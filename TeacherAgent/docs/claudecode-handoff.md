# Claude Code Handoff

最后更新：2026-07-29
当前阶段：Phase 3 核心功能已完成 + 安全加固 + 私有资料 RAG 集成 + sourceType 统一 + 边界保护 + 对话内资料上下文管理 + 会话级资料绑定持久化 + Document Worker PyInstaller 打包 + Tauri Sidecar 集成 + 性能优化 + 孤立节点清理 + 热门专业知识库扩容 + code-runner + timeout clamp + 文档真相源统一 + Provider 配置帮助中心
建议角色分工：用户做实机验证和 Provider 配置，Claude Code 继续修复问题。

## 当前做到哪了

TeacherAgent 已完成 Phase 0-4 的代码级开发 + Phase 1 本地 RAG + Phase 2 核心功能 + Phase 3 核心功能 + 知识库 Pack / 懒加载基础设施 + 学科选择与 Pack 启用范围：

- Tauri 2 + Vue 3 + TypeScript + Pinia + Vuetify 3 工程已建立。
- 5 个页面：对话辅导、练习、仪表盘、知识图谱、设置。
- Rust 后端已拆出 `models`、`database`、`provider`、`conversation`、`memory`、`assessment`、`knowledge`、`vector`、`bkt`、`math_engine`、`seed`、`ollama`、`worker`、`private_doc` 模块。
- **Phase 2 新增**：自适应练习推荐引擎（questionRecommender.ts）、仪表盘雷达图（chart.js）、向量搜索集成到 ToolAgent（vector/embedding 基础设施就绪，seed embedding 未生成，真实向量 RAG 未闭环）。
- **Phase 3 新增**：知识图谱天赋树（v-network-graph）、学习路径规划器、Ollama 本地引擎集成。
- **Provider 配置帮助中心**：本地结构化指南（Kimi/Ollama/通用 OpenAI Compatible），设置页抽屉式教程、预设应用（不触碰 API Key）、错误诊断联动、Provider 自动识别。与教学 RAG/Embedding/知识库完全隔离。治理文档：`docs/provider-guide-governance.md`。
- **知识库 Pack / 懒加载基础设施**：ChatView chunk 从 566 kB 降至 458 kB，低于 500 kB 警告阈值。新增 `packManifest.ts` 和 `packLoader.ts`，使用 `import.meta.glob` 让 Vite 将 seed JSON 打包为独立 chunk，运行时按需加载。PracticeView 已迁移到异步搜索接口。
- **CS408 知识库接入**：QoderWork 产出的 408 考研知识库（数据结构、组成原理、操作系统、计算机网络）以 draft pack 形式接入。CS408 已升级为每科 40 nodes / 40 questions，CS408 总计 160 nodes / 160 questions。PracticeView / KnowledgeGraphView / DashboardView 已改为读取 appStore.selectedSubject，支持学科切换。
- **物理知识库接入**：WorkBuddy 产出的大学物理知识库（力学、电磁学、热学、波动与光学、近代物理）以 draft pack 形式接入，共 41 知识节点 / 75 道题。`SubjectCode` 类型已扩展 `"physics"`，Rust `normalize_subject_code` / `subject_name` / `subject_style_key` 已注册物理分支，`packSelection.ts` 和 `plannerAgent.ts` 已补上物理条目。
- **流式 LLM 安全加固**：`openAiCompatibleProvider.ts` 的 `stream()` 方法已迁移至 Rust 后端转发（`complete_llm_chat_stream` Tauri command + `Channel<LlmStreamChunk>`），API Key 不再离开 Rust 进程。浏览器 DevTools 网络面板不再显示任何直接对 LLM 的请求。
- **Seed 覆盖导入**：`seed_knowledge_nodes` 新增 `overwrite` 参数，设置页新增「强制覆盖已存在节点」复选框，本地修改 seed JSON 后可强制更新已存在节点（保留 `created_at`）。
- **知识库 Pack 管理与质量门禁**：新增 `packStatus.ts`（状态统计）和 `packValidator.ts`（质量校验）服务。设置页新增"知识库管理"区域，显示 Pack 总览、按 subject 汇总、Pack 列表，支持刷新状态、Seed 全部（含覆盖模式）、校验 Pack 操作。校验规则包括 manifest count 严格按 pack 精确匹配（subject+chapter 或 packLoader 注入的 `__packId`）、ID 唯一性、prerequisite 引用有效性、hints L1/L2/L3 完整性、source/license 合规、difficulty 1-3 范围等。当前 21 个 Pack 应通过 validator。
- **学科选择与 Pack 启用范围**：新增 `packSelection.ts` store，支持 math/cs408 学科切换和 Pack 启用/禁用管理。启用状态保存在 localStorage，不影响 seed 文件。设置页新增 Pack 启用/禁用界面，支持单个切换、启用全部、禁用全部、恢复默认。对话知识库搜索、练习推荐、仪表盘统计和知识图谱均使用 enabledPackIds 过滤。不能禁用最后一个 Pack。
- SQLite migration、运行时迁移、会话、消息、学习记忆、反思记录、评估结果、掌握度和 Provider 配置表已接入。
- Provider 配置不再写死任何云厂商；用户填写 Provider 名称、Base URL、模型和 API Key。
- API Key 写入系统凭据存储，SQLite 只保存 `api_key_ref`。
- OpenAI-compatible 请求由 Rust `complete_llm_chat` command 代理；流式请求由 `complete_llm_chat_stream` 通过 Tauri 2 Channel 转发。
- MiMo Provider 已做兼容：当 Provider 名称、Base URL 或模型中包含 `mimo` / `xiaomimimo.com` 时，Rust 请求会使用 `api-key` 请求头和 `max_completion_tokens` 参数。
- MiMo 二次兼容已补代码并已验证通过：请求补充 `top_p`、`stop`、`frequency_penalty`、`presence_penalty`，并把 MiMo 的 `temperature <= 0` 归一到 `1.0`；设置页测试连接对 MiMo 使用 `temperature = 1` 和 `max_completion_tokens = 1024`。Claude Code 已补跑 `npm run test`（38 条通过）、`npm run build`、`cargo fmt`、`cargo check`、`cargo test`（13 条通过），全部成功。
- 本地数学知识库已扩充到 35 个原创知识节点，题库已有 12 道原创题目。
- `knowledge_search`、`question_bank_search`、规则版 PlannerAgent、规则版 ReflectionAgent + LLM Reflection、规则版 AssessmentAgent 和 Guardrail rewrite-once 已接入 TutorOrchestrator。
- Planner 类请求在未配置 Provider 时也能返回规则规划；普通对话未配置 Provider 时会提示去设置页。
- 对话消息会保存 `knowledge_refs_json`、`tool_refs_json`、`guardrail_json` 和 Planner 元数据。
- 核心 Tauri 窗口 UI 已针对 WebView 兼容性改造：主导航、聊天输入区、Provider 设置表单、会话标题输入、关键按钮均使用原生控件或稳定 CSS。

