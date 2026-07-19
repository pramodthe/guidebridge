import { useEffect, useRef, useState } from "react";
import {
  AgentProvider,
  AgentCursor,
  agentTarget,
  useAgentAction,
  useAgentBridge,
} from "@guidebridge/react";

type Mark = "X" | "O" | null;

const API = "http://localhost:8010";
const WIN_LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];

function calculateWinner(board: Mark[]): Mark {
  for (const [a, b, c] of WIN_LINES) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) return board[a];
  }
  return null;
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    fontFamily: "system-ui, -apple-system, sans-serif",
    color: "#1e1b2e",
    background: "#f4f1fb",
    minHeight: "100vh",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    padding: "48px 24px",
  },
  card: {
    background: "#fff",
    borderRadius: 20,
    padding: 32,
    boxShadow: "0 4px 24px rgba(76, 29, 149, 0.1)",
    textAlign: "center",
    width: "100%",
    maxWidth: 420,
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(3, 1fr)",
    gap: 10,
    margin: "20px auto",
    width: 300,
  },
  cell: {
    width: 92,
    height: 92,
    fontSize: 40,
    fontWeight: 800,
    border: "none",
    borderRadius: 14,
    background: "#f1edfb",
    cursor: "pointer",
    color: "#4c1d95",
  },
  button: {
    background: "#7c3aed",
    color: "#fff",
    border: "none",
    borderRadius: 10,
    padding: "10px 18px",
    font: "600 14px system-ui",
    cursor: "pointer",
  },
};

function StatusPill() {
  const { status } = useAgentBridge();
  const color = status === "connected" ? "#16a34a" : status === "connecting" ? "#d97706" : "#dc2626";
  return <span style={{ color, font: "600 12px system-ui" }}>● agent {status}</span>;
}

function cellLabel(mark: Mark, index: number): string {
  const pos = `row ${Math.floor(index / 3) + 1}, col ${(index % 3) + 1}`;
  return mark ? `Cell at ${pos}, taken by ${mark}` : `Cell at ${pos}, empty`;
}

function Board() {
  const [board, setBoard] = useState<Mark[]>(Array(9).fill(null));
  const [turnX, setTurnX] = useState(true); // human is always X and moves first
  const movingRef = useRef(false);

  const winner = calculateWinner(board);
  const full = board.every((c) => c !== null);
  const gameOver = !!winner || full;

  useAgentAction("get_game_state", "Read the tic-tac-toe board, whose turn it is, and the winner if any", () => ({
    board,
    turn: turnX ? "X" : "O",
    winner,
    full,
  }));

  useAgentAction("reset_game", "Start a new tic-tac-toe game", () => {
    setBoard(Array(9).fill(null));
    setTurnX(true);
    movingRef.current = false;
    return { reset: true };
  });

  // Whenever it becomes the agent's (O) turn, ask the backend to play.
  useEffect(() => {
    if (turnX || gameOver || movingRef.current) return;
    movingRef.current = true;
    fetch(`${API}/agent/move`, { method: "POST" })
      .catch(() => null)
      .finally(() => {
        movingRef.current = false;
      });
  }, [turnX, gameOver]);

  function playCell(i: number) {
    if (gameOver || board[i]) return;
    const next = board.slice();
    next[i] = turnX ? "X" : "O";
    setBoard(next);
    setTurnX(!turnX);
  }

  function newGame() {
    setBoard(Array(9).fill(null));
    setTurnX(true);
    movingRef.current = false;
  }

  let status: string;
  if (winner) status = winner === "X" ? "You win! 🎉" : "Agent wins — try again!";
  else if (full) status = "Draw.";
  else if (turnX) status = "Your turn (X)";
  else status = "Agent is thinking (O)…";

  return (
    <div style={styles.card}>
      <h1 style={{ font: "800 28px system-ui", margin: "0 0 4px" }}>Tic-Tac-Toe</h1>
      <p style={{ font: "400 14px system-ui", color: "#6b21a8", margin: "0 0 8px" }}>
        You are X. The <b>O</b> player is a Python agent playing perfect minimax through
        GuideBridge's <code>click</code> tool — watch the cursor.
      </p>
      <StatusPill />
      <p style={{ font: "700 16px system-ui", margin: "12px 0" }}>{status}</p>
      <div
        {...agentTarget("board", { label: "Tic-tac-toe board" })}
        style={{ ...styles.grid, pointerEvents: turnX && !gameOver ? "auto" : "none" }}
      >
        {board.map((mark, i) => (
          <button
            key={i}
            {...agentTarget(`cell-${i}`, { label: cellLabel(mark, i) })}
            style={{
              ...styles.cell,
              color: mark === "X" ? "#4c1d95" : "#0891b2",
              opacity: mark ? 1 : 0.9,
            }}
            onClick={() => playCell(i)}
          >
            {mark}
          </button>
        ))}
      </div>
      <button {...agentTarget("new-game", { label: "Start a new game" })} style={styles.button} onClick={newGame}>
        New game
      </button>
    </div>
  );
}

export default function App() {
  return (
    <AgentProvider url={`ws://${location.hostname}:8010/agent/ws`}>
      <AgentCursor label="Agent" color="#7c3aed" />
      <div style={styles.page}>
        <Board />
      </div>
    </AgentProvider>
  );
}
