#!/usr/bin/env bash
# GuideBridge quickstart — scaffolds a minimal working app from the published packages:
#   backend/   FastAPI + `guidebridge` (PyPI) with a no-API-key scripted demo agent
#   frontend/  Vite + React + `@guidebridge/react` (npm) with targets + the agent cursor
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/pramodthe/guidebridge/main/quickstart.sh | bash
#   # or: bash quickstart.sh [app-dir]     (default: guidebridge-app)
set -euo pipefail

APP_DIR="${1:-guidebridge-app}"

say() { printf '\033[1;32m▸ %s\033[0m\n' "$*"; }
die() { printf '\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

command -v python3 >/dev/null || die "python3 is required (3.10+)"
command -v node >/dev/null || die "node is required (18+)"
command -v npm >/dev/null || die "npm is required"
[ -e "$APP_DIR" ] && die "$APP_DIR already exists — pass a different directory name"

say "Creating $APP_DIR"
mkdir -p "$APP_DIR/backend" "$APP_DIR/frontend/src"

# ---------------------------------------------------------------- backend ----
cat > "$APP_DIR/backend/main.py" <<'PYEOF'
"""GuideBridge quickstart backend.

Mounts the AgentBridge WebSocket and a no-API-key scripted demo so you can see
the agent cursor working immediately. To swap the script for a real LLM agent,
hand `bridge.as_langchain_tools()` (or `bridge.as_openai_tools()`) to your
framework — see https://github.com/pramodthe/guidebridge#-framework-integrations
"""
import asyncio

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from guidebridge import AgentBridge

app = FastAPI(title="GuideBridge quickstart")
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1):\d+",
    allow_methods=["*"],
    allow_headers=["*"],
)

bridge = AgentBridge()                 # WebSocket endpoint at /agent/ws
app.include_router(bridge.router)


@app.get("/health")
async def health() -> dict:
    return {"ok": True, "sessions": bridge.sessions()}


# A fixed tour so the demo needs zero API keys. A real agent would decide these
# calls itself from bridge.as_langchain_tools() / as_openai_tools().
TOUR = [
    ("callout", {"target_id": "intro", "text": "Hi! I'm an agent driving this page.", "ms": 3200}),
    ("highlight", {"target_id": "star-button", "ms": 2500}),
    ("click", {"target_id": "star-button"}),
    ("click", {"target_id": "star-button"}),
    ("type_text", {"target_id": "name-input", "value": "GuideBridge"}),
    ("point_at", {"target_id": "save-button"}),
    ("callout", {"target_id": "save-button", "text": "I'll leave clicking Save to you :)", "ms": 3500}),
]


@app.post("/demo/tour")
async def demo_tour() -> dict:
    if bridge.get_session() is None:
        return {"started": False, "error": "no browser session connected"}

    async def run() -> None:
        for name, args in TOUR:
            await bridge.call_tool(name, args)
            await asyncio.sleep(1.3)

    asyncio.get_running_loop().create_task(run())
    return {"started": True, "steps": len(TOUR)}
PYEOF

# ---------------------------------------------------------------- frontend ---
cat > "$APP_DIR/frontend/package.json" <<'JSONEOF'
{
  "name": "guidebridge-quickstart",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build"
  },
  "dependencies": {
    "@guidebridge/react": "^0.2.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.3.0",
    "vite": "^5.4.0"
  }
}
JSONEOF

cat > "$APP_DIR/frontend/vite.config.js" <<'JSEOF'
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({ plugins: [react()] });
JSEOF

cat > "$APP_DIR/frontend/index.html" <<'HTMLEOF'
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>GuideBridge quickstart</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
HTMLEOF

cat > "$APP_DIR/frontend/src/main.jsx" <<'JSXEOF'
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
JSXEOF

cat > "$APP_DIR/frontend/src/App.jsx" <<'JSXEOF'
import { useState } from "react";
import {
  AgentProvider,
  AgentCursor,
  agentTarget,
  useAgentAction,
  useAgentBridge,
} from "@guidebridge/react";

