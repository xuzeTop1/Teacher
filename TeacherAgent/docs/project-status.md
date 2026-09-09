# TeacherAgent 项目状态记录

最后更新：2026-08-11
当前阶段：Phase 3 + approved/draft 发布级运行时隔离 + AlertTime 同步扩展 + 考试体系（ExamTaxonomy）+ Android 独立学习分析（自动验证完成，待实机）
维护对象：项目负责人、Codex、Claude Code、后续开发者

## 1. 当前结论

TeacherAgent Phase 3 核心功能已完成，approved/draft 发布级运行时隔离已完成；AlertTime 单手机局域网同步扩展（`docs/decisions/2026-08-03-alerttime-lan-sync.md`）与考试体系层级模型（`docs/exam-taxonomy.md`）已落地。

AlertTime Android 可选 LLM 计划评估已由用户在 2026-08-09 明确授权为原“手机端不做 LLM”的窄范围例外。双端代码闭环与自动化验证已完成，当前状态为**待真实 Provider、进程重启 UI 与手机—桌面局域网实机验收**；自动测试和构建通过不得写成实机完成。

计划建议现已形成“用户采纳 → Android 原子创建真实周目标/计划并记录本地来源 → 下次完整快照上传
`sourceProposalId` → Teacher SQLite 持久化 → accepted proposal 精确交叉核验 → 展示执行结果并进入下一轮建议”的
闭环。来源字段不替代真实完成状态；旧客户端缺失、字段漂移、`type != 1`、重复或跨 proposal 实体均
fail-closed。Android 只允许当前用户未删除、未归档的科目被建议引用；备份恢复与重新配对会清除不再可信的
本地主键来源映射，但保留已创建的业务数据。

**Catalog 双口径统计**：

| 口径 | Pack 数 | 知识节点 | 题目 |
|------|---------|----------|------|
| **正式（approved）** | 11 | 145 | 123 |
| **待审核（draft）** | 40 | 631 | 643 |
| **总计** | 51 | 776 | 766 |

- 正式 Pack：`math-limits`、已审核的 8 个数学 Pack、`python-basics` 与 `cs408-computer-networks`
- 其余 40 Pack 均为 draft，不进入默认检索、不计入正式统计

截至 2026-08-11 的最新自动门禁：Teacher Vitest 69 个测试文件 / 1309 个测试全部通过，`npm run build` 通过且 main bundle 为 473.78 kB；Rust `cargo test --all-targets` 283/283 通过，`cargo fmt --check` 通过，`user_version` 为 13；Android 36 suites / 264 tests 全通过，`lintDebug`（0 errors / 12 warnings）、`assembleDebug`、`assembleDebugAndroidTest` 通过。Node 协议镜像使用独立 `npm run test:protocol-mirror`，6 项通过、1 项因 Windows 符号链接权限按预期 skip，exit 0；双端 `sync/protocol` 10 个文件和 Android JVM 8 个 canonical fixture 文件逐字节一致；无设备离线跨仓闭环 exit 0。

核心能力：
- 5 个页面（对话、练习、仪表盘、知识图谱、设置）的代码与自动化边界已覆盖；生产包、进程重启后的 UI 与真实设备交互仍待验收
- 真实 Provider 配置与真实 LLM 对话仍待验收；历史 MiMo 窗口验证只保留在对应历史记录，不代表本轮完成
- **知识图谱天赋树**：v-network-graph 交互式网络图，节点颜色绑定掌握度（绿/橙/红/灰），点击查看详情
- **学习路径规划器**：基于拓扑排序的线性学习路径，显示当前推荐、完成进度、掌握度条
- **Ollama 本地引擎**：Rust 进程管理（启动/检测），设置页状态显示和一键启动按钮
- **练习模块自适应推荐**：基于掌握度的难度推荐（维果茨基最近发展区）、答题后智能推荐下一题
- **仪表盘可视化**：Chart.js 雷达图、学习路径面板、知识点覆盖率统计
- 练习模块 BKT 闭环：答题 → BKT 计算 → assessment 写入 → student_knowledge 更新
- LLM Reflection 已改为不阻塞前台对话（fire-and-forget）
- **Provider 配置帮助中心**：本地结构化指南（Kimi/Ollama/通用 OpenAI Compatible），设置页抽屉式教程、预设应用、错误诊断联动，与教学 RAG 完全隔离

当前 Rust 后端已拆出 `models`、`database`、`provider`、`conversation`、`memory`、`assessment`、`knowledge`、`vector`、`bkt`、`math_engine`、`seed`、`ollama`、`worker`、`private_doc` 模块。

## 2. 已完成工作

### 2.1 产品与治理

- 已整理 TeacherAgent 的产品定位：面向大学生、考研备考者和资格证考试学习者的桌面 AI 辅导助手。
- 已确定核心教学理念：引导而非告知，默认使用苏格拉底式辅导。
- 已确定桌面优先、本地优先、云端增强、隐私不倒退的产品原则。
- 已明确 Phase 0 到 Phase 4 的路线图。

相关文档：

- `docs/design.md`
- `docs/project-governance.md`
- `docs/architecture-diagram.html`

### 2.2 Prompt 与学科风格

- 已建立核心导师 Prompt 治理思路。
- 已确认导师核心人格统一为“引导式导师”。
- 已确认不同学科使用不同表达风格：英语可轻松诙谐，数学、物理、法学、会计等严谨学科应审慎、可验证。
- 已定义护栏评审、反思记录、RAG 注入和学科风格矩阵。

相关文档：

- `docs/prompt-governance.md`

### 2.3 Agent 架构

- 已设计 Orchestrator、ToolAgent、SocraticAgent、TutorAgent、GuardrailAgent、ReflectionAgent、AssessmentAgent、PlannerAgent 等职责边界。
- 已修正 MVP 运行时调用预算：Agent 是代码职责边界，不等于每个 Agent 独立调用 LLM。
- 已确定普通对话轮次尽量压缩为 1-2 次同步 LLM 调用，复杂轮次最多 3 次。
- 已明确 PlannerAgent 不进入每轮默认链路，只在目标设定、阶段完成、诊断完成或用户主动规划时触发。
- 已明确 Guardrail 失败后最多重写一次，仍失败则使用 fallback 模板。

相关文档：

- `docs/agent-architecture.md`

### 2.4 工具接口

- 已定义 `knowledge_search`、`web_search`、`calculator`、`code_runner`、`student_memory_search`、`question_bank_search` 等工具 schema。
- 已明确 ToolAgent 负责工具路由、隐私检查、错误处理和结果归一化。
- 已明确 `web_search` 不得携带学生隐私，不得自动写入正式知识库。

相关文档：

- `docs/tool-interface.md`

### 2.5 MVP 范围

- 已定义 MVP 目标：跑通桌面端连续多轮苏格拉底式对话、本地知识库增强、本地数据保存。
- 已确定首批建议学科：数学。
- 已确定首批建议章节：高等数学“极限与连续”。
- 已明确 MVP 必做、可做但不强制、明确不做的功能边界。
- 已定义 MVP 功能验收标准和测试样例。

相关文档：

- `docs/mvp-spec.md`

### 2.6 数据模型

- 已定义 SQLite 核心表：`students`、`subjects`、`learning_goals`、`conversations`、`messages`、`student_cognitive_profiles`、`long_term_memories`、`short_term_memories`、`knowledge_nodes`、`knowledge_edges`、`questions`、`student_knowledge`、`reflection_records`、`assessment_results`、`content_sources`、`provider_configs`。
- 已补充 migration 建表顺序，避免外键引用尚未创建的表。
- 已预留 SQLite-vec 向量表方向。
- 已补充长期结构化认知画像、长期记忆和短期记忆的数据表。

相关文档：

- `docs/data-model.md`

### 2.7 知识库与版权治理

- 已明确不做野爬商业教材、付费题库、培训机构资料和版权不明网页内容。
- 已确认优先使用原创内容、明确开放授权 OER 和人工审核资料。
- 已定义知识节点、题目、来源元数据和审核状态 schema。
- 已明确正式知识库只允许 `approved` 内容进入默认检索。

相关文档：

- `docs/knowledge-base-governance.md`

### 2.8 缓存与性能治理

- 已新增 `docs/cache-strategy.md`，定义 TeacherAgent 的缓存对象、禁缓存对象、缓存键、TTL、隐私边界和 Provider prompt cache 策略。
- 已参考 `xuzeTop1/llm-cache-optimizer` 的 README 和源码，将稳定 prompt layering、canonical serialization、cached token metrics、session memory compaction 和 Claude cache-control 思路纳入本项目缓存治理。
- 已新增前端内存 TTL cache、稳定 hash key、易变字段剔除、文本规范化和单飞请求 wrapper。
- 已新增 Provider cached token 指标提取，兼容 OpenAI `cached_tokens`、DeepSeek prompt cache hit/miss 和 Claude `cache_read_input_tokens` 字段。
- 已新增 Prompt Layer 排序工具，固定 `core_system -> tool_schema -> static_context -> session_memory -> history -> runtime` 顺序。
- 已新增 Phase 0 学习记忆服务，区分短期记忆、长期记忆和用户画像摘要。

相关文档：

- `docs/cache-strategy.md`

### 2.9 协作入口

- 已建立 Codex / Claude Code 的开发入口说明。
- 已把核心治理文档加入默认阅读清单。
- 已集中未决问题到开放决策池。

相关文档：

- `AGENTS.md`
- `CLAUDE.md`
- `docs/open-decisions.md`

## 3. 当前完成度总览

### 已完成（代码 + 测试通过）

- 5 个页面：对话辅导、练习、仪表盘、知识图谱、设置。
- Rust 后端模块：models、database、provider、conversation、memory、assessment、knowledge、vector、bkt、math_engine、seed、ollama、worker、code_worker、private_doc、embedding、custom_subject、web_search、shared。
- Provider keychain 路径：API Key 存系统凭据，SQLite 只存 `api_key_ref`。
- Rust math_compute command：纯 Rust 符号计算（求导、积分、求值、化简、极限、方程求解）。
- BKT command：贝叶斯知识追踪算法。
- 基础向量存储：BLOB + 余弦相似度（纯 Rust）。
- 规则版 ReflectionAgent + LLM Reflection（代码已实现并接入运行链路：有 Provider 时异步调用 LLM 反思，失败自动 fallback 到规则版，不阻塞学生可见回复）。
- 规则版 AssessmentAgent、PlannerAgent、GuardrailAgent。
- 知识库：723 知识节点 / 726 道题，41 个 Pack，9 个学科（数学、CS408、物理、英语、政治、管理类联考、教育学、心理学、法律硕士）。
- **Phase 1 本地 RAG**：723 个知识节点已入库 SQLite `knowledge_nodes` 表，ToolAgent 优先查数据库 keyword 搜索，降级到 JSON seed；启动时自动 seed，已 seed 时不重复写库。
- **code-runner**：Python 代码执行 sidecar（教学护栏，非安全沙箱），timeout clamp 1-30s，ToolAgent 根据编程意图自动路由。
- **embedding 批处理**：前端 embedding 批量生成服务已实现，vector-first 检索已集成到 ToolAgent，但全库 embedding 需 embedding Provider。
- 路由懒加载。
- IPC memory 调用恢复（带超时降级）。
- 章节级 DAG Planner（拓扑排序、关键路径）。

### 基础设施就绪但闭环未完成

- 向量检索：Rust 存储和搜索已就绪，embedding 批处理已实现，但全库 embedding 生成需 embedding Provider，真实语义检索未验收。
- 知识图谱可视化：SVG 页面已实现，数据来自 student_knowledge。

### 需用户操作

- 重新构建安装包（当前安装包已过期，7 月 7 日构建不包含 code-runner 等 7 月 9-10 日提交）。
- Tauri 窗口实机验证（5 个页面渲染和交互）。
- 真实 Provider 配置和 LLM 对话验收。

### 需后续开发或外部依赖

- 全库 embedding 生成（需 embedding Provider 或 Ollama + bge-m3）。
- SQLite-vec ANN 索引（当前 brute-force cosine 够用后再评估）。
- Ollama 本地模型集成（需用户安装 Ollama）。
- OCR/语音输入。
- 自动更新机制。

## 4. 下一步推荐

Phase 1 本地 RAG + 私有资料 RAG + code-runner 已完成。下一步优先级：

1. **P0**：收敛可发布基线 — Rust timeout clamp、code-runner 安全文案、文档真相源统一、完整验证。
2. **P1**：重新构建安装包并实机验收 — 重新 tauri build、确认 sidecar 带入、5 页面 + Provider 对话 + BKT + 私有资料 RAG + code-runner 验证。
3. **P2**：完成真实向量 RAG — 配置 embedding Provider、生成全库 embedding、对比 vector-first vs keyword fallback。
4. **P3**：性能与产品完善 — 主 bundle 依赖分析、按需拆分。

## 5. 验证门禁

当前全量验证通过（2026-07-10 timeout clamp + 文档统一后重新验证）：

```powershell
npm run test -- --maxWorkers=1   # 全部前端测试通过（850 条，41 个测试文件）
npm run build                    # ✓ built in ~4.1s，主 bundle 474 kB（< 500 kB 阈值）
cd src-tauri
cargo fmt -- --check             # 无格式问题
cargo check                      # 0 warning
cargo test                       # 全部 Rust 测试通过（132 条）
```

