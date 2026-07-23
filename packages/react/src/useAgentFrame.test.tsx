// @vitest-environment jsdom
//
// Regression guard for the 0.2.0 -> 0.2.1 fix ("stop disposing the iframe relay
// on WS connect"). This is the one scenario main's frame.test.ts does NOT cover:
// it exercises FrameRelay only in isolation, never through useAgentFrame mounted
// under AgentProvider with a bridge-status flip.
//
// The 0.2.0 bug: `registerFrame` was an inline arrow inside AgentProvider's
// context `useMemo(..., [status, ...])`, and useAgentFrame memoized the relay
// while its effect depended on `[relay, registerFrame]`. When the WebSocket
// connected, `status` flipped -> the context value recomputed -> `registerFrame`
// identity churned -> the effect tore down and disposed the *reused* memoized
// relay, then re-registered that disposed instance. Every later observe/action
// then rejected with "frame relay disposed" and observe_page/highlight timed out.
//
// This test flips status to "connected" and asserts observe still round-trips.
// It FAILS against 0.2.0 (no gb:observe posted / error payload) and PASSES with
// the fix (stable registerFrame + relay created inside the effect).
import { afterEach, describe, expect, it, vi } from "vitest";
import { useRef } from "react";

// Capture the transport AgentProvider builds so the test can drive the status
// flip and inject server frames without a real WebSocket. `vi.hoisted` lets the
// container be referenced inside the (hoisted) vi.mock factory.
const hoisted = vi.hoisted(() => ({
  captured: null as null | {
    onStatus: (s: string) => void;
    onFrame: (f: unknown) => void;
    sent: any[];
  },
}));

vi.mock("./transport", () => {
  class BridgeTransport {
    sent: any[] = [];
    constructor(_url: string, opts: any) {
      hoisted.captured = {
        onStatus: opts.onStatus,
        onFrame: opts.onFrame,
        sent: this.sent,
      };
    }
    connect() {}
    send(frame: any) {
      this.sent.push(frame);
    }
    close() {}
  }
  return { BridgeTransport };
});

// Imported after the mock is registered (vi.mock is hoisted above these anyway).
import { render, act, cleanup } from "@testing-library/react";
import { AgentProvider } from "./AgentProvider";
import { useAgentFrame } from "./hooks";

/** Minimal stand-in for an iframe: FrameRelay only touches these two members. */
function makeFakeIframe(rect = { left: 100, top: 200, width: 800, height: 600 }) {
  const contentWindow = { postMessage: vi.fn() };
  const iframe = {
    contentWindow,
    getBoundingClientRect: () => ({
      ...rect,
      right: rect.left + rect.width,
      bottom: rect.top + rect.height,
      x: rect.left,
      y: rect.top,
      toJSON: () => ({}),
    }),
  } as unknown as HTMLIFrameElement;
  return { iframe, contentWindow };
}

/** Deliver an iframe->parent message with a spoofable source. */
function deliver(source: unknown, data: unknown) {
  const event = new MessageEvent("message", { data });
  Object.defineProperty(event, "source", { value: source });
  window.dispatchEvent(event);
}

/** Flush pending microtasks + timers inside act. */
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

function FrameHost({ iframe }: { iframe: HTMLIFrameElement }) {
  const ref = useRef<HTMLIFrameElement | null>(iframe);
  useAgentFrame(ref);
  return null;
}

describe("useAgentFrame under AgentProvider", () => {
  afterEach(() => {
    cleanup();
    hoisted.captured = null;
  });

  it("keeps the iframe relay alive across a WS status flip (observe still resolves)", async () => {
    const { iframe, contentWindow } = makeFakeIframe();

    await act(async () => {
      render(
        <AgentProvider url="ws://test/agent/ws" sessionId="s1">
          <FrameHost iframe={iframe} />
        </AgentProvider>
      );
    });

    // The relay registered during the mount effect and captured the transport.
    expect(hoisted.captured).toBeTruthy();
    const cap = hoisted.captured!;

    // The in-iframe runtime announces itself -> relay is ready (so onFrame skips
    // waitReady and observes immediately).
    act(() => {
      deliver(contentWindow, { gb: 1, type: "gb:ready", payload: { version: 1 } });
    });

    // THE REGRESSION TRIGGER: the WebSocket connects, flipping bridge status.
    act(() => {
      cap.onStatus("connected");
    });

    // The server asks the page to observe; this routes to the registered relay.
    await act(async () => {
      cap.onFrame({ type: "observe.request", requestId: "req-1" });
      await Promise.resolve();
    });

    // If the relay were disposed (0.2.0), request() rejects before posting, so no
    // gb:observe ever reaches the iframe.
    const observeMsg = contentWindow.postMessage.mock.calls
      .map((c) => c[0] as any)
      .filter((m) => m?.type === "gb:observe")
      .pop();
    expect(
      observeMsg,
      "relay should have posted gb:observe to the iframe (was it disposed on connect?)"
    ).toBeTruthy();

    // Answer with a snapshot and let the result propagate to the transport.
    const snapshot = {
      url: "/lesson",
      title: "Lesson",
      scrollY: 0,
      scrollHeight: 1000,
      viewportHeight: 800,
      targets: [],
      customActions: [],
      recentEvents: [],
    };
    deliver(contentWindow, {
      gb: 1,
      type: "gb:observe_result",
      requestId: observeMsg.requestId,
      payload: { snapshot },
    });
    await flush();

    // The bridge must receive the real snapshot — NOT { error: "frame relay disposed" }.
    const result = cap.sent.find(
      (f) => f.type === "observe.result" && f.requestId === "req-1"
    );
    expect(result, "observe.result should have been sent back to the bridge").toBeTruthy();
    expect(result.payload).toEqual(snapshot);
    expect(result.payload).not.toHaveProperty("error");
  });
});
