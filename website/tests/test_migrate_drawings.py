import pytest
from django.utils import timezone

from website.models import Thought


@pytest.mark.django_db
def test_drawing_data_migration_logic():
    """The same create+update logic the data migration uses preserves caption,
    image path, publish flag, and timestamp."""
    ts = timezone.now() - timezone.timedelta(days=30)
    t = Thought.objects.create(content="my caption", is_published=False)
    Thought.objects.filter(pk=t.pk).update(image="drawings/2025/01/x.jpg", created_at=ts)

    t.refresh_from_db()
    assert t.content == "my caption"
    assert t.image.name == "drawings/2025/01/x.jpg"
    assert t.is_published is False
    assert abs((t.created_at - ts).total_seconds()) < 1
