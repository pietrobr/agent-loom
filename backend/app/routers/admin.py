"""Admin endpoints: catalog CRUD, customer onboarding, instances, metering.

Every endpoint requires the ``admin`` role.
"""
from __future__ import annotations

import logging
import uuid
from typing import Any, Dict, List

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form

from ..models import Instance, Template, Tenant, Branding, SYSTEM_ORG, _now
from ..security import Principal, require_admin
from ..services import agentic, blob, cosmos, foundry, search, ciam_groups, tracing
from ..config import get_settings

router = APIRouter(prefix="/v1/admin", tags=["admin"])
log = logging.getLogger(__name__)


# --------------------------------------------------------------------------- #
# Templates                                                                    #
# --------------------------------------------------------------------------- #
@router.get("/templates")
def list_templates(_: Principal = Depends(require_admin)) -> List[Dict[str, Any]]:
    return cosmos.list_all_templates()


@router.post("/templates")
def upsert_template(payload: Dict[str, Any], _: Principal = Depends(require_admin)) -> Dict[str, Any]:
    payload.setdefault("id", str(uuid.uuid4()))
    payload["org_id"] = SYSTEM_ORG
    payload["updated_at"] = _now()
    payload.setdefault("created_at", payload["updated_at"])
    tmpl = Template(**payload).model_dump()
    return cosmos.save_template(tmpl)


@router.delete("/templates/{template_id}")
def delete_template(template_id: str, _: Principal = Depends(require_admin)) -> Dict[str, str]:
    cosmos.delete("catalog", SYSTEM_ORG, template_id)
    return {"status": "deleted"}


@router.get("/foundry/models")
def list_foundry_models(_: Principal = Depends(require_admin)) -> List[str]:
    """Model deployments available in the Foundry project (the 'Name' column in
    the portal's Deployed models table). Used to pick which models a template
    enables."""
    return foundry.list_model_deployments()


# --------------------------------------------------------------------------- #
# Customers / tenants                                                          #
# --------------------------------------------------------------------------- #
@router.get("/customers")
def list_customers(_: Principal = Depends(require_admin)) -> List[Dict[str, Any]]:
    return cosmos.list_tenants()


@router.post("/customers")
def upsert_customer(payload: Dict[str, Any], _: Principal = Depends(require_admin)) -> Dict[str, Any]:
    if "org_id" not in payload:
        raise HTTPException(400, "org_id is required")
    payload["id"] = payload["org_id"]
    tenant = Tenant(**payload)
    tracing.event("Onboarding customer", org_id=tenant.org_id, name=tenant.name)
    # Always provision the per-customer Search index.
    with tracing.span("search.ensure_index", org_id=tenant.org_id):
        tenant.search_index = search.ensure_index(tenant.org_id)
    # In the groups model (production), ensure the customer's CIAM security
    # group exists and remember its id so customer tokens resolve to this org.
    existing = cosmos.get_tenant(tenant.org_id)
    tenant.group_id = (existing or {}).get("group_id", "") or tenant.group_id
    if not tenant.group_id:
        with tracing.span("ciam.ensure_group", org_id=tenant.org_id):
            gid = ciam_groups.ensure_group(tenant.org_id, tenant.name)
        if gid:
            tenant.group_id = gid
    with tracing.span("cosmos.save_tenant", org_id=tenant.org_id):
        saved = cosmos.save_tenant(tenant.model_dump())
    # Track lifecycle: an enabled customer has an open active period; a disabled
    # one is closed. This drives per-month active-days proration in the cost view.
    with tracing.span("cosmos.record_lifecycle", org_id=tenant.org_id):
        cosmos.record_lifecycle(tenant.org_id, tenant.name, active=tenant.enabled)
    return saved


@router.get("/customers/{org_id}/metering")
def customer_metering(org_id: str, _: Principal = Depends(require_admin)) -> Dict[str, Any]:
    if not cosmos.get_tenant(org_id):
        raise HTTPException(404, "unknown customer")
    return cosmos.metering_summary(org_id)


