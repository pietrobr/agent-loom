"""Seeds 2 demo customers + per-customer instances + Search indexes + knowledge.

Idempotent: re-running upserts. Demo customers:

  * horizon-travel  → Customer Care Assistant (FAQs on bookings/refunds)
  * novatech        → Knowledge / FAQ Assistant (FAQs on support contracts/SLAs)
"""
from __future__ import annotations

import os
import sys
import uuid
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "backend"))

from app.services import cosmos as cosmos_svc  # noqa: E402
from app.services import search as search_svc  # noqa: E402
from app.services import blob as blob_svc  # noqa: E402
from app.services import foundry as foundry_svc  # noqa: E402
from app.models import SYSTEM_ORG  # noqa: E402

# Demo customers + their knowledge loader are defined once in demo_seed_data
# (no Azure imports), shared with seed_via_api.py.
sys.path.insert(0, str(REPO / "scripts"))
from demo_seed_data import CUSTOMERS, load_knowledge_dir  # noqa: E402


def _demo_enabled() -> bool:
    """Whether to seed the built-in demo customers. Controlled by the
    SEED_DEMO_CUSTOMERS env var (default: enabled). Set it to 0/false/no to
    install AgentLoom with an empty customer list (templates are still created
    by create_foundry_agents.py)."""
    return os.environ.get("SEED_DEMO_CUSTOMERS", "true").strip().lower() not in (
        "0",
        "false",
        "no",
        "off",
    )


def main() -> None:
    if not _demo_enabled():
        print("SEED_DEMO_CUSTOMERS is disabled — skipping demo customer seeding.")
        return

    print("Ensuring Cosmos containers...")
    cosmos_svc.ensure_containers()

    for c in CUSTOMERS:
        org_id = c["org_id"]
        print(f"\n=== Seeding customer {org_id} ===")

        idx_name = search_svc.ensure_index(org_id)
        print(f"  Search index ensured: {idx_name}")

        tenant = {
            "id": org_id,
            "org_id": org_id,
            "name": c["name"],
            "tier": c["tier"],
            "monthly_token_quota": c["monthly_token_quota"],
            "branding": c["branding"],
            "search_index": idx_name,
        }
        cosmos_svc.save_tenant(tenant)
        print(f"  Tenant saved.")

        template = cosmos_svc.get_template(c["template_id"])
        if not template:
            print(f"  !! template {c['template_id']} not found - run create_foundry_agents.py first")
            continue

        # One default instance per customer. Configuring the instance creates
        # the real, per-customer Foundry agent (template base + this customer's
        # guidance baked into the agent's system instructions).
        instance_id = f"inst-{c['template_id']}"
        addendum = c["instructions_addendum"]
        agent_id = foundry_svc.create_instance_agent(
            template_id=template["id"],
            org_id=org_id,
            base_instructions=template.get("instructions", ""),
            addendum=addendum,
            model=template.get("model"),
        )
        print(f"  Foundry agent created: {agent_id}")
        instance = {
            "id": instance_id,
            "org_id": org_id,
            "template_id": template["id"],
            "display_name": c["instance_display"],
            "overrides": {"instructions_addendum": addendum},
            "suggested_questions": c.get("suggested_questions", []),
            "branding": c["branding"],
            "foundry_agent_id": agent_id,
        }
        cosmos_svc.save_instance(instance)
        print(f"  Instance saved: {instance_id}")

        # Upload knowledge (from sample-customers/<org>/knowledge) as private
        # blobs AND index into AI Search.
        docs = []
        for k in load_knowledge_dir(org_id):
            fname = (k["title"][:60].lower().replace(" ", "_").replace("/", "-") + ".txt")
            try:
                blob_svc.upload(org_id, instance_id, fname, k["content"].encode("utf-8"), "text/plain")
            except Exception as exc:  # pragma: no cover
                print(f"  !! blob upload skipped for {fname}: {exc}")
            docs.append({
                "id": str(uuid.uuid4()),
                "title": k["title"],
                "content": k["content"],
                "source": k["source"],
            })
        n = search_svc.upload_docs(org_id, instance_id, docs)
        print(f"  Knowledge indexed: {n} docs")

    print("\nDone.")


if __name__ == "__main__":
    main()
