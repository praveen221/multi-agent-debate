import json
import os
import re
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed

from openai import OpenAI

MAX_TOOL_ROUNDS = 3
# A model can request several web_search calls in one turn (we've seen up to
# 4-5) — tool_executor is IO-bound network work, so a thread pool collapses
# that from "sum of every search's latency" to "roughly the slowest one".
MAX_PARALLEL_TOOL_CALLS = 8

# Bounds the worst case in both cost and wall-clock time if a model degrades
# into a repetition loop instead of stopping (observed: 151K chars / $0.096 /
# 13 minutes for one turn). ~1100-1200 words — generous headroom over what
# the brevity instruction in agent_factory.py now asks for, but nowhere near
# unbounded. Paired with dedupe_repeated_lines below: the cap limits how much
# a loop can cost before it's cut off, the dedupe cleans up what's left.
MAX_RESPONSE_TOKENS = 1500

PROVIDERS = {
    "openrouter": {
        "base_url": "https://openrouter.ai/api/v1",
        "api_key_env": "OPENROUTER_API_KEY",
    },
}

# Some OpenRouter-hosted models emit their *native* tool-call template as
# plain content instead of a structured tool_calls response when the
# provider they're routed to doesn't translate it properly — e.g. Kimi's
# "<tool_calls>...<invoke name=...>" / "<|tool_call_begin|>" or DeepSeek's
# "<｜｜DSML｜｜tool_calls>" tags (note the fullwidth ｜ U+FF5C bars — plain
# ASCII-pipe patterns miss them). Once one leaked turn is stored it gets
# replayed into later context, so other models start mimicking the syntax.
# Every reply therefore passes through _deliver() before being returned:
# strip the leaked blocks, keep the surrounding real prose, and only if
# nothing substantial survives ask once more with tools off.
_LEAK_TAG = r"[^<>\n]{0,60}"
_LEAKED_TOOL_CALL_RE = re.compile(
    r"<" + _LEAK_TAG + r"(?:tool_call|invoke|DSML)"
    r"|tool_calls?_section|functions\.\w+:",
    re.IGNORECASE,
)
# Only removes blocks with a closing tag — an unterminated opener must never
# risk swallowing real prose after it. Whatever a malformed block leaves
# behind is caught by the stray-tag and functions-token passes below.
_LEAK_BLOCK_RE = re.compile(
    r"<" + _LEAK_TAG + r"tool_calls?" + _LEAK_TAG + r">"
    r".{0,1500}?"
    r"<" + _LEAK_TAG + r"tool_calls?" + _LEAK_TAG + r">",
    re.IGNORECASE | re.DOTALL,
)
_LEAK_STRAY_TAG_RE = re.compile(
    r"</?" + _LEAK_TAG + r"(?:invoke|parameter|DSML|tool_call)" + _LEAK_TAG + r">",
    re.IGNORECASE,
)
# Kimi's section format names the tool as "functions.web_search:7" between tags.
_LEAK_FN_TOKEN_RE = re.compile(r"functions\.\w+:\d*")

# A stripped reply shorter than this is just the pre-search preamble
# ("Let me check the latest numbers.") — not worth showing as a turn.
_MIN_SURVIVING_CHARS = 200

# A line repeating this many times is a degenerate loop, not a model
# legitimately restating a short phrase for emphasis (that's rare, and
# requiring a few repeats before we intervene means dedup never touches a
# normal response). Only lines at least this long count — short lines
# ("---", list-item dashes, blank separators) repeat constantly in normal
# markdown and aren't the failure mode we're guarding against.
_REPEAT_LOOP_THRESHOLD = 3
_MIN_REPEAT_LINE_CHARS = 30

_NO_TOOLS_NUDGE = {
    "role": "user",
    "content": (
        "(system note: the web_search tool is unavailable for this one reply. "
        "Answer directly from the discussion so far and what you already know. "
        "Do not emit any tool-call syntax.)"
    ),
}


def _looks_like_leaked_tool_call(text: str) -> bool:
    return bool(text) and bool(_LEAKED_TOOL_CALL_RE.search(text))


def strip_leaked_tool_calls(text: str) -> str:
    text = _LEAK_BLOCK_RE.sub("", text)
    text = _LEAK_STRAY_TAG_RE.sub("", text)
    text = _LEAK_FN_TOKEN_RE.sub("", text)
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    # A removed block often leaves its "---" separator dangling at the top.
    return re.sub(r"^(?:-{3,}\s*)+", "", text)


