import json
from unittest.mock import patch

import pytest

from website.models import Download, Session, Turn
from website.views.slops import _fmt_size


@pytest.mark.django_db
class TestSessionModel:
    def test_create_session(self):
        s = Session.objects.create()
        assert s.status == "pending"
        assert s.workspace == ""
        assert s.trace_path == ""
        assert s.created_at is not None

    def test_str_representation(self):
        s = Session.objects.create()
        Turn.objects.create(session=s, prompt="Fix the bug in main.py", submitter_ip="127.0.0.1")
        assert "Fix the bug" in str(s)

    def test_str_no_turns(self):
        s = Session.objects.create()
        assert "empty" in str(s).lower()


@pytest.mark.django_db
class TestTurnModel:
    def test_create_turn(self):
        s = Session.objects.create()
        t = Turn.objects.create(session=s, prompt="Fix the bug", submitter_ip="127.0.0.1")
        assert t.status == "pending"
        assert t.prompt == "Fix the bug"
        assert t.token_count == 0
        assert t.tool_calls == 0
        assert t.summary == ""
        assert t.error == ""
        assert t.created_at is not None

    def test_turns_ordered_chronologically(self):
        s = Session.objects.create()
        t1 = Turn.objects.create(session=s, prompt="First", submitter_ip="127.0.0.1")
        t2 = Turn.objects.create(session=s, prompt="Second", submitter_ip="127.0.0.1")
        turns = list(s.turns.all())
        assert turns[0].id == t1.id
        assert turns[1].id == t2.id

    def test_cascade_delete(self):
        s = Session.objects.create()
        Turn.objects.create(session=s, prompt="test", submitter_ip="127.0.0.1")
        s.delete()
        assert Turn.objects.count() == 0


@pytest.mark.django_db
class TestSlopsSubmit:
    def test_submit_creates_session_and_turn(self, client):
        resp = client.post("/api/slops/submit/", {"prompt": "Fix the bug"}, content_type="application/json")
        assert resp.status_code == 201
        data = resp.json()
        assert data["id"] is not None
        assert data["status"] == "pending"
        assert len(data["turns"]) == 1
        assert data["turns"][0]["prompt"] == "Fix the bug"
        assert data["turns"][0]["status"] == "pending"
        assert Session.objects.count() == 1
        assert Turn.objects.count() == 1

    def test_submit_followup_to_existing_session(self, client):
        s = Session.objects.create(status="done")
        Turn.objects.create(session=s, prompt="First", submitter_ip="10.0.0.1", status="done")
        resp = client.post(
            "/api/slops/submit/",
            {"prompt": "Follow up", "session_id": s.id},
            content_type="application/json",
        )
        assert resp.status_code == 201
        data = resp.json()
        assert len(data["turns"]) == 2
        assert data["status"] == "pending"

    def test_submit_rejects_if_session_has_active_turn(self, client):
        s = Session.objects.create(status="running")
        Turn.objects.create(session=s, prompt="Running", submitter_ip="10.0.0.1", status="running")
        resp = client.post(
            "/api/slops/submit/",
            {"prompt": "Another", "session_id": s.id},
            content_type="application/json",
        )
        assert resp.status_code == 409

    def test_submit_rate_limited_per_ip(self, client):
        client.post("/api/slops/submit/", {"prompt": "First"}, content_type="application/json")
        resp = client.post("/api/slops/submit/", {"prompt": "Second"}, content_type="application/json")
        assert resp.status_code == 429

    def test_submit_admin_bypasses_rate_limit(self, client, auth_headers):
        client.post("/api/slops/submit/", {"prompt": "First"}, content_type="application/json")
        resp = client.post("/api/slops/submit/", {"prompt": "Second"}, content_type="application/json", **auth_headers)
        assert resp.status_code == 201

    def test_submit_global_rate_limit(self, client):
        for i in range(10):
            Turn.objects.create(
                session=Session.objects.create(),
                prompt=f"task {i}",
                submitter_ip=f"10.0.0.{i + 1}",
            )
        resp = client.post("/api/slops/submit/", {"prompt": "One more"}, content_type="application/json")
        assert resp.status_code == 429

    def test_submit_empty_prompt(self, client):
        resp = client.post("/api/slops/submit/", {"prompt": ""}, content_type="application/json")
        assert resp.status_code == 400

    def test_submit_prompt_too_long(self, client):
        resp = client.post("/api/slops/submit/", {"prompt": "x" * 5001}, content_type="application/json")
        assert resp.status_code == 400

    def test_submit_nonexistent_session(self, client):
        resp = client.post(
            "/api/slops/submit/",
            {"prompt": "Follow up", "session_id": 999},
            content_type="application/json",
        )
        assert resp.status_code == 404


