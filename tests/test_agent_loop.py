from gary_terminal.config import Config
from gary_terminal.engine import Agent, MessageDone, ToolCallEvent, ToolResultEvent
from gary_terminal.engine.backend import Chunk
from gary_terminal.engine.usage import Usage


class FakeBackend:
    name = "fake"

    def __init__(self, scripts):
        self._scripts = scripts
        self._i = 0

    def model(self):
        return "fake"

    def set_model(self, m):
        pass

    async def list_models(self):
        return ["fake"]

    async def stream_turn(self, messages, tools):
        chunks = self._scripts[self._i]
        self._i += 1
        for c in chunks:
            yield c


def test_decide_candidate():
    assert Agent._decide_candidate("{") is True
    assert Agent._decide_candidate("hello") is False
    assert Agent._decide_candidate("```python\n") is False
    assert Agent._decide_candidate("```json\n") is True
    assert Agent._decide_candidate("") is None


async def test_tool_loop_with_fake_backend():
    agent = Agent(Config())
    call1 = [
        Chunk(text='{"name":"list_dir","arguments":{"path":"."}}'),
        Chunk(usage=Usage(input_tokens=1, output_tokens=1), done=True),
    ]
    call2 = [
        Chunk(text="완료했습니다"),
        Chunk(usage=Usage(input_tokens=1, output_tokens=1), done=True),
    ]
    agent._backend = FakeBackend([call1, call2])
    evs = [ev async for ev in agent.send("현재 폴더 봐줘")]
    kinds = [type(e).__name__ for e in evs]
    assert "ToolCallEvent" in kinds and "ToolResultEvent" in kinds and "MessageDone" in kinds
    tc = next(e for e in evs if isinstance(e, ToolCallEvent))
    assert tc.name == "list_dir"
    done = next(e for e in evs if isinstance(e, MessageDone))
    assert "완료" in done.content
    assert agent.usage.calls == 2
