"""Code execution for `python` checks.

Three modes:
  container  the sandbox service (compose): no network, read-only, unprivileged. The default there.
  local      a child process on this machine with the same resource limits but this machine's
             network and files. Only when EVALBENCH_SANDBOX=local says so.
  off        no sandbox configured: python checks are recorded as errors, never run unprotected.
"""

from __future__ import annotations

import asyncio

import httpx

from evalbench.sandbox.runner import SandboxResult, run_python

__all__ = ["Sandbox", "SandboxResult", "SandboxUnavailable"]


class SandboxUnavailable(Exception):
    """The code could not be run at all. This is an infrastructure problem, not a failed check."""


class Sandbox:
    def __init__(self, url: str | None = None, allow_local: bool = False):
        self.url = url
        self.allow_local = allow_local and not url
        self._client = httpx.AsyncClient(timeout=httpx.Timeout(90.0, connect=5.0)) if url else None
        self._local = asyncio.Semaphore(2)

    @property
    def mode(self) -> str:
        return "container" if self.url else "local" if self.allow_local else "off"

    @property
    def can_run(self) -> bool:
        return self.mode != "off"

    async def run(self, code: str, timeout: float = 5.0) -> SandboxResult:
        if self._client:
            try:
                r = await self._client.post(f"{self.url}/run", json={"code": code, "timeout": timeout})
                r.raise_for_status()
                return SandboxResult(**r.json())
            except (httpx.HTTPError, ValueError, TypeError) as e:
                raise SandboxUnavailable(f"sandbox unavailable ({e.__class__.__name__})") from None
        if not self.allow_local:
            raise SandboxUnavailable(
                "no code sandbox configured: run with the compose sandbox, or set EVALBENCH_SANDBOX=local to accept running model code on this machine"
            )
        async with self._local:
            return await asyncio.to_thread(run_python, code, timeout)

    async def health(self) -> bool:
        if not self._client:
            return self.allow_local
        try:
            r = await self._client.get(f"{self.url}/health")
            return r.status_code == 200
        except httpx.HTTPError:
            return False

    async def close(self) -> None:
        if self._client:
            await self._client.aclose()
