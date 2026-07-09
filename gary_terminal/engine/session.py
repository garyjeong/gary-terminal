"""대화 세션 저장/재개 (JSON 파일)."""
from __future__ import annotations

import json
import time
from dataclasses import dataclass
from pathlib import Path

SESS_DIR = Path.home() / ".gary-terminal" / "sessions"


@dataclass
class SessionInfo:
    path: Path
    id: str
    title: str
    model: str
    cwd: str
    updated: float
    turns: int


def _title(history: list[dict]) -> str:
    for m in history:
        if m.get("role") == "user":
            t = str(m.get("content", "")).strip().splitlines()[0]
            return t[:50] if t else "(제목 없음)"
    return "(빈 세션)"


class SessionStore:
    def __init__(self, base: Path | None = None) -> None:
        self._dir = base or SESS_DIR
        self._dir.mkdir(parents=True, exist_ok=True)

    def save(self, sid: str, history: list[dict], model: str, cwd: str) -> Path:
        data = {
            "id": sid,
            "title": _title(history),
            "model": model,
            "cwd": cwd,
            "updated": time.time(),
            "messages": history,
        }
        p = self._dir / f"{sid}.json"
        p.write_text(json.dumps(data, ensure_ascii=False, indent=1))
        return p

    def list(self, cwd: str | None = None) -> list[SessionInfo]:
        out: list[SessionInfo] = []
        for p in self._dir.glob("*.json"):
            try:
                d = json.loads(p.read_text())
            except Exception:
                continue
            if cwd is not None and d.get("cwd") != cwd:
                continue
            turns = sum(1 for m in d.get("messages", []) if m.get("role") == "user")
            out.append(
                SessionInfo(
                    p, d.get("id", p.stem), d.get("title", ""),
                    d.get("model", ""), d.get("cwd", ""),
                    float(d.get("updated", 0)), turns,
                )
            )
        out.sort(key=lambda s: s.updated, reverse=True)
        return out

    def load(self, path: Path) -> dict:
        return json.loads(path.read_text())
