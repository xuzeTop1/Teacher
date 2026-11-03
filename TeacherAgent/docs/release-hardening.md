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

# 产物泄漏扫描（凭据形态 + 构建机绝对路径 + 本机身份串）
python scripts/scan_artifact_leakage.py            # 使用默认目标集
# 期望: exit 0，输出 "clean: ..."
```

`scripts/release-check.ps1` 的第 2 步已改为直接调用该扫描器，因此 `.map`、凭据形态与构建机路径三条判定共用同一个实现；旧版内联的 `sk-`/`Bearer ` 正则（用 20 个字符类手工展开 `{20}`）已删除——它会把二进制里内嵌的**脱敏前缀表**误判为密钥泄漏。

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

共 89 个注册命令（`lib.rs` 73 个 + `sync/commands.rs` 16 个），全部显式列在 `tauri::generate_handler!`（`lib.rs:828`）白名单中，不存在自动暴露。Capability 文件 (`capabilities/default.json`) 仅授权 `core:default`，未授予 fs、http、shell、dialog 等插件权限。

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

- **文件访问**：`select_document_file` 通过 rfd 原生对话框选择文件，随后由 `authorize_selected_document`（`src-tauri/src/worker.rs:716`）做路径形状、常规文件、50 MB 与扩展名白名单校验，把规范路径登记为**一次性 64 位十六进制令牌**（TTL + 待处理上限 32）。`parse_document_with_worker` 的入参虽仍名为 `file_path`，实际只接受该令牌，取用即销毁（`worker.rs:241-275`），随后把已打开的句柄复制到 staging 目录交给 worker 解析。前端不持有绝对路径。
- **代码执行**：`run_code` 定位为**教学护栏，不是安全沙箱**——禁止网络/文件写入/shell 命令，但不防御逃逸。不受信代码的执行在 Release 构建中 fail-closed：`trusted_code_execution_enabled()` 要求 debug 构建 + `TEACHER_AGENT_ENABLE_TRUSTED_CODE_RUNNER=1` + `VITE_ENABLE_TRUSTED_CODE_RUNNER=1` 三者同时成立（`code_worker.rs:498-504`）；Python 解释器回退路径用 `#[cfg(not(debug_assertions))]` 在 Release 中编译移除（`code_worker.rs:263-266`）。
- **Sidecar 完整性**：代码路径已接入 SHA-256 校验（`sidecar_integrity.rs`），release 模式 manifest 缺失或畸形时 fail-closed。打包管线**已打通**：`tauri.conf.json` 的 `build.beforeBuildCommand` 调用 `npm run build:tauri-pre`，其第一步 `npm run sidecar:hashes` 执行 `scripts/generate-sidecar-hashes.ps1` 生成 `src-tauri/sidecar-hashes.json` 与 sidecar 同目录副本，`bundle.resources` 将其随安装包分发；`scripts/release-check.ps1` 在安装后目录复核哈希一致。仍缺的是 CI 载体（脚本目前需本地执行）与 Authenticode 签名。
- 无 API Key 返回前端的命令
- 所有 DB 操作使用 rusqlite 参数化查询
- seed 命令验证 public status，拒绝 approved 注入
- approved 同步使用 Rust 内嵌 registry，不接受外部 approved 数据
- release 错误不返回 SQL、绝对路径、keychain 内容或完整堆栈

## 5. Sidecar 完整性验证

### 机制

1. **构建阶段**：构建后执行 `scripts/generate-sidecar-hashes.ps1`，计算每个 sidecar 二进制的 SHA-256，生成 `sidecar-hashes.json`。
2. **分发**：manifest 由 `tauri.conf.json` 的 `bundle.resources` 随安装包分发，并保留与 sidecar 同目录的副本。
3. **运行时**：spawn 前计算实际文件 SHA-256，与 manifest 比对。不一致则拒绝启动并返回明确错误。
4. **开发模式**（`debug_assertions`）：manifest 缺失时**默认同样拒绝**，只有同时设置 `TEACHER_AGENT_ALLOW_UNVERIFIED_SIDECARS=1` 与 `VITE_ALLOW_UNVERIFIED_SIDECARS=1` 才跳过校验，并在 stderr 打印禁止分发该构建的告警。
5. **Release 模式**：不读取任何绕过开关；manifest 缺失或格式无效一律 fail-closed，拒绝启动 sidecar。

### 当前状态

- ✅ Rust 侧校验代码已实现（`sidecar_integrity.rs`）
- ✅ 生成脚本已就绪（`scripts/generate-sidecar-hashes.ps1`），并已接入 `npm run build:tauri-pre`
- ✅ manifest 随 `bundle.resources` 进入安装包，`release-check.ps1` 复核安装目录哈希
- ❌ 尚未执行真实负向验收（篡改 sidecar → 验证拒绝启动）
- ❌ 无 CI 载体执行 `generate-sidecar-hashes.ps1`，目前依赖本地构建流程

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
| sidecar-hashes.json CI 生成 | 部分完成 | 生成与打包已接入 `build:tauri-pre`；缺 CI 载体与安装后实机负向验收 |
| 构建机绝对路径清除 | 已完成（带受控残留） | 2026-09-19 真实发布构建验证：482→83，Rust 侧归零；剩余 83 条为 aws-lc-sys 的 C `__FILE__`，按 §10 登记为受控例外 |
| 真实 Tauri 桌面验收 | 待执行 | CSP 下 KaTeX/Shiki/Ollama 功能回归 |
| 向量库真实收敛 | 待执行 | 需要在桌面应用中执行 bge-m3 生成，验证 1542→63 |

