import pytest

from website.models import Attachment, Session, Turn


@pytest.mark.django_db
class TestAttachmentModel:
    def test_create_attachment(self):
        s = Session.objects.create()
        t = Turn.objects.create(session=s, prompt="Hi", submitter_ip="127.0.0.1")
        a = Attachment.objects.create(turn=t, filename="foo.csv", size=1234, content_type="text/csv")
        assert a.filename == "foo.csv"
        assert a.size == 1234
        assert a.content_type == "text/csv"
        assert a.created_at is not None

    def test_cascade_delete_with_turn(self):
        s = Session.objects.create()
        t = Turn.objects.create(session=s, prompt="Hi", submitter_ip="127.0.0.1")
        Attachment.objects.create(turn=t, filename="a.txt", size=1)
        t.delete()
        assert Attachment.objects.count() == 0
