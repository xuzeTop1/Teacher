# Release Hardening — TeacherAgent

> 安全目标声明：客户端软件不可能做到绝对无法逆向。本次目标是减少信息泄露、提高静态分析和篡改成本、保护密钥与用户数据。不把混淆当作权限控制。假设攻击者最终可以读取前端 JS、检查本地 SQLite、分析 Rust 二进制。任何必须保密的主密钥、管理员密钥或许可证秘密都不能放入客户端。

## 1. Rust Release Profile

```toml
[profile.release]
opt-level = "z"
lto = true
codegen-units = 1
strip = "symbols"
```

- `opt-level = "z"`：体积优先。应用是 I/O 密集型（网络 + SQLite），brute-force cosine 在 ~1500 向量上的计算量相对 embedding API 延迟可忽略。
- `lto = true` + `codegen-units = 1`：最大化死代码消除，减少二进制中的符号和字符串。
- `strip = "symbols"`：移除调试符号，提高静态分析成本。
- **不使用 `panic = "abort"`**：Tauri 2.x IPC 内部使用 `catch_unwind`。`panic = "abort"` 会将可恢复的 IPC/command 错误变为进程崩溃，破坏 sidecar 生命周期和错误边界。

## 2. 前端产物泄露控制

- **Sourcemap 强制关闭**：`vite.config.ts` 中 `sourcemap: isDev ? "inline" : false`。生产构建无论环境变量如何设置都不生成 `.map` 文件。已移除 `TAURI_ENV_SOURCEMAP` 逃逸口。
- **Minification**：生产使用 esbuild minify（默认）。
- **API Key 保护**：Provider Key 只保存到系统 keychain（Rust `keyring` crate）。前端只持有 `apiKeyRef`（引用字符串），不持有实际密钥。
- **不添加 JavaScript obfuscator**：会破坏 Vue、Tauri IPC、KaTeX、Shiki 和错误诊断。当前 minification + strip symbols 已足够提高成本。

### 构建后验证

```powershell
# 确认 dist 中无 .map 文件
Get-ChildItem -Path dist -Recurse -Filter "*.map" | Measure-Object | Select-Object -ExpandProperty Count
# 期望输出: 0
```

## 3. Tauri CSP

```json
"csp": "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: blob:; connect-src ipc: http://ipc.localhost; worker-src 'self' blob:",
"devCsp": "default-src 'self' http://127.0.0.1:1420; script-src 'self' 'wasm-unsafe-eval' http://127.0.0.1:1420; style-src 'self' 'unsafe-inline' http://127.0.0.1:1420; font-src 'self' data: http://127.0.0.1:1420; img-src 'self' data: blob: http://127.0.0.1:1420; connect-src ipc: http://ipc.localhost http://127.0.0.1:1420 ws://127.0.0.1:1420; worker-src 'self' blob: http://127.0.0.1:1420"
```

`devCsp` 仅用于 `tauri dev`：它精确放行本机 Vite 的 `127.0.0.1:1420` 与 HMR WebSocket，避免 WebView2 停留在空白页。安装包不使用该策略，继续只使用上面的最小化 `csp`。

| 指令 | 值 | 理由 |
|------|-----|------|
| default-src | 'self' | 默认拒绝所有远程资源 |
| script-src | 'self' 'wasm-unsafe-eval' | 本地脚本 + Shiki WASM |
| style-src | 'self' 'unsafe-inline' | Vuetify 动态注入样式 |
| font-src | 'self' data: | KaTeX 字体（data URI） |
| img-src | 'self' data: blob: | 用户上传图片（base64/blob） |
| connect-src | ipc: http://ipc.localhost | 仅 Tauri IPC（所有 LLM 请求走 Rust） |
| worker-src | 'self' blob: | Web Worker（如有） |

**禁止**：远程 script、eval（script 层面）、`javascript:` URL、任意远程连接。Markdown 内容通过 MessageRenderer 渲染，不执行 script/事件属性。

## 4. Tauri Command 审计清单

