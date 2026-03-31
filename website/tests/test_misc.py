import pytest


@pytest.mark.django_db
class TestHealthEndpoint:
    def test_health_ok(self, client):
        resp = client.get("/api/health/")
        assert resp.status_code == 200
        assert resp.json()["status"] == "ok"


@pytest.mark.django_db
class TestTodoList:
    def test_returns_200(self, client):
        resp = client.get("/api/todo/")
        assert resp.status_code == 200


@pytest.mark.django_db
class TestProjectList:
    def test_returns_200(self, client):
        resp = client.get("/api/projects/")
        assert resp.status_code == 200
