import re

from django.db import migrations

VIEW_COUNT_RE = re.compile(r",?\s*\d+\.?\d*\s*[MKBmkb]?\s*views?", re.IGNORECASE)


def clean_artist_names(apps, _schema_editor):
    ListenTrack = apps.get_model("website", "ListenTrack")
    tracks = ListenTrack.objects.filter(artist__iregex=r"\d+\.?\d*\s*[MKBmkb]?\s*views?")
    updated = []
    for track in tracks:
        cleaned = VIEW_COUNT_RE.sub("", track.artist).strip().strip(",").strip()
        if cleaned and cleaned != track.artist:
            track.artist = cleaned
            updated.append(track)
    if updated:
        ListenTrack.objects.bulk_update(updated, ["artist"], batch_size=500)


class Migration(migrations.Migration):
    dependencies = [
        ("website", "0015_ticker_pricesnapshot"),
    ]

    operations = [
        migrations.RunPython(clean_artist_names, migrations.RunPython.noop),
    ]
