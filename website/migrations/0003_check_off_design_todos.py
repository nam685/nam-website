from django.db import migrations

DONE_ITEMS = [
    "Discover Stitch (Figma killer) — explore for UI/UX design without being a pro designer",
    "Define color palette and design system",
]


def check_off(apps, _schema_editor):
    TodoItem = apps.get_model("website", "TodoItem")
    TodoItem.objects.filter(text__in=DONE_ITEMS).update(done=True)


def uncheck(apps, _schema_editor):
    TodoItem = apps.get_model("website", "TodoItem")
    TodoItem.objects.filter(text__in=DONE_ITEMS).update(done=False)


class Migration(migrations.Migration):
    dependencies = [
        ("website", "0002_seed_todo"),
    ]

    operations = [
        migrations.RunPython(check_off, uncheck),
    ]
