import { useEffect, useRef } from "react";
import { useAgentBridge } from "./AgentProvider";
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