@router.get("/costs")
def solution_costs(
    currency: str = "USD", _: Principal = Depends(require_admin)
) -> Dict[str, Any]:
    """Total Azure cost of the solution, attributed per customer and per month
    from recorded usage (tokens, calls) and shared Search index allocation.

    ``currency`` selects the price list (USD or EUR); unknown values fall back
    to USD."""
    from ..services import pricing

    cur = (currency or "USD").upper()
    if cur not in pricing.SUPPORTED_CURRENCIES:
        cur = "USD"
    return cosmos.cost_summary(cur)


@router.post("/reindex")
def reindex_all(_: Principal = Depends(require_admin)) -> Dict[str, Any]:
    """Migrate every customer's Search index to the vector+semantic RAG schema.

    Runs inside the backend (which sits in the VNet and can reach both Cosmos
    and Search). Re-chunks + embeds existing documents and drops the original
    whole-document records. Idempotent: re-running is a no-op once migrated.
    """
    results: Dict[str, Any] = {}
    totals = {"sources": 0, "chunks": 0, "embedding_tokens": 0, "deleted": 0}
    for tenant in cosmos.list_tenants():
        org_id = tenant.get("org_id") or tenant.get("id")
        if not org_id:
            continue
        try:
            res = search.reindex_org(org_id)
        except Exception as exc:  # pragma: no cover - defensive
            results[org_id] = {"error": str(exc)}
            continue
        results[org_id] = res
        for k in totals:
            totals[k] += int(res.get(k, 0) or 0)
        emb_tokens = int(res.get("embedding_tokens", 0) or 0)
        if emb_tokens:
            cosmos.log_metering(
                {
                    "id": str(uuid.uuid4()),
                    "org_id": org_id,
                    "instance_id": "",
                    "template_id": "",
                    "ts": _now(),
                    "kind": "embedding",
                    "input_tokens": emb_tokens,
                    "output_tokens": 0,
                    "total_tokens": emb_tokens,
                    "embedding_tokens": emb_tokens,
                }
            )
    return {"totals": totals, "by_customer": results}


@router.delete("/customers/{org_id}")
def delete_customer(org_id: str, _: Principal = Depends(require_admin)) -> Dict[str, Any]:
    """Delete a customer. Refused if any instance is still attached (the admin
    must remove every instance first, which also tears down its agent + KB)."""
    if not cosmos.get_tenant(org_id):
        raise HTTPException(404, "unknown customer")
    instances = cosmos.list_instances(org_id)
    if instances:
        raise HTTPException(
            409,
            f"customer has {len(instances)} instance(s); remove them before deleting the customer",
        )
    # No instances → safe to drop the (now-empty) Search index and the tenant.
    search.delete_index(org_id)
    # Tear down any agentic-retrieval knowledge base + source for this customer.
    agentic.delete_resources(org_id)
    # Remove the per-customer CIAM security group (groups model), if any.
    tenant = cosmos.get_tenant(org_id)
    if tenant and tenant.get("group_id"):
        ciam_groups.delete_group(tenant["group_id"])
    # Close the active period before removing the tenant; the lifecycle record
    # lives in the metering partition and survives the deletion.
    cosmos.record_lifecycle(org_id, (tenant or {}).get("name", org_id), active=False)
    cosmos.delete("tenants", org_id, org_id)
    return {"status": "deleted", "org_id": org_id}


# --------------------------------------------------------------------------- #
# Customer users (CIAM directory) — production only (groups model)            #
# --------------------------------------------------------------------------- #
def _require_group_mgmt() -> None:
    if not get_settings().group_provisioning_enabled:
        raise HTTPException(
            400,
            "User & group management is available only in production "
            "(Entra External ID groups).",
        )


def _customer_group_id(org_id: str) -> str:
    tenant = cosmos.get_tenant(org_id)
    if not tenant:
        raise HTTPException(404, "unknown customer")
    gid = tenant.get("group_id")
    if not gid:
        raise HTTPException(409, "this customer has no CIAM security group")
    return gid


