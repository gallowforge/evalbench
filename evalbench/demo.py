"""The demo workspace: two jobs with different answers.

Support ticket triage: three runs of five fictional models, where the cheapest model that is good
enough is a small hosted one. The core battery: six weekly runs of four of those models, where it
is a model on your own hardware. Plus a few hundred blind ratings. Answers are scripted
(data/demo/*.yaml) but every check result, pass rate, cost, rating and verdict is computed by the
same code that grades real runs.

The models are invented (Nimbus Pro, Atlas 70B, Orion Mini, Vega 8B, Lyra Flash), their prices
are made up and their hosts are placeholders, so nothing here describes a real product."""

from __future__ import annotations

import random
from datetime import UTC, datetime, timedelta
from itertools import combinations
from pathlib import Path

import yaml

from evalbench.checks import grade
from evalbench.db import Database, dumps
from evalbench.ratings import save_rating
from evalbench.sandbox import Sandbox, SandboxUnavailable
from evalbench.store import install_bundled_suites, load_suite
from evalbench.suites import task_hash

DATA = Path(__file__).parent / "data" / "demo"
ANSWERS = DATA / "answers.yaml"
SUITE_ID = "core-battery"
TRIAGE_ID = "support-triage"
TRIAGE_ANSWERS = DATA / "triage-answers.yaml"
TRIAGE_PLAN = DATA / "triage-plan.yaml"  # which scripted answer each model gives in each run
TRIAGE_AGE = (29, 17, 5)  # hours ago, oldest run first: all after the last core battery run
PARAMS = {"temperature": 0, "max_tokens": 4096}

MODELS = [
    {"label": "Nimbus Pro", "base_url": "https://api.example.com/v1", "model": "nimbus-pro",
     "api_key_env": "NIMBUS_API_KEY", "concurrency": 4, "color": "#2a78d6",
     "skill": [None, 0.78, 0.80, 0.82, 0.83, 0.84], "speed": (380, 16), "pick": 0, "price": (3.0, 15.0)},
    {"label": "Atlas 70B", "base_url": "http://192.0.2.40:1234/v1", "model": "atlas-70b-instruct",
     "api_key_env": None, "concurrency": 1, "color": "#eb6834",
     "skill": [0.70, 0.72, 0.73, 0.76, 0.78, 0.80], "speed": (900, 42), "pick": 1, "price": (0.0, 0.0)},
    {"label": "Orion Mini", "base_url": "https://api.example.com/v1", "model": "orion-mini",
     "api_key_env": "NIMBUS_API_KEY", "concurrency": 8, "color": "#1baf7a",
     "skill": [0.52, 0.55, 0.58, 0.60, 0.62, 0.66], "speed": (240, 7), "pick": -1, "price": (0.15, 0.6)},
    {"label": "Vega 8B", "base_url": "http://192.0.2.40:11434/v1", "model": "vega-8b-q4",
     "api_key_env": None, "concurrency": 1, "color": "#eda100",
     "skill": [0.36, 0.42, 0.49, 0.55, 0.62, 0.42], "speed": (300, 20), "pick": 0, "price": (0.0, 0.0)},
]
# A fifth model that only takes part in the triage runs. It is kept out of MODELS so the core
# battery draws the same random numbers it always has.
LYRA = {"label": "Lyra Flash", "base_url": "https://api.lyra.example/v1", "model": "lyra-flash",
        "api_key_env": "LYRA_API_KEY", "concurrency": 8, "color": "#6250d6", "speed": (190, 5), "price": (0.8, 4.0)}
RUN_LABELS = ["baseline", "weekly", "weekly", "new sampling defaults", "weekly", "vega 8b re-quantised"]
EASY = {"r01-ages", "r05-tank", "c05-primes", "d01-window", "d05-dict-mutation", "c02-json"}
HARD = {"r03-seating", "r06-sevens", "r07-clock", "c03-lipogram", "c06-explain", "d02-default-arg", "d04-durations"}


def _stamp(t: datetime) -> str:
    return t.strftime("%Y-%m-%dT%H:%M:%SZ")


def _add_model(db: Database, m: dict, created: datetime) -> int:
    return db.insert(
        """INSERT INTO models(label, provider, base_url, model, api_key_env, params, concurrency, color, created_at,
           price_in, price_out) VALUES(?,?,?,?,?,?,?,?,?,?,?)""",
        (m["label"], "openai-compatible", m["base_url"], m["model"], m["api_key_env"], dumps(PARAMS), m["concurrency"],
         m["color"], _stamp(created), *m["price"]),
    )


