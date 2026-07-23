import json
import logging
import os
import secrets
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

from dotenv import load_dotenv

load_dotenv()

from fastapi import BackgroundTasks, Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from postgrest.exceptions import APIError

import agent_factory
import judge as judge_module
import models as models_module
import titles as titles_module
from debate import build_messages

from api.auth import get_current_user_id
from api.credits import (
    add_spend,
    assert_within_budget,
    check_within_budget,
    get_or_create_credit_row,
)
from api.db import get_db
from api.schemas import (
    CreateSessionRequest,
    FeedbackRequest,
    JudgeActionRequest,
    NextTurnRequest,
    SteerMessageRequest,
    UpdateSessionRequest,
)

logger = logging.getLogger("mad")

app = FastAPI(title="Multi-Agent Debate API")

allowed_origins = os.environ.get("ALLOWED_ORIGINS", "http://localhost:3000").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    # HTTPException (rate limits, 404s, etc.) never reaches here — Starlette
    # handles those separately. This only catches genuinely unexpected
    # crashes (a bad model slug, an OpenRouter outage, ...) so a stranger
    # never sees a raw Python exception.
    logger.exception("Unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=500,
        content={"detail": "Something went wrong on our end. Please try again."},
    )


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/models")
def list_models(user_id: str = Depends(get_current_user_id)):
    catalog = models_module.cheapest_first(models_module.fetch_models())
    return [{"id": m["id"], "pricing": m.get("pricing", {})} for m in catalog]


@app.get("/api/credits")
def get_credits(user_id: str = Depends(get_current_user_id)):
    row = get_or_create_credit_row(user_id)
    return {"spent_usd": row["spent_usd"], "limit_usd": row["limit_usd"]}


def _generate_and_store_title(session_id: str, topic: str, user_id: str) -> None:
    """Background task after session creation. Only fills the title if it's
    still empty, so a user rename that lands first is never overwritten."""
    title, cost = titles_module.generate_title(topic)
    if title:
        get_db().table("mad_sessions").update({"title": title}).eq("id", session_id).is_(
            "title", "null"
        ).execute()
    if cost:
        add_spend(user_id, cost)


@app.post("/api/sessions")
def create_session(
    body: CreateSessionRequest,
    background_tasks: BackgroundTasks,
    user_id: str = Depends(get_current_user_id),
):
    check_within_budget(user_id)
    db = get_db()
    result = (
        db.table("mad_sessions")
        .insert(
            {
                "user_id": user_id,
                "topic": body.topic,
                "subject": body.subject or body.topic,
                "template_label": body.template_label,
                "agents": [a.model_dump() for a in body.agents],
                "judge": body.judge.model_dump() if body.judge else None,
                "status": "active",
            }
        )
        .execute()
    )
    session = result.data[0]
    background_tasks.add_task(_generate_and_store_title, session["id"], body.topic, user_id)
    return {"session_id": session["id"], "topic": session["topic"], "agents": session["agents"]}


@app.get("/api/sessions")
def list_sessions(user_id: str = Depends(get_current_user_id)):
    db = get_db()
    rows = (
        db.table("mad_sessions")
        .select("id, topic, title, status, created_at")
        .eq("user_id", user_id)
        .is_("deleted_at", "null")
        .order("created_at", desc=True)
        .execute()
        .data
    )
    return [
        {
            "session_id": r["id"],
            "topic": r["topic"],
            "title": r["title"],
            "status": r["status"],
            "created_at": r["created_at"],
        }
        for r in rows
    ]


def _insert_turn(db, row: dict) -> dict:
    """Insert a turn, healing a turn_index collision. The index is picked from
    a read that can be stale by write time — a human steer message can slip in
    at the same index while a turn is being produced, and the duplicate-key
    crash that causes is exactly what stranded a real session (the reply saved
    fine, then the insert 23505'd and the whole turn was lost). On a unique
    violation, re-read the current end of the transcript and insert there.
    For turns that must always land: the human steer message and the judge's
    remark. The agent-turn path handles a collision differently (see
    next_turn) — its reply is now stale, so it's dropped and the page resyncs
    rather than landing out of order."""
    for attempt in range(6):
        try:
            return db.table("mad_turns").insert(row).execute().data[0]
        except APIError as e:
            if getattr(e, "code", None) != "23505" or attempt == 5:
                raise
            count = (
                db.table("mad_turns")
                .select("id", count="exact")
                .eq("session_id", row["session_id"])
                .execute()
                .count
            )
            row = {**row, "turn_index": count}


