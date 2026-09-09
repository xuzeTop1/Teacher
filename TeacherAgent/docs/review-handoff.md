# TeacherAgent Review Handoff

最后更新：2026-07-02

## 当前阶段

Phase 3 核心功能已完成。`npm run test`（11 文件 99 条）、`npm run build`、`cargo fmt -- --check`、`cargo check`（0 warning）、`cargo test`（55 条）均通过。

## 已完成

- 5 个页面：对话辅导、练习、仪表盘、知识图谱、设置。
- Rust 后端 12 个模块：models、database、provider、conversation、memory、assessment、knowledge、vector、bkt、math_engine、seed、ollama。
- **Phase 2 新增**：自适应练习推荐引擎、仪表盘雷达图可视化、向量搜索集成到 ToolAgent（vector/embedding 基础设施就绪，seed embedding 未生成，真实向量 RAG 未闭环）。
- **Phase 3 新增**：知识图谱天赋树（v-network-graph）、学习路径规划器、Ollama 本地引擎集成。
- Provider keychain 路径：API Key 存系统凭据，SQLite 只存 `api_key_ref`。
- Rust math_compute command：纯 Rust 符号计算引擎。
- BKT command：贝叶斯知识追踪算法。
- 基础向量存储：BLOB + 余弦相似度（纯 Rust，无 C 扩展）。
- 规则/LLM Reflection 代码。
- 知识库：53 节点（极限 35 + 线代 10 + 概率 8），22 道题目。
- 路由懒加载优化。
- 对话消息会保存知识引用、工具摘要、Provider/Prompt 版本、Socratic 策略、Guardrail 摘要和 Planner 结果。
- 修复了 P3 实机验证中的流式输出截断问题：已实现句子级缓冲（Sentence-Buffered Streaming），并将 TutorOrchestrator 中 `maxTokens` 从 900 提升至 4096 以兼容深度思考模型，同时修复了 `openAiCompatibleProvider.ts` 中网络流末尾边界情况导致的丢字问题。
- 修复 Tauri 窗口主导航不可见问题：`App.vue` 改为稳定 CSS 侧边栏。
- 修复聊天页布局：消息区滚动，输入框和发送按钮保持可见。
- 对话输入区和关键按钮已改为原生 `textarea` / `button`，降低 Tauri WebView 中 Vuetify 输入/按钮可见性和点击代理风险。
- 设置页 Provider 表单已改为原生 `input` / `checkbox`，教学偏好学科选择已改为原生 `select`，修复 Tauri 窗口中 LLM Provider 输入项不可见、测试/保存按钮一直禁用的问题。
- Provider 设置页按钮顺序已调整为先“保存本次运行配置”、再“测试模型连接”，并在函数层保护未满足条件时不执行保存或测试。
- 会话标题栏也已从 `v-text-field` 改为原生 `input`；核心视图和聊天组件已无 Vuetify 表单输入控件残留。
- 已补充 ChatComposer 发送启用规则测试和 TutorOrchestrator 无 Provider 分叉测试。
- 已补充 OpenAI-compatible Provider 安全测试：`apiKeyRef` 请求委托 Rust command，避免浏览器直接 fetch。
- 已补充 Provider 表单状态测试：测试连接必须使用已保存的 `apiKeyRef`，新输入 API Key 只能先保存到系统凭据存储。
- 已补充 TutorOrchestrator 练习请求 prompt 防泄露测试：练习模式发给 Provider 的 prompt 只包含题目和提示，不包含内部答案或步骤标签。
- 已补充 TutorOrchestrator 复盘请求 prompt 边界测试：复盘模式发给 Provider 的 prompt 可包含内部答案和步骤作为参考，但学生可见回复仍不得包含内部标签。
- 已补充 TutorOrchestrator Guardrail 重写路径测试：Provider 草稿即使泄露内部题库标签，也必须先被改写，学生可见回复不得包含内部答案或步骤标签。
- 已将 Planner 历史元数据解析和 StoredMessage 恢复映射抽为 `chatMessageMetadata.ts` 纯函数，并补充测试，确认 `tool_refs_json.plannerResult` 可恢复为 Planner 面板数据；坏 JSON 或非 Planner 元数据会安全忽略，`tool` 等内部消息不会进入学生可见消息列表。
- 已补充 `tool_refs_json` 写入侧序列化测试：已有 `toolRefsJson` 会原样保留，无元数据写 `[]`，只有 `plannerResult` 时可序列化并被同一解析函数恢复。
- 已补充 Tutor 轮次元数据隐私测试：`tool_refs_json` 只保存 Provider、Prompt、Socratic 策略、工具命中数量/id 和评估 id 等摘要，不保存 `rawDraft`、完整工具上下文、内部答案或内部步骤标签。
- 已补充知识引用元数据隐私测试：`knowledge_refs_json` 只保存知识点 `id/title/subjectCode`，不保存 RAG 摘要、常见误区、苏格拉底提示或内部检索说明。
- 已开始 Rust 后端模块化：新增 `src-tauri/src/models.rs`、`database.rs`、`provider.rs` 和 `conversation.rs`，分别承接 DTO、数据库基础设施、Provider/LLM 代理、会话/消息 repository。

