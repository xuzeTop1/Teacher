# TeacherAgent 项目治理文档

版本：v1.0  
状态：项目内开发基线  
最后更新：2026-06-30  
适用对象：Codex、Claude Code、项目维护者

## 0. 文档权威边界

为避免文档之间重复维护导致不一致，TeacherAgent 文档按以下优先级分工：

- `docs/project-governance.md`：开发治理、架构边界、技术栈、质量标准、隐私原则的权威来源。
- `docs/design.md`：产品愿景、用户场景、交互流程、功能说明和学习机制说明。
- `docs/prompt-governance.md`：Prompt、护栏、学科风格、反思和 RAG 注入的权威来源。
- `docs/agent-architecture.md`：Agent 职责、调用链和 Agent 数据结构的权威来源。
- `docs/tool-interface.md`：工具输入输出 schema、工具隐私规则和工具错误处理的权威来源。
- `docs/mvp-spec.md`：MVP 范围、交互流程、验收标准和非目标的权威来源。
- `docs/data-model.md`：SQLite 表结构、实体关系、迁移和数据访问边界的权威来源。
- `docs/knowledge-base-governance.md`：知识库来源、版权许可、入库流程和审核状态的权威来源。
- `docs/cache-strategy.md`：缓存键、Provider prompt cache、缓存指标和 Prompt Layer 顺序的权威来源。
- `docs/rust-module-map.md`：Rust 后端模块边界、拆分顺序和验证状态的维护说明。
- `docs/verification-checklist.md`：Phase 0 / MVP 自动验证、手工验证、Provider 安全和教学链路验收的操作清单。
- `docs/phase0-execution-plan.md`：Phase 0 当前批次执行顺序、暂停项和进入下一批开发的门槛。
- `docs/project-status.md`：当前阶段、已完成工作、下一步任务和阶段验收的状态记录。
- `docs/open-decisions.md`：未决问题和产品/架构选择的集中决策池。

当文档内容冲突时，优先使用对应领域的专项文档；`docs/design.md` 中的技术栈、目录结构、MVP 范围和数据模型只作为产品设计背景，不作为实现契约。

## 1. 项目定位

TeacherAgent 是一款面向大学生、考研备考者和资格证考试学习者的桌面 AI 辅导助手。核心理念是“引导而非告知”：通过苏格拉底式对话帮助学习者自主发现答案，同时结合结构化知识库、学习画像和本地数据闭环，提供长期个性化辅导。

项目优先服务以下场景：

- 大学课程辅导：高等数学、线性代数、概率论、专业课等。
- 考研备考：数学、英语、政治、专业课等目标导向学习。
- 资格证考试：CPA、法考、教师资格证等结构化备考。
- 自主学习：需要持续反馈、路径规划和薄弱点追踪的学习者。

核心价值主张：让每个学习者都拥有一个耐心、专业、了解自己的 AI 老师。

## 2. 治理原则

### 2.1 教学原则

- 引导优先：默认通过追问、分解、类比、反例和反思引导学生思考。
- 不直接代答：除非进入明确的讲解、复盘或多次求助后的渐进妥协阶段，否则避免直接给出最终答案。
- 以理解为目标：输出不仅追求正确答案，更要帮助学生形成可迁移的思维方法。
- 难度适配：根据学生掌握度、信心和错误模式调整提示粒度。
- 复盘闭环：每次对话都应能沉淀为知识状态、认知画像或教学策略经验。

### 2.2 产品原则

- 桌面优先：当前阶段只做桌面应用，不扩展 Web 端和移动端。
- 本地优先：学生数据、对话历史、学习画像默认只存储在本地。
- 云端增强：云端 LLM 是能力增强选项，不应成为产品可用性的唯一前提。
- 核心体验先行：先把“对话式辅导”做顺，再扩展练习、路径、仪表盘和多学科。
- 面向长期使用：所有功能都应服务于越用越懂学生的长期学习闭环。

### 2.3 工程原则

- 文档权威边界优先：产品叙事以 `docs/design.md` 为准，开发治理和实现边界以本文件及专项契约为准。
- 层边界清晰：表现层、教学引擎层、AI 服务层、数据层、基础设施层不得随意互相穿透。
- 接口先于实现：跨层调用通过明确 service、command、provider 或 repository 接口完成。
- 简单可验证：MVP 阶段优先可运行、可测试、可迭代的实现，避免过早平台化。
- 隐私不倒退：任何新能力不得默默扩大数据上传范围。

