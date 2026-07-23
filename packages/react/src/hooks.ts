import { RefObject, useEffect, useMemo, useRef, useState } from "react";
import { useAgentBridge } from "./AgentProvider";
import { FrameRelay, FrameRelayOptions } from "./frame";
import { PageSnapshot } from "./protocol";
import { CustomActionHandler } from "./registry";
import { TARGET_ATTR } from "./registry";

/**
 * Register an app-level action the agent can invoke by name, e.g. navigation
 * or anything a raw DOM event can't express:
 *
 *   useAgentAction("go_to_checkout", "Navigate to the checkout page", () => navigate("/checkout"));
 *
 * `handler` is typically an inline closure over component state/props, so it's a new
 * function every render. Only `name`/`description` changing re-registers the action;
 * the latest `handler` is always called via a ref, so callers don't need to memoize it
 * and the invoked closure never goes stale.
 */
export function useAgentAction(
  name: string,
  description: string,
  handler: CustomActionHandler
): void {
  const { registerAction } = useAgentBridge();
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(
    () => registerAction(name, description, (args) => handlerRef.current(args)),
    [name, description, registerAction]
  );
}

/**
 * Sandboxed-iframe mode: route the agent's observe/act at a content iframe
 * whose HTML was server-side injected with the guidebridge iframe runtime
 * (pip: `guidebridge.iframe.inject_iframe_runtime`).
 *
 *   const iframeRef = useRef<HTMLIFrameElement>(null);
 *   const { snapshot, ready } = useAgentFrame(iframeRef);
 *   <iframe ref={iframeRef} sandbox="allow-scripts" src={artifactUrl} />
 *
 * While mounted, ALL agent page-control routes to the iframe (frame-wins);
 * the same-DOM registry/executor resumes when the hook unmounts. `snapshot()`
 * lets the host app read the page for its own purposes (e.g. LLM context).
 * Survives iframe remounts: identity is re-read per message, and the relay
 * re-arms on each fresh document's ready announcement.
 *
 * The relay is created inside the effect (not useMemo) so a re-register never
 * reuses a disposed instance. In 0.2.0, memoizing the relay + disposing it when
 * `registerFrame` identity churned on WS `connected` left observe/act dead.
 */
export function useAgentFrame(
  iframeRef: RefObject<HTMLIFrameElement | null>,
  opts: FrameRelayOptions = {}
): { snapshot: () => Promise<PageSnapshot>; ready: boolean } {
  const { registerFrame } = useAgentBridge();
  const [ready, setReady] = useState(false);
  const timeoutMs = opts.timeoutMs;
  const relayRef = useRef<FrameRelay | null>(null);

  useEffect(() => {
    const relay = new FrameRelay(iframeRef, { timeoutMs });
    relayRef.current = relay;
    const unregister = registerFrame(relay);
    const unsubscribe = relay.subscribeReady(setReady);
    setReady(relay.ready);
    void relay.waitReady();
    return () => {
      unsubscribe();
      unregister();
      relay.dispose();
      if (relayRef.current === relay) relayRef.current = null;
    };
  }, [iframeRef, timeoutMs, registerFrame]);

  return useMemo(
    () => ({
      snapshot: () => {
        const relay = relayRef.current;
        if (!relay) return Promise.reject(new Error("frame relay not ready"));
        return relay.snapshot();
      },
      ready,
    }),
    [ready]
  );
}

/**
 * Spread-props helper that marks an element as an agent target with a stable name:
 *
 *   <button {...agentTarget("checkout")}>Buy now</button>
 */
export function agentTarget(
  name: string,
  opts: { label?: string } = {}
): Record<string, string> {
  const props: Record<string, string> = { [TARGET_ATTR]: name };
  if (opts.label) props["data-agent-label"] = opts.label;
  return props;
}
