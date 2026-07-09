from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class TokenEvent:
    """스트리밍 도중 도착한 부분 텍스트."""

    text: str


@dataclass(frozen=True)
class ToolCallEvent:
    """도구 실행 시작."""

    name: str
    summary: str


@dataclass(frozen=True)
class ToolResultEvent:
    """도구 실행 결과."""

    name: str
    ok: bool
    summary: str


@dataclass(frozen=True)
class MessageDone:
    """어시스턴트 최종 메시지 완료."""

    content: str


@dataclass(frozen=True)
class EngineError:
    """엔진/모델 오류."""

    message: str


Event = TokenEvent | ToolCallEvent | ToolResultEvent | MessageDone | EngineError
