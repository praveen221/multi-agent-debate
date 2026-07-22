import json
import os
import re
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from functools import lru_cache

from openai import OpenAI

MAX_TOOL_ROUNDS = 3
# A model can request several web_search calls in one turn (we've seen up to
# 4-5) — tool_executor is IO-bound network work, so a thread pool collapses
# that from "sum of every search's latency" to "roughly the slowest one".
MAX_PARALLEL_TOOL_CALLS = 8

# Bounds the worst case in both cost and wall-clock time if a model degrades
# into a repetition loop instead of stopping (observed: 151K chars / $0.096 /
# 13 minutes for one turn) — paired with dedupe_repeated_lines below: the cap
# limits how much a loop can cost before it's cut off, dedupe cleans up
# what's left.
#
# 1500 was the first value tried here and it was wrong: reasoning-capable
# models (confirmed live against kimi-k2.5, see judge.py's MAX_JUDGE_TOKENS
# comment for the numbers) spend the large majority of their completion
# budget on reasoning regardless of prompt, so a tight cap starves the
# visible answer before reasoning finishes — content can come back empty.
# 6000 gives real headroom for that while still bounding worst case to a
# small fraction of the original incident, and reasoning stays fully
# enabled — degrading answer quality to dodge a budget problem isn't the
# right trade.
MAX_RESPONSE_TOKENS = 6000

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
    """Final gate for every reply. Returns (clean_text, extra_cost).

    Retries once only when there's genuinely nothing usable: content that
    was empty from the start (a reasoning-heavy model can burn its whole
    budget thinking and never reach a visible answer), or cleanup stripped
    out a leak/repetition loop and too little survived. A short-but-clean
    reply is never retried just for being short — brevity is the goal now,
    not a defect. (An earlier version of this got that wrong two different
    ways: first by skipping the retry whenever cleanup hadn't changed
    anything — which silently let originally-empty content through
    untouched — then by overcorrecting to retry on length alone, which
    retried short legitimate replies that never needed it.)"""
    original = text or ""
    cleaned = _clean(original)

    if not original.strip():
        needs_retry = True
    elif cleaned != original:
        needs_retry = len(cleaned) < _MIN_SURVIVING_CHARS
    else:
        needs_retry = False

    if not needs_retry:
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


@lru_cache(maxsize=None)
def get_client(provider: str) -> OpenAI:
    # One client per provider, reused for the whole process. The OpenAI client
    # is thread-safe and keeps an httpx connection pool, so every turn reuses a
    # warm keep-alive connection to the provider instead of paying a fresh TLS
    # handshake — agents are rebuilt each turn but no longer each spin up their
    # own client.
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


def _streamed_call(client, model, full_messages, tools):
    """One streamed completion. Yields {"type": "token", "text": delta} for
    each visible content delta as it arrives (so the caller can forward it
    live), then a final {"type": "_result", ...} carrying the assembled
    content, the reconstructed tool_calls, and this call's USD cost.

    Streaming a reasoning model doesn't make the reasoning any shorter — the
    first content token still lands only after the model finishes thinking —
    but once the answer starts, it flows word by word instead of the whole
    thing appearing at once after a long silence. cost comes from the final
    usage chunk (stream_options include_usage), verified live to carry the
    same real cost the non-streamed path reads off response.usage."""
    kwargs = dict(
        model=model,
        messages=full_messages,
        max_tokens=MAX_RESPONSE_TOKENS,
        stream=True,
        stream_options={"include_usage": True},
    )
    if tools:
        kwargs["tools"] = tools

    content_parts: list[str] = []
    tool_acc: dict[int, dict] = {}
    cost = 0.0
    for chunk in client.chat.completions.create(**kwargs):
        usage = getattr(chunk, "usage", None)
        if usage:
            cost = getattr(usage, "cost", 0) or 0
        if not chunk.choices:
            continue
        delta = chunk.choices[0].delta
        if delta.content:
            content_parts.append(delta.content)
            yield {"type": "token", "text": delta.content}
        for tc in delta.tool_calls or []:
            slot = tool_acc.setdefault(tc.index, {"id": None, "name": "", "arguments": ""})
            if tc.id:
                slot["id"] = tc.id
            if tc.function:
                if tc.function.name:
                    slot["name"] += tc.function.name
                if tc.function.arguments:
                    slot["arguments"] += tc.function.arguments

    tool_calls = [
        {"id": s["id"], "type": "function",
         "function": {"name": s["name"], "arguments": s["arguments"]}}
        for _, s in sorted(tool_acc.items())
    ]
    yield {
        "type": "_result",
        "content": "".join(content_parts),
        "tool_calls": tool_calls,
        "cost": cost,
    }


