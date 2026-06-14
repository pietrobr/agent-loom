"""Azure AI Search **agentic retrieval** (knowledge base) integration.

This sits on top of the per-customer ``kb-{org}`` index that already powers the
RAG pipeline. For customers/instances that opt in, we provision:

* a **knowledge source** (``ks-{org}``) that points at the existing index, and
* a **knowledge base** (``kbagent-{org}``) that binds the source to the Foundry
  chat model for LLM query planning + answer synthesis.

At query time the ``retrieve`` action decomposes the question into sub-queries,
runs them in parallel against the index, semantically re-ranks, and returns a
synthesized, citation-grounded answer plus an ``activity`` log (used to meter
the planning/synthesis tokens).

Implemented against the Search Service REST API ``2026-05-01-preview`` via
``httpx`` + AAD tokens, so the stable ``azure-search-documents`` SDK used by the
rest of the app is left untouched.
"""
from __future__ import annotations

import logging
import re
import time
from functools import lru_cache
from typing import Any, Dict, List, Optional, Tuple

import httpx

from ..config import get_settings
from ..credentials import get_credential
from . import search as search_svc

log = logging.getLogger(__name__)

_API_VERSION = "2026-05-01-preview"
_SCOPE = "https://search.azure.com/.default"
_SAFE = re.compile(r"[^a-z0-9-]+")


def knowledge_source_name(org_id: str) -> str:
    safe = _SAFE.sub("-", org_id.lower()).strip("-")
    return f"ks-{safe}"[:128]


def knowledge_base_name(org_id: str) -> str:
    safe = _SAFE.sub("-", org_id.lower()).strip("-")
    return f"kbagent-{safe}"[:128]


# --------------------------------------------------------------------------- #
# Auth + HTTP                                                                  #
# --------------------------------------------------------------------------- #
_token_cache: Dict[str, Any] = {"value": None, "exp": 0.0}


def _bearer() -> str:
    now = time.time()
    if _token_cache["value"] and _token_cache["exp"] - now > 120:
        return _token_cache["value"]
    tok = get_credential().get_token(_SCOPE)
    _token_cache["value"] = tok.token
    _token_cache["exp"] = float(tok.expires_on)
    return tok.token


def _headers() -> Dict[str, str]:
    return {"Authorization": f"Bearer {_bearer()}", "Content-Type": "application/json"}


def _base() -> str:
    return get_settings().search_endpoint.rstrip("/")


# --------------------------------------------------------------------------- #
# Provisioning                                                                 #
# --------------------------------------------------------------------------- #
def ensure_resources(org_id: str) -> Dict[str, str]:
    """Create/update the knowledge source + knowledge base for a customer.

    Idempotent. Returns the resource names. Requires the ``kb-{org}`` index to
    exist (created lazily here if missing).
    """
    s = get_settings()
    index = search_svc.ensure_index(org_id)
    ks = knowledge_source_name(org_id)
    kb = knowledge_base_name(org_id)

    ks_body = {
        "name": ks,
        "kind": "searchIndex",
        "description": f"Agentic retrieval source for {org_id}",
        "searchIndexParameters": {
            "searchIndexName": index,
            "semanticConfigurationName": "kb-semantic",
            "sourceDataFields": [
                {"name": "title"},
                {"name": "content"},
                {"name": "source"},
                {"name": "instance_id"},
            ],
            "searchFields": [{"name": "content"}, {"name": "title"}],
        },
    }
    kb_body = {
        "name": kb,
        "description": f"Agentic retrieval knowledge base for {org_id}",
        "knowledgeSources": [{"name": ks}],
        "outputMode": "answerSynthesis",
        "models": [
            {
                "kind": "azureOpenAI",
                "azureOpenAIParameters": {
                    "resourceUri": s.foundry_account_endpoint,
                    "deploymentId": s.foundry_chat_deployment,
                    "modelName": s.foundry_chat_model,
                },
            }
        ],
        "retrievalReasoningEffort": {"kind": "low"},
    }

    with httpx.Client(timeout=60.0) as client:
        r1 = client.put(
            f"{_base()}/knowledgesources/{ks}",
            params={"api-version": _API_VERSION},
            headers=_headers(),
            json=ks_body,
        )
        r1.raise_for_status()
        r2 = client.put(
            f"{_base()}/knowledgebases/{kb}",
            params={"api-version": _API_VERSION},
            headers=_headers(),
            json=kb_body,
        )
        r2.raise_for_status()
    log.info("agentic resources ready for %s (%s, %s)", org_id, ks, kb)
    return {"knowledge_source": ks, "knowledge_base": kb, "index": index}


