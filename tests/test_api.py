import csv
import io
import json

from fastapi.testclient import TestClient

from evalbench.app import create_app
from evalbench.auth import COOKIE, hash_password
from tests.conftest import make_settings, wait_for_run


def test_first_start_installs_the_sample_suite(client):
    suites = client.get("/api/suites").json()
    assert [s["id"] for s in suites] == ["core-battery"]
    assert suites[0]["tasks"] == 20
    meta = client.get("/api/meta").json()
    assert meta["sandbox"] == {"mode": "local", "ok": True}
    assert set(meta["keys"]) == {"anthropic", "openai"}


def test_suite_edit_via_yaml_and_form(client):
    payload = client.get("/api/suites/core-battery").json()
    suite = payload["suite"]
    suite["tasks"][0]["title"] = "Ages, retitled"
    saved = client.put("/api/suites/core-battery", json={"suite": suite}).json()
    assert "Ages, retitled" in saved["yaml"]
    bad = client.put("/api/suites/core-battery", json={"yaml": "id: core-battery\ntitle: X\ntasks: []"})
    assert bad.status_code == 422 and bad.json()["detail"]["errors"]
    renamed = client.put("/api/suites/core-battery", json={"yaml": "id: other\ntitle: X\ntasks: [{id: a, prompt: hi}]"})
    assert renamed.status_code == 422
    created = client.post("/api/suites", json={"yaml": "id: mini\ntitle: Mini\ntasks: [{id: a, prompt: hi}]"})
    assert created.status_code == 201
    assert client.post("/api/suites", json={"yaml": "id: mini\ntitle: Mini\ntasks: [{id: a, prompt: hi}]"}).status_code == 409
    check = client.post("/api/suites/validate", json={"yaml": "id: x\ntitle: X\ntasks: [{id: a}]"}).json()
    assert not check["ok"] and "prompt" in check["errors"][0]


def test_model_validation_never_stores_a_key(client):
    r = client.post("/api/models", json={"provider": "openai", "model": "x", "api_key_env": "sk-live-abc 123"})
    assert r.status_code == 422 and "name" in r.json()["detail"]
    m = client.post("/api/models", json={"provider": "anthropic", "model": "claude-haiku-5-5", "params": {"temperature": 0.2, "effort": "low"}}).json()
    assert m["params"] == {"effort": "low"}, "Anthropic takes effort, not temperature"
    assert m["key"]["env"] == "ANTHROPIC_API_KEY"
    assert client.post("/api/models", json={"provider": "openai-compatible", "model": "x"}).status_code == 422


