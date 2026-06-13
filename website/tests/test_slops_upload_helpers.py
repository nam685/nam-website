import pytest

from website.views.slops import (
    _safe_basename,
    _upload_dir_rel,
    _validate_extension,
)


class TestSafeBasename:
    @pytest.mark.parametrize(
        "raw,expected",
        [
            ("foo.csv", "foo.csv"),
            ("../../etc/passwd.txt", "passwd.txt"),
            ("C:\\Users\\nam\\foo.txt", "foo.txt"),
            ("dir/sub/a.md", "a.md"),
        ],
    )
    def test_strips_path(self, raw, expected):
        assert _safe_basename(raw) == expected

    def test_empty_raises(self):
        with pytest.raises(ValueError):
            _safe_basename("")

    def test_dotfile_raises(self):
        with pytest.raises(ValueError):
            _safe_basename(".env")

    def test_no_extension_raises(self):
        with pytest.raises(ValueError):
            _safe_basename("README")


class TestValidateExtension:
    def test_text_ok(self):
        _validate_extension("foo.csv")  # no raise

    def test_binary_ok(self):
        _validate_extension("report.pdf")  # no raise

    def test_case_insensitive(self):
        _validate_extension("FOO.CSV")  # no raise

    def test_rejects_unknown(self):
        with pytest.raises(ValueError):
            _validate_extension("evil.exe")


class TestUploadDirRel:
    def test_format(self):
        assert _upload_dir_rel(7, 42) == "uploads/7/42"
