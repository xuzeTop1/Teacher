//! Worker — 通过 CLI 调用 Python document-worker sidecar。
//!
//! 安全限制：
//! - 文件大小限制 50MB
//! - 超时 30 秒
//! - 不执行宏/脚本
//! - 只输出 draft 级别结果

use rand::RngCore;
use std::collections::HashMap;
use std::fs::{File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use std::process::{Child, Command};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

/// 文件大小限制：50MB（预览解析上限）
const MAX_FILE_SIZE: u64 = 50 * 1024 * 1024;

/// Worker 执行超时：30 秒
const WORKER_TIMEOUT: Duration = Duration::from_secs(30);

/// 超时轮询间隔
const POLL_INTERVAL: Duration = Duration::from_millis(200);

/// Python worker 模块名
const WORKER_MODULE: &str = "document_worker";
const AUTHORIZATION_TTL: Duration = Duration::from_secs(10 * 60);
const MAX_PENDING_AUTHORIZATIONS: usize = 32;
const MAX_MATH_EXPRESSION_CHARS: usize = 2_000;
const MAX_MATH_VARIABLE_CHARS: usize = 32;
const MAX_MATH_NESTING_DEPTH: usize = 32;
const MAX_MATH_TOKENS: usize = 512;
const SUPPORTED_MATH_OPERATIONS: [&str; 8] = [
    "simplify",
    "expand",
    "factor",
    "diff",
    "integrate",
    "solve",
    "eval",
    "limit",
];
const SAFE_MATH_IDENTIFIERS: [&str; 12] = [
    "sin", "cos", "tan", "ln", "log", "exp", "sqrt", "abs", "pi", "E", "I", "oo",
];

#[derive(Debug)]
struct AuthorizedDocument {
    canonical_path: PathBuf,
    file_name: String,
    length: u64,
    modified: Option<std::time::SystemTime>,
    authorized_at: Instant,
}

static AUTHORIZED_DOCUMENTS: OnceLock<Mutex<HashMap<String, AuthorizedDocument>>> = OnceLock::new();

/// 单页/单工作表内容
#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub(crate) struct PageOrSheet {
    pub name: String,
    pub text: String,
}

/// 文档解析结果（camelCase 对齐 Python/TS）
#[derive(Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ParseDocumentResult {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plain_text: Option<String>,
    #[serde(default)]
    pub pages_or_sheets: Vec<PageOrSheet>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(default)]
    pub warnings: Vec<String>,
}

/// 数学计算结果（camelCase 对齐 Python/TS）
#[derive(Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ComputeMathResult {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub input: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latex: Option<String>,
    #[serde(default)]
    pub steps: Vec<String>,
    #[serde(default)]
    pub warnings: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

// ── Worker 路径定位 ─────────────────────────────────────────────────────

/// 检查 sidecar 文件是否有效（存在且非空）。
/// 0 字节的 placeholder 文件不算有效 sidecar。
fn is_valid_sidecar(path: &std::path::Path) -> bool {
    path.exists()
        && std::fs::metadata(path)
            .map(|m| m.len() > 0)
            .unwrap_or(false)
}

