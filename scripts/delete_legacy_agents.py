"""Delete legacy Assistants left over from the old Foundry experience.

The first version of the demo created agents with the legacy Assistants API
(``azure-ai-agents`` threads/runs). After migrating to Prompt Agents those
remain as orphaned assistants and trigger the portal's "Update your agents"
notice. This script lists and deletes them via the legacy ``AgentsClient``.

Idempotent. Prereqs: az login with the Foundry data-plane role and
FOUNDRY_PROJECT_ENDPOINT set.

Requires the legacy package (installed on demand):
    pip install azure-ai-agents==1.1.0
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "backend"))

from app.credentials import get_credential  # noqa: E402


def main() -> None:
    endpoint = os.environ["FOUNDRY_PROJECT_ENDPOINT"]
    try:
        from azure.ai.agents import AgentsClient
    except ImportError:
        print("azure-ai-agents not installed. Run: pip install azure-ai-agents==1.1.0")
        return

    client = AgentsClient(endpoint=endpoint, credential=get_credential())
    deleted = 0
    try:
        agents = list(client.list_agents())
    except Exception as exc:  # pragma: no cover
        print(f"Could not list legacy agents: {exc}")
        return

    if not agents:
        print("No legacy agents found. Nothing to delete.")
        return

    for a in agents:
        aid = getattr(a, "id", None)
        name = getattr(a, "name", "") or ""
        if not aid:
            continue
        try:
            client.delete_agent(aid)
            deleted += 1
            print(f"  deleted legacy agent {aid} ({name})")
        except Exception as exc:  # pragma: no cover
            print(f"  !! failed to delete {aid}: {exc}")

    print(f"Done. Deleted {deleted} legacy agent(s).")


if __name__ == "__main__":
    main()