实机验证（`npm run tauri:dev`）已通过：
- 5 个页面（对话、练习、仪表盘、知识图谱、设置）正常渲染和交互
- 真实 Provider（MiMo）配置和 LLM 对话正常
- 练习模块 BKT 闭环：答题 → BKT → assessment → student_knowledge
- 流式输出公式渲染正常（KaTeX）
- Reflection 不阻塞前台对话（fire-and-forget）
- 调试日志已清理（不打印 request_body）
- **Phase 2 新增**：自适应练习推荐、仪表盘雷达图、向量搜索集成到 ToolAgent（vector/embedding 基础设施就绪，seed embedding 未生成，真实向量 RAG 未闭环）
- **Phase 1 RAG**：知识节点已入库 SQLite，ToolAgent 优先查数据库，中文自然句搜索命中率提升
- **私有资料导入**：PDF/DOCX/XLSX 预览 → 确认导入 → SQLite private draft，彻底删除（非软删除）
- **私有资料 RAG**：ToolAgent 对话时自动检索私有资料（keyword/simple scoring），sourceType 区分 built_in_pack / private_document
- **sourceType 契约统一**：SourceRef.sourceType 包含 built_in_pack、private_document 等值，与 prompt 注入一致
- **边界保护**：list limit clamp 1..=100、search limit clamp 1..=10、空 query 返回空、超长 query 截断 200 字符
- **自然问句私有资料检索**：toolAgent 从自然语言问句提取关键词（≥2连续中文/英文token）再传给 Rust LIKE 搜索，不再将完整问句（如"你看到我上传的政治考研大纲吗？"）直接传入
- **LIKE 元字符转义**：Rust `search_private_chunks_with_connection` 对 `%`、`_`、`\` 进行转义（ESCAPE '\\'），防止含特殊字符的查询匹配所有 chunk 并注入云 LLM prompt
- **tokenized OR 搜索**：Rust 搜索将 query 拆分为多个 token，任一 token 命中 text/heading/title 即返回，不再要求整句精确匹配
- **DocumentImportPanel 状态链修复**：loading → error → empty → list 使用 v-if/v-else-if/v-else 单链，修复 loading 或 error 时仍渲染 imported-list 的问题
- **资料摘要/大纲查询意图**：SocraticAgent 新增 `outline_summary` intent，覆盖"考哪些内容/大纲/考试范围/讲了什么/帮我总结/syllabus"等跨学科查询模式。命中时 mode=explain, shouldAskQuestion=false, strategy=direct_review，先结构化概括再给轻量后续建议，不强制苏格拉底式反问。`intent` 字段贯穿 SocraticDecision → TutorTeachingStrategy → prompt builder，避免与 review 模式混淆。
- **SocraticAgent intent 体系**：SocraticDecision 新增 `intent` 字段（SocraticIntent 类型），区分 concept_question / outline_summary / practice_solve / direct_answer_request / review / learning_plan / exam_sprint / emotional_support / counterexample / default_guide。tutorPromptBuilder 基于 intent 而非 shouldAskQuestion 做 prompt 分支。
- **Output contract 版本升级**：TUTOR_OUTPUT_CONTRACT_VERSION 升级为 tutor-output-contract-v1.1，反映 shouldAskQuestion 条件变更。
- **System prompt 升级**：TUTOR_SYSTEM_PROMPT_VERSION 升级为 tutor-system-v1.1，回复策略新增资料摘要/大纲例外规则。
- **2026-07-06 实机问题修复**：针对长 LLM 回复在对话页无法滚动、"帮我总结这份资料"在未检索到私有资料时泛化编造、练习题请求后追加通用追问的问题，新增运行时 prompt 约束和聊天区滚动边界。
- **2026-07-06 对话内资料导入**：ChatComposer 新增附件按钮，支持在对话页直接选择 PDF/DOCX/XLSX，本地解析后保存到 `private_documents` / `private_document_chunks`。导入成功后当前会话记录 `recentPrivateDocument`，ToolAgent 对"这份资料/刚才上传的资料"等指代请求优先读取最近文档 chunks，再注入私有资料 RAG。`TUTOR_SYSTEM_PROMPT_VERSION` 升级为 `tutor-system-v1.3`。前端测试更新为 `npm run test -- --maxWorkers=1` 438 条通过，`npm run build` 通过。
- **2026-07-06 对话内资料上下文管理 MVP**：ChatView 新增 `DocumentContextPanel` 组件，支持对话内资料上下文管理。用户可点击状态条"管理资料"按钮打开面板，面板展示当前资料标题、已导入资料列表，并提供三个操作：（1）**选择已有资料**：从当前学科已导入资料列表中选择一份作为当前对话资料，`recentPrivateDocument` 立即生效；（2）**本轮不用**：只清空当前会话 `recentPrivateDocument`，不删除 SQLite 数据，资料仍保留在本地资料库中；（3）**删除资料**：从 SQLite 彻底删除文档和 chunks，如果删除的是当前资料则同时清空引用。新增 `documentContextManager.ts` 纯逻辑模块和 9 条单元测试。前端测试更新为 `npm run test -- --maxWorkers=1` 457 条通过，`npm run build` 通过。`docs/verification-checklist.md` 已同步新增资料上下文管理验证项。
- **2026-07-06 会话级资料绑定持久化**：将 `recentPrivateDocument` 从纯前端内存状态持久化到 SQLite `conversation_private_documents` 表（方案 B：新建关联表）。每个会话可绑定 0 或 1 个私有资料，切换会话和重启应用后可恢复。Rust 新增 4 个 repository 函数（`bind_private_document_to_conversation`、`clear_private_document_binding`、`load_conversation_private_document_id`、`clear_bindings_for_private_document`）和 3 个 Tauri commands。删除私有资料时在同一事务内清理所有会话绑定。前端新增 `privateDocumentContextService.ts`，ChatView 在 `selectDocument`、`clearCurrentDocument`、`loadConversation` 和 `attachDocumentToCurrentConversation` 中调用持久化/恢复逻辑。新增 Rust 测试 4 条和前端测试 5 条。`docs/verification-checklist.md` 新增 §6.7 会话级资料绑定持久化验证项。
- **2026-07-06 Document Worker PyInstaller 打包 + Tauri Sidecar 集成**：新增 `tools/document-worker/build.ps1`（PyInstaller 一键打包脚本）和 `copy-sidecar.ps1`（复制产物到 Tauri sidecar 目录）。修改 `worker.rs`：新增 `resolve_worker_executable()` 查找 sidecar exe，`run_worker()` 优先使用 exe，未找到时回退到 Python 模块。将 `run_worker` 拆分为 `run_worker_exe`、`run_worker_python` 和 `collect_child_output` 三个函数。`tauri.conf.json` 新增 `externalBin: ["binaries/document-worker"]` 配置。用户无需安装 Python 即可使用文档解析功能。
- **2026-07-06 性能优化 + 孤立节点清理**：（A）修复设置页切到知识图谱页卡顿：KnowledgeGraphView 的 `loadGraphData` 改为 `setTimeout(0)` 延迟执行，让组件先渲染首屏；`packLoader.ts` 的 `loadKnowledgePacksByIds`、`loadAllKnowledgePacks`、`loadAllQuestionPacks` 从顺序加载改为 `Promise.allSettled` 并行加载。（B）处理 DB 节点多于 Pack 预期的问题：Rust `HealthCheckResult` 新增 `orphan_details` 字段（含 id/title/subject_code/review_status），健康检查现在返回孤立节点详情；新增 `delete_orphan_knowledge_nodes` Tauri command，安全删除不在 manifest 中的孤立节点（同步清理 knowledge_edges 和 student_knowledge 外键引用）；设置页知识库管理新增孤立节点详情列表和"清理孤立知识节点"按钮（点击前需确认）。新增 Rust 测试 3 条（orphan 删除、跳过 manifest 节点、orphan 详情返回）。

- 项目可以安装依赖。当前状态：已完成。
- 项目可以完成前端构建。当前状态：已完成，`npm run build` 通过。
- Vue 页面能渲染基础布局。当前状态：已在 Tauri 窗口中验证通过。
- 对话消息支持 Markdown、公式和代码块渲染。当前状态：已在 Tauri 窗口中验证通过。
- Tauri 后端能编译或至少配置完整。当前状态：`cargo fmt/check/test` 通过。
- 前端能调用一个最小 Tauri command。当前状态：已在 Tauri 窗口中验证通过。
- 目录结构与 `docs/project-governance.md` 基本一致。当前状态：已创建主要目录。
- `src-tauri/migrations/0001_initial.sql` 已按 `docs/data-model.md` 起草。当前状态：已完成。

## 6. 当前关键决策

- 技术栈：Tauri 2.x + Vue 3 + TypeScript + SQLite。
- UI 组件库：Vuetify 3。
- LLM Provider：优先 OpenAI 兼容接口。
- 本地模型：Ollama sidecar 预留，MVP 可先不完整实现。
- 首批知识库：数学，高等数学“极限与连续”。
- 知识来源：原创 seed + 明确授权 OER，禁止版权不明内容。
- Agent 调用：保留代码边界，运行时合并 LLM 调用以控制延迟。
- 学习记忆：短期记忆、长期记忆和用户画像都要做；当前已 SQLite 优先、`localStorage` 兜底，长期记忆摘要后续进入 SQLite-vec。
- 反思记录：当前已实现规则版 ReflectionAgent 和 LLM Reflection（有 Provider 时异步调用，失败 fallback 到规则版）并写入 SQLite。
- 评估记录：当前已实现规则版 AssessmentAgent 并写入 SQLite；保存评估结果时会同步知识节点快照并更新 `student_knowledge`，形成基础掌握度状态。
- 护栏闭环：当前已实现规则优先、风险时 LLM Guardrail、最多一次 rewrite 和最终 fallback；普通低风险轮次不新增额外 LLM 调用。
- 学习规划：当前已实现规则版 PlannerAgent 事件触发骨架；只在用户明确请求规划、复习安排或下一步建议时触发，普通对话不进入 PlannerAgent；规划时会尝试读取 `student_knowledge` 基础掌握度和最近练习时间，生成简化复习到期信号，并针对低掌握度节点读取 `knowledge_edges` / `prerequisites_json` 前置依赖，失败时回退到记忆摘要和学科默认计划。
- Provider 配置：当前已持久化非敏感默认配置；不指定默认云厂商；API Key 写入系统凭据存储，SQLite 只保存 `api_key_ref`；OpenAI-compatible 请求由 Rust command 从 keychain 取 Key 后发起。
- Provider 诊断：Rust `complete_llm_chat` 当前返回结构化错误 `code/message/status/retryable`，并只记录脱敏日志；设置页测试连接会展示错误类型、HTTP 状态和是否可重试。

## 7. 仍待确认

详见 `docs/open-decisions.md`。当前最影响 MVP 的问题：

- `web_search` 是否在 MVP 实际接入，还是只保留接口。
- 英语类学科幽默程度和冲刺模式是否需要 UI 开关。

## 8. 工作记录

### 2026-06-30

- 完成项目治理文档、Prompt 治理、Agent 架构、工具接口、MVP 规格、数据模型、知识库治理和开放决策池。
- 根据 review 修正 Agent 运行时调用预算，避免每轮 6-8 次 LLM 调用。
- 根据 review 修正目录结构权威来源，统一为架构层组织。
- 根据 review 明确 AssessmentAgent 承接对话式评估职责。
- 根据 review 集中未决问题到 `docs/open-decisions.md`。
- 根据 review 补充 `data-model.md` 的建表顺序和 `student_cognitive_profiles` 后续预留。
- 根据用户决策选择 Vuetify 3 作为 UI 组件库。
- 已创建 Phase 0 第一版应用骨架：Vite/Vue 入口、Vuetify 插件、对话页、设置页、Tauri 配置、最小 Rust command、初始 SQLite migration 和 seed 目录。
- 已验证 Node.js v24.11.1、npm 11.14.1 可用。
- 已执行 `npm install` 成功，生成依赖安装结果。
- 已执行 `npm run build` 成功，前端 TypeScript 与 Vite 构建通过。
- 已验证 `cargo` 和 `rustc` 当前可用：`cargo 1.96.0`、`rustc 1.96.0`。
- 已运行 `cargo check` 通过，确认 Tauri/Rust 后端可编译。
- 已运行 `cargo test` 通过，确认 SQLite migration 单元测试通过。
- 已执行 `npm run tauri -- info` 成功，确认 WebView2、MSVC、rustc、cargo、rustup、Node/npm、Tauri CLI 和项目配置可被识别。
- 已补充设置页 IPC 测试按钮和 `pingBackend()` 前端调用封装；Tauri 窗口内实机点击仍待验证。
- 已再次执行 `npm run build` 成功，确认 IPC 调用封装不影响前端构建。
- 已新增消息渲染组件和 renderer service，支持 Markdown、KaTeX 公式和 Shiki 代码块。
- 已将 Shiki 改为按需懒加载，只加载 MVP 常用语言 TypeScript、JavaScript、Python 和 Shell，避免全量语言包进入首屏。
- 已执行 `npm run build` 成功，确认消息渲染管线可通过 TypeScript 与 Vite 构建。
- 已新增 `src/services/llm/`，包含 LLM Provider 统一类型、`LlmProviderError` 和 OpenAI-compatible 非流式 Provider 骨架。
- 当前 Provider 通过设置页接收 API Key；保存时写入系统凭据存储，SQLite 只保存引用。OpenAI-compatible 请求通过 Rust `complete_llm_chat` command 发起，前端只传 `apiKeyRef`、模型配置和 messages。
- 已再次执行 `npm run build` 成功，确认 LLM Provider 骨架可通过 TypeScript 与 Vite 构建。
- 已通过 websearch / GitHub contents API 读取 `xuzeTop1/llm-cache-optimizer` 的 `serializer.py`、`layers.py`、`metrics.py`、`client.py`、`memory.py` 和 adapter 文件，并将稳定 prompt layering、canonical serialization、cached token metrics、session memory compaction 和 Claude cache-control 思路合并为本项目缓存治理。
- 已新增 `src/services/cache/canonicalSerializer.ts`、`cacheKey.ts`、`memoryCacheStore.ts` 和 `src/services/llm/cachedLlmProvider.ts`，形成 MVP 内存 TTL cache 与 LLM Provider wrapper。
- 已新增 `src/services/llm/cacheMetrics.ts`，用于解析 OpenAI/DeepSeek 响应中的 prompt cache 命中 token。
- 已新增 `src/engine/prompts/promptLayers.ts`，固定 Prompt Builder 的稳定前缀层级顺序。
- 已根据 `llm-cache-optimizer` 源码补齐 ISO 时间戳、UUID、request/trace/span/run id 占位符归一化、浮点数有限精度归一化、Claude `cache_read_input_tokens` 指标和成本节省估算。
- 已再次执行 `npm run build` 成功，确认缓存策略代码、Prompt Layer 工具和文档同步不破坏前端构建。
- 已新增 Tutor Prompt Builder v1：`src/engine/prompts/tutorSystem.ts`、`src/engine/prompts/tutorPromptBuilder.ts` 和 `src/engine/policies/subjectStyle.ts`。
- Prompt Builder v1 已支持核心导师 prompt、输出契约、学科风格注入、学生上下文、知识上下文、近期消息和本轮运行指令，并输出 cache-aware LLM messages / cache parts / promptVersion。
- 已接通第一版真实对话链路：设置页可把 OpenAI-compatible Provider 配置保存到当前运行时，ChatView 可调用 `buildTutorPrompt()` 生成 messages，再通过 `OpenAICompatibleProvider` 获取导师回复并用现有 MessageRenderer 渲染。
- 当前 API Key 不写入 localStorage、SQLite、普通文件或前端全局 store；设置页保存时写入系统凭据存储，模型请求时由 Rust 按 `apiKeyRef` 读取。
- 已新增规则版 `GuardrailAgent v1`：`src/engine/agents/guardrailAgent.ts`，覆盖过早最终答案、完整解法、内部信息泄露、隐私诱导和语气问题的确定性审查。
- 早期曾将规则版 Guardrail 接入学生可见回复路径：Provider 草稿必须先通过规则护栏，否则展示引导式兜底回复。
- 当前 Guardrail 已升级为 Phase 0 闭环：规则初筛、风险时 LLM 审核、最多一次重写、最终兜底；后续需要补更完整的护栏测试样例集。
- 已新增 `math_compute` 工具契约和占位适配器，明确数学计算工具不要求学生安装 Python；后续应由 Tauri sidecar、内置运行时或其他受控 runtime 提供 SymPy/SciPy 类能力。
- 已新增 `TutorOrchestrator v1`：`src/engine/agents/tutorOrchestrator.ts`，将 Prompt Builder、OpenAI-compatible Provider 和 Guardrail 调度从 ChatView 收拢到 engine 层。
- 已改造 ChatView 使用 `TutorOrchestrator.handleTurn()`，UI 只负责消息收发和渲染，不再直接构建 prompt 或调用 Guardrail。
- 已明确向量检索路线：Phase 0 使用 keyword/hybrid mock，Phase 1 默认 SQLite-vec，LanceDB 作为后续大规模/多模态备选。
- 已明确完整 prompt 不写入向量库；向量库只存知识摘要、题目摘要、脱敏反思摘要和学生长期记忆摘要。Prompt 复用依赖 Prompt Layer、版本化、缓存键和 Provider prefix cache。
- 已补充原创数学 seed：极限直观含义、等价无穷小、洛必达法则、一点连续。
- 已新增 `src/services/knowledge/localKnowledgeSearch.ts`，实现本地 JSON seed 的轻量 keyword/hybrid 检索。
- 已将本地 `knowledge_search` 接入 `TutorOrchestrator v1`，命中后把知识摘要、常见误区和苏格拉底提示注入 Tutor Prompt。
- 已新增 `ToolAgent v1`：`src/engine/agents/toolAgent.ts`，由 ToolAgent 负责本地 `knowledge_search` 路由和 `KnowledgeContext` 归一化；`TutorOrchestrator` 不再直接访问知识检索 service。
- 已将 `math_compute` 轻量路由接入 `ToolAgent v1`：数学计算类请求会生成内部 `tool_context`；在后端未配置时返回 `ENGINE_UNAVAILABLE`，Prompt 规则要求 Tutor 不得声称已完成计算。
- 已新增规则版 `SocraticAgent v1`：`src/engine/agents/socraticAgent.ts`，根据学生输入选择教学模式、最大提示等级、策略、解释深度和风险信号，不增加额外 LLM 调用。
- 已将 `SocraticAgent v1` 接入 `TutorOrchestrator v1`，普通对话会在 Prompt Builder 前完成教学策略决策。
- 已为 Prompt Builder 增加 `<teaching_strategy>` 运行时上下文，用于让模型自然体现追问、分解、反例、类比或复盘策略，同时不向学生暴露内部策略名称。
- 已修正 `ToolAgent v1` 的数学工具路由：概念类问题如“什么是极限”优先走概念解释和知识检索，不再误触发 `math_compute` 占位上下文。
- 已为 Prompt Builder 增加 `toolContextNotes` 注入点，用于放置受控工具上下文，并明确工具原始结果不直接展示给学生。
- 已新增 `src/types/memory.ts` 和 `src/services/student/memoryService.ts`，实现 Phase 0 学习记忆服务：短期记忆、长期记忆、用户画像摘要。
- 已将学习记忆接入 `TutorOrchestrator v1`：生成回复前读取 `sessionMemory` / `studentContext`，回复通过护栏后记录本轮信号。
- 已给 `ChatView` 增加当前会话 id，让短期记忆按会话隔离。
- 已在 `src-tauri/migrations/0001_initial.sql` 和 `docs/data-model.md` 中补充 `student_cognitive_profiles`、`long_term_memories`、`short_term_memories`。
- 已新增 Rust SQLite 运行时初始化命令 `init_database`，使用 `rusqlite` + bundled SQLite 在 Tauri app data directory 下创建 `teacher_agent.sqlite3`。
- 已新增 `schema_migrations` 迁移记录，并用 Rust 单元测试验证 `0001_initial` 首次迁移和重复执行幂等性。
- 已在设置页新增“初始化 SQLite”按钮，前端通过 `initializeDatabase()` 调用 Tauri 命令并展示数据库路径、已应用迁移和 `user_version`。
- 已补齐 Tauri `icons/icon.ico` 和 `tauri.conf.json` icon 配置，解除 Windows resource 构建错误。
- 已新增 Rust 会话/消息命令：`ensure_default_conversation`、`list_conversations`、`create_conversation`、`update_conversation_title`、`save_message`、`list_messages`。
- 已将 `ChatView` 接入 SQLite 会话历史管理：页面加载时显示历史侧栏，支持新建会话、切换会话、编辑标题，发送消息时保存学生消息和导师回复并刷新会话更新时间；Tauri 不可用时退回内存会话。
- 已新增 Rust 单元测试覆盖默认会话创建、会话列表、新建会话、标题更新、消息保存和按顺序读取。
- 已新增 Rust 学习记忆命令：`load_learning_memory_context`、`save_learning_memory_state`，覆盖用户画像、短期记忆和长期记忆摘要。
- 已将 `LearningMemoryService` 改为 SQLite 优先、`localStorage` 兜底；`TutorOrchestrator` 在生成回复前后异步读写学习记忆。
- 已新增 Rust 单元测试覆盖用户画像、短期记忆、长期记忆写入和读取。
- 已新增 `src/types/reflection.ts` 和 `src/engine/agents/reflectionAgent.ts`，实现规则版 ReflectionAgent v1，输出 observation / inference / uncertainty、知识更新、误区、策略效果和下一步建议。
- 已将 `LearningMemoryService` 改为消费 ReflectionAgent 输出，再更新短期记忆、长期记忆和用户画像候选项。
- 已新增 Rust 反思记录命令 `save_reflection_record`，并通过前端 `saveReflectionRecord()` 写入 `reflection_records`。
- 已新增 Rust 单元测试覆盖反思记录写入和读取。
- 已新增 Rust Provider 配置命令：`save_provider_config`、`load_default_provider_config`，保存默认 Provider 的非敏感配置到 `provider_configs`。
- 已新增 Rust Provider API Key 命令：`save_provider_api_key`、`delete_provider_api_key`，通过系统凭据存储保存和删除 API Key。不再提供明文读取命令（前端通过 `api_key_ref` 是否非空判断 key 是否存在，测试连接走 `complete_llm_chat` 间接验证）。
- 已新增 Rust LLM 请求命令：`complete_llm_chat`，按 OpenAI-compatible `/chat/completions` 协议请求模型；非本地 Provider 必须提供 `apiKeyRef`，由 Rust 从系统凭据存储读取 API Key。
- 已将设置页接入 Provider 配置加载/保存：启动时恢复 baseUrl/model/isLocal/apiKeyRef，不把 API Key 读入表单或前端全局 store；保存时 SQLite 只持久化非敏感字段和 keychain 引用。
- 已改造 OpenAI-compatible 前端 Provider：所有云端 LLM 调用强制走 Rust `complete_llm_chat` / `complete_llm_chat_stream`，非本地 Provider 必须提供 `apiKeyRef`；已移除前端 fetch fallback 与明文 API Key 路径，`LlmProviderConfig` 不再包含 `apiKey` 字段。
- 已新增 Rust 单元测试覆盖默认 Provider 保存/读取、合法 keychain 引用写入，并拒绝疑似明文 API Key 写入 `api_key_ref`。
- 已移除设置页的具体云厂商默认 Base URL 和模型示例，Provider 名称、Base URL、模型与 API Key 均由用户填写；API Key 继续不明文持久化。
- 已新增 `src/types/assessment.ts` 和 `src/engine/agents/assessmentAgent.ts`，实现规则版 AssessmentAgent v1，输出本轮正确性、置信度、知识点掌握度 delta、误区和下一步建议。
- 已新增 Rust 评估记录命令 `save_assessment_result`，并通过前端 `saveAssessmentResult()` 写入 `assessment_results`。
- 已将 `AssessmentAgent v1` 接入 `TutorOrchestrator v1`：Guardrail 后基于学生可见回复生成评估结果，SQLite 不可用时不阻断对话。
- 已将 `AssessmentAgent v1` 的知识点快照和掌握度 delta 接入 `student_knowledge`：保存评估结果时先同步最小知识节点快照，再更新掌握度概率、尝试次数、正确次数和证据摘要。
- 已新增 Rust 单元测试覆盖本轮评估结果写入、知识节点快照写入和学生掌握度更新。
- 已补齐 GuardrailAgent 的 LLM 审核和 rewrite-once 路径：规则护栏拒绝后才调用 LLM Guardrail，合并审查结果后最多重写一次，重写后仍不通过则使用兜底回复。
- 已将 TutorOrchestrator 改为统一执行 Guardrail 闭环；低风险普通轮次不额外调用 LLM，高风险轮次也有确定终止路径。
- 已再次执行 `npm run build` 成功，确认 Guardrail LLM 审核、rewrite-once 和文档同步不破坏前端构建。
- 已为 Rust `complete_llm_chat` 补充 Provider 错误分类：覆盖配置缺失、请求非法、API Key 缺失、keychain 失败、鉴权失败、模型或 endpoint 不存在、限流、网络错误、超时、服务端不可用和响应结构异常。
- 已为 Rust LLM 请求补充脱敏日志：只记录事件名、Provider、模型、endpoint host、HTTP 状态、错误 code 和消息数量，不记录 API Key、请求体、对话内容或学生画像。
- 已让前端 `LlmProviderError` 接收 Rust 结构化错误；设置页 Provider 测试失败时会展示错误类型、HTTP 状态和可重试提示。
- 已执行 `cargo fmt`、`cargo check`、`cargo test` 和 `npm run build` 成功；Rust 测试当前 8 个通过。
- 已新增 `src/types/planner.ts` 和 `src/engine/agents/plannerAgent.ts`，实现规则版 PlannerAgent v1，输出规划触发原因、下一步任务、复习重点、规划周期和置信度。
- 已将 PlannerAgent 接入 `TutorOrchestrator v1` 的事件触发路径：用户主动问“接下来学什么”“怎么安排复习”等规划请求时，不调用普通 Tutor 草稿 LLM，直接生成规则规划、通过规则护栏并记录学习记忆。
- 已让 `SocraticAgent v1` 标记 `plan_learning_request` 风险/意图信号，便于后续观测规划型轮次。
- 已执行 `npm run build` 成功，确认 PlannerAgent 类型、编排分支和文档同步不破坏前端构建。
- 已新增 Rust `load_student_knowledge` 只读命令和前端封装，按学科读取 `student_knowledge` + `knowledge_nodes` 的掌握度、练习次数、证据摘要和更新时间。
- 已将 `load_student_knowledge` 接入 PlannerAgent 事件触发路径：规划请求会优先使用低掌握度知识点生成复习重点和针对性任务；Tauri/SQLite 不可用时静默回退。
- 已扩展 `PlannerResult`，增加 `masterySignals` 字段，用于后续学习路径 UI 或调试观测。
- 已执行 `cargo fmt`、`cargo check`、`cargo test` 和 `npm run build` 成功；Rust 测试当前 9 个通过，并覆盖掌握度查询和知识前置依赖读取。
- 已新增 Rust `load_knowledge_prerequisites` 只读命令和前端封装，可按低掌握知识节点读取 `knowledge_edges` 的 `prerequisite` 边，并在边表缺失时回退读取 `knowledge_nodes.prerequisites_json`。
- 已将知识图谱前置依赖接入 PlannerAgent 事件触发路径：规划建议会优先插入“先补前置”任务，并在 `PlannerResult` 中暴露 `prerequisiteSignals` 供后续 UI 或调试观测使用。
- 已将简化间隔复习规则接入 PlannerAgent：基于 `student_knowledge.last_practiced_at` / `updated_at` 和掌握度估算复习阈值，生成“已间隔 X 天未复习”的 `reviewDueSignals` 和短复习任务；用户明确请求复习计划时会优先安排到期复习。
- 已执行 `npm run build` 成功，确认间隔复习信号、PlannerResult 扩展和文档同步不破坏前端构建。
- 已在对话页为 Planner 轮次增加“规划信号”折叠观测面板，展示 `masterySignals`、`prerequisiteSignals`、`reviewDueSignals` 和规划置信度，便于 Phase 0 实机判断路径建议是否可信。
- 已调整对话页 Provider 前置检查：规则版 PlannerAgent 不依赖 LLM Provider，用户未配置模型时仍可请求“接下来学什么/怎么复习”；普通辅导轮次仍提示先配置 Provider。
- 已执行 `npm run build` 成功，确认 Planner 观测面板、Provider 前置检查调整和样式改动不破坏前端构建。
- 已扩展消息读取返回值，`list_messages` 会返回 `knowledge_refs_json`、`tool_refs_json` 和 `guardrail_json`，前端会把 `tool_refs_json.plannerResult` 解析回 `ChatMessage.plannerResult`。
- 已让 Planner 轮次的规划结果随导师消息写入 `messages.tool_refs_json`，历史会话重新加载后仍能展示“规划信号”面板。
- 已执行 `npm run build` 成功，确认 Planner 元数据持久化与历史恢复不破坏前端构建。
- 本轮尝试执行 `cargo fmt`、`cargo check`、`cargo test` 时曾被 Windows sandbox / 当时额度限制拦截；已做静态核对，后续已在 2026-07-01 补跑通过。

### 2026-07-01

- 已补跑 `cargo fmt`、`cargo check`、`cargo test` 成功；Rust 测试当前 9 个通过，覆盖消息元数据回读、掌握度查询和知识前置依赖读取等路径。
- 已执行 `npm run build` 成功，确认前端 TypeScript、Vite 构建和 JSON seed import 均可通过。
- 已将 `data/knowledge/math-limits.seed.json` 扩充到 35 个 TeacherAgent 原创数学知识节点，覆盖极限定义、左右极限、无穷小、无穷大、不定式、因式分解、有理化、等价无穷小、夹逼定理、洛必达、泰勒展开、数列极限、连续性、间断点、介值定理、最值定理、渐近线等。
- 已扩展本地 `knowledge_search` 的中文短语 token 表，增强新增知识点的 keyword/hybrid mock 检索命中率。
- 已用只读 Node 计数命令确认数学 seed 当前节点数为 35。
- 已将 `data/questions/math-limits.seed.json` 扩充到 12 道 TeacherAgent 原创数学题目，覆盖概念判断、因式分解、有理化、等价无穷小、分段函数左右极限、连续性参数、夹逼定理、洛必达适用性、可去间断点、介值定理、有理函数无穷远极限和指数对数型极限。
- 已用只读 Node 计数命令确认数学题目 seed 当前题量为 12。
- 已新增 `src/services/questions/localQuestionBankSearch.ts`，支持本地 JSON 题库 keyword/hybrid mock 检索。
- 已将 `question_bank_search` 接入 ToolAgent：仅在用户明确请求练习、类似题、测验、复盘题等场景触发；练习/测验默认只给题目和提示，答案与步骤只在复盘目的下进入内部 tool context。
- 已同步 `docs/tool-interface.md`，将 `concept_check` 和 `diagnostic` 纳入题型契约，并记录 Phase 0 本地题库检索已接入。
- 已再次执行 `npm run build` 成功，确认本地题库检索 service、ToolAgent 路由和工具类型扩展不破坏前端构建。
- 已扩展对话消息落库元数据：导师回复会把知识节点引用写入 `knowledge_refs_json`，把 Provider/Prompt 版本、Socratic 策略、知识检索、题库检索、数学计算状态和 AssessmentResult id 写入 `tool_refs_json`，把 Guardrail 审核摘要写入 `guardrail_json`。
- 消息元数据只保存结构化引用和状态，不保存 API Key、完整 prompt、工具原始答案步骤或 Guardrail 未通过草稿；Planner 面板仍可从 `tool_refs_json.plannerResult` 恢复。
- 已再次执行 `npm run build` 成功，确认消息元数据落库逻辑不破坏前端构建。
- 已安装 Vitest 并新增 `npm run test` / `npm run test:watch` 脚本。
- 已新增本地知识库、题库和 ToolAgent 单元测试，覆盖“夹逼定理”“可去间断点”检索、按知识点 id 找题、练习模式不暴露答案、复盘模式才注入内部答案步骤、普通概念问题不触发题库检索。
- 测试发现并修复题库复盘触发词缺口：`shouldSearchQuestionBank` 现在能识别“复盘/解析/review”请求。
- 已执行 `npm run test` 成功，当前 3 个测试文件、7 条测试通过。
- 已再次执行 `npm run build` 成功，确认新增测试脚本、题库触发词修复和现有前端构建不冲突。
- 已执行 `npm run tauri -- info` 成功，确认当前 Tauri 环境可识别 WebView2、MSVC、Rust/Cargo、Node/npm 和项目配置。
- 已启动 `npm run tauri:dev`，Vite 在 `http://127.0.0.1:1420/` 返回 200，Rust dev command 编译并运行 `target/debug/teacher-agent.exe`。
- Windows Computer Use 自动化尝试连接失败，错误为 `failed to write kernel assets: 系统找不到指定的路径。 (os error 3)`；因此未继续做坐标式窗口点击验证。
- 已新增 Rust `run_local_smoke_check` Tauri command：验证 `ping`、SQLite 初始化、默认数学会话和消息写读；消息写读在事务内执行并回滚，避免污染真实会话。
- 已在设置页“本地数据库”区域新增“运行本地自检”按钮，展示 ping、数据库路径、默认会话、消息写读和事务回滚结果。
- 已新增 Rust 单元测试覆盖本地自检的消息写读和回滚确认；`cargo test` 当前 10 条测试通过。
- 已执行 `cargo fmt`、`cargo check`、`cargo test`、`npm run test` 和 `npm run build` 成功，确认本地自检 command、前端设置页入口和现有题库/知识库测试不冲突。
- 用户在 Tauri 窗口中发现应用级导航未显示，实际只剩对话页内部“会话”区域可点击；已将 `App.vue` 从 Vuetify `v-navigation-drawer` 改为稳定的 CSS 侧边栏导航，明确展示“对话辅导”和“设置”入口。
- 已修正聊天页布局：应用壳使用固定视口网格，`chat-view` 固定在 `100dvh` 内，消息列表单独滚动，输入框和发送按钮保持可见，避免页面整体滚动导致可交互区域被挤出。
- 已新增 TutorOrchestrator Planner 单元测试，确认用户请求“今天怎么复习”时，不需要 LLM Provider 也能返回规则版 PlannerAgent 规划、通过护栏，并带上 plannerResult。
- 已执行 `npm run test` 成功，当前 4 个测试文件、8 条测试通过；已执行 `npm run build` 成功，确认导航/布局修复和 Planner 测试不破坏前端构建。
- 已新增 `docs/review-handoff.md`，集中记录当前阶段、已完成工作、验证命令、review 重点、已知限制和下一步建议，便于用户进行全面 review。
- 已读取并处理 `docs/project_review.md` 的本轮全面 review：修复 F-01 Guardrail 内部标签泄露检测，覆盖 `answer_for_internal_review_only`、`solution_steps_for_internal_review_only`、`student_visible_policy` 和 `tool_result` 等内部标签。
- 已新增 `src/engine/agents/guardrailAgent.test.ts`，验证内部答案、内部步骤和学生可见策略标签一旦进入学生可见回复，会被规则护栏拦截并要求重写。
- 已修复 F-05 消息列表自动滚动：`ChatView.vue` 新增 `messageListEl` 和 `scrollMessagesToBottom()`，在发送消息、导师占位消息、导师回复更新、错误回退和历史消息加载后滚动到底部。
- 已同步更新 `docs/project_review.md` 的 F-01/F-05 状态、结论和下一步建议。
- 已执行 `npm run test` 成功，当前 5 个测试文件、9 条测试通过；已执行 `npm run build` 成功，确认 review 修复不破坏前端测试和构建。
- 已继续处理 review F-04：设置页“测试模型连接”不再隐式调用保存配置；测试只使用当前表单和已保存的 `apiKeyRef`，新输入 API Key 必须先保存到系统凭据存储后再测试。
- 已调整 Provider 保存流程：API Key 写入系统凭据存储成功后立即清空密码框，减少明文 Key 在页面状态中的停留时间。
- F-04 后已再次执行 `npm run build` 成功；后续 F-08 验证中已成功重跑 `npm run test`。
- 已继续处理 review F-08：Guardrail 规则补充英文最终答案、完整解法、隐私索取和羞辱语气检测，降低英语学科对话中英文风险话术绕过规则护栏的概率。
- 已扩展 `src/engine/agents/guardrailAgent.test.ts`，新增英文最终答案、英文隐私请求和英文羞辱语气测试样例。
- 已同步 `docs/project_review.md`，将 F-08 标记为已修复，并从 Phase 1 准备清单中移除“Guardrail 英文正则”待办。
- 已执行 `npm run test` 成功，当前 5 个测试文件、12 条测试通过；已执行 `npm run build` 成功，确认 F-04/F-08 修复不破坏前端测试和构建。
- 已继续处理 review F-02：将 `ChatView.vue` 中原本一函数两用的 `createMessageToolRefsJson()` 拆分为 `createTutorTurnToolRefsJson()` 和 `serializeMessageToolRefs()`，明确 Tutor 轮次元数据构造与消息落库兜底序列化的边界。
- 已同步 `docs/project_review.md`，将 F-02 标记为已修复。
- F-02 后已再次执行 `npm run test` 成功，当前 5 个测试文件、12 条测试通过；已再次执行 `npm run build` 成功。
- 已继续处理 review F-03：`src/stores/app.ts` 将 `llmProviderConfig` 改为 `Omit<LlmProviderConfig, "apiKey">`，从类型层面禁止 Pinia store 保存明文 API Key。
- 已调整 `SettingsView.vue`：不再从 store 初始化 `apiKey`，保存 Provider 配置时只向 store 写入 `apiKeyRef`，保存成功后继续清空密码框。
- 已同步 `docs/project_review.md`，将 F-03 标记为已修复。
- F-03 后已执行 `npm run test` 成功，当前 5 个测试文件、12 条测试通过；已执行 `npm run build` 成功。
- 已继续处理 review F-07：新增 `src/utils/text.ts` 和 `src/utils/subject.ts`，提取 `uniqueStrings`、`uniqueTrimmedStrings`、`truncateText`、`createId` 和 `subjectLabel` 等公共纯函数。
- 已将 ReflectionAgent、AssessmentAgent、PlannerAgent 和 LearningMemoryService 改为复用公共工具，移除各自重复的 `subjectLabel()`、`unique()`、`truncate()`、`createId()` 实现。
- 已同步 `docs/project_review.md`，将 F-07 标记为已修复。
- F-07 后已执行 `npm run test` 成功，当前 5 个测试文件、12 条测试通过；已执行 `npm run build` 成功。
- 已开始推进 Phase 1 预备项“ChatView 拆子组件”：新增 `src/components/chat/PlannerSignalPanel.vue`，把 Planner 观测面板、规划信号分组和置信度格式化逻辑从 `ChatView.vue` 中拆出。
- `ChatView.vue` 现在只负责在消息存在 `plannerResult` 时渲染 `PlannerSignalPanel`，聊天收发、持久化和 Planner 面板展示职责进一步分离。
- 已同步 `docs/project_review.md`，将“ChatView 拆子组件”更新为已先拆出 PlannerSignalPanel、后续可继续拆会话列表/消息列表。
- PlannerSignalPanel 拆分后已执行 `npm run test` 成功，当前 5 个测试文件、12 条测试通过；已执行 `npm run build` 成功。
- 已继续推进 “ChatView 拆子组件”：新增 `src/components/chat/ConversationSidebar.vue`，把会话历史侧栏、会话时间格式化、会话选择和新建入口从 `ChatView.vue` 中拆出。
- `ConversationSidebar` 通过 `create` / `select` 事件把用户操作交回父组件，父组件继续负责 SQLite 会话创建、加载和状态更新。
- 已同步 `docs/project_review.md`，将“ChatView 拆子组件”更新为已拆出 PlannerSignalPanel 和 ConversationSidebar。
- ConversationSidebar 拆分后已执行 `npm run test` 成功，当前 5 个测试文件、12 条测试通过；已执行 `npm run build` 成功。
- 已继续推进 “ChatView 拆子组件”：新增 `src/types/chat.ts`，集中定义 `ChatRole` 和 `ChatMessage`，供页面和聊天子组件共享。
- 已新增 `src/components/chat/MessageList.vue`，把消息列表渲染、消息角色展示、Markdown 渲染入口、PlannerSignalPanel 嵌入和消息区滚动 DOM 从 `ChatView.vue` 中拆出。
- `MessageList` 通过 `defineExpose()` 暴露 `scrollToBottom()`，父组件只保留滚动调用语义，不再直接持有消息列表 DOM。
- 已同步 `docs/project_review.md`，将“ChatView 拆子组件”更新为已拆出 PlannerSignalPanel、ConversationSidebar 和 MessageList。
- MessageList 拆分后已执行 `npm run test` 成功，当前 5 个测试文件、12 条测试通过；已执行 `npm run build` 成功。
- 已继续推进 “ChatView 拆子组件”：新增 `src/components/chat/ChatComposer.vue`，把底部输入框、发送按钮、Ctrl+Enter 发送触发和发送中禁用/加载状态从 `ChatView.vue` 中拆出。
- `ChatComposer` 通过 `v-model` 暴露草稿内容，通过 `send` 事件触发父组件原有 `sendMessage()`，父组件继续负责发送业务、持久化和 Agent 调度。
- 已同步 `docs/project_review.md`，将“ChatView 拆子组件”更新为已拆出 PlannerSignalPanel、ConversationSidebar、MessageList 和 ChatComposer。
- ChatComposer 拆分后已执行 `npm run test` 成功，当前 5 个测试文件、12 条测试通过；已执行 `npm run build` 成功。
- 已继续推进 “ChatView 拆子组件”：新增 `src/components/chat/ConversationTitleBar.vue`，把会话标题输入、保存按钮、Enter 保存和保存中状态从 `ChatView.vue` 中拆出。
- `ConversationTitleBar` 通过 `v-model` 暴露标题草稿，通过 `save` 事件触发父组件原有 `saveCurrentTitle()`，父组件继续负责 SQLite 标题更新和会话列表同步。
- 已同步 `docs/project_review.md`，将“ChatView 拆子组件”更新为已拆出 PlannerSignalPanel、ConversationSidebar、ConversationTitleBar、MessageList 和 ChatComposer。
- ConversationTitleBar 拆分后已执行 `npm run test` 成功，当前 5 个测试文件、12 条测试通过；已执行 `npm run build` 成功。
- 已继续处理 review F-10：新增 `src-tauri/src/models.rs`，将 Rust 后端 Tauri command DTO、学习记忆 DTO、Provider DTO 和 LLM DTO 从 `src-tauri/src/lib.rs` 中拆出，先完成低风险模块化。
- F-10 拆分后已执行 `cargo fmt`、`cargo check` 和 `cargo test` 成功；Rust 测试当前 10 条通过。
- 已继续处理 review F-10：新增 `src-tauri/src/database.rs`，将数据库路径解析、SQLite 打开、migration 执行和已应用 migration 读取逻辑从 `src-tauri/src/lib.rs` 中拆出。
- database 模块拆分后已再次执行 `cargo fmt`、`cargo check` 和 `cargo test` 成功；Rust 测试当前 10 条通过。
- 已继续处理 review F-10：新增 `src-tauri/src/provider.rs`，将 Provider 配置保存/读取、系统凭据存储、OpenAI-compatible 非流式请求、Provider 错误分类和脱敏日志从 `src-tauri/src/lib.rs` 中拆出。
- provider 模块拆分后已再次执行 `cargo fmt`、`cargo check` 和 `cargo test` 成功；Rust 测试当前 10 条通过。
- 已继续处理 review F-10：新增 `src-tauri/src/conversation.rs`，将默认会话、会话列表、会话创建/改名、消息保存/读取和相关 row mapper 从 `src-tauri/src/lib.rs` 中拆出。
- conversation 模块拆分后已做静态核对；当时尝试执行 `cargo fmt` 时被当前环境额度限制拦截，后续已在 2026-07-01 补跑 `cargo fmt` / `cargo check` / `cargo test` 并通过。
- 已新增 `docs/rust-module-map.md`，记录 Rust 后端当前模块职责、依赖方向、`conversation.rs` 拆分后的验证状态，以及后续 `memory.rs`、`assessment.rs`、`knowledge.rs`、共享 helper 的建议拆分顺序。
- 已同步 `src-tauri/README.md` 和 `docs/project-governance.md`，把 Rust 模块边界文档纳入后续维护入口。
- 已同步 `AGENTS.md` 和 `CLAUDE.md` 的默认阅读清单，将 `docs/rust-module-map.md` 加入 Codex / Claude Code 开发入口，并明确 Rust 后端模块边界以该文档为准。
- 已新增 `docs/verification-checklist.md`，把 MVP 验收转为可执行清单，覆盖自动命令、Tauri 窗口、本地数据库、Provider 安全、教学链路、持久化和 Guardrail 验证。
- 已同步 `AGENTS.md`、`CLAUDE.md` 和 `docs/project-governance.md`，将 `docs/verification-checklist.md` 纳入后续开发与 review 入口。
- 已新增 `docs/phase0-execution-plan.md`，把 Phase 0 剩余工作拆成 P0-P5 批次：先补跑 `conversation.rs` 拆分后的 Rust 验证，再验证 Tauri 窗口、SQLite、Provider 安全、教学链路和持久化闭环。
- 已同步 `AGENTS.md`、`CLAUDE.md` 和 `docs/project-governance.md`，将 `docs/phase0-execution-plan.md` 纳入 Codex / Claude Code 后续执行入口。
- 已完成 Phase 0 P0 验证：`conversation.rs` 拆分后已补跑 `cargo fmt`、`cargo check`、`cargo test`，全部通过；Rust 测试当前 10 条通过、0 失败。
- 已同步 `docs/rust-module-map.md`、`src-tauri/README.md`、`docs/review-handoff.md` 和 `docs/project_review.md`，移除 `conversation.rs` 待补跑标记，并将下一步推进点更新为 P1 桌面窗口与本地数据库验证。
- 已推进 Phase 0 P1 桌面运行验证：通过后台启动 `npm run tauri:dev`，`http://127.0.0.1:1420/` 返回 200，`teacher-agent.exe` 进程存在，Windows UI Automation 能识别 `TeacherAgent` Tauri 窗口。
- P1 实测发现对话页发送按钮不可点击；已将 `ChatComposer.vue` 的发送按钮从 Vuetify `v-btn` 改为原生 `button`，组件内部用 `canSend` 明确控制空输入/发送中状态，并保留 `Ctrl+Enter` 发送。
- 已为原生发送按钮补充稳定样式、hover、focus-visible 和 disabled 状态，降低 Tauri 窗口中点击代理或可点击区域不稳定的风险。
- 发送按钮修复后已执行 `npm run test` 成功：5 个测试文件、12 条测试通过；已执行 `npm run build` 成功。
- 后续实测截图确认底部输入框本身未正常显示，导致 `draft` 一直为空、发送按钮保持禁用；已将 `ChatComposer.vue` 的 `v-textarea` 也改为原生 `textarea`，并补充 `.composer-input` 边框、高度、placeholder、focus 和 disabled 样式，确保 Tauri 窗口中输入区可见可输入。
- 原生输入框修复后已再次执行 `npm run test` 成功：5 个测试文件、12 条测试通过；已再次执行 `npm run build` 成功。
- 为降低同类 Tauri WebView 点击代理风险，已将关键操作入口继续原生化：`ConversationSidebar.vue` 的新建会话按钮、`ConversationTitleBar.vue` 的保存标题按钮、`SettingsView.vue` 的 Provider 测试/保存、IPC ping、初始化 SQLite、运行本地自检按钮均改为原生 `button`。
- 已新增统一 `.action-button`、`.action-button-primary`、`.action-button-secondary`、`.icon-action-button` 样式，覆盖 hover、focus-visible、disabled 和小尺寸图标按钮状态。
- 关键按钮原生化后已执行 `npm run test` 成功：5 个测试文件、12 条测试通过；已执行 `npm run build` 成功。
- 已补充 `TutorOrchestrator` 无 Provider 分叉测试：规划请求“今天我该怎么复习极限与连续？”仍不创建 LLM Provider、返回规则版 PlannerAgent；普通问题“什么是极限？”在无 Provider 时会明确要求配置 LLM Provider，不会误走 Planner。
- 无 Provider 分叉测试补充后已执行 `npm run test` 成功：5 个测试文件、13 条测试通过；已执行 `npm run build` 成功。
- 已将 `ChatComposer` 的真实发送资格规则抽为 `canSendDraft()`，并新增单元测试覆盖空白输入不可发送、有内容可发送、发送中不可发送，防止对话输入区回退为“按钮一直禁用”。
- ChatComposer 状态测试补充后已执行 `npm run test` 成功：6 个测试文件、15 条测试通过；已执行 `npm run build` 成功。
- 已完成当前 Phase 0 全量验证：`npm run test` 通过（6 个测试文件、15 条测试）、`npm run build` 通过、`cargo fmt` 通过、`cargo check` 通过、`cargo test` 通过（10 条 Rust 测试）。
- 全量验证后已重新启动 `npm run tauri:dev`，`http://127.0.0.1:1420/` 返回 200，`teacher-agent.exe` 进程存在，可继续进行窗口内人工验证。
- 已补充 Provider 安全测试：`OpenAICompatibleProvider` 在存在 `apiKeyRef` 时必须委托 Rust `complete_llm_chat`，不得调用浏览器 `fetch`；非本地 Provider 没有 `apiKeyRef` 或运行时 key 时会在请求前失败，也不会调用 `fetch`。
- Provider 安全测试补充后已执行 `npm run test` 成功：7 个测试文件、17 条测试通过；已执行 `npm run build` 成功。
- 已将设置页 Provider 按钮启用规则抽为 `providerFormState.ts` 纯函数，并新增测试覆盖：基础配置必填、远程 Provider 保存规则、测试连接必须先保存为 `apiKeyRef`、本地 Provider 不需要 key。
- Provider 表单状态测试补充后已执行 `npm run test` 成功：8 个测试文件、21 条测试通过；已执行 `npm run build` 成功。
- 已补充 TutorOrchestrator Guardrail 重写路径测试：当 Provider 草稿包含 `answer_for_internal_review_only` / `solution_steps_for_internal_review_only` 等内部题库标签时，Orchestrator 会先触发 Guardrail 审核与一次重写，最终学生可见回复不包含内部答案或步骤标签。
- Guardrail 重写路径测试补充后已执行 `npm run test` 成功：8 个测试文件、22 条测试通过；已执行 `npm run build` 成功。
- 已补充 TutorOrchestrator 练习请求 prompt 防泄露测试：`给我一道夹逼定理练习` 会触发 `question_bank_search`，但发给 Provider 的 practice prompt 不包含 `answer_for_internal_review_only` / `solution_steps_for_internal_review_only` 内部答案或步骤标签，学生可见回复也不包含内部标签。
- 练习 prompt 防泄露测试补充后已执行 `npm run test` 成功：8 个测试文件、23 条测试通过；已执行 `npm run build` 成功。
- 已补充 TutorOrchestrator 复盘请求 prompt 边界测试：`帮我复盘这道夹逼定理题` 会把 `answer_for_internal_review_only` / `solution_steps_for_internal_review_only` 放入 review prompt 供导师参考，但最终学生可见回复不包含内部答案或步骤标签。
- 复盘 prompt 边界测试补充后已执行 `npm run test` 成功：8 个测试文件、24 条测试通过；已执行 `npm run build` 成功。
- 已将 Planner 历史消息元数据解析从 `ChatView.vue` 抽为 `src/components/chat/chatMessageMetadata.ts` 纯函数；`ChatView` 重新加载历史消息时继续从 `tool_refs_json.plannerResult` 恢复 `PlannerResult`，用于展示 Planner 信号面板。
- 已新增 `src/components/chat/chatMessageMetadata.test.ts`，覆盖 Planner 元数据正常恢复、旧元数据缺少信号数组时的安全默认值、坏 JSON / 非 Planner 元数据安全忽略。
- Planner 历史元数据恢复测试补充后已执行 `npm run test` 成功：9 个测试文件、27 条测试通过；已执行 `npm run build` 成功。
- 已继续扩展 `chatMessageMetadata.ts`，将 StoredMessage 列表恢复为学生可见 `ChatMessage` 列表的映射也抽为纯函数；恢复时只保留 `student` / `tutor` 消息，保留 `knowledgeRefsJson`、`toolRefsJson`、`guardrailJson`，并从 `tool_refs_json` 恢复 Planner 结果。
- StoredMessage 恢复映射测试补充后已执行 `npm run test` 成功：9 个测试文件、28 条测试通过；已执行 `npm run build` 成功。
- 已继续扩展 `chatMessageMetadata.ts`，将保存消息时的 `tool_refs_json` 序列化抽为 `serializeChatMessageToolRefs()`；已有 `toolRefsJson` 原样保留，无元数据写入 `[]`，只有 `plannerResult` 时写出可被 `parsePlannerResultFromToolRefs()` 恢复的结构。
- Planner `tool_refs_json` 写入侧测试补充后已执行 `npm run test` 成功：9 个测试文件、30 条测试通过；已执行 `npm run build` 成功。
- 已将 Tutor 轮次完整 `tool_refs_json` 构造抽为 `createTutorTurnToolRefsJson()`；构造结果只保存 Provider、Prompt 版本、Socratic 策略、工具命中数量/id、数学计算状态和 AssessmentResult id 等结构化摘要。
- 已新增 Tutor 轮次元数据隐私测试，确认 `tool_refs_json` 不保存 `rawDraft`、完整工具上下文、`answer_for_internal_review_only`、`solution_steps_for_internal_review_only` 或内部步骤文本。
- Tutor 轮次元数据隐私测试补充后已执行 `npm run build` 成功；修正测试假数据 schema 后再次执行 `npm run test` 成功：9 个测试文件、31 条测试通过。
- 已将 Guardrail 落库摘要抽为 `createGuardrailSummaryJson()`，`ChatView` 现在只保存 `allowed`、`source`、`maxHintLevelDetected`、`violations`、`rewriteRequired` 和 `rewriteAttempts`，不保存 `rewriteInstruction`、`fallbackReply` 或候选草稿长文本。
- 已新增 Guardrail 摘要隐私测试，确认 `guardrail_json` 不保存改写指令、兜底回复、内部答案标签或“完整答案”等长文本，并已补跑验证通过。
- Guardrail 摘要隐私测试补充后已执行 `npm run test` 成功：9 个测试文件、32 条测试通过；已执行 `npm run build` 成功。
- 已将 `knowledge_refs_json` 构造抽为 `createKnowledgeRefsJson()`；导师消息落库时只保存知识点 `id/title/subjectCode` 引用，不保存 RAG 摘要、常见误区、苏格拉底提示或内部检索说明。
- 知识引用元数据隐私测试补充后已执行 `npm run test` 成功：9 个测试文件、33 条测试通过；已执行 `npm run build` 成功。
- 已扩展 Rust `saves_and_lists_conversation_messages` 测试：学生消息缺省元数据会保存并读回为 `knowledge_refs_json = []`、`tool_refs_json = []`、`guardrail_json = {}`；导师消息的三类 JSON 元数据可通过 SQLite 保存和读取。
- Rust 消息元数据往返测试扩展后已执行 `cargo fmt`、`cargo check`、`cargo test` 成功；Rust 测试当前 10 条通过。
- 根据窗口实测反馈修复发送按钮“看起来仍被禁用”的交互：`ChatComposer` 现在仅在发送中禁用按钮；草稿为空时点击发送会聚焦输入框但不会发送空消息，保留 `canSendDraft()` 作为真实发送前置条件。
- 已加重对话输入区视觉边界：底部 composer 增加分隔线，textarea 边框和背景更明显，降低白底中输入框不可见导致误判按钮不可用的概率。
- 发送按钮交互修复后已执行 `npm run test` 成功：9 个测试文件、34 条测试通过；已执行 `npm run build` 成功。
- 已进一步把 ChatComposer 的“真实发送资格”“按钮禁用状态”“点击发送后的动作”拆成独立纯函数；测试明确覆盖空草稿点击发送会聚焦输入框、有内容才发送、只有发送中才禁用按钮。
- ChatComposer 交互语义测试补充后已执行 `npm run test` 成功：9 个测试文件、37 条测试通过；已执行 `npm run build` 成功。
- 根据设置页实测反馈修复 LLM Provider 无法配置问题：`SettingsView.vue` 的 Provider 名称、Base URL、模型、API Key 和本地 Provider 开关已从 Vuetify `v-text-field` / `v-switch` 改为原生 `input` / `checkbox`，避免 Tauri 窗口中输入控件不可见导致按钮一直禁用。
- 同步将教学偏好学科选择改为原生 `select`，降低同类 Vuetify 表单控件在 Tauri WebView 中不可见或不可交互的风险。
- Provider 表单原生化后已执行 `npm run test` 成功：9 个测试文件、37 条测试通过；已执行 `npm run build` 成功。
- 已调整 Provider 操作顺序：设置页现在先显示“保存本次运行配置”主按钮，再显示“测试模型连接”次按钮，匹配 API Key 先写入系统凭据存储、测试连接再使用 `apiKeyRef` 的安全流程。
- 已为 `saveProviderConfig()` 和 `testProvider()` 增加函数级前置保护，避免通过表单 Enter 提交或异常触发绕过按钮禁用条件。
- Provider 操作顺序和前置保护调整后已执行 `npm run test` 成功：9 个测试文件、37 条测试通过；已执行 `npm run build` 成功。
- 已将会话标题栏的 `v-text-field` 改为原生 `input`，并补充 `.conversation-title-input` 稳定样式；核心 `src/views` 和 `src/components` 中已无 `v-text-field`、`v-switch`、`v-select` 残留，降低 Tauri WebView 表单控件不可见风险。
- 会话标题输入框原生化后已执行 `npm run test` 成功：9 个测试文件、37 条测试通过；已执行 `npm run build` 成功。
- 根据 MiMo Provider 实测修复 OpenAI-compatible 差异：小米 MiMo 接口要求 `api-key` 请求头和 `max_completion_tokens` 参数，而不是标准 `Authorization: Bearer` 和 `max_tokens`。Rust `complete_llm_chat` 现在会根据 Provider 名称、Base URL 或模型中的 `mimo` / `xiaomimimo.com` 自动切换兼容请求格式。
- 已同步前端 runtime-key fallback 的 MiMo 兼容请求格式，并新增测试确认 MiMo fallback 使用 `api-key`、`max_completion_tokens`，不会发送 `max_tokens`。
- MiMo Provider 兼容修复后已执行 `npm run test` 成功：9 个测试文件、38 条测试通过；已执行 `npm run build` 成功；已执行 `cargo fmt`、`cargo check`、`cargo test` 成功，Rust 测试当前 12 条通过。
- 根据 MiMo 仍返回 `400 Param Incorrect` 的反馈，进一步贴近用户 PowerShell 成功样例：MiMo 请求会补充 `top_p = 0.95`、`stop = null`、`frequency_penalty = 0`、`presence_penalty = 0`；MiMo 的 `temperature <= 0` 会归一为 `1.0`；设置页测试连接对 MiMo 使用 `temperature = 1` 和 `max_completion_tokens = 1024`。
- 上述 MiMo 二次兼容改动已由 Claude Code 补跑自动验证通过：`npm run test`（9 个测试文件、38 条测试通过）、`npm run build`（vue-tsc + vite build 成功）、`cargo fmt`（格式化干净）、`cargo check`（编译通过）、`cargo test`（13 条 Rust 测试通过）。
- 已完成 Phase 0 P2 Provider 安全验证：MiMo Provider 连接成功（mimo-v2.5-pro，耗时 4728ms）。
- 已完成 Phase 0 P3 教学链路验证（配置 Provider 后）：
  - `什么是极限？` → 简短解释 + 引导问题 ✓
  - `直接告诉我答案` → 不直接给最终答案，引导思考 ✓
  - `给我一道夹逼定理练习` → 只展示题目和提示，不泄露答案 ✓
  - `帮我复盘这道夹逼定理题` → 完整复盘，内部答案不暴露给学生 ✓
