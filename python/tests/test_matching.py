from guidebridge.matching import match_snapshot_target

SNAPSHOT = {
    "targets": [
        {"id": "gb-ctl-3", "slug": "reset-sim", "label": "Reset simulation", "role": "button"},
        {"id": "gb-ctl-4", "slug": None, "label": "Wave frequency", "role": "range"},
    ],
    "sections": [
        {"id": "gb-sec-1", "slug": "intro", "title": "Introduction to waves"},
    ],
    "headings": [
        {"id": "gb-h-1", "level": 2, "text": "Amplitude and frequency"},
    ],
}


def test_exact_slug_match():
    assert match_snapshot_target(SNAPSHOT, "reset-sim") == "gb-ctl-3"


def test_exact_id_match():
    assert match_snapshot_target(SNAPSHOT, "gb-sec-1") == "gb-sec-1"


def test_case_insensitive():
    assert match_snapshot_target(SNAPSHOT, "RESET-SIM") == "gb-ctl-3"


def test_token_overlap_on_label():
    # A stale id like "gb-ctl-9" won't exact-match, but the model's intent
    # phrased as words should land on the labeled control.
    assert match_snapshot_target(SNAPSHOT, "wave frequency slider") == "gb-ctl-4"


def test_token_overlap_on_section_title():
    assert match_snapshot_target(SNAPSHOT, "introduction waves") == "gb-sec-1"


def test_heading_text_match():
    assert match_snapshot_target(SNAPSHOT, "amplitude") == "gb-h-1"


def test_no_match_returns_none():
    assert match_snapshot_target(SNAPSHOT, "zzz qqq") is None
    assert match_snapshot_target(SNAPSHOT, "") is None
    assert match_snapshot_target({}, "anything") is None
