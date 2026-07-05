import logging
import math
import random
import re
import time
from collections import defaultdict

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

# --- Patch-visualization edge ranking (public /listens neighbourhood viz only) ---
# All rebuilt edges are structural / tag / affinity; affinity carries the recommendation signal.
RADIO_EDGE_PRIORITY = {
    "affinity": 2.5,
    "tag": 1.2,
    "structural": 1.0,
}


def _canonical(a: MusicNode, b: MusicNode):
    """Return (source, target) ordered so source_id < target_id."""
    return (a, b) if a.id < b.id else (b, a)


def edge_exists(a: MusicNode, b: MusicNode, edge_type: str) -> bool:
    src, tgt = _canonical(a, b)
    return MusicEdge.objects.filter(source=src, target=tgt, edge_type=edge_type).exists()


def _upsert_edge(a: MusicNode, b: MusicNode, edge_type: str, weight: float, source_kind: str = ""):
    if a.id == b.id:
        return
    src, tgt = _canonical(a, b)
    MusicEdge.objects.update_or_create(
        source=src, target=tgt, edge_type=edge_type, defaults={"weight": weight, "source_kind": source_kind}
    )


def rebuild_structural_edges():
    """Backbone edges: track↔artist(s), track↔album, album↔artist. Connects each track to its
    own metadata cluster so a track is never fully isolated from its artist/album."""
    MusicEdge.objects.filter(edge_type="structural").delete()
    artists = {n.key: n for n in MusicNode.objects.filter(node_type="artist")}
    albums = {n.key: n for n in MusicNode.objects.filter(node_type="album")}
    tracks = {n.key: n for n in MusicNode.objects.filter(node_type="track")}

    for t in ListenTrack.objects.all().iterator():
        track_node = tracks.get(t.video_id)
        if not track_node:
            continue
        names = split_artists(t.artist)
        primary_artist = artists.get(normalize(names[0])) if names else None
        for name in names:
            artist_node = artists.get(normalize(name))
            if artist_node:
                _upsert_edge(track_node, artist_node, "structural", STRUCTURAL_WEIGHT)
        if t.album and names:
            album_node = albums.get(f"{normalize(names[0])}::{normalize(t.album)}")
            if album_node:
                _upsert_edge(track_node, album_node, "structural", STRUCTURAL_WEIGHT)
                # album↔artist so the album isn't a leaf hanging only off its tracks.
                if primary_artist:
                    _upsert_edge(album_node, primary_artist, "structural", STRUCTURAL_WEIGHT)


# --- Tag / genre layer (content-based multipartite connectivity) -------------------------------
TAG_TOP_N = 5  # top Last.fm tags to pull per artist
TAG_MIN_ARTISTS = 2  # keep only tags shared by ≥2 artists — a 1-artist tag is a dead-end leaf


def rebuild_tag_edges(api_key: str, progress=None):
    """Fetch each artist's top Last.fm tags and wire artist↔tag edges.

    Tags are few and widely shared, so they connect the graph *by construction* — an orphan
    artist whose Last.fm similars aren't in the library still shares a genre tag with the main
    body and is pulled into the giant component. Returns the count of tag-less artists (island
    risk) for reporting. No api_key → no-op (dev), returns 0.
    """
    MusicEdge.objects.filter(edge_type="tag").delete()
    MusicNode.objects.filter(node_type="tag").delete()
    if not api_key:
        _report(progress, "LASTFM_API_KEY unset; skipping tag layer")
        return 0

    artists = list(MusicNode.objects.filter(node_type="artist"))
    _report(progress, f"Last.fm: fetching top tags for {len(artists)} artists…")

    # First pass: collect (artist_key -> [(tag_norm, tag_title, count)]) and tally tag frequency.
    artist_tags: dict[str, list[tuple[str, str, int]]] = {}
    tag_artist_count: dict[str, int] = defaultdict(int)
    tag_title: dict[str, str] = {}
    for i, node in enumerate(artists, 1):
        payload = _cached_lastfm(
            f"artist.gettoptags::{node.key}",
            lambda node=node: lastfm.fetch_artist_top_tags(node.title, api_key, limit=TAG_TOP_N),
        )
        rows = []
        for t in payload:
            tnorm = normalize(t["name"])
            if not tnorm:
                continue
            rows.append((tnorm, t["name"], int(t.get("count", 0))))
            tag_artist_count[tnorm] += 1
            tag_title.setdefault(tnorm, t["name"])
        artist_tags[node.key] = rows
        if i % 50 == 0 or i == len(artists):
            _report(progress, f"  top tags: {i}/{len(artists)}")

    # Keep only tags shared by ≥ TAG_MIN_ARTISTS artists (a lone tag bridges nothing).
    kept_tags = {t for t, c in tag_artist_count.items() if c >= TAG_MIN_ARTISTS}
    for tnorm in kept_tags:
        _upsert_node("tag", tnorm, title=tag_title[tnorm])
    tag_nodes = {n.key: n for n in MusicNode.objects.filter(node_type="tag")}
    artist_nodes = {n.key: n for n in artists}

    tagless = 0
    for akey, rows in artist_tags.items():
        wired = [r for r in rows if r[0] in kept_tags]
        if not wired:
            tagless += 1
            continue
        for tnorm, _title, count in wired:
            # Weight: normalized tag strength (Last.fm counts run 0–100). Floored so a 0-count
            # (but present) tag still forms a usable bridge edge.
            _upsert_edge(artist_nodes[akey], tag_nodes[tnorm], "tag", max(count / 100.0, 0.05))
    _report(progress, f"Tag layer: {len(kept_tags)} shared tags, {tagless} tag-less artists")
    return tagless


