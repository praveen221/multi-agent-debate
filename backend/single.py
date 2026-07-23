"""The single-model track (Phase 3). Alongside a debate, the user can open a
parallel "Single Agent" track: one strong model (default Kimi 2.6) answering the
same topic, so the two can be compared and a benchmark accumulated.

It is NOT a debate participant — it's the honest "just ask one strong model"
baseline. The user never types at it directly; instead they pick from generated
follow-up options (build on the debate's own angles) that steer it over
comparable ground, and the debate's interventions (interfere / pressure-test /
refocus) are fanned in here as human/reviewer messages. Answers stream through
the same client.complete_streaming path the debate uses, so search grounding,
cost, and leak-cleanup all behave identically."""

import json
import os
import re

import agent_factory
import tools as tools_module
from agent import Agent
from client import get_client
from grounding import date_grounding

DEFAULT_SINGLE_MODEL = "anthropic/claude-sonnet-5"
FOLLOWUP_MODEL = os.environ.get("FOLLOWUP_MODEL", "google/gemini-2.5-flash")
FOLLOWUP_MAX_TOKENS = 800

# Topic-agnostic probes used when option generation fails or returns nothing —
# so the single track is never left with no way to go deeper.
FALLBACK_FOLLOWUPS = [
    {
        "label": "Argue the other side",
        "instruction": "Now make the strongest honest case for the opposite conclusion.",
    },
    {
        "label": "Stress-test the weakest claim",
        "instruction": "Identify the weakest link in your own reasoning and pressure-test it hard.",
    },
    {
        "label": "What would change your mind?",
        "instruction": "What concrete evidence would make you change your conclusion, and is any of it available?",
    },
]

_JSON_FENCE_RE = re.compile(r"^\s*```(?:json)?\s*|\s*```\s*$")

_SINGLE_BASE = (
    "You are a single, strong AI analyst. The user has brought a topic and wants "
    "your best, most honest answer to it. You are the baseline being compared "
    "against a multi-agent debate on the same topic, so give the strongest single "
    "answer you can: weigh the real considerations, take a clear position where "
    "the evidence supports one, surface the genuine trade-offs and uncertainties "
    "rather than hedging everything, and don't flatter the premise. Keep it "
    "focused and readable — a few tight paragraphs, not an exhaustive dump. "
    "Messages labeled \"A human asks\" or \"A reviewer challenges\" come from the "
    "person watching; respond to them directly and update your view honestly."
)


def build_single_agent(model: str, use_search: bool) -> Agent:
    persona = _SINGLE_BASE + " " + date_grounding(use_search)
    if use_search:
        persona += " Use the web_search tool to ground claims in real, current evidence."
        return Agent(
            name="Single model",
            model=model,
            provider="openrouter",
            persona=persona,
            tools=[tools_module.WEB_SEARCH_TOOL],
            tool_executor=agent_factory.make_tool_executor("Single model"),
        )
    return Agent(name="Single model", model=model, provider="openrouter", persona=persona)


def build_single_messages(
    topic: str, single_turns: list[dict], instruction: str | None = None
) -> list[dict]:
    """The single model's view of its own track. Its answers are assistant
    turns; fanned-in human/judge interventions are labeled user turns. When the
    user picks a follow-up option, its instruction is appended as the trigger for
    the next answer."""
    messages = [{"role": "user", "content": f"The topic is: {topic}"}]
    if not single_turns and instruction is None:
        messages.append({"role": "user", "content": "Give your answer."})
        return messages

    for t in single_turns:
        role = t.get("role", "single")
        if role == "single":
            messages.append({"role": "assistant", "content": t["text"]})
        elif role == "human":
            messages.append({"role": "user", "content": f"A human asks: {t['text']}"})
        elif role == "judge":
            messages.append({"role": "user", "content": f"A reviewer challenges: {t['text']}"})

    if instruction:
        messages.append({"role": "user", "content": instruction})
    return messages


def _render_agents(agents: list[dict] | None) -> str:
    if not agents:
        return ""
    lines = []
    for a in agents:
        if a.get("stance"):
            lines.append(f"- {a['name']} argues: {a['stance']}")
        elif a.get("mode") == "advise":
            lines.append(f"- {a['name']}: an advisor critiquing the idea candidly")
        else:
            lines.append(f"- {a['name']}: an open participant")
    return "The parallel debate has these participants:\n" + "\n".join(lines) + "\n\n"


def generate_followups(
    topic: str, agents: list[dict] | None, single_turns: list[dict]
) -> tuple[list[dict], float]:
    """2-4 next-step options that push the single model over the SAME ground the
    debate covers, so the two stay comparable — the user picks one instead of
    typing. Returns ([{label, instruction}], cost). Best-effort: on any failure
    returns [] so the track still works, just without suggestions."""
    last_answer = next(
        (t["text"] for t in reversed(single_turns) if t.get("role") == "single"), ""
    )
    system = (
        "You help a user probe a single AI model's answer so it can be compared "
        "fairly against a multi-agent debate on the same topic. Suggest 2 to 4 "
        "follow-up moves the user could take next — each should push the model to "
        "cover ground the debate would cover: the opposing case, a harder "
        "scrutiny of a claim, a specific sub-question, or a concrete stress test. "
        "Keep them genuinely different from each other. Respond with ONLY a JSON "
        "array — no fences — of objects with exactly: \"label\" (a short button "
        "caption, 2-5 words) and \"instruction\" (the full prompt to send the "
        "model, one sentence, addressed to it)."
    )
    user = (
        f"Topic: {topic}\n\n"
        f"{_render_agents(agents)}"
        f"The single model's latest answer:\n{last_answer[:1500]}\n\n"
        "Give the follow-up options as a JSON array."
    )
    try:
        client = get_client("openrouter")
        response = client.chat.completions.create(
            model=FOLLOWUP_MODEL,
            messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
            max_tokens=FOLLOWUP_MAX_TOKENS,
            temperature=0.3,
        )
        cost = getattr(response.usage, "cost", 0) or 0
        raw = _JSON_FENCE_RE.sub("", (response.choices[0].message.content or "").strip())
        parsed = json.loads(raw)
        options = (
            [
                {
                    "label": str(o.get("label") or "").strip(),
                    "instruction": str(o.get("instruction") or "").strip(),
                }
                for o in parsed
                if isinstance(o, dict) and o.get("label") and o.get("instruction")
            ]
            if isinstance(parsed, list)
            else []
        )
        # Never leave the track with no next step (the user can't type, so an
        # empty list would strand them) — fall back to universal probes.
        return (options[:4] or FALLBACK_FOLLOWUPS), cost
    except Exception:
        return FALLBACK_FOLLOWUPS, 0.0