@pytest.mark.django_db
class TestSlopsList:
    def test_list_returns_sessions_with_turns(self, client):
        s = Session.objects.create(status="done")
        Turn.objects.create(session=s, prompt="Task 1", submitter_ip="127.0.0.1", status="done")
        resp = client.get("/api/slops/")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 1
        assert len(data["sessions"]) == 1
        assert len(data["sessions"][0]["turns"]) == 1

    def test_list_excludes_fully_rejected_sessions(self, client):
        s1 = Session.objects.create(status="done")
        Turn.objects.create(session=s1, prompt="Good", submitter_ip="127.0.0.1", status="done")
        s2 = Session.objects.create(status="rejected")
        Turn.objects.create(session=s2, prompt="Bad", submitter_ip="127.0.0.1", status="rejected")
        resp = client.get("/api/slops/")
        data = resp.json()
        assert data["total"] == 1

    def test_list_pagination(self, client):
        for i in range(25):
            s = Session.objects.create()
            Turn.objects.create(session=s, prompt=f"Task {i}", submitter_ip="127.0.0.1")
        resp = client.get("/api/slops/?limit=10&offset=0")
        data = resp.json()
        assert len(data["sessions"]) == 10
        assert data["total"] == 25


@pytest.mark.django_db
class TestSlopsDetail:
    def test_detail_returns_session_with_turns(self, client):
        s = Session.objects.create(status="done", workspace="session-1")
        Turn.objects.create(session=s, prompt="Fix it", submitter_ip="127.0.0.1", status="done")
        resp = client.get(f"/api/slops/{s.id}/")
        assert resp.status_code == 200
        data = resp.json()
        assert data["workspace"] == "session-1"
        assert len(data["turns"]) == 1
        assert data["turns"][0]["prompt"] == "Fix it"

    def test_detail_not_found(self, client):
        resp = client.get("/api/slops/999/")
        assert resp.status_code == 404

    def test_public_endpoints_hide_submitter_ip(self, client):
        """Submitter IPs must not be leaked in public list/detail responses."""
        s = Session.objects.create(status="done")
        Turn.objects.create(session=s, prompt="Test", submitter_ip="1.2.3.4", status="done")
        for url in ["/api/slops/", f"/api/slops/{s.id}/"]:
            data = client.get(url).json()
            turns = data.get("turns") or data["sessions"][0]["turns"]
            for turn in turns:
                assert "submitter_ip" not in turn

    def test_admin_endpoints_include_submitter_ip(self, client, auth_headers):
        """Admin approve/reject responses should include submitter IP for moderation."""
        s = Session.objects.create()
        t = Turn.objects.create(session=s, prompt="Test", submitter_ip="1.2.3.4")
        resp = client.post(f"/api/slops/turns/{t.id}/reject/", **auth_headers)
        assert "submitter_ip" in resp.json()["turns"][0]

    def test_list_rejects_invalid_pagination(self, client):
        resp = client.get("/api/slops/?limit=abc")
        assert resp.status_code == 400


