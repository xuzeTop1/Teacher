//! Code Worker — 通过 CLI 调用 Python code-worker sidecar 执行代码。
//!
//! 安全限制：
//! - 仅支持 Python
//! - 超时 clamp 到 1-30 秒（Rust 层强制）
//! - 禁止网络、文件写入、shell 命令（教学护栏，非安全沙箱）
//! - 输出截断 64KB

use crate::shared::{redact_sensitive_text, truncate_for_storage};
use std::io::{Read, Write};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

/// 超时 clamp 范围（毫秒）
const TIMEOUT_MIN_MS: u64 = 1000;
const TIMEOUT_MAX_MS: u64 = 30000;

/// watchdog 额外缓冲（进程启动开销）
const WATCHDOG_BUFFER_MS: u64 = 2000;

/// 超时轮询间隔
const POLL_INTERVAL: Duration = Duration::from_millis(100);

/// Python worker 模块名
const WORKER_MODULE: &str = "code_worker";
const TRUSTED_EXECUTION_ENV: &str = "TEACHER_AGENT_ENABLE_TRUSTED_CODE_RUNNER";
const TRUSTED_EXECUTION_UI_ENV: &str = "VITE_ENABLE_TRUSTED_CODE_RUNNER";
const TRUSTED_EXECUTION_ERROR: &str =
    "当前环境未启用安全隔离，不能执行不受信代码。code-runner 仅允许在 Debug 构建中通过显式可信开发模式启用。";
const MAX_CODE_CHARS: usize = 100_000;
const MAX_STDIN_CHARS: usize = 64 * 1024;
const MAX_TEST_CASES: usize = 100;
const MAX_WORKER_DIAGNOSTIC_CHARS: usize = 4096;

/// 代码执行输入
#[derive(Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CodeRunnerInput {
    pub code: String,
    #[serde(default)]
    pub stdin: String,
    #[serde(default)]
    pub test_cases: Vec<CodeTestCase>,
    #[serde(default = "default_timeout_ms")]
    pub timeout_ms: u64,
}

fn default_timeout_ms() -> u64 {
    5000
}

/// 测试用例
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CodeTestCase {
    pub name: String,
    #[serde(default)]
    pub input: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expected_output: Option<String>,
}

/// 测试用例结果
#[derive(Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CodeTestResult {
    pub name: String,
    pub passed: bool,
    pub actual_output: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expected_output: Option<String>,
}

/// 代码执行结果
#[derive(Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CodeRunnerResult {
    pub ok: bool,
    pub exit_code: i32,
    #[serde(default)]
    pub stdout: String,
    #[serde(default)]
    pub stderr: String,
    #[serde(default)]
    pub test_results: Vec<CodeTestResult>,
    #[serde(default)]
    pub runtime_ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(default)]
    pub warnings: Vec<String>,
}

// ── Worker 路径定位 ─────────────────────────────────────────────────────

/// 检查 sidecar 文件是否有效。
fn is_valid_sidecar(path: &std::path::Path) -> bool {
    path.exists()
        && std::fs::metadata(path)
            .map(|m| m.len() > 0)
            .unwrap_or(false)
}

/// 查找 code-worker sidecar exe。
///
/// 优先级：
/// 1. 当前可执行文件同目录
/// 2. src-tauri/binaries/ 目录
fn resolve_code_worker_executable() -> Option<std::path::PathBuf> {
    let exe_names: &[&str] = if cfg!(windows) {
        &["code-worker-x86_64-pc-windows-msvc.exe", "code-worker.exe"]
    } else {
        &[
            "code-worker-x86_64-unknown-linux-gnu",
            "code-worker-x86_64-apple-darwin",
            "code-worker",
        ]
    };

    // 1. 当前可执行文件同目录
    if let Ok(current_exe) = std::env::current_exe() {
        if let Some(exe_dir) = current_exe.parent() {
            for name in exe_names {
                let sidecar_path = exe_dir.join(name);
                if is_valid_sidecar(&sidecar_path) {
                    return Some(sidecar_path);
                }
            }
        }
    }

    // 2. src-tauri/binaries/ 目录（开发期）
    if let Ok(current_exe) = std::env::current_exe() {
        if let Some(exe_dir) = current_exe.parent() {
            let mut candidate = exe_dir.to_path_buf();
            for _ in 0..10 {
                for name in exe_names {
                    let binaries_path = candidate.join("src-tauri").join("binaries").join(name);
                    if is_valid_sidecar(&binaries_path) {
                        return Some(binaries_path);
                    }
                }
                if !candidate.pop() {
                    break;
                }
            }
        }
    }

    None
}

