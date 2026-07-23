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


class ConciergeRequest(BaseModel):
    # The raw prompt the user typed, and which room type they were setting up —
    # the concierge is template-aware (a bare topic in an advocate room should
    # be clarified into a proposition; an advise room needs a concrete idea).
    prompt: str = Field(min_length=1, max_length=2000)
    template_label: str | None = Field(default=None, max_length=60)
    mode: Literal["discuss", "advocate", "advise"] = "discuss"


class IntakeInfo(BaseModel):
    # Links a created room back to the concierge interaction that produced it.
    # intake_id ties the mad_intake row to this session; interpretation/resolved
    # are denormalized onto the session so the room can show its framing banner
    # without a second read.
    intake_id: str | None = None
    interpretation: str | None = Field(default=None, max_length=1000)
    resolved: bool = False


class CreateSessionRequest(BaseModel):
    topic: str
    agents: list[AgentConfig]
    judge: JudgeConfig | None = None
    # What the user actually typed, before a template composed it into the
    # full instruction above — kept separate so the header can show just
    # that instead of the composed prompt. Optional: old clients and the
    # open-discussion template (no composition) can omit it.
    subject: str | None = Field(default=None, max_length=2000)
    template_label: str | None = Field(default=None, max_length=60)
    intake: IntakeInfo | None = None


class UpdateSessionRequest(BaseModel):
    judge: JudgeConfig | None = None
    title: str | None = Field(default=None, min_length=1, max_length=120)


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


class SingleStartRequest(BaseModel):
    # Which single model to run alongside the debate, and whether it searches.
    model: str = Field(min_length=1, max_length=120)
    use_search: bool = True


class SingleNextRequest(BaseModel):
    # A picked follow-up option — instruction is sent to the model, label is
    # recorded on the turn it produces. The user never types a raw prompt.
    instruction: str = Field(min_length=1, max_length=1000)
    label: str = Field(default="", max_length=120)


class SingleInterveneRequest(BaseModel):
    # A debate intervention fanned into the single track: a human steer or a
    # judge interjection, which the single model then responds to.
    kind: Literal["human", "judge"]
    text: str = Field(min_length=1, max_length=4000)


class ComparisonRequest(BaseModel):
    # The benchmark verdict: which track the user found more useful.
    preference: Literal["single", "multi"]


class FeedbackRequest(BaseModel):
    category: Literal["bug", "idea", "other"] | None = None
    # A rating prompt may send only stars (empty message), the manual box only
    # text — one of the two must be present.
    message: str = Field(default="", max_length=4000)
    rating: int | None = Field(default=None, ge=1, le=5)
    trigger_point: Literal["manual", "conclude", "rounds"] = "manual"
    page: str | None = Field(default=None, max_length=200)
