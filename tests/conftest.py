"""Shared fixtures: a temporary data directory, an app client, and a fake model server that speaks
both the OpenAI chat-completions and Anthropic Messages wire formats on a real socket, so the
official SDKs are exercised end to end."""

from __future__ import annotations

import socket
import threading
import time
from pathlib import Path

import pytest
import uvicorn
import yaml
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from evalbench.app import create_app
from evalbench.config import Settings
from evalbench.suites import parse_suite

ROOT = Path(__file__).resolve().parents[1]
SUITE = parse_suite((ROOT / "evalbench/data/suites/core-battery.yaml").read_text())
ANSWERS = yaml.safe_load((ROOT / "evalbench/data/demo/answers.yaml").read_text())


def best_answer(prompt: str) -> str:
    for task in SUITE.tasks:
        if task.prompt.strip() == prompt.strip():
            return max(ANSWERS[task.id], key=lambda v: v["q"])["text"]
    return "I am not sure."


def fake_server_app(log: list[dict]) -> FastAPI:
    app = FastAPI()

    @app.get("/v1/models")
    def models(request: Request) -> dict:
        log.append({"path": "/v1/models", "headers": dict(request.headers)})
        return {"object": "list", "data": [{"id": "good-model", "object": "model", "created": 0, "owned_by": "test"},
                                            {"id": "bad-model", "object": "model", "created": 0, "owned_by": "test"},
                                            {"id": "claude-haiku-5-5", "type": "model", "display_name": "Haiku", "created_at": "2026-01-01T00:00:00Z"}],
                "has_more": False, "first_id": "good-model", "last_id": "claude-haiku-5-5"}

    @app.post("/v1/chat/completions")
    async def chat(request: Request) -> dict:
        body = await request.json()
        log.append({"path": "/v1/chat/completions", "body": body, "headers": dict(request.headers)})
        prompt = body["messages"][-1]["content"]
        if body["model"] == "error-model":
            return {"error": "boom"}  # malformed: no choices
        text = best_answer(prompt) if body["model"] == "good-model" else "I am not sure."
        return {
            "id": "chatcmpl-1", "object": "chat.completion", "created": 0, "model": body["model"],
            "choices": [{"index": 0, "message": {"role": "assistant", "content": text}, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 12, "completion_tokens": 34, "total_tokens": 46},
        }

    @app.post("/v1/messages")
    async def messages(request: Request) -> dict:
        body = await request.json()
        log.append({"path": "/v1/messages", "body": body, "headers": dict(request.headers)})
        text = best_answer(body["messages"][-1]["content"])
        return {
            "id": "msg_1", "type": "message", "role": "assistant", "model": body["model"],
            "content": [{"type": "text", "text": text}],
            "stop_reason": "end_turn", "stop_sequence": None,
            "usage": {"input_tokens": 21, "output_tokens": 43},
        }

    return app


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="session")
def fake_server():
    log: list[dict] = []
    port = _free_port()
    server = uvicorn.Server(uvicorn.Config(fake_server_app(log), host="127.0.0.1", port=port, log_level="error"))
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    for _ in range(100):
        if server.started:
            break
        time.sleep(0.05)
    yield {"url": f"http://127.0.0.1:{port}/v1", "root": f"http://127.0.0.1:{port}", "log": log}
    server.should_exit = True
    thread.join(timeout=5)


def make_settings(tmp_path: Path, **overrides) -> Settings:
    values = dict(
        data_dir=tmp_path, password=None, sandbox_url=None, concurrency=4, min_justification=30,
        load_demo=False, host="127.0.0.1", port=0, auth=False, sandbox_local=True, allowed_hosts=("testserver",),
    )
    values.update(overrides)
    return Settings(**values)


@pytest.fixture
def client(tmp_path):
    with TestClient(create_app(make_settings(tmp_path))) as c:
        yield c


def wait_for_run(client: TestClient, run_id: int, timeout: float = 60) -> dict:
    deadline = time.time() + timeout
    while time.time() < deadline:
        run = client.get(f"/api/runs/{run_id}").json()
        if not run["active"] and run["status"] not in ("queued", "running"):
            return run
        time.sleep(0.1)
    raise AssertionError(f"run {run_id} did not finish")