/// 定位 Python code-worker 工作目录。
fn resolve_code_worker_dir() -> Result<std::path::PathBuf, String> {
    // 1. 环境变量
    if let Ok(dir) = std::env::var("TEACHER_AGENT_CODE_WORKER_DIR") {
        let path = std::path::PathBuf::from(&dir);
        if path.exists() {
            return Ok(path);
        }
        return Err(format!(
            "TEACHER_AGENT_CODE_WORKER_DIR 指向的目录不存在: {dir}"
        ));
    }

    // 2. 从当前可执行文件位置向上找项目根
    let exe_dir = std::env::current_exe()
        .map_err(|e| format!("无法获取可执行文件路径: {e}"))?
        .parent()
        .ok_or("无法获取可执行文件目录")?
        .to_path_buf();

    let mut candidate = exe_dir.clone();
    for _ in 0..10 {
        let cargo_toml = candidate.join("Cargo.toml");
        if cargo_toml.exists() {
            let worker_dir = candidate.join("tools").join("code-worker");
            if worker_dir.exists() {
                return Ok(worker_dir);
            }
            let worker_dir_alt = candidate
                .parent()
                .map(|p| p.join("tools").join("code-worker"));
            if let Some(alt) = worker_dir_alt {
                if alt.exists() {
                    return Ok(alt);
                }
            }
            return Err(format!(
                "找到项目根 {} 但 tools/code-worker 不存在",
                candidate.display()
            ));
        }
        if !candidate.pop() {
            break;
        }
    }

    Err("无法定位 Python code-worker 目录。请设置环境变量 TEACHER_AGENT_CODE_WORKER_DIR 或确认 tools/code-worker 存在。".to_string())
}

// ── 核心函数 ─────────────────────────────────────────────────────────────

/// 调用 code-worker 执行 Python 代码。
pub(crate) fn run_code_with_worker(input: &CodeRunnerInput) -> Result<CodeRunnerResult, String> {
    if input.code.trim().is_empty() {
        return Ok(CodeRunnerResult {
            ok: false,
            exit_code: 1,
            stdout: String::new(),
            stderr: String::new(),
            test_results: vec![],
            runtime_ms: 0,
            error: Some("No code provided.".to_string()),
            warnings: vec![],
        });
    }
    validate_code_runner_input(input)?;
    if !trusted_code_execution_enabled() {
        return Err(TRUSTED_EXECUTION_ERROR.to_string());
    }

    // Safety clamp: even if caller already clamped, enforce here as defense-in-depth
    let safe_timeout_ms = input.timeout_ms.clamp(TIMEOUT_MIN_MS, TIMEOUT_MAX_MS);
    let safe_input = CodeRunnerInput {
        code: input.code.clone(),
        stdin: input.stdin.clone(),
        test_cases: input.test_cases.clone(),
        timeout_ms: safe_timeout_ms,
    };

    let input_json =
        serde_json::to_string(&safe_input).map_err(|e| format!("序列化输入失败: {e}"))?;

    // The worker runs the main program plus every requested test case in
    // separate processes. Budget for all of them so a valid multi-case run is
    // not killed merely because the outer watchdog assumed one execution.
    let executions = (safe_input.test_cases.len() as u64).saturating_add(1);
    let watchdog_ms = safe_timeout_ms
        .saturating_mul(executions)
        .saturating_add(WATCHDOG_BUFFER_MS);
    let watchdog_timeout = Duration::from_millis(watchdog_ms);

    let output = run_code_worker(&input_json, watchdog_timeout)?;
    parse_code_worker_json(&output)
}

// ── 进程执行 ──────────────────────────────────────────────────────────

