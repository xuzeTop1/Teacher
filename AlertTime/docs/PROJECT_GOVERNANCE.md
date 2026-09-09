# AlertTime 项目治理文档

## 1. 项目定位

AlertTime 是一款面向大众学习用户的 Android 学习时间管理 App。它不是个人脚本工具，而是计划发展为可发布、可维护、可同步的学习产品。

核心用户包括：

- 高中生
- 大学生
- 考研、考公、考证用户
- 自习室用户
- 需要记录真实学习时间和复盘学习状态的人

第一阶段目标：

- 提供可靠的本地学习计时。
- 提供计划、便签、日记和基础统计。
- 使用 SQLite/Room 离线存储。
- 为后续云同步、账号系统和多设备使用预留架构空间。

## 2. 技术栈

第一阶段技术栈：

- 语言：Kotlin
- UI：Jetpack Compose
- 设计系统：Material 3
- Android 基线：Android 16 / API 36
- 架构：MVVM
- 本地数据库：Room SQLite
- 异步：Kotlin Coroutines + Flow
- 导航：Navigation Compose
- 构建工具：Gradle

暂不引入：

- 跨平台框架
- 复杂后端 SDK
- 大型 UI 组件库
- 非必要的动态化 UI 引擎

## 3. 产品原则

### 3.1 真实学习时间优先

计时数据是产品核心资产。任何功能都不能破坏计时的准确性。

要求：

- 开始、暂停、继续、结束逻辑必须清晰。
- App 异常退出后应尽量恢复正在进行的学习会话。
- 用户应能编辑明显错误的记录。
- 统计页必须和记录页数据口径一致。

### 3.2 离线优先

第一版必须在无网络环境下完整可用。

要求：

- 计时、计划、日记、统计都依赖本地数据。
- 云同步只能是增强能力，不能成为核心功能前置条件。
- 后续同步失败时不能影响本地继续使用。

### 3.3 面向大众用户

界面和文案不能只围绕个人习惯设计。

要求：

- 默认科目和默认计划应适合广泛学习场景。
- 不使用过度个人化命名。
- 用户可以自定义科目、目标和偏好。
- 数据结构预留多用户和云端身份。

### 3.4 克制和高频可用

这是一个会被频繁打开的工具，不是营销展示页。

要求：

- 首页必须让用户快速开始学习。
- 重要操作不能藏太深。
- 不做干扰学习的强动画。
- 视觉风格应安静、清晰、有层次。

## 4. UI 与交互规范

### 4.1 设计方向

AlertTime 的界面风格应满足：

- 现代
- 干净
- 克制
- 适合长时间使用
- 有学习工具的秩序感

避免：

- 过度卡通化
- 过度商务化
- 大面积刺眼颜色
- 复杂渐变堆叠
- 首屏营销页

### 4.2 页面结构

建议主导航：

- 首页
- 计划
- 统计
- 日记
- 我的或设置

首页优先级：

1. 当前学习状态
2. 开始学习按钮
3. 今日学习时长
4. 今日目标进度
5. 当前任务或最近科目

### 4.3 Compose 约定

- 页面级 Composable 以 `Screen` 结尾。
- 可复用组件以业务含义命名，如 `StudyTimerCard`。
- UI 状态使用不可变 data class。
- Composable 尽量保持无副作用。
- 副作用集中使用 `LaunchedEffect`、`DisposableEffect` 或 ViewModel。
- 颜色、字体、间距尽量通过统一 Theme 或 design token 管理。

示例命名：

```text
HomeScreen
PlanScreen
StatsScreen
DiaryScreen
SettingsScreen
StudyTimerCard
TodayProgressCard
SubjectChip
TaskListItem
```

## 5. 架构规范

推荐模块分层：

```text
app
├── data
│   ├── local
│   │   ├── dao
│   │   ├── entity
│   │   └── database
│   ├── mapper
│   └── repository
├── domain
│   ├── model
│   ├── repository
│   └── usecase
├── ui
│   ├── home
│   ├── plan
│   ├── stats
│   ├── diary
│   ├── settings
│   └── components
└── core
    ├── time
    ├── design
    └── util
```

依赖方向：

```text
ui -> domain -> data
```

禁止：

- UI 直接访问 Room DAO。
- ViewModel 直接拼接 SQL。
- Entity 直接暴露给 UI。
- 计时核心逻辑散落在多个 Composable 中。

## 6. 数据治理

### 6.1 数据是用户资产

学习记录、计划和日记都属于用户个人数据。

要求：