def delete_resources(org_id: str) -> None:
    """Best-effort teardown of the knowledge base + source for a customer."""
    ks = knowledge_source_name(org_id)
    kb = knowledge_base_name(org_id)
    with httpx.Client(timeout=30.0) as client:
        for path in (f"knowledgebases/{kb}", f"knowledgesources/{ks}"):
            try:
                client.delete(
                    f"{_base()}/{path}",
                    params={"api-version": _API_VERSION},
                    headers=_headers(),
                )
            except Exception as exc:  # pragma: no cover
                log.info("agentic delete %s ignored: %s", path, exc)


# --------------------------------------------------------------------------- #
# Retrieve                                                                     #
# --------------------------------------------------------------------------- #
def _activity_tokens(activity: List[Dict[str, Any]]) -> int:
    total = 0
    for a in activity or []:
        total += int(a.get("inputTokens", 0) or 0)
        total += int(a.get("outputTokens", 0) or 0)
    return total


def retrieve(
    org_id: str,
    message: str,
    instance_id: Optional[str] = None,
    system_prompt: str = "",
) -> Tuple[str, List[Dict[str, Any]], int]:
    """Run agentic retrieval for a question.

    Returns ``(answer, references, planning_tokens)`` where ``answer`` is the
    synthesized grounded answer, ``references`` is a list of grounding documents
    ``{title, content, source}``, and ``planning_tokens`` is the LLM token usage
    reported in the activity log (for metering).
    """
    kb = knowledge_base_name(org_id)
    messages: List[Dict[str, Any]] = []
    if system_prompt:
        messages.append(
            {"role": "assistant", "content": [{"type": "text", "text": system_prompt}]}
        )
    messages.append({"role": "user", "content": [{"type": "text", "text": message}]})

    # Per-instance isolation (the index is shared across a customer's instances).
    ks_params: Dict[str, Any] = {
        "knowledgeSourceName": knowledge_source_name(org_id),
        "kind": "searchIndex",
        "includeReferences": True,
        "includeReferenceSourceData": True,
    }
    flt = f"org_id eq '{org_id}'"
    if instance_id:
        flt += f" and instance_id eq '{instance_id}'"
    ks_params["filterAddOn"] = flt

    body = {
        "messages": messages,
        "includeActivity": True,
        "knowledgeSourceParams": [ks_params],
    }

    with httpx.Client(timeout=60.0) as client:
        resp = client.post(
            f"{_base()}/knowledgebases/{kb}/retrieve",
            params={"api-version": _API_VERSION},
            headers=_headers(),
            json=body,
        )
        resp.raise_for_status()
        data = resp.json()

    # Synthesized answer (output_mode = answerSynthesis).
    answer = ""
    for msg in data.get("response", []) or []:
        for c in msg.get("content", []) or []:
            if c.get("type") == "text" and c.get("text"):
                answer += c["text"]

    references: List[Dict[str, Any]] = []
    for ref in data.get("references", []) or []:
        sd = ref.get("sourceData") or {}
        references.append(
            {
                "title": sd.get("title", ""),
                "content": sd.get("content", ""),
                "source": sd.get("source", "agentic"),
            }
        )

    tokens = _activity_tokens(data.get("activity", []))
    return answer, references, tokens