def _looks_like_repetition_loop(text: str) -> bool:
    lines = [ln.strip() for ln in text.split("\n") if len(ln.strip()) >= _MIN_REPEAT_LINE_CHARS]
    if not lines:
        return False
    return Counter(lines).most_common(1)[0][1] >= _REPEAT_LOOP_THRESHOLD


def dedupe_repeated_lines(text: str) -> str:
    """Collapses a degenerate repetition loop (the same block restated many
    times in a row) down to the first copy of each substantial line, in
    original order. Turns "same ~10-line argument repeated 32 times" back
    into the single coherent answer that was said the first time. Short
    lines (blank separators, list markers) are never deduped — only lines
    long enough that an exact repeat can't be coincidental structure."""
    seen: set[str] = set()
    kept = []
    for line in text.split("\n"):
        key = line.strip()
        substantial = len(key) >= _MIN_REPEAT_LINE_CHARS
        if substantial and key in seen:
            continue
        if substantial:
            seen.add(key)
        kept.append(line)
    return "\n".join(kept).strip()


def _dedupe_repeated_paragraphs(text: str) -> str:
    """Second pass at paragraph granularity, no minimum length. Real loops
    observed in production nest a second, shorter cycle inside the big one —
    e.g. a short section header like "**Revised estimate:**" repeated on its
    own between blank lines — too short for dedupe_repeated_lines' 30-char
    floor. Only called after _looks_like_repetition_loop has already
    confirmed this is a genuine degenerate response, so being this
    aggressive (any exact repeat, any length, gets collapsed) is safe."""
    normalized = re.sub(r"\n{3,}", "\n\n", text)
    seen: set[str] = set()
    kept = []
    for para in normalized.split("\n\n"):
        key = para.strip()
        if key and key in seen:
            continue
        if key:
            seen.add(key)
        kept.append(para)
    return "\n\n".join(kept).strip()


def _clean(text: str) -> str:
    if _looks_like_leaked_tool_call(text):
        text = strip_leaked_tool_calls(text)
    if _looks_like_repetition_loop(text):
        text = dedupe_repeated_lines(text)
        text = _dedupe_repeated_paragraphs(text)
    return text


def _deliver(client, model, full_messages, text):
    """Final gate for every reply. Returns (clean_text, extra_cost)."""
    text = text or ""
    cleaned = _clean(text)
    if cleaned == text or len(cleaned) >= _MIN_SURVIVING_CHARS:
        return cleaned, 0.0
    retry = client.chat.completions.create(
        model=model,
        messages=full_messages + [_NO_TOOLS_NUDGE],
        max_tokens=MAX_RESPONSE_TOKENS,
    )
    cost = getattr(retry.usage, "cost", 0) or 0
    retry_clean = _clean(retry.choices[0].message.content or "")
    # If even the retry came back unusable, fall back to whatever survived
    # the original cleanup rather than an empty turn.
    return (retry_clean or cleaned), cost


def _run_tool_calls(calls: list[tuple[str, dict]], tool_executor) -> list:
    """Runs a batch of tool calls concurrently and returns results in the
    same order as `calls`. A single call skips the pool entirely — no
    thread-creation overhead for the common case of one search."""
    if len(calls) <= 1:
        return [tool_executor(name, args) for name, args in calls]
    with ThreadPoolExecutor(max_workers=min(len(calls), MAX_PARALLEL_TOOL_CALLS)) as pool:
        futures = [pool.submit(tool_executor, name, args) for name, args in calls]
        return [f.result() for f in futures]


def _run_tool_calls_progressive(calls: list[tuple[str, dict]], tool_executor):
    """Same batch as _run_tool_calls, but yields (index, result) as each one
    finishes instead of waiting for the whole batch — lets a streaming
    caller report real progress instead of a wall of silence until the
    slowest search lands."""
    if len(calls) <= 1:
        for i, (name, args) in enumerate(calls):
            yield i, tool_executor(name, args)
        return
    with ThreadPoolExecutor(max_workers=min(len(calls), MAX_PARALLEL_TOOL_CALLS)) as pool:
        future_to_index = {
            pool.submit(tool_executor, name, args): i for i, (name, args) in enumerate(calls)
        }
        for future in as_completed(future_to_index):
            yield future_to_index[future], future.result()


def get_client(provider: str) -> OpenAI:
    config = PROVIDERS[provider]
    api_key = os.environ.get(config["api_key_env"])
    if not api_key:
        raise RuntimeError(f"Missing {config['api_key_env']} environment variable")
    return OpenAI(base_url=config["base_url"], api_key=api_key)


