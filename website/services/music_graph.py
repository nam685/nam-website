import logging
import random
import re
import time

from django.db.models import Count, Max, Q
from django.utils import timezone

from website.models import LastfmCache, ListenTrack, MusicEdge, MusicNode
from website.services import lastfm

logger = logging.getLogger(__name__)


def _report(progress, msg: str):
    """Emit a progress line to an optional callback (CLI) and always to the log."""
    if progress:
        progress(msg)
    logger.info(msg)


def normalize(name: str) -> str:
    """Canonical identity key for artist/album names."""
    return name.strip().lower()


_TITLE_BRACKETS_RE = re.compile(r"\([^)]*\)|\[[^\]]*\]")
_TITLE_FEAT_RE = re.compile(r"\bfeat\.?.*$|\bft\.?.*$", re.IGNORECASE)


def canonical_title(title: str) -> str:
    """Loosened title key for Last.fm track matching: drop '(... Remix)', '[VIP]', 'feat. …'.

    Last.fm returns canonical titles, but a remix-heavy library has suffixes that never
    match exactly. Stripping them lets similar-track edges actually land (and harmlessly
    treats a remix as similar to its original).
    """
    t = _TITLE_BRACKETS_RE.sub("", title)
    t = _TITLE_FEAT_RE.sub("", t)
    return t.strip().lower()


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

    # Only real-timestamp plays (Takeout imports) represent genuine listening sessions.
    # Sync-created rows (history/liked/frequent) have fabricated timestamps that all cluster
    # at ~now, which would otherwise link every pair into one giant fake session.
    ordered = list(ListenTrack.objects.filter(from_sync=False).order_by("played_at").values("video_id", "played_at"))
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


LASTFM_REQUEST_DELAY = 0.25  # ~4 req/s, polite
SIMILAR_TRACK_NODE_LIMIT = 200  # cap track.getSimilar calls to the most-played tracks


def _cached_lastfm(cache_key: str, fetch):
    row = LastfmCache.objects.filter(cache_key=cache_key).first()
    if row is not None:
        return row.payload
    payload = fetch()
    # Only cache non-empty results. fetch_similar_* swallow API errors and return [],
    # so caching an empty payload would permanently memoize a transient failure.
    if payload:
        LastfmCache.objects.update_or_create(cache_key=cache_key, defaults={"payload": payload})
    time.sleep(LASTFM_REQUEST_DELAY)
    return payload


def rebuild_similarity_edges(api_key: str, progress=None):
    """Create similar_artist / similar_track edges between nodes already in the universe.

    Last.fm responses are cached in LastfmCache. With no api_key, this is a no-op so the
    graph still builds from co-listen + structural edges (useful in dev).
    """
    if not api_key:
        _report(progress, "LASTFM_API_KEY unset; skipping Last.fm similarity")
        return

    MusicEdge.objects.filter(edge_type__in=["similar_artist", "similar_track"]).delete()

    artists = {n.key: n for n in MusicNode.objects.filter(node_type="artist")}
    # Track lookup by (artist_norm, canonical_title) so Last.fm name-based results map back
    # to nodes despite remix/feat suffixes.
    tracks_by_name: dict[tuple[str, str], MusicNode] = {}
    for n in MusicNode.objects.filter(node_type="track"):
        tracks_by_name.setdefault((normalize(n.subtitle.split(",")[0]), canonical_title(n.title)), n)

    # --- similar artists ---
    artist_items = list(artists.items())
    _report(progress, f"Last.fm: fetching similar artists for {len(artist_items)} artists (cached calls are instant)…")
    for i, (key, node) in enumerate(artist_items, 1):
        payload = _cached_lastfm(
            f"artist.getsimilar::{key}",
            lambda node=node: lastfm.fetch_similar_artists(node.title, api_key),
        )
        for sim in payload:
            target = artists.get(normalize(sim["name"]))
            if target:
                _upsert_edge(node, target, "similar_artist", float(sim["match"]))
        if i % 25 == 0 or i == len(artist_items):
            _report(progress, f"  similar artists: {i}/{len(artist_items)}")

    # --- similar tracks (only for the most-played tracks, to bound API calls) ---
    top_tracks = list(MusicNode.objects.filter(node_type="track").order_by("-play_count")[:SIMILAR_TRACK_NODE_LIMIT])
    _report(progress, f"Last.fm: fetching similar tracks for {len(top_tracks)} tracks…")
    for i, node in enumerate(top_tracks, 1):
        artist_primary = node.subtitle.split(",")[0].strip()
        payload = _cached_lastfm(
            f"track.getsimilar::{normalize(artist_primary)}::{normalize(node.title)}",
            lambda node=node, a=artist_primary: lastfm.fetch_similar_tracks(a, node.title, api_key),
        )
        for sim in payload:
            target = tracks_by_name.get((normalize(sim["artist"]), canonical_title(sim["title"])))
            if target:
                _upsert_edge(node, target, "similar_track", float(sim["match"]))
        if i % 25 == 0 or i == len(top_tracks):
            _report(progress, f"  similar tracks: {i}/{len(top_tracks)}")