/// 查找 sidecar exe。
///
/// 检查两个名称（Tauri 生产期使用 triple 后缀名，开发期可能使用短名）：
/// - `document-worker-x86_64-pc-windows-msvc.exe`（Tauri externalBin 产物）
/// - `document-worker.exe`（PyInstaller 直接产物）
///
/// 优先级：
/// 1. 当前可执行文件同目录（Tauri 生产打包后 sidecar 的位置）
/// 2. src-tauri/binaries/ 目录（开发期手动放置）
///
/// 返回 None 表示未找到，应回退到 Python 模块路径。
fn resolve_worker_executable() -> Option<std::path::PathBuf> {
    // 按优先级排列：triple 后缀名优先（Tauri 标准），短名次之
    let exe_names: &[&str] = if cfg!(windows) {
        &[
            "document-worker-x86_64-pc-windows-msvc.exe",
            "document-worker.exe",
        ]
    } else {
        &[
            "document-worker-x86_64-unknown-linux-gnu",
            "document-worker-x86_64-apple-darwin",
            "document-worker",
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

/// 定位 Python worker 工作目录。
///
/// 优先级：
/// 1. 环境变量 TEACHER_AGENT_DOCUMENT_WORKER_DIR
/// 2. 项目根目录下 tools/document-worker
fn resolve_worker_dir() -> Result<std::path::PathBuf, String> {
    // 1. 环境变量
    if let Ok(dir) = std::env::var("TEACHER_AGENT_DOCUMENT_WORKER_DIR") {
        let path = std::path::PathBuf::from(&dir);
        if path.exists() {
            return Ok(path);
        }
        return Err(format!(
            "TEACHER_AGENT_DOCUMENT_WORKER_DIR 指向的目录不存在: {dir}"
        ));
    }

    // 2. 从当前可执行文件位置向上找项目根（Cargo.toml 所在目录）
    let exe_dir = std::env::current_exe()
        .map_err(|e| format!("无法获取可执行文件路径: {e}"))?
        .parent()
        .ok_or("无法获取可执行文件目录")?
        .to_path_buf();

    // 尝试从 exe 位置向上查找 Cargo.toml（定位项目根）
    let mut candidate = exe_dir.clone();
    for _ in 0..10 {
        let cargo_toml = candidate.join("Cargo.toml");
        if cargo_toml.exists() {
            let worker_dir = candidate.join("tools").join("document-worker");
            if worker_dir.exists() {
                return Ok(worker_dir);
            }
            // 也试试上一级（workspace 布局）
            let worker_dir_alt = candidate
                .parent()
                .map(|p| p.join("tools").join("document-worker"));
            if let Some(alt) = worker_dir_alt {
                if alt.exists() {
                    return Ok(alt);
                }
            }
            return Err(format!(
                "找到项目根 {} 但 tools/document-worker 不存在，请先安装: \
                 cd tools/document-worker && pip install -e \".[dev]\"",
                candidate.display()
            ));
        }
        if !candidate.pop() {
            break;
        }
    }

    Err(
        "无法定位 Python worker 目录。请设置环境变量 TEACHER_AGENT_DOCUMENT_WORKER_DIR \
         或确认 tools/document-worker 存在于项目根目录。"
            .to_string(),
    )
}

// ── 核心函数 ─────────────────────────────────────────────────────────────

/// 解析已通过 Rust 系统文件选择器授权的一次性文档令牌。
///
/// 前端永远拿不到本地绝对路径。授权文件在解析前通过已打开的文件句柄
/// 复制到应用临时 staging 目录，worker 只读取该副本。
pub(crate) fn parse_authorized_document(
    authorization_token: &str,
) -> Result<ParseDocumentResult, String> {
    if authorization_token.len() != 64
        || !authorization_token
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit())
    {
        return Err("文档授权无效或已过期，请重新选择文件。".to_string());
    }

    let authorization = take_authorization(authorization_token)?;
    let current_canonical = std::fs::canonicalize(&authorization.canonical_path)
        .map_err(|_| "文档授权已失效，请重新选择文件。".to_string())?;
    if current_canonical != authorization.canonical_path {
        return Err("文档在授权后发生变化，请重新选择文件。".to_string());
    }

    let mut source = File::open(&authorization.canonical_path)
        .map_err(|_| "无法读取已授权文档，请重新选择文件。".to_string())?;
    let opened_metadata = source
        .metadata()
        .map_err(|_| "无法检查已授权文档，请重新选择文件。".to_string())?;
    if !opened_metadata.is_file()
        || opened_metadata.len() != authorization.length
        || opened_metadata.modified().ok() != authorization.modified
    {
        return Err("文档在授权后发生变化，请重新选择文件。".to_string());
    }

    let extension = authorization
        .canonical_path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let staging_dir = std::env::temp_dir().join("teacher-agent-import-staging");
    std::fs::create_dir_all(&staging_dir).map_err(|_| "无法准备安全文档解析目录。".to_string())?;
    let canonical_staging_dir = std::fs::canonicalize(&staging_dir)
        .map_err(|_| "无法检查安全文档解析目录。".to_string())?;
    let staged_path = canonical_staging_dir.join(format!("{authorization_token}.{extension}"));
    let mut staged = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&staged_path)
        .map_err(|_| "无法创建安全文档副本，请重试。".to_string())?;
    let copy_result = std::io::copy(&mut source, &mut staged);
    let _ = staged.flush();
    drop(staged);

    let result = match copy_result {
        Ok(bytes) if bytes == authorization.length && bytes <= MAX_FILE_SIZE => {
            let staged_canonical = std::fs::canonicalize(&staged_path)
                .map_err(|_| "无法检查安全文档副本。".to_string())?;
            if !staged_canonical.starts_with(&canonical_staging_dir) {
                Err("安全文档副本路径校验失败。".to_string())
            } else {
                parse_trusted_document_path(&staged_canonical).map(|mut parsed| {
                    if parsed.title.as_deref() == Some(authorization_token) {
                        parsed.title = Path::new(&authorization.file_name)
                            .file_stem()
                            .and_then(|value| value.to_str())
                            .map(str::to_string);
                    }
                    parsed
                })
            }
        }
        Ok(_) => Err("文档在复制期间发生变化，请重新选择文件。".to_string()),
        Err(_) => Err("复制已授权文档失败，请重试。".to_string()),
    };
    let _ = std::fs::remove_file(&staged_path);
    result
}

/// Worker 只允许读取 Rust 创建的 staging 副本；不得直接暴露为 Tauri command。
fn parse_trusted_document_path(path: &Path) -> Result<ParseDocumentResult, String> {
    if !path.exists() {
        return Ok(ParseDocumentResult {
            ok: false,
            file_type: None,
            title: None,
            plain_text: None,
            pages_or_sheets: vec![],
            error: Some("文件不存在或授权已失效。".to_string()),
            warnings: vec![],
        });
    }

    let metadata = std::fs::metadata(path).map_err(|e| format!("无法读取文件元数据: {e}"))?;
    if metadata.len() > MAX_FILE_SIZE {
        return Ok(ParseDocumentResult {
            ok: false,
            file_type: None,
            title: None,
            plain_text: None,
            pages_or_sheets: vec![],
            error: Some(format!(
                "文件大小超过当前上限 50MB（{}MB）。扫描版 PDF 或含大量图片的文档建议压缩或拆分。",
                metadata.len() / (1024 * 1024)
            )),
            warnings: vec![],
        });
    }

    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    if !["pdf", "docx", "xlsx"].contains(&ext.as_str()) {
        return Ok(ParseDocumentResult {
            ok: false,
            file_type: None,
            title: None,
            plain_text: None,
            pages_or_sheets: vec![],
            error: Some(format!("不支持的文件类型: .{ext}，支持 .pdf/.docx/.xlsx")),
            warnings: vec![],
        });
    }

    let trusted_path = path
        .to_str()
        .ok_or_else(|| "文档路径编码不受支持。".to_string())?;
    let output = run_worker(&["parse", "--file", trusted_path])?;
    parse_worker_json(&output)
}

/// 调用 Python worker 执行数学计算。
pub(crate) fn compute_math_with_worker(
    expression: &str,
    operation: &str,
    variable: &str,
) -> Result<ComputeMathResult, String> {
    if expression.trim().is_empty() {
        return Ok(ComputeMathResult {
            ok: false,
            input: None,
            result: None,
            latex: None,
            steps: vec![],
            warnings: vec![],
            error: Some("表达式不能为空".to_string()),
        });
    }

    let (expression, operation, variable) =
        validate_math_worker_input(expression, operation, variable)?;
    let output = run_worker(&[
        "math",
        "--expr",
        &expression,
        "--op",
        &operation,
        "--var",
        &variable,
    ])?;
    parse_worker_json(&output)
}

fn validate_math_worker_input(
    expression: &str,
    operation: &str,
    variable: &str,
) -> Result<(String, String, String), String> {
    let expression = expression.split_whitespace().collect::<Vec<_>>().join(" ");
    if expression.is_empty() {
        return Err("数学表达式不能为空。".to_string());
    }
    if expression.chars().count() > MAX_MATH_EXPRESSION_CHARS {
        return Err(format!(
            "数学表达式过长，最多允许 {MAX_MATH_EXPRESSION_CHARS} 个字符。"
        ));
    }

    let operation = operation.trim().to_ascii_lowercase();
    if !SUPPORTED_MATH_OPERATIONS.contains(&operation.as_str()) {
        return Err("数学操作不受支持。".to_string());
    }

    let variable = variable.trim().to_string();
    if variable.is_empty()
        || variable.chars().count() > MAX_MATH_VARIABLE_CHARS
        || !variable.chars().enumerate().all(|(index, ch)| {
            ch.is_ascii_alphanumeric() && (index > 0 || ch.is_ascii_alphabetic())
        })
    {
        return Err("数学变量必须是 1-32 位 ASCII 字母数字标识符，且以字母开头。".to_string());
    }

    let chars = expression.chars().collect::<Vec<_>>();
    let mut depth = 0usize;
    let mut token_count = 0usize;
    let mut current_identifier = String::new();

    let validate_identifier = |identifier: &str| -> Result<(), String> {
        if identifier.is_empty()
            || identifier == variable
            || SAFE_MATH_IDENTIFIERS.contains(&identifier)
        {
            Ok(())
        } else {
            Err("数学表达式包含不受支持的标识符。".to_string())
        }
    };

    for (index, ch) in chars.iter().copied().enumerate() {
        let allowed = ch.is_ascii_alphanumeric()
            || matches!(ch, '+' | '-' | '*' | '/' | '^' | '(' | ')' | ',' | '.')
            || ch == ' ';
        if !allowed {
            return Err("数学表达式包含不受支持的字符。".to_string());
        }

        if ch.is_ascii_alphabetic() || (ch.is_ascii_digit() && !current_identifier.is_empty()) {
            current_identifier.push(ch);
            continue;
        }
        validate_identifier(&current_identifier)?;
        current_identifier.clear();

        if !ch.is_ascii_whitespace() {
            token_count = token_count.saturating_add(1);
            if token_count > MAX_MATH_TOKENS {
                return Err("数学表达式过于复杂。".to_string());
            }
        }

        match ch {
            '(' => {
                depth = depth.saturating_add(1);
                if depth > MAX_MATH_NESTING_DEPTH {
                    return Err("数学表达式嵌套层级过深。".to_string());
                }
            }
            ')' => {
                if depth == 0 {
                    return Err("数学表达式括号不匹配。".to_string());
                }
                depth -= 1;
            }
            '.' => {
                let previous_is_digit = index
                    .checked_sub(1)
                    .is_some_and(|i| chars[i].is_ascii_digit());
                let next_is_digit = chars
                    .get(index + 1)
                    .is_some_and(|next| next.is_ascii_digit());
                if !previous_is_digit && !next_is_digit {
                    return Err("数学表达式中的小数点格式无效。".to_string());
                }
            }
            _ => {}
        }
    }
    validate_identifier(&current_identifier)?;
    if depth != 0 {
        return Err("数学表达式括号不匹配。".to_string());
    }

    Ok((expression, operation, variable))
}

// ── 进程执行（带超时） ──────────────────────────────────────────────────

/// 执行 worker 命令，返回 stdout。
///
/// 优先使用 sidecar exe（生产期），回退到 Python 模块（仅开发期）。
/// 使用 try_wait + sleep loop 实现 30 秒超时。
fn run_worker(args: &[&str]) -> Result<String, String> {
    // 优先尝试 sidecar exe
    if let Some(exe_path) = resolve_worker_executable() {
        return run_worker_exe(&exe_path, args);
    }

    // Release builds: sidecar is mandatory. No Python fallback.
    #[cfg(not(debug_assertions))]
    {
        return Err("document-worker sidecar 未找到。请确认安装包完整，或重新安装。".to_string());
    }

    // Debug builds: fall back to Python module for development convenience.
    #[cfg(debug_assertions)]
    {
        run_worker_python(args)
    }
}

/// 通过 sidecar exe 执行 worker 命令。
fn run_worker_exe(exe_path: &std::path::Path, args: &[&str]) -> Result<String, String> {
    // Verify sidecar integrity before spawn (raises tampering cost)
    crate::sidecar_integrity::verify_sidecar_integrity(exe_path, "document-worker.exe")?;

    let mut cmd = Command::new(exe_path);
    configure_document_worker_environment(&mut cmd);
    cmd.args(args)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    let child = cmd
        .spawn()
        .map_err(|e| format!("无法启动 document-worker exe: {e}"))?;

    collect_child_output(child)
}

/// 通过 Python 模块执行 worker 命令（开发期回退）。
fn run_worker_python(args: &[&str]) -> Result<String, String> {
    let worker_dir = resolve_worker_dir()?;

    let mut cmd = Command::new("python");
    configure_document_worker_environment(&mut cmd);
    cmd.arg("-m")
        .arg(WORKER_MODULE)
        .args(args)
        .current_dir(&worker_dir)
        .env("PYTHONPATH", &worker_dir)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    let child = cmd.spawn().map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            format!(
                "无法启动 Python，且未找到 document-worker sidecar。\
                 请安装 Python 3.10+ 或放置 document-worker.exe。原始错误: {e}"
            )
        } else {
            format!("无法启动 Python worker: {e}")
        }
    })?;

    collect_child_output(child)
}

