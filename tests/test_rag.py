from gary_terminal.engine.rag import RagIndex, _chunks

VOCAB = ["alpha", "beta", "gamma", "delta"]


async def fake_embed(texts):
    return [[float(t.lower().count(w)) for w in VOCAB] for t in texts]


def test_chunks():
    text = "\n".join(str(i) for i in range(150))
    ch = list(_chunks(text))
    assert len(ch) >= 2 and ch[0][0] == 1 and ch[0][1] == 60


async def test_build_and_search(tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()
    (repo / "a.py").write_text("alpha alpha alpha\n")
    (repo / "b.py").write_text("beta beta\n")
    idx = RagIndex(repo, fake_embed, cache_root=tmp_path / "cache")
    stats = await idx.build()
    assert stats["chunks"] >= 2
    hits = await idx.search("alpha", k=1)
    assert hits and hits[0]["file"] == "a.py"


async def test_incremental(tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()
    (repo / "a.py").write_text("alpha\n")
    cache = tmp_path / "cache"
    idx = RagIndex(repo, fake_embed, cache_root=cache)
    await idx.build()
    idx2 = RagIndex(repo, fake_embed, cache_root=cache)
    stats = await idx2.build()
    assert stats["changed"] == 0


async def test_search_empty(tmp_path):
    idx = RagIndex(tmp_path, fake_embed, cache_root=tmp_path / "c")
    assert await idx.search("x") == []
