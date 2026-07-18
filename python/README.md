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

See the repository README for the full protocol, the React SDK, and a runnable demo.
