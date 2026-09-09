# TeacherAgent 缓存策略文档

版本：v1.0  
状态：MVP 设计基线  
最后更新：2026-06-30  
适用对象：Codex、Claude Code、前端/后端实现者

## 1. 目标

TeacherAgent 的缓存目标是降低延迟、减少重复 LLM 调用、提升 RAG 和知识检索命中率，同时不牺牲隐私和教学正确性。

缓存不是为了“记住一切”，而是为了复用确定性高、隐私风险低、失效边界清楚的中间结果。

## 2. 优先缓存对象

| 对象 | MVP 策略 | 原因 |
| --- | --- | --- |
| LLM health check | 可短 TTL 缓存 | 避免频繁点击测试连接导致重复请求 |
| Prompt Builder 输出 | Phase 1 缓存 | 同一上下文组装成本可复用，但需严格版本化 |
| knowledge_search 结果 | Phase 1 缓存 | 本地知识库查询高频且相对稳定 |
| RAG chunk ranking | Phase 1 缓存 | 相同查询和同一知识库版本下可复用 |
| session memory summary | Phase 0/1 可保存 | 作为上下文压缩，不保存完整历史 |
| message rendering | 内存缓存可选 | Markdown/KaTeX/Shiki 渲染可减少重复计算 |
| LLM tutoring response | 谨慎缓存 | 只缓存非个性化、无学生隐私、低温度、结构化诊断类请求 |

Prompt 不应通过向量库来“缓存”。完整 prompt 的复用应依赖：

- 稳定 Prompt Layer 顺序。
- promptVersion / knowledgeBaseVersion / studentContextVersion。
- Provider 原生 prompt cache。
- 应用层 hash key 和 TTL cache。

向量库只负责语义召回，不负责存储完整 prompt。

## 3. 不应缓存对象

- API Key、Authorization header 或任何密钥。
- 未经脱敏的学生隐私数据。
- 包含身份证号、手机号、住址等敏感信息的输入。
- 高度个性化的导师回复，除非缓存键包含学生画像版本和上下文版本。
- Guardrail 未通过的 LLM 草稿。
- `web_search` 原始网页正文。

## 4. 缓存键规则

缓存键必须稳定、可复现，并且不包含密钥。

建议组成：

```text
scope
version
providerName / model
subject
promptVersion
knowledgeBaseVersion
studentContextVersion
normalizedInputHash
optionsHash
```

要求：

- 只保存 hash，不保存完整敏感输入作为持久化 key。
- Prompt、知识库、学生画像、模型配置变化时，必须让缓存键变化。
- temperature、maxTokens、hintLevel、subjectStyle 等影响输出的参数必须进入 key。
- MVP 前端内存缓存可以短期保留原始 request 对象，但不得持久化。
- 缓存键序列化必须排序 JSON key，并剔除 `timestamp`、`request_id`、`trace_id`、`span_id`、`run_id`、`created_at`、`updated_at`、`uuid` 等易变字段。
- 普通文本在进入缓存 key 前应统一换行、压缩连续空白并 trim；ISO 时间戳、UUID、`req_*` / `trace_*` / `span_*` / `run_*` 标识符应替换为占位符。
- 浮点数进入缓存 key 前应做有限精度归一化，避免无意义的精度漂移造成 miss。

## 4.1 Prompt 前缀缓存规则

参考 `xuzeTop1/llm-cache-optimizer` 的设计，TeacherAgent 不只做应用层 TTL cache，还要主动提升 Provider 原生 prompt cache 命中率。

Prompt Builder 必须按稳定层级组装请求：

```text
core_system -> tool_schema -> static_context -> session_memory -> history -> runtime
```

规则：

