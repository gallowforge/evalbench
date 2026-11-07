"""Automatic checks: deterministic grading of a model's answer.

Each check first extracts the part of the answer it grades (the whole text, the last line, a
"Final answer:" line, a code block or a JSON value), then applies one rule. A task's score is the
weighted share of checks passed, and the task passes only when every check passes."""

from __future__ import annotations

import json
import re
import secrets
from dataclasses import asdict, dataclass

from evalbench.sandbox import Sandbox, SandboxUnavailable
from evalbench.suites import Check, Task

THINK = re.compile(r"<think>.*?</think>\s*", re.S | re.I)
FENCE = re.compile(r"```[ \t]*([\w+-]*)[^\n]*\n(.*?)```", re.S)
FINAL = re.compile(
    r"^[\s>*_#-]*(?:final\s+answer|answer)\s*[*_]*\s*[:：=]\s*[*_]*\s*(.+?)\s*$",
    re.I | re.M,
)
BOXED = re.compile(r"\\boxed\{([^{}]+)\}")
NUMBER = re.compile(r"[-+]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?:/\d+)?")


@dataclass
class CheckResult:
    type: str
    label: str
    passed: bool
    weight: float
    detail: str

    def to_dict(self) -> dict:
        return asdict(self)


def visible_answer(text: str) -> str:
    """Strip reasoning blocks that some local models print before the answer."""
    return THINK.sub("", text or "").strip()


def _strip_wrapping(s: str) -> str:
    s = s.strip()
    for _ in range(3):
        before = s
        s = re.sub(r"^\*\*(.*)\*\*$", r"\1", s, flags=re.S)
        s = re.sub(r"^`([^`]*)`$", r"\1", s)
        s = re.sub(r'^"(.*)"$', r"\1", s, flags=re.S)
        s = s.strip()
        if s == before:
            break
    return s


def extract(text: str, how: str) -> str:
    text = visible_answer(text)
    if how == "full":
        return text
    if how == "last_line":
        lines = [ln for ln in text.splitlines() if ln.strip()]
        return _strip_wrapping(lines[-1]).rstrip(". ") if lines else ""
    if how == "final_answer":
        boxed = BOXED.findall(text)
        if boxed:
            return boxed[-1].strip()
        found = FINAL.findall(text)
        if found:
            return _strip_wrapping(found[-1]).rstrip(". ")
        return extract(text, "last_line")
    if how == "code":
        blocks = FENCE.findall(text)
        if not blocks:
            return text
        python = [code for lang, code in blocks if lang.lower() in ("python", "py", "python3")]
        # The solution is usually the largest block; a short one is often a usage example.
        return max(python or [code for _, code in blocks], key=len)
    if how == "json":
        decoder = json.JSONDecoder()
        for i, ch in enumerate(text):
            if ch in "{[":
                try:
                    value, _ = decoder.raw_decode(text[i:])
                    return json.dumps(value)
                except json.JSONDecodeError:
                    continue
        return text
    raise ValueError(f"unknown extract mode {how!r}")


def _normalize(s: str, case_sensitive: bool) -> str:
    s = _strip_wrapping(s)
    s = re.sub(r"\s+", " ", s).strip()
    s = s.rstrip(".!")
    return s if case_sensitive else s.casefold()


def _as_number(s: str) -> float | None:
    s = s.strip().replace(",", "")
    try:
        if "/" in s:
            num, den = s.split("/", 1)
            return float(num) / float(den)
        return float(s)
    except (ValueError, ZeroDivisionError):
        return None


def _short(s: str, n: int = 60) -> str:
    s = re.sub(r"\s+", " ", s).strip()
    return s if len(s) <= n else s[: n - 1] + "…"


def _expects(check: Check) -> list[str]:
    if check.expect is None:
        return []
    return [check.expect] if isinstance(check.expect, str) else list(check.expect)


def _exact(check: Check, answer: str) -> tuple[bool, str]:
    got = _normalize(answer, check.case_sensitive)
    for want in _expects(check):
        target = _normalize(want, check.case_sensitive)
        if got == target:
            return True, f'matched "{_short(want)}"'
        want_num = _as_number(target)
        numbers = NUMBER.findall(got)
        if want_num is not None and len(numbers) == 1:  # "4.50 hours" counts, "3 + 4 = 7" does not
            got_num = _as_number(numbers[0])
            if got_num is not None and abs(got_num - want_num) <= 1e-9 * max(1.0, abs(want_num)):
                return True, f"matched {want}"
    return False, f'expected "{_short(_expects(check)[0])}", got "{_short(answer) or "nothing"}"'


def _contains(check: Check, answer: str, forbid: bool) -> tuple[bool, str]:
    hay = answer if check.case_sensitive else answer.casefold()
    hits = [w for w in _expects(check) if (w if check.case_sensitive else w.casefold()) in hay]
    if forbid:
        return (not hits, "none present" if not hits else f'contains "{_short(hits[0], 40)}"')
    wanted = _expects(check)
    if check.mode == "any":
        return (bool(hits), f'found "{_short(hits[0], 40)}"' if hits else "none of the phrases found")
    missing = [w for w in wanted if w not in hits]
    return (not missing, "all present" if not missing else f'missing "{_short(missing[0], 40)}"')


