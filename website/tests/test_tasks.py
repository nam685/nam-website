from unittest.mock import patch

import pytest

from website.models import Mission
from website.tasks import run_mission


@pytest.mark.django_db
class TestRunMission:
    def test_sets_status_to_running_then_done(self):
        m = Mission.objects.create(prompt="test", submitter_ip="127.0.0.1", status="approved", workspace="task-1")
        with patch("website.tasks._execute_klaude") as mock_exec:
            mock_exec.return_value = {"summary": "Did stuff", "token_count": 100, "tool_calls": 5, "error": ""}
            run_mission(m.id)
        m.refresh_from_db()
        assert m.status == "done"
        assert m.summary == "Did stuff"
        assert m.token_count == 100
        assert m.started_at is not None
        assert m.completed_at is not None

    def test_sets_status_to_failed_on_error(self):
        m = Mission.objects.create(prompt="test", submitter_ip="127.0.0.1", status="approved", workspace="task-1")
        with patch("website.tasks._execute_klaude") as mock_exec:
            mock_exec.side_effect = Exception("klaude crashed")
            run_mission(m.id)
        m.refresh_from_db()
        assert m.status == "failed"
        assert "klaude crashed" in m.error
        assert m.completed_at is not None

    def test_skips_non_approved_mission(self):
        m = Mission.objects.create(prompt="test", submitter_ip="127.0.0.1", status="pending", workspace="task-1")
        with patch("website.tasks._execute_klaude") as mock_exec:
            run_mission(m.id)
        mock_exec.assert_not_called()
        m.refresh_from_db()
        assert m.status == "pending"
