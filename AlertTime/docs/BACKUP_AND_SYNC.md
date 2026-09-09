# 数据备份（本地 JSON）与同步边界

本文档描述 AlertTime 当前的本地 JSON 备份能力（`data/backup/`）。备份模块本身没有网络请求、
云账户、WebDAV/Drive 或自动上传。合并恢复只在当前设备本地按主键补入缺失行，不能作为
多设备同步或冲突合并方案。

**协议隔离**：TeacherAgent 局域网同步使用独立的 `alerttime-teacher-sync` 协议、配对凭据、
快照校验和上传流程；本地备份使用 `alerttime-backup` 协议。两者不互相读取 envelope，
Teacher 同步不会调用备份恢复/合并逻辑，备份 JSON 也不能作为 Teacher 同步请求发送。

## 1. 能力总览

| 能力 | 说明 | 入口 |
| --- | --- | --- |
| 创建最近本地备份 | 把当前全量数据写入用户可见的 `Downloads/AlertTime/` 专属目录（MediaStore，文件名符合 `AlertTime-backup-yyyyMMdd-HHmmss.json`），更新最近备份元信息 | 数据与备份 → 创建本地备份 |
| 合并最近本地备份 | 无需选择文件，校验通过后二次确认；补入缺失数据并保留当前冲突数据 | 数据与备份 → 合并最近本地备份 |
| 导出 JSON 备份 | 通过系统文件选择器（SAF `CreateDocument`）保存到你选择的位置，UTF-8 明文 | 数据与备份 → 导出 JSON 备份 |
| 从 JSON 文件合并恢复 | 通过系统文件选择器（`OpenDocument`）读取备份，补入缺失数据并保留当前冲突数据 | 数据与备份 → 从 JSON 文件合并恢复 |

四种能力共用同一套 JSON 协议、校验、原子写入与计时器互斥逻辑。

**重要边界**：默认最近备份文件保存在用户可见的 `Downloads/AlertTime/` 专属目录，文件本身
通常不随应用卸载消失；但“最近备份”的 URI 元数据保存在应用私有设置中，清除应用数据或卸载
重装后可能丢失。应用会在 URI 缺失或失效时，仅在该专属目录内按约定文件名重新发现候选，
并按修改时间优先读取最近候选；查询权限、系统版本或 MediaStore 不可用时平稳显示“无最近备份”，
用户仍可通过「从 JSON 文件合并恢复」手动选择文件。该机制不宣称所有 Android 版本均已跨卸载
自动恢复，也不替代用户保存一份明确导出的 JSON 文件。

**隐私边界**：备份文件包含日记、学习计划、专注记录及可能的分心应用信息，为**明文**，
本阶段不实现加密备份格式。请妥善保管，不要发送给不可信的人。备份保存在你选择的位置，
应用不会自动上传。应用现有 Android 自动云备份规则未改变：Room 数据库仍被排除在云备份之外
（见 `res/xml/backup_rules.xml` 与 `res/xml/data_extraction_rules.xml`）。

**手机 Provider 网络边界**：计划评估的 Provider 由用户自行填写并主动启用。UI 的“无认证（本地服务）”
模式只允许 loopback/RFC1918 的 HTTPS 或 HTTP，并且绝不发送任何认证 Header；Bearer 与 `api-key` 模式
只允许 HTTPS，Key 只进入对应 Header。由于 Android `targetSdk=36` 的 cleartext 平台许可只能按应用整体配置，
`res/xml/network_security_config.xml` 的许可并不代表任意 HTTP 地址可用：`EndpointPolicy` 仍是唯一请求入口，
公网 HTTP、URL credentials/query/fragment、非 `/v1` 地址和重定向均被拒绝。HTTP 不加密，只适合用户信任的本地服务，
不得填写 API Key。Provider 配置与密文仍不进入备份 JSON。

用户点击生成或同步分析时，Provider 请求包含同步白名单内全部未软删除的科目、周目标、计划和
已结束专注会话，以便历史记录参与计划评估。请求使用临时 0-based 索引替代 Room 主键与 remote UUID，
并排除日记、会话 `note`、AppSetting、API Key、配对凭据和备份内容。输入超过 80,000 字符时不截断，
而是拒绝发送并回退到本地评估；UI 只显示安全失败分类，不回显响应正文或学习记录。分析结果中的
`inputSummary` 会显示本次同一输入实际纳入的完整白名单计数，不能与“今日计划数”或“本周目标数”混淆；
该摘要只包含计数，不包含 ID、正文或密钥。

