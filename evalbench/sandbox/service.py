"""The sandbox as a small HTTP service, run in its own locked-down container by compose.

It holds no data and no keys: it receives code, runs it under the limits in runner.py and returns
the exit code and output. Each concurrent execution gets its own unprivileged user id, so one run
can neither read another's files nor signal the service."""

from __future__ import annotations

import asyncio
import os

from fastapi import FastAPI
from pydantic import BaseModel, Field

from evalbench import __version__
from evalbench.sandbox.runner import run_python

app = FastAPI(title="evalbench sandbox", version=__version__, docs_url=None, redoc_url=None, openapi_url=None)
SLOTS = max(1, int(os.environ.get("EVALBENCH_SANDBOX_SLOTS", "2")))
_uids: asyncio.Queue[int] | None = None


def _pool() -> asyncio.Queue[int]:
    global _uids
    if _uids is None:
        _uids = asyncio.Queue()
        for i in range(SLOTS):
            _uids.put_nowait(61000 + i)
    return _uids


class RunRequest(BaseModel):
    code: str = Field(max_length=200_000)
    timeout: float = Field(default=5.0, gt=0, le=60)


@app.get("/health")
def health() -> dict:
    return {"ok": True, "version": __version__}


@app.post("/run")
async def run(req: RunRequest) -> dict:
    pool = _pool()
    uid = await pool.get()
    try:
        result = await asyncio.to_thread(run_python, req.code, req.timeout, 256, uid)
    finally:
        pool.put_nowait(uid)
    return result.to_dict()
