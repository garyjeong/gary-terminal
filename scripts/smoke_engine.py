"""엔진 단독 스모크 테스트 — TUI 없이 Ollama 연결·툴콜 루프 확인.

    uv run python scripts/smoke_engine.py "이 폴더에 뭐가 있어?"
승인 필요한 도구(write_file/run_shell)는 이 스크립트에서 자동 승인된다.
"""
from __future__ import annotations

import asyncio
import sys

from gary_terminal.config import Config
from gary_terminal.engine import (
    Agent,
    EngineError,
    MessageDone,
    TokenEvent,
    ToolCallEvent,
    ToolResultEvent,
)


async def _auto_approve(name: str, detail: str) -> bool:
    print(f"\n[approve? {name}] 자동 승인")
    return True


async def run() -> int:
    prompt = sys.argv[1] if len(sys.argv) > 1 else "list_dir 도구로 현재 폴더를 보여줘."
    agent = Agent(Config.load(), approver=_auto_approve)
    print(f"[model] {agent.model}")
    print(f"[you] {prompt}")
    async for ev in agent.send(prompt):
        if isinstance(ev, TokenEvent):
            print(ev.text, end="", flush=True)
        elif isinstance(ev, ToolCallEvent):
            print(f"\n[tool→] {ev.summary}")
        elif isinstance(ev, ToolResultEvent):
            print(f"[tool←] {'ok' if ev.ok else 'fail'} · {ev.summary}")
        elif isinstance(ev, MessageDone):
            print("\n[done]")
        elif isinstance(ev, EngineError):
            print(f"\n[error] {ev.message}")
            return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(run()))
