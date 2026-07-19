"""GuideBridge demo backend.

Runs the bridge plus two ways to drive the storefront:

  POST /demo/chat  — the real thing: a live LLM agent (Claude, via LangChain) that
                     reads your natural-language request and points/highlights/clicks/
                     types on its own to carry it out. Nothing about which elements it
                     touches is hardcoded. Needs TOKENROUTER_API_KEY (an OpenAI-compatible
                     gateway) or ANTHROPIC_API_KEY, plus:
                       pip install langchain langchain-openai   (or langchain-anthropic)

                     Streams progress as Server-Sent Events using AG-UI-style event
                     names (RUN_STARTED, TOOL_CALL_START/END, TEXT_MESSAGE_CONTENT
                     deltas, RUN_FINISHED/RUN_ERROR) so the UI shows the agent working
                     live instead of a dead spinner. The current page snapshot is
                     pre-loaded into the prompt so the agent can usually skip the
                     observe_page round trip.

  POST /demo/tour  — a scripted fallback: a fixed sequence of tool calls, no model,
                     no API key. Useful to show the cursor mechanics offline, but it
                     is NOT an agent — it does the same 13 steps every time.

Run:  uvicorn main:app --reload --port 8000
"""
from __future__ import annotations

import asyncio
import json
import os

from typing import Any, AsyncIterator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from guidebridge import AgentBridge

app = FastAPI(title="GuideBridge demo")
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1):\d+",
    allow_methods=["*"],
    allow_headers=["*"],
)

bridge = AgentBridge()
app.include_router(bridge.router)


@app.get("/health")
async def health() -> dict:
    return {"ok": True, "sessions": bridge.sessions()}


TOUR = [
    ("callout", {"target_id": "hero", "text": "Welcome! Let me show you around the store.", "ms": 3500}),
    ("scroll_to", {"target_id": "products"}),
    ("highlight", {"target_id": "product-monstera", "ms": 2500}),
    ("callout", {"target_id": "product-monstera", "text": "This one is our best seller.", "ms": 3000}),
    ("click", {"target_id": "add-monstera"}),
    ("scroll_to", {"target_id": "contact"}),
    ("callout", {"target_id": "contact", "text": "I'll fill this in as an example.", "ms": 3000}),
    ("type_text", {"target_id": "contact-name", "value": "Ada Lovelace"}),
    ("type_text", {"target_id": "contact-email", "value": "ada@example.com"}),
    ("select_option", {"target_id": "contact-plant", "value": "Monstera"}),
    ("type_text", {"target_id": "contact-message", "value": "Do you ship to Kathmandu?"}),
    ("point_at", {"target_id": "contact-send"}),
    ("callout", {"target_id": "contact-send", "text": "I'll leave sending to you :)", "ms": 4000}),
]


async def run_tour() -> None:
    for name, args in TOUR:
        await bridge.call_tool(name, args)
        await asyncio.sleep(1.4)


@app.post("/demo/tour")
async def demo_tour() -> dict:
    if bridge.get_session() is None:
        return {"started": False, "error": "no browser session connected"}
    asyncio.get_running_loop().create_task(run_tour())
    return {"started": True, "steps": len(TOUR)}


class ChatIn(BaseModel):
    message: str


SYSTEM = (
    "You are a friendly on-page guide for a plant storefront the user is currently "
    "looking at. You can see and control the real page with your tools. "
    "A snapshot of the current page (target ids, labels, values) is given below — use it "
    "directly; only call observe_page again if you changed the page and need fresh state. "
    "Carry out the user's request by calling the page tools yourself — point_at / highlight "
    "/ callout to draw attention, scroll_to to bring things into view, click to press "
    "buttons, type_text and select_option to fill the contact form. "
    "Narrate briefly as you go. When you are done, reply with one or two short sentences "
    "describing what you did. Never claim you did something the tool result didn't confirm."
)