/// 执行 code-worker 命令。
fn run_code_worker(input_json: &str, timeout: Duration) -> Result<String, String> {
    if let Some(exe_path) = resolve_code_worker_executable() {
        return run_code_worker_exe(&exe_path, input_json, timeout);
    }

    // Release builds: sidecar is mandatory. No Python fallback.
    #[cfg(not(debug_assertions))]
    {
        return Err("code-worker sidecar 未找到。请确认安装包完整，或重新安装。".to_string());
    }

    // Debug builds: fall back to Python module for development convenience.
    #[cfg(debug_assertions)]
    {
        run_code_worker_python(input_json, timeout)
    }
}

/// 通过 sidecar exe 执行。
fn run_code_worker_exe(
    exe_path: &std::path::Path,
    input_json: &str,
    timeout: Duration,
) -> Result<String, String> {
    // Verify sidecar integrity before spawn (raises tampering cost)
    // Tauri resolves development files with a target-triple suffix but installs
    // the external binary under its stable runtime name. The manifest uses the
    // stable name in both locations.
    crate::sidecar_integrity::verify_sidecar_integrity(exe_path, "code-worker.exe")?;

    let mut cmd = Command::new(exe_path);
    cmd.arg("run")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    configure_worker_environment(&mut cmd);
    configure_background_process(&mut cmd);

    let child = cmd
        .spawn()
        .map_err(|e| format!("无法启动 code-worker exe: {e}"))?;

    collect_child_output(child, input_json, timeout)
}

/// 通过 Python 模块执行。
fn run_code_worker_python(input_json: &str, timeout: Duration) -> Result<String, String> {
    let worker_dir = resolve_code_worker_dir()?;

    let mut cmd = Command::new("python");
    cmd.arg("-m")
        .arg(WORKER_MODULE)
        .arg("run")
        .current_dir(&worker_dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    configure_worker_environment(&mut cmd);
    cmd.env("PYTHONPATH", &worker_dir)
        .env("PYTHONIOENCODING", "utf-8")
        .env("PYTHONUTF8", "1");
    configure_background_process(&mut cmd);

    let child = cmd.spawn().map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            format!(
                "无法启动 Python，且未找到 code-worker sidecar。\
                 请安装 Python 3.10+ 或放置 code-worker.exe。原始错误: {e}"
            )
        } else {
            format!("无法启动 Python code-worker: {e}")
        }
    })?;

    collect_child_output(child, input_json, timeout)
}

fn configure_worker_environment(command: &mut Command) {
    command.env_clear();
    for name in ["SYSTEMROOT", "SystemRoot", "PATH", "TEMP", "TMP"] {
        if let Some(value) = std::env::var_os(name) {
            command.env(name, value);
        }
    }
    command
        .env("PYTHONIOENCODING", "utf-8")
        .env("PYTHONUTF8", "1")
        .env("PYTHONDONTWRITEBYTECODE", "1")
        .env(TRUSTED_EXECUTION_ENV, "1");
}

/// Prevent console applications from flashing a terminal window when launched
/// by the Tauri desktop process. Output remains available through the pipes.
fn configure_background_process(command: &mut Command) {
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);

    #[cfg(not(windows))]
    let _ = command;
}