def _colisten_counts(window_minutes: int = COLISTEN_WINDOW_MINUTES) -> dict[tuple[str, str], int]:
    """Co-occurrence count for every track pair played within `window_minutes` (personal CF).

    No top-K cap here (unlike the old build): the asymmetric top-K was the hubness generator.
    Density is bounded downstream by Mutual-Proximity + per-node top-k on the *rescaled* affinity.
    """
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
    return counts


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


def _lastfm_similar_candidates(api_key: str, progress=None):
    """Fetch Last.fm similar-artist + similar-track pairs as raw affinity candidates (global CF).

    Returns (similar_artist_candidates, similar_track_candidates), each a
    dict[(node_id_a, node_id_b)] -> match in [0, 1], keyed canonically (a < b). Only pairs where
    *both* endpoints are already library nodes are kept.
    """
    artists = {n.key: n for n in MusicNode.objects.filter(node_type="artist")}
    # Track lookup by (artist_norm, canonical_title) so Last.fm name-based results map back
    # to nodes despite remix/feat suffixes.
    tracks_by_name: dict[tuple[str, str], MusicNode] = {}
    for n in MusicNode.objects.filter(node_type="track"):
        tracks_by_name.setdefault((normalize(n.subtitle.split(",")[0]), canonical_title(n.title)), n)

    sa: dict[tuple[int, int], float] = {}
    artist_items = list(artists.items())
    _report(progress, f"Last.fm: fetching similar artists for {len(artist_items)} artists (cached calls are instant)…")
    for i, (key, node) in enumerate(artist_items, 1):
        payload = _cached_lastfm(
            f"artist.getsimilar::{key}",
            lambda node=node: lastfm.fetch_similar_artists(node.title, api_key),
        )
        for sim in payload:
            target = artists.get(normalize(sim["name"]))
            if target and target.id != node.id:
                pair = (min(node.id, target.id), max(node.id, target.id))
                sa[pair] = max(sa.get(pair, 0.0), float(sim["match"]))
        if i % 25 == 0 or i == len(artist_items):
            _report(progress, f"  similar artists: {i}/{len(artist_items)}")

    st: dict[tuple[int, int], float] = {}
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
            if target and target.id != node.id:
                pair = (min(node.id, target.id), max(node.id, target.id))
                st[pair] = max(st.get(pair, 0.0), float(sim["match"]))
        if i % 25 == 0 or i == len(top_tracks):
            _report(progress, f"  similar tracks: {i}/{len(top_tracks)}")
    return sa, st


# --- Affinity edges: Mutual Proximity de-hubbing ------------------------------------------------
# Hubness (Flexer/Schnitzer, OFAI): in any nearest-neighbour similarity space a few items become
# the neighbour of far too many others as a geometric artifact — our old 395-edge, play-count-4
# "super nodes". Mutual Proximity (Flexer & Stevens 2017) rescales each similarity to the
# probability that x and y are *mutually* near, using the empirical distribution of each node's
# own similarities; a hub whose partners don't reciprocate its nearness is pruned. We then keep
# each node's top-k by MP — the "mutual proximity graph" kNN construction — which bounds degree.
MP_TOPK = 8

# Content-based affinity: artists sharing genre tags. Skip tags broader than this — a tag on
# hundreds of artists ("pop") isn't discriminative and would generate a combinatorial hairball;
# such tags still connect the graph through their membership edges.
CONTENT_TAG_MAX_ARTISTS = 60


