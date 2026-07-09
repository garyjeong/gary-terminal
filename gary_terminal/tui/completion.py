"""입력 자동완성 — 슬래시 명령 + @파일 경로."""
from __future__ import annotations

import os
from pathlib import Path

COMMANDS = [
    "help", "models", "model", "reload", "clear",
    "save", "sessions", "resume", "usage", "compact", "theme", "quit",
]


def compute_completions(text: str, cwd: Path | None = None) -> tuple[str, list[str]]:
    """(치환된 입력, 후보목록) 반환. 단일 후보면 완성, 복수면 공통접두 + 후보."""
    base = Path(cwd) if cwd else Path.cwd()
    if text.startswith("/") and " " not in text:
        prefix = text[1:]
        matches = [c for c in COMMANDS if c.startswith(prefix)]
        if not matches:
            return text, []
        if len(matches) == 1:
            return f"/{matches[0]} ", []
        return f"/{os.path.commonprefix(matches)}", matches
    idx = max(text.rfind(" "), text.rfind("\t")) + 1
    token = text[idx:]
    if token.startswith("@"):
        newfrag, cands = _complete_path(token[1:], base)
        if newfrag == token[1:] and not cands:
            return text, []
        return text[:idx] + "@" + newfrag, cands
    return text, []


def _complete_path(frag: str, base: Path) -> tuple[str, list[str]]:
    if "/" in frag:
        dpart, name = frag.rsplit("/", 1)
        d = Path(dpart) if Path(dpart).is_absolute() else base / dpart
        prefix = dpart + "/"
    else:
        d, name, prefix = base, frag, ""
    try:
        entries = sorted(e for e in os.listdir(d) if not e.startswith("."))
    except OSError:
        return frag, []
    matches = [e for e in entries if e.startswith(name)]
    if not matches:
        return frag, []

    def deco(e: str) -> str:
        return e + "/" if (d / e).is_dir() else e

    if len(matches) == 1:
        return prefix + deco(matches[0]), []
    return prefix + os.path.commonprefix(matches), [deco(m) for m in matches]


def list_suggestions(text: str, cwd: Path | None = None) -> list[str]:
    """입력 즉시 표시할 후보 목록(슬래시 명령 / @파일). 개수 무관 전체 반환."""
    base = Path(cwd) if cwd else Path.cwd()
    if text.startswith("/") and " " not in text:
        prefix = text[1:]
        return [f"/{c}" for c in COMMANDS if c.startswith(prefix)]
    idx = max(text.rfind(" "), text.rfind("\t")) + 1
    token = text[idx:]
    if token.startswith("@"):
        return _list_paths(token[1:], base)
    return []


def _list_paths(frag: str, base: Path) -> list[str]:
    if "/" in frag:
        dpart, name = frag.rsplit("/", 1)
        d = Path(dpart) if Path(dpart).is_absolute() else base / dpart
        pre = dpart + "/"
    else:
        d, name, pre = base, frag, ""
    try:
        entries = sorted(e for e in os.listdir(d) if not e.startswith("."))
    except OSError:
        return []
    out = []
    for e in entries:
        if e.startswith(name):
            out.append("@" + pre + (e + "/" if (d / e).is_dir() else e))
        if len(out) >= 12:
            break
    return out
