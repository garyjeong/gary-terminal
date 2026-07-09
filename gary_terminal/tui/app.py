from __future__ import annotations

from rich.text import Text
from textual import work
from textual.app import App, ComposeResult
from textual.containers import Horizontal, Vertical, VerticalScroll
from textual.screen import ModalScreen
from textual.widgets import Button, Footer, Header, Input, Label, Static

from ..config import Config
from ..engine import (
    Agent,
    EngineError,
    MessageDone,
    TokenEvent,
    ToolCallEvent,
    ToolResultEvent,
)

HELP_TEXT = """[b]명령어[/b]
  /help            이 도움말
  /models          설치된 Ollama 모델 목록
  /model <name>    사용 모델 변경 (인자 없으면 현재 모델)
  /clear           대화 초기화
  /quit            종료
[b]도구[/b] read_file · list_dir (자동) · write_file · run_shell (승인 필요)
[dim]그 외 입력은 모델에게 전송됩니다.[/dim]"""


class Message(Static):
    """대화 한 줄. markup=True면 Rich 마크업 해석(시스템/도구), False면 리터럴."""

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

    def compose(self) -> ComposeResult:
        yield Header()
        yield VerticalScroll(id="conversation")
        yield Input(placeholder="메시지 입력 후 Enter … (/help)", id="prompt")
        yield Footer()

    def on_mount(self) -> None:
        self.sub_title = self.config.model
        self._add(
            "gary-terminal — 로컬 코딩 에이전트. /help 로 명령을 확인하세요.",
            "system",
            markup=True,
        )
        self.query_one("#prompt", Input).focus()

    def _add(self, text: str, role: str, markup: bool = False) -> Message:
        msg = Message(text, role, markup)
        self.query_one("#conversation", VerticalScroll).mount(msg)
        self.call_after_refresh(self._scroll_end)
        return msg

    def _scroll_end(self) -> None:
        self.query_one("#conversation", VerticalScroll).scroll_end(animate=False)

    async def _approve_tool(self, name: str, detail: str) -> bool:
        if name in self._always_allow:
            return True
        result = await self.push_screen_wait(ApprovalScreen(name, detail))
        if result == "always":
            self._always_allow.add(name)
            return True
        return result == "approve"

    async def on_input_submitted(self, event: Input.Submitted) -> None:
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
                elif isinstance(ev, ToolCallEvent):
                    current = None
                    self._add(f"🔧 {ev.summary}", "tool")
                elif isinstance(ev, ToolResultEvent):
                    icon = "✅" if ev.ok else "⚠️"
                    self._add(f"{icon} {ev.name} · {ev.summary}", "tool")
                elif isinstance(ev, MessageDone):
                    if current is None and not ev.content.strip():
                        self._add("(빈 응답)", "assistant")
                    current = None
                elif isinstance(ev, EngineError):
                    current = None
                    self._add(f"[오류] {ev.message}", "error")
        finally:
            self._streaming = False

    def action_clear(self) -> None:
        self.agent.reset()
        self.query_one("#conversation", VerticalScroll).remove_children()
        self._add("대화를 초기화했습니다.", "system", markup=True)

    def action_cancel(self) -> None:
        if self._streaming and self._worker is not None:
            self._worker.cancel()
            self._add("생성을 중단했습니다.", "system", markup=True)
