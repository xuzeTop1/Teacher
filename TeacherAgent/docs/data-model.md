# TeacherAgent 数据模型文档

版本：v1.0  
状态：MVP 开发基线  
最后更新：2026-08-11
适用对象：前端/后端实现者、Codex、Claude Code

## 1. 数据模型目标

MVP 数据模型需要支持：

- 本地学生档案。
- 会话与消息保存。
- 知识图谱 seed。
- 题库 seed。
- 基础知识掌握度。
- 对话反思记录。
- LLM Provider 配置。
- 后续扩展学习路径和评估报告。

数据库默认使用 SQLite。向量检索默认预留 SQLite-vec，但 MVP 可以先使用 keyword/hybrid mock。LanceDB 可作为后续大规模、多模态或跨项目知识库的备选方案，不作为 MVP 默认依赖。

## 2. 命名约定

- 表名使用 snake_case 复数形式。
- 主键统一为 `id TEXT PRIMARY KEY`，使用 UUID 或 ULID。
- 时间字段使用 ISO 8601 字符串，字段名为 `created_at`、`updated_at`。
- 软删除使用 `deleted_at TEXT NULL`。
- JSON 字段以 `_json` 结尾。
- 枚举字段使用 TEXT。

## 3. 核心表

### 3.0 建表顺序

Migration 实现时必须先创建被引用表，再创建引用表。建议顺序：

```text
students
subjects
content_sources
learning_goals
conversations
student_cognitive_profiles
long_term_memories
short_term_memories
knowledge_nodes
knowledge_edges
questions
messages
student_knowledge
reflection_records
assessment_results
provider_configs
private_documents
private_document_chunks
conversation_private_documents
```

其中 `knowledge_nodes.source_id` 和 `questions.source_id` 引用 `content_sources.id`，所以 `content_sources` 必须先于 `knowledge_nodes` 和 `questions` 创建。

### 3.1 students

学生档案。

```sql
CREATE TABLE students (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  stage TEXT,
  active_goal_id TEXT,
  preferences_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
```

说明：

- `stage` 示例：`college`、`postgraduate_exam`、`certification`。
- `preferences_json` 存储讲解偏好、主题偏好、默认学科风格等。

### 3.2 subjects

学科。