def _content_affinity_candidates() -> dict[tuple[int, int], float]:
    """Artist↔artist affinity from tag-set overlap (Jaccard), read from the tag edges in the DB.

    The content half of the CF+content hybrid: two artists with strongly overlapping genre tags
    get a recommendation edge even absent any co-listen or Last.fm-similar link. Returned as
    dict[(artist_a, artist_b)] -> jaccard in (0, 1], canonical (a < b).
    """
    artist_ids = set(MusicNode.objects.filter(node_type="artist").values_list("id", flat=True))
    artist_tags: dict[int, set[int]] = defaultdict(set)
    for s, t in MusicEdge.objects.filter(edge_type="tag").values_list("source_id", "target_id"):
        artist, tag = (s, t) if s in artist_ids else (t, s)
        artist_tags[artist].add(tag)

    tag_artists: dict[int, list[int]] = defaultdict(list)
    for artist, tags in artist_tags.items():
        for tag in tags:
            tag_artists[tag].append(artist)

    shared: dict[tuple[int, int], int] = defaultdict(int)
    for arts in tag_artists.values():
        if len(arts) > CONTENT_TAG_MAX_ARTISTS:
            continue  # non-discriminative broad tag
        arts = sorted(arts)
        for i in range(len(arts)):
            for j in range(i + 1, len(arts)):
                shared[(arts[i], arts[j])] += 1

    cands: dict[tuple[int, int], float] = {}
    for (a, b), sh in shared.items():
        union = len(artist_tags[a]) + len(artist_tags[b]) - sh
        if union > 0:
            cands[(a, b)] = sh / union
    return cands


def mutual_proximity(candidates: dict[tuple[int, int], float]) -> dict[tuple[int, int], float]:
    """Rescale symmetric similarities to Mutual Proximity in [0, 1].

    `candidates` maps a canonical node-id pair (a < b) to a symmetric similarity. For each node we
    build the empirical CDF of its similarities; MP(x, y) = CDF_x(s) · CDF_y(s). Midpoint ranking
    handles the heavy ties in discrete co-listen counts gracefully (all-equal → 0.5, not 0).
    """
    import bisect

    by_node: dict[int, list[float]] = defaultdict(list)
    for (a, b), s in candidates.items():
        by_node[a].append(s)
        by_node[b].append(s)
    sorted_sims = {n: sorted(v) for n, v in by_node.items()}

    def cdf(n: int, s: float) -> float:
        arr = sorted_sims[n]
        lo = bisect.bisect_left(arr, s)
        hi = bisect.bisect_right(arr, s)
        return (lo + hi) / (2 * len(arr))

    return {(a, b): cdf(a, s) * cdf(b, s) for (a, b), s in candidates.items()}


def _topk_by_mp(mp_scores: dict[tuple[int, int], float], k: int = MP_TOPK) -> set[tuple[int, int]]:
    """Keep each node's k strongest partners by MP, unioned. Bounds degree ≈ 2k and, because MP is
    mutual, a non-reciprocated hub never makes its counterparties' top-k → no artifact hubs."""
    by_node: dict[int, list[tuple[float, int]]] = defaultdict(list)
    for (a, b), mp in mp_scores.items():
        by_node[a].append((mp, b))
        by_node[b].append((mp, a))
    keep: set[tuple[int, int]] = set()
    for n, partners in by_node.items():
        partners.sort(reverse=True)
        for _mp, other in partners[:k]:
            keep.add((min(n, other), max(n, other)))
    return keep


