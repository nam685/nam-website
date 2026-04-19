from unittest.mock import MagicMock, patch

import pytest

from website.models import Download, Session, Turn
from website.tasks import _build_downloads_prefix, run_turn


@pytest.mark.django_db
class TestRunTurn:
    def _make_approved_turn(self, **session_kwargs):
        s = Session.objects.create(
            workspace=session_kwargs.get("workspace", "session-1"),
            trace_path=session_kwargs.get("trace_path", "/home/klaude/traces/session-1"),
            status="approved",
        )
        t = Turn.objects.create(session=s, prompt="test", submitter_ip="127.0.0.1", status="approved")
        return s, t

    def test_first_turn_runs_without_continue_flag(self):
        s, t = self._make_approved_turn()
        with patch("website.tasks._execute_klaude") as mock_exec:
            mock_exec.return_value = {
                "summary": "Did stuff",
                "token_count": 100,
                "tool_calls": 5,
                "error": "",
            }
            run_turn(t.id)
        t.refresh_from_db()
        s.refresh_from_db()
        assert t.status == "done"
        assert t.summary == "Did stuff"
        assert t.token_count == 100
        assert t.started_at is not None
        assert t.completed_at is not None
        assert s.status == "done"
        # Check that _execute_klaude was called without is_continuation
        call_args = mock_exec.call_args
        assert call_args[0][0] == t  # turn
        assert call_args[0][1] is False  # is_continuation

    def test_followup_turn_uses_continue_flag(self):
        s = Session.objects.create(workspace="session-1", trace_path="/home/klaude/traces/session-1", status="done")
        Turn.objects.create(session=s, prompt="first", submitter_ip="127.0.0.1", status="done")
        t2 = Turn.objects.create(session=s, prompt="second", submitter_ip="127.0.0.1", status="approved")
        with patch("website.tasks._execute_klaude") as mock_exec:
            mock_exec.return_value = {"summary": "More stuff", "token_count": 50, "tool_calls": 3, "error": ""}
            run_turn(t2.id)
        call_args = mock_exec.call_args
        assert call_args[0][1] is True  # is_continuation

    def test_failed_turn(self):
        s, t = self._make_approved_turn()
        with patch("website.tasks._execute_klaude") as mock_exec:
            mock_exec.side_effect = Exception("klaude crashed")
            run_turn(t.id)
        t.refresh_from_db()
        s.refresh_from_db()
        assert t.status == "failed"
        assert "klaude crashed" in t.error
        assert t.completed_at is not None
        assert s.status == "failed"

    def test_skips_non_approved_turn(self):
        s, t = self._make_approved_turn()
        t.status = "pending"
        t.save()
        with patch("website.tasks._execute_klaude") as mock_exec:
            run_turn(t.id)
        mock_exec.assert_not_called()
        t.refresh_from_db()
        assert t.status == "pending"

    def test_error_in_klaude_output(self):
        s, t = self._make_approved_turn()
        with patch("website.tasks._execute_klaude") as mock_exec:
            mock_exec.return_value = {
                "summary": "",
                "token_count": 10,
                "tool_calls": 1,
                "error": "something went wrong",
            }
            run_turn(t.id)
        t.refresh_from_db()
        s.refresh_from_db()
        assert t.status == "failed"
        assert t.error == "something went wrong"
        assert s.status == "failed"


@pytest.mark.django_db
class TestBuildDownloadsPrefix:
    def test_includes_path_with_ids(self):
        s = Session.objects.create(workspace="ws1", trace_path="/t")
        t = Turn.objects.create(session=s, prompt="x", submitter_ip="127.0.0.1")
        prefix = _build_downloads_prefix(s, t)
        assert f"downloads/{s.id}/{t.id}/" in prefix

    def test_mentions_caps(self):
        s = Session.objects.create()
        t = Turn.objects.create(session=s, prompt="x", submitter_ip="127.0.0.1")
        prefix = _build_downloads_prefix(s, t)
        assert "5 files" in prefix
        assert "5.0 MB" in prefix
        assert "10.0 MB" in prefix

    def test_ends_with_blank_line(self):
        s = Session.objects.create()
        t = Turn.objects.create(session=s, prompt="x", submitter_ip="127.0.0.1")
        prefix = _build_downloads_prefix(s, t)
        assert prefix.endswith("\n\n")