fn configure_document_worker_environment(command: &mut Command) {
    command.env_clear();
    for name in ["SYSTEMROOT", "SystemRoot", "TEMP", "TMP"] {
        if let Some(value) = std::env::var_os(name) {
            command.env(name, value);
        }
    }
    command
        .env("PYTHONIOENCODING", "utf-8")
        .env("PYTHONUTF8", "1")
        .env("PYTHONDONTWRITEBYTECODE", "1");
}

/// 收集子进程输出，带 30 秒超时。消费子进程所有权。
///
/// 使用 reader 线程并发读取 stdout/stderr，避免管道缓冲区满导致死锁。
/// 大文档解析的 JSON 输出可能超过管道缓冲区，如果先等退出再读会阻塞。
fn collect_child_output(mut child: Child) -> Result<String, String> {
    // 取出 stdout/stderr 管道，在独立线程中读取
    let mut child_stdout = child.stdout.take().ok_or("无法获取 worker stdout 管道")?;
    let mut child_stderr = child.stderr.take().ok_or("无法获取 worker stderr 管道")?;

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

    // 等待子进程退出，带超时
    let start = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) => {
                if start.elapsed() >= WORKER_TIMEOUT {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(format!(
                        "解析超时（{}秒）。文件可能过大或包含大量图片/复杂表格，可尝试压缩或拆分后重试。",
                        WORKER_TIMEOUT.as_secs()
                    ));
                }
                std::thread::sleep(POLL_INTERVAL);
            }
            Err(e) => {
                let _ = child.kill();
                return Err(format!("等待 worker 进程失败: {e}"));
            }
        }
    }

    // 收集 reader 线程结果
    let stdout = stdout_thread.join().unwrap_or_default();
    let stderr = stderr_thread.join().unwrap_or_default();

    let exit_code = child.wait().ok().and_then(|s| s.code()).unwrap_or(-1);

    if exit_code != 0 && stdout.trim().is_empty() {
        let hint = if stderr.contains("ModuleNotFoundError") {
            "Python 依赖未安装。请运行: cd tools/document-worker && pip install -e \".[dev]\""
        } else if stderr.contains("No module named") {
            "找不到 document_worker 模块。请确认 PYTHONPATH 设置正确。"
        } else {
            ""
        };
        let safe_stderr = crate::code_worker::sanitize_worker_diagnostic(&stderr);
        return Err(format!(
            "worker 执行失败 (exit {}): {}{}",
            exit_code,
            safe_stderr.trim(),
            if hint.is_empty() {
                String::new()
            } else {
                format!("\n提示: {hint}")
            }
        ));
    }

    Ok(stdout)
}

