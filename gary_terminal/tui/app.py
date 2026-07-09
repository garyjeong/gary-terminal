from __future__ import annotations

import time
from pathlib import Path

from rich.markdown import Markdown as RichMarkdown
from rich.markup import escape
from rich.text import Text
from textual import events, work
from textual.app import App, ComposeResult
from textual.containers import Horizontal, Vertical, VerticalScroll
from textual.screen import ModalScreen
from textual.widgets import Button, Footer, Header, Input, Label, Static, TextArea

from ..config import Config
from ..engine import (
    Agent,
    AttachmentEvent,
    CompactEvent,
    EngineError,
    MessageDone,
    TokenEvent,
    ToolCallEvent,
    ToolResultEvent,
)
from ..engine.session import SessionInfo, SessionStore
from .completion import compute_completions, list_suggestions

HELP_TEXT = """[b]명령어[/b]
  /help            이 도움말
  /models          현재 백엔드의 모델 목록
  /model           현재 백엔드·모델 표시
  /model ollama [모델]   로컬(Ollama)로 전환
  /model claude [모델]   구독 Claude(CLI)로 전환 (sonnet/opus/haiku)
  /model <이름>    현재 백엔드의 모델 변경
  /usage           이번 세션 사용량(토큰/비용)
  /compact         대화 컨텍스트 강제 요약·압축
  /reload          프로젝트 컨텍스트(AGENTS.md) 재로드
  /save · /sessions · /resume <번호>   세션 저장/목록/재개
  /clear           대화 초기화 (새 세션)
  /quit            종료
[b]도구[/b] read_file · list_dir (자동) · write_file · run_shell · MCP (승인)
[b]첨부[/b] @경로/파일   [b]Tab[/b] 자동완성
[dim]그 외 입력은 모델에게 전송됩니다.[/dim]"""


class Message(Static):
    def __init__(self, text: str, role: str, markup: bool = False) -> None:
        super().__init__(classes=f"msg {role}")
        self._buffer = text
        self._markup = markup
        self._sync()

    def _sync(self) -> None:
        self.update(self._buffer if self._markup else Text(self._buffer))

    def add_delta(self, delta: str) -> None:
        self._buffer += delta
        self._sync()

    def finalize_markdown(self) -> None:
        if self._buffer.strip():
            self.update(RichMarkdown(self._buffer))


class PromptArea(TextArea):
    """멀티라인 프롬프트 입력.

    Enter=제출 · Shift+Enter/Ctrl+J=줄바꿈 · Tab=자동완성 · Ctrl+C/Ctrl+D=종료 · Esc=중단
    """

    async def _on_key(self, event: events.Key) -> None:
        key = event.key
        if key == "enter":
            event.prevent_default(); event.stop()
            text = self.text
            self.text = ""
            await self.app._submit_prompt(text)
            return
        if key in ("shift+enter", "ctrl+j"):
            event.prevent_default(); event.stop()
            self.insert("\n")
            self._suggest()
            return
        if key == "tab":
            event.prevent_default(); event.stop()
            self._autocomplete()
            return
        if key in ("ctrl+c", "ctrl+d"):
            event.prevent_default(); event.stop()
            self.app.exit()
            return
        if key == "escape":
            event.prevent_default(); event.stop()
            self.app.action_cancel()
            return
        await super()._on_key(event)
        self._suggest()

    def _line_prefix(self) -> tuple[str, int, int]:
        row, col = self.cursor_location
        line = self.document.get_line(row)
        return line[:col], row, col

    def _autocomplete(self) -> None:
        prefix, row, col = self._line_prefix()
        new, cands = compute_completions(prefix)
        if new != prefix:
            self.replace(new, (row, 0), (row, col))
            self.move_cursor((row, len(new)))
        show = getattr(self.app, "_show_completions", None)
        if show:
            show(cands)

    def _suggest(self) -> None:
        prefix, _, _ = self._line_prefix()
        show = getattr(self.app, "_show_completions", None)
        if show:
            show(list_suggestions(prefix))


