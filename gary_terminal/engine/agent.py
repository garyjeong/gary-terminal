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
from .ollama_client import OllamaClient, OllamaError
from .tools import TOOL_SPECS, TOOLS, ToolResult, parse_tool_call, tools_protocol_text

MAX_STEPS = 8
Approver = Callable[[str, str], Awaitable[bool]]


class Agent:
    """대화 상태 + 툴콜 루프를 도는 엔진.

    UI와 모델 사이의 '이음매'. 나중에 이 인터페이스를 서버로 빼면 client/server.
    approver(name, detail) -> bool: 승인이 필요한 도구 실행 전 UI에 확인을 요청.
    """

    def __init__(self, config: Config, approver: Approver | None = None) -> None:
        self.config = config
        self._client = OllamaClient(config.ollama_host)
        self._history: list[dict] = []
        self._approver = approver
        self._project = load_project_context()

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

    async def list_models(self) -> list[str]:
        return await self._client.list_models()

    def _messages(self) -> list[dict]:
        system = self.config.system_prompt + "\n\n" + tools_protocol_text()
        if self._project:
            name, content = self._project
            system += f"\n\n프로젝트 컨텍스트 ({name}):\n{content}"
        return [{"role": "system", "content": system}, *self._history]

    @staticmethod
    def _decide_candidate(stripped: str) -> bool | None:
        """버퍼 앞부분으로 '본문이 툴콜 JSON인가'를 판정.

        True=툴콜 후보(스트리밍 숨김) / False=일반 텍스트(스트리밍) / None=판단 보류.
        JSON 객체({...})와 ```json 펜스만 후보로 보고, ```python 등 코드 답변은 흘린다.
        """
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
                    self.config.model, self._messages(), TOOL_SPECS
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
                tool = TOOLS.get(name)
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
            parsed = parse_tool_call(buffer)
            if parsed:
                calls.append(parsed)
        return calls

    async def _exec(self, name: str, args: dict) -> ToolResult:
        tool = TOOLS.get(name)
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
        except Exception as exc:  # noqa: BLE001 - 도구 오류는 모델에 되돌려줌
            return ToolResult(False, f"error: {exc}", f"오류: {exc}")