def test_end_to_end_run_rate_and_export(tmp_path, fake_server, monkeypatch):
    monkeypatch.setenv("TEST_ANTHROPIC_API_KEY", "sk-ant-test")
    with TestClient(create_app(make_settings(tmp_path))) as client:
        good = client.post("/api/models", json={"provider": "openai-compatible", "model": "good-model", "base_url": fake_server["url"], "label": "Good"}).json()
        bad = client.post("/api/models", json={"provider": "openai-compatible", "model": "bad-model", "base_url": fake_server["url"], "label": "Bad", "params": {"temperature": 0}}).json()
        claude = client.post("/api/models", json={"provider": "anthropic", "model": "claude-haiku-5-5", "base_url": fake_server["root"], "api_key_env": "TEST_ANTHROPIC_API_KEY", "params": {"effort": "low"}}).json()

        probe = client.post(f"/api/models/{good['id']}/test").json()
        assert probe["ok"] and probe["found"]
        found = client.post("/api/models/discover", json={"provider": "openai-compatible", "base_url": fake_server["url"]}).json()
        assert "good-model" in found["models"]

        run_id = client.post("/api/runs", json={"suite_id": "core-battery", "model_ids": [good["id"], bad["id"], claude["id"]], "label": "test"}).json()["id"]
        run = wait_for_run(client, run_id)
        assert run["status"] == "done"
        summary = {m["label"]: m["summary"] for m in run["models"]}
        assert summary["Good"]["pass_rate"] == 1.0 and summary["Good"]["scored"] == 20
        assert summary["Bad"]["pass_rate"] == 0.0
        assert summary["claude-haiku-5-5"]["pass_rate"] == 1.0

        anthropic_calls = [x for x in fake_server["log"] if x["path"] == "/v1/messages"]
        assert anthropic_calls, "the Anthropic SDK reached the fake server"
        sent = anthropic_calls[-1]
        assert "temperature" not in sent["body"] and sent["body"]["output_config"] == {"effort": "low"}
        h = sent["headers"]
        assert "sk-ant-test" in (h.get("x-api-key", "") + h.get("authorization", "")), "the key comes from the environment"
        assert "anthropic-version" in h
        chat = [x for x in fake_server["log"] if x["path"] == "/v1/chat/completions" and x["body"]["model"] == "bad-model"][-1]
        assert chat["body"]["temperature"] == 0 and chat["body"]["max_tokens"] == 4096

        answers = client.get(f"/api/runs/{run_id}/tasks/d01-window").json()
        assert len(answers["answers"]) == 3 and answers["task"]["checks"][0]["type"] == "python"

        pair = client.get("/api/rate/next", params={"rater": "sam", "run": run_id}).json()
        assert not pair["done"] and "model" not in json.dumps(pair["a"])
        short = client.post("/api/ratings", json={"result_a": pair["a"]["result_id"], "result_b": pair["b"]["result_id"], "preference": 3, "justification": "B."})
        assert short.status_code == 422
        ok = client.post("/api/ratings", json={
            "result_a": pair["a"]["result_id"], "result_b": pair["b"]["result_id"], "preference": 3, "run_id": run_id,
            "justification": "B answers the question; A says it is not sure, which is no help.", "rater": "sam",
            "scores": {"a": {"correctness": 1}, "b": {"correctness": 5}}, "confidence": "high", "seconds": 42,
        })
        assert ok.status_code == 201

        board = client.get("/api/scoreboard/core-battery").json()
        assert board["ratings"] == 1 and len(board["models"]) == 3
        assert board["models"][0]["auto"]["pass_rate"] == 1.0

        rows = list(csv.DictReader(io.StringIO(client.get("/api/export/ratings.csv").text)))
        assert len(rows) == 1 and rows[0]["winner"] == "b" and rows[0]["b_correctness"] == "5"
        prefs = [json.loads(x) for x in client.get("/api/export/preferences.jsonl").text.splitlines()]
        assert len(prefs) == 1 and prefs[0]["chosen"] != prefs[0]["rejected"] and prefs[0]["prompt"]
        results = client.get("/api/export/results.jsonl", params={"run": run_id}).text.splitlines()
        assert len(results) == 60

        second = client.post("/api/runs", json={"suite_id": "core-battery", "model_ids": [good["id"]]}).json()["id"]
        wait_for_run(client, second)
        board = client.get("/api/scoreboard/core-battery").json()
        assert len(board["history"]) == 2
        assert {r["model_id"]: r["regressed"] for r in board["regressions"]}[good["id"]] == 0


def test_provider_errors_are_recorded_not_fatal(tmp_path, fake_server):
    with TestClient(create_app(make_settings(tmp_path))) as client:
        broken = client.post("/api/models", json={"provider": "openai-compatible", "model": "error-model", "base_url": fake_server["url"]}).json()
        missing = client.post("/api/models", json={"provider": "openai", "model": "x", "api_key_env": "UNSET_TEST_API_KEY"}).json()
        run_id = client.post("/api/runs", json={"suite_id": "core-battery", "model_ids": [broken["id"], missing["id"]]}).json()["id"]
        run = wait_for_run(client, run_id)
        assert run["status"] == "failed"
        errors = {r["error"] for r in run["results"]}
        assert any("UNSET_TEST_API_KEY is not set" in e for e in errors)
        assert any("no choices" in e for e in errors)