## 3. 项目范围

### 3.1 当前范围内

- Tauri 2.x + Vue 3 + TypeScript 桌面应用。
- 苏格拉底式对话辅导体验。
- OpenAI 兼容 LLM Provider 适配层。
- Ollama 本地推理 sidecar 集成预留。
- RAG 检索与结构化知识库。
- SQLite 本地存储。
- SQLite-vec 向量检索。
- 符合 `docs/knowledge-base-governance.md` 的结构化知识库和题库 seed。
- 学生知识状态追踪。
- 学习画像与反思记录。
- 练习模块与多级提示脚手架。
- 学习仪表盘与学习路径规划。
- KaTeX 公式渲染和 Shiki 代码高亮。

### 3.3 可选扩展：AlertTime 单手机局域网同步（2026-08-03 用户授权范围）

用户明确授权本分支实现以下可选项（详见 `docs/decisions/2026-08-03-alerttime-lan-sync.md`）：

- 一个 TeacherAgent + 一个 Android 端 AlertTime，用户主动配对。
- 家庭 WiFi 或手机热点下的本地局域网 HTTPS 同步，手动「立即同步」触发。
- AlertTime 上报执行数据（科目、周目标、任务、学习会话、有效学习时长）；TeacherAgent 下发计划建议稿（proposal）。用户在手机明确采纳后才创建真实业务数据，并在后续快照用可选 `sourceProposalId` 回传来源；TeacherAgent 只有在同设备 accepted proposal、时间链、精确字段与 `type=1` 均成立时才生成执行反馈。来源字段本身不证明完成，不得成为导入快照的外键准入条件。
- 同步服务默认关闭；不引入账号体系、公网云服务、多手机、多教师、后台定时同步或通用 CRDT。
- 学校、公司和公共 WiFi 可能存在 AP isolation、VLAN 或防火墙限制；局域网同步不得宣传为任意网络下均可使用，UI 与文档必须说明该限制。
- 本扩展不得改变「桌面优先、本地优先、云端增强、隐私不倒退」的产品原则；后续如需公网 HTTPS 服务，必须复用本协议并单独走决策流程。

#### 3.3.1 Android 可选 LLM 学习分析（2026-08-09 窄范围授权）

用户本次明确授权以 `docs/decisions/2026-08-09-alerttime-android-plan-assessment.md` 覆盖原“手机端不做 LLM”的单一非目标，但仅限 AlertTime 手机端独立生成、保存并在稍后同步时携带 `learningAnalysis`，不扩展为移动端 TeacherAgent、账号体系、云数据库、云同步或远程学生画像：

- 应用不内置默认 Provider、默认模型或开发者公共 Key；只有用户在 Android 独立设置入口自行填写并启用后才调用。API Key 必须由 Keystore 保护，UI、普通配置和同步快照不得保存或回传明文 Key。
- 用户可填写学习目的、考试/项目名称、考试或重点科目和目标日期；字段默认留空，只在主动生成或同步时进入版本化 Prompt。云端请求只发送这些用户声明与生成本次分析所需的最小快照上下文；Android UI 不直接访问网络或 DAO。
- 手机独立生成不得依赖 Teacher 配对或桌面在线，结果先保存为本机派生缓存。每次新客户端同步仍必须生成绑定本次 `snapshotId` 的 profile（facts + inferences）、planEvaluation 与 assessmentDraft，并在桌面网络请求前保存；Provider 未配置、请求失败或响应非法时改用 `deterministic_fallback`。
- facts 与 inferences 必须分离；推断带 confidence 与 evidenceRefs。学习时长只属于投入证据，绝不直接更新 mastery。
- LLM 自评题仅为无答案的 draft，不进入 approved 题库、`assessment_results` 或 `student_knowledge`。TeacherAgent 只读展示；正式掌握度仍只由 approved 题库真实答题链路产生。
- TeacherAgent 将分析视为 untrusted sync-side data，必须校验结构并要求 `sourceSnapshotId` 绑定当前信封 `snapshotId`；Teacher UI 不直接访问数据库或 Provider。
- 本阶段继续使用手动私有局域网同步；云端数据库、公网跨网络同步和后台上传需后续单独决策，不得因手机独立分析而顺带引入。

