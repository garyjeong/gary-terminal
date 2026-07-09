"""사용량 추적 — 백엔드 무관(로컬 Ollama / 구독 claude)."""
from __future__ import annotations

from dataclasses import dataclass


@dataclass
class Usage:
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read: int = 0
    cache_write: int = 0
    cost_usd: float = 0.0
    is_estimate: bool = False  # 구독 claude=API 환산 참고치
    model: str = ""
    backend: str = ""


class UsageTracker:
    def __init__(self) -> None:
        self.input = 0
        self.output = 0
        self.cost = 0.0
        self.calls = 0
        self.has_cost = False

    def add(self, u: Usage | None) -> None:
        if u is None:
            return
        self.input += u.input_tokens
        self.output += u.output_tokens
        self.cost += u.cost_usd or 0.0
        self.calls += 1
        if u.cost_usd:
            self.has_cost = True

    @property
    def total_tokens(self) -> int:
        return self.input + self.output

    def status(self) -> str:
        s = f"{self.total_tokens:,} tok"
        if self.has_cost:
            s += f" · ~${self.cost:.4f}"
        return s

    def summary(self) -> str:
        lines = [
            "[b]사용량 (이번 세션)[/b]",
            f"  모델 호출: {self.calls}",
            f"  입력: {self.input:,} tok",
            f"  출력: {self.output:,} tok",
            f"  합계: {self.total_tokens:,} tok",
        ]
        if self.has_cost:
            lines.append(f"  환산 비용: ~${self.cost:.4f}  (구독=참고치, 실과금 아님)")
        else:
            lines.append("  비용: $0 (로컬)")
        return "\n".join(lines)
