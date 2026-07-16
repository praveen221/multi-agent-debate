from ddgs import DDGS

SNIPPET_MAX_LEN = 200

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


def web_search(query: str, max_results: int = 5) -> list[dict]:
    try:
        raw_results = DDGS().text(query, max_results=max_results)
    except Exception:
        print("[search failed/rate limited]")
        return []

    return [
        {
            "title": r.get("title", ""),
            "url": r.get("href", ""),
            "snippet": r.get("body", "")[:SNIPPET_MAX_LEN],
        }
        for r in raw_results
    ]
