from scripts.aoe2_watcher import already_uploaded, find_recs, hash_file, is_stable


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
