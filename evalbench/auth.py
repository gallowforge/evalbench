"""Sign-in. On by default: the password comes from EVALBENCH_PASSWORD, or is created in the browser
on first visit and stored as a scrypt hash. Sessions are HMAC-signed cookies bound to the current
password, so changing the password signs everyone out."""

from __future__ import annotations

import hashlib
import hmac
import secrets
import time
from collections import defaultdict, deque

from evalbench.config import Settings
from evalbench.db import Database

COOKIE = "evalbench_session"
SESSION_DAYS = 30
MIN_PASSWORD = 8
_N, _R, _P = 2**14, 8, 1


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=_N, r=_R, p=_P, dklen=32)
    return f"scrypt${_N}${_R}${_P}${salt.hex()}${digest.hex()}"


def check_hash(password: str, stored: str) -> bool:
    try:
        _, n, r, p, salt, digest = stored.split("$")
        got = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=int(n), r=int(r), p=int(p), dklen=32)
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(got.hex(), digest)


class Auth:
    def __init__(self, settings: Settings, db: Database):
        self.settings = settings
        self.db = db
        self._failures: dict[str, deque[float]] = defaultdict(deque)

    @property
    def enabled(self) -> bool:
        return self.settings.auth

    def _stored(self) -> str | None:
        return self.db.get_meta("password_hash")

    @property
    def setup_required(self) -> bool:
        return self.enabled and not self.settings.password and not self._stored()

    def _fingerprint(self) -> str:
        source = self.settings.password or self._stored() or ""
        return hashlib.sha256(source.encode()).hexdigest()[:16]

    def _sign(self, issued: int) -> str:
        msg = f"session:{issued}:{self._fingerprint()}".encode()
        return f"{issued}.{hmac.new(self.settings.secret(), msg, hashlib.sha256).hexdigest()}"

    def new_session(self) -> str:
        return self._sign(int(time.time()))

    def valid(self, token: str | None) -> bool:
        if not self.enabled:
            return True
        if self.setup_required or not token or "." not in token:
            return False
        issued, _, _ = token.partition(".")
        if not issued.isdigit() or time.time() - int(issued) > SESSION_DAYS * 86400:
            return False
        return hmac.compare_digest(token, self._sign(int(issued)))

    def verify(self, password: str) -> bool:
        if self.settings.password:
            return hmac.compare_digest(password.encode(), self.settings.password.encode())
        stored = self._stored()
        return bool(stored) and check_hash(password, stored)

    def set_password(self, password: str) -> None:
        self.db.set_meta("password_hash", hash_password(password))

    # Five failed attempts per client per minute, then a pause.
    def throttled(self, client: str) -> bool:
        window = self._failures[client]
        cutoff = time.monotonic() - 60
        while window and window[0] < cutoff:
            window.popleft()
        return len(window) >= 5

    def failed(self, client: str) -> None:
        self._failures[client].append(time.monotonic())

    def succeeded(self, client: str) -> None:
        self._failures.pop(client, None)
