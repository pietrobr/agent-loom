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

_CONFIG_DIRS = [
    Path(__file__).resolve().parents[3] / "config",
    Path("/app/config"),
    Path("config"),
]

# Approximate USD→currency factors, used ONLY to convert the built-in defaults
# when no price file exists for a non-USD currency. Real list prices come from
# config/azure_prices_<cur>.json (written by scripts/fetch_azure_prices.py).
_FX_FALLBACK: Dict[str, float] = {"USD": 1.0, "EUR": 0.92}

# Currencies the cost view can render. The first is the default.
SUPPORTED_CURRENCIES = ["USD", "EUR"]


def _price_filename(currency: str) -> str:
    cur = currency.upper()
    return "azure_prices.json" if cur == "USD" else f"azure_prices_{cur.lower()}.json"


def _price_paths(currency: str) -> list[Path]:
    fn = _price_filename(currency)
    return [d / fn for d in _CONFIG_DIRS]

_DEFAULTS: Dict[str, Any] = {
    "currency": "USD",
    "region": "swedencentral",
    "updated": None,
    "source": "built-in defaults",
    "models": {
        "gpt-4o-mini": {"input_per_1k": 0.000150, "output_per_1k": 0.000600},
        "gpt-4o": {"input_per_1k": 0.00250, "output_per_1k": 0.01000},
        "text-embedding-3-small": {"input_per_1k": 0.000020, "output_per_1k": 0.0},
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


def _defaults_for(currency: str) -> Dict[str, Any]:
    """Built-in defaults expressed in ``currency`` (USD as-is, others converted
    by the rough fallback rate). Only used when no price file is present."""
    cur = currency.upper()
    if cur == "USD":
        return _DEFAULTS
    rate = _FX_FALLBACK.get(cur, 1.0)
    d = json.loads(json.dumps(_DEFAULTS))  # deep copy
    d["currency"] = cur
    d["source"] = f"built-in defaults (≈{cur} at {rate})"
    for m in d["models"].values():
        m["input_per_1k"] = round(m["input_per_1k"] * rate, 8)
        m["output_per_1k"] = round(m["output_per_1k"] * rate, 8)
    d["search"]["unit_per_month"] = round(d["search"]["unit_per_month"] * rate, 2)
    d["shared_infrastructure"] = {
        k: round(v * rate, 2) for k, v in d["shared_infrastructure"].items()
    }
    return d


@lru_cache(maxsize=8)
def _prices(currency: str = "USD") -> Dict[str, Any]:
    cur = (currency or "USD").upper()
    base = _defaults_for(cur)
    for p in _price_paths(cur):
        if p.is_file():
            try:
                data = json.loads(p.read_text(encoding="utf-8"))
                merged = {**base, **data}
                # Deep-merge the nested maps so built-in entries the dynamic file
                # doesn't carry (e.g. the embedding model price) are preserved.
                merged["models"] = {**base["models"], **data.get("models", {})}
                merged["shared_infrastructure"] = {
                    **base["shared_infrastructure"],
                    **data.get("shared_infrastructure", {}),
                }
                return merged
            except Exception as exc:  # pragma: no cover
                log.warning("failed to read %s: %s", p, exc)
    return base


def meta(currency: str = "USD") -> Dict[str, Any]:
    p = _prices(currency)
    return {
        "currency": p.get("currency", "USD"),
        "region": p.get("region"),
        "updated": p.get("updated"),
        "source": p.get("source"),
        "search_monthly": float(p.get("search", {}).get("unit_per_month", 0.0)),
    }


def shared_infrastructure(currency: str = "USD") -> Dict[str, float]:
    """Monthly price of each shared component in the resource group."""
    si = _prices(currency).get("shared_infrastructure")
    if not si:
        # Older price files only had `search`; synthesize a minimal map.
        return {"ai_search": float(_prices(currency).get("search", {}).get("unit_per_month", 0.0))}
    return {k: float(v) for k, v in si.items()}


def shared_monthly_total(currency: str = "USD") -> float:
    return round(sum(shared_infrastructure(currency).values()), 2)


def model_price(model: str | None, currency: str = "USD") -> Dict[str, float]:
    models = _prices(currency).get("models", {})
    if model and model in models:
        return models[model]
    # Match by family prefix (e.g. a versioned deployment name).
    if model:
        for key, val in models.items():
            if model.startswith(key):
                return val
    return models.get(_DEFAULT_MODEL, _DEFAULTS["models"][_DEFAULT_MODEL])


def token_cost(model: str | None, input_tokens: int, output_tokens: int, currency: str = "USD") -> float:
    p = model_price(model, currency)
    return (input_tokens / 1000.0) * p.get("input_per_1k", 0.0) + (
        output_tokens / 1000.0
    ) * p.get("output_per_1k", 0.0)


_EMBEDDING_MODEL = "text-embedding-3-small"


def embedding_cost(tokens: int, currency: str = "USD") -> float:
    """Cost of embedding ``tokens`` (RAG ingestion). Embeddings are billed on
    input tokens only."""
    p = model_price(_EMBEDDING_MODEL, currency)
    return (tokens / 1000.0) * p.get("input_per_1k", 0.0)


def search_monthly_cost(currency: str = "USD") -> float:
    return float(_prices(currency).get("search", {}).get("unit_per_month", 0.0))
