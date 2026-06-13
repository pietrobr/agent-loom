"""Azure AI Search wrapper. One index per customer named ``kb-{org_id}``."""
from __future__ import annotations

import logging
import re
from functools import lru_cache
from typing import Any, Dict, Iterable, List

from azure.core.exceptions import ResourceNotFoundError
from azure.search.documents import SearchClient
from azure.search.documents.indexes import SearchIndexClient
from azure.search.documents.indexes.models import (
    SearchableField,
    SearchField,
    SearchFieldDataType,
    SearchIndex,
    SimpleField,
)

from ..config import get_settings
from ..credentials import get_credential

log = logging.getLogger(__name__)


_SAFE = re.compile(r"[^a-z0-9-]+")


def index_name_for(org_id: str) -> str:
    safe = _SAFE.sub("-", org_id.lower()).strip("-")
    return f"kb-{safe}"[:128]


@lru_cache(maxsize=1)
def _index_client() -> SearchIndexClient:
    s = get_settings()
    return SearchIndexClient(endpoint=s.search_endpoint, credential=get_credential())


def _search_client(index: str) -> SearchClient:
    s = get_settings()
    return SearchClient(endpoint=s.search_endpoint, index_name=index, credential=get_credential())


def ensure_index(org_id: str) -> str:
    """Create the per-customer index if missing. Returns the index name."""
    name = index_name_for(org_id)
    fields = [
        SimpleField(name="id", type=SearchFieldDataType.String, key=True, filterable=True),
        SimpleField(name="org_id", type=SearchFieldDataType.String, filterable=True),
        SimpleField(name="instance_id", type=SearchFieldDataType.String, filterable=True),
        SearchableField(name="title", type=SearchFieldDataType.String),
        SearchableField(name="content", type=SearchFieldDataType.String),
        SimpleField(name="source", type=SearchFieldDataType.String, filterable=True),
    ]
    idx = SearchIndex(name=name, fields=fields)
    try:
        _index_client().create_or_update_index(idx)
    except Exception as exc:  # pragma: no cover
        log.error("Failed to ensure index %s: %s", name, exc)
        raise
    return name


def delete_index(org_id: str) -> None:
    name = index_name_for(org_id)
    try:
        _index_client().delete_index(name)
    except ResourceNotFoundError:
        pass


def upload_docs(org_id: str, instance_id: str, docs: Iterable[Dict[str, Any]]) -> int:
    name = ensure_index(org_id)
    sanitized: List[Dict[str, Any]] = []
    for d in docs:
        d = dict(d)
        d["org_id"] = org_id  # enforce isolation
        d["instance_id"] = instance_id  # scope to the owning instance
        sanitized.append(d)
    if not sanitized:
        return 0
    res = _search_client(name).upload_documents(documents=sanitized)
    return sum(1 for r in res if r.succeeded)


def search(org_id: str, query: str, instance_id: str | None = None, top: int = 5) -> List[Dict[str, Any]]:
    name = index_name_for(org_id)
    flt = f"org_id eq '{org_id}'"
    if instance_id:
        flt += f" and instance_id eq '{instance_id}'"
    try:
        results = _search_client(name).search(
            search_text=query,
            top=top,
            filter=flt,  # belt-and-braces isolation (org + instance)
            select=["id", "title", "content", "source"],
        )
        return [dict(r) for r in results]
    except ResourceNotFoundError:
        log.info("No index yet for %s", org_id)
        return []


def document_count(org_id: str) -> int:
    """Total number of documents indexed for a customer (its kb-{org_id} index).

    Used to weight infrastructure cost attribution. Returns 0 if the index does
    not exist yet or the count cannot be read.
    """
    name = index_name_for(org_id)
    try:
        return int(_search_client(name).get_document_count())
    except ResourceNotFoundError:
        return 0
    except Exception as exc:  # pragma: no cover
        log.info("document_count(%s) ignored: %s", org_id, exc)
        return 0


def delete_instance_docs(org_id: str, instance_id: str) -> int:
    """Delete every indexed document that belongs to a given instance. Returns
    the count removed (best-effort, idempotent)."""
    name = index_name_for(org_id)
    try:
        client = _search_client(name)
        hits = client.search(
            search_text="*",
            filter=f"org_id eq '{org_id}' and instance_id eq '{instance_id}'",
            select=["id"],
            top=1000,
        )
        ids = [{"id": r["id"]} for r in hits]
        if not ids:
            return 0
        res = client.delete_documents(documents=ids)
        return sum(1 for r in res if r.succeeded)
    except ResourceNotFoundError:
        return 0
    except Exception as exc:  # pragma: no cover
        log.info("delete_instance_docs(%s/%s) ignored: %s", org_id, instance_id, exc)
        return 0
