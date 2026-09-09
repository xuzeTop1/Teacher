# TeacherAgent 发布安全审计报告

**审计日期**: 2026-07-25
**审计范围**: 源码 + 构建产物（MSI / NSIS / PE）
**方法**: 白盒审计 + 安装包解包 + PE 字符串分析
**版本**: v0.1.0 (commit `ed432e9`)

---

## 测试基线

### Git 状态

```
## main...origin/main [ahead 59]
 M docs/claudecode-handoff.md
 M docs/code-worker.md
 M docs/user-action-required.md
 M src/components/chat/welcomeMessages.test.ts
 M src/components/chat/welcomeMessages.ts
 M src/components/settings/ProviderPanel.vue
 M src/engine/agents/tutorOrchestrator.ts
 M src/services/llm/providerDiagnostics.ts
 M src/services/llm/providerFormState.test.ts
 M src/services/llm/providerFormState.ts
 M src/styles/main.css
 M src/views/ChatView.vue
 M tools/code-worker/code_worker/runner.py
 M tools/code-worker/tests/test_runner.py
?? docs/design/
?? docs/frontend-redesign-v1.md
?? src/components/chat/PythonPlayground.vue
?? src/services/llm/providerDiagnostics.test.ts
?? src/stores/app.test.ts
```

最近 5 个提交:
```
ed432e9 fix(release): fail-closed sidecar integrity, fix scripts and docs
db7318e docs(release): add hardening docs, scripts, and real-count verification
b807459 style: cargo fmt sidecar_integrity.rs
62eef86 feat(release): convergence fail-closed + release hardening
a15ec4f fix(knowledge): remove unsafe NOT IN deletion, add fail-closed and Rust tests
```

### 构建产物哈希

| 文件 | SHA-256 | 大小 |
|------|---------|------|
| MSI | `06D434F9CF7CA4052B1902C0FAD54E80DFD0A290151AC247DD0DAB1169392E4F` | 82,700 KB |
| NSIS | `0A1E8D9826BCF1980C9954662773846FC903A0197EC810B8FB3AFF6B536C2FF9` | 81,240 KB |
| teacher-agent.exe (target/release) | `C75F888F1621253959B134F42E3DB50487E64EC4DF35FAF4513DE1CDE5AC379D` | 12,962 KB |
| teacher-agent.exe (MSI) | `D747081A094953437DEA0F2B7A5DF3C50C85B512F5ADA1C256DE0F85F4CD5DEF` | 12,961 KB |
| code-worker.exe (target/release + MSI) | `2995B006FB78CAC6E8A093799299549C93725B1B75B33CE4423DC8762B43679F` | 7,939 KB |
| document-worker.exe (target/release + MSI) | `B893F6EDEE32B5D3F3B12E2250A4374DA5FB20C7BA8B8600BD14C4882D384663` | 67,682 KB |

> ⚠️ teacher-agent.exe 的 MSI 内嵌版本与 target/release 版本哈希不同，说明 MSI 打包过程修改了主程序（可能是 Tauri MSI bundler 重新签名或修改了 PE 头）。

---

## 一、安装包和前端资源暴露

### 检查结果

| 检查项 | 结果 | 证据 |
|--------|------|------|
| .map / source map | ✅ 无 | `dist/` 目录无 `.map` 文件；`vite.config.ts:22` `sourcemap: isDev ? "inline" : false` |
| TypeScript/Vue 源码 | ✅ 已编译 | dist 只有 `.js`/`.css`/`.html` |
| 测试文件 | ✅ 无 | dist 无 `*.test.*` 或 `*.spec.*` |
| .env 文件 | ✅ 无 | 项目根和 dist 均无 `.env` |
| Git 信息 | ✅ 无 | dist 无 `.git` 目录 |
| 调试日志 | ✅ 无 | dist JS 无 `console.log`/debug 特征 |
| 本地绝对路径 | ✅ 无 | dist JS 无可识别路径 |
| API Key / Token | ✅ 无 | dist JS 无 `sk-`/`api_key`/Authorization header |
| VITE_/TAURI_ 环境变量 | ✅ 仅 Tauri 内部变量 | 仅 `TAURI_TO_IPC_KEY__` / `TAURI_INTERNALS__`（Tauri 运行时需要） |
| localhost 引用 | ℹ️ 1处 | `SettingsView-B-uBnC0V.js`: `http://localhost:11434/v1` — Ollama 默认地址，UI 设置页展示，非秘密 |
| SQL schema | ✅ 仅在 JS 中的 ORM 定义 | 属于客户端业务逻辑 |
| Tauri command 名称 | ℹ️ 可见 | minified JS 中包含所有 command 名称，这是 Tauri IPC 的正常副作用 |

