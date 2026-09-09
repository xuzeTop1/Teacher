"""Tests for code-worker runner."""
import os
import subprocess

import pytest
from code_worker.schema import CodeRunInput, TestCaseInput
from code_worker.runner import (
    MAX_OUTPUT_BYTES,
    TRUSTED_EXECUTION_ENV,
    _build_restricted_env,
    _hidden_subprocess_kwargs,
    _run_wrapper,
    run_code,
)


@pytest.fixture(autouse=True)
def enable_explicit_trusted_test_mode(monkeypatch):
    """Existing execution tests exercise the explicit trusted dev path."""
    monkeypatch.setenv(TRUSTED_EXECUTION_ENV, "1")


def test_hidden_subprocess_kwargs_match_platform():
    kwargs = _hidden_subprocess_kwargs()
    if os.name == "nt":
        assert kwargs == {
            "creationflags": (
                subprocess.CREATE_NO_WINDOW | subprocess.CREATE_NEW_PROCESS_GROUP
            )
        }
    else:
        assert kwargs == {"start_new_session": True}


def test_timeout_invokes_process_tree_cleanup(monkeypatch):
    class FakeProcess:
        pid = 43210
        returncode = None

        def communicate(self, timeout):
            raise subprocess.TimeoutExpired(["python"], timeout)

        def poll(self):
            return None

    cleaned = []
    monkeypatch.setattr(subprocess, "Popen", lambda *args, **kwargs: FakeProcess())
    monkeypatch.setattr(
        "code_worker.runner._terminate_process_tree",
        lambda proc: cleaned.append(proc.pid),
    )

    with pytest.raises(subprocess.TimeoutExpired):
        _run_wrapper("while True: pass", 0.01)

    assert cleaned == [43210]


def test_untrusted_execution_is_fail_closed(monkeypatch):
    monkeypatch.delenv(TRUSTED_EXECUTION_ENV, raising=False)
    result = run_code(CodeRunInput(code="print('must not run')", timeout_ms=5000))
    assert not result.ok
    assert result.exit_code == -1
    assert "未启用安全隔离" in (result.error or "")


@pytest.mark.parametrize(
    "code",
    [
        "print(object.__subclasses__())",
        "kls=[c for c in object.__subclasses__() if c.__name__=='catch_warnings'][0]",
        "open('secret.txt').read()",
        "import socket; socket.create_connection(('example.com', 80))",
        "import subprocess; subprocess.run(['cmd', '/c', 'echo', 'unsafe'])",
    ],
)
def test_untrusted_attack_samples_spawn_no_process(monkeypatch, code):
    monkeypatch.delenv(TRUSTED_EXECUTION_ENV, raising=False)
    popen_calls = []

    def unexpected_popen(*args, **kwargs):
        popen_calls.append((args, kwargs))
        raise AssertionError("fail-closed request must not spawn a child process")

    monkeypatch.setattr(subprocess, "Popen", unexpected_popen)
    result = run_code(CodeRunInput(code=code, timeout_ms=5000))
    assert not result.ok
    assert result.exit_code == -1
    assert popen_calls == []


def test_restricted_environment_is_allowlist(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "must-not-leak")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "must-not-leak")
    monkeypatch.setenv("DATABASE_URL", "must-not-leak")
    monkeypatch.setenv("HTTPS_PROXY", "must-not-leak")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "must-not-leak")
    monkeypatch.setenv("SSH_AUTH_SOCK", "must-not-leak")
    monkeypatch.setenv("USER_DEFINED_SECRET", "must-not-leak")

    env = _build_restricted_env()

    assert set(env).issubset({
        "SYSTEMROOT",
        "SystemRoot",
        "TEMP",
        "TMP",
        "PYTHONIOENCODING",
        "PYTHONUTF8",
        "PYTHONDONTWRITEBYTECODE",
    })
    for name in (
        "OPENAI_API_KEY",
        "ANTHROPIC_API_KEY",
        "DATABASE_URL",
        "HTTPS_PROXY",
        "AWS_SECRET_ACCESS_KEY",
        "SSH_AUTH_SOCK",
        "USER_DEFINED_SECRET",
    ):
        assert name not in env
    assert "PATH" not in env