OpenAI-compatible Provider 使用有限的连接/写入/读取/总调用超时，当前默认值为 15 秒 / 15 秒 /
300 秒 / 330 秒。该总时限为思考模型预留较长首 token 延迟，但不会无限等待，也不会对可能重复计费的
`POST /chat/completions` 自动重试；OkHttp 显式关闭连接失败重试，确保一次用户操作最多一个 POST。
超时仅暴露稳定的 `timeout_network` 安全分类。不同 Provider 的思考模式或代理延迟可能仍需用户重试。

计划评估请求不发送硬编码 `temperature`，显式发送 `max_tokens=8192` 和
`response_format={"type":"json_object"}`，并保持通用 OpenAI-compatible 请求。仅当经 `EndpointPolicy`
解析的 host 精确为 `api.moonshot.cn`（大小写无关），且用户保存的模型精确为 `kimi-k2.5` 或
`kimi-k2.6` 时，才附加 `thinking={"type":"disabled"}`；同域其他模型、相似恶意域名、第三方代理和
本地服务均完全不发送该字段。该双重约束适配不会内置默认 Provider，也不会自动替换用户填写的地址、
模型或认证方式。若首个 choice 的 `finish_reason` 为 `length`，客户端在解析正文前停止并降级为稳定的
`response_truncated` 安全分类；UI 只显示“模型输出达到长度上限，内容被截断”，不显示响应正文、Key
或请求内容，也不会自动重试或二次请求。JVM 请求契约测试固定验证无 `temperature`、8192 token、JSON
object 模式、Moonshot 双重约束、截断分类、单次 POST 与敏感信息不泄露；真实 Provider 行为仍须实机验收。

模型正文的本地处理使用不含内容的阶段化安全诊断：合法 JSON 但顶层不是对象为
`output_root_shape`；命中答案字段防护为 `output_answer_guard`；必需字段缺失或类型错误为
`output_schema`；枚举、范围、长度或数量不合法为 `output_constraints`；题目任务索引缺失、越界或
无法形成有效绑定为 `output_task_binding`；最终同步协议拒绝为 `output_protocol`。真正无法解析为
JSON 的 assistant content 仍为 `response_non_json`，旧 `output_validation` 只作未知异常兜底。
这些代码及异常消息均为固定短语，不包含响应正文、字段值、API Key 或用户学习数据；取消操作不会被
吞掉或伪装成模型失败。

UsageStats 外部 AI 使用统计是可选增强。构建同步快照时，Room 事务只负责读取并冻结实体；事务
结束后，对本次快照中的全部已结束会话执行一次批量 `UsageStats.queryEvents`，再在内存中按会话
时间区间归属前台时长。禁止在 Room 事务内逐会话调用 `queryEvents`。未授权为 `null`，已授权但
没有目标 App 使用为 `0`，进行中会话为 `null`；该统计失败不得阻断本地分析或同步。

## 2. JSON 协议（schemaVersion 1）

顶层结构：

```json
{
  "format": "alerttime-backup",
  "schemaVersion": 1,
  "databaseVersion": 5,
  "appVersion": "0.1.0",
  "exportedAt": 1785600000000,
  "data": {
    "users": [],
    "subjects": [],
    "tasks": [],
    "weeklyGoals": [],
    "studySessions": [],
    "studySessionEvents": [],
    "diaries": [],
    "appSettings": []
  }
}
```

- `format` 固定为 `alerttime-backup`，导入时严格校验。
- `schemaVersion` 是**备份协议版本**（当前 1），不等于 Room `databaseVersion`。
- `databaseVersion` 是导出时的 Room 数据库版本。当前导出版本为 **5**；恢复明确接受版本
  **4 和 5**。版本 4 恢复到版本 5 时，缺失 JSON `aiHelpSeconds` 时按默认 `0` 恢复
  （对应 Room `ai_help_seconds`），
  不执行通用数据库迁移，也不接受更早版本或未来版本。其他版本一律拒绝。
- 所有时间字段使用 Unix epoch 毫秒；原本不是时间戳的业务字段（如 `sortOrder`、`priority`、
  `status`、`type`）按真实语义保留。
- 未知字段（来自未来版本）会被忽略；缺少必需字段、类型错误或结构非法会被拒绝。

### 字段映射

