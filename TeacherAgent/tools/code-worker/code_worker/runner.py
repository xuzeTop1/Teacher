"""Python code runner — executes code in a subprocess with guardrails.

Security classification: **GUARDRAILS, NOT A SANDBOX**
=======================================================
Phase 1 provides defense-in-depth guardrails against casual misuse,
but is NOT a security sandbox.  A determined student can escape via
CPython internals (e.g., object.__subclasses__() → catch_warnings →
warnings module → real builtins → open/import).

This is an inherent limitation of exec() + restricted builtins in
CPython.  The guardrails stop accidental misuse and casual probing;
they do NOT stop a motivated attacker.

Phase 2 MUST use an OS-level or runtime-level isolation boundary:
  - Windows Job Objects (resource limits, no child process creation)
  - seccomp / pledge / unveil (syscall filtering)
  - WebAssembly sandbox (Wasmtime/WasmEdge)
  - Container isolation (gVisor, Firecracker)
  - RestrictedPython (modified CPython bytecode)

Defense in depth (Phase 1 guardrails):
- Layer 1: OS subprocess boundary (process isolation)
- Layer 2: Restricted builtins dict (no __import__, open, eval, exec, compile)
- Layer 3: Import guard on sys.modules (blocked module list)
- Layer 4: Pruned sys.modules (minimal safe set)
- Layer 5: os/subprocess attribute blocking
- Layer 6: Timeout + output limits
"""
from __future__ import annotations

import subprocess
import sys
import time
import os
import re
import signal
import shutil
import tempfile

from .schema import CodeRunInput, CodeRunResult, TestCaseInput, TestCaseResult

MAX_OUTPUT_BYTES = 64 * 1024
TRUSTED_EXECUTION_ENV = "TEACHER_AGENT_ENABLE_TRUSTED_CODE_RUNNER"
TRUSTED_EXECUTION_ERROR = (
    "当前环境未启用安全隔离，不能执行不受信代码。"
    "code-runner 仅允许在 Debug 构建中通过显式可信开发模式启用。"
)
_WRAPPER_TOKEN_PATTERN = re.compile(r"__[A-Z][A-Z0-9_]*__")


def _hidden_subprocess_kwargs() -> dict[str, object]:
    """Start the wrapper in a separately terminable process group."""
    if os.name != "nt":
        return {"start_new_session": True}
    return {
        "creationflags": (
            subprocess.CREATE_NO_WINDOW | subprocess.CREATE_NEW_PROCESS_GROUP
        )
    }


