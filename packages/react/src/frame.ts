/**
 * Sandboxed-iframe mode: parent-side relay to the in-iframe runtime
 * (injected server-side via the pip package's `guidebridge.iframe`).
 *
 * The iframe has an opaque origin (`sandbox="allow-scripts"`), so identity is
 * `event.source === iframeRef.current?.contentWindow` — evaluated at event
 * time, which makes frequent iframe remounts self-healing — and all posts use
 * `targetOrigin "*"`. Envelope: `{gb: 1, type, requestId?, payload?}`.
 */

import { RefObject } from "react";
import { ActionResult, AgentAction, PageSnapshot } from "./protocol";
import { showCursor, hideCursor, showCursorAt } from "./cursorStore";

const GB = 1;
const READY_PING_ATTEMPTS = 5;
const READY_PING_INTERVAL_MS = 2500;

export interface FrameRelayOptions {
  /** Per-request timeout (default 4000ms). */
  timeoutMs?: number;
}

interface GbFrame {
  gb: number;
  type: string;
  requestId?: string;
  payload?: any;
}

let seq = 0;

export class FrameRelay {
  private pending = new Map<
    string,
    { resolve: (v: any) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }
  >();
  private timeoutMs: number;
  private disposed = false;
  private readyFlag = false;
  private readyListeners = new Set<(ready: boolean) => void>();
  private onWindowMessage: (e: MessageEvent) => void;

  constructor(
    private iframeRef: RefObject<HTMLIFrameElement | null>,
    opts: FrameRelayOptions = {}
  ) {
    this.timeoutMs = opts.timeoutMs ?? 4000;
    this.onWindowMessage = (e: MessageEvent) => {
      const iframe = this.iframeRef.current;
      if (!iframe || e.source !== iframe.contentWindow) return; // only OUR iframe
      const d = e.data as GbFrame | undefined;
      if (!d || d.gb !== GB || typeof d.type !== "string") return;

      if (d.type === "gb:ready") {
        // Every fresh document (initial load or remount) announces itself.
        this.setReady(true);
      } else if (d.type === "gb:cursor") {
        this.forwardCursor(d.payload);
      }

      if (d.requestId && this.pending.has(d.requestId)) {
        const entry = this.pending.get(d.requestId)!;
        this.pending.delete(d.requestId);
        clearTimeout(entry.timer);
        entry.resolve(d.payload);
      }
    };
    window.addEventListener("message", this.onWindowMessage);
  }

  get ready(): boolean {
    return this.readyFlag;
  }

  subscribeReady(listener: (ready: boolean) => void): () => void {
    this.readyListeners.add(listener);
    return () => this.readyListeners.delete(listener);
  }

  private setReady(value: boolean) {
    if (this.readyFlag === value) return;
    this.readyFlag = value;
    this.readyListeners.forEach((l) => l(value));
  }

  /** Iframe-viewport coords → viewport coords for the fixed-position AgentCursor. */
  private forwardCursor(p: any) {
    if (!p || typeof p.x !== "number" || typeof p.y !== "number") return;
    if (!p.visible) {
      hideCursor();
      return;
    }
    const rect = this.iframeRef.current?.getBoundingClientRect();
    if (!rect) return;
    showCursor(rect.left + p.x, rect.top + p.y, { click: !!p.click, holdMs: 3600 });
  }

  private post(frame: GbFrame): boolean {
    const target = this.iframeRef.current?.contentWindow;
    if (!target) return false;
    target.postMessage(frame, "*"); // opaque origin: "*" is the only option
    return true;
  }

  request<T = any>(type: string, payload?: unknown, timeoutMs = this.timeoutMs): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (this.disposed) {
        reject(new Error("frame relay disposed"));
        return;
      }
      const requestId = `gb_${Date.now().toString(36)}_${++seq}`;
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error("iframe did not respond"));
      }, timeoutMs);
      this.pending.set(requestId, { resolve, reject, timer });
      if (!this.post({ gb: GB, type, requestId, payload })) {
        this.pending.delete(requestId);
        clearTimeout(timer);
        reject(new Error("iframe not available"));
      }
    });
  }

  /**
   * Wait for the in-iframe runtime to answer a ping — retries because the
   * iframe may still be loading (or was just remounted).
   */
  async waitReady(): Promise<boolean> {
    for (let attempt = 0; attempt < READY_PING_ATTEMPTS; attempt++) {
      try {
        await this.request("gb:ping", undefined, 1200);
        this.setReady(true);
        return true;
      } catch {
        if (this.disposed) return false;
        await new Promise((r) => setTimeout(r, READY_PING_INTERVAL_MS));
      }
    }
    return false;
  }

  async snapshot(): Promise<PageSnapshot> {
    const payload = await this.request<{ snapshot?: PageSnapshot; error?: string }>("gb:observe");
    if (!payload?.snapshot) throw new Error(payload?.error ?? "no snapshot");
    return payload.snapshot;
  }

  async executeAction(action: AgentAction): Promise<ActionResult> {
    // Optimistic cursor: show motion immediately; the runtime's gb:cursor
    // frames refine the position once the action starts in-iframe.
    const iframe = this.iframeRef.current;
    if (iframe) {
      const rect = iframe.getBoundingClientRect();
      showCursor(rect.left + rect.width * 0.5, rect.top + rect.height * 0.45, { holdMs: 3600 });
    }
    const payload = await this.request<ActionResult>(
      "gb:action",
      { action },
      Math.max(this.timeoutMs, 6000) // actions include cursor-lead delays
    );
    return payload ?? { success: false, error: "no result" };
  }

  dispose(): void {
    this.disposed = true;
    window.removeEventListener("message", this.onWindowMessage);
    this.pending.forEach((entry) => {
      clearTimeout(entry.timer);
      entry.reject(new Error("frame relay disposed"));
    });
    this.pending.clear();
    this.readyListeners.clear();
  }
}

// re-export for convenience of hosts that only want cursor plumbing
export { showCursorAt };