- P3 验证发现 P1 性能问题：响应延迟约 30 秒，需要实现 sentence-buffered streaming 优化。
- 已将 TutorOrchestrator 的流式输出改造为句子级缓冲（Sentence-Buffered Streaming）：按句号、问号、感叹号等标点缓冲合并，在整句输出前用 Guardrail 规则快速检查，有效降低了首字延迟，同时避免违规文字立刻上屏。
- 修复了 P3 实机对话中的“句子截断”问题：大模型返回带深度思考过程时，如果在思考结束前达到了 `maxTokens: 900` 的限制会导致 `finish_reason: "length"` 提前终止，导致无实质输出。已将 `tutorOrchestrator.ts` 中流式与非流式请求的 `maxTokens` 默认限制放宽至 4096。
- 修复了 `openAiCompatibleProvider.ts` 处理网络流末尾边界情况的问题：当模型最后一个数据块没有以 `\n\n` 结尾时，原有缓冲逻辑会将其忽略导致丢字。已补充强制刷新剩余 `buffer` 的逻辑，并提升了对不规范 `data:` 前缀的 JSON 解析容错率。
- 已更新 `docs/phase0-execution-plan.md`，将 P2/P3 标记为已完成，P4 添加详细验证步骤。
- 已完成 Phase 0 P4 持久化闭环验证：
  - 会话持久化：新建会话后可在左侧列表看到 ✓
  - 重启后数据保留：关闭重启后会话和消息仍可查看 ✓
  - Planner 历史面板：规划信号面板显示掌握度、前置依赖和复习信号 ✓
  - 学习记忆持久化：长期记忆 6 条、短期记忆 4 条、学生画像 1 条已保存到 SQLite ✓
  - 掌握度更新：`student_knowledge` 表有 16 条记录，掌握度概率、尝试次数、正确次数均在更新 ✓
