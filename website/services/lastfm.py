import logging

import httpx

logger = logging.getLogger(__name__)

BASE_URL = "https://ws.audioscrobbler.com/2.0/"


def fetch_similar_artists(name: str, api_key: str, limit: int = 50) -> list[dict]:
    """Return [{'name': str, 'match': float}] for artists similar to `name` (CF-derived)."""
    try:
        resp = httpx.get(
            BASE_URL,
            params={
                "method": "artist.getsimilar",
                "artist": name,
                "api_key": api_key,
                "format": "json",
                "limit": limit,
            },
            timeout=10,
        )
        resp.raise_for_status()
        data = resp.json()
    except Exception:
        logger.warning("Last.fm artist.getsimilar failed for %r", name)
        return []
    out = []
    for a in data.get("similarartists", {}).get("artist", []):
        try:
            out.append({"name": a["name"], "match": float(a.get("match", 0))})
        except (KeyError, ValueError, TypeError):
            continue
    return out


def fetch_artist_top_tags(name: str, api_key: str, limit: int = 5) -> list[dict]:
    """Return [{'name': str, 'count': int}] for an artist's top Last.fm tags (genre/mood).

    Tags are the crowd-assigned genre labels. They form the multipartite connective layer of
    the music graph: artists sharing a tag get bridged, so niche/orphan artists reach the giant
    component instead of forming isolated islands.
    """
    try:
        resp = httpx.get(
            BASE_URL,
            params={
                "method": "artist.gettoptags",
                "artist": name,
                "api_key": api_key,
                "format": "json",
            },
            timeout=10,
        )
        resp.raise_for_status()
        data = resp.json()
    except Exception:
        logger.warning("Last.fm artist.gettoptags failed for %r", name)
        return []
    out = []
    for t in data.get("toptags", {}).get("tag", [])[:limit]:
        try:
            count = int(t.get("count", 0))
        except (ValueError, TypeError):
            count = 0
        name_ = t.get("name")
        if name_:
            out.append({"name": name_, "count": count})
    return out


def fetch_similar_tracks(artist: str, title: str, api_key: str, limit: int = 50) -> list[dict]:
    """Return [{'artist': str, 'title': str, 'match': float}] for similar tracks (CF-derived)."""
    try:
        resp = httpx.get(
            BASE_URL,
            params={
                "method": "track.getsimilar",
                "artist": artist,
                "track": title,
                "api_key": api_key,
                "format": "json",
                "limit": limit,
            },
            timeout=10,
        )
        resp.raise_for_status()
        data = resp.json()
    except Exception:
        logger.warning("Last.fm track.getsimilar failed for %r - %r", artist, title)
        return []
    out = []
    for t in data.get("similartracks", {}).get("track", []):
        try:
            out.append({"artist": t["artist"]["name"], "title": t["name"], "match": float(t.get("match", 0))})
        except (KeyError, ValueError, TypeError):
            continue
    return out