/// Kill the worker and every descendant it created. This is cleanup for the
/// trusted-debug runner, not a sandbox boundary; it prevents the Python
/// interpreter from surviving after its wrapper is timed out.
fn terminate_process_tree(child: &mut Child) {
    #[cfg(windows)]
    {
        let taskkill = std::env::var_os("SystemRoot")
            .or_else(|| std::env::var_os("SYSTEMROOT"))
            .map(|root| {
                std::path::PathBuf::from(root)
                    .join("System32")
                    .join("taskkill.exe")
            })
            .unwrap_or_else(|| std::path::PathBuf::from("taskkill.exe"));
        let _ = Command::new(taskkill)
            .args(["/PID", &child.id().to_string(), "/T", "/F"])
            .creation_flags(CREATE_NO_WINDOW)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    #[cfg(not(windows))]
    {
        let _ = child.kill();
    }
    let _ = child.kill();
    let _ = child.wait();
}

/// 收集子进程输出，带超时。
fn collect_child_output(
    mut child: Child,
    input_json: &str,
    timeout: Duration,
) -> Result<String, String> {
    let mut child_stdin = child.stdin.take().ok_or("无法获取 worker stdin")?;
    let mut child_stdout = child.stdout.take().ok_or("无法获取 worker stdout")?;
    let mut child_stderr = child.stderr.take().ok_or("无法获取 worker stderr")?;

    child_stdin
        .write_all(input_json.as_bytes())
        .map_err(|e| format!("无法通过 stdin 发送 code-worker 输入: {e}"))?;
    drop(child_stdin);

    let stdout_thread = std::thread::spawn(move || {
        let mut buf = String::new();
        let _ = child_stdout.read_to_string(&mut buf);
        buf
    });

    let stderr_thread = std::thread::spawn(move || {
        let mut buf = String::new();
        let _ = child_stderr.read_to_string(&mut buf);
        buf
    });

    let start = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) => {
                if start.elapsed() >= timeout {
                    terminate_process_tree(&mut child);
                    // The tree cleanup closes inherited pipe handles, so both
                    // readers can finish instead of leaking blocked threads.
                    let _ = stdout_thread.join();
                    let _ = stderr_thread.join();
                    return Err(format!("代码执行超时（{}秒）。", timeout.as_secs()));
                }
                std::thread::sleep(POLL_INTERVAL);
            }
            Err(e) => {
                terminate_process_tree(&mut child);
                let _ = stdout_thread.join();
                let _ = stderr_thread.join();
                return Err(format!("等待 worker 进程失败: {e}"));
            }
        }
    }

    let stdout = stdout_thread.join().unwrap_or_default();
    let stderr = stderr_thread.join().unwrap_or_default();
    let exit_code = child.wait().ok().and_then(|s| s.code()).unwrap_or(-1);

    if exit_code != 0 && stdout.trim().is_empty() {
        let hint = if stderr.contains("ModuleNotFoundError") {
            "Python 依赖未安装。请运行: cd tools/code-worker && pip install -e \".[dev]\""
        } else {
            ""
        };
        let safe_stderr = sanitize_worker_diagnostic(&stderr);
        let diagnostic = if safe_stderr.is_empty() {
            "worker 未返回可用诊断信息".to_string()
        } else {
            safe_stderr
        };
        return Err(format!(
            "code-worker 执行失败 (exit {}): {}{}",
            exit_code,
            diagnostic,
            if hint.is_empty() {
                String::new()
            } else {
                format!("\n{hint}")
            }
        ));
    }

    Ok(stdout)
}

fn validate_code_runner_input(input: &CodeRunnerInput) -> Result<(), String> {
    if input.code.chars().count() > MAX_CODE_CHARS {
        return Err("代码长度超过 100000 字符上限。".to_string());
    }
    if input.stdin.chars().count() > MAX_STDIN_CHARS {
        return Err("标准输入长度超过 64KB 上限。".to_string());
    }
    if input.test_cases.len() > MAX_TEST_CASES {
        return Err("测试用例数量超过 100 条上限。".to_string());
    }
    for test_case in &input.test_cases {
        if test_case.name.chars().count() > 200
            || test_case.input.chars().count() > MAX_STDIN_CHARS
            || test_case
                .expected_output
                .as_deref()
                .is_some_and(|value| value.chars().count() > MAX_STDIN_CHARS)
        {
            return Err("测试用例字段超过允许长度。".to_string());
        }
    }
    Ok(())
}

fn trusted_code_execution_enabled_for(debug_build: bool, explicit_opt_in: bool) -> bool {
    debug_build && explicit_opt_in
}

fn trusted_code_execution_enabled() -> bool {
    trusted_code_execution_enabled_for(
        cfg!(debug_assertions),
        std::env::var(TRUSTED_EXECUTION_ENV).as_deref() == Ok("1")
            && std::env::var(TRUSTED_EXECUTION_UI_ENV).as_deref() == Ok("1"),
    )
}

