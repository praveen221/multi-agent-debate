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


def check_within_budget(user_id: str) -> dict:
    row = get_or_create_credit_row(user_id)
    if row["spent_usd"] >= row["limit_usd"]:
        raise HTTPException(
            status_code=402,
            detail=(
                f"You've used your ${row['limit_usd']:.2f} debate credit. "
                f"Email {OWNER_EMAIL} for more."
            ),
        )
    return row


def add_spend(user_id: str, amount: float) -> float:
    """Returns the new total spent_usd."""
    db = get_db()
    row = get_or_create_credit_row(user_id)
    new_total = row["spent_usd"] + amount
    db.table("mad_user_credits").update({"spent_usd": new_total}).eq("user_id", user_id).execute()
    return new_total