def _enter(db: Database, run_id: int, model_id: int, m: dict) -> None:
    """Records that a model took part in a run, with the settings it ran with."""
    snap = {"id": model_id, "label": m["label"], "provider": "openai-compatible", "base_url": m["base_url"],
            "model": m["model"], "api_key_env": m["api_key_env"], "params": PARAMS,
            "concurrency": m["concurrency"], "color": m["color"]}
    db.execute("INSERT INTO run_models(run_id, model_id, snapshot) VALUES(?,?,?)", (run_id, model_id, dumps(snap)))


def _store(db: Database, run_id: int, suite, task, model_id: int, v: dict, graded: tuple, latency: int,
           tokens: tuple[int, int], when: datetime) -> None:
    checks, score, passed = graded
    db.execute(
        """INSERT INTO results(run_id, task_id, task_hash, category, model_id, status, output, finish_reason,
           latency_ms, input_tokens, output_tokens, checks, score, passed, completed_at)
           VALUES(?,?,?,?,?,'done',?,?,?,?,?,?,?,?,?)""",
        (run_id, task.id, task_hash(suite, task), task.category, model_id, v["text"].rstrip("\n"), "stop",
         latency, tokens[0], tokens[1], dumps(checks), score, None if passed is None else int(passed), _stamp(when)),
    )


async def load_demo(db: Database, sandbox: Sandbox, *, today: datetime | None = None) -> dict:
    if db.get_meta("demo") == "1":
        return {"ok": True, "already": True}
    install_bundled_suites(db)
    suite = load_suite(db, SUITE_ID)
    if suite is None:
        return {"ok": False, "error": "the core battery suite is missing"}
    suite_yaml = db.scalar("SELECT yaml FROM suites WHERE id=?", (SUITE_ID,))
    answers = yaml.safe_load(ANSWERS.read_text(encoding="utf-8"))
    rng = random.Random(20261108)
    today = (today or datetime.now(UTC)).replace(minute=0, second=0, microsecond=0)

    # Grade every scripted variant once with the real check engine. These answers ship with
    # Evalbench, so they may run locally when no sandbox is configured.
    if not sandbox.can_run:
        sandbox = Sandbox(allow_local=True)
    graded: dict[tuple[str, str], tuple[list, float | None, bool | None]] = {}
    for task in suite.tasks:
        for v in answers[task.id]:
            try:
                graded[(task.id, v["id"])] = await grade(task, v["text"], sandbox)
            except SandboxUnavailable:
                sandbox = Sandbox(allow_local=True)
                graded[(task.id, v["id"])] = await grade(task, v["text"], sandbox)

    model_ids = [_add_model(db, m, today - timedelta(days=50)) for m in MODELS]

    latent = {(mi, t.id): rng.random() for mi in range(len(MODELS)) for t in suite.tasks}
    run_ids: list[int] = []
    picks: dict[int, dict[tuple[int, str], dict]] = {}
    for k, label in enumerate(RUN_LABELS):
        created = today - timedelta(days=(len(RUN_LABELS) - 1 - k) * 7 + 1, hours=14 - k)
        started = created + timedelta(seconds=4)
        members = [i for i, m in enumerate(MODELS) if m["skill"][k] is not None]
        run_id = db.insert(
            "INSERT INTO runs(suite_id, suite_title, suite_yaml, label, status, created_at, started_at) VALUES(?,?,?,?,?,?,?)",
            (SUITE_ID, suite.title, suite_yaml, label, "done", _stamp(created), _stamp(started)),
        )
        run_ids.append(run_id)
        picks[run_id] = {}
        longest = 0.0
        for i in members:
            m = MODELS[i]
            _enter(db, run_id, model_ids[i], m)
            clock = 0.0
            for task in suite.tasks:
                variants = answers[task.id]
                passing = sorted((v for v in variants if graded[(task.id, v["id"])][2]), key=lambda v: -v["q"])
                failing = [v for v in variants if not graded[(task.id, v["id"])][2]]
                bias = 0.12 if task.id in EASY else -0.16 if task.id in HARD else 0.0
                ok = latent[(i, task.id)] + rng.gauss(0, 0.03) < m["skill"][k] + bias
                pool = passing if (ok and passing) or not failing else failing
                pick = m["pick"] if pool is passing else i
                v = pool[pick % len(pool)] if pick >= 0 else pool[-1]
                checks, score, passed = graded[(task.id, v["id"])]
                out_tokens = max(3, round(len(v["text"]) / 3.8))
                in_tokens = round(len(task.prompt) / 3.9) + 8
                base, per_token = m["speed"]
                latency = int(base + per_token * out_tokens + rng.uniform(-0.12, 0.18) * base)
                clock += latency / 1000 / m["concurrency"]
                _store(db, run_id, suite, task, model_ids[i], v, (checks, score, passed), latency, (in_tokens, out_tokens),
                       started + timedelta(seconds=clock))
                picks[run_id][(i, task.id)] = v
            longest = max(longest, clock)
        db.execute("UPDATE runs SET finished_at=? WHERE id=?", (_stamp(started + timedelta(seconds=longest + 2)), run_id))

    rated = 0
    for share, run_id in ((0.32, run_ids[-2]), (0.62, run_ids[-1])):
        picked = {(model_ids[i], task_id): v for (i, task_id), v in picks[run_id].items()}
        rated += _rate_run(db, rng, run_id, suite.tasks, model_ids, picked, share, today, _scores)

    ids = {m["label"]: model_ids[i] for i, m in enumerate(MODELS)}
    ids[LYRA["label"]] = _add_model(db, LYRA, today - timedelta(days=2))
    triage_runs, triage_rated = await _load_triage(db, sandbox, today, ids)

    db.set_meta("demo", "1")
    return {"ok": True, "runs": len(run_ids) + triage_runs, "models": len(ids), "ratings": rated + triage_rated}


