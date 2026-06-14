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

import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "backend"))

from app.services import cosmos as cosmos_svc  # noqa: E402
from app.models import SYSTEM_ORG  # noqa: E402

# Agent templates (blueprints) live as JSON under sample-templates/, one file
# per template, so they are editable without touching this script.
TEMPLATES_DIR = REPO / "sample-templates"


def load_templates() -> list[dict]:
    """Load every *.json template from sample-templates/. The default model is
    overridden by FOUNDRY_MODEL_DEPLOYMENT when that env var is set."""
    model = os.environ.get("FOUNDRY_MODEL_DEPLOYMENT")
    out: list[dict] = []
    for path in sorted(TEMPLATES_DIR.glob("*.json")):
        try:
            t = json.loads(path.read_text(encoding="utf-8"))
        except Exception as exc:  # pragma: no cover
            print(f"  !! skipping {path.name}: {exc}")
            continue
        if model:
            t["model"] = model
        out.append(t)
    return out


def _templates_enabled() -> bool:
    """Whether to seed the agent templates. Controlled by SEED_TEMPLATES
    (default: enabled). Set to 0/false/no to install without any template."""
    return os.environ.get("SEED_TEMPLATES", "true").strip().lower() not in (
        "0",
        "false",
        "no",
        "off",
    )


def main() -> None:
    if not _templates_enabled():
        print("SEED_TEMPLATES is disabled — skipping template seeding.")
        return

    print("Ensuring Cosmos containers...")
    cosmos_svc.ensure_containers()

    templates = load_templates()
    if not templates:
        print(f"No templates found in {TEMPLATES_DIR}. Nothing to seed.")
        return

    print("Seeding template catalog (no Foundry agents created yet)...")
    for t in templates:
        record = {
            **t,
            "org_id": SYSTEM_ORG,
            "foundry_agent_id": None,  # materialised per-customer at instance time
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        record.setdefault("created_at", record["updated_at"])
        cosmos_svc.save_template(record)
        print(f"  saved template {t['id']} (status={t.get('status', 'draft')})")

    print("Done.")


if __name__ == "__main__":
    main()
