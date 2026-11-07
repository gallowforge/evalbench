"""Aggregates for the run page, the scoreboard and the overview: pass rates, categories, history
over time and regressions between consecutive runs of the same model."""

from __future__ import annotations

import json
import statistics
from collections import defaultdict
from functools import lru_cache

from evalbench.db import Database
from evalbench.ratings import human_board, progress
from evalbench.runner import run_models
from evalbench.suites import SuiteError, parse_suite


def _median(values: list[float]) -> float | None:
    return round(statistics.median(values), 1) if values else None


def summarize(results: list[dict], unscored: frozenset[str] = frozenset()) -> dict:
    """Pass rate counts an errored answer to a graded task as not passed: an answer that never
    arrived is not a pass, and leaving it out would flatter a model that keeps timing out."""
    done = [r for r in results if r["status"] == "done"]
    scored = [r for r in done if r["passed"] is not None]
    failed_to_answer = [r for r in results if r["status"] == "error" and r["task_id"] not in unscored]
    attempted = len(scored) + len(failed_to_answer)
    passed = sum(int(r["passed"]) for r in scored)
    cats: dict[str, list[int]] = defaultdict(list)
    for r in scored:
        cats[r["category"]].append(int(r["passed"]))
    for r in failed_to_answer:
        cats[r["category"]].append(0)
    return {
        "total": len(results),
        "done": len(done),
        "errors": sum(1 for r in results if r["status"] == "error"),
        "pending": sum(1 for r in results if r["status"] in ("pending", "running")),
        "scored": len(scored),
        "attempted": attempted,
        "passed": passed,
        "pass_rate": round(passed / attempted, 4) if attempted else None,
        "mean_score": round(sum(r["score"] for r in scored) / attempted, 4) if attempted else None,
        "latency_ms": _median([r["latency_ms"] for r in done if r["latency_ms"] is not None]),
        "output_tokens": round(sum(r["output_tokens"] or 0 for r in done) / len(done)) if done else None,
        "categories": {c: round(sum(v) / len(v), 4) for c, v in cats.items()},
    }


@lru_cache(maxsize=256)
def _unscored(suite_yaml: str) -> frozenset[str]:
    try:
        return frozenset(t.id for t in parse_suite(suite_yaml).tasks if not t.checks)
    except SuiteError:
        return frozenset()


RESULT_COLS = "id, run_id, task_id, task_hash, category, model_id, status, score, passed, latency_ms, input_tokens, output_tokens, finish_reason, error, checks"


def run_list(db: Database, suite_id: str | None = None, limit: int = 100) -> list[dict]:
    sql = "SELECT id, suite_id, suite_title, suite_yaml, label, status, created_at, started_at, finished_at FROM runs"
    params: tuple = ()
    if suite_id:
        sql += " WHERE suite_id=?"
        params = (suite_id,)
    runs = db.all(sql + f" ORDER BY id DESC LIMIT {int(limit)}", params)
    for run in runs:
        results = db.all(f"SELECT {RESULT_COLS} FROM results WHERE run_id=?", (run["id"],))
        by_model: dict[int, list[dict]] = defaultdict(list)
        for r in results:
            by_model[r["model_id"]].append(r)
        unscored = _unscored(run.pop("suite_yaml"))
        run["models"] = [
            {"id": m["id"], "label": m["label"], "color": m["color"], **_brief(summarize(by_model[m["id"]], unscored))}
            for m in run_models(db, run["id"])
        ]
        total = len(results)
        finished = sum(1 for r in results if r["status"] in ("done", "error"))
        run["progress"] = {"total": total, "finished": finished}
        run["tasks"] = len({r["task_id"] for r in results})
    return runs


def _brief(s: dict) -> dict:
    return {k: s[k] for k in ("pass_rate", "mean_score", "errors", "latency_ms", "scored", "attempted", "passed")}


def run_detail(db: Database, run_id: int) -> dict | None:
    run = db.one("SELECT * FROM runs WHERE id=?", (run_id,))
    if not run:
        return None
    suite_yaml = run.pop("suite_yaml")
    suite = parse_suite(suite_yaml)
    unscored = _unscored(suite_yaml)
    results = db.all(f"SELECT {RESULT_COLS} FROM results WHERE run_id=? ORDER BY id", (run_id,))
    for r in results:
        r["checks"] = json.loads(r["checks"])
    models = run_models(db, run_id)
    by_model: dict[int, list[dict]] = defaultdict(list)
    for r in results:
        by_model[r["model_id"]].append(r)
    finished = sum(1 for r in results if r["status"] in ("done", "error"))
    return {
        **run,
        "tasks": [
            {"id": t.id, "title": t.title or t.id, "category": t.category, "checks": len(t.checks)} for t in suite.tasks
        ],
        "categories": suite.categories(),
        "models": [{**m, "summary": summarize(by_model[m["id"]], unscored)} for m in models],
        "results": results,
        "progress": {"total": len(results), "finished": finished},
        "rating": progress(db, "", run_id=run_id),
    }


def task_answers(db: Database, run_id: int, task_id: str) -> dict | None:
    run = db.one("SELECT suite_yaml FROM runs WHERE id=?", (run_id,))
    if not run:
        return None
    suite = parse_suite(run["suite_yaml"])
    task = suite.task(task_id)
    if not task:
        return None
    rows = db.all(
        "SELECT * FROM results WHERE run_id=? AND task_id=? ORDER BY model_id", (run_id, task_id)
    )
    for r in rows:
        r["checks"] = json.loads(r["checks"])
    return {
        "task": {
            **task.model_dump(mode="json", exclude={"rubric"}),
            "system": suite.system_for(task),
        },
        "answers": rows,
    }


