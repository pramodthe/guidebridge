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
