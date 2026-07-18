"""OpenAI-style adapter: function specs plus an async dispatcher.

Works with the OpenAI SDK, Anthropic tool use, Google ADK function tools, or any
framework that consumes JSON-schema function specs and lets you run the call.
"""
from __future__ import annotations

import json
from typing import TYPE_CHECKING, Any, Dict, List, Optional, Union

from ..tools import openai_tool_specs

if TYPE_CHECKING:  # pragma: no cover
    from ..bridge import AgentBridge


class OpenAIToolset:
    def __init__(self, bridge: "AgentBridge", session_id: Optional[str] = None) -> None:
        self._bridge = bridge
        self._session_id = session_id
        self.specs: List[Dict[str, Any]] = openai_tool_specs()

    @property
    def names(self) -> List[str]:
        return [s["function"]["name"] for s in self.specs]

    async def call(self, name: str, arguments: Union[str, Dict[str, Any], None]) -> str:
        if isinstance(arguments, str):
            try:
                args: Dict[str, Any] = json.loads(arguments or "{}")
            except ValueError:
                args = {}
        else:
            args = arguments or {}
        return await self._bridge.call_tool(name, args, session_id=self._session_id)