def test_first_visit_creates_the_owner_account(tmp_path):
    with TestClient(create_app(make_settings(tmp_path, auth=True))) as client:
        meta = client.get("/api/meta").json()
        assert meta["auth"] and meta["setup_required"] and not meta["authenticated"] and "keys" not in meta
        assert not meta["username_required"] and "username" not in meta
        assert client.get("/api/suites").status_code == 401
        assert client.post("/api/auth/setup", json={"username": "ali", "password": "short"}).status_code == 422
        assert client.post("/api/auth/setup", json={"username": "", "password": "correct horse"}).status_code == 422
        assert client.post("/api/auth/setup", json={"username": "a li", "password": "correct horse"}).status_code == 422
        assert client.post("/api/auth/setup", json={"username": "alex42", "password": "correct horse"}).status_code == 200
        assert client.get("/api/suites").status_code == 200, "creating the account signs you in"
        meta = client.get("/api/meta").json()
        assert meta["username"] == "alex42" and not meta["username_required"]
        assert client.post("/api/auth/setup", json={"username": "intruder", "password": "another one"}).status_code == 409
        assert client.post("/api/auth/username", json={"username": "x", "password": "correct horse"}).status_code == 409
        client.post("/api/auth/logout")
        assert client.get("/api/suites").status_code == 401
        assert client.post("/api/auth/login", json={"password": "correct horse"}).status_code == 401, "the username is required"
        ok = client.post("/api/auth/login", json={"username": " Alex42 ", "password": "correct horse"})
        assert ok.status_code == 200, "case and stray spaces from a phone keyboard do not matter"


def test_wrong_username_and_wrong_password_look_the_same(tmp_path):
    with TestClient(create_app(make_settings(tmp_path, auth=True))) as client:
        client.post("/api/auth/setup", json={"username": "owner", "password": "correct horse"})
        client.post("/api/auth/logout")
        wrong_user = client.post("/api/auth/login", json={"username": "someone", "password": "correct horse"})
        wrong_pass = client.post("/api/auth/login", json={"username": "owner", "password": "nope nope"})
        assert wrong_user.status_code == wrong_pass.status_code == 401
        assert wrong_user.json() == wrong_pass.json() == {"detail": "wrong username or password"}
        for _ in range(3):
            client.post("/api/auth/login", json={"username": "someone", "password": "x"})
        throttled = client.post("/api/auth/login", json={"username": "owner", "password": "correct horse"})
        assert throttled.status_code == 429, "both kinds of miss count toward the same back-off"


def test_password_only_install_picks_a_username_once(tmp_path):
    with TestClient(create_app(make_settings(tmp_path, auth=True))) as client:
        # An install from 1.0: a password hash and no username.
        client.app.state.evalbench.db.set_meta("password_hash", hash_password("correct horse"))
        meta = client.get("/api/meta").json()
        assert not meta["setup_required"] and meta["username_required"]
        assert client.post("/api/auth/username", json={"username": "ali", "password": "correct horse"}).status_code == 401
        assert client.post("/api/auth/login", json={"password": "nope nope"}).json()["detail"] == "wrong password"
        assert client.post("/api/auth/login", json={"username": "", "password": "correct horse"}).status_code == 200
        assert client.get("/api/meta").json()["username_required"]
        assert client.post("/api/auth/username", json={"username": "", "password": "correct horse"}).status_code == 422
        assert client.post("/api/auth/username", json={"username": "ali", "password": "nope nope"}).status_code == 401
        assert client.post("/api/auth/username", json={"username": "alex42", "password": "correct horse"}).status_code == 200
        assert client.get("/api/suites").status_code == 200, "the new session cookie follows the new account"
        meta = client.get("/api/meta").json()
        assert meta["username"] == "alex42" and not meta["username_required"]
        assert client.post("/api/auth/username", json={"username": "again", "password": "correct horse"}).status_code == 409
        client.post("/api/auth/logout")
        assert client.post("/api/auth/login", json={"username": "alex42", "password": "correct horse"}).status_code == 200


def test_old_sessions_end_when_the_username_is_picked(tmp_path):
    with TestClient(create_app(make_settings(tmp_path, auth=True))) as client:
        auth = client.app.state.evalbench.auth
        auth.db.set_meta("password_hash", hash_password("correct horse"))
        client.post("/api/auth/login", json={"password": "correct horse"})
        old = client.cookies.get(COOKIE)
        assert auth.valid(old)
        client.post("/api/auth/username", json={"username": "owner", "password": "correct horse"})
        assert client.get("/api/suites").status_code == 200
        assert not auth.valid(old), "a session from before the username no longer counts"


