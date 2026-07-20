// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { FrameRelay } from "./frame";
import { getCursorState, hideCursor } from "./cursorStore";

/** Minimal stand-in for an iframe: FrameRelay only touches these two members. */
function makeFakeIframe(rect = { left: 100, top: 200, width: 800, height: 600 }) {
  const contentWindow = { postMessage: vi.fn() };
  const iframe = {
    contentWindow,
    getBoundingClientRect: () => ({ ...rect, right: rect.left + rect.width, bottom: rect.top + rect.height, x: rect.left, y: rect.top, toJSON: () => ({}) }),
  } as unknown as HTMLIFrameElement;
  return { iframe, contentWindow };
}

/** Deliver an iframe→parent message with a spoofable source. */
function deliver(source: unknown, data: unknown) {
  const event = new MessageEvent("message", { data });
  Object.defineProperty(event, "source", { value: source });
  window.dispatchEvent(event);
}

function lastPosted(contentWindow: { postMessage: ReturnType<typeof vi.fn> }) {
  const calls = contentWindow.postMessage.mock.calls;
  return calls[calls.length - 1]?.[0];
}

describe("FrameRelay", () => {
  it("round-trips observe through gb:observe/gb:observe_result", async () => {
    const { iframe, contentWindow } = makeFakeIframe();
    const ref = { current: iframe };
    const relay = new FrameRelay(ref, { timeoutMs: 500 });

    const promise = relay.snapshot();
    const sent = lastPosted(contentWindow);
    expect(sent.gb).toBe(1);
    expect(sent.type).toBe("gb:observe");
    expect(sent.requestId).toBeTruthy();

    const snapshot = { url: "/x", title: "t", scrollY: 0, scrollHeight: 1, viewportHeight: 1, targets: [], customActions: [], recentEvents: [] };
    deliver(contentWindow, { gb: 1, type: "gb:observe_result", requestId: sent.requestId, payload: { snapshot } });
    await expect(promise).resolves.toEqual(snapshot);
    relay.dispose();
  });

  it("round-trips actions and shows an optimistic cursor immediately", async () => {
    hideCursor();
    const { iframe, contentWindow } = makeFakeIframe();
    const relay = new FrameRelay({ current: iframe }, { timeoutMs: 500 });

    const promise = relay.executeAction({ type: "click", targetId: "gb-ctl-1" });
    expect(getCursorState().visible).toBe(true); // optimistic, before any reply

    const sent = lastPosted(contentWindow);
    expect(sent.type).toBe("gb:action");
    expect(sent.payload.action).toEqual({ type: "click", targetId: "gb-ctl-1" });
    deliver(contentWindow, { gb: 1, type: "gb:action_result", requestId: sent.requestId, payload: { success: true } });
    await expect(promise).resolves.toEqual({ success: true });
    relay.dispose();
  });

  it("rejects on timeout when the iframe never answers", async () => {
    const { iframe } = makeFakeIframe();
    const relay = new FrameRelay({ current: iframe }, { timeoutMs: 40 });
    await expect(relay.request("gb:observe")).rejects.toThrow("iframe did not respond");
    relay.dispose();
  });

  it("ignores messages from a stale contentWindow after remount", async () => {
    const a = makeFakeIframe();
    const ref = { current: a.iframe };
    const relay = new FrameRelay(ref, { timeoutMs: 120 });

    const promise = relay.request("gb:observe");
    const sent = lastPosted(a.contentWindow);

    // Remount: the iframe is replaced (new contentWindow identity).
    const b = makeFakeIframe();
    ref.current = b.iframe;

    // A late reply from the OLD document must be ignored...
    deliver(a.contentWindow, { gb: 1, type: "gb:observe_result", requestId: sent.requestId, payload: { snapshot: { bogus: true } } });
    await expect(promise).rejects.toThrow("iframe did not respond");
    relay.dispose();
  });

  it("re-arms ready on each fresh document announcement", () => {
    const { iframe, contentWindow } = makeFakeIframe();
    const ref = { current: iframe };
    const relay = new FrameRelay(ref, { timeoutMs: 100 });
    const seen: boolean[] = [];
    relay.subscribeReady((r) => seen.push(r));

    deliver(contentWindow, { gb: 1, type: "gb:ready", payload: { version: 1 } });
    expect(relay.ready).toBe(true);
    expect(seen).toEqual([true]);
    relay.dispose();
  });

  it("maps iframe-relative cursor coords to viewport coords", () => {
    hideCursor();
    const { iframe, contentWindow } = makeFakeIframe({ left: 100, top: 200, width: 800, height: 600 });
    const relay = new FrameRelay({ current: iframe }, { timeoutMs: 100 });

    deliver(contentWindow, { gb: 1, type: "gb:cursor", payload: { x: 50, y: 60, visible: true, click: false } });
    const cursor = getCursorState();
    expect(cursor.visible).toBe(true);
    expect(cursor.x).toBe(150); // 100 + 50
    expect(cursor.y).toBe(260); // 200 + 60

    deliver(contentWindow, { gb: 1, type: "gb:cursor", payload: { x: 0, y: 0, visible: false } });
    expect(getCursorState().visible).toBe(false);
    relay.dispose();
  });

  it("rejects pending requests on dispose", async () => {
    const { iframe } = makeFakeIframe();
    const relay = new FrameRelay({ current: iframe }, { timeoutMs: 5000 });
    const promise = relay.request("gb:observe");
    relay.dispose();
    await expect(promise).rejects.toThrow("disposed");
  });
});
