# GuideBridge

**Give any Python agent eyes and hands inside your React app.**

GuideBridge connects an AI agent (LangChain, OpenAI SDK, Google ADK, or anything
that speaks JSON-schema tools) to the page your user is *currently looking at* —
in their own browser tab. The agent can observe the page semantically, then
point, highlight, scroll, click, type, drag, and attach guided-tour callouts,
all with a visible animated cursor so the user sees exactly what it's doing.

No browser automation, no screenshots, no hosted service. Just:

- **`@guidebridge/react`** (npm) — a provider, a cursor overlay, and two helpers
- **`guidebridge`** (pip) — a FastAPI-mountable WebSocket endpoint + tool adapters
- a small versioned JSON protocol between them

```
┌─────────────┐   tool calls    ┌──────────────┐   WebSocket    ┌───────────────┐
│  LLM agent   │ ─────────────▶ │  guidebridge │ ─────────────▶ │  React app     │
│ (LangChain,  │ ◀───────────── │  (FastAPI)   │ ◀───────────── │  (user's tab)  │
│  OpenAI, …)  │  observations  └──────────────┘    frames      │  cursor+DOM    │
└─────────────┘                                                 └───────────────┘
```

## Frontend (React)

```bash
npm install @guidebridge/react
```

```tsx
import { AgentProvider, AgentCursor, agentTarget, useAgentAction } from "@guidebridge/react";

function App() {
  return (
    <AgentProvider url="ws://localhost:8000/agent/ws">
      <AgentCursor label="Guide" />
      <section {...agentTarget("pricing")}>…</section>
      <button {...agentTarget("checkout")}>Buy now</button>
    </AgentProvider>
  );
}

// Anywhere inside the provider — expose app-level actions (navigation etc.):
useAgentAction("go_to_checkout", "Navigate to the checkout page", () => navigate("/checkout"));
```

By default the provider also auto-discovers plain buttons/inputs/links inside it
(`autoDiscover={false}` to restrict the agent to explicit `agentTarget`s only).

## Backend (Python / FastAPI)

```bash
pip install "guidebridge[fastapi,langchain]"
```

```python
from fastapi import FastAPI
from guidebridge import AgentBridge

app = FastAPI()
bridge = AgentBridge()
app.include_router(bridge.router)          # WebSocket endpoint at /agent/ws

# LangChain
tools = bridge.as_langchain_tools()

# OpenAI SDK / Anthropic / Google ADK — specs + dispatcher
toolset = bridge.as_openai_tools()
toolset.specs                              # JSON-schema function specs
await toolset.call("click", '{"target_id": "checkout"}')
```

## The agent's tools

| Tool | What it does |
| --- | --- |
| `observe_page` | Structured snapshot: targets (id/role/label/value), scroll state, registered app actions, recent user interactions |
| `point_at` | Move the visible cursor onto an element without acting |
| `highlight` | Point + outline an element while explaining |
| `callout` | Highlight + a text bubble next to the element (guided tours) |
| `click` | Full pointer/mouse event sequence + click |
| `type_text` | Animated typing via native value setters (works with controlled React inputs) |
| `select_option` | Choose a `<select>` option by value or label |
| `scroll_to` / `scroll_by` | Bring targets into view / free scrolling |
| `drag` | Animated drag-and-drop between two targets |
| `app_action` | Invoke a custom action the app registered with `useAgentAction` |

Every action moves the cursor first, then acts — so users see intent before the
page changes.

## Demo

A plant storefront driven by a scripted tour (no API key needed) or a real
LangChain agent:

```bash
# terminal 1 — backend
cd python && pip install -e ".[dev]"
cd ../examples/demo/backend && uvicorn main:app --port 8000

# terminal 2 — frontend
cd packages/react && npm install && npm run build
cd ../../examples/demo/frontend && npm install && npm run dev
```

Open http://localhost:5173 and press **▶ Run agent tour**.

## Security model

- The agent only reaches pages that mount `AgentProvider` and connect out to
  *your* backend — there is nothing to inject and no extension.
- `autoDiscover={false}` gives you a strict allowlist: only elements you marked
  with `agentTarget()` are visible or actionable.
- Pass `authorize=` to `AgentBridge` to authenticate the WebSocket (cookie/token)
  before a session is accepted.
- Destructive flows should stay behind `useAgentAction` handlers, where your own
  code decides what actually happens (and can ask the user to confirm).

## Repo layout

- `packages/react` — the npm package (`@guidebridge/react`)
- `python` — the pip package (`guidebridge`), tests included
- `examples/demo` — storefront demo (FastAPI backend + Vite React frontend)

## License

MIT
