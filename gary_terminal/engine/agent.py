from __future__ import annotations

import json
from collections.abc import AsyncIterator, Awaitable, Callable

from ..config import Config
from .context import expand_mentions, load_project_context
from .events import (
    AttachmentEvent,
    EngineError,
    Event,
    MessageDone,
    TokenEvent,
    ToolCallEvent,
    ToolResultEvent,
)
from .mcp_client import build_mcp_tools
from .ollama_client import OllamaClient, OllamaError
from .tools import ToolResult, make_protocol, make_specs, new_registry, parse_tool_call

MAX_STEPS = 8
Approver = Callable[[str, str], Awaitable[bool]]


class Agent:
    """대화 상태 + 툴콜 루프를 도는 엔진.

    도구 레지스트리(self._tools)를 인스턴스가 소유한다: 빌트인 + MCP 동적 등록.
    approver(name, detail) -> bool: 승인 필요한 도구 실행 전 UI 확인.
    """

    def __init__(self, config: Config, approver: Approver | None = None) -> None:
        self.config = config
        self._client = OllamaClient(config.ollama_host)
        self._history: list[dict] = []
        self._approver = approver
        self._project = load_project_context()
        self._tools = new_registry()
        self._rebuild()

    def _rebuild(self) -> None:
        self._specs = make_specs(self._tools)
        self._protocol = make_protocol(self._tools)

    @property
    def model(self) -> str:
        return self.config.model

    @property
    def project_name(self) -> str | None:
        return self._project[0] if self._project else None

    def set_model(self, name: str) -> None:
        self.config.model = name

    def reset(self) -> None:
        self._history.clear()

    def export_history(self) -> list[dict]:
        return list(self._history)

    def import_history(self, messages: list[dict]) -> None:
        self._history = [dict(m) for m in messages]

    def reload_context(self) -> str | None:
        self._project = load_project_context()
        return self.project_name

    async def load_mcp(self) -> list[tuple[str, int, str | None]]:
        tools, summary = await build_mcp_tools()
        for t in tools:
            self._tools[t.name] = t
        self._rebuild()
        return summary

    async def list_models(self) -> list[str]:
        return await self._client.list_models()

    def _messages(self) -> list[dict]:
        system = self.config.system_prompt + "\n\n" + self._protocol
        if self._project:
            name, content = self._project
            system += f"\n\n프로젝트 컨텍스트 ({name}):\n{content}"
        return [{"role": "system", "content": system}, *self._history]

    @staticmethod
    def _decide_candidate(stripped: str) -> bool | None:
        if not stripped:
            return None
        if stripped[0] == "{":
            return True
        if stripped.startswith("```"):
            if "\n" not in stripped:
                return None
            lang = stripped[3 : stripped.index("\n")].strip().lower()
            return lang == "json"
        return False

    async def send(self, user_text: str) -> AsyncIterator[Event]:
        expanded, attached, missing = expand_mentions(user_text)
        if attached or missing:
            yield AttachmentEvent(attached, missing)
        self._history.append({"role": "user", "content": expanded})
        for _ in range(MAX_STEPS):
            buffer = ""
            candidate: bool | None = None
            native: list[dict] = []
            try:
                async for chunk in self._client.stream_chat(
                    self.config.model, self._messages(), self._specs
                ):
                    msg = chunk.get("message", {})
                    delta = msg.get("content", "")
                    if delta:
                        buffer += delta
                        if candidate is None:
                            candidate = self._decide_candidate(buffer.lstrip())
                            if candidate is False:
                                yield TokenEvent(buffer)
                        elif candidate is False:
                            yield TokenEvent(delta)
                    if msg.get("tool_calls"):
                        native.extend(msg["tool_calls"])
                    if chunk.get("done"):
                        break
            except OllamaError as exc:
                yield EngineError(str(exc))
                return

            if candidate is None and not native and buffer:
                yield TokenEvent(buffer)
                candidate = False

            calls = self._collect_calls(native, candidate, buffer)

            if not calls:
                if candidate and not native:
                    yield TokenEvent(buffer)
                self._history.append({"role": "assistant", "content": buffer})
                yield MessageDone(buffer)
                return

            self._history.append({"role": "assistant", "content": buffer})
            for name, args in calls:
                tool = self._tools.get(name)
                summary = tool.call_summary(args) if tool else name
                yield ToolCallEvent(name, summary)
                result = await self._exec(name, args)
                yield ToolResultEvent(name, result.ok, result.summary)
                self._history.append(
                    {"role": "tool", "content": result.content, "tool_name": name}
                )
        yield EngineError(f"최대 도구 단계({MAX_STEPS}) 초과")

    def _collect_calls(
        self, native: list[dict], candidate: bool | None, buffer: str
    ) -> list[tuple[str, dict]]:
        calls: list[tuple[str, dict]] = []
        if native:
            for tc in native:
                fn = tc.get("function", {})
                name = fn.get("name", "")
                args = fn.get("arguments", {}) or {}
                if isinstance(args, str):
                    try:
                        args = json.loads(args)
                    except Exception:
                        args = {}
                if name:
                    calls.append((name, args))
        elif candidate:
            parsed = parse_tool_call(buffer, self._tools)
            if parsed:
                calls.append(parsed)
        return calls

    async def _exec(self, name: str, args: dict) -> ToolResult:
        tool = self._tools.get(name)
        if tool is None:
            return ToolResult(False, f"unknown tool: {name}", f"알 수 없는 도구: {name}")
        if tool.requires_approval:
            approved = False
            if self._approver is not None:
                approved = await self._approver(name, tool.describe(args))
            if not approved:
                return ToolResult(False, "denied by user", "거부됨")
        try:
            return await tool.run(args)
        except Exception as exc:  # noqa: BLE001
            return ToolResult(False, f"error: {exc}", f"오류: {exc}")
