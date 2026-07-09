import pytest

from gary_terminal.config import Config
from gary_terminal.engine import Agent
from gary_terminal.engine.lsp import detect_python_server, find_symbol_pos


def test_find_symbol_pos(tmp_path):
    f = tmp_path / "m.py"
    f.write_text("x = 1\ndef greet(n):\n    return n\n")
    assert find_symbol_pos(str(f), "greet") == (1, 4)
    assert find_symbol_pos(str(f), "nope") is None


async def test_lsp_definition_and_references(tmp_path, monkeypatch):
    if detect_python_server() is None:
        pytest.skip("파이썬 언어 서버 없음")
    (tmp_path / "m.py").write_text("def greet(name):\n    return name\n\n\nx = greet('a')\n")
    monkeypatch.chdir(tmp_path)
    agent = Agent(Config())
    try:
        d = await agent._tools["lsp_definition"].run({"file": "m.py", "name": "greet"})
        r = await agent._tools["lsp_references"].run({"file": "m.py", "name": "greet"})
    finally:
        if agent._lsp:
            await agent._lsp.shutdown()
    assert d.ok and "m.py:1" in d.content
    assert r.ok and r.content.count("m.py:") >= 2


async def test_lsp_no_server(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr("gary_terminal.engine.agent.detect_python_server", lambda: None)
    (tmp_path / "m.py").write_text("x = 1\n")
    agent = Agent(Config())
    r = await agent._tools["lsp_definition"].run({"file": "m.py", "name": "x"})
    assert not r.ok and "서버" in r.content
