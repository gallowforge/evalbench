"""Blind pairwise rating and the statistics behind the human leaderboard.

Pairs are two answers to the same task from different models. Sides are shuffled, names are never
sent to the rater, and the next pair is the least-rated one, so coverage stays balanced across
model pairs. Preferences are fitted with a Bradley-Terry model, reported on an Elo-like scale with
bootstrap confidence intervals."""

from __future__ import annotations

import json
import math
import random
from collections import defaultdict
from functools import lru_cache
from itertools import combinations

from evalbench.db import Database, dumps, now
from evalbench.suites import FLAGS, PREFERENCE_LABELS, SCALE, Suite, parse_suite

FLAG_IDS = {f["id"] for f in FLAGS}


class RatingError(ValueError):
    pass


@lru_cache(maxsize=64)
def _suite_from_text(text: str) -> Suite:
    return parse_suite(text)


def scope_results(db: Database, *, run_id: int | None = None, suite_id: str | None = None) -> list[dict]:
    """Answers available for rating. A run scope uses that run; a suite scope uses each model's
    most recent answer to each task across all runs of the suite."""
    if run_id is not None:
        return db.all(
            """SELECT r.id, r.run_id, r.task_id, r.task_hash, r.model_id, r.output, u.suite_id, u.suite_yaml
               FROM results r JOIN runs u ON u.id=r.run_id
               WHERE r.run_id=? AND r.status='done' AND COALESCE(r.output,'')<>''""",
            (run_id,),
        )
    return db.all(
        """SELECT r.id, r.run_id, r.task_id, r.task_hash, r.model_id, r.output, u.suite_id, u.suite_yaml
           FROM results r JOIN runs u ON u.id=r.run_id
           WHERE u.suite_id=? AND r.status='done' AND COALESCE(r.output,'')<>''
             AND r.run_id = (SELECT MAX(r2.run_id) FROM results r2 JOIN runs u2 ON u2.id=r2.run_id
                             WHERE u2.suite_id=u.suite_id AND r2.task_id=r.task_id AND r2.model_id=r.model_id
                               AND r2.status='done')""",
        (suite_id,),
    )


def pair_key(a: int, b: int) -> str:
    return f"{min(a, b)}-{max(a, b)}"


def _candidate_pairs(results: list[dict]) -> list[tuple[dict, dict]]:
    by_task: dict[str, list[dict]] = defaultdict(list)
    for r in results:
        by_task[r["task_id"]].append(r)
    pairs = []
    for task_id in sorted(by_task):
        for x, y in combinations(sorted(by_task[task_id], key=lambda r: r["model_id"]), 2):
            # Same task version only: a pair never compares answers to two different prompts.
            if x["model_id"] != y["model_id"] and x["task_hash"] == y["task_hash"] and x["output"].strip() != y["output"].strip():
                pairs.append((x, y))
    return pairs


def progress(db: Database, rater: str, *, run_id: int | None = None, suite_id: str | None = None) -> dict:
    results = scope_results(db, run_id=run_id, suite_id=suite_id)
    pairs = _candidate_pairs(results)
    done = _rated_pairs(db, rater)
    rated = sum(1 for x, y in pairs if frozenset((x["id"], y["id"])) in done)
    return {"total": len(pairs), "rated": rated, "remaining": len(pairs) - rated}


def _rated_pairs(db: Database, rater: str) -> set[frozenset]:
    rows = db.all("SELECT result_a, result_b FROM ratings WHERE rater=?", (rater,))
    return {frozenset((r["result_a"], r["result_b"])) for r in rows}


def next_pair(
    db: Database, rater: str, *, run_id: int | None = None, suite_id: str | None = None, skip: list[str] | None = None,
    rng: random.Random | None = None,
) -> dict | None:
    """`skip` holds pair keys ("12-34", lower id first) the rater passed over in this session;
    they come back only once nothing else is left."""
    rng = rng or random.Random()
    results = scope_results(db, run_id=run_id, suite_id=suite_id)
    pairs = _candidate_pairs(results)
    done = _rated_pairs(db, rater)
    open_pairs = [(x, y) for x, y in pairs if frozenset((x["id"], y["id"])) not in done]
    if not open_pairs:
        return None
    skipped = set(skip or [])
    fresh = [(x, y) for x, y in open_pairs if pair_key(x["id"], y["id"]) not in skipped]
    choices = fresh or open_pairs
    pair_counts: dict[frozenset, int] = defaultdict(int)
    model_counts: dict[frozenset, int] = defaultdict(int)
    for r in db.all("SELECT result_a, result_b, model_a, model_b FROM ratings"):
        pair_counts[frozenset((r["result_a"], r["result_b"]))] += 1
        model_counts[frozenset((r["model_a"], r["model_b"]))] += 1
    rng.shuffle(choices)
    x, y = min(
        choices,
        key=lambda p: (pair_counts[frozenset((p[0]["id"], p[1]["id"]))], model_counts[frozenset((p[0]["model_id"], p[1]["model_id"]))]),
    )
    if rng.random() < 0.5:
        x, y = y, x
    suite = _suite_from_text(x["suite_yaml"])
    task = suite.task(x["task_id"])
    if task is None:
        return None
    return {
        "suite_id": x["suite_id"],
        "run_id": run_id,
        "task": {
            "id": task.id,
            "title": task.title or task.id,
            "category": task.category,
            "prompt": task.prompt,
            "system": suite.system_for(task),
            "reference": task.reference,
            "notes": task.notes,
        },
        "rubric": [d.model_dump() for d in suite.rubric_for(task)],
        "key": pair_key(x["id"], y["id"]),
        "a": {"result_id": x["id"], "output": x["output"]},
        "b": {"result_id": y["id"], "output": y["output"]},
        "progress": {"total": len(pairs), "rated": len(pairs) - len(open_pairs), "remaining": len(open_pairs)},
    }