```sql
CREATE TABLE subjects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  style_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

示例：

- `math`
- `english`
- `law`
- `accounting`
- `programming`

### 3.3 learning_goals

学习目标。

```sql
CREATE TABLE learning_goals (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  name TEXT NOT NULL,
  target_date TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  FOREIGN KEY (student_id) REFERENCES students(id),
  FOREIGN KEY (subject_id) REFERENCES subjects(id)
);
```

### 3.4 conversations

会话。

```sql
CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL,
  subject_id TEXT,
  learning_goal_id TEXT,
  title TEXT NOT NULL,
  summary TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  FOREIGN KEY (student_id) REFERENCES students(id),
  FOREIGN KEY (subject_id) REFERENCES subjects(id),
  FOREIGN KEY (learning_goal_id) REFERENCES learning_goals(id)
);
```

### 3.5 messages

会话消息。

```sql
CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  content_format TEXT NOT NULL DEFAULT 'markdown',
  token_count INTEGER,
  knowledge_refs_json TEXT NOT NULL DEFAULT '[]',
  tool_refs_json TEXT NOT NULL DEFAULT '[]',
  guardrail_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id)
);
```

`role`：

- `student`
- `tutor`
- `system`
- `tool`

### 3.6 student_cognitive_profiles

长期结构化用户画像。用于保存学习目标、解释偏好、常见误区、有效策略和情绪/参与信号。画像必须是“可修正的教学假设”，不能被当成永久标签。

```sql
CREATE TABLE student_cognitive_profiles (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL,
  subject_id TEXT,
  learning_goals_json TEXT NOT NULL DEFAULT '[]',
  explanation_preferences_json TEXT NOT NULL DEFAULT '[]',
  recurring_misconceptions_json TEXT NOT NULL DEFAULT '[]',
  effective_strategies_json TEXT NOT NULL DEFAULT '[]',
  affective_signals_json TEXT NOT NULL DEFAULT '[]',
  confidence REAL NOT NULL DEFAULT 0.0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  FOREIGN KEY (student_id) REFERENCES students(id),
  FOREIGN KEY (subject_id) REFERENCES subjects(id),
  UNIQUE (student_id, subject_id)
);
```

### 3.7 long_term_memories

长期记忆摘要。只保存脱敏摘要、证据摘要和置信度，不保存完整 prompt、完整对话或工具原始输出。后续可进入 `student_memory_embedding` 向量索引。

```sql
CREATE TABLE long_term_memories (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL,
  subject_id TEXT,
  memory_kind TEXT NOT NULL,
  summary TEXT NOT NULL,
  evidence TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0.0,
  source TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  FOREIGN KEY (student_id) REFERENCES students(id),
  FOREIGN KEY (subject_id) REFERENCES subjects(id)
);
```

索引：

```sql
CREATE INDEX idx_long_term_memories_student ON long_term_memories(student_id, subject_id, memory_kind);
```

### 3.8 short_term_memories

短期记忆快照。用于当前会话的主题、待跟进问题、近期误区和轮次数，服务上下文连续性。它可以被频繁覆盖，不应长期无限增长。

```sql
CREATE TABLE short_term_memories (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  subject_id TEXT,
  summary TEXT NOT NULL,
  recent_focus_json TEXT NOT NULL DEFAULT '[]',
  open_questions_json TEXT NOT NULL DEFAULT '[]',
  last_misconceptions_json TEXT NOT NULL DEFAULT '[]',
  last_mode TEXT,
  turn_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id),
  FOREIGN KEY (student_id) REFERENCES students(id),
  FOREIGN KEY (subject_id) REFERENCES subjects(id),
  UNIQUE (conversation_id)
);
```

### 3.9 knowledge_nodes

知识节点。

```sql
CREATE TABLE knowledge_nodes (
  id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL,
  title TEXT NOT NULL,
  slug TEXT NOT NULL,
  summary TEXT NOT NULL,
  level TEXT NOT NULL,
  difficulty INTEGER NOT NULL DEFAULT 1,  -- 范围 1-3，入库时 .clamp(1, 3)
  prerequisites_json TEXT NOT NULL DEFAULT '[]',
  misconceptions_json TEXT NOT NULL DEFAULT '[]',
  socratic_hints_json TEXT NOT NULL DEFAULT '[]',
  source_id TEXT,
  license_snapshot TEXT,
  review_status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (subject_id) REFERENCES subjects(id),
  FOREIGN KEY (source_id) REFERENCES content_sources(id)
);
```

索引：

```sql
CREATE INDEX idx_knowledge_nodes_subject ON knowledge_nodes(subject_id);
CREATE INDEX idx_knowledge_nodes_slug ON knowledge_nodes(slug);
```

### 3.10 knowledge_edges

知识图谱边。

```sql
CREATE TABLE knowledge_edges (
  id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL,
  from_node_id TEXT NOT NULL,
  to_node_id TEXT NOT NULL,
  relation_type TEXT NOT NULL,
  weight REAL NOT NULL DEFAULT 1.0,
  created_at TEXT NOT NULL,
  FOREIGN KEY (subject_id) REFERENCES subjects(id),
  FOREIGN KEY (from_node_id) REFERENCES knowledge_nodes(id),
  FOREIGN KEY (to_node_id) REFERENCES knowledge_nodes(id)
);
```

`relation_type`：

- `prerequisite`
- `related`
- `part_of`
- `common_confusion`

### 3.11 questions

题库。

```sql
CREATE TABLE questions (
  id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL,
  title TEXT,
  content TEXT NOT NULL,
  question_type TEXT NOT NULL,
  difficulty INTEGER NOT NULL DEFAULT 1,  -- 范围 1-3
  answer TEXT,
  solution_steps_json TEXT NOT NULL DEFAULT '[]',
  hints_json TEXT NOT NULL DEFAULT '[]',
  knowledge_node_ids_json TEXT NOT NULL DEFAULT '[]',
  source_id TEXT,
  license_snapshot TEXT,
  review_status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (subject_id) REFERENCES subjects(id),
  FOREIGN KEY (source_id) REFERENCES content_sources(id)
);
```

### 3.12 student_knowledge

学生知识掌握状态。

```sql
CREATE TABLE student_knowledge (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL,
  knowledge_node_id TEXT NOT NULL,
  mastery_probability REAL NOT NULL DEFAULT 0.0,
  attempts_count INTEGER NOT NULL DEFAULT 0,
  correct_count INTEGER NOT NULL DEFAULT 0,
  last_practiced_at TEXT,
  last_evidence_message_id TEXT,
  evidence_summary TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (student_id) REFERENCES students(id),
  FOREIGN KEY (knowledge_node_id) REFERENCES knowledge_nodes(id),
  FOREIGN KEY (last_evidence_message_id) REFERENCES messages(id),
  UNIQUE (student_id, knowledge_node_id)
);
```

**冷启动说明**：BKT 算法使用 mastery_probability=0.5 作为冷启动默认先验值，用于推荐系统避免将新用户判为极度薄弱。此值不代表学生真实掌握程度。UI 层必须区分：
- `attempts_count === 0`：冷启动记录，显示"未开始/待学习"，不显示百分比
- `attempts_count < 3`：数据不足，显示"初始评估"
- `attempts_count >= 3`：真实学习记录，正常显示百分比

### 3.13 reflection_records

反思记录。

```sql
CREATE TABLE reflection_records (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  summary TEXT NOT NULL,
  knowledge_updates_json TEXT NOT NULL DEFAULT '[]',
  misconceptions_json TEXT NOT NULL DEFAULT '[]',
  strategy_insights_json TEXT NOT NULL DEFAULT '[]',
  next_best_action_json TEXT NOT NULL DEFAULT '{}',
  confidence REAL NOT NULL DEFAULT 0.0,
  created_at TEXT NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id),
  FOREIGN KEY (student_id) REFERENCES students(id)
);
```

### 3.14 assessment_results

对话式评估结果。

```sql
CREATE TABLE assessment_results (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  learning_goal_id TEXT,
  conversation_id TEXT,
  assessment_type TEXT NOT NULL,
  overall_level TEXT NOT NULL,
  strengths_json TEXT NOT NULL DEFAULT '[]',
  weaknesses_json TEXT NOT NULL DEFAULT '[]',
  recommendations_json TEXT NOT NULL DEFAULT '[]',
  evidence_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY (student_id) REFERENCES students(id),
  FOREIGN KEY (subject_id) REFERENCES subjects(id),
  FOREIGN KEY (learning_goal_id) REFERENCES learning_goals(id),
  FOREIGN KEY (conversation_id) REFERENCES conversations(id)
);
```

### 3.15 content_sources

内容来源和许可证。

```sql
CREATE TABLE content_sources (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  url TEXT,
  source_type TEXT NOT NULL,
  license TEXT NOT NULL,
  attribution_required INTEGER NOT NULL DEFAULT 0,
  commercial_use_allowed INTEGER NOT NULL DEFAULT 0,
  derivative_allowed INTEGER NOT NULL DEFAULT 0,
  share_alike_required INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

### 3.16 provider_configs

LLM Provider 配置。API Key 不应明文存储在该表；只存 keychain 引用。

```sql
CREATE TABLE provider_configs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  provider_type TEXT NOT NULL,
  base_url TEXT NOT NULL,
  model TEXT NOT NULL,
  api_key_ref TEXT,
  is_default INTEGER NOT NULL DEFAULT 0,
  is_local INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

当前 Phase 0 已落地 Provider 配置 repository：

- Rust command：`save_provider_config`
- Rust command：`load_default_provider_config`
- Rust command：`save_provider_api_key`
- Rust command：`delete_provider_api_key`
- Rust command：`complete_llm_chat`
- 前端封装：`saveProviderConfig()`、`loadDefaultProviderConfig()`、`saveProviderApiKey()`、`deleteProviderApiKey()`
- 当前策略：不指定默认云厂商；由用户填写 `name`、`base_url`、`model` 和 API Key。SQLite 只持久化 `name`、`provider_type`、`base_url`、`model`、`is_default`、`is_local` 和 `api_key_ref`；API Key 写入系统凭据存储，不写入 SQLite、localStorage 或普通文件。
- 运行时边界：OpenAI-compatible 请求优先通过 Rust `complete_llm_chat` 发起；前端传 `apiKeyRef`、模型配置和 messages，Rust 从系统凭据存储读取 API Key 并设置 Authorization header。前端全局 store 不保存明文 API Key。
- 验证：Rust 单元测试覆盖默认 Provider 保存/读取、合法 keychain 引用写入、疑似明文 API Key 拒绝，以及 LLM command 的 keychain 引用和 role 校验。

### 3.17 private_documents

用户确认导入的私有资料文档。标记为 `private_user_import` / `draft`，不混入内置 Pack。

```sql
CREATE TABLE private_documents (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL,
  subject_code TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_type TEXT NOT NULL,
  title TEXT,
  source_type TEXT NOT NULL DEFAULT 'private_user_import',
  status TEXT NOT NULL DEFAULT 'draft',
  content_hash TEXT,
  chunk_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
```

索引：

```sql
CREATE INDEX idx_private_docs_student_subject ON private_documents(student_id, subject_code);
```

说明：

- 不保存用户原始文件路径或二进制原文件。
- 只保存解析后的文本元数据和 chunk。
- `source_type` 固定为 `private_user_import`。
- `status` 固定为 `draft`。
- 删除为彻底删除（DELETE chunks + DELETE document，同一事务），`deleted_at` 列保留为 schema 兼容字段但代码不使用。

### 3.18 private_document_chunks

私有文档的文本 chunk，用于后续私有 RAG 检索。

```sql
CREATE TABLE private_document_chunks (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  heading TEXT,
  text TEXT NOT NULL,
  token_estimate INTEGER,
  created_at TEXT NOT NULL,
  FOREIGN KEY(document_id) REFERENCES private_documents(id)
);
```

索引：

```sql
CREATE INDEX idx_private_doc_chunks_doc ON private_document_chunks(document_id);
```

说明：

- 每 chunk 约 1500 字符，按页面切分。
- `heading` 取原页面/工作表名称。
- `token_estimate` 粗估（中文约 1.5 char/token，英文约 4 char/token，取折中 2）。
- 不存储 embedding（后续私有 RAG 阶段再加）。

### 3.19 conversation_private_documents

会话级私有资料绑定。每个会话最多绑定 0 或 1 个私有资料。

```sql
CREATE TABLE conversation_private_documents (
  conversation_id TEXT NOT NULL,
  private_document_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (conversation_id),
  FOREIGN KEY (conversation_id) REFERENCES conversations(id),
  FOREIGN KEY (private_document_id) REFERENCES private_documents(id)
);
```

说明：

- `conversation_id` 为主键，保证每个会话最多绑定 1 份资料。
- 删除 private_document 时，Rust 代码在同一事务内清理所有指向该 document 的绑定。
- 切换会话、重启应用后，前端从该表恢复 `recentPrivateDocument`。

## 4. 向量表预留

如果启用 SQLite-vec：

```sql
-- 具体语法按 sqlite-vec 版本调整。
-- MVP 可以先不创建真实 vector table。
```

逻辑向量对象：

- `knowledge_node_embedding`
- `question_embedding`
- `student_memory_embedding`
- `reflection_summary_embedding`

`student_cognitive_profiles` 已作为结构化表进入模型。当前 Phase 0 代码已优先读写 SQLite，并保留 `localStorage` 作为浏览器预览或 IPC 失败时的降级镜像；后续如需语义召回，可为画像摘要和长期记忆摘要建立 embedding 索引。

### 4.1 向量库选型边界

默认路线：

1. Phase 0：JSON seed + keyword/hybrid mock，先跑通 RAG 注入链路。
2. Phase 1：SQLite-vec，本地优先、部署简单、与 SQLite 数据模型一致。
3. Phase 2+：如果知识库规模、多模态文件或跨项目检索需求明显增加，再评估 LanceDB。

SQLite-vec 适合：

- 桌面本地应用。
- 单用户知识库。
- 知识节点、题目、学生记忆和反思摘要的本地向量召回。
- 与 SQLite migration、删除、导出、备份保持一致。

LanceDB 适合：

- 大规模知识库。
- 多模态向量，如图片、PDF chunk、音视频转写片段。
- 后续需要独立知识库服务或跨设备知识资产管理。

MVP 不建议一开始上 LanceDB，原因是会增加打包、迁移、备份和隐私治理复杂度。

### 4.2 什么进入向量库

允许向量化：

- `knowledge_nodes.summary`
- 经过审核的知识 chunk。
- 题目 stem、考点标签、原创解析摘要。
- `reflection_records.summary` 和经过脱敏的误区摘要。
- `student_cognitive_profiles` 后续的结构化摘要字段。

不应向量化：

- 完整系统 prompt。
- 完整 Prompt Builder 输出。
- API Key、Provider 配置、内部工具原始结果。
- 未脱敏的完整学生对话。
- Guardrail 未通过的模型草稿。

Prompt 应通过版本化、缓存键和 provider prefix cache 管理，不把完整 prompt 写入向量库。向量库用于“语义召回”，不是 prompt 日志仓库。

## 5. Seed 数据

MVP seed 最少包括：

- `subjects`：数学。
- `knowledge_nodes`：至少 30 个极限与连续节点。
- `knowledge_edges`：前置关系。
- `content_sources`：每个知识来源。
- `questions`：至少 10 道原创或明确授权题。

## 6. 数据访问边界

- UI 组件不直接访问 SQLite。
- 前端通过 `src/services/student/`、`src/services/knowledge/`、`src/services/tools/` 调用数据能力。
- Rust 后端负责实际数据库连接、migration、keychain。
- Agent 只读取 repository/service 返回的结构化对象。

## 7. 隐私与删除

必须支持后续实现：

- 删除学生档案。
- 删除会话。
- 清空所有本地学习数据。
- 导出会话和学习记录。
- 清除 Provider 配置和 keychain 引用。

MVP 可先实现内部 service 方法，不一定暴露完整 UI。

## 8. 迁移策略

建议：

```text
src-tauri/migrations/
├── 0001_initial.sql
├── 0002_seed_subjects.sql
└── 0003_seed_math_limits.sql
```

每个 migration 必须可重复验证。不要依赖手工数据库编辑。

当前 Phase 0 已落地最小运行时迁移：

- Rust command：`init_database`
- 前端封装：`src/services/tauri/commands.ts` 的 `initializeDatabase()`
- 数据库位置：Tauri app data directory 下的 `teacher_agent.sqlite3`
- 迁移记录表：`schema_migrations`
- 当前迁移：`0001_initial`
- 验证：Rust 单元测试覆盖首次迁移和重复执行幂等性。

当前 Phase 0 已落地最小会话/消息 repository：

- Rust command：`ensure_default_conversation`
- Rust command：`list_conversations`
- Rust command：`create_conversation`
- Rust command：`update_conversation_title`
- Rust command：`save_message`
- Rust command：`list_messages`
- 前端封装：`ensureDefaultConversation()`、`listConversations()`、`createConversation()`、`updateConversationTitle()`、`saveMessage()`、`listMessages()`
- 当前策略：按学科创建本地默认会话，前端对话页提供历史侧栏、新建会话、切换会话和标题编辑；发送消息时保存学生消息和导师回复，并刷新会话更新时间。
- 验证：Rust 单元测试覆盖默认会话创建、会话列表、新建会话、标题更新、消息保存和按顺序读取。

当前 Phase 0 已落地学习记忆 repository：

- Rust command：`load_learning_memory_context`
- Rust command：`save_learning_memory_state`
- 前端封装：`loadLearningMemoryContext()`、`saveLearningMemoryState()`
- 存储表：`student_cognitive_profiles`、`short_term_memories`、`long_term_memories`
- 当前策略：`LearningMemoryService` 优先读写 SQLite；浏览器预览、Tauri IPC 不可用或写入失败时回退到 `localStorage`。
- 验证：Rust 单元测试覆盖用户画像、短期记忆、长期记忆的写入和读取。

当前 Phase 0 已落地反思记录写入：

- Rust command：`save_reflection_record`
- 前端封装：`saveReflectionRecord()`
- 存储表：`reflection_records`
- 当前策略：规则版 `ReflectionAgent v1` 生成结构化反思，保存摘要、知识更新、误区、策略洞察和下一步建议。
- 验证：Rust 单元测试覆盖反思记录写入和读取。

当前 Phase 0 已落地评估结果写入：

- Rust command：`save_assessment_result`
- 前端封装：`saveAssessmentResult()`
- 存储表：`assessment_results`
- 当前策略：规则版 `AssessmentAgent v1` 在 Guardrail 后基于学生可见回复生成 `turn_assessment`，保存正确性、置信度、知识点掌握度 delta、误区和下一步建议。
- 掌握度更新：`save_assessment_result` 会从 `evidence_json` 读取本轮 `knowledgeSnapshots` 和 `knowledgeUpdates`，先同步最小 `knowledge_nodes` 快照，再更新 `student_knowledge.mastery_probability`、`attempts_count`、`correct_count`、`last_practiced_at` 和 `evidence_summary`。
- 限制：当前掌握度模型是规则版增量累加，后续可升级为 Bayesian Knowledge Tracing、IRT 或间隔复习权重模型。
- 验证：Rust 单元测试覆盖评估结果写入、知识节点快照写入和学生掌握度更新。

## 8.5 AlertTime 同步读模型（2026-08-03 可选扩展）

本阶段新增的同步表全部位于 TeacherAgent 本地 SQLite（migration `0008_sync_tables`），是 AlertTime 上报数据的**设备读模型**（read model），不是权威源。数据所有权见 `docs/decisions/2026-08-03-alerttime-lan-sync.md` 与 `sync/protocol/protocol.md`。

### 8.5.1 sync_devices

已配对设备与设备凭据（只存凭据哈希，不存明文）。

```sql
CREATE TABLE sync_devices (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  credential_hash TEXT NOT NULL,
  certificate_pin TEXT NOT NULL,
  paired_at TEXT NOT NULL,
  last_sync_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL
);
```

- `credential_hash`：SHA-256(设备凭据)，凭据由配对时生成的高熵随机串组成，明文只在配对响应中下发一次。
- `certificate_pin`：配对时上报的 SPKI SHA-256，用于设备侧核对服务端证书。
- `revoked_at` 非空即失效；鉴权时同时检查。

### 8.5.2 sync_pairing_tokens

一次性配对 token（只存哈希与过期时间，明文不落库、不进日志）。

```sql
CREATE TABLE sync_pairing_tokens (
  token_hash TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);
```

### 8.5.3 sync_snapshots

已接收快照记录，`id` 即 `snapshotId`，用于幂等重放。

```sql
CREATE TABLE sync_snapshots (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  received_at TEXT NOT NULL,
  received_at_ms INTEGER,
  status TEXT NOT NULL,
  subject_count INTEGER NOT NULL DEFAULT 0,
  goal_count INTEGER NOT NULL DEFAULT 0,
  task_count INTEGER NOT NULL DEFAULT 0,
  session_count INTEGER NOT NULL DEFAULT 0
);
```

#### AlertTime 诊断证据的数据库权威重建（无 migration）

AlertTime 同步诊断仍复用 `assessment_results.evidence_json`，不新增表或列。只有同步诊断路径才在持久化 JSON 顶层写入类型化的 `diagnosticProvenance`：`origin = alerttime_sync_diagnostic_v1`、`questionId`、`alertSubjectRemoteId` 以及可空的 `examTrackId` / `examSubjectId` / `examModuleId`。同一 JSON 内既有的 nested `evidence`（题号、`correct`、`examTrackId` / `subjectId` / `moduleId`）必须与 provenance 逐字段一致；不一致的整行丢弃。

`load_persisted_sync_diagnostic_assessments(ids)` 是新的 typed Tauri 读取边界。`ids` 仅是 localStorage 候选线索；Rust 以参数化查询从 `assessment_results JOIN subjects` 读取，`teacherSubjectId` 只取数据库 `subjects.code`，正确性只取持久化 `correctness`，`createdAt` 只取数据库行。普通 `practice-*`、损坏 JSON、缺题号/正确性、非法 provenance、超限或重复 ID 不得进入结果；错误不得回显 evidence 内容。返回记录仅包含可验证的 assessmentId、teacherSubjectId、correct、questionId、AlertTime 科目 remoteId、考试归属和 DB createdAt。

历史 `diag-*` 记录仅在 nested evidence 结构合法时兼容；缺少 `alertSubjectRemoteId` 时返回 null，前端只能在当前 `teacherSubjectId` 恰好对应一个 mapping 且历史考试 scope（若存在）与当前 mapping 精确一致时兼容。多个 mapping 或 mapping 改指其他考试叶子时拒绝复用。`persistedDiagnosticEvidence` 只使用上述 DB 记录重建题数、正确数、mapping、考试归属和 `sourceAssessmentIds`；localStorage 中的计数、时间和归属字段永远不进入 proposal。该闭环不改变表结构，也不改变普通练习保存语义。

`received_at_ms` 是可空的 epoch 毫秒：迁移前已存在但无法解析的 `received_at` 行保留 `NULL`，不得伪造时间。新导入通过接收 API 同时保存解析后的 `received_at_ms`。用于按设备读取最新快照/分析的索引为：

```sql
CREATE INDEX idx_sync_snapshots_device_received_at_ms
  ON sync_snapshots(device_id, received_at_ms DESC);
```

### 8.5.4 设备读模型：sync_subjects / sync_weekly_goals / sync_tasks / sync_study_sessions

每个设备一套镜像行，主键为 `(device_id, remote_id)`；`remote_id` 是 AlertTime 的稳定 UUID（跨设备 ID）。外键字段全部使用 remote_id（如 `subject_remote_id`、`task_remote_id`）。

```sql
CREATE TABLE sync_subjects (
  device_id TEXT NOT NULL,
  remote_id TEXT NOT NULL,
  name TEXT NOT NULL,
  is_archived INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  PRIMARY KEY (device_id, remote_id)
);

CREATE TABLE sync_weekly_goals (
  device_id TEXT NOT NULL,
  remote_id TEXT NOT NULL,
  source_proposal_id TEXT,
  week_start INTEGER NOT NULL,
  title TEXT NOT NULL,
  success_criteria TEXT,
  status INTEGER NOT NULL,
  completed_at INTEGER,
  deferred_to_week_start INTEGER,
  exception_reason TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  PRIMARY KEY (device_id, remote_id)
);

CREATE TABLE sync_tasks (
  device_id TEXT NOT NULL,
  remote_id TEXT NOT NULL,
  source_proposal_id TEXT,
  subject_remote_id TEXT,
  title TEXT NOT NULL,
  content TEXT,
  type INTEGER NOT NULL,
  priority INTEGER NOT NULL,
  status INTEGER NOT NULL,
  target_duration_seconds INTEGER,
  due_at INTEGER,
  completed_at INTEGER,
  sort_order INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  PRIMARY KEY (device_id, remote_id)
);

CREATE TABLE sync_study_sessions (
  device_id TEXT NOT NULL,
  remote_id TEXT NOT NULL,
  subject_remote_id TEXT,
  task_remote_id TEXT,
  title TEXT,
  start_time INTEGER NOT NULL,
  end_time INTEGER,
  duration_seconds INTEGER NOT NULL,
  pause_seconds INTEGER NOT NULL,
  focus_score INTEGER,
  note TEXT,
  status INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  PRIMARY KEY (device_id, remote_id)
);
```

字段语义与 AlertTime `docs/DATABASE.md` 一致：任务 `status` 0 未完成 / 1 已完成；周目标 `status` 0 待完成 / 1 已完成 / 2 已延期 / 3 已取消；会话 `status` 0 已完成 / 1 进行中 / 2 已取消 / 3 异常结束。进行中的会话只展示，不计入已完成统计。

### 8.5.5 subject_mappings

用户显式确认的学科映射：AlertTime 科目 remote_id → TeacherAgent 学科 id（内置学科 code 或 `custom-*` 自建学科）。无映射的科目只参与执行分析，不参与掌握度更新。

```sql
CREATE TABLE subject_mappings (
  device_id TEXT NOT NULL,
  alert_subject_remote_id TEXT NOT NULL,
  teacher_subject_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (device_id, alert_subject_remote_id)
);
```

### 8.5.6 sync_proposals

TeacherAgent 生成的计划建议稿（proposal）。只由 TeacherAgent 创建与更新状态；手机端通过 `POST /v1/proposal-decisions` 上报采纳/拒绝。

```sql
CREATE TABLE sync_proposals (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'pending',
  rationale TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  source_assessment_ids_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  expires_at INTEGER,
  decided_at INTEGER
);
```

`status`：`pending`、`accepted`、`rejected`、`superseded`。生成新 proposal 时，同一设备此前 pending 的 proposal 标记为 `superseded`。时间字段与协议一致使用 epoch 毫秒（本表是同步协议存储的例外，与第 2 节「ISO 8601 字符串」的通用约定不同，因为协议 fixture 使用 epoch 毫秒）。

### 8.5.7 sync_proposal_decisions

决策幂等表：`proposal_id` 为主键，同一决策重复上报幂等；已接受后不可改为拒绝（400 拒绝）。

```sql
CREATE TABLE sync_proposal_decisions (
  proposal_id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  decision TEXT NOT NULL,
  decided_at INTEGER NOT NULL,
  FOREIGN KEY (proposal_id) REFERENCES sync_proposals(id)
);
```

`decided_at` 为 epoch 毫秒（与协议一致）。

### 8.5.8 同步事务边界

- 快照导入：验证通过后在**单个 SQLite 事务**内完成「删除该设备旧读模型 + 插入新读模型 + 写入 sync_snapshots」，任一步失败整体回滚；`snapshotId` 已存在时直接幂等 ack，不重复导入。
- proposal 决策：`sync_proposal_decisions` 与 `sync_proposals.status` 更新在同一事务。
- 设备状态读取：`sync_get_device_state` 在同一连接、同一个 SQLite 读事务内原子读取设备 `readModel` 与 `lastSnapshot`，两者来自同一数据库视图，不允许 store 并行调用两个独立 IPC 再自行拼接。旧的分开读取命令仅为兼容保留。
- 掌握度更新仍走既有 `assessment_results` / `student_knowledge` 链路（见 3.12/3.14），同步读模型不直接写掌握度。

### 8.5.9 最新快照与分析排序、迁移 0012

迁移 `0012_sync_snapshot_received_at_ms` 为 `sync_snapshots` 增加可空的 `received_at_ms INTEGER`，并为 `(device_id, received_at_ms DESC)` 创建索引。迁移会把可解析的 `received_at` 回填为 epoch 毫秒；旧的不可解析行保留 `NULL`。新的快照导入由接收 API 保存 `received_at_ms`，不能将该列声明为 `NOT NULL`。

按设备选择最新快照或其分析时，排序语义固定为：

```text
received_at_ms DESC,
received_at DESC,
rowid DESC,
id DESC
```

其中 `rowid DESC` 表示在相同毫秒和相同文本时间下，选择后插入的行；因此即使两行的毫秒和文本时间完全相同，也不会由 UUID 字典序决定先后。最新快照与最新分析都必须使用这套排序，不能在没有分析的最新快照时回退展示旧分析。

### 8.5.10 Proposal 采纳来源与执行反馈、迁移 0013

迁移 `0013_sync_proposal_source_ids` 为 `sync_weekly_goals` 与 `sync_tasks` 增加可空的
`source_proposal_id TEXT`。该字段由 AlertTime 在用户明确采纳 proposal 并实际创建本地周目标/计划时生成，
随完整快照上传；TeacherAgent 必须在快照事务中原样保存，并在 read model 中以
`sourceProposalId` 返回。旧客户端不发送时保持 `NULL`。

该字段只是来源声明，不是 `sync_proposals` 的外键。TeacherAgent 导入快照时不得因为本地缺少同名 proposal
而拒绝原始学习数据；只有在生成执行反馈时，才把它与同设备、状态为 `accepted` 的 proposal 交叉核验。
任务还必须为 `type = 1`，且标题、科目、目标时长、截止时间与 proposal 条目精确一致；周目标的周起点、标题、
成功标准也必须精确一致。字段漂移、跨 proposal、重复实体、软删除或缺少来源都必须保守展示，不能抬高完成率。

`source_proposal_id` 本身不能证明完成。完成状态仍只来自同步实体的真实 `status`；`status = 0` 为待完成，
`status = 1` 为完成，其他终态、软删除和无法匹配项分别统计。下一轮计划建议只能引用最近一次仍可由上述规则
证明的采纳执行结果，并避免重复建议仍在待完成的同源任务或周目标。

### 8.6 考试体系（ExamTaxonomy）扩展（2026-08-07，迁移 0009）

权威说明：`docs/exam-taxonomy.md`；目录数据：`data/exam-taxonomy/catalog.json`（EXAM_TRACK → SUBJECT → MODULE，含 stableId/别名/状态/questionScope/来源许可）。

- `sync_subjects` 新增可选列（手机端声明，仅展示与映射建议，不是权威映射）：
  - `exam_track_id TEXT`、`exam_subject_id TEXT`、`exam_module_id TEXT`。
- `subject_mappings` 新增可选列（用户映射可指向考试体系叶子；`exam_subject_id` 优先，旧 `teacher_subject_id` 保留兼容）：
  - `exam_track_id TEXT`、`exam_subject_id TEXT`、`exam_module_id TEXT`。
- 旧数据兼容：旧快照（无 exam 字段）解析为 NULL；旧映射值（如 `cs408`）保留并在解析时提示选择子科目；不删除、清空、迁移重建任何既有数据。
- 题目归属：题目 seed 不加字段，由 Registry 按 pack → 叶子推导（examTrackId/subjectId/moduleId），检索链 = approved 过滤 → 叶子范围过滤 → 结构化校验（fail-closed）。

### 8.7 窗口状态与 AI 使用时间（2026-08-07）

- 窗口状态：`core/window/WindowState.kt`（WindowMode 六分类 + WindowStateHolder 进程级单例）；MainActivity 窗口回调写入；ON_STOP 按分类处理（画中画/分屏不暂停、锁屏暂停不记分心、真后台暂停记分心）。
- AI 使用时间事件（`status_codes`）：`EVENT_AI_HELP = 8`（开始，兼容旧数据语义）+ `EVENT_AI_HELP_ENDED = 9`（显式结束）；重复开始/结束幂等；未正常结束按最后事件时间安全截断。
- `study_sessions.ai_help_seconds`（Room v5，迁移 4→5）：完成会话时写回；备份协议接受 v4 备份（ai_help_seconds 默认 0）。
- `sync_study_sessions`（迁移 0010）新增可选列：`ai_help_seconds / ai_help_count / external_ai_app_seconds / ai_usage_source`；`ai_usage_source ∈ {alerttime_ai_help, usage_stats, unknown}`；外部 AI App 时长仅 UsageStats 授权后统计，未授权为 NULL（unknown），不得写成 0。
- 掌握度边界不变：AI 求助时间、外部 AI 时间、暂停时间与有效专注时间分别统计，不混算。

### 8.8 手机本地学习分析与稍后同步（2026-08-10）

`learningAnalysis` 是 AlertTime 可独立生成并在稍后同步时携带的派生分析数据，结构与安全边界由 `docs/decisions/2026-08-09-alerttime-android-plan-assessment.md` 定义。旧客户端快照可不含该字段；新客户端每次同步必须生成 profile、planEvaluation 和 assessmentDraft，LLM 失败时写入 `deterministic_fallback` 结果。手机独立生成不依赖 Teacher 配对或桌面在线。

- profile 严格分为 facts 与 inferences：事实和推断均带 evidenceRefs，推断另带 0..1 confidence。学习时长只可成为投入证据，不能写入或推导 `student_knowledge.mastery_probability`。
- assessmentDraft.status 固定为 draft，题目无 answer/solution 字段；该数据不得写入 `questions` 的 approved 内容、`assessment_results` 或 `student_knowledge`。正式掌握度仍只由 approved 题库真实答题链路更新。
- TeacherAgent 将分析视为 untrusted sync-side data；接收和展示前必须要求 `sourceSnapshotId` 等于信封 `snapshotId`，并校验枚举、分数、置信度与长度边界。
- 数据所有权仍不变：AlertTime 拥有执行快照及其同步侧分析；TeacherAgent 仅保存/读取收到的快照分析并只读展示，不把它升级为正式评估证据。
- Android 不内置 Provider 地址、模型或公共 Key；用户在手机设置中自行填写，API Key 由 Keystore 保护且不进入同步数据。用户声明的学习目的、考试/项目、考试科目和目标日期默认留空，只在主动生成/同步时进入最小 Prompt，并作为本地事实保留。
- Android 最近分析以 `learning_analysis_runtime_*` AppSetting 派生缓存持久化，可由原始业务数据重新生成，故不进入备份 JSON；用户填写的 `learner_context_*` 属于普通设置，可随明文备份迁移。每次同步生成新分析并在首个桌面网络请求前写入缓存。
- 当前仍是手动私有局域网同步；云端数据库、账号、后台上传、云画像和完整历史上传均不在范围内。

## 9. 与其他文档的关系

- MVP 范围：`docs/mvp-spec.md`
- 知识库来源和许可证：`docs/knowledge-base-governance.md`
- 工具接口：`docs/tool-interface.md`
- Agent 数据结构：`docs/agent-architecture.md`
