from django.db import migrations

FIRST_THOUGHT = "This is my public diary. Certified 100% human generated."


def seed_thought(apps, _schema_editor):
    Thought = apps.get_model("website", "Thought")
    Thought.objects.create(content=FIRST_THOUGHT)


def unseed_thought(apps, _schema_editor):
    Thought = apps.get_model("website", "Thought")
    Thought.objects.filter(content=FIRST_THOUGHT).delete()


class Migration(migrations.Migration):
    dependencies = [
        ("website", "0006_thought_model"),
    ]

    operations = [
        migrations.RunPython(seed_thought, unseed_thought),
    ]
