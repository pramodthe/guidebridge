import { useRef, useState } from "react";
import {
  AgentProvider,
  AgentCursor,
  agentTarget,
  useAgentAction,
  useAgentBridge,
} from "@guidebridge/react";
import {
  cancelSpeech,
  createRecognition,
  Recognition,
  speak,
  sttSupported,
  ttsSupported,
} from "./speech";

const API = `http://${location.hostname}:8000`;

const PLANTS = [
  { id: "monstera", name: "Monstera Deliciosa", price: 42, emoji: "🪴" },
  { id: "fiddle", name: "Fiddle-Leaf Fig", price: 65, emoji: "🌿" },
  { id: "cactus", name: "Golden Barrel Cactus", price: 28, emoji: "🌵" },
];

const styles: Record<string, React.CSSProperties> = {
  page: {
    fontFamily: "system-ui, -apple-system, sans-serif",
    color: "#1e2a23",
    background: "#f6f8f4",
    minHeight: "100vh",
  },
  section: { maxWidth: 880, margin: "0 auto", padding: "56px 24px" },
  hero: {
    background: "linear-gradient(135deg, #14532d, #16a34a)",
    color: "#fff",
    borderRadius: 0,
  },
  grid: { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 20 },
  card: {
    background: "#fff",
    borderRadius: 16,
    padding: 20,
    boxShadow: "0 2px 12px rgba(20,60,40,.08)",
    textAlign: "center",
  },
  button: {
    background: "#16a34a",
    color: "#fff",
    border: "none",
    borderRadius: 10,
    padding: "10px 18px",
    font: "600 14px system-ui",
    cursor: "pointer",
  },
  field: {
    display: "block",
    width: "100%",
    boxSizing: "border-box",
    margin: "6px 0 16px",
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid #cfd8cf",
    font: "400 14px system-ui",
    background: "#fff",
  },
};

function StatusPill() {
  const { status } = useAgentBridge();
  const color = status === "connected" ? "#16a34a" : status === "connecting" ? "#d97706" : "#dc2626";
  return (
    <span style={{ color, font: "600 12px system-ui" }}>
      ● agent {status}
    </span>
  );
}

type ChatMsg = { role: "user" | "agent" | "error" | "tool"; text: string };

const EXAMPLES = [
  "What's your cheapest plant? Point it out.",
  "Add the Fiddle-Leaf Fig to my cart.",
  "Help me ask about shipping to Nepal.",
];

/** Human-readable label for a streamed tool call (AG-UI TOOL_CALL_START). */
function toolLabel(name?: string, args?: { target_id?: string } | null): string {
  const id = args && typeof args.target_id === "string" ? ` ${args.target_id}` : "";
  switch (name) {
    case "observe_page":
      return "🔍 Looking at the page…";
    case "point_at":
    case "highlight":
    case "callout":
      return `👉 Pointing out${id}`;
    case "click":
      return `👆 Clicking${id}`;
    case "type_text":
      return "⌨️ Typing…";
    case "select_option":
      return "🔽 Choosing an option…";
    case "scroll_to":
    case "scroll_by":
      return "📜 Scrolling…";
    case "drag":
      return "✋ Dragging…";
    case "app_action":
      return "⚙️ Running an action…";
    default:
      return `⋯ ${name ?? "working"}…`;
  }
}

