import pytest

from website.models import Session, Turn


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
        t = Turn.objects.create(session=s, prompt="Fix the bug in main.py", submitter_ip="127.0.0.1")
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
