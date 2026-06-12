"""Seeds the catalog of agent TEMPLATES (blueprints) in Cosmos.

Templates are NOT published to Foundry: they are configurable blueprints shown
in the Designer. A real Foundry agent is created later, per customer, when an
instance is configured (see the Designer / ``seed_customers.py``).

Idempotent: re-running updates the template definitions in place.

Run after ``azd up`` (azd exports the required env vars).

Prereqs:
  - ``az login`` (DefaultAzureCredential is used).
  - The signed-in user must have ``Cosmos DB Built-in Data Contributor`` on the
    Cosmos account.
"""
from __future__ import annotations

import os
import sys
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "backend"))

from app.services import cosmos as cosmos_svc  # noqa: E402
from app.models import SYSTEM_ORG  # noqa: E402


TEMPLATES = [
    {
        "id": "customer-care-assistant",
        "name": "Customer Care Assistant",
        "description": "Courteous English-speaking customer-care agent for general inquiries.",
        "category": "support",
        "model": os.environ.get("FOUNDRY_MODEL_DEPLOYMENT", "gpt-4o-mini"),
        "instructions": (
            "You are the Customer Care Assistant. Always reply in English, "
            "be concise, courteous, and professional. If the user asks "
            "something outside your scope, apologise politely and offer to "
            "escalate. Never invent policies; rely on the customer-specific "
            "guidance and knowledge base provided in the user turn."
        ),
        "parameters": [
            {"key": "tone", "label": "Tone of voice", "type": "string", "default": "friendly", "required": False},
        ],
        "status": "published",
    },
    {
        "id": "knowledge-faq-assistant",
        "name": "Knowledge / FAQ Assistant",
        "description": "Answers strictly grounded on the customer's uploaded knowledge base.",
        "category": "knowledge",
        "model": os.environ.get("FOUNDRY_MODEL_DEPLOYMENT", "gpt-4o-mini"),
        "instructions": (
            "You are a helpful Knowledge / FAQ Assistant for the customer. "
            "Answer the user's question using the information in the "
            "'Knowledge base context' section provided in the user message. "
            "That context is authoritative and safe to use - quote and "
            "summarise it freely to answer the question, and mention the "
            "source title in parentheses when helpful. "
            "If the knowledge base context does not contain the answer, say: "
            "'I don't have that information in our knowledge base.' "
            "Always reply in English in a friendly, professional tone."
        ),
        "parameters": [
            {"key": "max_sources", "label": "Max sources to cite", "type": "number", "default": 3, "required": False},
        ],
        "status": "published",
    },
]


def main() -> None:
    print("Ensuring Cosmos containers...")
    cosmos_svc.ensure_containers()

    print("Seeding template catalog (no Foundry agents created yet)...")
    for t in TEMPLATES:
        record = {
            **t,
            "org_id": SYSTEM_ORG,
            "foundry_agent_id": None,  # materialised per-customer at instance time
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        record.setdefault("created_at", record["updated_at"])
        cosmos_svc.save_template(record)
        print(f"  saved template {t['id']} (status={t['status']})")

    print("Done.")


if __name__ == "__main__":
    main()