def rebuild_affinity_edges(api_key: str, progress=None):
    """Rebuild the single `affinity` edge layer from co-listen (personal CF) + Last.fm (global CF).

    Each source is Mutual-Proximity rescaled and top-k'd independently (its similarities are only
    comparable within-source), then merged: a pair kept in several sources takes its strongest MP.
    """
    MusicEdge.objects.filter(edge_type__in=["affinity", "colisten", "similar_artist", "similar_track"]).delete()
    tracks = {n.key: n for n in MusicNode.objects.filter(node_type="track")}

    per_source: dict[str, dict[tuple[int, int], float]] = {}
    # personal co-listen → node-id pairs
    coli: dict[tuple[int, int], float] = {}
    for (va, vb), c in _colisten_counts().items():
        na, nb = tracks.get(va), tracks.get(vb)
        if na and nb:
            coli[(min(na.id, nb.id), max(na.id, nb.id))] = float(c)
    per_source["colisten"] = coli
    # global CF from Last.fm
    if api_key:
        sa, st = _lastfm_similar_candidates(api_key, progress)
        per_source["similar_artist"] = sa
        per_source["similar_track"] = st
    else:
        _report(progress, "LASTFM_API_KEY unset; affinity from co-listen only")
    # content-based: artist↔artist genre-tag overlap (built from the tag layer, no extra API calls)
    per_source["content"] = _content_affinity_candidates()

    best: dict[tuple[int, int], tuple[float, str]] = {}
    for kind, cands in per_source.items():
        if not cands:
            continue
        mp = mutual_proximity(cands)
        for pair in _topk_by_mp(mp):
            m = mp[pair]
            if m <= 0:
                continue
            if pair not in best or m > best[pair][0]:
                best[pair] = (m, kind)

    # Hard per-node degree cap. MP + per-node top-k bounds how many partners a node *selects*, but
    # the union is still unbounded: a track that lands in hundreds of others' top-k (the heavy
    # count-1 co-listen ties barely suppress it) re-accumulates into a hub. Since a uniform random
    # walk visits nodes ∝ degree, such a hub would recur in shuffle — the exact thing we're killing.
    # Greedily keep highest-MP edges such that no node exceeds AFFINITY_MAX_DEGREE. Connectivity is
    # unaffected: the tag layer is the backbone, affinity only adds taste.
    kept = _cap_affinity_degree(best)
    node_ids = {i for pair in kept for i in pair}
    id_to_node = {n.id: n for n in MusicNode.objects.filter(id__in=node_ids)}
    for (a, b), (m, kind) in kept.items():
        na, nb = id_to_node.get(a), id_to_node.get(b)
        if na and nb:
            _upsert_edge(na, nb, "affinity", m, source_kind=kind)
    _report(progress, f"Affinity: {len(kept)}/{len(best)} MP edges kept after degree cap")


AFFINITY_MAX_DEGREE = 12  # hard cap on affinity edges per node (bounds hub recurrence in the walk)


def _cap_affinity_degree(best: dict[tuple[int, int], tuple[float, str]], cap: int = AFFINITY_MAX_DEGREE):
    """Keep highest-MP edges so no node exceeds `cap` affinity edges (symmetric, so all degrees ≤ cap)."""
    degree: dict[int, int] = defaultdict(int)
    kept: dict[tuple[int, int], tuple[float, str]] = {}
    for (a, b), (m, kind) in sorted(best.items(), key=lambda kv: kv[1][0], reverse=True):
        if degree[a] >= cap or degree[b] >= cap:
            continue
        kept[(a, b)] = (m, kind)
        degree[a] += 1
        degree[b] += 1
    return kept


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


def compute_node_degrees():
    """Set each node.degree to its incident-edge count (both directions). Run after edges built."""
    from collections import Counter

    deg = Counter()
    for src_id, tgt_id in MusicEdge.objects.values_list("source_id", "target_id").iterator():
        deg[src_id] += 1
        deg[tgt_id] += 1
    to_update = []
    for node in MusicNode.objects.all().iterator():
        d = deg.get(node.id, 0)
        if node.degree != d:
            node.degree = d
            to_update.append(node)
    MusicNode.objects.bulk_update(to_update, ["degree"], batch_size=500)


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
PATCH_MAX_DEGREE = 8  # cap edges per node in a patch so hub nodes don't render as a hairball


def _cap_edges_by_degree(edges, max_degree: int = PATCH_MAX_DEGREE):
    """Bound every node to `max_degree` incident edges, keeping the strongest ones.

    Structural / similar_artist edges are uncapped at build time, so a prolific artist or
    album becomes a "super node" wired to every one of its tracks. This greedily builds a
    degree-bounded subgraph for the *visualization only* (the underlying MusicEdge rows,
    which radio scores over, are untouched):

    1. Rank edges by (edge-type priority, weight) descending — the same priority radio uses
       (similar_track > colisten > similar_artist > structural), so meaningful relationships
       survive and excess structural hub links are dropped first.
    2. Keep an edge only if BOTH endpoints are still under the cap; a node may end with fewer
       than `max_degree` if its edges were claimed by higher-priority neighbours.
    """
    ranked = sorted(edges, key=lambda e: (RADIO_EDGE_PRIORITY.get(e.edge_type, 1.0), e.weight), reverse=True)
    degree: dict[int, int] = defaultdict(int)
    kept = []
    for e in ranked:
        if degree[e.source_id] >= max_degree or degree[e.target_id] >= max_degree:
            continue
        kept.append(e)
        degree[e.source_id] += 1
        degree[e.target_id] += 1
    return kept


