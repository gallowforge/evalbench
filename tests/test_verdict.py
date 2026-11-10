"""The verdict: the rule itself (shared cases, also run by the web tests), what a model costs,
and the endpoint and the command line on a real run."""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from evalbench.app import create_app
from evalbench.cli import main, parse_price
from evalbench.db import SCHEMA, Database
from evalbench.suites import SuiteError, dump_suite, parse_suite
from evalbench.verdict import cost_per_1k, decide, explain, money, need, wilson
from tests.conftest import make_settings, wait_for_run

ROOT = Path(__file__).resolve().parents[1]
CASES = json.loads((ROOT / "tests/verdict-cases.json").read_text())


@pytest.mark.parametrize("case", CASES["need"], ids=lambda c: f"{c['bar']} of {c['attempted']}")
def test_need(case):
    assert need(case["bar"], case["attempted"]) == case["need"]


@pytest.mark.parametrize("case", CASES["wilson"], ids=lambda c: f"{c['passed']} of {c['attempted']}")
def test_wilson(case):
    got = wilson(case["passed"], case["attempted"])
    if case["interval"] is None:
        assert got is None
    else:
        assert got == pytest.approx(case["interval"], abs=1e-4)


@pytest.mark.parametrize("case", CASES["decide"], ids=lambda c: c["name"])
def test_decide(case):
    got = decide(case["candidates"], case["bar"], case["objective"])
    want = case["expect"]
    for key in ("pick", "order", "best", "unranked"):
        assert got[key] == want[key], key
    for model_id, row in want.get("rows", {}).items():
        assert got["rows"][int(model_id)] == row, model_id


def test_decide_refuses_an_unknown_objective():
    with pytest.raises(ValueError):
        decide([], 0.9, "vibes")


def test_cost_is_worked_out_from_the_tokens_the_run_used():
    rows = [
        {"status": "done", "input_tokens": 1000, "output_tokens": 200},
        {"status": "done", "input_tokens": 3000, "output_tokens": 400},
        {"status": "done", "input_tokens": None, "output_tokens": None},  # the server did not say
        {"status": "error", "input_tokens": None, "output_tokens": None},
    ]
    # (1000*3 + 200*15 + 3000*3 + 400*15) / 2 answers / 1e6 * 1000 answers
    assert cost_per_1k(rows, 3, 15) == pytest.approx(10.5)
    assert cost_per_1k(rows, 0, 0) == 0
    assert cost_per_1k(rows, None, 15) is None
    assert cost_per_1k(rows[2:], 3, 15) is None


def test_money():
    assert [money(x) for x in (0, 0.0312, 0.12, 0.7, 2.61, 48.5, 1234.5)] == ["$0", "$0.031", "$0.12", "$0.70", "$2.61", "$48.50", "$1,234"]


def test_the_terminal_says_which_model_and_why():
    models = [
        {"id": 1, "label": "Big", "passed": 24, "attempted": 24, "cost": 2.64, "latency_ms": 2100},
        {"id": 2, "label": "Small", "passed": 22, "attempted": 24, "cost": 0.12, "latency_ms": 900},
        {"id": 3, "label": "Unpriced", "passed": 23, "attempted": 24, "cost": None, "latency_ms": 800},
    ]
    lines = explain(models, decide(models, 0.9, "cost"))
    assert lines[0] == "Use Small: 22 of 24 right at a 90% bar, $0.12 per 1,000 answers."
    assert lines[1] == "Big gets 24 of 24, at 22x the price."
    assert "nothing to spare" in lines[2]
    assert lines[3] == "Not ranked for want of a price: Unpriced."
    assert explain(models, decide(models, 0.9, "speed"))[0] == "Use Unpriced: 23 of 24 right at a 90% bar, 0.8 s per answer."
    none = explain(models[1:2], decide(models[1:2], 0.95, "cost"))
    assert none == ["No model reaches the 95% bar.", "Closest: Small with 22 of 24 right, 1 short."]
    assert explain([], decide([], 0.9, "cost")) == ["No graded answers yet, so there is nothing to decide."]


def test_a_suite_can_set_its_own_bar():
    text = "id: s\ntitle: S\nbar: 0.85\ntasks:\n  - {id: a, prompt: hi}\n"
    suite = parse_suite(text)
    assert suite.bar == 0.85
    assert "\nbar: 0.85\n" in dump_suite(suite)
    assert parse_suite("id: s\ntitle: S\ntasks:\n  - {id: a, prompt: hi}\n").bar is None
    for bad in ("0", "1.5", "-0.2"):
        with pytest.raises(SuiteError):
            parse_suite(text.replace("0.85", bad))


def test_prices_are_stored_and_validated(client):
    m = client.post("/api/models", json={"provider": "anthropic", "model": "claude-haiku-5-5", "price_in": 1, "price_out": "5"}).json()
    assert (m["price_in"], m["price_out"]) == (1.0, 5.0)
    assert client.put(f"/api/models/{m['id']}", json={"label": "Renamed"}).json()["price_out"] == 5.0  # kept
    cleared = client.put(f"/api/models/{m['id']}", json={"price_in": "", "price_out": None}).json()
    assert (cleared["price_in"], cleared["price_out"]) == (None, None)
    free = client.post("/api/models", json={"provider": "anthropic", "model": "claude-haiku-5-5", "price_in": 0, "price_out": 0}).json()
    assert (free["price_in"], free["price_out"]) == (0.0, 0.0)  # zero is a price, not "unknown"
    assert client.post("/api/models", json={"provider": "anthropic", "model": "x", "price_in": -1}).status_code == 422
    assert client.post("/api/models", json={"provider": "anthropic", "model": "x", "price_in": "cheap"}).status_code == 422