@pytest.mark.django_db
class TestSlopsApprove:
    def test_approve_first_turn_sets_workspace(self, client, auth_headers):
        s = Session.objects.create()
        t = Turn.objects.create(session=s, prompt="Do it", submitter_ip="127.0.0.1")
        resp = client.post(f"/api/slops/turns/{t.id}/approve/", **auth_headers)
        assert resp.status_code == 200
        t.refresh_from_db()
        s.refresh_from_db()
        assert t.status == "approved"
        assert t.approved_at is not None
        assert s.status == "approved"
        assert s.workspace == "klaude-playground"

    def test_approve_sets_per_session_trace_path(self, client, auth_headers):
        """Each session must get its own trace directory to prevent cross-contamination."""
        s1 = Session.objects.create()
        t1 = Turn.objects.create(session=s1, prompt="First", submitter_ip="127.0.0.1")
        s2 = Session.objects.create()
        t2 = Turn.objects.create(session=s2, prompt="Second", submitter_ip="127.0.0.1")

        client.post(f"/api/slops/turns/{t1.id}/approve/", **auth_headers)
        client.post(f"/api/slops/turns/{t2.id}/approve/", **auth_headers)

        s1.refresh_from_db()
        s2.refresh_from_db()

        # Both use same workspace but different trace paths
        assert s1.workspace == s2.workspace == "klaude-playground"
        assert s1.trace_path != s2.trace_path
        assert str(s1.id) in s1.trace_path
        assert str(s2.id) in s2.trace_path

    def test_approve_with_custom_workspace(self, client, auth_headers):
        s = Session.objects.create()
        t = Turn.objects.create(session=s, prompt="Do it", submitter_ip="127.0.0.1")
        resp = client.post(
            f"/api/slops/turns/{t.id}/approve/",
            {"workspace": "playground"},
            content_type="application/json",
            **auth_headers,
        )
        assert resp.status_code == 200
        s.refresh_from_db()
        assert s.workspace == "playground"

    def test_approve_rejects_path_traversal_workspace(self, client, auth_headers):
        s = Session.objects.create()
        t = Turn.objects.create(session=s, prompt="Do it", submitter_ip="127.0.0.1")
        resp = client.post(
            f"/api/slops/turns/{t.id}/approve/",
            {"workspace": "../../../etc"},
            content_type="application/json",
            **auth_headers,
        )
        assert resp.status_code == 400

    def test_approve_followup_keeps_existing_workspace(self, client, auth_headers):
        s = Session.objects.create(workspace="session-1", trace_path="/traces/session-1", status="done")
        Turn.objects.create(session=s, prompt="First", submitter_ip="127.0.0.1", status="done")
        t2 = Turn.objects.create(session=s, prompt="Second", submitter_ip="127.0.0.1")
        resp = client.post(f"/api/slops/turns/{t2.id}/approve/", **auth_headers)
        assert resp.status_code == 200
        s.refresh_from_db()
        assert s.workspace == "session-1"

    def test_approve_non_pending_fails(self, client, auth_headers):
        s = Session.objects.create(status="running")
        t = Turn.objects.create(session=s, prompt="Do it", submitter_ip="127.0.0.1", status="running")
        resp = client.post(f"/api/slops/turns/{t.id}/approve/", **auth_headers)
        assert resp.status_code == 409

    def test_approve_requires_auth(self, client):
        s = Session.objects.create()
        t = Turn.objects.create(session=s, prompt="Do it", submitter_ip="127.0.0.1")
        resp = client.post(f"/api/slops/turns/{t.id}/approve/")
        assert resp.status_code == 401


