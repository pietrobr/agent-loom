"""Static Azure price list + cost attribution helpers.

Prices come from ``config/azure_prices.json`` (refreshed by
``scripts/fetch_azure_prices.py``, which calls the Azure Retail Prices API).
Built-in defaults are used if the file is missing so the cost view never breaks.
"""
from __future__ import annotations

import json
import logging
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict

log = logging.getLogger(__name__)

_PRICE_PATH_CANDIDATES = [
    Path(__file__).resolve().parents[3] / "config" / "azure_prices.json",
    Path("/app/config/azure_prices.json"),
    Path("config/azure_prices.json"),
]

_DEFAULTS: Dict[str, Any] = {
    "currency": "USD",
    "region": "swedencentral",
    "updated": None,
    "source": "built-in defaults",
    "models": {
        "gpt-4o-mini": {"input_per_1k": 0.000150, "output_per_1k": 0.000600},
        "gpt-4o": {"input_per_1k": 0.00250, "output_per_1k": 0.01000},
    },
    "search": {"sku": "Standard S1", "unit_per_month": 245.28},
    "shared_infrastructure": {
        "ai_search": 245.28,
        "container_apps": 55.00,
        "container_registry": 20.00,
        "cosmos_db": 25.00,
        "log_analytics": 12.00,
        "storage": 3.00,
        "key_vault": 1.00,
        "ai_foundry_base": 0.00,
    },
}

# Fallback model used when an instance's model is unknown/deleted.
_DEFAULT_MODEL = "gpt-4o-mini"


@lru_cache(maxsize=1)
def _prices() -> Dict[str, Any]:
    for p in _PRICE_PATH_CANDIDATES:
        if p.is_file():
            try:
                data = json.loads(p.read_text(encoding="utf-8"))
                return {**_DEFAULTS, **data}
            except Exception as exc:  # pragma: no cover
                log.warning("failed to read %s: %s", p, exc)
    return _DEFAULTS


def meta() -> Dict[str, Any]:
    p = _prices()
    return {
        "currency": p.get("currency", "USD"),
        "region": p.get("region"),
        "updated": p.get("updated"),
        "source": p.get("source"),
        "search_monthly": float(p.get("search", {}).get("unit_per_month", 0.0)),
    }


def shared_infrastructure() -> Dict[str, float]:
    """Monthly USD price of each shared component in the resource group."""
    si = _prices().get("shared_infrastructure")
    if not si:
        # Older price files only had `search`; synthesize a minimal map.
        return {"ai_search": float(_prices().get("search", {}).get("unit_per_month", 0.0))}
    return {k: float(v) for k, v in si.items()}


def shared_monthly_total() -> float:
    return round(sum(shared_infrastructure().values()), 2)


def model_price(model: str | None) -> Dict[str, float]:
    models = _prices().get("models", {})
    if model and model in models:
        return models[model]
    # Match by family prefix (e.g. a versioned deployment name).
    if model:
        for key, val in models.items():
            if model.startswith(key):
                return val
    return models.get(_DEFAULT_MODEL, _DEFAULTS["models"][_DEFAULT_MODEL])


def token_cost(model: str | None, input_tokens: int, output_tokens: int) -> float:
    p = model_price(model)
    return (input_tokens / 1000.0) * p.get("input_per_1k", 0.0) + (
        output_tokens / 1000.0
    ) * p.get("output_per_1k", 0.0)


def search_monthly_cost() -> float:
    return float(_prices().get("search", {}).get("unit_per_month", 0.0))
