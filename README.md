<div align="center">

# 🧭 GuideBridge

**Give any Python agent eyes and hands inside your React app.**

Your AI agent can see the page your user is looking at, point at things with a visible
cursor, highlight, scroll, click, type, drag, and explain — live, in the user's own
browser tab. No browser automation. No screenshots. No hosted service.

[![npm](https://img.shields.io/badge/npm-%40guidebridge%2Freact-cb3837?logo=npm)](https://www.npmjs.com/package/@guidebridge/react)
[![PyPI](https://img.shields.io/badge/PyPI-guidebridge-3775a9?logo=pypi&logoColor=white)](https://pypi.org/project/guidebridge/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Python](https://img.shields.io/badge/python-3.10%2B-blue?logo=python&logoColor=white)](python/)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white)](packages/react/)

[Quickstart](#-quickstart) · [How it works](#-how-it-works) · [Agent tools](#-the-agents-tools) ·
[React API](#-react-api) · [Python API](#-python-api) · [Frameworks](#-framework-integrations) ·
[Protocol](#-protocol) · [Security](#-security-model) · [Demo](#-run-the-demo)

![GuideBridge demo: an agent tours a storefront, highlights products, and fills the contact form with a visible cursor](docs/demo.gif)

</div>

---

## Why GuideBridge?

Vision-based "computer use" agents drive a browser *they* own: screenshot → vision model →
pixel coordinates → click. That's slow (seconds per action), expensive (image tokens on
every observation), brittle (pixel drift, re-renders), and can't touch the tab your user
already has open.

When you **own the app**, you don't need vision. GuideBridge instruments your React app to
expose a cooperative interface: the agent *observes* a compact semantic snapshot (a few KB
of JSON, not a screenshot) and *acts* on named targets (not coordinates), over a WebSocket
round trip measured in milliseconds. A visible animated cursor makes every action legible
to the user — the agent doesn't just do things, it visibly *shows and explains* them.

|                      | GuideBridge | Browser-use / computer use |
| -------------------- | ----------- | -------------------------- |
| Latency per action   | ~10–100 ms  | 2–10 s (vision inference)  |
| Observation cost     | ~2–4 KB JSON | thousands of image tokens |
| Targets              | semantic ids | pixel coordinates         |
| Runs in user's own tab | ✅         | ❌ (agent-owned browser)   |
| Survives re-renders  | ✅ (id + retry) | ❌                     |
| Arbitrary third-party sites | ❌   | ✅                         |

Use GuideBridge for **your** product: onboarding guides, in-app copilots, support agents
that fix things while the user watches, AI tutors that teach on top of your UI.

## 📦 What's in the box

| Package | Registry | What it is |
| ------- | -------- | ---------- |
| [`@guidebridge/react`](packages/react/) | npm | `<AgentProvider>`, `<AgentCursor>`, `agentTarget()`, `useAgentAction()` — the in-page runtime |
| [`guidebridge`](python/) | PyPI | `AgentBridge` — FastAPI WebSocket endpoint, session manager, and tool adapters for LangChain / OpenAI / Anthropic / Google ADK |
| [Protocol](#-protocol) | — | A small, versioned JSON frame protocol connecting the two |

```
┌──────────────┐   tool calls     ┌──────────────┐    WebSocket     ┌────────────────┐
│  LLM agent    │ ───────────────▶ │  guidebridge  │ ───────────────▶ │  your React app │
│  (LangChain,  │                  │   (FastAPI)   │                  │  (user's tab)   │
│  OpenAI, ADK) │ ◀─────────────── │               │ ◀─────────────── │  cursor + DOM   │
└──────────────┘   observations    └──────────────┘     frames       └────────────────┘
```

## 🚀 Quickstart

### 1. Frontend — mark up your app

```bash
npm install @guidebridge/react
```

```tsx
import { AgentProvider, AgentCursor, agentTarget, useAgentAction } from "@guidebridge/react";

function App() {
  return (
    <AgentProvider url="ws://localhost:8000/agent/ws">
      <AgentCursor label="Guide" />

      <section {...agentTarget("pricing", { label: "Pricing plans" })}>…</section>
      <button {...agentTarget("checkout")}>Buy now</button>
    </AgentProvider>
  );
}
```

Expose app-level actions the agent can call by name (navigation, anything a DOM
event can't express):

```tsx
function CheckoutShortcut() {
  const navigate = useNavigate();
  useAgentAction("go_to_checkout", "Navigate to the checkout page", () => navigate("/checkout"));
  return null;
}
```

### 2. Backend — mount the bridge, hand tools to your agent

```bash
pip install "guidebridge[fastapi,langchain]"
```

```python
from fastapi import FastAPI
from guidebridge import AgentBridge

app = FastAPI()
bridge = AgentBridge()
app.include_router(bridge.router)        # WebSocket endpoint at /agent/ws

tools = bridge.as_langchain_tools()      # ready for any LangChain agent
```

### 3. Let the agent drive

```python
from langchain.agents import create_agent
from langchain_anthropic import ChatAnthropic

agent = create_agent(
    ChatAnthropic(model="claude-sonnet-5"),
    tools=bridge.as_langchain_tools(),
    system_prompt=(
        "You are an on-page guide. Call observe_page first, then point, highlight, "
        "and act while you explain what you're doing."
    ),
)
await agent.ainvoke({"messages": [{"role": "user", "content": "Show me how to check out"}]})
```

The user watches a labeled cursor glide to the pricing section, highlight it, fill the
form, and stop short of the Buy button — while the agent narrates.

## 🔍 How it works

1. **`<AgentProvider>`** opens a WebSocket to your backend and registers the page:
   every `agentTarget()` element, plus (by default) plain buttons/inputs/links inside the
   provider, becomes an addressable target with a stable id, role, label, and live value.
2. **Your agent calls a tool** (e.g. `click(target_id="checkout")`). The `AgentBridge`
   turns it into a small JSON frame, sends it to the right browser session, and awaits
   the reply as the tool result.
3. **The in-page runtime executes it** — cursor animates to the element *first* (~450 ms
   lead so intent reads before the change), then performs a real DOM interaction:
   full pointer-event sequences for clicks, native value setters for typing (so React
   controlled inputs actually update), smooth scrolling, animated drag.
4. **The agent observes** with `observe_page`: a compact snapshot of targets, values,
   scroll state, registered app actions, and the user's recent clicks/inputs — so it can
   react to what the user just did.

## 🛠 The agent's tools

Every framework adapter exposes the same 11 tools:

| Tool | Arguments | What the user sees |
| ---- | --------- | ------------------ |
| `observe_page` | — | nothing (returns the semantic snapshot) |
| `point_at` | `target_id` | cursor glides onto the element |
| `highlight` | `target_id`, `ms?` | cursor + colored outline while the agent explains |
| `callout` | `target_id`, `text`, `ms?` | highlight + a text bubble next to the element |
| `click` | `target_id` | cursor arrives, click ripple, real click fires |
| `type_text` | `target_id`, `value` | cursor arrives, value types in character by character |
| `select_option` | `target_id`, `value` | dropdown changes to the option (by value or label) |
| `scroll_to` | `target_id` | element scrolls smoothly into view, centered |
| `scroll_by` | `direction`, `amount?` | page scrolls a viewport (or half) up/down |
| `drag` | `target_id`, `to_target_id` | cursor drags one element onto another |
| `app_action` | `name`, `args` | whatever your `useAgentAction` handler does |

Failed actions return structured errors (`target not found: …`) so the agent can
re-observe and recover.

## ⚛️ React API

### `<AgentProvider>`

| Prop | Type | Default | Description |
| ---- | ---- | ------- | ----------- |
| `url` | `string` | — | WebSocket URL of your `AgentBridge` endpoint |
| `sessionId` | `string` | `"default"` | Stable id for this tab; use your user/tab id in multi-user apps |
| `autoDiscover` | `boolean` | `true` | Also expose undecorated buttons/inputs/links. Set `false` for a strict allowlist of `agentTarget`s only |

Reconnects automatically with exponential backoff.

### `<AgentCursor>`

| Prop | Type | Default |
| ---- | ---- | ------- |
| `label` | `string` | `"Agent"` |
| `color` | `string` | `"#2C50EE"` |

Render it once anywhere inside your app; it positions itself (`position: fixed`,
pointer-events: none) and only appears while the agent is acting.

### `agentTarget(name, opts?)`

Spread-props helper that names an element for the agent:

```tsx
<button {...agentTarget("checkout", { label: "Complete the purchase" })}>Buy</button>
```

### `useAgentAction(name, description, handler)`

Registers a custom action. It appears in `observe_page` under `customActions`, and the
agent invokes it via the `app_action` tool. The handler's return value is serialized back
to the agent. Unregisters automatically on unmount.

### `useAgentBridge()`

Returns `{ status, sessionId, registerAction }` — `status` is
`"connecting" | "connected" | "disconnected"`, handy for a status pill.

## 🐍 Python API

### `AgentBridge(path="/agent/ws", *, timeout_s=10.0, authorize=None)`

| Member | Description |
| ------ | ----------- |
| `.router` | FastAPI `APIRouter` with the WebSocket endpoint — `app.include_router(bridge.router)` |
| `.as_langchain_tools(session_id=None)` | `list[StructuredTool]` (async) for LangChain / LangGraph agents |
| `.as_openai_tools(session_id=None)` | `OpenAIToolset` with `.specs` (JSON-schema function specs) and `await .call(name, args)` |
| `.call_tool(name, args, session_id=None)` | Direct dispatch — build your own adapter on this |
| `.get_session(session_id=None)` / `.sessions()` | Inspect connected browser tabs |
| `.wait_for_session(session_id=None, timeout_s=30)` | Await a tab connecting (useful in scripts/tests) |
| `authorize=` | `async (websocket) -> bool` — authenticate the socket (cookie, token, origin) before a session is accepted |

`session_id=None` targets the most recent connected tab — fine for single-user apps;
pass explicit ids in multi-user deployments.

If no tab is connected (or it doesn't answer within `timeout_s`), tools return a
graceful sentinel telling the model to continue without the page — your agent never
hangs or crashes on a closed tab.

## 🔌 Framework integrations

<details>
<summary><b>LangChain / LangGraph</b></summary>

```python
tools = bridge.as_langchain_tools()
agent = create_agent(model, tools=tools, system_prompt="…")
```
</details>

<details>
<summary><b>OpenAI SDK</b></summary>

```python
toolset = bridge.as_openai_tools()

resp = client.chat.completions.create(model="gpt-4o", messages=msgs, tools=toolset.specs)
for tc in resp.choices[0].message.tool_calls or []:
    result = await toolset.call(tc.function.name, tc.function.arguments)
    msgs.append({"role": "tool", "tool_call_id": tc.id, "content": result})
```
</details>

<details>
<summary><b>Anthropic SDK</b></summary>

```python
toolset = bridge.as_openai_tools()
anthropic_tools = [
    {"name": s["function"]["name"], "description": s["function"]["description"],
     "input_schema": s["function"]["parameters"]}
    for s in toolset.specs
]

msg = client.messages.create(model="claude-sonnet-5", max_tokens=1024,
                             tools=anthropic_tools, messages=msgs)
for block in msg.content:
    if block.type == "tool_use":
        result = await toolset.call(block.name, block.input)
```
</details>

<details>
<summary><b>MCP (Claude Code, Claude Desktop, Cursor, …)</b></summary>

```python
# pip install "guidebridge[mcp]"
server = bridge.as_mcp_server()
server.run()                                  # stdio, for local MCP clients

# or serve over HTTP alongside your FastAPI app:
app.mount("/mcp", server.streamable_http_app())
```

Any MCP client connected to this server gets all 11 page-control tools.
</details>

<details>
<summary><b>Google ADK / anything else</b></summary>

Any framework that consumes JSON-schema function specs works: feed it
`toolset.specs` (or `guidebridge.openai_tool_specs()`) and route calls through
`await bridge.call_tool(name, args)`.
</details>

## 📡 Protocol

Versioned JSON frames (current: `v1`) over one WebSocket per tab. TypeScript types live in
[`packages/react/src/protocol.ts`](packages/react/src/protocol.ts), the Pydantic mirror in
[`python/src/guidebridge/protocol.py`](python/src/guidebridge/protocol.py).

```jsonc
// browser → backend, once on connect
{ "type": "hello", "version": "1", "sessionId": "default", "page": { "url": "…", "title": "…" } }

// backend → browser
{ "type": "observe.request", "requestId": "gb_a1b2c3" }
{ "type": "action.request",  "requestId": "gb_d4e5f6", "action": { "type": "click", "targetId": "checkout" } }

// browser → backend
{ "type": "observe.result", "requestId": "gb_a1b2c3", "payload": { /* PageSnapshot */ } }
{ "type": "action.result",  "requestId": "gb_d4e5f6", "payload": { "success": true } }
```

`PageSnapshot` contains `targets` (id, role, label, current value, visibility),
scroll state, `customActions`, and `recentEvents` (the user's last ~15 interactions).

## 🔒 Security model

GuideBridge is **cooperative by design** — there is nothing to inject and no extension:

- The agent reaches only pages that mount `AgentProvider` and connect **out** to *your*
  backend. It cannot touch other tabs or sites.
- `autoDiscover={false}` turns the page into a strict allowlist: only elements you
  explicitly marked with `agentTarget()` are visible or actionable.
- `AgentBridge(authorize=…)` authenticates the WebSocket (session cookie, JWT, origin
  check) before any session is accepted.
- Keep destructive flows behind `useAgentAction` handlers — your code decides what
  actually happens and can require user confirmation before doing it.
- The cursor overlay makes every agent action visible; nothing happens silently.

## 🌱 Run the demos

**Plant storefront** — a scripted guided tour (no API key) or a real LangChain agent
(`ANTHROPIC_API_KEY`):

```bash
# terminal 1 — backend
cd python && pip install -e ".[dev]"
cd ../examples/demo/backend && uvicorn main:app --port 8000

# terminal 2 — frontend
cd packages/react && npm install && npm run build
cd ../../examples/demo/frontend && npm install && npm run dev
```

Open <http://localhost:5173> and press **▶ Run agent tour**: the cursor tours the store,
highlights the best seller, adds it to the cart, and fills the contact form while
explaining each step.

**[Tic-tac-toe](examples/tictactoe/)** — play against a Python minimax agent, no API key
needed. Exercises `app_action` reading *live* component state plus the `click` tool, end
to end in a real browser — a good smoke test after changing the SDK:

```bash
cd examples/tictactoe/backend  && uvicorn main:app --port 8010
cd examples/tictactoe/frontend && npm install && npm run dev
```

Open <http://localhost:5183> — you're X, the cursor plays O and never loses.

## 🗺 Roadmap

- [x] **MCP server adapter** — `bridge.as_mcp_server()` exposes page control to Claude,
      Cursor, and any MCP client
- [ ] `spotlight` action (dim everything except the target) + step-sequenced tours
- [ ] Human-confirmation policy hooks (`confirm: true` per target/action)
- [ ] Sandboxed-iframe mode for untrusted/generated HTML content
- [ ] Vue / Svelte runtimes speaking the same protocol
- [ ] Voice transports (LiveKit data channels, Vapi client messages)

## 🤖 For AI coding agents

This repo is agent-ready — clone it and your coding agent can integrate GuideBridge for you:

- [`llms.txt`](llms.txt) — LLM-readable index of docs, protocol, and examples
- [`.claude/skills/guidebridge/SKILL.md`](.claude/skills/guidebridge/SKILL.md) — a
  step-by-step integration playbook; Claude Code picks it up automatically in this repo,
  or copy the `guidebridge/` folder into your own project's `.claude/skills/`
- [`AGENTS.md`](AGENTS.md) — repo map, build/test commands, and contribution rules
  (Claude, Cursor, Codex, etc. read this when working on the codebase)

Tell your agent: *"Add GuideBridge to my app so an AI guide can control the page"* — the
skill walks it through provider setup, target naming, bridge mounting, and verification.

## 🤝 Contributing

Issues and PRs welcome. To develop locally:

```bash
# React package
cd packages/react && npm install && npm run typecheck && npm run build

# Python package + tests (includes real-WebSocket e2e tests)
cd python && pip install -e ".[dev]" && pytest
```

Keep the two protocol files in sync when adding frames or actions, and bump
`PROTOCOL_VERSION` on breaking changes.

## 📄 License

[MIT](LICENSE) © Pramod Thebe

---

<div align="center">
<sub>Inspired by the lesson bridge in <a href="https://github.com/pramodthe/Hi-Tuto">Hi-Tuto</a>,
where a voice tutor teaches on top of AI-generated lessons by pointing, scrolling, and
clicking — generalized here so any agent can do it in any React app.</sub>
</div>
