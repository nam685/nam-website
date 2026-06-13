import pytest

from website.models import Attachment, Session, Turn
from website.tasks import _build_prompt_with_attachments


@pytest.mark.django_db
class TestPromptPrefix:
    def test_no_attachments_returns_raw(self):
        s = Session.objects.create()
        t = Turn.objects.create(session=s, prompt="hello", submitter_ip="127.0.0.1")
        assert _build_prompt_with_attachments(t) == "hello"

    def test_single_attachment(self):
        s = Session.objects.create()
        t = Turn.objects.create(session=s, prompt="summarize", submitter_ip="127.0.0.1")
        Attachment.objects.create(turn=t, filename="data.csv", size=2048)
        out = _build_prompt_with_attachments(t)
        assert out.endswith("summarize")
        assert "[attachments" in out
        assert f"uploads/{s.id}/{t.id}/data.csv" in out
        assert "2.0 KB" in out

    def test_multiple_attachments_listed(self):
        s = Session.objects.create()
        t = Turn.objects.create(session=s, prompt="look", submitter_ip="127.0.0.1")
        Attachment.objects.create(turn=t, filename="a.txt", size=100)
        Attachment.objects.create(turn=t, filename="b.pdf", size=1024 * 200)
        out = _build_prompt_with_attachments(t)
        assert "a.txt" in out and "b.pdf" in out
        assert "200.0 KB" in out