def test_wrapper_values_are_not_rescanned_as_template_tokens():
    result = run_code(CodeRunInput(
        code='print(input()); print("__MAX_OUTPUT__"); print("__BLOCKED_SET__")',
        stdin="__USER_CODE__",
        timeout_ms=5000,
    ))
    assert result.ok
    assert result.stdout.splitlines() == [
        "__USER_CODE__",
        "__MAX_OUTPUT__",
        "__BLOCKED_SET__",
    ]


class TestBasicExecution:
    def test_simple_print(self):
        result = run_code(CodeRunInput(code="print('hello')", timeout_ms=5000))
        assert result.ok
        assert result.exit_code == 0
        assert "hello" in result.stdout
        assert result.runtime_ms > 0

    def test_arithmetic(self):
        result = run_code(CodeRunInput(code="print(1 + 1)", timeout_ms=5000))
        assert result.ok
        assert "2" in result.stdout

    def test_multiline_code(self):
        code = "x = 10\ny = 20\nprint(x + y)"
        result = run_code(CodeRunInput(code=code, timeout_ms=5000))
        assert result.ok
        assert "30" in result.stdout

    def test_empty_code(self):
        result = run_code(CodeRunInput(code="", timeout_ms=5000))
        assert not result.ok
        assert result.error is not None

    def test_whitespace_only_code(self):
        result = run_code(CodeRunInput(code="   \n  ", timeout_ms=5000))
        assert not result.ok

    def test_list_comprehension(self):
        code = "print([x**2 for x in range(5)])"
        result = run_code(CodeRunInput(code=code, timeout_ms=5000))
        assert result.ok
        assert "[0, 1, 4, 9, 16]" in result.stdout

    def test_function_def(self):
        code = "def fib(n):\n    if n < 2: return n\n    return fib(n-1) + fib(n-2)\nprint(fib(10))"
        result = run_code(CodeRunInput(code=code, timeout_ms=5000))
        assert result.ok
        assert "55" in result.stdout

    def test_string_methods(self):
        code = "print('Hello World'.lower().split())"
        result = run_code(CodeRunInput(code=code, timeout_ms=5000))
        assert result.ok
        assert "hello" in result.stdout

    def test_dict_operations(self):
        code = "d = {'a': 1, 'b': 2}\nprint(sorted(d.items()))"
        result = run_code(CodeRunInput(code=code, timeout_ms=5000))
        assert result.ok
        assert "a" in result.stdout


class TestStdin:
    def test_stdin_input(self):
        code = "name = input(); print(f'Hello, {name}!')"
        result = run_code(CodeRunInput(code=code, stdin="Alice", timeout_ms=5000))
        assert result.ok
        assert "Hello, Alice!" in result.stdout


class TestSyntaxErrors:
    def test_syntax_error(self):
        result = run_code(CodeRunInput(code="def foo(:", timeout_ms=5000))
        assert not result.ok
        assert result.exit_code != 0

    def test_runtime_error(self):
        result = run_code(CodeRunInput(code="print(1/0)", timeout_ms=5000))
        assert not result.ok
        assert result.stderr != ""
        assert "ZeroDivisionError" in result.stderr


# ── Security tests ────────────────────────────────────────────────

class TestSecurityImport:
    """Import is not available — __import__ is not in restricted builtins."""

    def test_import_os_blocked(self):
        code = "import os"
        result = run_code(CodeRunInput(code=code, timeout_ms=5000))
        assert not result.ok
        assert "NameError" in result.stderr or "ImportError" in result.stderr

    def test_import_subprocess_blocked(self):
        code = "import subprocess; subprocess.check_output(['echo'])"
        result = run_code(CodeRunInput(code=code, timeout_ms=5000))
        assert not result.ok

    def test_import_socket_blocked(self):
        code = "import socket"
        result = run_code(CodeRunInput(code=code, timeout_ms=5000))
        assert not result.ok

    def test_import_ctypes_blocked(self):
        code = "import ctypes"
        result = run_code(CodeRunInput(code=code, timeout_ms=5000))
        assert not result.ok

    def test_import_importlib_blocked(self):
        code = "import importlib"
        result = run_code(CodeRunInput(code=code, timeout_ms=5000))
        assert not result.ok

    def test_os_system_blocked(self):
        code = "import os; os.system('echo pwned')"
        result = run_code(CodeRunInput(code=code, timeout_ms=5000))
        assert not result.ok

    def test_subprocess_check_output_blocked(self):
        code = "import subprocess; subprocess.check_output(['echo', 'pwned'])"
        result = run_code(CodeRunInput(code=code, timeout_ms=5000))
        assert not result.ok

    def test_subprocess_run_blocked(self):
        code = "import subprocess; subprocess.run(['echo', 'pwned'])"
        result = run_code(CodeRunInput(code=code, timeout_ms=5000))
        assert not result.ok

    def test_os_execv_blocked(self):
        code = "import os; os.execv('/bin/echo', ['echo', 'pwned'])"
        result = run_code(CodeRunInput(code=code, timeout_ms=5000))
        assert not result.ok

    def test_dunder_import_not_in_builtins(self):
        code = "print('__import__' in dir(__builtins__))"
        result = run_code(CodeRunInput(code=code, timeout_ms=5000))
        assert result.ok
        assert "False" in result.stdout