### 3.4 当前范围外（沿用，扩展不改变以下边界）

- Web 端或移动端产品。
- 云端账号体系和多端同步。
- 多用户协同课堂功能。
- 自动向学校或第三方平台上报成绩。
- 视频课程生成。
- 未经用户明确授权的云端学生画像存储。

范围外内容可以记录为 backlog，但不得挤占 MVP 核心对话体验。

## 4. 架构治理

系统采用五层架构，详见 `docs/design.md` 和 `docs/architecture-diagram.html`。

| 层级 | 名称 | 职责 | 典型模块 |
| --- | --- | --- | --- |
| L1 | 表现层 | 用户界面、交互、可视化 | Chat UI、Knowledge Panel、Practice、Dashboard |
| L2 | 教学引擎层 | 教学策略、路径、护栏、评估 | Socratic、Scaffolding、Path Planner、Guardrail |
| L3 | AI 服务层 | LLM 调度、RAG、学生模型、Prompt | LLM Provider、Retriever、Prompt Builder、Reflection |
| L4 | 数据层 | 知识、题库、学生档案、对话记录 | SQLite tables、JSON seed data、embeddings |
| L5 | 基础设施层 | 桌面运行时、本地数据库、模型进程 | Tauri、Rust commands、SQLite、Ollama |

### 4.1 依赖方向

- 表现层可以调用前端 store、service 或 Tauri command，不直接操作数据库。
- 教学引擎层可以调用 AI 服务层和数据访问接口，不直接依赖 UI 组件。
- AI 服务层负责统一 LLM、RAG、Prompt 和反思流程，不把 provider 细节泄漏给 UI。
- 数据层负责持久化和查询，不承载教学策略。
- 基础设施层只暴露最小必要能力，例如文件、数据库、sidecar、系统 keychain。
- AlertTime Android 学习分析遵循同样分层：Android UI 不直接网络/DAO；Teacher UI 不直接数据库/Provider；同步分析先经过协议边界校验和纯展示模型，再进入只读 UI。

### 4.2 模块边界

- `src/components/`：只放 UI 组件和小范围交互。
- `src/views/`：页面级组合，不承载复杂业务算法。
- `src/stores/`：Pinia 状态，负责状态编排，不写底层 provider 逻辑。
- `src/engine/`：教学智能和学习策略核心逻辑。
- `src/engine/agents/`：Tutor、Socratic、Guardrail、Assessment、Reflection、Planner 等 Agent 实现。
- `src/engine/prompts/`：核心导师 Prompt、护栏评审、反思、RAG 注入模板。
- `src/engine/policies/`：学科风格、提示等级、护栏策略等纯规则。
- `src/services/`：外部能力和数据访问封装，负责调用 Tauri command、LLM Provider、RAG、工具适配器。
- `src/services/tools/`：`knowledge_search`、`web_search`、`calculator`、`code_runner` 等工具实现或适配。
- `src/types/`：Agent、Tool、Learning、Data Model 的共享 TypeScript 类型。
- `src-tauri/src/`：Rust 后端，负责安全边界、数据库、sidecar 和系统能力。
- `data/`：初始知识库、题库、embedding 或 seed 数据。

Rust 后端模块边界和继续拆分顺序见 `docs/rust-module-map.md`。当 `src-tauri/src/` 下模块职责变化时，应同步更新该文档和 `docs/project-status.md`。

## 5. 技术决策

### 5.1 固定技术栈

| 类型 | 技术 | 决策 |
| --- | --- | --- |
| 桌面框架 | Tauri 2.x | 固定 |
| 前端框架 | Vue 3 + TypeScript | 固定 |
| 构建工具 | Vite | 固定 |
| 状态管理 | Pinia | 固定 |
| UI 组件 | Vuetify 3 | 固定 |
| 样式 | Vuetify 内置 + scoped CSS | Vuetify 提供组件样式，自定义样式用 scoped CSS |
| 本地数据库 | SQLite | 固定 |
| 向量检索 | SQLite-vec | 默认方案；LanceDB 作为后续大规模/多模态备选 |
| 本地模型 | Ollama sidecar | 默认本地运行时 |
| 云端模型 | OpenAI 兼容 API | 默认云端接口协议 |
| 数学渲染 | KaTeX | 固定 |
| 代码高亮 | Shiki | 固定 |

