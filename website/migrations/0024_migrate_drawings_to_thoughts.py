from django.db import migrations


def migrate_drawings(apps, schema_editor):
    Drawing = apps.get_model("website", "Drawing")
    Thought = apps.get_model("website", "Thought")
    for d in Drawing.objects.all().iterator():
        t = Thought.objects.create(content=d.caption or "", is_published=d.is_published)
        # Reuse the existing file path and preserve the original timestamp.
        Thought.objects.filter(pk=t.pk).update(image=d.image.name, created_at=d.created_at)


def noop(apps, schema_editor):
    # Irreversible by design — migrated rows are indistinguishable from native thoughts.
    pass


class Migration(migrations.Migration):
    dependencies = [("website", "0023_thought_image")]
    operations = [migrations.RunPython(migrate_drawings, noop)]
