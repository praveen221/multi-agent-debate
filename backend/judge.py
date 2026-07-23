"""The LLM judge: reads the debate transcript from the sideline and either
produces a structured verdict (for the human, never shown to the agents) or
an interjection (spoken into the debate). One completion call per action,
no tools — the judge prods, the agents (who have search) verify."""

import json
import re

from client import get_client
from grounding import judge_grounding

DIRECTIONS = {"converging", "diverging", "off_topic", "stalling", "balanced"}
SUGGESTED_ACTIONS = {"none", "intervene", "pressure_test", "refocus", "conclude"}

VERDICT_SYSTEM = (
    "You are the judge overseeing a multi-participant debate. You observe from "
    "the sideline; you are not a participant. Read the transcript and assess "
    "where the discussion is heading. Each participant's web search results "
    "(title, URL, snippet) appear indented beneath their turns — when "
    "participants' claims contradict each other or their own cited sources, say "
    "so explicitly and distinguish factual disagreements (about facts, numbers, "
    "events) from differences of interpretation. Respond with ONLY a JSON "
    "object — no markdown fences, no commentary — with exactly these keys:\n"
    '- "direction": one of "converging", "diverging", "off_topic", "stalling", "balanced"\n'
    '- "summary": 1-2 sentences on the current state and trajectory of the debate, '
    "referencing the actual arguments made and flagging any factual contradiction\n"
    '- "agreements": array of short strings — points the participants now agree on (may be empty)\n'
    '- "contentions": array of short strings — points still in dispute; prefix genuinely '
    'factual disputes with "Factual: " (may be empty)\n'
    '- "suggested_action": one of "none", "intervene", "pressure_test", "refocus", "conclude". '
    "Use pressure_test when participants are converging without enough scrutiny, "
    "refocus when the discussion has drifted from the topic, intervene when you have "
    "an observation the participants themselves ought to hear, conclude ONLY when the "
    "debate has stayed converged across multiple rounds and further rounds would add "
    "little, and none otherwise.\n"
    "Participant roles, when listed above the transcript, change how you read the room: "
    "sustained disagreement between ASSIGNED ADVOCATES is healthy, not a failure — judge "
    "whether each side is well-argued and evidence-grounded, and for advocate debates "
    'treat "converging" as the honest weight of evidence pointing one way and conclude '
    "when both cases are fully argued and little new is arriving."
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

REPORT_SYSTEM = (
    "You are the judge who oversaw a multi-participant debate that has now "
    "concluded. Write the closing report for a reader who did not watch the "
    "debate. Be honest about confidence and keep disagreement visible — do "
    "not manufacture a consensus that wasn't reached. Respond with ONLY a "
    "JSON object — no markdown fences, no commentary — with exactly these keys:\n"
    '- "landed": 2-3 sentences on where the debate ultimately landed, referencing '
    "the actual arguments\n"
    '- "agreements": array of short strings — points the participants ended up agreeing on\n'
    '- "contentions": array of short strings — points that stayed genuinely contested\n'
    '- "evidence": array of objects {"claim": str, "sources": [{"title": str, "url": str}]} — '
    "the claims that mattered most and the sources that grounded them. Only cite "
    "sources that actually appear in the transcript below; if a claim was never "
    "grounded in a source, use an empty sources array\n"
    '- "cautions": array of short strings — what a skeptical reader should still '
    "verify independently\n"
    "If participant roles are listed above the transcript and participants were "
    "assigned advocates, adjudicate between the cases — say which side the evidence "
    "favors and how strongly — rather than describing a consensus."
)

_JSON_FENCE_RE = re.compile(r"^\s*```(?:json)?\s*|\s*```\s*$")


def _render_participants(agents: list[dict] | None) -> str:
    """A roles header for judge calls, so the judge reads an adversarial or
    advisory room correctly. Empty when everyone is a plain participant —
    no point spending tokens restating the default."""
    if not agents or all(not a.get("stance") and a.get("mode") != "advise" for a in agents):
        return ""
    lines = []
    for a in agents:
        if a.get("stance"):
            lines.append(f"- {a['name']}: ASSIGNED ADVOCATE — argues: {a['stance']}")
        elif a.get("mode") == "advise":
            lines.append(f"- {a['name']}: independent advisor asked to critique the user's idea candidly")
        else:
            lines.append(f"- {a['name']}: open participant, views evolve freely")
    return "Participants:\n" + "\n".join(lines) + "\n\n"


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


# Same worst-case protection as MAX_RESPONSE_TOKENS in client.py — a report
# synthesizes a whole transcript plus sources, so it gets more headroom than
# a single agent turn.
#
# Verified live against moonshotai/kimi-k2.5 before picking this number:
# reasoning is on by default and isn't optional here — it consistently
# spends ~90-95% of the completion budget on reasoning regardless of prompt
# (1074/1130 tokens, 1281/1337, 962/1014 across three test calls), and a
# tight cap (the original 2000, or client.py's original 1500) starves the
# visible answer before reasoning finishes, which is what produced one real
# empty verdict in prod. There's a reasoning.max_tokens knob that's supposed
# to reserve budget for content separately, but it isn't reliably honored by
# this model (tested: still came back empty at max_tokens=700 split
# 300/400) — so the fix is just a generous total ceiling, not a split.
# Disabling reasoning entirely was considered and rejected: it would
# degrade judgment quality for no real benefit, since the actual fix here
# is "give it enough room," not "stop it from thinking."
MAX_JUDGE_TOKENS = 6000


def _call(model: str, system: str, user_content: str) -> tuple[str, float]:
    """Retries once if content comes back empty — a generous MAX_JUDGE_TOKENS
    should make this rare, but it's a cheap backstop against whatever cause,
    reasoning-budget or otherwise."""
    client = get_client("openrouter")
    system = f"{judge_grounding()}\n\n{system}"

    def _once():
        response = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user_content},
            ],
            max_tokens=MAX_JUDGE_TOKENS,
        )
        cost = getattr(response.usage, "cost", 0) or 0
        return response.choices[0].message.content or "", cost

    text, cost = _once()
    if text.strip():
        return text, cost
    retry_text, retry_cost = _once()
    return retry_text, cost + retry_cost


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


