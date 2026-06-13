"""Admin endpoints: catalog CRUD, customer onboarding, instances, metering.

Every endpoint requires the ``admin`` role.
"""
from __future__ import annotations

import uuid
from typing import Any, Dict, List

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form

from ..models import Instance, Template, Tenant, Branding, SYSTEM_ORG, _now
from ..security import Principal, require_admin
from ..services import blob, cosmos, foundry, search

router = APIRouter(prefix="/v1/admin", tags=["admin"])


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
    # Always provision the per-customer Search index.
    tenant.search_index = search.ensure_index(tenant.org_id)
    return cosmos.save_tenant(tenant.model_dump())


@router.get("/customers/{org_id}/metering")
def customer_metering(org_id: str, _: Principal = Depends(require_admin)) -> Dict[str, Any]:
    if not cosmos.get_tenant(org_id):
        raise HTTPException(404, "unknown customer")
    return cosmos.metering_summary(org_id)


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
    cosmos.delete("tenants", org_id, org_id)
    return {"status": "deleted", "org_id": org_id}


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

    # Materialise (or re-version) the per-customer Foundry agent. The agent name
    # is deterministic, so this updates it in place — applying any model or
    # guidance change on edit without ever creating a duplicate.
    addendum = (instance.overrides or {}).get("instructions_addendum")
    instance.foundry_agent_id = foundry.create_instance_agent(
        template_id=template["id"],
        org_id=org_id,
        base_instructions=template.get("instructions", ""),
        addendum=addendum,
        model=chosen_model,
    )
    return cosmos.save_instance(instance.model_dump())


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
    search.upload_docs(
        org_id,
        instance_id,
        [{"id": doc_id, "title": title, "content": text, "source": source}],
    )
    return {
        "id": doc_id,
        "blob": f"{org_id}/{instance_id}/{file.filename}",
        "indexed": True,
    }
