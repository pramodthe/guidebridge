"""Framework-agnostic tool definitions over a BridgeSession.

Each tool is (name, description, args model, session coroutine). Adapters
(langchain, openai, ...) wrap this one list, so every framework exposes the
same behavior.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Awaitable, Callable, Dict, List, Optional, Type

from pydantic import BaseModel

from . import protocol
from .session import UNAVAILABLE, BridgeSession


@dataclass(frozen=True)
class ToolDef:
    name: str
    description: str
    args_model: Type[BaseModel]
    run: Callable[[BridgeSession, Dict[str, Any]], Awaitable[str]]


def _dump(result: Optional[Dict[str, Any]]) -> str:
    return UNAVAILABLE if result is None else json.dumps(result)


async def _observe(session: BridgeSession, _args: Dict[str, Any]) -> str:
    return _dump(await session.observe())


def _action(action_type: str, keymap: Dict[str, str]):
    async def run(session: BridgeSession, args: Dict[str, Any]) -> str:
        action: Dict[str, Any] = {"type": action_type}
        for arg_key, wire_key in keymap.items():
            if args.get(arg_key) is not None:
                action[wire_key] = args[arg_key]
        return _dump(await session.act(action))

    return run


async def _app_action(session: BridgeSession, args: Dict[str, Any]) -> str:
    action = {"type": "custom", "name": args.get("name"), "args": args.get("args") or {}}
    return _dump(await session.act(action))


_TARGET = {"target_id": "targetId"}

TOOL_DEFS: List[ToolDef] = [
    ToolDef(
        "observe_page",
        "Read the live page the user is looking at: interactive targets (with ids, labels, "
        "current values), scroll position, registered app actions, and the user's recent "
        "interactions. Call this before acting, and again after the page changes.",
        protocol.ObserveArgs,
        _observe,
    ),
    ToolDef(
        "point_at",
        "Move the visible agent cursor onto an element without acting, to direct the user's "
        "attention while you explain.",
        protocol.TargetArgs,
        _action("point", _TARGET),
    ),
    ToolDef(
        "highlight",
        "Point the cursor at an element and outline it while you explain it.",
        protocol.HighlightArgs,
        _action("highlight", {**_TARGET, "ms": "ms"}),
    ),
    ToolDef(
        "callout",
        "Highlight an element and attach a short text bubble next to it (guided-tour style).",
        protocol.CalloutArgs,
        _action("callout", {**_TARGET, "text": "text", "ms": "ms"}),
    ),
    ToolDef(
        "click",
        "Click a button, link, tab, or other control with the visible agent cursor.",
        protocol.TargetArgs,
        _action("click", _TARGET),
    ),
    ToolDef(
        "type_text",
        "Move the cursor to an input or textarea and type a value into it.",
        protocol.TypeArgs,
        _action("type", {**_TARGET, "value": "value"}),
    ),
    ToolDef(
        "select_option",
        "Choose an option in a <select> dropdown by value or visible label.",
        protocol.SelectArgs,
        _action("select_option", {**_TARGET, "value": "value"}),
    ),
    ToolDef(
        "scroll_to",
        "Scroll an element into view (centered).",
        protocol.TargetArgs,
        _action("scroll_to", _TARGET),
    ),
    ToolDef(
        "scroll_by",
        "Scroll the page up or down without a specific target.",
        protocol.ScrollByArgs,
        _action("scroll_by", {"direction": "direction", "amount": "amount"}),
    ),
    ToolDef(
        "drag",
        "Drag one element onto another (drag-and-drop) with the visible cursor.",
        protocol.DragArgs,
        _action("drag", {"target_id": "targetId", "to_target_id": "toTargetId"}),
    ),
    ToolDef(
        "app_action",
        "Invoke a custom action the app registered (listed under customActions in "
        "observe_page), e.g. navigation. Pass its name and arguments.",
        protocol.AppActionArgs,
        _app_action,
    ),
]


def openai_tool_specs() -> List[Dict[str, Any]]:
    """OpenAI/Anthropic-style function specs for TOOL_DEFS."""
    return [
        {
            "type": "function",
            "function": {
                "name": t.name,
                "description": t.description,
                "parameters": t.args_model.model_json_schema(),
            },
        }
        for t in TOOL_DEFS
    ]


async def dispatch(session: BridgeSession, name: str, args: Dict[str, Any]) -> str:
    """Validate args against the tool's schema and run it. Returns the tool-result string."""
    for t in TOOL_DEFS:
        if t.name == name:
            validated = t.args_model.model_validate(args or {})
            return await t.run(session, validated.model_dump())
    raise KeyError(f"unknown guidebridge tool: {name}")