@pytest.mark.django_db
class TestSlopsReject:
    def test_reject_turn(self, client, auth_headers):
        s = Session.objects.create()
        t = Turn.objects.create(session=s, prompt="Do it", submitter_ip="127.0.0.1")
        resp = client.post(f"/api/slops/turns/{t.id}/reject/", **auth_headers)
        assert resp.status_code == 200
        t.refresh_from_db()
        s.refresh_from_db()
        assert t.status == "rejected"
        assert s.status == "rejected"

    def test_reject_with_prior_done_turn(self, client, auth_headers):
        s = Session.objects.create(status="done")
        Turn.objects.create(session=s, prompt="First", submitter_ip="127.0.0.1", status="done")
        t2 = Turn.objects.create(session=s, prompt="Second", submitter_ip="127.0.0.1")
        resp = client.post(f"/api/slops/turns/{t2.id}/reject/", **auth_headers)
        assert resp.status_code == 200
        s.refresh_from_db()
        assert s.status == "done"

    def test_reject_requires_auth(self, client):
        s = Session.objects.create()
        t = Turn.objects.create(session=s, prompt="Do it", submitter_ip="127.0.0.1")
        resp = client.post(f"/api/slops/turns/{t.id}/reject/")
        assert resp.status_code == 401


@pytest.mark.django_db
class TestSlopsDelete:
    def test_delete_session(self, client, auth_headers):
        s = Session.objects.create(status="done")
        Turn.objects.create(session=s, prompt="Do it", submitter_ip="127.0.0.1", status="done")
        resp = client.post(f"/api/slops/{s.id}/delete/", **auth_headers)
        assert resp.status_code == 200
        assert Session.objects.count() == 0
        assert Turn.objects.count() == 0

    def test_delete_not_found(self, client, auth_headers):
        resp = client.post("/api/slops/999/delete/", **auth_headers)
        assert resp.status_code == 404

    def test_delete_requires_auth(self, client):
        s = Session.objects.create()
        resp = client.post(f"/api/slops/{s.id}/delete/")
        assert resp.status_code == 401


@pytest.mark.django_db
class TestSlopsCancel:
    def test_cancel_running_turn(self, client, auth_headers):
        s = Session.objects.create(status="running", trace_path="/home/klaude/traces/ws/1")
        t = Turn.objects.create(session=s, prompt="Running", submitter_ip="127.0.0.1", status="running")
        with patch("subprocess.run") as mock_sub:
            resp = client.post(f"/api/slops/turns/{t.id}/cancel/", **auth_headers)
        assert resp.status_code == 200
        t.refresh_from_db()
        s.refresh_from_db()
        assert t.status == "failed"
        assert t.error == "Cancelled by admin"
        assert t.completed_at is not None
        mock_sub.assert_called_once()

    def test_cancel_approved_turn(self, client, auth_headers):
        s = Session.objects.create(status="approved")
        t = Turn.objects.create(session=s, prompt="Queued", submitter_ip="127.0.0.1", status="approved")
        resp = client.post(f"/api/slops/turns/{t.id}/cancel/", **auth_headers)
        assert resp.status_code == 200
        t.refresh_from_db()
        assert t.status == "failed"

    def test_cancel_done_turn_rejected(self, client, auth_headers):
        s = Session.objects.create(status="done")
        t = Turn.objects.create(session=s, prompt="Done", submitter_ip="127.0.0.1", status="done")
        resp = client.post(f"/api/slops/turns/{t.id}/cancel/", **auth_headers)
        assert resp.status_code == 409

    def test_cancel_requires_auth(self, client):
        s = Session.objects.create(status="running")
        t = Turn.objects.create(session=s, prompt="Running", submitter_ip="127.0.0.1", status="running")
        resp = client.post(f"/api/slops/turns/{t.id}/cancel/")
        assert resp.status_code == 401