每个 DTO 与真实 Room 实体一一对应（见 `data/backup/BackupDtos.kt`），保留全部业务字段：
本地主键 `id`、`remote_id`、`user_id`、软删除 `deleted_at`、`created_at`/`updated_at`
以及既有同步元数据 `sync_status`。**不导出**缓存、截图、APK、通知状态、ViewModel 运行时状态、
文件路径、密钥或运行时日志。**必须包含软删除记录**，不能只导出 UI 可见数据。

| JSON 集合 | 表 | 关键外键 |
| --- | --- | --- |
| users | users | — |
| subjects | subjects | user_id → users |
| tasks | tasks | user_id → users；subject_id → subjects（SET NULL） |
| weeklyGoals | weekly_goals | user_id → users |
| studySessions | study_sessions | user_id → users；subject_id → subjects；task_id → tasks |
| studySessionEvents | study_session_events | session_id → study_sessions |
| diaries | diaries | user_id → users |
| appSettings | app_settings | —（key 主键） |

**appSettings 导出白名单**：设备绑定/同步运行时状态（`sync_` 前缀 key，如
`sync_server_info_v1`、`sync_credential_v1`、`sync_last_sync_at_v1`、
`sync_proposals_v1`、`sync_pending_decisions_v1`、`sync_processed_proposal_ids_v1`）
以及手机端计划评估 Provider 配置（`learning_analysis_llm_` 前缀）、可重新生成的最近分析缓存
（`learning_analysis_runtime_` 前缀）**不进入**明文 JSON 备份。这些 key 属于设备绑定、
同步运行时状态、派生缓存或设备敏感配置；其中 API Key 密文绑定当前
设备的 Android Keystore，换机恢复后也无法解密，因此不得导出或恢复。恢复校验发现任一
受保护前缀会 fail-closed 拒绝整批文件，防止外部或旧备份绕过导出过滤。恢复旧备份不会
自动恢复配对、Provider 配置或最近分析缓存；合并恢复保留当前设备已有的这些运行时状态。
用户填写的学习目的、考试名称、考试科目和目标日期属于普通 AppSetting，会与主题、目标、提醒等
非敏感配置一起进入明文备份；导出前的隐私提示覆盖这些内容。

## 3. 导出流程

1. 用户点击「导出 JSON 备份」，系统文件选择器（`CreateDocument("application/json")`）
   出现，默认文件名 `AlertTime-backup-yyyyMMdd-HHmmss.json`。位置由用户选择，应用不写死任何路径。
2. 在**一个 Room 只读事务**中读取全部集合（专门的 `exportAll` 查询，不复用带
   `deleted_at IS NULL` 的 UI 过滤查询），生成一致快照。
3. 编码为 UTF-8 明文 JSON，写入用户选择的 Uri。
4. 成功后把同一份数据原子地登记为最近本地备份（临时文件 + 重命名，失败保留旧备份）。
5. 导出前展示明文隐私提醒。

导出/创建备份在计时中（运行、暂停、异常恢复、仍有持久化任务）一律禁用：
「请先结束当前专注，再进行数据备份」。

## 4. 恢复流程（两种来源共用同一套逻辑）

1. 选择来源：最近本地备份（不选文件）或 JSON 文件（`OpenDocument`，接受
   `application/json`、`text/json`、`application/octet-stream`）。
2. 流式读取（强制 32 MiB 上限）→ 解码 → 校验（**此阶段不修改数据库**）。
3. 展示摘要：导出时间、协议版本、各数据集合数量。
4. 明确提示：合并只补入当前不存在的行；同本地主键或应用设置键冲突时，保留当前本地数据；用户二次确认。
5. 原子合并：**单个** `database.withTransaction` 内按父表到子表顺序执行 `INSERT OR IGNORE`，
   保留 JSON 中本地主键（备份内既有外键关系不被破坏）。任一步失败整体回滚，旧数据完整保留。
6. 成功提示「数据已合并恢复」（不表述为「同步成功」）；取消、读取失败、解析失败、校验失败或
   写入失败时，现有数据库保持不变。
7. 合并成功后刷新所有 Flow、ViewModel 与计时器内存状态
   （`HomeViewModel.refreshAfterBackupRestore`），计时器不会把恢复前的旧会话写回数据库。

### 校验规则（写库前全部完成）

