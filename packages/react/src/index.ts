export { AgentProvider, useAgentBridge } from "./AgentProvider";
export type { AgentProviderProps, AgentBridgeContextValue } from "./AgentProvider";
export { AgentCursor } from "./AgentCursor";
export type { AgentCursorProps } from "./AgentCursor";
export { useAgentAction, agentTarget } from "./hooks";
export { setCursorLabel } from "./cursorStore";
export type {
  AgentAction,
  ActionResult,
  PageSnapshot,
  TargetInfo,
  UserEvent,
  ServerFrame,
  ClientFrame,
} from "./protocol";
export { PROTOCOL_VERSION } from "./protocol";
