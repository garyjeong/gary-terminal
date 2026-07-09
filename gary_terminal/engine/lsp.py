"""최소 LSP 클라이언트 — 언어 서버와 JSON-RPC(stdio)로 대화.

파이썬 우선(pyright-langserver / pylsp / jedi-language-server 자동 감지).
정의·참조·진단을 도구로 노출하기 위한 경량 클라이언트(상주 세션, 지연 시작).
"""
from __future__ import annotations

import asyncio
import json
import os
import re
import shutil
from pathlib import Path

_PY_SERVERS = [
    (["pyright-langserver", "--stdio"], "pyright-langserver"),
    (["basedpyright-langserver", "--stdio"], "basedpyright-langserver"),
    (["pylsp"], "pylsp"),
    (["jedi-language-server"], "jedi-language-server"),
]


class LspError(RuntimeError):
    pass


def detect_python_server() -> list[str] | None:
    for cmd, binname in _PY_SERVERS:
        if shutil.which(binname):
            return cmd
    return None


def _uri(path) -> str:
    return "file://" + str(Path(path).resolve())


def find_symbol_pos(file: str, name: str) -> tuple[int, int] | None:
    """파일에서 식별자 name의 첫 등장 위치(0-based line, col)."""
    try:
        text = Path(file).read_text(errors="replace")
    except OSError:
        return None
    pat = re.compile(r"\b" + re.escape(name) + r"\b")
    for i, ln in enumerate(text.splitlines()):
        m = pat.search(ln)
        if m:
            return i, m.start()
    return None


def _as_locations(res) -> list[dict]:
    if res is None:
        return []
    if isinstance(res, dict):
        res = [res]
    out = []
    for it in res:
        uri = it.get("uri") or it.get("targetUri", "")
        rng = it.get("range") or it.get("targetSelectionRange") or it.get("targetRange") or {}
        start = rng.get("start", {})
        out.append({
            "file": uri.replace("file://", ""),
            "line": start.get("line", 0) + 1,
            "col": start.get("character", 0),
        })
    return out


class LspClient:
    def __init__(self, cmd: list[str], root: Path) -> None:
        self._cmd = cmd
        self._root = Path(root)
        self._proc: asyncio.subprocess.Process | None = None
        self._id = 0
        self._pending: dict[int, asyncio.Future] = {}
        self._diags: dict[str, list] = {}
        self._open: set[str] = set()
        self._started = False
        self._lock = asyncio.Lock()

    async def start(self) -> None:
        async with self._lock:
            if self._started:
                return
            self._proc = await asyncio.create_subprocess_exec(
                *self._cmd,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.DEVNULL,
            )
            asyncio.create_task(self._read_loop())
            await self._request("initialize", {
                "processId": os.getpid(),
                "rootUri": _uri(self._root),
                "capabilities": {
                    "textDocument": {
                        "synchronization": {"didSave": True},
                        "publishDiagnostics": {},
                        "definition": {"linkSupport": False},
                        "references": {},
                        "documentSymbol": {"hierarchicalDocumentSymbolSupport": True},
                        "hover": {},
                    },
                    "workspace": {"symbol": {}},
                },
            })
            await self._notify("initialized", {})
            self._started = True

    async def _send(self, obj: dict) -> None:
        assert self._proc and self._proc.stdin
        data = json.dumps(obj).encode()
        self._proc.stdin.write(f"Content-Length: {len(data)}\r\n\r\n".encode() + data)
        await self._proc.stdin.drain()

    async def _request(self, method: str, params: dict, timeout: float = 20.0):
        self._id += 1
        rid = self._id
        fut: asyncio.Future = asyncio.get_event_loop().create_future()
        self._pending[rid] = fut
        await self._send({"jsonrpc": "2.0", "id": rid, "method": method, "params": params})
        try:
            return await asyncio.wait_for(fut, timeout=timeout)
        except asyncio.TimeoutError:
            self._pending.pop(rid, None)
            raise LspError(f"LSP 응답 시간초과: {method}") from None

    async def _notify(self, method: str, params: dict) -> None:
        await self._send({"jsonrpc": "2.0", "method": method, "params": params})

    async def _read_loop(self) -> None:
        assert self._proc and self._proc.stdout
        out = self._proc.stdout
        try:
            while True:
                headers: dict[bytes, bytes] = {}
                while True:
                    line = await out.readline()
                    if not line:
                        return
                    line = line.rstrip(b"\r\n")
                    if not line:
                        break
                    if b":" in line:
                        k, v = line.split(b":", 1)
                        headers[k.strip().lower()] = v.strip()
                length = int(headers.get(b"content-length", b"0"))
                if length <= 0:
                    continue
                body = await out.readexactly(length)
                await self._dispatch(json.loads(body))
        except Exception:
            return

    async def _dispatch(self, msg: dict) -> None:
        if "id" in msg and ("result" in msg or "error" in msg):
            fut = self._pending.pop(msg["id"], None)
            if fut and not fut.done():
                fut.set_result(msg.get("result"))
        elif "id" in msg and "method" in msg:
            await self._send({"jsonrpc": "2.0", "id": msg["id"], "result": None})
        elif msg.get("method") == "textDocument/publishDiagnostics":
            p = msg.get("params", {})
            self._diags[p.get("uri", "")] = p.get("diagnostics", [])

    async def open(self, file: str) -> str:
        uri = _uri(file)
        if uri not in self._open:
            text = Path(file).read_text(errors="replace")
            lang = "python" if file.endswith(".py") else "plaintext"
            await self._notify("textDocument/didOpen", {"textDocument": {
                "uri": uri, "languageId": lang, "version": 1, "text": text}})
            self._open.add(uri)
        return uri

    async def definition(self, file: str, line: int, col: int) -> list[dict]:
        uri = await self.open(file)
        res = await self._request("textDocument/definition", {
            "textDocument": {"uri": uri}, "position": {"line": line, "character": col}})
        return _as_locations(res)

    async def references(self, file: str, line: int, col: int) -> list[dict]:
        uri = await self.open(file)
        res = await self._request("textDocument/references", {
            "textDocument": {"uri": uri}, "position": {"line": line, "character": col},
            "context": {"includeDeclaration": True}})
        return _as_locations(res)

    async def diagnostics(self, file: str, wait: float = 2.5) -> list[dict]:
        uri = await self.open(file)
        for _ in range(int(wait / 0.1)):
            if uri in self._diags:
                break
            await asyncio.sleep(0.1)
        return self._diags.get(uri, [])

    async def shutdown(self) -> None:
        if self._proc and self._proc.returncode is None:
            try:
                self._proc.terminate()
                await asyncio.wait_for(self._proc.wait(), timeout=2.0)
            except (ProcessLookupError, asyncio.TimeoutError):
                pass
