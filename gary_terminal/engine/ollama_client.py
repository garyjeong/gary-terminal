from __future__ import annotations

import json
from collections.abc import AsyncIterator

import httpx


class OllamaError(RuntimeError):
    """Ollama 연결/요청 실패."""


class OllamaClient:
    """Ollama REST API의 최소 비동기 래퍼."""

    def __init__(self, host: str, timeout: float = 300.0) -> None:
        self._host = host.rstrip("/")
        self._timeout = timeout

    async def list_models(self) -> list[str]:
        url = f"{self._host}/api/tags"
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.get(url)
                resp.raise_for_status()
                data = resp.json()
        except httpx.HTTPError as exc:
            raise OllamaError(f"Ollama 연결 실패: {exc}") from exc
        return [m["name"] for m in data.get("models", [])]

    async def stream_chat(
        self,
        model: str,
        messages: list[dict],
        tools: list[dict] | None = None,
    ) -> AsyncIterator[dict]:
        """/api/chat 를 스트리밍으로 호출하고 파싱된 청크(dict)를 그대로 방출."""
        url = f"{self._host}/api/chat"
        payload: dict = {"model": model, "messages": messages, "stream": True}
        if tools:
            payload["tools"] = tools
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                async with client.stream("POST", url, json=payload) as resp:
                    resp.raise_for_status()
                    async for line in resp.aiter_lines():
                        if not line.strip():
                            continue
                        chunk = json.loads(line)
                        if "error" in chunk:
                            raise OllamaError(chunk["error"])
                        yield chunk
                        if chunk.get("done"):
                            break
        except httpx.HTTPError as exc:
            raise OllamaError(f"Ollama 요청 실패: {exc}") from exc
