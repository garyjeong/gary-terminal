"""모델 백엔드 추상화 — 로컬 Ollama / 구독 claude(CLI).

각 백엔드는 messages(+tools)를 받아 Chunk 스트림을 방출한다:
텍스트 델타, (네이티브)tool_calls, 마지막에 usage. Agent의 툴 루프는 백엔드 무관.
"""
from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator
from dataclasses import dataclass

from .ollama_client import OllamaClient, OllamaError
from .usage import Usage


@dataclass
class Chunk:
    text: str = ""
    tool_calls: list | None = None
    usage: Usage | None = None
    done: bool = False


class OllamaBackend:
    name = "ollama"

    def __init__(self, host: str, model: str) -> None:
        self._client = OllamaClient(host)
        self._model = model

    def model(self) -> str:
        return self._model

    def set_model(self, m: str) -> None:
        self._model = m

    async def list_models(self) -> list[str]:
        return await self._client.list_models()

    async def stream_turn(self, messages: list[dict], tools: list[dict]) -> AsyncIterator[Chunk]:
        async for chunk in self._client.stream_chat(self._model, messages, tools):
            msg = chunk.get("message", {})
            text = msg.get("content", "")
            tcs = msg.get("tool_calls")
            if text or tcs:
                yield Chunk(text=text or "", tool_calls=tcs)
            if chunk.get("done"):
                yield Chunk(
                    usage=Usage(
                        input_tokens=chunk.get("prompt_eval_count", 0),
                        output_tokens=chunk.get("eval_count", 0),
                        model=self._model,
                        backend="ollama",
                    ),
                    done=True,
                )


CLAUDE_MODELS = ["sonnet", "opus", "haiku"]


class ClaudeCliBackend:
    """로컬 `claude` CLI를 헤드리스로 구동 — 구독 인증을 그대로 상속.

    gary-terminal의 툴 루프/승인/MCP를 유지하기 위해 claude 자체 도구는 끄고
    (--allowedTools "") 텍스트 생성기로만 쓴다. 응답은 우리 JSON 툴 프로토콜을 따른다.
    """

    name = "claude"

    def __init__(self, model: str = "sonnet") -> None:
        self._model = model

    def model(self) -> str:
        return self._model

    def set_model(self, m: str) -> None:
        self._model = m

    async def list_models(self) -> list[str]:
        return list(CLAUDE_MODELS)

    async def stream_turn(self, messages: list[dict], tools: list[dict]) -> AsyncIterator[Chunk]:
        prompt = _render_prompt(messages)
        cmd = [
            "claude", "-p", prompt,
            "--output-format", "stream-json",
            "--include-partial-messages", "--verbose",
            "--model", self._model,
            "--allowedTools", "",
        ]
        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
        except FileNotFoundError:
            yield Chunk(text="[claude 오류] `claude` CLI를 찾을 수 없습니다.", done=True)
            return
        usage: Usage | None = None
        assert proc.stdout is not None
        async for raw in proc.stdout:
            line = raw.decode(errors="replace").strip()
            if not line:
                continue
            try:
                d = json.loads(line)
            except Exception:
                continue
            t = d.get("type")
            if t == "stream_event":
                ev = d.get("event", {})
                if ev.get("type") == "content_block_delta":
                    delta = ev.get("delta", {})
                    if delta.get("type") == "text_delta":
                        txt = delta.get("text", "")
                        if txt:
                            yield Chunk(text=txt)
            elif t == "result":
                u = d.get("usage", {}) or {}
                usage = Usage(
                    input_tokens=u.get("input_tokens", 0),
                    output_tokens=u.get("output_tokens", 0),
                    cache_read=u.get("cache_read_input_tokens", 0),
                    cache_write=u.get("cache_creation_input_tokens", 0),
                    cost_usd=float(d.get("total_cost_usd", 0.0) or 0.0),
                    is_estimate=True,
                    model=self._model,
                    backend="claude",
                )
                if d.get("is_error"):
                    err = d.get("result") or d.get("api_error_status") or "claude 오류"
                    yield Chunk(text=f"\n[claude 오류] {err}")
        await proc.wait()
        yield Chunk(
            usage=usage or Usage(model=self._model, backend="claude", is_estimate=True),
            done=True,
        )


def _render_prompt(messages: list[dict]) -> str:
    parts: list[str] = []
    for m in messages:
        role = m.get("role")
        c = str(m.get("content", ""))
        if role == "system":
            parts.append(c)
        elif role == "user":
            parts.append(f"\n\n=== 사용자 ===\n{c}")
        elif role == "assistant":
            parts.append(f"\n\n=== 어시스턴트 ===\n{c}")
        elif role == "tool":
            parts.append(f"\n\n=== 도구결과({m.get('tool_name', '')}) ===\n{c}")
    parts.append("\n\n=== 어시스턴트 ===\n")
    return "".join(parts)
