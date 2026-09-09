# TeacherAgent MVP 规格说明

版本：v1.0  
状态：MVP 开发基线  
最后更新：2026-06-30  
适用对象：产品负责人、Codex、Claude Code、前端/后端实现者

## 1. MVP 目标

MVP 的目标不是做完整学习平台，而是验证 TeacherAgent 的核心体验：

> 学习者能在桌面应用中进行连续多轮对话，AI 以苏格拉底式方式引导学习，能使用本地知识库增强回答，并把对话与基础学习状态保存到本地。

MVP 成功标准：

- 学生愿意继续和它对话，而不是觉得它只是普通聊天机器人。
- AI 默认不直接代答，但引导不是敷衍。
- 基础知识库能让回答更准确、更贴近课程内容。
- 对话、消息、知识点关联和基础掌握度能被本地保存。
- 后续练习、路径规划、学生画像有清晰扩展位置。

## 2. MVP 用户

首批用户：

- 大学生。
- 考研备考者。
- 需要高等数学基础辅导的自主学习者。

首批学科建议：

- 数学。
- 章节种子：高等数学“极限与连续”。

首批场景：

- 学生问一个概念。
- 学生拿一道题来问“怎么做”。
- 学生给出错误思路，AI 诊断并追问。
- 学生请求复盘，AI 给完整解析和变式练习建议。
- 学生完成一轮对话后，系统记录相关知识点和掌握度变化。

## 3. MVP 范围

### 3.1 必须做

| 模块 | MVP 要求 |
| --- | --- |
| 桌面壳 | Tauri 2.x + Vue 3 + TypeScript 项目可运行 |
| 对话界面 | 消息列表、输入框、发送状态、流式/类流式展示 |
| 消息渲染 | Markdown、KaTeX 公式、代码块基础渲染 |
| LLM Provider | 至少一个 OpenAI 兼容云端 Provider |
| Prompt | 接入 `docs/prompt-governance.md` 的核心导师 Prompt |
| Agent 编排 | 实现低延迟 `plan_and_draft` 路径 |
| 护栏 | 规则护栏 + 必要时 LLM 护栏；最多一次重写 |
| 本地存储 | SQLite 保存学生、会话、消息、知识点、基础掌握度 |
| 知识库 | 至少一个数学章节的知识节点 seed |
| 检索 | `knowledge_search` 支持 keyword/hybrid mock 或基础检索 |
| 反思 | 对话后异步生成基础 ReflectionRecord |
| 设置 | 配置 baseUrl、apiKey、model；API Key 不明文保存在前端状态 |

### 3.2 可以做但不强制

- 简单学生仪表盘。
- 类似题推荐。
- `calculator` 基础数值验算。
- 学生目标设置。
- 本地 Ollama Provider 的接口占位。

### 3.3 明确不做

- Web 端。
- 移动端。
- 云账号、多端同步。
- 家长/教师端。
- 完整练习系统。
- 完整学习路径规划。
- OCR、语音输入。
- 自动更新。
- 大规模多学科知识库。
- 自动爬虫入库。

## 3.5 可选扩展：AlertTime 单手机局域网同步（2026-08-03 用户授权）

用户明确授权本分支实现可选的 AlertTime 局域网同步扩展（详见 `docs/decisions/2026-08-03-alerttime-lan-sync.md`）：

- 范围：一个 TeacherAgent + 一个 Android 端 AlertTime；家庭 WiFi 或手机热点；手动「立即同步」；本地局域网 HTTPS；断线重试；幂等同步；用户明确采纳建议。
- 上报白名单：subjects、weeklyGoals、tasks、studySessions。默认禁止上传：diaries、appSettings、用户隐私资料、studySessionEvents 原始事件、本地路径、备份文件、通知状态、API Key、Provider 配置、计时器内存状态。
- 数据所有权：AlertTime 拥有执行数据；TeacherAgent 拥有分析、诊断、掌握度与计划建议稿；TeacherAgent 只下发 proposal，手机明确采纳后才创建本地计划。
- 验收重点：连续两次同步无重复记录；approved 题诊断后仅答题更新 mastery；采纳恰好创建一次；拒绝不创建；撤销设备后旧凭据失效。
- 不实现：公网云同步、Spring Boot/PostgreSQL/Spring Cloud、云账号、多手机、多教师、后台定时同步、公网穿透、通用 CRDT、通用手机端 LLM、手机明文保存 Provider API Key、日记正文同步、AppSettings 全量同步、完整备份文件上传、TeacherAgent 修改手机已有任务、通过学习时长直接更新掌握度。
- 网络限制：学校、公司和公共 WiFi 可能存在 AP isolation、VLAN 或防火墙限制；局域网同步不得宣传为任意网络下均可使用。

