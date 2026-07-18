# guidebridge

Give any Python agent eyes and hands inside your React app: semantic page
observation, cursor-led actions (click, type, scroll, drag), and guided-tour
overlays (highlight, callout) — over a WebSocket to the user's live browser tab.

Pairs with the [`@guidebridge/react`](https://www.npmjs.com/package/@guidebridge/react)
frontend SDK.

```python
from fastapi import FastAPI
from guidebridge import AgentBridge

app = FastAPI()
bridge = AgentBridge()
app.include_router(bridge.router)      # mounts ws endpoint at /agent/ws

tools = bridge.as_langchain_tools()    # or bridge.as_openai_tools()
```

```python
# LangChain / LangGraph
tools = bridge.as_langchain_tools()

# OpenAI / Anthropic / Google ADK — JSON-schema specs + async dispatcher
toolset = bridge.as_openai_tools()
toolset.specs
await toolset.call("click", '{"target_id": "checkout"}')
```

The agent gets 11 tools — `observe_page`, `point_at`, `highlight`, `callout`, `click`,
`type_text`, `select_option`, `scroll_to`, `scroll_by`, `drag`, `app_action` — each
executed in the user's live tab with a visible cursor. Optional extras:
`guidebridge[fastapi]`, `guidebridge[langchain]`.

Full documentation, protocol reference, demo, and security model:
[github.com/pramodthe/guidebridge](https://github.com/pramodthe/guidebridge).

MIT © Pramod Thebe
