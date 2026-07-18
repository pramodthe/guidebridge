import { useState } from "react";
import {
  AgentProvider,
  AgentCursor,
  agentTarget,
  useAgentAction,
  useAgentBridge,
} from "@guidebridge/react";

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

function DemoControls() {
  const [busy, setBusy] = useState(false);
  async function startTour() {
    setBusy(true);
    try {
      await fetch("http://localhost:8000/demo/tour", { method: "POST" });
    } finally {
      setTimeout(() => setBusy(false), 2000);
    }
  }
  return (
    <div
      style={{
        position: "fixed",
        right: 16,
        bottom: 16,
        zIndex: 1000,
        background: "#fff",
        borderRadius: 14,
        padding: "12px 16px",
        boxShadow: "0 4px 24px rgba(0,0,0,.15)",
        display: "flex",
        gap: 12,
        alignItems: "center",
      }}
    >
      <StatusPill />
      <button style={styles.button} onClick={startTour} disabled={busy}>
        {busy ? "Touring…" : "▶ Run agent tour"}
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
            Houseplants delivered to your door. This storefront is driven by a Python agent
            through <b>GuideBridge</b> — click “Run agent tour” and watch the cursor.
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
    <AgentProvider url="ws://localhost:8000/agent/ws">
      <AgentCursor label="Guide" color="#16a34a" />
      <DemoControls />
      <Store />
    </AgentProvider>
  );
}
