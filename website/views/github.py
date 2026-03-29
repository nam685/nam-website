import json
import logging
import os
import urllib.request

from django.core.cache import cache
from django.http import JsonResponse

logger = logging.getLogger(__name__)

GITHUB_USERNAME = "nam685"
GITHUB_GRAPHQL_URL = "https://api.github.com/graphql"
CACHE_KEY = "github_contributions"
CACHE_TTL = 3600  # 1 hour


def _fetch_contributions():
    token = os.environ.get("GITHUB_TOKEN", "")
    if not token:
        return None

    query = """
    {
      user(login: "%s") {
        contributionsCollection {
          contributionCalendar {
            totalContributions
            weeks {
              contributionDays {
                contributionCount
                date
              }
            }
          }
        }
      }
    }
    """ % GITHUB_USERNAME

    req = urllib.request.Request(
        GITHUB_GRAPHQL_URL,
        data=json.dumps({"query": query}).encode(),
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
    )

    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read())
            return data["data"]["user"]["contributionsCollection"]["contributionCalendar"]
    except Exception:
        logger.exception("Failed to fetch GitHub contributions")
        return None


def contributions(_request):
    cached = cache.get(CACHE_KEY)
    if cached is not None:
        return JsonResponse({"contributions": cached})

    data = _fetch_contributions()
    if data is None:
        return JsonResponse({"contributions": None}, status=502)

    cache.set(CACHE_KEY, data, CACHE_TTL)
    return JsonResponse({"contributions": data})
