import { AgentAction, ActionResult } from "./protocol";
import { BridgeRegistry } from "./registry";
import { showCursor, showCursorAt } from "./cursorStore";

const CURSOR_LEAD_MS = 450; // cursor arrives before the action fires, so intent reads first
const HIGHLIGHT_COLOR = "#2C50EE";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function fail(error: string): ActionResult {
  return { success: false, error };
}

/**
 * Set a value on an input/textarea/select through the native prototype setter,
 * then dispatch input/change. Assigning `.value` directly is swallowed by
 * React's internal value tracker; this path makes controlled components update.
 */
function setNativeValue(el: Element, value: string): void {
  const proto =
    el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : el instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) setter.call(el, value);
  else (el as HTMLInputElement).value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

/**
 * Full pointer/mouse sequence rather than bare .click(): components often
 * listen on pointerdown/mousedown and ignore a lone synthetic click.
 */
function synthClick(el: Element): void {
  const opts = { bubbles: true, cancelable: true, view: window };
  try {
    if (window.PointerEvent) el.dispatchEvent(new PointerEvent("pointerdown", opts));
    el.dispatchEvent(new MouseEvent("mousedown", opts));
    if (window.PointerEvent) el.dispatchEvent(new PointerEvent("pointerup", opts));
    el.dispatchEvent(new MouseEvent("mouseup", opts));
  } catch {
    /* pointer events unsupported */
  }
  (el as HTMLElement).click?.();
}

let activeHighlight: { el: HTMLElement; outline: string; offset: string; timer: number } | null =
  null;

function applyHighlight(el: HTMLElement, ms: number): void {
  clearHighlight();
  activeHighlight = {
    el,
    outline: el.style.outline,
    offset: el.style.outlineOffset,
    timer: window.setTimeout(clearHighlight, Math.min(ms, 10000)),
  };
  el.style.outline = `3px solid ${HIGHLIGHT_COLOR}`;
  el.style.outlineOffset = "4px";
}

function clearHighlight(): void {
  if (!activeHighlight) return;
  activeHighlight.el.style.outline = activeHighlight.outline;
  activeHighlight.el.style.outlineOffset = activeHighlight.offset;
  clearTimeout(activeHighlight.timer);
  activeHighlight = null;
}

let activeCallout: HTMLElement | null = null;

function showCallout(target: Element, textContent: string, ms: number): void {
  activeCallout?.remove();
  const r = target.getBoundingClientRect();
  const el = document.createElement("div");
  el.setAttribute("aria-hidden", "true");
  el.textContent = textContent;
  // Place above the target unless it sits near the viewport top — then below.
  const above = r.top > 96;
  el.style.cssText = [
    "position:fixed",
    "z-index:2147483645",
    "max-width:280px",
    `left:${Math.min(window.innerWidth - 300, Math.max(12, r.left))}px`,
    `top:${above ? r.top - 8 : Math.max(12, r.top + 24)}px`,
    above ? "transform:translateY(-100%)" : "transform:none",
    `background:${HIGHLIGHT_COLOR}`,
    "color:#fff",
    "padding:8px 12px",
    "border-radius:10px",
    "font:600 13px/1.4 system-ui,-apple-system,sans-serif",
    "box-shadow:0 4px 18px rgba(44,80,238,.35)",
    "pointer-events:none",
  ].join(";");
  document.body.appendChild(el);
  activeCallout = el;
  setTimeout(() => {
    if (activeCallout === el) {
      el.remove();
      activeCallout = null;
    }
  }, Math.min(ms, 15000));
}

async function animateTyping(el: Element, value: string): Promise<void> {
  const total = Math.min(900, Math.max(120, value.length * 25));
  const step = value.length ? total / value.length : 0;
  (el as HTMLElement).focus?.();
  for (let i = 1; i <= value.length; i++) {
    setNativeValue(el, value.slice(0, i));
    if (step > 4) await sleep(step);
  }
}