- `core_system`、`tool_schema`、`static_context` 必须尽量稳定，不能每轮插入时间戳、随机 ID 或动态排序内容。
- `session_memory` 用于替代不断增长的长历史，保留稳定摘要和关键词，减少历史漂移。
- `history` 只放必要的最近对话，不把所有旧消息无限追加。
- `runtime` 放本轮用户输入、检索片段、临时参数和其他高变化内容，必须靠后。
- 工具 schema 和静态学科规则要版本化；版本变化允许 cache miss，但不能悄悄改内容。
- Claude 类显式 cache-control provider 后续可在稳定层边界加 breakpoint；OpenAI/DeepSeek 类 provider 依赖稳定前缀自动命中。

## 5. TTL 建议

| 缓存类型 | MVP TTL | 说明 |
| --- | --- | --- |
| Provider health check | 30-120 秒 | 只用于减少重复测试 |
| knowledge_search | 5-30 分钟 | 知识库版本变化立即失效 |
| RAG ranking | 5-15 分钟 | 与 embedding / ranking 版本绑定 |
| message rendering | 当前会话 | 页面刷新可丢弃 |
| LLM tutoring response | 默认不启用 | 后续按请求类型白名单开放 |

## 6. 命中率提升策略

- 规范化输入：去除首尾空白、统一换行、压缩连续空白。
- 分层 key：先按 scope/model/promptVersion 分桶，再计算输入 hash。
- 版本化失效：Prompt、知识库、学科风格、学生画像版本变化时自动 miss。
- 单飞请求：同一个 key 同时发起多个请求时，只允许一个真实请求，其余等待同一个 Promise。
- 负缓存谨慎：短时间缓存“检索无结果”可以减少重复查询，但不能缓存 LLM 网络失败太久。
- 观测指标：记录 hit、miss、stale、evicted、inFlightJoined。
- Provider 指标：解析 OpenAI `usage.prompt_tokens_details.cached_tokens` 和 DeepSeek `usage.prompt_cache_hit_tokens` / `usage.prompt_cache_miss_tokens`。
- Claude 指标：后续接入 Claude Provider 时解析 `usage.cache_read_input_tokens`。
- 对比基线：后续 benchmark 应比较 naive prompt 与 cache-aware prompt 的 cached token、延迟和成本。

## 7. 隐私边界

缓存分三层：

1. 前端内存缓存：只在当前运行期间有效，适合 Phase 0/Phase 1。
2. SQLite 本地缓存：Phase 1 后可用于 knowledge_search / RAG，必须保存 hash key 和版本字段。
3. 远端缓存：默认禁止，除非用户明确启用，并完成隐私评审。

任何持久化缓存都必须支持：

- 按学生删除。
- 按课程/目标删除。
- 全量清空。
- 版本失效。

向量索引的隐私边界：

- 可持久化：审核后的知识摘要、题目摘要、脱敏反思摘要、学生长期记忆摘要。
- 不持久化：完整 prompt、完整学生对话、Provider 请求体、Guardrail 未通过草稿、工具原始输出、API Key。
- 删除学生档案时，必须同步删除该学生的向量记录。

短期记忆、长期记忆和用户画像的缓存边界：

- 短期记忆保存当前会话摘要、待跟进问题和近期关注点，可被频繁覆盖。
- 长期记忆保存脱敏摘要、证据摘要、置信度和来源，不保存逐字对话。
- 用户画像保存聚合偏好和误区，只能作为可修正假设。
- Phase 0 当前已优先写入 SQLite，并保留 `localStorage` 作为浏览器预览或 Tauri IPC 失败时的兜底镜像；后续为长期记忆摘要建立可删除的向量索引。

## 8. MVP 实现落点

当前建议目录：

```text
src/services/cache/
├── canonicalSerializer.ts
├── cacheKey.ts
├── memoryCacheStore.ts
├── types.ts
└── README.md
```

LLM Provider 缓存适配器：

```text
src/services/llm/cachedLlmProvider.ts
src/services/llm/cacheMetrics.ts
```

Prompt 前缀稳定工具：

```text
src/engine/prompts/promptLayers.ts
```

