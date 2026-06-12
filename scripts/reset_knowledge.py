"""One-off: wipe the OLD knowledge layout so it can be rebuilt with the new
per-instance scheme (instance_id field + per-instance blob folders).

For every tenant in Cosmos it:
  * deletes the whole ``kb-{org_id}`` Search index (drops legacy docs that had
    no ``instance_id``), and
  * deletes every blob under ``{org_id}/`` (legacy flat layout + nested folders).

After this, re-run ``seed_customers.py`` to recreate the index and re-upload the
demo knowledge scoped to each instance.
"""
from __future__ import annotations

import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "backend"))

from app.services import cosmos as cosmos_svc  # noqa: E402
from app.services import search as search_svc  # noqa: E402
from app.services import blob as blob_svc  # noqa: E402


def _delete_org_blobs(org_id: str) -> int:
    container = blob_svc._container()  # internal helper, fine for a one-off
    removed = 0
    for b in container.list_blobs(name_starts_with=f"{org_id}/"):
        try:
            container.delete_blob(b.name)
            removed += 1
        except Exception as exc:  # pragma: no cover
            print(f"    !! delete_blob({b.name}) skipped: {exc}")
    return removed


def main() -> None:
    tenants = cosmos_svc.list_tenants()
    if not tenants:
        print("No tenants found.")
        return
    for t in tenants:
        org_id = t.get("org_id")
        if not org_id:
            continue
        print(f"Resetting knowledge for {org_id} ...")
        search_svc.delete_index(org_id)
        print(f"  index kb-{org_id} deleted")
        n = _delete_org_blobs(org_id)
        print(f"  {n} blob(s) deleted")
    print("\nDone. Now run: python scripts/seed_customers.py")


if __name__ == "__main__":
    main()
