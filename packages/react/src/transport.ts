import { ClientFrame, ServerFrame } from "./protocol";

export type BridgeStatus = "connecting" | "connected" | "disconnected";

export interface TransportHandlers {
  onFrame: (frame: ServerFrame) => void;
  onStatus: (status: BridgeStatus) => void;
  buildHello: () => ClientFrame;
}

/** WebSocket client with exponential-backoff reconnect. */
export class BridgeTransport {
  private ws: WebSocket | null = null;
  private closed = false;
  private attempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private url: string,
    private handlers: TransportHandlers
  ) {}

  connect(): void {
    this.closed = false;
    this.open();
  }

  private open(): void {
    if (this.closed) return;
    this.handlers.onStatus("connecting");
    const ws = new WebSocket(this.url);
    this.ws = ws;

    ws.onopen = () => {
      this.attempt = 0;
      this.handlers.onStatus("connected");
      this.send(this.handlers.buildHello());
    };
    ws.onmessage = (e) => {
      let frame: ServerFrame;
      try {
        frame = JSON.parse(String(e.data));
      } catch {
        return;
      }
      if (frame && typeof frame.type === "string") this.handlers.onFrame(frame);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.handlers.onStatus("disconnected");
      this.scheduleReconnect();
    };
    ws.onerror = () => {
      ws.close();
    };
  }

  private scheduleReconnect(): void {
    if (this.closed) return;
    const delay = Math.min(15000, 500 * 2 ** this.attempt++);
    this.reconnectTimer = setTimeout(() => this.open(), delay);
  }

  send(frame: ClientFrame): boolean {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(frame));
      return true;
    }
    return false;
  }

  close(): void {
    this.closed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = null;
  }
}