### 前端 JS 可恢复内容

经过对 minified JS 的审查，攻击者可以恢复：
- **Provider 配置结构** — 正常的客户端设置逻辑
- **Prompt 模板** — 嵌入在 agent 逻辑中
- **Pack manifest** — seed files 以 minified JS module 形式存在
- **Tauri command 列表** — 所有 53 个 command 名称可见

**判定**: 以上均为客户端业务逻辑的正常暴露，不构成安全漏洞。不泄露 API Key、密钥或可利用的越权边界。

---

## 二、Rust/PE 发布加固

### Cargo.toml 配置 (src-tauri/Cargo.toml:31-40)

```toml
[profile.release]
opt-level = "z"
lto = true
codegen-units = 1
strip = "symbols"
```

✅ 配置正确，panic="unwind" 保留（Tauri IPC catch_unwind 兼容性需要，文档已说明）。

### PE 分析结果 (teacher-agent.exe)

| 检查项 | 结果 | 详情 |
|--------|------|------|
| 调试目录 / RSDS | ⚠️ 残留 | 嵌入 `teacher_agent.pdb` 引用路径。`strip="symbols"` 去除了符号表但保留了 debug 目录头中的 PDB 文件名 |
| 源文件绝对路径 | ⚠️ ~879 处 | 包括 `C:\Users\Acer\.cargo\registry\src\...` — 暴露构建机器用户名 `Acer` 和 crate 源码路径 |
| Rust panic 路径 | ⚠️ 部分 | `futures-channel-0.3.32\src\mpsc\queue.rs`、`mod.rs` 等 panic 消息中包含源文件路径 |
| API Key | ✅ 无真实密钥 | `api_key` 字符串来自 serde `rename_all="camelCase"` 的 struct 字段名，非真实凭据 |
| 私钥 | ✅ 无 | |
| 用户隐私数据 | ✅ 无 | 除上述构建路径外 |

### 判定

- `strip="symbols"` 生效但**不完全**：去除了 DWARF/PDB 符号，但 RSDS 调试目录头和 panic 位置信息中的源文件路径仍然残留。
- 暴露构建机器用户名 (`Acer`) 和 crate 源路径是**信息泄露（P3）**，属于 Rust 编译的正常残留，非安全漏洞。
- 预期进一步减少残留需要 `panic="abort"`（但会破坏 Tauri IPC 错误恢复）或在 build.rs 中使用 `rustc-cfg` 去除 panic 路径。

---

## 三、Sidecar 完整性验证 — **P0 关键发现**

### 源码审查

#### sidecar_integrity.rs

- `src-tauri/src/sidecar_integrity.rs:49-94`: `verify_sidecar_integrity`
  - Release 构建（`#[cfg(not(debug_assertions))]`）manifest 缺失时返回 Err ✅ **fail-closed**
  - Debug 构建 manifest 缺失时返回 Ok（跳过校验）
  - 哈希不匹配返回 Err ✅
  - Manifest 缺少条目返回 Err ✅

#### 测试覆盖盲区

- `src-tauri/src/sidecar_integrity.rs:166-177`: `verify_skips_when_no_manifest` 测试
  - 该测试**仅验证 debug 路径**（`#[cfg(debug_assertions)]` 在测试中为 true）
  - **Release 路径（manifest 缺失 → Err）未被任何测试覆盖**
  - 如需验证 release 路径，需要 `cargo test --release`

### P0-1: sidecar-hashes.json 未打包进安装包 **[已通过真实 MSI 复现]**