def test_account_from_the_environment(tmp_path):
    settings = make_settings(tmp_path, auth=True, username="owner", password="correct horse")
    with TestClient(create_app(settings)) as client:
        meta = client.get("/api/meta").json()
        assert meta["auth"] and not meta["setup_required"] and not meta["username_required"]
        assert meta["password_from_env"] and meta["username_from_env"]
        assert client.get("/api/health").status_code == 200
        assert client.get("/api/suites").status_code == 401
        assert client.post("/api/auth/login", json={"username": "other", "password": "correct horse"}).status_code == 401
        assert client.post("/api/auth/login", json={"username": "owner", "password": "correct horse"}).status_code == 200
        assert client.get("/api/suites").status_code == 200


def test_password_from_the_environment_without_a_username(tmp_path):
    with TestClient(create_app(make_settings(tmp_path, auth=True, password="correct horse"))) as client:
        assert client.get("/api/meta").json()["username_required"]
        assert client.post("/api/auth/login", json={"password": "correct horse"}).status_code == 200
        assert client.post("/api/auth/username", json={"username": "owner", "password": "correct horse"}).status_code == 200
        client.post("/api/auth/logout")
        assert client.post("/api/auth/login", json={"username": "owner", "password": "correct horse"}).status_code == 200


def test_any_username_from_the_environment_can_finish_setup(tmp_path):
    with TestClient(create_app(make_settings(tmp_path, auth=True, username="Ali Husain"))) as client:
        assert client.post("/api/auth/setup", json={"username": "ali husain", "password": "correct horse"}).status_code == 200
        assert client.get("/api/meta").json()["username"] == "Ali Husain"


def test_odd_unicode_is_a_wrong_answer_not_a_crash(tmp_path):
    for settings in (
        make_settings(tmp_path / "env", auth=True, username="owner", password="correct horse"),
        make_settings(tmp_path / "db", auth=True),
    ):
        settings.data_dir.mkdir()
        with TestClient(create_app(settings)) as client:
            if not settings.password:
                client.post("/api/auth/setup", json={"username": "owner", "password": "correct horse"})
                client.post("/api/auth/logout")
            # A lone surrogate, sent the only way JSON can carry one: as an escape.
            for body in (rb'{"username": "owner", "password": "\ud800"}', rb'{"username": "\ud800", "password": "correct horse"}'):
                sent = client.post("/api/auth/login", content=body, headers={"content-type": "application/json"})
                assert sent.status_code == 401


def test_username_from_the_environment_at_first_visit(tmp_path):
    with TestClient(create_app(make_settings(tmp_path, auth=True, username="owner"))) as client:
        meta = client.get("/api/meta").json()
        assert meta["setup_required"] and meta["username_from_env"]
        bad = client.post("/api/auth/setup", json={"username": "someone", "password": "correct horse"})
        assert bad.status_code == 422 and "EVALBENCH_USERNAME" in bad.json()["detail"]
        assert client.post("/api/auth/setup", json={"username": "Owner", "password": "correct horse"}).status_code == 200


def test_sign_in_off_means_localhost_only(tmp_path):
    with TestClient(create_app(make_settings(tmp_path, allowed_hosts=()))) as client:
        assert client.get("/api/suites").status_code == 403
        assert client.get("/api/suites", headers={"host": "localhost:8484"}).status_code == 200
        assert client.get("/api/suites", headers={"host": "evil.example.com"}).status_code == 403