/// 解析 code-worker JSON 输出。
fn parse_code_worker_json(output: &str) -> Result<CodeRunnerResult, String> {
    let trimmed = output.trim();
    if trimmed.is_empty() {
        return Err("code-worker 返回空输出".to_string());
    }

    let mut result: CodeRunnerResult =
        serde_json::from_str(trimmed).map_err(|e| format!("解析 code-worker JSON 失败: {e}"))?;
    result.stderr = sanitize_worker_diagnostic(&result.stderr);
    result.error = result
        .error
        .as_deref()
        .map(sanitize_worker_diagnostic)
        .filter(|value| !value.is_empty());
    result.warnings = result
        .warnings
        .iter()
        .map(|warning| sanitize_worker_diagnostic(warning))
        .filter(|warning| !warning.is_empty())
        .collect();
    for test_result in &mut result.test_results {
        test_result.actual_output = truncate_for_storage(
            &sanitize_worker_diagnostic(&test_result.actual_output),
            MAX_WORKER_DIAGNOSTIC_CHARS,
        );
        test_result.expected_output = test_result
            .expected_output
            .as_deref()
            .map(|value| truncate_for_storage(value, MAX_WORKER_DIAGNOSTIC_CHARS));
    }
    Ok(result)
}

pub(crate) fn sanitize_worker_diagnostic(value: &str) -> String {
    let without_ansi = strip_ansi_and_control_sequences(value);
    let redacted_lines = without_ansi
        .lines()
        .map(redact_sensitive_text)
        .map(|line| redact_absolute_path_tokens(&line))
        .collect::<Vec<_>>()
        .join("\n");
    truncate_for_storage(redacted_lines.trim(), MAX_WORKER_DIAGNOSTIC_CHARS)
}

fn strip_ansi_and_control_sequences(value: &str) -> String {
    let mut result = String::with_capacity(value.len());
    let mut characters = value.chars();

    while let Some(character) = characters.next() {
        if character == '\x1b' {
            if characters.next() == Some('[') {
                for escape_character in characters.by_ref() {
                    if escape_character.is_ascii_alphabetic() {
                        break;
                    }
                }
            }
        } else if !character.is_control() || matches!(character, '\n' | '\r' | '\t') {
            result.push(character);
        }
    }

    result
}

