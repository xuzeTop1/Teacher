"""Code Worker CLI entry point.

Usage:
    echo '{"code":"print(1+1)","timeout_ms":5000}' | python -m code_worker run
"""
from __future__ import annotations

import argparse
import json
import sys

try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except AttributeError:
    pass

from .runner import run_code
from .schema import CodeRunInput


def cmd_run(args: argparse.Namespace) -> None:
    """Execute explicitly trusted local Python code received via stdin."""
    raw = sys.stdin.read()

    if not raw or not raw.strip():
        print(json.dumps({"ok": False, "error": "No input provided."}, ensure_ascii=False))
        sys.exit(1)

    try:
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        print(json.dumps({"ok": False, "error": f"Invalid JSON: {e}"}, ensure_ascii=False))
        sys.exit(1)

    try:
        input_data = CodeRunInput.from_json(data)
    except (TypeError, ValueError) as e:
        print(json.dumps({"ok": False, "error": str(e)}, ensure_ascii=False))
        sys.exit(1)
    result = run_code(input_data)
    print(result.to_json())
    sys.exit(0 if result.ok else 1)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="TeacherAgent Code Worker — safe Python code execution"
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    # run subcommand
    subparsers.add_parser("run", help="Execute explicitly trusted local Python code from stdin")

    args = parser.parse_args()

    if args.command == "run":
        cmd_run(args)


if __name__ == "__main__":
    main()