def _terminate_process_tree(proc: subprocess.Popen[bytes]) -> None:
    """Best-effort cleanup for trusted development runs; not a sandbox boundary."""
    if proc.poll() is not None:
        return

    if os.name == "nt":
        system_root = os.environ.get("SYSTEMROOT") or os.environ.get("SystemRoot")
        taskkill = (
            os.path.join(system_root, "System32", "taskkill.exe")
            if system_root
            else "taskkill.exe"
        )
        try:
            subprocess.run(
                [taskkill, "/PID", str(proc.pid), "/T", "/F"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                env=_build_restricted_env(),
                timeout=5,
                check=False,
                creationflags=subprocess.CREATE_NO_WINDOW,
            )
        except (OSError, subprocess.SubprocessError):
            proc.kill()
    else:
        try:
            os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
        except (OSError, ProcessLookupError):
            proc.kill()

    try:
        proc.wait(timeout=5)
    except (OSError, subprocess.SubprocessError):
        if proc.poll() is None:
            proc.kill()
            proc.wait()


def _find_python() -> str:
    """Find the real Python interpreter.

    When running as a PyInstaller bundle, sys.executable is the exe itself,
    not Python.  We need the real interpreter to run the wrapper script.
    """
    # Not frozen → sys.executable is already Python
    if not getattr(sys, "frozen", False):
        return sys.executable

    # Frozen (PyInstaller) → find system Python
    candidates = []

    # 1. sys._base_executable (most reliable in venvs, Python 3.7+)
    base_exec = getattr(sys, "_base_executable", None)
    if base_exec and os.path.isfile(base_exec):
        candidates.append(base_exec)

    # 2. sys.base_prefix / python.exe
    base = getattr(sys, "base_prefix", None)
    if base:
        candidate = os.path.join(base, "python.exe")
        if os.path.isfile(candidate):
            candidates.append(candidate)

    # 3. PATH
    for name in ("python3", "python"):
        found = shutil.which(name)
        if found and os.path.isfile(found):
            candidates.append(found)

    # 4. Common locations
    appdata = os.environ.get("LOCALAPPDATA", "")
    progfiles = os.environ.get("PROGRAMFILES", "")
    for ver in ("Python313", "Python312", "Python311", "Python310"):
        for base_dir in (appdata, progfiles):
            candidate = os.path.join(base_dir, "Programs", "Python", ver, "python.exe")
            if os.path.isfile(candidate):
                candidates.append(candidate)

    # Deduplicate and try each candidate
    seen = set()
    for c in candidates:
        if c not in seen:
            seen.add(c)
            # Verify it actually runs
            try:
                r = subprocess.run(
                    [c, "--version"],
                    capture_output=True,
                    timeout=5,
                    **_hidden_subprocess_kwargs(),
                )
                if r.returncode == 0:
                    return c
            except Exception:
                continue

    raise FileNotFoundError(
        "Cannot find Python interpreter. code-worker sidecar requires Python 3.10+ "
        "installed on the system PATH or in a standard location."
    )


def _render_wrapper_template(template: str, replacements: dict[str, str]) -> str:
    """Replace tokens once so inserted code/stdin cannot trigger later replacements."""
    def replace_token(match: re.Match[str]) -> str:
        token = match.group(0)
        if token not in replacements:
            raise ValueError(f"Unknown wrapper template token: {token}")
        return replacements[token]

    return _WRAPPER_TOKEN_PATTERN.sub(replace_token, template)


# Modules that the import guard will reject
BLOCKED_MODULES = frozenset([
    "socket", "http", "urllib", "ftplib", "smtplib",
    "telnetlib", "xmlrpc", "ssl", "asyncio",
    "subprocess", "ctypes", "importlib",
    "code", "codeop", "compileall", "py_compile",
])

# Safe builtins — no __import__, no open, no eval, no compile, no exec
# Student code gets ONLY these from __builtins__.
_SAFE_BUILTINS: dict[str, object] = {}


def _populate_safe_builtins():
    """Populate the safe builtins dict from the real builtins module."""
    import builtins as _bi

    # Types
    for name in (
        "bool", "int", "float", "complex", "str", "bytes", "bytearray",
        "list", "dict", "set", "frozenset", "tuple",
        "object", "type", "classmethod", "staticmethod", "property", "super",
        "memoryview", "slice", "range", "enumerate", "zip",
        "map", "filter", "reversed", "sorted",
        "Exception", "BaseException",
        "ArithmeticError", "AssertionError", "AttributeError",
        "EOFError", "FloatingPointError", "GeneratorExit", "ImportError",
        "IndentationError", "IndexError", "KeyError", "KeyboardInterrupt",
        "LookupError", "MemoryError", "NameError", "NotImplementedError",
        "OSError", "OverflowError", "RecursionError", "ReferenceError",
        "RuntimeError", "StopIteration", "SyntaxError", "SystemError",
        "SystemExit", "TabError", "TypeError", "UnboundLocalError",
        "UnicodeError", "UnicodeDecodeError", "UnicodeEncodeError",
        "UnicodeTranslateError", "ValueError", "ZeroDivisionError",
        "BlockingIOError", "BrokenPipeError", "ChildProcessError",
        "ConnectionError", "FileExistsError", "FileNotFoundError",
        "InterruptedError", "IsADirectoryError", "NotADirectoryError",
        "PermissionError", "ProcessLookupError", "TimeoutError",
        "Warning", "UserWarning", "DeprecationWarning", "SyntaxWarning",
        "RuntimeWarning", "FutureWarning", "ImportWarning",
        "PendingDeprecationWarning", "ResourceWarning",
    ):
        if hasattr(_bi, name):
            _SAFE_BUILTINS[name] = getattr(_bi, name)

    # Functions — carefully curated, no I/O or import
    for name in (
        "abs", "all", "any", "ascii", "bin", "callable", "chr",
        "dir", "divmod", "format", "getattr", "hasattr", "hash",
        "hex", "id", "isinstance", "issubclass", "iter", "len",
        "max", "min", "next", "oct", "ord", "pow", "print",
        "input", "repr", "reversed", "round", "setattr", "sorted",
        "sum", "vars", "zip", "enumerate", "map", "filter",
        "delattr", "staticmethod", "classmethod", "property", "super",
    ):
        if hasattr(_bi, name):
            _SAFE_BUILTINS[name] = getattr(_bi, name)

    # Constants
    for name in ("True", "False", "None", "NotImplemented", "Ellipsis"):
        if hasattr(_bi, name):
            _SAFE_BUILTINS[name] = getattr(_bi, name)


_populate_safe_builtins()


def _build_restricted_code(input_code: str, stdin_data: str) -> str:
    """Build wrapper script that execs student code in a restricted env.

    The key insight: student code's __builtins__ is a plain dict with only
    safe functions.  There is NO __import__ and NO open in that dict, so
    there is no closure-based recovery path.

    Module-level guards protect sys.modules and os.* as defense-in-depth.
    """

    blocked_repr = repr(list(sorted(BLOCKED_MODULES)))
    stdin_repr = repr(stdin_data)
    code_repr = repr(input_code)
    safe_builtins_repr = repr(list(sorted(_SAFE_BUILTINS.keys())))
    max_output = str(MAX_OUTPUT_BYTES)

    wrapper = '''
import sys
import builtins as _real_builtins

# ── Layer 2+3: Import guard ──────────────────────────────────────
# Block dangerous modules via __import__ replacement.
# The original is held in a closure — but student code won't see this
# function because Layer 2 replaces builtins with a plain dict.
_blocked = __BLOCKED_SET__
_orig_import = _real_builtins.__import__

def _guard_import(name, *args, **kwargs):
    top = name.split(".")[0]
    if top in _blocked:
        raise ImportError(f"Module {name} is blocked for security reasons.")
    return _orig_import(name, *args, **kwargs)

_real_builtins.__import__ = _guard_import

# ── Layer 4: os safety ───────────────────────────────────────────
import os
for _f in ("system", "popen"):
    setattr(os, _f, lambda *a, **kw: (_ for _ in ()).throw(PermissionError("blocked")))
for _a in ("execv","execve","execvp","execvpe","spawnv","spawnve","spawnvp","spawnvpe"):
    if hasattr(os, _a):
        setattr(os, _a, lambda *a, _n=_a: (_ for _ in ()).throw(PermissionError(f"os.{_n} is blocked")))

# ── Layer 4: subprocess stub ─────────────────────────────────────
import types as _t
_sp = _t.ModuleType("subprocess")
_sp.__all__ = []
def _spb(*a, **kw): raise PermissionError("subprocess is blocked.")
for _n in ("Popen","run","call","check_call","check_output","getoutput","getstatusoutput","getstatus"):
    setattr(_sp, _n, _spb)
sys.modules["subprocess"] = _sp

# ── Layer 2: Build restricted builtins dict ──────────────────────
# This is a PLAIN DICT — no closure, no function attributes.
# Student code gets this as __builtins__ and cannot recover originals.
_allowed = __SAFE_BUILTINS_KEYS__
_rb = {}
for _k in _allowed:
    if hasattr(_real_builtins, _k):
        _rb[_k] = getattr(_real_builtins, _k)

# NOTE: open is NOT provided. Any Python function added to _rb would
# carry __closure__ / __globals__ back to the wrapper module, leaking
# _real_builtins.  All entries in _rb are C-level objects (types,
# builtin functions, constants) which have no __globals__ or __closure__.
# Student code has no file I/O.  This is a deliberate Phase 1 trade-off.
# Phase 2 should use OS-level sandboxing (Job Objects / seccomp) and
# re-enable a safe open if needed.

# ── Layer 4: Prune sys.modules ───────────────────────────────────
_safe_mods = {"sys", "io", "builtins", "_thread", "warnings",
              "abc", "encodings", "codecs", "errno"}
for _m in list(sys.modules):
    if _m.split(".")[0] not in _safe_mods:
        del sys.modules[_m]

# ── Stdin injection ──────────────────────────────────────────────
import io as _io
_stdin_data = __STDIN_DATA__
if _stdin_data:
    sys.stdin = _io.StringIO(_stdin_data)

# ── Capture stdout ───────────────────────────────────────────────
_capture = _io.StringIO()
_real_stdout = sys.stdout
sys.stdout = _capture

# ── Execute student code with restricted builtins ────────────────
_student_ns = {"__builtins__": _rb}
_exit_code = 0
try:
    _user_code = __USER_CODE__
    exec(compile(_user_code, "<student>", "exec"), _student_ns)
except SystemExit as _se:
    _exit_code = _se.code if isinstance(_se.code, int) else 1
except Exception as _e:
    sys.stdout = _real_stdout
    print(f"{type(_e).__name__}: {_e}", file=sys.stderr)
    _exit_code = 1
else:
    sys.stdout = _real_stdout
    _output = _capture.getvalue()
    if len(_output.encode("utf-8")) > __MAX_OUTPUT__:
        _output = _output[:__MAX_OUTPUT__] + "\\n... (output truncated)"
    print(_output, end="")

sys.exit(_exit_code)
'''
    return _render_wrapper_template(
        wrapper,
        {
            "__BLOCKED_SET__": blocked_repr,
            "__SAFE_BUILTINS_KEYS__": safe_builtins_repr,
            "__STDIN_DATA__": stdin_repr,
            "__USER_CODE__": code_repr,
            "__MAX_OUTPUT__": max_output,
        },
    )


def _build_test_wrapper(user_code: str, tc_input: str) -> str:
    """Build wrapper for a single test case — same restricted model."""
    blocked_repr = repr(list(sorted(BLOCKED_MODULES)))
    safe_builtins_repr = repr(list(sorted(_SAFE_BUILTINS.keys())))
    tc_input_repr = repr(tc_input)
    code_repr = repr(user_code)

    wrapper = '''
import sys
import builtins as _real_builtins

_blocked = __BLOCKED_SET__
_orig_import = _real_builtins.__import__
def _guard_import(name, *args, **kwargs):
    if name.split(".")[0] in _blocked:
        raise ImportError(f"Module {name} is blocked.")
    return _orig_import(name, *args, **kwargs)
_real_builtins.__import__ = _guard_import

import os
for _f in ("system", "popen"):
    setattr(os, _f, lambda *a, **kw: (_ for _ in ()).throw(PermissionError("blocked")))
for _a in ("execv","execve","execvp","execvpe","spawnv","spawnve","spawnvp","spawnvpe"):
    if hasattr(os, _a):
        setattr(os, _a, lambda *a, _n=_a: (_ for _ in ()).throw(PermissionError(f"os.{_n} is blocked")))

import types as _t
_sp = _t.ModuleType("subprocess")
_sp.__all__ = []
def _spb(*a, **kw): raise PermissionError("subprocess blocked.")
for _n in ("Popen","run","call","check_call","check_output","getoutput","getstatusoutput","getstatus"):
    setattr(_sp, _n, _spb)
sys.modules["subprocess"] = _sp

_allowed = __SAFE_BUILTINS_KEYS__
_rb = {}
for _k in _allowed:
    if hasattr(_real_builtins, _k):
        _rb[_k] = getattr(_real_builtins, _k)

# NOTE: open is NOT provided to student code (see _build_restricted_code).

import io as _io
sys.stdin = _io.StringIO(__TC_INPUT__)

_capture = _io.StringIO()
sys.stdout = _capture

_ns = {"__builtins__": _rb}
try:
    exec(compile(__USER_CODE__, "<student>", "exec"), _ns)
    _output = _capture.getvalue().rstrip("\\n")
    sys.stdout = sys.__stdout__
    print(_output)
except Exception as _e:
    sys.stdout = sys.__stdout__
    print(f"Error: {type(_e).__name__}: {_e}", file=sys.stderr)
    sys.exit(1)
'''
    return _render_wrapper_template(
        wrapper,
        {
            "__BLOCKED_SET__": blocked_repr,
            "__SAFE_BUILTINS_KEYS__": safe_builtins_repr,
            "__TC_INPUT__": tc_input_repr,
            "__USER_CODE__": code_repr,
        },
    )


def run_code(input_data: CodeRunInput) -> CodeRunResult:
    """Execute explicitly trusted local code in a restricted subprocess.

    The restricted Python namespace is a teaching guardrail, not a sandbox.
    Callers must explicitly opt in; the Rust boundary independently enforces
    the same fail-closed policy before this worker is started.
    """
    if not input_data.code.strip():
        return CodeRunResult(
            ok=False, exit_code=1,
            error="No code provided.",
            warnings=["Empty code string."],
        )
    if os.environ.get(TRUSTED_EXECUTION_ENV) != "1":
        return CodeRunResult(
            ok=False,
            exit_code=-1,
            error=TRUSTED_EXECUTION_ERROR,
            warnings=["Untrusted code execution is disabled because OS-level isolation is unavailable."],
        )

    wrapper = _build_restricted_code(input_data.code, input_data.stdin)
    timeout_s = max(1, min(30, input_data.timeout_ms / 1000))
    start_time = time.monotonic()

    try:
        returncode, raw_stdout, raw_stderr = _run_wrapper(wrapper, timeout_s)
        elapsed_ms = int((time.monotonic() - start_time) * 1000)

        # Decode stdout/stderr as UTF-8 (not system default which may be GBK)
        stdout = (raw_stdout or b"").decode("utf-8", errors="replace")
        stderr = (raw_stderr or b"").decode("utf-8", errors="replace")

        stdout = _truncate_output(stdout, "... (output truncated)")
        stderr = _truncate_output(stderr, "... (error output truncated)")

        test_results = []
        if input_data.test_cases:
            test_results = _run_test_cases(input_data.code, input_data.test_cases, timeout_s)

        return CodeRunResult(
            ok=returncode == 0,
            exit_code=returncode,
            stdout=stdout, stderr=stderr,
            test_results=test_results,
            runtime_ms=elapsed_ms,
        )
    except subprocess.TimeoutExpired:
        elapsed_ms = int((time.monotonic() - start_time) * 1000)
        return CodeRunResult(
            ok=False, exit_code=-1,
            error=f"Code execution timed out ({timeout_s}s limit).",
            runtime_ms=elapsed_ms,
            warnings=["Execution was killed due to timeout."],
        )
    except Exception as e:
        elapsed_ms = int((time.monotonic() - start_time) * 1000)
        return CodeRunResult(
            ok=False, exit_code=-1,
            error=f"Execution failed: {type(e).__name__}: {e}",
            runtime_ms=elapsed_ms,
        )


def _truncate_output(value: str, marker: str) -> str:
    raw = value.encode("utf-8")
    if len(raw) <= MAX_OUTPUT_BYTES:
        return value
    marker_bytes = f"\n{marker}".encode("utf-8")
    head = raw[: MAX_OUTPUT_BYTES - len(marker_bytes)]
    return head.decode("utf-8", errors="ignore") + marker_bytes.decode("utf-8")


def _run_wrapper(wrapper: str, timeout_s: float) -> tuple[int, bytes, bytes]:
    """Run a generated wrapper from a temporary file, never from argv.

    Windows has a short command-line limit; passing generated source via ``-c``
    also exposes it to process listings. The file exists only for the child
    lifetime and is removed on every exit path.
    """
    wrapper_path: str | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w", encoding="utf-8", suffix=".py", prefix="teacheragent-code-",
            dir=tempfile.gettempdir(), delete=False,
        ) as wrapper_file:
            wrapper_file.write(wrapper)
            wrapper_path = wrapper_file.name
        proc = subprocess.Popen(
            [_find_python(), wrapper_path],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=_build_restricted_env(),
            cwd=tempfile.gettempdir(),
            **_hidden_subprocess_kwargs(),
        )
        stdout, stderr = proc.communicate(timeout=timeout_s)
    except subprocess.TimeoutExpired:
        _terminate_process_tree(proc)
        raise
    finally:
        if wrapper_path:
            try:
                os.unlink(wrapper_path)
            except OSError:
                pass
    return proc.returncode, stdout or b"", stderr or b""


