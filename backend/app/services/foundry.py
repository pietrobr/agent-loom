"""Foundry Agent Service integration (NEW Foundry experience).

Uses the GA **Prompt Agents** model from ``azure-ai-projects`` 2.x: agents are
created with ``agents.create_version(PromptAgentDefinition(...))`` and invoked
through the OpenAI-compatible **Responses** API
(``get_openai_client().responses.create(..., stream=True)``) referencing the
agent by name. This is what the new Foundry portal expects — no legacy
Assistants/threads, so agents no longer show the "Update your agents" notice.

MVP strategy unchanged: one shared Foundry agent per catalog template; the
customer's knowledge/config is injected at runtime in the user input, and data
isolation is enforced by the ``org_id`` filter upstream.
"""
from __future__ import annotations

import logging
import re
from functools import lru_cache
from typing import Iterator, List, Optional

from azure.ai.projects import AIProjectClient
from azure.ai.projects.models import PromptAgentDefinition

from ..config import get_settings
from ..credentials import get_credential

log = logging.getLogger(__name__)


@lru_cache(maxsize=1)
def project_client() -> AIProjectClient:
    s = get_settings()
    return AIProjectClient(endpoint=s.foundry_project_endpoint, credential=get_credential())


@lru_cache(maxsize=1)
def _openai_client():
    # OpenAI-compatible client bound to the Foundry project endpoint.
    return project_client().get_openai_client()


_SAFE_NAME = re.compile(r"[^a-z0-9-]+")


def agent_name_for_instance(template_id: str, org_id: str) -> str:
    """Deterministic, Foundry-safe agent name for a customer's instance."""
    raw = f"{template_id}-{org_id}".lower()
    return _SAFE_NAME.sub("-", raw).strip("-")[:60]


def list_model_deployments() -> List[str]:
    """Return the names of the model deployments available in the Foundry project.

    These are the deployment names usable as the agent ``model`` parameter (the
    "Name" column in the Foundry portal's Deployed models table).
    """
    names: List[str] = []
    try:
        for dep in project_client().deployments.list(deployment_type="ModelDeployment"):
            name = getattr(dep, "name", None)
            if name:
                names.append(name)
    except Exception as exc:  # pragma: no cover - network/permission issues
        log.warning("list_model_deployments failed: %s", exc)
    # De-duplicate while preserving order.
    seen: set[str] = set()
    return [n for n in names if not (n in seen or seen.add(n))]


def build_instance_instructions(base_instructions: str, addendum: Optional[str]) -> str:
    """Compose the per-instance agent system instructions: template base + the
    customer's own guidance. Keeping the guidance in the system prompt (instead
    of the user turn) keeps each customer's agent self-contained."""
    parts = [base_instructions.strip()]
    if addendum:
        parts.append("\n[Customer-specific guidance]\n" + addendum.strip())
    return "\n".join(p for p in parts if p)


# --------------------------------------------------------------------------- #
# Agent / conversation management                                             #
# --------------------------------------------------------------------------- #
def create_template_agent(name: str, instructions: str, model: Optional[str] = None) -> str:
    """Create (or version) a Prompt Agent. Returns the agent **name**, which is
    how Responses reference it. Used to materialise a per-instance agent."""
    s = get_settings()
    model_id = model or s.foundry_model_deployment
    agent = project_client().agents.create_version(
        agent_name=name,
        definition=PromptAgentDefinition(model=model_id, instructions=instructions),
    )
    return agent.name


def create_instance_agent(
    template_id: str,
    org_id: str,
    base_instructions: str,
    addendum: Optional[str] = None,
    model: Optional[str] = None,
) -> str:
    """Materialise (or update) the real Foundry agent for a customer instance.
    Returns the agent name to store on the instance as ``foundry_agent_id``."""
    name = agent_name_for_instance(template_id, org_id)
    instructions = build_instance_instructions(base_instructions, addendum)
    return create_template_agent(name=name, instructions=instructions, model=model)


def delete_agent(name: str) -> None:
    """Best-effort delete of a per-instance agent (idempotent)."""
    try:
        project_client().agents.delete(name)
    except Exception as exc:  # pragma: no cover
        log.info("delete_agent(%s) ignored: %s", name, exc)


def create_thread() -> str:
    """Create a server-side conversation; returns its id (kept name for compat)."""
    return _openai_client().conversations.create().id


# --------------------------------------------------------------------------- #
# Streaming run                                                                #
# --------------------------------------------------------------------------- #
def _build_user_content(message: str, knowledge: List[dict], instance_overrides: dict) -> str:
    """Build the user turn. Customer guidance lives in the agent's system
    instructions now, so the turn carries only the retrieved knowledge."""
    parts: List[str] = []
    if knowledge:
        kb = "\n".join(
            f"- ({k.get('source','kb')}) {k.get('title','')}: {k.get('content','')[:1200]}"
            for k in knowledge
        )
        parts.append(f"[Knowledge base context - answer using ONLY this when applicable]\n{kb}\n")
    parts.append(f"[User question]\n{message}")
    return "\n\n".join(parts)


def stream_run(
    agent_id: str,   # holds the agent NAME in the new model
    thread_id: str,  # holds the conversation id in the new model
    user_message: str,
    knowledge: Optional[List[dict]] = None,
    instance_overrides: Optional[dict] = None,
) -> Iterator[tuple[str, str]]:
    """Yield (event, data) tuples suitable for SSE.

    Events: ``token`` (delta text), ``usage`` (JSON with token counts),
    ``done`` (end marker), ``error`` (failure message).

    Newer/preview model deployments occasionally return a transient
    "unable to complete inference" internal error. If the stream fails BEFORE
    any token is emitted, we retry once; once tokens have been sent we cannot
    safely restart, so the error is surfaced.
    """
    content = _build_user_content(user_message, knowledge or [], instance_overrides or {})
    client = _openai_client()

    def _attempt() -> Iterator[tuple[str, str]]:
        with client.responses.create(
            conversation=thread_id,
            input=[{"role": "user", "content": content}],
            extra_body={"agent_reference": {"name": agent_id, "type": "agent_reference"}},
            stream=True,
        ) as events:
            for event in events:
                etype = getattr(event, "type", "")
                if etype == "response.output_text.delta":
                    delta = getattr(event, "delta", "")
                    if delta:
                        yield ("token", delta)
                elif etype == "response.completed":
                    usage = getattr(getattr(event, "response", None), "usage", None)
                    if usage:
                        yield (
                            "usage",
                            f'{{"input":{getattr(usage,"input_tokens",0)},'
                            f'"output":{getattr(usage,"output_tokens",0)},'
                            f'"total":{getattr(usage,"total_tokens",0)}}}',
                        )
                elif etype == "error":
                    raise RuntimeError(str(getattr(event, "message", "stream error")))

    max_attempts = 2
    for attempt in range(1, max_attempts + 1):
        produced = False
        try:
            for ev, data in _attempt():
                if ev == "token":
                    produced = True
                yield (ev, data)
            yield ("done", "")
            return
        except Exception as exc:  # pragma: no cover - network/model issues
            if produced or attempt >= max_attempts:
                log.exception("Foundry stream failed (attempt %d, gave up)", attempt)
                yield ("error", f"agent run failed: {exc}")
                yield ("done", "")
                return
            log.warning("Foundry stream failed (attempt %d), retrying: %s", attempt, exc)