### 5.2 LLM Provider 策略

优先实现 OpenAI 兼容 Provider。用户配置模型时只需要理解以下字段：

- `baseUrl`
- `apiKey`
- `model`
- `providerName`
- `isLocal`

Ollama、DeepSeek、智谱 GLM、通义千问、Moonshot 等都应尽量走同一套 OpenAI 兼容请求和流式响应逻辑。非 OpenAI 格式服务商后续通过独立 Provider 扩展，不影响现有接口。

Rust 侧 LLM 请求必须返回可诊断但不泄露隐私的错误结构。当前错误字段包括：

- `code`：如 `auth_missing`、`auth_failed`、`network_error`、`timeout`、`rate_limited`、`model_or_endpoint_not_found`、`provider_unavailable`、`invalid_response`。
- `message`：面向开发/设置页排查的简短说明，必须脱敏。
- `status`：可选 HTTP 状态码。
- `retryable`：是否适合稍后重试。

Provider 请求日志只能记录事件名、Provider 名称、模型名、脱敏 endpoint host、HTTP 状态、错误 code 和消息数量；不得记录 API Key、Authorization header、完整请求体、对话内容、学生画像或工具原始输出。

## 6. AI 与 Prompt 治理

### 6.1 系统 Prompt 管理

- 系统 Prompt 必须版本化。
- Prompt 变更需要说明目标、风险和验证方式。
- 不允许在业务代码中散落不可追踪的大段 Prompt。
- Prompt 应尽量拆为角色、教学规则、安全规则、学生上下文、知识上下文和输出格式。

### 6.2 护栏要求

护栏引擎至少覆盖以下场景：

- 检测并拦截直接给最终答案的回复。
- 检测完整解题过程是否过早暴露。
- 识别学生连续要求“直接给答案”的情况。
- 对多次求助采用渐进妥协策略，而不是机械拒绝。
- 对有害、歧视、隐私泄露或不适合学习场景的内容进行过滤。

### 6.3 反思与画像

每次重要对话结束后，系统应尽量沉淀：

- 涉及的知识点。
- 学生回答质量。
- 可能的误解模式。
- 有效或无效的引导策略。
- 后续复习建议。
- 对学习画像的增量更新。

反思结果不能替代学生事实数据，必须区分“观测事实”和“模型推断”。

## 7. 数据与隐私治理

### 7.1 数据原则

- 学生数据默认本地存储。
- API Key 使用系统 keychain 或等价安全机制保存。
- 前端不得持久化、展示或在全局 store 中保存完整 API Key。OpenAI-compatible 请求应优先通过 Rust command 发起，由 Rust 从系统凭据存储读取 API Key。
- 云端 LLM 请求只发送完成当前任务所需的最小上下文。
- 学生画像、长期记忆、学习历史不得默认上传云端。
- AlertTime Android 可选 LLM 只发送本次学习分析所需的最小上下文；未显式启用时不得出站。其分析是可撤销、可质疑的同步侧推断，不得自动提升为掌握度、正式评估或云端长期画像。

### 7.1.1 运行时安全边界（2026-07-30）

- Python code-runner 当前没有 OS 级隔离，必须 fail-closed：Release 无条件关闭，Debug 仅允许双重显式 opt-in 的可信本地开发代码；普通学生输入不得执行。
- 文档导入只能从 Rust 系统文件选择器产生的一次性授权令牌进入解析链路。前端不得获得或回传真实绝对路径；worker 只读取 Rust 创建的 staging 副本。
- Provider base URL 必须规范化并限制为远程 HTTPS或 loopback HTTP；禁止 URL 凭据、查询参数和片段，HTTP 客户端不得跟随重定向。
- Provider API Key 在 keychain 中必须与规范化 endpoint 身份绑定；endpoint 变化、SQLite 篡改、旧版未绑定 Key 或非法 `api_key_ref` 均 fail-closed。
- Markdown 最终写入 DOM 前必须经过 DOMPurify allowlist 清洗；继续保留 `markdown-it html:false`、KaTeX `trust:false` 和 Tauri CSP。
- Release sidecar 必须校验 SHA-256；Debug 缺少 manifest 也默认拒绝，只有显式开发开关可以绕过，并必须在日志和 UI 显示不可分发警告。
- document-worker 与 code-worker 的所有子进程都必须先清空继承环境，再按运行所需恢复最小变量；不得继承 Provider Key、代理、云/SSH 凭据、数据库连接串或任意自定义秘密。
- 未真正实现的 CPU、内存、网络或文件系统隔离参数不得出现在可接受契约中；调用方请求未实现的内存限制时必须明确拒绝。
- SymPy worker 的 expression、operation、variable 必须在 Rust command 边界完成长度、枚举和受控数学语法校验，不依赖前端校验。
- worker 诊断进入前端或 LLM 上下文前必须在 Rust IPC 边界清洗 ANSI/控制字符、绝对路径及已知凭据形态，并限制长度；不得把原始 sidecar stderr 直接拼入用户可见错误。

