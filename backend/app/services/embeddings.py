"""Embeddings + text chunking for the RAG pipeline.

Embeddings are produced via the Foundry project's OpenAI-compatible client
(same managed identity as the chat model), using the deployment named by
``EMBEDDING_DEPLOYMENT``. Documents are split into overlapping chunks so each
vector represents a focused passage (true RAG, not whole-document vectors).
"""
from __future__ import annotations

import logging
import re
from typing import Dict, List, Tuple

from ..config import get_settings
from .foundry import _embeddings_client

log = logging.getLogger(__name__)

# ~500 tokens per chunk with ~50 token overlap. We approximate tokens as
# words * 1.3; using words keeps the splitter dependency-free.
_WORDS_PER_CHUNK = 380
_WORDS_OVERLAP = 40

_WS = re.compile(r"\s+")


def chunk_text(text: str, *, words_per_chunk: int = _WORDS_PER_CHUNK, overlap: int = _WORDS_OVERLAP) -> List[str]:
    """Split text into overlapping word-windows. Returns at least one chunk."""
    clean = _WS.sub(" ", (text or "")).strip()
    if not clean:
        return []
    words = clean.split(" ")
    if len(words) <= words_per_chunk:
        return [clean]
    chunks: List[str] = []
    step = max(1, words_per_chunk - overlap)
    for start in range(0, len(words), step):
        window = words[start : start + words_per_chunk]
        if window:
            chunks.append(" ".join(window))
        if start + words_per_chunk >= len(words):
            break
    return chunks


def embed_texts(texts: List[str]) -> Tuple[List[List[float]], int]:
    """Embed a list of texts. Returns (vectors, total_tokens_used).

    Batches in groups to stay within request limits. On failure, raises so the
    caller can decide whether to fall back to keyword-only indexing.
    """
    s = get_settings()
    client = _embeddings_client()
    vectors: List[List[float]] = []
    total_tokens = 0
    batch = 64
    for i in range(0, len(texts), batch):
        part = texts[i : i + batch]
        resp = client.embeddings.create(model=s.embedding_deployment, input=part)
        # Preserve order.
        for item in sorted(resp.data, key=lambda d: d.index):
            vectors.append(list(item.embedding))
        usage = getattr(resp, "usage", None)
        if usage is not None:
            total_tokens += int(getattr(usage, "total_tokens", 0) or 0)
    return vectors, total_tokens


def embed_query(text: str) -> List[float]:
    """Embed a single query string for vector search. Returns [] on failure."""
    try:
        vectors, _ = embed_texts([text])
        return vectors[0] if vectors else []
    except Exception as exc:  # pragma: no cover - network/permission issues
        log.warning("embed_query failed: %s", exc)
        return []


def build_chunk_records(doc: Dict) -> List[Dict]:
    """Expand a source document into per-chunk records (without vectors).

    The caller fills ``content_vector`` after embedding. ``id`` is unique per
    chunk; ``parent_id`` ties chunks back to the source document.
    """
    parent_id = str(doc.get("id") or "")
    title = doc.get("title", "")
    source = doc.get("source", "")
    chunks = chunk_text(doc.get("content", ""))
    records: List[Dict] = []
    for n, chunk in enumerate(chunks):
        records.append(
            {
                "id": f"{parent_id}__{n}" if parent_id else f"chunk-{n}",
                "parent_id": parent_id,
                "title": title,
                "content": chunk,
                "source": source,
            }
        )
    return records