- 删除前需要明确确认。
- 后续应支持导出。
- 日记内容不应被无提示上传。
- 云同步要有清晰开关和隐私说明。

### 6.2 时间处理

- 存储统一使用 epoch milliseconds。
- 展示时使用用户本地时区。
- 日统计边界以用户本地日期为准。
- 周统计第一版使用周一作为一周开始。

### 6.3 数据迁移

任何数据库结构变更都必须：

- 更新数据库版本。
- 提供 Room Migration。
- 更新 `docs/DATABASE.md`。
- 添加或更新相关测试。

正式版本禁止使用 destructive migration。

## 7. 代码质量规范

### 7.1 Kotlin 规范

- 优先使用不可变数据结构。
- 明确处理 nullable。
- 避免超长函数。
- 业务枚举使用 enum class 或受控常量。
- 时间、时长转换集中放在工具类或 domain service。

### 7.2 Compose 规范

- Preview 应覆盖主要状态。
- Loading、Empty、Error 状态不能缺失。
- 列表项应有稳定 key。
- 大型页面拆成小组件。
- 不在 Composable 中直接创建长期业务对象。

### 7.3 错误处理

- 数据库写入失败需要可观察。
- 计时状态异常需要用户可恢复。
- 同步失败后续不能破坏本地数据。
- 用户可理解的错误应显示为清晰文案。

## 8. 分支和提交规范

建议分支命名：

| 类型 | 示例 |
|---|---|
| 功能 | `feat/study-timer` |
| 修复 | `fix/timer-restore` |
| 文档 | `docs/database-design` |
| 重构 | `refactor/session-domain` |
| 实验 | `experiment/compose-theme` |

提交信息建议：

```text
feat(timer): add study session timer
fix(database): repair session duration migration
docs: add database design document
refactor(ui): split home timer components
```

## 9. 版本规划

### 9.1 MVP

目标：本地可用的学习时间管理 App。

范围：

- 学习计时
- 学习记录
- 科目管理
- 计划和便签
- 日记
- 今日和本周统计
- Room SQLite 本地存储

### 9.2 Beta

目标：接近可公开测试。

范围：

- 更完整的统计
- 数据导出
- 提醒功能
- 更完善的设置页
- 基础错误恢复
- UI 细节打磨

### 9.3 Cloud Ready

目标：为服务器上线做准备。

范围：

- 账号体系预留
- 云同步字段启用
- 冲突解决策略
- 隐私和数据协议
- 多设备同步设计

## 10. 测试策略

优先测试以下高风险区域：

- 计时开始、暂停、继续、结束
- App 退出后恢复计时状态
- 每日学习时长统计
- 跨天学习会话处理
- 数据库迁移
- 删除和编辑学习记录

测试类型：

- Unit Test：domain 逻辑、时间计算、统计聚合
- DAO Test：Room 查询和写入
- UI Test：关键页面状态和主流程
- Manual QA：真实设备长时间计时

## 11. 隐私与安全

第一版即使没有服务器，也要按照可发布产品标准处理用户数据。

要求：

- 不默认收集敏感数据。
- 日记内容默认只保存在本地。
- 后续云同步必须提供明确开关。
- 日志中不能输出日记正文。
- 导出数据时提醒用户文件包含个人学习内容。

## 12. LLM 协作规范

当使用 LLM 编写本项目代码时，应遵守：

- 优先阅读现有架构和文档。
- 不随意更换技术栈。
- 不引入大型依赖来解决小问题。
- UI 修改遵守本文档的设计方向。
- 数据库修改必须同步更新数据库文档。
- 计时逻辑修改必须说明统计口径是否变化。
- 生成页面时要包含空状态、错误状态和加载状态。

推荐后续创建专用 skill：

```text
study-app-compose-designer
```

该 skill 用于约束 LLM 生成适合大众学习时间管理 App 的 Jetpack Compose UI。

## 13. 决策记录

重要技术和产品决策应记录在 `docs/adr/` 目录。

ADR 命名：

```text
0001-use-jetpack-compose.md
0002-use-room-sqlite.md
0003-offline-first-architecture.md
```

每份 ADR 建议包含：

- 背景
- 决策
- 备选方案
- 影响
- 日期

## 14. 当前已确认决策

| 决策 | 结果 |
|---|---|
| Android 技术路线 | 原生 Android |
| Android SDK 基线 | Android 16 / API 36 |
| UI 技术 | Jetpack Compose |
| 数据库 | Room SQLite |
| 第一阶段网络依赖 | 无，离线优先 |
| 产品定位 | 面向大众学习用户 |
| 后续方向 | 可迁移云同步 |