## 当前验证

最近一次完整通过（2026-07-02 文档口径收敛时复跑）：

```powershell
npm run test      # 11 文件 99 条通过
npm run build     # ✓ built in ~3.8s
cargo fmt -- --check  # 无格式问题
cargo check       # 0 warning
cargo test        # 55 条通过
```

当前测试覆盖：

- 前端：11 个测试文件、99 条测试。
- Rust：55 条测试（含 BKT 9 条、math_engine 14 条、vector 5 条、seed 11 条、provider 5 条、core 11 条）。

重点测试包括：

- 本地知识库命中“夹逼定理”“可去间断点”。
- 本地题库按主题和知识点 id 找题。
- ToolAgent 练习模式不暴露答案，复盘模式才注入内部答案。
- 普通概念问题不触发题库检索。
- Planner 请求无需 Provider 也能返回规则规划。
- 普通非规划辅导问题在无 Provider 时会要求配置 LLM Provider。
- ChatComposer 发送按钮规则：空白输入不会发送但会聚焦输入框，有内容时发送，发送中才禁用按钮。
- Provider 请求安全边界：`apiKeyRef` 路径走 Rust `complete_llm_chat`，无认证引用的非本地 Provider 不发起浏览器请求。
- MiMo Provider 兼容边界：MiMo runtime-key fallback 使用 `api-key` 和 `max_completion_tokens`，不使用 `Authorization: Bearer` / `max_tokens`。
- Provider 表单安全边界：远程 Provider 测试连接必须先保存 keychain 引用，新输入 API Key 不直接进入测试连接路径。
- Orchestrator 练习 prompt 边界：`给我一道夹逼定理练习` 会触发 `question_bank_search`，但发给 Provider 的 practice prompt 不包含内部答案或步骤标签。
- Orchestrator 复盘 prompt 边界：`帮我复盘这道夹逼定理题` 会把内部答案和步骤放入 review prompt 供导师参考，但最终学生可见回复不包含内部标签。
- Orchestrator 防泄露边界：Provider 草稿含 `answer_for_internal_review_only` / `solution_steps_for_internal_review_only` 时，Guardrail 会触发一次改写，最终学生可见内容不包含内部标签。
- Planner 历史恢复边界：`tool_refs_json.plannerResult` 可解析回 `PlannerResult`，缺失的信号数组和置信度有安全默认值，坏 JSON 不会阻断历史消息加载；恢复消息列表时只保留 student/tutor 消息并保留元数据字段。
- Planner 元数据写入边界：保存消息时会复用既有 `toolRefsJson`；只有 `plannerResult` 时写出可恢复的 `tool_refs_json`；无元数据时写入空数组占位。
- Tutor 轮次元数据隐私边界：落库的 `tool_refs_json` 不包含 `rawDraft`、`answer_for_internal_review_only`、`solution_steps_for_internal_review_only` 或完整内部工具上下文。
- 知识引用元数据隐私边界：落库的 `knowledge_refs_json` 只包含知识点引用，不包含完整 RAG 上下文、误区列表或提示词。
- SQLite migration 幂等。
- 本地自检消息写读后回滚。
- 会话消息和元数据回读。
- 学习记忆、反思记录、评估记录、掌握度更新。
- Provider 配置不保存明文 API Key。
- 非本地 LLM 请求必须提供 keychain 引用。
- 消息元数据 SQLite 往返：学生消息缺省元数据会保存为 `[]` / `{}`，导师消息的 `knowledge_refs_json`、`tool_refs_json`、`guardrail_json` 可保存并按原字段读回。

## Review 重点建议

1. UI 交互
   - 检查左侧主导航是否在 Tauri 窗口稳定显示。
   - 检查对话页输入框是否始终可见。
   - 检查会话标题输入框是否可见、可输入并可保存。
   - 检查设置页 Provider 名称、Base URL、模型、API Key 和本地 Provider 开关是否可见可输入。
   - 检查设置页“初始化 SQLite”和“运行本地自检”是否可点击并展示结果。

