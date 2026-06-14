"""Azure AI Search wrapper. One index per customer named ``kb-{org_id}``.

The index is a real RAG store: each document is chunked, every chunk carries a
vector embedding (``content_vector``) plus a semantic configuration, so queries
use hybrid retrieval (keyword + vector) re-ranked by the semantic ranker.
"""
from __future__ import annotations

import logging
import re
from functools import lru_cache
from typing import Any, Dict, Iterable, List

from azure.core.exceptions import ResourceNotFoundError
from azure.search.documents import SearchClient
from azure.search.documents.indexes import SearchIndexClient
from azure.search.documents.indexes.models import (
    HnswAlgorithmConfiguration,
    SearchableField,
    SearchField,
    SearchFieldDataType,
    SearchIndex,
    SemanticConfiguration,
    SemanticField,
    SemanticPrioritizedFields,
    SemanticSearch,
    SimpleField,
    VectorSearch,
    VectorSearchProfile,
)
from azure.search.documents.models import VectorizedQuery

from ..config import get_settings
from ..credentials import get_credential

log = logging.getLogger(__name__)

_SEMANTIC_CONFIG = "kb-semantic"
_VECTOR_PROFILE = "kb-vector-profile"
_HNSW_CONFIG = "kb-hnsw"


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
    """Create/upgrade the per-customer index if missing. Returns the index name.

    The schema includes a vector field + HNSW profile + semantic configuration.
    ``create_or_update_index`` adds new fields/configs to an existing index
    without dropping data already stored.
    """
    s = get_settings()
    name = index_name_for(org_id)
    fields = [
        SimpleField(name="id", type=SearchFieldDataType.String, key=True, filterable=True),
        SimpleField(name="org_id", type=SearchFieldDataType.String, filterable=True),
        SimpleField(name="instance_id", type=SearchFieldDataType.String, filterable=True),
        SimpleField(name="parent_id", type=SearchFieldDataType.String, filterable=True),
        SearchableField(name="title", type=SearchFieldDataType.String),
        SearchableField(name="content", type=SearchFieldDataType.String),
        SimpleField(name="source", type=SearchFieldDataType.String, filterable=True),
        SearchField(
            name="content_vector",
            type=SearchFieldDataType.Collection(SearchFieldDataType.Single),
            searchable=True,
            vector_search_dimensions=s.embedding_dimensions,
            vector_search_profile_name=_VECTOR_PROFILE,
        ),
    ]
    vector_search = VectorSearch(
        algorithms=[HnswAlgorithmConfiguration(name=_HNSW_CONFIG)],
        profiles=[VectorSearchProfile(name=_VECTOR_PROFILE, algorithm_configuration_name=_HNSW_CONFIG)],
    )
    semantic_search = SemanticSearch(
        default_configuration_name=_SEMANTIC_CONFIG,
        configurations=[
            SemanticConfiguration(
                name=_SEMANTIC_CONFIG,
                prioritized_fields=SemanticPrioritizedFields(
                    title_field=SemanticField(field_name="title"),
                    content_fields=[SemanticField(field_name="content")],
                ),
            )
        ],
    )
    idx = SearchIndex(
        name=name,
        fields=fields,
        vector_search=vector_search,
        semantic_search=semantic_search,
    )
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


def upload_docs(org_id: str, instance_id: str, docs: Iterable[Dict[str, Any]]) -> Dict[str, int]:
    """Chunk + embed each source document and index the chunks.

    Returns ``{"chunks": n, "embedding_tokens": t}``. Falls back to keyword-only
    chunks (no vectors) if embedding fails, so ingestion never hard-breaks.
    """
    from . import embeddings as emb  # local import to avoid a cycle at load

    name = ensure_index(org_id)

    # 1) Expand documents into per-chunk records.
    records: List[Dict[str, Any]] = []
    for d in docs:
        records.extend(emb.build_chunk_records(dict(d)))
    if not records:
        return {"chunks": 0, "embedding_tokens": 0}

    # 2) Embed every chunk (best-effort).
    tokens = 0
    try:
        vectors, tokens = emb.embed_texts([r["content"] for r in records])
        for r, v in zip(records, vectors):
            r["content_vector"] = v
    except Exception as exc:  # pragma: no cover
        log.warning("embedding failed for %s, indexing keyword-only: %s", org_id, exc)

    # 3) Enforce isolation + upload.
    for r in records:
        r["org_id"] = org_id
        r["instance_id"] = instance_id
    res = _search_client(name).upload_documents(documents=records)
    uploaded = sum(1 for r in res if r.succeeded)
    return {"chunks": uploaded, "embedding_tokens": tokens}