**证据**:
- MSI 解包后 `PFiles\TeacherAgent\` 仅包含 3 个文件：
  - `teacher-agent.exe`
  - `code-worker.exe`
  - `document-worker.exe`
- `sidecar-hashes.json` **不存在于安装目录中**
- `src-tauri/tauri.conf.json` 中**没有 `resources` 配置**来包含此文件

**实际行为**:
1. 用户安装 TeacherAgent
2. 尝试运行代码 → `verify_sidecar_integrity` 被调用
3. `load_hash_manifest(dir)` 找不到 `sidecar-hashes.json`
4. Release 构建返回 Err: `"sidecar 完整性校验失败：未找到 sidecar-hashes.json。安装包构建异常，请重新安装。"`
5. Sidecar **被拒绝启动** ✅ **fail-closed 本身工作正常**

**预期行为**: `sidecar-hashes.json` 应该包含在安装包中，使得安装后应用能正常校验并启动 sidecar。

**风险**: 当前生产安装包中，代码执行和文档解析功能**完全不可用**。这是一个构建流水线缺陷：安全机制本身正确（fail-closed），但集成不完整导致功能损坏。

**修复建议**:
在 `tauri.conf.json` 的 `bundle` 中添加 `resources` 配置：
```json
"bundle": {
    "resources": {
        "src-tauri/target/release/sidecar-hashes.json": "./"
    }
}
```
或在 `build.rs` 中自动生成 + 在 Tauri build 的 `beforeBuildCommand` 中包含生成步骤。

### P0-2: Python fallback 绕过 sidecar 完整性校验 **[源码审查确认]**

**证据**:
- `src-tauri/src/code_worker.rs:239-243`: `run_code_worker()` 在 `resolve_code_worker_executable()` 返回 None 时回退到 `run_code_worker_python()`
- `src-tauri/src/worker.rs:284-291`: `run_worker()` 同样存在 Python fallback
- Python 路径 (`run_code_worker_python` / `run_worker_python`) **不经过任何完整性校验**
- 环境变量 `TEACHER_AGENT_CODE_WORKER_DIR` / `TEACHER_AGENT_DOCUMENT_WORKER_DIR` 可以重定向 Python 工作目录

**风险**: 如果攻击者能够：
1. 删除/重命名 sidecar exe 文件
2. 设置环境变量指向恶意 Python 代码
→ 可以绕过 sidecar 完整性校验，执行任意 Python 代码

**实际可利用性**: 需要在本地环境设置环境变量或修改文件系统，属于本地提权/持久化场景。

**修复建议**: 在 release 构建中禁用 Python fallback，仅允许通过已验证的 sidecar exe 执行。

### P1-1: Manifest key 与 resolve 函数文件名不匹配风险 **[源码审查确认]**

**证据**:
- `sidecar-hashes.json` 使用 key: `"code-worker.exe"`, `"document-worker.exe"`（短名）
- `src-tauri/src/code_worker.rs:107-108`: `resolve_code_worker_executable()` 优先查找 `"code-worker-x86_64-pc-windows-msvc.exe"`（triple 后缀），次选 `"code-worker.exe"`
- `src-tauri/src/worker.rs:94-98`: 同样优先 triple 后缀名
- `src-tauri/src/code_worker.rs:253-257`: `verify_sidecar_integrity` 使用 `exe_path.file_name()` 作为 key

**实际行为**: 当前安装包中文件名为短名 (`code-worker.exe`)，所以与 manifest key 匹配。但如果 Tauri 打包策略改变（使用 triple 后缀名），resolve 会找到 triple 名文件但 manifest 找不到对应条目 → 校验失败。

**风险**: 文件名策略不一致导致未来构建可能自动 break。

**修复建议**: 统一文件名策略，或将 manifest key 和 resolve 逻辑对齐。

### P1-2: sidecar-hashes.json 生成未集成到构建流程

**证据**:
- `scripts/generate-sidecar-hashes.ps1` 是独立脚本，需要**手动运行**
- `build.rs` 仅调用 `tauri_build::build()`，无自定义 manifest 生成逻辑
- `tauri.conf.json` 的 `beforeBuildCommand` 仅为 `npm run build`（前端构建），不包含 Rust sidecar manifest 生成

**风险**: 开发者可能忘记运行脚本，导致 manifest 与实际二进制不匹配或缺失。

---

## 四、Tauri 命令攻击面审计

### 命令全量枚举 (53 个注册命令)

**文件**: `src-tauri/src/lib.rs:767-838`

#### 分类统计

| 类别 | 数量 | 命令 |
|------|------|------|
| 数据库写入（对话/消息/记忆/评估/配置） | 16 | `init_database`, `ensure_default_conversation`, `save_message`, `create_conversation`, `archive_conversation`, `unarchive_conversation`, `delete_conversation`, `update_conversation_title`, `save_learning_memory_state`, `save_reflection_record`, `save_assessment_result`, `save_provider_config`, `delete_provider_config`, `save_private_document`, `delete_private_document`, `bind_private_document_to_conversation` |
| 数据库只读（查询/列表/加载） | 19 | `run_local_smoke_check`, `list_conversations`, `list_messages`, `load_learning_memory_context`, `load_student_knowledge`, `load_knowledge_prerequisites`, `load_default_provider_config`, `list_provider_configs`, `search_knowledge_from_db`, `get_knowledge_nodes_by_ids`, `count_*` (6), `list_private_documents`, `load_private_document_chunks`, `search_private_document_chunks`, `get_private_document` |
| Keychain（API Key 存取） | 4 | `save_provider_api_key`, `delete_provider_api_key`, `save_bocha_api_key`, `delete_bocha_api_key` |
| Provider / 网络 | 4 | `complete_llm_chat`, `complete_llm_chat_stream`, `bocha_web_search`, `has_bocha_api_key` |
| Sidecar / 进程 | 4 | `parse_document_with_worker`, `compute_math_with_worker`, `run_code`, `select_document_file` |
| Ollama 管理 | 3 | `check_ollama_status`, `list_ollama_models`, `start_ollama_engine` |
| Embedding | 3 | `generate_embedding`, `generate_embeddings_batch`, `store_vector_embedding`, `search_vector_embeddings`, `delete_embeddings_by_model_and_ids`, `count_vector_embeddings` |
| 知识节点管理（seed/health/delete） | 8 | `seed_knowledge_nodes_from_json`, `sync_approved_manifest`, `count_manifest_nodes`, `knowledge_health_check`, `delete_orphan_knowledge_nodes`, `create_custom_subject`, `delete_custom_subject`, `generate_knowledge_from_sources` |
| 纯函数/无副作用 | 3 | `ping`, `compute_math_expression`, `bkt_update_mastery` |

### 高风险命令逐项分析

#### `parse_document_with_worker` (lib.rs:550-556)
- **调用链**: `parse_document_with_worker` → `worker::parse_document_with_worker(file_path)` → `run_worker` → `resolve_worker_executable` OR `run_worker_python`
- **参数校验**: ✅ 检查文件是否存在、大小 ≤50MB、扩展名 .pdf/.docx/.xlsx
- **风险**: `file_path` 由前端传入，**可能读取任意路径**。虽然有扩展名白名单，但用户通过文件选择器选择的路径可能指向任意位置。

#### `run_code` (lib.rs:578-596)
- **参数校验**: ✅ 超时 clamp 到 1-30 秒；空代码返回错误
- **风险**: 代码内容由前端完全控制 → 在 `code_worker` sidecar 内执行，但 sidecar 本身无沙箱（仅教学护栏）

#### `seed_knowledge_nodes_from_json` (lib.rs:420-430)
- **参数校验**: ✅ 验证 `status` 必须是 `approved` 或 `draft`
- **风险**: 种子 JSON 由前端完全控制 → 可注入任意知识节点内容

#### `delete_orphan_knowledge_nodes` (lib.rs:502-511)
- **参数校验**: ✅ 需要 `force: bool` + `orphan_ids` 和 `manifest_node_ids` 双层校验
- **风险**: ✅ 不删除 approved (lib.rs:510 `seed::delete_orphan_knowledge_nodes` 有内部保护)

#### `generate_embedding` / `generate_embeddings_batch` (lib.rs:362-392)
- **参数校验**: ⚠️ `base_url` 由前端传入，**无 allowlist 限制**
- **风险**: 前端可将 embedding 请求指向任意 URL（但 API key 需要从 keychain 获取，这限制了滥用范围）

#### `bocha_web_search` (lib.rs:691-699)
- **参数校验**: ✅ API key 从 keychain 读取，不从前端传入
- **风险**: `query` 和 `count` 由前端控制 → 可能发起任意搜索查询

#### Provider commands (`complete_llm_chat`, `complete_llm_chat_stream`)
- **参数校验**: ✅ API key 必须通过 keychain reference，拒绝 plaintext；role 白名单
- **风险**: `base_url` 由前端传入 → 可指向任意 LLM endpoint（但需要有效的 API key）

### 不存在的高风险漏洞

| 检查项 | 结果 |
|--------|------|
| 任意文件路径读取 | ✅ 未发现 — `parse_document_with_worker` 虽然有文件路径参数，但受扩展名和大小限制 |
| 任意文件路径写入 | ✅ 未发现 |
| 任意进程/命令执行 | ⚠️ `run_code` 在 sidecar 内执行 Python 代码（设计预期行为，但 sidecar 无沙箱） |
| SQL 拼接 | ✅ 未发现 — 所有 SQL 使用参数化查询 (`params![]`) |
| API Key 明文返回前端 | ✅ 未发现 — keychain 集成确保 key 不离开 Rust 层 |
| 绝对数据库路径泄露 | ℹ️ `init_database` 返回 `database_path`（设计行为，用于 Smoke Check 显示） |
| 内部堆栈泄露 | ✅ 未发现 — 错误消息为中文用户友好描述 |

### Capabilities (src-tauri/capabilities/default.json)

```json
{
  "identifier": "default",
  "windows": ["main"],
  "permissions": ["core:default"]
}
```

✅ 使用 Tauri 2 `core:default` 最小权限，未添加额外权限。

---

## 五、CSP 与 Markdown 边界

### CSP 策略 (src-tauri/tauri.conf.json:23)

```
default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: blob:; connect-src ipc: http://ipc.localhost; worker-src 'self' blob:
```

| 检查项 | 结果 | 说明 |
|--------|------|------|
| CSP 是否为 null | ✅ 已设置 | 不再为 null（commit `62eef86`） |
| `unsafe-eval` | ✅ 不存在 | 仅有 `wasm-unsafe-eval`（Shiki WASM 需要） |
| `wasm-unsafe-eval` | ℹ️ 存在 | Shiki 语法高亮的 WASM 运行时需要，属于合理需求 |
| 任意远程 script | ✅ 不允许 | `script-src 'self'` 仅允许本地 |
| 任意 connect-src | ✅ 仅 IPC | `connect-src ipc: http://ipc.localhost` 仅允许 Tauri IPC |
| `javascript:` URL | ✅ 被 CSP 阻止 | 无 `unsafe-inline` 在 script-src |
| event handler 注入 | ✅ 被 CSP 阻止 | inline event handler 需要 `unsafe-inline` 在 script-src |