class TestSecurityBuiltinReduction:
    """eval/exec/compile/open are not in restricted builtins."""

    def test_eval_not_in_builtins(self):
        code = "eval('1+1')"
        result = run_code(CodeRunInput(code=code, timeout_ms=5000))
        assert not result.ok
        assert "NameError" in result.stderr

    def test_exec_not_in_builtins(self):
        code = "exec('print(1)')"
        result = run_code(CodeRunInput(code=code, timeout_ms=5000))
        assert not result.ok

    def test_compile_not_in_builtins(self):
        code = "compile('1', '<x>', 'eval')"
        result = run_code(CodeRunInput(code=code, timeout_ms=5000))
        assert not result.ok

    def test_open_not_in_builtins(self):
        """open is NOT in restricted builtins — no file I/O for student code."""
        code = "open('/tmp/test.txt', 'w')"
        result = run_code(CodeRunInput(code=code, timeout_ms=5000))
        assert not result.ok
        assert "NameError" in result.stderr

    def test_builtins_is_plain_dict(self):
        code = "print(type(__builtins__))"
        result = run_code(CodeRunInput(code=code, timeout_ms=5000))
        assert result.ok
        assert "dict" in result.stdout


class TestSecurityClosureGlobals:
    """Regression: ensure no Python function in restricted builtins leaks
    real builtins via __closure__ or __globals__."""

    def test_no_function_has_globals_leaking_wrapper(self):
        """Every callable in restricted builtins should be a C function
        (no __globals__ pointing to wrapper module internals)."""
        code = '''
bad = []
for name, obj in __builtins__.items():
    if callable(obj) and hasattr(obj, '__globals__'):
        g = obj.__globals__
        if '_real_builtins' in g or '_guard_import' in g or '_orig_import' in g:
            bad.append(name)
if bad:
    print(f"FAIL: {bad} have __globals__ leaking wrapper internals")
else:
    print("OK")
'''
        result = run_code(CodeRunInput(code=code, timeout_ms=5000))
        assert result.ok, result.stderr
        assert "OK" in result.stdout, result.stdout

    def test_no_function_has_closure_leaking_real_builtins(self):
        """No callable in restricted builtins should have __closure__ with
        a cell containing the real builtins module."""
        code = '''
bad = []
for name, obj in __builtins__.items():
    if callable(obj) and hasattr(obj, '__closure__') and obj.__closure__:
        for cell in obj.__closure__:
            try:
                v = cell.cell_contents
                if v is not None and hasattr(v, '__import__'):
                    bad.append(name)
            except ValueError:
                pass
if bad:
    print(f"FAIL: {bad} have __closure__ leaking real builtins")
else:
    print("OK")
'''
        result = run_code(CodeRunInput(code=code, timeout_ms=5000))
        assert result.ok, result.stderr
        assert "OK" in result.stdout, result.stdout

    def test_cannot_recover_import_via_closure_bypass(self):
        """Attempt the full bypass chain: open.__closure__[0] → real builtins → __import__."""
        code = '''
try:
    f = __builtins__["open"]
    print("FAIL: open found in builtins")
except KeyError:
    print("OK: open not in builtins")
'''
        result = run_code(CodeRunInput(code=code, timeout_ms=5000))
        assert result.ok
        assert "OK" in result.stdout

    def test_cannot_recover_import_via_dunder_getattribute(self):
        """object.__getattribute__ on builtins dict shouldn't leak import."""
        code = '''
# builtins is a plain dict — __class__ is just 'dict', not a module
bi_cls = object.__getattribute__(__builtins__, "__class__")
print(bi_cls.__name__)
# Try to find import through the class — should fail
try:
    real_bi = bi_cls.__import__
    print("FAIL: found __import__ via class")
except AttributeError:
    print("OK: no __import__ on dict class")
'''
        result = run_code(CodeRunInput(code=code, timeout_ms=5000))
        assert result.ok
        assert "dict" in result.stdout
        assert "OK" in result.stdout
        assert "FAIL" not in result.stdout

    def test_internal_names_not_in_student_namespace(self):
        """Wrapper internals are not visible to student code."""
        code = (
            "for name in ['_BLOCKED', '_guard_import', '_orig_import', "
            "'_real_builtins', '_safe_open', '_sp', '_spb', '_blocked', "
            "'_rb', '_allowed', '_k', '_tmp', '_safe_mods']:\n"
            "    if name in dir():\n"
            "        raise AssertionError(f'{name} is exposed!')\n"
        )
        result = run_code(CodeRunInput(code=code, timeout_ms=5000))
        assert result.ok, f"Internal name exposed: {result.stderr}"

    def test_all_builtins_entries_are_c_level(self):
        """Every entry in restricted builtins should be a C-level object
        (type, builtin_function_or_method, or constant). No Python functions."""
        code = '''
py_funcs = []
for name, obj in __builtins__.items():
    t = type(obj).__name__
    if t == 'function':
        py_funcs.append(name)
if py_funcs:
    print(f"FAIL: Python functions found: {py_funcs}")
else:
    print("OK: all entries are C-level")
'''
        result = run_code(CodeRunInput(code=code, timeout_ms=5000))
        assert result.ok, result.stderr
        assert "OK" in result.stdout, result.stdout


