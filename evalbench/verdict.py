"""The verdict: which model should do this job.

Each model is judged on its most recent run of the suite. It clears the bar when the share of
tasks it got right is at or above the bar. Among the models that clear, the pick is the cheapest
one (or the fastest); a tie goes to the more accurate model. The rule is small on purpose: every
number it uses is on the page, so the pick can be checked by hand.

`decide`, `need` and `wilson` are pure and have twins in web/src/lib/verdict.ts. Both sides run
the cases in tests/verdict-cases.json, so the browser and the server cannot drift apart."""

from __future__ import annotations

import json
import math
from collections import defaultdict

from evalbench.db import Database
from evalbench.ratings import human_board
from evalbench.stats import RESULT_COLS, _unscored, summarize
from evalbench.suites import SuiteError, parse_suite

DEFAULT_BAR = 0.9
OBJECTIVES = ("cost", "speed")


def need(bar: float, attempted: int) -> int:
    """The fewest right answers out of `attempted` that reach the bar."""
    return max(0, math.ceil(bar * attempted - 1e-9))


def wilson(passed: int, attempted: int, z: float = 1.96) -> list[float] | None:
    """The range the true pass rate plausibly lies in (Wilson score interval, 95%). It is wide on
    a small suite, and that is the point of showing it."""
    if not attempted:
        return None
    p = passed / attempted
    d = 1 + z * z / attempted
    centre = (p + z * z / (2 * attempted)) / d
    half = z * math.sqrt(p * (1 - p) / attempted + z * z / (4 * attempted * attempted)) / d
    return [round(max(0.0, centre - half), 4), round(min(1.0, centre + half), 4)]


def decide(candidates: list[dict], bar: float = DEFAULT_BAR, objective: str = "cost") -> dict:
    """candidates: [{id, passed, attempted, cost, latency_ms}]. cost (dollars per 1,000 answers)
    and latency_ms may be None; a model without the number being optimised ranks after the ones
    that have it, so an unpriced model is never called the cheapest."""
    if objective not in OBJECTIVES:
        raise ValueError(f"objective must be one of {', '.join(OBJECTIVES)}")
    metric, other = ("cost", "latency_ms") if objective == "cost" else ("latency_ms", "cost")
    judged = [c for c in candidates if c.get("attempted")]

    def rate(c: dict) -> float:
        return c["passed"] / c["attempted"]

    def by_metric(c: dict) -> tuple:
        a, b = c.get(metric), c.get(other)
        return (a is None, a or 0, -rate(c), b is None, b or 0, c["id"])

    def by_rate(c: dict) -> tuple:
        a = c.get(metric)
        return (-rate(c), a is None, a or 0, c["id"])

    rows: dict[int, dict] = {}
    for c in judged:
        n = need(bar, c["attempted"])
        rows[c["id"]] = {"need": n, "margin": c["passed"] - n, "clears": c["passed"] >= n, "beaten_by": []}
    # A model is beaten when another one is at least as accurate and at least as cheap (or fast),
    # and strictly better on one of the two. Beaten models are never worth choosing at any bar.
    for c in judged:
        if c.get(metric) is None:
            continue
        better = [
            o
            for o in judged
            if o["id"] != c["id"]
            and o.get(metric) is not None
            and rate(o) >= rate(c)
            and o[metric] <= c[metric]
            and (rate(o) > rate(c) or o[metric] < c[metric])
        ]
        rows[c["id"]]["beaten_by"] = [o["id"] for o in sorted(better, key=by_metric)]
    order = [c["id"] for c in sorted((c for c in judged if rows[c["id"]]["clears"]), key=by_metric)]
    ranked = sorted(judged, key=by_rate)
    known = {c["id"] for c in judged if c.get(metric) is not None}
    return {
        "bar": bar,
        "objective": objective,
        "pick": order[0] if order else None,
        "order": order,
        "best": ranked[0]["id"] if ranked else None,
        "unranked": [i for i in order if i not in known],
        "rows": rows,
    }


def cost_per_1k(rows: list[dict], price_in: float | None, price_out: float | None) -> float | None:
    """Dollars for 1,000 answers at these prices (per million tokens), from the tokens the run
    really used. None when a price is missing or no answer reported its tokens."""
    if price_in is None or price_out is None:
        return None
    used = [r for r in rows if r["status"] == "done" and r["input_tokens"] is not None and r["output_tokens"] is not None]
    if not used:
        return None
    total = sum(r["input_tokens"] * price_in + r["output_tokens"] * price_out for r in used)
    return round(total / len(used) / 1000, 6)


