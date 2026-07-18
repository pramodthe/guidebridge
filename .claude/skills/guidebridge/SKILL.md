---
name: guidebridge
description: >-
  Integrate GuideBridge into an app so a Python AI agent can see and control the user's
  live page (point, highlight, click, type, scroll, drag, callouts) with a visible cursor.
  Use when asked to add an in-app AI guide/copilot/tutor, let an agent control the UI,
  add guided tours driven by an LLM, or wire GuideBridge into React + FastAPI with
  LangChain, OpenAI, Anthropic, Google ADK, or MCP.
---

# Integrating GuideBridge

GuideBridge = `@guidebridge/react` (npm, in-page runtime) + `guidebridge` (PyPI, FastAPI
WebSocket bridge + agent tool adapters). The agent observes a semantic snapshot of the
page and acts on **named targets** — never coordinates, never screenshots. It only works
on apps that mount the provider; it cannot drive third-party sites.

## Integration checklist

Work through these in order. Steps 1–2 frontend, 3–4 backend, 5 verify.

### 1. Frontend: mount the runtime

```bash
npm install @guidebridge/react
```

```tsx
import { AgentProvider, AgentCursor, agentTarget, useAgentAction } from "@guidebridge/react";

<AgentProvider url={`ws://${location.hostname}:8000/agent/ws`}>
  <AgentCursor label="Guide" />   {/* render exactly once */}
  {/* rest of the app */}
</AgentProvider>
```

- Use `location.hostname` (not a hardcoded host) in the ws URL; use `wss://` behind TLS.
- `sessionId` prop: pass a stable per-user/tab id in multi-user apps; default "default"
  is fine for single-user.

### 2. Frontend: name targets and expose actions

Mark every element the agent should reference — sections it explains, controls it uses:

```tsx
<section {...agentTarget("pricing", { label: "Pricing plans" })}>…</section>
<button {...agentTarget("checkout")}>Buy now</button>
```

For anything a DOM event can't express (navigation, mutations, modals), register a
custom action near the relevant component:

```tsx
useAgentAction("go_to_checkout", "Navigate to the checkout page", () => navigate("/checkout"));
```

Rules of thumb:
- Give targets short, semantic, kebab-case names the LLM can guess ("contact-email",
  not "input-7").
- `autoDiscover` defaults to true (plain buttons/inputs/links inside the provider are
  also exposed). For sensitive apps set `autoDiscover={false}` so only explicit
  `agentTarget` elements are visible/actionable — a strict allowlist.
- Destructive operations (delete, pay, send) should NOT be bare buttons the agent can
  click; put them behind `useAgentAction` handlers that confirm with the user first.

### 3. Backend: mount the bridge

```bash
pip install "guidebridge[fastapi]"
```

```python
from fastapi import FastAPI
from guidebridge import AgentBridge

app = FastAPI()
bridge = AgentBridge()                 # optional: timeout_s=, authorize=async fn(ws)->bool
app.include_router(bridge.router)      # WebSocket endpoint at /agent/ws
```

- If frontend and backend run on different origins, WebSockets are not blocked by CORS,
  but any HTTP endpoints the frontend calls need CORS configured.
- Production: pass `authorize=` to validate the session cookie/JWT before accepting.

### 4. Backend: hand tools to the agent

Pick ONE per framework:

```python
# LangChain / LangGraph
tools = bridge.as_langchain_tools()          # pip install "guidebridge[langchain]"

# OpenAI / Anthropic / ADK — JSON-schema specs + async dispatcher
toolset = bridge.as_openai_tools()           # toolset.specs; await toolset.call(name, args)

# MCP (Claude Code, Claude Desktop, Cursor)
server = bridge.as_mcp_server()              # pip install "guidebridge[mcp]"
server.run()                                 # stdio; or app.mount("/mcp", server.streamable_http_app())
```

The 11 tools every adapter exposes: `observe_page`, `point_at`, `highlight`, `callout`,
`click`, `type_text`, `select_option`, `scroll_to`, `scroll_by`, `drag`, `app_action`.

System-prompt guidance that makes agents behave well with these tools:

> You are an on-page guide. Call observe_page first to learn target ids. While you
> explain something, point_at or highlight it. Use callout for short labels, click /
> type_text / select_option to demonstrate, and never claim an action succeeded if the
> tool result says otherwise. Re-observe after the page changes.

### 5. Verify end-to-end

1. Start backend, then frontend; open the app.
2. `curl http://localhost:8000/health`-style check isn't built in — instead check
   `bridge.sessions()` is non-empty (e.g. from a debug endpoint) or watch the
   `useAgentBridge().status` value turn "connected".
3. Smoke-test without an LLM: `await bridge.call_tool("observe_page", {})` should return
   JSON containing your named targets; `await bridge.call_tool("point_at", {"target_id": "<one>"})`
   should visibly move the cursor.
4. Then wire the real agent and ask it to "show me around this page".

## Gotchas

- **No session connected** → tools return a graceful "page did not respond" sentinel
  string, not an exception. If you see it, the tab isn't open or the ws URL is wrong.
- **`observe_page` first**: target ids for auto-discovered elements (`gb-N`) are assigned
  lazily; agents acting on guessed ids will fail with `target not found`.
- **Controlled React inputs work** (native value setters are used) — do not "fix" typing
  by setting `el.value` directly anywhere.
- **PEP 563 + FastAPI**: if you subclass/extend the bridge, keep `WebSocket` imported at
  module level in files using `from __future__ import annotations`, or FastAPI misreads
  endpoint signatures and rejects connections with 403.
- One `<AgentCursor />` per app; rendering it twice draws two cursors.

## Reference

Full docs: README at the repo root. Protocol: `packages/react/src/protocol.ts` and
`python/src/guidebridge/protocol.py` (keep in sync; bump PROTOCOL_VERSION on breaking
changes). Working example: `examples/demo/` (storefront + scripted tour + LangChain
endpoint).