def _hub_weight(degree: int) -> float:
    """Down-weight high-degree hub nodes so they don't saturate every patch / radio pick.

    Log-damped: hubs still surface sometimes (they *are* the most-played music), just not in
    the majority of patches. Degree 0 -> 1.0 (no penalty), degree 100 -> ~0.18.
    """
    return 1.0 / (1.0 + math.log1p(max(degree, 0)))


def damped_weighted_sample(items, scores, k=1, *, damping=math.sqrt, rng=None):
    """Pick up to k distinct items by weighted-random over damping(max(score, 0)), no replacement.

    Shared sampling kernel for both the seedless shuffle seed pick and radio's next-track pick.
    `items`/`scores` are parallel sequences. An all-zero (or empty-weight) pool falls back to a
    uniform pick so a degenerate score set never raises.
    """
    rng = rng or random
    items = list(items)
    scores = list(scores)
    idxs = list(range(len(items)))
    chosen = []
    for _ in range(min(k, len(items))):
        weights = [damping(max(scores[i], 0.0)) for i in idxs]
        total = sum(weights)
        if total <= 0:
            pos = rng.randrange(len(idxs))
        else:
            pos = rng.choices(range(len(idxs)), weights=weights, k=1)[0]
        chosen.append(items[idxs[pos]])
        idxs.pop(pos)
    return chosen


def _pick_shuffle_seed(exclude_keys, rng):
    """Uniform-random track seed for seedless shuffle — a random start for the walk.

    No score weighting: on a connected, de-hubbed graph, a uniform random walk visits nodes in
    proportion to their degree, so popular/central tracks surface naturally without an explicit
    popularity term. Falls back to any node, then allows repeats rather than returning nothing.
    """
    ids = list(MusicNode.objects.filter(node_type="track").exclude(key__in=exclude_keys).values_list("id", flat=True))
    ids = ids or list(MusicNode.objects.exclude(key__in=exclude_keys).values_list("id", flat=True))
    ids = ids or list(MusicNode.objects.values_list("id", flat=True))
    return MusicNode.objects.filter(id=rng.choice(ids)).first() if ids else None


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


def get_patch(seed_key, seed_type, max_nodes: int = PATCH_MAX_NODES, *, exclude_keys=None, rng=None) -> dict:
    """Return {seed, nodes, edges} for the seed node + BFS depth-2 neighborhood, capped.

    With no seed_key, pick a song-forward weighted-random seed (see `_pick_recommended_seed`).
    `exclude_keys` skips recently-served seeds; `rng` is injectable for deterministic tests.
    """
    rng = rng or random
    exclude_keys = exclude_keys or set()
    if seed_key is None:
        seed_node = _pick_shuffle_seed(exclude_keys, rng)
        if seed_node is None:
            return {"seed": None, "nodes": [], "edges": []}
    else:
        seed_node = MusicNode.objects.filter(key=seed_key, node_type=seed_type).first()
        if seed_node is None:
            seed_node = MusicNode.objects.filter(key=seed_key).first()
        if seed_node is None:
            return {"seed": None, "nodes": [], "edges": []}

    # BFS to depth 2, accumulating a reach score per neighbor (edge weight decayed by hop depth).
    neighbor_score: dict[int, float] = {}
    frontier = {seed_node.id}
    seen = {seed_node.id}
    for depth in range(2):
        edges = _neighbors(frontier)
        next_frontier: set[int] = set()
        for e in edges:
            for a, b in ((e.source_id, e.target_id), (e.target_id, e.source_id)):
                if a in frontier and b != seed_node.id:
                    neighbor_score[b] = neighbor_score.get(b, 0.0) + e.weight / (depth + 1)
                    if b not in seen:
                        seen.add(b)
                        next_frontier.add(b)
        frontier = next_frontier
        if not frontier:
            break

    # Fill the patch (seed always included). When the neighborhood exceeds the cap, choose which
    # nodes to keep by damped-weighted sampling over reach-score x hub penalty, so a few super-hubs
    # no longer dominate every patch. Under the cap, keep everything (behavior unchanged).
    neighbor_ids = list(neighbor_score)
    room = max_nodes - 1
    if len(neighbor_ids) > room:
        degrees = dict(MusicNode.objects.filter(id__in=neighbor_ids).values_list("id", "degree"))
        eff = [neighbor_score[i] * _hub_weight(degrees.get(i, 0)) for i in neighbor_ids]
        kept = damped_weighted_sample(neighbor_ids, eff, k=room, rng=rng)
        collected = {seed_node.id, *kept}
    else:
        collected = {seed_node.id, *neighbor_ids}

    edges = list(MusicEdge.objects.filter(source_id__in=collected, target_id__in=collected))
    # Cap each node to its strongest PATCH_MAX_DEGREE edges so an uncapped hub (structural /
    # similar_artist) doesn't render as a hairball. Done before the connected-node pass below so a
    # node whose only edges are trimmed away is dropped rather than left floating.
    edges = _cap_edges_by_degree(edges)
    # Drop any non-seed node left without an edge into `collected`: over-cap sampling can keep a
    # depth-2 node whose only connector (its depth-1 parent) wasn't sampled, which would otherwise
    # render as a floating dot. The seed is always kept even if it has no neighbours.
    connected = {seed_node.id}
    for e in edges:
        connected.add(e.source_id)
        connected.add(e.target_id)
    nodes = list(MusicNode.objects.filter(id__in=connected))
    id_to_key = {n.id: n.key for n in nodes}
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
    _report(progress, "Building structural backbone…")
    rebuild_structural_edges()
    _report(progress, "Building tag/genre connective layer…")
    rebuild_tag_edges(api_key=api_key, progress=progress)
    _report(progress, "Building affinity edges (co-listen + Last.fm, Mutual-Proximity rescaled)…")
    rebuild_affinity_edges(api_key=api_key, progress=progress)
    _report(progress, "Computing recommendation scores…")
    compute_recommend_scores()
    _report(progress, "Computing node degrees…")
    compute_node_degrees()
    _report(progress, f"Done: {MusicNode.objects.count()} nodes, {MusicEdge.objects.count()} edges")


