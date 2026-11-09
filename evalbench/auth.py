"""Sign-in. On by default, with one owner account: a username and a password.

The account comes from EVALBENCH_USERNAME and EVALBENCH_PASSWORD, or is created in the browser on
first visit, with the password stored as a scrypt hash next to the username. Sign-in checks both in
constant time and answers a wrong username exactly as it answers a wrong password, with the same
message, delay and back-off, so nobody can learn whether a username exists. Sessions are HMAC-signed
cookies bound to the current account, so changing it signs everyone out.

Installs from before usernames keep their password; after signing in, the owner picks a username once.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
import threading
import time
import unicodedata
from collections import defaultdict, deque

from evalbench.config import Settings
from evalbench.db import Database

COOKIE = "evalbench_session"
SESSION_DAYS = 30
MIN_PASSWORD = 8
MAX_USERNAME = 64
_N, _R, _P = 2**14, 8, 1


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=_N, r=_R, p=_P, dklen=32)
    return f"scrypt${_N}${_R}${_P}${salt.hex()}${digest.hex()}"


def check_hash(password: str, stored: str) -> bool:
    try:
        _, n, r, p, salt, digest = stored.split("$")
        got = hashlib.scrypt(
            password.encode(), salt=bytes.fromhex(salt), n=int(n), r=int(r), p=int(p), dklen=32
        )
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(got.hex(), digest)


def username_key(name: str) -> str:
    """The form two usernames are compared in: phone keyboards capitalise the first letter, and a
    password manager may store either case, so case and Unicode width do not matter."""
    return unicodedata.normalize("NFKC", name).strip().casefold()


def clean_username(raw: object) -> str:
    name = unicodedata.normalize("NFKC", str(raw or "")).strip()
    if not name:
        raise ValueError("choose a username")
    if len(name) > MAX_USERNAME:
        raise ValueError(f"keep the username to {MAX_USERNAME} characters")
    if any(ch.isspace() or unicodedata.category(ch).startswith("C") for ch in name):
        raise ValueError("a username has no spaces or hidden characters")
    return name


def _digest(text: str) -> bytes:
    # surrogatepass: a lone surrogate from a JSON body is just another wrong value, not a crash.
    return hashlib.sha256(text.encode("utf-8", "surrogatepass")).digest()


def _same(a: str, b: str) -> bool:
    """Constant-time equality that also hides the length of the secret."""
    return hmac.compare_digest(_digest(a), _digest(b))


class Auth:
    def __init__(self, settings: Settings, db: Database):
        self.settings = settings
        self.db = db
        self._failures: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    @property
    def enabled(self) -> bool:
        return self.settings.auth

    def _stored(self) -> str | None:
        return self.db.get_meta("password_hash")

    @property
    def username(self) -> str | None:
        return self.settings.username or self.db.get_meta("username") or None

    @property
    def setup_required(self) -> bool:
        return self.enabled and not self.settings.password and not self._stored()

    @property
    def username_required(self) -> bool:
        """An install from before usernames: it has a password but nobody has picked a username."""
        return self.enabled and not self.setup_required and not self.username

    def _fingerprint(self) -> str:
        source = f"{self.settings.password or self._stored() or ''}\0{username_key(self.username or '')}"
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

    def verify(self, username: str, password: str) -> bool:
        """Both halves are always checked, so a wrong username costs the same time as a wrong password.
        Before a username exists, only the password counts."""
        expected = self.username
        user_ok = expected is None or _same(username_key(username), username_key(expected))
        if self.settings.password:
            pass_ok = _same(password, self.settings.password)
        else:
            stored = self._stored()
            pass_ok = bool(stored) and check_hash(password, stored or "")
        return user_ok and pass_ok

    def create_account(self, username: str, password: str) -> bool:
        """First visit only. Two setups racing cannot mix one's username with the other's password."""
        digest = hash_password(password)
        with self._lock:
            if not self.setup_required:
                return False
            self.db.set_meta("username", username)
            self.db.set_meta("password_hash", digest)
        return True

    def set_username(self, username: str) -> bool:
        with self._lock:
            if not self.username_required:
                return False
            self.db.set_meta("username", username)
        return True

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