def _mean(values: list[float]) -> float | None:
    return round(sum(values) / len(values), 1) if values else None


def _why(row: dict) -> str:
    """One line on why an answer did not pass: the first check it failed, or the error."""
    if row["status"] == "error":
        return row["error"] or "no answer"
    for c in json.loads(row["checks"] or "[]"):
        if not c.get("passed"):
            return c.get("label") or c.get("type") or "a check failed"
    return ""


def _candidate(rows: list[dict], unscored: frozenset[str], prices: dict) -> dict | None:
    s = summarize(rows, unscored)
    if not s["attempted"]:
        return None
    done = [r for r in rows if r["status"] == "done"]
    cats: dict[str, list[int]] = defaultdict(lambda: [0, 0])
    tasks: dict[str, dict] = {}
    for r in rows:
        if r["task_id"] in unscored or r["status"] not in ("done", "error"):
            continue
        if r["status"] == "done" and r["passed"] is None:
            continue
        ok = r["status"] == "done" and bool(r["passed"])
        cats[r["category"]][0] += int(ok)
        cats[r["category"]][1] += 1
        tasks[r["task_id"]] = {"ok": ok, "result_id": r["id"], **({} if ok else {"why": _why(r)})}
    return {
        "passed": s["passed"],
        "attempted": s["attempted"],
        "pass_rate": s["pass_rate"],
        "interval": wilson(s["passed"], s["attempted"]),
        "errors": s["errors"],
        "latency_ms": s["latency_ms"],
        "input_tokens": _mean([r["input_tokens"] for r in done if r["input_tokens"] is not None]),
        "output_tokens": _mean([r["output_tokens"] for r in done if r["output_tokens"] is not None]),
        "cost": cost_per_1k(rows, prices.get("price_in"), prices.get("price_out")),
        "categories": dict(cats),
        "tasks": tasks,
    }


def verdict(db: Database, suite_id: str) -> dict | None:
    """Everything the verdict page shows for one suite, with the decision at the suite's own bar.
    The page recomputes the decision as the bar moves; the evidence underneath does not change."""
    stored = db.one("SELECT title, description, yaml FROM suites WHERE id=?", (suite_id,))
    runs = db.all(
        "SELECT id, label, status, created_at, suite_title, suite_yaml FROM runs WHERE suite_id=? ORDER BY id",
        (suite_id,),
    )
    if not stored and not runs:
        return None
    text = stored["yaml"] if stored else runs[-1]["suite_yaml"]
    try:
        suite = parse_suite(text)
    except SuiteError:
        suite = None
    bar = (suite.bar if suite and suite.bar is not None else DEFAULT_BAR)

    results = db.all(
        f"SELECT {RESULT_COLS} FROM results WHERE run_id IN (SELECT id FROM runs WHERE suite_id=?) ORDER BY id",
        (suite_id,),
    )
    by_run_model: dict[tuple[int, int], list[dict]] = defaultdict(list)
    for r in results:
        by_run_model[(r["run_id"], r["model_id"])].append(r)

    info: dict[int, dict] = {}
    for run in runs:
        for snap in db.all("SELECT model_id, snapshot FROM run_models WHERE run_id=? ORDER BY rowid", (run["id"],)):
            s = json.loads(snap["snapshot"])
            info[snap["model_id"]] = {k: s.get(k) for k in ("label", "color", "provider", "model", "base_url")}
    for m in db.all("SELECT id, label, color, price_in, price_out, archived FROM models"):
        if m["id"] in info:  # today's name, colour and prices; what was run stays as it was
            info[m["id"]].update(
                label=m["label"], color=m["color"] or info[m["id"]]["color"],
                price_in=m["price_in"], price_out=m["price_out"], archived=bool(m["archived"]),
            )

    by_id = {r["id"]: r for r in runs}
    history = []
    latest: dict[int, int] = {}
    for run in runs:
        unscored = _unscored(run["suite_yaml"])
        point = {"run_id": run["id"], "label": run["label"], "created_at": run["created_at"], "models": {}}
        for mid, meta in info.items():
            rows = by_run_model.get((run["id"], mid))
            c = _candidate(rows, unscored, meta) if rows else None
            if c:
                point["models"][mid] = {k: c[k] for k in ("passed", "attempted", "cost", "latency_ms")}
                latest[mid] = run["id"]
        if point["models"]:
            history.append(point)

    models = []
    for mid, run_id in latest.items():
        run = by_id[run_id]
        c = _candidate(by_run_model[(run_id, mid)], _unscored(run["suite_yaml"]), info[mid])
        meta = info[mid]
        models.append(
            {
                "id": mid,
                "label": meta["label"],
                "color": meta["color"],
                "provider": meta["provider"],
                "model": meta["model"],
                "price_in": meta.get("price_in"),
                "price_out": meta.get("price_out"),
                "archived": meta.get("archived", False),
                "run_id": run_id,
                "run_label": run["label"],
                "run_at": run["created_at"],
                **c,  # type: ignore[dict-item]
            }
        )
    models.sort(key=lambda m: (-m["pass_rate"], m["cost"] is None, m["cost"] or 0, m["id"]))

    human = human_board(db, suite_id)
    return {
        "suite": {
            "id": suite_id,
            "title": suite.title if suite else (stored["title"] if stored else runs[-1]["suite_title"]),
            "description": suite.description if suite else "",
            "bar": bar,
            "exists": bool(stored),
            "tasks": [{"id": t.id, "title": t.title or t.id, "category": t.category} for t in suite.tasks if t.checks]
            if suite
            else [],
            "ungraded": sum(1 for t in suite.tasks if not t.checks) if suite else 0,
        },
        "models": models,
        "history": history,
        "human": {"models": human["models"], "h2h": human["h2h"], "count": human["count"]},
        "runs": len(runs),
        "decision": decide(models, bar, "cost"),
        "picks": [
            {"run_id": p["run_id"], "pick": decide([{"id": i, **m} for i, m in p["models"].items()], bar, "cost")["pick"]}
            for p in history
        ],
    }


