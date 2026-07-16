import json
import urllib.request

MODELS_URL = "https://openrouter.ai/api/v1/models"


def fetch_models() -> list[dict]:
    """Live OpenRouter model catalog. Raises on network/API failure — caller decides the fallback."""
    with urllib.request.urlopen(MODELS_URL, timeout=10) as response:
        return json.load(response)["data"]


def cheapest_first(models: list[dict]) -> list[dict]:
    def prompt_price(m):
        try:
            price = float(m.get("pricing", {}).get("prompt", "inf"))
        except (TypeError, ValueError):
            return float("inf")
        # Some models (e.g. openrouter/auto) report -1 as a "dynamic pricing"
        # sentinel rather than a real per-token cost — treat those as unknown.
        return float("inf") if price < 0 else price

    return sorted(models, key=prompt_price)
