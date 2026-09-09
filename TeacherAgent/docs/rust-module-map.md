# Rust Backend Module Map

最后更新：2026-07-30

本文记录 `src-tauri/src/` 的模块边界，供 Codex、Claude Code 和后续维护者继续拆分 Rust 后端时使用。

## 当前模块

| 模块 | 职责 | 允许依赖 |
| --- | --- | --- |
| `lib.rs` | Tauri command 注册、命令薄封装 | `conversation`、`database`、`embedding`、`knowledge`、`memory`、`models`、`provider`、`assessment`、`shared` |
| `shared.rs` | 共享学科/时间/slug/truncate helper、DEFAULT_STUDENT_ID/NAME 常量 | `rusqlite`、`serde_json` |
| `embedding.rs` | Embedding API 调用（单条/批量），含重试和进度报告 | `models`、`provider`、`reqwest`、`serde_json`、`tokio` |
| `models.rs` | Tauri command 输入输出 DTO、学习记忆 DTO、Provider DTO、LLM DTO | `serde`、`serde_json` |
| `database.rs` | 数据库路径解析、SQLite 打开、migration 执行、已应用 migration 读取 | `rusqlite`、`tauri` |
| `provider.rs` | Provider 配置保存/读取、严格 URL 规范化、endpoint 绑定的系统凭据存储、禁重定向 OpenAI-compatible 请求、Provider 错误分类、脱敏日志 | `models`、`rusqlite`、`keyring`、`reqwest`、`serde_json` |
| `conversation.rs` | 默认会话、会话列表、会话创建/改名、消息保存/读取、会话和消息 row mapper | `models`、`rusqlite`、`lib.rs` 中的共享学科/时间 helper |
| `memory.rs` | 学习记忆：认知画像、短期记忆、长期记忆的加载/保存/upsert 和 row mapper | `models`、`rusqlite`、`conversation` |
| `assessment.rs` | 反思记录保存、评估结果保存、掌握度更新、知识节点快照 | `models`、`rusqlite`、`conversation`、`lib.rs` 中的共享 helper |
| `knowledge.rs` | 学生知识掌握度查询、知识图谱前置依赖读取 | `models`、`rusqlite`、`lib.rs` 中的 `normalize_subject_code` |
| `worker.rs` | Python document-worker sidecar 调用（文档解析 + 数学计算）、系统文件选择器、一次性文档授权令牌、staging 副本、子进程环境白名单、数学输入语法边界 | `serde`、`serde_json`、`std::process`、`rfd`、`rand` |
| `code_worker.rs` | code-worker fail-closed、可信 Debug opt-in、stdin-only 传输、输入/超时限制、子进程环境白名单 | `serde`、`serde_json`、`std::process` |
| `sidecar_integrity.rs` | sidecar SHA-256 manifest 校验；Release 强制，Debug 默认拒绝并仅双重显式 opt-in 可绕过 | `sha2`、`hex`、`serde_json` |
| `private_doc.rs` | 私有资料文档保存/列表/删除/chunk 加载/搜索、会话级资料绑定 | `rusqlite`、`lib.rs` 中的共享 helper |
| `vector.rs` | 向量 embedding 存储和余弦相似度搜索 | `rusqlite` |
| `bkt.rs` | 贝叶斯知识追踪算法 | 无外部依赖 |
| `math_engine.rs` | 纯 Rust 符号计算（求导、积分、求值、化简、极限、方程求解） | 无外部依赖 |
| `seed.rs` | 知识库 seed 导入（JSON → SQLite）、健康检查 | `rusqlite`、`serde_json` |
| `ollama.rs` | Ollama 本地引擎进程管理（启动/检测）、本地模型列表只读检测 | `std::process`、`reqwest`、`serde` |
| `main.rs` | Tauri 可执行入口 | `teacher_agent_lib::run()` |

## 依赖方向

- `main.rs` 只调用 `teacher_agent_lib::run()`。
- `lib.rs` 可以调用各业务模块，但业务模块不要反向调用 Tauri command。
- `models.rs` 不应依赖业务模块。
- `database.rs` 不应依赖 Provider、Conversation、Memory 或 Assessment 模块。
- `provider.rs` 不应依赖 UI、学生画像、对话内容 repository 或 Prompt 逻辑。
- `conversation.rs` 只处理会话和消息持久化，不承载教学策略、Provider 请求或学习记忆算法。

## 当前验证状态

`models.rs`、`database.rs`、`provider.rs`、`conversation.rs`、`memory.rs`、`assessment.rs`、`knowledge.rs` 拆分后已通过：

```powershell
cd src-tauri
cargo fmt
cargo check
cargo test
```

最近一次验证时间：2026-07-07。

验证结果：`cargo test` 111 条 Rust 测试通过，0 失败。当前可以继续按下方顺序拆分后续模块，但每一步仍需独立补跑 `cargo fmt`、`cargo check`、`cargo test`。

## 下一步拆分顺序

建议按下面顺序继续，每一步都要补跑 `cargo fmt`、`cargo check`、`cargo test`：

1. ~~`memory.rs`~~：✅ 已完成（2026-07-02）。迁出 `load_learning_memory_context_with_connection`、`save_learning_memory_state_with_connection`、认知画像、短期记忆、长期记忆相关 row mapper 和 JSON array helper。
2. ~~`assessment.rs`~~：✅ 已完成（2026-07-02）。迁出 `save_reflection_record_with_connection`、`save_assessment_result_with_connection`、掌握度更新、知识节点快照和相关 DTO 处理。
3. ~~`knowledge.rs`~~：✅ 已完成（2026-07-02）。迁出 `load_student_knowledge_with_connection`、`load_knowledge_prerequisites_with_connection` 和知识图谱前置依赖读取。
4. ~~`shared.rs`~~：✅ 已完成（2026-07-07）。迁出 `normalize_subject_code`、`subject_name`、`subject_style_key`、`subject_code_from_subject_id`、`truncate_for_storage`、`current_timestamp`、`current_unix_nanos`、`create_slug`、`validate_json_object_or_array` 等共享 helper，以及 `DEFAULT_STUDENT_ID`/`DEFAULT_STUDENT_NAME` 常量。`provider.rs` 中的重复 `truncate_for_storage` 已删除，改用 `crate::shared::truncate_for_storage`。
5. ~~`embedding.rs`~~：✅ 已完成（2026-07-07）。迁出 `generate_embedding_for_text` 和 `generate_embeddings_batch_for_texts` 核心逻辑。Tauri command 薄封装保留在 `lib.rs`。

## 拆分纪律

- 每次只迁出一个职责簇，避免同时修改 schema、业务逻辑和模块边界。
- DTO 字段保持 `pub(crate)`，不要无故扩大为公共 crate API。
- Rust command 保持薄封装：打开数据库、调用 repository、返回 DTO。
- 涉及 API Key、Provider 日志或学生画像的改动必须同步隐私文档或状态记录。
- 若验证命令被环境限制拦截，必须在 `docs/project-status.md` 和交接文档中标记“待补跑”，不要写成已通过。
