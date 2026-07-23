import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { PROTOCOL_VERSION, ServerFrame } from "./protocol";
import { BridgeRegistry, CustomActionHandler } from "./registry";
import { executeAction } from "./executor";
import { FrameRelay } from "./frame";
import { BridgeStatus, BridgeTransport } from "./transport";

export interface AgentBridgeContextValue {
  status: BridgeStatus;
  sessionId: string;
  registerAction: (
    name: string,
    description: string,
    handler: CustomActionHandler
  ) => () => void;
  /**
   * Register a sandboxed-iframe relay (see useAgentFrame). While a frame is
   * registered, ALL observe/action requests route to it instead of the
   * same-DOM registry/executor (exclusive, frame-wins). Returns unregister.
   */
  registerFrame: (relay: FrameRelay) => () => void;
}

const AgentBridgeContext = createContext<AgentBridgeContextValue | null>(null);

export function useAgentBridge(): AgentBridgeContextValue {
  const ctx = useContext(AgentBridgeContext);
  if (!ctx) throw new Error("useAgentBridge must be used inside <AgentProvider>");
  return ctx;
}

export interface AgentProviderProps {
  /** WebSocket URL of the guidebridge backend endpoint, e.g. ws://localhost:8000/agent/ws */
  url: string;
  /** Stable id for this browser session; defaults to "default". */
  sessionId?: string;
  /** Also expose undecorated buttons/inputs/links inside the provider (default true). */
  autoDiscover?: boolean;
  children: React.ReactNode;
}

export function AgentProvider({
  url,
  sessionId = "default",
  autoDiscover = true,
  children,
}: AgentProviderProps): React.ReactElement {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<FrameRelay | null>(null);
  const [status, setStatus] = useState<BridgeStatus>("connecting");

  const registry = useMemo(
    () => new BridgeRegistry(() => rootRef.current, autoDiscover),
    [autoDiscover]
  );

  // Stable across status flips. If this identity churns, useAgentFrame's effect
  // disposes the iframe FrameRelay and (in 0.2.0) reused the dead instance.
  const registerFrame = useCallback((relay: FrameRelay) => {
    frameRef.current = relay;
    return () => {
      if (frameRef.current === relay) frameRef.current = null;
    };
  }, []);

  useEffect(() => {
    const transport = new BridgeTransport(url, {
      buildHello: () => ({
        type: "hello",
        version: PROTOCOL_VERSION,
        sessionId,
        page: { url: window.location.href, title: document.title },
      }),
      onStatus: setStatus,
      onFrame: (frame: ServerFrame) => {
        const relay = frameRef.current; // frame-wins routing (read per request)
        if (frame.type === "observe.request") {
          if (relay) {
            void (async () => {
              try {
                if (!relay.ready) await relay.waitReady();
                const payload = await relay.snapshot();
                transport.send({
                  type: "observe.result",
                  requestId: frame.requestId,
                  payload,
                });
              } catch (e) {
                transport.send({
                  type: "observe.result",
                  requestId: frame.requestId,
                  payload: { error: (e as Error).message },
                });
              }
            })();
          } else {
            transport.send({
              type: "observe.result",
              requestId: frame.requestId,
              payload: registry.snapshot(),
            });
          }
        } else if (frame.type === "action.request") {
          const run = (async () => {
            if (relay) {
              if (!relay.ready) await relay.waitReady();
              return relay.executeAction(frame.action);
            }
            return executeAction(registry, frame.action);
          })();
          void run
            .catch((e) => ({ success: false, error: (e as Error).message }))
            .then((payload) =>
              transport.send({ type: "action.result", requestId: frame.requestId, payload })
            );
        }
      },
    });
    transport.connect();

    // Learner/user interaction capture → surfaced to the agent in snapshots.
    const root = rootRef.current;
    const onClick = (e: Event) => {
      const el = (e.target as Element | null)?.closest?.("button, a[href], [data-agent-target]");
      if (!el) return;
      registry.pushEvent({
        kind: "click",
        targetId: registry.idFor(el),
        label: (el as HTMLElement).innerText?.trim().slice(0, 60),
      });
    };
    const onInput = (e: Event) => {
      const el = e.target as HTMLInputElement | null;
      if (!el || !("value" in el)) return;
      registry.pushEvent({
        kind: "input",
        targetId: registry.idFor(el),
        value: String(el.value).slice(0, 60),
      });
    };
    root?.addEventListener("click", onClick, true);
    root?.addEventListener("input", onInput, true);

    return () => {
      root?.removeEventListener("click", onClick, true);
      root?.removeEventListener("input", onInput, true);
      transport.close();
    };
  }, [url, sessionId, registry]);

  const value = useMemo<AgentBridgeContextValue>(
    () => ({
      status,
      sessionId,
      registerAction: (name, description, handler) =>
        registry.registerAction(name, description, handler),
      registerFrame,
    }),
    [status, sessionId, registry, registerFrame]
  );

  return (
    <AgentBridgeContext.Provider value={value}>
      <div ref={rootRef} style={{ display: "contents" }}>
        {children}
      </div>
    </AgentBridgeContext.Provider>
  );
}