/// 解析 worker JSON 输出为强类型结果。
fn parse_worker_json<T: serde::de::DeserializeOwned>(json_str: &str) -> Result<T, String> {
    serde_json::from_str(json_str.trim()).map_err(|e| {
        format!(
            "Worker 输出 JSON 解析失败: {e}\n原始输出: {}",
            crate::code_worker::sanitize_worker_diagnostic(
                &json_str.chars().take(500).collect::<String>()
            )
        )
    })
}

// ── 文件选择对话框 ──────────────────────────────────────────────────────

/// 文件选择结果（camelCase 对齐 TS）
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FileSelectionResult {
    pub selected: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_name: Option<String>,
}

/// 打开文件选择对话框，仅允许 PDF/DOCX/XLSX。
pub(crate) fn select_document_file() -> Result<FileSelectionResult, String> {
    let dialog = rfd::FileDialog::new()
        .set_title("选择文档文件")
        .add_filter("文档文件", &["pdf", "docx", "xlsx"])
        .add_filter("PDF 文件", &["pdf"])
        .add_filter("Word 文档", &["docx"])
        .add_filter("Excel 表格", &["xlsx"]);

    match dialog.pick_file() {
        Some(path) => {
            let (token, file_name) = authorize_selected_document(&path)?;
            Ok(FileSelectionResult {
                selected: true,
                // Compatibility field: this is an opaque, one-time authorization
                // token, never a local filesystem path.
                file_path: Some(token),
                file_name: Some(file_name),
            })
        }
        None => Ok(FileSelectionResult {
            selected: false,
            file_path: None,
            file_name: None,
        }),
    }
}

