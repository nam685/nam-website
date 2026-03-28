from django.http import JsonResponse

from ..models import Project


def project_list(_request):
    projects = Project.objects.all()
    data = [
        {
            "title": p.title,
            "slug": p.slug,
            "description": p.description,
            "tags": p.tags,
            "github_url": p.github_url,
            "live_url": p.live_url,
            "extra_links": p.extra_links,
            "status": p.status,
        }
        for p in projects
    ]
    return JsonResponse(data, safe=False)