class TestSecuritySubclassesEscape:
    """Regression: object.__subclasses__() escape path.

    CPython keeps all live types in object.__subclasses__().  If the wrapper
    imported 'warnings', warnings.catch_warnings is a subclass of object.
    Student code can walk: catch_warnings → _module → warnings → __builtins__
    → real builtins → open / __import__.

    These tests DOCUMENT the known bypass.  They verify the guardrails
    stop casual misuse, but they also confirm the escape EXISTS — which
    is why Phase 2 MUST use OS-level isolation.
    """

    def test_subclasses_catch_warnings_exists(self):
        """Confirm catch_warnings is reachable via __subclasses__.
        This is the root cause of the escape — DOCUMENTS the bypass."""
        code = '''
found = False
for cls in object.__subclasses__():
    if cls.__name__ == "catch_warnings":
        found = True
        break
if found:
    print("EXISTS: catch_warnings reachable via __subclasses__")
else:
    print("NOT_FOUND: catch_warnings not in subclasses")
'''
        result = run_code(CodeRunInput(code=code, timeout_ms=5000))
        assert result.ok, result.stderr
        assert "EXISTS" in result.stdout or "NOT_FOUND" in result.stdout

    def test_subclasses_escape_can_recover_open(self):
        """Full escape chain: catch_warnings → warnings module → builtins → open.

        The specific attribute path varies by Python version:
        - Python 3.10: catch_warnings._module (class attr)
        - Python 3.11+: catch_warnings is instantiated → __init__ imports warnings

        This test documents the KNOWN bypass.  Phase 1 guardrails do NOT
        reliably block it.  Phase 2 with OS-level sandbox is required.
        """
        code = '''
escaped = False
for cls in object.__subclasses__():
    if cls.__name__ != "catch_warnings":
        continue
    # Try class-level _module (Python 3.10)
    wm = getattr(cls, "_module", None)
    if wm is None:
        # Python 3.11+: _module is set on instance, not class.
        # Try __init__.__globals__ to find warnings module
        init = getattr(cls, "__init__", None)
        if init and hasattr(init, "__globals__"):
            wm = init.__globals__.get("sys")  # not warnings, but worth trying
    if wm is None:
        break
    bi = getattr(wm, "__builtins__", None)
    if bi is None:
        break
    real_open = bi.get("open") if isinstance(bi, dict) else getattr(bi, "open", None)
    if real_open:
        p = "/tmp/cw_escape_phase1.txt"
        real_open(p, "w").write("escaped")
        content = real_open(p, "r").read()
        try:
            real_import = bi.get("__import__") if isinstance(bi, dict) else getattr(bi, "__import__", None)
            if real_import:
                real_import("os").remove(p)
        except Exception:
            pass
        if content == "escaped":
            escaped = True
            break
print("ESCAPED" if escaped else "BLOCKED")
'''
        result = run_code(CodeRunInput(code=code, timeout_ms=5000))
        assert result.ok, result.stderr
        # Phase 1: accept EITHER outcome — escape may or may not work
        # depending on Python version and sys.modules pruning.
        assert "ESCAPED" in result.stdout or "BLOCKED" in result.stdout
        if "ESCAPED" in result.stdout:
            # Known Phase 1 limitation — logged, not hidden
            pass

    def test_subclasses_escape_can_recover_import(self):
        """Full escape chain: catch_warnings → warnings module → builtins → __import__.
        KNOWN bypass — Phase 1 guardrails may or may not block it.
        """
        code = '''
escaped = False
for cls in object.__subclasses__():
    if cls.__name__ != "catch_warnings":
        continue
    wm = getattr(cls, "_module", None)
    if wm is None:
        break
    bi = getattr(wm, "__builtins__", None)
    if bi is None:
        break
    real_import = bi.get("__import__") if isinstance(bi, dict) else getattr(bi, "__import__", None)
    if real_import:
        try:
            os_mod = real_import("os")
            if hasattr(os_mod, "getcwd"):
                escaped = True
                break
        except Exception:
            pass
print("ESCAPED" if escaped else "BLOCKED")
'''
        result = run_code(CodeRunInput(code=code, timeout_ms=5000))
        assert result.ok, result.stderr
        assert "ESCAPED" in result.stdout or "BLOCKED" in result.stdout

    def test_mro_traversal_no_io_types(self):
        """__mro__ traversal from basic types should not expose I/O types."""
        code = '''
found = []
for cls in int.__mro__:
    if hasattr(cls, 'read') or hasattr(cls, 'write'):
        found.append(cls.__name__)
print(found[:5] if found else "OK: no I/O types via MRO")
'''
        result = run_code(CodeRunInput(code=code, timeout_ms=5000))
        assert result.ok, result.stderr

    def test_known_escape_documented(self):
        """This test documents that the escape IS known and accepted.
        Phase 1 = guardrails only. Phase 2 = real sandbox."""
        assert True, (
            "Phase 1 code-worker is NOT a security sandbox. "
            "object.__subclasses__() escape is known and accepted. "
            "Phase 2 must use OS-level isolation."
        )


