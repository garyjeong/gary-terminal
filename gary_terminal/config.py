from __future__ import annotations

import os
import tomllib
from dataclasses import dataclass
from pathlib import Path

CONFIG_PATH = Path.home() / ".config" / "gary-terminal" / "config.toml"

DEFAULT_OLLAMA_HOST = "http://localhost:11434"
DEFAULT_MODEL = "qwen2.5-coder:7b"
DEFAULT_CLAUDE_MODEL = "sonnet"
DEFAULT_CONTEXT_LIMIT = 8000
DEFAULT_BACKEND = "ollama"
DEFAULT_SYSTEM_PROMPT = (
    "You are gary-terminal, a local coding assistant running in the user's "
    "terminal. You work in the current directory. Inspect files with tools "
    "before answering when it helps. Be concise; prefer code over prose. "
    "Reply in Korean."
)


@dataclass
class Config:
    ollama_host: str = DEFAULT_OLLAMA_HOST
    model: str = DEFAULT_MODEL
    claude_model: str = DEFAULT_CLAUDE_MODEL
    context_limit: int = DEFAULT_CONTEXT_LIMIT
    backend: str = DEFAULT_BACKEND
    theme: str | None = None
    auto_escalate: bool = False
    escalate_to: str = "claude"
    subagent_write: bool = False
    embed_model: str = "nomic-embed-text"
    system_prompt: str = DEFAULT_SYSTEM_PROMPT

    @classmethod
    def load(cls) -> "Config":
        data: dict = {}
        if CONFIG_PATH.is_file():
            try:
                data = tomllib.loads(CONFIG_PATH.read_text())
            except Exception:
                data = {}

        def as_bool(x):
            return x if isinstance(x, bool) else str(x).strip().lower() in ("1", "true", "yes", "on")

        def pick(key, default, cast=str):
            env = os.environ.get("GT_" + key.upper())
            if env is not None:
                try:
                    return cast(env)
                except Exception:
                    return default
            if data.get(key) is not None:
                try:
                    return cast(data[key])
                except Exception:
                    return default
            return default

        return cls(
            ollama_host=pick("ollama_host", DEFAULT_OLLAMA_HOST),
            model=pick("model", DEFAULT_MODEL),
            claude_model=pick("claude_model", DEFAULT_CLAUDE_MODEL),
            context_limit=pick("context_limit", DEFAULT_CONTEXT_LIMIT, int),
            backend=pick("backend", DEFAULT_BACKEND),
            theme=pick("theme", None) or None,
            auto_escalate=pick("auto_escalate", False, as_bool),
            escalate_to=pick("escalate_to", "claude"),
            subagent_write=pick("subagent_write", False, as_bool),
            embed_model=pick("embed_model", "nomic-embed-text"),
            system_prompt=pick("system_prompt", DEFAULT_SYSTEM_PROMPT),
        )
