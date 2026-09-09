# Provider Guide 治理文档

## 概述

Provider Guide 是 TeacherAgent 设置页面中的本地配置教程系统，帮助不会阅读官方 API 文档的普通用户正确配置 LLM Provider。

## 与官方文档的关系

- Guide 是官方文档的**易用解释层**，不是官方文档副本。
- 每篇 Guide 必须标注官方来源 URL 和最后核验日期。
- Guide 内容使用自己的语言简化说明，不大量复制官方原文。
- Guide 明确声明"本指南为 TeacherAgent 易用说明，不替代官方文档"。

## 与教学知识库的隔离

Provider Guide 与以下系统**完全隔离**：

- `data/knowledge/`（教学知识库）
- `packManifest` / `packLoader`（Pack 清单系统）
- Embedding 生成（向量库）
- ToolAgent `knowledge_search`（学生对话 RAG）
- 学生对话检索结果

代码证据：`providerGuideRegistry.ts` 不 import 任何 packManifest、packLoader、knowledgeSearch、embedding、toolAgent 模块。测试 `providerGuideRegistry.test.ts` 中有隔离断言。

## approved/draft 审核流程

- Guide 有 `status: "approved" | "draft"` 字段。
- 只有 `approved` Guide 出现在用户可见的教程列表中。
- `draft` Guide 不进入默认用户列表。
- 新增 Guide 初始为 `draft`，经核验后改为 `approved`。

## 官方来源要求

每篇 Guide 必须包含 `officialSources` 数组，每项包含：

- `title`: 官方文档标题
- `url`: 官方 URL
- `verifiedAt`: 最后核验日期（YYYY-MM-DD）

缺少 `officialSources` 的 Guide 在运行时验证中会被拒绝加载（fail-closed）。

运行时校验范围为**关键字段严格校验**：必填字段存在性、字符串/布尔/数组类型、URL 格式（http/https）、`verifiedAt` 日期格式、重复 ID 检测、数组元素类型。TypeScript 类型中标记为可选的字段（如 modelPreset.visionModel、modelPreset.embeddingModel）不做非空强制，但出现时仍会做类型检查。这不等同于完整 JSON Schema 验证。

## 更新与过期策略

- 当 Provider 官方文档发生重大变更（模型下线、URL 变更、参数限制变化）时，应更新对应 Guide。
- `verifiedAt` 超过 6 个月的 Guide 应在下次维护时重新核验。
- 无法确认的内容标记为 `draft`，不得伪装成 `approved`。

## API Key 安全边界

- Guide 中不得出现真实 API Key。
- 预设应用（applyModelPreset / applyBaseUrlPreset）永远不触碰 API Key 字段。
- Guide 中的示例使用明显的占位符（如 `sk-（在控制台复制你的密钥）`）。
- 测试中有断言：Guide JSON 不包含 `sk-[A-Za-z0-9]{20,}` 模式。
- API Key 存储链路不变：前端 → saveProviderApiKey → OS keychain。Guide 不引入新的 Key 暴露路径。

## 预设应用交互决策

产品决策：预设应用为即时填充，不设置"应用前预览/确认"弹窗。理由：

- 预设只修改表单字段，不触发保存。用户仍需手动点击"保存"才会持久化。
- API Key 永远不被预设触碰，无敏感字段风险。
- 即时填充让用户可以直接看到变更结果并继续微调，比弹窗确认摩擦更低。
- 如果用户不满意，可以手动修改或点击"取消"清空表单。
- Embedding 预设为例外：不写入 localStorage，仅显示非持久提示"请前往知识库页面确认并生成向量"，由 KnowledgeBasePanel 负责实际持久化。

## 新增 Provider Guide 的步骤

1. 在 `data/provider-guides/` 下创建 `<provider-name>.guide.json`。
2. 填写所有必填字段（id, providerName, displayName, description, status, guideVersion, verifiedAt, officialSources）。
3. 查阅 Provider 当前官方文档，填写 baseUrlPresets、modelPresets、setupSteps、commonErrors、fieldHelp、securityNotices。
4. 在 `providerGuideRegistry.ts` 中添加 import。
5. 运行 `npx vitest run src/services/llm/providerGuideRegistry.test.ts` 确认通过。
6. 初始 status 设为 `draft`，核验后改为 `approved`。

## 错误映射维护方法

- `commonErrors[].matchPatterns` 用于匹配 `providerDiagnostics.ts` 返回的错误消息。
- 匹配规则：大小写不敏感的子串匹配。
- 新增错误类型时，先确认 `providerDiagnostics.ts` 的 `formatProviderError` 输出格式，再编写 matchPatterns。
- 匹配失败时显示原始安全化错误摘要，不吞掉错误。

## 文件清单

| 文件 | 用途 |
|------|------|
| `data/provider-guides/*.guide.json` | Guide 数据 |
| `src/services/llm/providerGuideTypes.ts` | TypeScript 类型定义 |
| `src/services/llm/providerGuideRegistry.ts` | 加载、验证、查询逻辑 |
| `src/services/llm/providerGuideRegistry.test.ts` | 单元测试（47 项） |
| `src/components/settings/ProviderGuideDrawer.vue` | 教程抽屉 UI |
| `src/components/settings/ProviderPanel.vue` | 集成入口 |
