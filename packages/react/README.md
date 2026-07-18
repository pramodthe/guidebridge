# @guidebridge/react

React runtime for [GuideBridge](https://github.com/pramodthe/guidebridge) — give any
Python agent eyes and hands inside your React app. The agent observes the page
semantically and acts with a visible animated cursor: point, highlight, callout,
click, type, scroll, drag.

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

// Expose app-level actions (navigation, mutations) the agent can call by name:
useAgentAction("go_to_checkout", "Navigate to the checkout page", () => navigate("/checkout"));
```

Pairs with the [`guidebridge`](https://pypi.org/project/guidebridge/) pip package, which
mounts the WebSocket endpoint on FastAPI and adapts the page into tools for LangChain,
the OpenAI/Anthropic SDKs, or Google ADK.

- **`<AgentProvider url sessionId? autoDiscover?>`** — connects to your backend, registers
  targets, executes actions. `autoDiscover={false}` restricts the agent to explicit
  `agentTarget()` elements only.
- **`<AgentCursor label? color?>`** — the visible pointer with label pill and click ripple.
- **`agentTarget(name, { label? })`** — spread-props to name an element for the agent.
- **`useAgentAction(name, description, handler)`** — register a custom action.
- **`useAgentBridge()`** — `{ status, sessionId, registerAction }` for connection UI.

Typing uses native value setters, so **controlled React inputs update correctly**;
clicks dispatch full pointer-event sequences; every action is preceded by the cursor
moving to the target so users see intent before the page changes.

Full documentation, protocol reference, demo, and security model:
[github.com/pramodthe/guidebridge](https://github.com/pramodthe/guidebridge).

MIT © Pramod Thebe