## 15. Android 可选 LLM 计划评估授权

状态：**手机独立生成与自动化验证已实现，待真实设备验收**。自动化测试或 APK 构建通过不能
替代真实 Provider、配置保存/停用、进程重启持久化与稍后局域网同步验收，不得写成“实机已通过”。

本授权仅适用于用户在独立“学习分析与模型设置”中主动配置的手机端计划评估，不得扩展为默认
云端画像、云数据库、云同步、日记上传、自动采纳计划或后台持续分析。Provider 地址、模型与
API Key 均由用户填写，应用不得内嵌可用默认值或开发者公共密钥。

要求：

- 默认关闭。手机端必须允许在未配对、桌面离线和局域网不可用时由用户主动生成并本地保存分析；
  未配置、未启用、配置无效、网络失败、模型输出非法或 Provider 异常时使用
  `deterministic_fallback`。每次实际同步仍生成一份绑定本次 `snapshotId` 的新分析，并在任何
  桌面网络请求前保存到手机。
- 用户可填写学习目的、考试/项目名称、考试或重点科目与目标日期；字段默认全部留空，不得猜测。
  用户主动生成或同步时，这些字段与全部未软删除的科目、周目标、计划及已结束专注会话共同进入
  Prompt。发送前必须移除本地主键、remote UUID、日记、会话 note、API Key、AppSetting、配对凭据、
  备份 JSON、设备文件和通知内容；不得在后台自动上传。
- API Key 使用独立 Android Keystore 密钥保护；UI 和 ViewModel 状态不得保存、显示或回填明文
  Key。Provider 的 `learning_analysis_llm_` 设备敏感设置与可重新生成的
  `learning_analysis_runtime_` 派生缓存不得进入备份 JSON；用户填写的普通学习目标设置可随
  明文 JSON 备份迁移，并受导出隐私提示约束。
- Provider 持久化 instrumentation 测试必须使用独立测试数据库与独立 Keystore alias，不能读取、
  替换或删除用户生产密钥；测试须覆盖 Room 关闭/重开后非敏感设置恢复、密钥密文落库及重新解密。
- 学习时长、专注评分和 AI 使用时长只能作为投入与执行事实，不能直接更新或推断 mastery。
  事实与模型推断必须分离，并保留证据引用与置信度。
- LLM 生成题目的状态固定为 `draft`，不得进入 approved 题库、`assessment_results` 或 mastery；
  只有用户真实作答且经过正式评估链路后，才能形成掌握度证据。
- 计划评估只生成建议，手机端和 TeacherAgent 均不得自动采纳、自动改写计划或替用户确认完成。
- UI 不直接访问网络或 Room DAO；Provider 配置读取、原子保存、停用和密钥处理必须由数据层 Store
  完成。配置半写、缺密钥或密文不可解密时，必须安全视为未启用。
- 本阶段不引入远程数据库、账号、后台上传或任意网络同步。TeacherAgent 仍是同一私有局域网内
  用户手动触发的可选消费者；跨网络云端数据库留待后续单独决策。
- 设置表单存在未保存修改时不得生成分析；刷新、学习目标保存、Provider 保存/停用、独立生成与
  同步生成必须有明确互斥，不能让异步刷新或旧持久化值覆盖用户刚保存的配置。
- `durationSeconds` 是已记录的有效专注秒数，计划评估不得再次扣除 `pauseSeconds`。跨午夜完成会话
  必须按手机本地自然日统计；同步 DTO 缺少暂停/继续事件时可按开始/结束区间重叠比例分摊，但必须
  附带可审计 warning，不能整段丢弃或全算到开始日。
- `evidenceRefs` 必须绑定当前快照中的科目、周目标、任务、会话，或使用协议冻结的今日/本周聚合与
  用户设置证据名；未知和跨快照引用必须在上传前 fail-closed。Teacher 读取派生缓存时重做同一语义
  校验，缓存损坏只隐藏该分析，不影响原始学习数据。
- UsageStats 是可选增强；权限竞态、OEM 异常和无授权均降级为 unknown，不得阻断分析、备份或同步。
  构建一次快照时，必须先在单个 Room 事务内冻结同步白名单实体，再在事务外对本次全部已结束
  会话执行一次批量 `UsageStats.queryEvents` 扫描，并在内存中按会话区间归属结果；禁止在 Room
  事务内按会话逐个查询系统 UsageStats。未授权保持 `null`，已授权但区间无使用保持 `0`，
  进行中会话保持 `null`。
  建议处理结果部分回传失败时须保留待发记录并在 UI 明示下次重试；配对和同步操作须全进程互斥。
