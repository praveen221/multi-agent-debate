import time

from fastapi import Header, HTTPException

from api.db import get_db

# Validating a bearer token calls out to Supabase Auth over the network. That
# happened on *every* request — and one autoplay burst is 6+ requests carrying
# the same token back to back. Cache the validated token -> user_id for a few
# minutes so only the first request in a burst pays that round-trip. Tokens are
# short-lived JWTs; a 5-minute TTL means a just-revoked token stays honored for
# at most that long, which is an acceptable trade for this app.
_TOKEN_TTL_SECONDS = 300
_TOKEN_CACHE_MAX = 512
_token_cache: dict[str, tuple[str, float]] = {}


def get_current_user_id(authorization: str | None = Header(default=None)) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    token = authorization.removeprefix("Bearer ").strip()

    now = time.time()
    cached = _token_cache.get(token)
    if cached and cached[1] > now:
        return cached[0]

    try:
        response = get_db().auth.get_user(token)
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    if not response or not response.user:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    user_id = response.user.id
    # Bounded so it can't grow without limit; tokens are few and short-lived, so
    # clearing wholesale when it fills is fine (the next request re-validates).
    if len(_token_cache) >= _TOKEN_CACHE_MAX:
        _token_cache.clear()
    _token_cache[token] = (user_id, now + _TOKEN_TTL_SECONDS)
    return user_id