def _build_llm():
    """Prefer a TokenRouter-proxied model (an OpenAI-compatible gateway, so no vendor
    SDK needed); fall back to calling Anthropic directly. Neither is required by the
    GuideBridge SDK itself — only by this demo's live agent."""
    token_router_key = os.environ.get("TOKENROUTER_API_KEY")
    if token_router_key:
        from langchain_openai import ChatOpenAI

        return ChatOpenAI(
            model=os.environ.get("TOKENROUTER_MODEL", "anthropic/claude-sonnet-5"),
            api_key=token_router_key,
            base_url=os.environ.get("TOKENROUTER_BASE_URL", "https://api.tokenrouter.com/v1"),
            max_tokens=1200,
            streaming=True,
        )
    if os.environ.get("ANTHROPIC_API_KEY"):
        from langchain_anthropic import ChatAnthropic

        return ChatAnthropic(model="claude-sonnet-5", max_tokens=1200, streaming=True)
    return None


def _sse(event: dict) -> str:
    """One Server-Sent Event frame."""
    return f"data: {json.dumps(event)}\n\n"


def _chunk_text(chunk: Any) -> str:
    """Pull streamed text out of a model chunk (string content, or Anthropic-style
    content blocks). Tool-call chunks have no text and yield ''."""
    content = getattr(chunk, "content", None)
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for block in content:
            if isinstance(block, dict) and block.get("type") == "text":
                parts.append(block.get("text", ""))
            elif isinstance(block, str):
                parts.append(block)
        return "".join(parts)
    return ""


async def _chat_events(message: str) -> AsyncIterator[str]:
    """Run the agent and stream AG-UI-style events as SSE."""
    if bridge.get_session() is None:
        yield _sse({"type": "RUN_ERROR", "message": "no browser session connected — open the storefront first"})
        return
    try:
        from langchain.agents import create_agent
    except ImportError:
        yield _sse({"type": "RUN_ERROR", "message": "pip install langchain langchain-openai (or langchain-anthropic)"})
        return
    llm = _build_llm()
    if llm is None:
        yield _sse({"type": "RUN_ERROR", "message": "set TOKENROUTER_API_KEY or ANTHROPIC_API_KEY to use the live agent"})
        return

    # Pre-load the page snapshot: one cheap bridge round trip (no model call) so the
    # agent can usually skip the observe_page step — cuts one full model hop.
    system = SYSTEM
    try:
        snapshot = await bridge.call_tool("observe_page", {})
        system = f"{SYSTEM}\n\nCURRENT PAGE SNAPSHOT (JSON):\n{snapshot}"
    except Exception:
        pass

    agent = create_agent(llm, tools=bridge.as_langchain_tools(), system_prompt=system)

    yield _sse({"type": "RUN_STARTED"})
    final_parts: list[str] = []
    try:
        async for ev in agent.astream_events(
            {"messages": [{"role": "user", "content": message}]}, version="v2"
        ):
            etype = ev.get("event")
            if etype == "on_tool_start":
                yield _sse({
                    "type": "TOOL_CALL_START",
                    "toolCallName": ev.get("name"),
                    "args": ev.get("data", {}).get("input"),
                })
            elif etype == "on_tool_end":
                yield _sse({"type": "TOOL_CALL_END", "toolCallName": ev.get("name")})
            elif etype == "on_chat_model_stream":
                text = _chunk_text(ev.get("data", {}).get("chunk"))
                if text:
                    final_parts.append(text)
                    yield _sse({"type": "TEXT_MESSAGE_CONTENT", "delta": text})
    except Exception as exc:  # surface the failure into the stream, don't hang the UI
        yield _sse({"type": "RUN_ERROR", "message": str(exc)})
        return
    yield _sse({"type": "RUN_FINISHED", "text": "".join(final_parts)})


@app.post("/demo/chat")
async def demo_chat(body: ChatIn) -> StreamingResponse:
    return StreamingResponse(
        _chat_events(body.message),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