@pytest.mark.django_db
class TestSlopsTrace:
    def test_trace_no_path(self, client):
        s = Session.objects.create()
        resp = client.get(f"/api/slops/{s.id}/trace/")
        assert resp.status_code == 200
        assert resp.json()["trace"] is None

    def test_trace_not_found(self, client):
        resp = client.get("/api/slops/999/trace/")
        assert resp.status_code == 404

    def test_trace_file_exists(self, client):
        s = Session.objects.create(trace_path="/home/klaude/traces/session-1")
        mock_trace = {
            "schema_version": "ATIF-v1.4",
            "steps": [
                {"source": "user", "message": "hello"},
                {"source": "agent", "message": "hi there", "tool_calls": []},
            ],
        }
        with patch("website.tasks._read_atif_trace", return_value=mock_trace):
            resp = client.get(f"/api/slops/{s.id}/trace/")
        assert resp.status_code == 200
        data = resp.json()
        assert data["trace"]["step_count"] == 2
        assert len(data["trace"]["messages"]) == 2
        assert data["trace"]["messages"][0]["role"] == "user"
        assert data["trace"]["messages"][1]["role"] == "assistant"

    def test_trace_isolation_between_sessions(self, client):
        """Each session's trace endpoint must read from its own trace_path, not a shared one."""
        s1 = Session.objects.create(trace_path="/home/klaude/traces/ws/1")
        s2 = Session.objects.create(trace_path="/home/klaude/traces/ws/2")

        trace_a = {"schema_version": "ATIF-v1.4", "steps": [{"source": "user", "message": "session A"}]}
        trace_b = {"schema_version": "ATIF-v1.4", "steps": [{"source": "user", "message": "session B"}]}

        with patch("website.tasks._read_atif_trace", return_value=trace_a) as mock_read:
            resp = client.get(f"/api/slops/{s1.id}/trace/")
            mock_read.assert_called_once_with("/home/klaude/traces/ws/1")
        assert resp.json()["trace"]["messages"][0]["content"] == "session A"

        with patch("website.tasks._read_atif_trace", return_value=trace_b) as mock_read:
            resp = client.get(f"/api/slops/{s2.id}/trace/")
            mock_read.assert_called_once_with("/home/klaude/traces/ws/2")
        assert resp.json()["trace"]["messages"][0]["content"] == "session B"


@pytest.mark.django_db
class TestSlopsTraceDownload:
    def test_download_requires_auth(self, client):
        s = Session.objects.create(trace_path="/home/klaude/traces/ws/1")
        resp = client.get(f"/api/slops/{s.id}/trace/download/")
        assert resp.status_code == 401

    def test_download_via_header(self, client, auth_headers):
        s = Session.objects.create(trace_path="/home/klaude/traces/ws/1")
        mock_trace = {"schema_version": "ATIF-v1.4", "steps": [{"source": "user", "message": "hello"}]}
        with patch("website.tasks._read_atif_trace", return_value=mock_trace):
            resp = client.get(f"/api/slops/{s.id}/trace/download/", **auth_headers)
        assert resp.status_code == 200
        assert resp["Content-Disposition"] == f'attachment; filename="atif-session-{s.id}.json"'
        assert resp["Content-Type"] == "application/json"
        data = json.loads(resp.content)
        assert data["schema_version"] == "ATIF-v1.4"
        assert len(data["steps"]) == 1

    def test_download_via_query_token(self, client, admin_token):
        s = Session.objects.create(trace_path="/home/klaude/traces/ws/1")
        mock_trace = {"schema_version": "ATIF-v1.4", "steps": []}
        with patch("website.tasks._read_atif_trace", return_value=mock_trace):
            resp = client.get(f"/api/slops/{s.id}/trace/download/?token={admin_token}")
        assert resp.status_code == 200
        assert resp["Content-Disposition"] == f'attachment; filename="atif-session-{s.id}.json"'

    def test_download_not_found(self, client, auth_headers):
        resp = client.get("/api/slops/999/trace/download/", **auth_headers)
        assert resp.status_code == 404

    def test_download_no_trace_path(self, client, auth_headers):
        s = Session.objects.create()
        resp = client.get(f"/api/slops/{s.id}/trace/download/", **auth_headers)
        assert resp.status_code == 404

    def test_download_empty_trace(self, client, auth_headers):
        s = Session.objects.create(trace_path="/home/klaude/traces/ws/1")
        with patch("website.tasks._read_atif_trace", return_value={}):
            resp = client.get(f"/api/slops/{s.id}/trace/download/", **auth_headers)
        assert resp.status_code == 404


