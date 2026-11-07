"""The HTTP API and the web app, served from one process."""

from __future__ import annotations

import asyncio
import contextlib
import ctypes
import ipaddress
import re
import sys
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from fastapi import Body, FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles

from evalbench import __version__, export, ratings, stats, store
from evalbench.auth import COOKIE, MIN_PASSWORD, SESSION_DAYS, Auth
from evalbench.config import Settings, load_settings
from evalbench.db import Database
from evalbench.providers import PRESETS, PROVIDERS, ProviderError, ProviderPool, key_status
from evalbench.runner import RunError, RunManager, create_run
from evalbench.sandbox import Sandbox
from evalbench.suites import SuiteError, dump_suite, parse_suite

STATIC = Path(__file__).parent / "static"
LOCAL_HOSTS = {"localhost", "127.0.0.1", "[::1]"}
OPEN = ("/api/health", "/api/auth/", "/api/meta")


def _hide_environment() -> None:
    """Mark this process non-dumpable, so other processes of the same user (such as code run in
    local sandbox mode) cannot read its environment, and with it the API keys, from /proc."""
    if sys.platform.startswith("linux"):
        with contextlib.suppress(OSError, AttributeError):
            ctypes.CDLL(None, use_errno=True).prctl(4, 0, 0, 0, 0)  # PR_SET_DUMPABLE = 0


def _safe_name(value: str | None) -> str:
    return re.sub(r"[^A-Za-z0-9._-]", "", value or "")[:64]


class State:
    settings: Settings
    db: Database
    pool: ProviderPool
    sandbox: Sandbox
    runs: RunManager
    auth: Auth


