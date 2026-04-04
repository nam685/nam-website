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
