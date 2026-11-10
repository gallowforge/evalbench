"""SQLite storage. One file, WAL mode, a single connection guarded by a lock: the workload is a
handful of writers at most, and this keeps every write ordered without a server."""

from __future__ import annotations

import json
import sqlite3
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

SCHEMA_VERSION = 2

SCHEMA = """
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS suites (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  yaml        TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS models (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  label       TEXT NOT NULL,
  provider    TEXT NOT NULL,
  base_url    TEXT,
  model       TEXT NOT NULL,
  api_key_env TEXT,
  params      TEXT NOT NULL DEFAULT '{}',
  concurrency INTEGER NOT NULL DEFAULT 2,
  color       TEXT NOT NULL DEFAULT '',
  archived    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  price_in    REAL,
  price_out   REAL
);
CREATE TABLE IF NOT EXISTS runs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  suite_id    TEXT NOT NULL,
  suite_title TEXT NOT NULL,
  suite_yaml  TEXT NOT NULL,
  label       TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  started_at  TEXT,
  finished_at TEXT
);
CREATE TABLE IF NOT EXISTS run_models (
  run_id   INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  model_id INTEGER NOT NULL,
  snapshot TEXT NOT NULL,
  PRIMARY KEY (run_id, model_id)
);
CREATE TABLE IF NOT EXISTS results (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id        INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  task_id       TEXT NOT NULL,
  task_hash     TEXT NOT NULL,
  category      TEXT NOT NULL DEFAULT '',
  model_id      INTEGER NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending',
  output        TEXT,
  error         TEXT,
  finish_reason TEXT,
  latency_ms    INTEGER,
  input_tokens  INTEGER,
  output_tokens INTEGER,
  checks        TEXT NOT NULL DEFAULT '[]',
  score         REAL,
  passed        INTEGER,
  completed_at  TEXT,
  UNIQUE (run_id, task_id, model_id)
);
CREATE INDEX IF NOT EXISTS results_run ON results(run_id);
CREATE TABLE IF NOT EXISTS ratings (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  suite_id      TEXT NOT NULL,
  run_id        INTEGER,
  task_id       TEXT NOT NULL,
  result_a      INTEGER NOT NULL,
  result_b      INTEGER NOT NULL,
  model_a       INTEGER NOT NULL,
  model_b       INTEGER NOT NULL,
  preference    INTEGER NOT NULL,
  scores        TEXT NOT NULL DEFAULT '{}',
  flags         TEXT NOT NULL DEFAULT '{}',
  justification TEXT NOT NULL,
  confidence    TEXT,
  rater         TEXT NOT NULL DEFAULT '',
  seconds       INTEGER,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ratings_suite ON ratings(suite_id);
"""


def now() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


class Database:
    def __init__(self, path: Path | str):
        self.path = str(path)
        self.lock = threading.RLock()
        self.conn = sqlite3.connect(self.path, check_same_thread=False, isolation_level=None)
        self.conn.row_factory = sqlite3.Row
        if self.path != ":memory:":
            self.conn.execute("PRAGMA journal_mode=WAL")
        self.conn.execute("PRAGMA foreign_keys=ON")
        self.conn.execute("PRAGMA busy_timeout=5000")
        with self.lock:
            self.conn.executescript(SCHEMA)
            self._upgrade()
            self.conn.execute(f"PRAGMA user_version={SCHEMA_VERSION}")

    def _upgrade(self) -> None:
        """Brings a database made by an older version up to date. Version 2 added what a model
        costs: dollars per million tokens, in and out."""
        have = {r["name"] for r in self.conn.execute("PRAGMA table_info(models)")}
        for column in ("price_in", "price_out"):
            if column not in have:
                self.conn.execute(f"ALTER TABLE models ADD COLUMN {column} REAL")

    def execute(self, sql: str, params: tuple | dict = ()) -> sqlite3.Cursor:
        with self.lock:
            return self.conn.execute(sql, params)

    def insert(self, sql: str, params: tuple | dict = ()) -> int:
        with self.lock:
            return int(self.conn.execute(sql, params).lastrowid)

    def all(self, sql: str, params: tuple | dict = ()) -> list[dict]:
        with self.lock:
            return [dict(r) for r in self.conn.execute(sql, params).fetchall()]

    def one(self, sql: str, params: tuple | dict = ()) -> dict | None:
        with self.lock:
            row = self.conn.execute(sql, params).fetchone()
            return dict(row) if row else None

    def scalar(self, sql: str, params: tuple | dict = ()) -> Any:
        with self.lock:
            row = self.conn.execute(sql, params).fetchone()
            return row[0] if row else None

    @contextmanager
    def tx(self) -> Iterator[sqlite3.Connection]:
        with self.lock:
            self.conn.execute("BEGIN IMMEDIATE")
            try:
                yield self.conn
            except BaseException:
                self.conn.execute("ROLLBACK")
                raise
            self.conn.execute("COMMIT")

    def get_meta(self, key: str, default: str | None = None) -> str | None:
        value = self.scalar("SELECT value FROM meta WHERE key=?", (key,))
        return default if value is None else value

    def set_meta(self, key: str, value: str) -> None:
        self.execute(
            "INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (key, value),
        )

    def close(self) -> None:
        with self.lock:
            self.conn.close()
