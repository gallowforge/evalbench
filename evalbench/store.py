"""Reads and writes for suites and models, kept apart from the HTTP layer."""

from __future__ import annotations

import json
from pathlib import Path

from evalbench.db import Database, dumps, now
from evalbench.providers import EFFORTS, PROVIDERS, ProviderError, check_key_binding, key_status
from evalbench.suites import Suite, SuiteError, dump_suite, parse_suite, suite_from_dict, task_hash

PALETTE = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"]  # documented categorical order for light surfaces
BUNDLED = Path(__file__).parent / "data" / "suites"


# ---------- suites ----------

def save_suite(db: Database, text: str, *, expected_id: str | None = None) -> Suite:
    suite = parse_suite(text)
    if expected_id and suite.id != expected_id:
        raise SuiteError([f"id: the suite id is '{expected_id}'; rename by creating a new suite"])
    stamp = now()
    db.execute(
        """INSERT INTO suites(id, title, description, yaml, created_at, updated_at) VALUES(?,?,?,?,?,?)
           ON CONFLICT(id) DO UPDATE SET title=excluded.title, description=excluded.description,
           yaml=excluded.yaml, updated_at=excluded.updated_at""",
        (suite.id, suite.title, suite.description, text, stamp, stamp),
    )
    return suite


def save_suite_structured(db: Database, data: dict, *, expected_id: str | None = None) -> tuple[Suite, str]:
    suite = suite_from_dict(data)
    text = dump_suite(suite)
    return save_suite(db, text, expected_id=expected_id), text


def get_suite_row(db: Database, suite_id: str) -> dict | None:
    return db.one("SELECT * FROM suites WHERE id=?", (suite_id,))


def load_suite(db: Database, suite_id: str) -> Suite | None:
    row = get_suite_row(db, suite_id)
    return parse_suite(row["yaml"]) if row else None


def suite_payload(db: Database, row: dict) -> dict:
    suite = parse_suite(row["yaml"])
    return {
        "id": suite.id,
        "title": suite.title,
        "description": suite.description,
        "version": suite.version,
        "yaml": row["yaml"],
        "suite": suite.model_dump(mode="json"),
        "hashes": {t.id: task_hash(suite, t) for t in suite.tasks},
        "updated_at": row["updated_at"],
        "runs": db.scalar("SELECT COUNT(*) FROM runs WHERE suite_id=?", (suite.id,)),
    }


def list_suites(db: Database) -> list[dict]:
    out = []
    for row in db.all("SELECT * FROM suites ORDER BY title"):
        try:
            suite = parse_suite(row["yaml"])
        except SuiteError:
            continue
        last = db.one(
            "SELECT id, created_at, status FROM runs WHERE suite_id=? ORDER BY id DESC LIMIT 1", (suite.id,)
        )
        cats: dict[str, int] = {}
        checks: dict[str, int] = {}
        for t in suite.tasks:
            cats[t.category] = cats.get(t.category, 0) + 1
            for c in t.checks:
                checks[c.type] = checks.get(c.type, 0) + 1
        out.append(
            {
                "id": suite.id,
                "title": suite.title,
                "description": suite.description,
                "version": suite.version,
                "tasks": len(suite.tasks),
                "categories": cats,
                "check_types": checks,
                "updated_at": row["updated_at"],
                "runs": db.scalar("SELECT COUNT(*) FROM runs WHERE suite_id=?", (suite.id,)),
                "last_run": last,
            }
        )
    return out


def install_bundled_suites(db: Database) -> list[str]:
    """Adds the sample suites on first start. Never overwrites a suite the user has edited."""
    installed = []
    for path in sorted(BUNDLED.glob("*.yaml")):
        text = path.read_text(encoding="utf-8")
        suite = parse_suite(text)
        if not get_suite_row(db, suite.id):
            save_suite(db, text)
            installed.append(suite.id)
    return installed


# ---------- models ----------

def _model_row(row: dict) -> dict:
    row = dict(row)
    row["params"] = json.loads(row["params"] or "{}")
    row["archived"] = bool(row["archived"])
    row["key"] = key_status(row)
    return row


