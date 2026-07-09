from gary_terminal.tui.completion import compute_completions, list_suggestions


def test_slash_single(tmp_path):
    assert compute_completions("/rel", tmp_path) == ("/reload ", [])


def test_slash_multi(tmp_path):
    new, cands = compute_completions("/re", tmp_path)
    assert new == "/re" and set(cands) == {"reload", "resume"}


def test_at_file(tmp_path):
    (tmp_path / "README.md").write_text("x")
    new, _ = compute_completions("@READ", tmp_path)
    assert new == "@README.md"


def test_at_dir_slash(tmp_path):
    (tmp_path / "src").mkdir()
    new, _ = compute_completions("@sr", tmp_path)
    assert new == "@src/"


def test_list_suggestions_slash(tmp_path):
    s = list_suggestions("/", tmp_path)
    assert "/help" in s and "/quit" in s


def test_list_suggestions_none(tmp_path):
    assert list_suggestions("hello world", tmp_path) == []