## 9. 构建机路径清除与被否决的两项加固（2026-09-18）

### 9.1 实测：重映射前后

对象：`src-tauri/target/release/teacher-agent.exe`。前 = 2026-09-10 构建（16,518,656 B，无重映射）；
后 = 2026-09-19 经 `scripts/build-release.ps1` 构建（17,645,056 B，sha256 前缀 `dfd97b65`，
rustc 1.96.0 + MSVC 14.51.36231，607 个 crate，fat LTO）。计数来自 `scripts/scan_artifact_leakage.py`。

| 判定 | 前 | 后 |
|------|---:|---:|
| `identity/RUSTUP_HOME` = `…\.rustup` | 46 | **0** |
| `identity/CARGO_HOME` = `…\.cargo` | 551 | 51 |
| `identity/CARGO_HOME-83` = `…\CARGO~1` | 32 | 32 |
| 绝对源路径（`.rs`/`.c` 等结尾） | 482 | **83** |
| 用户名 / 仓库根 / TEMP / 计算机器名 / 凭据形态 | 0 | **0** |

两个 sidecar 与 `dist/` 全程为 0。`release-check.ps1` 八步在"后"这一版上全部 PASS。

剩下的 83 条**全部来自 `aws-lc-sys-0.43.0` 的 C 源码**（51 条长路径 + 32 条 8.3 短路径，
83 个字符串各出现一次），上下文形如 `num <= BN_MAX_WORDS` 后紧跟
`…\aws-lc-sys-0.43.0\aws-lc\crypto\fipsmodule\bn\bn.c`——是 C `assert()` 展开时把 `__FILE__`
编进了 `.rdata`。`cc-1.2.65` 里没有任何 `NDEBUG`，即 cc-rs 不会自动关掉 C 断言。

同一次核查排除了三类更敏感的路径：

- **仓库根目录 0 条**。`env!("CARGO_MANIFEST_DIR")` 只出现在 `src-tauri/src/sync/protocol.rs:1460,1462`，位于 `#[cfg(test)] mod tests` 内，不进入发布二进制；其余 `include_str!` 只嵌入文件内容而不嵌入路径。
- **用户名与用户目录 0 条**。扫描器从当前环境推导出用户名、用户目录、临时目录、计算机名、仓库根等身份串再检索制品，这些全部 0 命中。残留限于依赖与工具链根，暴露的只是"构建机把 CARGO_HOME 放在非默认位置"这一事实，不指向具体个人；因此本文档也不写出这些串的实值，避免文档本身成为新的泄露面。
- **PE 调试目录只记文件名**。rustc 调链接器时恒带 `/PDBALTPATH:%_PDB%`，因此 CodeView 目录里的符号文件引用是裸文件名 `teacher_agent.pdb`，不是绝对路径；`.pdb` 本体也不进安装包。

### 9.2 处置：编译期重映射 + 受控残留基线

`scripts/build-release.ps1` 在启动构建前把 `--remap-path-prefix` 注入 `CARGO_ENCODED_RUSTFLAGS`，前缀取自 `$env:CARGO_HOME`、`$env:RUSTUP_HOME` 与仓库根，因此**仓库里不出现任何机器特定字符串**，闸门在任何构建机上都是自指的。

机制先在无链接器环境下证过（同一含 `panic!` 的源文件用 `rustc --emit=obj` 编译两次，绝对路径 1→0，改写成 `/cargo\src\lib.rs`），再在真实 607-crate 发布构建上证成：`.rustup` 46→0、Rust 编译单元侧的 `.cargo` 500→0。

**残留为什么不清零**：`--remap-path-prefix` 是 rustc 的开关，管不到 `cl.exe`，而 cl.exe 没有等价的路径重映射选项——`__FILE__` 就是命令行上给什么写什么。要给一个 FIPS 密码学依赖强塞 `/DNDEBUG` 来消掉断言字符串，等于为了仪表盘上少点灰去拔发动机报警灯，收益只是少暴露一个依赖缓存目录，代价是改变该依赖的 C 断言构建语义。本文选择不换这个交换，改为把残留**登记成受控已知项**（见 §9.6）。

构建环境本身踩过两个坑，都已固化进脚本：

