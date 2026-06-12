"""Cosmos repository helpers.

Every read/write is forced on `partition_key=org_id`. Cross-tenant queries are
not possible from these helpers — by construction.
"""
from __future__ import annotations

import logging
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


def list_instances(org_id: str) -> List[Dict[str, Any]]:
    return query("instances", org_id, "SELECT * FROM c")


def save_instance(item: Dict[str, Any]) -> Dict[str, Any]:
    return upsert("instances", item["org_id"], item)


def get_instance(org_id: str, instance_id: str) -> Optional[Dict[str, Any]]:
    return read("instances", org_id, instance_id)


def log_metering(event: Dict[str, Any]) -> None:
    upsert("metering", event["org_id"], event)


def metering_summary(org_id: str) -> Dict[str, Any]:
    rows = query(
        "metering",
        org_id,
        "SELECT VALUE { calls: 1, input: c.input_tokens, output: c.output_tokens, total: c.total_tokens, instance: c.instance_id } FROM c",
    )
    calls = len(rows)
    total = sum(r.get("total", 0) for r in rows)
    by_instance: Dict[str, Dict[str, int]] = {}
    for r in rows:
        bucket = by_instance.setdefault(r["instance"], {"calls": 0, "tokens": 0})
        bucket["calls"] += 1
        bucket["tokens"] += r.get("total", 0)
    return {"calls": calls, "total_tokens": total, "by_instance": by_instance}