def rating_options() -> dict:
    return {
        "flags": FLAGS,
        "scale": [{"value": k, "label": v} for k, v in SCALE.items()],
        "preference": [{"value": k, "label": v} for k, v in PREFERENCE_LABELS.items()],
        "confidence": ["low", "medium", "high"],
    }


def save_rating(db: Database, payload: dict, min_justification: int = 30) -> int:
    try:
        a_id, b_id = int(payload["result_a"]), int(payload["result_b"])
        preference = int(payload["preference"])
    except (KeyError, TypeError, ValueError):
        raise RatingError("result_a, result_b and preference are required") from None
    if preference not in PREFERENCE_LABELS:
        raise RatingError("preference must be between -3 (A much better) and 3 (B much better)")
    justification = str(payload.get("justification") or "").strip()
    if len(justification) < min_justification:
        raise RatingError(f"write at least {min_justification} characters explaining the choice")
    rows = {
        r["id"]: r
        for r in db.all(
            """SELECT r.id, r.task_id, r.task_hash, r.model_id, r.run_id, r.status, r.output, u.suite_id, u.suite_yaml
               FROM results r JOIN runs u ON u.id=r.run_id WHERE r.id IN (?,?)""",
            (a_id, b_id),
        )
    }
    if len(rows) != 2:
        raise RatingError("both answers must exist")
    a, b = rows[a_id], rows[b_id]
    if a["task_id"] != b["task_id"] or a["suite_id"] != b["suite_id"] or a["task_hash"] != b["task_hash"]:
        raise RatingError("both answers must be to the same version of the same task")
    if a["model_id"] == b["model_id"]:
        raise RatingError("compare answers from two different models")
    if any(r["status"] != "done" or not (r["output"] or "").strip() for r in (a, b)):
        raise RatingError("both answers must be finished")
    rater = str(payload.get("rater") or "").strip()[:40]
    already = db.scalar(
        "SELECT COUNT(*) FROM ratings WHERE rater=? AND ((result_a=? AND result_b=?) OR (result_a=? AND result_b=?))",
        (rater, a_id, b_id, b_id, a_id),
    )
    if already:
        raise RatingError("you have already rated this pair")
    suite = _suite_from_text(a["suite_yaml"])
    task = suite.task(a["task_id"])
    dims = {d.id for d in suite.rubric_for(task)} if task else set()
    raw_scores = payload.get("scores") or {}
    raw_flags = payload.get("flags") or {}
    if not isinstance(raw_scores, dict) or not isinstance(raw_flags, dict):
        raise RatingError("scores and flags are objects keyed by side, a and b")
    scores: dict[str, dict[str, int]] = {"a": {}, "b": {}}
    for side in ("a", "b"):
        side_scores = raw_scores.get(side) or {}
        if not isinstance(side_scores, dict):
            raise RatingError("scores for each side map rubric dimensions to 1-5")
        for dim, value in side_scores.items():
            if dim not in dims:
                raise RatingError(f"unknown rubric dimension '{dim}'")
            try:
                v = int(value)
            except (TypeError, ValueError):
                raise RatingError("rubric scores run from 1 to 5") from None
            if v not in SCALE:
                raise RatingError("rubric scores run from 1 to 5")
            scores[side][dim] = v
    flags = {}
    for side in ("a", "b"):
        side_flags = raw_flags.get(side) or []
        if not isinstance(side_flags, list):
            raise RatingError("flags for each side are a list")
        flags[side] = sorted({f for f in side_flags if f in FLAG_IDS})
    confidence = payload.get("confidence")
    if confidence not in (None, "", "low", "medium", "high"):
        raise RatingError("confidence is low, medium or high")
    try:
        seconds = payload.get("seconds")
        seconds = max(0, min(int(seconds), 86_400)) if seconds not in (None, "") else None
        run_id = int(payload["run_id"]) if payload.get("run_id") not in (None, "") else None
    except (TypeError, ValueError):
        raise RatingError("seconds and run_id are numbers") from None
    return db.insert(
        """INSERT INTO ratings(suite_id, run_id, task_id, result_a, result_b, model_a, model_b, preference,
           scores, flags, justification, confidence, rater, seconds, created_at)
           VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (
            a["suite_id"], run_id, a["task_id"], a_id, b_id, a["model_id"], b["model_id"],
            preference, dumps(scores), dumps(flags), justification, confidence or None,
            rater, seconds, payload.get("created_at") or now(),
        ),
    )


# ---------- statistics ----------

def matches(db: Database, suite_id: str) -> list[tuple[int, int, float]]:
    """(model_a, model_b, score of A): 1 = A preferred, 0 = B preferred, 0.5 = about the same."""
    out = []
    for r in db.all("SELECT model_a, model_b, preference FROM ratings WHERE suite_id=?", (suite_id,)):
        p = r["preference"]
        out.append((r["model_a"], r["model_b"], 1.0 if p < 0 else 0.0 if p > 0 else 0.5))
    return out


def bradley_terry(games: list[tuple[int, int, float]], prior: float = 1.0, iters: int = 300) -> dict[int, float]:
    """Strengths by minorise-maximise (Hunter, 2004). Each model also plays `prior` virtual draws
    against a fixed reference of strength 1, which keeps unbeaten or winless models finite.
    Returns ratings on an Elo-like scale centred on 1000 (400 points = 10:1 odds)."""
    players = sorted({p for a, b, _ in games for p in (a, b)})
    if not players:
        return {}
    wins = defaultdict(float)
    n: dict[tuple[int, int], float] = defaultdict(float)
    for a, b, s in games:
        wins[a] += s
        wins[b] += 1 - s
        n[(a, b)] += 1
        n[(b, a)] += 1
    strength = dict.fromkeys(players, 1.0)
    for _ in range(iters):
        new = {}
        for i in players:
            denom = prior / (strength[i] + 1.0)
            for j in players:
                if (i, j) in n:
                    denom += n[(i, j)] / (strength[i] + strength[j])
            new[i] = (wins[i] + prior * 0.5) / denom
        delta = max(abs(math.log(new[i] / strength[i])) for i in players)
        strength = new
        if delta < 1e-10:
            break
    centre = sum(math.log10(s) for s in strength.values()) / len(players)
    return {p: 1000 + 400 * (math.log10(strength[p]) - centre) for p in players}


def bootstrap(games: list[tuple[int, int, float]], rounds: int = 200, seed: int = 7) -> dict[int, tuple[float, float]]:
    """95% intervals from resampling the ratings with replacement."""
    if len(games) < 2:
        return {}
    rng = random.Random(seed)
    samples: dict[int, list[float]] = defaultdict(list)
    for _ in range(rounds):
        resample = [games[rng.randrange(len(games))] for _ in games]
        for p, r in bradley_terry(resample, iters=120).items():
            samples[p].append(r)
    out = {}
    for p, values in samples.items():
        values.sort()
        lo = values[int(0.025 * (len(values) - 1))]
        hi = values[int(0.975 * (len(values) - 1))]
        out[p] = (lo, hi)
    return out


def human_board(db: Database, suite_id: str) -> dict:
    games = matches(db, suite_id)
    ratings = bradley_terry(games)
    ci = bootstrap(games)
    record: dict[int, dict] = defaultdict(lambda: {"wins": 0.0, "games": 0, "ties": 0})
    h2h: dict[str, dict] = {}
    for a, b, s in games:
        for p, score in ((a, s), (b, 1 - s)):
            record[p]["wins"] += score
            record[p]["games"] += 1
            record[p]["ties"] += 1 if s == 0.5 else 0
        key, flip = (f"{a}-{b}", False) if a < b else (f"{b}-{a}", True)
        cell = h2h.setdefault(key, {"wins": 0.0, "games": 0})
        cell["wins"] += (1 - s) if flip else s  # wins of the lower id
        cell["games"] += 1
    models = {}
    for p, r in ratings.items():
        rec = record[p]
        models[p] = {
            "rating": round(r, 1),
            "ci": [round(ci[p][0], 1), round(ci[p][1], 1)] if p in ci else None,
            "win_rate": round(rec["wins"] / rec["games"], 4) if rec["games"] else None,
            "games": rec["games"],
            "ties": rec["ties"],
        }
    return {"models": models, "h2h": h2h, "count": len(games)}


def rating_rows(db: Database, suite_id: str | None = None, limit: int | None = None) -> list[dict]:
    sql = "SELECT * FROM ratings" + (" WHERE suite_id=?" if suite_id else "") + " ORDER BY id DESC"
    if limit:
        sql += f" LIMIT {int(limit)}"
    rows = db.all(sql, (suite_id,) if suite_id else ())
    for r in rows:
        r["scores"] = json.loads(r["scores"])
        r["flags"] = json.loads(r["flags"])
        r["preference_label"] = PREFERENCE_LABELS[r["preference"]]
    return rows