- 最近分析作为派生缓存持久化时，只能附带完成重载校验所需的最小 remoteId 证据索引，不得复制原始
  计划正文、会话备注、Provider 配置或密钥。缓存重载必须按索引重做协议结构、实体引用和证据绑定校验；
  索引缺失、损坏或语义不一致时丢弃派生缓存并允许用户重新生成，不影响原始计划和学习记录。
- Provider 网络层必须把用户保存的 Base URL、模型和认证方式原样作为本次请求权威输入，不得在请求层
  隐式回退到内置地址、模型或另一认证模式。API Key 只能进入所选认证 Header，不能进入 JSON 正文；
  HTTP 错误不得回显 Provider 响应正文、请求体或密钥。内存拦截器测试属于请求契约证据，不替代真实
  Provider、TLS、代理和设备网络验收。

### 15.1 Provider 网络边界补充（2026-08-11）

- 认证方式包含 `none`（UI 文案“无认证（本地服务）”）。它只适用于用户明确选择、且用户信任的本机或
  RFC1918 局域网服务；不发送 `Authorization` 或 `api-key`，`apiKey` 必须为空。
- Bearer 与 `api-key` 模式只允许 HTTPS，并且 API Key 只能进入各自对应的请求 Header；不得进入 URL、查询参数、
  JSON 正文或日志。所有模式继续拒绝公网 HTTP、URL credentials、query、fragment、非 `/v1` 根地址，OkHttp 不跟随重定向。
- Android `targetSdk=36` 的 cleartext 许可是 app-wide。为使动态私网地址上的 `none` HTTP 真实可用，Manifest 使用
  最小 `network_security_config` 平台许可；这不是域名白名单。`EndpointPolicy` 是唯一请求入口，继续对 HTTP 做
  loopback/RFC1918 与 `none` 双重限制，带密钥模式永远强制 HTTPS。新增网络入口必须复用该策略，不得直接创建绕过策略的请求。
- 从带密钥模式切换到 `none` 时，Room 同一事务先写非敏感配置、删除旧密文、最后启用；`none` 不要求、不解密、不返回
  Key。切回带密钥模式必须重新填写或使用仍存在且可解密的密文；空数据库不产生默认 Provider。

### 15.2 全量学习记录分析边界（2026-08-15）

- “全部记录”仅指同步白名单内全部未软删除的科目、周目标、计划及已结束专注会话。会话只发送标题、
  时间、有效时长、暂停、专注评分和 AI 使用聚合等分析字段；`note`、日记、设置、密钥和任何本地/远程
  标识符始终排除。
- Prompt 使用本次请求内的 0-based `subjectIndex`、`goalIndex`、`taskIndex`、`sessionIndex` 重建关联，
  不向 Provider 暴露 Room 主键或同步 UUID。历史记录可用于画像、趋势和计划合理性，但时长、完成状态及
  专注评分仍不能单独作为掌握度证据；测试题优先当前有效、未完成或近期计划。
- 不得静默丢弃记录或截断记录正文。序列化输入超过 `MAX_LLM_PROMPT_CHARS` 时整次请求 fail-closed，
  使用本地确定性评估并在 UI 明示“学习记录过多，未发送给模型”。
- Provider 失败只暴露稳定安全分类：认证/权限、接口或模型不存在、限流/额度、网络超时、响应非 JSON、
  输出校验失败或请求过大。输出校验按固定阶段码区分 `output_root_shape`、`output_answer_guard`、
  `output_schema`、`output_constraints`、`output_task_binding` 与 `output_protocol`；旧
  `output_validation` 仅保留为未知异常兜底。阶段码和对应异常消息只能使用固定短语，不得拼接底层
  exception message、字段名/字段值、响应正文、请求体、Key、URL 查询参数或学习记录内容。
  协程 `CancellationException` 必须继续向上传播，不能转换成 fallback 诊断码。
- `alerttime-plan-assessment-v3` 允许纯 JSON 或仅一个完整的 `json` Markdown 代码块；代码块外解释、多个
  对象、答案字段或非法 schema 必须 fail-closed。

### 15.3 学习分析输入摘要与 Provider 超时（2026-08-15）

- 新分析可带 `inputSummary`，只记录本次同一 `AnalysisInput` 实际纳入的科目、周目标、计划和已结束
  专注会话数量，以及固定来源标识；不得包含本地主键、remote UUID、正文、密钥或其他设备标识。
  它是完整输入计数，不能与“今日计划数”“本周目标数”等派生事实混用。若存在，接收端必须核对它与
  同一 snapshot 的白名单计数一致；旧版缺失该字段仍保持兼容。
