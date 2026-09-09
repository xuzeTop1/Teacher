# TeacherAgent 全面 Review 报告

> 审查时间：2026-07-01  
> 依据文档：[review-handoff.md](file:///d:/TeacherAgent/docs/review-handoff.md)  
> 当前阶段：Phase 0 进行中  
> 审查方法：逐文件代码级审查，覆盖 review-handoff.md 中全部 4 个维度

---

## 〇、上轮以来的增量变化

相较上一轮 review，本轮观察到以下新增工作：

| 变化 | 说明 |
|------|------|
| `tauri dev` 已可启动 | review-handoff.md 确认 `http://127.0.0.1:1420/` 返回 200 |
| 新增 `run_local_smoke_check` | Rust 侧验证 ping、SQLite、默认会话、消息写读、事务回滚 |
| 知识 seed 扩充到 35 节点 | `data/knowledge/math-limits.seed.json` 31KB（上轮约 4 节点） |
| 新增 12 道原创题目 | `data/questions/math-limits.seed.json` 12KB |
| `question_bank_search` 接入 ToolAgent | 练习模式不暴露答案，复盘模式注入内部答案 |
| App.vue 改为稳定 CSS 侧边栏 | 不再依赖 Vuetify 导航抽屉组件 |
| ChatView 新增元数据持久化 | `knowledgeRefsJson`、`toolRefsJson`、`guardrailJson` 均保存和恢复 |
| 前端测试新增至 38 条 | 覆盖知识库、题库、ToolAgent、Planner 无 Provider、Provider 安全、MiMo 兼容、练习/复盘 prompt 边界、Guardrail 重写、Planner 历史恢复、Composer 空输入聚焦行为和元数据隐私等场景 |
| Rust 测试新增至 10 条 | 新增本地自检 smoke check |
| main.css 442 行完整样式 | 聊天布局、消息列表滚动、composer 固定底部、响应式适配 |

---

## 一、UI 交互（review-handoff.md §1）

### 1.1 左侧主导航是否在 Tauri 窗口稳定显示

✅ **通过**

[App.vue](file:///d:/TeacherAgent/src/App.vue) 使用纯 CSS Grid 侧边栏（`grid-template-columns: 232px minmax(0, 1fr)`），不再依赖 Vuetify 的 `v-navigation-drawer`。

[main.css L26-46](file:///d:/TeacherAgent/src/styles/main.css#L26-L46) 的 `.app-shell` / `.app-sidebar` / `.app-content` 结构清晰：
- 侧边栏 `position: sticky; top: 0; height: 100dvh;` — 固定可见
- 导航项有 hover 和 `router-link-active` 高亮样式
- 响应式断点 `@media (max-width: 900px)` 降级为单列

> [!NOTE]
> 这个改动解决了上轮 review 中"Vuetify 导航抽屉在 Tauri 窗口可能不可见"的问题。

### 1.2 对话页输入框是否始终可见

✅ **通过**

[main.css L110-113](file:///d:/TeacherAgent/src/styles/main.css#L110-L113)：
```css
.chat-view {
  height: 100dvh;
  overflow: hidden;
}
```

[main.css L138-145](file:///d:/TeacherAgent/src/styles/main.css#L138-L145)：`.message-list` 有 `flex: 1; overflow: auto;` — 消息区独立滚动。

[main.css L326-332](file:///d:/TeacherAgent/src/styles/main.css#L326-L332)：`.composer` 有 `flex-shrink: 0;` — 输入框不会被压缩，始终固定在底部。

[ChatView.vue L605-625](file:///d:/TeacherAgent/src/views/ChatView.vue#L605-L625)：`<footer class="composer">` 在 `chat-main` 内部，消息列表和 composer 共用 flex 布局，消息区滚动不影响 composer。

### 1.3 设置页"初始化 SQLite"和"运行本地自检"是否可点击并展示结果

✅ **通过**

[SettingsView.vue L312-347](file:///d:/TeacherAgent/src/views/SettingsView.vue#L312-L347)：
- "初始化 SQLite"按钮 → 调用 `setupDatabase()` → 展示路径、migration、user_version
- "运行本地自检"按钮 → 调用 `runSmokeCheck()` → 展示 ping、数据库路径、默认会话、消息写读、事务回滚
- 两个按钮有独立的 `loading`/`disabled` 状态和独立的 `v-alert` 展示结果

⚠️ **小发现**：两个按钮并排但没有视觉层级区分。"初始化 SQLite"是 `color="primary"` 实心按钮，"运行本地自检"是 `variant="outlined"` 描边按钮——这是合理的。

---

## 二、Provider 安全（review-handoff.md §2）

### 2.1 前端 store、SQLite、日志不保存明文 API Key

✅ **通过（有条件）**

**Pinia Store** — [app.ts L25](file:///d:/TeacherAgent/src/stores/app.ts#L25)：`hasUsableProviderConfig` 检查 `apiKeyRef?.trim() || apiKey?.trim()`，store 类型允许 `apiKey` 字段存在。

[SettingsView.vue L111-118](file:///d:/TeacherAgent/src/views/SettingsView.vue#L111-L118)：当 keychain 引用可用时，`apiKey` 被设为 `undefined`：
```ts
apiKey: nextApiKeyRef ? undefined : providerForm.apiKey,
```

> [!IMPORTANT]
> **条件**：当 keychain 不可用（浏览器预览模式）时，`apiKey` 明文会暂存在 Pinia store 内存中。这是 Phase 0 的设计意图——浏览器预览 fallback。但必须确保：
> 1. `apiKey` 不会被 `localStorage` 持久化（✅ Pinia 没有 persist 插件）
> 2. `apiKey` 不会进入 SQLite（✅ `saveProviderConfigToDatabase` 只传 `apiKeyRef`，不传 `apiKey`）

**SQLite** — [commands.ts L270-272](file:///d:/TeacherAgent/src/services/tauri/commands.ts#L270-L272)：`saveProviderConfig` 只传 `apiKeyRef`，不传 `apiKey`。✅

**Rust 请求** — [commands.ts L303-319](file:///d:/TeacherAgent/src/services/tauri/commands.ts#L303-L319)：`completeLlmChat` 只传 `apiKeyRef`，不传 `apiKey`。✅

### 2.2 设置页加载 Provider 配置时不会把 API Key 回填到输入框

✅ **通过**

[SettingsView.vue L74](file:///d:/TeacherAgent/src/views/SettingsView.vue#L74)：
```ts
providerForm.apiKey = ""
```

加载保存的配置后，表单的 `apiKey` 字段被显式清空。用户看到的是空密码框和提示文字"保存到系统凭据存储，SQLite 只保存引用"。

### 2.3 Rust 错误日志没有输出请求体、对话内容或学生画像

✅ **通过**（基于上轮对 lib.rs 的审查：Rust `complete_llm_chat_with_provider` 只记录事件名、provider name、model、endpoint host、HTTP 状态码和 error code）

---

## 三、教学链路（review-handoff.md §3）

### 3.1 未配置 Provider 时，普通对话应提示去设置页

✅ **通过**

[ChatView.vue L102-112](file:///d:/TeacherAgent/src/views/ChatView.vue#L102-L112)：
```ts
if (!appStore.hasUsableProviderConfig && !shouldTriggerPlanner(content)) {
  // → 显示提示消息
}
```

当 `hasUsableProviderConfig` 为 false 且非规划请求时，导师消息提示用户去设置页配置。

### 3.2 未配置 Provider 时，规划类请求应能走 PlannerAgent

✅ **通过**

同一段代码 `!shouldTriggerPlanner(content)` 条件意味着规划类请求**不会被拦截**，会穿过到 orchestrator。

[tutorOrchestrator.ts L91-139](file:///d:/TeacherAgent/src/engine/agents/tutorOrchestrator.ts#L91-L139)：`shouldTriggerPlanner` 为 true 时直接走 PlannerAgent 分支，该分支不需要 `input.providerConfig`，返回 `providerName: "TeacherAgent PlannerAgent", model: "rules-v1"`。

### 3.3 练习类请求应触发题库，但不要直接显示答案

✅ **通过**

[toolAgent.ts L73-77](file:///d:/TeacherAgent/src/engine/agents/toolAgent.ts#L73-L77)：`shouldSearchQuestionBank` 匹配"练习|习题|题目|例题|..."等关键词。

[toolAgent.ts L236](file:///d:/TeacherAgent/src/engine/agents/toolAgent.ts#L236)：答案控制逻辑：
```ts
input.purpose === "review" && question.answer
  ? `answer_for_internal_review_only: ${question.answer}`
  : ""
```

只有 `purpose === "review"` 时才注入答案。practice/assessment/similar_example 模式下答案**不进入 prompt**。

[toolAgent.ts L244](file:///d:/TeacherAgent/src/engine/agents/toolAgent.ts#L244)：
```
student_visible_policy: for practice or assessment, show at most one question first 
and only an L1 hint; reveal answers or solution steps only in explicit review mode.
```

Prompt 层面也明确约束了策略。

### 3.4 复盘/解析类请求可使用答案作为内部参考

✅ **通过**

[toolAgent.ts L90-94](file:///d:/TeacherAgent/src/engine/agents/toolAgent.ts#L90-L94)：`inferQuestionPurpose` 将"复盘|讲解|解析|review"映射为 `purpose: "review"`，此时答案和解题步骤会以 `answer_for_internal_review_only` / `solution_steps_for_internal_review_only` 标签注入。

✅ **已修复 F-01**：标签名用了 `_for_internal_review_only` 后缀后，Guardrail 已补充 `answer_for_internal_review_only`、`solution_steps_for_internal_review_only`、`student_visible_policy`、`tool_result` 等内部标签泄露检测，并新增单元测试覆盖。

---

## 四、数据持久化（review-handoff.md §4）

### 4.1 消息、knowledge_refs_json、tool_refs_json、guardrail_json 能保存并恢复

✅ **通过**

**保存** — [ChatView.vue L135-137](file:///d:/TeacherAgent/src/views/ChatView.vue#L135-L137)：
```ts
tutorMessage.knowledgeRefsJson = createKnowledgeRefsJson(result)
tutorMessage.toolRefsJson = createTutorTurnToolRefsJson(tutorMessage, result)
tutorMessage.guardrailJson = createGuardrailJson(result)
```

[ChatView.vue L254-268](file:///d:/TeacherAgent/src/views/ChatView.vue#L254-L268)：`persistChatMessage` 将这三个字段传给 `saveMessage`。

**恢复** — [ChatView.vue](file:///d:/TeacherAgent/src/views/ChatView.vue)：`fromStoredMessages` 调用 `restoreChatMessagesFromStoredMessages()`，从 `StoredMessage` 恢复 `knowledgeRefsJson`、`toolRefsJson`、`guardrailJson` 和 `plannerResult`，并过滤掉内部 `tool` 消息。

**tool_refs_json 内容** — [ChatView.vue](file:///d:/TeacherAgent/src/views/ChatView.vue)：`createTutorTurnToolRefsJson()` 负责 Tutor 轮次完整元数据构造，`serializeChatMessageToolRefs()` 负责保存消息前的兜底序列化，当前会保存以下结构：

```json
{
  "plannerResult": { ... },
  "provider": { "name", "model", "promptVersion" },
  "socratic": { "mode", "maxHintLevel", "strategy" },
  "tools": { "knowledgeSearch", "questionBankSearch", "mathCompute" },
  "assessmentResultId": "..."
}
```

### 4.2 Planner 面板在历史会话重新加载后仍可展示

✅ **通过**

[ChatView.vue](file:///d:/TeacherAgent/src/views/ChatView.vue)：`fromStoredMessages` 调用 `restoreChatMessagesFromStoredMessages()`，再由 `parsePlannerResultFromToolRefs()` 从 `tool_refs_json` 中解析出 `PlannerResult`。

[chatMessageMetadata.ts](file:///d:/TeacherAgent/src/components/chat/chatMessageMetadata.ts)：`parsePlannerResultFromToolRefs()` 做防御性解析（检查 `nextTasks` 是否数组、信号数组和置信度兜底、坏 JSON 安全忽略）。

[ChatView.vue L567-601](file:///d:/TeacherAgent/src/views/ChatView.vue#L567-L601)：模板中 `v-if="message.plannerResult"` 条件展示规划信号面板。

### 4.3 本地自检不留下 smoke message

✅ **通过**

review-handoff.md 明确说"测试消息在事务内回滚"，前端 `runSmokeCheck` 返回 `rollbackVerified: boolean`。

---

## 五、额外代码级发现

除 review-handoff.md 4 个维度的检查外，以下是代码审查中发现的额外问题：

### F-01 ✅ Guardrail 内部标签泄露检测已修复

| 严重性 | 位置 |
|--------|------|
| 中 | [guardrailAgent.ts L41-44](file:///d:/TeacherAgent/src/engine/agents/guardrailAgent.ts#L41-L44) |

`INTERNAL_LEAK_PATTERNS` 已补充 `answer_for_internal_review_only`、`solution_steps_for_internal_review_only`、`student_visible_policy`、`tool_result` 和 `<tool_result>` 等 ToolAgent 内部标签模式。如果 LLM 回复包含这些原始标签，规则护栏会拦截并要求重写。

**验证**：已新增 `src/engine/agents/guardrailAgent.test.ts`，覆盖内部答案、内部步骤和学生可见策略标签泄露场景。

---

### F-02 ✅ `tool_refs_json` 序列化函数已拆分

| 严重性 | 位置 |
|--------|------|
| 低 | [ChatView.vue L362](file:///d:/TeacherAgent/src/views/ChatView.vue#L362) |

原 `createMessageToolRefsJson(message, result?)` 同时承担“从 TutorTurnResult 构造元数据”和“落库前从 ChatMessage 序列化”的职责，语义容易误读。现在已拆分为：

- `createTutorTurnToolRefsJson(message, result)`：只负责 Tutor 轮次完整元数据构造。
- `serializeChatMessageToolRefs(message)`：只负责保存消息前的兜底序列化。

行为保持不变，但调用边界更清楚。

---

### F-03 ✅ Pinia store 不再保存明文 `apiKey`

| 严重性 | 位置 |
|--------|------|
| 低 | [app.ts L10](file:///d:/TeacherAgent/src/stores/app.ts#L10) |

Pinia store 的 `llmProviderConfig` 已改为 `Omit<LlmProviderConfig, "apiKey">`，类型层面排除明文 API Key。`SettingsView.vue` 也不再从 store 初始化 `apiKey`，保存 Provider 配置时只写入 `apiKeyRef`。Tauri 主路径下，API Key 只应短暂停留在设置页密码框状态中，保存后写入系统凭据存储并清空输入框。

---

### F-04 ✅ `testProvider()` 不再隐式保存配置

| 严重性 | 位置 |
|--------|------|
| 低 | [SettingsView.vue L198](file:///d:/TeacherAgent/src/views/SettingsView.vue#L198) |

用户点击"测试模型连接"时不再执行 `saveProviderConfig()`，测试只使用当前表单里的 Provider 名称、Base URL、模型和已保存的 `apiKeyRef`。如果用户刚输入新的 API Key，需要先点击保存，把 Key 写入系统凭据存储后再测试。

保存成功后密码框会清空，避免 API Key 明文继续停留在页面状态中。

---

### F-05 ✅ 消息列表自动滚动已修复

上轮 review 指出的"消息列表不自动滚动到底部"问题已修复。`ChatView.vue` 现在给消息列表增加 `messageListEl` 引用和 `scrollMessagesToBottom()`，在用户发送消息、导师占位消息出现、导师回复更新、错误回退和历史消息加载后都会滚动到底部。

---

### F-06 ✅ 知识 seed 已大幅扩充

上轮 review 指出只有 4 个知识节点。现在 `data/knowledge/math-limits.seed.json` 已扩充到 31KB（约 35 个节点），`data/questions/math-limits.seed.json` 新增 12 道原创题目。覆盖"极限与连续"整章的核心概念。这是显著进步。

---

### F-07 ✅ 公共工具函数已提取

| 严重性 | 位置 |
|--------|------|
| 低 | reflectionAgent, assessmentAgent, plannerAgent, memoryService |

`subjectLabel()`、`unique()`、`truncate()`、`createId()` 等重复纯函数已提取到公共模块：

- `src/utils/subject.ts`：统一学科中文名映射。
- `src/utils/text.ts`：统一字符串去重、截断和 id 生成。

ReflectionAgent、AssessmentAgent、PlannerAgent 和 MemoryService 已改为复用公共工具，减少后续维护分叉。

---

### F-08 ✅ Guardrail 英文规则已补充

| 严重性 | 位置 |
|--------|------|
| 中 | [guardrailAgent.ts L30-53](file:///d:/TeacherAgent/src/engine/agents/guardrailAgent.ts#L30-L53) |

`FINAL_ANSWER_PATTERNS`、`FULL_SOLUTION_PATTERNS`、`PRIVACY_RISK_PATTERNS`、`TONE_PROBLEM_PATTERNS` 已补充英文模式，覆盖英文最终答案、完整解法、隐私索取和羞辱语气。英语学科对话中出现 "The answer is C"、"Paste your API key"、"You're stupid" 等学生可见风险时会触发规则护栏。

**验证**：`src/engine/agents/guardrailAgent.test.ts` 已新增英文最终答案、英文隐私请求和英文羞辱语气测试样例。

---

### F-09 ✅ App 壳层架构合理

[App.vue](file:///d:/TeacherAgent/src/App.vue) 精简到 31 行，只做布局壳（侧边栏 + 路由视图），不包含业务逻辑。品牌标识和导航项用纯 HTML + CSS 实现，不依赖 Vuetify 复杂组件，Tauri 窗口兼容性好。

---

### F-10 ✅ Rust lib.rs 已开始拆模块

上轮 review 已指出。本轮已先完成低风险拆分：新增 `src-tauri/src/models.rs`，将 Tauri command 输入输出 DTO、学习记忆 DTO、Provider DTO、LLM DTO 等从 `src-tauri/src/lib.rs` 中移出；随后新增 `src-tauri/src/database.rs`，将数据库路径解析、SQLite 打开、migration 执行和已应用 migration 读取逻辑移出；再新增 `src-tauri/src/provider.rs`，承接 Provider 配置持久化、系统凭据存储、OpenAI-compatible 请求、错误分类和脱敏日志；最新新增 `src-tauri/src/conversation.rs`，承接默认会话、会话列表、会话创建/改名、消息保存/读取和相关 row mapper。

本次拆分只调整模块组织和 crate 内可见性，不改变数据库 schema、LLM 请求、keychain 或测试逻辑。后续仍建议继续按边界拆出 `memory`、`assessment`、`knowledge_repository` 等模块。

---

### F-11 ✅ 前端测试覆盖关键路径

review-handoff.md 确认 9 个测试文件、38 条前端测试覆盖了：
- 知识库命中"夹逼定理""可去间断点"
- 题库按主题和知识点 id 找题
- ToolAgent 练习模式不暴露答案
- 普通概念问题不触发题库
- Planner 无 Provider 也能返回规划
- ChatComposer 空草稿点击发送时聚焦输入框但不发送，只有发送中才禁用按钮
- Provider `apiKeyRef` 路径走 Rust command，不走浏览器 fetch
- MiMo Provider runtime-key fallback 使用 `api-key` 和 `max_completion_tokens`
- Provider 表单测试连接必须使用已保存 keychain 引用
- Orchestrator 练习请求发给 Provider 的 prompt 不包含内部答案或步骤标签
- Orchestrator 复盘请求发给 Provider 的 prompt 可包含内部答案和步骤，但学生可见回复不暴露内部标签
- Orchestrator 在 Provider 草稿泄露内部标签时会触发 Guardrail 改写，不把内部答案标签返回给学生
- Planner 历史消息的 `tool_refs_json.plannerResult` 可恢复为 Planner 面板数据，坏 JSON 安全忽略，内部 `tool` 消息不会进入学生可见消息列表
- Planner 消息保存时的 `tool_refs_json` 写入侧可序列化 `plannerResult`，并能被同一解析函数恢复
- Tutor 轮次 `tool_refs_json` 只保存结构化摘要，不保存 raw draft、内部答案标签或完整工具上下文
- Guardrail `guardrail_json` 只保存审核摘要，不保存 rewriteInstruction、fallbackReply、内部答案标签或兜底长文本
- 知识引用 `knowledge_refs_json` 只保存知识点引用，不保存 RAG 摘要、误区、提示或内部检索说明

这些测试覆盖了 review-handoff.md §3 教学链路的核心断言。

---

### F-12 ✅ Smoke check 设计合理

`run_local_smoke_check` 在事务中写入测试消息后回滚，验证了数据库读写能力而不污染用户数据。`rollbackVerified` 字段让前端可以确认清理是否成功。

---

## 六、已知限制确认

对照 review-handoff.md §"已知限制"逐条确认：

| 已知限制 | 确认状态 |
|----------|----------|
| Windows Computer Use 自动化本轮连接失败 | 📋 已知，不影响代码正确性 |
| 知识库和题库仍是 JSON seed + keyword/hybrid mock | ✅ 代码中确认，Phase 1 接入 SQLite-vec |
| `math_compute` 仍是占位路由 | ✅ [toolAgent.ts L59-71](file:///d:/TeacherAgent/src/engine/agents/toolAgent.ts#L59-L71) 确认是占位 |
| LLM Reflection 和完整学习路径 DAG 未实现 | ✅ 当前全部是规则版 Agent |
| 真实 Provider 对话需用户填写后实机验证 | ✅ 需要人工验证 |

---

## 七、Review 结论

### 按维度汇总

| 维度 | 结论 | 发现数 |
|------|------|--------|
| **UI 交互** | ✅ 全部通过 | 0 个阻塞 |
| **Provider 安全** | ✅ 通过（浏览器预览模式有条件放行） | 1 个低风险 |
| **教学链路** | ✅ 全部通过 | F-01 已修复 |
| **数据持久化** | ✅ 全部通过 | 0 个阻塞 |

### 总体评价

> [!TIP]
> **Phase 0 的核心功能链路在代码层面已经跑通。** review-handoff.md 中列出的全部检查项均在代码中得到了正确实现。知识库扩充、题库接入、smoke check、CSS 布局修复和消息元数据持久化都是上轮 review 后的显著进步。

> [!IMPORTANT]
> **本轮 review 的两个立刻修复项已经处理：**
> 1. **F-01**：Guardrail 已检测 ToolAgent 注入的内部标签（`answer_for_internal_review_only` 等）
> 2. **F-05**：消息列表已在发送、回复和历史加载后自动滚动到底部

---

## 八、下一步行动建议

### 立刻可做（不需要新功能）

优先按 `docs/phase0-execution-plan.md` 执行。P0 Rust 验证已恢复，下一步进入 P1 桌面窗口与本地数据库验证。

1. **人工验证 review-handoff.md §下一步建议**：
   - 未配置 Provider → 发送"今天我该怎么复习极限与连续？"→ 验证 Planner 轮次
   - 配置 Provider → 跑通真实对话
   - "给我一道夹逼定理练习"→ 验证题库不暴露答案
   - "帮我复盘这道夹逼定理题"→ 验证内部答案注入

---

## 九、本轮修复记录

| 修复项 | 改动 |
|--------|------|
| F-01 Guardrail 内部标签泄露 | `src/engine/agents/guardrailAgent.ts` 补充内部标签泄露正则；`src/engine/agents/guardrailAgent.test.ts` 新增单元测试 |
| F-05 消息列表自动滚动 | `src/views/ChatView.vue` 增加 `messageListEl` 和 `scrollMessagesToBottom()`，覆盖发送、回复、异常和历史加载路径 |
| F-04 Provider 测试隐式保存 | `src/views/SettingsView.vue` 将保存和测试拆开；测试只使用已保存 Key 引用，保存成功后清空密码框 |
| F-08 Guardrail 英文规则 | `src/engine/agents/guardrailAgent.ts` 补充英文最终答案、完整解法、隐私和语气规则；测试覆盖英文风险样例 |
| F-02 tool refs 序列化歧义 | `src/views/ChatView.vue` 拆分 `createTutorTurnToolRefsJson()` 和 `serializeChatMessageToolRefs()` |
| F-03 Pinia 明文 API Key | `src/stores/app.ts` 类型层面排除 `apiKey`；`src/views/SettingsView.vue` 不再向 store 写入明文 Key |
| F-07 公共工具函数重复 | 新增 `src/utils/text.ts` 和 `src/utils/subject.ts`，复用文本与学科标签工具 |
| F-10 Rust lib.rs 拆模块 | 新增 `src-tauri/src/models.rs`、`src-tauri/src/database.rs`、`src-tauri/src/provider.rs` 和 `src-tauri/src/conversation.rs`，将后端 DTO、数据库基础设施、Provider/LLM 代理逻辑和会话/消息 repository 从 `src-tauri/src/lib.rs` 移出 |

验证结果：

- `npm run test`：9 个测试文件、38 条测试通过。
- `npm run build`：通过；F-03/F-04/F-08 后均已再次通过。
- `models.rs`、`database.rs`、`provider.rs`、`conversation.rs` 拆分后：`cargo fmt`、`cargo check`、`cargo test` 通过，10 条 Rust 测试通过；其中消息测试覆盖三类元数据默认值和 SQLite 往返。

### Phase 1 准备

进入 Phase 1 前，先完成 `docs/phase0-execution-plan.md` 的 P0-P4 验收。

| 优先级 | 任务 |
|--------|------|
| 高 | Rust lib.rs 在验证通过后继续按职责拆 `memory.rs`、`assessment.rs`、`knowledge.rs` |
| 高 | Streaming 流式回复 |
| 高 | SQLite-vec 向量检索 |
| 中 | ChatView 继续拆子组件（已拆出 PlannerSignalPanel、ConversationSidebar、ConversationTitleBar、MessageList 和 ChatComposer） |
| 低 | E2E 集成测试 |