@pytest.mark.django_db
class TestExecuteKlaudeUsesPrefix:
    def test_prompt_passed_to_klaude_includes_downloads_prefix(self):
        s = Session.objects.create(workspace="ws", trace_path="/home/klaude/traces/ws/1")
        t = Turn.objects.create(session=s, prompt="do the thing", submitter_ip="127.0.0.1", status="approved")
        with (
            patch("website.tasks.subprocess.run") as mock_run,
            patch("website.tasks._read_atif_trace", return_value={}),
        ):
            mock_run.return_value.returncode = 0
            mock_run.return_value.stdout = ""
            mock_run.return_value.stderr = ""
            from website.tasks import _execute_klaude

            _execute_klaude(t, is_continuation=False)

        # Find the call that invoked the klaude CLI (last arg looks like the CLI path)
        klaude_cmds = [c for c in mock_run.call_args_list if any("/klaude" in (a or "") for a in c.args[0])]
        assert klaude_cmds, "klaude CLI was not invoked"
        cmd = klaude_cmds[-1].args[0]
        # Find the prompt argument (the one starting with '[downloads')
        prompt_args = [a for a in cmd if a.startswith("[downloads")]
        assert prompt_args, f"no downloads-prefixed prompt in {cmd!r}"
        assert "do the thing" in prompt_args[0]


def _mock_find_result(pairs):
    """Return a MagicMock that mimics subprocess.run's CompletedProcess for find."""
    m = MagicMock()
    m.returncode = 0
    m.stdout = "\n".join(f"{name}|{size}" for name, size in pairs) + "\n"
    return m


