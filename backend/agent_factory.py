import tools
from agent import Agent

BASE_PERSONA = (
    "You are a thoughtful, honest participant in a discussion. You will be given "
    "a topic and, as the conversation goes on, your own past replies and the other "
    "participants' replies — messages from other participants are labeled with "
    "their name. When it's your turn, share your genuine perspective on the topic "
    "so far — agree, disagree, add nuance, or build on what's already been said. "
    "You are not assigned a side and don't need to defend a fixed position; let "
    "your view evolve naturally as the discussion progresses. Keep responses to "
    "2-4 sentences."
)


def make_tool_executor(agent_name):
    def tool_executor(name, args):
        if name == "web_search":
            query = args.get("query", "")
            print(f"[{agent_name} searching: '{query}']")
            return tools.web_search(query, args.get("max_results", 5))
        raise ValueError(f"Unknown tool: {name}")

    return tool_executor


def build_agent(config: dict) -> Agent:
    """config: {name, model, use_search}. Shared by the CLI and the web API
    so agent construction can't drift between the two entrypoints."""
    name = config["name"]
    persona = f"You are {name}. " + BASE_PERSONA
    agent_tools = None
    tool_executor = None
    if config.get("use_search"):
        persona += " Use the web_search tool when it would help ground a claim in real evidence."
        agent_tools = [tools.WEB_SEARCH_TOOL]
        tool_executor = make_tool_executor(name)

    return Agent(
        name=name,
        model=config["model"],
        provider="openrouter",
        persona=persona,
        tools=agent_tools,
        tool_executor=tool_executor,
    )