@router.get("/ciam/users")
def list_directory_users(
    search: str | None = None,
    skip_token: str | None = None,
    limit: int = 25,
    _: Principal = Depends(require_admin),
) -> Dict[str, Any]:
    """List users in the customers (CIAM) tenant, paged. ``search`` prefix-matches
    name / UPN / mail; pass back ``next_skip_token`` for the next page."""
    _require_group_mgmt()
    return ciam_groups.list_users(search=search, top=limit, skip_token=skip_token)


@router.get("/customers/{org_id}/group/members")
def list_customer_group_members(
    org_id: str, _: Principal = Depends(require_admin)
) -> List[Dict[str, Any]]:
    """Users currently in this customer's CIAM security group."""
    _require_group_mgmt()
    return ciam_groups.list_group_members(_customer_group_id(org_id))


@router.post("/customers/{org_id}/group/members")
def add_customer_group_member(
    org_id: str, payload: Dict[str, Any], _: Principal = Depends(require_admin)
) -> Dict[str, str]:
    """Add a directory user to this customer's CIAM security group."""
    _require_group_mgmt()
    user_id = (payload or {}).get("user_id")
    if not user_id:
        raise HTTPException(400, "user_id is required")
    if not ciam_groups.add_group_member(_customer_group_id(org_id), user_id):
        raise HTTPException(502, "failed to add the user to the group")
    return {"status": "added", "user_id": user_id, "org_id": org_id}


@router.delete("/customers/{org_id}/group/members/{user_id}")
def remove_customer_group_member(
    org_id: str, user_id: str, _: Principal = Depends(require_admin)
) -> Dict[str, str]:
    """Remove a directory user from this customer's CIAM security group."""
    _require_group_mgmt()
    if not ciam_groups.remove_group_member(_customer_group_id(org_id), user_id):
        raise HTTPException(502, "failed to remove the user from the group")
    return {"status": "removed", "user_id": user_id, "org_id": org_id}


# --------------------------------------------------------------------------- #
# Instances                                                                    #
# --------------------------------------------------------------------------- #
@router.get("/customers/{org_id}/instances")
def list_customer_instances(org_id: str, _: Principal = Depends(require_admin)) -> List[Dict[str, Any]]:
    return cosmos.list_instances(org_id)


@router.post("/customers/{org_id}/instances")
def upsert_instance(org_id: str, payload: Dict[str, Any], _: Principal = Depends(require_admin)) -> Dict[str, Any]:
    if not cosmos.get_tenant(org_id):
        raise HTTPException(404, "unknown customer")
    template = cosmos.get_template(payload.get("template_id", ""))
    if not template:
        raise HTTPException(400, "unknown template_id")
    payload["org_id"] = org_id
    payload.setdefault("id", str(uuid.uuid4()))
    instance = Instance(**payload)

    # Previous app-side inputs (if editing an existing instance), used to decide
    # whether the agent actually needs re-versioning.
    existing = cosmos.get_instance(org_id, instance.id)
    prev_addendum = ((existing or {}).get("overrides") or {}).get("instructions_addendum") if existing else None
    prev_model = (existing or {}).get("model") if existing else None
    # Carry over any portal-disabled tools parked on the record.
    if existing and not instance.disabled_tools:
        instance.disabled_tools = existing.get("disabled_tools") or []

    # Resolve the model: must be one the template enabled (if it restricts).
    allowed = template.get("allowed_models") or []
    chosen_model = instance.model or template.get("model")
    if allowed:
        if not chosen_model:
            chosen_model = allowed[0]
        elif chosen_model not in allowed:
            raise HTTPException(
                400,
                f"model '{chosen_model}' is not enabled for this template; choose one of {allowed}",
            )
    instance.model = chosen_model

    # Create or update the per-customer Foundry agent. This is a no-op when only
    # app-level metadata changed (display name, suggested questions) and it
    # preserves tools/knowledge added from the Foundry portal; it only
    # re-versions when the model or the addendum actually change in AgentLoom.
    addendum = (instance.overrides or {}).get("instructions_addendum")
    instance.foundry_agent_id = foundry.reconcile_instance_agent(
        template_id=template["id"],
        org_id=org_id,
        base_instructions=template.get("instructions", ""),
        addendum=addendum,
        model=chosen_model,
        prev_addendum=prev_addendum,
        prev_model=prev_model,
        agent_exists=bool(existing and existing.get("foundry_agent_id")),
    )

    # Agentic retrieval can only be enabled if the template allows it; provision
    # the per-customer knowledge source + knowledge base on enable (idempotent).
    if instance.agentic_retrieval and not template.get("agentic_retrieval"):
        raise HTTPException(400, "this template does not allow agentic retrieval")
    if instance.agentic_retrieval:
        try:
            agentic.ensure_resources(org_id)
        except Exception as exc:  # pragma: no cover - provisioning is best-effort
            log.warning("agentic provisioning failed for %s: %s", org_id, exc)

    return cosmos.save_instance(instance.model_dump())