- 已新增 `src/components/chat/LearningPanel.vue`，点击 📊 按钮可查看学生画像、长期记忆和短期记忆。
- 当前 Phase 0 进度：P0-P4 全部完成，可进入 P5 阶段。

### 2026-07-02（Phase 1 开发）

- 已完成 Rust 后端模块拆分任务 3：新增 `src-tauri/src/knowledge.rs`，将 `load_student_knowledge_with_connection`、`load_knowledge_prerequisites_with_connection` 和 `row_to_student_knowledge_mastery` 从 `lib.rs` 拆出。
- 已清理 `lib.rs` 中不再使用的 `params` 导入、`clamp_probability` 函数和 `create_student_knowledge_id` 函数（这些函数已在 `assessment.rs` 中有独立实现）。
- 已更新 `docs/rust-module-map.md`：`assessment.rs` 和 `knowledge.rs` 均标记为已完成，模块表补充完整。
- 已执行全量验证：`npm run test`（9 个测试文件、38 条测试通过）、`npm run build`（通过）、`cargo fmt`（通过）、`cargo check`（无警告）、`cargo test`（15 条 Rust 测试通过）。
- 已恢复 IPC memory 调用：`TutorOrchestrator` 的 `handleTurn()` 和 `handleTurnStream()` 不再绕过 IPC 直接使用 `getLocalPromptContext`，改为调用 `learningMemoryService.getPromptContext()`（3 秒超时）和 `learningMemoryService.recordTutorTurn()`（5 秒超时）；超时时自动降级到 localStorage。
- 移除了 `tutorOrchestrator.ts` 中的 `getLocalPromptContext` 未使用导入。
- 已接入向量检索基础设施：新增 `src-tauri/src/vector.rs` 模块，实现 embedding 存储（BLOB）、余弦相似度搜索和 CRUD 操作；新增 `src-tauri/migrations/0002_vector_embeddings.sql` 创建 `vector_embeddings` 表；新增 Tauri commands `store_vector_embedding`、`search_vector_embeddings` 和 `generate_embedding`（调用 OpenAI-compatible `/v1/embeddings` 端点）；新增前端 `src/services/knowledge/vectorSearch.ts` 封装向量搜索和批量 embedding 存储；新增 `src/services/tauri/commands.ts` 前端 IPC 封装。
- 向量库只存储知识摘要、题目摘要、脱敏反思摘要和学生长期记忆摘要的 embedding，完整 prompt 不进入向量库。
- Rust 测试新增至 20 条（新增 5 条 vector 模块测试：余弦相似度、blob 往返、upsert/search/delete/count）。
- 已实现数学计算引擎：新增 `src-tauri/src/math_engine.rs` 纯 Rust 符号计算模块，支持多项式求导（x^n、a*x^n、求和）、基本函数求导（sin/cos/ln/exp）、多项式积分、表达式求值（含运算符优先级）、表达式化简、极限（直接代入/不定式检测）和线性方程求解；新增 Tauri command `compute_math_expression`；前端 `mathCompute.ts` 从 `ENGINE_UNAVAILABLE` 改为调用 Rust 引擎；`toolAgent.ts` 的 `runToolAgent` 改为 async 以支持异步计算调用。
- Rust 测试新增至 34 条（新增 14 条 math_engine 测试覆盖多项式求导、三角函数求导、求和求导、多项式求值、三角函数求值、极限、积分、方程求解、化简和数字格式化）。
- 已扩展章节级 DAG Planner：`plannerAgent.ts` 新增 `buildChapterDAG()`（从知识前置依赖构建章节 DAG）、`generateChapterDAGTasks()`（生成章节级学习任务和信号）、拓扑排序（Kahn 算法）、关键路径分析和推荐下一章算法；`PlannerResult` 新增 `chapterSignals` 字段；`PlannerSignalPanel.vue` 新增"章节路径"信号组；`chatMessageMetadata.ts` 和测试已同步更新。

