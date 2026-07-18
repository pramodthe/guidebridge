import json

import pytest

pytest.importorskip("mcp")

from guidebridge import AgentBridge
from guidebridge.tools import TOOL_DEFS


async def test_mcp_server_exposes_all_tools():
    bridge = AgentBridge()
    server = bridge.as_mcp_server()
    listed = {t.name for t in await server.list_tools()}
    expected = {t.name for t in TOOL_DEFS}
    # app_action's kwarg is renamed action_name in MCP to avoid shadowing; same tool set.
    assert listed == expected


async def test_mcp_tool_call_without_session_returns_sentinel():
    bridge = AgentBridge()
    server = bridge.as_mcp_server()
    result = await server.call_tool("click", {"target_id": "checkout"})
    text = result[0][0].text if isinstance(result, tuple) else result[0].text
    assert "did not respond" in text or "browser" in text