def _regex(check: Check, answer: str) -> tuple[bool, str]:
    flags = 0
    for ch in check.flags:
        flags |= {"i": re.I, "m": re.M, "s": re.S}[ch]
    rx = re.compile(check.pattern or "", flags)
    m = rx.fullmatch(answer.strip()) if check.fullmatch else rx.search(answer)
    if check.negate:
        return (m is None, "not present" if m is None else f'found "{_short(m.group(0), 40)}"')
    if m:
        return True, "whole answer matches" if check.fullmatch else f'found "{_short(m.group(0), 40)}"'
    return False, "answer does not match the pattern" if check.fullmatch else "pattern not found"


def count(answer: str, unit: str) -> int:
    text = answer.strip()
    if unit == "chars":
        return len(text)
    if unit == "lines":
        return len([ln for ln in text.splitlines() if ln.strip()])
    if unit == "sentences":
        return len([s for s in re.split(r"(?<=[.!?])\s+", text) if s.strip()])
    return len(text.split())


def _length(check: Check, answer: str) -> tuple[bool, str]:
    n = count(answer, check.unit)
    unit = check.unit if n != 1 else check.unit.rstrip("s")
    if check.min is not None and n < check.min:
        return False, f"{n} {unit} (min {check.min})"
    if check.max is not None and n > check.max:
        return False, f"{n} {unit} (max {check.max})"
    bounds = [f"min {check.min}" if check.min is not None else "", f"max {check.max}" if check.max is not None else ""]
    return True, f"{n} {unit} ({', '.join(b for b in bounds if b)})"


def _json(check: Check, answer: str) -> tuple[bool, str]:
    try:
        value = json.loads(answer.strip())
    except json.JSONDecodeError as e:
        return False, f"not valid JSON ({e.msg} at line {e.lineno})"
    if check.required or check.equals:
        if not isinstance(value, dict):
            return False, "expected a JSON object"
        missing = [k for k in (check.required or []) if k not in value]
        if missing:
            return False, f"missing key {missing[0]!r}"
        for k, want in (check.equals or {}).items():
            got = value.get(k)
            same = (
                got.casefold() == want.casefold()
                if isinstance(got, str) and isinstance(want, str) and not check.case_sensitive
                else got == want
            )
            if not same:
                return False, f"{k} is {json.dumps(got)}, expected {json.dumps(want)}"
    return True, "valid JSON" + (" with the expected fields" if check.required or check.equals else "")


async def _python(check: Check, code: str, sandbox: Sandbox) -> tuple[bool, str]:
    # The answer runs inside exec so a stray sys.exit() cannot end the program before the tests;
    # a per-run marker printed after the tests proves they all ran (os._exit cannot fake it).
    marker = f"evalbench-ok-{secrets.token_hex(8)}"
    program = (
        f"_answer = {code!r}\n"
        "try:\n"
        "    exec(compile(_answer, 'answer.py', 'exec'), globals())\n"
        "except SystemExit:\n"
        "    pass\n"
        "del _answer\n\n"
        f"# --- evalbench tests ---\n{check.tests}\n\n"
        f"print({marker!r})\n"
    )
    result = await sandbox.run(program, timeout=check.timeout)
    if result.timed_out:
        return False, f"timed out after {check.timeout:g}s"
    if result.killed:
        return False, "killed: too much memory or output"
    if result.ok and marker in result.stdout:
        return True, f"tests passed in {result.duration_ms} ms"
    lines = [ln for ln in result.stderr.strip().splitlines() if ln.strip()]
    if result.ok:
        return False, "exited before the tests finished"
    last = lines[-1] if lines else f"exit code {result.exit_code}"
    return False, _short(last, 120)


DEFAULT_EXTRACT = {"python": "code", "json": "json"}


async def run_check(check: Check, output: str, sandbox: Sandbox) -> CheckResult:
    how = check.extract or DEFAULT_EXTRACT.get(check.type, "full")
    answer = extract(output, how)
    try:
        if check.type == "exact":
            passed, detail = _exact(check, answer)
        elif check.type == "contains":
            passed, detail = _contains(check, answer, forbid=False)
        elif check.type == "not_contains":
            passed, detail = _contains(check, answer, forbid=True)
        elif check.type == "regex":
            passed, detail = _regex(check, answer)
        elif check.type == "length":
            passed, detail = _length(check, answer)
        elif check.type == "json":
            passed, detail = _json(check, answer)
        else:
            passed, detail = await _python(check, answer, sandbox)
    except SandboxUnavailable:
        raise  # not the model's fault: the result is recorded as an error and can be retried
    except Exception as e:  # a check must never take a run down
        passed, detail = False, f"check failed to run: {e}"
    return CheckResult(check.type, check.title(), passed, check.weight, detail)


async def grade(task: Task, output: str, sandbox: Sandbox) -> tuple[list[dict], float | None, bool | None]:
    """Returns (check results, weighted score 0..1, all passed). Tasks without checks are
    unscored (None) and left to human rating."""
    if not task.checks:
        return [], None, None
    results = [await run_check(c, output, sandbox) for c in task.checks]
    total = sum(r.weight for r in results)
    score = sum(r.weight for r in results if r.passed) / total
    return [r.to_dict() for r in results], round(score, 4), all(r.passed for r in results)
