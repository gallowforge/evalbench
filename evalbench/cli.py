"""Command line: serve the app, run the sandbox service, validate suites, load the demo, or run a
suite headless (for CI gates on a model or a prompt change)."""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

from evalbench import __version__


def _serve(args: argparse.Namespace) -> int:
    import uvicorn

    from evalbench.config import load_settings

    s = load_settings()
    uvicorn.run("evalbench.app:app", host=args.host or s.host, port=args.port or s.port, log_level="info", proxy_headers=True)
    return 0


def _sandbox(args: argparse.Namespace) -> int:
    import uvicorn

    uvicorn.run("evalbench.sandbox.service:app", host=args.host, port=args.port, log_level="warning")
    return 0


def _validate(args: argparse.Namespace) -> int:
    from evalbench.suites import SuiteError, parse_suite

    failed = 0
    for path in args.files:
        try:
            suite = parse_suite(Path(path).read_text(encoding="utf-8"))
        except SuiteError as e:
            failed += 1
            print(f"✗ {path}")
            for err in e.errors:
                print(f"    {err}")
            continue
        checks = sum(len(t.checks) for t in suite.tasks)
        cats = ", ".join(f"{c} {sum(t.category == c for t in suite.tasks)}" for c in suite.categories())
        print(f"✓ {path}  {suite.id}: {len(suite.tasks)} tasks ({cats}), {checks} checks")
    return 1 if failed else 0


def _demo(args: argparse.Namespace) -> int:
    from evalbench.config import load_settings
    from evalbench.db import Database
    from evalbench.demo import load_demo
    from evalbench.sandbox import Sandbox

    s = load_settings()
    db = Database(s.db_path)
    result = asyncio.run(load_demo(db, Sandbox(s.sandbox_url, allow_local=s.sandbox_local)))
    print(json.dumps(result))
    return 0 if result.get("ok") else 1


def parse_model_spec(spec: str) -> dict:
    """provider:model[@base_url], e.g. anthropic:claude-haiku-5-5 or
    openai-compatible:qwen3-8b@http://localhost:1234/v1"""
    provider, sep, rest = spec.partition(":")
    if not sep or not rest:
        raise ValueError(f"model spec '{spec}' should look like provider:model[@base_url]")
    model, _, base_url = rest.partition("@")
    return {"provider": provider, "model": model, "base_url": base_url or None, "label": model}


def parse_price(spec: str) -> tuple[str, float, float]:
    """model=in/out in dollars per million tokens, e.g. claude-haiku-5-5=1/5 or qwen3-8b=0/0"""
    model, sep, rest = spec.rpartition("=")
    try:
        if not sep or not model:
            raise ValueError
        price_in, price_out = (float(x) for x in rest.split("/"))
    except ValueError:
        raise ValueError(f"price '{spec}' should look like model=in/out, in dollars per million tokens") from None
    return model, price_in, price_out


