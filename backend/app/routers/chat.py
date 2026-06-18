"""SSE chat endpoint: resolves org_id from the JWT, runs the customer's
instance against its template's Foundry agent, streams tokens back.
"""
from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timezone
from typing import AsyncGenerator

import anyio
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sse_starlette.sse import EventSourceResponse
from ..models import ChatRequest
from ..security import Principal, get_principal
from ..services import agentic, cosmos, foundry, search

router = APIRouter(prefix="/v1", tags=["chat"])
log = logging.getLogger(__name__)

# Max characters of extracted document text returned to the chat composer.
# Keeps a single attachment from blowing past the model context window.
_MAX_EXTRACT_CHARS = 20_000


def _thread_id_for(org_id: str, conversation_id: str) -> str:
    """Map (org_id, conversation_id) → Foundry thread_id, creating on demand."""
    key = f"thread::{conversation_id}"
    existing = cosmos.read("threads", org_id, key)
    if existing and existing.get("thread_id"):
        return existing["thread_id"]
    thread_id = foundry.create_thread()
    cosmos.upsert(
        "threads",
        org_id,
        {"id": key, "org_id": org_id, "conversation_id": conversation_id, "thread_id": thread_id},
    )
    return thread_id


def _extract_text(filename: str, content_type: str, raw: bytes) -> str:
    """Best-effort plain-text extraction from an uploaded document.

    Supports PDF (pypdf), Word .docx (python-docx) and any UTF-8 text/markdown
    file. Returns the extracted text; raises HTTP 415 for unsupported formats.
    """
    name = (filename or "").lower()
    ctype = (content_type or "").lower()

    # PDF
    if name.endswith(".pdf") or "pdf" in ctype:
        try:
            import io

            from pypdf import PdfReader  # type: ignore

            reader = PdfReader(io.BytesIO(raw))
            parts = [(page.extract_text() or "") for page in reader.pages]
            return "\n".join(parts).strip()
        except Exception as exc:  # pragma: no cover - depends on file content
            raise HTTPException(422, f"could not read PDF: {exc}")

    # Word .docx
    if name.endswith(".docx") or "officedocument.wordprocessingml" in ctype:
        try:
            import io

            from docx import Document  # type: ignore

            doc = Document(io.BytesIO(raw))
            return "\n".join(par.text for par in doc.paragraphs).strip()
        except Exception as exc:  # pragma: no cover - depends on file content
            raise HTTPException(422, f"could not read Word document: {exc}")

    # Plain text / markdown / csv (legacy .doc is not supported)
    if name.endswith(".doc"):
        raise HTTPException(415, "legacy .doc is not supported — upload PDF, DOCX, TXT or MD")
    if name.endswith((".txt", ".md", ".csv")) or ctype.startswith("text/") or not ctype:
        return raw.decode("utf-8", errors="ignore").strip()

    raise HTTPException(415, f"unsupported file type: {filename}")


@router.post("/chat/extract")
async def extract_document(
    file: UploadFile = File(...),
    p: Principal = Depends(get_principal),
) -> dict:
    """Extract plain text from an uploaded document for the chat composer.

    Lets a customer attach a file (e.g. a CV) in the chat: the client uploads
    it here, receives the extracted text, and includes it in the next message.
    Authenticated and org-scoped via the JWT; nothing is persisted.
    """
    raw = await file.read()
    if not raw:
        raise HTTPException(400, "empty file")
    if len(raw) > 8 * 1024 * 1024:
        raise HTTPException(413, "file too large (max 8 MB)")

    text = await anyio.to_thread.run_sync(
        _extract_text, file.filename or "", file.content_type or "", raw
    )
    if not text:
        raise HTTPException(422, "no readable text found in the document")

    truncated = len(text) > _MAX_EXTRACT_CHARS
    if truncated:
        text = text[:_MAX_EXTRACT_CHARS]
    return {
        "filename": file.filename,
        "chars": len(text),
        "truncated": truncated,
        "text": text,
    }


