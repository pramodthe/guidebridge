import React, { useEffect, useState } from "react";
import { CursorState, getCursorState, subscribeCursor } from "./cursorStore";

export interface AgentCursorProps {
  /** Label shown in the pill next to the pointer. Default "Agent". */
  label?: string;
  /** Pointer + pill color. Default cobalt. */
  color?: string;
}

/**
 * Visible pointer showing what the agent is doing. Render once, anywhere
 * inside your app (it positions itself with position:fixed).
 */
export function AgentCursor({
  label = "Agent",
  color = "#2C50EE",
}: AgentCursorProps): React.ReactElement | null {
  const [cursor, setCursor] = useState<CursorState>(getCursorState());
  const [pulse, setPulse] = useState(0);

  useEffect(
    () =>
      subscribeCursor((state) => {
        setCursor(state);
        if (state.click && state.visible) setPulse((n) => n + 1);
      }),
    []
  );

  if (!cursor.visible) return null;

  return (
    <div
      aria-hidden
      style={{
        position: "fixed",
        left: cursor.x,
        top: cursor.y,
        zIndex: 2147483646,
        pointerEvents: "none",
        transform: "translate(-2px, -2px)",
        transition:
          "left 0.4s cubic-bezier(0.22, 1, 0.36, 1), top 0.4s cubic-bezier(0.22, 1, 0.36, 1)",
        willChange: "left, top",
        filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.35))",
      }}
    >
      <div style={{ position: "relative", width: 28, height: 28 }}>
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path
            d="M5.5 3.5L19 12.2L12.4 13.6L9.8 20.5L5.5 3.5Z"
            fill={color}
            stroke="#fff"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
        </svg>
        {cursor.click && (
          <span
            key={pulse}
            style={{
              position: "absolute",
              left: 4,
              top: 4,
              width: 20,
              height: 20,
              borderRadius: "50%",
              border: `2px solid ${color}99`,
              animation: "gb-ping 0.7s cubic-bezier(0, 0, 0.2, 1) 2",
            }}
          />
        )}
        <span
          style={{
            position: "absolute",
            left: 20,
            top: 18,
            whiteSpace: "nowrap",
            borderRadius: 999,
            background: color,
            padding: "3px 8px",
            font: "700 11px/1.3 system-ui, -apple-system, sans-serif",
            letterSpacing: "0.02em",
            color: "#fff",
            boxShadow: `0 2px 10px ${color}66`,
          }}
        >
          {label}
        </span>
      </div>
      <style>
        {`@keyframes gb-ping { 0% { transform: scale(1); opacity: 1; } 75%, 100% { transform: scale(2.2); opacity: 0; } }`}
      </style>
    </div>
  );
}
