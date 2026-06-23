"""Shared helpers for the evals scripts.

Loads the azd environment (so the scripts can be run directly without manually
exporting variables) and resolves the per-agent folder + config. Auth uses
``DefaultAzureCredential`` (``az login``).

Each agent lives in its own folder under ``evals/agents/<name>/`` with an
``agent.json`` config and (after fetching) a ``dataset.jsonl``. The shared
``fetch_traces.py`` / ``run_eval.py`` scripts take that folder as their first
argument so the same tooling serves many agents.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
AGENTS_DIR = HERE / "agents"
DATASET_NAME = "dataset.jsonl"
CONFIG_NAME = "agent.json"
# Reuse the backend's service layer when present instead of duplicating it.
sys.path.insert(0, str(REPO / "backend"))


def load_azd_env() -> dict[str, str]:
    """Populate os.environ from ``azd env get-values`` (idempotent).

    Only fills variables that are not already set, so an explicit shell export
    always wins. Silently no-ops if azd is unavailable.
    """
    if os.environ.get("FOUNDRY_PROJECT_ENDPOINT") and os.environ.get("AZURE_RESOURCE_GROUP"):
        return dict(os.environ)
    try:
        out = subprocess.run(
            ["azd", "env", "get-values"],
            cwd=str(REPO),
            capture_output=True,
            text=True,
            timeout=60,
            shell=os.name == "nt",
        )
    except Exception as exc:  # pragma: no cover - azd not installed
        print(f"  (azd env get-values unavailable: {exc})")
        return dict(os.environ)
    if out.returncode != 0:
        print(f"  (azd env get-values failed: {out.stderr.strip()})")
        return dict(os.environ)
    for line in out.stdout.splitlines():
        line = line.strip()
        if not line or "=" not in line:
            continue
        key, _, val = line.partition("=")
        os.environ.setdefault(key.strip(), val.strip().strip('"'))
    return dict(os.environ)


def resolve_agent_dir(agent_arg: str) -> Path:
    """Resolve an agent folder from a name (under ./agents) or an explicit path."""
    candidate = Path(agent_arg)
    for path in (candidate, AGENTS_DIR / agent_arg, HERE / agent_arg):
        if (path / CONFIG_NAME).is_file():
            return path.resolve()
    available = sorted(p.name for p in AGENTS_DIR.glob("*") if (p / CONFIG_NAME).is_file())
    raise SystemExit(
        f"No '{CONFIG_NAME}' found for agent '{agent_arg}'. "
        f"Available agents: {', '.join(available) or '(none)'}"
    )


def load_agent_config(agent_dir: Path) -> dict:
    """Read the agent's ``agent.json`` config."""
    cfg_path = agent_dir / CONFIG_NAME
    cfg = json.loads(cfg_path.read_text(encoding="utf-8"))
    if not cfg.get("agent"):
        raise SystemExit(f"{cfg_path} is missing the required 'agent' field.")
    return cfg


def account_endpoint(project_endpoint: str) -> str:
    """Foundry *account* endpoint (drops the ``/api/projects/<name>`` suffix)."""
    return project_endpoint.split("/api/projects/")[0].rstrip("/")
