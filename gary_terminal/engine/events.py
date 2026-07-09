from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class TokenEvent:
    text: str


@dataclass(frozen=True)
class AttachmentEvent:
    attached: list[str] = field(default_factory=list)
    missing: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class CompactEvent:
    """컨텍스트 자동 압축(요약) 발생."""

    removed: int
    summary_chars: int


@dataclass(frozen=True)
class ToolCallEvent:
    name: str
    summary: str


@dataclass(frozen=True)
class ToolResultEvent:
    name: str
    ok: bool
    summary: str


@dataclass(frozen=True)
class EscalateEvent:
    """로컬 백엔드 실패 → 상위 백엔드로 자동 승격."""

    from_backend: str
    to_backend: str


@dataclass(frozen=True)
class PlanEvent:
    """계획/TODO 갱신."""

    items: list[dict] = field(default_factory=list)


@dataclass(frozen=True)
class MessageDone:
    content: str


@dataclass(frozen=True)
class EngineError:
    message: str


Event = (
    TokenEvent
    | AttachmentEvent
    | CompactEvent
    | EscalateEvent
    | PlanEvent
    | ToolCallEvent
    | ToolResultEvent
    | MessageDone
    | EngineError
)