def _run(args: argparse.Namespace) -> int:
    from evalbench.config import load_settings
    from evalbench.db import Database
    from evalbench.providers import ProviderPool
    from evalbench.runner import RunManager, create_run
    from evalbench.sandbox import Sandbox
    from evalbench.stats import run_detail
    from evalbench.store import create_model, save_suite
    from evalbench.verdict import decide, explain, verdict

    s = load_settings()
    db = Database(":memory:" if args.ephemeral else s.db_path)
    path = Path(args.suite)
    if path.exists():
        suite = save_suite(db, path.read_text(encoding="utf-8"))
        suite_id = suite.id
    else:
        suite_id = args.suite
    if args.bar is not None and not 0 < args.bar <= 1:
        raise SystemExit(f"--bar is a share from 0 to 1, such as 0.9 for nine in ten; got {args.bar:g}")
    try:
        specs = [parse_model_spec(spec) for spec in args.model]
        prices = [parse_price(p) for p in args.price or []]
    except ValueError as e:
        raise SystemExit(str(e)) from None
    for model, price_in, price_out in prices:
        hit = [m for m in specs if m["model"] == model]
        if not hit:
            raise SystemExit(f"--price names '{model}', which is not one of the --model ids")
        for m in hit:  # the same model id at two base URLs shares the price
            m.update(price_in=price_in, price_out=price_out)
    try:
        model_ids = [create_model(db, m)["id"] for m in specs]
    except ValueError as e:  # a negative or impossible price, said plainly
        raise SystemExit(str(e)) from None

    async def go() -> dict:
        pool, sandbox = ProviderPool(), Sandbox(s.sandbox_url, allow_local=s.sandbox_local or args.allow_local_code)
        manager = RunManager(db, pool, sandbox, s.concurrency)
        run_id = create_run(db, suite_id, model_ids, args.label or "cli")
        manager.start(run_id)
        await manager.wait(run_id)
        await pool.close()
        await sandbox.close()
        return run_detail(db, run_id)

    detail = asyncio.run(go())
    # The verdict covers the models of this run only, so an old model in the same database
    # cannot win a run it was not part of.
    board = verdict(db, suite_id)
    ran = [m for m in board["models"] if m["id"] in model_ids and m["run_id"] == detail["id"]]
    decision = decide(ran, args.bar if args.bar is not None else board["suite"]["bar"], "speed" if args.fastest else "cost")
    worst = 1.0
    if args.json:
        print(json.dumps({
            "run": detail["id"],
            "models": [{"label": m["label"], **m["summary"]} for m in detail["models"]],
            "verdict": {
                "bar": decision["bar"],
                "objective": decision["objective"],
                "pick": next((m["label"] for m in ran if m["id"] == decision["pick"]), None),
                "clears": [m["label"] for i in decision["order"] for m in ran if m["id"] == i],
                "models": [
                    {"label": m["label"], "passed": m["passed"], "attempted": m["attempted"], "cost_per_1k": m["cost"],
                     "latency_ms": m["latency_ms"], **{k: decision["rows"][m["id"]][k] for k in ("need", "margin", "clears")}}
                    for m in ran
                ],
            },
        }, indent=2))
    for m in detail["models"]:
        sm = m["summary"]
        rate = sm["pass_rate"] if sm["pass_rate"] is not None else 0.0
        worst = min(worst, rate)
        if not args.json:
            print(f"{m['label']:<32} {sm['passed']:>3}/{sm['attempted']:<3} passed  {rate:6.1%}  errors {sm['errors']}")
    if not args.json:
        print()
        for line in explain(ran, decision):
            print(line)
    if args.require_pick and decision["pick"] is None:
        print(f"no model reaches the {decision['bar']:.0%} bar", file=sys.stderr)
        return 2
    if args.fail_under is not None and worst < args.fail_under:
        print(f"pass rate {worst:.1%} is below --fail-under {args.fail_under:.0%}", file=sys.stderr)
        return 2
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="evalbench", description="Self-hosted LLM evaluation workbench.")
    parser.add_argument("--version", action="version", version=f"evalbench {__version__}")
    sub = parser.add_subparsers(dest="command")

    p = sub.add_parser("serve", help="run the web app (default)")
    p.add_argument("--host")
    p.add_argument("--port", type=int)
    p.set_defaults(func=_serve)

    p = sub.add_parser("sandbox", help="run the code sandbox service")
    p.add_argument("--host", default="0.0.0.0")
    p.add_argument("--port", type=int, default=8485)
    p.set_defaults(func=_sandbox)

    p = sub.add_parser("validate", help="check suite files")
    p.add_argument("files", nargs="+")
    p.set_defaults(func=_validate)

    p = sub.add_parser("demo", help="load the demo workspace into the data directory")
    p.set_defaults(func=_demo)

    p = sub.add_parser("run", help="run a suite headless, print pass rates and the model to use")
    p.add_argument("suite", help="a suite file, or the id of a suite in the database")
    p.add_argument("--model", action="append", required=True, help="provider:model[@base_url]; repeat for more")
    p.add_argument("--price", action="append", help="model=in/out in dollars per million tokens; repeat for more")
    p.add_argument("--bar", type=float, help="the share of tasks a model must get right (0..1); default: the suite's bar, or 0.9")
    p.add_argument("--fastest", action="store_true", help="pick the fastest model that clears the bar instead of the cheapest")
    p.add_argument("--require-pick", action="store_true", help="exit 2 if no model clears the bar")
    p.add_argument("--label", default="")
    p.add_argument("--fail-under", type=float, help="exit 2 if any model's pass rate is below this (0..1)")
    p.add_argument("--ephemeral", action="store_true", help="keep nothing: use an in-memory database")
    p.add_argument("--allow-local-code", action="store_true", help="run python checks on this machine when no sandbox URL is set")
    p.add_argument("--json", action="store_true")
    p.set_defaults(func=_run)

    args = parser.parse_args(argv)
    if not getattr(args, "func", None):
        args = parser.parse_args(["serve", *(argv or [])])
    return args.func(args)
