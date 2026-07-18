"""The LLM judge: reads the debate transcript from the sideline and either
produces a structured verdict (for the human, never shown to the agents) or
an interjection (spoken into the debate). One completion call per action,
no tools — the judge prods, the agents (who have search) verify."""

import json
import re

from client import get_client

DIRECTIONS = {"converging", "diverging", "off_topic", "stalling", "balanced"}
SUGGESTED_ACTIONS = {"none", "intervene", "pressure_test", "refocus"}

VERDICT_SYSTEM = (
    "You are the judge overseeing a multi-participant debate. You observe from "
    "the sideline; you are not a participant. Read the transcript and assess "
    "where the discussion is heading. Respond with ONLY a JSON object — no "
    "markdown fences, no commentary — with exactly these keys:\n"
    '- "direction": one of "converging", "diverging", "off_topic", "stalling", "balanced"\n'
    '- "summary": 1-2 sentences on the current state and trajectory of the debate, '
    "referencing the actual arguments made\n"
    '- "agreements": array of short strings — points the participants now agree on (may be empty)\n'
    '- "contentions": array of short strings — points still in dispute (may be empty)\n'
    '- "suggested_action": one of "none", "intervene", "pressure_test", "refocus". '
    "Use pressure_test when participants are converging without enough scrutiny, "
    "refocus when the discussion has drifted from the topic, intervene when you have "
    "an observation the participants themselves ought to hear, and none otherwise."
)

PRESSURE_TEST_SYSTEM = (
    "You are the judge overseeing a multi-participant debate. The participants "
    "appear to be settling into agreement. Write a short interjection addressed "
    "to all of them together — 2-3 pointed counter-questions challenging the "
    "points they currently agree on, even claims that are likely correct. You "
    "are not fact-checking and must not assert that anything is wrong; your job "
    "is to push them to re-examine their reasoning and evidence once more. "
    "Output only the interjection text, spoken directly to the participants."
)

REFOCUS_SYSTEM = (
    "You are the judge overseeing a multi-participant debate. The discussion "
    "has drifted from the original topic. Write a short interjection addressed "
    "to all participants: point out concretely where the discussion wandered, "
    "and pull them back to the original topic. Output only the interjection "
    "text, spoken directly to the participants."
)

_JSON_FENCE_RE = re.compile(r"^\s*```(?:json)?\s*|\s*```\s*$")


def _render_transcript(transcript: list[dict]) -> str:
    """Text-only transcript for the judge. Verdicts are excluded — the judge
    re-reads the debate fresh each time instead of compounding on its own
    past reads — but its spoken interjections are part of the record."""
    lines = []
    for turn in transcript:
        role = turn.get("role", "agent")
        if role == "agent":
            lines.append(f"{turn['speaker']}: {turn['text']}")
        elif role == "human":
            lines.append(f"Human moderator: {turn['text']}")
        elif role == "judge" and (turn.get("verdict") or {}).get("kind") == "intervention":
            lines.append(f"You (the judge) interjected: {turn['text']}")
    return "\n\n".join(lines)


def _call(model: str, system: str, user_content: str) -> tuple[str, float]:
    client = get_client("openrouter")
    response = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user_content},
        ],
    )
    cost = getattr(response.usage, "cost", 0) or 0
    return response.choices[0].message.content or "", cost


def _parse_verdict(raw: str) -> dict:
    """Best-effort parse. A malformed judge response must never break the
    debate flow — fall back to treating the whole text as the summary."""
    try:
        parsed = json.loads(_JSON_FENCE_RE.sub("", raw.strip()))
        if not isinstance(parsed, dict):
            raise ValueError("not an object")
    except (json.JSONDecodeError, ValueError):
        return {
            "kind": "verdict",
            "direction": None,
            "summary": raw.strip(),
            "agreements": [],
            "contentions": [],
            "suggested_action": "none",
        }

    direction = parsed.get("direction")
    suggested = parsed.get("suggested_action")
    return {
        "kind": "verdict",
        "direction": direction if direction in DIRECTIONS else None,
        "summary": str(parsed.get("summary") or raw.strip()),
        "agreements": [str(a) for a in parsed.get("agreements") or [] if a],
        "contentions": [str(c) for c in parsed.get("contentions") or [] if c],
        "suggested_action": suggested if suggested in SUGGESTED_ACTIONS else "none",
    }


def run_verdict(model: str, topic: str, transcript: list[dict]) -> tuple[str, dict, float]:
    """Returns (display_text, verdict_jsonb, cost)."""
    user_content = f"The debate topic is: {topic}\n\nTranscript so far:\n\n{_render_transcript(transcript)}"
    raw, cost = _call(model, VERDICT_SYSTEM, user_content)
    verdict = _parse_verdict(raw)
    return verdict["summary"], verdict, cost


def run_interjection(model: str, topic: str, transcript: list[dict], action: str) -> tuple[str, float]:
    """action: 'pressure_test' | 'refocus'. Returns (text, cost)."""
    system = PRESSURE_TEST_SYSTEM if action == "pressure_test" else REFOCUS_SYSTEM
    user_content = f"The debate topic is: {topic}\n\nTranscript so far:\n\n{_render_transcript(transcript)}"
    text, cost = _call(model, system, user_content)
    return text.strip(), cost
