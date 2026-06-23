"""Run a **groundedness** evaluation over the dataset built from Foundry traces
using the Foundry **Evals API** (``openai_client.evals``), so the run shows up in
the *new* Microsoft Foundry portal under **Build → Evaluations**.

Groundedness measures how well the agent's ``response`` is supported by the
retrieved ``context`` (the knowledge base snippets) for a given ``query`` — the
core quality signal for a RAG/FAQ assistant. It runs server-side in Foundry via
the built-in ``builtin.groundedness`` evaluator (an ``azure_ai_evaluator``
grader), judged by a chat model deployment.

Each agent is configured in its own folder under ``agents/<name>/agent.json``;
the dataset is read from that folder's ``dataset.jsonl`` (run ``fetch_traces.py``
first).

Usage:
    python evals/run_eval.py aurelia-motors
    python evals/run_eval.py aurelia-motors --name aurelia-groundedness --judge gpt-4o-mini

Requires ``az login`` with access to the Foundry project + a chat model
deployment to act as the LLM judge (default: agent.json ``judge`` or
FOUNDRY_MODEL_DEPLOYMENT).
"""
from __future__ import annotations

import argparse
import json
import os
import time
from datetime import datetime, timezone

from _common import (
    DATASET_NAME,
    load_agent_config,
    load_azd_env,
    resolve_agent_dir,
)

TERMINAL_STATES = {"completed", "failed", "canceled", "cancelled", "error"}