function AgentChat() {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [voiceReplies, setVoiceReplies] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<Recognition | null>(null);

  function scrollLog() {
    requestAnimationFrame(() => {
      if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
    });
  }

  function appendAgentDelta(delta: string) {
    setMessages((m) => {
      const last = m[m.length - 1];
      if (last && last.role === "agent") {
        const copy = m.slice();
        copy[copy.length - 1] = { role: "agent", text: last.text + delta };
        return copy;
      }
      return [...m, { role: "agent", text: delta }];
    });
  }

  async function send(text: string, speakReply = voiceReplies) {
    const message = text.trim();
    if (!message || busy) return;
    cancelSpeech();
    setInput("");
    setMessages((m) => [...m, { role: "user", text: message }]);
    scrollLog();
    setBusy(true);
    let finalText = "";
    try {
      const res = await fetch(`${API}/demo/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
      if (!res.body) throw new Error("no stream");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let sep: number;
        while ((sep = buffer.indexOf("\n\n")) >= 0) {
          const frame = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          const dataLine = frame.split("\n").find((l) => l.startsWith("data:"));
          if (!dataLine) continue;
          let ev: { type?: string; delta?: string; text?: string; toolCallName?: string; args?: { target_id?: string }; message?: string };
          try {
            ev = JSON.parse(dataLine.slice(5).trim());
          } catch {
            continue;
          }
          if (ev.type === "TOOL_CALL_START") {
            setMessages((m) => [...m, { role: "tool", text: toolLabel(ev.toolCallName, ev.args) }]);
          } else if (ev.type === "TEXT_MESSAGE_CONTENT") {
            const d = ev.delta ?? "";
            finalText += d;
            appendAgentDelta(d);
          } else if (ev.type === "RUN_FINISHED") {
            if (ev.text) finalText = ev.text;
          } else if (ev.type === "RUN_ERROR") {
            setMessages((m) => [...m, { role: "error", text: ev.message ?? "Agent error" }]);
          }
          scrollLog();
        }
      }
    } catch {
      setMessages((m) => [...m, { role: "error", text: "Could not reach the backend." }]);
    } finally {
      setBusy(false);
      scrollLog();
      if (speakReply && finalText.trim()) speak(finalText);
    }
  }

  function startListening() {
    if (busy || listening) return;
    const rec = createRecognition();
    if (!rec) return;
    cancelSpeech();
    recognitionRef.current = rec;
    setListening(true);
    rec.onresult = (e) => {
      const transcript = e.results[0]?.[0]?.transcript ?? "";
      if (transcript.trim()) {
        setVoiceReplies(true); // a spoken question gets a spoken answer
        void send(transcript, true);
      }
    };
    rec.onerror = () => setListening(false);
    rec.onend = () => {
      setListening(false);
      recognitionRef.current = null;
    };
    try {
      rec.start();
    } catch {
      setListening(false);
    }
  }

  function stopListening() {
    recognitionRef.current?.stop();
    setListening(false);
  }

  function toggleVoiceReplies() {
    setVoiceReplies((v) => {
      if (v) cancelSpeech();
      return !v;
    });
  }

  async function runScriptedTour() {
    if (busy) return;
    setMessages((m) => [...m, { role: "user", text: "(scripted tour)" }]);
    setBusy(true);
    try {
      await fetch(`${API}/demo/tour`, { method: "POST" });
      setMessages((m) => [
        ...m,
        { role: "agent", text: "Running the fixed demo tour — watch the cursor." },
      ]);
    } finally {
      setTimeout(() => setBusy(false), 2000);
      scrollLog();
    }
  }

  return (
    <div
      style={{
        position: "fixed",
        right: 16,
        bottom: 16,
        zIndex: 1000,
        width: 340,
        background: "#fff",
        borderRadius: 16,
        boxShadow: "0 8px 32px rgba(0,0,0,.18)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        border: "1px solid #e4ebe4",
      }}
    >
      <div
        style={{
          padding: "10px 14px",
          borderBottom: "1px solid #eef2ee",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span style={{ font: "700 14px system-ui" }}>🌿 Store guide</span>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {ttsSupported && (
            <button
              onClick={toggleVoiceReplies}
              title={voiceReplies ? "Spoken replies on" : "Spoken replies off"}
              style={{
                border: "none",
                background: "transparent",
                cursor: "pointer",
                fontSize: 15,
                lineHeight: 1,
                opacity: voiceReplies ? 1 : 0.45,
              }}
            >
              {voiceReplies ? "🔊" : "🔇"}
            </button>
          )}
          <StatusPill />
        </div>
      </div>

      <div
        ref={logRef}
        style={{
          maxHeight: 260,
          minHeight: 96,
          overflowY: "auto",
          padding: "12px 14px",
          display: "flex",
          flexDirection: "column",
          gap: 8,
          background: "#f9fbf9",
        }}
      >
        {messages.length === 0 && (
          <div style={{ font: "400 13px system-ui", color: "#6b7c6f" }}>
            Ask the AI agent to do something on this page{sttSupported ? " — type or tap 🎤 to speak" : ""}.
            It can see the store and will move the cursor to carry it out. Try:
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
              {EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  onClick={() => send(ex)}
                  disabled={busy}
                  style={{
                    textAlign: "left",
                    border: "1px solid #d7e3d7",
                    background: "#fff",
                    borderRadius: 8,
                    padding: "7px 10px",
                    font: "500 12.5px system-ui",
                    color: "#14532d",
                    cursor: busy ? "default" : "pointer",
                  }}
                >
                  {ex}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) =>
          m.role === "tool" ? (
            <div
              key={i}
              style={{
                alignSelf: "flex-start",
                font: "500 11.5px system-ui",
                color: "#6b7c6f",
                padding: "0 2px",
              }}
            >
              {m.text}
            </div>
          ) : (
            <div
              key={i}
              style={{
                alignSelf: m.role === "user" ? "flex-end" : "flex-start",
                maxWidth: "85%",
                padding: "7px 11px",
                borderRadius: 12,
                font: "400 13px/1.4 system-ui",
                background:
                  m.role === "user" ? "#16a34a" : m.role === "error" ? "#fef2f2" : "#eef4ee",
                color: m.role === "user" ? "#fff" : m.role === "error" ? "#b91c1c" : "#1e2a23",
                border: m.role === "error" ? "1px solid #fca5a5" : "none",
              }}
            >
              {m.text}
            </div>
          )
        )}
        {busy && (
          <div style={{ alignSelf: "flex-start", font: "italic 12px system-ui", color: "#6b7c6f" }}>
            Agent is working…
          </div>
        )}
      </div>

      <div style={{ padding: 10, borderTop: "1px solid #eef2ee", display: "flex", gap: 8 }}>
        {sttSupported && (
          <button
            onClick={() => (listening ? stopListening() : startListening())}
            disabled={busy}
            title={listening ? "Listening — tap to stop" : "Speak to the agent"}
            style={{
              border: listening ? "1px solid #dc2626" : "1px solid #d7e3d7",
              background: listening ? "#fef2f2" : "#fff",
              borderRadius: 9,
              padding: "8px 11px",
              font: "500 14px system-ui",
              cursor: busy ? "default" : "pointer",
              opacity: busy ? 0.6 : 1,
              animation: listening ? "gb-pulse 1.1s ease-in-out infinite" : undefined,
            }}
          >
            {listening ? "●" : "🎤"}
          </button>
        )}
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") send(input);
          }}
          placeholder={listening ? "Listening…" : sttSupported ? "Type or 🎤 speak…" : "Tell the agent what to do…"}
          disabled={busy}
          style={{
            flex: 1,
            border: "1px solid #d7e3d7",
            borderRadius: 9,
            padding: "8px 10px",
            font: "400 13px system-ui",
            outline: "none",
          }}
        />
        <button
          style={{ ...styles.button, padding: "8px 14px", opacity: busy ? 0.6 : 1 }}
          onClick={() => send(input)}
          disabled={busy}
        >
          Send
        </button>
      </div>
      <style>{"@keyframes gb-pulse { 0%,100% { box-shadow: 0 0 0 0 rgba(220,38,38,.5) } 50% { box-shadow: 0 0 0 5px rgba(220,38,38,0) } }"}</style>

      <button
        onClick={runScriptedTour}
        disabled={busy}
        style={{
          border: "none",
          borderTop: "1px solid #eef2ee",
          background: "#fff",
          padding: "8px 14px",
          font: "500 12px system-ui",
          color: "#6b7c6f",
          cursor: busy ? "default" : "pointer",
          textAlign: "center",
        }}
      >
        or ▶ run the scripted tour (no API key)
      </button>
    </div>
  );
}

function Store() {
  const [cart, setCart] = useState<string[]>([]);
  const [form, setForm] = useState({ name: "", email: "", plant: "", message: "" });

  useAgentAction("clear_cart", "Empty the shopping cart", () => {
    setCart([]);
    return { cleared: true };
  });

  return (
    <div style={styles.page}>
      <section {...agentTarget("hero", { label: "Store introduction" })} style={{ ...styles.hero }}>
        <div style={styles.section}>
          <h1 style={{ font: "800 40px system-ui", margin: 0 }}>Sprout &amp; Stem 🌱</h1>
          <p style={{ font: "400 18px system-ui", opacity: 0.9, maxWidth: 520 }}>
            Houseplants delivered to your door. Talk to the AI guide in the corner — a real
            Claude agent that can see this page and drive it through <b>GuideBridge</b>.
            Ask it to find a plant, add it to your cart, or fill the form, and watch the cursor.
          </p>
          <span style={{ font: "600 14px system-ui" }}>🛒 Cart: {cart.length} item{cart.length === 1 ? "" : "s"}</span>
        </div>
      </section>

      <section {...agentTarget("products", { label: "Product list" })} style={styles.section}>
        <h2 style={{ font: "700 26px system-ui" }}>Our plants</h2>
        <div style={styles.grid}>
          {PLANTS.map((p) => (
            <div key={p.id} {...agentTarget(`product-${p.id}`, { label: p.name })} style={styles.card}>
              <div style={{ fontSize: 56 }}>{p.emoji}</div>
              <h3 style={{ font: "700 16px system-ui", margin: "8px 0 4px" }}>{p.name}</h3>
              <p style={{ font: "600 14px system-ui", color: "#16a34a" }}>${p.price}</p>
              <button
                {...agentTarget(`add-${p.id}`, { label: `Add ${p.name} to cart` })}
                style={styles.button}
                onClick={() => setCart((c) => [...c, p.id])}
              >
                Add to cart
              </button>
            </div>
          ))}
        </div>
      </section>

      <section {...agentTarget("contact", { label: "Contact form" })} style={{ ...styles.section, paddingTop: 8 }}>
        <h2 style={{ font: "700 26px system-ui" }}>Ask us anything</h2>
        <div style={{ ...styles.card, textAlign: "left", maxWidth: 520 }}>
          <label style={{ font: "600 13px system-ui" }}>Name</label>
          <input
            {...agentTarget("contact-name", { label: "Your name" })}
            style={styles.field}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <label style={{ font: "600 13px system-ui" }}>Email</label>
          <input
            {...agentTarget("contact-email", { label: "Your email" })}
            style={styles.field}
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
          <label style={{ font: "600 13px system-ui" }}>Which plant?</label>
          <select
            {...agentTarget("contact-plant", { label: "Plant of interest" })}
            style={styles.field}
            value={form.plant}
            onChange={(e) => setForm({ ...form, plant: e.target.value })}
          >
            <option value="">Choose…</option>
            {PLANTS.map((p) => (
              <option key={p.id} value={p.name}>{p.name}</option>
            ))}
          </select>
          <label style={{ font: "600 13px system-ui" }}>Message</label>
          <textarea
            {...agentTarget("contact-message", { label: "Your message" })}
            style={{ ...styles.field, minHeight: 80 }}
            value={form.message}
            onChange={(e) => setForm({ ...form, message: e.target.value })}
          />
          <button {...agentTarget("contact-send", { label: "Send message" })} style={styles.button}>
            Send message
          </button>
        </div>
      </section>
    </div>
  );
}

export default function App() {
  return (
    <AgentProvider url={`ws://${location.hostname}:8000/agent/ws`}>
      <AgentCursor label="Guide" color="#16a34a" />
      <AgentChat />
      <Store />
    </AgentProvider>
  );
}
