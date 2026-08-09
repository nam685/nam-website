import pytest

import scripts.aoe2_watcher as watcher
from scripts.aoe2_watcher import (
    FatalAuthError,
    RateLimitedError,
    _login,
    _upload,
    already_uploaded,
    find_recs,
    hash_file,
    is_stable,
    load_env_file,
    resolve_config,
    supervise,
)


def test_hash_and_dedup(tmp_path):
    p = tmp_path / "a.aoe2record"
    p.write_bytes(b"hello")
    h = hash_file(str(p))
    assert len(h) == 64
    seen = set()
    assert already_uploaded(h, seen) is False
    seen.add(h)
    assert already_uploaded(h, seen) is True


def test_is_stable(tmp_path):
    p = tmp_path / "b.aoe2record"
    p.write_bytes(b"12345")
    assert is_stable(str(p), prev_size=5) is True
    assert is_stable(str(p), prev_size=3) is False


def test_find_recs_filters_extension(tmp_path):
    (tmp_path / "x.aoe2record").write_bytes(b"r")
    (tmp_path / "y.aoe2spgame").write_bytes(b"s")
    found = find_recs(str(tmp_path))
    assert len(found) == 1 and found[0].endswith(".aoe2record")


def test_load_env_file_parses_and_ignores_comments_and_junk(tmp_path):
    p = tmp_path / "w.env"
    p.write_text(
        "# a comment\n"
        "AOE2_SERVER_URL=https://nam685.de\n"
        "\n"
        "AOE2_ADMIN_SECRET =  sek=ret  \n"  # spaces trimmed; '=' kept in value
        "JUNK LINE WITHOUT EQUALS\n"
    )
    vals = load_env_file(str(p))
    assert vals["AOE2_SERVER_URL"] == "https://nam685.de"
    assert vals["AOE2_ADMIN_SECRET"] == "sek=ret"
    assert "JUNK LINE WITHOUT EQUALS" not in vals
    assert len(vals) == 2


def test_load_env_file_missing_returns_empty(tmp_path):
    assert load_env_file(str(tmp_path / "nope.env")) == {}


def test_resolve_config_env_wins_over_file():
    environ = {"AOE2_SERVER_URL": "https://env/"}  # trailing slash should be stripped
    file_values = {
        "AOE2_SERVER_URL": "https://file",
        "AOE2_ADMIN_SECRET": "s",
        "AOE2_REC_DIR": "/recs",
    }
    cfg = resolve_config(environ, file_values)
    assert cfg["AOE2_SERVER_URL"] == "https://env"
    assert cfg["AOE2_ADMIN_SECRET"] == "s"
    assert cfg["AOE2_REC_DIR"] == "/recs"


def test_resolve_config_missing_raises_with_names():
    with pytest.raises(RuntimeError) as exc:
        resolve_config({}, {"AOE2_SERVER_URL": "https://x"})
    msg = str(exc.value)
    assert "AOE2_ADMIN_SECRET" in msg and "AOE2_REC_DIR" in msg


def test_upload_sends_coach_zero(tmp_path, monkeypatch):
    """Eager preprocess, lazy coach: every upload must tell the server coach=0."""
    rec = tmp_path / "g.aoe2record"
    rec.write_bytes(b"replaydata")
    captured = {}

    class FakeResp:
        status_code = 201

    def fake_post(url, **kwargs):
        captured["url"] = url
        captured["data"] = kwargs.get("data")
        return FakeResp()

    monkeypatch.setattr(watcher.httpx, "post", fake_post)
    resp = _upload("https://nam685.de", "tok", str(rec))

    assert resp.status_code == 201
    assert captured["url"].endswith("/api/aoe2/upload/")
    assert captured["data"] == {"coach": "0"}


@pytest.mark.parametrize("status", [401, 403])
def test_login_raises_fatal_on_bad_secret(monkeypatch, status):
    """A wrong secret must not be retryable — retrying it locks the real admin out."""

    class FakeResp:
        status_code = status

    monkeypatch.setattr(watcher.httpx, "post", lambda *_, **__: FakeResp())

    with pytest.raises(FatalAuthError):
        _login("https://nam685.de", "stale-secret")


def test_login_raises_rate_limited_on_429(monkeypatch):
    class FakeResp:
        status_code = 429

    monkeypatch.setattr(watcher.httpx, "post", lambda *_, **__: FakeResp())

    with pytest.raises(RateLimitedError):
        _login("https://nam685.de", "secret")


def test_supervise_backs_off_hard_when_rate_limited():
    """429 is retryable, but at the rate-limit window's pace — not the usual 30s."""
    sleeps = []

    def target():
        raise RateLimitedError("429")

    supervise(target, sleep_fn=sleeps.append, retry_delay=7, iterations=2, backoff=900)

    assert sleeps == [900, 900]


def test_breaker_blocks_restart_after_fatal_auth(monkeypatch, tmp_path):
    """The marker file must survive process exit, or the Scheduled Task just resumes hammering."""
    block = tmp_path / "aoe2_watcher.auth_failed"
    monkeypatch.setattr(watcher, "_block_path", lambda: str(block))

    assert watcher._tripped_breaker() is False
    watcher._trip_breaker("login rejected (401)")
    assert watcher._tripped_breaker() is True
    assert "401" in block.read_text()


def test_supervise_propagates_fatal_auth():
    """supervise() swallows everything except FatalAuthError, which must stop the daemon."""
    calls = {"n": 0}
    sleeps = []

    def target():
        calls["n"] += 1
        raise FatalAuthError("bad secret")

    with pytest.raises(FatalAuthError):
        supervise(target, sleep_fn=sleeps.append, retry_delay=7, iterations=3)

    assert calls["n"] == 1  # stopped on the first rejection, did not loop
    assert sleeps == []


def test_supervise_catches_and_retries():
    calls = {"n": 0}
    sleeps = []

    def target():
        calls["n"] += 1
        raise RuntimeError("transient boom")

    supervise(target, sleep_fn=sleeps.append, retry_delay=7, iterations=3)

    assert calls["n"] == 3  # never propagated; kept retrying
    assert sleeps == [7, 7, 7]