PERSONALIZATION_BOOST = 1.5  # multiplier per active flag (liked/subscribed/in_library)


def compute_recommend_scores():
    """Rediscovery weighting (play_count x days_since_last_play) boosted by personalization."""
    now = timezone.now()
    for node in MusicNode.objects.all().iterator():
        days_since = (now - node.last_played).days if node.last_played else 30
        base = max(node.play_count, 1) * max(days_since, 1)
        boost = 1.0
        for flag in (node.is_liked, node.is_subscribed, node.in_library):
            if flag:
                boost *= PERSONALIZATION_BOOST
        node.recommend_score = base * boost
        node.save(update_fields=["recommend_score"])


def apply_personalization(*, liked_video_ids, library_album_keys, subscribed_artist_keys, library_video_ids):
    """Set personalization flags on existing nodes from YTM library data (idempotent)."""
    MusicNode.objects.filter(node_type="track").update(is_liked=False, in_library=False)
    MusicNode.objects.filter(node_type="album").update(in_library=False)
    MusicNode.objects.filter(node_type="artist").update(is_subscribed=False)

    if liked_video_ids:
        MusicNode.objects.filter(node_type="track", key__in=liked_video_ids).update(is_liked=True)
    if library_video_ids:
        MusicNode.objects.filter(node_type="track", key__in=library_video_ids).update(in_library=True)
    if library_album_keys:
        MusicNode.objects.filter(node_type="album", key__in=library_album_keys).update(in_library=True)
    if subscribed_artist_keys:
        MusicNode.objects.filter(node_type="artist", key__in=subscribed_artist_keys).update(is_subscribed=True)


PATCH_MAX_NODES = 40


def _serialize_node(n: MusicNode) -> dict:
    return {
        "key": n.key,
        "node_type": n.node_type,
        "title": n.title,
        "subtitle": n.subtitle,
        "thumbnail_url": n.thumbnail_url,
        "video_id": n.video_id,
        "play_count": n.play_count,
        "is_liked": n.is_liked,
        "is_subscribed": n.is_subscribed,
        "in_library": n.in_library,
    }


def _neighbors(node_ids: set[int]):
    """All edges with at least one endpoint in node_ids."""
    edges = MusicEdge.objects.filter(source_id__in=node_ids).union(MusicEdge.objects.filter(target_id__in=node_ids))
    return list(edges)


