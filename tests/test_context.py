from gary_terminal.engine.context import (
    estimate_tokens,
    expand_mentions,
    load_project_context,
)


def test_expand_attach(tmp_path):
    (tmp_path / "a.txt").write_text("hello")
    exp, att, mis = expand_mentions("@a.txt 요약", tmp_path)
    assert att == ["a.txt"] and "hello" in exp and mis == []


def test_expand_missing(tmp_path):
    _, att, mis = expand_mentions("@nope.xyz", tmp_path)
    assert mis == ["nope.xyz"] and att == []


def test_expand_ignores_plain_word(tmp_path):
    _, att, mis = expand_mentions("@property 데코", tmp_path)
    assert att == [] and mis == []


def test_load_context(tmp_path):
    (tmp_path / "AGENTS.md").write_text("rules")
    assert load_project_context(tmp_path) == ("AGENTS.md", "rules")


def test_load_context_none(tmp_path):
    assert load_project_context(tmp_path) is None


def test_estimate_tokens():
    assert estimate_tokens([{"role": "user", "content": "a" * 35}]) == 10
