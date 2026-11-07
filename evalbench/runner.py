"""Runs: every task in a suite against every chosen model, graded as answers arrive.

A run snapshots the suite text and each model's settings when it is created, so editing a suite or
a model later never rewrites history. Work is limited twice: a global cap and each model's own
concurrency (a local model on one GPU usually wants 1)."""

from __future__ import annotations

import asyncio
import json
import logging

from evalbench.checks import grade
from evalbench.db import Database, dumps, now
from evalbench.providers import Completion, ProviderError, ProviderPool
from evalbench.sandbox import Sandbox, SandboxUnavailable
from evalbench.store import get_model, get_suite_row
from evalbench.suites import parse_suite, task_hash

log = logging.getLogger("evalbench.runner")

SNAPSHOT_KEYS = ("id", "label", "provider", "base_url", "model", "api_key_env", "params", "concurrency", "color")


class RunError(ValueError):
    pass


def create_run(db: Database, suite_id: str, model_ids: list[int], label: str = "") -> int:
    row = get_suite_row(db, suite_id)
    if not row:
        raise RunError(f"no suite '{suite_id}'")
    suite = parse_suite(row["yaml"])
    ids = list(dict.fromkeys(int(m) for m in model_ids))
    if not ids:
        raise RunError("choose at least one model")
    models = []
    for model_id in ids:
        m = get_model(db, model_id)
        if not m or m["archived"]:
            raise RunError(f"model {model_id} does not exist")
        models.append(m)
    with db.tx() as conn:
        run_id = conn.execute(
            "INSERT INTO runs(suite_id, suite_title, suite_yaml, label, status, created_at) VALUES(?,?,?,?,?,?)",
            (suite.id, suite.title, row["yaml"], label.strip()[:80], "queued", now()),
        ).lastrowid
        for m in models:
            conn.execute(
                "INSERT INTO run_models(run_id, model_id, snapshot) VALUES(?,?,?)",
                (run_id, m["id"], dumps({k: m[k] for k in SNAPSHOT_KEYS})),
            )
        for task in suite.tasks:
            h = task_hash(suite, task)
            for m in models:
                conn.execute(
                    "INSERT INTO results(run_id, task_id, task_hash, category, model_id) VALUES(?,?,?,?,?)",
                    (run_id, task.id, h, task.category, m["id"]),
                )
    return int(run_id)


def run_models(db: Database, run_id: int) -> list[dict]:
    rows = db.all("SELECT model_id, snapshot FROM run_models WHERE run_id=? ORDER BY rowid", (run_id,))
    out = []
    for r in rows:
        snap = json.loads(r["snapshot"])
        current = db.one("SELECT label, color FROM models WHERE id=?", (r["model_id"],))
        if current:  # show today's name and colour; the settings stay as they were
            snap["label"], snap["color"] = current["label"], current["color"] or snap.get("color")
        out.append(snap)
    return out