def complete_streaming(client, model, system_prompt, messages, tools=None, tool_executor=None):
    """Same tool loop as complete(), but streams the answer as it's written and
    yields progress along the way:
      {"type": "token_reset"}          before each model call — the live
                                       preview so far is a tool-round preamble
                                       or an earlier attempt; drop it.
      {"type": "token", "text"}        a visible content delta.
      {"type": "tool_call", ...}       a search being fired.
      {"type": "tool_result", ...}     a search landing.
      {"type": "text", "text", ...}    the final, cleaned, authoritative reply.

    The final "text" is the source of truth: it has been through _deliver
    (leak/repetition cleanup, empty-content retry), so a caller shows the
    streamed tokens live and then replaces them with this when it arrives —
    identical in the common case, corrected when cleanup changed something.
    cost is the sum of every completion call's real USD cost across the loop;
    sources is every web_search call's {query, results} for grounding."""
    full_messages = [{"role": "system", "content": system_prompt}] + list(messages)
    total_cost = 0.0
    sources = []

    def _run_call(tools_arg):
        # Streams one model call, re-yielding its token events upward and
        # returning the captured _result dict.
        result = None
        yield {"type": "token_reset"}
        for event in _streamed_call(client, model, full_messages, tools_arg):
            if event["type"] == "_result":
                result = event
            else:
                yield event
        yield {"type": "_return", "result": result}

    if not tools:
        result = None
        for event in _run_call(None):
            if event["type"] == "_return":
                result = event["result"]
            else:
                yield event
        total_cost += result["cost"]
        text, extra = _deliver(client, model, full_messages, result["content"])
        total_cost += extra
        yield {"type": "text", "text": text, "cost": total_cost, "sources": sources}
        return

    for _ in range(MAX_TOOL_ROUNDS):
        result = None
        for event in _run_call(tools):
            if event["type"] == "_return":
                result = event["result"]
            else:
                yield event
        total_cost += result["cost"]

        if not result["tool_calls"]:
            text, extra = _deliver(client, model, full_messages, result["content"])
            total_cost += extra
            yield {"type": "text", "text": text, "cost": total_cost, "sources": sources}
            return

        assistant_msg = {"role": "assistant", "tool_calls": result["tool_calls"]}
        if result["content"]:
            assistant_msg["content"] = result["content"]
        full_messages.append(assistant_msg)

        # Announce every call in the batch up front (so the UI shows all
        # pending searches at once, not a trickle), then run them together
        # and report each one as it lands — real progress, not a spinner.
        parsed = [
            (tc["function"]["name"], json.loads(tc["function"]["arguments"]))
            for tc in result["tool_calls"]
        ]
        for name, args in parsed:
            yield {"type": "tool_call", "name": name, "args": args}

        results: list = [None] * len(parsed)
        for index, res in _run_tool_calls_progressive(parsed, tool_executor):
            results[index] = res
            name, args = parsed[index]
            if name == "web_search":
                yield {
                    "type": "tool_result",
                    "name": name,
                    "query": args.get("query", ""),
                    "result_count": len(res),
                    "titles": [r.get("title", "") for r in res[:2] if r.get("title")],
                }

        for tool_call, (name, args), res in zip(result["tool_calls"], parsed, results):
            if name == "web_search":
                sources.append({"query": args.get("query", ""), "results": res})
            full_messages.append(
                {
                    "role": "tool",
                    "tool_call_id": tool_call["id"],
                    "content": json.dumps(res),
                }
            )

    result = None
    for event in _run_call(None):
        if event["type"] == "_return":
            result = event["result"]
        else:
            yield event
    total_cost += result["cost"]
    text, extra = _deliver(client, model, full_messages, result["content"])
    total_cost += extra
    yield {"type": "text", "text": text, "cost": total_cost, "sources": sources}
