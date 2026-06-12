"""SSE chat endpoint: resolves org_id from the JWT, runs the customer's
instance against its template's Foundry agent, streams tokens back.
"""
from __future__ import annotations

import json
import uuid
from typing import AsyncGenerator

import anyio
from fastapi import APIRouter, Depends, HTTPException
from sse_starlette.sse import EventSourceResponse

from ..models import ChatRequest
from ..security import Principal, get_principal
from ..services import cosmos, foundry, search

router = APIRouter(prefix="/v1", tags=["chat"])


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

    # Retrieve this instance's private knowledge (top 5 hits).
    hits = search.search(p.org_id, req.message, instance_id=req.instance_id, top=5)

    async def event_stream() -> AsyncGenerator[dict, None]:
        yield {"event": "meta", "data": json.dumps({
            "conversation_id": conversation_id,
            "instance_id": req.instance_id,
            "template_id": template["id"],
            "kb_hits": len(hits),
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
            "input_tokens": usage_info.get("input", 0),
            "output_tokens": usage_info.get("output", 0),
            "total_tokens": usage_info.get("total", 0),
        })

    return EventSourceResponse(event_stream())
