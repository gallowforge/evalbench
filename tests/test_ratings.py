import asyncio
import random

import pytest

from evalbench.db import Database
from evalbench.demo import load_demo
from evalbench.ratings import RatingError, bootstrap, bradley_terry, next_pair, progress, save_rating
from evalbench.sandbox import Sandbox


def test_equal_records_give_equal_ratings():
    games = [(1, 2, 1.0), (2, 1, 1.0), (1, 2, 0.5)]
    r = bradley_terry(games)
    assert abs(r[1] - r[2]) < 1e-6 and abs(r[1] - 1000) < 1e-6


def test_stronger_model_rates_higher_and_stays_finite():
    games = [(1, 2, 1.0)] * 8 + [(2, 3, 1.0)] * 8
    r = bradley_terry(games)
    assert r[1] > r[2] > r[3]
    assert all(abs(v) < 5000 for v in r.values()), "the prior keeps an unbeaten model finite"


def test_ratings_ignore_side():
    games = [(1, 2, 1.0), (1, 2, 0.0), (2, 1, 1.0)]
    flipped = [(b, a, 1 - s) for a, b, s in games]
    assert bradley_terry(games) == pytest.approx(bradley_terry(flipped))


def test_bootstrap_interval_contains_estimate():
    games = [(1, 2, 1.0)] * 12 + [(1, 2, 0.0)] * 4
    est = bradley_terry(games)
    ci = bootstrap(games)
    assert ci[1][0] <= est[1] <= ci[1][1]


@pytest.fixture
def demo_db():
    db = Database(":memory:")
    asyncio.run(load_demo(db, Sandbox()))
    return db


def test_pairs_are_blind_and_balanced(demo_db):
    run_id = demo_db.scalar("SELECT MAX(id) FROM runs")
    pair = next_pair(demo_db, "sam", run_id=run_id, rng=random.Random(1))
    assert pair is not None
    text = repr(pair)
    for label in ("Nimbus", "Atlas", "Orion", "Vega"):
        assert label not in text, "a pair never names a model"
    assert set(pair["a"]) == {"result_id", "output"}
    assert pair["a"]["output"] != pair["b"]["output"]


def test_rating_flow_and_progress(demo_db):
    run_id = demo_db.scalar("SELECT MAX(id) FROM runs")
    before = progress(demo_db, "sam", run_id=run_id)
    pair = next_pair(demo_db, "sam", run_id=run_id)
    save_rating(demo_db, {
        "result_a": pair["a"]["result_id"], "result_b": pair["b"]["result_id"], "preference": -2,
        "scores": {"a": {"correctness": 5}, "b": {"correctness": 2}},
        "flags": {"b": ["factual_error", "not-a-flag"]},
        "justification": "A gets the right answer and shows the check; B does not.", "rater": "sam",
    })
    after = progress(demo_db, "sam", run_id=run_id)
    assert after["rated"] == before["rated"] + 1 and after["remaining"] == before["remaining"] - 1
    again = next_pair(demo_db, "sam", run_id=run_id, rng=random.Random(2))
    assert {again["a"]["result_id"], again["b"]["result_id"]} != {pair["a"]["result_id"], pair["b"]["result_id"]}
    row = demo_db.one("SELECT flags FROM ratings ORDER BY id DESC LIMIT 1")
    assert row["flags"] == '{"a":[],"b":["factual_error"]}'


def test_skipped_pairs_come_back_last(demo_db):
    run_id = demo_db.scalar("SELECT MAX(id) FROM runs")
    first = next_pair(demo_db, "sam", run_id=run_id, rng=random.Random(3))
    second = next_pair(demo_db, "sam", run_id=run_id, skip=[first["key"]], rng=random.Random(3))
    assert second["key"] != first["key"]


@pytest.mark.parametrize(
    ("change", "message"),
    [
        ({"preference": 5}, "between -3"),
        ({"justification": "short"}, "at least 30"),
        ({"scores": {"a": {"nonsense": 3}}}, "unknown rubric"),
        ({"scores": {"a": {"correctness": 9}}}, "1 to 5"),
        ({"confidence": "certain"}, "confidence"),
    ],
)
def test_rating_validation(demo_db, change, message):
    run_id = demo_db.scalar("SELECT MAX(id) FROM runs")
    pair = next_pair(demo_db, "sam", run_id=run_id)
    payload = {"result_a": pair["a"]["result_id"], "result_b": pair["b"]["result_id"], "preference": 1,
               "justification": "B is shorter and still gets every part of it right."}
    payload.update(change)
    with pytest.raises(RatingError, match=message):
        save_rating(demo_db, payload)


def test_rating_needs_two_models_on_one_task(demo_db):
    rows = demo_db.all("SELECT id, task_id, model_id FROM results WHERE run_id=1 ORDER BY id LIMIT 30")
    same_model = [r for r in rows if r["model_id"] == rows[0]["model_id"]]
    with pytest.raises(RatingError):
        save_rating(demo_db, {"result_a": same_model[0]["id"], "result_b": same_model[1]["id"], "preference": 0,
                              "justification": "x" * 40})
