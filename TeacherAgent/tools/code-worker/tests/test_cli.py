"""CLI transport regression tests."""

import json
import os
import subprocess
import sys

from code_worker.runner import TRUSTED_EXECUTION_ENV


def test_cli_accepts_json_only_via_stdin():
    env = dict(os.environ)
    env[TRUSTED_EXECUTION_ENV] = "1"
    payload = json.dumps({"code": "print('stdin-ok')", "timeout_ms": 5000})
    completed = subprocess.run(
        [sys.executable, "-m", "code_worker", "run"],
        input=payload,
        text=True,
        capture_output=True,
        env=env,
        timeout=15,
        check=False,
    )
    assert completed.returncode == 0, completed.stderr
    output = json.loads(completed.stdout)
    assert output["ok"] is True
    assert "stdin-ok" in output["stdout"]
    assert payload not in " ".join(completed.args)


def test_cli_rejects_legacy_input_argument():
    completed = subprocess.run(
        [sys.executable, "-m", "code_worker", "run", "--input", '{"code":"print(1)"}'],
        text=True,
        capture_output=True,
        timeout=10,
        check=False,
    )
    assert completed.returncode != 0
    assert "unrecognized arguments" in completed.stderr


def test_cli_rejects_unenforced_memory_limit_as_structured_error():
    payload = json.dumps({"code": "print(1)", "memoryLimitMb": 64})
    completed = subprocess.run(
        [sys.executable, "-m", "code_worker", "run"],
        input=payload,
        text=True,
        capture_output=True,
        timeout=10,
        check=False,
    )
    assert completed.returncode != 0
    output = json.loads(completed.stdout)
    assert output["ok"] is False
    assert "OS-level memory isolation" in output["error"]
