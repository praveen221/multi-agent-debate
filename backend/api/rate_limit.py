from datetime import datetime, timedelta, timezone

from fastapi import HTTPException

from api.db import get_db

WINDOW_MINUTES = 60
MAX_REQUESTS_PER_WINDOW = 30


def check_and_increment(user_id: str) -> None:
    db = get_db()
    now = datetime.now(timezone.utc)

    response = db.table("mad_rate_limits").select("*").eq("user_id", user_id).maybe_single().execute()
    row = response.data if response else None

    if row is None:
        db.table("mad_rate_limits").insert(
            {"user_id": user_id, "window_start": now.isoformat(), "request_count": 1}
        ).execute()
        return

    window_start = datetime.fromisoformat(row["window_start"])
    if now - window_start > timedelta(minutes=WINDOW_MINUTES):
        db.table("mad_rate_limits").update(
            {"window_start": now.isoformat(), "request_count": 1}
        ).eq("user_id", user_id).execute()
        return

    if row["request_count"] >= MAX_REQUESTS_PER_WINDOW:
        raise HTTPException(status_code=429, detail="Rate limit exceeded — try again later")

    db.table("mad_rate_limits").update({"request_count": row["request_count"] + 1}).eq(
        "user_id", user_id
    ).execute()
