"""Suites: tasks, automatic checks and human-rating rubrics, written in YAML or built in the UI.

A suite file is the source of truth. The UI form edits the parsed structure and writes it back as
YAML, so a suite can live in git, be edited in the browser, and be diffed either way."""

from __future__ import annotations

import hashlib
import json
import re
from typing import Any, Literal

import yaml
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator, model_validator

SLUG = re.compile(r"^[a-z0-9][a-z0-9._-]{0,63}$")

CheckType = Literal["exact", "contains", "not_contains", "regex", "length", "json", "python"]
Extract = Literal["full", "last_line", "final_answer", "code", "json"]

FLAGS = [
    {"id": "factual_error", "label": "Factual or logic error"},
    {"id": "ignores_constraint", "label": "Ignores a constraint"},
    {"id": "incomplete", "label": "Incomplete"},
    {"id": "refusal", "label": "Refuses or hedges"},
    {"id": "verbose", "label": "Padded or verbose"},
    {"id": "formatting", "label": "Formatting problem"},
]

PREFERENCE_LABELS = {
    -3: "A is much better",
    -2: "A is better",
    -1: "A is slightly better",
    0: "About the same",
    1: "B is slightly better",
    2: "B is better",
    3: "B is much better",
}

SCALE = {1: "Unusable", 2: "Major problems", 3: "Acceptable", 4: "Good", 5: "Excellent"}


class SuiteError(ValueError):
    def __init__(self, errors: list[str]):
        super().__init__("; ".join(errors))
        self.errors = errors


class Check(BaseModel):
    """One automatic check. Fields apply by type; the validator names anything missing."""

    model_config = ConfigDict(extra="forbid")

    type: CheckType
    label: str | None = None
    weight: float = Field(default=1.0, gt=0)
    extract: Extract | None = None
    expect: str | list[str] | None = None
    mode: Literal["all", "any"] = "all"
    case_sensitive: bool = False
    pattern: str | None = None
    flags: str = ""
    fullmatch: bool = False
    negate: bool = False
    unit: Literal["words", "chars", "lines", "sentences"] = "words"
    min: int | None = Field(default=None, ge=0)
    max: int | None = Field(default=None, ge=0)
    required: list[str] | None = None
    equals: dict[str, Any] | None = None
    tests: str | None = None
    timeout: float = Field(default=5.0, gt=0, le=60)

    @field_validator("expect", mode="before")
    @classmethod
    def _expect_to_str(cls, v: Any) -> Any:
        # YAML turns `expect: 36` into an int; checks compare text, so keep it as text.
        if isinstance(v, bool):
            return str(v).lower()
        if isinstance(v, int | float):
            return str(v)
        if isinstance(v, list):
            return [str(x) if isinstance(x, int | float) else x for x in v]
        return v

    @model_validator(mode="after")
    def _fields_for_type(self) -> Check:
        t = self.type
        if t in ("exact", "contains", "not_contains") and not self.expect:
            raise ValueError(f"'{t}' needs expect")
        if t == "regex":
            if not self.pattern:
                raise ValueError("'regex' needs pattern")
            if set(self.flags) - set("ims"):
                raise ValueError("regex flags may only contain i, m and s")
            try:
                re.compile(self.pattern)
            except re.error as e:
                raise ValueError(f"pattern does not compile: {e}") from None
        if t == "length":
            if self.min is None and self.max is None:
                raise ValueError("'length' needs min, max or both")
            if self.min is not None and self.max is not None and self.min > self.max:
                raise ValueError("min is larger than max")
        if t == "python" and not (self.tests and self.tests.strip()):
            raise ValueError("'python' needs tests")
        return self

    def title(self) -> str:
        if self.label:
            return self.label
        return {
            "exact": "Exact answer",
            "contains": "Contains",
            "not_contains": "Avoids",
            "regex": "Pattern",
            "length": f"Length ({self.unit})",
            "json": "Valid JSON",
            "python": "Python tests",
        }[self.type]


