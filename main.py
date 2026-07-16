import json

from dotenv import load_dotenv

import debate
import tools
from agent import Agent

load_dotenv()

TOPIC = "Can a debate and discussion between multiple models and agents lead to better and more factually correct research rather than using one model, basically the MAD multi agent debate systems used in RL training more recently can they become consumer facing tools?"


def make_tool_executor(agent_name):
    def tool_executor(name, args):
        if name == "web_search":
            query = args.get("query", "")
            print(f"[{agent_name} searching: '{query}']")
            return tools.web_search(query, args.get("max_results", 5))
        raise ValueError(f"Unknown tool: {name}")

    return tool_executor


def main():
    base_persona = (
        "You are a thoughtful, honest participant in a discussion. You will be given "
        "a topic and, as the conversation goes on, the other participant's replies. "
        "When it's your turn, share your genuine perspective on the topic so far — "
        "agree, disagree, add nuance, or build on what's already been said. You are "
        "not assigned a side and don't need to defend a fixed position; let your view "
        "evolve naturally as the discussion progresses. Keep responses to 2-4 sentences."
    )

    agent_a = Agent(
        name="Agent A",
        model="deepseek/deepseek-v4-pro",
        provider="openrouter",
        persona=base_persona
        + " Use the web_search tool when it would help ground a claim in real evidence.",
        tools=[tools.WEB_SEARCH_TOOL],
        tool_executor=make_tool_executor("Agent A"),
    )

    agent_b = Agent(
        name="Agent B",
        model="moonshotai/kimi-k2.5",
        provider="openrouter",
        persona=base_persona,
    )

    def on_turn(turn):
        print(f"\n=== {turn['speaker']} ===")
        print(turn["text"])

    transcript = debate.run([agent_a, agent_b], TOPIC, rounds=3, on_turn=on_turn)

    with open("transcript.json", "w") as f:
        json.dump({"topic": TOPIC, "transcript": transcript}, f, indent=2)

    print("\nTranscript saved to transcript.json")


if __name__ == "__main__":
    main()