### 2026-07-02（Phase 2 开发）

- 已新增练习模块：`PracticeView.vue`（练习页面）、`PracticeQuestionCard.vue`（题目卡片与多级提示）、`PracticeFeedback.vue`（答案反馈）；新增 `/practice` 路由。
- 已新增学习仪表盘：`DashboardView.vue`（掌握度分布、学习统计、会话记录）；新增 `/dashboard` 路由。
- 已实现 BKT 知识追踪算法：新增 `src-tauri/src/bkt.rs`，实现贝叶斯知识状态更新（P(L0)、P(T)、P(G)、P(S) 四参数）和掌握度计算；新增 Tauri command `bkt_update_mastery`。
- Rust 测试新增至 43 条（新增 9 条 BKT 测试）。

### 2026-07-02（Phase 3 开发）

- 已新增知识图谱可视化：`KnowledgeGraphView.vue`（SVG 节点图、掌握度着色、前置依赖连线、节点详情面板）；新增 `/knowledge-graph` 路由。

### 2026-07-02（Phase 4 开发）

- 已实现路由懒加载：所有页面路由改为动态 `import()`，首屏只加载 ChatView。
- 已扩展学科知识库：新增线性代数基础知识节点 10 个（矩阵、行列式、逆矩阵、线性方程组、向量等）+ 5 道题目；新增概率统计基础知识节点 8 个（样本空间、事件、古典概型、条件概率、独立性、随机变量、期望、方差）+ 5 道题目。
- 当前知识库总计 53 个节点（极限 35 + 线代 10 + 概率 8），题库总计 22 道题目（极限 12 + 线代 5 + 概率 5）。
- 已实现 LLM Reflection：`reflectionAgent.ts` 新增 `reflectOnTutorTurnWithLlm()` 异步函数，可调用 Provider 生成深度反思；失败时自动降级到规则版。
- Phase 4 跳过项（需用户操作）：OCR/语音输入、自动更新机制、Ollama sidecar 集成。

### 2026-07-02（MVP 验收收尾）

- 已修复对话消息调试计时污染：`ChatView.vue` 的 `sendMessage()` 不再将 `⏱ 耗时...`、`处理中...` 写入 `tutorMessage.content`；改为使用独立的 `streamingTimingText`/`streamingDraftContent` 响应式变量仅用于 UI 显示；最终写入 SQLite 的 `content` 只能是导师正式回复正文；历史会话加载时会自动清除可能残留的调试计时前缀。
- 已补齐练习模块 BKT 闭环：`PracticeView.vue` 的 `submitAnswer()` 现在使用 BKT 计算的实际掌握度变化（`bktResult.pKnow - currentPknow`）作为 `masteryDelta` 传入 `saveAssessmentResult`，而非硬编码的 `0.1/-0.05`；assessment 写入链路会通过 `apply_assessment_knowledge_updates` 更新 `student_knowledge` 表。
- 已新增练习模块 BKT 闭环测试：`src/views/practiceLogic.test.ts` 覆盖答案评估、BKT 掌握度计算和"提交练习答案会产生掌握度更新"的核心逻辑。
- 已更新生产构建配置：`vite.config.ts` 现在根据 `TAURI_ENV_DEBUG` 环境变量区分开发/生产模式；开发模式可 sourcemap、不压缩；生产默认 minify + 无 sourcemap（除非显式设置 `TAURI_ENV_SOURCEMAP=true`）。
- 已校准全部文档口径：`project-status.md`、`review-handoff.md`、`claudecode-handoff.md`、`user-action-required.md`、`src-tauri/README.md`、`src/services/README.md` 均已更新，删除旧 Phase 0/1 口径，修正测试数量（43 条 Rust 测试），明确 LLM Reflection 已接入运行链路，练习模块 BKT 闭环已完成。
- 已修复 `evaluateAnswer` 数值比较：数字答案做严格数值比较，不再用 substring includes（`"10"` vs `"0"` 不再误判为正确）；从文本中提取嵌入数字做数值匹配。
- 已抽出 `submitPracticeAnswer` 服务函数：从 PracticeView 抽出独立模块，PracticeView 和测试共用；覆盖 BKT 调用、saveAssessmentResult 调用、conversationId 来源、knowledgeSnapshots 非空、保存失败反馈等流程测试。
- 已修复练习页持久化闭环：conversationId 使用 `ensureDefaultConversation` 返回的真实 id（避免外键失败）；knowledgeSnapshots 非空（确保 knowledge_nodes 存在后 student_knowledge 可更新）；保存失败时 UI 显示"练习结果未保存"提示。
- 已修复流式输出阻塞：`handleTurnStream` 的 `persistAssessmentResult` 和 `recordTutorTurn` 改为 fire-and-forget，不阻塞 UI 显示；ChatView 的 `onStreamUpdate(done=true)` 回调中立即设置 `tutorMessage.content`。
- 已修复流式公式渲染：流式阶段使用 `MessageRenderer` 渲染 Markdown/KaTeX，不再用纯文本插值。
- 已清理 LLM debug 日志：移除 `provider.rs` 中的 `request_body`、`auth_mode`、`endpoint` 三行 `eprintln!`，只保留结构化 `log_llm_provider_event`。
- MVP 实机验证通过：5 个页面正常渲染和交互，MiMo Provider 对话正常，练习 BKT 闭环正常，流式公式渲染正常，Reflection 不阻塞前台。

### 2026-07-02（Phase 1 RAG 本地检索）

- 已新增 Rust `seed.rs` 模块：实现知识节点入库（`seed_knowledge_nodes`）、计数（`count_knowledge_nodes`）和 keyword 搜索（`search_knowledge_nodes_by_keyword`）。
- 已新增 3 个 Tauri command：`seed_knowledge_nodes_from_json`、`count_knowledge_nodes`、`search_knowledge_from_db`。
- 已新增前端 `knowledgeIndexer.ts`：编排 seed 流程，启动时自动将 53 个 JSON seed 节点写入 SQLite `knowledge_nodes` 表；已 seed 时不重复写库（先 count 再决定是否 seed）。
- 已更新 `toolAgent.ts`：知识检索优先查 SQLite 数据库，数据库无结果或不可用时降级到 JSON seed 搜索。
- 已更新 `ChatView.vue`：`initializeConversation()` 中调用 `seedAllKnowledgeNodes()`，确保知识节点入库。
- 已改进中文自然句搜索：`extract_search_tokens()` 提取中文 2 字组合 + ASCII 单词，"什么是极限？"可命中"极限的直观含义"，"解释夹逼定理"可命中"夹逼定理"。
- 已修复 difficulty 字段入库：`SeedNode` 新增 `difficulty` 字段（默认 1，clamp 1-5），入库时保留真实 difficulty。
- 已修复 seed 不重复写库：`seed_knowledge_nodes` 改为 INSERT OR SKIP（已存在则跳过，不 UPDATE，避免刷新 `updated_at`）。
- Rust 测试新增至 51 条（新增 5 条 seed 测试：中文自然句搜索、difficulty 入库、跳过已存在节点）。
- 前端测试新增至 77 条（新增 5 条 ToolAgent 测试：DB 命中优先、空结果降级、异常降级、参数传递、禁用时不调用）。
- 当前是 SQLite keyword RAG，不是 vector RAG；vector/embedding 仍是 Phase 2。

### 2026-07-02（Phase 2 核心功能）

- **向量搜索集成到 ToolAgent**：`toolAgent.ts` 新增向量搜索优先路径，优先级为向量搜索（需 embedding provider）→ 数据库 keyword → JSON seed。
- **sqlite-vec 尝试**：尝试集成 `sqlite-vec 0.1.10-alpha.4`，但 Windows 编译失败（缺少 `sqlite-vec-diskann.c`），已回退到 brute-force cosine similarity。后续版本修复后可重新启用。
- **自适应题目推荐引擎**：新增 `src/services/practice/questionRecommender.ts`，实现基于维果茨基"最近发展区"原理的难度推荐：
  - 掌握度 < 0.3 → 难度 1；0.3-0.5 → 难度 1-2；0.5-0.7 → 难度 2-3；0.7-0.85 → 难度 3-4；> 0.85 → 难度 4-5
  - 连续正确且提示少 → 提升难度；连续错误 → 降低难度；提示使用多 → 降低难度
- **练习模块自适应推荐**：`PracticeView.vue` 集成推荐引擎，答题后自动推荐下一题；新增掌握度进度条显示。
- **仪表盘可视化**：`DashboardView.vue` 引入 `chart.js` + `vue-chartjs`，新增雷达图展示各知识点掌握度分布；新增知识点覆盖率统计（已学 / 总 53 个节点）。
- 前端测试新增至 94 条（新增 17 条 questionRecommender 测试：难度推荐、下一题推荐、提示阶梯文案）。
- `package.json` 新增依赖：`chart.js`、`vue-chartjs`。

### 2026-07-02（冷启动默认掌握度修复）

- 已修复冷启动默认掌握度逻辑：新学生（`studentKnowledge` 为空）的默认整体掌握度从 0/0.3 统一调整为 0.5（中等水平）。
- 修改点：
  - `questionRecommender.ts`：`avgMastery` 空数组默认值 0.3 → 0.5；未知节点默认掌握度 0.3 → 0.5。
  - `PracticeView.vue`：`averageMastery` 冷启动默认值 0 → 0.5。
  - `DashboardView.vue`：`overallMastery` 冷启动默认值 0 → 0.5。
- 效果：新学生首次进入时，练习模块推荐难度 2-3 的中等题（而非难度 1），仪表盘显示 50% 掌握度（而非 0%）。
- 新增冷启动测试用例：空掌握度数组默认 0.5，推荐难度 2-3。
- 前端测试新增至 95 条。

### 2026-07-02（Phase 3 核心功能）

- **知识图谱天赋树可视化**：`KnowledgeGraphView.vue` 引入 `v-network-graph` 库，从 SVG 静态图升级为交互式网络图。
  - 节点颜色绑定掌握度：≥0.8 绿色（已点亮）、≥0.4 橙色（学习中）、<0.4 灰色（未解锁）。
  - 支持点击节点查看详情（掌握度、练习次数、前置知识）。
  - 层级布局基于前置依赖的拓扑排序。
- **学习路径智能规划器**：新增 `src/components/learning/LearningPathPanel.vue`，集成到 DashboardView。
  - 导出 `plannerAgent.ts` 中的 `topologicalSort`、`findCriticalPath`、`findRecommendedNext` 函数。
  - 基于拓扑排序生成线性学习路径，过滤已掌握节点（≥0.8）。
  - 显示当前推荐学习节点、完成进度、掌握度条。
- **Ollama 本地引擎集成**：
  - 新增 `src-tauri/src/ollama.rs`：`check_ollama_status`（检测 localhost:11434）、`start_ollama_engine`（后台启动 ollama serve）。
  - 新增 2 个 Tauri command：`check_ollama_status`、`start_ollama_engine`。
  - `SettingsView.vue` 新增"本地大模型引擎"区域：状态指示灯、一键启动/重启按钮。
  - `Cargo.toml` 新增 `reqwest` 的 `blocking` feature。
- `package.json` 新增依赖：`v-network-graph`。

### 2026-07-02（知识库 Pack / 懒加载基础设施）

- **问题**：ChatView chunk 达到 566.45 kB，超过 500 kB 警告阈值。主要原因是 `knowledgeIndexer.ts`、`localKnowledgeSearch.ts` 和 `localQuestionBankSearch.ts` 静态导入了所有 20 个 seed JSON 文件（10 个知识库 + 10 个题库），导致这些数据在构建时被打包进主 chunk。
- **解决方案**：实现知识库 pack manifest 和懒加载机制。
- **新增文件**：
  - `src/services/knowledge/packManifest.ts`：知识库包清单定义，包含所有 10 个知识库包的元信息（路径、学科、预期数量）。
  - `src/services/knowledge/packLoader.ts`：懒加载器实现，使用 `import()` 动态导入避免静态打包，内置缓存机制。
- **修改文件**：
  - `src/services/knowledge/knowledgeIndexer.ts`：移除静态导入，改为使用 `loadAllKnowledgePacks()` 懒加载。
  - `src/services/knowledge/localKnowledgeSearch.ts`：移除静态导入，新增 `searchLocalKnowledgeLazy()` 异步版本。
  - `src/services/questions/localQuestionBankSearch.ts`：移除静态导入，新增 `searchLocalQuestionBankLazy()` 异步版本。
  - `src/engine/agents/toolAgent.ts`：使用懒加载版本的搜索函数。
  - `src/services/knowledge/localKnowledgeSearch.test.ts`：改用异步版本。
  - `src/services/questions/localQuestionBankSearch.test.ts`：改用异步版本。
- **验证结果**：
  - 测试通过：13 个测试文件，126 个测试用例全部通过。
  - 构建成功：TypeScript 编译和 Vite 构建均无错误。
  - **Chunk 体积减小**：
    - ChatView: 566.45 kB → 458.22 kB（**减少 108.23 kB，降幅 19.1%**）
    - localQuestionBankSearch: 60.94 kB → 7.29 kB（**减少 53.65 kB，降幅 88%**）
    - ChatView 现在低于 500 kB 警告阈值。
- **关键特性**：
  - 懒加载：只在需要时才加载 seed 数据，避免初始打包膨胀。
  - 缓存机制：加载后的数据会被缓存，避免重复加载。
  - 向后兼容：保留同步版本接口，现有调用者无需立即修改。
  - 按需加载：搜索时只加载相关学科的 pack，而非全部。
  - 错误处理：加载失败不会阻断主流程，有完善的 fallback 机制。

### 2026-07-03（知识库 Pack 懒加载修复）

- **问题 1**：`@vite-ignore` 导致生产构建中 seed JSON 未被打包，Tauri 生产环境加载失败。
  - **修复**：改用 `import.meta.glob("../../../data/knowledge/*.seed.json")` 和 `import.meta.glob("../../../data/questions/*.seed.json")`。Vite 在构建时静态分析 glob 模式，将匹配的 JSON 文件打包为独立 chunk，运行时由 Vite 管理路径和懒加载。
  - **结果**：dist 中生成 20 个 seed JSON 独立 chunk（10 knowledge + 10 question），生产环境可正常访问。
- **问题 2**：`PracticeView.vue` 仍调用同步 `searchLocalQuestionBank()`，该接口已废弃返回空结果，导致练习页无题目。
  - **修复**：`loadQuestions` 改为 async，使用 `searchLocalQuestionBankLazy()`，增加 `isLoadingQuestions` / `loadError` 状态，模板增加 loading 和 error UI。
- **问题 3**：`packManifest.ts` 中 `expectedQuestionCount` 与实际 JSON 数据不一致。
  - **修复**：按实际数据修正（math-limits: 12, linear-algebra-basics: 5, probability-basics: 5, math-derivatives: 9, math-applications-of-derivatives: 8, math-indefinite-integrals: 8, math-definite-integrals: 7, math-integral-applications: 7, math-mean-value-theorems: 7, math-multivariable-calculus: 7）。
  - **新增测试**：`packManifest.test.ts` 遍历 PACK_MANIFEST，加载每个 pack 并断言 expectedNodeCount/expectedQuestionCount 与实际数据一致。
- **新增测试**：`localKnowledgeSearch.test.ts` / `localQuestionBankSearch.test.ts` 增加废弃同步接口测试，验证返回空结果。
- **验证结果**：
  - 测试通过：14 个测试文件，148 个测试用例全部通过。
  - 构建成功：dist 中生成 20 个 seed JSON 独立 chunk。
  - ChatView chunk: 458.22 kB（低于 500 kB 警告阈值）。
  - localQuestionBankSearch chunk: 10.09 kB。
  - PracticeView chunk: 14.26 kB。
  - Rust: 58 条测试通过。

### 2026-07-03（CS408 知识库 Pack 接入）

- **数据来源**：QoderWork 产出的 CS408（408考研）知识库，以 draft pack 形式接入。
- **新增文件**：
  - `data/knowledge/cs408-data-structures.seed.json`：数据结构，40 知识节点
  - `data/knowledge/cs408-computer-organization.seed.json`：计算机组成原理，40 知识节点
  - `data/knowledge/cs408-operating-systems.seed.json`：操作系统，40 知识节点
  - `data/knowledge/cs408-computer-networks.seed.json`：计算机网络，40 知识节点
  - `data/questions/cs408-*.seed.json`：对应 4 个题库，各 40 题
- **全库总计**：282 知识节点 / 251 道题（数学 122/91 + CS408 160/160）
- **代码改动**：
  - `SubjectCode` 新增 `"cs408"`
  - `packManifest.ts` 新增 4 个 CS408 pack
  - `subjectStyle.ts` / `plannerAgent.ts` 新增 cs408 学科风格和学习计划
  - `PracticeView` / `KnowledgeGraphView` / `DashboardView` 从硬编码 math 改为 `appStore.selectedSubject`
  - `knowledgeIndexer.ts` subjects 数组新增 cs408
  - `localKnowledgeSearch.ts` / `localQuestionBankSearch.ts` 新增 CS408 搜索关键词
  - `dataIntegrity.test.ts` 新增 CS408 seed 校验
- **CS408 seed 全部 status: draft**，未经教学审核，需后续 review。

### 2026-07-03（知识库 Pack 管理与质量门禁）

- **目标**：实现知识库 Pack 管理与质量验收能力，避免每次接入新知识库都靠人工看报告。
- **新增服务**：
  - `src/services/knowledge/packStatus.ts`：Pack 状态统计服务，提供按 subject 汇总、Pack 列表、DB 对比等功能。
  - `src/services/knowledge/packValidator.ts`：Pack 质量校验服务，校验 manifest count、ID 唯一性、prerequisite 引用、hints 完整性、source/license 合规等。
- **SettingsView 新增"知识库管理"区域**：
  - 总览卡片：Pack 数、知识节点总数、题目总数、DB 节点总数
  - 按 subject 汇总：math/cs408 的预期节点/题目 vs DB 实际节点
  - Pack 列表：可展开查看全部 16 个 pack 的详情
  - 操作按钮：刷新状态、Seed 全部、校验 Pack
  - 校验结果：errors/warnings 结构化展示
- **新增测试**：
  - `packStatus.test.ts`：math 122/91、cs408 160/160、全库 282/251 汇总正确
  - `packValidator.test.ts`：当前全部 seed 校验通过，summary 包含正确的 pack/node/question 计数
- **验证结果**：
  - 测试通过：18 个测试文件，201 个测试用例全部通过。
  - 构建成功：TypeScript 编译和 Vite 构建均无错误。
  - Rust: 58 条测试通过。

### 2026-07-03（CS408 知识库升级至每科 40 节点 / 40 题）

- **目标**：将 QoderWork 已审计通过的 CS408 知识库从每科 20 节点 / 20 题升级为每科 40 节点 / 40 题。
- **数据来源**：`D:\Qoder_output\cs408`（QoderWork 输出），8 个 seed 文件覆盖 4 个 CS408 学科。
- **变更内容**：
  - 覆盖 8 个 CS408 seed 文件（4 knowledge + 4 questions），每科 40 节点 / 40 题
  - `packManifest.ts`：4 个 CS408 pack 的 `expectedNodeCount` 和 `expectedQuestionCount` 从 20 改为 40
  - `packStatus.test.ts`：cs408 汇总更新为 160/160，全库总计更新为 282/251/16 packs
  - `packValidator.test.ts`：summary 更新为 282 nodes / 251 questions，subjectCounts["cs408"] 更新为 160
  - `data/README.md`、`docs/project-status.md`、`docs/claudecode-handoff.md` 同步更新
