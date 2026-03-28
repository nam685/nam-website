from django.http import JsonResponse

from ..models import TodoSection


def todo_list(_request):
    sections = TodoSection.objects.prefetch_related("items").all()
    data = [
        {
            "title": section.title,
            "items": [{"text": item.text, "done": item.done} for item in section.items.all()],
        }
        for section in sections
    ]
    return JsonResponse(data, safe=False)
