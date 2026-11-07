import os

from evalbench.sandbox.runner import run_python


def test_runs_code_and_captures_output():
    r = run_python("print('hello')")
    assert r.ok and r.stdout == "hello\n"


def test_reports_failures():
    r = run_python("raise SystemExit(3)")
    assert r.exit_code == 3 and not r.ok


def test_wall_clock_timeout():
    r = run_python("while True:\n    pass", timeout=1)
    assert r.timed_out and not r.ok


def test_cannot_fork():
    r = run_python("import os\nos.fork()")
    assert not r.ok and ("BlockingIOError" in r.stderr or "Resource temporarily unavailable" in r.stderr)


def test_cannot_spawn_processes():
    r = run_python("import subprocess\nsubprocess.run(['true'])")
    assert not r.ok


def test_memory_is_capped():
    r = run_python("x = bytearray(1024 * 1024 * 1024)", memory_mb=128)
    assert not r.ok and "MemoryError" in r.stderr


def test_environment_is_empty(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test-not-real")
    r = run_python("import os\nprint(sorted(os.environ))")
    assert "ANTHROPIC_API_KEY" not in r.stdout


def test_runs_in_a_fresh_directory():
    r = run_python("import os\nprint(os.getcwd())\nprint(os.listdir('.'))")
    cwd, listing = r.stdout.splitlines()
    assert "evalbench-" in cwd and sorted(eval(listing)) == ["main.py", "stderr", "stdout"]
    assert not os.path.exists(cwd), "the work directory is removed afterwards"


def test_output_is_truncated_keeping_head_and_tail():
    r = run_python("print('a' * 50000)\nprint('THE-END')")
    assert r.ok and "[output truncated]" in r.stdout and r.stdout.rstrip().endswith("THE-END") and len(r.stdout) < 9000


def test_endless_output_cannot_exhaust_memory():
    r = run_python("while True:\n    print('x' * 1000)", timeout=3)
    assert not r.ok and len(r.stdout) < 9000
