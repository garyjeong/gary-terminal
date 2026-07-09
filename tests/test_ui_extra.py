from rich.markdown import Markdown as RichMarkdown
from rich.text import Text

from gary_terminal.tui.app import GaryTerminalApp, Message


def _content(m):
    return getattr(m, "_Static__content")


async def test_message_live_markdown():
    app = GaryTerminalApp()
    async with app.run_test():
        m = app._add("", "assistant", live=True)
        m.feed("# 제목\n본문", render=True)
        assert isinstance(_content(m), RichMarkdown)


async def test_message_plain():
    app = GaryTerminalApp()
    async with app.run_test():
        m = app._add("x", "user")
        assert isinstance(_content(m), Text)


async def test_message_feed_throttle():
    app = GaryTerminalApp()
    async with app.run_test():
        m = app._add("", "assistant", live=True)
        m.feed("a", render=False)
        m.feed("b", render=False)
        assert m._buffer == "ab"


async def test_search_and_copy():
    app = GaryTerminalApp()
    async with app.run_test():
        app._add("hello world", "assistant")
        app._add("goodbye now", "assistant")
        app._cmd_search("hello")
        matched = [m for m in app.query(Message) if "match" in m.classes]
        assert any("hello" in m._buffer for m in matched)
        app._cmd_search("")
        assert not [m for m in app.query(Message) if "match" in m.classes]
        copied = []
        app.copy_to_clipboard = lambda t: copied.append(t)
        app._cmd_copy("")
        assert copied and "goodbye now" in copied[-1]
