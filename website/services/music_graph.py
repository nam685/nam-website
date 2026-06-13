import logging

from django.db.models import Count, Max
from django.utils import timezone

from website.models import ListenTrack, MusicEdge, MusicNode

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


COLISTEN_WINDOW_MINUTES = 30
STRUCTURAL_WEIGHT = 0.5


def _canonical(a: MusicNode, b: MusicNode):
    """Return (source, target) ordered so source_id < target_id."""
    return (a, b) if a.id < b.id else (b, a)


def edge_exists(a: MusicNode, b: MusicNode, edge_type: str) -> bool:
    src, tgt = _canonical(a, b)
    return MusicEdge.objects.filter(source=src, target=tgt, edge_type=edge_type).exists()


def _upsert_edge(a: MusicNode, b: MusicNode, edge_type: str, weight: float):
    if a.id == b.id:
        return
    src, tgt = _canonical(a, b)
    MusicEdge.objects.update_or_create(source=src, target=tgt, edge_type=edge_type, defaults={"weight": weight})


def rebuild_structural_edges():
    """track -> its artist(s) and album. Thin connective tissue between node types."""
    MusicEdge.objects.filter(edge_type="structural").delete()
    artists = {n.key: n for n in MusicNode.objects.filter(node_type="artist")}
    albums = {n.key: n for n in MusicNode.objects.filter(node_type="album")}
    tracks = {n.key: n for n in MusicNode.objects.filter(node_type="track")}

    for t in ListenTrack.objects.all().iterator():
        track_node = tracks.get(t.video_id)
        if not track_node:
            continue
        names = split_artists(t.artist)
        for name in names:
            artist_node = artists.get(normalize(name))
            if artist_node:
                _upsert_edge(track_node, artist_node, "structural", STRUCTURAL_WEIGHT)
        if t.album and names:
            album_node = albums.get(f"{normalize(names[0])}::{normalize(t.album)}")
            if album_node:
                _upsert_edge(track_node, album_node, "structural", STRUCTURAL_WEIGHT)


def rebuild_colisten_edges(window_minutes: int = COLISTEN_WINDOW_MINUTES):
    """Link tracks played within `window_minutes` of each other. Weight = co-occurrence count."""
    MusicEdge.objects.filter(edge_type="colisten").delete()
    tracks = {n.key: n for n in MusicNode.objects.filter(node_type="track")}
    window = timezone.timedelta(minutes=window_minutes)

    ordered = list(ListenTrack.objects.order_by("played_at").values("video_id", "played_at"))
    counts: dict[tuple[str, str], int] = {}
    for i, cur in enumerate(ordered):
        for nxt in ordered[i + 1 :]:
            if nxt["played_at"] - cur["played_at"] > window:
                break
            if nxt["video_id"] == cur["video_id"]:
                continue
            pair = tuple(sorted((cur["video_id"], nxt["video_id"])))
            counts[pair] = counts.get(pair, 0) + 1

    for (a_key, b_key), count in counts.items():
        a, b = tracks.get(a_key), tracks.get(b_key)
        if a and b:
            _upsert_edge(a, b, "colisten", float(count))
