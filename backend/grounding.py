"""Temporal grounding shared by the agents and the judge. Neither the agent
personas (agent_factory.py) nor the judge prompts (judge.py) otherwise carry a
date, so a reasoning model reads "the recent Iran strikes" and anchors on
whatever its training cutoff made salient — that's the real July-2026-read-as-
2025 bug users reported. Injecting today's date at call time (not as a baked-in
constant) keeps it correct as days pass on a stateless backend that rebuilds
every agent and judge call from scratch each turn."""

from datetime import datetime, timezone


def today_str() -> str:
    # Built by hand rather than with a strftime day directive (%-d is
    # non-portable, %d zero-pads) so "July 3, 2026" reads naturally everywhere.
    d = datetime.now(timezone.utc)
    return f"{d:%B} {d.day}, {d.year}"


def date_grounding(has_search: bool) -> str:
    """One line for an agent's system prompt. Resolves temporal ambiguity
    toward the present, but — crucially — tells the model to check rather than
    silently assume when it's unsure, so a genuinely historical topic isn't
    force-read as a current one. The search clause only appears for agents that
    actually have the tool."""
    base = (
        f"For reference, today's date is {today_str()}. When the topic mentions "
        'current events, recent developments, or words like "now", "latest", or '
        '"recent", assume it means the most recent such events as of today, unless '
        "the user specifies a different time."
    )
    if has_search:
        return base + (
            " If you're unsure which event is meant, say so and use the web_search "
            "tool to check — don't silently assume an older one."
        )
    return base + (
        " If you're unsure which event is meant, say so rather than silently "
        "assuming an older one."
    )


def judge_grounding() -> str:
    """A lighter line for the judge, which assesses the room rather than making
    fresh temporal claims — enough to keep its sense of 'recent' aligned with
    the agents' so a verdict doesn't drift to a different year than the debate."""
    return (
        f"For reference, today's date is {today_str()}. Read any mention of "
        '"recent", "now", or "latest" as of today unless a turn says otherwise.'
    )