1. **MSVC 半边缺失**。Windows SDK 是完整的（`C:\Windows Kits\10\Lib\10.0.22621.0`，`kernel32.Lib`、`libucrt.lib` 均在），rustc 也自带 `rust-lld.exe`；缺的是 VS/Build Tools 那侧的 `link.exe`、`cl.exe` 与 VC 导入库 `msvcrt.lib`、`oldnames.lib`。补一个链接器不够，因为 `rusqlite` 的 bundled 要编译 SQLite C 源码、`aws-lc-sys` 要编译并汇编 C。
2. **入口与 PATH**。装好之后 `link.exe` 仍不在普通终端 PATH 里；而 Build Tools 2026 里 `VC\Auxiliary\Build\vcvars64.bat` **不存在**，实际入口是 `Common7\Tools\VsDevCmd.bat`，且 `vswhere -requires …VC.Tools.x86.x64` 会返回空。脚本因此先按组件 ID 问、问不到就枚举实例并挑真正存在入口脚本的那个，然后自动加载开发环境，所以**不必**从 Developer PowerShell 启动。失败原因分三类各自报：Git 自带 `link(1)` 遮蔽（症状是 `link: extra operand`，易误诊成 Shell 问题）、没有 VS 实例、有实例但缺 MSVC 生成工具组件。

### 9.3 否决：钉死 devtools

`tauri-runtime-wry-2.11.3/src/lib.rs:5209-5211` 把 `with_devtools(...)` 整个调用包在 `#[cfg(any(debug_assertions, feature = "devtools"))]` 里，而 `src-tauri/Cargo.toml` 是 `tauri = { version = "2", features = [] }`。发布构建中这行代码根本不参与编译，检查器由 wry 自身的 `#[cfg(not(debug_assertions))] devtools: false` 决定为关闭——是编译期事实，不是运行期可翻转的开关。

此时在 `tauri.conf.json` 写 `"devtools": false` 只会影响 debug 分支（`WindowConfig.devtools` 文档默认值是"启用"），即把开发者自己的检查器关掉；`core:webview:deny-internal-toggle-devtools` 在发布版是对一个未被编译进来的命令做拒绝，是空操作。两项都是净负收益，故不加。

### 9.4 否决：拦 WebView2 远程调试环境变量

三条独立理由，任一成立即不值得做：

1. 能设置 `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` 意味着已经取得该用户的代码执行权，而论文 4.4 的防护范围明确**不包括**已获得物理或操作系统权限的攻击者——这超出自己声明的威胁模型。
2. wry 总是以编程方式调用 `set_additional_browser_arguments`（`wry-*/src/webview2/mod.rs:294-327`），而 WebView2 文档未说明环境变量与该选项之间是拼接还是覆盖，缓解是否有效无法证实。
3. 应用以提权身份运行时 WebView2 直接忽略 `WEBVIEW2_*` 覆盖，这条路径本身不可靠。

### 9.5 扫描器的局限（不要读成"已证明干净"）

- `.msi` 与 NSIS `setup.exe` 是压缩容器，静态字节扫描看不见其内容。闸门扫的是**装入安装器的那些产物**。
- `code-worker.exe` / `document-worker.exe` 由 PyInstaller 冻结，载荷经压缩，因此两者的 0 命中只说明"明文里看不见"，不等于"内部没有"。要覆盖它们需要解包 PYZ，目前未做。
- 身份层依赖扫描时所在机器的环境：在构建机上跑才有意义，在别人机器上跑会把别人的路径当成"干净"。

## 10. 受控残留基线（2026-09-19）

`scripts/artifact-leakage-baseline.json` 把 §9.1 那 83 条登记为**唯一一类例外**。它不是把阈值调成 83 的橡皮图章，而是五重约束：

1. **锁来源**：路径必须形如 `<CARGO_HOME>\registry\src\<index>\<crate_dir>\…`，`crate_dir` 逐字匹配。
2. **锁形态**：长路径与 8.3 短路径（`CARGO~1\…\AWS-LC~1.0\`）各自一条规则、各自设上限，因为 aws-lc 的构建为绕开路径长度限制自己缩短过路径，长前缀的重映射对它们不匹配。
3. **锁数量**：单文件长路径 ≤ 51、短路径 ≤ 32、合计 ≤ 83，超一个就 FAIL。
4. **敏感类别零容忍**：用户名、用户域、计算机名、HOME/USERPROFILE/TEMP、仓库根、`RUSTUP_HOME`、凭据形态——**不进基线**，命中一次即 FAIL。
5. **版本变化即失效**：`crate_dir` 里钉死了 `aws-lc-sys-0.43.0`。依赖升级后目录名不再匹配，闸门直接 FAIL，逼一次重新审计。83 不是常数。

基线文件里不写任何绝对路径，只写 `identity_token` 的**名字**，由扫描器从当前环境解析出实际值，所以同一份基线在任何构建机上都成立、也都能独立发现本机泄露。

三条实测（都跑过）：

| 场景 | 结果 |
|------|------|
| 正常扫描 2026-09-19 产物 | exit 0，note 显示 `长路径=51 短路径=32` |
| `--no-baseline`（零容忍） | exit 1，报出全部 83 条 |
| 把 `crate_dir` 改成 `aws-lc-sys-0.44.0` 模拟依赖升级 | exit 1，83 条重新变成未解释泄露 |

`release-check.ps1` 第 2 步调用扫描器时默认启用基线；要复核残留真相，加 `--no-baseline` 再跑一次。