def money(x: float) -> str:
    if x == 0:
        return "$0"
    if x < 0.995:
        return f"${x:.2f}" if x >= 0.095 else f"${x:.3f}"
    return f"${x:,.2f}" if x < 100 else f"${x:,.0f}"


def explain(models: list[dict], decision: dict) -> list[str]:
    """The verdict as a few plain lines, for the terminal."""
    by_id = {m["id"]: m for m in models}
    bar = f"{decision['bar']:.0%}"
    if not by_id:
        return ["No graded answers yet, so there is nothing to decide."]
    best = by_id[decision["best"]]
    if decision["pick"] is None:
        short = -decision["rows"][best["id"]]["margin"]
        return [
            f"No model reaches the {bar} bar.",
            f"Closest: {best['label']} with {best['passed']} of {best['attempted']} right, {short} short.",
        ]
    pick = by_id[decision["pick"]]
    speed = decision["objective"] == "speed"
    got = f"{pick['passed']} of {pick['attempted']} right"
    if speed:
        how = f"{pick['latency_ms'] / 1000:.1f} s per answer" if pick["latency_ms"] is not None else "speed not measured"
    elif pick["cost"] is None:
        how = "price not set"
    elif pick["cost"] == 0:
        how = "no API bill"
    else:
        how = f"{money(pick['cost'])} per 1,000 answers"
    lines = [f"Use {pick['label']}: {got} at a {bar} bar, {how}."]
    if best["id"] != pick["id"] and best["passed"] / best["attempted"] > pick["passed"] / pick["attempted"]:
        extra = f"{best['label']} gets {best['passed']} of {best['attempted']}"
        if not speed and pick["cost"] and best["cost"]:
            extra += f", at {best['cost'] / pick['cost']:.0f}x the price"
        elif not speed and best["cost"]:
            extra += f", for {money(best['cost'])} per 1,000 answers"
        lines.append(extra + ".")
    margin = decision["rows"][pick["id"]]["margin"]
    if margin == 0:
        lines.append("It clears the bar with nothing to spare: one more miss and it would not.")
    if decision["unranked"]:
        names = ", ".join(by_id[i]["label"] for i in decision["unranked"])
        what = "a measured speed" if speed else "a price"
        lines.append(f"Not ranked for want of {what}: {names}.")
    return lines