2. Provider 安全
   - 确认前端 store、SQLite、日志都不保存明文 API Key。
   - 确认设置页加载 Provider 配置时不会把 API Key 回填到输入框。
   - 确认填写新 API Key 后先保存配置，再用已保存的 `apiKeyRef` 测试连接。
   - 确认 Rust 错误日志没有输出请求体、对话内容或学生画像。

3. 教学链路
   - 未配置 Provider 时，普通对话应提示去设置页配置模型。
   - 未配置 Provider 时，规划类请求应能走 PlannerAgent。
   - 练习类请求应触发题库，但不要直接显示答案。
   - 复盘/解析类请求可使用答案作为内部参考。

4. 数据持久化
   - 确认消息、`knowledge_refs_json`、`tool_refs_json`、`guardrail_json` 能保存并恢复。
   - 确认 Planner 面板在历史会话重新加载后仍可展示。
   - 确认本地自检不留下 smoke message。

## 已知限制

- Windows Computer Use 自动化插件本轮连接失败：`failed to write kernel assets: 系统找不到指定的路径。 (os error 3)`，所以没有完成自动窗口点击验证。
- **[Phase 1 跳过] sqlite-vec crate 未下载**：网络无法连接 crates.io（`Could not connect to server (Failed to connect to crates.io port 443 via 127.0.0.1 after 2044 ms)`），无法添加 `sqlite-vec` Rust crate 依赖。替代方案：实现了纯 Rust `vector.rs` 模块，使用 BLOB 存储 embedding 向量 + 手写余弦相似度搜索，不依赖 C 扩展。功能等价但性能不如原生 sqlite-vec（线性扫描 vs ANN 索引）。**后续建议**：网络恢复后评估是否迁移到 sqlite-vec 原生扩展以获得 ANN 索引加速。
- **[Phase 1 跳过] embedding 模型未实装**：当前 `generate_embedding` Tauri command 调用 OpenAI-compatible `/v1/embeddings` 端点，但用户需自行配置支持 embedding 的 Provider。**后续建议**：评估本地 embedding 模型（如通过 Ollama）以减少对外部 API 的依赖。
- 本地题库和知识库当前仍是 JSON seed + keyword/hybrid mock，向量检索已接入但尚未对 seed 数据生成 embedding。
- LLM Reflection：代码已实现并接入 memoryService 运行链路（有 Provider 时异步调用 LLM 反思，失败自动 fallback 到规则版，不阻塞学生可见回复）。
- 真实 Provider 对话需要用户填写 Base URL、模型和 API Key 后再实机验证。
- **[Phase 4 跳过] OCR/语音输入**：需要外部依赖（tesseract、语音识别 SDK），超出当前依赖范围。**后续建议**：评估 Tauri sidecar 集成 OCR 引擎。
- **[Phase 4 跳过] 自动更新机制**：需要 Tauri updater 插件 + 更新服务器基础设施。**后续建议**：Phase 5+ 配合部署流程实现。
- **[Phase 4 跳过] Ollama sidecar 集成**：需要用户安装 Ollama。**后续建议**：用户安装 Ollama 后，通过 `http://127.0.0.1:11434/v1` 作为本地 Provider 接入。
- **[Phase 4 已完成] 路由懒加载**：所有页面路由改为动态 import，首屏只加载 ChatView。
- **[Phase 4 已完成] 学科扩展（线性代数）**：新增 10 个线性代数基础知识节点 + 5 道题目，覆盖矩阵、行列式、逆矩阵、线性方程组、向量等。

## 下一步建议

1. 启动 `npm run tauri:dev`，确认窗口显示的是最新 UI。
2. 人工 review 当前 UI：确认对话页底部原生输入框可见、可输入；空内容点击”发送”会聚焦输入框，输入内容后可发送。
3. 检查设置页 Provider 名称、Base URL、模型、API Key、本地 Provider 开关是否可见可输入。
4. 在设置页点击”初始化 SQLite”和”运行本地自检”，确认本地数据库状态和事务回滚结果正常展示。
5. 在未配置 Provider 时发送”今天我该怎么复习极限与连续？”，验证 Planner 轮次。
6. 配置一个 OpenAI-compatible Provider，按”先保存、后测试”的顺序跑通真实连接。
7. 验证真实对话、练习题请求”给我一道夹逼定理练习”和复盘请求”帮我复盘这道夹逼定理题”。
8. 验证练习模块：提交答案后掌握度是否更新（BKT 计算 → assessment 写入 → student_knowledge）。
