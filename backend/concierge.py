"""The pre-discussion concierge (Phase 2). One fast, date-grounded call that
reads the user's raw prompt BEFORE any room opens and routes it down one of
three doors:

  - discuss: a clear, arguable topic (or a concrete idea for review) -> refine
             it into a self-contained instruction and open a room.
  - clarify: genuinely ambiguous, or missing the stance/idea the chosen room
             structure needs -> ask ONE question with concrete options.
  - answer:  simple, factual, or meta ("what can you do?") -> answer inline and
             don't spend a whole debate on it.

It is template-aware: an advocate room ("bull vs bear") or an advise room that
arrives without a clear proposition/idea should clarify rather than proceed.
Search is available so "the recent X" resolves to a real, dated event instead
of a training-era guess — the same misfire grounding.py fixed inside the
debate, now caught before the room even opens.

Structured JSON out, parsed defensively: a malformed or failed call degrades to
"discuss with the prompt as-is" so intake can never block room creation."""

import json
import os
import re

import tools as tools_module
from client import get_client
from grounding import today_str

# Gemini 2.5 Flash: ~4s incl. one search (vs ~30s for a slow reasoning model),
# ~$0.0008/intake, reliably resolves temporal references and follows the JSON
# contract. Env-overridable. Chosen in a live bake-off against gpt-4o-mini
# (slower on multi-search) and claude-haiku-4.5 (~5x the cost).
CONCIERGE_MODEL = os.environ.get("CONCIERGE_MODEL", "google/gemini-2.5-flash")

# Intake sits in front of an already-slow debate, so keep it tight: at most a
# couple of search rounds, then force an answer.
MAX_SEARCH_ROUNDS = 2
CONCIERGE_MAX_TOKENS = 2000

DECISIONS = {"discuss", "clarify", "answer"}

_JSON_FENCE_RE = re.compile(r"^\s*```(?:json)?\s*|\s*```\s*$")

# How each room type changes what "under-specified" means. mode comes straight
# from the agents' interaction mode (schemas.AgentConfig.mode); a template maps
# to one of these.
_ROOM_GUIDANCE = {
    "discuss": (
        "It is an open discussion room — any genuinely arguable topic fits. "
        "Clarify only when the prompt is truly ambiguous about what is being asked."
    ),
    "advocate": (
        "It is an adversarial debate room: participants are assigned OPPOSING "
        "sides of a proposition. If the prompt does not contain a clear, "
        "debatable proposition — a claim with two defensible sides — use "
        "'clarify' to pin down exactly what should be argued (e.g. a bare topic "
        'like "crypto" needs a specific claim to debate).'
    ),
    "advise": (
        "It is a review room: the user brings their OWN idea, plan, or decision "
        "for candid critique. If there is no concrete idea or plan to review, "
        "use 'clarify' to find out what they want examined."
    ),
}


def _build_system(template_label: str | None, mode: str) -> str:
    room = _ROOM_GUIDANCE.get(mode, _ROOM_GUIDANCE["discuss"])
    label = f'a "{template_label}" room' if template_label else "a discussion room"
    return (
        "You are the intake concierge for a structured multi-agent debate app, "
        "where two or more AI advisors discuss a topic and an LLM judge oversees "
        "them. A user has just typed a prompt to start a room. Your job is to "
        "decide, before the room opens, how to handle it — and to spend as "
        "little of the user's time as possible while doing it.\n\n"
        f"Today's date is {today_str()}. If the prompt refers to a \"recent\", "
        '"latest", or "current" event, you MUST use the web_search tool to '
        "identify the specific event and its date as of today, then name that "
        "event and date explicitly in refined_input and set resolved to true — "
        "never leave a vague time reference in place, and never assume an older "
        'event than today\'s date implies. For example, "are the recent strikes '
        'justified" should become a refined_input that names the actual, dated '
        "strikes you found in search.\n"
        "If search surfaces more than one distinct event that could plausibly "
        "match the prompt (for example, strikes in different years), do NOT "
        "silently pick one — use the 'clarify' decision and offer each candidate "
        "event as an option, so the user chooses which they mean.\n\n"
        f"The user chose {label}. {room}\n\n"
        "Classify the prompt into exactly one decision:\n"
        '- "discuss": a clear, arguable topic or a concrete idea/plan for review. '
        "Write a refined_input: the user's prompt rewritten to be self-contained "
        "and unambiguous (resolve timeframe and entity references), preserving "
        "their intent and wording where you can. Keep it in the SAME form and "
        "style the user wrote in — a question stays a question, a bare topic "
        "stays a bare topic, a claim stays a claim. Do NOT add debate scaffolding "
        "like \"Debate whether\", \"Argue that\", or side assignments; the app "
        "wraps refined_input for the room type on its own. Write interpretation as a "
        "one-line, plain-English restatement of the topic they'll discuss (for "
        'example: "Whether the US strikes on Iran of July 2026 were justified") '
        "— just the topic itself, with no lead-in phrase. Set "
        "resolved to true ONLY if you pinned down something the user left "
        "implicit (a date, which of several possible events or entities, a "
        "scope) — something worth showing back to them. Always fill "
        "interpretation for a 'discuss' decision.\n"
        '- "clarify": the prompt could mean materially different things, or lacks '
        "the proposition/idea this room type needs. Ask ONE short question and "
        "give 2 to 4 concrete options. Each option's label is a short button "
        "caption; its refined_input is the self-contained, disambiguated "
        "topic/subject/claim the room would start from — in the same bare style "
        "as refined_input above, with NO added debate scaffolding.\n"
        '- "answer": a simple factual/lookup question, or anything a full debate '
        "would be the wrong tool for. Write a concise, direct answer of 2 to 4 "
        "sentences. Do NOT open a room. Any question about the app itself or your "
        "own capabilities — \"what can you do\", \"who are you\", \"how does this "
        'work", "what is this" — is ALWAYS "answer", never "discuss".\n\n'
        "Bias strongly toward 'discuss'. Only 'clarify' for genuine ambiguity or "
        "a missing stance/idea the room structure requires. Only 'answer' when a "
        "debate makes no sense.\n\n"
        "Respond with ONLY a JSON object — no markdown fences, no commentary — "
        "with exactly these keys:\n"
        '- "decision": "discuss" | "clarify" | "answer"\n'
        '- "interpretation": string (empty unless decision is "discuss")\n'
        '- "resolved": boolean\n'
        '- "refined_input": string (empty unless decision is "discuss")\n'
        '- "clarify": object {"question": string, "options": [{"label": string, '
        '"refined_input": string}]} — null unless decision is "clarify"\n'
        '- "answer": string (empty unless decision is "answer")'
    )