async function animateDrag(from: Element, to: Element): Promise<void> {
  const a = from.getBoundingClientRect();
  const b = to.getBoundingClientRect();
  const start = { x: a.left + a.width / 2, y: a.top + a.height / 2 };
  const end = { x: b.left + b.width / 2, y: b.top + b.height / 2 };
  const opts = { bubbles: true, cancelable: true, view: window };

  showCursor(start.x, start.y, { click: true, holdMs: 4000 });
  if (window.PointerEvent) {
    from.dispatchEvent(
      new PointerEvent("pointerdown", { ...opts, clientX: start.x, clientY: start.y })
    );
  }
  from.dispatchEvent(new MouseEvent("mousedown", { ...opts, clientX: start.x, clientY: start.y }));
  from.dispatchEvent(new DragEvent("dragstart", { ...opts, clientX: start.x, clientY: start.y }));

  const steps = 12;
  for (let i = 1; i <= steps; i++) {
    const x = start.x + ((end.x - start.x) * i) / steps;
    const y = start.y + ((end.y - start.y) * i) / steps;
    showCursor(x, y, { holdMs: 4000 });
    const over = document.elementFromPoint(x, y) ?? to;
    if (window.PointerEvent) {
      over.dispatchEvent(new PointerEvent("pointermove", { ...opts, clientX: x, clientY: y }));
    }
    over.dispatchEvent(new MouseEvent("mousemove", { ...opts, clientX: x, clientY: y }));
    over.dispatchEvent(new DragEvent("dragover", { ...opts, clientX: x, clientY: y }));
    await sleep(28);
  }

  to.dispatchEvent(new DragEvent("drop", { ...opts, clientX: end.x, clientY: end.y }));
  if (window.PointerEvent) {
    to.dispatchEvent(new PointerEvent("pointerup", { ...opts, clientX: end.x, clientY: end.y }));
  }
  to.dispatchEvent(new MouseEvent("mouseup", { ...opts, clientX: end.x, clientY: end.y }));
  from.dispatchEvent(new DragEvent("dragend", { ...opts, clientX: end.x, clientY: end.y }));
  showCursor(end.x, end.y, { click: true });
}

export async function executeAction(
  registry: BridgeRegistry,
  action: AgentAction
): Promise<ActionResult> {
  switch (action.type) {
    case "scroll_by": {
      const dir = action.direction === "up" ? -1 : 1;
      const frac = action.amount === "half" ? 0.5 : 0.85;
      showCursor(window.innerWidth * 0.5, window.innerHeight * (dir < 0 ? 0.28 : 0.72), {
        holdMs: 2000,
      });
      await sleep(250);
      window.scrollBy({ top: dir * window.innerHeight * frac, behavior: "smooth" });
      await sleep(450); // let the smooth scroll progress so reported scrollY is meaningful
      return { success: true, scrollY: Math.round(window.scrollY) };
    }
    case "custom": {
      try {
        const result = await registry.runAction(action.name, action.args ?? {});
        return { success: true, result: result ?? null };
      } catch (e) {
        return fail((e as Error).message);
      }
    }
    default:
      break;
  }

  const el = registry.findTarget(action.targetId);
  if (!el) return fail(`target not found: ${action.targetId}`);
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  showCursorAt(el, { holdMs: 3600 });
  await sleep(CURSOR_LEAD_MS);
  if (!el.isConnected) return fail("target disappeared");
  showCursorAt(el, { holdMs: 3600 }); // re-aim after the scroll settled

  switch (action.type) {
    case "point":
    case "scroll_to":
      return { success: true };
    case "highlight":
      applyHighlight(el as HTMLElement, action.ms ?? 3200);
      return { success: true };
    case "callout":
      applyHighlight(el as HTMLElement, action.ms ?? 4500);
      showCallout(el, action.text, action.ms ?? 4500);
      return { success: true };
    case "click":
      synthClick(el);
      showCursorAt(el, { click: true });
      return { success: true };
    case "type": {
      if (!("value" in el)) return fail("target does not accept text");
      await animateTyping(el, action.value);
      showCursorAt(el, { click: true });
      return { success: true };
    }
    case "select_option": {
      if (!(el instanceof HTMLSelectElement)) return fail("target is not a select");
      const match = Array.from(el.options).find(
        (o) =>
          o.value === action.value ||
          o.label.toLowerCase() === action.value.toLowerCase()
      );
      if (!match) return fail(`option not found: ${action.value}`);
      setNativeValue(el, match.value);
      showCursorAt(el, { click: true });
      return { success: true };
    }
    case "drag": {
      const to = registry.findTarget(action.toTargetId);
      if (!to) return fail(`drop target not found: ${action.toTargetId}`);
      await animateDrag(el, to);
      return { success: true };
    }
    default:
      return fail(`unknown action type: ${(action as AgentAction).type}`);
  }
}
