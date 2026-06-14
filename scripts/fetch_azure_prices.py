"""Fetch Azure retail prices and write a static price list used by the cost view.

The Azure Retail Prices API is public (no auth) and documented at
https://learn.microsoft.com/rest/api/cost-management/retail-prices/azure-retail-prices

We capture what AgentLoom needs to attribute the **whole solution** cost to
customers:
  - Azure OpenAI token meters (input/output per 1K tokens) for the models the
    partner deploys (variable, per-customer), and
  - the monthly price of every **shared** Azure component in the resource group
    (Azure AI Search, Container Apps, Container Registry, Cosmos DB, Storage,
    Log Analytics, Key Vault, AI Foundry base). These are split across the
    customers that are active in each month.

The result is saved to ``config/azure_prices.json`` and read at runtime by
``backend/app/services/pricing.py``. Re-run this script to refresh prices:

    python scripts/fetch_azure_prices.py --region swedencentral

If the API is unreachable the file keeps its previous content (or the backend
falls back to built-in defaults), so the cost view degrades gracefully.
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import urlopen

API = "https://prices.azure.com/api/retail/prices"
CONFIG_DIR = Path(__file__).resolve().parents[1] / "config"
OUT = CONFIG_DIR / "azure_prices.json"
HOURS_PER_MONTH = 730

# Currencies to fetch. USD is written to azure_prices.json (the default the
# backend reads); every other currency goes to azure_prices_<cur>.json.
CURRENCIES = ["USD", "EUR"]

# Rough USD→currency factors, used ONLY to convert the built-in fallbacks when
# the retail API returns nothing for a non-USD currency (real list prices come
# from the API and override these).
FX_FALLBACK = {"USD": 1.0, "EUR": 0.92}


def _out_path(currency: str) -> Path:
    cur = currency.upper()
    name = "azure_prices.json" if cur == "USD" else f"azure_prices_{cur.lower()}.json"
    return CONFIG_DIR / name

# Models the partner is likely to deploy. Keys are matched (case-insensitive,
# substring) against the retail meter names. Built-in fallbacks are USD per 1K
# tokens and only used when the API returns nothing for that model.
MODEL_FALLBACKS_USD_PER_1K = {
    "gpt-4o-mini": {"input_per_1k": 0.000150, "output_per_1k": 0.000600},
    "gpt-4o": {"input_per_1k": 0.00250, "output_per_1k": 0.01000},
    "gpt-4.1-mini": {"input_per_1k": 0.000400, "output_per_1k": 0.001600},
    "gpt-4.1": {"input_per_1k": 0.00200, "output_per_1k": 0.00800},
    "o4-mini": {"input_per_1k": 0.001100, "output_per_1k": 0.004400},
    "text-embedding-3-small": {"input_per_1k": 0.000020, "output_per_1k": 0.0},
}

# Monthly USD fallbacks for the shared components in the resource group. These
# are used when the retail API can't be matched (consumption services have no
# single "monthly" SKU). They are deliberately conservative dev-tier estimates.
SHARED_FALLBACKS_USD_PER_MONTH = {
    "ai_search": 245.28,          # Azure AI Search Standard S1
    "container_apps": 55.00,      # 3 apps on a Consumption environment
    "container_registry": 20.00,  # ACR Standard
    "cosmos_db": 25.00,           # Cosmos DB serverless (RU + storage)
    "log_analytics": 12.00,       # Azure Monitor / Log Analytics ingestion
    "storage": 3.00,              # Blob storage (private)
    "key_vault": 1.00,            # Key Vault operations
    "ai_foundry_base": 0.00,      # Foundry project base (token cost is per-call)
}


def _get(filter_expr: str, currency: str = "USD") -> list[dict]:
    items: list[dict] = []
    url = f"{API}?{urlencode({'$filter': filter_expr, 'currencyCode': currency.upper()})}"
    for _ in range(20):  # follow NextPageLink
        with urlopen(url, timeout=30) as resp:  # noqa: S310 (trusted Azure host)
            data = json.loads(resp.read().decode("utf-8"))
        items.extend(data.get("Items", []))
        nxt = data.get("NextPageLink")
        if not nxt:
            break
        url = nxt
    return items


def fetch_models(region: str, currency: str = "USD") -> dict:
    out: dict[str, dict] = {}
    fx = FX_FALLBACK.get(currency.upper(), 1.0)
    try:
        items = _get(
            "serviceName eq 'Cognitive Services' and "
            f"armRegionName eq '{region}' and unitOfMeasure eq '1K'",
            currency,
        )
    except Exception as exc:  # pragma: no cover
        print(f"warning: model price fetch failed: {exc}", file=sys.stderr)
        items = []

    for model in MODEL_FALLBACKS_USD_PER_1K:
        inp = out.setdefault(model, {})
        for it in items:
            meter = (it.get("meterName") or "").lower()
            if model not in meter:
                continue
            price = it.get("retailPrice") or 0.0
            if "inp" in meter or "input" in meter:
                inp["input_per_1k"] = price
            elif "outp" in meter or "output" in meter:
                inp["output_per_1k"] = price
        for k, v in MODEL_FALLBACKS_USD_PER_1K[model].items():
            inp.setdefault(k, round(v * fx, 8))
    return out


def _monthly_from_hourly(items: list[dict]) -> float | None:
    hourly = next(
        (it["retailPrice"] for it in items if (it.get("unitOfMeasure") or "").startswith("1 Hour")),
        None,
    )
    return round(hourly * HOURS_PER_MONTH, 2) if hourly else None


def _monthly_from_daily(items: list[dict]) -> float | None:
    daily = next(
        (it["retailPrice"] for it in items if "day" in (it.get("unitOfMeasure") or "").lower()),
        None,
    )
    return round(daily * 30.0, 2) if daily else None


def fetch_shared(region: str, currency: str = "USD") -> dict:
    """Best-effort monthly price for each shared component, with fallbacks."""
    fx = FX_FALLBACK.get(currency.upper(), 1.0)
    shared = {k: round(v * fx, 2) for k, v in SHARED_FALLBACKS_USD_PER_MONTH.items()}

    # Azure AI Search Standard S1 (hourly meter).
    try:
        items = _get(
            "serviceName eq 'Azure Cognitive Search' and "
            f"armRegionName eq '{region}' and skuName eq 'Standard S1'",
            currency,
        )
        m = _monthly_from_hourly(items)
        if m:
            shared["ai_search"] = m
    except Exception as exc:  # pragma: no cover
        print(f"warning: search price fetch failed: {exc}", file=sys.stderr)

    # Azure Container Registry Standard (daily registry unit).
    try:
        items = _get(
            "serviceName eq 'Container Registry' and skuName eq 'Standard'", currency
        )
        m = _monthly_from_daily(items)
        if m:
            shared["container_registry"] = m
    except Exception as exc:  # pragma: no cover
        print(f"warning: ACR price fetch failed: {exc}", file=sys.stderr)

    return shared


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--region", default="swedencentral")
    ap.add_argument(
        "--currencies",
        default=",".join(CURRENCIES),
        help="Comma-separated currency codes to fetch (default: USD,EUR).",
    )
    args = ap.parse_args()

    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    for currency in [c.strip().upper() for c in args.currencies.split(",") if c.strip()]:
        shared = fetch_shared(args.region, currency)
        payload = {
            "currency": currency,
            "region": args.region,
            "updated": datetime.now(timezone.utc).isoformat(),
            "source": "Azure Retail Prices API",
            "models": fetch_models(args.region, currency),
            # Kept for backwards compatibility; mirrors shared_infrastructure.ai_search.
            "search": {"sku": "Standard S1", "unit_per_month": shared["ai_search"]},
            "shared_infrastructure": shared,
        }
        out = _out_path(currency)
        out.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
        print(f"wrote {out}")
        print(f"  {currency} shared infra monthly total ≈ {sum(shared.values()):,.2f}")


if __name__ == "__main__":
    main()