- `format`、`schemaVersion`、`databaseVersion`、`exportedAt`；
- 全部 8 个必需集合存在，数量不超过上限（如 users ≤ 1000、events ≤ 200 万）；
- 主键为正且无重复；真实外键引用存在（user/subject/task/session/event）；
- 进行中的学习会话（`status = 1` 且未删除）最多一个；
- 时长、暂停时长、计数等数值非负；`endTime ≥ startTime`；focusScore ∈ [0, 100]；
- `status`、`type`、`eventType` 等枚举值受当前版本支持（见 `core/StatusCodes.kt`）；
- 字符串长度、集合数量、嵌套规模有合理上限；
- JSON 中的字符串一律按数据保存，不接受也不执行任何路径、Intent、SQL、类名等非数据内容。

## 5. 一致性、原子性与文件大小

- **一致性**：导出为单一只读事务内的快照；合并为单一写事务。
- **原子性**：父表到子表的全部插入在一个事务内；中途任何失败整体回滚。
- **并发**：导出与导入共用应用级 `Mutex`（`BackupRepository.operationMutex`），防止重复点击
  或并发操作；UI 层同时用 `operationRunning` 状态防抖。
- **计时器互斥**：计时器与备份共用同一个 `BackupTimerGate` 原子门（非 UI 状态快照）——
  计时活跃（运行/暂停/异常恢复/持久化）时备份操作在入口被拒；备份操作持有门期间计时器
  `tryStartTimer` 立即失败，旧计时状态不可能在恢复写库期间写回。计时恢复 running 会话时
  通过同一门标记忙碌。
- **文件大小**：读取在流式过程中强制限制 32 MiB，不能只依赖文件元数据；**导出与最近备份
  写入使用同一上限检查**（`encodeEnvelope`），不会产出应用自身拒绝恢复的文件。
- **兼容性**：未知字段可忽略；格式错误、类型错误、缺少关键字段或不支持的版本一律拒绝。
- **隐私**：明文，无加密；本阶段不实现加密备份格式（代码注释与本文档均明确此限制）。

## 6. 最近本地备份的限制

- 默认最近备份写入用户可见的 `Downloads/AlertTime/` 专属目录（不依赖应用私有目录，
  不进入 Android 自动云备份）。应用私有设置只保存最近文件的 URI，文件保留与 URI 元数据保留
  是两个不同边界。
- 仅在用户点击「创建本地备份」或「导出 JSON」成功后更新；不做后台定时备份。
- 更新采用临时文件 + 原子重命名，失败时保留之前可用备份。
- 备份不存在、损坏、不可读或校验失败时，「合并最近本地备份」禁用并给出明确错误。
- 清除应用数据或卸载重装后，若 URI 元数据丢失，应用只会在 `Downloads/AlertTime/` 内查找
  本应用约定命名的 JSON 候选；候选数量和单文件读取大小均有界，并且恢复前仍必须通过 JSON
  解码与全部校验。查询不可用时不自动猜测其他目录；用户可随时使用文件选择器手动恢复。
- **不保证所有 Android 版本均跨卸载自动恢复**；跨卸载/换机仍建议使用「导出 JSON 备份」并
  保存在用户明确管理的位置。

## 7. 测试

- 单元测试：`BackupJsonCodecTest`（round-trip、nullable、中文/换行/特殊字符、未知字段、
  错误格式与不支持版本拒绝）；`BackupValidatorTest`（重复主键、外键缺失、非法枚举、
  负时长、超限字符串/集合、合法软删除通过）。
- Instrumentation：`BackupRepositoryInstrumentedTest`（全量导出含软删除、合并恢复后数据一致、
  外键与 session/event 关系保留、故意制造插入失败时事务回滚且旧库不被清空、app settings 恢复、
  共享门阻塞、**测试使用注入的隔离临时目录，绝不触碰生产备份目录**）。
- UI/状态：`DataBackupDialogTest`（计时中操作禁用、无最近备份时恢复按钮禁用、合并恢复需二次确认、
  失败信息可见、成功后状态刷新）。

当前状态：用户自带 Provider、手机独立生成/本地保存、Provider 与派生缓存过滤、协议隔离以及
最近备份 URI 丢失后的受限 MediaStore 重新发现已经完成实现；候选选择规则已通过 JVM 测试，
真实 MediaStore、进程重启读取、跨卸载行为、Teacher 稍后局域网同步及备份恢复联合流程
仍**待真实设备验收**。本文档不据此宣称实机通过。

## 8. 未实现事项（非目标）

