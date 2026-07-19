"""GuideBridge demo #2: tic-tac-toe, with two interchangeable opponents.

  POST /agent/move      — a plain Python minimax function decides the move.
                           No model call, no API key. This exercises the raw
                           SDK mechanics (observe/act/click) with a decision
                           layer that is deliberately NOT an agent, so the
                           package is testable out of the box.

  POST /agent/move-llm  — a real LLM (Claude, via LangChain) decides the move
                           by calling GuideBridge's tools itself: it invokes
                           the get_game_state app_action to see the board,
                           reasons about it, and calls the click tool on the
                           cell it chooses. Nothing here tells it what move to
                           make — that's the actual point of this endpoint.
                           Requires ANTHROPIC_API_KEY and
                           `pip install langchain langchain-anthropic`.

Both endpoints drive the exact same AgentBridge/click/cursor path; only the
"what move should I make" decision differs.

Run:  uvicorn main:app --reload --port 8010
"""
from __future__ import annotations

import json
import os
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


LLM_SYSTEM_PROMPT = """You are playing tic-tac-toe. You are "O"; the human is "X".

Call the get_game_state app_action first to see the current board, whose turn
it is, and the winner (if any). The board is a length-9 array indexed left to
right, top to bottom (0,1,2 / 3,4,5 / 6,7,8); empty cells are null.

If it is not O's turn, or the game is already over, do not call any other
tool — just say so.

Otherwise, think about which empty cell is the strongest move for O (block an
immediate loss, take an immediate win, otherwise play well), then call the
click tool with target_id "cell-<index>" for that cell — e.g. "cell-4" for
the center. Make exactly ONE move, then stop. Do not call get_game_state
again after clicking, and do not click more than one cell.

Reply with one short sentence naming the cell you chose and why."""


@app.post("/agent/move-llm")
async def agent_move_llm() -> dict:
    if bridge.get_session() is None:
        return {"error": "no browser session connected"}
    if not os.environ.get("ANTHROPIC_API_KEY"):
        return {"error": "set ANTHROPIC_API_KEY and install langchain langchain-anthropic to use this mode"}
    try:
        from langchain.agents import create_agent
        from langchain_anthropic import ChatAnthropic
    except ImportError:
        return {"error": "pip install langchain langchain-anthropic"}

    agent = create_agent(
        ChatAnthropic(model="claude-sonnet-5", max_tokens=500),
        tools=bridge.as_langchain_tools(),
        system_prompt=LLM_SYSTEM_PROMPT,
    )
    result = await agent.ainvoke(
        {"messages": [{"role": "user", "content": "It's your turn. Make your move."}]}
    )
    reply = result["messages"][-1].content
    if not isinstance(reply, str):
        reply = json.dumps(reply)
    return {"reply": reply}


@app.post("/agent/reset")
async def agent_reset() -> dict:
    if bridge.get_session() is None:
        return {"error": "no browser session connected"}
    result = await bridge.call_tool("app_action", {"name": "reset_game", "args": {}})
    return json.loads(result)
