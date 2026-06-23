"""Simulate agent conversations so Foundry emits real GenAI **traces** for an
agent — the same ``AppGenAIContent`` spans you already see in the portal.

It invokes the agent through the Foundry **Responses API** (referencing the
agent by name, exactly like the backend's chat flow), with grounded Aurelia
Motors Q&A built from the customer's knowledge base. Each call produces one
trace (developer + user message with ``[Knowledge base context ...]`` /
``[User question]`` and the assistant answer) — reusable later for evaluation
(`fetch_traces.py`) and for supervised fine-tuning.

Usage:
    python evals/simulate_traces.py aurelia-motors --count 1000
    python evals/simulate_traces.py aurelia-motors --count 20 --concurrency 8

Requires ``az login`` with access to the Foundry project. The agent must already
exist in the project (e.g. knowledge-faq-assistant-aurelia-motors).
"""
from __future__ import annotations

import argparse
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from _common import REPO, load_agent_config, load_azd_env, resolve_agent_dir

# Question banks grounded in the Aurelia knowledge files (doc stem -> questions).
# {model} is expanded across the four cars for the model-range topic.
MODELS = ["Stellare", "Vento", "Soluna", "Eterna"]
MODEL_QUESTIONS = [
    "What kind of car is the Aurelia {model}?",
    "What engine does the Aurelia {model} have?",
    "How much power does the Aurelia {model} produce?",
    "How many seats does the Aurelia {model} have?",
    "Tell me about the Aurelia {model}.",
    "Is the Aurelia {model} a good choice for me?",
]
QUESTION_BANK: dict[str, list[str]] = {
    "01-model-range": [
        "How many models does Aurelia make?",
        "What is Aurelia's annual production cap?",
        "Which Aurelia model is fully electric?",
        "What is the WLTP range of the Eterna?",
        "How fast does the Stellare go from 0 to 100 km/h?",
        "How quickly does the Vento's hardtop retract?",
        "Where are Aurelia cars built?",
        "Which model is the most driver-focused?",
        "Does the Soluna have all-wheel drive?",
        "What is the Executive Lounge package?",
    ],
    "02-warranty": [
        "How long is the new vehicle warranty?",
        "Is the Aurelia warranty transferable?",
        "What does the battery warranty cover?",
        "How long is the Eterna battery warranty?",
        "What is not covered by the warranty?",
        "How long is the corrosion warranty?",
        "Can I extend my warranty?",
        "What is Aurelia Extended Care?",
        "Are tyres covered under the warranty?",
        "When does my warranty coverage start?",
    ],
    "03-servicing": [
        "How often should I service my Stellare?",
        "What is the service interval for the Eterna?",
        "How do I book a service?",
        "Do you offer collection and delivery for servicing?",
        "What is the Aurelia Care Plan?",
        "How often should I rotate my tyres?",
        "Do you provide a courtesy car during service?",
        "How often does the Eterna get software updates?",
        "Can I transfer the Care Plan to a new owner?",
        "Are software updates free for the Eterna?",
    ],
    "04-ordering-bespoke": [
        "How do I place an order for an Aurelia?",
        "What deposit is required to order?",
        "How long does it take to build my car?",
        "What can I customise with Aurelia Bespoke?",
        "How many paint colours are available?",
        "Can I collect my car at the Modena factory?",
        "Can I cancel my order and get a refund?",
        "Until when can I change my specification?",
        "Can I add a personalised plaque?",
        "Do you offer home delivery?",
    ],
    "05-ownership-faq": [
        "What is Aurelia Privilege membership?",
        "Is roadside assistance included?",
        "How fast can the Eterna charge?",
        "Is a home charger included with the Eterna?",
        "How do I arrange a test drive?",
        "Can I track my car's build progress?",
        "Do you deliver outside Europe?",
        "Do you offer financing?",
        "What is the Extended Experience drive?",
        "What benefits does Aurelia Privilege include?",
    ],
}
# Natural phrasing variations to multiply the base questions into 1000+ unique turns.
PREFIXES = [
    "", "Hi, ", "Hello, ", "Quick question — ", "Could you tell me: ",
    "I'd like to know: ", "Please help: ", "I was wondering, ", "One more thing — ",
    "Hey there, ", "Good day. ", "Excuse me, ", "Can you clarify: ",
    "A question for you: ", "Sorry to bother you, but ",
]


def load_knowledge(knowledge_dir: Path) -> dict[str, str]:
    docs: dict[str, str] = {}
    for path in sorted(knowledge_dir.glob("*.md")):
        docs[path.stem] = " ".join(path.read_text(encoding="utf-8").split())
    if not docs:
        raise SystemExit(f"No knowledge .md files in {knowledge_dir}")
    return docs