## 最近验证

最近一次通过（2026-07-10 timeout clamp + 文档统一后需重新验证）：

```powershell
npm run test -- --maxWorkers=1   # 850 条通过，41 个测试文件全绿
npm run build                    # ✓ built in 4.1s，主 bundle 474 kB（< 500 kB 阈值）
cd src-tauri
cargo fmt -- --check             # 无格式问题
cargo check                      # 0 warning
cargo test                       # 全部 Rust 测试通过（132 条）
```

关键安全保证：
- orphan 清理不删除 student_knowledge（有学习记录的节点自动跳过）
- health check / cleanup 使用严格 pack 加载（任一 pack 失败则拒绝执行清理）
- code-runner timeout 在 Rust 层双重 clamp（lib.rs 入口 + code_worker.rs 防御层），watchdog 使用 saturating_add 防溢出
- code-runner 是教学护栏，非安全沙箱；2026-07-30 起 Release 无条件关闭，Debug 仅双重显式 opt-in 的可信开发模式可用
- 文档导入不再接受前端绝对路径，只接受 Rust 文件选择器签发的一次性授权令牌并解析 staging 副本
- Provider API Key 与规范化 endpoint 在 Keychain 中绑定；旧未绑定 Key 需用户重新录入

当前覆盖：

- 全库：723 知识节点 / 726 道题（数学 122/91 + CS408 160/160 + 物理 41/75 + 英语 80/80 + 政治 80/80 + 管理类联考 60/60 + 教育学 60/60 + 心理学 60/60 + 法律硕士 60/60），41 个 Pack。
- difficulty 已统一为 1/2/3（入库时 `.clamp(1, 3)`，推荐引擎上限 3）。
- 冷启动默认掌握度 0.5（Rust assessment.rs + 前端 questionRecommender / PracticeView / DashboardView / submitPracticeAnswer）。
- 学科选择：`appStore.selectedSubject` 是唯一状态源，支持 math / cs408 / physics / english / politics / management / education / psychology / law。
- 学科选项从 `AVAILABLE_SUBJECTS`（基于 packManifest）派生，设置页和 Pack 管理使用同一数据源。
- Pack 启用范围：`packSelectionStore` 按 subject 管理启用状态，保存在 localStorage。
- 流式 LLM 全量走 Rust IPC：`complete_llm_chat_stream` + `Channel<LlmStreamChunk>`，API Key 不暴露给前端。
- Seed 覆盖导入：设置页「强制覆盖已存在节点」复选框，勾选时 `seedAllKnowledgeNodes(true)` 覆盖已存在节点。
- enabledPackIds 已贯穿：ChatView → tutorOrchestrator → toolAgent → searchLocalKnowledgeLazy / searchLocalQuestionBankLazy。
- dist 中 50 个 seed JSON chunk（25 pack × 2）。
- **私有资料导入草稿层**：设置页"私有资料导入"区域，支持 PDF/DOCX/XLSX 预览 → 确认导入 → SQLite（`private_documents` + `private_document_chunks`）。save/delete 均在单一事务内完成。delete 为彻底删除（hard delete，非软删除）。不保存原始路径，不上传云端，不写入内置 Pack。设置页显示已导入资料数量和 RAG 接入状态。
- **对话内资料导入**：ChatComposer 新增附件按钮，支持在对话页直接选择 PDF/DOCX/XLSX，本地解析后保存到 private draft，并把当前会话最近导入资料记录为 `recentPrivateDocument`。用户随后说"这份资料/刚才上传的资料"时，ToolAgent 优先读取该文档 chunks。
- **私有资料 RAG**：ToolAgent 对话时自动检索私有资料（keyword/simple scoring，最多 3 条），与 built-in Pack 结果合并注入 prompt。sourceType 区分 `built_in_pack` / `private_document`。引用私有资料时使用"你的资料中提到..."表达。私有资料搜索失败不影响 built-in 检索。
- **sourceType 契约统一**：`SourceRef.sourceType` 包含 `built_in_pack`、`private_document`、`local_knowledge`、`open_web`、`oer`、`user_content`、`generated`。`private_user_import` 仅作为 license/来源标识，不再作为检索结果类型。
- **自然问句私有资料检索**：toolAgent 从自然语言问句提取关键词再传给 Rust LIKE 搜索，避免完整问句无法匹配 PDF 文本。
- **LIKE 元字符转义 + tokenized OR 搜索**：Rust 端对 `%`/`_`/`\` 转义，query 拆分为多 token 用 OR 条件匹配，防止注入式宽匹配。
- **DocumentImportPanel 状态链修复**：loading/error/empty/list 使用 v-if/v-else-if/v-else 单链。
- **边界保护**：list_private_documents limit clamp 1..=100（默认 50），search_private_document_chunks limit clamp 1..=10（默认 5），空 query 返回空，超长 query 截断 200 字符。
- **资料摘要/大纲查询意图**：SocraticAgent 新增 `outline_summary` intent，覆盖"考哪些内容/大纲/考试范围/讲了什么/帮我总结/syllabus"等跨学科查询模式。命中时 shouldAskQuestion=false，先结构化概括再给轻量后续建议。`intent` 字段贯穿 SocraticDecision → TutorTeachingStrategy → prompt builder，与 review 模式互不干扰。
- **SocraticAgent intent 体系**：SocraticDecision 新增 `intent` 字段（SocraticIntent 类型），区分 concept_question / outline_summary / practice_solve / direct_answer_request / review / learning_plan / exam_sprint / emotional_support / counterexample / default_guide。
- **Output contract 版本**：TUTOR_OUTPUT_CONTRACT_VERSION = tutor-output-contract-v1.1，TUTOR_SYSTEM_PROMPT_VERSION = tutor-system-v1.1。
- **Document Worker**：Python sidecar 架构，Rust 通过 `std::process::Command` 调用。PDF/DOCX/XLSX 文本提取 + SymPy 数学计算。安全限制：50MB 上限、30 秒超时、不执行宏、不访问网络。

## 当前未完成（需用户操作或后续开发）

已完成代码但需用户实机验证：
- 重新构建安装包（当前 7 月 7 日安装包已过期，不包含 code-runner 等修复）
- 5 个页面的实际渲染和交互（对话、练习、仪表盘、知识图谱、设置）
- 真实 Provider 配置和 LLM 对话验收
- 练习结果写回掌握度/BKT 完整链路（BKT 计算已接入，assessment 写入已对接 student_knowledge）
- code-runner 可信 Debug 模式端到端执行（需 Python 3.10+ / code-worker exe，并显式设置双重开发开关；生产禁止）

基础设施就绪但需后续开发：
- embedding 批处理已实现，但全库 embedding 生成需 embedding Provider（或 Ollama + bge-m3）
- 真实向量 RAG 语义检索验收

需外部依赖或用户安装：
- Ollama 本地模型集成
- OCR/语音输入
- 自动更新机制

## 不要做

- 不要把 API Key 写入 Pinia、localStorage、SQLite 明文字段、日志或普通文件。
- 不要在前端 `fetch` 中直接携带 API Key 发起 LLM 请求（包括流式），所有 LLM 请求必须走 Rust IPC。
- 不要绕过 GuardrailAgent 直接返回 LLM 草稿。
- 不要在用户验证前接入 SQLite-vec 或 sidecar。
- 不要导入版权不明教材、题库或爬虫内容。
- 不要恢复核心表单里的 Vuetify `v-text-field`、`v-switch`、`v-select`，当前 Tauri 窗口 已出现过不可见问题。
- 不要使用旧题型（proof / single / multiple_choice / calculation / analysis / short_answer）；question.type 只允许 `concept_check` / `solution` / `diagnostic`。
- 不要使用 difficulty 4/5；difficulty 只允许 1 / 2 / 3。
- 新增学科时，必须同步更新 `SubjectCode` 类型、`subjectLabel` 映射、Rust `normalize_subject_code` / `subject_name` / `subject_style_key`、`AVAILABLE_SUBJECTS`、`subjectStyle.ts` 和 `plannerAgent.ts`。

## Codex Review 重点

Claude Code 完成后，Codex review 应重点检查：

- Provider API Key 是否只通过 keychain 引用流转。
- 设置页是否仍能在 Tauri 窗口中真实输入和点击。
- 普通对话是否仍通过 TutorOrchestrator、GuardrailAgent 和消息持久化链路。
- 练习模式是否不把 `answer_for_internal_review_only` / `solution_steps_for_internal_review_only` 暴露给学生。
- 新增验证记录是否和实际命令/窗口结果一致。
