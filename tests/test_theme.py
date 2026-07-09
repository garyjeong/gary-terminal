from gary_terminal.tui.theme import BUILTIN, _to_theme, load_themes


def test_builtin_names():
    names = [t.name for t in load_themes()]
    assert "gary-dark" in names and "gary-light" in names and "gary-mono" in names


def test_to_theme():
    th = _to_theme(BUILTIN[0])
    assert th.name == "gary-dark" and th.dark is True and th.primary == "#7aa2f7"
