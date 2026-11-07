"""Settings, read once from the environment. API keys are never read here: providers look up the
environment variable a model names at call time, so a key is never stored or logged."""

from __future__ import annotations

import os
import secrets
from dataclasses import dataclass, field
from pathlib import Path


def _flag(name: str) -> bool:
    return os.environ.get(name, "").strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class Settings:
    data_dir: Path
    password: str | None
    sandbox_url: str | None
    concurrency: int
    min_justification: int
    load_demo: bool
    host: str
    port: int
    auth: bool = True
    sandbox_local: bool = False
    allowed_hosts: tuple[str, ...] = field(default_factory=tuple)

    @property
    def db_path(self) -> Path:
        return self.data_dir / "evalbench.db"

    def secret(self) -> bytes:
        """A per-install signing key for session cookies, created on first use, owner-only."""
        path = self.data_dir / "secret.key"
        try:
            fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        except FileExistsError:
            return path.read_text().strip().encode()
        with os.fdopen(fd, "w") as f:
            f.write(secrets.token_hex(32))
        return path.read_text().strip().encode()


def load_settings() -> Settings:
    data_dir = Path(os.environ.get("EVALBENCH_DATA", "./data")).expanduser().resolve()
    data_dir.mkdir(parents=True, exist_ok=True)
    auth_off = os.environ.get("EVALBENCH_AUTH", "").strip().lower() in {"off", "0", "false", "no"}
    return Settings(
        data_dir=data_dir,
        password=os.environ.get("EVALBENCH_PASSWORD") or None,
        sandbox_url=(os.environ.get("EVALBENCH_SANDBOX_URL") or "").rstrip("/") or None,
        concurrency=max(1, int(os.environ.get("EVALBENCH_CONCURRENCY", "8"))),
        min_justification=max(0, int(os.environ.get("EVALBENCH_MIN_JUSTIFICATION", "30"))),
        load_demo=_flag("EVALBENCH_DEMO"),
        host=os.environ.get("EVALBENCH_HOST", "0.0.0.0"),
        port=int(os.environ.get("EVALBENCH_PORT", "8484")),
        auth=not auth_off,
        sandbox_local=os.environ.get("EVALBENCH_SANDBOX", "").strip().lower() == "local",
        allowed_hosts=tuple(h.strip().lower() for h in os.environ.get("EVALBENCH_ALLOWED_HOSTS", "").split(",") if h.strip()),
    )
