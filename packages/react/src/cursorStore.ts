/**
 * Tiny pub/sub store for the visible agent cursor. Module-level so the
 * executor (plain TS) and <AgentCursor/> (React) share state without context.
 */

export interface CursorState {
  x: number;
  y: number;
  visible: boolean;
  click: boolean;
  label: string;
}

type Listener = (state: CursorState) => void;

let state: CursorState = { x: 0, y: 0, visible: false, click: false, label: "Agent" };
const listeners = new Set<Listener>();
let hideTimer: ReturnType<typeof setTimeout> | null = null;

export function getCursorState(): CursorState {
  return state;
}

export function subscribeCursor(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function emit(next: Partial<CursorState>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l(state));
}

export function setCursorLabel(label: string): void {
  emit({ label });
}

/**
 * Move the cursor to viewport coordinates and keep it visible for holdMs
 * (default 3200ms) before fading out.
 */
export function showCursor(
  x: number,
  y: number,
  opts: { click?: boolean; holdMs?: number } = {}
): void {
  const pad = 12;
  const w = typeof window !== "undefined" ? window.innerWidth : 1280;
  const h = typeof window !== "undefined" ? window.innerHeight : 800;
  emit({
    x: Math.max(pad, Math.min(w - pad, x)),
    y: Math.max(pad, Math.min(h - pad, y)),
    visible: true,
    click: !!opts.click,
  });
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = setTimeout(() => emit({ visible: false, click: false }), opts.holdMs ?? 3200);
}

export function hideCursor(): void {
  if (hideTimer) clearTimeout(hideTimer);
  emit({ visible: false, click: false });
}

/** Move the cursor onto an element (upper-middle area, like a human would aim). */
export function showCursorAt(el: Element, opts: { click?: boolean; holdMs?: number } = {}): void {
  const r = el.getBoundingClientRect();
  const x = r.left + Math.max(12, Math.min(r.width * 0.5, r.width - 8));
  const y = r.top + Math.max(8, Math.min(r.height * 0.4, 40));
  showCursor(x, y, opts);
}