fn authorize_selected_document(path: &Path) -> Result<(String, String), String> {
    validate_untrusted_path_shape(path)?;
    let canonical = std::fs::canonicalize(path)
        .map_err(|_| "无法授权所选文档，请确认文件仍然存在。".to_string())?;
    validate_canonical_document_path(&canonical)?;
    let metadata = std::fs::metadata(&canonical).map_err(|_| "无法检查所选文档。".to_string())?;
    if !metadata.is_file() {
        return Err("只能导入普通文档文件。".to_string());
    }
    if metadata.len() > MAX_FILE_SIZE {
        return Err("文件大小超过当前上限 50MB。".to_string());
    }
    let extension = canonical
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !["pdf", "docx", "xlsx"].contains(&extension.as_str()) {
        return Err("不支持的文件类型，仅支持 PDF、DOCX、XLSX。".to_string());
    }
    let file_name = canonical
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "文件名编码不受支持。".to_string())?
        .to_string();

    let mut random = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut random);
    let token = hex::encode(random);
    let authorizations = AUTHORIZED_DOCUMENTS.get_or_init(|| Mutex::new(HashMap::new()));
    let mut entries = authorizations
        .lock()
        .map_err(|_| "文档授权状态不可用，请重试。".to_string())?;
    entries.retain(|_, item| item.authorized_at.elapsed() <= AUTHORIZATION_TTL);
    if entries.len() >= MAX_PENDING_AUTHORIZATIONS {
        return Err("待处理文档过多，请稍后重试。".to_string());
    }
    entries.insert(
        token.clone(),
        AuthorizedDocument {
            canonical_path: canonical,
            file_name: file_name.clone(),
            length: metadata.len(),
            modified: metadata.modified().ok(),
            authorized_at: Instant::now(),
        },
    );
    Ok((token, file_name))
}

fn take_authorization(token: &str) -> Result<AuthorizedDocument, String> {
    let entries = AUTHORIZED_DOCUMENTS.get_or_init(|| Mutex::new(HashMap::new()));
    let mut entries = entries
        .lock()
        .map_err(|_| "文档授权状态不可用，请重试。".to_string())?;
    entries.retain(|_, item| item.authorized_at.elapsed() <= AUTHORIZATION_TTL);
    entries
        .remove(token)
        .ok_or_else(|| "文档授权无效或已过期，请重新选择文件。".to_string())
}