首批只实现：

- 内存 TTL cache。
- 稳定 JSON key。
- 易变字段剔除和文本规范化。
- SHA-256 key hash。
- LLM Provider wrapper。
- Provider cached token 指标提取。
- Prompt Layer 固定排序。
- 命中率统计。

## 9. GitHub 缓存项目合并说明

已参考用户仓库 `xuzeTop1/llm-cache-optimizer` 的 README 和项目元数据，将其中适合 TeacherAgent 的原则合并为本策略：

- 稳定 prompt layering：固定 `core_system -> tool_schema -> static_context -> session_memory -> history -> runtime` 顺序。
- canonical serialization：排序 JSON key、规范空白、剔除时间戳和 request id 等易变字段。
- provider metrics：兼容 OpenAI、DeepSeek 和 Claude 的 cached token usage 字段，并支持按模型价格预设估算节省成本。
- session memory：用稳定摘要和关键词替代无限增长的历史上下文。
- provider 差异：OpenAI/DeepSeek 依赖自动前缀缓存；Claude 后续可引入显式 cache-control breakpoint，稳定 system block 达到约 4096 字符后再标记缓存。

本次没有直接复制 Python 实现。TeacherAgent 使用 TypeScript/Vue/Tauri 架构，因此只迁移设计原则，并落到本项目的 `src/services/cache/`、`src/services/llm/` 和 `src/engine/prompts/`。

## 10. 知识库 Pack 懒加载策略

### 10.1 问题背景

ChatView chunk 达到 566.45 kB，超过 500 kB 警告阈值。主要原因是 `knowledgeIndexer.ts`、`localKnowledgeSearch.ts` 和 `localQuestionBankSearch.ts` 静态导入了所有 20 个 seed JSON 文件（10 个知识库 + 10 个题库），导致这些数据在构建时被打包进主 chunk。

### 10.2 解决方案

实现知识库 pack manifest 和懒加载机制：

1. **Pack Manifest**：`src/services/knowledge/packManifest.ts` 定义所有可用的知识库包清单，包含路径、学科、预期数量等元信息。
2. **Pack Loader**：`src/services/knowledge/packLoader.ts` 使用 `import.meta.glob("../../../data/knowledge/*.seed.json")` 和 `import.meta.glob("../../../data/questions/*.seed.json")` 实现懒加载。Vite 在构建时静态分析 glob 模式，将匹配的 JSON 文件打包为独立 chunk，运行时按需加载。内置缓存机制避免重复加载。

### 10.3 缓存策略

- **内存缓存**：加载后的知识库和题库数据会被缓存在 `Map` 中，避免重复加载。
- **按需加载**：搜索时只加载相关学科的 pack，而非全部加载。
- **缓存失效**：应用重启后缓存自动清除，无需手动失效机制。
- **预加载**：提供 `preloadSubject()` 函数，可在后台预加载指定学科的数据。

### 10.4 性能优化效果

- ChatView chunk: 566.45 kB → 458.22 kB（**减少 108.23 kB，降幅 19.1%**）
- localQuestionBankSearch chunk: 60.94 kB → 10.09 kB（**减少 50.85 kB，降幅 83%**）
- ChatView 现在低于 500 kB 警告阈值。
- dist 中生成 20 个 seed JSON 独立 chunk（10 knowledge + 10 question），由 Vite 管理路径和懒加载。

### 10.5 向后兼容

- 保留同步版本接口（已废弃），现有调用者无需立即修改。
- 新增异步版本 `searchLocalKnowledgeLazy()` 和 `searchLocalQuestionBankLazy()`，推荐新代码使用。

## 11. 与其他文档的关系

- LLM Provider：`docs/project-governance.md`
- 数据模型：`docs/data-model.md`
- 知识库治理：`docs/knowledge-base-governance.md`
- 工具接口：`docs/tool-interface.md`
- 当前状态：`docs/project-status.md`
