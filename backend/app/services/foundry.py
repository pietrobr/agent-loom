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

import base64
import json
import logging
import re
import urllib.request
from functools import lru_cache
from typing import Iterator, List, Optional
from urllib.parse import quote

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


@lru_cache(maxsize=1)
def _embeddings_client():
    """Azure OpenAI client scoped to the Foundry *account* (not the project).

    Embeddings live on the account data-plane route
    (``/openai/deployments/<deployment>/embeddings``); the project-scoped client
    only exposes the Responses/Conversations surface and 404s on embeddings.
    """
    from azure.identity import get_bearer_token_provider
    from openai import AzureOpenAI

    s = get_settings()
    # Strip the '/api/projects/<name>' suffix to reach the account endpoint.
    account = s.foundry_project_endpoint.split("/api/projects/")[0].rstrip("/")
    token_provider = get_bearer_token_provider(
        get_credential(), "https://cognitiveservices.azure.com/.default"
    )
    return AzureOpenAI(
        azure_endpoint=account,
        azure_ad_token_provider=token_provider,
        api_version="2024-10-21",
    )


_SAFE_NAME = re.compile(r"[^a-z0-9-]+")


def agent_name_for_instance(template_id: str, org_id: str) -> str:
    """Deterministic, Foundry-safe agent name for a customer's instance."""
    raw = f"{template_id}-{org_id}".lower()
    return _SAFE_NAME.sub("-", raw).strip("-")[:60]


def _account_arm_id() -> Optional[str]:
    """ARM resource id of the Foundry (Cognitive Services) account, or None when
    the subscription/resource-group are not configured."""
    s = get_settings()
    sub = s.azure_subscription_id
    rg = s.azure_resource_group
    if not (sub and rg):
        return None
    account = s.foundry_account_name
    if not account and s.foundry_project_endpoint:
        # Derive the account name from the endpoint host's first label.
        account = s.foundry_project_endpoint.split("//", 1)[-1].split(".", 1)[0]
    if not account:
        return None
    return (
        f"/subscriptions/{sub}/resourceGroups/{rg}/providers"
        f"/Microsoft.CognitiveServices/accounts/{account}"
    )


def _list_account_deployments() -> List[str]:
    """List deployment names via the ARM **control plane** — the source of truth.

    The project data-plane deployments API is eventually consistent and omits
    deployments created outside the project (e.g. fine-tuned models deployed via
    the CLI/portal), so they never show up there. The account-level control-plane
    listing always reflects every deployment. Requires the backend identity to
    have read access (Reader) on the account; on failure we return [] and the
    caller falls back to the project list.
    """
    arm_id = _account_arm_id()
    if not arm_id:
        return []
    try:
        token = get_credential().get_token("https://management.azure.com/.default").token
        url = f"https://management.azure.com{arm_id}/deployments?api-version=2023-05-01"
        req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
        with urllib.request.urlopen(req, timeout=10) as resp:  # noqa: S310 (trusted ARM URL)
            data = json.load(resp)
    except Exception as exc:  # pragma: no cover - network/permission issues
        log.warning("ARM deployment listing failed: %s", exc)
        return []
    return [n for item in data.get("value", []) if (n := item.get("name"))]


def _list_project_deployments() -> List[str]:
    """List deployment names via the Foundry **project** data plane."""
    names: List[str] = []
    try:
        for dep in project_client().deployments.list(deployment_type="ModelDeployment"):
            name = getattr(dep, "name", None)
            if name:
                names.append(name)
    except Exception as exc:  # pragma: no cover - network/permission issues
        log.warning("project deployment listing failed: %s", exc)
    return names


def list_model_deployments() -> List[str]:
    """Return the names of the model deployments available on the Foundry account.

    These are the deployment names usable as the agent ``model`` parameter (the
    "Name" column in the Foundry portal's Deployed models table).

    Prefers the ARM control-plane listing (complete and immediately consistent),
    then merges in any project data-plane entries so the dropdown is never empty
    even if the backend identity lacks ARM read access.
    """
    names = _list_account_deployments() + _list_project_deployments()
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