class ApprovalScreen(ModalScreen[str]):
    BINDINGS = [
        ("y", "approve", "승인"),
        ("a", "always", "항상"),
        ("n", "deny", "거부"),
        ("escape", "deny", "거부"),
    ]

    def __init__(self, name: str, detail: str) -> None:
        super().__init__()
        self._name = name
        self._detail = detail

    def compose(self) -> ComposeResult:
        with Vertical(id="dialog"):
            yield Label(f"도구 승인 요청 — {self._name}")
            yield Static(Text(self._detail), id="detail")
            with Horizontal(id="buttons"):
                yield Button("승인 (y)", variant="success", id="approve")
                yield Button("항상 (a)", variant="primary", id="always")
                yield Button("거부 (n)", variant="error", id="deny")

    def on_button_pressed(self, event: Button.Pressed) -> None:
        self.dismiss(event.button.id or "deny")

    def action_approve(self) -> None:
        self.dismiss("approve")

    def action_always(self) -> None:
        self.dismiss("always")

    def action_deny(self) -> None:
        self.dismiss("deny")


class GaryTerminalApp(App):
    CSS_PATH = "styles.tcss"
    TITLE = "gary-terminal"
    BINDINGS = [
        ("ctrl+l", "clear", "초기화"),
        ("escape", "cancel", "중단"),
        ("ctrl+c", "quit", "종료"),
        ("ctrl+d", "quit", "종료"),
    ]

    def __init__(self) -> None:
        super().__init__()
        self.config = Config.load()
        self.agent = Agent(self.config, approver=self._approve_tool)
        self._streaming = False
        self._worker = None
        self._always_allow: set[str] = set()
        self._sessions = SessionStore()
        self._session_id = time.strftime("%Y%m%d-%H%M%S")
        self._last_sessions: list[SessionInfo] = []

    def compose(self) -> ComposeResult:
        yield Header()
        yield VerticalScroll(id="conversation")
        yield Static("", id="hint")
        yield PromptArea(id="prompt", soft_wrap=True, show_line_numbers=False, compact=True, placeholder="메시지 · Enter 전송 · Shift+Enter 줄바꿈 · Tab 완성 · /help")
        yield Footer()

    def on_mount(self) -> None:
        self._update_status()
        self._add(
            "gary-terminal — 로컬 코딩 에이전트. /help 로 명령을 확인하세요.",
            "system",
            markup=True,
        )
        if self.agent.project_name:
            self._add(f"📁 프로젝트 컨텍스트 로드: {self.agent.project_name}", "tool")
        self.query_one("#prompt", TextArea).focus()
        self._load_mcp()

    def _add(self, text: str, role: str, markup: bool = False) -> Message:
        msg = Message(text, role, markup)
        self.query_one("#conversation", VerticalScroll).mount(msg)
        self.call_after_refresh(self._scroll_end)
        return msg

    def _scroll_end(self) -> None:
        self.query_one("#conversation", VerticalScroll).scroll_end(animate=False)

    def _show_completions(self, cands: list[str]) -> None:
        hint = self.query_one("#hint", Static)
        hint.update(Text("  ".join(cands)) if cands else Text(""))


    def _status_text(self) -> str:
        a = self.agent
        return f"{a.backend_name}:{a.model} · {a.usage.status()} · ctx {a.context_tokens():,}"

    def _update_status(self) -> None:
        self.sub_title = self._status_text()

    async def _approve_tool(self, name: str, detail: str) -> bool:
        if name in self._always_allow:
            return True
        result = await self.push_screen_wait(ApprovalScreen(name, detail))
        if result == "always":
            self._always_allow.add(name)
            return True
        return result == "approve"

    async def _submit_prompt(self, raw: str) -> None:
        self.query_one("#hint", Static).update(Text(""))
        text = raw.strip()
        if not text:
            return
        if text.startswith("/"):
            await self._handle_command(text)
            return
        if self._streaming:
            self._add("생성 중입니다. Esc로 중단하거나 완료를 기다리세요.", "system", markup=True)
            return
        self._add(text, "user")
        self._worker = self._run_turn(text)

    async def _handle_command(self, text: str) -> None:
        parts = text[1:].split(maxsplit=1)
        cmd = parts[0].lower() if parts and parts[0] else ""
        arg = parts[1].strip() if len(parts) > 1 else ""
        if cmd in ("quit", "q", "exit"):
            self.exit()
        elif cmd == "help":
            self._add(HELP_TEXT, "system", markup=True)
        elif cmd == "clear":
            self.action_clear()
        elif cmd == "reload":
            name = self.agent.reload_context()
            msg = f"컨텍스트 재로드: {name}" if name else "프로젝트 컨텍스트 파일 없음 (AGENTS.md)"
            self._add(msg, "system", markup=True)
        elif cmd == "save":
            self._save_session(explicit=True)
        elif cmd == "sessions":
            self._show_sessions()
        elif cmd == "resume":
            self._resume_session(arg)
        elif cmd == "usage":
            self._add(self.agent.usage.summary(), "system", markup=True)
        elif cmd == "compact":
            await self._cmd_compact()
        elif cmd == "models":
            await self._show_models()
        elif cmd == "model":
            await self._cmd_model(arg)
        else:
            self._add(f"알 수 없는 명령: /{cmd}  (/help)", "system", markup=True)

    async def _cmd_model(self, arg: str) -> None:
        if not arg:
            self._add(f"현재: {self.agent.backend_name}:{self.agent.model}", "system", markup=True)
            return
        parts = arg.split()
        first = parts[0].lower()
        rest = parts[1] if len(parts) > 1 else ""
        if first in ("claude", "ollama"):
            self.agent.switch_backend(first)
            if rest:
                self.agent.set_model(rest)
            self._add(f"백엔드 전환 → {self.agent.backend_name}:{self.agent.model}", "system", markup=True)
        else:
            self.agent.set_model(arg)
            self._add(f"모델 변경 → {self.agent.backend_name}:{self.agent.model}", "system", markup=True)
        self._update_status()

    async def _cmd_compact(self) -> None:
        ev = await self.agent.compact(force=True)
        if ev:
            self._add(f"🗜️ 컨텍스트 압축: 이전 {ev.removed}개 → 요약({ev.summary_chars}자)", "tool")
            self._render_history()
        else:
            self._add("압축할 이전 대화가 충분치 않습니다.", "system", markup=True)
        self._update_status()

    async def _show_models(self) -> None:
        try:
            models = await self.agent.list_models()
        except EngineError as exc:
            self._add(str(exc), "error")
            return
        if not models:
            self._add("모델이 없습니다.", "system", markup=True)
            return
        cur = self.agent.model
        lines = "\n".join(f"  {'●' if m == cur else '○'} {m}" for m in models)
        self._add(f"[b]{self.agent.backend_name} 모델[/b]\n{lines}", "system", markup=True)

    # --- 세션 ---
    def _save_session(self, explicit: bool = False) -> None:
        hist = self.agent.export_history()
        if not hist:
            if explicit:
                self._add("저장할 대화가 없습니다.", "system", markup=True)
            return
        try:
            p = self._sessions.save(self._session_id, hist, self.agent.model, str(Path.cwd()))
        except Exception as exc:  # noqa: BLE001
            if explicit:
                self._add(f"저장 실패: {exc}", "error")
            return
        if explicit:
            self._add(f"세션 저장: {p.name}", "system", markup=True)

    def _show_sessions(self) -> None:
        sessions = self._sessions.list(str(Path.cwd()))
        self._last_sessions = sessions
        if not sessions:
            self._add("저장된 세션이 없습니다.", "system", markup=True)
            return
        lines = []
        for i, s in enumerate(sessions[:15], 1):
            when = time.strftime("%m-%d %H:%M", time.localtime(s.updated))
            lines.append(f"  {i}. {escape(s.title)}  · {s.turns}턴 · {when} · {escape(s.model)}")
        self._add("[b]세션 (/resume <번호>)[/b]\n" + "\n".join(lines), "system", markup=True)

    def _resume_session(self, arg: str) -> None:
        sessions = self._last_sessions or self._sessions.list(str(Path.cwd()))
        self._last_sessions = sessions
        if not sessions:
            self._add("저장된 세션이 없습니다.", "system", markup=True)
            return
        n = int(arg) if arg.isdigit() else 1
        if not (1 <= n <= len(sessions)):
            self._add(f"범위 밖입니다: 1~{len(sessions)}", "system", markup=True)
            return
        info = sessions[n - 1]
        data = self._sessions.load(info.path)
        self.agent.import_history(data.get("messages", []))
        model = data.get("model")
        if model:
            self.agent.set_model(model)
        self._session_id = info.id
        self._render_history()
        self._add(f"세션 재개: {escape(info.title)} ({info.turns}턴)", "system", markup=True)
        self._update_status()

    def _render_history(self) -> None:
        conv = self.query_one("#conversation", VerticalScroll)
        conv.remove_children()
        for m in self.agent.export_history():
            role = m.get("role")
            content = str(m.get("content", ""))
            if role == "user":
                self._add(content, "user")
            elif role == "assistant":
                if content.strip():
                    msg = self._add("", "assistant")
                    msg._buffer = content
                    msg.finalize_markdown()
            elif role == "tool":
                self._add(f"🔧 {m.get('tool_name', 'tool')} 결과", "tool")

    @work(exclusive=False)
    async def _load_mcp(self) -> None:
        try:
            summary = await self.agent.load_mcp()
        except Exception as exc:  # noqa: BLE001
            self._add(f"MCP 로드 오류: {exc}", "error")
            return
        for name, count, err in summary:
            if err:
                self._add(f"🔌 MCP {name}: 실패 — {err}", "error")
            elif count:
                self._add(f"🔌 MCP {name}: 도구 {count}개 로드", "tool")

    @work(exclusive=True)
    async def _run_turn(self, user_text: str) -> None:
        self._streaming = True
        current: Message | None = None
        try:
            async for ev in self.agent.send(user_text):
                if isinstance(ev, TokenEvent):
                    if current is None:
                        current = self._add("", "assistant")
                    current.add_delta(ev.text)
                    self._scroll_end()
                elif isinstance(ev, AttachmentEvent):
                    for p in ev.attached:
                        self._add(f"📎 첨부: {p}", "tool")
                    for p in ev.missing:
                        self._add(f"⚠️ 파일 없음: {p}", "tool")
                elif isinstance(ev, CompactEvent):
                    self._add(
                        f"🗜️ 컨텍스트 압축: 이전 {ev.removed}개 메시지 → 요약({ev.summary_chars}자)",
                        "tool",
                    )
                elif isinstance(ev, ToolCallEvent):
                    current = None
                    self._add(f"🔧 {ev.summary}", "tool")
                elif isinstance(ev, ToolResultEvent):
                    icon = "✅" if ev.ok else "⚠️"
                    self._add(f"{icon} {ev.name} · {ev.summary}", "tool")
                elif isinstance(ev, MessageDone):
                    if current is not None:
                        current.finalize_markdown()
                        current = None
                    else:
                        self._add("(빈 응답)", "assistant")
                    self._scroll_end()
                elif isinstance(ev, EngineError):
                    current = None
                    self._add(f"[오류] {ev.message}", "error")
        finally:
            self._streaming = False
            self._save_session()
            self._update_status()

    def action_quit(self) -> None:
        self.exit()

    def action_clear(self) -> None:
        self.agent.reset()
        self._session_id = time.strftime("%Y%m%d-%H%M%S")
        self.query_one("#conversation", VerticalScroll).remove_children()
        self._add("대화를 초기화했습니다. (새 세션)", "system", markup=True)
        self._update_status()

    def action_cancel(self) -> None:
        if self._streaming and self._worker is not None:
            self._worker.cancel()
            self._add("생성을 중단했습니다.", "system", markup=True)
