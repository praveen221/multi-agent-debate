import json
import logging
import os
from datetime import datetime, timezone

from dotenv import load_dotenv

load_dotenv()

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse

import agent_factory
import models as models_module
from debate import build_messages

from api.auth import get_current_user_id
from api.credits import add_spend, check_within_budget, get_or_create_credit_row
from api.db import get_db
from api.schemas import CreateSessionRequest, SteerMessageRequest

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


@app.post("/api/sessions")
def create_session(body: CreateSessionRequest, user_id: str = Depends(get_current_user_id)):
    check_within_budget(user_id)
    db = get_db()
    result = (
        db.table("mad_sessions")
        .insert(
            {
                "user_id": user_id,
                "topic": body.topic,
                "agents": [a.model_dump() for a in body.agents],
                "status": "active",
            }
        )
        .execute()
    )
    session = result.data[0]
    return {"session_id": session["id"], "topic": session["topic"], "agents": session["agents"]}


@app.get("/api/sessions")
def list_sessions(user_id: str = Depends(get_current_user_id)):
    db = get_db()
    rows = (
        db.table("mad_sessions")
        .select("id, topic, status, created_at")
        .eq("user_id", user_id)
        .order("created_at", desc=True)
        .execute()
        .data
    )
    return [
        {
            "session_id": r["id"],
            "topic": r["topic"],
            "status": r["status"],
            "created_at": r["created_at"],
        }
        for r in rows
    ]


def _load_session(session_id: str, user_id: str) -> dict:
    db = get_db()
    result = db.table("mad_sessions").select("*").eq("id", session_id).maybe_single().execute()
    session = result.data if result else None
    if session is None:
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
def next_turn(session_id: str, user_id: str = Depends(get_current_user_id)):
    session = _load_session(session_id, user_id)
    if session["status"] != "active":
        raise HTTPException(status_code=400, detail="Debate has already ended")

    check_within_budget(user_id)

    db = get_db()
    transcript = (
        db.table("mad_turns")
        .select("*")
        .eq("session_id", session_id)
        .order("turn_index")
        .execute()
        .data
    )

    agents = [agent_factory.build_agent(cfg) for cfg in session["agents"]]
    agent_turns = [t for t in transcript if t.get("role", "agent") == "agent"]
    next_agent = agents[len(agent_turns) % len(agents)]
    messages = build_messages(next_agent, transcript, session["topic"])
    turn_index = len(transcript)

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
                if event["type"] == "tool_call" and event["name"] == "web_search":
                    query = event["args"].get("query", "")
                    yield json.dumps({"type": "search", "query": query}) + "\n"
                elif event["type"] == "text":
                    final_text = event["text"]
                    cost = event["cost"]
                    sources = event.get("sources", [])

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
            total_spent = add_spend(user_id, cost)
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
    result = (
        db.table("mad_turns")
        .insert(
            {
                "session_id": session_id,
                "turn_index": turn_index,
                "role": "human",
                "speaker": "Moderator",
                "text": body.text,
                "cost_usd": 0,
            }
        )
        .execute()
    )
    turn = result.data[0]
    return {
        "turn_index": turn["turn_index"],
        "role": "human",
        "speaker": "Moderator",
        "text": turn["text"],
    }


@app.post("/api/sessions/{session_id}/end")
def end_session(session_id: str, user_id: str = Depends(get_current_user_id)):
    _load_session(session_id, user_id)
    db = get_db()
    db.table("mad_sessions").update(
        {"status": "ended", "ended_at": datetime.now(timezone.utc).isoformat()}
    ).eq("id", session_id).execute()
    return {"status": "ended"}