def _model_meta(db: Database, run_ids: list[int]) -> dict[int, dict]:
    meta: dict[int, dict] = {}
    for run_id in run_ids:
        for m in run_models(db, run_id):
            meta[m["id"]] = {"id": m["id"], "label": m["label"], "color": m["color"], "provider": m.get("provider"), "model": m.get("model")}
    return meta


def scoreboard(db: Database, suite_id: str) -> dict:
    runs = db.all(
        "SELECT id, label, status, created_at, suite_yaml FROM runs WHERE suite_id=? ORDER BY id", (suite_id,)
    )
    run_ids = [r["id"] for r in runs]
    yaml_of = {r["id"]: r["suite_yaml"] for r in runs}
    meta = _model_meta(db, run_ids)
    results = db.all(
        f"SELECT {RESULT_COLS} FROM results WHERE run_id IN (SELECT id FROM runs WHERE suite_id=?) ORDER BY run_id",
        (suite_id,),
    )
    by_run_model: dict[tuple[int, int], list[dict]] = defaultdict(list)
    for r in results:
        by_run_model[(r["run_id"], r["model_id"])].append(r)

    history = []
    for run in runs:
        point = {"run_id": run["id"], "label": run["label"], "created_at": run["created_at"], "models": {}}
        for (rid, mid), rows in by_run_model.items():
            if rid == run["id"]:
                s = summarize(rows, _unscored(run["suite_yaml"]))
                if s["pass_rate"] is not None:
                    point["models"][mid] = {"pass_rate": s["pass_rate"], "mean_score": s["mean_score"]}
        if point["models"]:
            history.append(point)

    latest: dict[int, dict] = {}
    regressions = []
    for mid in meta:
        model_runs = [rid for rid in run_ids if any(r["status"] in ("done", "error") for r in by_run_model.get((rid, mid), []))]
        if not model_runs:
            continue
        last = model_runs[-1]
        rows = by_run_model[(last, mid)]
        latest[mid] = {"run_id": last, **summarize(rows, _unscored(yaml_of[last]))}
        if len(model_runs) >= 2:
            prev = model_runs[-2]
            before = {r["task_id"]: r for r in by_run_model[(prev, mid)] if r["passed"] is not None}
            after = {r["task_id"]: r for r in rows if r["passed"] is not None or r["status"] == "error"}
            changes = []
            for task_id, now_r in after.items():
                was = before.get(task_id)
                if not was:
                    continue
                if now_r["status"] == "error":
                    kind = "errored" if was["passed"] else None
                elif was["passed"] == now_r["passed"]:
                    kind = None
                elif was["task_hash"] != now_r["task_hash"]:
                    kind = "task_changed"
                else:
                    kind = "regression" if was["passed"] else "fixed"
                if kind:
                    changes.append({"task_id": task_id, "category": now_r["category"], "kind": kind, "result_id": now_r["id"]})
            regressions.append(
                {
                    "model_id": mid,
                    "from_run": prev,
                    "to_run": last,
                    "regressed": sum(1 for c in changes if c["kind"] == "regression"),
                    "fixed": sum(1 for c in changes if c["kind"] == "fixed"),
                    "changes": sorted(changes, key=lambda c: (c["kind"] != "regression", c["task_id"])),
                }
            )

    human = human_board(db, suite_id)
    titles: dict[str, str] = {}
    categories: list[str] = []
    if runs:
        try:
            suite = parse_suite(runs[-1]["suite_yaml"])
            titles = {t.id: t.title or t.id for t in suite.tasks}
            categories = suite.categories()
        except SuiteError:
            pass
    rows = []
    for mid, m in meta.items():
        if mid not in latest and mid not in human["models"]:
            continue
        rows.append({**m, "auto": latest.get(mid), "human": human["models"].get(mid)})
    rows.sort(
        key=lambda r: (
            -((r["auto"] or {}).get("pass_rate") or 0),
            -(r["human"]["rating"] if r["human"] else 0),
            -((r["auto"] or {}).get("mean_score") or 0),
        )
    )
    return {
        "suite_id": suite_id,
        "models": rows,
        "categories": categories,
        "task_titles": titles,
        "history": history,
        "regressions": regressions,
        "h2h": human["h2h"],
        "ratings": human["count"],
        "runs": len(runs),
    }


def overview(db: Database) -> dict:
    suites = db.all("SELECT id, title FROM suites ORDER BY title")
    boards = []
    for s in suites:
        if not db.scalar("SELECT COUNT(*) FROM runs WHERE suite_id=?", (s["id"],)):
            continue
        board = scoreboard(db, s["id"])
        boards.append({"id": s["id"], "title": s["title"], **board})
    to_rate = []
    for s in suites:
        p = progress(db, "", suite_id=s["id"])
        if p["total"]:
            to_rate.append({"suite_id": s["id"], "title": s["title"], **p})
    return {
        "counts": {
            "suites": len(suites),
            "models": db.scalar("SELECT COUNT(*) FROM models WHERE archived=0"),
            "runs": db.scalar("SELECT COUNT(*) FROM runs"),
            "answers": db.scalar("SELECT COUNT(*) FROM results WHERE status='done'"),
            "ratings": db.scalar("SELECT COUNT(*) FROM ratings"),
            "checks_run": db.scalar(
                "SELECT COALESCE(SUM(json_array_length(checks)),0) FROM results WHERE status='done'"
            ),
        },
        "boards": boards,
        "recent_runs": run_list(db, limit=6),
        "rating": to_rate,
        "demo": db.get_meta("demo") == "1",
    }
