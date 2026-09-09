"""Tests for code-worker schema."""
import json
import pytest
from code_worker.schema import CodeRunInput, CodeRunResult, TestCaseInput, TestCaseResult


class TestCodeRunInput:
    def test_from_json_basic(self):
        data = {"code": "print(1)", "timeout_ms": 5000}
        inp = CodeRunInput.from_json(data)
        assert inp.code == "print(1)"
        assert inp.timeout_ms == 5000
        assert inp.test_cases == []

    def test_from_json_with_test_cases(self):
        data = {
            "code": "print(1)",
            "test_cases": [{"name": "t1", "input": "", "expected_output": "1"}],
        }
        inp = CodeRunInput.from_json(data)
        assert len(inp.test_cases) == 1
        assert inp.test_cases[0].name == "t1"
        assert inp.test_cases[0].expected_output == "1"

    def test_from_json_defaults(self):
        inp = CodeRunInput.from_json({})
        assert inp.code == ""
        assert inp.timeout_ms == 5000

    def test_from_json_camel_case(self):
        """Rust serializes with camelCase — Python must accept both forms."""
        data = {
            "code": "print(1)",
            "timeoutMs": 3000,
            "testCases": [
                {"name": "t1", "input": "", "expectedOutput": "1"},
            ],
        }
        inp = CodeRunInput.from_json(data)
        assert inp.timeout_ms == 3000
        assert len(inp.test_cases) == 1
        assert inp.test_cases[0].expected_output == "1"

    def test_from_json_snake_case_still_works(self):
        data = {
            "code": "print(1)",
            "timeout_ms": 2000,
            "test_cases": [
                {"name": "t1", "input": "", "expected_output": "2"},
            ],
        }
        inp = CodeRunInput.from_json(data)
        assert inp.timeout_ms == 2000
        assert len(inp.test_cases) == 1
        assert inp.test_cases[0].expected_output == "2"

    @pytest.mark.parametrize("field", ["memoryLimitMb", "memory_limit_mb"])
    def test_memory_limit_is_rejected_instead_of_silently_ignored(self, field):
        with pytest.raises(ValueError, match="OS-level memory isolation"):
            CodeRunInput.from_json({"code": "print(1)", field: 64})

    def test_from_json_camel_case_takes_precedence(self):
        """If both are present, camelCase wins (Rust path)."""
        data = {
            "code": "print(1)",
            "timeoutMs": 1000,
            "timeout_ms": 9000,
        }
        inp = CodeRunInput.from_json(data)
        assert inp.timeout_ms == 1000


class TestCodeRunResult:
    def test_to_dict(self):
        result = CodeRunResult(ok=True, exit_code=0, stdout="hello", runtime_ms=42)
        d = result.to_dict()
        assert d["ok"] is True
        assert d["exitCode"] == 0
        assert d["stdout"] == "hello"
        assert d["runtimeMs"] == 42
        assert d["testResults"] == []

    def test_to_json_is_valid_json(self):
        result = CodeRunResult(ok=False, exit_code=1, stderr="error")
        j = result.to_json()
        parsed = json.loads(j)
        assert parsed["ok"] is False

    def test_to_dict_with_test_results(self):
        tr = TestCaseResult(name="t1", passed=True, actual_output="2", expected_output="2")
        result = CodeRunResult(ok=True, test_results=[tr])
        d = result.to_dict()
        assert len(d["testResults"]) == 1
        assert d["testResults"][0]["passed"] is True
        assert d["testResults"][0]["actualOutput"] == "2"
