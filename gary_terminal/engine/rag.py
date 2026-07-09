"""의미기반 코드 검색(RAG) — Ollama 임베딩 + numpy 브루트포스 인덱스.

- 청킹: 라인 윈도우(겹침). 코드 확장자만, 무시 디렉토리 제외
- 인덱스: 파일 해시 매니페스트로 증분 재색인. cwd별 캐시(~/.cache/gary-terminal/index/<hash>)
- 검색: 질의 임베딩 → 코사인 유사도 top-k
"""
from __future__ import annotations

import hashlib
import json
from collections.abc import Awaitable, Callable
from pathlib import Path

import numpy as np

CACHE_ROOT = Path.home() / ".cache" / "gary-terminal" / "index"
CHUNK_LINES = 60
OVERLAP = 15
MAX_FILE_BYTES = 200_000
CODE_EXT = {
    ".py", ".js", ".ts", ".tsx", ".jsx", ".go", ".rs", ".java", ".kt", ".rb",
    ".php", ".c", ".h", ".cpp", ".hpp", ".cs", ".swift", ".scala", ".sh",
    ".sql", ".toml", ".yaml", ".yml", ".json", ".md", ".txt", ".css", ".html",
    ".vue", ".svelte",
}
IGNORE_DIRS = {
    ".git", "node_modules", ".venv", "venv", "__pycache__", "dist", "build",
    ".next", ".cache", "target", ".gary-terminal", ".mypy_cache", ".ruff_cache",
}

EmbedFn = Callable[[list[str]], Awaitable[list[list[float]]]]


def _cwd_key(cwd: Path) -> str:
    return hashlib.sha1(str(cwd.resolve()).encode()).hexdigest()[:16]


def _iter_files(root: Path):
    for p in root.rglob("*"):
        if not p.is_file():
            continue
        if any(part in IGNORE_DIRS for part in p.parts):
            continue
        if p.suffix.lower() not in CODE_EXT:
            continue
        try:
            if p.stat().st_size > MAX_FILE_BYTES:
                continue
        except OSError:
            continue
        yield p


def _chunks(text: str):
    lines = text.splitlines()
    if not lines:
        return
    n = len(lines)
    step = max(1, CHUNK_LINES - OVERLAP)
    i = 0
    while i < n:
        seg = lines[i : i + CHUNK_LINES]
        yield i + 1, i + len(seg), "\n".join(seg)
        if i + CHUNK_LINES >= n:
            break
        i += step


def _normalize(a: np.ndarray) -> np.ndarray:
    norm = np.linalg.norm(a, axis=1, keepdims=True)
    norm[norm == 0] = 1.0
    return a / norm


class RagIndex:
    def __init__(self, cwd: Path, embed: EmbedFn, cache_root: Path | None = None) -> None:
        self._cwd = Path(cwd)
        self._embed = embed
        self._dir = (cache_root or CACHE_ROOT) / _cwd_key(self._cwd)
        self._meta: list[dict] = []
        self._vecs: np.ndarray | None = None
        self._manifest: dict[str, str] = {}
        self._load()

    @property
    def count(self) -> int:
        return len(self._meta)

    def _load(self) -> None:
        try:
            self._meta = json.loads((self._dir / "meta.json").read_text())
            self._manifest = json.loads((self._dir / "manifest.json").read_text())
            self._vecs = np.load(self._dir / "vecs.npy")
        except Exception:
            self._meta, self._manifest, self._vecs = [], {}, None

    def _save(self) -> None:
        self._dir.mkdir(parents=True, exist_ok=True)
        (self._dir / "meta.json").write_text(json.dumps(self._meta, ensure_ascii=False))
        (self._dir / "manifest.json").write_text(json.dumps(self._manifest))
        vecs = self._vecs if self._vecs is not None else np.zeros((0, 1), dtype="float32")
        np.save(self._dir / "vecs.npy", vecs)

    async def build(self, progress: Callable[[int, int], None] | None = None) -> dict:
        files = list(_iter_files(self._cwd))
        cur_hashes: dict[str, str] = {}
        keep_idx: list[int] = []
        changed: list[tuple[Path, str]] = []
        for p in files:
            rel = str(p.relative_to(self._cwd))
            try:
                h = hashlib.sha1(p.read_bytes()).hexdigest()
            except OSError:
                continue
            cur_hashes[rel] = h
            if self._manifest.get(rel) == h:
                keep_idx.extend(i for i, m in enumerate(self._meta) if m["file"] == rel)
            else:
                changed.append((p, rel))

        kept_meta = [self._meta[i] for i in keep_idx]
        kept_vecs = (
            self._vecs[keep_idx] if (self._vecs is not None and keep_idx) else None
        )

        new_meta: list[dict] = []
        new_texts: list[str] = []
        for p, rel in changed:
            try:
                text = p.read_text(errors="replace")
            except OSError:
                continue
            for a, b, seg in _chunks(text):
                if seg.strip():
                    new_meta.append({"file": rel, "start": a, "end": b, "text": seg})
                    new_texts.append(f"{rel}:{a}\n{seg}")

        new_vecs = None
        if new_texts:
            embs = await self._embed_batched(new_texts, progress)
            new_vecs = _normalize(np.array(embs, dtype="float32"))

        parts = [v for v in (kept_vecs, new_vecs) if v is not None and len(v)]
        self._vecs = np.vstack(parts) if parts else None
        self._meta = kept_meta + new_meta
        self._manifest = cur_hashes
        self._save()
        return {"files": len(files), "chunks": len(self._meta), "changed": len(changed)}

    async def _embed_batched(self, texts: list[str], progress) -> list[list[float]]:
        out: list[list[float]] = []
        batch = 64
        for i in range(0, len(texts), batch):
            out.extend(await self._embed(texts[i : i + batch]))
            if progress:
                progress(min(i + batch, len(texts)), len(texts))
        return out

    async def search(self, query: str, k: int = 8) -> list[dict]:
        if self._vecs is None or not self._meta:
            return []
        q = await self._embed([query])
        qv = _normalize(np.array(q, dtype="float32"))[0]
        sims = self._vecs @ qv
        order = np.argsort(-sims)[:k]
        return [{**self._meta[i], "score": float(sims[i])} for i in order]