def _load_rows(data_path) -> list[dict]:
    rows: list[dict] = []
    with data_path.open(encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


DEFAULT_INSTRUCTIONS = (
    "You are a helpful Knowledge / FAQ Assistant. Answer the user's question "
    "using ONLY the information in the 'Knowledge base context' section of the "
    "user message. If the answer is not in that context, say you don't have that "
    "information. Be concise and professional."
)
USER_TEMPLATE = (
    "[Knowledge base context - answer using ONLY this when applicable]\n"
    "{{item.context}}\n\n"
    "[User question]\n"
    "{{item.query}}"
)


def _mean_score(openai_client, eval_id: str, run_id: str) -> tuple[float | None, int, int]:
    """Return (mean_score, passed, total) for a completed run."""
    scores: list[float] = []
    passed = 0
    total = 0
    try:
        for item in openai_client.evals.runs.output_items.list(run_id, eval_id=eval_id):
            for res in getattr(item, "results", []) or []:
                rd = res if isinstance(res, dict) else getattr(res, "__dict__", {})
                total += 1
                if rd.get("passed"):
                    passed += 1
                val = rd.get("score")
                if isinstance(val, (int, float)):
                    scores.append(float(val))
    except Exception:  # pragma: no cover
        return None, passed, total
    mean = sum(scores) / len(scores) if scores else None
    return mean, passed, total


def main() -> None:
    load_azd_env()
    # The Foundry account has key auth disabled. If a stray OpenAI key lingers in
    # the environment, the openai client would attach it as an `api-key` header
    # (alongside the Entra token) and the account rejects the request. Drop them
    # so the judge authenticates purely with Entra ID.
    for stray in ("AZURE_OPENAI_API_KEY", "OPENAI_API_KEY"):
        os.environ.pop(stray, None)
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("agent_dir", help="agent name under ./agents (or a path) with agent.json")
    ap.add_argument("--name", default=None, help="evaluation display name")
    ap.add_argument("--judge", default=None, help="grader (LLM judge) model deployment")
    ap.add_argument("--models", default=None,
                    help="comma-separated target model deployments to compare (overrides config)")
    args = ap.parse_args()

    agent_dir = resolve_agent_dir(args.agent_dir)
    cfg = load_agent_config(agent_dir)
    data_path = agent_dir / DATASET_NAME
    if not data_path.exists():
        raise SystemExit(f"Dataset not found: {data_path}. Run fetch_traces.py {agent_dir.name} first.")

    project_endpoint = os.environ.get("FOUNDRY_PROJECT_ENDPOINT")
    if not project_endpoint:
        raise SystemExit("FOUNDRY_PROJECT_ENDPOINT is not set (run `azd env get-values`).")

    rows = _load_rows(data_path)
    if not rows:
        raise SystemExit(f"{data_path} is empty. Run fetch_traces.py {agent_dir.name} first.")

    judge = args.judge or cfg.get("judge") or os.environ.get("FOUNDRY_MODEL_DEPLOYMENT", "gpt-4o-mini")
    if args.models:
        models = [m.strip() for m in args.models.split(",") if m.strip()]
    else:
        models = cfg.get("models") or [judge]
    instructions = cfg.get("instructions") or DEFAULT_INSTRUCTIONS

    from azure.ai.projects import AIProjectClient
    from azure.identity import DefaultAzureCredential

    project_client = AIProjectClient(endpoint=project_endpoint, credential=DefaultAzureCredential())
    openai_client = project_client.get_openai_client()

    eval_name = args.name or cfg.get("evaluation_name") or f"{agent_dir.name}-groundedness"
    eval_name = f"{eval_name}-{datetime.now(timezone.utc):%Y%m%d-%H%M%S}"
    print(f"Agent folder: {agent_dir.name}  |  judge: {judge}  |  rows: {len(rows)}")
    print(f"Comparing models: {', '.join(models)}")
    print(f"Creating evaluation '{eval_name}' (new Foundry portal)...")

    # 1. One eval: groundedness scored on the MODEL-GENERATED answer
    #    ({{sample.output_text}}) for the same query + context.
    eval_object = openai_client.evals.create(
        name=eval_name,
        data_source_config={
            "type": "custom",
            "item_schema": {
                "type": "object",
                "properties": {
                    "query": {"type": "string"},
                    "context": {"type": "string"},
                },
                "required": ["query", "context"],
            },
            "include_sample_schema": True,
        },
        testing_criteria=[
            {
                "type": "azure_ai_evaluator",
                "name": "groundedness",
                "evaluator_name": "builtin.groundedness",
                "initialization_parameters": {"model": judge},
                "data_mapping": {
                    "query": "{{item.query}}",
                    "context": "{{item.context}}",
                    "response": "{{sample.output_text}}",
                },
            }
        ],
    )
    print(f"  eval id: {eval_object.id}")

    source_content = [{"item": {"query": r["query"], "context": r["context"]}} for r in rows]

    # 2. One run per target model — Foundry generates the answer with that model,
    #    then grades its groundedness. Using the Azure-native
    #    `azure_ai_target_completions` data source + `azure_ai_model` target makes
    #    the portal show the model in the **Target** column of the runs table.
    runs: dict[str, str] = {}
    for model in models:
        run = openai_client.evals.runs.create(
            eval_id=eval_object.id,
            name=f"eval-{model}",
            metadata={"target_model": model},
            data_source={
                "type": "azure_ai_target_completions",
                "source": {"type": "file_content", "content": source_content},
                "input_messages": {
                    "type": "template",
                    "template": [
                        {"type": "message", "role": "system",
                         "content": {"type": "input_text", "text": instructions}},
                        {"type": "message", "role": "user",
                         "content": {"type": "input_text", "text": USER_TEMPLATE}},
                    ],
                },
                "target": {"type": "azure_ai_model", "model": model},
            },
        )
        runs[model] = run.id
        print(f"  run '{model}': {run.id}")

    # 3. Poll all runs until every one reaches a terminal state.
    print("\nWaiting for runs to complete", end="", flush=True)
    statuses: dict[str, str] = {m: "queued" for m in models}
    while any(s not in TERMINAL_STATES for s in statuses.values()):
        time.sleep(5)
        for model, run_id in runs.items():
            if statuses[model] in TERMINAL_STATES:
                continue
            r = openai_client.evals.runs.retrieve(run_id, eval_id=eval_object.id)
            statuses[model] = r.status
        print(".", end="", flush=True)
    print(" done")

    # 4. Comparison table.
    print(f"\n=== Groundedness comparison · {eval_name} ===")
    header = f"{'Model':<18} {'Status':<11} {'Pass/Total':<11} {'Mean score':<10}"
    print(header)
    print("-" * len(header))
    for model in models:
        run_id = runs[model]
        mean, passed, total = _mean_score(openai_client, eval_object.id, run_id)
        mean_str = f"{mean:.2f}" if mean is not None else "-"
        print(f"{model:<18} {statuses[model]:<11} {f'{passed}/{total}':<11} {mean_str:<10}")

    # Eval-level portal link (strip the per-run suffix from a run's report_url).
    sample_run = openai_client.evals.runs.retrieve(next(iter(runs.values())), eval_id=eval_object.id)
    report_url = getattr(sample_run, "report_url", None)
    eval_url = report_url.split("/run/")[0] if report_url else eval_object.id
    print("\nView the comparison in the new Foundry portal (Build → Evaluations):")
    print(f"  {eval_url}")


if __name__ == "__main__":
    main()
