import logging

from django.db.models import Count, Max

from website.models import ListenTrack, MusicNode

logger = logging.getLogger(__name__)


def normalize(name: str) -> str:
    """Canonical identity key for artist/album names."""
    return name.strip().lower()


def split_artists(field: str) -> list[str]:
    """Split a stored 'A, B' artist field into individual names."""
    return [n.strip() for n in field.split(",") if n.strip()]


def _upsert_node(node_type, key, *, title, subtitle="", thumbnail_url="", video_id="", play_count=0, last_played=None):
    MusicNode.objects.update_or_create(
        node_type=node_type,
        key=key,
        defaults={
            "title": title,
            "subtitle": subtitle,
            "thumbnail_url": thumbnail_url,
            "video_id": video_id,
            "play_count": play_count,
            "last_played": last_played,
        },
    )


def rebuild_nodes():
    """(Re)build track/artist/album nodes from the ListenTrack play log.

    Personalization flags (is_liked/in_library/is_subscribed) are NOT touched here
    so a play-only rebuild preserves them; they are set by sync_personalization().
    """
    # --- Track nodes (keyed by video_id) ---
    track_rows = ListenTrack.objects.values("video_id").annotate(play_count=Count("id"), last_played=Max("played_at"))
    for row in track_rows:
        latest = ListenTrack.objects.filter(video_id=row["video_id"]).order_by("-played_at").first()
        _upsert_node(
            "track",
            row["video_id"],
            title=latest.title,
            subtitle=latest.artist,
            thumbnail_url=latest.thumbnail_url,
            video_id=row["video_id"],
            play_count=row["play_count"],
            last_played=row["last_played"],
        )

    # --- Artist + album aggregates (need per-name splitting) ---
    artist_counts: dict[str, dict] = {}
    album_counts: dict[str, dict] = {}
    for t in ListenTrack.objects.all().iterator():
        names = split_artists(t.artist)
        for name in names:
            a = artist_counts.setdefault(
                normalize(name),
                {
                    "title": name,
                    "play_count": 0,
                    "last_played": t.played_at,
                    "thumbnail_url": t.thumbnail_url,
                    "video_id": t.video_id,
                },
            )
            a["play_count"] += 1
            if t.played_at > a["last_played"]:
                a["last_played"] = t.played_at
                a["video_id"] = t.video_id
                a["thumbnail_url"] = t.thumbnail_url or a["thumbnail_url"]
        if t.album and names:
            primary = names[0]
            key = f"{normalize(primary)}::{normalize(t.album)}"
            al = album_counts.setdefault(
                key,
                {
                    "title": t.album,
                    "subtitle": primary,
                    "play_count": 0,
                    "last_played": t.played_at,
                    "thumbnail_url": t.thumbnail_url,
                    "video_id": t.video_id,
                },
            )
            al["play_count"] += 1
            if t.played_at > al["last_played"]:
                al["last_played"] = t.played_at
                al["thumbnail_url"] = t.thumbnail_url or al["thumbnail_url"]

    for key, a in artist_counts.items():
        _upsert_node(
            "artist",
            key,
            title=a["title"],
            thumbnail_url=a["thumbnail_url"],
            video_id=a["video_id"],
            play_count=a["play_count"],
            last_played=a["last_played"],
        )
    for key, al in album_counts.items():
        _upsert_node(
            "album",
            key,
            title=al["title"],
            subtitle=al["subtitle"],
            thumbnail_url=al["thumbnail_url"],
            video_id=al["video_id"],
            play_count=al["play_count"],
            last_played=al["last_played"],
        )
