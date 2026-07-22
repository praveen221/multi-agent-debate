import json
import os
import urllib.request

from ddgs import DDGS

SNIPPET_MAX_LEN = 200
SERPER_URL = "https://google.serper.dev/search"

WEB_SEARCH_TOOL = {
    "type": "function",
    "function": {
        "name": "web_search",
        "description": "Search the web and return a list of results with title, url, and snippet.",
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "The search query.",
                },
                "max_results": {
                    "type": "integer",
                    "description": "Maximum number of results to return.",
                    "default": 5,
                },
            },
            "required": ["query"],
        },
    },
}


def _serper_search(query: str, max_results: int) -> list[dict] | None:
    """Google results via Serper — fast and reliable. Returns None when no key
    is configured (caller falls back to DuckDuckGo); raises on a network/API
    error so the caller can fall back on that too."""
    api_key = os.environ.get("SERPER_API_KEY")
    if not api_key:
        return None
    body = json.dumps({"q": query, "num": max_results}).encode()
    request = urllib.request.Request(
        SERPER_URL,
        data=body,
        headers={"X-API-KEY": api_key, "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=10) as response:
        data = json.load(response)
    return [
        {
            "title": r.get("title", ""),
            "url": r.get("link", ""),
            "snippet": (r.get("snippet", "") or "")[:SNIPPET_MAX_LEN],
        }
        for r in data.get("organic", [])[:max_results]
    ]


def _ddg_search(query: str, max_results: int) -> list[dict]:
    """DuckDuckGo via the ddgs library — the free fallback. Slower (2-5s) and
    rate-limit prone, but needs no key."""
    return [
        {
            "title": r.get("title", ""),
            "url": r.get("href", ""),
            "snippet": (r.get("body", "") or "")[:SNIPPET_MAX_LEN],
        }
        for r in DDGS().text(query, max_results=max_results)
    ]


def web_search(query: str, max_results: int = 5) -> list[dict]:
    """Prefer Serper (Google, ~10x faster and reliable); fall back to
    DuckDuckGo whenever Serper is unconfigured, errors, or comes back empty —
    so a missing/expired key or a Serper outage degrades the search rather than
    breaking the turn. Both return the same {title, url, snippet} shape."""
    try:
        results = _serper_search(query, max_results)
        if results:
            return results
    except Exception:
        print("[serper search failed — falling back to duckduckgo]")

    try:
        return _ddg_search(query, max_results)
    except Exception:
        print("[search failed/rate limited]")
        return []
