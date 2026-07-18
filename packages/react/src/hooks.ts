import { useEffect } from "react";
import { useAgentBridge } from "./AgentProvider";
import { CustomActionHandler } from "./registry";
import { TARGET_ATTR } from "./registry";

/**
 * Register an app-level action the agent can invoke by name, e.g. navigation
 * or anything a raw DOM event can't express:
 *
 *   useAgentAction("go_to_checkout", "Navigate to the checkout page", () => navigate("/checkout"));
 */
export function useAgentAction(
  name: string,
  description: string,
  handler: CustomActionHandler
): void {
  const { registerAction } = useAgentBridge();
  useEffect(() => registerAction(name, description, handler), [name, description]);
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
