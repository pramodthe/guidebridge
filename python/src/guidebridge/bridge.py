"""AgentBridge: FastAPI-mountable WebSocket endpoint + session manager + tool factories."""
from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, Awaitable, Callable, Dict, List, Optional

from . import protocol, tools
from .session import UNAVAILABLE, BridgeSession

try:
    # Module-level so the deferred "WebSocket" annotation (PEP 563) resolves from
    # module globals when FastAPI inspects the endpoint signature.
    from fastapi import APIRouter, WebSocket, WebSocketDisconnect
except ImportError:  # pragma: no cover
    APIRouter = WebSocket = WebSocketDisconnect = None  # type: ignore[assignment]

logger = logging.getLogger(__name__)

Authorizer = Callable[[Any], Awaitable[bool]]


class AgentBridge:
    """Connects browser tabs (via WebSocket) to agent tools.

    Usage::

        bridge = AgentBridge()
        app.include_router(bridge.router)
        agent_tools = bridge.as_langchain_tools()
    """

    def __init__(
        self,
        path: str = "/agent/ws",
        *,
        timeout_s: float = 10.0,
        authorize: Optional[Authorizer] = None,
    ) -> None:
        self.path = path
        self.timeout_s = timeout_s
        self.authorize = authorize
        self._sessions: Dict[str, BridgeSession] = {}
        self._session_waiters: List[asyncio.Future[BridgeSession]] = []
        self._router = None

    # ---- session registry ----

    def get_session(self, session_id: Optional[str] = None) -> Optional[BridgeSession]:
        """A specific session, or the only/most recent one when session_id is None."""
        if session_id is not None:
            return self._sessions.get(session_id)
        if not self._sessions:
            return None
        return next(reversed(self._sessions.values()))

    def sessions(self) -> List[str]:
        return list(self._sessions)

    async def wait_for_session(
        self, session_id: Optional[str] = None, timeout_s: float = 30.0
    ) -> BridgeSession:
        existing = self.get_session(session_id)
        if existing is not None:
            return existing
        fut: asyncio.Future[BridgeSession] = asyncio.get_running_loop().create_future()
        self._session_waiters.append(fut)
        try:
            while True:
                session = await asyncio.wait_for(fut, timeout=timeout_s)
                if session_id is None or session.session_id == session_id:
                    return session
                fut = asyncio.get_running_loop().create_future()
                self._session_waiters.append(fut)
        finally:
            if fut in self._session_waiters:
                self._session_waiters.remove(fut)

    def _register(self, session: BridgeSession) -> None:
        old = self._sessions.pop(session.session_id, None)
        if old is not None:
            old.close()
        self._sessions[session.session_id] = session
        waiters, self._session_waiters = self._session_waiters, []
        for fut in waiters:
            if not fut.done():
                fut.set_result(session)

    def _unregister(self, session: BridgeSession) -> None:
        session.close()
        if self._sessions.get(session.session_id) is session:
            del self._sessions[session.session_id]

    # ---- tool surface ----

    async def call_tool(
        self, name: str, args: Dict[str, Any], session_id: Optional[str] = None
    ) -> str:
        session = self.get_session(session_id)
        if session is None:
            return UNAVAILABLE
        return await tools.dispatch(session, name, args)

    def openai_tool_specs(self) -> List[Dict[str, Any]]:
        return tools.openai_tool_specs()

    def as_langchain_tools(self, session_id: Optional[str] = None):
        from .adapters.langchain import as_langchain_tools

        return as_langchain_tools(self, session_id=session_id)

    def as_openai_tools(self, session_id: Optional[str] = None):
        from .adapters.openai import OpenAIToolset

        return OpenAIToolset(self, session_id=session_id)

    def as_mcp_server(self, session_id: Optional[str] = None, *, name: str = "guidebridge"):
        from .adapters.mcp import as_mcp_server

        return as_mcp_server(self, session_id=session_id, name=name)

    # ---- FastAPI integration ----

    @property
    def router(self):
        if self._router is None:
            self._router = self._build_router()
        return self._router

    def _build_router(self):
        if APIRouter is None:
            raise ImportError(
                "fastapi is required for AgentBridge.router: pip install 'guidebridge[fastapi]'"
            )
        router = APIRouter()

        @router.websocket(self.path)
        async def agent_ws(ws: WebSocket) -> None:  # pragma: no cover - exercised in demo/tests
            if self.authorize is not None and not await self.authorize(ws):
                await ws.close(code=4403)
                return
            await ws.accept()

            try:
                hello_raw = await ws.receive_text()
                hello = protocol.ClientHello.model_validate_json(hello_raw)
            except Exception:
                await ws.close(code=4400)
                return

            send_lock = asyncio.Lock()

            async def send_frame(frame: Dict[str, Any]) -> None:
                async with send_lock:
                    await ws.send_text(protocol.encode(frame))

            session = BridgeSession(
                hello.sessionId, send_frame, timeout_s=self.timeout_s, page=hello.page
            )
            self._register(session)
            logger.info("guidebridge: session connected id=%s", session.session_id)

            try:
                while True:
                    raw = await ws.receive_text()
                    try:
                        frame = json.loads(raw)
                    except ValueError:
                        continue
                    if not isinstance(frame, dict):
                        continue
                    ftype = frame.get("type")
                    if ftype in ("observe.result", "action.result"):
                        session.handle_frame(frame)
                    # "event" frames are informational; snapshots carry recent events.
            except WebSocketDisconnect:
                pass
            finally:
                self._unregister(session)
                logger.info("guidebridge: session disconnected id=%s", session.session_id)

        return router
