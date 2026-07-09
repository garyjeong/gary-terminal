from __future__ import annotations

import time
from pathlib import Path

from rich.markup import escape
from rich.markdown import Markdown as RichMarkdown
from rich.text import Text
from textual import events, work
from textual.app import App, ComposeResult
from textual.containers import Horizontal, Vertical, VerticalScroll
from textual.screen import ModalScreen
from textual.widgets import Button, Footer, Header, Input, Label, Static

from ..config import Config
from ..engine import (
    Agent,
    AttachmentEvent,
    EngineError,
    MessageDone,
    TokenEvent,
    ToolCallEvent,
    ToolResultEvent,
)
from ..engine.session import SessionInfo, SessionStore
from .completion import compute_completions

HELP_TEXT = """[b]명령어[/b]
  /help            이 도움말
  /models          설치된 Ollama 모델 목록
  /model <name>    사용 모델 변경
  /reload          프로젝트 컨텍스트(AGENTS.md) 재로드
  /save            현재 대화 세션 저장
  /sessions        저장된 세션 목록
  /resume <번호>   세션 재개 (번호 없으면 최근)
  /clear           대화 초기화 (새 세션)
  /quit            종료
[b]도구[/b] read_file · list_dir (자동) · write_file · run_shell (승인 필요)
[b]첨부[/b] @경로/파일.py 로 파일 내용을 프롬프트에 포함
[b]Tab[/b] 슬래시 명령 · @파일 경로 자동완성
[dim]그 외 입력은 모델에게 전송됩니다.[/dim]"""


class Message(Static):
    """대화 한 줄. markup=True면 Rich 마크업, False면 리터럴.
    finalize_markdown(): 완료된 답을 마크다운(코드 하이라이트)으로 재렌더."""

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


class PromptInput(Input):
    """Tab 자동완성을 지원하는 입력창."""

    def on_key(self, event: events.Key) -> None:
        if event.key == "tab":
            event.prevent_default()
            event.stop()
            new, cands = compute_completions(self.value)
            if new != self.value:
                self.value = new
                self.cursor_position = len(self.value)
            show = getattr(self.app, "_show_completions", None)
            if show:
                show(cands)


class ApprovalScreen(ModalScreen[str]):
    """도구 실행 승인 모달. dismiss 값: approve / always / deny."""

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
        yield PromptInput(placeholder="메시지 입력 후 Enter … (/help · @파일 · Tab 자동완성)", id="prompt")
        yield Footer()

    def on_mount(self) -> None:
        self.sub_title = self.config.model
        self._add(
            "gary-terminal — 로컬 코딩 에이전트. /help 로 명령을 확인하세요.",
            "system",
            markup=True,
        )
        if self.agent.project_name:
            self._add(f"📁 프로젝트 컨텍스트 로드: {self.agent.project_name}", "tool")
        self.query_one("#prompt", Input).focus()
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

    async def _approve_tool(self, name: str, detail: str) -> bool:
        if name in self._always_allow:
            return True
        result = await self.push_screen_wait(ApprovalScreen(name, detail))
        if result == "always":
            self._always_allow.add(name)
            return True
        return result == "approve"

    async def on_input_submitted(self, event: Input.Submitted) -> None:
        self.query_one("#hint", Static).update(Text(""))
        text = event.value.strip()
        event.input.value = ""
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
        elif cmd == "models":
            await self._show_models()
        elif cmd == "model":
            if not arg:
                self._add(f"현재 모델: {self.agent.model}", "system", markup=True)
            else:
                self.agent.set_model(arg)
                self.sub_title = arg
                self._add(f"모델 변경 → {arg}", "system", markup=True)
        else:
            self._add(f"알 수 없는 명령: /{cmd}  (/help)", "system", markup=True)

    async def _show_models(self) -> None:
        try:
            models = await self.agent.list_models()
        except EngineError as exc:
            self._add(str(exc), "error")
            return
        if not models:
            self._add("설치된 모델이 없습니다. ollama pull <model> 로 받으세요.", "system", markup=True)
            return
        cur = self.agent.model
        lines = "\n".join(f"  {'●' if m == cur else '○'} {m}" for m in models)
        self._add(f"[b]설치된 모델[/b]\n{lines}", "system", markup=True)

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
            self.sub_title = model
        self._session_id = info.id
        self._render_history()
        self._add(f"세션 재개: {escape(info.title)} ({info.turns}턴)", "system", markup=True)

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

    def action_clear(self) -> None:
        self.agent.reset()
        self._session_id = time.strftime("%Y%m%d-%H%M%S")
        self.query_one("#conversation", VerticalScroll).remove_children()
        self._add("대화를 초기화했습니다. (새 세션)", "system", markup=True)

    def action_cancel(self) -> None:
        if self._streaming and self._worker is not None:
            self._worker.cancel()
            self._add("생성을 중단했습니다.", "system", markup=True)
