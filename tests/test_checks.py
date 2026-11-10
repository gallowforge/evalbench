import asyncio
from pathlib import Path

import pytest
import yaml

from evalbench.checks import count, extract, grade, run_check, visible_answer
from evalbench.sandbox import Sandbox
from evalbench.suites import Check, Task, parse_suite

ROOT = Path(__file__).resolve().parents[1]
SUITE = parse_suite((ROOT / "evalbench/data/suites/core-battery.yaml").read_text())
ANSWERS = yaml.safe_load((ROOT / "evalbench/data/demo/answers.yaml").read_text())
SANDBOX = Sandbox(allow_local=True)


def check(text: str, **fields) -> tuple[bool, str]:
    result = asyncio.run(run_check(Check(**fields), text, SANDBOX))
    return result.passed, result.detail


def test_a_text_check_can_grade_one_field_of_a_json_answer():
    answer = 'Here you go:\n```json\n{"category": "billing", "reply": "Sorry about that. I have sent the invoice again.", "meta": {"lang": "en"}}\n```'
    assert check(answer, type="length", field="reply", max=10) == (True, "9 words (max 10)")
    assert check(answer, type="length", field="reply", max=5) == (False, "9 words (max 5)")
    assert check(answer, type="not_contains", field="reply", expect=["refund"]) == (True, "none present")
    # the same phrase elsewhere in the answer does not count: only the field is read
    assert check(answer, type="not_contains", field="reply", expect=["billing"]) == (True, "none present")
    assert check(answer, type="contains", field="reply", expect="invoice")[0]
    assert check(answer, type="exact", field="category", expect="Billing")[0]
    assert check(answer, type="exact", field="meta.lang", expect="en")[0]
    assert check(answer, type="regex", field="reply", pattern=r"^Sorry")[0]
    # a field that is not there fails the check and says so, whatever the rule
    assert check(answer, type="not_contains", field="note", expect="x") == (False, 'no "note" field in the answer')
    assert check(answer, type="exact", field="meta.tone", expect="x") == (False, 'no "meta.tone" field in the answer')
    assert check("I cannot help with that.", type="length", field="reply", max=5) == (False, "the answer is not JSON")
    # numbers and other values are compared as their JSON text
    assert check('{"score": 4, "tags": ["a"]}', type="exact", field="score", expect="4")[0]
    assert check('{"score": 4, "tags": ["a"]}', type="contains", field="tags", expect='"a"')[0]
    assert Check(type="length", field="reply", max=5).title() == "Length (words) in reply"


def test_extract_modes():
    text = "Working...\n\n**Answer:** 7/15."
    assert extract(text, "final_answer") == "7/15"
    assert extract("Some steps\n\\boxed{42}\nmore", "final_answer") == "42"
    assert extract("first\nsecond\n\n", "last_line") == "second"
    assert extract("intro\n```js\nx\n```\n```python\ny = 1\n```", "code") == "y = 1\n"
    assert extract('Sure: {"a": [1, 2]} done', "json") == '{"a": [1, 2]}'
    assert visible_answer("<think>hmm</think>\nHello") == "Hello"


def test_exact_normalises_and_compares_numbers():
    assert check("Answer: monday", type="exact", expect="Monday", extract="final_answer")[0]
    assert check("Answer: 4.50 hours", type="exact", expect="4.5", extract="final_answer")[0]
    assert check("Answer: 1,000", type="exact", expect="1000", extract="final_answer")[0]
    ok, detail = check("Answer: 24", type="exact", expect="36", extract="final_answer")
    assert not ok and detail == 'expected "36", got "24"'
    assert not check("MONDAY", type="exact", expect="Monday", case_sensitive=True)[0]
    assert not check("3 + 4 = 7", type="exact", expect="3")[0], "a number inside working is not the answer"


def test_regex_full_negate_and_flags():
    assert check("[2, 3, 5]", type="regex", pattern=r"\[2, 3, 5\]", fullmatch=True)[0]
    assert not check("Primes: [2, 3, 5]", type="regex", pattern=r"\[2, 3, 5\]", fullmatch=True)[0]
    ok, detail = check("A very calm sea", type="regex", pattern=r"\bvery\b", flags="i", negate=True)
    assert not ok and 'found "very"' in detail
    assert check("line one\nline two", type="regex", pattern=r"^line two$", flags="m")[0]


