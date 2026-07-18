"""GuideBridge demo backend.

Runs the bridge plus two demo drivers:
  POST /demo/tour  — scripted guided tour of the storefront (no LLM key needed)
  POST /demo/chat  — real LLM agent with guidebridge tools (needs ANTHROPIC_API_KEY
                     and `pip install langchain-anthropic langchain`)

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
    "You are a friendly on-page guide for a plant storefront the user is currently looking at. "
    "You can see and control the page with your tools. Always call observe_page first, then use "
    "point_at/highlight/callout/click/type_text/select_option/scroll while you explain what you "
    "are doing. Keep spoken replies to one or two sentences."
)


@app.post("/demo/chat")
async def demo_chat(body: ChatIn) -> dict:
    if not os.environ.get("ANTHROPIC_API_KEY"):
        return {"error": "set ANTHROPIC_API_KEY and install langchain-anthropic to use chat"}
    try:
        from langchain.agents import create_agent
        from langchain_anthropic import ChatAnthropic
    except ImportError:
        return {"error": "pip install langchain langchain-anthropic"}

    agent = create_agent(
        ChatAnthropic(model="claude-sonnet-5", max_tokens=1200),
        tools=bridge.as_langchain_tools(),
        system_prompt=SYSTEM,
    )
    result = await agent.ainvoke({"messages": [{"role": "user", "content": body.message}]})
    reply = result["messages"][-1].content
    if not isinstance(reply, str):
        reply = json.dumps(reply)
    return {"reply": reply}
