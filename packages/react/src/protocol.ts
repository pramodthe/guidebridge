/**
 * GuideBridge wire protocol v1.
 * Small JSON frames over a WebSocket between the host app (browser) and the
 * agent backend. Mirrored by the Pydantic models in the `guidebridge` pip package.
 */

export const PROTOCOL_VERSION = "1";

export type TargetRole =
  | "button"
  | "link"
  | "input"
  | "textarea"
  | "select"
  | "range"
  | "checkbox"
  | "section"
  | "other";

export interface TargetInfo {
  id: string;
  role: TargetRole;
  label: string;
  value?: string;
  disabled?: boolean;
  visible: boolean;
}

export interface UserEvent {
  kind: "click" | "input" | "change" | "navigate";
  targetId?: string;
  label?: string;
  value?: string;
  at: string;
}

export interface CustomActionInfo {
  name: string;
  description: string;
}

export interface PageSnapshot {
  url: string;
  title: string;
  scrollY: number;
  scrollHeight: number;
  viewportHeight: number;
  targets: TargetInfo[];
  customActions: CustomActionInfo[];
  recentEvents: UserEvent[];
}

export type AgentAction =
  | { type: "point"; targetId: string }
  | { type: "highlight"; targetId: string; ms?: number }
  | { type: "click"; targetId: string }
  | { type: "type"; targetId: string; value: string }
  | { type: "select_option"; targetId: string; value: string }
  | { type: "scroll_to"; targetId: string }
  | { type: "scroll_by"; direction: "up" | "down"; amount?: "page" | "half" }
  | { type: "drag"; targetId: string; toTargetId: string }
  | { type: "callout"; targetId: string; text: string; ms?: number }
  | { type: "custom"; name: string; args?: Record<string, unknown> };

export interface ActionResult {
  success: boolean;
  error?: string;
  [key: string]: unknown;
}

/** Frames the backend sends to the browser. */
export type ServerFrame =
  | { type: "observe.request"; requestId: string }
  | { type: "action.request"; requestId: string; action: AgentAction };

/** Frames the browser sends to the backend. */
export type ClientFrame =
  | {
      type: "hello";
      version: string;
      sessionId: string;
      page: { url: string; title: string };
    }
  | { type: "observe.result"; requestId: string; payload: PageSnapshot }
  | { type: "action.result"; requestId: string; payload: ActionResult }
  | { type: "event"; payload: UserEvent };