### Markdown/XSS 边界分析

CSP 策略 `script-src 'self' 'wasm-unsafe-eval'` 的含义：
- ✅ `<script>` 标签内联代码 → **被 CSP 阻止**
- ✅ `<img onerror="...">` → **被 CSP 阻止**（inline event handler 需要 `unsafe-inline` 在 script-src）
- ✅ `javascript:` 链接 → **被 CSP 阻止**
- ✅ `eval()` / `new Function()` → **被 CSP 阻止**（无 `unsafe-eval`）

**KaTeX**: ✅ 仅输出 HTML/CSS/font，无 JS 执行 → CSP 兼容
**Shiki**: ✅ 需要 `wasm-unsafe-eval` 加载 WASM → CSP 已允许
**Markdown 渲染**: ✅ 输出静态 HTML → 无 JS 生成
**Ollama IPC**: ✅ `connect-src ipc: http://ipc.localhost` → 允许 Tauri IPC 和 localhost HTTP

**Markdown 渲染 XSS 验证（源码审查）**:
- Shiki 代码高亮在构建时预编译为 HTML 字符串 → 无运行时 JS 生成
- KaTeX 将 LaTeX 编译为纯 HTML → 无 JS 执行路径
- `marked` 库配置中应确保 `sanitize` 或同等选项 → 需要进一步审查 `MessageRenderer.vue`

