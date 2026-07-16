def _build_messages(agent, transcript, topic):
    if not transcript:
        return [
            {
                "role": "user",
                "content": f"The debate topic is: {topic}\n\nGive your opening argument.",
            }
        ]

    messages = []
    for turn in transcript:
        role = "assistant" if turn["speaker"] == agent.name else "user"
        messages.append({"role": role, "content": f"{turn['speaker']}: {turn['text']}"})
    return messages


def run(agents: list, topic: str, rounds: int = 3, on_turn=None) -> list[dict]:
    transcript = []
    total_turns = rounds * len(agents)

    for i in range(total_turns):
        agent = agents[i % len(agents)]
        messages = _build_messages(agent, transcript, topic)
        text = agent.respond(messages)
        turn = {"speaker": agent.name, "text": text}
        transcript.append(turn)
        if on_turn:
            on_turn(turn)

    return transcript