共 70 个注册命令。Capability 文件 (`capabilities/default.json`) 仅授权 `core:default`。

### 按功能分类

| 类别 | 命令 | 安全评估 |
|------|------|----------|
| **数据库初始化** | init_database, run_local_smoke_check, ping | 只读/幂等，无外部输入 |
| **对话管理** | create_conversation, list_conversations, delete_conversation, archive_conversation, unarchive_conversation, update_conversation_title, ensure_default_conversation, list_messages, save_message | 参数为 ID/字符串，rusqlite 参数化查询 |
| **Provider 配置** | save_provider_config, delete_provider_config, list_provider_configs, load_default_provider_config | 配置 CRUD，apiKeyRef 只是引用 |
| **API Key（keychain）** | save_provider_api_key, delete_provider_api_key, save_bocha_api_key, delete_bocha_api_key, has_bocha_api_key | 写入/删除 OS keychain，不返回密钥内容 |
| **LLM 调用** | complete_llm_chat, complete_llm_chat_stream, generate_embedding, generate_embeddings_batch | 通过 Rust HTTP 调用，API key 从 keychain 解析，不经前端 |
| **知识搜索** | search_knowledge_from_db, search_vector_embeddings, get_knowledge_nodes_by_ids, load_knowledge_prerequisites | 参数化查询，entity_ids 有长度限制（clamp 1..50） |
| **向量管理** | store_vector_embedding, count_vector_embeddings, delete_embeddings_by_model_and_ids | 删除需明确 entity_type + model + ID 列表 |
| **知识 Seed** | seed_knowledge_nodes_from_json, sync_approved_manifest, count_knowledge_nodes, count_all_knowledge_nodes, count_approved_knowledge_nodes, count_manifest_nodes, get_approved_knowledge_node_counts_by_subject, get_knowledge_node_counts_by_subject, knowledge_health_check, delete_orphan_knowledge_nodes | seed 验证 public status，拒绝 approved 注入；sync 使用 Rust 内嵌 registry |
| **学习记忆** | load_learning_memory_context, save_learning_memory_state, load_student_knowledge, bkt_update_mastery | 本地学生数据 CRUD |
| **评估/反思** | save_assessment_result, save_reflection_record | 只写入，不返回敏感内容 |
| **私有文档** | save_private_document, get_private_document, delete_private_document, list_private_documents, load_private_document_chunks, search_private_document_chunks, bind_private_document_to_conversation, clear_private_document_binding, load_conversation_private_document_id, select_document_file | select_document_file 使用 rfd 原生对话框；其余为本地 CRUD |
| **自定义学科** | create_custom_subject, delete_custom_subject, list_custom_subjects | 本地 CRUD |
| **Ollama** | check_ollama_status, list_ollama_models, start_ollama_engine | 只与 localhost:11434 通信 |
| **Web 搜索** | bocha_web_search | 通过 Rust 调用 Bocha API，不携带学生隐私 |
| **Sidecar** | compute_math_with_worker, parse_document_with_worker, run_code | 通过 SHA-256 验证后 spawn sidecar |
| **数学计算** | compute_math_expression | 本地 math engine |
| **知识生成** | generate_knowledge_from_sources | 从已有 source 生成，不引入外部内容 |

### 安全结论

- **文件访问**：`select_document_file` 通过 rfd 原生对话框选择文件。但 `parse_document_with_worker` 接受前端传入的 `file_path: String`，仅检查文件存在性、50 MB 大小限制和扩展名白名单，**不验证路径确实来自原生文件选择器**。攻击者若控制前端 JS 可传入任意本地路径（受 OS 文件权限约束）。
- **代码执行**：`run_code` 会执行调用方提供的 Python 代码。项目已明确这是**教学护栏，不是安全沙箱**——禁止网络/文件写入/shell 命令，但不防御逃逸。
- **Sidecar 完整性**：代码路径已接入 SHA-256 校验（`sidecar_integrity.rs`），release 模式 manifest 缺失时 fail-closed。但**生产 manifest 生成与打包尚未完成**——需要在 CI/CD 中执行 `generate-sidecar-hashes.ps1` 并将 `sidecar-hashes.json` 放入安装包。当前状态：代码就绪，管线未打通。
- 无 API Key 返回前端的命令
- 所有 DB 操作使用 rusqlite 参数化查询
- seed 命令验证 public status，拒绝 approved 注入
- approved 同步使用 Rust 内嵌 registry，不接受外部 approved 数据
- release 错误不返回 SQL、绝对路径、keychain 内容或完整堆栈