def reconcile_instance_agent(
    template_id: str,
    org_id: str,
    base_instructions: str,
    addendum: Optional[str] = None,
    model: Optional[str] = None,
    prev_addendum: Optional[str] = None,
    prev_model: Optional[str] = None,
    agent_exists: bool = False,
) -> str:
    """Create or update a customer's agent WITHOUT clobbering portal edits.

    The decision is based on the APP-side inputs (model + addendum), not on the
    live agent definition — because the Foundry portal normalises instructions
    when an admin edits the agent there, which would otherwise look like a change.

    - Agent doesn't exist yet → create it (v1).
    - Exists and neither the model nor the addendum changed in AgentLoom → no-op
      (preserves tools, knowledge and instruction tweaks made in the portal).
    - Model or addendum changed → re-version, carrying over the tools currently
      on the live agent so portal-added tools survive.
    Returns the agent name.
    """
    name = agent_name_for_instance(template_id, org_id)
    s = get_settings()
    desired_model = model or s.foundry_model_deployment
    desired_instructions = build_instance_instructions(base_instructions, addendum)

    if not agent_exists:
        return create_template_agent(name=name, instructions=desired_instructions, model=desired_model)

    unchanged = (model or "") == (prev_model or "") and (addendum or "") == (prev_addendum or "")
    if unchanged:
        return name  # app inputs unchanged → leave the portal's agent untouched

    # Re-version, preserving the tools already on the agent (portal-added too).
    existing_tools = get_agent_details(name).get("tools") or []
    agent = project_client().agents.create_version(
        agent_name=name,
        definition=PromptAgentDefinition(
            model=desired_model,
            instructions=desired_instructions,
            tools=existing_tools or [],
        ),
    )
    return agent.name


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
# Agent inspection (model, tools) + portal deep link                          #
# --------------------------------------------------------------------------- #
def _to_plain(obj: object) -> object:
    """Best-effort convert an SDK model (MutableMapping/attrs) to plain data."""
    if obj is None or isinstance(obj, (str, int, float, bool)):
        return obj
    if isinstance(obj, dict):
        return {k: _to_plain(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_to_plain(v) for v in obj]
    as_dict = getattr(obj, "as_dict", None)
    if callable(as_dict):
        try:
            return _to_plain(as_dict())
        except Exception:  # pragma: no cover
            pass
    if hasattr(obj, "items"):
        try:
            return {k: _to_plain(v) for k, v in obj.items()}  # type: ignore[attr-defined]
        except Exception:  # pragma: no cover
            pass
    return obj


def _latest_version(name: str):
    """Return the most recent AgentVersionDetails for an agent (or None)."""
    try:
        versions = list(project_client().agents.list_versions(name, limit=1, order="desc"))
        if versions:
            return versions[0]
    except Exception as exc:  # pragma: no cover
        log.warning("list_versions(%s) failed: %s", name, exc)
    return None


def _tool_key(tool: dict) -> str:
    """Stable identity for a tool: type + optional name (function tools)."""
    t = tool.get("type", "tool")
    n = tool.get("name") or (tool.get("function") or {}).get("name") or ""
    return f"{t}:{n}" if n else t


def _extract_definition(details) -> dict:
    """Pull the agent definition (model/instructions/tools) out of version details."""
    plain = _to_plain(details) or {}
    if not isinstance(plain, dict):
        return {}
    # The definition may be nested under 'definition' or inlined.
    return plain.get("definition") if isinstance(plain.get("definition"), dict) else plain


def get_agent_details(name: str) -> dict:
    """Read a customer agent's current model, instructions and configured tools."""
    details = _latest_version(name)
    out = {"name": name, "version": None, "model": None, "instructions": "", "tools": []}
    if details is None:
        return out
    plain = _to_plain(details) or {}
    out["version"] = (plain.get("version") if isinstance(plain, dict) else None) or getattr(details, "version", None)
    definition = _extract_definition(details)
    out["model"] = definition.get("model")
    out["instructions"] = definition.get("instructions") or ""
    tools = definition.get("tools") or []
    out["tools"] = [t for t in (_to_plain(tools) or []) if isinstance(t, dict)]
    return out


def portal_url_for_agent(name: str) -> Optional[str]:
    """Direct deep link into the Azure AI Foundry portal that opens THIS agent.

    The new ("nextgen") portal routes a project as
    ``/nextgen/r/{token},{rg},,{account},{project}`` where ``token`` is the
    subscription GUID encoded as base64url, then the agent as
    ``/build/agents/{agentName}/build``. We derive everything from the project's
    ARM id carried in ``FOUNDRY_PORTAL_URL`` (the ``wsid`` query value).
    Falls back to the plain project URL if the ARM id can't be parsed.
    """
    base = get_settings().foundry_portal_url
    if not base:
        return None

    m = re.search(r"wsid=([^&]+)", base)
    wsid = m.group(1) if m else base
    am = re.search(
        r"/subscriptions/([^/]+)/resourceGroups/([^/]+)/providers/"
        r"Microsoft\.CognitiveServices/accounts/([^/]+)/projects/([^/?&]+)",
        wsid,
        re.IGNORECASE,
    )
    if not am:
        # Couldn't parse — return the project URL (still useful) with tid.
        tid = get_settings().foundry_tenant_id
        if tid and "tid=" not in base:
            sep = "&" if "?" in base else "?"
            return f"{base}{sep}tid={tid}"
        return base

    sub, rg, account, project = am.group(1), am.group(2), am.group(3), am.group(4)
    try:
        token = base64.urlsafe_b64encode(bytes.fromhex(sub.replace("-", ""))).rstrip(b"=").decode()
    except ValueError:
        token = sub  # not a GUID (shouldn't happen) — degrade gracefully
    return (
        f"https://ai.azure.com/nextgen/r/{token},{rg},,{account},{project}"
        f"/build/agents/{quote(name, safe='')}/build"
    )


def set_agent_tools(name: str, model: str, instructions: str, tools: list[dict]) -> dict:
    """Re-version the agent with the given set of (enabled) tools."""
    s = get_settings()
    model_id = model or s.foundry_model_deployment
    definition = PromptAgentDefinition(
        model=model_id,
        instructions=instructions,
        tools=tools or [],
    )
    agent = project_client().agents.create_version(agent_name=name, definition=definition)
    return {"name": agent.name}



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

