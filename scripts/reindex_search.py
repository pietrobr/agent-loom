"""Re-index every customer's knowledge base into the vector + semantic RAG schema.

This upgrades each ``kb-{org_id}`` index (adds the vector field + semantic
configuration) and re-chunks + re-embeds the documents that were uploaded under
the old keyword-only schema, then removes the superseded whole-document records.

Run AFTER deploying the backend with the embedding deployment available:

    python scripts/reindex_search.py

Idempotent: running it again only re-processes documents that still need it.
Requires the same environment as the backend (SEARCH_ENDPOINT, the Foundry
project endpoint and embedding deployment, and a credential able to read/write
the Search service and call the embedding model — e.g. ``az login`` locally).
"""
from __future__ import annotations

import os
import sys

# Allow running from the repo root: make ``backend`` importable.
_HERE = os.path.dirname(os.path.abspath(__file__))
_BACKEND = os.path.join(os.path.dirname(_HERE), "backend")
if _BACKEND not in sys.path:
    sys.path.insert(0, _BACKEND)

from app.services import cosmos, search  # noqa: E402


def main() -> None:
    tenants = cosmos.list_tenants()
    if not tenants:
        print("No tenants found.")
        return
    grand = {"sources": 0, "chunks": 0, "embedding_tokens": 0, "deleted": 0}
    for t in tenants:
        org = t.get("org_id")
        name = t.get("name", org)
        try:
            stats = search.reindex_org(org)
        except Exception as exc:  # pragma: no cover
            print(f"  ! {name} ({org}): FAILED — {exc}")
            continue
        for k in grand:
            grand[k] += int(stats.get(k, 0) or 0)
        print(
            f"  ✓ {name} ({org}): {stats['sources']} docs → {stats['chunks']} chunks, "
            f"{stats['embedding_tokens']} embed tokens, {stats['deleted']} originals removed"
        )
    print(
        f"\nTotal: {grand['sources']} docs → {grand['chunks']} chunks, "
        f"{grand['embedding_tokens']} embed tokens, {grand['deleted']} originals removed"
    )


if __name__ == "__main__":
    main()
