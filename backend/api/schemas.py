from pydantic import BaseModel


class AgentConfig(BaseModel):
    name: str
    model: str
    use_search: bool = False


class CreateSessionRequest(BaseModel):
    topic: str
    agents: list[AgentConfig]