def test_a_database_from_before_prices_is_upgraded(tmp_path):
    path = tmp_path / "old.db"
    old = sqlite3.connect(path)
    old.executescript(SCHEMA.replace(",\n  price_in    REAL,\n  price_out   REAL", ""))
    assert "price_in" not in {r[1] for r in old.execute("PRAGMA table_info(models)")}
    old.execute(
        "INSERT INTO models(label, provider, model, created_at) VALUES('Old', 'anthropic', 'claude-haiku-5-5', '2026-01-01T00:00:00Z')"
    )
    old.execute("PRAGMA user_version=1")
    old.commit()
    old.close()
    db = Database(path)
    row = db.one("SELECT label, price_in, price_out FROM models")
    assert row == {"label": "Old", "price_in": None, "price_out": None}
    assert db.scalar("PRAGMA user_version") == 2
    db.close()
    Database(path).close()  # opening it again changes nothing


def test_verdict_on_a_real_run(tmp_path, fake_server):
    with TestClient(create_app(make_settings(tmp_path))) as client:
        assert client.get("/api/verdict/nope").status_code == 404
        empty = client.get("/api/verdict/core-battery").json()
        assert empty["models"] == [] and empty["decision"]["pick"] is None and empty["suite"]["bar"] == 0.9
        assert len(empty["suite"]["tasks"]) == 20
        base = {"provider": "openai-compatible", "base_url": fake_server["url"]}
        good = client.post("/api/models", json={**base, "model": "good-model", "label": "Good", "price_in": 3, "price_out": 15}).json()
        bad = client.post("/api/models", json={**base, "model": "bad-model", "label": "Bad", "price_in": 0, "price_out": 0}).json()
        run_id = client.post("/api/runs", json={"suite_id": "core-battery", "model_ids": [good["id"], bad["id"]]}).json()["id"]
        wait_for_run(client, run_id)
        v = client.get("/api/verdict/core-battery").json()
        by_label = {m["label"]: m for m in v["models"]}
        g, b = by_label["Good"], by_label["Bad"]
        assert (g["passed"], g["attempted"], b["passed"]) == (20, 20, 0)
        assert g["cost"] == pytest.approx((12 * 3 + 34 * 15) / 1000)  # the fake server reports 12 in, 34 out
        assert b["cost"] == 0
        assert g["interval"][1] == 1 and g["interval"][0] < 0.9
        assert v["decision"]["pick"] == good["id"] and v["decision"]["order"] == [good["id"]]
        assert v["decision"]["rows"][str(bad["id"])]["clears"] is False
        assert set(g["tasks"]) == {t["id"] for t in v["suite"]["tasks"]}
        assert all(t["ok"] for t in g["tasks"].values())
        miss = next(iter(b["tasks"].values()))
        assert miss["ok"] is False and miss["why"]
        assert g["categories"]["reasoning"] == [7, 7]
        assert v["history"][0]["models"][str(good["id"])] == {"passed": 20, "attempted": 20, "cost": g["cost"], "latency_ms": g["latency_ms"]}
        assert v["picks"] == [{"run_id": run_id, "pick": good["id"]}]
        # A price added after the run changes the cost, not what was measured.
        client.put(f"/api/models/{good['id']}", json={"price_in": 30, "price_out": 150})
        assert client.get("/api/verdict/core-battery").json()["models"][0]["cost"] == pytest.approx(g["cost"] * 10)


def test_price_spec():
    assert parse_price("claude-haiku-5-5=1/5") == ("claude-haiku-5-5", 1.0, 5.0)
    assert parse_price("qwen3:8b=0/0") == ("qwen3:8b", 0.0, 0.0)
    for bad in ("claude-haiku-5-5", "x=1", "x=a/b", "=1/2"):
        with pytest.raises(ValueError):
            parse_price(bad)


def test_headless_run_names_the_model_to_use(tmp_path, fake_server, monkeypatch, capsys):
    monkeypatch.setenv("EVALBENCH_DATA", str(tmp_path))
    suite = str(ROOT / "evalbench/data/suites/core-battery.yaml")
    good = f"openai-compatible:good-model@{fake_server['url']}"
    bad = f"openai-compatible:bad-model@{fake_server['url']}"
    common = ["run", suite, "--model", good, "--model", bad, "--ephemeral", "--allow-local-code"]
    assert main([*common, "--price", "good-model=3/15", "--price", "bad-model=0/0"]) == 0
    out = capsys.readouterr().out
    assert "Use good-model: 20 of 20 right at a 90% bar, $0.55 per 1,000 answers." in out
    assert main([*common, "--json", "--bar", "0.5"]) == 0
    data = json.loads(capsys.readouterr().out)
    assert data["verdict"]["pick"] == "good-model" and data["verdict"]["bar"] == 0.5
    assert [m["clears"] for m in data["verdict"]["models"]] == [True, False]
    # Nothing clears when only the weak model runs, and --require-pick turns that into a failed build.
    assert main(["run", suite, "--model", bad, "--ephemeral", "--allow-local-code", "--require-pick"]) == 2
    captured = capsys.readouterr()
    assert "No model reaches the 90% bar." in captured.out and "no model reaches the 90% bar" in captured.err
    with pytest.raises(SystemExit, match="not one of the --model ids"):
        main([*common, "--price", "other=1/2"])
    with pytest.raises(SystemExit, match="model=in/out"):
        main([*common, "--price", "good-model"])
