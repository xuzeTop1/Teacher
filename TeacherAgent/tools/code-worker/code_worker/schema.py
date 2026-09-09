"""Code Worker JSON schemas."""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any


def _pick(data: dict[str, Any], camel: str, snake: str, default: Any = None) -> Any:
    """Read a key that may arrive as camelCase (from Rust) or snake_case."""
    if camel in data:
        return data[camel]
    return data.get(snake, default)


@dataclass
class TestCaseInput:
    name: str = ""
    input: str = ""
    expected_output: str | None = None

    @classmethod
    def from_json(cls, data: dict[str, Any]) -> "TestCaseInput":
        if not isinstance(data, dict):
            raise ValueError("each test case must be an object")
        name = data.get("name", "")
        stdin = data.get("input", "")
        expected_output = _pick(data, "expectedOutput", "expected_output")
        if not isinstance(name, str) or not isinstance(stdin, str):
            raise ValueError("test case name and input must be strings")
        if expected_output is not None and not isinstance(expected_output, str):
            raise ValueError("test case expectedOutput must be a string or null")
        return cls(
            name=name,
            input=stdin,
            expected_output=expected_output,
        )


@dataclass
class CodeRunInput:
    code: str = ""
    stdin: str = ""
    test_cases: list[TestCaseInput] = field(default_factory=list)
    timeout_ms: int = 5000

    @classmethod
    def from_json(cls, data: dict[str, Any]) -> "CodeRunInput":
        if not isinstance(data, dict):
            raise ValueError("code-runner input must be a JSON object")
        if "memoryLimitMb" in data or "memory_limit_mb" in data:
            raise ValueError(
                "memoryLimitMb is unsupported because code-worker has no "
                "OS-level memory isolation; the request was rejected."
            )
        raw_cases = _pick(data, "testCases", "test_cases", [])
        code = data.get("code", "")
        stdin = data.get("stdin", "")
        timeout_ms = _pick(data, "timeoutMs", "timeout_ms", 5000)
        if not isinstance(code, str) or not isinstance(stdin, str):
            raise ValueError("code and stdin must be strings")
        if not isinstance(raw_cases, list):
            raise ValueError("testCases must be an array")
        if isinstance(timeout_ms, bool) or not isinstance(timeout_ms, int):
            raise ValueError("timeoutMs must be an integer")
        test_cases = [TestCaseInput.from_json(tc) for tc in raw_cases]
        return cls(
            code=code,
            stdin=stdin,
            test_cases=test_cases,
            timeout_ms=timeout_ms,
        )


@dataclass
class TestCaseResult:
    name: str = ""
    passed: bool = False
    actual_output: str = ""
    expected_output: str | None = None


@dataclass
class CodeRunResult:
    ok: bool = True
    exit_code: int = 0
    stdout: str = ""
    stderr: str = ""
    test_results: list[TestCaseResult] = field(default_factory=list)
    runtime_ms: int = 0
    error: str | None = None
    warnings: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        # camelCase keys to match Rust serde(rename_all = "camelCase")
        return {
            "ok": self.ok,
            "exitCode": self.exit_code,
            "stdout": self.stdout,
            "stderr": self.stderr,
            "testResults": [
                {
                    "name": tr.name,
                    "passed": tr.passed,
                    "actualOutput": tr.actual_output,
                    "expectedOutput": tr.expected_output,
                }
                for tr in self.test_results
            ],
            "runtimeMs": self.runtime_ms,
            "error": self.error,
            "warnings": self.warnings,
        }

    def to_json(self) -> str:
        return json.dumps(self.to_dict(), ensure_ascii=False)