def _load_session(session_id: str, user_id: str) -> dict:
    db = get_db()
    result = db.table("mad_sessions").select("*").eq("id", session_id).maybe_single().execute()
    session = result.data if result else None
    if session is None or session.get("deleted_at"):
        raise HTTPException(status_code=404, detail="Session not found")
    if session["user_id"] != user_id:
        raise HTTPException(status_code=403, detail="Not your session")
    return session


@app.get("/api/sessions/{session_id}")
def get_session(session_id: str, user_id: str = Depends(get_current_user_id)):
    session = _load_session(session_id, user_id)
    db = get_db()
    turns = (
        db.table("mad_turns")
        .select("*")
        .eq("session_id", session_id)
        .order("turn_index")
        .execute()
        .data
    )
    return {"session": session, "turns": turns}


@app.post("/api/sessions/{session_id}/next")
def next_turn(
    session_id: str,
    body: NextTurnRequest | None = None,
    user_id: str = Depends(get_current_user_id),
):
    db = get_db()

    # The session row, the transcript, and the credit row don't depend on each
    # other — fetch them together so the turn pays one round-trip of DB latency
    # up front instead of three back to back. The credit row fetched here is
    # reused at the end for add_spend, so the whole turn reads it once.
    with ThreadPoolExecutor(max_workers=3) as pool:
        f_session = pool.submit(
            lambda: db.table("mad_sessions")
            .select("*")
            .eq("id", session_id)
            .maybe_single()
            .execute()
        )
        f_turns = pool.submit(
            lambda: db.table("mad_turns")
            .select("*")
            .eq("session_id", session_id)
            .order("turn_index")
            .execute()
        )
        f_credit = pool.submit(get_or_create_credit_row, user_id)
        session_res = f_session.result()
        transcript = f_turns.result().data
        credit_row = f_credit.result()

    session = session_res.data if session_res else None
    if session is None or session.get("deleted_at"):
        raise HTTPException(status_code=404, detail="Session not found")
    if session["user_id"] != user_id:
        raise HTTPException(status_code=403, detail="Not your session")
    if session["status"] != "active":
        raise HTTPException(status_code=400, detail="Debate has already ended")
    assert_within_budget(credit_row)

    turn_index = len(transcript)

    if body and body.expected_turn_index is not None and body.expected_turn_index != turn_index:
        raise HTTPException(
            status_code=409,
            detail=(
                "This page was out of sync with the debate — it has been refreshed. "
                "Continue when ready."
            ),
        )

    agents = [agent_factory.build_agent(cfg) for cfg in session["agents"]]
    agent_turns = [t for t in transcript if t.get("role", "agent") == "agent"]
    next_agent = agents[len(agent_turns) % len(agents)]
    messages = build_messages(next_agent, transcript, session["topic"])

    def event_stream():
        # A StreamingResponse has already sent a 200 and started the body by
        # the time this runs — an exception here can't turn into a different
        # HTTP status. Catch it and emit a clean error event instead of
        # letting the stream just cut off with a raw traceback.
        try:
            final_text = None
            cost = 0.0
            sources = []
            for event in next_agent.respond_streaming(messages):
                if event["type"] == "token":
                    yield json.dumps({"type": "token", "text": event["text"]}) + "\n"
                elif event["type"] == "token_reset":
                    yield json.dumps({"type": "token_reset"}) + "\n"
                elif event["type"] == "tool_call" and event["name"] == "web_search":
                    query = event["args"].get("query", "")
                    yield json.dumps({"type": "search", "query": query}) + "\n"
                elif event["type"] == "tool_result" and event["name"] == "web_search":
                    yield (
                        json.dumps(
                            {
                                "type": "search_result",
                                "query": event["query"],
                                "result_count": event["result_count"],
                                "titles": event["titles"],
                            }
                        )
                        + "\n"
                    )
                elif event["type"] == "text":
                    final_text = event["text"]
                    cost = event["cost"]
                    sources = event.get("sources", [])

            try:
                db.table("mad_turns").insert(
                    {
                        "session_id": session_id,
                        "turn_index": turn_index,
                        "role": "agent",
                        "speaker": next_agent.name,
                        "text": final_text,
                        "cost_usd": cost,
                        "sources": sources,
                    }
                ).execute()
            except APIError as e:
                if getattr(e, "code", None) != "23505":
                    raise
                # A human steer message (or another turn) claimed this index
                # while the reply was still being written, so the reply is
                # stale — it never saw what arrived. Drop it, don't bill for
                # it, and tell the page to resync (the same out-of-sync
                # recovery as the pre-flight 409); the next turn is generated
                # against the updated transcript and responds to the steer.
                logger.info(
                    "Turn %s superseded mid-generation for session %s", turn_index, session_id
                )
                yield (
                    json.dumps(
                        {
                            "type": "error",
                            "message": (
                                "A new message came in while this turn was being written, so "
                                "it's out of sync. The page has been refreshed — continue when "
                                "you're ready."
                            ),
                        }
                    )
                    + "\n"
                )
                return
            total_spent = add_spend(user_id, cost, row=credit_row)
            yield (
                json.dumps(
                    {
                        "type": "turn",
                        "turn_index": turn_index,
                        "role": "agent",
                        "speaker": next_agent.name,
                        "text": final_text,
                        "cost_usd": cost,
                        "sources": sources,
                        "total_spent_usd": total_spent,
                    }
                )
                + "\n"
            )
        except Exception:
            logger.exception("Error generating turn for session %s", session_id)
            yield (
                json.dumps(
                    {
                        "type": "error",
                        "message": (
                            f"Couldn't generate {next_agent.name}'s turn — the model may be "
                            "unavailable right now. Please try again."
                        ),
                    }
                )
                + "\n"
            )

    return StreamingResponse(event_stream(), media_type="application/x-ndjson")


