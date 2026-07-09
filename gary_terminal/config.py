from __future__ import annotations

import os
from dataclasses import dataclass

DEFAULT_OLLAMA_HOST = "http://localhost:11434"
DEFAULT_MODEL = "qwen2.5-coder:7b"
DEFAULT_CLAUDE_MODEL = "sonnet"
DEFAULT_CONTEXT_LIMIT = 8000
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
    system_prompt: str = DEFAULT_SYSTEM_PROMPT

    @classmethod
    def load(cls) -> "Config":
        try:
            climit = int(os.environ.get("GT_CONTEXT_LIMIT", DEFAULT_CONTEXT_LIMIT))
        except ValueError:
            climit = DEFAULT_CONTEXT_LIMIT
        return cls(
            ollama_host=os.environ.get("GT_OLLAMA_HOST", DEFAULT_OLLAMA_HOST),
            model=os.environ.get("GT_MODEL", DEFAULT_MODEL),
            claude_model=os.environ.get("GT_CLAUDE_MODEL", DEFAULT_CLAUDE_MODEL),
            context_limit=climit,
        )
