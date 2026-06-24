import pytest

from scripts.aoe2_watcher import (
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


def test_supervise_catches_and_retries():
    calls = {"n": 0}
    sleeps = []

    def target():
        calls["n"] += 1
        raise RuntimeError("transient boom")

    supervise(target, sleep_fn=sleeps.append, retry_delay=7, iterations=3)

    assert calls["n"] == 3  # never propagated; kept retrying
    assert sleeps == [7, 7, 7]