def search(org_id: str, query: str, instance_id: str | None = None, top: int = 5) -> List[Dict[str, Any]]:
    """Hybrid retrieval: keyword + vector, re-ranked by the semantic ranker.

    Falls back gracefully: if the query embedding can't be produced, runs a
    keyword+semantic search; if the semantic ranker isn't available, runs a
    plain keyword search. Isolation by org_id (+ optional instance_id) always
    applies.
    """
    from . import embeddings as emb  # local import to avoid a cycle at load

    name = index_name_for(org_id)
    flt = f"org_id eq '{org_id}'"
    if instance_id:
        flt += f" and instance_id eq '{instance_id}'"

    vector_queries = None
    qvec = emb.embed_query(query)
    if qvec:
        vector_queries = [
            VectorizedQuery(vector=qvec, k_nearest_neighbors=max(top, 10), fields="content_vector")
        ]

    def _run(use_semantic: bool) -> List[Dict[str, Any]]:
        kwargs: Dict[str, Any] = {
            "search_text": query,
            "top": top,
            "filter": flt,
            "select": ["id", "parent_id", "title", "content", "source"],
        }
        if vector_queries is not None:
            kwargs["vector_queries"] = vector_queries
        if use_semantic:
            kwargs["query_type"] = "semantic"
            kwargs["semantic_configuration_name"] = _SEMANTIC_CONFIG
        return [dict(r) for r in _search_client(name).search(**kwargs)]

    try:
        return _run(use_semantic=True)
    except ResourceNotFoundError:
        log.info("No index yet for %s", org_id)
        return []
    except Exception as exc:
        # Semantic ranker may be unavailable on some SKUs/regions; degrade.
        log.info("semantic search failed for %s (%s); falling back", org_id, exc)
        try:
            return _run(use_semantic=False)
        except ResourceNotFoundError:
            return []
        except Exception as exc2:  # pragma: no cover
            log.warning("search failed for %s: %s", org_id, exc2)
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


def reindex_org(org_id: str) -> Dict[str, int]:
    """Migrate a customer's existing index to the vector+semantic RAG schema.

    Reads every current document; the originals (those without ``parent_id``)
    are treated as source documents, re-chunked + embedded, and re-uploaded as
    chunks. The original whole-document records are then deleted. Idempotent:
    re-running finds only chunk records (which carry ``parent_id``) and is a
    no-op.
    """
    name = ensure_index(org_id)  # upgrades schema (adds vector + semantic config)
    client = _search_client(name)
    try:
        rows = list(
            client.search(
                search_text="*",
                filter=f"org_id eq '{org_id}'",
                select=["id", "instance_id", "parent_id", "title", "content", "source"],
                top=1000,
            )
        )
    except ResourceNotFoundError:
        return {"sources": 0, "chunks": 0, "embedding_tokens": 0, "deleted": 0}

    sources = [r for r in rows if not r.get("parent_id")]
    total_chunks = 0
    total_tokens = 0
    deleted = 0
    for src in sources:
        inst = src.get("instance_id", "")
        res = upload_docs(
            org_id,
            inst,
            [
                {
                    "id": src.get("id"),
                    "title": src.get("title", ""),
                    "content": src.get("content", ""),
                    "source": src.get("source", "upload"),
                }
            ],
        )
        total_chunks += int(res.get("chunks", 0) or 0)
        total_tokens += int(res.get("embedding_tokens", 0) or 0)

    # Delete the original whole-document records (now superseded by chunks).
    originals = [{"id": r["id"]} for r in sources if "__" not in str(r.get("id", ""))]
    if originals:
        try:
            dres = client.delete_documents(documents=originals)
            deleted = sum(1 for r in dres if r.succeeded)
        except Exception as exc:  # pragma: no cover
            log.warning("reindex delete failed for %s: %s", org_id, exc)

    # Back-fill vectors for existing chunks (vector field is not retrievable, so
    # we re-embed every chunk; harmless and idempotent in effect).
    stale = [r for r in rows if r.get("parent_id")]
    if stale:
        from . import embeddings as emb  # local import to avoid a cycle at load

        try:
            vectors, tokens = emb.embed_texts([r.get("content", "") for r in stale])
            patches = [
                {"id": r["id"], "content_vector": v}
                for r, v in zip(stale, vectors)
            ]
            if patches:
                client.merge_documents(documents=patches)
                total_chunks += len(patches)
                total_tokens += tokens
        except Exception as exc:  # pragma: no cover
            log.warning("reindex vector back-fill failed for %s: %s", org_id, exc)

    return {
        "sources": len(sources),
        "chunks": total_chunks,
        "embedding_tokens": total_tokens,
        "deleted": deleted,
    }