## 5. Sidecar 完整性验证

### 机制

1. **构建阶段**：构建后执行 `scripts/generate-sidecar-hashes.ps1`，计算每个 sidecar 二进制的 SHA-256，生成 `sidecar-hashes.json`。
2. **分发**：manifest 文件需随安装包放置在 sidecar 同目录（**当前尚未集成到 tauri build 管线，需手动执行或 CI 集成**）。
3. **运行时**：spawn 前计算实际文件 SHA-256，与 manifest 比对。不一致则拒绝启动并返回明确错误。
4. **开发模式**（`debug_assertions`）：manifest 不存在时跳过校验并输出日志。
5. **Release 模式**：manifest 不存在时 **fail-closed**，拒绝启动 sidecar。

### 当前状态

- ✅ Rust 侧校验代码已实现（`sidecar_integrity.rs`）
- ✅ 生成脚本已就绪（`scripts/generate-sidecar-hashes.ps1`）
- ❌ 尚未集成到 `tauri build` 管线（manifest 不会自动进入安装包）
- ❌ 尚未执行真实负向验收（篡改 sidecar → 验证拒绝启动）

### 构建清单生成

```powershell
# scripts/generate-sidecar-hashes.ps1
# 在 `npm run tauri build` 之后执行
# 默认扫描 src-tauri/target/release/

$sidecars = @(
    "code-worker.exe",
    "document-worker.exe"
)

# 计算 SHA-256 并写入 sidecar-hashes.json
# 任一 sidecar 缺失则 exit 1（不允许不完整 manifest）
```

### 安全边界说明

- 客户端内嵌摘要仍可被高级攻击者修改——这是提高篡改成本，不是绝对信任根。
- Windows Authenticode 代码签名需要证书。当前无证书，记录为**外部发布阻塞项**。
- 不使用 UPX/VMProtect 等壳（触发杀软、破坏可维护性）。
- 不使用反调试、自修改代码、定时崩溃等方案。

## 6. 禁止采用的方案

- 内核驱动、rootkit、进程注入
- 检测并杀死调试器、反编译器或系统工具
- 自修改代码、破坏性反调试、定时崩溃
- UPX、VMProtect 等壳
- 硬件指纹、强制联网 DRM、云账号系统
- 客户端硬编码的万能密钥、签名私钥或许可证主秘密

## 7. 已知 WIP 混入记录

提交 `62eef86` 中 `src-tauri/src/code_worker.rs` 的变更除了 sidecar 完整性检查外，还包含了任务开始前已存在于工作树的 WIP：

- `CREATE_NO_WINDOW` 常量和 `configure_background_process()` 函数（防止 sidecar 弹出控制台窗口）
- 在 `run_code_worker_exe` 和 `run_code_worker_python` 中调用 `configure_background_process`

这些 WIP 变更功能上是正确的（Windows 桌面应用不应弹出控制台窗口），但严格来说违反了"WIP 不进入提交"的约定。此处明确记录，不掩盖。

## 8. 外部发布阻塞项

| 项目 | 状态 | 说明 |
|------|------|------|
| Windows Authenticode 代码签名 | 阻塞 | 需要购买代码签名证书 |
| sidecar-hashes.json CI 生成 | 待实现 | 需要在 CI/CD 管线中集成 generate-sidecar-hashes.ps1 |
| 真实 Tauri 桌面验收 | 待执行 | CSP 下 KaTeX/Shiki/Ollama 功能回归 |
| 向量库真实收敛 | 待执行 | 需要在桌面应用中执行 bge-m3 生成，验证 1542→63 |
