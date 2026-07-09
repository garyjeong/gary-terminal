"""프로젝트 컨텍스트 로드 + @파일 멘션 확장."""
from __future__ import annotations

import re
from pathlib import Path

CONTEXT_FILES = ["AGENTS.md", "CLAUDE.md", "GEMINI.md"]
MAX_CONTEXT = 20_000
MAX_ATTACH = 40_000
_MENTION = re.compile(r"@([^\s@]+)")


def load_project_context(cwd: Path | None = None) -> tuple[str, str] | None:
    """cwd에서 프로젝트 컨텍스트 파일(AGENTS.md 등)을 찾아 (파일명, 내용) 반환."""
    base = cwd or Path.cwd()
    for name in CONTEXT_FILES:
        p = base / name
        if p.is_file():
            text = p.read_text(errors="replace")
            if len(text) > MAX_CONTEXT:
                text = text[:MAX_CONTEXT] + "\n...(잘림)"
            return name, text
    return None


def expand_mentions(text: str, cwd: Path | None = None) -> tuple[str, list[str], list[str]]:
    """text의 @경로 멘션을 찾아 파일 내용을 뒤에 인라인한다.

    반환: (모델에게 보낼 확장 텍스트, 첨부된 경로, 없는 경로)
    경로처럼 보이지 않는 @단어(@property 등)는 무시한다.
    """
    base = cwd or Path.cwd()
    seen: list[str] = []
    for m in _MENTION.finditer(text):
        raw = m.group(1).rstrip(".,;:)")
        if raw and raw not in seen:
            seen.append(raw)
    if not seen:
        return text, [], []
    attached: list[str] = []
    missing: list[str] = []
    blocks: list[str] = []
    for rp in seen:
        p = Path(rp).expanduser()
        if not p.is_absolute():
            p = base / rp
        if p.is_file():
            content = p.read_text(errors="replace")
            if len(content) > MAX_ATTACH:
                content = content[:MAX_ATTACH] + "\n...(잘림)"
            blocks.append(f"[첨부 파일: {rp}]\n```\n{content}\n```")
            attached.append(rp)
        elif "/" in rp or "." in rp:
            missing.append(rp)
    expanded = text + "\n\n" + "\n\n".join(blocks) if blocks else text
    return expanded, attached, missing


def estimate_tokens(messages: list[dict]) -> int:
    """메시지 리스트의 대략적 토큰 수(문자수 기반 근사)."""
    total = sum(len(str(m.get("content", ""))) for m in messages)
    return int(total / 3.5)
