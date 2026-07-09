from __future__ import annotations

import os
from dataclasses import dataclass

DEFAULT_OLLAMA_HOST = "http://localhost:11434"
DEFAULT_MODEL = "qwen2.5-coder:7b"
DEFAULT_SYSTEM_PROMPT = (
    "You are gary-terminal, a local coding assistant running fully offline in "
    "the user's terminal. You work in the current directory. Inspect files with "
    "tools before answering when it helps. Be concise; prefer code over prose. "
    "Reply in Korean."
)


@dataclass
class Config:
    ollama_host: str = DEFAULT_OLLAMA_HOST
    model: str = DEFAULT_MODEL
    system_prompt: str = DEFAULT_SYSTEM_PROMPT

    @classmethod
    def load(cls) -> "Config":
        return cls(
            ollama_host=os.environ.get("GT_OLLAMA_HOST", DEFAULT_OLLAMA_HOST),
            model=os.environ.get("GT_MODEL", DEFAULT_MODEL),
        )
