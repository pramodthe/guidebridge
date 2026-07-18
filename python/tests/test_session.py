import asyncio
import json

import pytest

from guidebridge.session import UNAVAILABLE, BridgeSession
from guidebridge import tools


class FakeWire:
    """Captures outbound frames and lets tests script the browser's replies."""

    def __init__(self):
        self.sent = []
        self.session = None
        self.auto_reply = None  # callable(frame) -> payload dict or None (stay silent)

    async def send(self, frame):
        self.sent.append(frame)
        if self.auto_reply is not None:
            payload = self.auto_reply(frame)
            if payload is not None:
                result_type = (
                    "observe.result" if frame["type"] == "observe.request" else "action.result"
                )
                self.session.handle_frame(
                    {"type": result_type, "requestId": frame["requestId"], "payload": payload}
                )


def make_session(auto_reply=None, timeout_s=0.2):
    wire = FakeWire()
    wire.auto_reply = auto_reply
    session = BridgeSession("default", wire.send, timeout_s=timeout_s)
    wire.session = session
    return session, wire


async def test_observe_round_trip():
    snapshot = {"title": "Demo", "targets": []}
    session, wire = make_session(lambda f: snapshot)
    result = await session.observe()
    assert result == snapshot
    assert wire.sent[0]["type"] == "observe.request"


async def test_action_round_trip_and_frame_shape():
    session, wire = make_session(lambda f: {"success": True})
    result = await session.act({"type": "click", "targetId": "checkout"})
    assert result == {"success": True}
    frame = wire.sent[0]
    assert frame["type"] == "action.request"
    assert frame["action"] == {"type": "click", "targetId": "checkout"}


async def test_timeout_returns_none():
    session, _ = make_session(auto_reply=None, timeout_s=0.05)
    assert await session.act({"type": "click", "targetId": "x"}) is None


async def test_stale_request_id_ignored():
    session, _ = make_session()
    assert session.handle_frame({"type": "action.result", "requestId": "nope", "payload": {}}) is False


async def test_dispatch_validates_and_maps_args():
    session, wire = make_session(lambda f: {"success": True})
    out = await tools.dispatch(session, "type_text", {"target_id": "email", "value": "hi@x.dev"})
    assert json.loads(out) == {"success": True}
    assert wire.sent[0]["action"] == {"type": "type", "targetId": "email", "value": "hi@x.dev"}


async def test_dispatch_unavailable_when_no_reply():
    session, _ = make_session(auto_reply=None, timeout_s=0.05)
    out = await tools.dispatch(session, "click", {"target_id": "x"})
    assert out == UNAVAILABLE


async def test_dispatch_unknown_tool():
    session, _ = make_session()
    with pytest.raises(KeyError):
        await tools.dispatch(session, "explode", {})


def test_openai_specs_cover_all_tools():
    specs = tools.openai_tool_specs()
    names = {s["function"]["name"] for s in specs}
    assert "observe_page" in names and "drag" in names and "app_action" in names
    assert len(specs) == len(tools.TOOL_DEFS)