- **CS408 最终数量**：160 知识节点 / 160 道题目（DS 40/40, CO 40/40, OS 40/40, CN 40/40）
- **全库最终数量**：282 知识节点 / 251 道题目（数学 122/91 + CS408 160/160）
- **质量状态**：status=draft，来源为 TeacherAgent original / QoderWork draft，已通过结构校验和人工抽查，但仍建议后续对计算题继续抽样复核。

### 2026-07-04（安全加固：流式 LLM 迁移至 Rust 转发 + 难度统一为 1-3）

- **安全修复 B-03：流式 LLM 请求全部迁移至 Rust 后端**
  - **问题**：`openAiCompatibleProvider.ts` 的 `stream()` 方法绕过 Rust 安全路径，通过前端 `fetch` 直接发送请求，API Key 明文暴露在浏览器进程和 DevTools 网络面板。
  - **修复**：
    - `src-tauri/src/models.rs`：新增 `LlmStreamChunk` 结构体（`content` + `done`）。
    - `src-tauri/src/provider.rs`：新增 `complete_llm_chat_stream_with_provider` 函数，从 keychain 安全获取 API Key，使用 `reqwest` 流式请求 LLM，逐行解析 SSE `data:` 行，通过 Tauri 2 `Channel<LlmStreamChunk>` 推送 chunk 给前端。
    - `src-tauri/src/lib.rs`：注册 `complete_llm_chat_stream` Tauri command。
    - `src/services/tauri/commands.ts`：新增 `completeLlmChatStream` 异步生成器，通过 `Channel` 接收 chunk 并 `yield` 给调用方。
    - `src/services/llm/openAiCompatibleProvider.ts`：`stream()` 方法改为调用 `completeLlmChatStream` 走 IPC 通信，**删除** `resolveApiKey()` 方法和前端 `fetch` 逻辑。API Key 不再离开 Rust 进程。
    - `Cargo.toml`：reqwest 新增 `stream` feature，新增 `futures-util` 依赖。
  - **效果**：浏览器 DevTools 网络面板不再显示任何直接对 LLM 的请求，API Key 全程在 Rust 进程内使用。

- **难度统一 B-01/B-19：全局 Difficulty 范围收敛至 1-3**
  - **问题**：`questionRecommender.ts` 推荐引擎使用 1-5 难度范围，但实际题库和知识库只有 1-3。掌握度 > 0.7 的学生推荐难度 4-5，完全命中不了任何题目。
  - **修复**：
    - `src/services/practice/questionRecommender.ts`：难度映射上限调整为 3。掌握度 ≥ 0.7 → 难度 3（原为 3-4 / 4-5）；连续正确提升上限为 3（原为 5）。
    - `src-tauri/src/seed.rs`：`difficulty.clamp(1, 5)` 改为 `.clamp(1, 3)`，防止外部 seed 数据中 difficulty > 3 的值入库。
    - `src-tauri/src/assessment.rs`：冷启动默认掌握度从 0.35 修正为 0.5，与前端和 `AGENTS.md` 一致。
    - `src/services/practice/questionRecommender.test.ts`：更新测试断言，最高难度必须 ≤ 3。
    - `src-tauri/src/seed.rs` 测试：新增 difficulty 5 被 clamp 到 3 的测试用例。
    - `src-tauri/src/lib.rs` 测试：更新 mastery 计算期望值（0.39 → 0.54，因冷启动默认从 0.35 改为 0.5）。

- **修复 B-02：`handleTurn` / `handleTurnStream` 返回实际 memoryContext**
  - **问题**：两个主方法在返回 `TutorTurnResult` 时硬编码 `memoryContext: undefined`，导致学习记忆上下文丢失。
  - **修复**：`src/engine/agents/tutorOrchestrator.ts` 两处 `memoryContext: undefined` 改为 `memoryContext`（ES shorthand property）。
  - **效果**：ChatView 的 `result.memoryContext` 正确携带学习记忆上下文，与 Planner 分支行为一致。

- **验证结果**：
  - `cargo test`：58 条 Rust 测试全部通过。
  - `npx vitest run src/services/practice/questionRecommender.test.ts`：18 条测试全部通过。
  - Rust 编译通过（`cargo check` 成功）。

### 2026-07-04（接入物理知识库 Pack）

- **目标**：接入 WorkBuddy 生成的大学物理知识库（力学、电磁学、热学、波动与光学、近代物理）。
- **数据来源**：`D:\WorkBuddy_output\physics`（5 knowledge + 5 questions seed 文件）。
- **变更内容**：
  - 拷入 10 个 seed 文件到 `data/knowledge/` 和 `data/questions/`
  - `packManifest.ts`：新增 5 个 physics Pack（mechanics/electromagnetism/thermodynamics/waves-optics/modern）
  - `src/types/learning.ts`：`SubjectCode` 联合类型新增 `"physics"`
  - `src/utils/subject.ts`：`SUBJECT_LABELS` 新增 `physics: "物理"`
  - `src/stores/packSelection.ts`：`AVAILABLE_SUBJECTS` 新增物理选项
  - `src/engine/policies/subjectStyle.ts`：新增物理学科风格（严谨、直观、可验证）
  - `src-tauri/src/lib.rs`：`normalize_subject_code` / `subject_name` / `subject_style_key` 新增 physics 分支
  - 修复 `physics-modern.seed.json` 的 JSON 语法错误（`source` 对象闭合用了 `]` 而非 `}`）
  - 修复 `physics-thermodynamics.seed.json` 的 JSON 尾逗号
  - 修复 `physics-waves-optics` 题库节点引用 typo（`yound` → `young`）
- **物理 Pack 统计**：力学 9/15、电磁学 10/15、热学 6/15、波动与光学 9/15、近代物理 7/15（共 41 节点 / 75 题）
- **全库最终数量**：323 知识节点 / 326 道题目（数学 122/91 + CS408 160/160 + 物理 41/75），21 个 Pack
- **验证结果**：
  - `npx vitest run`：266 条测试全部通过（19 个测试文件）。
  - `cargo test`：58 条 Rust 测试全部通过。

### 2026-07-04（Seed 覆盖导入功能）

- **目标**：本地修改 seed JSON（错别字、提示补全等）后能强制覆盖已存在节点，而非被跳过。
- **变更内容**：
  - `src-tauri/src/seed.rs`：`seed_knowledge_nodes` 新增 `overwrite: bool` 参数；为 true 时对已存在节点执行 `UPDATE`（更新 title、slug、summary、level、difficulty、prerequisites_json、misconceptions_json、socratic_hints_json、license_snapshot、review_status），保留原始 `created_at`；`SeedResult.updated` 返回实际更新数。
  - `src-tauri/src/lib.rs`：`seed_knowledge_nodes_from_json` 命令接受 `overwrite: Option<bool>`（默认 false）。
  - `src/services/tauri/commands.ts`：`seedKnowledgeNodesFromJson` 透传 `overwrite` 参数。
  - `src/services/knowledge/knowledgeIndexer.ts`：`seedAllKnowledgeNodes` 和 `seedKnowledgeNodesBySubject` 接受 `overwrite` 参数；覆盖模式跳过幂等检查。
  - `src/views/SettingsView.vue`：Seed 按钮旁新增「强制覆盖已存在节点」复选框，勾选时调用 `seedAllKnowledgeNodes(true)`。
  - `src/engine/agents/plannerAgent.ts`：补上 physics 学科规划条目（物理图景 → 量纲检验）。
  - `src/services/knowledge/knowledgeIndexer.ts`：subject 迭代列表补上 `"physics"`。
- **验证结果**：
  - `cargo test`：59 条 Rust 测试全部通过（新增 `seed_overwrite_updates_existing_nodes`）。
  - `npx vitest run`：266 条测试全部通过（19 个测试文件）。
  - `tsc --noEmit`：TypeScript 类型检查通过。

### 2026-07-04（知识库健康检查与一键同步）

- **目标**：产品化 Pack/DB 一致性检查和同步流程，让用户清楚看到 missing / orphan / subject mismatch 并一键修复。
- **新增 Rust 命令**：`knowledge_health_check`（`seed.rs`），接收 manifest nodeId + expectedSubjectId 列表，与 DB 比对，返回 missing / orphan / subject mismatch 详情。
- **新增前端服务**：`runKnowledgeHealthCheck()`（`packStatus.ts`），加载所有 pack seed 提取 nodeId→subject 映射，调用 Rust 命令。
- **设置页新增**：
  - "健康检查"按钮：显示 missing / orphan / subject mismatch 数量和详情
  - "一键同步"按钮：等价于 `seedAllKnowledgeNodes(overwrite=true)`，同步后自动刷新健康检查
  - 安全提示：同步不会删除对话、练习记录或学习进度
  - orphan 只报告不自动删除
- **Rust 测试新增 5 条**：missing 检出、subject mismatch 检出、orphan 检出、sync 修复 mismatch、orphan 不被 sync 删除
- **前端测试新增 3 条**：ok / missing / subject mismatch 状态覆盖
- **安全约束**：不删除 student_knowledge / assessment / messages / conversations；orphan 只报告不删除

### 2026-07-04（Python Document Worker 基础设施与预览入口）

- **目标**：搭建 Python sidecar 架构，用于文档解析和数学计算，为后续私有知识库导入做准备。
- **架构**：Python worker 作为独立进程，Rust 通过 `std::process::Command` 调用，读取 JSON 输出。不嵌入 Tauri 主进程。
- **新增 Python 模块**：`tools/document-worker/`
  - `document_worker/parsers/pdf_parser.py`：PyMuPDF 解析 PDF，带 pdfplumber/pypdf fallback，预览最多前 20 页
  - `document_worker/parsers/docx_parser.py`：python-docx 解析 DOCX 段落和表格
  - `document_worker/parsers/xlsx_parser.py`：openpyxl 解析 XLSX
  - `document_worker/math_engine.py`：SymPy 数学计算（展开、因式分解、求导、积分、解方程）
  - `document_worker/schema.py`：JSON 输出 schema 定义
  - `document_worker/__main__.py`：CLI 入口
- **新增 Rust 命令**：`parse_document_with_worker`、`compute_math_with_worker`（`worker.rs`）
- **安全限制**：文件 50MB 上限、30 秒超时、不执行宏/脚本、不访问网络、输出为 draft 级别
- **测试**：Python 单元测试 26 条（math engine 14 + schema 4 + parser 8）、Rust 测试 10 条（含 camelCase 序列化、路径定位、超时）
- **文档**：新增 `docs/document-worker.md`
- **当前状态**：基础设施已完成（sidecar 架构、CLI、JSON schema、Rust/TS 绑定、开发期路径查找）。设置页已接入私有资料导入实验入口，支持选择 PDF/DOCX/XLSX、本地解析、多文件预览和导航切换后保留当前会话内预览。**尚未接入私有知识库入库、私有 RAG、OCR、PyInstaller 打包脚本。**
- **生产分发策略**（D-108 已决定）：PyInstaller 打包 `document-worker.exe` 随 Tauri 安装包分发，用户无需安装 Python。开发期保留 `python -m document_worker` 模式。**注意**：`tauri.conf.json` 的 `externalBin` 配置待 PyInstaller 产物验证后再启用，当前未写入，避免无 exe 时生产 bundle 失败。
- **后续任务顺序**：
  1. 解析质量继续打磨（真实 PDF/DOCX 样本、乱码/超时/复杂版式降级）
  2. 用户确认后进入 private draft（写入本地 SQLite，标记为私有）
  3. 私有知识库 RAG（搜索时合并内置 + 私有）
  4. PyInstaller 打包脚本 + Tauri sidecar 集成验证
  5. 可选 OCR（扫描件 PDF 图片文字识别）

### 2026-07-04（私有资料确认入库草稿层）

- **目标**：在"私有资料导入"预览基础上，增加"确认导入"功能，将解析结果保存到本地 SQLite 作为 private draft 文档和 chunk。
- **新增 Migration**：`0003_private_documents.sql`，创建 `private_documents` 和 `private_document_chunks` 表。
- **新增 Rust 模块**：`src-tauri/src/private_doc.rs`，实现 save / list / delete(彻底删除) / load chunks 四个 repository 函数。save 和 delete 均在单一 SQLite 事务内完成，避免半导入或孤儿 chunks。
- **新增 Rust Commands**：`save_private_document`、`list_private_documents`、`delete_private_document`、`load_private_document_chunks`。
- **新增前端 Service**：`src/services/document/privateDocumentService.ts`，封装 `confirmImportToDraft`、`listImportedDocuments`、`removeImportedDocument`。
- **Store 增强**：`src/stores/documentImport.ts` 新增 `importStatus`（idle/importing/imported/error）、`confirmImport(previewId, subjectCode)`、`importedDocuments` 列表、`loadImportedDocuments`、`deleteImportedDocument`。
- **UI 增强**：`DocumentImportPanel.vue` 新增"确认导入"按钮（已导入后不可重复点击）、已导入资料列表（fileName/fileType/subject/createdAt/chunkCount）、删除确认提示、隐私说明文案。
- **数据边界**：不保存原始文件路径、不上传云端、不调用 LLM、不生成 embedding、不写入内置 Pack。
- **Rust 测试新增 9 条**：save→list、chunk 生成、delete→list 不显示、不保存 filePath、subjectCode 隔离、empty_pages fallback、empty_document 拒绝、transaction 回滚、deleted_chunks_not_loadable。Rust 测试总计 90 条通过。
- **前端测试**：store 测试已适配新字段。前端测试总计 360 条通过。
- **验证**：`cargo fmt -- --check` 通过、`cargo test` 90 条通过、`npm run test -- --maxWorkers=1` 360 条通过、`npm run build` 通过。
- **删除语义**：delete 为彻底删除（DELETE chunks + DELETE document，同一事务），非软删除。UI 文案为"移除此资料"。
- **待做**：私有知识库 RAG（搜索时合并内置 + 私有）、PyInstaller 打包、可选 OCR。

### 2026-07-05（私有资料 RAG 集成 + sourceType 统一 + 边界保护）

- **目标**：完成上述旧待做项中的"私有知识库 RAG"，统一 sourceType 契约，为 Rust 私有资料命令补充边界保护，同步文档状态。
- **私有资料 RAG 已完成 MVP**：ToolAgent 对话时自动检索私有资料（keyword/simple scoring，最多 3 条），与 built-in Pack 结果合并注入 prompt。`sourceType` 区分 `built_in_pack` / `private_document`。引用私有资料时使用"你的资料中提到..."表达。私有资料搜索失败不影响 built-in 检索。未导入私有资料时 built-in 行为不退化。
- **sourceType 契约统一**：`SourceRef.sourceType` 从 `local_knowledge | open_web | oer | user_content | generated | private_user_import` 改为 `built_in_pack | private_document | local_knowledge | open_web | oer | user_content | generated`。`private_user_import` 仅作为 `license` 字段值，不再作为检索结果类型。`docs/tool-interface.md` 已同步。
- **Rust 边界保护**：`list_private_documents` limit clamp 1..=100（默认 50），`search_private_document_chunks` limit clamp 1..=10（默认 5），空 query 返回空，超长 query（>200 字符）截断。保护在 repository 层（`private_doc.rs`）实现。
- **删除语义注释修正**：`documentImport.ts` 和 `commands.ts` 的注释从"软删除"改为"彻底删除（hard delete）"，与实际行为一致。
- **设置页 RAG 状态**：DocumentImportPanel 新增轻量状态摘要，显示已导入资料数量和"对话检索：已接入本地私有资料 RAG"。
- **Rust 测试新增 6 条**：`list_negative_limit_clamped_to_one`、`list_huge_limit_clamped_to_100`、`search_negative_limit_clamped_to_one`、`search_huge_limit_clamped_to_10`、`search_empty_query_returns_empty`、`search_overlong_query_truncated`。Rust 测试总计 99 条通过。
- **验证**：`cargo fmt -- --check` 通过、`cargo check` 0 warning、`cargo test` 99 条通过、`npm run test -- --maxWorkers=1` 374 条通过、`npm run build` 通过、`python -m pytest` 43 条通过。
- **本轮未做**：embedding / sqlite-vec 向量检索、PyInstaller 打包、Tauri sidecar externalBin、OCR。上述旧段落中的"待做：私有知识库 RAG"已完成 MVP keyword/simple scoring 闭环。

### 2026-07-06（测试全绿 + 孤立节点清理安全修复 + 性能优化）

- **目标**：恢复测试全绿、修复孤立节点清理的数据安全语义、health check fail-fast、优化知识图谱切页卡顿。
- **管理类联考 seed 处理（方案 A1）**：`management-logic`、`management-math`、`management-writing` 的 knowledge 和 questions seed 文件移至 `data/drafts/management/`，不参与 `import.meta.glob` 自动发现。这些 seed 未在 `PACK_MANIFEST` 中注册，属于未完成草稿，正式接入需完整走学科注册流程。
- **孤立节点清理安全修复**：`delete_orphan_knowledge_nodes` 不再删除 `student_knowledge`。改为先检查 orphan 节点是否有 `student_knowledge` 引用，如有则跳过并报告为 `blocked_by_student_knowledge_ids`。`OrphanCleanupResult` 移除 `student_knowledge_deleted`，新增 `blocked_by_student_knowledge_ids` 和 `message` 字段。设置页确认文案改为"只删除未被当前 manifest 声明、且没有学习进度引用的内置孤立知识节点；不会删除对话、练习结果、私有资料或学习进度"。
- **严格 Pack 加载**：`packLoader.ts` 新增 `loadAllKnowledgePacksStrict()` 和 `loadKnowledgePacksByIdsStrict()`，使用 `Promise.all` 而非 `Promise.allSettled`，任一 pack 加载失败则 reject。`runKnowledgeHealthCheck()` 和 `handleCleanupOrphans()` 改用严格版本，避免部分 manifest 导致误删。
- **知识图谱切页优化**：`KnowledgeGraphView.loadGraphData()` 改为只加载当前选中 pack（首屏快速渲染），剩余 pack 在后台分批加载（每批 3 个，每批之间 `setTimeout(0)` 让出主线程）。新增 `loadGeneration` 计数器处理 subject 快速切换时的请求取消。
- **Rust 测试新增 1 条**：`delete_orphan_knowledge_nodes_skips_with_student_knowledge`。Rust 测试总计 111 条通过。
- **前端测试新增 4 条**：`packLoader` exports 测试。前端测试总计 474 条通过。
- **验证**：`cargo fmt -- --check` 通过、`cargo check` 0 warning、`cargo test` 111 条通过、`npm run test -- --maxWorkers=1` 474 条通过（30 个测试文件全绿）、`npm run build` 通过。

### 2026-07-06（知识图谱 DOM 渲染性能修复 + 清理入口可发现性）

