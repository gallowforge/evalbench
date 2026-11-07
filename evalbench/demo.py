"""The demo workspace: six weekly runs of the core battery against four fictional models, plus a few
dozen blind ratings. Answers are scripted (data/demo/answers.yaml) but every check result,
pass rate, rating and regression is computed by the same code that grades real runs.

The models are invented (Nimbus Pro, Atlas 70B, Orion Mini, Vega 8B) and their hosts are
placeholders, so nothing here describes a real product."""

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

ANSWERS = Path(__file__).parent / "data" / "demo" / "answers.yaml"
SUITE_ID = "core-battery"

MODELS = [
    {"label": "Nimbus Pro", "base_url": "https://api.example.com/v1", "model": "nimbus-pro",
     "api_key_env": "NIMBUS_API_KEY", "concurrency": 4, "color": "#3987e5",
     "skill": [None, 0.78, 0.80, 0.82, 0.83, 0.84], "speed": (380, 16), "pick": 0},
    {"label": "Atlas 70B", "base_url": "http://192.168.1.40:1234/v1", "model": "atlas-70b-instruct",
     "api_key_env": None, "concurrency": 1, "color": "#d95926",
     "skill": [0.70, 0.72, 0.73, 0.76, 0.78, 0.80], "speed": (900, 42), "pick": 1},
    {"label": "Orion Mini", "base_url": "https://api.example.com/v1", "model": "orion-mini",
     "api_key_env": "NIMBUS_API_KEY", "concurrency": 8, "color": "#199e70",
     "skill": [0.52, 0.55, 0.58, 0.60, 0.62, 0.66], "speed": (240, 7), "pick": -1},
    {"label": "Vega 8B", "base_url": "http://192.168.1.40:11434/v1", "model": "vega-8b-q4",
     "api_key_env": None, "concurrency": 1, "color": "#c98500",
     "skill": [0.36, 0.42, 0.49, 0.55, 0.62, 0.42], "speed": (300, 20), "pick": 0},
]
RUN_LABELS = ["baseline", "weekly", "weekly", "new sampling defaults", "weekly", "vega 8b re-quantised"]
EASY = {"r01-ages", "r05-tank", "c05-primes", "d01-window", "d05-dict-mutation", "c02-json"}
HARD = {"r03-seating", "r06-sevens", "r07-clock", "c03-lipogram", "c06-explain", "d02-default-arg", "d04-durations"}


def _stamp(t: datetime) -> str:
    return t.strftime("%Y-%m-%dT%H:%M:%SZ")


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

    model_ids = []
    for m in MODELS:
        model_ids.append(
            db.insert(
                """INSERT INTO models(label, provider, base_url, model, api_key_env, params, concurrency, color, created_at)
                   VALUES(?,?,?,?,?,?,?,?,?)""",
                (m["label"], "openai-compatible", m["base_url"], m["model"], m["api_key_env"],
                 dumps({"temperature": 0, "max_tokens": 4096}), m["concurrency"], m["color"],
                 _stamp(today - timedelta(days=50))),
            )
        )

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
            snap = {"id": model_ids[i], "label": m["label"], "provider": "openai-compatible", "base_url": m["base_url"],
                    "model": m["model"], "api_key_env": m["api_key_env"], "params": {"temperature": 0, "max_tokens": 4096},
                    "concurrency": m["concurrency"], "color": m["color"]}
            db.execute("INSERT INTO run_models(run_id, model_id, snapshot) VALUES(?,?,?)", (run_id, model_ids[i], dumps(snap)))
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
                db.execute(
                    """INSERT INTO results(run_id, task_id, task_hash, category, model_id, status, output, finish_reason,
                       latency_ms, input_tokens, output_tokens, checks, score, passed, completed_at)
                       VALUES(?,?,?,?,?,'done',?,?,?,?,?,?,?,?,?)""",
                    (run_id, task.id, task_hash(suite, task), task.category, model_ids[i], v["text"].rstrip("\n"), "stop",
                     latency, in_tokens, out_tokens, dumps(checks), score, None if passed is None else int(passed),
                     _stamp(started + timedelta(seconds=clock))),
                )
                picks[run_id][(i, task.id)] = v
            longest = max(longest, clock)
        db.execute("UPDATE runs SET finished_at=? WHERE id=?", (_stamp(started + timedelta(seconds=longest + 2)), run_id))

    rated = 0
    for share, run_id in ((0.32, run_ids[-2]), (0.62, run_ids[-1])):
        finished = datetime.strptime(db.scalar("SELECT finished_at FROM runs WHERE id=?", (run_id,)), "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=UTC)
        rows = db.all("SELECT id, task_id, model_id FROM results WHERE run_id=?", (run_id,))
        index = {(r["model_id"], r["task_id"]): r["id"] for r in rows}
        for task in suite.tasks:
            members = [i for i in range(len(MODELS)) if (model_ids[i], task.id) in index]
            for x, y in combinations(members, 2):
                vx, vy = picks[run_id][(x, task.id)], picks[run_id][(y, task.id)]
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
                when = finished + timedelta(hours=rng.uniform(2, 40))
                if when > today:
                    when = today - timedelta(minutes=rng.randint(20, 300))
                save_rating(
                    db,
                    {
                        "result_a": index[(model_ids[x], task.id)],
                        "result_b": index[(model_ids[y], task.id)],
                        "run_id": run_id,
                        "preference": preference,
                        "scores": {"a": _scores(vx, rng), "b": _scores(vy, rng)},
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

    db.set_meta("demo", "1")
    return {"ok": True, "runs": len(run_ids), "models": len(model_ids), "ratings": rated}


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
