"""Exports: human ratings as CSV or JSONL, preference pairs ready for DPO-style training, and raw
run results. Every export carries the prompt and both answers, so a file stands on its own."""

from __future__ import annotations

import csv
import io
import json
from collections.abc import Iterator

from evalbench.db import Database
from evalbench.ratings import _suite_from_text
from evalbench.suites import PREFERENCE_LABELS


def _labels(db: Database) -> dict[int, str]:
    labels = {r["id"]: r["label"] for r in db.all("SELECT id, label FROM models")}
    for r in db.all("SELECT model_id, snapshot FROM run_models"):
        labels.setdefault(r["model_id"], json.loads(r["snapshot"]).get("label", str(r["model_id"])))
    return labels


def rating_records(db: Database, suite_id: str | None = None) -> Iterator[dict]:
    sql = """SELECT g.*, ra.output AS output_a, rb.output AS output_b, u.suite_yaml, u.id AS answer_run
             FROM ratings g
             JOIN results ra ON ra.id=g.result_a
             JOIN results rb ON rb.id=g.result_b
             JOIN runs u ON u.id=ra.run_id"""
    params: tuple = ()
    if suite_id:
        sql += " WHERE g.suite_id=?"
        params = (suite_id,)
    labels = _labels(db)
    for g in db.all(sql + " ORDER BY g.id", params):
        suite = _suite_from_text(g["suite_yaml"])
        task = suite.task(g["task_id"])
        p = g["preference"]
        yield {
            "rating_id": g["id"],
            "created_at": g["created_at"],
            "rater": g["rater"],
            "suite": g["suite_id"],
            "run_id": g["answer_run"],
            "task_id": g["task_id"],
            "category": task.category if task else "",
            "system": suite.system_for(task) if task else None,
            "prompt": task.prompt if task else "",
            "response_a": g["output_a"],
            "response_b": g["output_b"],
            "model_a": labels.get(g["model_a"], str(g["model_a"])),
            "model_b": labels.get(g["model_b"], str(g["model_b"])),
            "preference": p,
            "preference_label": PREFERENCE_LABELS[p],
            "winner": "a" if p < 0 else "b" if p > 0 else "tie",
            "strength": abs(p),
            "scores": json.loads(g["scores"]),
            "flags": json.loads(g["flags"]),
            "justification": g["justification"],
            "confidence": g["confidence"],
            "seconds": g["seconds"],
        }


def ratings_jsonl(db: Database, suite_id: str | None = None) -> Iterator[str]:
    for rec in rating_records(db, suite_id):
        yield json.dumps(rec, ensure_ascii=False) + "\n"


def _cell(value):
    """Spreadsheets run cells that start with = + - or @ as formulas. Model output is untrusted,
    so such cells get a leading apostrophe in the CSV (the JSONL exports stay verbatim)."""
    if isinstance(value, str) and value[:1] in ("=", "+", "-", "@", "\t", "\r"):
        return "'" + value
    return value


def ratings_csv(db: Database, suite_id: str | None = None) -> str:
    records = list(rating_records(db, suite_id))
    dims = sorted({d for r in records for side in ("a", "b") for d in r["scores"].get(side, {})})
    base = [
        "rating_id", "created_at", "rater", "suite", "run_id", "task_id", "category", "prompt",
        "response_a", "response_b", "model_a", "model_b", "preference", "preference_label", "winner",
        "strength", "confidence", "seconds", "justification", "flags_a", "flags_b",
    ]
    header = base + [f"a_{d}" for d in dims] + [f"b_{d}" for d in dims]
    buf = io.StringIO()
    writer = csv.writer(buf, lineterminator="\n")
    writer.writerow(header)
    for r in records:
        row = [r[k] for k in base[:19]]
        row += ["|".join(r["flags"].get("a", [])), "|".join(r["flags"].get("b", []))]
        row += [r["scores"].get("a", {}).get(d, "") for d in dims]
        row += [r["scores"].get("b", {}).get(d, "") for d in dims]
        writer.writerow([_cell(v) for v in row])
    return buf.getvalue()


def preference_pairs(db: Database, suite_id: str | None = None, min_strength: int = 1) -> Iterator[str]:
    """One line per decisive rating: {prompt, chosen, rejected}. Ties are left out."""
    for r in rating_records(db, suite_id):
        if r["winner"] == "tie" or r["strength"] < min_strength:
            continue
        a_wins = r["winner"] == "a"
        record = {
            "prompt": r["prompt"],
            "chosen": r["response_a"] if a_wins else r["response_b"],
            "rejected": r["response_b"] if a_wins else r["response_a"],
            "system": r["system"],
            "meta": {
                "suite": r["suite"],
                "task_id": r["task_id"],
                "chosen_model": r["model_a"] if a_wins else r["model_b"],
                "rejected_model": r["model_b"] if a_wins else r["model_a"],
                "strength": r["strength"],
                "rating_id": r["rating_id"],
                "justification": r["justification"],
            },
        }
        yield json.dumps(record, ensure_ascii=False) + "\n"


def results_jsonl(db: Database, run_id: int | None = None, suite_id: str | None = None) -> Iterator[str]:
    sql = """SELECT r.*, u.suite_id, u.label AS run_label FROM results r JOIN runs u ON u.id=r.run_id
             WHERE r.status IN ('done','error')"""
    params: list = []
    if run_id is not None:
        sql += " AND r.run_id=?"
        params.append(run_id)
    if suite_id:
        sql += " AND u.suite_id=?"
        params.append(suite_id)
    labels = _labels(db)
    for r in db.all(sql + " ORDER BY r.id", tuple(params)):
        yield json.dumps(
            {
                "result_id": r["id"],
                "run_id": r["run_id"],
                "run_label": r["run_label"],
                "suite": r["suite_id"],
                "task_id": r["task_id"],
                "task_hash": r["task_hash"],
                "category": r["category"],
                "model": labels.get(r["model_id"], str(r["model_id"])),
                "status": r["status"],
                "output": r["output"],
                "error": r["error"],
                "finish_reason": r["finish_reason"],
                "checks": json.loads(r["checks"]),
                "score": r["score"],
                "passed": None if r["passed"] is None else bool(r["passed"]),
                "latency_ms": r["latency_ms"],
                "input_tokens": r["input_tokens"],
                "output_tokens": r["output_tokens"],
                "completed_at": r["completed_at"],
            },
            ensure_ascii=False,
        ) + "\n"