### P2-1: `connect-src http://ipc.localhost` 语法分析

`connect-src ipc: http://ipc.localhost` 允许到 `http://ipc.localhost` 的连接。这是 Tauri 2.x 的内部 IPC 代理方案。`ipc:` 协议用于 Tauri 自定义 IPC，`http://ipc.localhost` 是 Tauri 用于 HTTP 请求代理的虚拟主机。

✅ 这不会开放到任意远程服务器的连接，因为 Tauri 的 HTTP 客户端在 Rust 层处理。

---

## 六、向量收敛安全

### 源码审查

- `src/services/knowledge/seedEmbeddingService.ts`:
  - ✅ `loadAllKnowledgePacksStrict` / `loadAllQuestionPacksStrict` — 单个 pack 加载失败导致整个操作终止
  - ✅ 删除前的 duplicate ID 检测
  - ✅ draft/approved ID 集合零交集检查
  - ✅ `Some([])` 不会降级为全库搜索（`entity_ids` 参数显式传递）
  - ✅ `delete_embeddings_by_model_and_ids` 仅删除指定 `entity_ids` 和 `embedding_model`，不删除 custom/private 模型

### 6 个收敛可靠性测试 (commit `62eef86`)
- strict loader 失败
- delete 失败传播
- 正确 draft ID 派生
- approved 零交集
- 重复检测
- 正常路径完成