- 默认 Provider 超时必须有限且可测试：连接 15 秒、写入 15 秒、读取 300 秒、总调用 330 秒。该策略
  为思考模型预留较长首 token 延迟，但不得无限等待，也不得对未具备幂等依据的分析 POST 自动重试。
  OkHttp 必须显式关闭连接失败重试；一次用户操作最多发送一个分析 POST。Activity 进入后台不得
  主动取消 ViewModel 中已经开始的生成，也不得引入后台自动请求或重试。
  超时继续只暴露稳定的 `timeout_network` 安全分类，不回显 Provider 响应、请求体或学习记录。
- 通用 OpenAI-compatible 分析请求不得硬编码 `temperature`；显式发送 `max_tokens=8192` 与
  `response_format={"type":"json_object"}`。唯一受控兼容例外是：`EndpointPolicy` 解析后的 host
  精确等于 `api.moonshot.cn`（大小写无关），且用户保存的模型精确等于 `kimi-k2.5` 或 `kimi-k2.6`
  时，请求附带 `thinking={"type":"disabled"}`；其他域名、代理、相似域名和其他模型必须完全省略
  `thinking`。该策略不得替换用户地址或模型，也不构成内置默认 Provider。响应必须先检查
  `finish_reason`：值为 `length` 时，在解析模型正文前 fail-closed 为稳定的 `response_truncated` 分类，
  不得回显正文、Key 或请求内容，也不得为此自动发送第二次请求。

## 16. Teacher proposal 分页同步口径

TeacherAgent proposal 列表默认每页 50 条，AlertTime 必须依据服务端返回的 `nextCursor` 继续
拉取，不能只请求首屏。每一页必须先经过生产 `SyncCodec` 校验；分页编排只接受已经校验的
plausible cursor，并进行 URL query component 编码，同时保持现有 HTTPS pin、Bearer 和同步
Mutex。

分页结果在内存中按服务端最新到最旧聚合。跨页重复 proposalId、游标不前进或循环、单页/累计
结果越过 `SyncProposalStore.MAX_STORED_PROPOSALS`、空页带游标以及任何中间页错误都必须
fail-closed。分页 helper 成功返回前不得调用本地 merge；成功后只调用一次
`mergeFromServer`，因此任何中间页失败都不能部分覆盖本地 proposal。`SyncOutcome.proposalsReceived`
是本次成功聚合并提交的唯一 proposal 数，分页总上限必须引用 Store 常量而不是复制数字。

## 17. 2026-08-11 proposal 采纳来源与执行反馈

proposal 的采纳来源必须形成可审计、可失效的闭环：只有当前用户仍存在、未删除且未归档的科目可以被
proposal 引用。采纳校验、创建 `type = 1` 计划/任务与周目标、幂等标记、待发送决策以及
`proposalId → 本地主键` 的来源记录必须在同一个 Room 事务内完成；任一步失败都必须整事务回滚。

来源记录使用有界、显式版本化的本地 mapping，key 为 `sync_proposal_sources_v1`。它是同步运行态而非
用户业务数据：损坏、未知版本、重复主键或超过上限时必须 fail-closed，放弃来源追踪但不阻断普通同步，
也不得删除已存在的业务实体。mapping 不进入备份 JSON；覆盖恢复、合并恢复和重新配对时清除 mapping，
但保留计划、周目标、任务及学习记录等业务实体。

同步快照的 `sourceProposalId` 为可选字段，旧客户端缺失该字段必须保持兼容。来源声明不能直接视为完成事实；
Teacher 只有在同设备、已采纳 proposal、来源 ID、proposal 字段和最新快照实体严格一致，并确认任务为
`type = 1` 后，才能据真实快照状态计算执行反馈。字段漂移、跨设备来源、重复认领、来源缺失或额外实体
必须 fail-closed，不得提高完成率。执行反馈可以作为下一次建议的证据，但系统不得自动采纳、自动完成或
自动改写用户计划。

### 17.1 自动验证记录

2026-08-11 最新自动门禁结果：Android 36 suites / 264 tests 通过；`lintDebug` 0 errors / 12 warnings；
`assembleDebug` 与 `assembleDebugAndroidTest` 通过；TeacherAgent 与 AlertTime 双端协议 10 个文件及
JVM 8 个 fixture 镜像逐字节一致；统一离线闭环通过。该结果不包含设备/ADB、真实 Provider、进程重启 UI
或局域网同步实机验收，不能表述为实机通过。
