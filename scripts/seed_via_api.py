"""Seed the catalog over the backend **REST API** (no direct Cosmos access).

Why this exists
---------------
Cosmos DB is deployed with ``publicNetworkAccess: 'Disabled'`` (private endpoint
only), so the original ``create_foundry_agents.py`` / ``seed_customers.py`` —
which open a Cosmos client directly — cannot run from a developer machine or
from the ``azd`` post-provision hook (both are outside the VNet).

The backend Container App **is** inside the VNet and already exposes admin
endpoints that perform exactly the same work (Cosmos + Search + Blob + Foundry).
This script drives those endpoints over HTTPS, so the seed succeeds without ever
opening the Cosmos firewall.

It seeds, idempotently and gated by the same env flags as before:

  * agent **templates** from ``sample-templates/*.json``  (``SEED_TEMPLATES``)
  * the 2 demo **customers** + instances + knowledge        (``SEED_DEMO_CUSTOMERS``)

Requires (set by the post-provision hook / azd env):
  * ``BACKEND_URL``               — public ingress of the backend Container App
  * ``ALLOW_DEV_TOKENS=true``     — backend default; lets us mint an admin token
  * ``FOUNDRY_MODEL_DEPLOYMENT``  — optional; overrides each template's model
"""
from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

import httpx

REPO = Path(__file__).resolve().parents[1]
TEMPLATES_DIR = REPO / "sample-templates"
sys.path.insert(0, str(REPO / "scripts"))
from demo_seed_data import CUSTOMERS, load_knowledge_dir  # noqa: E402

BACKEND_URL = (os.environ.get("BACKEND_URL") or "").rstrip("/")
MODEL_OVERRIDE = os.environ.get("FOUNDRY_MODEL_DEPLOYMENT")

# Generous timeout: instance creation provisions a Foundry agent and knowledge
# upload runs embeddings, both of which take a few seconds.
HTTP = httpx.Client(timeout=httpx.Timeout(180.0))


def _truthy(val: str | None, default: bool = True) -> bool:
    if val is None:
        return default
    return val.strip().lower() not in ("0", "false", "no", "off")


def _wait_for_backend(max_wait_s: int = 360) -> None:
    """Block until the backend answers /healthz (it may cold-start from zero)."""
    deadline = time.time() + max_wait_s
    attempt = 0
    while True:
        attempt += 1
        try:
            r = HTTP.get(f"{BACKEND_URL}/healthz", timeout=10.0)
            if r.status_code == 200:
                print(f"Backend healthy after {attempt} attempt(s).")
                return
        except Exception as exc:  # noqa: BLE001 - keep polling
            if attempt == 1:
                print(f"Waiting for backend at {BACKEND_URL} … ({exc.__class__.__name__})")
        if time.time() >= deadline:
            raise SystemExit(f"Backend did not become healthy within {max_wait_s}s")
        time.sleep(5)


def _admin_token() -> str:
    r = HTTP.post(
        f"{BACKEND_URL}/v1/auth/dev-token",
        json={"org_id": "_system", "sub": "seed", "roles": ["admin"], "ttl_seconds": 3600},
    )
    if r.status_code != 200:
        raise SystemExit(
            "Could not mint an admin dev-token (is ALLOW_DEV_TOKENS=true?): "
            f"{r.status_code} {r.text}"
        )
    return r.json()["access_token"]


def _seed_templates(headers: dict) -> None:
    if not _truthy(os.environ.get("SEED_TEMPLATES")):
        print("SEED_TEMPLATES is disabled — skipping template seeding.")
        return
    files = sorted(TEMPLATES_DIR.glob("*.json"))
    if not files:
        print(f"No templates found in {TEMPLATES_DIR}. Nothing to seed.")
        return
    print("Seeding template catalog via API …")
    for path in files:
        try:
            tmpl = json.loads(path.read_text(encoding="utf-8"))
        except Exception as exc:  # noqa: BLE001
            print(f"  !! skipping {path.name}: {exc}")
            continue
        if MODEL_OVERRIDE:
            tmpl["model"] = MODEL_OVERRIDE
        r = HTTP.post(f"{BACKEND_URL}/v1/admin/templates", json=tmpl, headers=headers)
        r.raise_for_status()
        print(f"  saved template {tmpl['id']} (status={tmpl.get('status', 'draft')})")


def _seed_customers(headers: dict) -> None:
    if not _truthy(os.environ.get("SEED_DEMO_CUSTOMERS")):
        print("SEED_DEMO_CUSTOMERS is disabled — skipping demo customer seeding.")
        return
    print("Seeding demo customers via API …")
    for c in CUSTOMERS:
        org_id = c["org_id"]
        print(f"\n=== Seeding customer {org_id} ===")

        # 1) Customer/tenant (the endpoint also provisions the Search index).
        tenant = {
            "org_id": org_id,
            "name": c["name"],
            "tier": c["tier"],
            "monthly_token_quota": c["monthly_token_quota"],
            "branding": c["branding"],
        }
        r = HTTP.post(f"{BACKEND_URL}/v1/admin/customers", json=tenant, headers=headers)
        r.raise_for_status()
        print("  Tenant saved.")

        # 2) Default instance — the endpoint creates the per-customer Foundry agent.
        instance_id = f"inst-{c['template_id']}"
        addendum = c["instructions_addendum"]
        instance = {
            "id": instance_id,
            "template_id": c["template_id"],
            "display_name": c["instance_display"],
            "overrides": {"instructions_addendum": addendum},
            "suggested_questions": c.get("suggested_questions", []),
            "branding": c["branding"],
        }
        r = HTTP.post(
            f"{BACKEND_URL}/v1/admin/customers/{org_id}/instances",
            json=instance,
            headers=headers,
        )
        if r.status_code >= 400:
            raise SystemExit(f"  !! instance create failed for {org_id}: {r.status_code} {r.text}")
        print(f"  Instance saved + Foundry agent created: {instance_id}")

        # 3) Knowledge — uploaded as private blob + indexed into Search.
        docs = load_knowledge_dir(org_id)
        for k in docs:
            fname = k["title"][:60].lower().replace(" ", "_").replace("/", "-") + ".txt"
            r = HTTP.post(
                f"{BACKEND_URL}/v1/admin/customers/{org_id}/instances/{instance_id}/knowledge",
                data={"title": k["title"], "source": k["source"]},
                files={"file": (fname, k["content"].encode("utf-8"), "text/plain")},
                headers=headers,
            )
            if r.status_code >= 400:
                print(f"  !! knowledge upload failed for {fname}: {r.status_code} {r.text}")
        print(f"  Knowledge indexed: {len(docs)} docs")


def main() -> None:
    if not BACKEND_URL:
        raise SystemExit("BACKEND_URL is not set — cannot seed over the API.")
    want_templates = _truthy(os.environ.get("SEED_TEMPLATES"))
    want_customers = _truthy(os.environ.get("SEED_DEMO_CUSTOMERS"))
    if not (want_templates or want_customers):
        print("Both SEED_TEMPLATES and SEED_DEMO_CUSTOMERS are disabled — nothing to do.")
        return

    _wait_for_backend()
    headers = {"Authorization": f"Bearer {_admin_token()}"}
    _seed_templates(headers)
    _seed_customers(headers)
    print("\nDone.")


if __name__ == "__main__":
    main()