✅ 向量收敛安全机制设计正确。

---

## 七、依赖与构建可复现性

### Cargo.toml / Cargo.lock 一致性

- ✅ `sha2 = "0.10"` → Cargo.lock: `0.10.9`
- ✅ `hex = "0.4"` → Cargo.lock: `0.4.x`
- ✅ Cargo.lock 已提交（commit `ed432e9`）
- ✅ `cargo check --locked` / `cargo build --release --locked` 应可复现

---

## 八、综合判定

### 当前安装包是否真的启用了 sidecar 完整性校验？

**是**。代码逻辑正确（fail-closed），release 构建在 manifest 缺失时会拒绝启动 sidecar。但 **sidecar-hashes.json 未被打包进安装包**，导致生产环境中 sidecar 功能完全不可用。

### 删除或损坏 manifest 是否能绕过校验？

**不能绕过，但会更糟**：删除 manifest 会导致 release 构建拒绝启动 sidecar（fail-closed）。但攻击者可以通过删除 sidecar exe 文件并设置环境变量来触发 **Python fallback 路径**，这条路完全不经过完整性校验。

### 是否泄露 API Key、token、PDB 路径或 source map？

- API Key / token: **无泄露**
- PDB 路径: **`teacher_agent.pdb` 引用残留在 PE 中**（P3）
- Source map: **无泄露**（`vite.config.ts` 正确配置）
- 构建机器用户名: **泄露**（`C:\Users\Acer\...` 路径残留在 PE 中，P3）

### Tauri commands 是否存在任意文件/命令执行面？

- 任意文件读取: **无**（`parse_document_with_worker` 有扩展名白名单）
- 任意文件写入: **无**
- 任意命令执行: ⚠️ **间接存在** — `run_code` 在 sidecar 内执行任意 Python 代码 + Python fallback 路径无完整性校验

### 当前安装包适合内部测试还是正式发布？

**不适合正式发布**。P0-1（manifest 缺失导致功能损坏）和 P0-2（Python fallback 绕过校验）必须修复后才能发布。

### 哪些结果未经真实运行验证？