def _run_test_cases(
    user_code: str,
    test_cases: list[TestCaseInput],
    timeout_s: float,
) -> list[TestCaseResult]:
    """Run each test case in a separate subprocess."""
    results = []
    for tc in test_cases:
        wrapper = _build_test_wrapper(user_code, tc.input)
        try:
            returncode, stdout, stderr = _run_wrapper(wrapper, timeout_s)
            actual = _truncate_output(
                (stdout or b"").decode("utf-8", errors="replace").rstrip("\n"),
                "... (test output truncated)",
            )
            passed = returncode == 0
            if returncode != 0:
                diagnostic = _truncate_output(
                    (stderr or b"").decode("utf-8", errors="replace").strip(),
                    "... (test error truncated)",
                )
                actual = f"Error: {diagnostic or 'test process exited unsuccessfully'}"
            if tc.expected_output is not None:
                passed = actual.strip() == tc.expected_output.strip()
        except subprocess.TimeoutExpired:
            actual = "Error: timed out"
            passed = False
        except Exception as e:
            actual = f"Error: {type(e).__name__}: {e}"
            passed = False

        results.append(TestCaseResult(
            name=tc.name, passed=passed,
            actual_output=actual,
            expected_output=tc.expected_output,
        ))
    return results


def _build_restricted_env() -> dict[str, str]:
    """Build the minimum environment needed by the child interpreter.

    This is an allowlist by construction. Provider credentials, proxy
    settings, cloud credentials, SSH variables, database URLs, and arbitrary
    user-defined secrets are never copied from the parent process.
    """
    allowed_names = ("SYSTEMROOT", "SystemRoot", "TEMP", "TMP")
    env = {
        name: value
        for name in allowed_names
        if (value := os.environ.get(name))
    }
    env.update({
        "PYTHONIOENCODING": "utf-8",
        "PYTHONUTF8": "1",
        "PYTHONDONTWRITEBYTECODE": "1",
    })
    return env