### 7.2 数据类型

| 数据 | 存储 | 说明 |
| --- | --- | --- |
| 学生档案 | SQLite | 基础信息、偏好、目标 |
| 对话记录 | SQLite | 本地历史和上下文摘要 |
| 知识图谱 | SQLite 或 JSON seed | 知识点、前置依赖、章节 |
| 题库 | SQLite 或 JSON seed | 题目、答案、解析、难度 |
| 掌握度 | SQLite | BKT 或简化概率模型 |
| 认知画像 | SQLite + SQLite-vec | 结构化字段和向量召回 |
| 配置 | 本地配置 + keychain | 模型配置、UI 偏好 |

### 7.3 删除与导出

后续实现用户数据管理时，应支持：

- 清空全部本地学习数据。
- 导出对话和学习报告。
- 删除单个学生档案。
- 删除单个目标或课程的学习记录。
- 重置模型配置和 API Key。

## 8. 质量标准

### 8.1 MVP 验收标准

MVP 必须满足：

- 用户可以完成连续多轮对话。
- AI 默认以引导方式回复，而不是直接代答。
- 至少支持一个云端 OpenAI 兼容 Provider。
- 至少支持一个数学知识库章节的 RAG 检索。
- 对话可以保存到本地 SQLite。
- 基础学生掌握度可以记录和展示。
- UI 支持 Markdown、公式和代码块。
- 关键错误不会导致应用崩溃或数据丢失。

### 8.2 测试要求

- 教学引擎核心逻辑需要单元测试。
- LLM Provider 需要 mock 测试。
- 护栏规则需要样例集测试。
- 数据库迁移需要可重复执行。
- 关键 Tauri command 需要覆盖成功和失败路径。
- UI 重要交互需要最小端到端验证。

### 8.3 文档要求

任何明显改变以下内容的开发，都要同步更新文档：

- 技术栈。
- 架构分层。
- 数据模型。
- 知识库来源、许可或入库流程。
- Prompt 或护栏策略。
- 隐私边界。
- MVP 范围。
- 开发路线图。

## 9. 变更管理

### 9.1 变更等级

| 等级 | 示例 | 要求 |
| --- | --- | --- |
| 架构级 | 换数据库、改 Provider 架构、跨层依赖变化 | 先更新治理或设计文档，再实施 |
| 功能级 | 新增练习模块、仪表盘、学习路径 | 更新设计说明和验收标准 |
| 数据级 | 修改核心表结构、知识图谱格式 | 提供迁移策略 |
| Prompt 级 | 修改导师人格、护栏规则 | 记录变更理由和测试样例 |
| UI 级 | 页面布局、组件库、主题变化 | 保持与既有设计一致 |
| 修复级 | bug fix、安全修复 | 可先修复，事后补充必要说明 |

### 9.2 决策记录

重要技术决策建议放入：

```text
docs/decisions/
```

文件命名建议：

```text
YYYY-MM-DD-short-title.md
```

每条决策记录应包含：

- 背景。
- 决策。
- 替代方案。
- 影响。
- 后续验证。

## 10. 路线图

### Phase 0：项目初始化

目标：完成 Tauri + Vue 3 + TypeScript 基础工程。

交付：

- Vite + Vue 3 项目。
- Tauri 2.x 配置。
- Pinia、路由、基础布局。
- SQLite 连接验证。
- 最小 IPC 通信验证。

### Phase 1：MVP 对话辅导

目标：跑通可用的苏格拉底式对话体验。

交付：