@pytest.mark.django_db
class TestRegisterDownloads:
    def _setup(self):
        s = Session.objects.create(workspace="ws", trace_path="/t")
        t = Turn.objects.create(session=s, prompt="p", submitter_ip="127.0.0.1", status="done")
        return s, t

    def test_no_dir_creates_no_rows(self):
        s, t = self._setup()
        with patch("website.tasks.subprocess.run") as mock_run:
            mock_run.return_value = MagicMock(returncode=0, stdout="")
            from website.tasks import _register_downloads

            _register_downloads(t)
        assert Download.objects.count() == 0

    def test_missing_dir_returncode_nonzero(self):
        s, t = self._setup()
        with patch("website.tasks.subprocess.run") as mock_run:
            mock_run.return_value = MagicMock(returncode=1, stdout="")
            from website.tasks import _register_downloads

            _register_downloads(t)
        assert Download.objects.count() == 0

    def test_single_file_creates_row(self):
        s, t = self._setup()
        with patch("website.tasks.subprocess.run") as mock_run:
            mock_run.return_value = _mock_find_result([("a.md", 100)])
            from website.tasks import _register_downloads

            _register_downloads(t)
        rows = list(Download.objects.all())
        assert len(rows) == 1
        assert rows[0].filename == "a.md"
        assert rows[0].size == 100
        assert rows[0].oversize is False

    def test_respects_max_files(self):
        s, t = self._setup()
        pairs = [(f"f{i}.txt", 10) for i in range(7)]
        with patch("website.tasks.subprocess.run") as mock_run:
            mock_run.return_value = _mock_find_result(pairs)
            from website.tasks import _register_downloads

            _register_downloads(t)
        assert Download.objects.count() == 5

    def test_marks_oversize(self):
        s, t = self._setup()
        with patch("website.tasks.subprocess.run") as mock_run:
            mock_run.return_value = _mock_find_result([("big.bin", 6 * 1024 * 1024)])
            from website.tasks import _register_downloads

            _register_downloads(t)
        row = Download.objects.get()
        assert row.oversize is True
        assert row.size == 6 * 1024 * 1024

    def test_servable_total_cap_stops_after_10mb(self):
        s, t = self._setup()
        # 3 files of 4 MB each — second fits (total 8 MB), third (12 MB total) skipped
        pairs = [(f"f{i}.bin", 4 * 1024 * 1024) for i in range(3)]
        with patch("website.tasks.subprocess.run") as mock_run:
            mock_run.return_value = _mock_find_result(pairs)
            from website.tasks import _register_downloads

            _register_downloads(t)
        assert Download.objects.count() == 2

    def test_oversize_does_not_count_toward_total(self):
        s, t = self._setup()
        # oversize first (6 MB > 5 MB per-file cap), then a 4.5 MB servable file.
        # If big.bin had counted toward the total (6 MB), ok.bin (4.5 MB) would push
        # the total to 10.5 MB > MAX_TOTAL_UPLOAD (10 MB) and be rejected.
        # Since oversize files don't count, servable_total stays 0 and ok.bin fits.
        pairs = [("big.bin", 6 * 1024 * 1024), ("ok.bin", 4 * 1024 * 1024 + 512 * 1024)]
        with patch("website.tasks.subprocess.run") as mock_run:
            mock_run.return_value = _mock_find_result(pairs)
            from website.tasks import _register_downloads

            _register_downloads(t)
        rows = list(Download.objects.order_by("id"))
        assert len(rows) == 2
        assert rows[0].oversize is True
        assert rows[1].oversize is False

    def test_shells_out_with_klaude_user(self):
        s, t = self._setup()
        with patch("website.tasks.subprocess.run") as mock_run:
            mock_run.return_value = MagicMock(returncode=0, stdout="")
            from website.tasks import _register_downloads

            _register_downloads(t)
        cmd = mock_run.call_args.args[0]
        assert cmd[0] == "sudo"
        assert cmd[1] == "-u"
        assert cmd[2] == "klaude"
        assert cmd[3] == "find"
        assert f"downloads/{s.id}/{t.id}" in cmd[4]


@pytest.mark.django_db
class TestRunTurnRegistersDownloads:
    def test_done_turn_calls_register_downloads(self):
        s = Session.objects.create(workspace="ws", trace_path="/home/klaude/traces/ws/1", status="approved")
        t = Turn.objects.create(session=s, prompt="p", submitter_ip="127.0.0.1", status="approved")
        with (
            patch("website.tasks._execute_klaude") as mock_exec,
            patch("website.tasks._register_downloads") as mock_reg,
        ):
            mock_exec.return_value = {"summary": "ok", "token_count": 0, "tool_calls": 0, "error": ""}
            run_turn(t.id)
        mock_reg.assert_called_once()
        assert mock_reg.call_args.args[0].id == t.id

    def test_failed_turn_does_not_register_downloads(self):
        s = Session.objects.create(workspace="ws", trace_path="/t", status="approved")
        t = Turn.objects.create(session=s, prompt="p", submitter_ip="127.0.0.1", status="approved")
        with (
            patch("website.tasks._execute_klaude") as mock_exec,
            patch("website.tasks._register_downloads") as mock_reg,
        ):
            mock_exec.return_value = {"summary": "", "token_count": 0, "tool_calls": 0, "error": "boom"}
            run_turn(t.id)
        mock_reg.assert_not_called()

    def test_exception_does_not_register_downloads(self):
        s = Session.objects.create(workspace="ws", trace_path="/t", status="approved")
        t = Turn.objects.create(session=s, prompt="p", submitter_ip="127.0.0.1", status="approved")
        with (
            patch("website.tasks._execute_klaude", side_effect=Exception("x")),
            patch("website.tasks._register_downloads") as mock_reg,
        ):
            run_turn(t.id)
        mock_reg.assert_not_called()
