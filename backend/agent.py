from dataclasses import dataclass, field

import client as client_module


@dataclass
class Agent:
    name: str
    model: str
    provider: str
    persona: str
    tools: list = field(default=None)
    tool_executor: callable = field(default=None)

    def __post_init__(self):
        self._client = client_module.get_client(self.provider)

    def respond(self, messages: list[dict]) -> str:
        return client_module.complete(
            self._client,
            self.model,
            self.persona,
            messages,
            tools=self.tools,
            tool_executor=self.tool_executor,
        )

    def respond_streaming(self, messages: list[dict]):
        return client_module.complete_streaming(
            self._client,
            self.model,
            self.persona,
            messages,
            tools=self.tools,
            tool_executor=self.tool_executor,
        )