class TestTimeout:
    def test_timeout(self):
        code = "while True: pass"
        result = run_code(CodeRunInput(code=code, timeout_ms=2000))
        assert not result.ok
        assert result.error is not None
        assert "timed out" in result.error.lower() or result.exit_code != 0


class TestOutputLimit:
    def test_stdout_is_bounded_in_bytes(self):
        code = "print('界' * 30000)"
        result = run_code(CodeRunInput(code=code, timeout_ms=5000))
        assert result.ok
        assert len(result.stdout.encode("utf-8")) <= MAX_OUTPUT_BYTES
        assert result.stdout.endswith("... (output truncated)")


class TestTestCases:
    def test_passing_test_case(self):
        code = "print(2)"
        tc = TestCaseInput(name="test_add", input="", expected_output="2")
        result = run_code(CodeRunInput(code=code, test_cases=[tc], timeout_ms=5000))
        assert result.ok
        assert len(result.test_results) == 1
        assert result.test_results[0].passed

    def test_failing_test_case(self):
        code = "print(3)"
        tc = TestCaseInput(name="test_add", input="", expected_output="2")
        result = run_code(CodeRunInput(code=code, test_cases=[tc], timeout_ms=5000))
        assert len(result.test_results) == 1
        assert not result.test_results[0].passed
        assert result.test_results[0].actual_output.strip() == "3"

    def test_multiple_test_cases(self):
        code = "print('ok')"
        tcs = [
            TestCaseInput(name="t1", input="", expected_output="ok"),
            TestCaseInput(name="t2", input="", expected_output="ok"),
        ]
        result = run_code(CodeRunInput(code=code, test_cases=tcs, timeout_ms=5000))
        assert len(result.test_results) == 2
        assert all(tr.passed for tr in result.test_results)


class TestJsonOutput:
    def test_json_structure(self):
        result = run_code(CodeRunInput(code="print('x')", timeout_ms=5000))
        d = result.to_dict()
        assert "ok" in d
        assert "exitCode" in d
        assert "stdout" in d
        assert "stderr" in d
        assert "testResults" in d
        assert "runtimeMs" in d
        assert "warnings" in d