def create_app(settings: Settings | None = None) -> FastAPI:
    state = State()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        state.settings = settings or load_settings()
        _hide_environment()
        state.db = Database(state.settings.db_path)
        state.auth = Auth(state.settings, state.db)
        state.pool = ProviderPool()
        state.sandbox = Sandbox(state.settings.sandbox_url, allow_local=state.settings.sandbox_local)
        state.runs = RunManager(state.db, state.pool, state.sandbox, state.settings.concurrency)
        state.runs.recover()
        if state.db.get_meta("initialised") is None:
            store.install_bundled_suites(state.db)
            state.db.set_meta("initialised", "1")
            if state.settings.load_demo:
                from evalbench.demo import load_demo

                await load_demo(state.db, state.sandbox)
        yield
        await state.runs.shutdown()
        await state.pool.close()
        await state.sandbox.close()
        state.db.close()

    app = FastAPI(title="Evalbench", version=__version__, lifespan=lifespan, docs_url="/api/docs", redoc_url=None)
    app.state.evalbench = state

    # ---------- access: sign-in, localhost-only when sign-in is off, sandbox kept out ----------

    sandbox_ips: dict = {"at": 0.0, "ips": set()}

    async def from_sandbox(client: str) -> bool:
        """The sandbox container shares a network with the app so the app can reach it. Requests
        in the other direction, from model-written code, are refused outright."""
        url = state.settings.sandbox_url
        if not url or not client:
            return False
        if time.monotonic() - sandbox_ips["at"] > 30:
            host = urlparse(url).hostname or ""
            try:
                infos = await asyncio.get_running_loop().getaddrinfo(host, None)
                ips = {i[4][0] for i in infos}
                sandbox_ips["ips"] = {ip for ip in ips if not ipaddress.ip_address(ip).is_loopback}
            except (OSError, ValueError):
                pass
            sandbox_ips["at"] = time.monotonic()
        return client in sandbox_ips["ips"]

    def host_of(request: Request) -> str:
        host = (request.headers.get("host") or "").lower()
        if host.startswith("["):
            return host[: host.find("]") + 1]
        return host.split(":", 1)[0]

    @app.middleware("http")
    async def guard(request: Request, call_next):
        client = request.client.host if request.client else ""
        if await from_sandbox(client):
            return JSONResponse({"detail": "not reachable from the sandbox"}, status_code=403)
        if not state.auth.enabled:
            host = host_of(request)
            if host not in LOCAL_HOSTS and host not in state.settings.allowed_hosts:
                return JSONResponse(
                    {"detail": "sign-in is off, so only localhost may connect; turn sign-in on or set EVALBENCH_ALLOWED_HOSTS"},
                    status_code=403,
                )
        path = request.url.path
        if path.startswith("/api/") and not path.startswith(OPEN) and not state.auth.valid(request.cookies.get(COOKIE)):
            return JSONResponse({"detail": "sign in first"}, status_code=401)
        return await call_next(request)

    def _session(request: Request) -> JSONResponse:
        resp = JSONResponse({"ok": True})
        secure = request.url.scheme == "https"
        resp.set_cookie(COOKIE, state.auth.new_session(), max_age=SESSION_DAYS * 86400, httponly=True, samesite="lax", secure=secure)
        return resp

    @app.post("/api/auth/setup")
    def setup(request: Request, body: dict = Body(...)) -> Response:
        if not state.auth.setup_required:
            raise HTTPException(409, "a password is already set")
        password = str(body.get("password") or "")
        if len(password) < MIN_PASSWORD:
            raise HTTPException(422, f"use at least {MIN_PASSWORD} characters")
        state.auth.set_password(password)
        return _session(request)

    @app.post("/api/auth/login")
    async def login(request: Request, body: dict = Body(...)) -> Response:
        if not state.auth.enabled:
            return JSONResponse({"ok": True})
        client = request.client.host if request.client else ""
        if state.auth.throttled(client):
            raise HTTPException(429, "too many attempts; wait a minute")
        if not state.auth.verify(str(body.get("password") or "")):
            state.auth.failed(client)
            await asyncio.sleep(0.4)
            raise HTTPException(401, "wrong password")
        state.auth.succeeded(client)
        return _session(request)

    @app.post("/api/auth/logout")
    def logout() -> Response:
        resp = JSONResponse({"ok": True})
        resp.delete_cookie(COOKIE)
        return resp

    # ---------- meta ----------

    @app.get("/api/health")
    def health() -> dict:
        return {"ok": True, "version": __version__}

    @app.get("/api/meta")
    async def meta(request: Request) -> dict:
        s = state.settings
        authed = state.auth.valid(request.cookies.get(COOKIE))
        out: dict[str, Any] = {
            "version": __version__,
            "auth": state.auth.enabled,
            "setup_required": state.auth.setup_required,
            "password_from_env": bool(s.password),
            "authenticated": authed,
        }
        if authed:
            out.update(
                {
                    "demo": state.db.get_meta("demo") == "1",
                    "data_dir": str(s.data_dir),
                    "concurrency": s.concurrency,
                    "min_justification": s.min_justification,
                    "sandbox": {"mode": state.sandbox.mode, "ok": await state.sandbox.health()},
                    "keys": {
                        name: key_status({"provider": name, "api_key_env": None})
                        for name in ("anthropic", "openai")
                    },
                    "providers": PROVIDERS,
                    "presets": PRESETS,
                    "rating": ratings.rating_options(),
                }
            )
        return out

    @app.get("/api/overview")
    def overview() -> dict:
        return stats.overview(state.db)

    # ---------- suites ----------

    @app.get("/api/suites")
    def suites() -> list[dict]:
        return store.list_suites(state.db)

    @app.get("/api/suites/{suite_id}")
    def suite(suite_id: str) -> dict:
        row = store.get_suite_row(state.db, suite_id)
        if not row:
            raise HTTPException(404, "no such suite")
        return store.suite_payload(state.db, row)

    @app.post("/api/suites/validate")
    def validate(body: dict = Body(...)) -> dict:
        try:
            if "yaml" in body:
                s = parse_suite(str(body["yaml"]))
                return {"ok": True, "suite": s.model_dump(mode="json")}
            from evalbench.suites import suite_from_dict

            s = suite_from_dict(body.get("suite") or {})
            return {"ok": True, "suite": s.model_dump(mode="json"), "yaml": dump_suite(s)}
        except SuiteError as e:
            return {"ok": False, "errors": e.errors}

    def _save(body: dict, expected: str | None) -> dict:
        try:
            if "yaml" in body:
                s = store.save_suite(state.db, str(body["yaml"]), expected_id=expected)
            else:
                s, _ = store.save_suite_structured(state.db, body.get("suite") or {}, expected_id=expected)
        except SuiteError as e:
            raise HTTPException(422, {"errors": e.errors}) from None
        return store.suite_payload(state.db, store.get_suite_row(state.db, s.id))

    @app.post("/api/suites", status_code=201)
    def create_suite(body: dict = Body(...)) -> dict:
        try:
            s = parse_suite(body["yaml"]) if "yaml" in body else None
        except SuiteError as e:
            raise HTTPException(422, {"errors": e.errors}) from None
        if s and store.get_suite_row(state.db, s.id):
            raise HTTPException(409, f"a suite with id '{s.id}' already exists")
        return _save(body, None)

    @app.put("/api/suites/{suite_id}")
    def update_suite(suite_id: str, body: dict = Body(...)) -> dict:
        if not store.get_suite_row(state.db, suite_id):
            raise HTTPException(404, "no such suite")
        return _save(body, suite_id)

    @app.delete("/api/suites/{suite_id}")
    def delete_suite(suite_id: str) -> dict:
        state.db.execute("DELETE FROM suites WHERE id=?", (suite_id,))
        return {"ok": True}

    @app.get("/api/suites/{suite_id}/yaml")
    def suite_yaml(suite_id: str) -> Response:
        row = store.get_suite_row(state.db, suite_id)
        if not row:
            raise HTTPException(404, "no such suite")
        return PlainTextResponse(
            row["yaml"], media_type="application/yaml",
            headers={"Content-Disposition": f'attachment; filename="{_safe_name(suite_id)}.yaml"'},
        )

    # ---------- models ----------

    @app.get("/api/models")
    def models(archived: bool = False) -> list[dict]:
        return store.list_models(state.db, include_archived=archived)

    @app.post("/api/models", status_code=201)
    def create_model(body: dict = Body(...)) -> dict:
        try:
            return store.create_model(state.db, body)
        except (ValueError, TypeError) as e:
            raise HTTPException(422, str(e)) from None

    @app.put("/api/models/{model_id}")
    def update_model(model_id: int, body: dict = Body(...)) -> dict:
        try:
            return store.update_model(state.db, model_id, body)
        except KeyError:
            raise HTTPException(404, "no such model") from None
        except (ValueError, TypeError) as e:
            raise HTTPException(422, str(e)) from None

    @app.delete("/api/models/{model_id}")
    def delete_model(model_id: int) -> dict:
        return {"result": store.remove_model(state.db, model_id)}

    @app.post("/api/models/{model_id}/test")
    async def test_model(model_id: int) -> dict:
        m = store.get_model(state.db, model_id)
        if not m:
            raise HTTPException(404, "no such model")
        started = time.monotonic()
        try:
            ids = await state.pool.list_models(m)
        except ProviderError as e:
            return {"ok": False, "error": str(e)}
        found = m["model"] in ids or not ids
        return {
            "ok": True,
            "found": found,
            "ms": int((time.monotonic() - started) * 1000),
            "detail": "reachable, model listed" if found else f"reachable, but '{m['model']}' is not in the {len(ids)} models it lists",
        }

    @app.post("/api/models/discover")
    async def discover(body: dict = Body(...)) -> dict:
        probe = {
            "provider": body.get("provider") or "openai-compatible",
            "base_url": (body.get("base_url") or None),
            "api_key_env": body.get("api_key_env") or None,
            "model": "probe",
        }
        if probe["provider"] not in PROVIDERS:
            raise HTTPException(422, "unknown provider")
        try:
            return {"ok": True, "models": await state.pool.list_models(probe)}
        except ProviderError as e:
            return {"ok": False, "error": str(e), "models": []}

    # ---------- runs ----------

    @app.get("/api/runs")
    def runs(suite: str | None = None) -> list[dict]:
        out = stats.run_list(state.db, suite_id=suite)
        for r in out:
            r["active"] = state.runs.active(r["id"])
        return out

    @app.post("/api/runs", status_code=201)
    async def start_run(body: dict = Body(...)) -> dict:
        try:
            run_id = create_run(state.db, str(body.get("suite_id") or ""), body.get("model_ids") or [], str(body.get("label") or ""))
        except RunError as e:
            raise HTTPException(422, str(e)) from None
        state.runs.start(run_id)
        return {"id": run_id}

    @app.get("/api/runs/{run_id}")
    def run(run_id: int) -> dict:
        detail = stats.run_detail(state.db, run_id)
        if not detail:
            raise HTTPException(404, "no such run")
        detail["active"] = state.runs.active(run_id)
        return detail

    @app.get("/api/runs/{run_id}/tasks/{task_id}")
    def answers(run_id: int, task_id: str) -> dict:
        out = stats.task_answers(state.db, run_id, task_id)
        if not out:
            raise HTTPException(404, "no such task in this run")
        return out

    @app.post("/api/runs/{run_id}/cancel")
    def cancel(run_id: int) -> dict:
        state.runs.cancel(run_id)
        return {"ok": True}

    @app.post("/api/runs/{run_id}/resume")
    async def resume(run_id: int) -> dict:
        if not state.db.one("SELECT id FROM runs WHERE id=?", (run_id,)):
            raise HTTPException(404, "no such run")
        try:
            state.runs.resume(run_id)
        except RunError as e:
            raise HTTPException(409, str(e)) from None
        return {"ok": True}

    @app.delete("/api/runs/{run_id}")
    def delete_run(run_id: int) -> dict:
        if state.runs.active(run_id):
            raise HTTPException(409, "cancel the run first")
        with state.db.tx() as conn:
            conn.execute(
                "DELETE FROM ratings WHERE result_a IN (SELECT id FROM results WHERE run_id=?) OR result_b IN (SELECT id FROM results WHERE run_id=?)",
                (run_id, run_id),
            )
            conn.execute("DELETE FROM runs WHERE id=?", (run_id,))
        return {"ok": True}

    # ---------- rating ----------

    @app.get("/api/rate/next")
    def rate_next(rater: str = "", run: int | None = None, suite: str | None = None, skip: str = "") -> dict:
        if run is None and not suite:
            raise HTTPException(422, "choose a run or a suite to rate")
        pair = ratings.next_pair(
            state.db, rater, run_id=run, suite_id=suite, skip=[s for s in skip.split(",") if s]
        )
        if pair is None:
            return {"done": True, "progress": ratings.progress(state.db, rater, run_id=run, suite_id=suite)}
        return {"done": False, **pair}

    @app.post("/api/ratings", status_code=201)
    def rate(body: dict = Body(...)) -> dict:
        try:
            rating_id = ratings.save_rating(state.db, body, state.settings.min_justification)
        except ratings.RatingError as e:
            raise HTTPException(422, str(e)) from None
        return {"id": rating_id}

    @app.get("/api/ratings")
    def rating_list(suite: str | None = None, limit: int = 200) -> list[dict]:
        return ratings.rating_rows(state.db, suite, limit)

    # ---------- scoreboard and exports ----------

    @app.get("/api/scoreboard/{suite_id}")
    def scoreboard(suite_id: str) -> dict:
        return stats.scoreboard(state.db, suite_id)

    @app.get("/api/export/summary")
    def export_summary() -> dict:
        db = state.db
        return {
            "ratings": db.scalar("SELECT COUNT(*) FROM ratings"),
            "pairs": db.scalar("SELECT COUNT(*) FROM ratings WHERE preference<>0"),
            "results": db.scalar("SELECT COUNT(*) FROM results WHERE status IN ('done','error')"),
            "suites": db.all("SELECT id, title FROM suites ORDER BY title"),
        }

    def _download(body, name: str, media: str) -> Response:
        headers = {"Content-Disposition": f'attachment; filename="{name}"'}
        if isinstance(body, str):
            return Response(body, media_type=media, headers=headers)
        return StreamingResponse(body, media_type=media, headers=headers)

    @app.get("/api/export/ratings.csv")
    def ratings_csv(suite: str | None = None) -> Response:
        return _download(export.ratings_csv(state.db, suite), f"evalbench-ratings{'-' + _safe_name(suite) if suite else ''}.csv", "text/csv")

    @app.get("/api/export/ratings.jsonl")
    def ratings_jsonl(suite: str | None = None) -> Response:
        return _download(export.ratings_jsonl(state.db, suite), f"evalbench-ratings{'-' + _safe_name(suite) if suite else ''}.jsonl", "application/jsonl")

    @app.get("/api/export/preferences.jsonl")
    def preferences(suite: str | None = None, min_strength: int = 1) -> Response:
        return _download(
            export.preference_pairs(state.db, suite, min_strength),
            f"evalbench-preferences{'-' + _safe_name(suite) if suite else ''}.jsonl", "application/jsonl",
        )

    @app.get("/api/export/results.jsonl")
    def results_jsonl(run: int | None = None, suite: str | None = None) -> Response:
        name = f"evalbench-results{'-run' + str(run) if run else ''}{'-' + _safe_name(suite) if suite else ''}.jsonl"
        return _download(export.results_jsonl(state.db, run, suite), name, "application/jsonl")

    @app.post("/api/demo")
    async def demo() -> dict:
        from evalbench.demo import load_demo

        return await load_demo(state.db, state.sandbox)

    # ---------- the web app ----------

    if (STATIC / "assets").is_dir():
        app.mount("/assets", StaticFiles(directory=STATIC / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str) -> Response:
        if path.startswith("api/"):
            raise HTTPException(404, "not found")
        candidate = (STATIC / path).resolve()
        if path and candidate.is_file() and STATIC.resolve() in candidate.parents:
            return FileResponse(candidate)
        index = STATIC / "index.html"
        if index.exists():
            return FileResponse(index, headers={"Cache-Control": "no-cache"})
        return PlainTextResponse("Evalbench API is running. Build the web app with `npm --prefix web run build`.")

    return app


app = create_app()