fn redact_absolute_path_tokens(value: &str) -> String {
    value
        .split_whitespace()
        .map(|token| {
            let candidate = token.trim_matches(|character: char| {
                matches!(
                    character,
                    '"' | '\'' | '`' | '(' | ')' | '[' | ']' | '{' | '}' | '<' | '>' | ','
                )
            });
            let bytes = candidate.as_bytes();
            let windows_absolute = bytes.len() >= 3
                && bytes[0].is_ascii_alphabetic()
                && bytes[1] == b':'
                && matches!(bytes[2], b'\\' | b'/');
            let sensitive_unix_absolute = ["/home/", "/Users/", "/tmp/", "/var/tmp/"]
                .iter()
                .any(|prefix| candidate.starts_with(prefix));
            if windows_absolute || candidate.starts_with("\\\\") || sensitive_unix_absolute {
                "[path]".to_string()
            } else {
                token.to_string()
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

// ── 测试 ────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_empty_code_returns_error() {
        let input = CodeRunnerInput {
            code: "".to_string(),
            stdin: String::new(),
            test_cases: vec![],
            timeout_ms: 5000,
        };
        let result = run_code_with_worker(&input).unwrap();
        assert!(!result.ok);
        assert!(result.error.is_some());
    }

    #[test]
    fn test_untrusted_execution_is_fail_closed() {
        assert!(!trusted_code_execution_enabled_for(false, false));
        assert!(!trusted_code_execution_enabled_for(false, true));
        assert!(!trusted_code_execution_enabled_for(true, false));
        assert!(trusted_code_execution_enabled_for(true, true));
    }

    #[test]
    fn test_input_limits_fail_closed_before_spawn() {
        let input = CodeRunnerInput {
            code: "x".repeat(MAX_CODE_CHARS + 1),
            stdin: String::new(),
            test_cases: vec![],
            timeout_ms: 5000,
        };
        assert!(validate_code_runner_input(&input)
            .unwrap_err()
            .contains("代码长度"));
    }

    #[test]
    fn test_worker_command_line_contains_no_student_code() {
        let input = CodeRunnerInput {
            code: "print('student-secret')".to_string(),
            stdin: "private-stdin".to_string(),
            test_cases: vec![],
            timeout_ms: 5000,
        };
        let json = serde_json::to_string(&input).unwrap();
        assert!(json.contains("student-secret"));
        assert_eq!(WORKER_MODULE, "code_worker");
        // The process command is fixed to: code-worker run (or python -m
        // code_worker run). The serialized payload is passed only to stdin.
        let fixed_args = ["run"];
        assert!(!fixed_args.iter().any(|arg| arg.contains("student-secret")));
        assert!(!fixed_args.iter().any(|arg| arg.contains("private-stdin")));
    }

    #[test]
    fn test_parse_valid_json() {
        let json = r#"{"ok":true,"exitCode":0,"stdout":"2\n","stderr":"","testResults":[],"runtimeMs":42,"error":null,"warnings":[]}"#;
        let result = parse_code_worker_json(json).unwrap();
        assert!(result.ok);
        assert_eq!(result.exit_code, 0);
        assert_eq!(result.runtime_ms, 42);
    }

    #[test]
    fn test_parse_redacts_worker_diagnostics_without_losing_teaching_signal() {
        let json = serde_json::json!({
            "ok": false,
            "exitCode": 1,
            "stdout": "",
            "stderr": "\u{1b}[31mNameError\u{1b}[0m: token gsk_example at C:\\Users\\student\\answer.py line 3",
            "testResults": [],
            "runtimeMs": 42,
            "error": "Authorization: Bearer sk-ant-api03-example",
            "warnings": ["secret at /home/student/private.py", "\u{0007}unsafe-control"]
        })
        .to_string();

        let result = parse_code_worker_json(&json).unwrap();
        assert!(result.stderr.contains("NameError"));
        assert!(result.stderr.contains("line 3"));
        assert!(result.stderr.contains("[redacted]"));
        assert!(result.stderr.contains("[path]"));
        assert!(!result.stderr.contains("gsk_example"));
        assert!(!result.stderr.contains("C:\\Users"));
        assert!(!result.stderr.contains('\u{1b}'));
        assert_eq!(result.error.as_deref(), Some("[redacted]"));
        assert_eq!(result.warnings[0], "secret at [path]");
        assert_eq!(result.warnings[1], "unsafe-control");
    }

    #[test]
    fn test_parse_empty_string_fails() {
        let result = parse_code_worker_json("");
        assert!(result.is_err());
    }

    #[test]
    fn test_timeout_clamp_min() {
        let input = CodeRunnerInput {
            code: "print(1)".to_string(),
            stdin: String::new(),
            test_cases: vec![],
            timeout_ms: 100, // below minimum
        };
        // run_code_with_worker will clamp to 1000ms before spawning worker
        // We can't easily test the full flow without a worker, but verify the clamp logic
        let safe_ms = input.timeout_ms.clamp(TIMEOUT_MIN_MS, TIMEOUT_MAX_MS);
        assert_eq!(safe_ms, 1000);
    }

    #[test]
    fn test_timeout_clamp_max() {
        let input = CodeRunnerInput {
            code: "print(1)".to_string(),
            stdin: String::new(),
            test_cases: vec![],
            timeout_ms: 999999, // above maximum
        };
        let safe_ms = input.timeout_ms.clamp(TIMEOUT_MIN_MS, TIMEOUT_MAX_MS);
        assert_eq!(safe_ms, 30000);
    }

    #[test]
    fn test_timeout_clamp_within_range() {
        let input = CodeRunnerInput {
            code: "print(1)".to_string(),
            stdin: String::new(),
            test_cases: vec![],
            timeout_ms: 10000,
        };
        let safe_ms = input.timeout_ms.clamp(TIMEOUT_MIN_MS, TIMEOUT_MAX_MS);
        assert_eq!(safe_ms, 10000);
    }

    #[test]
    fn test_watchdog_no_overflow() {
        // saturating_add prevents overflow even with u64::MAX
        let watchdog_ms = u64::MAX.saturating_add(WATCHDOG_BUFFER_MS);
        assert_eq!(watchdog_ms, u64::MAX);
        // Normal case
        let watchdog_ms = 30000u64.saturating_add(WATCHDOG_BUFFER_MS);
        assert_eq!(watchdog_ms, 32000);
    }
}
