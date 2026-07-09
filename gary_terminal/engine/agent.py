from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator, Awaitable, Callable

from pathlib import Path

from ..config import Config
from .backend import ClaudeCliBackend, OllamaBackend
from .context import estimate_tokens, expand_mentions, load_project_context
from .events import (
    AttachmentEvent,
    CompactEvent,
    EngineError,
    EscalateEvent,
    Event,
    MessageDone,
    PlanEvent,
    SubagentEvent,
    TokenEvent,
    ToolCallEvent,
    ToolResultEvent,
)
from .mcp_client import build_mcp_tools
from .lsp import LspClient, detect_python_server, find_symbol_pos
from .rag import RagIndex
from .ollama_client import OllamaClient, OllamaError
from .tools import Tool, ToolResult, make_protocol, make_specs, new_registry, parse_tool_call
from .usage import UsageTracker

MAX_STEPS = 8
KEEP_RECENT = 4
MAX_SUBAGENTS = 5
Approver = Callable[[str, str], Awaitable[bool]]


class Agent:
    """대화 상태 + 툴콜 루프. 백엔드(로컬/구독) 무관.

    - auto_escalate: 로컬 백엔드 실패 시 상위 백엔드로 자동 재시도
    - spawn_agents: 병렬 서브에이전트(읽기 전용 도구)
    - update_plan: 계획/TODO 추적
    """

    def __init__(
        self,
        config: Config,
        approver: Approver | None = None,
        allow_meta_tools: bool = True,
    ) -> None:
        self.config = config
        self._backends: dict[str, object] = {
            "ollama": OllamaBackend(config.ollama_host, config.model),
            "claude": ClaudeCliBackend(config.claude_model),
        }
        self._backend = self._backends.get(config.backend, self._backends["ollama"])
        self._history: list[dict] = []
        self._approver = approver
        self._project = load_project_context()
        self.usage = UsageTracker()
        self.plan: list[dict] = []
        self._spawn_result: str = ""
        self._embed_client = OllamaClient(config.ollama_host)
        self._rag: RagIndex | None = None
        self._lsp: LspClient | None = None
        self._tools = new_registry()
        if allow_meta_tools:
            self._tools["spawn_agents"] = self._make_spawn_tool()
            self._tools["update_plan"] = self._make_plan_tool()
            self._tools["codebase_search"] = self._make_search_tool()
            self._tools["lsp_definition"] = self._make_lsp_tool("definition")
            self._tools["lsp_references"] = self._make_lsp_tool("references")
            self._rag = RagIndex(Path.cwd(), self._embed_texts)
        self._rebuild()

    def _rebuild(self) -> None:
        self._specs = make_specs(self._tools)
        self._protocol = make_protocol(self._tools)

    # --- 백엔드/모델 ---
    @property
    def backend_name(self) -> str:
        return self._backend.name

    @property
    def model(self) -> str:
        return self._backend.model()

    def set_model(self, name: str) -> None:
        self._backend.set_model(name)

    def switch_backend(self, name: str) -> bool:
        if name in self._backends:
            self._backend = self._backends[name]
            return True
        return False

    async def list_models(self) -> list[str]:
        return await self._backend.list_models()

    # --- 상태 ---
    @property
    def project_name(self) -> str | None:
        return self._project[0] if self._project else None

    def reset(self) -> None:
        self._history.clear()
        self.plan.clear()

    def export_history(self) -> list[dict]:
        return list(self._history)

    def import_history(self, messages: list[dict]) -> None:
        self._history = [dict(m) for m in messages]

    def reload_context(self) -> str | None:
        self._project = load_project_context()
        return self.project_name

    def context_tokens(self) -> int:
        return estimate_tokens(self._messages())

    async def load_mcp(self) -> list[tuple[str, int, str | None]]:
        tools, summary = await build_mcp_tools()
        for t in tools:
            self._tools[t.name] = t
        self._rebuild()
        return summary

    def _messages(self) -> list[dict]:
        system = self.config.system_prompt + "\n\n" + self._protocol
        if self._project:
            name, content = self._project
            system += f"\n\n프로젝트 컨텍스트 ({name}):\n{content}"
        return [{"role": "system", "content": system}, *self._history]

    # --- 계획/TODO ---
    def render_plan(self) -> str:
        if not self.plan:
            return "📋 (계획 없음)"
        icons = {"pending": "☐", "in_progress": "▶", "done": "☑", "completed": "☑"}
        rows = "\n".join(f"  {icons.get(t.get('status'), '☐')} {t.get('content', '')}" for t in self.plan)
        return "📋 계획\n" + rows

    def _make_plan_tool(self) -> Tool:
        async def run(args: dict) -> ToolResult:
            items = args.get("tasks") or args.get("todos") or args.get("plan") or []
            plan: list[dict] = []
            for it in items:
                if isinstance(it, dict):
                    plan.append({
                        "content": str(it.get("content") or it.get("task") or ""),
                        "status": str(it.get("status", "pending")),
                    })
                elif isinstance(it, str):
                    plan.append({"content": it, "status": "pending"})
            self.plan = plan
            return ToolResult(True, self.render_plan(), f"계획 {len(plan)}개")

        return Tool(
            "update_plan",
            "Record or update the task plan/todo list. Each item: {content, status: pending|in_progress|done}.",
            {"type": "object", "properties": {"tasks": {"type": "array", "items": {
                "type": "object", "properties": {
                    "content": {"type": "string"}, "status": {"type": "string"}}}}},
             "required": ["tasks"]},
            False, run, lambda a: "계획 갱신", lambda a: "update_plan()",
        )

    # --- 의미기반 코드 검색(RAG) ---
    async def _embed_texts(self, texts: list[str]) -> list[list[float]]:
        return await self._embed_client.embed(self.config.embed_model, texts)

    async def build_index(self, progress=None) -> dict:
        if self._rag is None:
            self._rag = RagIndex(Path.cwd(), self._embed_texts)
        return await self._rag.build(progress)

    def _make_search_tool(self) -> Tool:
        async def run(args: dict) -> ToolResult:
            if self._rag is None or self._rag.count == 0:
                return ToolResult(False, "코드 색인이 없습니다. /index 로 먼저 색인하세요.", "색인 없음")
            query = str(args.get("query", ""))
            if not query:
                return ToolResult(False, "query 누락", "query 누락")
            try:
                k = int(args.get("k", 8) or 8)
            except (TypeError, ValueError):
                k = 8
            try:
                hits = await self._rag.search(query, k)
            except Exception as exc:  # noqa: BLE001
                return ToolResult(False, f"검색 실패: {exc}", "검색 실패")
            if not hits:
                return ToolResult(True, "(관련 코드 없음)", f"{query} (0건)")
            body = "\n\n".join(
                f"# {h['file']}:{h['start']}-{h['end']} (score {h['score']:.2f})\n{h['text']}"
                for h in hits
            )
            return ToolResult(True, body[:60000], f"{query} ({len(hits)}건)")

        return Tool(
            "codebase_search",
            "Semantic (meaning-based) search over the indexed codebase. Run /index first.",
            {"type": "object",
             "properties": {"query": {"type": "string"}, "k": {"type": "integer"}},
             "required": ["query"]},
            False, run,
            lambda a: f"의미검색: {a.get('query')}",
            lambda a: f"codebase_search({str(a.get('query', ''))[:30]})",
        )

    # --- LSP(정의/참조) ---
    async def _ensure_lsp(self) -> LspClient | None:
        if self._lsp is None:
            cmd = detect_python_server()
            if cmd is None:
                return None
            self._lsp = LspClient(cmd, Path.cwd())
        try:
            await self._lsp.start()
        except Exception:  # noqa: BLE001
            return None
        return self._lsp

    def _make_lsp_tool(self, kind: str) -> Tool:
        async def run(args: dict) -> ToolResult:
            file = str(args.get("file", ""))
            name = str(args.get("name", ""))
            if not file or not name:
                return ToolResult(False, "file/name 누락", "인자 누락")
            if not file.endswith(".py"):
                return ToolResult(False, "현재 파이썬(.py)만 지원합니다.", "미지원")
            if not Path(file).is_file():
                return ToolResult(False, f"파일 없음: {file}", "없음")
            cli = await self._ensure_lsp()
            if cli is None:
                return ToolResult(
                    False,
                    "파이썬 언어 서버가 없습니다. `pip install python-lsp-server` 또는 pyright 설치.",
                    "서버 없음",
                )
            pos = find_symbol_pos(file, name)
            if pos is None:
                return ToolResult(False, f"'{name}' 위치를 찾지 못했습니다.", "위치 없음")
            line, col = pos
            try:
                if kind == "definition":
                    locs = await cli.definition(file, line, col)
                else:
                    locs = await cli.references(file, line, col)
            except Exception as exc:  # noqa: BLE001
                return ToolResult(False, f"LSP 오류: {exc}", "오류")
            if not locs:
                return ToolResult(True, "(결과 없음)", f"{name} (0건)")
            body = "\n".join(f"{loc['file']}:{loc['line']}" for loc in locs)
            return ToolResult(True, body, f"{name} ({len(locs)}건)")

        desc = (
            "Find where a symbol is defined (LSP, precise)."
            if kind == "definition"
            else "Find all references to a symbol (LSP, precise)."
        )
        return Tool(
            f"lsp_{kind}", desc,
            {"type": "object",
             "properties": {"file": {"type": "string"}, "name": {"type": "string"}},
             "required": ["file", "name"]},
            False, run,
            lambda a, _k=kind: f"lsp {_k}: {a.get('name')}",
            lambda a, _k=kind: f"lsp_{_k}({a.get('name')})",
        )

    # --- 서브에이전트(병렬) ---
    def _make_spawn_tool(self) -> Tool:
        async def run(args: dict) -> ToolResult:
            tasks = args.get("tasks") or []
            if isinstance(tasks, str):
                tasks = [tasks]
            tasks = [str(t) for t in tasks if str(t).strip()][:MAX_SUBAGENTS]
            if not tasks:
                return ToolResult(False, "tasks 누락", "tasks 누락")
            results = await asyncio.gather(*[self._run_subagent(t) for t in tasks])
            body = "\n\n".join(
                f"[서브에이전트 {i + 1}] {t}\n{r}" for i, (t, r) in enumerate(zip(tasks, results))
            )
            return ToolResult(True, body, f"서브에이전트 {len(tasks)}개")

        return Tool(
            "spawn_agents",
            "Run several independent sub-tasks in parallel sub-agents (read-only tools). "
            "Use for research/exploration that can be split up.",
            {"type": "object",
             "properties": {"tasks": {"type": "array", "items": {"type": "string"}}},
             "required": ["tasks"]},
            False, run,
            lambda a: f"병렬 서브에이전트 {len(a.get('tasks', []))}개",
            lambda a: f"spawn_agents({len(a.get('tasks', []))})",
        )

    def _subagent_approver(self) -> Approver | None:
        return self._approver if self.config.subagent_write else None

    async def _run_indexed(self, i: int, task: str) -> tuple[int, str]:
        return i, await self._run_subagent(task)

    async def _spawn_stream(self, args: dict) -> AsyncIterator[Event]:
        tasks = args.get("tasks") or []
        if isinstance(tasks, str):
            tasks = [tasks]
        tasks = [str(t) for t in tasks if str(t).strip()][:MAX_SUBAGENTS]
        if not tasks:
            self._spawn_result = "tasks 누락"
            return
        results = [""] * len(tasks)
        for i, t in enumerate(tasks):
            yield SubagentEvent(i + 1, len(tasks), t, "start", "")
        pending = [asyncio.create_task(self._run_indexed(i, t)) for i, t in enumerate(tasks)]
        for fut in asyncio.as_completed(pending):
            i, r = await fut
            results[i] = r
            status = "error" if r.startswith(("(오류", "(예외")) else "done"
            yield SubagentEvent(i + 1, len(tasks), tasks[i], status, r[:80].replace("\n", " "))
        self._spawn_result = "\n\n".join(
            f"[서브에이전트 {i + 1}] {t}\n{results[i]}" for i, t in enumerate(tasks)
        )

    async def _run_subagent(self, task: str) -> str:
        sub = Agent(self.config, approver=self._subagent_approver(), allow_meta_tools=False)
        text = ""
        try:
            async for ev in sub.send(task):
                if isinstance(ev, TokenEvent):
                    text += ev.text
                elif isinstance(ev, MessageDone):
                    text = ev.content
                elif isinstance(ev, EngineError):
                    return f"(오류: {ev.message})"
        except Exception as exc:  # noqa: BLE001
            return f"(예외: {exc})"
        return text.strip()[:4000] or "(빈 응답)"

    # --- 컨텍스트 압축 ---
    async def compact(self, force: bool = False) -> CompactEvent | None:
        if len(self._history) <= KEEP_RECENT + 1:
            return None
        if not force and estimate_tokens(self._history) < self.config.context_limit:
            return None
        old = self._history[:-KEEP_RECENT]
        recent = self._history[-KEEP_RECENT:]
        summary = await self._summarize(old)
        self._history = [
            {"role": "user", "content": f"[이전 대화 요약]\n{summary}"},
            {"role": "assistant", "content": "요약 확인했습니다. 이어서 진행하겠습니다."},
            *recent,
        ]
        return CompactEvent(removed=len(old), summary_chars=len(summary))

    async def _summarize(self, msgs: list[dict]) -> str:
        convo = "\n".join(f"{m.get('role')}: {str(m.get('content', ''))[:1500]}" for m in msgs)
        prompt = [{
            "role": "user",
            "content": (
                "다음 대화를 이후 맥락 유지에 꼭 필요한 핵심만 한국어로 간결히 요약해줘. "
                "결정사항·다룬 파일·미해결 항목 위주로:\n\n" + convo
            ),
        }]
        text = ""
        try:
            async for ch in self._backend.stream_turn(prompt, []):
                if ch.text:
                    text += ch.text
        except Exception:  # noqa: BLE001
            return "(요약 실패 — 이전 대화 일부 생략)"
        return text.strip() or "(요약 없음)"

    @staticmethod
    def _decide_candidate(stripped: str) -> bool | None:
        if not stripped:
            return None
        if stripped[0] == "{":
            return True
        if stripped.startswith("```"):
            if "\n" not in stripped:
                return None
            lang = stripped[3 : stripped.index("\n")].strip().lower()
            return lang == "json"
        return False

    # --- 실행 ---
    def _can_escalate(self) -> bool:
        return (
            self.config.auto_escalate
            and self.config.escalate_to in self._backends
            and self._backend.name != self.config.escalate_to
        )

    def _trim_to_last_user(self) -> None:
        for i in range(len(self._history) - 1, -1, -1):
            if self._history[i].get("role") == "user":
                del self._history[i + 1:]
                return

    async def send(self, user_text: str) -> AsyncIterator[Event]:
        expanded, attached, missing = expand_mentions(user_text)
        if attached or missing:
            yield AttachmentEvent(attached, missing)
        self._history.append({"role": "user", "content": expanded})
        compact = await self.compact()
        if compact is not None:
            yield compact

        escalated = False
        async for ev in self._run_loop():
            if isinstance(ev, EngineError) and not escalated and self._can_escalate():
                escalated = True
                target = self.config.escalate_to
                yield EscalateEvent(self._backend.name, target)
                self._trim_to_last_user()
                saved = self._backend
                self._backend = self._backends[target]
                try:
                    async for ev2 in self._run_loop():
                        yield ev2
                finally:
                    self._backend = saved
                return
            yield ev

    async def _run_loop(self) -> AsyncIterator[Event]:
        for _ in range(MAX_STEPS):
            buffer = ""
            candidate: bool | None = None
            native: list[dict] = []
            step_usage = None
            try:
                async for chunk in self._backend.stream_turn(self._messages(), self._specs):
                    if chunk.text:
                        buffer += chunk.text
                        if candidate is None:
                            candidate = self._decide_candidate(buffer.lstrip())
                            if candidate is False:
                                yield TokenEvent(buffer)
                        elif candidate is False:
                            yield TokenEvent(chunk.text)
                    if chunk.tool_calls:
                        native.extend(chunk.tool_calls)
                    if chunk.usage:
                        step_usage = chunk.usage
                    if chunk.done:
                        break
            except OllamaError as exc:
                yield EngineError(str(exc))
                return
            self.usage.add(step_usage)

            if candidate is None and not native and buffer:
                yield TokenEvent(buffer)
                candidate = False

            calls = self._collect_calls(native, candidate, buffer)

            if not calls:
                if candidate and not native:
                    yield TokenEvent(buffer)
                self._history.append({"role": "assistant", "content": buffer})
                yield MessageDone(buffer)
                return

            self._history.append({"role": "assistant", "content": buffer})
            for name, args in calls:
                tool = self._tools.get(name)
                summary = tool.call_summary(args) if tool else name
                yield ToolCallEvent(name, summary)
                if name == "spawn_agents":
                    self._spawn_result = ""
                    async for sev in self._spawn_stream(args):
                        yield sev
                    yield ToolResultEvent(name, True, "서브에이전트 완료")
                    self._history.append(
                        {"role": "tool", "content": self._spawn_result, "tool_name": name}
                    )
                    continue
                result = await self._exec(name, args)
                yield ToolResultEvent(name, result.ok, result.summary)
                self._history.append(
                    {"role": "tool", "content": result.content, "tool_name": name}
                )
                if name == "update_plan":
                    yield PlanEvent(list(self.plan))
        yield EngineError(f"최대 도구 단계({MAX_STEPS}) 초과")

    def _collect_calls(
        self, native: list[dict], candidate: bool | None, buffer: str
    ) -> list[tuple[str, dict]]:
        calls: list[tuple[str, dict]] = []
        if native:
            for tc in native:
                fn = tc.get("function", {})
                name = fn.get("name", "")
                args = fn.get("arguments", {}) or {}
                if isinstance(args, str):
                    try:
                        args = json.loads(args)
                    except Exception:
                        args = {}
                if name:
                    calls.append((name, args))
        elif candidate:
            parsed = parse_tool_call(buffer, self._tools)
            if parsed:
                calls.append(parsed)
        return calls

    async def _exec(self, name: str, args: dict) -> ToolResult:
        tool = self._tools.get(name)
        if tool is None:
            return ToolResult(False, f"unknown tool: {name}", f"알 수 없는 도구: {name}")
        if tool.requires_approval:
            approved = False
            if self._approver is not None:
                approved = await self._approver(name, tool.describe(args))
            if not approved:
                return ToolResult(False, "denied by user", "거부됨")
        try:
            return await tool.run(args)
        except Exception as exc:  # noqa: BLE001
            return ToolResult(False, f"error: {exc}", f"오류: {exc}")