def list_models(db: Database, include_archived: bool = False) -> list[dict]:
    sql = "SELECT * FROM models" + ("" if include_archived else " WHERE archived=0") + " ORDER BY id"
    return [_model_row(r) for r in db.all(sql)]


def get_model(db: Database, model_id: int) -> dict | None:
    row = db.one("SELECT * FROM models WHERE id=?", (model_id,))
    return _model_row(row) if row else None


def clean_model(data: dict) -> dict:
    provider = data.get("provider")
    if provider not in PROVIDERS:
        raise ValueError(f"provider must be one of {', '.join(PROVIDERS)}")
    model = str(data.get("model") or "").strip()
    if not model:
        raise ValueError("model id is required")
    label = str(data.get("label") or model).strip()[:60]
    base_url = (str(data.get("base_url") or "").strip().rstrip("/")) or None
    if provider == "openai-compatible" and not base_url:
        raise ValueError("an OpenAI-compatible model needs a base URL")
    if base_url and not base_url.startswith(("http://", "https://")):
        raise ValueError("base URL must start with http:// or https://")
    key_env = (str(data.get("api_key_env") or "").strip()) or None
    try:
        check_key_binding(provider, base_url, key_env)
    except ProviderError as e:
        raise ValueError(str(e)) from None
    raw = data.get("params") or {}
    params: dict = {}
    if raw.get("max_tokens") not in (None, ""):
        params["max_tokens"] = max(1, min(int(raw["max_tokens"]), 128000))
    if raw.get("temperature") not in (None, "") and provider != "anthropic":
        params["temperature"] = max(0.0, min(float(raw["temperature"]), 2.0))
    if raw.get("effort") in EFFORTS and provider != "openai-compatible":
        params["effort"] = raw["effort"]
    if raw.get("timeout") not in (None, ""):
        params["timeout"] = max(5, min(int(raw["timeout"]), 3600))
    concurrency = max(1, min(int(data.get("concurrency") or (1 if provider == "openai-compatible" else 4)), 32))
    color = str(data.get("color") or "").strip()
    return {
        "label": label,
        "provider": provider,
        "base_url": base_url,
        "model": model,
        "api_key_env": key_env,
        "params": params,
        "concurrency": concurrency,
        "color": color,
    }


def create_model(db: Database, data: dict) -> dict:
    m = clean_model(data)
    if not m["color"]:
        used = {r["color"] for r in db.all("SELECT color FROM models WHERE archived=0")}
        m["color"] = next((c for c in PALETTE if c not in used), PALETTE[db.scalar("SELECT COUNT(*) FROM models") % len(PALETTE)])
    model_id = db.insert(
        """INSERT INTO models(label, provider, base_url, model, api_key_env, params, concurrency, color, created_at)
           VALUES(?,?,?,?,?,?,?,?,?)""",
        (m["label"], m["provider"], m["base_url"], m["model"], m["api_key_env"], dumps(m["params"]), m["concurrency"], m["color"], now()),
    )
    return get_model(db, model_id)  # type: ignore[return-value]


def update_model(db: Database, model_id: int, data: dict) -> dict:
    current = get_model(db, model_id)
    if not current:
        raise KeyError(model_id)
    m = clean_model({**current, **data})
    db.execute(
        """UPDATE models SET label=?, provider=?, base_url=?, model=?, api_key_env=?, params=?, concurrency=?, color=?
           WHERE id=?""",
        (m["label"], m["provider"], m["base_url"], m["model"], m["api_key_env"], dumps(m["params"]), m["concurrency"], m["color"] or current["color"], model_id),
    )
    return get_model(db, model_id)  # type: ignore[return-value]


def remove_model(db: Database, model_id: int) -> str:
    """Archives a model that has results (history stays intact), deletes one that has none."""
    used = db.scalar("SELECT COUNT(*) FROM run_models WHERE model_id=?", (model_id,))
    if used:
        db.execute("UPDATE models SET archived=1 WHERE id=?", (model_id,))
        return "archived"
    db.execute("DELETE FROM models WHERE id=?", (model_id,))
    return "deleted"