- 加密备份格式（明文，妥善保管）。
- 后台自动备份 / 自动定时备份 / 自动上传。
- 更复杂的冲突解决或双向合并：当前仅补入缺失行，主键/设置键冲突时保留当前本地值。
- 通用多设备/云同步。现有 TeacherAgent 局域网同步是单手机与单桌面间的独立、手动、私有网络
  协议，不等同于云同步，也不提供任意多端冲突合并、账号体系或自动上传。

## 9. 学习分析定向设备验收

`scripts/verify-learning-analysis-device.ps1` 是当前唯一推荐的自动设备入口。默认仅做只读预检；
只有显式追加 `-ConfirmReplaceInstall` 才会继续。示例：

```powershell
./scripts/verify-learning-analysis-device.ps1 -AdbPath D:/AndroidSDK/platform-tools/adb.exe
./scripts/verify-learning-analysis-device.ps1 -AdbPath D:/AndroidSDK/platform-tools/adb.exe -ConfirmReplaceInstall
```

安全边界：

- 必须且只能有一台已授权设备在线；也可用 `-Serial` 明确指定。
- 设备必须已安装 `com.hxz.alerttime.app`；脚本拒绝把不存在的应用当作新安装目标。
- 只使用 `adb install -r -t` 覆盖安装现有 debug APK 与测试 APK；不包含卸载、清除数据或
  全量 `connectedAndroidTest`。
- 只运行 `LocalLearningAnalysisStoreInstrumentedTest`、
  `LlmProviderSettingsStoreInstrumentedTest` 和 `LearningAnalysisDialogTest`。这些测试使用独立
  测试数据库/Keystore alias 或纯 Compose 状态，不访问生产学习数据库和生产 Provider Key。
- 覆盖安装前后核对 package `userId` 与 `firstInstallTime`；相异则 fail-closed。该检查不替代用户
  对已有计划、历史专注和配对状态的界面确认。

脚本已经通过 PowerShell AST 语法解析；在无设备状态下实测会在安装前安全拒绝。真实设备测试仍未执行。

## 10. 无设备学习分析回放

`LearningAnalysisOfflineReplayTest` 在 JVM 中串联真实 `SyncCodec`、
`LearningAnalysisService` 与 `LearningAnalysisRepository` 边界，使用协议中的
`snapshot-valid.json` 固定快照以及实体状态变化的 A/B 快照验证：

- canonical 快照必须先经过生产 `SyncCodec.decodeSnapshotEnvelope` 解码，再进入回放；
- 覆盖软删除、中文/换行/emoji、AI 使用字段以及今日计划引用；
- 未配置 Provider 时生成并保存 `deterministic_fallback`；
- 在实体 `remoteId` 保持稳定、完成状态或专注时长变化时，画像、评分和证据随快照变化，
  两个快照分别绑定自己的 `sourceSnapshotId`，并生成不同 `analysisId`；
- 验证最新快照 B 被选中，并保留并发互斥与回退行为；
- 跨 Repository 实例共享的操作互斥保证旧生成结果不会覆盖新快照的最近分析；
- 整条测试不依赖设备、ADB、Room、Keystore、真实 Provider 或网络。

2026-08-11 完整 JVM 门禁为 34 suites / 222 tests，0 failures / 0 errors / 0 skipped；
`lintDebug`、`assembleDebug` 与 `assembleDebugAndroidTest` 同时通过。该回放用于提高代码闭环
可信度，不替代上节三个 instrumentation、进程重启 UI、真实 Provider 或局域网实机验收。

### Teacher 侧统一离线入口

可从 TeacherAgent 工作区使用统一入口编排本节无设备回放：

```powershell
npm run verify:alerttime-offline -- `
  -AlertTimeRoot "<AlertTime worktree>" `
  -RustToolchainBin "<Rust toolchain bin>"
```

该入口会串行运行 Teacher 侧 TypeScript 回放、Rust HTTP 回放、AlertTime 侧
`LearningAnalysisOfflineReplayTest` 与 `SyncCodecTest` Android JVM 回放，以及两端
`sync/protocol` 文件集合和字节级一致性校验（含 `app/src/test/resources/sync/fixtures` 与
AlertTime 根目录 fixture 的镜像校验）。AlertTime 侧在这里仅运行 JVM 回放，
不会调用 `adb`，不会安装、卸载或清除应用数据，不会运行 instrumentation，也不会写入
`local.properties`。

主 Agent 已实际复跑该入口并成功退出（exit 0）。验收证据如下：

