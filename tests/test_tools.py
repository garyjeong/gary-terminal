from gary_terminal.engine.tools import (
    make_protocol,
    make_specs,
    new_registry,
    parse_tool_call,
)


def test_parse_raw():
    reg = new_registry()
    assert parse_tool_call('{"name":"list_dir","arguments":{"path":"."}}', reg) == (
        "list_dir",
        {"path": "."},
    )


def test_parse_fenced_with_trailing():
    reg = new_registry()
    txt = '```json\n{"name":"read_file","arguments":{"path":"x"}}\n```\n\n설명'
    assert parse_tool_call(txt, reg) == ("read_file", {"path": "x"})


def test_parse_non_tool():
    reg = new_registry()
    assert parse_tool_call("그냥 텍스트", reg) is None
    assert parse_tool_call('{"foo":1}', reg) is None


def test_specs_and_protocol():
    reg = new_registry()
    specs = make_specs(reg)
    assert any(s["function"]["name"] == "read_file" for s in specs)
    assert "read_file" in make_protocol(reg)


async def test_read_and_list(tmp_path):
    (tmp_path / "f.txt").write_text("data")
    reg = new_registry()
    r = await reg["read_file"].run({"path": str(tmp_path / "f.txt")})
    assert r.ok and "data" in r.content
    r2 = await reg["list_dir"].run({"path": str(tmp_path)})
    assert r2.ok and "f.txt" in r2.content


async def test_write_requires_approval():
    reg = new_registry()
    assert reg["write_file"].requires_approval is True
    assert reg["read_file"].requires_approval is False
