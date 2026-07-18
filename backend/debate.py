def build_messages(agent, transcript, topic):
    messages = [{"role": "user", "content": f"The debate topic is: {topic}"}]

    if not transcript:
        messages.append({"role": "user", "content": "Give your opening argument."})
        return messages

    for turn in transcript:
        if turn.get("role") == "human":
            messages.append(
                {"role": "user", "content": f"A human moderator says: {turn['text']}"}
            )
        elif turn.get("role") == "judge":
            # Only interjections are spoken into the debate; verdicts are
            # sideline notes for the human and the agents never see them.
            if (turn.get("verdict") or {}).get("kind") == "intervention":
                messages.append(
                    {"role": "user", "content": f"The debate judge interjects: {turn['text']}"}
                )
        elif turn["speaker"] == agent.name:
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
        messages = build_messages(agent, transcript, topic)
        text = agent.respond(messages)
        turn = {"speaker": agent.name, "text": text}
        transcript.append(turn)
        yield turn
        i += 1