function Status() {
  const { status } = useAgentBridge();
  const color = status === "connected" ? "#16a34a" : "#d97706";
  return <span style={{ color, fontWeight: 600, fontSize: 13 }}>● agent {status}</span>;
}

function Demo() {
  const [stars, setStars] = useState(0);
  const [name, setName] = useState("");
  const [saved, setSaved] = useState(false);

  // Custom actions: things the agent can do that a raw DOM event can't express.
  useAgentAction("reset_demo", "Reset the demo to its initial state", () => {
    setStars(0);
    setName("");
    setSaved(false);
    return { reset: true };
  });

  const card = {
    maxWidth: 460,
    margin: "60px auto",
    padding: 32,
    borderRadius: 16,
    background: "#fff",
    boxShadow: "0 4px 24px rgba(0,0,0,.08)",
    fontFamily: "system-ui, sans-serif",
  };
  const button = {
    padding: "10px 18px",
    borderRadius: 10,
    border: "none",
    background: "#2C50EE",
    color: "#fff",
    fontWeight: 600,
    cursor: "pointer",
  };

  return (
    <div style={{ background: "#f4f5fb", minHeight: "100vh" }}>
      <div style={card}>
        <div {...agentTarget("intro", { label: "Introduction" })}>
          <h1 style={{ marginTop: 0 }}>GuideBridge 🧭</h1>
          <p style={{ color: "#555" }}>
            This page is controllable by a Python agent. Press <b>Run demo tour</b> and
            watch the cursor click, type, and explain.
          </p>
          <Status />
        </div>

        <div style={{ margin: "24px 0", display: "flex", gap: 12, alignItems: "center" }}>
          <button
            {...agentTarget("star-button", { label: "Give a star" })}
            style={button}
            onClick={() => setStars((n) => n + 1)}
          >
            ⭐ Star
          </button>
          <span style={{ fontWeight: 700 }}>{stars} stars</span>
        </div>

        <label style={{ fontSize: 13, fontWeight: 600 }}>Your name</label>
        <input
          {...agentTarget("name-input", { label: "Name input" })}
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={{
            display: "block",
            width: "100%",
            boxSizing: "border-box",
            margin: "6px 0 16px",
            padding: "10px 12px",
            borderRadius: 10,
            border: "1px solid #ccd",
          }}
        />
        <button
          {...agentTarget("save-button", { label: "Save" })}
          style={{ ...button, background: saved ? "#16a34a" : "#2C50EE" }}
          onClick={() => setSaved(true)}
        >
          {saved ? "Saved ✓" : "Save"}
        </button>

        <hr style={{ margin: "24px 0", border: "none", borderTop: "1px solid #eee" }} />
        <button
          style={{ ...button, background: "#111" }}
          onClick={() => fetch("http://localhost:8000/demo/tour", { method: "POST" })}
        >
          ▶ Run demo tour
        </button>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <AgentProvider url="ws://localhost:8000/agent/ws">
      <AgentCursor label="Agent" />
      <Demo />
    </AgentProvider>
  );
}
JSXEOF

# ---------------------------------------------------------------- install ----
say "Installing backend (PyPI: guidebridge) into backend/.venv"
python3 -m venv "$APP_DIR/backend/.venv"
"$APP_DIR/backend/.venv/bin/pip" install --quiet --upgrade pip
"$APP_DIR/backend/.venv/bin/pip" install --quiet "guidebridge[fastapi]" "uvicorn[standard]"

say "Installing frontend (npm: @guidebridge/react)"
(cd "$APP_DIR/frontend" && npm install --no-fund --no-audit --loglevel=error)

say "Done! Run it:"
cat <<RUNEOF

  # terminal 1 — backend
  cd $APP_DIR/backend
  .venv/bin/uvicorn main:app --port 8000

  # terminal 2 — frontend
  cd $APP_DIR/frontend
  npm run dev

Then open http://localhost:5173 and press "▶ Run demo tour".
Next step: replace the scripted tour with a real agent —
  https://github.com/pramodthe/guidebridge#-framework-integrations
RUNEOF
