"""Build a groundedness evaluation dataset from a Foundry agent's traces, read
**directly from Foundry's tracing store** (the Application Insights / Log
Analytics workspace wired to the Foundry project).

Foundry emits GenAI content spans into the ``AppGenAIContent`` table. Each row
carries, per agent turn:

  * ``InputMessages``  — the messages sent to the model. For this app the *user*
    message embeds the retrieved knowledge as
    ``[Knowledge base context ...]`` followed by ``[User question] <q>``.
  * ``OutputMessages`` — the assistant's answer.

This script queries that table for one agent (configured per folder under
``agents/<name>/agent.json``), splits each user turn into ``context`` (the
grounding knowledge) and ``query`` (the question), pairs it with the
``response``, and writes ``dataset.jsonl`` into that agent folder. No Cosmos /
backend access required — only the Log Analytics query endpoint (public) and
``az login``.

Usage:
    python evals/fetch_traces.py aurelia-motors
    python evals/fetch_traces.py aurelia-motors --days 30
    python evals/fetch_traces.py agents/aurelia-motors --workspace <law-guid>
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import urllib.error
import urllib.request

from azure.identity import DefaultAzureCredential

from _common import (
    DATASET_NAME,
    load_agent_config,
    load_azd_env,
    resolve_agent_dir,
)

LOGS_SCOPE = "https://api.loganalytics.io/.default"
QUESTION_MARKER = "[User question]"
CONTEXT_MARKER = "[Knowledge base context"


# --------------------------------------------------------------------------- #
# Workspace resolution                                                        #
# --------------------------------------------------------------------------- #
def _az(*args: str) -> str:
    out = subprocess.run(
        ["az", *args], capture_output=True, text=True, timeout=120, shell=os.name == "nt"
    )
    if out.returncode != 0:
        raise RuntimeError(out.stderr.strip() or f"az {' '.join(args)} failed")
    return out.stdout.strip()


def resolve_workspace_guid(explicit: str | None) -> str:
    """Customer (GUID) id of the Log Analytics workspace behind the project."""
    if explicit:
        return explicit
    if os.environ.get("LOG_ANALYTICS_WORKSPACE_ID"):
        return os.environ["LOG_ANALYTICS_WORKSPACE_ID"]
    rg = os.environ.get("AZURE_RESOURCE_GROUP")
    if not rg:
        raise SystemExit("Set --workspace <guid> or AZURE_RESOURCE_GROUP (run `azd env get-values`).")
    rows = json.loads(
        _az("resource", "list", "-g", rg, "--resource-type",
            "Microsoft.OperationalInsights/workspaces", "--query", "[].name", "-o", "json")
    )
    if not rows:
        raise SystemExit(f"No Log Analytics workspace found in resource group {rg}.")
    return _az("monitor", "log-analytics", "workspace", "show", "-g", rg, "-n", rows[0],
               "--query", "customerId", "-o", "tsv")


# --------------------------------------------------------------------------- #
# Log Analytics query                                                         #
# --------------------------------------------------------------------------- #
def query_logs(workspace_guid: str, kql: str) -> list[dict]:
    token = DefaultAzureCredential().get_token(LOGS_SCOPE).token
    req = urllib.request.Request(
        f"https://api.loganalytics.io/v1/workspaces/{workspace_guid}/query",
        data=json.dumps({"query": kql}).encode(),
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=180) as resp:
            body = json.load(resp)
    except urllib.error.HTTPError as exc:  # surface the KQL error
        raise SystemExit(f"Log Analytics query failed ({exc.code}): {exc.read().decode()}")
    table = body["tables"][0]
    cols = [c["name"] for c in table["columns"]]
    return [dict(zip(cols, row)) for row in table["rows"]]


# --------------------------------------------------------------------------- #
# Message parsing                                                             #
# --------------------------------------------------------------------------- #
def _parts_text(msg: dict) -> str:
    parts = msg.get("parts") or []
    chunks: list[str] = []
    for p in parts:
        if isinstance(p, dict):
            chunks.append(p.get("content") or p.get("text") or "")
        elif isinstance(p, str):
            chunks.append(p)
    return "\n".join(c for c in chunks if c).strip()


def _last_role_text(raw: str, roles: tuple[str, ...]) -> str:
    try:
        messages = json.loads(raw) if raw else []
    except json.JSONDecodeError:
        return ""
    if isinstance(messages, dict):
        messages = [messages]
    text = ""
    for msg in messages:
        if isinstance(msg, dict) and msg.get("role") in roles:
            t = _parts_text(msg)
            if t:
                text = t  # keep the last matching one
    return text


def _split_user_turn(user_text: str) -> tuple[str, str]:
    if QUESTION_MARKER in user_text:
        before, _, after = user_text.partition(QUESTION_MARKER)
        query = after.strip()
        context_block = before
    else:
        query = user_text.strip()
        context_block = ""
    context = "\n".join(
        ln for ln in context_block.splitlines() if CONTEXT_MARKER not in ln
    ).strip()
    return context, query


# --------------------------------------------------------------------------- #
# Main                                                                         #
# --------------------------------------------------------------------------- #
def fetch(workspace_guid: str, agent: str, days: int) -> list[dict]:
    kql = (
        "AppGenAIContent "
        f"| where TimeGenerated > ago({days}d) "
        f"| where AgentName == '{agent}' "
        "| where isnotempty(OutputMessages) "
        "| project TimeGenerated, TraceId, SpanId, ModelName, InputMessages, OutputMessages "
        "| order by TimeGenerated asc"
    )
    print("KQL:\n" + kql + "\n")
    raw_rows = query_logs(workspace_guid, kql)
    print(f"Fetched {len(raw_rows)} GenAI content span(s) for agent '{agent}'.")

    seen: set[str] = set()
    out: list[dict] = []
    for row in raw_rows:
        user_text = _last_role_text(row.get("InputMessages", ""), ("user",))
        response = _last_role_text(row.get("OutputMessages", ""), ("assistant", "model"))
        if not user_text or not response:
            continue
        context, query = _split_user_turn(user_text)
        dedupe_key = hashlib.sha1(f"{query}\x1f{response}".encode()).hexdigest()
        if dedupe_key in seen:
            continue
        seen.add(dedupe_key)
        out.append(
            {
                "query": query,
                "context": context,
                "response": response,
                "trace_id": row.get("TraceId"),
                "model": row.get("ModelName"),
            }
        )
    return out


def main() -> None:
    load_azd_env()
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("agent_dir", help="agent name under ./agents (or a path) with agent.json")
    ap.add_argument("--agent", default=None, help="override the Foundry agent name")
    ap.add_argument("--days", type=int, default=None, help="look-back window (default from config)")
    ap.add_argument("--workspace", default=None, help="Log Analytics workspace GUID")
    ap.add_argument(
        "--keep-empty-context",
        action="store_true",
        help="keep turns even when no knowledge context was injected",
    )
    args = ap.parse_args()

    agent_dir = resolve_agent_dir(args.agent_dir)
    cfg = load_agent_config(agent_dir)
    agent = args.agent or cfg["agent"]
    days = args.days if args.days is not None else int(cfg.get("days", 90))
    out_path = agent_dir / DATASET_NAME
    print(f"Agent folder: {agent_dir.name}  |  agent: {agent}  |  look-back: {days}d")

    workspace_guid = resolve_workspace_guid(args.workspace)
    print(f"Log Analytics workspace: {workspace_guid}")

    rows = fetch(workspace_guid, agent, days)
    if not args.keep_empty_context:
        kept = [r for r in rows if r["context"]]
        dropped = len(rows) - len(kept)
        if dropped:
            print(f"Dropping {dropped} turn(s) without grounding context.")
        rows = kept

    if not rows:
        raise SystemExit(
            "No gradeable turns found. Chat with the agent first, widen --days, or "
            "re-run with --keep-empty-context."
        )

    with out_path.open("w", encoding="utf-8") as fh:
        for r in rows:
            fh.write(json.dumps(r, ensure_ascii=False) + "\n")
    print(f"Wrote {len(rows)} row(s) -> {out_path}")


if __name__ == "__main__":
    main()
