from pathlib import Path

import pytest

from evalbench.suites import SuiteError, dump_suite, parse_suite, task_hash

ROOT = Path(__file__).resolve().parents[1]
CORE = (ROOT / "evalbench/data/suites/core-battery.yaml").read_text()
TEMPLATE = (ROOT / "examples/suite-template.yaml").read_text()


def test_core_battery_shape():
    suite = parse_suite(CORE)
    assert len(suite.tasks) == 20
    counts = {c: sum(t.category == c for t in suite.tasks) for c in suite.categories()}
    assert counts == {"reasoning": 7, "constraints": 7, "debugging": 6}
    assert all(t.checks for t in suite.tasks), "every battery task is graded automatically"
    assert [d.id for d in suite.rubric] == ["instruction_following", "correctness", "explanation", "concision"]


def test_template_uses_every_check_type():
    suite = parse_suite(TEMPLATE)
    used = {c.type for t in suite.tasks for c in t.checks}
    assert used == {"exact", "contains", "not_contains", "regex", "length", "json", "python"}


def test_dump_round_trips():
    for text in (CORE, TEMPLATE):
        suite = parse_suite(text)
        assert parse_suite(dump_suite(suite)) == suite


def test_hash_tracks_what_the_model_sees():
    suite = parse_suite(CORE)
    task = suite.tasks[0]
    original = task_hash(suite, task)
    assert task_hash(suite, task.model_copy(update={"title": "Renamed"})) == original
    assert task_hash(suite, task.model_copy(update={"prompt": task.prompt + " "})) != original
    assert task_hash(suite.model_copy(update={"system": "Be brief."}), task) != original


@pytest.mark.parametrize(
    ("text", "message"),
    [
        ("id: x\ntitle: X\ntasks: []", "tasks"),
        ("id: Bad Id\ntitle: X\ntasks: [{id: a, prompt: hi}]", "id: use lowercase"),
        ("id: x\ntitle: X\ntasks: [{id: a, prompt: hi}, {id: a, prompt: yo}]", "used twice"),
        ("id: x\ntitle: X\ntasks: [{id: a, prompt: hi, checks: [{type: exact}]}]", "tasks[0].checks[0]: 'exact' needs expect"),
        ("id: x\ntitle: X\ntasks: [{id: a, prompt: hi, checks: [{type: regex, pattern: '('}]}]", "does not compile"),
        ("id: x\ntitle: X\ntasks: [{id: a, prompt: hi, checks: [{type: length, min: 5, max: 2}]}]", "min is larger"),
        ("id: x\ntitle: X\ntasks: [{id: a, prompt: hi, checks: [{type: python}]}]", "needs tests"),
        ("id: x\ntitle: X\ntasks: [{id: a, prompt: hi, oops: 1}]", "oops"),
        ("id: x\n  title: [", "line"),
        ("- just\n- a list", "mapping"),
    ],
)
def test_errors_point_at_the_problem(text, message):
    with pytest.raises(SuiteError) as e:
        parse_suite(text)
    assert any(message in err for err in e.value.errors), e.value.errors


def test_numeric_expect_stays_text():
    suite = parse_suite("id: x\ntitle: X\ntasks: [{id: a, prompt: hi, checks: [{type: exact, expect: 36}]}]")
    assert suite.tasks[0].checks[0].expect == "36"