@router.post("/customers/{org_id}/instances/{instance_id}/agentic")
def toggle_instance_agentic(
    org_id: str,
    instance_id: str,
    payload: Dict[str, Any],
    _: Principal = Depends(require_admin),
) -> Dict[str, Any]:
    """Enable/disable Azure AI Search agentic retrieval on an existing instance.

    Enabling provisions the customer's knowledge source + knowledge base. The
    template must allow agentic retrieval.
    """
    inst = cosmos.get_instance(org_id, instance_id)
    if not inst:
        raise HTTPException(404, "instance not found for this org")
    enabled = bool(payload.get("enabled", True))
    if enabled:
        template = cosmos.get_template(inst.get("template_id", ""))
        if not (template and template.get("agentic_retrieval")):
            raise HTTPException(400, "this template does not allow agentic retrieval")
        agentic.ensure_resources(org_id)
    inst["agentic_retrieval"] = enabled
    saved = cosmos.save_instance(inst)
    return {"instance_id": instance_id, "agentic_retrieval": enabled, "id": saved.get("id")}


@router.delete("/customers/{org_id}/instances/{instance_id}")
def delete_instance(org_id: str, instance_id: str, _: Principal = Depends(require_admin)) -> Dict[str, Any]:
    inst = cosmos.get_instance(org_id, instance_id)
    if not inst:
        raise HTTPException(404, "instance not found for this org")
    # 1) tear down the dedicated Foundry agent
    if inst.get("foundry_agent_id"):
        foundry.delete_agent(inst["foundry_agent_id"])
    # 2) remove the instance's knowledge: indexed docs + its blob folder
    removed_docs = search.delete_instance_docs(org_id, instance_id)
    removed_blobs = blob.delete_instance_kb(org_id, instance_id)
    # 3) finally drop the instance record
    cosmos.delete("instances", org_id, instance_id)
    return {"status": "deleted", "removed_docs": removed_docs, "removed_blobs": removed_blobs}


# --------------------------------------------------------------------------- #
# Agent inspection: portal link + tool enable/disable                         #
# --------------------------------------------------------------------------- #
@router.get("/customers/{org_id}/instances/{instance_id}/agent")
def get_instance_agent(org_id: str, instance_id: str, _: Principal = Depends(require_admin)) -> Dict[str, Any]:
    inst = cosmos.get_instance(org_id, instance_id)
    if not inst:
        raise HTTPException(404, "instance not found for this org")
    agent_name = inst.get("foundry_agent_id")
    if not agent_name:
        raise HTTPException(409, "instance is not bound to a Foundry agent")

    details = foundry.get_agent_details(agent_name)
    # Tools currently on the agent are "enabled"; any stored on the instance
    # were disabled by the admin and removed from the live agent.
    disabled = inst.get("disabled_tools") or []
    enabled_tools = [{**t, "key": foundry._tool_key(t), "enabled": True} for t in details.get("tools", [])]
    disabled_tools = [{**t, "key": foundry._tool_key(t), "enabled": False} for t in disabled]
    return {
        "name": agent_name,
        "version": details.get("version"),
        "model": details.get("model") or inst.get("model"),
        "portal_url": foundry.portal_url_for_agent(agent_name),
        "tools": enabled_tools + disabled_tools,
    }