- **目标**：修复知识图谱切页卡顿（122 节点卡片一次性进 DOM），改善孤立节点清理入口可发现性。
- **卡顿根因**：`listShowAll` 默认 `true` 导致进入页面即渲染全部 122 个节点卡片；`graphData` / `packPrerequisites` computed 在列表模式下仍执行图谱构建；无渐进渲染、无 CSS containment。
- **修复 1 — 默认当前章节**：`listShowAll` 默认改为 `false`，进入页面只展示当前 pack 节点（约 10-35 个）。
- **修复 2 — 渐进渲染**：新增 `visibleLimit`（初始 30），`visibleNodes` 只渲染前 N 个；"显示更多"按钮追加 30 个；切换 pack/subject/全部-当前章节时重置 limit。
- **修复 3 — 图谱计算延迟**：`graphData` 和 `packPrerequisites` 仅在 `viewMode === 'graph'` 时计算，列表模式跳过。
- **修复 4 — CSS containment**：`.node-list-item` 添加 `content-visibility: auto` 和 `contain-intrinsic-size: auto 80px`，减少重排。
- **清理入口**：知识图谱页底部添加"数据数量异常？请到 设置 → 知识库管理 → 健康检查 处理孤立节点"提示和 `router-link` 跳转按钮。
- **额外 seed 处理**：`education-pedagogy.seed.json` 未在 `PACK_MANIFEST` 中注册，移至 `data/drafts/education-pedagogy.seed.json`。
- **逻辑提取**：新增 `knowledgeGraphLogic.ts` 纯逻辑模块（`VISIBLE_STEP`、`getVisibleNodes`、`nextVisibleLimit`、`hasMoreNodes`、`resolveListNodeSource`），可独立测试。
- **验证**：`cargo fmt -- --check` 通过、`cargo test` 111 条通过、`npm run test -- --maxWorkers=1` 489 条通过（31 个测试文件全绿）、`npm run build` 通过。

### 2026-07-06（逻辑函数接入 + 清理入口 hash 定位 + 测试契约收口）

- **目标**：让 KnowledgeGraphView 真正使用 `knowledgeGraphLogic.ts` 纯逻辑函数（消除重复代码），改善知识库清理入口可发现性，补充集成测试。
- **逻辑函数接入**：KnowledgeGraphView 导入 `VISIBLE_STEP`、`getVisibleNodes`、`nextVisibleLimit`、`hasMoreNodes`、`resolveListNodeSource`，删除组件内重复的 `const VISIBLE_STEP = 30`、内联的 `listNodes`/`visibleNodes`/`hasMoreNodes`/`showMoreNodes` 逻辑。
- **清理入口 hash 定位**：KnowledgeGraphView 的 `router-link` 改为 `{ path: '/settings', query: { scrollTo: 'knowledge-management' } }`；SettingsView 的知识库管理 section 增加 `id="knowledge-management"`，健康检查区域增加 `id="knowledge-health-check"`；SettingsView 的 `onMounted` 和 `watch(route.query.scrollTo)` 会滚动到目标区域。
- **tsconfig 排除测试文件**：`tsconfig.json` 新增 `"exclude": ["src/**/*.test.ts"]`，避免 `vue-tsc --noEmit` 因测试文件中的 `node:fs`/`node:path` 导入报错。
- **测试新增 4 条**：`knowledgeGraphLogic.test.ts` 新增 KnowledgeGraphView 集成验证（导入来源、无 orphan 函数、scrollTo query、SettingsView id 属性）。前端测试总计 493 条通过（31 个测试文件全绿）。
- **验证**：`cargo fmt -- --check` 通过、`cargo test` 111 条通过、`npm run test -- --maxWorkers=1` 493 条通过、`npm run build` 通过。

### 2026-07-06（Seed Embedding 生成 — 向量检索闭环）

- **目标**：打通"生成 Embedding → 存入本地数据库 → 搜索时使用真实向量匹配"的最后一步链路。
- **Rust 批量 Embedding**：新增 `generate_embeddings_batch` Tauri command，支持 OpenAI-compatible `/embeddings` 批量接口（input 为数组），batch_size 默认 64，200ms 间隔，429 自动重试，通过 Channel 实时报告进度。
- **Rust 计数命令**：新增 `count_vector_embeddings` command，暴露 `vector::count_embeddings`。
- **TS IPC 封装**：`commands.ts` 新增 `generateEmbeddingsBatch`（带 Channel 进度回调）和 `countVectorEmbeddings`。
- **编排服务**：新增 `seedEmbeddingService.ts`，通过 `loadAllKnowledgePacks()` 获取全库节点，构建 "title: summary" 文本，批量调用 embedding API，逐条存入 `vector_embeddings` 表。
- **设置页 UI**：知识库管理区域新增"向量 Embedding"子区块，含模型名输入框、"生成全库 Embedding"按钮、进度条、计数显示。
- **向量 RAG 链路**：`toolAgent.ts` 已有 vector-first 搜索逻辑（优先向量 → 降级 keyword），生成 embedding 后自动生效。

### 2026-07-06（题库 Embedding + 向量检索闭环补全）

- **目标**：将题库（Questions）纳入 Embedding 生成与向量检索链路，实现完整的 RAG 闭环。
- **seedEmbeddingService.ts 修改**：引入 `loadAllQuestionPacks()`，知识点和题目合并为一个数组统一调用 `generateEmbeddingsBatch`。题目使用 `title + content + answer` 拼接文本。落库时通过 `entityType` 区分 `knowledge_node` / `question`。新增 `getQuestionEmbeddingCount()` 和 `getTotalEmbeddingCount()`。
- **vectorSearch.ts 新增**：`searchQuestionByVector()` 函数，使用 `ENTITY_TYPE_QUESTION` 过滤向量搜索。
- **toolAgent.ts 修改**：新增 `runQuestionBankSearch()` 函数，题库搜索优先尝试向量匹配（`searchQuestionByVector`），命中后通过 lazy search 获取完整题目详情并按向量 score 排序；无向量结果时降级到 `searchLocalQuestionBankLazy`。支持 `isPartialPackSelection` 判断，用户禁用部分 pack 时跳过向量搜索。
- **新增测试**：`seedEmbeddingService.test.ts`（8 条）、`vectorSearch.test.ts`（8 条）。
- **验证**：`cargo test` 111 条通过、`npm run build` 通过、`npm run test` 509 条通过（4 条 pre-existing seed 数据完整性失败，非本次引入）。
- **已知观察**：用户报告从设置页切换到知识图谱时卡顿比其他页面更明显。当前修复（懒计算 graphData、渐进渲染、CSS containment）对所有来源页面均生效。设置→知识图谱的额外延迟可能与 SettingsView 组件树较大导致卸载耗时有关，需后续实机 profiling 确认。

### 2026-07-07（Embedding 预检 + UI 文案统一）

- **问题**：用户配置的 chat Provider 不支持 `/embeddings` 端点，点击"生成全库 Embedding"后报 404，错误信息不友好。
- **根因**：`generate_embedding` Rust command 将 chat Provider 的 `base_url` 拼接 `/embeddings`，但很多代理/网关只转发 `/chat/completions`。
- **修复**：
  - `seedEmbeddingService.ts` 新增 `preflightEmbeddingCheck()`：批量生成前先用短文本测试 embeddings endpoint，404/401/模型不支持等错误提前暴露，不开始批量写入。
  - `generateSeedEmbeddings()` 在 Phase 1 前调用 preflight，失败则 throw 用户友好的错误。
  - 错误文案统一为："当前 Provider 不支持 Embedding 接口（返回 404）。知识库 keyword 检索仍可正常使用。如使用 OpenAI，请配置支持 /v1/embeddings 的 Base URL 和 embedding 模型；如使用 Ollama，请使用 nomic-embed-text 等 embedding 模型。"
  - 设置页 Embedding 区域描述补充"如果当前 Provider 不支持 Embedding 接口，keyword 检索仍可正常使用"。
  - 健康检查成功消息改为"知识库已同步，无异常。共 X 个节点，Y 个已入库。"
- **UI 文案统一**：设置页知识库管理描述从"Seed 入库"改为"Seed 全部入库"，与按钮文案"Seed 全部"一致。
- **验证**：`npm run test` 536 passed、`npm run build`、`cargo fmt -- --check`、`cargo check`、`cargo test` 111 passed。

### 2026-07-07（答对闭环策略：修复答对后仍过度苏格拉底追问）

- **实机问题**：学生在数学极限题中给出正确答案和核心理由（如"tanx 等价于 x 所以极限值为 3/2"），但导师仍继续追问基础问题（如"哪个表达式是趋于 0 的小部分？是 x 还是 3x？"），显得啰嗦、低估学生能力。
- **根因**：`socraticAgent.ts` 的 `hasStudentAttempt` 检测到"所以"等关键词后，强制进入 `diagnose` 模式且 `shouldAskQuestion = true`，无论学生答案是否正确。`tutorSystem.ts` 缺少"答对闭环"规则，`TUTOR_OUTPUT_CONTRACT` 强制要求末尾追问。
- **修复**：
  - `socraticAgent.ts`：新增 `answer_with_reasoning` intent 和 `hasAnswerWithReasoning()` 检测函数。当学生消息同时包含推导关键词（等价/代入/化简/因为/所以等）和结论关键词（极限值/答案/结果 + 数值）时，进入 `review` 模式，`shouldAskQuestion = false`，`explanationDepth = full_review`。优先级高于 `hasStudentAttempt`。
  - `tutorSystem.ts`：TUTOR_SYSTEM_PROMPT 新增答对闭环规则——学生给出正确结论和推导依据时，必须先明确确认正确，再补充规范推导，不追问已掌握的基础点。TUTOR_OUTPUT_CONTRACT 新增 `answer_with_reasoning` 输出结构说明。
  - `tutorPromptBuilder.ts`：`createRuntimeGuidance` 新增 `answer_with_reasoning` 分支，给出确认→规范推导→轻量建议的回复结构指引。
- **新增测试**：`socraticAgent.test.ts` 新增 10 条测试（7 条答对闭环正例、1 条仅推理无结论不匹配、1 条仅结论无不匹配、1 条错误答案仍走诊断）。
- **未破坏场景**：学生不会做时仍引导、答案错误时仍纠偏、只给答案没理由时可要求补理由、outline_summary 仍直接结构化回答。
- **验证**：`npm run test -- --maxWorkers=1` 552 passed、`npm run build`、`cargo fmt -- --check`、`cargo check`、`cargo test` 111 passed。

### 2026-07-07（P1 可维护性债务第 1 批）

- **P1-1 小拆 lib.rs**：
  - 新增 `src-tauri/src/shared.rs`：迁出 `normalize_subject_code`、`subject_name`、`subject_style_key`、`subject_code_from_subject_id`、`truncate_for_storage`、`current_timestamp`、`current_unix_nanos`、`create_slug`、`validate_json_object_or_array`，以及 `DEFAULT_STUDENT_ID`/`DEFAULT_STUDENT_NAME` 常量。
  - 新增 `src-tauri/src/embedding.rs`：迁出 `generate_embedding_for_text` 和 `generate_embeddings_batch_for_texts` 核心逻辑。Tauri command 薄封装保留在 `lib.rs`。
  - 删除 `provider.rs` 中重复的 `truncate_for_storage`，改用 `crate::shared::truncate_for_storage`。
  - `lib.rs` 从 ~1979 行减至 ~1887 行。
- **P1-4 核心 Agent 单元测试**：
  - `plannerAgent.test.ts`：21 条测试，覆盖事件触发判定、复习到期阈值（3/7/14 天分级）、前置依赖回退、保守输出、去重、记忆聚焦。
  - `assessmentAgent.test.ts`：25 条测试，覆盖正确/部分正确/错误/未知分类、掌握度 delta 计算、下一步建议、置信度上下限。
  - `reflectionAgent.test.ts`：28 条测试，覆盖观察 vs 推断分离、不确定性追踪、误区提取、策略洞察、记忆候选生成、置信度。
- **清理死状态**：`tutorOrchestrator.ts` 的 `handleTurn` 和 `handleTurnStream` 中 `timestamps` 数组被 push 但从未读取，已删除。保留 `onTiming` 回调。
- **验证**：`npm run test -- --maxWorkers=1` 542 passed、`npm run build`、`cargo fmt -- --check`、`cargo check`（0 warning）、`cargo test` 111 passed。

### 2026-07-07（P1-2 tutorOrchestrator 重构：消除 handleTurn / handleTurnStream 重复）

- **目标**：消除 `handleTurn` 与 `handleTurnStream` 之间约 250 行重复逻辑，降低 drift 风险。
- **重构方式**：抽取 4 个共享方法 + 2 个共享 helper：
  - `prepareTurnContext()`：Socratic decision + ToolAgent + Memory + ID 解析，返回 `TurnContext`。
  - `runPlannerPath()`：Planner 短路逻辑，非流式/流式共享。
  - `buildPromptFromContext()`：Prompt 构建。
  - `runPostLlmPipeline()`：评估 + 记忆保存（fire-and-forget），返回 `AssessmentResult`。
  - `runNonStreamLlmCall()`：非流式 LLM 调用 + Guardrail。
  - `runStreamLlmCall()`：流式 LLM 调用 + 句级 Guardrail。
  - `createStamp()`：计时工具函数。
- **保持不变**：`handleTurn` / `handleTurnStream` 外部 API 签名不变；Planner 短路、Guardrail rewrite/fallback、ToolAgent 降级、Reflection 失败不阻塞等语义不变。
- **新增测试**（7 条）：
  - `onTiming` 回调覆盖所有关键阶段。
  - 流式/非流式共享同一 pre-LLM context（socratic decision、mode、knowledge context）。
  - Guardrail rewrite 在非流式路径下返回 `rewriteAttempts=1`。
  - 流式 Guardrail `internal_leak` 检测并回退。
  - `outline_summary` 和 `answer_with_reasoning` intent 不因重构退化。
  - Planner 路径流式/非流式返回一致结果。
- **修复 1 条已有测试**：`stream guardrail violation aborts streaming and returns fallback` 改用 `answer_for_internal_review_only` 触发真实 violation（原来用 "答案是 42" 不触发 fast guardrail）。
- **文件行数变化**：`tutorOrchestrator.ts` 从 683 行变为 673 行（净减 10 行，但消除了 ~250 行重复）。
- **验证**：`npm run test -- --maxWorkers=1` 649 passed、`npm run build`、`cargo fmt -- --check`、`cargo check`、`cargo test` 123 passed。

### 2026-07-08（知识天赋树节点交互闭环 + 冷启动 mastery=0.5 隐藏）

- **实机问题**：
  1. 知识天赋树列表/图谱中的节点点击无任何反应，没有详情、讲解、练习入口。
  2. 所有未真实学习过的节点都显示"50% · 学习中"，冷启动默认 mastery=0.5 不能直接暴露给用户。
- **修复**：
  - **冷启动判断**：新增 `src/utils/mastery.ts`，提供 `isColdStartKnowledge()`、`getMasteryLabel()`、`getMasteryBadgeText()`、`getMasteryBadgeClass()`、`getMasteryColor()` 等工具函数。判断依据：`attemptsCount === 0` 视为冷启动。
  - **UI 状态映射**：
    - 冷启动（无真实学习记录）→ "未开始"，灰色
    - 数据不足（1-2 次练习）→ "初始评估"，橙色
    - 真实学习（3+ 次练习）→ 显示百分比 + 状态标签
  - **KnowledgeGraphView 更新**：
    - 节点详情面板：显示中文标题、摘要、所属学科、Pack 中文名、前置知识（中文标题）、掌握度（区分冷启动/真实）
    - 操作按钮："让导师讲解"、"出一道练习"跳转对话页
    - 图例更新：灰色 = "未开始/待学习"
    - 列表/图谱节点 mastery 显示使用新工具函数
  - **graphBuilder.ts 更新**：`buildNodeColors()` 冷启动节点（attemptsCount=0）显示灰色
  - **DashboardView 更新**：掌握度分布排除冷启动记录，整体掌握度只计算真实学习记录
  - **新增测试**（74 条）：`mastery.test.ts` 覆盖冷启动判断、mastery 展示、颜色映射；`knowledgeGraphLogic.test.ts` 新增 UI 集成测试；`graphBuilder.test.ts` 新增冷启动着色测试
- **保持不变**：底层冷启动 mastery=0.5（BKT 算法先验）不变；数据库 schema 不变；41 pack / 723 nodes / 726 questions 不变。
- **验证**：`npm run test -- --maxWorkers=1` 650 passed、`npm run build`、`cargo fmt -- --check`、`cargo check`、`cargo test` 123 passed。

### 2026-07-09

- **Python 编程辅导 Phase 1 落地**：独立 `code-worker` Python sidecar + Rust 模块 + Tauri command + 前端 service + ToolAgent 路由 + SocraticAgent 编程意图 + Prompt 治理更新 + Python 知识库/题库 seed。
- **code-worker sidecar**：`tools/code-worker/`，Python 标准库实现，定位为教学护栏（非安全沙箱）：restricted builtins、import guard、pruned sys.modules、os/subprocess 阻断、超时和输出限制可阻止意外误用，但不承诺执行不受信代码；超时由调用方指定（clamp 1-30s），支持 stdin/test_cases。
- **安全修复**（review 后）：(1) subprocess 拦截从逐方法补丁改为整模块替换；(2) Python JSON 输出从 snake_case 改为 camelCase，与 Rust `serde(rename_all = "camelCase")` 契约一致；(3) timeoutMs 从硬编码 5s 改为透传调用方值；(4) `open`/`__import__` 从 restricted builtins 中彻底移除，`_safe_open` 不再存在，所有 builtins 条目均为 C 级对象（无 `__closure__`/`__globals__` 可反射）。
- **安全分类修正**：code-worker Phase 1 = **教学护栏（guardrails），非安全沙箱**。纯 Python wrapper 存在 CPython 级不可封堵逃逸（`object.__subclasses__()` → `catch_warnings` → warnings → 真实 builtins）。回归测试 `TestSecuritySubclassesEscape` 已覆盖逃逸路径。仅适用于可信代码。Phase 2 必须迁移到 OS 级隔离（Windows Job Object / seccomp / WASM / 容器）。D-111 已记录。
- **新增回归测试**：`test_subclasses_catch_warnings_exists`、`test_subclasses_escape_can_recover_open`、`test_subclasses_escape_can_recover_import`、`test_mro_traversal_no_io_types`、`test_known_escape_documented`。共 52 条 code-worker 测试通过。
- **Rust 模块**：`src-tauri/src/code_worker.rs`，复用 document-worker 的 sidecar 查找 + Python 回退模式，新增 `run_code` Tauri command。
- **前端集成**：`src/types/tool.ts` 新增 `CodeRunnerInput`/`CodeRunnerOutput`；`src/services/tools/codeRunner.ts` 封装 Tauri command + tool context 构建；`src/services/tools/codeRunner.test.ts` 7 条测试通过。
- **ToolAgent 路由**：`src/engine/agents/toolAgent.ts` 新增 `shouldRunCode()` 检测编程意图（代码块/traceback/运行请求），路由 `code_runner`。
- **SocraticAgent 意图**：新增 `code_debug`（报错定位）、`code_explain`（代码解释）、`code_run_request`（运行请求）三个意图。
- **Prompt 治理**：`tutorSystem.ts` 升级为 v1.5，新增编程辅导规则（调试伙伴风格、不代写完整代码、报错定位引导、测试用例分析）；`tutorPromptBuilder.ts` 新增编程意图的 runtime guidance 分支。
- **学科风格**：`subjectStyle.ts` 已有 `debugging_partner` 风格，`prompt-governance.md` 已补充编程学科默认值。
- **知识库 seed**：`data/knowledge/python-basics.seed.json`（8 个节点：变量类型、条件、循环、函数、列表字典、字符串、异常、常见错误）；`data/questions/python-basics.seed.json`（8 道题：类型判断、缩进错误、range 理解、函数返回值、索引越界、字符串方法、Traceback 阅读、异常处理实践）。
- **文档同步**：`docs/tool-interface.md` code_runner 节更新为 Phase 1 已实现 Python；`docs/open-decisions.md` D-102 → decided；`docs/agent-architecture.md` ToolAgent 能力更新；新增 `docs/code-worker.md`。
- **D-102 决策**：`code_runner` 首批支持 Python，TypeScript/JavaScript 放 Phase 2。
- **PyInstaller sidecar 构建**：`tools/code-worker/dist/code-worker.exe`（8MB），复制到 `src-tauri/binaries/code-worker-x86_64-pc-windows-msvc.exe`。当前 exe 作为 code-worker 分发入口，仍需目标机器安装 Python 3.10+；运行时自动查找系统 Python（`sys._base_executable` → PATH → 常见目录），每个候选执行 `python --version` 验证。5 条端到端 smoke test 通过（算术/ZeroDivisionError/SyntaxError/测试用例/超时）。
- **教学反馈优化**：`createCodeRunnerToolContext` 重构为苏格拉底式教学结构——(1) 提取 stderr 中的错误类型和行号（`analyzeStderr`），(2) 为 12 种常见 Python 错误提供中文教学提示（NameError→拼写/作用域、TypeError→类型混用、IndexError→off-by-one 等），(3) 超时场景专门引导循环终止条件分析，(4) 测试失败展示 expected vs actual 并引导 print() 调试，(5) 全部通过后建议边界条件或变式。`runCodeRunner` 将 Python runtime error 作为成功工具结果保留 stderr / exitCode，避免教学分析丢上下文。`tutorSystem.ts` 升级为 v1.6，编程辅导规则扩展为按错误类型分类引导。
- **code_runner 触发修复**：`ToolAgentInput` 增加 `recentMessages`，`TutorOrchestrator` 透传最近对话；`shouldRunCode()` 扩展"编译/compile/解释器/interpreter/工具连调/工具联调/上一段代码/前面的代码/刚才的代码/之前的代码"等触发词；`createCodeRunnerInput()` 不再把中文自然语言当代码执行，优先提取当前消息代码块/行内 Python 片段，再从最近学生消息倒序提取代码。未找到代码时写入 `NO_CODE_FOUND` 工具上下文，引导导师请学生贴代码。
- **UI 提示**：ChatView 在 programming 学科下显示"代码运行使用教学护栏，仅适用于可信练习代码"提示。
- **验证**：`tools/code-worker` pytest 52 passed、`npm run test -- --maxWorkers=1` 847 passed（41 files）、`npm run build`、`cargo fmt -- --check`、`cargo check`、`cargo test` 128 passed。

