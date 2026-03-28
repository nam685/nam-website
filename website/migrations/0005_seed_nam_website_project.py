from django.db import migrations


def seed_projects(apps, _schema_editor):
    Project = apps.get_model("website", "Project")
    Project.objects.create(
        title="nam685.de",
        slug="nam-website",
        description=(
            "This site. Built with Django + Next.js on a Hetzner ARM64 server. "
            "Cyberpunk aesthetic, wheel nav, per-section color themes. "
            "Deployed via GitHub Actions over SSH."
        ),
        tags=["next.js", "django", "tailwind", "self-hosted"],
        github_url="https://github.com/nam685/nam-website",
        live_url="https://nam685.de",
        extra_links=[
            {"label": "/now", "url": "/now"},
            {"label": "/uses", "url": "/uses"},
            {"label": "/changelog", "url": "/changelog"},
            {"label": "/todo", "url": "/todo"},
        ],
        status="active",
        order=0,
    )


def unseed_projects(apps, _schema_editor):
    Project = apps.get_model("website", "Project")
    Project.objects.filter(slug="nam-website").delete()


class Migration(migrations.Migration):
    dependencies = [
        ("website", "0004_project_model"),
    ]

    operations = [
        migrations.RunPython(seed_projects, unseed_projects),
    ]