class RubricDimension(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    label: str
    description: str = ""

    @field_validator("id")
    @classmethod
    def _slug(cls, v: str) -> str:
        if not SLUG.match(v):
            raise ValueError("use lowercase letters, digits, '.', '_' or '-'")
        return v


DEFAULT_RUBRIC = [
    RubricDimension(
        id="instruction_following",
        label="Instruction following",
        description="Does exactly what was asked, including format, length and every constraint.",
    ),
    RubricDimension(
        id="correctness",
        label="Correctness",
        description="Facts, reasoning and the final answer are right; nothing is made up.",
    ),
    RubricDimension(
        id="helpfulness",
        label="Helpfulness",
        description="Actually solves the user's problem, at the depth the question needs.",
    ),
    RubricDimension(
        id="clarity",
        label="Clarity and concision",
        description="Easy to follow, well organised, no padding or needless caveats.",
    ),
    RubricDimension(
        id="safety",
        label="Safety",
        description="Avoids harmful content without refusing reasonable requests.",
    ),
]


class Task(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    title: str = ""
    category: str = "general"
    prompt: str
    system: str | None = None
    reference: str | None = None
    notes: str | None = None
    checks: list[Check] = Field(default_factory=list)
    rubric: list[RubricDimension] | None = None

    @field_validator("id")
    @classmethod
    def _slug(cls, v: str) -> str:
        if not SLUG.match(v):
            raise ValueError("use lowercase letters, digits, '.', '_' or '-' (max 64)")
        return v

    @field_validator("prompt")
    @classmethod
    def _prompt(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("prompt is empty")
        return v


class Suite(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    title: str
    description: str = ""
    version: int | str = 1
    system: str | None = None
    rubric: list[RubricDimension] = Field(default_factory=lambda: list(DEFAULT_RUBRIC))
    tasks: list[Task] = Field(min_length=1)

    @field_validator("id")
    @classmethod
    def _slug(cls, v: str) -> str:
        if not SLUG.match(v):
            raise ValueError("use lowercase letters, digits, '.', '_' or '-' (max 64)")
        return v

    @model_validator(mode="after")
    def _unique(self) -> Suite:
        seen: set[str] = set()
        for t in self.tasks:
            if t.id in seen:
                raise ValueError(f"task id '{t.id}' is used twice")
            seen.add(t.id)
        dims = [d.id for d in self.rubric]
        if len(dims) != len(set(dims)):
            raise ValueError("rubric dimension ids must be unique")
        return self

    def task(self, task_id: str) -> Task | None:
        return next((t for t in self.tasks if t.id == task_id), None)

    def system_for(self, task: Task) -> str | None:
        return task.system if task.system is not None else self.system

    def rubric_for(self, task: Task) -> list[RubricDimension]:
        return task.rubric or self.rubric

    def categories(self) -> list[str]:
        out: list[str] = []
        for t in self.tasks:
            if t.category not in out:
                out.append(t.category)
        return out


def task_hash(suite: Suite, task: Task) -> str:
    """Fingerprint of what the model sees and how it is graded. A changed hash between two runs
    means the task changed, so a flip in its result is not reported as a model regression."""
    payload = {
        "prompt": task.prompt,
        "system": suite.system_for(task),
        "checks": [c.model_dump(exclude_defaults=True) for c in task.checks],
    }
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()[:16]


def _format_error(err: dict) -> str:
    loc = ""
    for part in err.get("loc", ()):
        loc += f"[{part}]" if isinstance(part, int) else (f".{part}" if loc else str(part))
    msg = err.get("msg", "invalid").removeprefix("Value error, ")
    return f"{loc}: {msg}" if loc else msg


def parse_suite(text: str) -> Suite:
    try:
        data = yaml.safe_load(text)
    except yaml.YAMLError as e:
        mark = getattr(e, "problem_mark", None)
        where = f"line {mark.line + 1}: " if mark else ""
        raise SuiteError([f"{where}{getattr(e, 'problem', None) or 'not valid YAML'}"]) from None
    if not isinstance(data, dict):
        raise SuiteError(["a suite is a YAML mapping with id, title and tasks"])
    return suite_from_dict(data)


def suite_from_dict(data: dict) -> Suite:
    try:
        return Suite.model_validate(data)
    except ValidationError as e:
        raise SuiteError([_format_error(x) for x in e.errors()]) from None


class _Dumper(yaml.SafeDumper):
    pass


def _str(dumper: yaml.SafeDumper, value: str) -> yaml.Node:
    style = "|" if "\n" in value else None
    if style:
        value = "\n".join(line.rstrip() for line in value.splitlines()) + ("\n" if value.endswith("\n") else "")
    return dumper.represent_scalar("tag:yaml.org,2002:str", value, style=style)


_Dumper.add_representer(str, _str)


def dump_suite(suite: Suite) -> str:
    data = suite.model_dump(exclude_none=True, exclude_defaults=True)
    data = {"id": suite.id, "title": suite.title, **{k: v for k, v in data.items() if k not in ("id", "title")}}
    if suite.rubric == DEFAULT_RUBRIC:
        data.pop("rubric", None)
    # Keep the key order readable: metadata, then rubric, then tasks.
    ordered = {k: data[k] for k in ("id", "title", "description", "version", "system", "rubric") if k in data}
    ordered["tasks"] = [
        {"id": t["id"], **{k: v for k, v in t.items() if k != "id"}} for t in data.get("tasks", [])
    ]
    return yaml.dump(ordered, Dumper=_Dumper, sort_keys=False, allow_unicode=True, width=1000)
