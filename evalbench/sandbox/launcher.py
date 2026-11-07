"""Sets resource limits on itself, then replaces itself with the script to run.

Called by runner.py as: launcher.py <cpu seconds> <memory MB> <max file bytes> <script>
Using exec instead of a preexec hook keeps limit-setting out of the threaded parent process."""

import os
import resource
import sys


def main() -> None:
    cpu, memory_mb, file_limit, script = int(sys.argv[1]), int(sys.argv[2]), int(sys.argv[3]), sys.argv[4]
    memory = memory_mb * 1024 * 1024
    resource.setrlimit(resource.RLIMIT_CPU, (cpu, cpu))
    resource.setrlimit(resource.RLIMIT_AS, (memory, memory))
    resource.setrlimit(resource.RLIMIT_FSIZE, (file_limit, file_limit))
    resource.setrlimit(resource.RLIMIT_NOFILE, (32, 32))
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    # Last: from here on the process cannot fork or start threads.
    resource.setrlimit(resource.RLIMIT_NPROC, (0, 0))
    os.execv(sys.executable, [sys.executable, "-I", "-B", script])


if __name__ == "__main__":
    main()