def get_patch(seed_key, seed_type, max_nodes: int = PATCH_MAX_NODES) -> dict:
    """Return {seed, nodes, edges} for the seed node + BFS depth-2 neighborhood, capped."""
    if seed_key is None:
        seed = list(MusicNode.objects.filter(recommend_score__gt=0).order_by("-recommend_score")[:50])
        seed = seed or list(MusicNode.objects.all()[:50])
        if not seed:
            return {"seed": None, "nodes": [], "edges": []}
        weights = [n.recommend_score or 1.0 for n in seed]
        seed_node = random.choices(seed, weights=weights, k=1)[0]
    else:
        seed_node = MusicNode.objects.filter(key=seed_key, node_type=seed_type).first()
        if seed_node is None:
            seed_node = MusicNode.objects.filter(key=seed_key).first()
        if seed_node is None:
            return {"seed": None, "nodes": [], "edges": []}

    # BFS to depth 2 collecting node ids.
    frontier = {seed_node.id}
    collected = {seed_node.id}
    for _ in range(2):
        edges = _neighbors(frontier)
        next_frontier = set()
        for e in edges:
            for nid in (e.source_id, e.target_id):
                if nid not in collected and len(collected) < max_nodes:
                    collected.add(nid)
                    next_frontier.add(nid)
        frontier = next_frontier
        if not frontier:
            break

    nodes = list(MusicNode.objects.filter(id__in=collected))
    id_to_key = {n.id: n.key for n in nodes}
    edges = MusicEdge.objects.filter(source_id__in=collected, target_id__in=collected)
    return {
        "seed": seed_node.key,
        "nodes": [_serialize_node(n) for n in nodes],
        "edges": [
            {
                "source": id_to_key[e.source_id],
                "target": id_to_key[e.target_id],
                "edge_type": e.edge_type,
                "weight": e.weight,
            }
            for e in edges
        ],
    }


def search_nodes(query: str, limit: int = 10) -> list[dict]:
    if not query.strip():
        return []
    qs = MusicNode.objects.filter(Q(title__icontains=query) | Q(subtitle__icontains=query)).order_by(
        "-recommend_score"
    )[:limit]
    return [
        {
            "key": n.key,
            "node_type": n.node_type,
            "title": n.title,
            "subtitle": n.subtitle,
            "thumbnail_url": n.thumbnail_url,
        }
        for n in qs
    ]


def _load_personalization_from_ytm(ytm_headers):
    """Pull liked/library/subscriptions from YTM. Returns kwargs for apply_personalization.

    Returns None (not empty sets) when the pull can't run — no auth, or an API/parse
    failure. None means "don't touch the flags" so a failed-auth rebuild preserves the
    flags from the last good sync instead of wiping them. A genuine empty library still
    returns a dict (empty sets) and is applied normally.
    """
    if not ytm_headers:
        return None
    try:
        from ytmusicapi import YTMusic

        yt = YTMusic(ytm_headers)
        liked = {s.get("videoId") for s in yt.get_liked_songs(limit=500).get("tracks", []) if s.get("videoId")}
        lib_songs = {s.get("videoId") for s in yt.get_library_songs(limit=1000) if s.get("videoId")}
        album_keys = set()
        for al in yt.get_library_albums(limit=500):
            name = al.get("title", "")
            artist = (al.get("artists") or [{}])[0].get("name", "")
            if name and artist:
                album_keys.add(f"{normalize(artist)}::{normalize(name)}")
        subs = {normalize(a.get("artist", "")) for a in yt.get_library_subscriptions(limit=1000) if a.get("artist")}
        return {
            "liked_video_ids": liked,
            "library_album_keys": album_keys,
            "subscribed_artist_keys": subs,
            "library_video_ids": lib_songs,
        }
    except Exception as e:
        logger.warning(
            "YTM personalization unavailable (%s) — keeping existing liked/subscribed flags. "
            "Re-auth via the /listens AUTH button if this persists.",
            e.__class__.__name__,
        )
        return None


def build_graph(api_key: str, ytm_headers=None, progress=None):
    """Full idempotent rebuild of the music graph from ListenTrack + YTM + Last.fm.

    `progress` is an optional callable(str) for live status output (e.g. a CLI writer).
    """
    _report(progress, "Building nodes from play history…")
    rebuild_nodes()
    _report(progress, "Applying YTM personalization (liked / library / subscriptions)…")
    personalization = _load_personalization_from_ytm(ytm_headers)
    if personalization is not None:
        apply_personalization(**personalization)
    else:
        _report(progress, "  no YTM auth — keeping existing liked/subscribed flags")
    _report(progress, "Building structural + co-listen edges…")
    rebuild_structural_edges()
    rebuild_colisten_edges()
    rebuild_similarity_edges(api_key=api_key, progress=progress)
    _report(progress, "Computing recommendation scores…")
    compute_recommend_scores()
    _report(progress, f"Done: {MusicNode.objects.count()} nodes, {MusicEdge.objects.count()} edges")
