from typing import Literal

from pydantic import BaseModel, Field


class AgentConfig(BaseModel):
    name: str
    model: str
    use_search: bool = False
    persona: str | None = Field(default=None, max_length=500)
    # Interaction mode, usually set by a template. A non-empty stance makes
    # the agent an advocate regardless of mode.
    mode: Literal["discuss", "advocate", "advise"] = "discuss"
    stance: str | None = Field(default=None, max_length=300)


class JudgeConfig(BaseModel):
    enabled: bool = True
    model: str


class CreateSessionRequest(BaseModel):
    topic: str
    agents: list[AgentConfig]
    judge: JudgeConfig | None = None


class UpdateSessionRequest(BaseModel):
    judge: JudgeConfig


class SteerMessageRequest(BaseModel):
    text: str = Field(min_length=1, max_length=2000)


class NextTurnRequest(BaseModel):
    # The client's view of the transcript length. If it doesn't match the
    # database (a dropped stream, a second tab), refuse to generate a turn
    # from the stale count instead of letting the rotation go wrong.
    expected_turn_index: int | None = None


class JudgeActionRequest(BaseModel):
    action: Literal["verdict", "intervene", "pressure_test", "refocus", "report"]
    # For 'intervene': the verdict turn whose text gets spoken into the debate.
    source_turn_index: int | None = None
