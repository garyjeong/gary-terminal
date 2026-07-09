"""로컬 코딩 도구 + 툴콜 프로토콜.

작은 로컬 모델은 네이티브 tool_calls를 신뢰성 있게 못 만들어 본문에 JSON을 흘린다.
그래서 프롬프트에 프로토콜을 명시하고 본문 JSON을 강건 추출한다(네이티브도 지원).
도구 레지스트리는 Agent 인스턴스가 소유한다(빌트인 + MCP 동적 등록).
"""
from __future__ import annotations

import asyncio
import difflib
import json
import os
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from pathlib import Path

MAX_OUTPUT = 60_000
SHELL_TIMEOUT = 60.0


@dataclass
class ToolResult:
    ok: bool
    content: str
    summary: str


@dataclass
class Tool:
    name: str
    description: str
    parameters: dict
    requires_approval: bool
    run: Callable[[dict], Awaitable[ToolResult]]
    describe: Callable[[dict], str]
    call_summary: Callable[[dict], str]


def _clip(text: str) -> str:
    return text if len(text) <= MAX_OUTPUT else text[:MAX_OUTPUT] + "\n...(잘림)"


async def _read_file(args: dict) -> ToolResult:
    path = str(args.get("path", ""))
    p = Path(path).expanduser()
    if not p.is_file():
        return ToolResult(False, f"파일 없음: {path}", f"{path} (없음)")
    text = p.read_text(errors="replace")
    return ToolResult(True, _clip(text), f"{path} ({len(text)}B)")


async def _list_dir(args: dict) -> ToolResult:
    path = str(args.get("path", "."))
    p = Path(path).expanduser()
    if not p.is_dir():
        return ToolResult(False, f"디렉토리 아님: {path}", f"{path} (없음)")
    entries = sorted(os.listdir(p))
    lines = [f"{'d' if (p / e).is_dir() else '-'} {e}" for e in entries]
    return ToolResult(True, "\n".join(lines) or "(빈 디렉토리)", f"{path} ({len(entries)}개)")


async def _write_file(args: dict) -> ToolResult:
    path = str(args.get("path", ""))
    content = str(args.get("content", ""))
    if not path:
        return ToolResult(False, "path 누락", "path 누락")
    p = Path(path).expanduser()
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content)
    return ToolResult(True, f"{len(content)}B → {path}", f"{path} ({len(content)}B 저장)")


async def _run_shell(args: dict) -> ToolResult:
    cmd = str(args.get("command", ""))
    if not cmd:
        return ToolResult(False, "command 누락", "command 누락")
    try:
        proc = await asyncio.create_subprocess_shell(
            cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT
        )
        out, _ = await asyncio.wait_for(proc.communicate(), timeout=SHELL_TIMEOUT)
    except asyncio.TimeoutError:
        return ToolResult(False, f"타임아웃 ({SHELL_TIMEOUT:.0f}s)", f"{cmd} (타임아웃)")
    text = _clip(out.decode(errors="replace"))
    return ToolResult(True, f"[exit {proc.returncode}]\n{text}", f"{cmd} (exit {proc.returncode})")


def _describe_write(a: dict) -> str:
    path = str(a.get("path", ""))
    content = str(a.get("content", ""))
    p = Path(path).expanduser()
    if p.is_file():
        try:
            old = p.read_text(errors="replace")
        except Exception:
            old = ""
        diff = "".join(
            difflib.unified_diff(
                old.splitlines(keepends=True),
                content.splitlines(keepends=True),
                fromfile=f"a/{path}", tofile=f"b/{path}",
            )
        )
        return f"파일 수정: {path}\n\n{diff[:1500] or '(변경 없음)'}"
    return f"새 파일: {path}\n\n{content[:1000]}"


def _builtin_tools() -> dict[str, Tool]:
    return {
        "read_file": Tool(
            "read_file", "Read a text file and return its content.",
            {"type": "object", "properties": {"path": {"type": "string"}}, "required": ["path"]},
            False, _read_file, lambda a: f"읽기: {a.get('path')}",
            lambda a: f"read_file({a.get('path')})",
        ),
        "list_dir": Tool(
            "list_dir", "List entries in a directory.",
            {"type": "object", "properties": {"path": {"type": "string"}}, "required": ["path"]},
            False, _list_dir, lambda a: f"목록: {a.get('path', '.')}",
            lambda a: f"list_dir({a.get('path', '.')})",
        ),
        "write_file": Tool(
            "write_file", "Create or overwrite a file with the given content.",
            {"type": "object",
             "properties": {"path": {"type": "string"}, "content": {"type": "string"}},
             "required": ["path", "content"]},
            True, _write_file,
            _describe_write,
            lambda a: f"write_file({a.get('path')})",
        ),
        "run_shell": Tool(
            "run_shell", "Run a shell command in the current directory and return its output.",
            {"type": "object", "properties": {"command": {"type": "string"}}, "required": ["command"]},
            True, _run_shell, lambda a: f"셸 명령:\n\n{a.get('command')}",
            lambda a: f"run_shell({str(a.get('command', ''))[:40]})",
        ),
    }


def new_registry() -> dict[str, Tool]:
    return _builtin_tools()


def make_specs(tools: dict[str, Tool]) -> list[dict]:
    return [
        {"type": "function", "function": {
            "name": t.name, "description": t.description, "parameters": t.parameters}}
        for t in tools.values()
    ]


def make_protocol(tools: dict[str, Tool]) -> str:
    lines = ["사용 가능한 도구:"]
    for t in tools.values():
        keys = ", ".join(t.parameters.get("properties", {}).keys())
        appr = " (승인 필요)" if t.requires_approval else ""
        desc = (t.description or "").strip().splitlines()
        head = desc[0][:100] if desc else ""
        lines.append(f"- {t.name}({keys}): {head}{appr}")
    lines += [
        "",
        "도구를 호출하려면 다른 말 없이 JSON 객체 하나만 출력한다(코드펜스·설명 금지):",
        '{"name": "<도구이름>", "arguments": { ... }}',
        "도구 결과를 받은 뒤 필요하면 또 도구를 호출하거나, 최종 답을 한국어로 작성한다.",
        "도구가 필요 없으면 곧바로 답한다.",
    ]
    return "\n".join(lines)


def _first_json_object(s: str) -> dict | None:
    start = s.find("{")
    while start != -1:
        depth = 0
        in_str = False
        esc = False
        for i in range(start, len(s)):
            c = s[i]
            if in_str:
                if esc:
                    esc = False
                elif c == "\\":
                    esc = True
                elif c == '"':
                    in_str = False
            elif c == '"':
                in_str = True
            elif c == "{":
                depth += 1
            elif c == "}":
                depth -= 1
                if depth == 0:
                    try:
                        obj = json.loads(s[start:i + 1])
                        if isinstance(obj, dict):
                            return obj
                    except Exception:
                        pass
                    break
        start = s.find("{", start + 1)
    return None


def parse_tool_call(text: str, tools: dict[str, Tool]) -> tuple[str, dict] | None:
    obj = _first_json_object(text)
    if obj is None:
        return None
    name = obj.get("name") or obj.get("tool")
    args = obj.get("arguments")
    if args is None:
        args = obj.get("args", {})
    if isinstance(args, str):
        try:
            args = json.loads(args)
        except Exception:
            args = {}
    if isinstance(name, str) and name in tools and isinstance(args, dict):
        return name, args
    return None