@pytest.mark.django_db
class TestSlopsStats:
    def test_stats_empty(self, client):
        resp = client.get("/api/slops/stats/")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total_sessions"] == 0
        assert data["total_turns"] == 0
        assert data["total_tokens"] == 0

    def test_stats_counts_from_turns(self, client):
        s1 = Session.objects.create(status="done")
        Turn.objects.create(
            session=s1, prompt="a", submitter_ip="1.2.3.4", status="done", token_count=100, tool_calls=5
        )
        s2 = Session.objects.create(status="failed")
        Turn.objects.create(
            session=s2, prompt="b", submitter_ip="1.2.3.4", status="failed", token_count=50, tool_calls=2
        )
        s3 = Session.objects.create()
        Turn.objects.create(session=s3, prompt="c", submitter_ip="1.2.3.4", status="pending")
        resp = client.get("/api/slops/stats/")
        data = resp.json()
        assert data["total_sessions"] == 2
        assert data["total_turns"] == 2
        assert data["total_tokens"] == 150
        assert data["total_tool_calls"] == 7
        assert data["success_rate"] == 50.0


class TestFmtSize:
    def test_zero_bytes(self):
        assert _fmt_size(0) == "0 B"

    def test_bytes(self):
        assert _fmt_size(512) == "512 B"

    def test_kilobytes(self):
        assert _fmt_size(1024) == "1.0 KB"

    def test_kilobytes_fraction(self):
        assert _fmt_size(1536) == "1.5 KB"

    def test_megabytes(self):
        assert _fmt_size(5 * 1024 * 1024) == "5.0 MB"


@pytest.mark.django_db
class TestDownloadModel:
    def test_create_download(self):
        s = Session.objects.create()
        t = Turn.objects.create(session=s, prompt="p", submitter_ip="127.0.0.1")
        d = Download.objects.create(turn=t, filename="out.md", size=123)
        assert d.filename == "out.md"
        assert d.size == 123
        assert d.oversize is False
        assert d.created_at is not None

    def test_download_cascade_on_turn_delete(self):
        s = Session.objects.create()
        t = Turn.objects.create(session=s, prompt="p", submitter_ip="127.0.0.1")
        Download.objects.create(turn=t, filename="a.txt", size=1)
        t.delete()
        assert Download.objects.count() == 0

    def test_download_cascade_on_session_delete(self):
        s = Session.objects.create()
        t = Turn.objects.create(session=s, prompt="p", submitter_ip="127.0.0.1")
        Download.objects.create(turn=t, filename="a.txt", size=1)
        s.delete()
        assert Download.objects.count() == 0

    def test_oversize_flag(self):
        s = Session.objects.create()
        t = Turn.objects.create(session=s, prompt="p", submitter_ip="127.0.0.1")
        d = Download.objects.create(turn=t, filename="big.bin", size=10 * 1024 * 1024, oversize=True)
        assert d.oversize is True


@pytest.mark.django_db
class TestDownloadsInSerialization:
    def test_turn_includes_downloads_field(self, client):
        s = Session.objects.create()
        t = Turn.objects.create(session=s, prompt="p", submitter_ip="127.0.0.1", status="done")
        Download.objects.create(turn=t, filename="out.md", size=100)
        Download.objects.create(turn=t, filename="big.bin", size=10_000_000, oversize=True)

        resp = client.get(f"/api/slops/{s.id}/")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["turns"]) == 1
        downloads = data["turns"][0]["downloads"]
        assert len(downloads) == 2
        assert downloads[0]["filename"] == "out.md"
        assert downloads[0]["size"] == 100
        assert downloads[0]["oversize"] is False
        assert downloads[1]["oversize"] is True
        assert "id" in downloads[0]

    def test_turn_without_downloads_has_empty_list(self, client):
        s = Session.objects.create()
        Turn.objects.create(session=s, prompt="p", submitter_ip="127.0.0.1", status="done")
        resp = client.get(f"/api/slops/{s.id}/")
        assert resp.json()["turns"][0]["downloads"] == []
