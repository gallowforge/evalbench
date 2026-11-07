"""Runs untrusted Python in a child process with hard resource limits.

Every execution gets a fresh, private temporary directory, an empty environment, isolated mode
(`-I`), and rlimits on CPU time, address space, file size, open files and process count (it cannot
fork). Output goes to files inside that directory, so the file-size limit caps it too. When this
process runs as root (the sandbox container), the child runs as a separate unprivileged user, so
it cannot signal the service or read another execution's files.

This is one layer. The compose setup adds the outer wall: the sandbox runs in its own container
with no route out, a read-only root filesystem and a process cap."""

from __future__ import annotations

import os
import subprocess
import sys
import tempfile
import time
from dataclasses import asdict, dataclass
from pathlib import Path

HEAD = 6_000
TAIL = 2_000
FILE_LIMIT = 4 * 1024 * 1024
NOBODY = 65534
LAUNCHER = Path(__file__).with_name("launcher.py")


@dataclass
class SandboxResult:
    exit_code: int | None
    stdout: str
    stderr: str
    timed_out: bool
    duration_ms: int
    killed: bool = False

    @property
    def ok(self) -> bool:
        return self.exit_code == 0 and not self.timed_out and not self.killed

    def to_dict(self) -> dict:
        return asdict(self)


def _read(path: str) -> str:
    """The head and the tail of a file, so a marker printed last is never lost."""
    try:
        size = os.path.getsize(path)
        with open(path, "rb") as f:
            if size <= HEAD + TAIL:
                data = f.read()
                return data.decode("utf-8", errors="replace")
            head = f.read(HEAD)
            f.seek(size - TAIL)
            tail = f.read(TAIL)
    except OSError:
        return ""
    return head.decode("utf-8", errors="replace") + "\n[output truncated]\n" + tail.decode("utf-8", errors="replace")


def run_python(code: str, timeout: float = 5.0, memory_mb: int = 256, uid: int | None = None) -> SandboxResult:
    timeout = max(0.5, min(float(timeout), 60.0))
    as_root = os.geteuid() == 0
    child_uid = (uid if uid is not None else NOBODY) if as_root else None

    with tempfile.TemporaryDirectory(prefix="evalbench-") as workdir:
        script = os.path.join(workdir, "main.py")
        out_path = os.path.join(workdir, "stdout")
        err_path = os.path.join(workdir, "stderr")
        with open(script, "w", encoding="utf-8") as f:
            f.write(code)
        if child_uid is not None:
            # The child may read only its own script; the directory stays root's, and the output
            # files are opened here and inherited, so the child never needs to open anything.
            os.chmod(script, 0o400)  # before chown: without CAP_FOWNER root cannot chmod a file it gave away
            os.chown(script, child_uid, child_uid)
            os.chmod(workdir, 0o711)
        else:
            os.chmod(workdir, 0o700)

        env = {
            "PATH": "/usr/local/bin:/usr/bin:/bin",
            "HOME": workdir,
            "LANG": "C.UTF-8",
            "PYTHONDONTWRITEBYTECODE": "1",
            "PYTHONHASHSEED": "0",
        }
        # The launcher sets the limits and then execs the script, so no Python code runs between
        # fork and exec in this (threaded) process.
        argv = [sys.executable, "-I", "-S", str(LAUNCHER), str(int(timeout) + 1), str(memory_mb), str(FILE_LIMIT), script]
        drop = {"user": child_uid, "group": child_uid, "extra_groups": []} if child_uid is not None else {}
        started = time.monotonic()
        timed_out = False
        with open(out_path, "wb") as out, open(err_path, "wb") as err:
            proc = subprocess.Popen(
                argv, cwd=workdir, env=env, stdin=subprocess.DEVNULL, stdout=out, stderr=err,
                start_new_session=True, **drop,
            )
            try:
                code_ = proc.wait(timeout=timeout)
            except subprocess.TimeoutExpired:
                timed_out = True
                proc.kill()
                code_ = proc.wait()
        duration = int((time.monotonic() - started) * 1000)
        signal_ = -code_ if code_ is not None and code_ < 0 else None
        return SandboxResult(
            exit_code=None if timed_out else code_,
            stdout=_read(out_path),
            stderr=_read(err_path),
            timed_out=timed_out or signal_ == 24,  # SIGXCPU: the CPU-time limit
            killed=signal_ in (9, 25) and not timed_out,  # SIGKILL (memory) or SIGXFSZ (output too large)
            duration_ms=duration,
        )
