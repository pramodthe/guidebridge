"""MCP adapter: expose a bridge's tools as a Model Context Protocol server.

Any MCP client (Claude Code, Claude Desktop, Cursor, ...) then gets page control
for free. Tools are defined as explicit typed functions so FastMCP derives the
same schemas the other adapters use.

Usage::

    server = bridge.as_mcp_server()
    server.run()                       # stdio, for local MCP clients

    # or mount over HTTP alongside your FastAPI app:
    app.mount("/mcp", server.streamable_http_app())
"""
from __future__ import annotations

from typing import TYPE_CHECKING, Any, Dict, Literal, Optional

if TYPE_CHECKING:  # pragma: no cover
    from ..bridge import AgentBridge


def as_mcp_server(
    bridge: "AgentBridge",
    session_id: Optional[str] = None,
    *,
    name: str = "guidebridge",
):
    try:
        from mcp.server.fastmcp import FastMCP
    except ImportError as e:  # pragma: no cover
        raise ImportError(
            "the mcp package is required for as_mcp_server(): pip install 'guidebridge[mcp]'"
        ) from e

    mcp = FastMCP(
        name,
        instructions=(
            "Tools for observing and controlling the web page the user is currently "
            "looking at, with a visible agent cursor. Call observe_page first to get "
            "target ids, then point/highlight/callout/click/type while you explain."
        ),
    )

    async def call(tool: str, args: Dict[str, Any]) -> str:
        return await bridge.call_tool(tool, args, session_id=session_id)

    @mcp.tool()
    async def observe_page() -> str:
        """Read the live page: targets (ids, labels, values), scroll state, registered app actions, and recent user interactions."""
        return await call("observe_page", {})

    @mcp.tool()
    async def point_at(target_id: str) -> str:
        """Move the visible agent cursor onto an element without acting."""
        return await call("point_at", {"target_id": target_id})

    @mcp.tool()
    async def highlight(target_id: str, ms: Optional[int] = None) -> str:
        """Point the cursor at an element and outline it while you explain it."""
        return await call("highlight", {"target_id": target_id, "ms": ms})

    @mcp.tool()
    async def callout(target_id: str, text: str, ms: Optional[int] = None) -> str:
        """Highlight an element and attach a short text bubble next to it."""
        return await call("callout", {"target_id": target_id, "text": text, "ms": ms})

    @mcp.tool()
    async def click(target_id: str) -> str:
        """Click a button, link, tab, or other control with the visible agent cursor."""
        return await call("click", {"target_id": target_id})

    @mcp.tool()
    async def type_text(target_id: str, value: str) -> str:
        """Move the cursor to an input or textarea and type a value into it."""
        return await call("type_text", {"target_id": target_id, "value": value})

    @mcp.tool()
    async def select_option(target_id: str, value: str) -> str:
        """Choose an option in a select dropdown by value or visible label."""
        return await call("select_option", {"target_id": target_id, "value": value})

    @mcp.tool()
    async def scroll_to(target_id: str) -> str:
        """Scroll an element into view (centered)."""
        return await call("scroll_to", {"target_id": target_id})

    @mcp.tool()
    async def scroll_by(direction: Literal["up", "down"], amount: Literal["page", "half"] = "page") -> str:
        """Scroll the page up or down without a specific target."""
        return await call("scroll_by", {"direction": direction, "amount": amount})

    @mcp.tool()
    async def drag(target_id: str, to_target_id: str) -> str:
        """Drag one element onto another (drag-and-drop) with the visible cursor."""
        return await call("drag", {"target_id": target_id, "to_target_id": to_target_id})

    @mcp.tool()
    async def app_action(action_name: str, args: Optional[Dict[str, Any]] = None) -> str:
        """Invoke a custom action the app registered (listed under customActions in observe_page)."""
        return await call("app_action", {"name": action_name, "args": args or {}})

    return mcp
