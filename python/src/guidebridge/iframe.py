"""Sandboxed-iframe mode: the injectable in-iframe runtime.

Host apps that render untrusted/generated HTML in ``sandbox="allow-scripts"``
iframes cannot inject scripts from the parent (opaque origin, no DOM access),
so the runtime below must be baked into the served HTML server-side::

    from guidebridge.iframe import inject_iframe_runtime
    html = inject_iframe_runtime(html)   # idempotent, replaces older versions

The runtime speaks a small postMessage envelope ``{gb: 1, type, requestId?,
payload?}`` with the parent (see ``packages/react/src/frame.ts`` FrameRelay):

    parent -> iframe:  gb:ping | gb:observe | gb:action
    iframe -> parent:  gb:ready | gb:observe_result | gb:action_result | gb:cursor

Identity: the iframe only accepts messages where ``e.source === window.parent``
and posts with ``targetOrigin "*"`` — the only workable checks for an
opaque-origin sandbox. The runtime deliberately references ``window.parent``;
host postprocessors that lint generated HTML for parent access must strip this
runtime (``strip_iframe_runtime``) before linting and re-inject after.

The snapshot's ``url`` is ``location.pathname`` only: artifact URLs often carry
auth tokens in the query string, which must never reach snapshots/LLM context.
"""
from __future__ import annotations

import re

IFRAME_RUNTIME_VERSION = 1
IFRAME_RUNTIME_MARKER = "guidebridge-iframe-runtime"

# Cursor choreography (ms): the pointer visibly arrives before the action fires.
_LEAD_CLICKY_MS = 520
_LEAD_SCROLL_MS = 320