async def _load_triage(db: Database, sandbox: Sandbox, today: datetime, ids: dict[str, int]) -> tuple[int, int]:
    """The support triage job: every model in triage-plan.yaml, one run per entry in its `runs`.
    The plan names the scripted answer each model gives; the real checks decide what passes."""
    suite = load_suite(db, TRIAGE_ID)
    if suite is None:
        return 0, 0
    suite_yaml = db.scalar("SELECT yaml FROM suites WHERE id=?", (TRIAGE_ID,))
    answers = yaml.safe_load(TRIAGE_ANSWERS.read_text(encoding="utf-8"))
    plan = yaml.safe_load(TRIAGE_PLAN.read_text(encoding="utf-8"))
    rng = random.Random(20261111)
    variants = {task.id: {v["id"]: v for v in answers[task.id]} for task in suite.tasks}
    graded = {(task.id, v["id"]): await grade(task, v["text"], sandbox) for task in suite.tasks for v in answers[task.id]}
    setup = {m["label"]: m for m in (*MODELS, LYRA)}
    members = sorted((ids[label], setup[label]) for label in plan["models"])

    run_ids: list[int] = []
    picked: dict[int, dict[tuple[int, str], dict]] = {}
    for k, run in enumerate(plan["runs"]):
        created = today - timedelta(hours=TRIAGE_AGE[k])
        started = created + timedelta(seconds=3)
        run_id = db.insert(
            "INSERT INTO runs(suite_id, suite_title, suite_yaml, label, status, created_at, started_at) VALUES(?,?,?,?,?,?,?)",
            (TRIAGE_ID, suite.title, suite_yaml, run["label"], "done", _stamp(created), _stamp(started)),
        )
        run_ids.append(run_id)
        picked[run_id] = {}
        longest = 0.0
        for model_id, m in members:
            _enter(db, run_id, model_id, m)
            script = plan["models"][m["label"]]
            changed = script["runs"][k] or {}
            clock = 0.0
            for task in suite.tasks:
                v = variants[task.id][changed.get(task.id, script["default"])]
                out_tokens = max(3, round(len(v["text"]) / 3.8))
                in_tokens = round((len(suite.system or "") + len(task.prompt)) / 3.9) + 12  # the policy is sent every time
                base, per_token = m["speed"]
                latency = int(base + per_token * out_tokens + rng.uniform(-0.12, 0.18) * base)
                clock += latency / 1000 / m["concurrency"]
                _store(db, run_id, suite, task, model_id, v, graded[(task.id, v["id"])], latency, (in_tokens, out_tokens),
                       started + timedelta(seconds=clock))
                picked[run_id][(model_id, task.id)] = v
            longest = max(longest, clock)
        db.execute("UPDATE runs SET finished_at=? WHERE id=?", (_stamp(started + timedelta(seconds=longest + 2)), run_id))

    rated = 0
    order = [model_id for model_id, _ in members]
    for share, run_id, window in ((0.2, run_ids[-2], (0.3, 10.0)), (0.5, run_ids[-1], (0.2, 4.5))):
        rated += _rate_run(db, rng, run_id, suite.tasks, order, picked[run_id], share, today, _triage_scores, window)
    return len(run_ids), rated


