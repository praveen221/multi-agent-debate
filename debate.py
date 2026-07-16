def _build_messages(agent, transcript, topic):
    messages = [{"role": "user", "content": f"The debate topic is: {topic}"}]

    if not transcript:
        messages.append({"role": "user", "content": "Give your opening argument."})
        return messages

    for turn in transcript:
        if turn["speaker"] == agent.name:
            messages.append({"role": "assistant", "content": turn["text"]})
        else:
            messages.append(
                {"role": "user", "content": f"{turn['speaker']}: {turn['text']}"}
            )
    return messages


def run(agents: list, topic: str):
    """Yields one turn at a time; the next agent only speaks once you pull again."""
    transcript = []
    i = 0
    while True:
        agent = agents[i % len(agents)]
        messages = _build_messages(agent, transcript, topic)
        text = agent.respond(messages)
        turn = {"speaker": agent.name, "text": text}
        transcript.append(turn)
        yield turn
        i += 1
