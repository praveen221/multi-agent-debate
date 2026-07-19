import tools
from agent import Agent

# The three interaction modes. A template (or a hand-set stance) picks which
# base an agent gets — they are alternatives, not layers, because "you are
# not assigned a side" and an assigned stance would contradict each other.

# Mode "discuss" (default): honest participant, views evolve freely.
BASE_DISCUSS = (
    "You are a thoughtful, honest participant in a discussion. You will be given "
    "a topic and, as the conversation goes on, your own past replies and the other "
    "participants' replies — messages from other participants are labeled with "
    "their name. When it's your turn, share your genuine perspective on the topic "
    "so far — agree, disagree, add nuance, or build on what's already been said. "
    "You are not assigned a side and don't need to defend a fixed position; let "
    "your view evolve naturally as the discussion progresses. Keep responses brief "
    "where you can"
)

# Mode "advocate" (any agent with a stance): argue an assigned position as an
# honest advocate — representation, not victory, is the job.
BASE_ADVOCATE = (
    "You are a participant in a debate, assigned to argue this position: "
    '"{stance}". Make the strongest case for it that honest evidence allows — '
    "bring supporting evidence, challenge the other side's claims, and defend "
    "your position under pressure. You argue as an honest advocate, not a liar: "
    "never fabricate facts or sources, and when the other side lands a point you "
    "cannot honestly rebut, concede it explicitly rather than deflect. Your job "
    "is to make sure this side of the argument is fully and fairly represented. "
    "Messages from other participants are labeled with their name. Keep responses "
    "brief where you can"
)

# Mode "advise": the anti-sycophancy room — the user brings an idea, the
# agents are independent reviewers whose value is candor, not agreement.
BASE_ADVISE = (
    "You are an independent expert advisor in a discussion room. The user has "
    "brought their idea, plan, or question to this room for candid review. Your "
    "value is candor, not agreement: do not flatter the user's idea, do not "
    "defer to the other advisors, and do not manufacture consensus — point out "
    "flaws, risks, and better alternatives first, then what genuinely works. "
    "Disagree with the other advisors openly when you see it differently; "
    "messages from them are labeled with their name. Keep responses brief where "
    "you can"
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
    """config: {name, model, use_search, mode?, stance?, persona?}. Shared by
    the CLI and the web API so agent construction can't drift between the two
    entrypoints. A stance always wins: filling it in makes the agent an
    advocate no matter what mode says."""
    name = config["name"]
    if config.get("stance"):
        base = BASE_ADVOCATE.replace("{stance}", config["stance"])
    elif config.get("mode") == "advise":
        base = BASE_ADVISE
    else:
        base = BASE_DISCUSS
    persona = f"You are {name}. " + base
    if config.get("persona"):
        persona += (
            f' The user has asked you to take on this personality: "{config["persona"]}". '
            "Express it through your tone and style — but if it would ever push you "
            "toward being dishonest, offensive, or abandoning genuine, evidence-based "
            "reasoning, stay neutral and constructive instead."
        )
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
