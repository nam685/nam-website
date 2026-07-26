from django.core.cache import cache as redis_cache
from django.http import JsonResponse
from django.views.decorators.http import require_GET

from ..auth import require_admin
from ..services import music_graph

# Ring of the last few seedless "shuffle" seeds, so consecutive shuffles don't repeat the same node.
_RECENT_SEEDS_KEY = "graph_recent_seeds"
_RECENT_SEEDS_MAX = 8


@require_GET
def graph_patch(request):
    """Return a patch (seed + neighborhood). No seed -> song-forward weighted-random shuffle."""
    seed = request.GET.get("seed") or None
    seed_type = request.GET.get("type") or None

    recent = list(redis_cache.get(_RECENT_SEEDS_KEY) or []) if seed is None else []
    patch = music_graph.get_patch(seed_key=seed, seed_type=seed_type, exclude_keys=set(recent))

    if seed is None and patch.get("seed"):
        key = patch["seed"]  # get_patch returns the seed node's key string
        recent = [k for k in recent if k != key] + [key]
        redis_cache.set(_RECENT_SEEDS_KEY, recent[-_RECENT_SEEDS_MAX:], 3600)

    return JsonResponse(patch)


@require_GET
def graph_search(request):
    """Search nodes by title/subtitle to re-seed the graph."""
    query = request.GET.get("q", "")
    return JsonResponse({"results": music_graph.search_nodes(query)})


@require_GET
@require_admin
def graph_full(request):  # noqa: ARG001
    """Whole graph + connectivity analytics for the admin diagnostic viz (admin-gated)."""
    return JsonResponse(music_graph.get_full_graph())