def test_contains_and_not_contains():
    assert check("Tokyo, Japan", type="contains", expect=["tokyo", "japan"])[0]
    assert not check("Tokyo", type="contains", expect=["tokyo", "japan"])[0]
    assert check("Kyoto", type="contains", expect=["tokyo", "kyoto"], mode="any")[0]
    ok, detail = check("```json\n{}\n```", type="not_contains", expect="```")
    assert not ok and "contains" in detail


def test_length_units():
    assert count("One. Two! Three?", "sentences") == 3
    assert count("a\n\nb\n", "lines") == 2
    assert count("  four words right here ", "words") == 4
    ok, detail = check("one two three four five", type="length", unit="words", max=4)
    assert not ok and detail == "5 words (max 4)"
    assert check("one two", type="length", unit="words", min=1, max=4)[0]


def test_json_check_reads_the_first_json_value_by_default():
    fenced = '```json\n{"city": "Tokyo"}\n```'
    assert check(fenced, type="json", equals={"city": "Tokyo"})[0]
    assert not check(fenced, type="json", extract="full")[0], "extract: full demands JSON only"


def test_json_check():
    assert check('{"city": "tokyo", "n": 1}', type="json", required=["city"], equals={"city": "Tokyo"})[0]
    ok, detail = check('{"city": "Osaka"}', type="json", equals={"city": "Tokyo"})
    assert not ok and "expected" in detail
    ok, detail = check("not json", type="json")
    assert not ok and "not valid JSON" in detail


def test_python_check_runs_tests_in_the_sandbox():
    passing = "```python\ndef add(a, b):\n    return a + b\n```"
    failing = "```python\ndef add(a, b):\n    return a - b\n```"
    tests = "assert add(2, 3) == 5, 'add(2, 3) should be 5'"
    assert check(passing, type="python", tests=tests)[0]
    ok, detail = check(failing, type="python", tests=tests)
    assert not ok and "AssertionError: add(2, 3) should be 5" in detail
    ok, detail = check("```python\nwhile True: pass\n```", type="python", tests="pass", timeout=1)
    assert not ok and "timed out" in detail


def test_python_check_cannot_be_faked_by_exiting_early():
    tests = "assert add(2, 3) == 5"
    for exit_call in ("import sys\nsys.exit(0)", "raise SystemExit", "import os\nos._exit(0)"):
        answer = "```python\ndef add(a, b):\n    return a - b\n" + exit_call + "\n```"
        ok, detail = check(answer, type="python", tests=tests)
        assert not ok, f"{exit_call!r} passed: {detail}"


def test_code_extract_prefers_the_solution_over_a_usage_example():
    answer = "Use it like `x`:\n```python\nprint(add(1, 2))\n```\nHere is the fix:\n```python\ndef add(a, b):\n    return a + b\n```"
    assert check(answer, type="python", tests="assert add(2, 3) == 5")[0]


def test_no_sandbox_means_an_error_not_a_failure():
    from evalbench.sandbox import SandboxUnavailable

    task = Task(id="t", prompt="p", checks=[Check(type="python", tests="assert True")])
    with pytest.raises(SandboxUnavailable):
        asyncio.run(grade(task, "x = 1", Sandbox()))


def test_grade_weights_and_unscored_tasks():
    task = Task(id="t", prompt="p", checks=[
        Check(type="contains", expect="a", weight=3),
        Check(type="contains", expect="zzz", weight=1),
    ])
    checks, score, passed = asyncio.run(grade(task, "a b c", SANDBOX))
    assert score == 0.75 and passed is False and len(checks) == 2
    assert asyncio.run(grade(Task(id="u", prompt="p"), "x", SANDBOX)) == ([], None, None)


@pytest.mark.parametrize("task", SUITE.tasks, ids=lambda t: t.id)
def test_demo_answers_grade_as_labelled(task):
    """Strong and correct-but-thin answers pass every check; weak or wrong ones fail at least one.
    This keeps the battery, the check engine and the demo data honest with each other."""
    for variant in ANSWERS[task.id]:
        _, _, passed = asyncio.run(grade(task, variant["text"], SANDBOX))
        assert passed == (variant["q"] >= 2), f"{task.id}/{variant['id']} graded {passed}"
