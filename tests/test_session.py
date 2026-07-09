from gary_terminal.engine.session import SessionStore


def test_roundtrip(tmp_path):
    st = SessionStore(tmp_path)
    hist = [{"role": "user", "content": "hi"}, {"role": "assistant", "content": "yo"}]
    st.save("s1", hist, "m", "/cwd")
    lst = st.list("/cwd")
    assert len(lst) == 1 and lst[0].title == "hi" and lst[0].turns == 1
    data = st.load(lst[0].path)
    assert data["messages"] == hist and data["model"] == "m"


def test_list_filter_cwd(tmp_path):
    st = SessionStore(tmp_path)
    st.save("a", [{"role": "user", "content": "x"}], "m", "/one")
    st.save("b", [{"role": "user", "content": "y"}], "m", "/two")
    assert len(st.list("/one")) == 1 and len(st.list()) == 2
