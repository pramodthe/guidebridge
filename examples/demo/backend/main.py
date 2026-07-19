"""GuideBridge demo backend.

Runs the bridge plus two ways to drive the storefront:

  POST /demo/chat  — the real thing: a live LLM agent (Claude, via LangChain) that
                     reads your natural-language request, calls observe_page to see
                     the store, then points/highlights/clicks/types on its own to
                     carry it out. Nothing about which elements it touches is
                     hardcoded. Needs TOKENROUTER_API_KEY (an OpenAI-compatible
                     gateway) or ANTHROPIC_API_KEY, plus:
                       pip install langchain langchain-openai   (or langchain-anthropic)

  POST /demo/tour  — a scripted fallback: a fixed sequence of tool calls, no model,
                     no API key. Useful to show the cursor mechanics offline, but it
                     is NOT an agent — it does the same 13 steps every time.

Run:  uvicorn main:app --reload --port 8000
"""
from __future__ import annotations

import asyncio
import json
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
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
    "ALWAYS call observe_page first to learn the current target ids, values, and what "
    "is on screen. Then carry out the user's request by calling the page tools yourself "
    "— point_at / highlight / callout to draw attention, scroll_to to bring things into "
    "view, click to press buttons, type_text and select_option to fill the contact form. "
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
        )
    if os.environ.get("ANTHROPIC_API_KEY"):
        from langchain_anthropic import ChatAnthropic

        return ChatAnthropic(model="claude-sonnet-5", max_tokens=1200)
    return None


@app.post("/demo/chat")
async def demo_chat(body: ChatIn) -> dict:
    if bridge.get_session() is None:
        return {"error": "no browser session connected — open the storefront first"}
    try:
        from langchain.agents import create_agent
    except ImportError:
        return {"error": "pip install langchain langchain-openai (or langchain-anthropic)"}

    llm = _build_llm()
    if llm is None:
        return {"error": "set TOKENROUTER_API_KEY or ANTHROPIC_API_KEY to use the live agent"}

    agent = create_agent(
        llm,
        tools=bridge.as_langchain_tools(),
        system_prompt=SYSTEM,
    )
    result = await agent.ainvoke({"messages": [{"role": "user", "content": body.message}]})
    reply = result["messages"][-1].content
    if not isinstance(reply, str):
        reply = json.dumps(reply)
    return {"reply": reply}