def _node_to_track(node: MusicNode) -> dict:
    """Shape a track MusicNode as a frontend ListenTrack dict.

    Graph nodes store title/subtitle(artist)/thumbnail/video_id only; id, album,
    duration and played_at come from the latest ListenTrack row for the video_id.
    """
    lt = ListenTrack.objects.filter(video_id=node.video_id).order_by("-played_at").first()
    return {
        "id": lt.id if lt else 0,
        "video_id": node.video_id,
        "title": node.title,
        "artist": node.subtitle,
        "album": lt.album if lt else "",
        "thumbnail_url": node.thumbnail_url,
        "duration": lt.duration if lt else "",
        "played_at": lt.played_at.isoformat() if lt else "",
    }


WALK_RESTART_PROB = 0.15  # radio: chance per step to teleport back to the seed (keeps results near it)
WALK_TELEPORT_PROB = 0.08  # chance per step to jump to a uniform-random track anywhere in the graph


def _load_adjacency():
    """Load the whole graph into an in-memory adjacency list + track lookup for fast walking.

    The graph is small (a few thousand nodes / edges), so one query beats a DB round-trip per step.
    Returns (adjacency: id -> [neighbour ids], track_video: id -> video_id for playable tracks).
    """
    adjacency: dict[int, list[int]] = defaultdict(list)
    # weight > 0 only: a non-positive edge means "no real affinity" and is not a walkable link.
    for src, tgt in MusicEdge.objects.filter(weight__gt=0).values_list("source_id", "target_id").iterator():
        adjacency[src].append(tgt)
        adjacency[tgt].append(src)
    track_video = dict(MusicNode.objects.filter(node_type="track").exclude(video_id="").values_list("id", "video_id"))
    return adjacency, track_video