class RunManager:
    def __init__(self, db: Database, pool: ProviderPool, sandbox: Sandbox, concurrency: int = 8):
        self.db = db
        self.pool = pool
        self.sandbox = sandbox
        self.concurrency = concurrency
        self._tasks: dict[int, asyncio.Task] = {}
        self._cancelled: set[int] = set()

    def recover(self) -> int:
        """After a restart, runs that were in flight are marked interrupted and can be resumed."""
        self.db.execute("UPDATE results SET status='pending' WHERE status='running'")
        cur = self.db.execute(
            "UPDATE runs SET status='interrupted' WHERE status IN ('queued','running')"
        )
        return cur.rowcount

    def active(self, run_id: int) -> bool:
        task = self._tasks.get(run_id)
        return bool(task and not task.done())

    def start(self, run_id: int) -> None:
        if self.active(run_id):
            return
        self._cancelled.discard(run_id)
        self._tasks[run_id] = asyncio.create_task(self._execute(run_id), name=f"run-{run_id}")

    def resume(self, run_id: int) -> None:
        if self.active(run_id):
            raise RunError("the run is still in progress")
        self.db.execute(
            "UPDATE results SET status='pending', error=NULL WHERE run_id=? AND status IN ('error','running')",
            (run_id,),
        )
        self.db.execute("UPDATE runs SET status='queued', finished_at=NULL WHERE id=?", (run_id,))
        self.start(run_id)

    def cancel(self, run_id: int) -> None:
        self._cancelled.add(run_id)
        if not self.active(run_id):
            self.db.execute(
                "UPDATE runs SET status='cancelled', finished_at=? WHERE id=? AND status IN ('queued','interrupted')",
                (now(), run_id),
            )

    async def wait(self, run_id: int) -> None:
        task = self._tasks.get(run_id)
        if task:
            await task

    async def shutdown(self) -> None:
        for task in self._tasks.values():
            task.cancel()
        await asyncio.gather(*self._tasks.values(), return_exceptions=True)

    async def _execute(self, run_id: int) -> None:
        db = self.db
        run = db.one("SELECT * FROM runs WHERE id=?", (run_id,))
        if not run:
            return
        db.execute(
            "UPDATE runs SET status='running', started_at=COALESCE(started_at, ?) WHERE id=?", (now(), run_id)
        )
        suite = parse_suite(run["suite_yaml"])
        # Settings come from the snapshot taken at creation, never from today's edits.
        models = {
            r["model_id"]: json.loads(r["snapshot"])
            for r in db.all("SELECT model_id, snapshot FROM run_models WHERE run_id=?", (run_id,))
        }
        rows = db.all(
            "SELECT id, task_id, model_id, output, finish_reason, latency_ms, input_tokens, output_tokens FROM results WHERE run_id=? AND status='pending' ORDER BY id",
            (run_id,),
        )
        overall = asyncio.Semaphore(self.concurrency)
        per_model = {mid: asyncio.Semaphore(int(m.get("concurrency") or 1)) for mid, m in models.items()}

        async def one(row: dict) -> None:
            async with per_model[row["model_id"]], overall:
                if run_id in self._cancelled:
                    return
                task = suite.task(row["task_id"])
                model = models[row["model_id"]]
                db.execute("UPDATE results SET status='running' WHERE id=?", (row["id"],))
                if row["output"] is not None:
                    # Answered before, only the grading failed (sandbox outage): grade it again
                    # instead of paying for a second answer.
                    reply = Completion(row["output"], row["input_tokens"], row["output_tokens"], row["latency_ms"] or 0, row["finish_reason"])
                else:
                    try:
                        reply = await self.pool.complete(model, suite.system_for(task), task.prompt)
                    except ProviderError as e:
                        db.execute(
                            "UPDATE results SET status='error', error=?, completed_at=? WHERE id=?",
                            (str(e), now(), row["id"]),
                        )
                        return
                    except Exception as e:  # keep the run going; record what broke
                        log.exception("result %s failed", row["id"])
                        db.execute(
                            "UPDATE results SET status='error', error=?, completed_at=? WHERE id=?",
                            (f"{e.__class__.__name__}: {e}", now(), row["id"]),
                        )
                        return
                try:
                    checks, score, passed = await grade(task, reply.text, self.sandbox)
                except SandboxUnavailable as e:
                    # Keep the answer, mark the result as an error: resuming the run grades it again.
                    db.execute(
                        "UPDATE results SET status='error', output=?, error=?, finish_reason=?, latency_ms=?, input_tokens=?, output_tokens=?, completed_at=? WHERE id=?",
                        (reply.text, str(e), reply.finish_reason, reply.latency_ms, reply.input_tokens, reply.output_tokens, now(), row["id"]),
                    )
                    return
                db.execute(
                    """UPDATE results SET status='done', output=?, error=NULL, finish_reason=?, latency_ms=?,
                       input_tokens=?, output_tokens=?, checks=?, score=?, passed=?, completed_at=? WHERE id=?""",
                    (
                        reply.text,
                        reply.finish_reason,
                        reply.latency_ms,
                        reply.input_tokens,
                        reply.output_tokens,
                        dumps(checks),
                        score,
                        None if passed is None else int(passed),
                        now(),
                        row["id"],
                    ),
                )

        try:
            await asyncio.gather(*(one(r) for r in rows))
        except asyncio.CancelledError:
            db.execute("UPDATE results SET status='pending' WHERE run_id=? AND status='running'", (run_id,))
            db.execute("UPDATE runs SET status='interrupted' WHERE id=?", (run_id,))
            raise
        if run_id in self._cancelled:
            db.execute("UPDATE results SET status='pending' WHERE run_id=? AND status='running'", (run_id,))
            status = "cancelled"
        else:
            counts = {
                r["status"]: r["n"]
                for r in db.all("SELECT status, COUNT(*) AS n FROM results WHERE run_id=? GROUP BY status", (run_id,))
            }
            status = "failed" if counts.get("error") and not counts.get("done") else "done"
        db.execute("UPDATE runs SET status=?, finished_at=? WHERE id=?", (status, now(), run_id))
        self._cancelled.discard(run_id)
