"""End-to-end: real FastAPI app + uvicorn + a fake browser over a real WebSocket."""
import asyncio
import contextlib
import json
import socket

import pytest
import uvicorn
import websockets
from fastapi import FastAPI

from guidebridge import AgentBridge

SNAPSHOT = {
    "url": "http://demo/",
    "title": "Demo",
    "scrollY": 0,
    "scrollHeight": 2000,
    "viewportHeight": 800,
    "targets": [{"id": "checkout", "role": "button", "label": "Buy now", "visible": True}],
    "customActions": [],
    "recentEvents": [],
}


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


async def fake_browser(url: str, stop: asyncio.Event):
    """Connects like the React SDK: sends hello, answers observe/action requests."""
    async with websockets.connect(url) as ws:
        await ws.send(
            json.dumps(
                {
                    "type": "hello",
                    "version": "1",
                    "sessionId": "default",
                    "page": {"url": "http://demo/", "title": "Demo"},
                }
            )
        )
        while not stop.is_set():
            try:
                raw = await asyncio.wait_for(ws.recv(), timeout=0.1)
            except asyncio.TimeoutError:
                continue
            frame = json.loads(raw)
            if frame["type"] == "observe.request":
                await ws.send(
                    json.dumps(
                        {
                            "type": "observe.result",
                            "requestId": frame["requestId"],
                            "payload": SNAPSHOT,
                        }
                    )
                )
            elif frame["type"] == "action.request":
                await ws.send(
                    json.dumps(
                        {
                            "type": "action.result",
                            "requestId": frame["requestId"],
                            "payload": {"success": True, "echo": frame["action"]},
                        }
                    )
                )


@pytest.fixture
async def running_bridge():
    bridge = AgentBridge()
    app = FastAPI()
    app.include_router(bridge.router)
    port = free_port()
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning"))
    server_task = asyncio.create_task(server.serve())
    while not server.started:
        await asyncio.sleep(0.02)

    stop = asyncio.Event()
    browser_task = asyncio.create_task(fake_browser(f"ws://127.0.0.1:{port}/agent/ws", stop))
    await bridge.wait_for_session(timeout_s=5)

    yield bridge

    stop.set()
    with contextlib.suppress(Exception):
        await asyncio.wait_for(browser_task, timeout=2)
    server.should_exit = True
    with contextlib.suppress(Exception):
        await asyncio.wait_for(server_task, timeout=5)


async def test_observe_and_click_over_real_socket(running_bridge):
    bridge = running_bridge
    observed = json.loads(await bridge.call_tool("observe_page", {}))
    assert observed["targets"][0]["id"] == "checkout"

    clicked = json.loads(await bridge.call_tool("click", {"target_id": "checkout"}))
    assert clicked["success"] is True
    assert clicked["echo"] == {"type": "click", "targetId": "checkout"}


async def test_openai_toolset_over_real_socket(running_bridge):
    toolset = running_bridge.as_openai_tools()
    assert "observe_page" in toolset.names
    result = json.loads(await toolset.call("type_text", '{"target_id": "email", "value": "a@b.c"}'))
    assert result["echo"] == {"type": "type", "targetId": "email", "value": "a@b.c"}


async def test_langchain_tools_over_real_socket(running_bridge):
    lc_tools = running_bridge.as_langchain_tools()
    by_name = {t.name: t for t in lc_tools}
    result = json.loads(await by_name["highlight"].ainvoke({"target_id": "checkout"}))
    assert result["echo"]["type"] == "highlight"