@router.post("/chat")
async def chat(req: ChatRequest, p: Principal = Depends(get_principal)) -> EventSourceResponse:
    instance = cosmos.get_instance(p.org_id, req.instance_id)
    if not instance:
        raise HTTPException(404, "instance not found for this org")

    template = cosmos.get_template(instance["template_id"])
    if not template:
        raise HTTPException(409, "instance references an unknown template")
    agent_id = instance.get("foundry_agent_id")
    if not agent_id:
        raise HTTPException(409, "instance is not bound to a Foundry agent")

    conversation_id = req.conversation_id or str(uuid.uuid4())
    thread_id = _thread_id_for(p.org_id, conversation_id)

    # Retrieve this instance's private knowledge. When the instance opted into
    # Azure AI Search agentic retrieval, run the knowledge base (LLM query
    # planning + answer synthesis) and use its grounding references; otherwise
    # use the standard hybrid+semantic search. Falls back gracefully.
    agentic_used = False
    agentic_tokens = 0
    hits: list = []
    if instance.get("agentic_retrieval"):
        try:
            system_prompt = (instance.get("overrides") or {}).get("instructions_addendum") or ""
            answer, refs, agentic_tokens = await anyio.to_thread.run_sync(
                agentic.retrieve, p.org_id, req.message, req.instance_id, system_prompt
            )
            hits = refs
            # If the KB returned no grounding refs but did synthesize an answer,
            # pass that answer as a single knowledge item so the agent can use it.
            if not hits and answer:
                hits = [{"title": "Agentic answer", "content": answer, "source": "agentic"}]
            agentic_used = True
        except Exception as exc:  # pragma: no cover - degrade to standard RAG
            log.warning("agentic retrieve failed for %s; falling back: %s", p.org_id, exc)
    if not agentic_used:
        hits = search.search(p.org_id, req.message, instance_id=req.instance_id, top=5)

    async def event_stream() -> AsyncGenerator[dict, None]:
        yield {"event": "meta", "data": json.dumps({
            "conversation_id": conversation_id,
            "instance_id": req.instance_id,
            "template_id": template["id"],
            "kb_hits": len(hits),
            "agentic": agentic_used,
        })}

        usage_info = {"input": 0, "output": 0, "total": 0}

        # The Foundry SDK call is sync — push it through a thread.
        send_queue: anyio.streams.memory.MemoryObjectSendStream
        recv_queue: anyio.streams.memory.MemoryObjectReceiveStream
        send_queue, recv_queue = anyio.create_memory_object_stream(max_buffer_size=128)

        def _run_sync() -> None:
            try:
                for ev, data in foundry.stream_run(
                    agent_id=agent_id,
                    thread_id=thread_id,
                    user_message=req.message,
                    knowledge=hits,
                    instance_overrides=instance.get("overrides"),
                ):
                    anyio.from_thread.run(send_queue.send, (ev, data))
            finally:
                anyio.from_thread.run(send_queue.aclose)

        async with anyio.create_task_group() as tg:
            tg.start_soon(anyio.to_thread.run_sync, _run_sync)
            async for ev, data in recv_queue:
                if ev == "usage":
                    try:
                        usage_info = json.loads(data)
                    except Exception:
                        pass
                    yield {"event": "usage", "data": data}
                elif ev == "token":
                    yield {"event": "token", "data": data}
                elif ev == "error":
                    yield {"event": "error", "data": data}
                elif ev == "done":
                    yield {"event": "done", "data": ""}

        cosmos.log_metering({
            "id": str(uuid.uuid4()),
            "org_id": p.org_id,
            "instance_id": req.instance_id,
            "template_id": template["id"],
            "ts": datetime.now(timezone.utc).isoformat(),
            "input_tokens": usage_info.get("input", 0),
            "output_tokens": usage_info.get("output", 0),
            "total_tokens": usage_info.get("total", 0),
        })

        # Meter the agentic-retrieval planning/synthesis tokens separately so
        # they don't inflate chat metrics but still show up as their own cost.
        if agentic_used and agentic_tokens:
            cosmos.log_metering({
                "id": str(uuid.uuid4()),
                "org_id": p.org_id,
                "instance_id": req.instance_id,
                "template_id": template["id"],
                "ts": datetime.now(timezone.utc).isoformat(),
                "kind": "agentic",
                "input_tokens": agentic_tokens,
                "output_tokens": 0,
                "total_tokens": agentic_tokens,
                "agentic_tokens": agentic_tokens,
            })

    return EventSourceResponse(event_stream())
