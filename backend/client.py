import json
import os
import re
from concurrent.futures import ThreadPoolExecutor, as_completed

from openai import OpenAI

MAX_TOOL_ROUNDS = 3
# A model can request several web_search calls in one turn (we've seen up to
# 4-5) — tool_executor is IO-bound network work, so a thread pool collapses
# that from "sum of every search's latency" to "roughly the slowest one".
MAX_PARALLEL_TOOL_CALLS = 8

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


def _deliver(client, model, full_messages, text):
    """Final gate for every reply. Returns (clean_text, extra_cost)."""
    if not _looks_like_leaked_tool_call(text or ""):
        return text, 0.0
    stripped = strip_leaked_tool_calls(text)
    if len(stripped) >= _MIN_SURVIVING_CHARS:
        return stripped, 0.0
    retry = client.chat.completions.create(
        model=model, messages=full_messages + [_NO_TOOLS_NUDGE]
    )
    cost = getattr(retry.usage, "cost", 0) or 0
    clean = strip_leaked_tool_calls(retry.choices[0].message.content or "")
    # If even the retry came back as pure tool syntax, fall back to whatever
    # prose the original had rather than an empty turn.
    return (clean or stripped), cost


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
        response = client.chat.completions.create(model=model, messages=full_messages)
        text, _ = _deliver(client, model, full_messages, response.choices[0].message.content)
        return text

    for _ in range(MAX_TOOL_ROUNDS):
        response = client.chat.completions.create(
            model=model, messages=full_messages, tools=tools
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
    response = client.chat.completions.create(model=model, messages=full_messages)
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
        response = client.chat.completions.create(model=model, messages=full_messages)
        total_cost += getattr(response.usage, "cost", 0) or 0
        text, extra = _deliver(client, model, full_messages, response.choices[0].message.content)
        total_cost += extra
        yield {"type": "text", "text": text, "cost": total_cost, "sources": sources}
        return

    for _ in range(MAX_TOOL_ROUNDS):
        response = client.chat.completions.create(
            model=model, messages=full_messages, tools=tools
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

    response = client.chat.completions.create(model=model, messages=full_messages)
    total_cost += getattr(response.usage, "cost", 0) or 0
    text, extra = _deliver(client, model, full_messages, response.choices[0].message.content)
    total_cost += extra
    yield {"type": "text", "text": text, "cost": total_cost, "sources": sources}
