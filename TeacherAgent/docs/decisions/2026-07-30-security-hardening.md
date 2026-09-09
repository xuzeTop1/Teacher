# 2026-07-30 安全修复：未隔离代码执行 fail-closed

状态：accepted
范围：code-worker、文档导入、Provider、Markdown 渲染、sidecar

## 背景

安全复核确认：`exec + restricted builtins` 无法抵抗 CPython 对象图逃逸；文档解析 command 接受前端原始路径；Provider endpoint 未与 Keychain API Key 绑定；worker 继承父进程环境；最终 Markdown HTML 缺少独立清洗层；Debug sidecar 可静默跳过 hash；学生代码通过命令行传输。

## 决策

1. 在 OS 级隔离完成前，code-runner 对不受信代码 fail-closed。Release 永久关闭；Debug 也默认关闭，只提供双重显式 opt-in 的可信开发模式。
2. 不把 restricted builtins、模块过滤、超时或输出截断描述为安全沙箱。
3. 文档导入采用“系统文件选择器 → Rust 一次性授权令牌 → 已打开句柄复制到 staging → worker 解析副本”。前端不持有绝对路径。
4. Provider URL 统一严格解析：远程 HTTPS，HTTP 仅 loopback；禁止 URL 凭据/query/fragment；禁用自动重定向。
5. Keychain 中保存版本化的 `{ endpoint_identity, api_key }`，使用前必须与规范化 endpoint 相等。旧明文 keychain 值不自动迁移。
6. `api_key_ref` 只接受 `keychain:teacher-agent:provider-api-key:<provider-id>` 且 provider id 只含 ASCII 字母、数字、`-`、`_`。
7. code-worker 输入只走 stdin；Rust 和 Python 子进程环境都采用显式白名单。
8. Markdown 在最终 DOM sink 前使用 DOMPurify allowlist；保留 `markdown-it html:false`、KaTeX `trust:false` 和 CSP。
9. Release sidecar hash 不可绕过。Debug 缺 manifest 也默认拒绝，只允许显式开发开关，并在日志和 UI 告警。
10. document-worker exe 与 Python fallback 均先清空环境，再恢复 SystemRoot、TEMP/TMP 和 Python UTF-8 所需变量；不继承 PATH 或任何凭据/代理变量。
11. SymPy worker 在 Rust command 边界限制 expression、operation、variable；未知标识符、代码式字符、超长和复杂度滥用在启动 worker 前拒绝。
12. 删除 code-worker 未执行的 `memoryLimitMb` 契约并对该字段 fail-closed；wrapper 改为单次模板替换，执行代码的 Python 子进程不再继承 PATH。
13. code-worker 的 stderr/error/warnings 在 Rust IPC 边界统一清洗：移除 ANSI/控制字符和绝对路径，识别常见 Provider/平台密钥及 Authorization/Bearer 头，并限制为 4K 字符；保留错误类型和行号供教学反馈。

## 替代方案

- 继续扩展 Python 过滤器：拒绝。无法形成 CPython 安全边界。
- 本次直接实现 Windows Job Object：未采用。Job Object 只能覆盖部分资源/进程树限制，若缺少受限令牌、网络和文件系统策略，仍不足以宣称可执行不受信代码。
- 容器或虚拟机：当前桌面 MVP 过重，保留后续评估。
- Wasmtime：作为 D-112 候选；需要先定义受支持 Python/教学运行时能力。

## 影响与迁移

- 生产 Python 练习台默认不可执行代码，这是有意的安全降级。
- 旧 Keychain API Key 因没有 endpoint 绑定会被拒绝，用户需要在设置页重新录入一次。
- 文档选择结果中的 `filePath` 暂为兼容字段名，但值已变为 64 位一次性令牌；任何真实路径或重复令牌均被拒绝。
- Debug 使用未校验 sidecar 时，开发者必须同时配置 Rust 与前端告警开关；Release 不读取绕过开关。

## 后续验证

- D-112 决定并验证真正的 OS 级隔离方案。
- Windows 实机检查 Process Explorer/WMI 中命令行不出现学生代码或 stdin。
- 安装包验证 `sidecar-hashes.json` 与安装目录 sidecar 完全匹配。
- Tauri 实机验证文档导入、Provider endpoint 变更提示、XSS payload 和开发模式警告。
