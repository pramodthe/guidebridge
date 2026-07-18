"""One connected browser session: request/response routing over its WebSocket."""
from __future__ import annotations

import asyncio
import json
import logging
import uuid
from typing import Any, Awaitable, Callable, Dict, Optional

from . import protocol

logger = logging.getLogger(__name__)

SendFrame = Callable[[Dict[str, Any]], Awaitable[None]]

UNAVAILABLE = (
    "The page did not respond. The user's browser tab may be closed or still loading; "
    "continue without the page action and tell the user if it matters."
)


class BridgeSession:
    """Awaitable observe/act router bound to one connected browser tab."""

    def __init__(
        self,
        session_id: str,
        send_frame: SendFrame,
        *,
        timeout_s: float = 10.0,
        page: Optional[Dict[str, Any]] = None,
    ) -> None:
        self.session_id = session_id
        self.page = page or {}
        self._send_frame = send_frame
        self._timeout_s = timeout_s
        self._pending: Dict[str, asyncio.Future[Dict[str, Any]]] = {}
        self.closed = False

    # -- inbound (called by the transport when the browser replies) --

    def handle_frame(self, frame: Dict[str, Any]) -> bool:
        """Resolve a pending observe/action future. Returns True if consumed."""
        request_id = frame.get("requestId")
        if not request_id:
            return False
        fut = self._pending.get(request_id)
        if fut is None or fut.done():
            return False
        payload = frame.get("payload")
        if isinstance(payload, str):
            try:
                payload = json.loads(payload)
            except ValueError:
                payload = {"raw": payload}
        fut.set_result(payload if isinstance(payload, dict) else {"raw": payload})
        return True

    # -- outbound (called by tools) --

    async def _round_trip(self, frame: Dict[str, Any], request_id: str) -> Optional[Dict[str, Any]]:
        fut: asyncio.Future[Dict[str, Any]] = asyncio.get_running_loop().create_future()
        self._pending[request_id] = fut
        try:
            await self._send_frame(frame)
            return await asyncio.wait_for(fut, timeout=self._timeout_s)
        except asyncio.TimeoutError:
            return None
        except Exception:
            logger.exception("guidebridge: round trip failed (session=%s)", self.session_id)
            return None
        finally:
            self._pending.pop(request_id, None)

    async def observe(self) -> Optional[Dict[str, Any]]:
        request_id = f"gb_{uuid.uuid4().hex[:10]}"
        return await self._round_trip(protocol.observe_request(request_id), request_id)

    async def act(self, action: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        request_id = f"gb_{uuid.uuid4().hex[:10]}"
        return await self._round_trip(protocol.action_request(request_id, action), request_id)

    def close(self) -> None:
        self.closed = True
        for fut in self._pending.values():
            if not fut.done():
                fut.cancel()
        self._pending.clear()
