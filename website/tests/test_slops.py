import pytest

from website.models import Mission


@pytest.mark.django_db
class TestMissionModel:
    def test_create_mission(self):
        m = Mission.objects.create(prompt="Fix the bug", submitter_ip="127.0.0.1")
        assert m.status == "pending"
        assert m.prompt == "Fix the bug"
        assert m.created_at is not None

    def test_str_truncates(self):
        m = Mission(prompt="a" * 100, submitter_ip="127.0.0.1")
        assert len(str(m)) <= 83  # 80 chars + "..."

    def test_default_values(self):
        m = Mission(prompt="test", submitter_ip="127.0.0.1")
        assert m.status == "pending"
        assert m.workspace == ""
        assert m.trace_path == ""
        assert m.token_count == 0
        assert m.tool_calls == 0
        assert m.summary == ""
        assert m.error == ""


@pytest.mark.django_db
class TestSlopsSubmit:
    def test_submit_creates_pending_mission(self, client):
        resp = client.post("/api/slops/submit/", {"prompt": "Fix the bug in main.py"}, content_type="application/json")
        assert resp.status_code == 201
        data = resp.json()
        assert data["id"] is not None
        assert data["status"] == "pending"
        assert Mission.objects.count() == 1

    def test_submit_rate_limited(self, client):
        client.post("/api/slops/submit/", {"prompt": "First"}, content_type="application/json")
        resp = client.post("/api/slops/submit/", {"prompt": "Second"}, content_type="application/json")
        assert resp.status_code == 429

    def test_submit_empty_prompt(self, client):
        resp = client.post("/api/slops/submit/", {"prompt": ""}, content_type="application/json")
        assert resp.status_code == 400

    def test_submit_prompt_too_long(self, client):
        resp = client.post("/api/slops/submit/", {"prompt": "x" * 5001}, content_type="application/json")
        assert resp.status_code == 400


@pytest.mark.django_db
class TestSlopsList:
    def test_list_returns_missions(self, client):
        Mission.objects.create(prompt="Task 1", submitter_ip="127.0.0.1")
        Mission.objects.create(prompt="Task 2", submitter_ip="127.0.0.1")
        resp = client.get("/api/slops/")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 2
        assert len(data["missions"]) == 2

    def test_list_excludes_rejected(self, client):
        Mission.objects.create(prompt="Good", submitter_ip="127.0.0.1", status="done")
        Mission.objects.create(prompt="Bad", submitter_ip="127.0.0.1", status="rejected")
        resp = client.get("/api/slops/")
        data = resp.json()
        assert data["total"] == 1

    def test_list_pagination(self, client):
        for i in range(25):
            Mission.objects.create(prompt=f"Task {i}", submitter_ip="127.0.0.1")
        resp = client.get("/api/slops/?limit=10&offset=0")
        data = resp.json()
        assert len(data["missions"]) == 10
        assert data["total"] == 25


@pytest.mark.django_db
class TestSlopsDetail:
    def test_detail_returns_mission(self, client):
        m = Mission.objects.create(prompt="Fix it", submitter_ip="127.0.0.1", status="done")
        resp = client.get(f"/api/slops/{m.id}/")
        assert resp.status_code == 200
        data = resp.json()
        assert data["prompt"] == "Fix it"

    def test_detail_not_found(self, client):
        resp = client.get("/api/slops/999/")
        assert resp.status_code == 404


@pytest.mark.django_db
class TestSlopsApprove:
    def test_approve_pending_mission(self, client, auth_headers):
        m = Mission.objects.create(prompt="Do it", submitter_ip="127.0.0.1")
        resp = client.post(f"/api/slops/{m.id}/approve/", **auth_headers)
        assert resp.status_code == 200
        m.refresh_from_db()
        assert m.status == "approved"
        assert m.approved_at is not None
        assert m.workspace.startswith("task-")

    def test_approve_with_playground_workspace(self, client, auth_headers):
        m = Mission.objects.create(prompt="Do it", submitter_ip="127.0.0.1")
        resp = client.post(
            f"/api/slops/{m.id}/approve/",
            {"workspace": "playground"},
            content_type="application/json",
            **auth_headers,
        )
        assert resp.status_code == 200
        m.refresh_from_db()
        assert m.workspace == "playground"

    def test_approve_non_pending_fails(self, client, auth_headers):
        m = Mission.objects.create(prompt="Do it", submitter_ip="127.0.0.1", status="running")
        resp = client.post(f"/api/slops/{m.id}/approve/", **auth_headers)
        assert resp.status_code == 409

    def test_approve_requires_auth(self, client):
        m = Mission.objects.create(prompt="Do it", submitter_ip="127.0.0.1")
        resp = client.post(f"/api/slops/{m.id}/approve/")
        assert resp.status_code == 401


@pytest.mark.django_db
class TestSlopsReject:
    def test_reject_pending_mission(self, client, auth_headers):
        m = Mission.objects.create(prompt="Do it", submitter_ip="127.0.0.1")
        resp = client.post(f"/api/slops/{m.id}/reject/", **auth_headers)
        assert resp.status_code == 200
        m.refresh_from_db()
        assert m.status == "rejected"

    def test_reject_requires_auth(self, client):
        m = Mission.objects.create(prompt="Do it", submitter_ip="127.0.0.1")
        resp = client.post(f"/api/slops/{m.id}/reject/")
        assert resp.status_code == 401


@pytest.mark.django_db
class TestSlopsTrace:
    def test_trace_no_path(self, client):
        m = Mission.objects.create(prompt="test", submitter_ip="127.0.0.1")
        resp = client.get(f"/api/slops/{m.id}/trace/")
        assert resp.status_code == 200
        data = resp.json()
        assert data["trace"] is None

    def test_trace_not_found(self, client):
        resp = client.get("/api/slops/999/trace/")
        assert resp.status_code == 404

    def test_trace_file_exists(self, client, tmp_path):
        trace_dir = tmp_path / "task-1"
        trace_dir.mkdir()
        trace_file = trace_dir / "trace.json"
        trace_file.write_text('{"messages": [{"role": "user", "content": "hello"}]}')
        m = Mission.objects.create(prompt="test", submitter_ip="127.0.0.1", trace_path=str(trace_dir))
        resp = client.get(f"/api/slops/{m.id}/trace/")
        assert resp.status_code == 200
        data = resp.json()
        assert data["trace"]["messages"][0]["content"] == "hello"


@pytest.mark.django_db
class TestSlopsStats:
    def test_stats_empty(self, client):
        resp = client.get("/api/slops/stats/")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total_missions"] == 0
        assert data["total_tokens"] == 0

    def test_stats_counts_completed(self, client):
        Mission.objects.create(prompt="a", submitter_ip="1.2.3.4", status="done", token_count=100, tool_calls=5)
        Mission.objects.create(prompt="b", submitter_ip="1.2.3.4", status="failed", token_count=50, tool_calls=2)
        Mission.objects.create(prompt="c", submitter_ip="1.2.3.4", status="pending")
        resp = client.get("/api/slops/stats/")
        data = resp.json()
        assert data["total_missions"] == 2
        assert data["total_tokens"] == 150
        assert data["total_tool_calls"] == 7
        assert data["success_rate"] == 50.0