def _parse(raw: str, prompt: str) -> dict:
    """Defensive parse. Any failure falls back to opening a normal room with the
    user's prompt unchanged — intake must never be the reason a debate can't
    start."""
    fallback = {
        "decision": "discuss",
        "interpretation": "",
        "resolved": False,
        "refined_input": prompt,
        "clarify": None,
        "answer": "",
    }
    try:
        parsed = json.loads(_JSON_FENCE_RE.sub("", (raw or "").strip()))
        if not isinstance(parsed, dict):
            raise ValueError("not an object")
    except (json.JSONDecodeError, ValueError):
        return fallback

    decision = parsed.get("decision")
    if decision not in DECISIONS:
        return fallback

    refined = str(parsed.get("refined_input") or "").strip()
    clarify = None
    raw_clarify = parsed.get("clarify")
    if decision == "clarify" and isinstance(raw_clarify, dict):
        options = [
            {
                "label": str(o.get("label") or "").strip(),
                "refined_input": str(o.get("refined_input") or "").strip(),
            }
            for o in raw_clarify.get("options") or []
            if isinstance(o, dict) and o.get("label") and o.get("refined_input")
        ]
        question = str(raw_clarify.get("question") or "").strip()
        # A clarify decision with no usable options is useless — fall back to
        # just starting the room rather than showing an empty question.
        if question and len(options) >= 2:
            clarify = {"question": question, "options": options[:4]}
    if decision == "clarify" and not clarify:
        return fallback

    answer = str(parsed.get("answer") or "").strip()
    if decision == "answer" and not answer:
        return fallback

    return {
        "decision": decision,
        "interpretation": str(parsed.get("interpretation") or "").strip(),
        "resolved": bool(parsed.get("resolved")) and decision == "discuss",
        "refined_input": refined or prompt if decision == "discuss" else "",
        "clarify": clarify,
        "answer": answer if decision == "answer" else "",
    }


def run_concierge(
    prompt: str, template_label: str | None = None, mode: str = "discuss"
) -> tuple[dict, float, list[dict]]:
    """Returns (decision, cost_usd, sources). `decision` is the parsed dict
    above; `sources` is every web_search fired {query, results} — kept so the
    intake can be persisted with its evidence and, later, reused to seed the
    first debate turn."""
    client = get_client("openrouter")
    messages = [
        {"role": "system", "content": _build_system(template_label, mode)},
        {"role": "user", "content": f'The user typed: "{prompt}"'},
    ]
    total_cost = 0.0
    sources: list[dict] = []

    for _ in range(MAX_SEARCH_ROUNDS):
        response = client.chat.completions.create(
            model=CONCIERGE_MODEL,
            messages=messages,
            tools=[tools_module.WEB_SEARCH_TOOL],
            max_tokens=CONCIERGE_MAX_TOKENS,
            temperature=0,
        )
        total_cost += getattr(response.usage, "cost", 0) or 0
        message = response.choices[0].message
        if not message.tool_calls:
            return _parse(message.content, prompt), total_cost, sources

        messages.append(message.model_dump(exclude_unset=True))
        for tc in message.tool_calls:
            try:
                args = json.loads(tc.function.arguments or "{}")
            except json.JSONDecodeError:
                args = {}
            query = args.get("query", "")
            results = tools_module.web_search(query, args.get("max_results", 5))
            sources.append({"query": query, "results": results})
            messages.append(
                {"role": "tool", "tool_call_id": tc.id, "content": json.dumps(results)}
            )

    # Ran out of search rounds mid-loop — force a final answer with no tools.
    response = client.chat.completions.create(
        model=CONCIERGE_MODEL,
        messages=messages,
        max_tokens=CONCIERGE_MAX_TOKENS,
        temperature=0,
    )
    total_cost += getattr(response.usage, "cost", 0) or 0
    return _parse(response.choices[0].message.content, prompt), total_cost, sources
