"""LangChain adapter: wrap guidebridge tools as StructuredTools."""
from __future__ import annotations

from functools import partial
from typing import TYPE_CHECKING, List, Optional

from ..tools import TOOL_DEFS

if TYPE_CHECKING:  # pragma: no cover
    from ..bridge import AgentBridge


def as_langchain_tools(bridge: "AgentBridge", session_id: Optional[str] = None) -> List:
    try:
        from langchain_core.tools import StructuredTool
    except ImportError as e:  # pragma: no cover
        raise ImportError(
            "langchain-core is required for as_langchain_tools(): pip install langchain-core"
        ) from e

    lc_tools = []
    for tool_def in TOOL_DEFS:

        async def run(_name: str = tool_def.name, **kwargs) -> str:
            return await bridge.call_tool(_name, kwargs, session_id=session_id)

        lc_tools.append(
            StructuredTool.from_function(
                coroutine=partial(run, tool_def.name),
                name=tool_def.name,
                description=tool_def.description,
                args_schema=tool_def.args_model,
            )
        )
    return lc_tools
