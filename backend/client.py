import json
import os

from openai import OpenAI

MAX_TOOL_ROUNDS = 3

PROVIDERS = {
    "openrouter": {
        "base_url": "https://openrouter.ai/api/v1",
        "api_key_env": "OPENROUTER_API_KEY",
    },
}


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
        return response.choices[0].message.content

    for _ in range(MAX_TOOL_ROUNDS):
        response = client.chat.completions.create(
            model=model, messages=full_messages, tools=tools
        )
        message = response.choices[0].message

        if not message.tool_calls:
            return message.content

        full_messages.append(message.model_dump(exclude_unset=True))

        for tool_call in message.tool_calls:
            args = json.loads(tool_call.function.arguments)
            result = tool_executor(tool_call.function.name, args)
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
    return response.choices[0].message.content


def complete_streaming(client, model, system_prompt, messages, tools=None, tool_executor=None):
    """Same tool loop as complete(), but yields progress along the way:
    {"type": "tool_call", "name", "args"} for each tool call, then finally
    {"type": "text", "text", "cost"} — cost is the sum of every completion
    call's real USD cost (OpenRouter reports this on every response), since
    one "turn" can involve several calls across the tool loop."""
    full_messages = [{"role": "system", "content": system_prompt}] + list(messages)
    total_cost = 0.0

    if not tools:
        response = client.chat.completions.create(model=model, messages=full_messages)
        total_cost += getattr(response.usage, "cost", 0) or 0
        yield {"type": "text", "text": response.choices[0].message.content, "cost": total_cost}
        return

    for _ in range(MAX_TOOL_ROUNDS):
        response = client.chat.completions.create(
            model=model, messages=full_messages, tools=tools
        )
        total_cost += getattr(response.usage, "cost", 0) or 0
        message = response.choices[0].message

        if not message.tool_calls:
            yield {"type": "text", "text": message.content, "cost": total_cost}
            return

        full_messages.append(message.model_dump(exclude_unset=True))

        for tool_call in message.tool_calls:
            args = json.loads(tool_call.function.arguments)
            yield {"type": "tool_call", "name": tool_call.function.name, "args": args}
            result = tool_executor(tool_call.function.name, args)
            full_messages.append(
                {
                    "role": "tool",
                    "tool_call_id": tool_call.id,
                    "content": json.dumps(result),
                }
            )

    response = client.chat.completions.create(model=model, messages=full_messages)
    total_cost += getattr(response.usage, "cost", 0) or 0
    yield {"type": "text", "text": response.choices[0].message.content, "cost": total_cost}