def walk(
    seed_video_id=None,
    exclude_video_ids=None,
    limit=5,
    *,
    restart_prob=WALK_RESTART_PROB,
    teleport_prob=WALK_TELEPORT_PROB,
    rng=None,
) -> list[int]:
    """Uniform random walk over the graph, returning up to `limit` fresh track node ids in order.

    The single navigation primitive behind both shuffle and radio:
      - `seed_video_id=None` → shuffle: start at a uniform-random track, no restart.
      - `seed_video_id` set   → radio: start at the seed, teleport back with `restart_prob`.
    Each step moves to a uniformly-random neighbour (any edge type — tag/artist/album nodes are
    traversed for reachability but only track nodes are emitted). Because the graph is de-hubbed,
    visitation is ∝ degree, so popular/central tracks recur naturally.

    With probability `teleport_prob` a step instead jumps to a uniform-random track *anywhere* in
    the graph (the PageRank random-surfer). This gives every node — including stray lone songs in
    tiny disconnected islands the walk could never otherwise reach — a small nonzero long-run
    visitation probability, so orphan tracks still surface occasionally without needing to be
    structurally connected. Set to 0 to disable (e.g. deterministic tests / pure-neighbourhood radio).
    """
    rng = rng or random
    exclude = set(exclude_video_ids or ())
    adjacency, track_video = _load_adjacency()
    if not track_video:
        return []
    track_ids = list(track_video)

    if seed_video_id:
        exclude.add(seed_video_id)
        seed = MusicNode.objects.filter(node_type="track", key=seed_video_id).first()
        if seed is None:
            return []  # radio from an unknown seed → nothing (don't silently random-walk)
        seed_id = seed.id
    else:
        # seedless shuffle: uniform-random start over playable tracks not already excluded
        start_pool = [i for i, v in track_video.items() if v not in exclude] or track_ids
        seed_id = rng.choice(start_pool)

    results: list[int] = []
    seen_videos = set(exclude)
    current = seed_id
    # Bounded step budget: enough to reach `limit` fresh tracks on a connected graph, but finite so
    # a tiny/degenerate component can't loop forever.
    budget = max(limit * 60, 120)
    for _ in range(budget):
        if len(results) >= limit:
            break
        r = rng.random()
        if teleport_prob and r < teleport_prob:
            current = rng.choice(track_ids)  # jump anywhere — lets isolated islands surface
        elif seed_video_id and restart_prob and r < teleport_prob + restart_prob:
            current = seed_id  # radio: pull back toward the seed
        else:
            neighbours = adjacency.get(current)
            if not neighbours:
                # dead end (fully isolated node): restart from seed, or teleport in seedless shuffle
                current = seed_id if seed_video_id else rng.choice(track_ids)
                continue
            current = rng.choice(neighbours)
        vid = track_video.get(current)
        if vid and vid not in seen_videos:
            seen_videos.add(vid)
            results.append(current)
    return results


def radio_next(seed_video_id, exclude_video_ids=None, limit=5) -> list[dict]:
    """Next radio tracks via a uniform random walk seeded at `seed_video_id` (see `walk`)."""
    ids = walk(seed_video_id, exclude_video_ids=exclude_video_ids, limit=limit)
    if not ids:
        return []
    by_id = {n.id: n for n in MusicNode.objects.filter(id__in=ids)}
    return [_node_to_track(by_id[i]) for i in ids if i in by_id]


# --- Full-graph diagnostic snapshot (admin visualization) ---------------------------------------
def _connected_components(node_ids, adjacency):
    """Label connected components; returns id -> component index, sorted so 0 is the largest."""
    seen: set[int] = set()
    comps: list[list[int]] = []
    for start in node_ids:
        if start in seen:
            continue
        stack, comp = [start], []
        while stack:
            x = stack.pop()
            if x in seen:
                continue
            seen.add(x)
            comp.append(x)
            stack.extend(n for n in adjacency.get(x, ()) if n not in seen)
        comps.append(comp)
    comps.sort(key=len, reverse=True)
    return {nid: idx for idx, comp in enumerate(comps) for nid in comp}, comps


def _articulation_and_bridges(node_ids, adjacency):
    """Tarjan articulation points + bridges (iterative, whole graph). Returns (set aps, set bridges).

    Bridges are canonical (a, b) with a < b. Surfaces internal fragility: a node/edge whose removal
    would split a component further — the weak seams a walk can get trapped behind.
    """
    disc: dict[int, int] = {}
    low: dict[int, int] = {}
    aps: set[int] = set()
    bridges: set[tuple[int, int]] = set()
    timer = 0
    for root in node_ids:
        if root in disc:
            continue
        # iterative DFS; stack frames carry (node, parent, neighbour-iterator, child-count)
        stack = [(root, -1, iter(adjacency.get(root, ())), 0)]
        disc[root] = low[root] = timer
        timer += 1
        root_children = 0
        while stack:
            node, parent, it, _ = stack[-1]
            advanced = False
            for nb in it:
                if nb == parent:
                    continue
                if nb not in disc:
                    disc[nb] = low[nb] = timer
                    timer += 1
                    if node == root:
                        root_children += 1
                    stack.append((nb, node, iter(adjacency.get(nb, ())), 0))
                    advanced = True
                    break
                else:
                    low[node] = min(low[node], disc[nb])
            if advanced:
                continue
            stack.pop()
            if stack:
                par = stack[-1][0]
                low[par] = min(low[par], low[node])
                if par != root and low[node] >= disc[par]:
                    aps.add(par)
                if low[node] > disc[par]:
                    bridges.add((min(par, node), max(par, node)))
        if root_children > 1:
            aps.add(root)
    return aps, bridges


ISLAND_MAX_SIZE = 5  # components this small are "islands" listed individually in the summary
TOP_HUBS = 20