- 对话界面。
- LLM Provider。
- 基础 Prompt。
- RAG 检索。
- 数学知识库 seed。
- 护栏引擎 v1。
- 对话本地保存。

### Phase 2：练习与追踪

目标：形成学习数据闭环。

交付：

- 练习模块。
- 多级提示系统。
- BKT 或简化掌握度模型。
- 学生仪表盘。
- 错题和薄弱点记录。

### Phase 3：知识图谱与路径

目标：实现目标导向学习规划。

交付：

- 知识图谱可视化。
- 学习路径规划器。
- 对话式能力评估。
- Ollama sidecar 集成。

### Phase 4：多学科与优化

目标：扩大学科覆盖，提高稳定性和体验。

交付：

- 多学科知识库。
- OCR 或图片输入。
- 性能优化。
- 自动更新。
- 本地离线体验增强。

## 11. 风险登记册

| 风险 | 等级 | 影响 | 应对 |
| --- | --- | --- | --- |
| LLM 直接给答案 | 高 | 核心教学理念失效 | Prompt + 输出检测 + 策略引擎 + 测试集 |
| 知识库质量不足 | 高 | 辅导准确性下降 | 人工审核、数据来源记录、逐章迭代 |
| 本地模型能力不足 | 中 | 离线体验不稳定 | 云端增强优先，本地作为可选能力 |
| Rust 学习成本 | 中 | 进度变慢 | Rust 只做安全边界和系统能力，教学逻辑优先 TS |
| 隐私边界模糊 | 高 | 用户信任受损 | 本地优先、最小上下文上传、明确配置 |
| UI 范围膨胀 | 中 | MVP 延迟 | 先做对话体验，再做丰富仪表盘 |
| 多学科过早扩张 | 中 | 知识质量失控 | 先完成一个学科闭环 |

## 12. 给 AI 开发助手的执行规则

Codex 和 Claude Code 在本项目中应遵守：

- 先读 `docs/project-governance.md`、`docs/design.md` 和相关专项契约。
- MVP 范围以 `docs/mvp-spec.md` 为准，避免提前扩展非目标能力。
- 数据表结构以 `docs/data-model.md` 为准，不在 UI 或 service 中临时发明核心字段。
- 知识库内容以 `docs/knowledge-base-governance.md` 为准，禁止导入版权不明、来源不明或未审核内容。
- 实现前确认当前 repo 结构，不凭空假设文件存在。
- 优先做小而完整的可运行增量。
- 不随意更换技术栈。
- 不引入云端同步、账号系统或移动端功能，除非明确要求。
- 涉及学生数据、Prompt、护栏、Provider、数据库结构时，同步更新文档。
- 涉及缓存键、Prompt 前缀结构或 Provider cached token 指标时，同步更新 `docs/cache-strategy.md`。
- 默认保护用户已有修改，不做破坏性 git 操作。
- 遇到产品定位冲突时，以本文件和 `docs/design.md` 为准。
- 遇到未决产品/架构选择时，先查 `docs/open-decisions.md`，不要把临时假设散落到多个文档。

## 13. 相关文档

- `docs/design.md`：产品设计与详细架构说明。
- `docs/architecture-diagram.html`：系统架构图。
- `docs/prompt-governance.md`：核心导师 Prompt、护栏规则、反思 Prompt、RAG 注入模板和学科风格策略。
- `docs/agent-architecture.md`：Tutor、Socratic、Guardrail、Knowledge、Assessment、Reflection、Planner、ToolAgent 的职责与调用链。
- `docs/tool-interface.md`：knowledge_search、web_search、calculator、code_runner、student_memory_search、question_bank_search 的接口规范。
- `docs/mvp-spec.md`：MVP 目标、范围、验收标准和测试要求。
- `docs/data-model.md`：本地 SQLite 表结构、实体边界和迁移规则。
- `docs/knowledge-base-governance.md`：知识库来源、许可、入库流程和审核标准。
- `docs/cache-strategy.md`：应用层缓存、Provider prompt cache、Prompt Layer 和 cached token 指标策略。
- `docs/project-status.md`：当前阶段、已完成工作、下一步任务和工作记录。
- `docs/open-decisions.md`：待确认问题和架构/产品决策池。
- `AGENTS.md`：Codex 开发指令。
- `CLAUDE.md`：Claude Code 开发指令入口。
