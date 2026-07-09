import gary_terminal.config as cfg


def test_env_override(monkeypatch, tmp_path):
    monkeypatch.setattr(cfg, "CONFIG_PATH", tmp_path / "none.toml")
    monkeypatch.setenv("GT_MODEL", "foo")
    monkeypatch.setenv("GT_CONTEXT_LIMIT", "1234")
    c = cfg.Config.load()
    assert c.model == "foo" and c.context_limit == 1234


def test_defaults(monkeypatch, tmp_path):
    monkeypatch.setattr(cfg, "CONFIG_PATH", tmp_path / "none.toml")
    for v in ("GT_MODEL", "GT_BACKEND", "GT_CONTEXT_LIMIT"):
        monkeypatch.delenv(v, raising=False)
    c = cfg.Config.load()
    assert c.backend == "ollama" and c.theme is None


def test_toml_load(monkeypatch, tmp_path):
    f = tmp_path / "config.toml"
    f.write_text('model = "bar"\nbackend = "claude"\ntheme = "gary-dark"\n')
    monkeypatch.setattr(cfg, "CONFIG_PATH", f)
    for v in ("GT_MODEL", "GT_BACKEND"):
        monkeypatch.delenv(v, raising=False)
    c = cfg.Config.load()
    assert c.model == "bar" and c.backend == "claude" and c.theme == "gary-dark"
