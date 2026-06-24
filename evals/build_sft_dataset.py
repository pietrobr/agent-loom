"""Build a **supervised fine-tuning (SFT)** dataset from an agent's Foundry
traces, in the Azure OpenAI chat format, ready to fine-tune (e.g. gpt-4.1-mini).

It reads the agent's GenAI content spans from Foundry's tracing store
(`AppGenAIContent`) — the same traces you see in the portal — and turns each
turn into a chat example:

    {"messages": [
        {"role": "system",    "content": "<agent instructions>"},
        {"role": "user",      "content": "[Knowledge base context ...]\\n[User question] ..."},
        {"role": "assistant", "content": "<the agent's answer>"}
    ]}

The system prompt is taken from the trace's ``developer`` message (the real
agent instructions). Output is split into train/validation JSONL under
``agents/<name>/sft/``.

Usage:
    python evals/build_sft_dataset.py aurelia-motors
    python evals/build_sft_dataset.py aurelia-motors --days 1 --val-split 0.1
"""
from __future__ import annotations

import argparse
import hashlib
import json
import random

from _common import load_agent_config, load_azd_env, resolve_agent_dir
from fetch_traces import _last_role_text, query_logs, resolve_workspace_guid


def build_examples(workspace_guid: str, agent: str, days: int, min_chars: int) -> list[dict]:
    kql = (
        "AppGenAIContent "
        f"| where TimeGenerated > ago({days}d) "
        f"| where AgentName == '{agent}' "
        "| where isnotempty(OutputMessages) "
        "| project TraceId, InputMessages, OutputMessages "
        "| order by TraceId asc"
    )
    print("KQL:\n" + kql + "\n")
    rows = query_logs(workspace_guid, kql)
    print(f"Fetched {len(rows)} content span(s) for agent '{agent}'.")

    seen: set[str] = set()
    examples: list[dict] = []
    for row in rows:
        system = _last_role_text(row.get("InputMessages", ""), ("developer", "system"))
        user = _last_role_text(row.get("InputMessages", ""), ("user",))
        assistant = _last_role_text(row.get("OutputMessages", ""), ("assistant", "model"))
        if not user or not assistant or len(assistant) < min_chars:
            continue
        key = hashlib.sha1(user.encode()).hexdigest()
        if key in seen:
            continue
        seen.add(key)
        messages = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": user})
        messages.append({"role": "assistant", "content": assistant})
        examples.append({"messages": messages})
    return examples


def write_jsonl(path, rows: list[dict]) -> None:
    with path.open("w", encoding="utf-8") as fh:
        for r in rows:
            fh.write(json.dumps(r, ensure_ascii=False) + "\n")


def main() -> None:
    load_azd_env()
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("agent_dir", help="agent name under ./agents (or a path) with agent.json")
    ap.add_argument("--days", type=int, default=None, help="trace look-back (default from config)")
    ap.add_argument("--workspace", default=None, help="Log Analytics workspace GUID")
    ap.add_argument("--val-split", type=float, default=0.1, help="validation fraction")
    ap.add_argument("--min-assistant-chars", type=int, default=20, help="drop very short answers")
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()

    agent_dir = resolve_agent_dir(args.agent_dir)
    cfg = load_agent_config(agent_dir)
    agent = cfg["agent"]
    days = args.days if args.days is not None else int(cfg.get("days", 90))

    workspace_guid = resolve_workspace_guid(args.workspace)
    print(f"Agent: {agent}  |  workspace: {workspace_guid}  |  look-back: {days}d")

    examples = build_examples(workspace_guid, agent, days, args.min_assistant_chars)
    if len(examples) < 10:
        raise SystemExit(
            f"Only {len(examples)} examples — Azure OpenAI fine-tuning needs >= 10. "
            f"Generate more traces (simulate_traces.py) or widen --days."
        )

    random.Random(args.seed).shuffle(examples)
    n_val = max(1, int(len(examples) * args.val_split)) if args.val_split > 0 else 0
    val = examples[:n_val]
    train = examples[n_val:]

    out_dir = agent_dir / "sft"
    out_dir.mkdir(exist_ok=True)
    train_path = out_dir / "train.jsonl"
    val_path = out_dir / "validation.jsonl"
    write_jsonl(train_path, train)
    if val:
        write_jsonl(val_path, val)

    print(f"\nSFT dataset written:")
    print(f"  train:      {train_path}  ({len(train)} examples)")
    if val:
        print(f"  validation: {val_path}  ({len(val)} examples)")
    print("\nSample (first training example):")
    print(json.dumps(train[0], ensure_ascii=False)[:600])
    print("\nNext: fine-tune gpt-4.1-mini with:")
    print(f"  python finetune.py {agent_dir.name} --model gpt-4.1-mini")


if __name__ == "__main__":
    main()
