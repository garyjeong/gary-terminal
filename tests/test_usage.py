from gary_terminal.engine.usage import Usage, UsageTracker


def test_tracker():
    t = UsageTracker()
    t.add(Usage(input_tokens=10, output_tokens=5))
    t.add(Usage(input_tokens=3, output_tokens=2, cost_usd=0.01))
    assert t.total_tokens == 20 and t.calls == 2 and t.has_cost
    assert "20" in t.status()
    assert "사용량" in t.summary()


def test_tracker_none():
    t = UsageTracker()
    t.add(None)
    assert t.calls == 0