def _rate_run(db: Database, rng: random.Random, run_id: int, tasks: list, members: list[int],
              picked: dict[tuple[int, str], dict], share: float, today: datetime, scores,
              window: tuple[float, float] = (2, 40)) -> int:
    """Two scripted judges rate a share of the run's answer pairs, blind, the way a person would:
    the better-written answer usually wins, close calls go either way. `window` is how many hours
    after the run a rating lands."""
    finished = datetime.strptime(db.scalar("SELECT finished_at FROM runs WHERE id=?", (run_id,)), "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=UTC)
    rows = db.all("SELECT id, task_id, model_id FROM results WHERE run_id=?", (run_id,))
    index = {(r["model_id"], r["task_id"]): r["id"] for r in rows}
    rated = 0
    for task in tasks:
        present = [m for m in members if (m, task.id) in index]
        for x, y in combinations(present, 2):
            vx, vy = picked[(x, task.id)], picked[(y, task.id)]
            if vx["text"] == vy["text"] or rng.random() > share:
                continue
            if rng.random() < 0.5:
                x, y, vx, vy = y, x, vy, vx
            diff = vy["q"] - vx["q"]
            strength = min(3, abs(diff))
            if strength and rng.random() < 0.15:
                strength -= 1
            if diff == 0 and rng.random() < 0.4:
                preference = rng.choice([-1, 1])
            else:
                preference = strength if diff > 0 else -strength
            when = finished + timedelta(hours=rng.uniform(*window))
            if when > today:
                when = today - timedelta(minutes=rng.randint(20, 300))
            save_rating(
                db,
                {
                    "result_a": index[(x, task.id)],
                    "result_b": index[(y, task.id)],
                    "run_id": run_id,
                    "preference": preference,
                    "scores": {"a": scores(vx, rng), "b": scores(vy, rng)},
                    "flags": {"a": vx.get("flags", []), "b": vy.get("flags", [])},
                    "justification": _justify(preference, vx, vy),
                    "confidence": "high" if abs(preference) >= 2 else ("medium" if preference else rng.choice(["medium", "low"])),
                    "rater": "alex" if rng.random() < 0.6 else "jordan",
                    "seconds": int(35 + (len(vx["text"]) + len(vy["text"])) / 14 + rng.uniform(0, 70)),
                    "created_at": _stamp(when),
                },
                min_justification=0,
            )
            rated += 1
    return rated


def _triage_scores(v: dict, rng: random.Random) -> dict:
    """Rubric marks for a triage answer: accuracy is the two labels, policy the rules, and the
    other two are about the reply itself."""
    q = v["q"]
    flags = set(v.get("flags", []))
    broken = "formatting" in flags  # not one JSON object, or a field missing
    accuracy = 1 if broken else 2 if "factual_error" in flags else 5
    policy = (3 if "verbose" in flags else 1) if "ignores_constraint" in flags and not broken else 2 if broken else 5
    if q == 3:
        return {"accuracy": accuracy, "policy": policy, "helpfulness": rng.choice([4, 5, 5]), "tone": 5}
    if q == 2:
        return {"accuracy": accuracy, "policy": policy, "helpfulness": rng.choice([3, 4]), "tone": rng.choice([2, 3])}
    if not flags:  # right labels, a few cold words
        return {"accuracy": accuracy, "policy": policy, "helpfulness": 2, "tone": rng.choice([1, 2])}
    return {"accuracy": accuracy, "policy": policy, "helpfulness": rng.choice([3, 4]) if not broken else 2,
            "tone": rng.choice([3, 4])}


def _scores(v: dict, rng: random.Random) -> dict:
    q = v["q"]
    flags = set(v.get("flags", []))
    if q == 3:
        return {"instruction_following": 5, "correctness": 5, "explanation": rng.choice([4, 5, 5]), "concision": rng.choice([4, 5])}
    if q == 2:
        return {"instruction_following": rng.choice([4, 5]), "correctness": 5, "explanation": 2, "concision": 5}
    if q == 1:
        return {"instruction_following": 2, "correctness": 4 if "factual_error" not in flags else 2,
                "explanation": 3, "concision": 2 if "verbose" in flags else 3}
    return {"instruction_following": rng.choice([3, 4]) if "ignores_constraint" not in flags else 2,
            "correctness": 1, "explanation": rng.choice([2, 3]), "concision": rng.choice([3, 4])}


def _justify(preference: int, a: dict, b: dict) -> str:
    if preference == 0:
        return f"Both are right and nothing important separates them. A {a['note']}; B {b['note']}."
    w, wn, l_, ln = ("A", a["note"], "B", b["note"]) if preference < 0 else ("B", b["note"], "A", a["note"])
    if abs(preference) == 1 and a["q"] == b["q"]:
        return f"Close call. {w} {wn}, which reads a little better; {l_} {ln}."
    return f"{w} {wn}. {l_} {ln}."