def build_base_questions() -> list[tuple[str, str]]:
    """Return [(doc_stem, question)] grounded per knowledge doc."""
    items: list[tuple[str, str]] = []
    for model in MODELS:
        for q in MODEL_QUESTIONS:
            items.append(("01-model-range", q.format(model=model)))
    for stem, questions in QUESTION_BANK.items():
        for q in questions:
            items.append((stem, q))
    return items


def generate_turns(docs: dict[str, str], count: int) -> list[tuple[str, str]]:
    """Yield up to `count` unique (context, question) pairs."""
    base = build_base_questions()
    out: list[tuple[str, str]] = []
    seen: set[str] = set()
    for prefix in PREFIXES:
        for stem, question in base:
            if len(out) >= count:
                return out
            doc = docs.get(stem) or next(iter(docs.values()))
            phrased = f"{prefix}{question}" if not prefix else f"{prefix}{question[0].lower()}{question[1:]}"
            if phrased in seen:
                continue
            seen.add(phrased)
            context = f"- (upload) {stem}: {doc}"
            out.append((context, phrased))
    return out


def build_user_content(context: str, question: str) -> str:
    """Mirror the backend's composed user turn."""
    return (
        "[Knowledge base context - answer using ONLY this when applicable]\n"
        f"{context}\n\n"
        "[User question]\n"
        f"{question}"
    )


def main() -> None:
    load_azd_env()
    for stray in ("AZURE_OPENAI_API_KEY", "OPENAI_API_KEY"):
        os.environ.pop(stray, None)
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("agent_dir", help="agent name under ./agents (or a path) with agent.json")
    ap.add_argument("--count", type=int, default=1000, help="number of traces to generate")
    ap.add_argument("--concurrency", type=int, default=12, help="parallel in-flight calls")
    args = ap.parse_args()

    agent_dir = resolve_agent_dir(args.agent_dir)
    cfg = load_agent_config(agent_dir)
    agent = cfg["agent"]
    knowledge_dir = (REPO / cfg.get("knowledge_dir", "")).resolve()
    if not knowledge_dir.is_dir():
        raise SystemExit(f"knowledge_dir not found: {knowledge_dir} (set it in agent.json)")

    project_endpoint = os.environ.get("FOUNDRY_PROJECT_ENDPOINT")
    if not project_endpoint:
        raise SystemExit("FOUNDRY_PROJECT_ENDPOINT is not set (run `azd env get-values`).")

    docs = load_knowledge(knowledge_dir)
    turns = generate_turns(docs, args.count)
    print(f"Agent: {agent}")
    print(f"Knowledge: {knowledge_dir.name} ({len(docs)} docs)")
    print(f"Generating {len(turns)} traces (concurrency={args.concurrency})...")
    if len(turns) < args.count:
        print(f"  note: only {len(turns)} unique turns available (< requested {args.count}).")

    from azure.ai.projects import AIProjectClient
    from azure.identity import DefaultAzureCredential

    client = AIProjectClient(
        endpoint=project_endpoint, credential=DefaultAzureCredential()
    ).get_openai_client()
    agent_ref = {"agent_reference": {"name": agent, "type": "agent_reference"}}

    counter = {"ok": 0, "err": 0}
    lock = threading.Lock()
    t0 = time.time()

    def invoke(turn: tuple[str, str]) -> None:
        context, question = turn
        content = build_user_content(context, question)
        for attempt in range(1, 4):
            try:
                client.responses.create(
                    input=[{"role": "user", "content": content}],
                    extra_body=agent_ref,
                )
                with lock:
                    counter["ok"] += 1
                    done = counter["ok"] + counter["err"]
                if done % 50 == 0:
                    rate = done / max(time.time() - t0, 1e-3)
                    print(f"  {done}/{len(turns)}  ({rate:.1f}/s, ok={counter['ok']}, err={counter['err']})")
                return
            except Exception as exc:  # pragma: no cover - network/429
                if attempt == 3:
                    with lock:
                        counter["err"] += 1
                    if counter["err"] <= 5:
                        print(f"  ! failed ({type(exc).__name__}): {str(exc)[:140]}")
                    return
                time.sleep(2 * attempt)

    with ThreadPoolExecutor(max_workers=args.concurrency) as pool:
        futures = [pool.submit(invoke, t) for t in turns]
        for _ in as_completed(futures):
            pass

    dur = time.time() - t0
    print(f"\nDone in {dur:.0f}s — ok={counter['ok']}, err={counter['err']}.")
    print("Traces are emitted to the Foundry project's Application Insights")
    print("(table AppGenAIContent). Allow 1-3 min for ingestion, then view them in")
    print("the portal's tracing view or rebuild the eval dataset with:")
    print(f"  python fetch_traces.py {agent_dir.name} --days 1")


if __name__ == "__main__":
    main()
