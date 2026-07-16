import json
import os
from datetime import datetime, timezone

from dotenv import load_dotenv

load_dotenv()

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

import agent_factory
import models as models_module
from debate import build_messages

from api.auth import get_current_user_id
from api.credits import add_spend, check_within_budget, get_or_create_credit_row
from api.db import get_db
from api.schemas import CreateSessionRequest

app = FastAPI(title="Multi-Agent Debate API")

allowed_origins = os.environ.get("ALLOWED_ORIGINS", "http://localhost:3000").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
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
    next_agent = agents[len(transcript) % len(agents)]
    messages = build_messages(next_agent, transcript, session["topic"])
    turn_index = len(transcript)

    def event_stream():
        final_text = None
        cost = 0.0
        for event in next_agent.respond_streaming(messages):
            if event["type"] == "tool_call" and event["name"] == "web_search":
                query = event["args"].get("query", "")
                yield json.dumps({"type": "search", "query": query}) + "\n"
            elif event["type"] == "text":
                final_text = event["text"]
                cost = event["cost"]

        db.table("mad_turns").insert(
            {
                "session_id": session_id,
                "turn_index": turn_index,
                "speaker": next_agent.name,
                "text": final_text,
                "cost_usd": cost,
            }
        ).execute()
        total_spent = add_spend(user_id, cost)
        yield (
            json.dumps(
                {
                    "type": "turn",
                    "turn_index": turn_index,
                    "speaker": next_agent.name,
                    "text": final_text,
                    "cost_usd": cost,
                    "total_spent_usd": total_spent,
                }
            )
            + "\n"
        )

    return StreamingResponse(event_stream(), media_type="application/x-ndjson")


@app.post("/api/sessions/{session_id}/end")
def end_session(session_id: str, user_id: str = Depends(get_current_user_id)):
    _load_session(session_id, user_id)
    db = get_db()
    db.table("mad_sessions").update(
        {"status": "ended", "ended_at": datetime.now(timezone.utc).isoformat()}
    ).eq("id", session_id).execute()
    return {"status": "ended"}
