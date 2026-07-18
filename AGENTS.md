# AGENTS.md — for coding agents working in this repo

GuideBridge lets a Python AI agent see and control a user's live React app page with a
visible cursor. Monorepo: npm package + pip package + demo, connected by a versioned
JSON protocol.

## Layout

- `packages/react/` — `@guidebridge/react` (TypeScript). Public API in `src/index.ts`;
  page runtime in `registry.ts` (targets/snapshot), `executor.ts` (actions + cursor
  choreography), `transport.ts` (ws client), `AgentProvider.tsx`, `AgentCursor.tsx`.
- `python/` — `guidebridge` (PyPI). `bridge.py` (AgentBridge: FastAPI ws endpoint +
  session registry), `session.py` (request/response futures), `tools.py` (the 11 tool
  defs — single source of truth), `adapters/` (langchain, openai, mcp).
- `packages/react/src/protocol.ts` ↔ `python/src/guidebridge/protocol.py` — the wire
  protocol, mirrored by hand. **Any frame/action change must touch both** and bump
  `PROTOCOL_VERSION` if breaking.
- `examples/demo/` — plant-store demo (Vite React frontend + FastAPI backend with a
  scripted tour). Frontend depends on the react package via `file:` link — rebuild the
  package (`npm run build`) before expecting demo changes to appear.
- `.claude/skills/guidebridge/SKILL.md` — integration playbook for agents adding
  GuideBridge to *other* apps. `llms.txt` — LLM-readable index.

## Build & test

```bash
# React package
cd packages/react && npm install && npm run typecheck && npm run build

# Python package (Python >= 3.10; repo venv lives at python/.venv)
cd python && pip install -e ".[dev]" && pytest      # includes real-WebSocket e2e tests

# Demo
cd examples/demo/backend  && uvicorn main:app --port 8000
cd examples/demo/frontend && npm install && npm run dev
```

## Rules

- New agent-visible capability = new entry in `python/.../tools.py` + action in both
  protocol files + executor case in `packages/react/src/executor.ts` + a test. Adapters
  (langchain/openai) pick up new tools automatically; the MCP adapter
  (`adapters/mcp.py`) needs an explicit function added.
- Keep `from __future__ import annotations` files honest: FastAPI endpoint parameter
  types (e.g. `WebSocket`) must be imported at module level or signature resolution
  breaks (connections 403).
- Typing must go through native value setters (see `setNativeValue` in executor.ts) so
  controlled React inputs update; never assign `.value` directly.
- Actions move the cursor first, then act (~450 ms lead) — preserve this in new actions;
  the visible-intent choreography is a product feature, not decoration.
- Tools must degrade gracefully: no session / timeout returns the sentinel string from
  `session.py`, never an unhandled exception into the agent loop.
- Don't commit `python/dist/`, `node_modules/`, or `.venv/` (gitignored).
