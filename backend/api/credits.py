from fastapi import HTTPException

from api.db import get_db

DEFAULT_LIMIT_USD = 5.00
OWNER_EMAIL = "mpj1391996@gmail.com"


def get_or_create_credit_row(user_id: str) -> dict:
    db = get_db()
    response = db.table("mad_user_credits").select("*").eq("user_id", user_id).maybe_single().execute()
    row = response.data if response else None
    if row is None:
        row = (
            db.table("mad_user_credits")
            .insert({"user_id": user_id, "spent_usd": 0, "limit_usd": DEFAULT_LIMIT_USD})
            .execute()
            .data[0]
        )
    return row


def assert_within_budget(row: dict) -> dict:
    """Budget check against an already-fetched credit row — lets the turn path
    fetch the row once (in parallel with its other reads) and check it here
    without a second round-trip."""
    if row["spent_usd"] >= row["limit_usd"]:
        raise HTTPException(
            status_code=402,
            detail=(
                f"You've used your ${row['limit_usd']:.2f} debate credit. "
                f"Email {OWNER_EMAIL} for more."
            ),
        )
    return row


def check_within_budget(user_id: str) -> dict:
    return assert_within_budget(get_or_create_credit_row(user_id))


def add_spend(user_id: str, amount: float, row: dict | None = None) -> float:
    """Returns the new total spent_usd. Pass `row` to reuse a credit row already
    fetched earlier in the request (the turn path checks the budget up front and
    then records spend at the end — no reason to read the same row twice). A
    single user drives their debate sequentially, so the pre-fetched row can't
    have gone stale between the check and the write."""
    db = get_db()
    if row is None:
        row = get_or_create_credit_row(user_id)
    new_total = row["spent_usd"] + amount
    db.table("mad_user_credits").update({"spent_usd": new_total}).eq("user_id", user_id).execute()
    return new_total
