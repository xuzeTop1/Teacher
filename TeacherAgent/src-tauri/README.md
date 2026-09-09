# Tauri Backend

Rust 后端负责 TeacherAgent 的本地安全边界、SQLite、系统凭据存储、后续 sidecar 和系统能力。

当前已落地：

- 模块拆分：`models.rs`、`database.rs`、`provider.rs`、`conversation.rs`、`memory.rs`、`assessment.rs`、`knowledge.rs`、`vector.rs`、`bkt.rs`、`math_engine.rs`、`seed.rs`、`ollama.rs` 已从原 `lib.rs` 中拆出；详见 `docs/rust-module-map.md`。
- `ping`：最小 IPC 验证命令。
- `init_database`：初始化本地 SQLite 数据库，执行 `migrations/0001_initial.sql`，并返回数据库路径、迁移状态、已应用迁移和 `user_version`。
- `run_local_smoke_check`：运行本地自检，验证 `ping`、SQLite 初始化、默认会话和消息写读；消息写读在事务内执行并回滚，不污染正式会话。
- `ensure_default_conversation`：确保默认学生、学科和会话存在，返回本地会话标识。
- `list_conversations`：按学科读取本地会话列表，用于前端历史侧栏。
- `create_conversation`：按学科创建一个新的本地会话。
- `update_conversation_title`：更新会话标题，并刷新会话更新时间。
- `save_message`：保存或更新单条会话消息，并持久化 `knowledge_refs_json`、`tool_refs_json`、`guardrail_json` 等消息元数据。
- `list_messages`：按会话读取最近消息和消息元数据，用于前端恢复本地历史、Planner 观测面板等附加状态。
- `load_learning_memory_context`：读取用户画像、短期记忆和长期记忆摘要。
- `save_learning_memory_state`：保存用户画像、短期记忆和长期记忆摘要。
- `save_reflection_record`：保存对话后结构化反思记录到 `reflection_records`。
- `save_assessment_result`：保存本轮对话评估结果到 `assessment_results`，并同步知识节点快照与 `student_knowledge` 基础掌握度。
- `load_student_knowledge`：按学生和学科读取 `student_knowledge` 与 `knowledge_nodes` 的基础掌握度列表，用于 PlannerAgent 生成下一步建议。
- `load_knowledge_prerequisites`：按知识节点读取 `knowledge_edges` 的前置依赖；若图谱边暂未导入，则回退读取 `knowledge_nodes.prerequisites_json` 的文本前置概念。
- `save_provider_config`：保存默认 LLM Provider 的非敏感配置到 `provider_configs`，不保存明文 API Key。
- `load_default_provider_config`：读取默认 LLM Provider 配置，用于设置页恢复 baseUrl/model 等字段。
- `save_provider_api_key`：把 Provider API Key 写入系统凭据存储，返回 `api_key_ref`。
- `delete_provider_api_key`：按 `api_key_ref` 删除系统凭据存储中的 API Key。
- `complete_llm_chat`：由 Rust 按 OpenAI-compatible `/chat/completions` 协议请求模型；非本地 Provider 必须提供 `api_key_ref`，API Key 从系统凭据存储读取；失败时返回结构化错误 `code/message/status/retryable`。
- `store_vector_embedding`：存储或更新 embedding 向量（BLOB 格式）到 `vector_embeddings` 表。
- `search_vector_embeddings`：按实体类型和查询向量做余弦相似度搜索，返回排序结果。
- `generate_embedding`：调用 Provider 的 `/v1/embeddings` 端点生成文本 embedding。
- `check_ollama_status`：检查 Ollama 服务是否在 localhost:11434 运行。
- `start_ollama_engine`：启动 Ollama 后台服务进程。
- `compute_math_expression`：纯 Rust 符号计算引擎，支持多项式求导/积分、基本函数求导、表达式求值、化简、极限和线性方程求解。
- `bkt_update_mastery`：贝叶斯知识追踪算法，根据答题结果更新知识掌握概率。
- `seed_knowledge_nodes_from_json`：将 JSON seed 数据批量写入 `knowledge_nodes` 表（已存在则跳过）。
- `count_knowledge_nodes`：按学科统计 `knowledge_nodes` 表中的节点数量。
- `search_knowledge_from_db`：按学科和关键词搜索 `knowledge_nodes` 表，支持中文自然句。

数据库策略：

- 数据库文件名：`teacher_agent.sqlite3`
- 存储位置：Tauri app data directory。
- 迁移记录：`schema_migrations`
- 当前 migration 可重复执行，表结构使用 `CREATE TABLE IF NOT EXISTS`。
- SQLite 使用 `rusqlite` + bundled SQLite，避免依赖用户系统 SQLite 安装。

验证命令：

```powershell
npm run build
cd src-tauri
cargo fmt
cargo check
cargo test
```

说明：

- `cargo test`（51 条）目前包含 migration 幂等性、本地自检事务回滚、会话列表/重命名、会话消息与消息元数据回读、学习记忆、反思记录、本轮评估、学生掌握度更新、学生掌握度读取、知识前置依赖读取、Provider 配置保存、LLM command 输入校验、BKT 算法、数学计算引擎、向量存储/搜索、知识节点 seed/搜索（含中文自然句）等测试，会在系统临时目录创建测试数据库并在结束后删除。单元测试不读写真系统凭据，只验证 keychain 引用可安全写入 SQLite、疑似明文 API Key 会被拒绝、非本地 LLM 请求必须提供 `api_key_ref`，并验证 Provider 错误分类 code。
- 当前已具备最小会话/消息 repository、消息元数据 round-trip、学习记忆 repository、反思记录、本轮评估写入、基础掌握度更新、掌握度读取、知识前置依赖读取、BKT 算法、数学计算引擎和向量存储/搜索能力。学习记忆前端仍保留 `localStorage` 兜底，以便浏览器预览或 IPC 不可用时继续开发。
- 当前 Provider 配置只在 SQLite 持久化非敏感字段和 `api_key_ref`。API Key 写入系统凭据存储；OpenAI-compatible 请求优先走 Rust `complete_llm_chat`，前端全局 store 不保存明文 API Key。
- Rust LLM 请求日志只记录事件名、Provider 名称、模型名、脱敏 endpoint host、HTTP 状态、错误 code 和消息数量，不记录 API Key、请求体、对话内容或学生画像。
- `conversation.rs` 拆分后已于 2026-07-01 补跑 `cargo fmt`、`cargo check`、`cargo test` 并通过；Rust 测试当前 10 条通过。
