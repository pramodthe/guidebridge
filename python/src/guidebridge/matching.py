"""Stale-target recovery: find the current id of a stale/mistyped target.

Auto-generated ids (gb-ctl-N and friends) die whenever a content page
re-renders its DOM, so a model acting on an old observe_page result gets
"target not found". Given a fresh snapshot, match the wanted id against
stable slugs first, then fall back to a token-overlap match on labels/titles.

Ported from the pattern proven in production by Hi-Tuto's lesson bridge.
"""
from __future__ import annotations

import re
from typing import Any, Dict, List, Optional


def match_snapshot_target(snapshot: Dict[str, Any], wanted: str) -> Optional[str]:
    wanted_l = (wanted or "").strip().lower()
    if not wanted_l:
        return None
    candidates: List[Dict[str, Any]] = [
        *(snapshot.get("targets") or []),
        *(snapshot.get("sections") or []),
        *(snapshot.get("headings") or []),
    ]
    for c in candidates:
        if wanted_l in (str(c.get("slug") or "").lower(), str(c.get("id") or "").lower()):
            return str(c.get("id") or c.get("slug"))
    tokens = [t for t in re.split(r"[^a-z0-9]+", wanted_l) if len(t) > 1]
    if not tokens:
        return None
    best: Optional[tuple[int, str]] = None
    for c in candidates:
        hay = " ".join(
            str(c.get(k) or "") for k in ("slug", "label", "title", "text", "id")
        ).lower()
        score = sum(1 for t in tokens if t in hay)
        if score and (best is None or score > best[0]):
            best = (score, str(c.get("id") or c.get("slug")))
    return best[1] if best else None