- Android `LearningAnalysisOfflineReplayTest` JVM 回放显示 `BUILD SUCCESSFUL`；
- Android `SyncCodecTest` JVM 回放显示 `BUILD SUCCESSFUL`；
- Teacher TypeScript 回放通过 10 项，Rust HTTP 回放通过 2 项；
- TeacherAgent 与 AlertTime 两端协议目录共 10 个文件，且 Android 测试 fixture 与 AlertTime
  根目录 fixture 文件集合及字节内容完全一致；
- `local.properties` 守卫未发现文件创建或修改；
- 全程无 ADB、无设备连接、无安装/卸载、无清除应用数据。

该入口是当前无设备阶段的统一离线验证入口，仍不等价于 instrumentation、真实 Provider
验收或局域网同步真机验收，也不替代
进程重启 UI 流程和真实网络链路验证。

## 11. Teacher proposal 分页与原子合并

TeacherAgent 的 `GET /v1/proposals` 使用 `DEFAULT_PROPOSAL_LIMIT=50`，响应通过
`nextCursor` 表示下一页。AlertTime 同步时会从首屏开始，使用上一页经
`SyncCodec` 校验通过的 cursor，并按 query component 编码后请求后续页面；不关闭
HTTPS 证书 pin、Bearer 凭据或同步 Mutex。

- 每一页先完成协议、deviceId、proposalId、嵌套字段和 cursor 校验，再进入跨页聚合。
- 跨页 proposalId 重复、cursor 不前进、cursor 循环、非法 cursor、页异常或累计结果超过
  `SyncProposalStore.MAX_STORED_PROPOSALS` 时 fail-closed。
- 空页、`nextCursor=null` 或达到本地总上限时终止；单页和跨页结果均保持服务端最新到最旧顺序。
- 所有页面成功验证后，才对 `SyncProposalStore.mergeFromServer` 调用一次；中间页失败不会
  部分覆盖本地建议。`SyncOutcome.proposalsReceived` 只统计本次成功聚合并提交的唯一 proposal。
- 本地总上限唯一来源为 `SyncProposalStore.MAX_STORED_PROPOSALS`（当前 100），不能在协调器或
  UI 另写一个分页缓存上限。

该分页闭环的 JVM 测试覆盖 50+1 两页、空尾页、null cursor 兼容终止、重复 ID、cursor 循环、
中间页异常原子性和总上限；仍需在后续真实局域网设备验收中确认 TeacherAgent 返回多页时的实际链路。

## 12. 2026-08-11 proposal 采纳来源闭环

TeacherAgent 下发的 proposal 只能引用当前用户的**未删除、未归档科目**。采纳校验、计划与周目标
创建、幂等标记、待发送决策以及 proposal 来源记录必须在同一个 Room 事务中完成；任一校验或写入失败，
整笔事务回滚，不能留下半个计划、孤立周目标或已处理但未创建实体的状态。

采纳会创建 `type = 1` 的计划/任务，并保存有界、版本化的本地映射
`proposalId → weeklyGoalLocalIds/taskLocalIds`。映射 key `sync_proposal_sources_v1` 属于本地运行态：

- 映射缺失、损坏、超出版本或数量上限时 fail-closed，仅放弃来源追踪，不阻断普通同步，也不删除业务实体；
- 映射不进入 JSON 备份；覆盖恢复、合并恢复和重新配对都会清除映射，但保留已经创建的计划、周目标和学习记录；
- 快照中的 `sourceProposalId` 是可选字段，旧客户端缺失该字段仍可读写；该字段只表示来源声明，**不证明计划已完成**。

Teacher 只有在 proposal 已被当前设备采纳、来源 ID 与快照实体及字段严格匹配、任务仍为 `type = 1`，且完成状态
由最新快照事实支持时，才生成执行结果与完成率；来源缺失、字段漂移、跨设备、重复认领或额外实体均按不可追踪处理。
执行结果会作为下一次建议的输入证据，但不会自动完成、改写或再次采纳计划。

2026-08-11 自动门禁：Android 36 suites / 264 tests 通过；`lintDebug` 为 0 errors / 12 warnings；
`assembleDebug`、`assembleDebugAndroidTest`、TeacherAgent 与 AlertTime 双端协议 10 文件镜像、JVM 8 个
fixture 镜像及统一离线闭环均通过。此次未进行设备、ADB、真实 Provider 或局域网实机验收。
