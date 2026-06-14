"""Cosmos repository helpers.

Every read/write is forced on `partition_key=org_id`. Cross-tenant queries are
not possible from these helpers — by construction.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone, timedelta
from functools import lru_cache
from typing import Any, Dict, Iterable, List, Optional

from azure.cosmos import CosmosClient, exceptions
from azure.cosmos.partition_key import PartitionKey

from ..config import get_settings
from ..credentials import get_credential
from ..models import SYSTEM_ORG

log = logging.getLogger(__name__)


CONTAINERS = ["catalog", "tenants", "instances", "metering", "threads"]


@lru_cache(maxsize=1)
def _client() -> CosmosClient:
    s = get_settings()
    return CosmosClient(s.cosmos_endpoint, credential=get_credential())


def _db():
    return _client().get_database_client(get_settings().cosmos_database)


def _container(name: str):
    return _db().get_container_client(name)


def ensure_containers() -> None:
    """Create database + containers if missing. Called by setup scripts."""
    s = get_settings()
    db = _client().create_database_if_not_exists(s.cosmos_database)
    for name in CONTAINERS:
        db.create_container_if_not_exists(id=name, partition_key=PartitionKey(path="/org_id"))


# --------------------------------------------------------------------------- #
# Generic helpers (always partitioned)                                        #
# --------------------------------------------------------------------------- #
def upsert(container: str, org_id: str, item: Dict[str, Any]) -> Dict[str, Any]:
    item["org_id"] = org_id  # never trust the caller
    return _container(container).upsert_item(item)


def read(container: str, org_id: str, item_id: str) -> Optional[Dict[str, Any]]:
    try:
        return _container(container).read_item(item=item_id, partition_key=org_id)
    except exceptions.CosmosResourceNotFoundError:
        return None


def delete(container: str, org_id: str, item_id: str) -> None:
    try:
        _container(container).delete_item(item=item_id, partition_key=org_id)
    except exceptions.CosmosResourceNotFoundError:
        pass


def query(container: str, org_id: str, sql: str, params: Optional[List[Dict[str, Any]]] = None) -> List[Dict[str, Any]]:
    return list(
        _container(container).query_items(
            query=sql,
            parameters=params or [],
            partition_key=org_id,
        )
    )


# --------------------------------------------------------------------------- #
# Domain shortcuts                                                            #
# --------------------------------------------------------------------------- #
def list_published_templates() -> List[Dict[str, Any]]:
    return query(
        "catalog",
        SYSTEM_ORG,
        "SELECT * FROM c WHERE c.status = @s",
        [{"name": "@s", "value": "published"}],
    )


def list_all_templates() -> List[Dict[str, Any]]:
    return query("catalog", SYSTEM_ORG, "SELECT * FROM c")


def get_template(template_id: str) -> Optional[Dict[str, Any]]:
    return read("catalog", SYSTEM_ORG, template_id)


def save_template(item: Dict[str, Any]) -> Dict[str, Any]:
    return upsert("catalog", SYSTEM_ORG, item)


def list_tenants() -> List[Dict[str, Any]]:
    # Tenants live in their own partition. Use a cross-partition query (admin only).
    return list(_container("tenants").read_all_items())


def save_tenant(item: Dict[str, Any]) -> Dict[str, Any]:
    return upsert("tenants", item["org_id"], item)


def get_tenant(org_id: str) -> Optional[Dict[str, Any]]:
    return read("tenants", org_id, org_id)


# --------------------------------------------------------------------------- #
# Tenant lifecycle (active periods) — survives tenant deletion                #
# --------------------------------------------------------------------------- #
# Stored in the metering container (partitioned by org_id) under a fixed id so
# it persists even after the tenant document is deleted. Each record holds a
# list of [start, end] active periods; an open period has end == None.
_LIFECYCLE_ID = "lifecycle"


def get_lifecycle(org_id: str) -> Optional[Dict[str, Any]]:
    return read("metering", org_id, _LIFECYCLE_ID)


def record_lifecycle(org_id: str, name: str, active: bool) -> None:
    """Open or close the customer's active period.

    active=True  -> ensure an open period exists (customer created/enabled)
    active=False -> close the open period, if any (customer disabled/deleted)
    """
    now = datetime.now(timezone.utc).isoformat()
    doc = get_lifecycle(org_id) or {
        "id": _LIFECYCLE_ID,
        "org_id": org_id,
        "kind": _LIFECYCLE_ID,
        "name": name,
        "periods": [],
    }
    doc["name"] = name or doc.get("name") or org_id
    periods: List[Dict[str, Any]] = doc.get("periods") or []
    open_period = next((p for p in periods if not p.get("end")), None)
    if active:
        if not open_period:
            periods.append({"start": now, "end": None})
    else:
        if open_period:
            open_period["end"] = now
    doc["periods"] = periods
    upsert("metering", org_id, doc)


def list_instances(org_id: str) -> List[Dict[str, Any]]:
    return query("instances", org_id, "SELECT * FROM c")


def save_instance(item: Dict[str, Any]) -> Dict[str, Any]:
    return upsert("instances", item["org_id"], item)


def get_instance(org_id: str, instance_id: str) -> Optional[Dict[str, Any]]:
    return read("instances", org_id, instance_id)


def log_metering(event: Dict[str, Any]) -> None:
    upsert("metering", event["org_id"], event)


def metering_summary(org_id: str) -> Dict[str, Any]:
    # SELECT * so each document keeps its system `_ts` (epoch seconds), which we
    # use as a timestamp fallback for older events logged without an ISO `ts`.
    rows = query("metering", org_id, "SELECT * FROM c")
    # Exclude non-event docs (e.g. the lifecycle record stored in this container).
    rows = [r for r in rows if r.get("kind") not in (_LIFECYCLE_ID, "embedding") and r.get("id") != _LIFECYCLE_ID]
    calls = len(rows)
    total = sum(r.get("total_tokens", 0) for r in rows)
    by_instance: Dict[str, Dict[str, int]] = {}
    by_day_map: Dict[str, Dict[str, int]] = {}
    for r in rows:
        toks = r.get("total_tokens", 0)
        inst = r.get("instance_id", "unknown")
        bucket = by_instance.setdefault(inst, {"calls": 0, "tokens": 0})
        bucket["calls"] += 1
        bucket["tokens"] += toks

        # Daily time-series bucket. Prefer the explicit ISO `ts`; fall back to
        # Cosmos' internal `_ts` (epoch seconds) for older events without `ts`.
        ts = r.get("ts")
        if ts:
            day = str(ts)[:10]
        elif r.get("_ts"):
            day = datetime.fromtimestamp(r["_ts"], tz=timezone.utc).strftime("%Y-%m-%d")
        else:
            day = ""
        if day:
            d = by_day_map.setdefault(day, {"calls": 0, "tokens": 0})
            d["calls"] += 1
            d["tokens"] += toks

    by_day = [
        {"date": day, "calls": v["calls"], "tokens": v["tokens"]}
        for day, v in sorted(by_day_map.items())
    ]
    return {
        "calls": calls,
        "total_tokens": total,
        "by_instance": by_instance,
        "by_day": by_day,
    }


def _event_month(r: Dict[str, Any]) -> str:
    """Calendar month (YYYY-MM) for a metering event, ISO `ts` first then `_ts`."""
    ts = r.get("ts")
    if ts:
        return str(ts)[:7]
    if r.get("_ts"):
        return datetime.fromtimestamp(r["_ts"], tz=timezone.utc).strftime("%Y-%m")
    return ""


def _month_bounds(month: str) -> tuple:
    """Return (start, end) datetimes (UTC) for a 'YYYY-MM' month."""
    year, mon = int(month[:4]), int(month[5:7])
    start = datetime(year, mon, 1, tzinfo=timezone.utc)
    if mon == 12:
        end = datetime(year + 1, 1, 1, tzinfo=timezone.utc)
    else:
        end = datetime(year, mon + 1, 1, tzinfo=timezone.utc)
    return start, end


def _parse_iso(s: Any) -> Optional[datetime]:
    if not s:
        return None
    try:
        dt = datetime.fromisoformat(str(s).replace("Z", "+00:00"))
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except Exception:
        return None


def _active_days_in_month(periods: List[Dict[str, Any]], month: str, now: datetime) -> int:
    """Number of distinct active days a customer had within a calendar month,
    from its lifecycle [start, end] periods (end=None means still active)."""
    m_start, m_end = _month_bounds(month)
    days: set = set()
    for p in periods or []:
        s = _parse_iso(p.get("start")) or m_start
        e = _parse_iso(p.get("end")) or now
        s = max(s, m_start)
        e = min(e, m_end)
        if e <= s:
            continue
        cur = datetime(s.year, s.month, s.day, tzinfo=timezone.utc)
        while cur < e:
            days.add(cur.date())
            cur += timedelta(days=1)
    # Cap at the number of days in the month.
    total_days = (m_end - m_start).days
    return min(len(days), total_days)


def cost_summary() -> Dict[str, Any]:
    """Attribute the total Azure cost of the solution across customers/months.

    Token cost is computed per metering event from the price of the instance's
    model. All **shared** infrastructure in the resource group (Azure AI Search,
    Container Apps, ACR, Cosmos DB, Storage, Log Analytics, Key Vault, Foundry
    base) is summed into a monthly figure and split across the customers active
    in each month using a **weighted** formula (token usage 60%, calls 20%,
    indexed documents 20%). Each client's infra share is then **prorated by the
    number of days it was active that month** (created→disabled/deleted), so a
    customer active only 1 day pays ~1/30 of its share, and a customer gone the
    next month pays nothing.
    """
    from . import pricing  # local import to avoid a cycle at module load
    from . import search as search_svc

    now = datetime.now(timezone.utc)

    # Cross-partition reads (admin only).
    raw = list(_container("metering").read_all_items())
    events = [r for r in raw if r.get("kind") not in (_LIFECYCLE_ID, "embedding") and r.get("id") != _LIFECYCLE_ID]
    embedding_events = [r for r in raw if r.get("kind") == "embedding"]
    lifecycles = [r for r in raw if r.get("kind") == _LIFECYCLE_ID or r.get("id") == _LIFECYCLE_ID]
    periods_by_org = {lc.get("org_id"): (lc.get("periods") or []) for lc in lifecycles}
    instances = list(_container("instances").read_all_items())
    tenants = list(_container("tenants").read_all_items())

    model_by_instance = {
        (i.get("org_id"), i.get("id")): i.get("model") for i in instances
    }
    name_by_org = {t.get("org_id"): t.get("name") for t in tenants}
    created_by_org = {t.get("org_id"): t.get("created_at") for t in tenants}

    # For tenants without an explicit lifecycle record (created before lifecycle
    # tracking), synthesize an open period from their created_at so active-days
    # proration still works.
    for org, created in created_by_org.items():
        if org not in periods_by_org and created:
            periods_by_org[org] = [{"start": created, "end": None}]

    # Last metering activity per org — used to close dangling open lifecycle
    # periods for customers that no longer exist as tenants (deleted without the
    # period being closed). Without this they'd look "still active" forever.
    last_event_by_org: Dict[str, str] = {}
    for e in events:
        org = e.get("org_id", "unknown")
        ts = e.get("ts")
        if not ts and e.get("_ts"):
            ts = datetime.fromtimestamp(e["_ts"], tz=timezone.utc).isoformat()
        if ts and (org not in last_event_by_org or str(ts) > last_event_by_org[org]):
            last_event_by_org[org] = str(ts)

    for org, periods in periods_by_org.items():
        if org in name_by_org:
            continue  # still a tenant → open period is legitimate
        # Customer no longer exists: close any open period at its last activity.
        end = last_event_by_org.get(org)
        for p in periods:
            if not p.get("end"):
                p["end"] = end or p.get("start")

    # month -> org_id -> aggregate
    months: Dict[str, Dict[str, Dict[str, Any]]] = {}
    # (org, month) -> set of calendar days with activity (event-based fallback).
    event_days: Dict[tuple, set] = {}
    for e in events:
        month = _event_month(e)
        if not month:
            continue
        org = e.get("org_id", "unknown")
        inp = int(e.get("input_tokens", 0) or 0)
        outp = int(e.get("output_tokens", 0) or 0)
        tot = int(e.get("total_tokens", 0) or 0) or (inp + outp)
        model = model_by_instance.get((org, e.get("instance_id")))
        cost = pricing.token_cost(model, inp, outp)

        # Track the day this event happened (for legacy customers with no tenant
        # and no lifecycle record, e.g. deleted before lifecycle tracking).
        ev_dt = _parse_iso(e.get("ts"))
        if not ev_dt and e.get("_ts"):
            ev_dt = datetime.fromtimestamp(e["_ts"], tz=timezone.utc)
        if ev_dt:
            event_days.setdefault((org, month), set()).add(ev_dt.date())

        bucket = months.setdefault(month, {}).setdefault(
            org,
            {
                "org_id": org,
                "name": name_by_org.get(org, org),
                "tokens": 0,
                "calls": 0,
                "indices": 1,
                "documents": 0,
                "token_cost": 0.0,
                "embedding_tokens": 0,
                "embedding_cost": 0.0,
            },
        )
        bucket["tokens"] += tot
        bucket["calls"] += 1
        bucket["token_cost"] += cost

    # Embedding (RAG ingestion) events are metered separately so they never
    # inflate chat call/token/cost metrics, but their cost is still attributed
    # to the customer as its own line.
    for e in embedding_events:
        month = _event_month(e)
        if not month:
            continue
        org = e.get("org_id", "unknown")
        etok = int(e.get("embedding_tokens", 0) or e.get("total_tokens", 0) or 0)
        if etok <= 0:
            continue
        bucket = months.setdefault(month, {}).setdefault(
            org,
            {
                "org_id": org,
                "name": name_by_org.get(org, org),
                "tokens": 0,
                "calls": 0,
                "indices": 1,
                "documents": 0,
                "token_cost": 0.0,
                "embedding_tokens": 0,
                "embedding_cost": 0.0,
            },
        )
        bucket["embedding_tokens"] += etok
        bucket["embedding_cost"] += pricing.embedding_cost(etok)

    # Document count per customer (current index size, used as a proxy weight).
    doc_count: Dict[str, int] = {}
    for org in {org for m in months.values() for org in m}:
        doc_count[org] = search_svc.document_count(org)

    infra = pricing.shared_infrastructure()
    infra_monthly = pricing.shared_monthly_total()

    # Weighted infra split. A client's share is a blend of its token usage, call
    # volume and indexed document count (each normalized within the month). This
    # avoids charging an idle customer the same as a heavy one.
    W_TOKENS, W_CALLS, W_DOCS = 0.6, 0.2, 0.2

    by_month = []
    grand_total = 0.0
    for month in sorted(months.keys()):
        clients = list(months[month].values())
        active = len(clients) or 1
        m_start, m_end = _month_bounds(month)
        days_in_month = (m_end - m_start).days
        for c in clients:
            c["documents"] = doc_count.get(c["org_id"], 0)
            periods = periods_by_org.get(c["org_id"])
            if periods is not None:
                # Explicit lifecycle record, or synthesized from the tenant's
                # created_at (customer still exists).
                c["active_days"] = _active_days_in_month(periods, month, now)
            else:
                # No lifecycle record and no tenant (deleted before lifecycle
                # tracking): best estimate is the number of days it had activity.
                c["active_days"] = len(event_days.get((c["org_id"], month), set())) or 1
            c["days_in_month"] = days_in_month

        sum_tokens = sum(c["tokens"] for c in clients)
        sum_calls = sum(c["calls"] for c in clients)
        sum_docs = sum(c["documents"] for c in clients)

        # Per-client weight; falls back to an equal share if a dimension is empty.
        def _frac(value: int, total: int) -> float:
            return (value / total) if total > 0 else (1.0 / active)

        weights = []
        for c in clients:
            w = (
                W_TOKENS * _frac(c["tokens"], sum_tokens)
                + W_CALLS * _frac(c["calls"], sum_calls)
                + W_DOCS * _frac(c["documents"], sum_docs)
            )
            weights.append(w)
        weight_total = sum(weights) or 1.0

        month_token = 0.0
        month_infra = 0.0
        month_embedding = 0.0
        for c, w in zip(clients, weights):
            share = w / weight_total
            # Pro-rate the infra share by the fraction of the month the customer
            # was actually active (created→disabled/deleted). 1 day ⇒ share/30.
            active_frac = (c["active_days"] / days_in_month) if days_in_month else 1.0
            c["infra_weight"] = round(share, 4)
            c["active_fraction"] = round(active_frac, 4)
            c["infra_cost"] = round(infra_monthly * share * active_frac, 4)
            # Back-compat: the AI Search slice of this client's prorated share.
            c["search_cost"] = round(infra.get("ai_search", 0.0) * share * active_frac, 4)
            c["token_cost"] = round(c["token_cost"], 4)
            c["embedding_cost"] = round(c.get("embedding_cost", 0.0), 4)
            c["total_cost"] = round(c["token_cost"] + c["embedding_cost"] + c["infra_cost"], 4)
            month_token += c["token_cost"]
            month_infra += c["infra_cost"]
            month_embedding += c["embedding_cost"]
        clients.sort(key=lambda x: x["total_cost"], reverse=True)
        month_total = round(month_token + month_embedding + month_infra, 2)
        grand_total += month_total
        by_month.append(
            {
                "month": month,
                "token_cost": round(month_token, 2),
                "embedding_cost": round(month_embedding, 4),
                "infra_cost": round(month_infra, 2),
                "infra_full": round(infra_monthly, 2),
                "search_cost": round(infra.get("ai_search", 0.0), 2),
                "total_cost": month_total,
                "active_clients": active,
                "days_in_month": days_in_month,
                "weights": {"tokens": W_TOKENS, "calls": W_CALLS, "documents": W_DOCS},
                "clients": clients,
            }
        )

    return {
        **pricing.meta(),
        "search_monthly": round(infra.get("ai_search", 0.0), 2),
        "infra_monthly": infra_monthly,
        "infra_breakdown": {k: round(v, 2) for k, v in infra.items()},
        "weights": {"tokens": W_TOKENS, "calls": W_CALLS, "documents": W_DOCS},
        "total_cost": round(grand_total, 2),
        "by_month": list(reversed(by_month)),  # newest first
    }

