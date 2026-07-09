"""테마 템플릿 — 내장 gary 테마 + 사용자 파일(~/.config/gary-terminal/themes/*.toml).

각 템플릿은 시맨틱 색 토큰(primary/accent/background/surface/panel/success/
warning/error/foreground/secondary + dark)을 정의하고 Textual Theme으로 매핑된다.
파일명(확장자 제외)이 테마 이름이 된다. /theme <이름> 으로 적용.
"""
from __future__ import annotations

import tomllib
from pathlib import Path

from textual.theme import Theme

THEME_DIR = Path.home() / ".config" / "gary-terminal" / "themes"

BUILTIN: list[dict] = [
    {
        "name": "gary-dark", "dark": True,
        "primary": "#7aa2f7", "secondary": "#bb9af7", "accent": "#7dcfff",
        "foreground": "#c0caf5", "background": "#1a1b26", "surface": "#24283b",
        "panel": "#414868", "success": "#9ece6a", "warning": "#e0af68", "error": "#f7768e",
    },
    {
        "name": "gary-light", "dark": False,
        "primary": "#2e7de9", "secondary": "#9854f1", "accent": "#007197",
        "foreground": "#3760bf", "background": "#e1e2e7", "surface": "#d4d6e4",
        "panel": "#c4c8da", "success": "#587539", "warning": "#8c6c3e", "error": "#f52a65",
    },
    {
        "name": "gary-mono", "dark": True,
        "primary": "#b0b0b0", "secondary": "#808080", "accent": "#d0d0d0",
        "foreground": "#e0e0e0", "background": "#101010", "surface": "#1c1c1c",
        "panel": "#2a2a2a", "success": "#9aa79a", "warning": "#c9b98a", "error": "#d08a8a",
    },
]


def _to_theme(d: dict) -> Theme:
    return Theme(
        name=str(d["name"]),
        dark=bool(d.get("dark", True)),
        primary=d.get("primary", "#7aa2f7"),
        secondary=d.get("secondary"),
        accent=d.get("accent"),
        foreground=d.get("foreground"),
        background=d.get("background"),
        surface=d.get("surface"),
        panel=d.get("panel"),
        success=d.get("success"),
        warning=d.get("warning"),
        error=d.get("error"),
    )


def load_themes() -> list[Theme]:
    themes = [_to_theme(d) for d in BUILTIN]
    if THEME_DIR.is_dir():
        for f in sorted(THEME_DIR.glob("*.toml")):
            try:
                data = tomllib.loads(f.read_text())
            except Exception:
                continue
            data.setdefault("name", f.stem)
            try:
                themes.append(_to_theme(data))
            except Exception:
                continue
    return themes
