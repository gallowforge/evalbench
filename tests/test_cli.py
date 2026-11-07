from pathlib import Path

import pytest

from evalbench.cli import main, parse_model_spec

ROOT = Path(__file__).resolve().parents[1]


def test_validate_reports_each_file(tmp_path, capsys):
    bad = tmp_path / "bad.yaml"
    bad.write_text("id: x\ntitle: X\ntasks: [{id: a, prompt: hi, checks: [{type: regex}]}]")
    code = main(["validate", str(ROOT / "evalbench/data/suites/core-battery.yaml"), str(bad)])
    out = capsys.readouterr().out
    assert code == 1
    assert "core-battery: 20 tasks (reasoning 7, constraints 7, debugging 6), 28 checks" in out
    assert "'regex' needs pattern" in out


def test_model_spec():
    assert parse_model_spec("anthropic:claude-haiku-5-5") == {"provider": "anthropic", "model": "claude-haiku-5-5", "base_url": None, "label": "claude-haiku-5-5"}
    spec = parse_model_spec("openai-compatible:qwen3-8b@http://localhost:1234/v1")
    assert spec["base_url"] == "http://localhost:1234/v1" and spec["model"] == "qwen3-8b"
    with pytest.raises(ValueError):
        parse_model_spec("just-a-name")


def test_headless_run_gates_on_pass_rate(tmp_path, fake_server, monkeypatch, capsys):
    monkeypatch.setenv("EVALBENCH_DATA", str(tmp_path))
    suite = str(ROOT / "evalbench/data/suites/core-battery.yaml")
    good = f"openai-compatible:good-model@{fake_server['url']}"
    bad = f"openai-compatible:bad-model@{fake_server['url']}"
    assert main(["run", suite, "--model", good, "--fail-under", "0.9", "--ephemeral", "--allow-local-code"]) == 0
    assert "20/20  passed" in capsys.readouterr().out
    assert main(["run", suite, "--model", good, "--model", bad, "--fail-under", "0.9", "--ephemeral", "--allow-local-code"]) == 2
    capsys.readouterr()
    # Without a sandbox the python tasks are errors, never run unprotected, and count as not passed.
    assert main(["run", suite, "--model", good, "--fail-under", "0.9", "--ephemeral"]) == 2
    assert "15/20  passed" in capsys.readouterr().out
