"""MCP(Model Context Protocol) 클라이언트 — 외부 도구를 도구 레지스트리에 등록.

연결은 호출 단위(connect-per-call)로 열고 닫아 앱 수명주기와 분리한다.
설정: ~/.config/gary-terminal/mcp.json
  {"servers": [{"name": "obsidian", "url": "http://127.0.0.1:27200/mcp",
                "headers": {"Authorization": "Bearer ..."},
                "tools": ["get_vault_file", ...]}]}   # tools 는 선택(allowlist)
"""
from __future__ import annotations

import json
from pathlib import Path

from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client

from .tools import Tool, ToolResult

CONFIG_PATH = Path.home() / ".config" / "gary-terminal" / "mcp.json"


def load_mcp_config() -> list[dict]:
    if not CONFIG_PATH.is_file():
        return []
    try:
        data = json.loads(CONFIG_PATH.read_text())
    except Exception:
        return []
    return data.get("servers", []) or []


def _content_text(content) -> str:
    parts: list[str] = []
    for c in content or []:
        t = getattr(c, "text", None)
        parts.append(t if t is not None else str(getattr(c, "data", c)))
    return "\n".join(parts) if parts else "(빈 결과)"


class MCPServer:
    def __init__(self, name: str, url: str, headers: dict | None = None) -> None:
        self.name = name
        self.url = url
        self.headers = headers or {}

    async def list_tools(self):
        async with streamablehttp_client(self.url, headers=self.headers) as (r, w, _):
            async with ClientSession(r, w) as s:
                await s.initialize()
                return (await s.list_tools()).tools

    async def call_tool(self, name: str, args: dict) -> tuple[str, bool]:
        async with streamablehttp_client(self.url, headers=self.headers) as (r, w, _):
            async with ClientSession(r, w) as s:
                await s.initialize()
                res = await s.call_tool(name, args)
                return _content_text(res.content), bool(getattr(res, "isError", False))


def _make_tool(server: MCPServer, ti) -> Tool:
    name = f"{server.name}_{ti.name}"
    ann = getattr(ti, "annotations", None)
    read_only = bool(getattr(ann, "readOnlyHint", False)) if ann else False
    params = getattr(ti, "inputSchema", None) or {"type": "object", "properties": {}}
    desc = getattr(ti, "description", "") or ""

    async def run(args: dict, _s=server, _n=ti.name, _nm=name) -> ToolResult:
        text, err = await _s.call_tool(_n, args)
        return ToolResult(not err, _clip(text), _nm)

    def describe(a: dict, _s=server, _n=ti.name) -> str:
        return f"{_s.name} MCP · {_n}\n{json.dumps(a, ensure_ascii=False)[:600]}"

    return Tool(name, desc, params, not read_only, run, describe, lambda a, _nm=name: _nm)


def _clip(text: str) -> str:
    return text if len(text) <= 60_000 else text[:60_000] + "\n...(잘림)"


async def build_mcp_tools() -> tuple[list[Tool], list[tuple[str, int, str | None]]]:
    tools: list[Tool] = []
    summary: list[tuple[str, int, str | None]] = []
    for sc in load_mcp_config():
        srv = MCPServer(sc.get("name", "mcp"), sc.get("url", ""), sc.get("headers", {}))
        allow = set(sc.get("tools") or [])
        try:
            infos = await srv.list_tools()
        except Exception as exc:  # noqa: BLE001
            summary.append((srv.name, 0, str(exc)[:80]))
            continue
        n = 0
        for ti in infos:
            if allow and ti.name not in allow:
                continue
            tools.append(_make_tool(srv, ti))
            n += 1
        summary.append((srv.name, n, None))
    return tools, summary