def run_verdict(
    model: str, topic: str, transcript: list[dict], agents: list[dict] | None = None
) -> tuple[str, dict, float]:
    """Returns (display_text, verdict_jsonb, cost)."""
    user_content = (
        f"The debate topic is: {topic}\n\n"
        f"{_render_participants(agents)}"
        f"Transcript so far:\n\n{_render_transcript_with_sources(transcript, snippet_chars=150)}"
    )
    raw, cost = _call(model, VERDICT_SYSTEM, user_content)
    verdict = _parse_verdict(raw)

    # Gate 'conclude' in code, not just in the prompt: two agents often
    # politely converge in the opening rounds, and a "this looks done"
    # nudge there would send users away before the debate gets tested.
    # Conclude is only allowed once convergence has held across two
    # consecutive verdicts; otherwise downgrade to pressure_test (push
    # deeper instead of leaving) or none.
    if verdict["suggested_action"] == "conclude":
        previous = None
        for turn in transcript:
            v = turn.get("verdict") or {}
            if turn.get("role") == "judge" and v.get("kind") == "verdict":
                previous = v
        stable = (
            previous is not None
            and previous.get("direction") == "converging"
            and verdict["direction"] == "converging"
        )
        if not stable:
            verdict["suggested_action"] = (
                "pressure_test" if verdict["direction"] == "converging" else "none"
            )
    return verdict["summary"], verdict, cost


def run_interjection(
    model: str, topic: str, transcript: list[dict], action: str, agents: list[dict] | None = None
) -> tuple[str, float]:
    """action: 'pressure_test' | 'refocus'. Returns (text, cost)."""
    system = PRESSURE_TEST_SYSTEM if action == "pressure_test" else REFOCUS_SYSTEM
    user_content = (
        f"The debate topic is: {topic}\n\n"
        f"{_render_participants(agents)}"
        f"Transcript so far:\n\n{_render_transcript(transcript)}"
    )
    text, cost = _call(model, system, user_content)
    return text.strip(), cost


def _render_transcript_with_sources(transcript: list[dict], snippet_chars: int = 200) -> str:
    """Like _render_transcript, but each agent turn is followed by the sources
    it actually searched, so judge output can point at real evidence instead
    of reconstructing it. Repeated URLs are shown once — agents often re-find
    the same pages, and the judge doesn't need them twice."""
    lines = []
    seen_urls: set[str] = set()
    for turn in transcript:
        role = turn.get("role", "agent")
        if role == "agent":
            lines.append(f"{turn['speaker']}: {turn['text']}")
            for search in turn.get("sources") or []:
                for r in search.get("results", []):
                    url = r.get("url", "")
                    if url and url in seen_urls:
                        continue
                    seen_urls.add(url)
                    snippet = (r.get("snippet") or "")[:snippet_chars]
                    lines.append(
                        f"  [source used by {turn['speaker']}] {r.get('title', '')} — "
                        f"{url} — {snippet}"
                    )
        elif role == "human":
            lines.append(f"Human moderator: {turn['text']}")
        elif role == "judge" and (turn.get("verdict") or {}).get("kind") == "intervention":
            lines.append(f"The judge interjected: {turn['text']}")
    return "\n\n".join(lines)


def _parse_report(raw: str) -> dict:
    try:
        parsed = json.loads(_JSON_FENCE_RE.sub("", raw.strip()))
        if not isinstance(parsed, dict):
            raise ValueError("not an object")
    except (json.JSONDecodeError, ValueError):
        return {
            "kind": "report",
            "landed": raw.strip(),
            "agreements": [],
            "contentions": [],
            "evidence": [],
            "cautions": [],
        }

    evidence = []
    for item in parsed.get("evidence") or []:
        if not isinstance(item, dict) or not item.get("claim"):
            continue
        sources = [
            {"title": str(s.get("title") or ""), "url": str(s.get("url") or "")}
            for s in item.get("sources") or []
            if isinstance(s, dict) and s.get("url")
        ]
        evidence.append({"claim": str(item["claim"]), "sources": sources})

    return {
        "kind": "report",
        "landed": str(parsed.get("landed") or raw.strip()),
        "agreements": [str(a) for a in parsed.get("agreements") or [] if a],
        "contentions": [str(c) for c in parsed.get("contentions") or [] if c],
        "evidence": evidence,
        "cautions": [str(c) for c in parsed.get("cautions") or [] if c],
    }


def run_report(
    model: str, topic: str, transcript: list[dict], agents: list[dict] | None = None
) -> tuple[str, dict, float]:
    """Returns (display_text, report_jsonb, cost)."""
    user_content = (
        f"The debate topic was: {topic}\n\n"
        f"{_render_participants(agents)}"
        f"Full transcript:\n\n{_render_transcript_with_sources(transcript)}"
    )
    raw, cost = _call(model, REPORT_SYSTEM, user_content)
    report = _parse_report(raw)
    return report["landed"], report, cost
