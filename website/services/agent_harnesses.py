import httpx

FEED_URL = "https://raw.githubusercontent.com/RyanAlberts/best-of-Agent-Harnesses/main/harnesses.json"

# Category ids (per the feed's own taxonomy) relevant to devops/agent-harness tooling.
# Excludes categories like evaluation/observability/research-task/memory/libraries-sdks,
# which skew toward building agent products rather than tools you'd install and use.
RELEVANT_CATEGORIES = {
    "coding-agent-products",
    "coding-harness-configs",
    "plugins-mcp-cli",
    "personal-agent-runtimes",
    "multi-agent",
}


def fetch_harnesses() -> list[dict]:
    """Fetch and filter the best-of-Agent-Harnesses feed to devops-relevant projects."""
    resp = httpx.get(FEED_URL, timeout=15)
    resp.raise_for_status()
    data = resp.json()

    return [p for p in data.get("projects", []) if p.get("category") in RELEVANT_CATEGORIES]