@router.post("/customers/{org_id}/instances/{instance_id}/agent/tools")
def toggle_instance_agent_tool(
    org_id: str,
    instance_id: str,
    payload: Dict[str, Any],
    _: Principal = Depends(require_admin),
) -> Dict[str, Any]:
    """Enable or disable a single tool on the customer's agent. Disabled tools
    are removed from the live Foundry agent and parked on the instance record so
    they can be re-enabled later without losing their configuration."""
    inst = cosmos.get_instance(org_id, instance_id)
    if not inst:
        raise HTTPException(404, "instance not found for this org")
    agent_name = inst.get("foundry_agent_id")
    if not agent_name:
        raise HTTPException(409, "instance is not bound to a Foundry agent")

    tool_key = payload.get("key")
    enabled = bool(payload.get("enabled"))
    if not tool_key:
        raise HTTPException(400, "missing tool 'key'")

    details = foundry.get_agent_details(agent_name)
    live_tools: List[Dict[str, Any]] = list(details.get("tools", []))
    parked: List[Dict[str, Any]] = list(inst.get("disabled_tools") or [])

    if enabled:
        # Move from parked → live.
        keep = [t for t in parked if foundry._tool_key(t) != tool_key]
        moved = [t for t in parked if foundry._tool_key(t) == tool_key]
        if not moved:
            raise HTTPException(404, "tool not found among disabled tools")
        parked = keep
        live_tools = live_tools + moved
    else:
        # Move from live → parked.
        moved = [t for t in live_tools if foundry._tool_key(t) == tool_key]
        if not moved:
            raise HTTPException(404, "tool not found among enabled tools")
        live_tools = [t for t in live_tools if foundry._tool_key(t) != tool_key]
        parked = parked + moved

    foundry.set_agent_tools(
        agent_name,
        model=details.get("model") or inst.get("model"),
        instructions=details.get("instructions", ""),
        tools=live_tools,
    )
    inst["disabled_tools"] = parked
    cosmos.save_instance(inst)
    return {"status": "ok", "enabled": enabled, "key": tool_key}


# --------------------------------------------------------------------------- #
# Knowledge upload (private blob + Search index) - scoped to one instance      #
# --------------------------------------------------------------------------- #
@router.post("/customers/{org_id}/instances/{instance_id}/knowledge")
async def upload_knowledge(
    org_id: str,
    instance_id: str,
    title: str = Form(...),
    source: str = Form("upload"),
    file: UploadFile = File(...),
    _: Principal = Depends(require_admin),
) -> Dict[str, Any]:
    if not cosmos.get_tenant(org_id):
        raise HTTPException(404, "unknown customer")
    if not cosmos.get_instance(org_id, instance_id):
        raise HTTPException(404, "instance not found for this org")

    raw = await file.read()
    blob.upload(org_id, instance_id, file.filename, raw, content_type=file.content_type)

    try:
        text = raw.decode("utf-8", errors="ignore")
    except Exception:
        text = ""

    doc_id = str(uuid.uuid4())
    result = search.upload_docs(
        org_id,
        instance_id,
        [{"id": doc_id, "title": title, "content": text, "source": source}],
    )
    # Meter the embedding tokens consumed while indexing (RAG ingestion cost).
    emb_tokens = int(result.get("embedding_tokens", 0) or 0)
    if emb_tokens:
        cosmos.log_metering(
            {
                "id": str(uuid.uuid4()),
                "org_id": org_id,
                "instance_id": instance_id,
                "template_id": (cosmos.get_instance(org_id, instance_id) or {}).get("template_id", ""),
                "ts": _now(),
                "kind": "embedding",
                "input_tokens": emb_tokens,
                "output_tokens": 0,
                "total_tokens": emb_tokens,
                "embedding_tokens": emb_tokens,
            }
        )
    return {
        "id": doc_id,
        "blob": f"{org_id}/{instance_id}/{file.filename}",
        "indexed": True,
        "chunks": result.get("chunks", 0),
        "embedding_tokens": emb_tokens,
    }