def test_keys_cannot_be_sent_to_another_server(client, fake_server, monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-secret-value")
    attacker = fake_server["url"]
    cases = [
        {"provider": "anthropic", "model": "x", "base_url": attacker},
        {"provider": "openai-compatible", "model": "x", "base_url": attacker, "api_key_env": "ANTHROPIC_API_KEY"},
        {"provider": "openai-compatible", "model": "x", "base_url": attacker, "api_key_env": "EVALBENCH_PASSWORD"},
        {"provider": "openai-compatible", "model": "x", "base_url": attacker, "api_key_env": "HOME"},
    ]
    for body in cases:
        r = client.post("/api/models", json=body)
        assert r.status_code == 422, body
    before = len(fake_server["log"])
    found = client.post("/api/models/discover", json={"provider": "openai-compatible", "base_url": attacker, "api_key_env": "ANTHROPIC_API_KEY"}).json()
    assert not found["ok"] and "only sent to api.anthropic.com" in found["error"]
    assert not any("sk-ant-secret-value" in json.dumps(x.get("headers", {})) for x in fake_server["log"][before:])
    ok = client.post("/api/models", json={"provider": "openai-compatible", "model": "x", "base_url": attacker, "api_key_env": "GATEWAY_API_KEY"})
    assert ok.status_code == 201, "an endpoint's own key variable is fine"


def test_without_a_sandbox_python_tasks_are_errors_and_resume_regrades(tmp_path, fake_server):
    with TestClient(create_app(make_settings(tmp_path, sandbox_local=False))) as client:
        assert client.get("/api/meta").json()["sandbox"] == {"mode": "off", "ok": False}
        good = client.post("/api/models", json={"provider": "openai-compatible", "model": "good-model", "base_url": fake_server["url"]}).json()
        run_id = client.post("/api/runs", json={"suite_id": "core-battery", "model_ids": [good["id"]]}).json()["id"]
        run = wait_for_run(client, run_id)
        summary = run["models"][0]["summary"]
        assert summary["errors"] == 5 and summary["attempted"] == 20 and summary["pass_rate"] == 0.75
        errored = [r for r in run["results"] if r["status"] == "error"]
        assert all("no code sandbox configured" in r["error"] for r in errored)
        answers = client.get(f"/api/runs/{run_id}/tasks/d01-window").json()["answers"]
        assert answers[0]["output"], "the answer is kept, so it can be graded later without asking again"


def test_ratings_are_not_counted_twice_and_go_with_their_run(client):
    client.post("/api/demo")
    run_id = 6
    pair = client.get("/api/rate/next", params={"rater": "sam", "run": run_id}).json()
    body = {"result_a": pair["a"]["result_id"], "result_b": pair["b"]["result_id"], "preference": 1, "rater": "sam",
            "justification": "B is shorter and still gets every part of it right."}
    assert client.post("/api/ratings", json=body).status_code == 201
    again = client.post("/api/ratings", json=body)
    assert again.status_code == 422 and "already rated" in again.json()["detail"]
    bad = client.post("/api/ratings", json={**body, "rater": "kim", "scores": {"a": {"correctness": "great"}}})
    assert bad.status_code == 422
    total = client.get("/api/export/summary").json()["ratings"]
    in_run = len([r for r in client.get("/api/ratings", params={"limit": 1000}).json() if r["run_id"] == run_id])
    assert client.delete(f"/api/runs/{run_id}").status_code == 200
    assert client.get("/api/export/summary").json()["ratings"] <= total - in_run
    board = client.get("/api/scoreboard/core-battery").json()
    rows = list(csv.DictReader(io.StringIO(client.get("/api/export/ratings.csv").text)))
    assert board["ratings"] == len(rows), "the board and the export agree"


def test_csv_neutralises_formulas(client, fake_server):
    from evalbench.export import _cell

    assert _cell("=HYPERLINK(1)") == "'=HYPERLINK(1)" and _cell("-2") == "'-2" and _cell("fine") == "fine" and _cell(3) == 3


def test_demo_loads_once(client):
    first = client.post("/api/demo").json()
    assert first["runs"] == 6 and first["ratings"] > 40
    assert client.post("/api/demo").json()["already"]
    overview = client.get("/api/overview").json()
    assert overview["demo"] and overview["counts"]["runs"] == 6
    board = client.get("/api/scoreboard/core-battery").json()
    vega = next(r for r in board["regressions"] if r["model_id"] == next(m["id"] for m in board["models"] if m["label"] == "Vega 8B"))
    assert vega["regressed"] >= 1, "the demo tells a regression story"
