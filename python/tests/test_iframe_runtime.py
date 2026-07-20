from guidebridge.iframe import (
    IFRAME_RUNTIME_MARKER,
    IFRAME_RUNTIME_VERSION,
    inject_iframe_runtime,
    strip_iframe_runtime,
)

HTML = "<!DOCTYPE html><html><head><title>t</title></head><body><h1>Hi</h1></body></html>"


def test_inject_adds_versioned_runtime_before_body_close():
    out = inject_iframe_runtime(HTML)
    assert f"{IFRAME_RUNTIME_MARKER} v{IFRAME_RUNTIME_VERSION}" in out
    assert out.count(IFRAME_RUNTIME_MARKER) == 1
    assert out.rindex(IFRAME_RUNTIME_MARKER) < out.lower().rindex("</body>")


def test_inject_is_idempotent_and_version_replacing():
    once = inject_iframe_runtime(HTML)
    twice = inject_iframe_runtime(once)
    assert twice.count(IFRAME_RUNTIME_MARKER) == 1
    # An older-version block gets replaced, not duplicated
    old = once.replace(f"v{IFRAME_RUNTIME_VERSION}", "v0")
    upgraded = inject_iframe_runtime(old)
    assert upgraded.count(IFRAME_RUNTIME_MARKER) == 1
    assert f"v{IFRAME_RUNTIME_VERSION}" in upgraded


def test_strip_removes_all_runtime_blocks():
    injected = inject_iframe_runtime(HTML)
    assert IFRAME_RUNTIME_MARKER not in strip_iframe_runtime(injected)


def test_runtime_contains_window_parent_documented_hazard():
    """The runtime necessarily references window.parent. Host postprocessors that
    lint generated HTML for parent access MUST strip_iframe_runtime() first."""
    injected = inject_iframe_runtime(HTML)
    assert "window.parent" in injected
    assert "window.parent" not in strip_iframe_runtime(injected)


def test_no_body_tag_appends_at_end():
    out = inject_iframe_runtime("<div>fragment</div>")
    assert out.startswith("<div>fragment</div>")
    assert IFRAME_RUNTIME_MARKER in out


def test_runtime_uses_pathname_not_href():
    """Artifact URLs can carry ?access_token= — the snapshot must never include it."""
    injected = inject_iframe_runtime(HTML)
    assert "location.pathname" in injected
    assert "location.href" not in injected