以下测试因环境限制未执行：
1. **实际安装 + 运行 TeacherAgent.exe** — 因当前机器未安装应用
2. **cargo test --release** 验证 release 路径的 fail-closed 行为
3. **修改 sidecar 一个字节后实际运行校验** — 因 sidecar-hashes.json 在安装包中缺失
4. **CSP 动态验证**（尝试在 Markdown 中注入 `<script>` 等）— 需要启动 Tauri WebView
5. **Keychain 集成测试** — 需要真实 OS keychain 环境
6. **Ollama 状态检查** — 需本地 Ollama 运行

所有标记为"✅ 未发现"的结论均基于源码审计和构建产物静态分析。

---

## 九、按优先级汇总

### P0 — 安全能力完全失效或可越权

| # | 标题 | 证据 |
|---|------|------|
| P0-1 | **sidecar-hashes.json 未打包进安装包** — 生产应用 sidecar 功能完全不可用 | MSI 解包仅 3 个文件，无 manifest；`tauri.conf.json` 无 `resources` 配置 |
| P0-2 | **Python fallback 绕过 sidecar 完整性校验** — 删除 sidecar exe + 设环境变量可执行未经校验的 Python 代码 | `code_worker.rs:239-243`, `worker.rs:284-291` |

### P1 — 正式发布阻塞

| # | 标题 | 证据 |
|---|------|------|
| P1-1 | **Manifest key 与 resolve 函数文件名策略不一致** — triple 后缀 vs 短名 | `sidecar-hashes.json` 用短名，`resolve_*_executable()` 优先 triple 后缀 |
| P1-2 | **sidecar-hashes.json 生成未集成到构建流程** — 需手动运行脚本 | `build.rs` 无集成，`beforeBuildCommand` 不含生成步骤 |
| P1-3 | **Release 路径（manifest 缺失→Err）无测试覆盖** | `sidecar_integrity.rs:166-177` 仅测 debug 路径 |
| P1-4 | **teacher-agent.exe MSI 内嵌版本与 release 目录版本哈希不一致** — 构建可复现性疑点 | SHA-256 不同 |

### P2 — 防御纵深

| # | 标题 | 证据 |
|---|------|------|
| P2-1 | **`run_code` 无语言白名单** — 虽然当前仅支持 Python，但如果 sidecar 扩展支持其他语言，前端可完全控制 | `code_worker.rs:202` 无语言参数 |
| P2-2 | **`generate_embedding` 的 `base_url` 无 allowlist** — 可能指向任意 URL | `lib.rs:362-370` |
| P2-3 | **`select_document_file` 使用 rfd 本地对话框** — ✅ 安全，但 `parse_document_with_worker` 接受任意 file_path 字符串 | `lib.rs:550, 598-600` |

### P3 — 信息泄露/维护

| # | 标题 | 证据 |
|---|------|------|
| P3-1 | **PE 嵌入 PDB 路径 `teacher_agent.pdb`** | teacher-agent.exe RSDS 调试目录 |
| P3-2 | **PE 嵌入构建机器用户名 `Acer` 和 crate 源路径** | `C:\Users\Acer\.cargo\registry\...` |
| P3-3 | **源文件路径残留在 panic 消息中** ~879 处 | `futures-channel-0.3.32\src\mpsc\queue.rs` 等 |
| P3-4 | ✅ **2026-07-30 已修复** — `sk-ant-` 原本已被 `sk-` 覆盖；现进一步覆盖 `gsk_`、`AIza`、`hf_`、GitHub、Slack、Stripe、AWS、OAuth/JWT 等常见形态，并正确清洗 Authorization/Bearer 头 | `shared.rs` |

---

## 十、修复优先级建议

1. **立即修复 (P0)**:
   - 在 `tauri.conf.json` 添加 `bundle.resources` 配置，将 `sidecar-hashes.json` 打包进安装包
   - 在 release 构建中禁用 Python fallback，仅允许通过已验证 sidecar 执行

2. **发布前修复 (P1)**:
   - 统一 sidecar 文件名策略
   - 将 `generate-sidecar-hashes.ps1` 集成到 `beforeBuildCommand`
   - 添加 `cargo test --release` 验证 release fail-closed 路径

3. **后续迭代 (P2-P3)**:
   - 添加 `generate_embedding` URL allowlist
   - 评估 `panic="abort"` 对 Tauri IPC 的影响以减少 PE 路径残留
