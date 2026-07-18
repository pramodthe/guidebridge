import {
  CustomActionInfo,
  PageSnapshot,
  TargetInfo,
  TargetRole,
  UserEvent,
} from "./protocol";

export type CustomActionHandler = (
  args: Record<string, unknown>
) => unknown | Promise<unknown>;

interface CustomActionEntry {
  description: string;
  handler: CustomActionHandler;
}

const AUTO_ATTR = "data-gb-autoid";
export const TARGET_ATTR = "data-agent-target";
const LABEL_ATTR = "data-agent-label";

const MAX_TARGETS = 60;
const MAX_EVENTS = 15;

let autoN = 0;

function text(s: string | null | undefined, max: number): string {
  return (s || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function roleOf(el: Element): TargetRole {
  const tag = el.tagName.toLowerCase();
  if (tag === "button") return "button";
  if (tag === "a") return "link";
  if (tag === "select") return "select";
  if (tag === "textarea") return "textarea";
  if (tag === "input") {
    const t = (el as HTMLInputElement).type;
    if (t === "button" || t === "submit") return "button";
    if (t === "range") return "range";
    if (t === "checkbox" || t === "radio") return "checkbox";
    return "input";
  }
  if (tag === "section" || el.hasAttribute("data-agent-section")) return "section";
  return "other";
}

function labelOf(el: Element): string {
  const explicit =
    el.getAttribute(LABEL_ATTR) ||
    el.getAttribute("aria-label") ||
    el.getAttribute("placeholder") ||
    el.getAttribute("name");
  if (explicit) return text(explicit, 80);
  if (el.tagName.toLowerCase() === "input") {
    const id = el.getAttribute("id");
    if (id) {
      const lab = document.querySelector(`label[for="${CSS.escape(id)}"]`);
      if (lab) return text(lab.textContent, 80);
    }
  }
  const heading = el.querySelector("h1,h2,h3,h4");
  if (heading && roleOf(el) === "section") return text(heading.textContent, 80);
  return text((el as HTMLElement).innerText ?? el.textContent, 80);
}

function isVisible(el: Element): boolean {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < window.innerHeight;
}

/**
 * Registry of agent-visible targets and app-registered custom actions,
 * scoped to the AgentProvider's root element.
 */
export class BridgeRegistry {
  private customActions = new Map<string, CustomActionEntry>();
  private events: UserEvent[] = [];

  constructor(
    private getRoot: () => HTMLElement | null,
    private autoDiscover: boolean
  ) {}

  registerAction(name: string, description: string, handler: CustomActionHandler): () => void {
    this.customActions.set(name, { description, handler });
    return () => {
      if (this.customActions.get(name)?.handler === handler) this.customActions.delete(name);
    };
  }

  async runAction(name: string, args: Record<string, unknown>): Promise<unknown> {
    const entry = this.customActions.get(name);
    if (!entry) throw new Error(`no custom action registered: ${name}`);
    return await entry.handler(args);
  }

  pushEvent(evt: Omit<UserEvent, "at">): void {
    this.events.push({ ...evt, at: new Date().toISOString() });
    if (this.events.length > MAX_EVENTS) this.events.shift();
  }

  /** Elements the agent may see and act on. */
  private collectElements(): Element[] {
    const root = this.getRoot() ?? document.body;
    const selector = this.autoDiscover
      ? `[${TARGET_ATTR}], button, a[href], input, select, textarea`
      : `[${TARGET_ATTR}]`;
    return Array.from(root.querySelectorAll(selector)).slice(0, MAX_TARGETS);
  }

  /** Stable id for an element: explicit target name, DOM id, or assigned auto id. */
  idFor(el: Element): string {
    const explicit = el.getAttribute(TARGET_ATTR);
    if (explicit) return explicit;
    if (el.id) return el.id;
    let auto = el.getAttribute(AUTO_ATTR);
    if (!auto) {
      auto = `gb-${++autoN}`;
      el.setAttribute(AUTO_ATTR, auto);
    }
    return auto;
  }

  findTarget(id: string): Element | null {
    if (!id) return null;
    const esc = CSS.escape(id);
    return (
      document.querySelector(`[${TARGET_ATTR}="${esc}"]`) ||
      document.getElementById(id) ||
      document.querySelector(`[${AUTO_ATTR}="${esc}"]`)
    );
  }

  snapshot(): PageSnapshot {
    const targets: TargetInfo[] = this.collectElements().map((el) => {
      const info: TargetInfo = {
        id: this.idFor(el),
        role: roleOf(el),
        label: labelOf(el),
        visible: isVisible(el),
      };
      const anyEl = el as HTMLInputElement;
      if ("value" in anyEl && typeof anyEl.value === "string") {
        info.value = anyEl.value.slice(0, 80);
      }
      if ("disabled" in anyEl && anyEl.disabled) info.disabled = true;
      return info;
    });
    const customActions: CustomActionInfo[] = Array.from(this.customActions.entries()).map(
      ([name, entry]) => ({ name, description: entry.description })
    );
    return {
      url: window.location.href,
      title: text(document.title, 120),
      scrollY: Math.round(window.scrollY),
      scrollHeight: document.documentElement.scrollHeight,
      viewportHeight: window.innerHeight,
      targets,
      customActions,
      recentEvents: this.events.slice(),
    };
  }
}