def complete(client, model, system_prompt, messages, tools=None, tool_executor=None):
    full_messages = [{"role": "system", "content": system_prompt}] + list(messages)

    if not tools:
        response = client.chat.completions.create(
            model=model, messages=full_messages, max_tokens=MAX_RESPONSE_TOKENS
        )
        text, _ = _deliver(client, model, full_messages, response.choices[0].message.content)
        return text

    for _ in range(MAX_TOOL_ROUNDS):
        response = client.chat.completions.create(
            model=model, messages=full_messages, tools=tools, max_tokens=MAX_RESPONSE_TOKENS
        )
        message = response.choices[0].message

        if not message.tool_calls:
            text, _ = _deliver(client, model, full_messages, message.content)
            return text

        full_messages.append(message.model_dump(exclude_unset=True))

        parsed = [(tc.function.name, json.loads(tc.function.arguments)) for tc in message.tool_calls]
        results = _run_tool_calls(parsed, tool_executor)
        for tool_call, result in zip(message.tool_calls, results):
            full_messages.append(
                {
                    "role": "tool",
                    "tool_call_id": tool_call.id,
                    "content": json.dumps(result),
                }
            )

    # Hit the round cap right after executing a round of tool calls — the model
    # hasn't responded to those results yet. Force one final answer, no more tools.
    response = client.chat.completions.create(
        model=model, messages=full_messages, max_tokens=MAX_RESPONSE_TOKENS
    )
    text, _ = _deliver(client, model, full_messages, response.choices[0].message.content)
    return text


def complete_streaming(client, model, system_prompt, messages, tools=None, tool_executor=None):
    """Same tool loop as complete(), but yields progress along the way:
    {"type": "tool_call", "name", "args"} for each tool call, then finally
    {"type": "text", "text", "cost", "sources"} — cost is the sum of every
    completion call's real USD cost (OpenRouter reports this on every
    response), since one "turn" can involve several calls across the tool
    loop. sources is every web_search call's {query, results} from this
    turn, for persisting/displaying full grounding."""
    full_messages = [{"role": "system", "content": system_prompt}] + list(messages)
    total_cost = 0.0
    sources = []

    if not tools:
        response = client.chat.completions.create(
            model=model, messages=full_messages, max_tokens=MAX_RESPONSE_TOKENS
        )
        total_cost += getattr(response.usage, "cost", 0) or 0
        text, extra = _deliver(client, model, full_messages, response.choices[0].message.content)
        total_cost += extra
        yield {"type": "text", "text": text, "cost": total_cost, "sources": sources}
        return

    for _ in range(MAX_TOOL_ROUNDS):
        response = client.chat.completions.create(
            model=model, messages=full_messages, tools=tools, max_tokens=MAX_RESPONSE_TOKENS
        )
        total_cost += getattr(response.usage, "cost", 0) or 0
        message = response.choices[0].message

        if not message.tool_calls:
            text, extra = _deliver(client, model, full_messages, message.content)
            total_cost += extra
            yield {"type": "text", "text": text, "cost": total_cost, "sources": sources}
            return

        full_messages.append(message.model_dump(exclude_unset=True))

        # Announce every call in the batch up front (so the UI shows all
        # pending searches at once, not a trickle), then run them together
        # and report each one as it lands — real progress, not a spinner.
        parsed = [(tc.function.name, json.loads(tc.function.arguments)) for tc in message.tool_calls]
        for name, args in parsed:
            yield {"type": "tool_call", "name": name, "args": args}

        results: list = [None] * len(parsed)
        for index, result in _run_tool_calls_progressive(parsed, tool_executor):
            results[index] = result
            name, args = parsed[index]
            if name == "web_search":
                yield {
                    "type": "tool_result",
                    "name": name,
                    "query": args.get("query", ""),
                    "result_count": len(result),
                    "titles": [r.get("title", "") for r in result[:2] if r.get("title")],
                }

        for tool_call, (name, args), result in zip(message.tool_calls, parsed, results):
            if name == "web_search":
                sources.append({"query": args.get("query", ""), "results": result})
            full_messages.append(
                {
                    "role": "tool",
                    "tool_call_id": tool_call.id,
                    "content": json.dumps(result),
                }
            )

    response = client.chat.completions.create(
        model=model, messages=full_messages, max_tokens=MAX_RESPONSE_TOKENS
    )
    total_cost += getattr(response.usage, "cost", 0) or 0
    text, extra = _deliver(client, model, full_messages, response.choices[0].message.content)
    total_cost += extra
    yield {"type": "text", "text": text, "cost": total_cost, "sources": sources}