IFRAME_RUNTIME_JS = """
(function () {
  var GB = 1;
  var VERSION = %(version)d;
  var events = [];   // ring buffer of recent user interactions
  var autoN = 0;

  function txt(s, n) { return (s || '').replace(/\\s+/g, ' ').trim().slice(0, n); }
  function ensureId(el, prefix) {
    if (el.id) return el.id;
    var id = prefix + '-' + (++autoN);
    while (document.getElementById(id)) id = prefix + '-' + (++autoN);
    el.id = id;
    return id;
  }
  function pushEvent(evt) {
    evt.at = new Date().toISOString();
    events.push(evt);
    if (events.length > 15) events.shift();
  }
  function post(msg) {
    try { window.parent.postMessage(msg, '*'); } catch (err) {}
  }

  function slugOf(el) {
    return el.getAttribute('data-agent-target') || el.getAttribute('data-lesson-control') ||
           el.getAttribute('data-lesson-section') || el.getAttribute('data-agent-section') || null;
  }
  function findTarget(id) {
    if (!id) return null;
    var el = document.getElementById(id);
    if (el) return el;
    try {
      var esc = (window.CSS && CSS.escape) ? CSS.escape(id) : id.replace(/[^\\w-]/g, '');
      return document.querySelector(
        '[data-agent-target="' + esc + '"],[data-lesson-control="' + esc + '"],' +
        '[data-lesson-section="' + esc + '"],[data-agent-section="' + esc + '"]'
      );
    } catch (e) { return null; }
  }
  function visible(el) {
    var r = el.getBoundingClientRect();
    return r.bottom > 0 && r.top < window.innerHeight && r.width > 0 && r.height > 0;
  }
  function roleOf(el) {
    var t = el.tagName.toLowerCase();
    if (t === 'button' || (t === 'input' && (el.type === 'button' || el.type === 'submit'))) return 'button';
    if (t === 'a') return 'link';
    if (t === 'select') return 'select';
    if (t === 'textarea') return 'textarea';
    if (t === 'input') {
      if (el.type === 'range') return 'range';
      if (el.type === 'checkbox' || el.type === 'radio') return 'checkbox';
      return 'input';
    }
    return 'other';
  }
  function labelOf(el) {
    return txt(el.getAttribute('aria-label') || el.getAttribute('data-agent-label') ||
               slugOf(el) || el.innerText || el.placeholder || el.name || el.type ||
               el.tagName.toLowerCase(), 80);
  }

  function snapshot() {
    var headings = [];
    document.querySelectorAll('h1,h2,h3').forEach(function (h) {
      if (headings.length >= 30) return;
      headings.push({ id: ensureId(h, 'gb-h'), level: +h.tagName[1], text: txt(h.innerText, 90) });
    });
    var sectionEls = document.querySelectorAll('[data-agent-section],[data-lesson-section]');
    if (!sectionEls.length) sectionEls = document.querySelectorAll('section');
    var sections = [], visibleSectionId = null;
    sectionEls.forEach(function (s) {
      if (sections.length >= 30) return;
      var vis = visible(s);
      var id = ensureId(s, 'gb-sec');
      if (vis && !visibleSectionId) visibleSectionId = id;
      sections.push({
        id: id,
        slug: slugOf(s),
        title: txt(s.getAttribute('data-lesson-title') || (s.querySelector('h1,h2,h3') || {}).innerText || '', 80),
        summary: txt(s.innerText, 180),
        visible: vis
      });
    });
    var targets = [];
    document.querySelectorAll('button,input,select,textarea,[data-agent-target],[data-lesson-control]')
      .forEach(function (c) {
        if (targets.length >= 40) return;
        var info = {
          id: ensureId(c, 'gb-ctl'),
          slug: slugOf(c),
          role: roleOf(c),
          label: labelOf(c),
          visible: visible(c)
        };
        if ('value' in c && typeof c.value === 'string') info.value = String(c.value).slice(0, 80);
        if (c.disabled) info.disabled = true;
        targets.push(info);
      });
    return {
      url: location.pathname,   // never the query string: it may carry auth tokens
      title: txt(document.title, 120),
      scrollY: Math.round(window.scrollY),
      scrollHeight: document.documentElement.scrollHeight,
      viewportHeight: window.innerHeight,
      targets: targets,
      customActions: [],
      recentEvents: events.slice(),
      sections: sections,
      headings: headings,
      visibleSectionId: visibleSectionId
    };
  }

  // --- Cursor: computed here, RENDERED by the parent (gb:cursor frames) ---
  var lastCursor = { x: 0, y: 0 };
  var hideTimer = null;
  function sendCursor(x, y, opts) {
    var pad = 16;
    x = Math.max(pad, Math.min((window.innerWidth || 320) - pad, x));
    y = Math.max(pad, Math.min((window.innerHeight || 240) - pad, y));
    lastCursor.x = Math.round(x);
    lastCursor.y = Math.round(y);
    post({ gb: GB, type: 'gb:cursor', payload: {
      x: lastCursor.x, y: lastCursor.y, visible: true, click: !!(opts && opts.click)
    }});
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(function () {
      post({ gb: GB, type: 'gb:cursor', payload: { x: lastCursor.x, y: lastCursor.y, visible: false, click: false } });
    }, (opts && opts.holdMs) || 3200);
  }
  function cursorToEl(el, opts) {
    var r = el.getBoundingClientRect();
    var x = r.left + Math.max(12, Math.min(r.width * 0.5, r.width - 8));
    var y = r.top + Math.max(8, Math.min(r.height * 0.35, 36));
    // Off-screen target: park at the viewport edge toward it so intent still reads.
    if (r.bottom < 0) y = 28;
    else if (r.top > window.innerHeight) y = window.innerHeight - 28;
    if (r.right < 0) x = 28;
    else if (r.left > window.innerWidth) x = window.innerWidth - 28;
    sendCursor(x, y, opts);
  }

  // Full pointer/mouse sequence, not bare .click(): generated pages often listen
  // on pointerdown/mousedown and ignore a lone synthetic click.
  function synthClick(el) {
    var o = { bubbles: true, cancelable: true, view: window };
    try {
      if (window.PointerEvent) el.dispatchEvent(new PointerEvent('pointerdown', o));
      el.dispatchEvent(new MouseEvent('mousedown', o));
      if (window.PointerEvent) el.dispatchEvent(new PointerEvent('pointerup', o));
      el.dispatchEvent(new MouseEvent('mouseup', o));
    } catch (err) {}
    el.click();
  }
  // Native prototype setter so framework-controlled inputs (React etc.) update too.
  function setNativeValue(el, value) {
    var proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype :
                el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    var desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(el, value); else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  var prevOutline = null;
  function clearHighlight() {
    if (prevOutline) {
      prevOutline.el.style.outline = prevOutline.outline;
      prevOutline.el.style.outlineOffset = prevOutline.offset;
      if (prevOutline.timer) clearTimeout(prevOutline.timer);
      prevOutline = null;
    }
  }
  function applyHighlight(el, ms) {
    clearHighlight();
    prevOutline = { el: el, outline: el.style.outline, offset: el.style.outlineOffset };
    el.style.outline = '3px solid #2C50EE';
    el.style.outlineOffset = '4px';
    prevOutline.timer = setTimeout(clearHighlight, Math.min(ms || 3200, 10000));
  }

  var TARGET_ACTIONS = { point: 1, scroll_to: 1, highlight: 1, click: 1, type: 1, select_option: 1 };

  // Cursor leads: pointer moves first, then the real DOM action fires.
  function execute(action, done) {
    var type = action && action.type;
    function finish(result) { try { done(result); } catch (err) {} }

    if (type === 'scroll_by') {
      var dir = action.direction === 'up' ? -1 : 1;
      var frac = action.amount === 'half' ? 0.5 : 0.85;
      sendCursor(window.innerWidth * 0.5, window.innerHeight * (dir < 0 ? 0.28 : 0.72), { holdMs: 2200 });
      setTimeout(function () {
        window.scrollBy({ top: dir * window.innerHeight * frac, behavior: 'smooth' });
        setTimeout(function () {
          finish({ success: true, scrollY: Math.round(window.scrollY) });
        }, 450);
      }, 280);
      return;
    }
    if (!TARGET_ACTIONS[type]) {
      finish({ success: false, error: 'unsupported in iframe mode: ' + (type || 'unknown') });
      return;
    }
    var el = findTarget(action.targetId);
    if (!el) {
      finish({ success: false, error: 'target not found: ' + (action.targetId || '') });
      return;
    }
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    cursorToEl(el, { holdMs: 3600 });
    var leadMs = (type === 'scroll_to' || type === 'point') ? %(lead_scroll)d : %(lead_clicky)d;
    setTimeout(function () {
      if (!el.isConnected) {
        finish({ success: false, error: 'target disappeared' });
        return;
      }
      cursorToEl(el, { holdMs: 3600, click: type === 'click' || type === 'type' || type === 'select_option' });
      if (type === 'highlight') {
        applyHighlight(el, action.ms);
      } else if (type === 'click') {
        synthClick(el);
      } else if (type === 'type') {
        if (!('value' in el)) { finish({ success: false, error: 'target has no value' }); return; }
        setNativeValue(el, action.value != null ? String(action.value) : '');
      } else if (type === 'select_option') {
        if (el.tagName !== 'SELECT') { finish({ success: false, error: 'target is not a select' }); return; }
        var want = String(action.value == null ? '' : action.value).toLowerCase();
        var match = null;
        for (var i = 0; i < el.options.length; i++) {
          var o = el.options[i];
          if (o.value === action.value || (o.label || o.text || '').toLowerCase() === want) { match = o; break; }
        }
        if (!match) { finish({ success: false, error: 'option not found: ' + action.value }); return; }
        setNativeValue(el, match.value);
      }
      // point / scroll_to: cursor + scrollIntoView already did the work
      finish({ success: true, cursor: { x: lastCursor.x, y: lastCursor.y } });
    }, leadMs);
  }

  // Recent-interaction capture for observe_page (agent context, not analytics).
  document.addEventListener('click', function (e) {
    var c = e.target && e.target.closest && e.target.closest('button,a,[data-agent-target],[data-lesson-control]');
    if (c) pushEvent({ kind: 'click', targetId: c.id || slugOf(c), label: labelOf(c) });
  }, true);
  document.addEventListener('change', function (e) {
    var c = e.target;
    if (c && ('value' in c)) pushEvent({ kind: 'change', targetId: c.id || slugOf(c), label: labelOf(c), value: String(c.value).slice(0, 60) });
  }, true);

  window.addEventListener('message', function (e) {
    if (e.source !== window.parent) return;   // only the embedding app
    var d = e.data;
    if (!d || d.gb !== GB || !d.type) return;
    if (d.type === 'gb:ping') {
      post({ gb: GB, type: 'gb:ready', requestId: d.requestId, payload: { version: VERSION } });
    } else if (d.type === 'gb:observe') {
      var payload;
      try { payload = { snapshot: snapshot() }; }
      catch (err) { payload = { error: String(err) }; }
      post({ gb: GB, type: 'gb:observe_result', requestId: d.requestId, payload: payload });
    } else if (d.type === 'gb:action') {
      try {
        execute(d.payload && d.payload.action, function (result) {
          post({ gb: GB, type: 'gb:action_result', requestId: d.requestId, payload: result });
        });
      } catch (err) {
        post({ gb: GB, type: 'gb:action_result', requestId: d.requestId, payload: { success: false, error: String(err) } });
      }
    }
  });
  post({ gb: GB, type: 'gb:ready', payload: { version: VERSION } });
})();
""" % {"version": IFRAME_RUNTIME_VERSION, "lead_clicky": _LEAD_CLICKY_MS, "lead_scroll": _LEAD_SCROLL_MS}


def iframe_runtime_patch() -> str:
    """The runtime wrapped in a version-tagged <script> block."""
    return (
        f"<script>\n// {IFRAME_RUNTIME_MARKER} v{IFRAME_RUNTIME_VERSION}\n"
        f"{IFRAME_RUNTIME_JS.strip()}\n</script>"
    )


_STRIP_RE = re.compile(
    r"<script>\s*//\s*" + re.escape(IFRAME_RUNTIME_MARKER) + r"[^\n]*\n.*?</script>",
    re.DOTALL,
)


def strip_iframe_runtime(html: str) -> str:
    """Remove any previously injected runtime (any version). Idempotent."""
    return _STRIP_RE.sub("", html)


def inject_iframe_runtime(html: str) -> str:
    """Strip any prior runtime and append the current one before </body>.

    Idempotent and version-replacing: calling on already-injected HTML yields
    exactly one runtime block at the current version.
    """
    html = strip_iframe_runtime(html)
    patch = iframe_runtime_patch()
    idx = html.lower().rfind("</body>")
    if idx == -1:
        return html + "\n" + patch
    return html[:idx] + patch + "\n" + html[idx:]
