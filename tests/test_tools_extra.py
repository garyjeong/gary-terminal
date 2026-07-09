from gary_terminal.engine.tools import _detect_project, new_registry


async def test_search_code(tmp_path):
    (tmp_path / "a.py").write_text("def hello():\n    pass\n")
    reg = new_registry()
    r = await reg["search_code"].run({"query": "hello", "path": str(tmp_path)})
    assert r.ok and "a.py" in r.content


def test_detect(tmp_path):
    (tmp_path / "pyproject.toml").write_text("[project]\nname='x'\n")
    assert _detect_project(str(tmp_path)) == "python"
    assert _detect_project(str(tmp_path / "nope")) is None


def test_new_tools_approval():
    reg = new_registry()
    assert reg["run_tests"].requires_approval is True
    assert reg["search_code"].requires_approval is False
    assert reg["diagnostics"].requires_approval is False