fn validate_untrusted_path_shape(path: &Path) -> Result<(), String> {
    let raw = path.to_string_lossy();
    if !path.is_absolute()
        || raw.starts_with(r"\\")
        || raw.starts_with("//")
        || raw.starts_with(r"\\?\")
        || raw.starts_with(r"\\.\")
        || path
            .components()
            .any(|component| matches!(component, Component::ParentDir | Component::CurDir))
    {
        return Err("不允许的文档路径，请通过系统文件选择器重新选择。".to_string());
    }
    Ok(())
}

fn validate_canonical_document_path(path: &Path) -> Result<(), String> {
    const SENSITIVE_COMPONENTS: &[&str] = &[
        ".ssh",
        ".aws",
        ".azure",
        ".gnupg",
        ".kube",
        ".codex",
        "credentials",
        "credential",
        "secrets",
    ];
    let has_sensitive_component = path.components().any(|component| {
        let value = component.as_os_str().to_string_lossy().to_ascii_lowercase();
        SENSITIVE_COMPONENTS.contains(&value.as_str())
    });
    if has_sensitive_component {
        return Err("所选位置属于敏感凭据目录，不能导入。".to_string());
    }

    for variable in ["SystemRoot", "SYSTEMROOT", "ProgramData"] {
        if let Some(root) = std::env::var_os(variable) {
            if let Ok(canonical_root) = std::fs::canonicalize(root) {
                if path.starts_with(canonical_root) {
                    return Err("所选位置属于系统目录，不能导入。".to_string());
                }
            }
        }
    }
    Ok(())
}

// ── 测试 ────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn arbitrary_path_is_not_an_authorization_token() {
        let result = parse_authorized_document("/nonexistent/file.pdf");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("授权"));
    }

    #[test]
    fn unsupported_type_is_rejected_during_authorization() {
        let dir = std::env::temp_dir().join("teacher-agent-worker-test");
        let _ = std::fs::create_dir_all(&dir);
        let file_path = dir.join("test.txt");
        std::fs::write(&file_path, "test").unwrap();

        let result = authorize_selected_document(&file_path);
        assert!(result.unwrap_err().contains("不支持"));

        let _ = std::fs::remove_file(&file_path);
    }

    #[test]
    fn legal_document_receives_opaque_one_time_token() {
        let dir = std::env::temp_dir().join(format!(
            "teacher-agent-authorize-test-{}",
            std::process::id()
        ));
        let _ = std::fs::create_dir_all(&dir);
        let file_path = dir.join("legal.pdf");
        std::fs::write(&file_path, b"%PDF-test").unwrap();

        let (token, file_name) = authorize_selected_document(&file_path).unwrap();
        assert_eq!(token.len(), 64);
        assert!(!token.contains("legal.pdf"));
        assert_eq!(file_name, "legal.pdf");
        assert!(take_authorization(&token).is_ok());
        assert!(take_authorization(&token).is_err());

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn relative_parent_unc_and_device_paths_are_rejected() {
        for raw in [
            "../secret.pdf",
            r"docs\..\secret.pdf",
            r"\\server\share\doc.pdf",
            r"\\?\C:\secret.pdf",
            r"\\.\C:\secret.pdf",
        ] {
            assert!(
                validate_untrusted_path_shape(Path::new(raw)).is_err(),
                "{raw}"
            );
        }
    }

    #[test]
    fn sensitive_directory_is_rejected_after_canonicalization() {
        let dir = std::env::temp_dir()
            .join(format!(
                "teacher-agent-sensitive-test-{}",
                std::process::id()
            ))
            .join(".ssh");
        let _ = std::fs::create_dir_all(&dir);
        let file_path = dir.join("notes.pdf");
        std::fs::write(&file_path, b"%PDF-test").unwrap();
        assert!(authorize_selected_document(&file_path)
            .unwrap_err()
            .contains("敏感"));
        let _ = std::fs::remove_dir_all(
            dir.parent()
                .expect("sensitive test directory should have a parent"),
        );
    }

    #[test]
    fn symlink_to_sensitive_file_is_rejected_when_platform_allows_symlinks() {
        let root =
            std::env::temp_dir().join(format!("teacher-agent-symlink-test-{}", std::process::id()));
        let sensitive_dir = root.join(".ssh");
        let _ = std::fs::create_dir_all(&sensitive_dir);
        let target = sensitive_dir.join("credential.pdf");
        let link = root.join("selected.pdf");
        std::fs::write(&target, b"%PDF-sensitive").unwrap();

        #[cfg(windows)]
        let link_result = std::os::windows::fs::symlink_file(&target, &link);
        #[cfg(unix)]
        let link_result = std::os::unix::fs::symlink(&target, &link);
        #[cfg(not(any(windows, unix)))]
        let link_result: Result<(), std::io::Error> =
            Err(std::io::Error::from(std::io::ErrorKind::Unsupported));

        if link_result.is_ok() {
            assert!(authorize_selected_document(&link)
                .unwrap_err()
                .contains("敏感"));
        }
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn configured_system_directories_are_rejected() {
        for variable in ["SystemRoot", "SYSTEMROOT", "ProgramData"] {
            if let Some(root) = std::env::var_os(variable) {
                if let Ok(canonical_root) = std::fs::canonicalize(root) {
                    assert!(validate_canonical_document_path(&canonical_root).is_err());
                }
            }
        }
    }

    #[test]
    fn oversized_document_is_rejected() {
        let dir = std::env::temp_dir().join(format!(
            "teacher-agent-oversized-test-{}",
            std::process::id()
        ));
        let _ = std::fs::create_dir_all(&dir);
        let file_path = dir.join("large.pdf");
        let file = File::create(&file_path).unwrap();
        file.set_len(MAX_FILE_SIZE + 1).unwrap();
        drop(file);
        assert!(authorize_selected_document(&file_path)
            .unwrap_err()
            .contains("50MB"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn authorized_file_replacement_is_detected() {
        let dir = std::env::temp_dir().join(format!(
            "teacher-agent-replacement-test-{}",
            std::process::id()
        ));
        let _ = std::fs::create_dir_all(&dir);
        let file_path = dir.join("replace.pdf");
        std::fs::write(&file_path, b"first").unwrap();
        let (token, _) = authorize_selected_document(&file_path).unwrap();
        std::fs::write(&file_path, b"replacement-with-different-size").unwrap();
        let result = parse_authorized_document(&token);
        assert!(result.unwrap_err().contains("发生变化"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn document_worker_environment_is_explicit_allowlist_without_path_or_secrets() {
        let mut command = Command::new("document-worker");
        command
            .env("PATH", "must-be-cleared")
            .env("OPENAI_API_KEY", "must-be-cleared")
            .env("HTTPS_PROXY", "must-be-cleared");
        configure_document_worker_environment(&mut command);
        let names = command
            .get_envs()
            .map(|(name, _)| name.to_string_lossy().to_string())
            .collect::<Vec<_>>();

        for required in ["PYTHONIOENCODING", "PYTHONUTF8", "PYTHONDONTWRITEBYTECODE"] {
            assert!(names.iter().any(|name| name == required));
        }
        for forbidden in [
            "PATH",
            "OPENAI_API_KEY",
            "ANTHROPIC_API_KEY",
            "HTTPS_PROXY",
            "DATABASE_URL",
            "AWS_SECRET_ACCESS_KEY",
            "SSH_AUTH_SOCK",
        ] {
            assert!(!names.iter().any(|name| name == forbidden));
        }
        assert!(names.iter().all(|name| [
            "SYSTEMROOT",
            "SystemRoot",
            "TEMP",
            "TMP",
            "PYTHONIOENCODING",
            "PYTHONUTF8",
            "PYTHONDONTWRITEBYTECODE",
        ]
        .contains(&name.as_str())));
    }

    #[test]
    fn math_worker_input_accepts_only_bounded_math_grammar() {
        for expression in ["x^2 + sin(x)", "(x + 1)**2", "x, x, 0", "sqrt(x2) + pi"] {
            let variable = if expression.contains("x2") { "x2" } else { "x" };
            assert!(
                validate_math_worker_input(expression, "simplify", variable).is_ok(),
                "{expression} should be accepted"
            );
        }

        for expression in [
            "__import__(os)",
            "open(x)",
            "x.__class__",
            "x[0]",
            "'x'",
            "Symbol(x)",
            "(x + 1",
        ] {
            assert!(
                validate_math_worker_input(expression, "eval", "x").is_err(),
                "{expression} must be rejected"
            );
        }
    }

    #[test]
    fn math_worker_input_rejects_length_operation_variable_and_complexity_abuse() {
        assert!(validate_math_worker_input(
            &"x".repeat(MAX_MATH_EXPRESSION_CHARS + 1),
            "eval",
            "x"
        )
        .is_err());
        assert!(validate_math_worker_input("x + 1", "import", "x").is_err());
        assert!(validate_math_worker_input("x + 1", "eval", "x;system").is_err());
        assert!(validate_math_worker_input(
            "x + 1",
            "eval",
            &"x".repeat(MAX_MATH_VARIABLE_CHARS + 1)
        )
        .is_err());
        let nested = format!(
            "{}x{}",
            "(".repeat(MAX_MATH_NESTING_DEPTH + 1),
            ")".repeat(MAX_MATH_NESTING_DEPTH + 1)
        );
        assert!(validate_math_worker_input(&nested, "eval", "x").is_err());
    }

    #[test]
    fn math_empty_expression() {
        let result = compute_math_with_worker("", "eval", "x").unwrap();
        assert!(!result.ok);
        assert!(result.error.unwrap().contains("空"));
    }

    #[test]
    fn math_invalid_operation() {
        let result = compute_math_with_worker("x+1", "invalid", "x");
        match result {
            Ok(r) => {
                assert!(!r.ok, "invalid operation should return ok=false");
                assert!(r.error.is_some(), "should have error message");
            }
            Err(e) => {
                assert!(!e.is_empty(), "error message should not be empty");
            }
        }
    }

    /// 测试 camelCase JSON 反序列化完整性
    #[test]
    fn deserialize_camel_case_parse_result() {
        let json = r#"{
            "ok": true,
            "fileType": "pdf",
            "title": "测试文档",
            "pagesOrSheets": [
                {"name": "Page 1", "text": "第一段内容"},
                {"name": "Page 2", "text": "第二段内容"}
            ],
            "plainText": "第一段内容\n第二段内容",
            "warnings": []
        }"#;

        let result: ParseDocumentResult = serde_json::from_str(json).unwrap();
        assert!(result.ok);
        assert_eq!(result.file_type.as_deref(), Some("pdf"));
        assert_eq!(result.title.as_deref(), Some("测试文档"));
        assert_eq!(result.plain_text.as_deref(), Some("第一段内容\n第二段内容"));
        assert_eq!(result.pages_or_sheets.len(), 2);
        assert_eq!(result.pages_or_sheets[0].name, "Page 1");
        assert_eq!(result.pages_or_sheets[0].text, "第一段内容");
        assert!(result.error.is_none());
    }

    /// 测试 camelCase JSON 反序列化（math）
    #[test]
    fn deserialize_camel_case_math_result() {
        let json = r#"{
            "ok": true,
            "input": "(x+1)**2",
            "result": "x**2 + 2*x + 1",
            "latex": "x^{2} + 2 x + 1",
            "steps": ["输入表达式: (x+1)**2", "展开结果: x**2 + 2*x + 1"],
            "warnings": []
        }"#;

        let result: ComputeMathResult = serde_json::from_str(json).unwrap();
        assert!(result.ok);
        assert_eq!(result.input.as_deref(), Some("(x+1)**2"));
        assert_eq!(result.result.as_deref(), Some("x**2 + 2*x + 1"));
        assert_eq!(result.latex.as_deref(), Some("x^{2} + 2 x + 1"));
        assert_eq!(result.steps.len(), 2);
    }

    /// 测试 error 输出反序列化
    #[test]
    fn deserialize_error_result() {
        let json = r#"{"ok": false, "error": "文件不存在"}"#;
        let result: ParseDocumentResult = serde_json::from_str(json).unwrap();
        assert!(!result.ok);
        assert_eq!(result.error.as_deref(), Some("文件不存在"));
        assert!(result.pages_or_sheets.is_empty());
    }

    /// 测试序列化输出是 camelCase
    #[test]
    fn serialize_camel_case() {
        let result = ParseDocumentResult {
            ok: true,
            file_type: Some("pdf".to_string()),
            title: Some("test".to_string()),
            plain_text: Some("text".to_string()),
            pages_or_sheets: vec![PageOrSheet {
                name: "P1".to_string(),
                text: "content".to_string(),
            }],
            error: None,
            warnings: vec![],
        };

        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("\"fileType\""));
        assert!(json.contains("\"plainText\""));
        assert!(json.contains("\"pagesOrSheets\""));
        assert!(!json.contains("\"file_type\""));
        assert!(!json.contains("\"plain_text\""));
    }

    /// 错误结果序列化后仍包含 pagesOrSheets: []
    #[test]
    fn serialize_error_always_has_pages_or_sheets() {
        let result = ParseDocumentResult {
            ok: false,
            file_type: None,
            title: None,
            plain_text: None,
            pages_or_sheets: vec![],
            error: Some("文件不存在".to_string()),
            warnings: vec![],
        };

        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("\"pagesOrSheets\":[]"));
        assert!(json.contains("\"ok\":false"));
    }

    /// 测试 resolve_worker_executable 在没有 exe 时返回 None
    #[test]
    fn resolve_worker_executable_returns_none_when_not_found() {
        // 正常开发环境（未手动放置 exe）应返回 None
        let result = resolve_worker_executable();
        // 可能返回 None（没有 exe）或 Some（如果已手动放置）
        // 这里只验证不会 panic
        if let Some(path) = result {
            assert!(
                path.file_name()
                    .unwrap()
                    .to_str()
                    .unwrap()
                    .contains("document-worker"),
                "exe 名称应包含 document-worker"
            );
        }
    }

    /// 测试 resolve_worker_dir 在未设置环境变量时的行为
    #[test]
    fn resolve_worker_dir_no_env() {
        // 不设置环境变量，测试默认路径解析
        // 这个测试可能成功（如果 tools/document-worker 存在）或失败（返回错误信息）
        let result = resolve_worker_dir();
        match result {
            Ok(path) => {
                assert!(path.ends_with("tools") || path.ends_with("document-worker"));
            }
            Err(e) => {
                assert!(
                    e.contains("TEACHER_AGENT_DOCUMENT_WORKER_DIR")
                        || e.contains("tools/document-worker")
                        || e.contains("无法定位")
                );
            }
        }
    }

    /// FileSelectionResult selected=true 时 JSON 使用 camelCase
    #[test]
    fn file_selection_camel_case_when_selected() {
        let result = FileSelectionResult {
            selected: true,
            file_path: Some("D:\\docs\\report.pdf".to_string()),
            file_name: Some("report.pdf".to_string()),
        };
        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("\"selected\":true"));
        assert!(json.contains("\"filePath\""));
        assert!(json.contains("\"fileName\""));
        assert!(!json.contains("\"file_path\""));
        assert!(!json.contains("\"file_name\""));
    }

    /// FileSelectionResult selected=false 时不包含路径字段
    #[test]
    fn file_selection_no_path_when_cancelled() {
        let result = FileSelectionResult {
            selected: false,
            file_path: None,
            file_name: None,
        };
        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("\"selected\":false"));
        assert!(!json.contains("filePath"));
        assert!(!json.contains("fileName"));
        assert!(!json.contains("file_path"));
        assert!(!json.contains("file_name"));
    }

    /// 验证大 stdout 输出不会因管道缓冲区满导致死锁或超时。
    /// 使用 PowerShell 输出 200KB 数据（超过 Windows 64KB 管道缓冲区）。
    #[test]
    fn large_stdout_does_not_deadlock() {
        // PowerShell: 输出 200KB 的 'A' 字符
        let mut cmd = Command::new("powershell");
        cmd.args(["-NoProfile", "-Command", "'A' * 200000"])
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());

        let child = cmd.spawn().expect("should spawn powershell");
        let result = collect_child_output(child);

        assert!(
            result.is_ok(),
            "should not timeout or fail: {:?}",
            result.err()
        );
        let output = result.unwrap();
        assert!(
            output.len() >= 200_000,
            "expected >=200KB output, got {} bytes",
            output.len()
        );
    }
}
