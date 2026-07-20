"""authorize returning a string binds the allowed sessionId (D8 identity binding)."""
import asyncio
import contextlib
import json
import socket

import pytest
import uvicorn
import websockets
from fastapi import FastAPI

from guidebridge import AgentBridge


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


async def authorize(ws) -> object:
    # Derive identity from credentials (here: a query param standing in for a JWT).
    token = ws.query_params.get("access_token")
    if token != "good-token":
        return False
    return "user1:lesson1"  # the ONLY sessionId this connection may claim


@pytest.fixture
async def server():
    bridge = AgentBridge(authorize=authorize)
    app = FastAPI()
    app.include_router(bridge.router)
    port = free_port()
    srv = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning"))
    task = asyncio.create_task(srv.serve())
    while not srv.started:
        await asyncio.sleep(0.02)
    yield bridge, f"ws://127.0.0.1:{port}/agent/ws"
    srv.should_exit = True
    with contextlib.suppress(Exception):
        await asyncio.wait_for(task, timeout=5)


def hello(session_id: str) -> str:
    return json.dumps(
        {"type": "hello", "version": "1", "sessionId": session_id, "page": {}}
    )


async def test_bad_token_rejected(server):
    _, url = server
    with pytest.raises(Exception):
        async with websockets.connect(f"{url}?access_token=bad") as ws:
            await ws.send(hello("user1:lesson1"))
            await asyncio.wait_for(ws.recv(), timeout=2)


async def test_mismatched_session_id_rejected(server):
    bridge, url = server
    async with websockets.connect(f"{url}?access_token=good-token") as ws:
        await ws.send(hello("attacker:lesson9"))
        with pytest.raises(websockets.exceptions.ConnectionClosed):
            await asyncio.wait_for(ws.recv(), timeout=3)
    assert "attacker:lesson9" not in bridge.sessions()


async def test_matching_session_id_accepted(server):
    bridge, url = server
    async with websockets.connect(f"{url}?access_token=good-token") as ws:
        await ws.send(hello("user1:lesson1"))
        for _ in range(40):
            if "user1:lesson1" in bridge.sessions():
                break
            await asyncio.sleep(0.05)
        assert "user1:lesson1" in bridge.sessions()
