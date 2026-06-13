"""Seeds 2 demo customers + per-customer instances + Search indexes + knowledge.

Idempotent: re-running upserts. Demo customers:

  * horizon-travel  → Customer Care Assistant (FAQs on bookings/refunds)
  * novatech        → Knowledge / FAQ Assistant (FAQs on support contracts/SLAs)
"""
from __future__ import annotations

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


CUSTOMERS = [
    {
        "org_id": "horizon-travel",
        "name": "Horizon Travel",
        "tier": "pro",
        "monthly_token_quota": 5_000_000,
        "branding": {
            "product_name": "Horizon Travel Concierge",
            "primary_color": "#0E7C86",
            "logo_url": "/logo.svg",
            "tagline": "Your journey, our care.",
        },
        "template_id": "customer-care-assistant",
        "instance_display": "Horizon Customer Care",
        "instructions_addendum": (
            "You represent Horizon Travel, a premium travel agency. "
            "Booking changes are free up to 14 days before departure. "
            "Always offer to escalate complex refund cases to a human agent."
        ),
        "suggested_questions": [
            "How do I change my booking?",
            "What is your refund policy?",
            "How do I add baggage to my reservation?",
        ],
        "knowledge": [
            {
                "title": "How do I change my booking?",
                "source": "FAQ — Bookings",
                "content": (
                    "Bookings can be changed free of charge up to 14 days before the "
                    "departure date through the Horizon Travel portal or by contacting "
                    "support. Within 14 days a 30 EUR fee per passenger applies. "
                    "Name corrections (single character typos) are always free."
                ),
            },
            {
                "title": "What is your refund policy?",
                "source": "FAQ — Refunds",
                "content": (
                    "Cancellations made 30+ days before departure are refunded in full. "
                    "Cancellations between 29 and 7 days receive a 50% refund. "
                    "Cancellations within 7 days are non-refundable but eligible for "
                    "credit on a future booking valid 12 months."
                ),
            },
            {
                "title": "How do I add baggage to my reservation?",
                "source": "FAQ — Baggage",
                "content": (
                    "Extra baggage can be added in the My Trips section of the portal "
                    "up to 4 hours before departure. The cost is 30 EUR per 23 kg piece."
                ),
            },
        ],
    },
    {
        "org_id": "novatech",
        "name": "NovaTech Solutions",
        "tier": "starter",
        "monthly_token_quota": 1_000_000,
        "branding": {
            "product_name": "NovaTech Helpdesk",
            "primary_color": "#7C3AED",
            "logo_url": "/logo.svg",
            "tagline": "Always-on IT support.",
        },
        "template_id": "knowledge-faq-assistant",
        "instance_display": "NovaTech Helpdesk Bot",
        "instructions_addendum": (
            "You are the NovaTech Solutions helpdesk assistant. NovaTech sells "
            "managed IT services to small and medium businesses. Quote SLAs and "
            "contract terms VERBATIM from the knowledge base."
        ),
        "suggested_questions": [
            "What is the standard support SLA?",
            "What does the premium support tier include?",
            "What is included in a support contract?",
        ],
        "knowledge": [
            {
                "title": "Standard Support SLA",
                "source": "Contracts — SLA",
                "content": (
                    "Standard tier: response within 4 business hours, resolution "
                    "target 2 business days for severity 2+ incidents. Coverage "
                    "Mon–Fri 09:00–18:00 local time."
                ),
            },
            {
                "title": "Premium Support SLA",
                "source": "Contracts — SLA",
                "content": (
                    "Premium tier: response within 30 minutes 24/7, resolution "
                    "target 8 hours for severity 1 incidents. Includes a dedicated "
                    "Technical Account Manager."
                ),
            },
            {
                "title": "What is included in a support contract?",
                "source": "Contracts — Scope",
                "content": (
                    "Every NovaTech support contract covers: endpoint monitoring, "
                    "patch management, backup verification, monthly reporting and "
                    "unlimited helpdesk tickets within the contracted tier hours."
                ),
            },
        ],
    },
]


def main() -> None:
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

        # Upload knowledge as private blobs AND index into AI Search
        docs = []
        for k in c["knowledge"]:
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
