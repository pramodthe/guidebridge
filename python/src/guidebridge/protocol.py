"""GuideBridge wire protocol v1 — Pydantic mirror of packages/react/src/protocol.ts."""
from __future__ import annotations

import json
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field

PROTOCOL_VERSION = "1"


class TargetInfo(BaseModel):
    id: str
    role: str
    label: str
    value: Optional[str] = None
    disabled: Optional[bool] = None
    visible: bool
    slug: Optional[str] = None


class SectionInfo(BaseModel):
    """A content section of the page (data-agent-section / data-lesson-section)."""

    id: str
    slug: Optional[str] = None
    title: str = ""
    summary: str = ""
    visible: bool = False


class HeadingInfo(BaseModel):
    id: str
    level: int
    text: str


class UserEvent(BaseModel):
    kind: str
    targetId: Optional[str] = None
    label: Optional[str] = None
    value: Optional[str] = None
    at: str


class CustomActionInfo(BaseModel):
    name: str
    description: str


class PageSnapshot(BaseModel):
    url: str
    title: str
    scrollY: int
    scrollHeight: int
    viewportHeight: int
    targets: List[TargetInfo]
    customActions: List[CustomActionInfo] = Field(default_factory=list)
    recentEvents: List[UserEvent] = Field(default_factory=list)
    # Optional structure emitted by content-page runtimes (e.g. iframe mode):
    sections: Optional[List[SectionInfo]] = None
    headings: Optional[List[HeadingInfo]] = None
    visibleSectionId: Optional[str] = None


class ActionResult(BaseModel):
    model_config = {"extra": "allow"}

    success: bool
    error: Optional[str] = None


class ClientHello(BaseModel):
    type: Literal["hello"]
    version: str
    sessionId: str
    page: Dict[str, Any] = Field(default_factory=dict)


class ClientFrame(BaseModel):
    """Loose envelope for anything the browser sends after hello."""

    model_config = {"extra": "allow"}

    type: str
    requestId: Optional[str] = None
    payload: Any = None


def encode(frame: Dict[str, Any]) -> str:
    return json.dumps(frame, separators=(",", ":"))


def observe_request(request_id: str) -> Dict[str, Any]:
    return {"type": "observe.request", "requestId": request_id}


def action_request(request_id: str, action: Dict[str, Any]) -> Dict[str, Any]:
    return {"type": "action.request", "requestId": request_id, "action": action}


# ---- Tool argument schemas (shared by all framework adapters) ----


class ObserveArgs(BaseModel):
    """No arguments."""


class TargetArgs(BaseModel):
    target_id: str = Field(
        description="Target id from observe_page (a data-agent-target name, DOM id, or auto id)."
    )


class HighlightArgs(TargetArgs):
    ms: Optional[int] = Field(default=None, description="How long to keep the highlight, in ms.")


class TypeArgs(TargetArgs):
    value: str = Field(description="The text or value to enter.")


class SelectArgs(TargetArgs):
    value: str = Field(description="Option value or visible label to select.")


class ScrollByArgs(BaseModel):
    direction: Literal["up", "down"] = Field(description="Which way to scroll the page.")
    amount: Literal["page", "half"] = Field(
        default="page", description="A full viewport or half of one."
    )


class DragArgs(BaseModel):
    target_id: str = Field(description="Id of the element to drag.")
    to_target_id: str = Field(description="Id of the drop target.")


class CalloutArgs(TargetArgs):
    text: str = Field(description="Short explanation to show in a bubble next to the target.")
    ms: Optional[int] = Field(default=None, description="How long to keep the callout, in ms.")


class AppActionArgs(BaseModel):
    name: str = Field(description="Name of a custom action listed in observe_page customActions.")
    args: Dict[str, Any] = Field(default_factory=dict, description="Arguments for the action.")