def full_graph_snapshot() -> dict:
    """Whole graph + connectivity analytics for the admin diagnostic viz. Pure read, no mutation."""
    nodes = list(MusicNode.objects.all())
    node_ids = [n.id for n in nodes]
    id_set = set(node_ids)
    raw_edges = list(MusicEdge.objects.values("source_id", "target_id", "edge_type", "source_kind", "weight"))

    adjacency: dict[int, list[int]] = defaultdict(list)
    degree: dict[int, int] = defaultdict(int)
    for e in raw_edges:
        s, t = e["source_id"], e["target_id"]
        if s in id_set and t in id_set:
            adjacency[s].append(t)
            adjacency[t].append(s)
            degree[s] += 1
            degree[t] += 1

    component_of, comps = _connected_components(node_ids, adjacency)
    giant = set(comps[0]) if comps else set()
    aps, bridges = _articulation_and_bridges(list(giant), {k: v for k, v in adjacency.items() if k in giant})

    def nid(n):
        return f"{n.node_type}:{n.key}"

    id_to_key = {n.id: nid(n) for n in nodes}
    out_nodes = [
        {
            "id": nid(n),
            "key": n.key,
            "node_type": n.node_type,
            "title": n.title,
            "subtitle": n.subtitle,
            "video_id": n.video_id,
            "play_count": n.play_count,
            "is_liked": n.is_liked,
            "is_subscribed": n.is_subscribed,
            "in_library": n.in_library,
            "degree": degree.get(n.id, 0),
            "component": component_of.get(n.id, 0),
        }
        for n in nodes
    ]
    out_edges = [
        {
            "source": id_to_key[e["source_id"]],
            "target": id_to_key[e["target_id"]],
            "edge_type": e["edge_type"],
            "source_kind": e["source_kind"],
            "weight": e["weight"],
        }
        for e in raw_edges
        if e["source_id"] in id_set and e["target_id"] in id_set
    ]

    # --- summary ---
    node_by_id = {n.id: n for n in nodes}
    degs = sorted(degree.get(i, 0) for i in node_ids)
    deg_hist: dict[str, int] = defaultdict(int)
    for d in degs:
        deg_hist[str(d)] += 1
    comp_sizes = [len(c) for c in comps]
    islands = [
        {
            "component": idx,
            "size": len(c),
            "nodes": [
                {"id": id_to_key[i], "node_type": node_by_id[i].node_type, "title": node_by_id[i].title} for i in c
            ],
        }
        for idx, c in enumerate(comps)
        if len(c) <= ISLAND_MAX_SIZE
    ]
    top_hub_ids = sorted(node_ids, key=lambda i: degree.get(i, 0), reverse=True)[:TOP_HUBS]
    edge_type_counts: dict[str, int] = defaultdict(int)
    source_kind_counts: dict[str, int] = defaultdict(int)
    for e in out_edges:
        edge_type_counts[e["edge_type"]] += 1
        if e["source_kind"]:
            source_kind_counts[e["source_kind"]] += 1
    n = len(degs)
    summary = {
        "node_count": len(nodes),
        "edge_count": len(out_edges),
        "component_count": len(comps),
        "giant_size": len(giant),
        "component_sizes": comp_sizes,
        "islands": islands,
        "degree": {
            "min": degs[0] if degs else 0,
            "max": degs[-1] if degs else 0,
            "mean": round(sum(degs) / n, 2) if n else 0,
            "median": degs[n // 2] if n else 0,
            "histogram": dict(deg_hist),
        },
        "top_hubs": [
            {
                "id": id_to_key[i],
                "node_type": node_by_id[i].node_type,
                "title": node_by_id[i].title,
                "degree": degree.get(i, 0),
                "play_count": node_by_id[i].play_count,
            }
            for i in top_hub_ids
        ],
        "edge_type_counts": dict(edge_type_counts),
        "source_kind_counts": dict(source_kind_counts),
        "articulation_points": [
            {"id": id_to_key[i], "node_type": node_by_id[i].node_type, "title": node_by_id[i].title} for i in aps
        ],
        "bridges": [{"source": id_to_key[a], "target": id_to_key[b]} for a, b in bridges],
        "tagless_artists": _tagless_artist_count(),
    }
    return {"nodes": out_nodes, "edges": out_edges, "summary": summary}


def _tagless_artist_count() -> int:
    """Artists with no tag edge in either direction — the residual island risk."""
    from django.db.models import Q

    total = MusicNode.objects.filter(node_type="artist").count()
    tagged = (
        MusicNode.objects.filter(node_type="artist")
        .filter(Q(edges_out__edge_type="tag") | Q(edges_in__edge_type="tag"))
        .distinct()
        .count()
    )
    return total - tagged
