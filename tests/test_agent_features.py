from gary_terminal.config import Config
from gary_terminal.engine import Agent, EscalateEvent, MessageDone, PlanEvent
from gary_terminal.engine.backend import Chunk
from gary_terminal.engine.ollama_client import OllamaError
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


class ErrBackend:
    name = "ollama"

    def model(self):
        return "x"

    def set_model(self, m):
        pass

    async def list_models(self):
        return []

    async def stream_turn(self, messages, tools):
        raise OllamaError("서버 다운")
        yield Chunk()  # generator 로 만들기 위함


class OkBackend:
    name = "claude"

    def model(self):
        return "sonnet"

    def set_model(self, m):
        pass

    async def list_models(self):
        return ["sonnet"]

    async def stream_turn(self, messages, tools):
        yield Chunk(text="에스컬레이션 성공")
        yield Chunk(usage=Usage(), done=True)


async def test_auto_escalation():
    cfg = Config()
    cfg.auto_escalate = True
    cfg.escalate_to = "claude"
    agent = Agent(cfg)
    agent._backends["ollama"] = ErrBackend()
    agent._backends["claude"] = OkBackend()
    agent._backend = agent._backends["ollama"]
    evs = [e async for e in agent.send("안녕")]
    assert any(isinstance(e, EscalateEvent) for e in evs)
    done = [e for e in evs if isinstance(e, MessageDone)]
    assert done and "성공" in done[-1].content
    assert agent._backend.name == "ollama"  # 원복


async def test_no_escalation_when_off():
    cfg = Config()
    cfg.auto_escalate = False
    agent = Agent(cfg)
    agent._backends["ollama"] = ErrBackend()
    agent._backend = agent._backends["ollama"]
    evs = [e async for e in agent.send("안녕")]
    assert not any(isinstance(e, EscalateEvent) for e in evs)


async def test_update_plan_tool():
    agent = Agent(Config())
    call1 = [
        Chunk(text='{"name":"update_plan","arguments":{"tasks":[{"content":"A","status":"in_progress"},{"content":"B"}]}}'),
        Chunk(usage=Usage(), done=True),
    ]
    call2 = [Chunk(text="계획대로 진행합니다"), Chunk(usage=Usage(), done=True)]
    agent._backend = FakeBackend([call1, call2])
    evs = [e async for e in agent.send("계획 세워줘")]
    assert any(isinstance(e, PlanEvent) for e in evs)
    assert len(agent.plan) == 2
    assert agent.plan[0]["content"] == "A" and agent.plan[0]["status"] == "in_progress"


async def test_spawn_agents(monkeypatch):
    agent = Agent(Config())

    async def fake_sub(task):
        return f"결과:{task}"

    monkeypatch.setattr(agent, "_run_subagent", fake_sub)
    r = await agent._tools["spawn_agents"].run({"tasks": ["t1", "t2"]})
    assert r.ok and "결과:t1" in r.content and "결과:t2" in r.content


def test_subagent_has_no_meta_tools():
    sub = Agent(Config(), allow_meta_tools=False)
    assert "spawn_agents" not in sub._tools and "update_plan" not in sub._tools
    main = Agent(Config())
    assert "spawn_agents" in main._tools and "update_plan" in main._tools
