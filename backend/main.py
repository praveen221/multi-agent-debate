import json

import questionary
from dotenv import load_dotenv

import agent_factory
import debate
import models

load_dotenv()

DEFAULT_TOPIC = "Can a debate and discussion between multiple models and agents lead to better and more factually correct research rather than using one model, basically the MAD multi agent debate systems used in RL training more recently can they become consumer facing tools?"


def pick_model(model_ids):
    if not model_ids:
        return questionary.text("Model slug (e.g. deepseek/deepseek-v4-pro):").ask()

    return questionary.autocomplete(
        "Model (type to search):",
        choices=model_ids,
        match_middle=True,
        validate=lambda text: text in model_ids or "Pick a model from the list",
    ).ask()


def setup_agents():
    print("Fetching available models from OpenRouter...")
    try:
        model_ids = [m["id"] for m in models.cheapest_first(models.fetch_models())]
        print(f"Loaded {len(model_ids)} models (cheapest first).\n")
    except Exception:
        print("[couldn't fetch model list — you'll need to type slugs manually]\n")
        model_ids = []

    count = int(
        questionary.text(
            "How many agents?",
            default="2",
            validate=lambda text: text.isdigit() and int(text) >= 2,
        ).ask()
    )

    agents = []
    for i in range(count):
        default_name = f"Agent {chr(65 + i)}"
        name = questionary.text(f"Name for agent {i + 1}:", default=default_name).ask()
        model = pick_model(model_ids)
        wants_search = questionary.confirm(
            f"Give {name} the web_search tool?", default=False
        ).ask()

        agents.append(
            agent_factory.build_agent(
                {"name": name, "model": model, "use_search": wants_search}
            )
        )

    return agents


def main():
    agents = setup_agents()
    topic = input("\nDebate topic (Enter for default): ").strip() or DEFAULT_TOPIC

    print(f"\nTopic: {topic}")

    transcript = []
    turns = debate.run(agents, topic)
    while True:
        if input("\n[Enter] next turn, [q] end debate: ").strip().lower() == "q":
            break
        turn = next(turns)
        print(f"\n=== {turn['speaker']} ===")
        print(turn["text"])
        transcript.append(turn)

    with open("transcript.json", "w") as f:
        json.dump({"topic": topic, "transcript": transcript}, f, indent=2)

    print("\nTranscript saved to transcript.json")


if __name__ == "__main__":
    main()