2026-08-09 用户明确授权一项窄范围例外（详见 `docs/decisions/2026-08-09-alerttime-android-plan-assessment.md`）：Android 可选调用用户自行填写的 LLM Provider，在未配对或桌面离线时也能独立生成并本地保存 `learningAnalysis`；应用不内置默认 Provider、模型或公共 Key。用户填写的学习目的、考试/项目、考试科目与目标日期会作为声明数据进入版本化 Prompt。每次稍后的新客户端同步仍生成绑定本次 `snapshotId` 的新分析，并在桌面网络请求前保存。API Key 由 Keystore 保护，只发送最小上下文；失败时生成确定性降级结果。分析包含 facts/inferences 分离的 profile、planEvaluation 和无答案 assessmentDraft。学习时长不更新 mastery；草稿题不进入 approved 题库、`assessment_results` 或 `student_knowledge`，TeacherAgent 仅校验 `sourceSnapshotId` 后只读展示。本例外不包含云端数据库、账号、云画像、后台上传、自动计划写入或移动端完整辅导。

## 4. MVP 默认交互流程

### 4.1 普通辅导对话

```text
学生输入问题
  ↓
读取当前会话和学生上下文
  ↓
规则判断是否需要 knowledge_search
  ↓
执行本地知识检索
  ↓
plan_and_draft：合并意图判断、策略选择、回复生成
  ↓
Guardrail 快速审核
  ↓
返回学生可见回复
  ↓
异步保存消息和反思记录
```

同步 LLM 调用预算：

- 普通轮次：1 次。
- 需要 LLM Guardrail：2 次。
- Guardrail 拒绝并重写：最多 3 次。

### 4.2 复盘模式

触发条件：

- 学生明确说“我做完了，帮我复盘”。
- 学生选择“看完整解析”。
- 系统已经给到 L3，学生仍要求完整讲解。

复盘模式允许完整解法，但必须：

- 标明这是复盘。
- 解释关键转折。
- 指出常见误区。
- 给一个变式或复习建议。

### 4.3 直接要答案

默认策略：

1. 第一次：柔性拒绝 + L1 提示。
2. 第二次：说明学习目的 + L2 提示。
3. 第三次：L3 关键步骤，保留最后一步。
4. 第四次：询问是否切换到复盘模式。

## 5. 功能验收标准

### 5.1 对话体验

- 用户可以新建会话。
- 用户可以发送文本消息。
- AI 回复能显示 Markdown、公式和代码块。
- 刷新或重启后，会话和消息仍可查看。
- AI 回复默认包含一个可行动的下一步问题或提示。
- 对明显“直接给答案”的请求，AI 不直接输出完整答案。

### 5.2 LLM Provider

- 用户可以配置 OpenAI 兼容 `baseUrl`、`apiKey`、`model`。
- 配置错误时展示可理解错误。
- 前端不直接暴露完整 API Key。
- LLM 请求失败时不导致应用崩溃。

### 5.3 Knowledge Search

- 至少有 30 个知识节点 seed。
- 每个知识节点包含标题、摘要、前置知识、常见误区、提示、来源。
- 学生问题能检索到相关知识节点。
- 检索无结果时，AI 会询问更多上下文，而不是编造。

### 5.4 Guardrail

- 规则能识别明显最终答案泄露。
- 规则能识别完整解题过程过早输出。
- Guardrail 失败最多重写一次。
- 重写仍失败时使用 fallback 模板。

### 5.5 本地数据

- 会话和消息保存到 SQLite。
- 知识节点 seed 可导入 SQLite 或从 JSON 读取。
- 学生知识状态可以记录基础掌握度。
- ReflectionRecord 可以异步保存。

## 6. MVP 测试样例

| 编号 | 场景 | 输入 | 期望 |
| --- | --- | --- | --- |
| T-001 | 概念解释 | “什么是极限？” | 简短解释 + 小问题 |
| T-002 | 未尝试题目 | “这道极限题怎么做？” | 不直接给答案，先问直接代入结果 |
| T-003 | 错误尝试 | “我把 x=0 代进去，所以是 1” | 指出不定式并引导 |
| T-004 | 直接要答案 | “直接告诉我答案” | 柔性拒绝 + 提示 |
| T-005 | 复盘 | “我做完了，看完整解析” | 进入复盘模式 |
| T-006 | 检索无结果 | “这个题是什么知识点？”但题干缺失 | 要求补充题干 |
| T-007 | LLM 失败 | Provider 返回错误 | UI 显示错误，不崩溃 |
| T-008 | 隐私 | “帮我保存身份证号……” | 拒绝不必要隐私 |

## 7. MVP 质量门槛

- TypeScript strict 模式。
- 核心 Agent/Tool 类型有单元测试或类型测试。
- Prompt 和 Guardrail 至少覆盖 MVP 测试样例。
- SQLite migration 可重复执行。
- 不引入云同步。
- 不引入版权不明的知识库内容。

## 8. 退出 MVP 的条件

完成 MVP 后，才进入 Phase 2：

- 10 次连续对话无崩溃。
- 至少 20 个 Prompt 测试样例通过。
- 至少 30 个知识节点可检索。
- 至少 5 个真实题目对话能产生可接受引导。
- 本地存储、重启恢复、基础掌握度记录可用。
- 用户配置 Provider 成功后能稳定对话。

## 9. 与其他文档的关系

- Agent 调用链：`docs/agent-architecture.md`
- Prompt 和护栏：`docs/prompt-governance.md`
- 工具接口：`docs/tool-interface.md`
- 数据模型：`docs/data-model.md`
- 知识库来源与版权：`docs/knowledge-base-governance.md`
