"""GuideBridge demo #2: tic-tac-toe against an unbeatable minimax agent.

Deliberately uses no LLM — this exercises the raw SDK mechanics end to end:
a Python "agent" reads the board through a custom app_action, decides a move
with plain minimax, and plays it with the `click` tool. Same round trip a
real LLM agent would use, minus the model call, so the package works out of
the box with zero API keys.

Run:  uvicorn main:app --reload --port 8010
"""
from __future__ import annotations

import json
from typing import List, Optional

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from guidebridge import AgentBridge

app = FastAPI(title="GuideBridge tic-tac-toe demo")
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1):\d+",
    allow_methods=["*"],
    allow_headers=["*"],
)

bridge = AgentBridge()
app.include_router(bridge.router)

WIN_LINES = [
    (0, 1, 2), (3, 4, 5), (6, 7, 8),
    (0, 3, 6), (1, 4, 7), (2, 5, 8),
    (0, 4, 8), (2, 4, 6),
]


def winner_of(board: List[Optional[str]]) -> Optional[str]:
    for a, b, c in WIN_LINES:
        if board[a] and board[a] == board[b] == board[c]:
            return board[a]
    return None


def minimax(board: List[Optional[str]], player: str) -> tuple[int, Optional[int]]:
    """Perfect-play tic-tac-toe: agent is always "O", human is always "X"."""
    win = winner_of(board)
    if win == "O":
        return 1, None
    if win == "X":
        return -1, None
    empties = [i for i, v in enumerate(board) if v is None]
    if not empties:
        return 0, None

    best_score = -2 if player == "O" else 2
    best_move: Optional[int] = None
    for i in empties:
        board[i] = player
        score, _ = minimax(board, "X" if player == "O" else "O")
        board[i] = None
        if (player == "O" and score > best_score) or (player == "X" and score < best_score):
            best_score, best_move = score, i
    return best_score, best_move


@app.get("/health")
async def health() -> dict:
    return {"ok": True, "sessions": bridge.sessions()}


@app.post("/agent/move")
async def agent_move() -> dict:
    if bridge.get_session() is None:
        return {"error": "no browser session connected"}

    raw = await bridge.call_tool("app_action", {"name": "get_game_state", "args": {}})
    try:
        state = json.loads(raw)
    except ValueError:
        return {"error": raw}
    if "result" not in state:
        return {"error": state.get("error") or "could not read game state"}

    game = state["result"]
    board: List[Optional[str]] = game["board"]
    if game.get("winner") or all(board):
        return {"skipped": True, "reason": "game already over"}
    if game.get("turn") != "O":
        return {"skipped": True, "reason": "not the agent's turn"}

    _, move = minimax(list(board), "O")
    if move is None:
        return {"skipped": True, "reason": "no legal move"}

    result = await bridge.call_tool("click", {"target_id": f"cell-{move}"})
    return {"move": move, "result": json.loads(result)}


@app.post("/agent/reset")
async def agent_reset() -> dict:
    if bridge.get_session() is None:
        return {"error": "no browser session connected"}
    result = await bridge.call_tool("app_action", {"name": "reset_game", "args": {}})
    return json.loads(result)