### 2026-07-25（实机问题收敛：Embedding / Kimi / Pack / 掌握度 / 天赋树）

- **Embedding 已有库识别**：知识库设置页同时统计知识节点与题目向量，自动发现已存在的模型，区分空库、完整、未完成和超出 approved 目标的旧库；已有向量再次生成必须二次确认，不再启动时无条件探测 Ollama。
- **Kimi 兼容**：`api.moonshot.cn` 与 `kimi-*` Provider 增加模型预设；Kimi K2.5/K2.6 请求按官方固定采样约束省略 `temperature`，显式保留 `thinking: enabled`，并确保 `max_tokens` 不低于官方默认的 32768。这样既保留复杂数学推理能力，也避免低输出额度被推理过程耗尽后出现 HTTP 200 但最终正文为空。
- **向量 IPC 契约修复**：`VectorSearchResult` 的 Rust 序列化统一为 camelCase，匹配前端 `entityId / embeddingModel` 契约。此前真实向量结果使用 snake_case 返回，导致节点 ID 读取为 `undefined` 并静默降级到关键词检索；新增真实序列化测试与运行时回退日志。Embedding 生成仍一次覆盖所有学科的 approved Pack，draft 内容不进入正式向量库。
- **Pack 显式全启用**：默认仍仅启用 approved；用户点击“启用全部（含待审核）”时，当前学科 approved/draft Pack 全部写入显式选择。
- **50% 先验隐藏**：`mastery=0.5 + correctCount=0` 即使历史累计了 unknown attempts，也不再归入“发展中”，统一标记为“待评估”。
- **天赋树视觉状态**：图谱节点由纯色圆点升级为带状态图标的令牌：已掌握 `✓`、学习中 `↗`、待加强 `!`、未评估 `◇`。

### 2026-07-30（安全修复迭代）

- **code-runner fail-closed**：确认 CPython `object.__subclasses__()` 逃逸真实存在，未采用过滤器伪装修复。Release 无条件关闭；Debug 需 Rust/前端双重显式 opt-in，只允许可信本地开发代码。未授权攻击样例在启动 worker 前被拒绝。
- **stdin + 环境白名单**：移除 `--input <JSON>`；Rust 仅用 stdin 传输代码，Rust/Python 两层子进程环境均由白名单构造，不继承 Provider、代理、云、SSH、数据库或自定义秘密。
- **文档路径边界**：系统文件选择器在 Rust 中生成一次性令牌，前端不再收到绝对路径；解析前重新校验并通过已打开句柄复制到 staging，worker 只读副本。任意路径、`..`、UNC/设备路径、敏感目录、非法扩展名、超 50MB、授权后替换均 fail-closed。
- **Provider / Key 绑定**：远程 endpoint 强制 HTTPS，HTTP 仅 loopback；禁止 URL 凭据/query/fragment，HTTP 客户端禁重定向。Keychain 值绑定规范化 endpoint，endpoint 变化、SQLite 篡改、旧未绑定 Key、非法引用均在请求前拒绝。
- **XSS 防护**：保留 `markdown-it html:false` 与 KaTeX `trust:false`，最终 DOM sink 新增 DOMPurify allowlist；覆盖 script、SVG、事件属性、`javascript:` 与主动嵌入标签。
- **sidecar 完整性**：Release 继续强制 SHA-256；Debug 缺 manifest 也默认拒绝，仅显式 opt-in 可绕过并显示日志/全局 UI 警告。Tauri build 前自动生成 manifest。
- **最终审计跟进**：document-worker 可执行文件与 Python 回退统一 `env_clear` 后按最小白名单恢复环境；SymPy 入口新增 operation、变量名、表达式长度/字符/标识符/token/括号深度校验。code-worker 移除未生效的 `memoryLimitMb` 契约并对该字段 fail-closed，wrapper 改为单次渲染，执行子进程不再继承 `PATH`。
- **修复后再审计收敛**：可信 Debug code-worker 的 stderr/error/warnings 在 Rust IPC 边界统一清洗 ANSI/控制字符、绝对路径和常见凭据形态，单项限制 4K 字符，同时保留错误类型/行号。明文 Key 启发式扩展到 Groq、Google、Hugging Face、GitHub、Slack、Stripe、AWS、OAuth/JWT，并修复 Authorization/Bearer 后续 token 遗留。document-worker 不继承 `PATH` 维持为有意的最小权限设计。
- **安全边界**：本次没有实现 OS 级代码隔离，不宣称“完全安全”；D-112 继续跟踪 Windows Job Object + 受限令牌/网络/文件系统或 Wasmtime 方案。
- **供应链残留项**：运行时继续强制 sidecar SHA-256，但 PyInstaller/pytest 构建依赖尚未采用 hash-pinned lock；已由 D-113 记录，不虚报为已完成。
- **验证结果**：code-worker 68 passed；document-worker 43 passed；前端 53 files / 1116 tests passed，code-runner 教学反馈专项 10 passed；Rust 201 passed（worker 专项 34、shared 脱敏 15、code-worker 边界 11）；release 专项 15 passed；`cargo fmt --check`、`cargo check`、`npm run build` 通过；最终 code-worker 冒烟覆盖默认拒绝、可信执行、伪内存限制拒绝和占位符不重扫；Tauri MSI/NSIS 构建成功；`release-check.ps1` 8/8 通过。

### 2026-08-10（AlertTime Android 用户自带 Provider 与独立学习分析）

- **授权边界**：Provider 地址、模型和 Key 全部由用户在 Android 独立设置中填写，应用不内置默认；手机可在未配对、桌面离线时独立生成并保存分析，稍后局域网同步再生成绑定新快照的分析。不扩展云端数据库、账号、公网同步、后台上传、云端学生画像或移动端完整辅导。权威 ADR：`docs/decisions/2026-08-09-alerttime-android-plan-assessment.md`。
- **目标契约**：用户填写的学习目的、考试/项目、考试科目和目标日期写入版本化最小 Prompt；独立生成与每次新客户端同步包含 facts/inferences 分离的 profile、planEvaluation 与无答案 assessmentDraft；Provider 失败时使用 `deterministic_fallback`。
- **证据边界**：学习时长仅属投入证据；草稿题仅 draft，不进入 approved 题库、`assessment_results` 或 `student_knowledge`。正式 mastery 仍由 approved 题库真实答题更新。
- **安全边界**：Android API Key 由 Keystore 保护，只发送用户声明与最小计划/聚合执行上下文；最近分析是排除于备份的派生缓存，用户学习目标作为普通设置可备份。Teacher 按 untrusted sync-side data 校验 `sourceSnapshotId` 后只读展示。Android UI 不直接网络/DAO，Teacher UI 不直接 DB/Provider。
- **当前状态**：双端 DTO、Android Provider/确定性降级、手机独立持久化与 Teacher 接收/展示均已实现；自动门禁完成：Teacher 前端 61 files / 1248 tests、Rust 256 tests、前端正式构建、`cargo fmt --check` 均通过，Android 33 suites / 215 tests、lint、debug APK 与 androidTest APK 构建均通过，两端 10 个协议文件 SHA-256 逐项一致。终审已将 LLM 输入收敛到手机本地今日计划/当前周目标/今日完成会话，以 `sourceTaskIndex` 在手机端映射真实任务与学科引用，并统一 Kotlin、Rust、JSON Schema 的嵌套非空字符串与 envelope 时间/版本约束；Teacher 的派生分析缓存损坏时只忽略该分析，不再拖垮其他同步读模型。协调器级网络失败回归已证明首个桌面请求发生前最近分析已经本地保存，失败仍正常返回且不会伪造同步成功。Android 分析生成以确定性基线的 `generatedAt` 作为整次分析唯一时刻，日期范围、LLM 输入、LLM 成功结果与降级结果共用同一手机本地时区；即使 Provider 响应跨过午夜也不会漂移。不同 ViewModel 创建的 Repository 仍共享分析操作互斥，独立生成不会与同步前生成并发覆盖最近结果；空 AppSetting 数据库也不会产生内嵌 Provider、模型或可请求配置。另修复测试夹具依赖系统当前自然周导致的跨周回归波动。生产统计仍默认使用真实当前周。真实 Provider、进程重启 UI 和手机—桌面局域网闭环仍待实机验收，不得宣称实机完成。
- **2026-08-10 审查收敛**：Android 未保存的学习目标或 Provider 草稿会阻止生成，刷新、设置保存、独立生成和同步生成互斥；可选 UsageStats 读取失败降级为 unknown，不阻断分析或同步。今日统计纳入跨午夜完成会话，并在同步 DTO 缺少暂停事件时按本地自然日重叠比例分摊；`durationSeconds` 已是有效专注时间，不再重复扣除 `pauseSeconds`。两端要求 `evidenceRefs` 绑定当前快照实体或冻结聚合/用户设置证据；Rust 读取历史缓存时重做同一语义校验，失效分析仅隐藏自身。建议处理结果回传部分失败时保留待发记录并在 Android 明示下次重试，配对/同步操作使用全进程互斥。真实 Provider、进程重启 UI 和手机—桌面局域网闭环仍待实机验收。
- **缓存重启边界**：手机最近分析缓存新增最小 remoteId 证据索引，重开时可继续执行证据绑定校验而不会把合法任务/会话证据误判为无效；索引不复制计划正文、会话备注或 Provider 信息。真实 Room 文件关闭/重开 instrumentation 测试已写入并成功构建，但尚未在设备执行。
- **用户自带 Provider 请求证据**：内存 OkHttp 契约测试已验证用户填写的 Base URL、模型与显式认证模式进入请求，API Key 不进入 JSON 正文，失败消息不回显响应正文或密钥。另新增独立测试数据库与独立 Keystore alias 的 instrumentation，验证 Room 关闭/重开后的配置恢复、密文落库和重新解密；独立设置入口 Compose instrumentation 则锁定未配对、未配置 Provider 时仍可进入手机本地规则生成。两项均已成功编译进 androidTest APK，尚未在设备执行。真实服务商兼容性、TLS 与设备网络仍留待实机验收。
- **安全设备入口**：AlertTime 新增 `scripts/verify-learning-analysis-device.ps1`。默认只读预检，显式确认后仅用覆盖安装运行三个隔离 instrumentation；拒绝新装、多设备、卸载、清数据和全量设备测试，并核对安装前后 package userId/firstInstallTime。脚本语法解析与无设备 fail-closed 已验证；当前 `adb devices` 为空，尚未形成真机结果。
- **剩余验收收口**：目标能力当前没有已知代码缺口；`docs/verification-checklist.md` 第 17 节剩余 11 条均为运行证据，已合并为 4 个批次：设备安全与 3 项隔离测试、手机独立生成与重启持久化、Provider 关闭时的局域网确定性闭环、用户自带真实 Provider 与故障注入。任一批次失败后才按证据重新打开实现项；云端数据库、账号、公网同步和后台上传仍是明确非目标。

### 2026-08-11（无设备跨层回放门禁）

- **单命令入口（主 Agent 已实际复跑）**：Windows PowerShell 5.1 AST 解析通过；Node mirror 单测 7 项中 6 passed、1 skipped，跳过原因为 Windows 无符号链接权限且逻辑为明确拒绝。执行 `npm run verify:alerttime-offline -- -AlertTimeRoot "C:\Users\Acer\Documents\AlertTime-teacheragent-json" -RustToolchainBin "D:\DevEnv\Caches\.rustup\toolchains\stable-x86_64-pc-windows-msvc\bin"` 完整 exit 0。Teacher canonical Vitest 10 passed，Rust `snapshot_route_` 2 passed，Android `LearningAnalysisOfflineReplayTest` JVM 类通过且 Gradle `BUILD SUCCESSFUL`；双端协议 10 files identical。
- **离线边界与守卫结果**：无 ADB、无设备、无安装/卸载/清数据、无 connectedAndroidTest；`local.properties` 未创建或修改，脚本守卫通过；无 rustup 自动修复、无 Git 暂存/提交。该结果不替代 instrumentation、真实 Provider 或局域网手机—桌面真机闭环。

- **Teacher HTTP 回放**：在 Axum Router 内直接回放 canonical `snapshot-valid.json`，覆盖凭据鉴权、信封与学习分析校验、SQLite 导入、`snapshotAck` 和 read model 读取；错误 `sourceSnapshotId` 返回 422，并确认 `sync_snapshots` / `sync_learning_analyses` 均无残留。测试不监听端口、不访问网络。
- **Android 离线回放**：JVM 测试串联 `LearningAnalysisService` 与 `LearningAnalysisRepository`，验证未配置 Provider 时走 `deterministic_fallback`，快照 A/B 分别绑定当前 `sourceSnapshotId` 并生成不同 `analysisId`，共享互斥保证旧结果不会覆盖新快照最近分析；不使用设备、ADB、Room、Keystore 或真实网络。
- **Teacher canonical 投影**：Vitest 直接读取双端协议 canonical fixture，验证事实、推断、计划评估、draft 题展示模型以及 snapshot 绑定、答案字段、evidenceRef、置信度和分数边界；实体归属仍由 Rust 持有当前快照 ID 集合并 fail-closed，不错误下沉给缺少该上下文的前端函数。
- **此前同日早期复跑结果（历史上下文）**：Teacher 前端 62 files / 1258 tests、Rust 258 tests、Android 34 suites / 216 tests 全部通过；Teacher build、Rust fmt、Android lintDebug / assembleDebug / assembleDebugAndroidTest 通过；双端 `sync/protocol` 各 10 个文件 SHA-256 一致。该结果仅保留为早期回放记录，以下方最新门禁为准。

- **最新无设备闭环（主 Agent 与 Luna 已实际确认）**：生产 `SyncCodec.decodeSnapshotEnvelope` 回放 canonical fixture 后进入 `LearningAnalysisService` / Repository，覆盖软删除、Unicode/emoji、AI 使用字段、今日计划及稳定实体 ID 的 A/B 状态变化。`sync_get_device_state` 以单连接、单 SQLite 读事务原子返回 `readModel + lastSnapshot`。Pinia store 防回归测试锁定 `loadDevice` 仅调用原子 `getSyncDeviceState`；合法 `analysis.sourceSnapshotId` 与 `lastSnapshot.snapshotId` 一致，report 使用同一 snapshot，两个 legacy 命令均未调用。
- **Rust SQLite 边界验证**：canonical fixture 真 SQLite 文件关闭/重开、迁移 0012 回填、迁移 0013 从带旧数据的 v12 安全升级并幂等、同毫秒 A/B 顺序、最新无分析不回退旧分析、分析冲突整事务回滚均已覆盖；`user_version` 为 13。周目标/计划的 `sourceProposalId` 经快照导入、SQLite、重启与 read model 往返保持，且不要求本地存在 proposal 行。
- **Teacher 投影与组件验证**：同一 canonical fixture 的事实、推断、计划评估和 draft 题投影，以及 snapshot 绑定、答案字段、evidenceRef、置信度和分数边界已覆盖；`LearningAnalysisPanel` 真实 SFC SSR 完整渲染、snapshot mismatch、null fallback 3 项通过。
- **今日计划与诊断闭环收敛**：练习范围优先使用今日计划映射到的 approved 考试叶子；父级考试组、draft Pack、跨叶子归属和空白显式 whitelist 均 fail-closed。叶子掌握度只读取该范围内全部 approved knowledge node。同步诊断 evidence 写入现有 `assessment_results.evidence_json`，提案生成时由 Rust 重新从 SQLite 权威读取；localStorage 只提供候选 ID，不能改写正确数、学科归属或时间。历史证据仅在 mapping 唯一且考试叶子一致时兼容。
- **提案传输与 Android 接收收敛**：提案列表改为稳定 keyset 分页；空白、未知和跨设备 cursor 返回 400 `invalid_cursor`。Android 拉取全部页面后一次性合并，重复 ID、循环 cursor、中途失败和超过 100 条均不产生部分写入；snapshot/decision ACK 与请求 ID、计数和决策严格绑定。同步题目与 Android Provider 输出在 typed decode 前拒绝直接 `answer` / `solution` / `explanation` 等答案字段。
- **Android 用户自带 Provider 网络边界**：新增 `none` 无认证模式；它不保存或发送 Key，可使用 HTTPS 或 loopback/RFC1918 HTTP。Bearer 与 `api-key` 模式必须使用 HTTPS 且必须有非空 Key。切换到 `none` 时 Room 事务内删除旧密文后才启用；Android cleartext 平台许可只提供动态私网地址能力，实际请求仍由 `EndpointPolicy` 做唯一入口校验，且 OkHttp 禁止重定向。真实 TLS、厂商兼容性和手机网络仍待实机验收。
- **最新自动门禁**：Teacher Vitest 69 个测试文件 / 1309 个测试全部通过，`npm run build` 通过且 main bundle 为 473.78 kB；Rust `cargo test --all-targets` 283/283 通过、`cargo fmt --check` 通过；Android 36 suites / 264 tests 全通过，`lintDebug`（0 errors / 12 warnings）、`assembleDebug`、`assembleDebugAndroidTest` 通过；Node 独立 `npm run test:protocol-mirror` 6 项通过、1 项因 Windows 符号链接权限按预期 skip、exit 0；单命令离线闭环再次通过，双端 `sync/protocol` 10 个文件与 Android JVM 8 个 canonical fixture 文件逐字节一致。
- **边界与待验收**：无 ADB、无设备、无安装/卸载/清数据、无 connectedAndroidTest；未操作设备，双端功能工作树无暂存/提交。真实 Provider、进程重启 UI、Android instrumentation 和手机—桌面 LAN 真机闭环仍未完成；该离线闭环不替代这些验收。云端数据库、账号、公网同步和后台上传仍是明确非目标。
