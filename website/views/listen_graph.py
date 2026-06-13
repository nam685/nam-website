from django.http import JsonResponse
from django.views.decorators.http import require_GET

from ..services import music_graph


@require_GET
def graph_patch(request):
    """Return a patch (seed + neighborhood). No seed -> recommendation-weighted random."""
    seed = request.GET.get("seed") or None
    seed_type = request.GET.get("type") or None
    patch = music_graph.get_patch(seed_key=seed, seed_type=seed_type)
    return JsonResponse(patch)


@require_GET
def graph_search(request):
    """Search nodes by title/subtitle to re-seed the graph."""
    query = request.GET.get("q", "")
    return JsonResponse({"results": music_graph.search_nodes(query)})
