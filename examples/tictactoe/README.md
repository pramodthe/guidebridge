# Tic-Tac-Toe vs. a GuideBridge agent

A second, self-contained GuideBridge demo — no LLM or API key required. A plain Python
minimax "agent" plays perfect tic-tac-toe against you using only the SDK's tools:

- `app_action("get_game_state")` — a `useAgentAction` the frontend registers, returning
  the live board, whose turn it is, and the winner
- `click("cell-<n>")` — the agent's actual move, executed with the visible cursor exactly
  like a human click (full pointer-event sequence, cursor leads the action)

It's a good smoke test after changing the SDK: it exercises the real WebSocket round
trip, custom actions reading **live** component state (not just static content), and
the click executor, end to end, in a real browser.

## Run it

```bash
# terminal 1 — backend
cd ../../python && pip install -e ".[dev]"
cd ../examples/tictactoe/backend && uvicorn main:app --port 8010

# terminal 2 — frontend
cd ../../../packages/react && npm install && npm run build
cd ../examples/tictactoe/frontend && npm install && npm run dev
```

Open <http://localhost:5183>. You're X and move first; the agent (O) responds
automatically. It never loses — expect a draw if you play well, or a loss if you don't.

## A real LLM opponent, not just minimax

Toggle **Claude (real LLM)** in the UI to switch the O player from minimax to an actual
Claude agent that decides its own moves — it calls `get_game_state` (an `app_action`)
to see the board and reasons about it, then calls `click` itself. No move logic is
hardcoded anywhere in this path; the backend only explains the rules. Expect 10–30s per
move (a few real model round trips), and occasionally a turn where the model doesn't
commit to a move in time — the frontend hands control back to you cleanly rather than
soft-locking.

Needs one of:
```bash
# Anthropic directly
export ANTHROPIC_API_KEY=sk-...

# or an OpenAI-compatible gateway (e.g. TokenRouter) — set the model string if your
# gateway names it differently than "anthropic/claude-sonnet-5"
export TOKENROUTER_API_KEY=sk-...
export TOKENROUTER_MODEL=anthropic/claude-sonnet-5   # optional, this is the default

pip install langchain langchain-openai   # or langchain-anthropic for the direct path
```

## Why this caught a real bug

The first version of this demo hung forever: the agent's `get_game_state` action kept
returning the *initial* board (all empty, X's turn) no matter how many moves were
played. The cause was in `@guidebridge/react` itself — `useAgentAction`'s effect only
re-ran when `name`/`description` changed, so it registered the handler closure from the
**first render** and never updated it, permanently capturing stale `board`/`turnX`
values. Fixed in `packages/react/src/hooks.ts` with a latest-ref pattern so the
registered action always calls the handler from the most recent render. If you're
testing a change to the SDK, this demo is a fast way to catch this class of bug again —
the plant-store demo's only custom action (`clear_cart`) doesn't read state, so it can't
surface it.
