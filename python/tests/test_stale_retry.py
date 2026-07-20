"""call_tool retries once with a fuzzy-matched target after 'target not found'."""
import json

from guidebridge import AgentBridge
from guidebridge.session import BridgeSession

FRESH_SNAPSHOT = {
    "url": "/lesson",
    "title": "t",
    "scrollY": 0,
    "scrollHeight": 100,
    "viewportHeight": 50,
    "targets": [
        {"id": "gb-ctl-12", "slug": "reset-sim", "label": "Reset simulation", "role": "button", "visible": True}
    ],
    "customActions": [],
    "recentEvents": [],
}


class ScriptedWire:
    """Replies: action->not-found, observe->fresh snapshot, action->success."""

    def __init__(self):
        self.session = None
        self.frames = []

    async def send(self, frame):
        self.frames.append(frame)
        rid = frame["requestId"]
        if frame["type"] == "observe.request":
            self.session.handle_frame(
                {"type": "observe.result", "requestId": rid, "payload": FRESH_SNAPSHOT}
            )
        elif frame["type"] == "action.request":
            target = frame["action"].get("targetId")
            if target == "gb-ctl-12":
                payload = {"success": True, "clicked": target}
            else:
                payload = {"success": False, "error": f"target not found: {target}"}
            self.session.handle_frame(
                {"type": "action.result", "requestId": rid, "payload": payload}
            )


def make_bridge_with_session():
    bridge = AgentBridge()
    wire = ScriptedWire()
    session = BridgeSession("default", wire.send, timeout_s=0.5)
    wire.session = session
    bridge._register(session)
    return bridge, wire


async def test_retry_recovers_stale_id_via_slug():
    bridge, wire = make_bridge_with_session()
    result = json.loads(await bridge.call_tool("click", {"target_id": "reset-sim"}))
    # "reset-sim" is a slug, not a live DOM id -> first attempt fails,
    # re-observe + match resolves it to gb-ctl-12, retry succeeds.
    assert result == {"success": True, "clicked": "gb-ctl-12"}
    types = [f["type"] for f in wire.frames]
    assert types == ["action.request", "observe.request", "action.request"]


async def test_retry_recovers_via_label_tokens():
    bridge, _ = make_bridge_with_session()
    result = json.loads(await bridge.call_tool("click", {"target_id": "reset simulation button"}))
    assert result["success"] is True


async def test_no_retry_when_nothing_matches():
    bridge, wire = make_bridge_with_session()
    result = json.loads(await bridge.call_tool("click", {"target_id": "zzz-qqq"}))
    assert result["success"] is False
    # observe happened, but no better id was found, so no second action
    types = [f["type"] for f in wire.frames]
    assert types == ["action.request", "observe.request"]


async def test_no_retry_for_non_target_errors():
    bridge, wire = make_bridge_with_session()

    async def send(frame):
        wire.frames.append(frame)
        wire.session.handle_frame(
            {
                "type": "action.result",
                "requestId": frame["requestId"],
                "payload": {"success": False, "error": "target has no value"},
            }
        )

    wire.session._send_frame = send
    result = json.loads(await bridge.call_tool("type_text", {"target_id": "x", "value": "v"}))
    assert result["success"] is False
    assert len(wire.frames) == 1
