"""Seed Predictive History channel with featured videos."""

from django.db import migrations


def seed_predictive_history(apps, _schema_editor):
    WatchChannel = apps.get_model("website", "WatchChannel")
    WatchVideo = apps.get_model("website", "WatchVideo")

    channel, _ = WatchChannel.objects.get_or_create(
        youtube_channel_id="UC11aHtNnc5bEPLI4jf6mnYg",
        defaults={
            "name": "Predictive History",
            "description": (
                "Prof. Jiang Xueqin explores whether Asimov's psycho-history is possible — "
                "predicting geopolitics through historical patterns and game theory."
            ),
            "thumbnail_url": "",
            "tier": "never_miss",
            "display_order": 0,
        },
    )

    videos = [
        {
            "youtube_video_id": "7y_hbz6loEo",
            "title": "Geo-Strategy #8: The Iran Trap",
            "thumbnail_url": "https://i.ytimg.com/vi/7y_hbz6loEo/hqdefault.jpg",
            "note": "2024 prediction: US will get trapped in Iran war",
        },
        {
            "youtube_video_id": "HvVTNTPzq7E",
            "title": "Civilization #23: Cyrus the Great as Messiah",
            "thumbnail_url": "https://i.ytimg.com/vi/HvVTNTPzq7E/hqdefault.jpg",
            "note": "",
        },
        {
            "youtube_video_id": "ef-Ch2LGDDI",
            "title": "Civilization #47: The Passion of Robespierre",
            "thumbnail_url": "https://i.ytimg.com/vi/ef-Ch2LGDDI/hqdefault.jpg",
            "note": "",
        },
    ]

    for v in videos:
        WatchVideo.objects.get_or_create(
            youtube_video_id=v["youtube_video_id"],
            defaults={
                "channel": channel,
                "title": v["title"],
                "thumbnail_url": v["thumbnail_url"],
                "note": v["note"],
                "pinned": True,
                "visible": True,
            },
        )


def unseed(apps, _schema_editor):
    WatchVideo = apps.get_model("website", "WatchVideo")
    WatchChannel = apps.get_model("website", "WatchChannel")
    WatchVideo.objects.filter(youtube_video_id__in=["7y_hbz6loEo", "HvVTNTPzq7E", "ef-Ch2LGDDI"]).delete()
    WatchChannel.objects.filter(youtube_channel_id="UC11aHtNnc5bEPLI4jf6mnYg").delete()


class Migration(migrations.Migration):
    dependencies = [
        ("website", "0022_add_is_liked_to_listentrack"),
    ]

    operations = [
        migrations.RunPython(seed_predictive_history, unseed),
    ]
