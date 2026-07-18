from pydantic import BaseModel, Field


class AgentConfig(BaseModel):
    name: str
    model: str
    use_search: bool = False
    persona: str | None = Field(default=None, max_length=500)


class CreateSessionRequest(BaseModel):
    topic: str
    agents: list[AgentConfig]


class SteerMessageRequest(BaseModel):
    text: str = Field(min_length=1, max_length=2000)