@app.post("/api/sessions/{session_id}/messages")
def add_steer_message(
    session_id: str, body: SteerMessageRequest, user_id: str = Depends(get_current_user_id)
):
    session = _load_session(session_id, user_id)
    if session["status"] != "active":
        raise HTTPException(status_code=400, detail="Debate has already ended")

    db = get_db()
    turn_index = (
        db.table("mad_turns")
        .select("id", count="exact")
        .eq("session_id", session_id)
        .execute()
        .count
    )
    turn = _insert_turn(
        db,
        {
            "session_id": session_id,
            "turn_index": turn_index,
            "role": "human",
            "speaker": "Moderator",
            "text": body.text,
            "cost_usd": 0,
        },
    )
    return {
        "turn_index": turn["turn_index"],
        "role": "human",
        "speaker": "Moderator",
        "text": turn["text"],
    }


@app.patch("/api/sessions/{session_id}")
def update_session(
    session_id: str, body: UpdateSessionRequest, user_id: str = Depends(get_current_user_id)
):
    session = _load_session(session_id, user_id)
    updates: dict = {}
    if body.judge is not None:
        # Toggling the judge only makes sense on a live discussion; renaming
        # is fine at any point.
        if session["status"] != "active":
            raise HTTPException(status_code=400, detail="Debate has already ended")
        updates["judge"] = body.judge.model_dump()
    if body.title is not None:
        updates["title"] = body.title.strip()
    if not updates:
        raise HTTPException(status_code=400, detail="Nothing to update")
    get_db().table("mad_sessions").update(updates).eq("id", session_id).execute()
    return updates


@app.delete("/api/sessions/{session_id}")
def delete_session(session_id: str, user_id: str = Depends(get_current_user_id)):
    """Soft delete: hidden from the account and any share link dies, but the
    row stays (see the privacy page's data-retention wording)."""
    _load_session(session_id, user_id)
    get_db().table("mad_sessions").update(
        {"deleted_at": datetime.now(timezone.utc).isoformat(), "share_id": None}
    ).eq("id", session_id).execute()
    return {"deleted": True}


@app.post("/api/feedback")
def submit_feedback(body: FeedbackRequest, user_id: str = Depends(get_current_user_id)):
    if not body.message.strip() and body.rating is None:
        raise HTTPException(status_code=400, detail="Nothing to submit")
    get_db().table("mad_feedback").insert(
        {
            "user_id": user_id,
            "category": body.category,
            "message": body.message.strip(),
            "rating": body.rating,
            "trigger_point": body.trigger_point,
            "page": body.page,
        }
    ).execute()
    return {"ok": True}


DEFAULT_JUDGE_MODEL = "moonshotai/kimi-k2.5"


