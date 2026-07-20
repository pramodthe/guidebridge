"""guidebridge: give any Python agent eyes and hands inside a React app."""
from .bridge import AgentBridge
from .matching import match_snapshot_target
from .session import BridgeSession, UNAVAILABLE
from .tools import TOOL_DEFS, dispatch, openai_tool_specs
from .protocol import PROTOCOL_VERSION

__all__ = [
    "AgentBridge",
    "BridgeSession",
    "UNAVAILABLE",
    "TOOL_DEFS",
    "dispatch",
    "match_snapshot_target",
    "openai_tool_specs",
    "PROTOCOL_VERSION",
]

__version__ = "0.2.0"