@app.post("/api/sessions/{session_id}/judge")
def judge_action(
    session_id: str, body: JudgeActionRequest, user_id: str = Depends(get_current_user_id)
):
    session = _load_session(session_id, user_id)
    judge_config = session.get("judge") or {}

    db = get_db()
    transcript = (
        db.table("mad_turns")
        .select("*")
        .eq("session_id", session_id)
        .order("turn_index")
        .execute()
        .data
    )
    turn_index = len(transcript)

    if body.action == "report":
        # The closing report runs on concluded debates and doesn't require
        # the judge toggle — it's the debate's ending, not an interruption.
        if session["status"] != "ended":
            raise HTTPException(status_code=400, detail="Conclude the debate first")
        existing = next(
            (t for t in transcript if (t.get("verdict") or {}).get("kind") == "report"), None
        )
        if existing:
            return {
                "turn_index": existing["turn_index"],
                "role": "judge",
                "speaker": "Judge",
                "text": existing["text"],
                "cost_usd": existing["cost_usd"],
                "verdict": existing["verdict"],
            }
        check_within_budget(user_id)
        model = judge_config.get("model") or DEFAULT_JUDGE_MODEL
        text, verdict, cost = judge_module.run_report(
            model, session["topic"], transcript, agents=session["agents"]
        )
        inserted = _insert_turn(
            db,
            {
                "session_id": session_id,
                "turn_index": turn_index,
                "role": "judge",
                "speaker": "Judge",
                "text": text,
                "cost_usd": cost,
                "verdict": verdict,
            },
        )
        add_spend(user_id, cost)
        return {
            "turn_index": inserted["turn_index"],
            "role": "judge",
            "speaker": "Judge",
            "text": text,
            "cost_usd": cost,
            "verdict": verdict,
        }

    if session["status"] != "active":
        raise HTTPException(status_code=400, detail="Debate has already ended")
    if not judge_config.get("enabled"):
        raise HTTPException(status_code=400, detail="The judge is not enabled for this session")

    if body.action == "intervene":
        # No model call — promote an existing verdict's text into the debate.
        source = next(
            (
                t
                for t in transcript
                if t["turn_index"] == body.source_turn_index and t.get("role") == "judge"
            ),
            None,
        )
        if source is None:
            raise HTTPException(status_code=404, detail="Judge remark not found")
        text = source["text"]
        verdict = {"kind": "intervention", "action": "intervene"}
        cost = 0.0
    else:
        check_within_budget(user_id)
        if body.action == "verdict":
            text, verdict, cost = judge_module.run_verdict(
                judge_config["model"], session["topic"], transcript, agents=session["agents"]
            )
        else:  # pressure_test | refocus
            text, cost = judge_module.run_interjection(
                judge_config["model"], session["topic"], transcript, body.action,
                agents=session["agents"],
            )
            verdict = {"kind": "intervention", "action": body.action}

    inserted = _insert_turn(
        db,
        {
            "session_id": session_id,
            "turn_index": turn_index,
            "role": "judge",
            "speaker": "Judge",
            "text": text,
            "cost_usd": cost,
            "verdict": verdict,
        },
    )
    if cost:
        add_spend(user_id, cost)

    return {
        "turn_index": inserted["turn_index"],
        "role": "judge",
        "speaker": "Judge",
        "text": text,
        "cost_usd": cost,
        "verdict": verdict,
    }


@app.post("/api/sessions/{session_id}/share")
def share_session(session_id: str, user_id: str = Depends(get_current_user_id)):
    session = _load_session(session_id, user_id)
    if session.get("share_id"):
        return {"share_id": session["share_id"]}
    share_id = secrets.token_urlsafe(12)
    get_db().table("mad_sessions").update({"share_id": share_id}).eq("id", session_id).execute()
    return {"share_id": share_id}


@app.post("/api/sessions/{session_id}/unshare")
def unshare_session(session_id: str, user_id: str = Depends(get_current_user_id)):
    _load_session(session_id, user_id)
    get_db().table("mad_sessions").update({"share_id": None}).eq("id", session_id).execute()
    return {"share_id": None}


@app.get("/api/public/{share_id}")
def get_public_debate(share_id: str):
    """Unauthenticated read of a shared debate. Sanitized: no user_id, no
    costs, no personas — just what a reader of the debate should see."""
    db = get_db()
    result = (
        db.table("mad_sessions").select("*").eq("share_id", share_id).maybe_single().execute()
    )
    session = result.data if result else None
    if session is None or session.get("deleted_at"):
        raise HTTPException(status_code=404, detail="Debate not found")
    turns = (
        db.table("mad_turns")
        .select("turn_index, role, speaker, text, sources, verdict")
        .eq("session_id", session["id"])
        .order("turn_index")
        .execute()
        .data
    )
    return {
        "topic": session["topic"],
        "subject": session.get("subject") or session["topic"],
        "template_label": session.get("template_label"),
        "status": session["status"],
        "created_at": session["created_at"],
        "agents": [
            {
                "name": a["name"],
                "model": a["model"],
                "use_search": a.get("use_search", False),
                # mode/stance are part of the debate's honest framing — a
                # reader must be able to tell advocacy from belief. Personas
                # stay private.
                "mode": a.get("mode", "discuss"),
                "stance": a.get("stance"),
            }
            for a in session["agents"]
        ],
        "turns": turns,
    }


@app.post("/api/sessions/{session_id}/end")
def end_session(session_id: str, user_id: str = Depends(get_current_user_id)):
    _load_session(session_id, user_id)
    db = get_db()
    db.table("mad_sessions").update(
        {"status": "ended", "ended_at": datetime.now(timezone.utc).isoformat()}
    ).eq("id", session_id).execute()
    return {"status": "ended"}
