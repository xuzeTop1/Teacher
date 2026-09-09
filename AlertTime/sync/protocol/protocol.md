# AlertTime ↔ TeacherAgent 同步协议 v1

协议名：`alerttime-teacher-sync`  
schemaVersion：`1`  
状态：本分支实现基线  
最后更新：2026-08-03  
权威来源：`docs/decisions/2026-08-03-alerttime-lan-sync.md`

> 本文件在两个仓库各保存一份（TeacherAgent：`sync/protocol/protocol.md`；AlertTime：`sync/protocol/protocol.md`），内容必须逐字一致。golden fixtures 与 SHA-256 清单同样各保存一份；两端测试读取同一版本的 fixture，防止协议漂移。任何一侧修改协议文件后，必须同步另一侧并重新生成 SHA-256 清单。

## 1. 定位

这是 AlertTime（Android 手机）与 TeacherAgent（桌面）之间**单手机局域网同步**的专用协议。它与本地备份协议（`alerttime-backup`，用于同设备本地恢复）完全分离：

- 禁止把最近本地备份直接发送给 TeacherAgent；
- 禁止调用 `BackupRepository.restore/merge` 完成同步；
- 禁止把同步成功表述为备份恢复成功；
- 不修改现有 A+B 合并恢复规则。

本协议只用于家庭 WiFi 或手机热点下的私有局域网（HTTPS）。学校、公司和公共 WiFi 可能存在 AP isolation、VLAN 或防火墙限制，不能宣传为任意网络下均可使用。

## 2. 传输

- 传输层：HTTPS（TLS 1.2+），证书为 TeacherAgent 自签证书，手机端只信任二维码中的证书 pin（SPKI SHA-256）。
- 所有接口使用显式 DTO（JSON），不使用任意 Map。
- 请求体上限：8 MiB（`MAX_SYNC_BYTES`）。
- 请求超时、失败次数限制、日志脱敏由两端实现。
- 每个端点只接受自己的 `messageType`：`/v1/pair` 只接受 `pair`、`/v1/snapshots`
  只接受 `snapshot`、`/v1/proposal-decisions` 只接受 `proposalDecision`；
  错误消息类型一律 400 拒绝，不允许同一种通用校验让错误类型消息混入其他端点。
- `POST /v1/unpair`：手机使用当前 Bearer 设备凭据撤销自己；服务端将对应设备
  `revoked_at` 置为当前时间后返回 `unpairAck`，手机确认收到后才清除本地凭据；
  撤销后旧凭据立即返回 401。手机端解除配对流程必须区分「已安全撤销」（服务端
  确认）与「网络不可用」（不得假装已撤销，提示稍后重试或在 TeacherAgent 设备列表手工撤销）。
- 响应校验：手机端必须验证响应 `messageType` 为期望值，且响应 `deviceId`
  等于当前配对设备；`snapshotAck` 必须在信封中回显请求的 `snapshotId`，
  手机端据此关联本次请求（不匹配即拒绝）。
- 接口：
  - `GET /v1/health`：服务健康信息（不要求鉴权，只返回服务名与协议版本）。
  - `POST /v1/pair`：使用一次性配对 token 换发设备凭据。
  - `POST /v1/snapshots`：上报完整业务快照（Bearer 设备凭据鉴权）。
  - `GET /v1/proposals?cursor=<proposalId>`：拉取本设备建议稿（Bearer 鉴权）。
  - `POST /v1/proposal-decisions`：上报采纳/拒绝决策（Bearer 鉴权）。

## 3. 消息信封（所有消息共用）

```json
{
  "format": "alerttime-teacher-sync",
  "schemaVersion": 1,
  "messageType": "snapshot",
  "deviceId": "3f2f8a6e-…-uuid",
  "snapshotId": "4f1f2a91-…-uuid",
  "generatedAt": 1785600000000,
  "appVersion": "0.1.0",
  "protocolCapabilities": {
    "fullSnapshotV1": true,
    "proposalsV1": true
  },
  "cursor": null,
  "payload": { }
}
```

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `format` | string | 固定 `alerttime-teacher-sync`，严格校验 |
| `schemaVersion` | int | 固定 `1`；不支持其他版本，否则整批拒绝 |
| `messageType` | string | `pair`、`pairAck`、`unpairAck`、`snapshot`、`snapshotAck`、`proposal`、`proposalDecision`、`decisionAck` 之一 |
| `deviceId` | string | 跨设备稳定 ID，配对时由 TeacherAgent 生成（UUID） |
| `snapshotId` | string | 快照消息的幂等 ID（UUID）；`messageType` 非 snapshot 时可省略或为 `batchId` |
| `generatedAt` | int | 非负 epoch 毫秒 |
| `appVersion` | string? | 可选；发送端应用版本，非空且不超过 64 字符 |
| `protocolCapabilities` | object | 协议能力声明，第一版固定上述两个字段 |
| `cursor` | object/null | 分页游标；第一版只有 proposals 响应使用（proposalId） |
| `payload` | object | 消息体，按 `messageType` 解释 |

未知字段（来自未来版本）一律忽略；缺少必需字段、类型错误、结构非法、`format`/`schemaVersion` 不匹配一律整批拒绝。

## 4. 消息类型

### 4.1 snapshot（AlertTime → TeacherAgent）

`POST /v1/snapshots` 请求体。payload 上报白名单：

- `subjects`：科目（含软删除）。
- `weeklyGoals`：周目标（含软删除）。
- `tasks`：任务/计划（含软删除）。
- `studySessions`：学习会话（含软删除）。

**默认禁止上传**：diaries、appSettings、用户隐私资料、studySessionEvents 原始事件、本地路径、备份文件、通知状态、API Key、Provider 配置、计时器内存状态。

**会话笔记（note）隐私最小化**：`studySession.note` 是自由文本笔记，可能包含隐私内容，
周完成分析不需要它。协议字段保留为可选（向后兼容），但 AlertTime v1 客户端**默认不上传**
（发送时始终为 null）；如需上传必须提供显式用户开关且默认关闭，本版本未提供该开关，
因此 v1 永不发送 note。

实体规则：

- 每个实体必须有稳定 `remoteId`（UUID 字符串）。AlertTime 优先使用现有 `remote_id`；为空时在**单个 Room 只读事务内生成并持久化**；不得使用本地自增 id 作为跨设备 ID。
- DTO 外键全部使用 `remoteId`：`task.subjectRemoteId → subjects`、`studySession.subjectRemoteId → subjects`、`studySession.taskRemoteId → tasks`。外键引用不存在则整批拒绝。
- `subject` 可选字段 `examTrackId` / `examSubjectId` / `examModuleId`（考试体系声明，v1 扩展）：
  - 旧版手机端不发送这些字段时视为 null，TeacherAgent 必须兼容；
  - 字段非空时长度 ≤ 200、不能是空字符串，否则整批拒绝；
  - 这些字段只用于展示与映射建议，**不是**权威映射；TeacherAgent 仍以「用户映射表 + 精确别名匹配」解析手机端科目。
- `studySession` 可选字段 `aiHelpSeconds` / `aiHelpCount` / `externalAiAppSeconds` / `aiUsageSource`（AI 使用时间，v1 扩展）：
  - `aiHelpSeconds`：用户在 AlertTime 的 AI 求助时段内停留秒数（AI_HELP_STARTED → AI_HELP_ENDED）；
  - `aiHelpCount`：AI 求助会话次数；`externalAiAppSeconds`：外部 AI App（如 Gemini/ChatGPT）前台秒数，
    仅在用户授权 UsageStats 且配置目标 App 后统计，未授权为 null（unknown），不得写成 0；
  - `aiUsageSource`：`alerttime_ai_help` / `usage_stats` / `unknown`；
  - 旧版手机端不发送这些字段时使用默认值（0 / null / null），TeacherAgent 必须兼容并显示「未记录」，
    不得推断为「没有使用 AI」；AI 使用时间不得覆盖 `durationSeconds` / `focusScore` / `pauseSeconds`；
  - 字段必须非负；`aiUsageSource` 必须属于上述枚举，否则整批拒绝。
- `learningAnalysis` 是 `snapshot.payload` 的可选 v1 扩展。新版 AlertTime 每次同步均应生成；旧客户端未发送时
  TeacherAgent 必须接受快照，并将最新分析视为不存在，不得伪造 LLM 结果。该对象包含：
  - `analysisId`、`sourceSnapshotId`、`generatedAt`、`promptVersion`、`generator`；
    `sourceSnapshotId` 必须与信封 `snapshotId` 完全相同，`generator` 仅允许 `android_llm` 或
    `deterministic_fallback`。LLM 不可用、响应非法或超时时仍须使用确定性回退生成分析，并在 `warnings` 说明；
  - `profile.facts[]` 记录事实（`code`、`label`、任意 JSON `value`、`evidenceRefs`），同一分析内
    `fact.code` 必须唯一；`profile.inferences[]` 记录模型推断（`statement`、0..1 的 `confidence`、
    `evidenceRefs`）。事实与推断必须分离，推断不能伪装为已观察事实；
  - `inputSummary` 是可选的安全审计摘要，包含本次同一分析输入中实际纳入的科目、周目标、计划和已结束
    专注会话数量，以及固定 `source = same_analysis_input_v1`。它不包含正文、主键、remote UUID 或其他
    设备标识；存在时必须与当前 snapshot 中全部未软删除科目、周目标、计划和已结束会话的计数完全一致。
    旧版客户端缺失该字段时仍兼容读取；它不能替代原始快照，也不能被解释为今日计划或本周目标数量；
  - `planEvaluation` 包含 `verdict`（`reasonable` / `needs_adjustment` / `insufficient_data`）、
    必须出现但可为 null 的 0..100 `score`、各维度、风险与建议。数据不足时使用
    `insufficient_data`，不得仅凭学习时长推断掌握度；
  - `assessmentDraft.status` 固定为 `draft`；每题包含唯一 `questionId`、可选
    `subjectRemoteId` / `taskRemoteId`、`type`（`concept_check` / `diagnostic` / `reflection`）、
    `prompt`、`rationale`、`rubric[]`。非空引用必须指向同一 snapshot payload 中真实存在的
    `subjects.remoteId` / `tasks.remoteId`，不存在、跨快照或重复 `questionId` 均整批拒绝；
  - 题目的所有 JSON key 均按 ASCII 小写检查：key 包含 `answer`、包含 `solution`，或等于
    `explanation` 时立即拒绝；`Answer`、`finalAnswer`、`workedSolution` 等变体同样禁止。
    `prompt`、`rationale`、`rubric` 是允许的教学字段。分析和题目草稿只作为
    本地只读建议保存，**不得**写入或更新 mastery / 学生画像主表，不得进入 approved 题库，且不得写入
    `assessment_results`。只有用户对 approved 题库真实作答后产生的评估证据才能更新掌握度。
  - Android 发送给自带 Provider 的最小上下文包含同步白名单内全部未软删除科目、周目标、计划和已结束专注会话，
    并显式附带手机本地日期、周起始日和 `zoneId`；`timeScope` 与聚合字段用于区分今日/本周/历史范围，
    不能把历史记录从输入中静默删除。模型只看到 `sourceTaskIndex`，不得接触或决定 remoteId；
    手机按本次快照内的任务索引映射回真实 `taskRemoteId` / `subjectRemoteId`，非法或游离索引触发确定性回退。
  - `evidenceRefs`、维度摘要、风险、建议、范围摘要、题目理由、rubric 项与 warning 项均不得为空白字符串；
    Rust 接收端、Android 发送端、JSON Schema 和桌面展示投影使用同一语义，避免“已接收但不可展示”。
  - `evidenceRefs` 必须可绑定到当前快照：允许固定聚合证据 `scope:today`、`scope:current_week`、
    `scope:historical`、`session_summary:today`、`session_summary:all`，允许用户设置证据
    `user_setting:purpose`、`user_setting:examName`、
    `user_setting:focusSubjects`、`user_setting:targetDate`；其余值必须是当前快照中的科目、周目标、任务、
    会话 remoteId，或 `task:<当前快照任务 remoteId>`。未知、跨快照或伪造引用整批拒绝；读取历史缓存时
    也必须重做同一语义校验，失效分析只丢弃自身，不得拖垮其余只读模型。
- 字段语义与 AlertTime `docs/DATABASE.md` 一致：
  - 任务 `type`：0 待办 / 1 计划 / 2 便签；`status`：0 未完成 / 1 已完成 / 2 已归档。
  - 周目标 `status`：0 待完成 / 1 已完成 / 2 已延期 / 3 已取消。
  - 会话 `status`：0 已完成 / 1 进行中 / 2 已取消 / 3 异常结束。**进行中的会话可展示，但不得算作已完成会话**。
- `weeklyGoal.sourceProposalId` 与 `task.sourceProposalId` 是可选 nullable 字段：
  - 仅表示手机端用户明确点击「采纳」后、在同一 Room 事务中创建该实体时记录的来源 proposal ID；必须使用现有 ID 约束（长度 8..64，字符仅限 ASCII 字母、数字、`-`、`_`）。
  - 手工创建的周目标/任务必须发送 `null` 或省略字段；字段不表示 Teacher 自动采纳，也不能单独作为完成率、掌握度或其他学习效果证据。
  - TeacherAgent 导入快照时不得查询本地 proposal 是否存在、是否已 accepted，也不得因为暂时找不到 proposal 拒绝整个手机快照；后续执行效果只能由 TeacherAgent 在同一设备的 accepted proposal 与最新快照实体结构一致后计算。
  - 旧版快照缺少字段时按 `null` 处理并继续读取；TeacherAgent 不得为旧数据猜测来源 proposal。
- 校验规则：`format`/`schemaVersion`/`messageType`/`deviceId`/`snapshotId`；`generatedAt` 必须非负；可选 `appVersion` 必须非空且不超过 64 字符；四个集合存在且数量不超过上限（subjects ≤ 5000、weeklyGoals ≤ 50000、tasks ≤ 100000、sessions ≤ 200000）；数值非负；`endTime ≥ startTime`；`focusScore ∈ [0, 100]`；枚举值受支持；字符串长度有上限（标题 ≤ 200、备注 ≤ 20000）。
- 请求体字节上限 8 MiB，超限拒绝（413）。
- 幂等：`snapshotId` 已存在时返回 `snapshotAck(accepted=true)` 且**不重复导入**；此时 `entityCounts` 回传该快照已存储的计数（与重发方内容一致），客户端可照常校验 ack 计数。
- 数据非法时整批拒绝，不写任何行。

`POST /v1/snapshots` 响应：

```json
{
  "format": "alerttime-teacher-sync",
  "schemaVersion": 1,
  "messageType": "snapshotAck",
  "deviceId": "…",
  "snapshotId": "…",
  "generatedAt": 1785600000000,
  "appVersion": "0.1.0",
  "protocolCapabilities": { "fullSnapshotV1": true, "proposalsV1": true },
  "cursor": null,
  "payload": {
    "accepted": true,
    "receivedAt": 1785600000000,
    "entityCounts": { "subjects": 2, "weeklyGoals": 3, "tasks": 4, "studySessions": 5 }
  }
}
```

`snapshotAck` 信封中的 `snapshotId` 必须回显请求中的 `snapshotId`，手机端据此关联确认。

### 4.2 proposal（TeacherAgent → AlertTime）

`GET /v1/proposals` 返回 `messageType=proposal` 的响应信封；其 `payload` 是
`ProposalsList`，不是单条 `Proposal`。`Proposal` 只表示列表中的一个建议稿对象，
两者在 schema 中分别对应 `proposal` 与 `proposalsList` 定义。

```json
{
  "format": "alerttime-teacher-sync",
  "schemaVersion": 1,
  "messageType": "proposal",
  "deviceId": "…device uuid…",
  "generatedAt": 1785600000000,
  "appVersion": "0.1.0",
  "protocolCapabilities": { "fullSnapshotV1": true, "proposalsV1": true },
  "cursor": null,
  "payload": {
    "proposals": [
      {
        "proposalId": "…uuid…",
        "deviceId": "…device uuid…",
        "version": 1,
        "status": "pending",
        "rationale": "本周英语投入 3.2 小时但计划完成率 40%；诊断显示动词时态薄弱（2/5 正确）。建议下周聚焦时态专项练习。",
        "proposedWeeklyGoals": [
          { "weekStart": 1785600000000, "title": "完成时态专项 10 题", "successCriteria": "正确率 ≥ 80%" }
        ],
        "proposedTasks": [
          {
            "title": "复习一般现在时与现在完成时",
            "subjectRemoteId": "…subject uuid…",
            "targetDurationSeconds": 1800,
            "dueAt": null
          }
        ],
        "sourceAssessmentIds": ["…assessment uuid…"],
        "createdAt": 1785600000000,
        "expiresAt": null
      }
    ],
    "nextCursor": "…last proposalId…"
  }
}
```

- `status`：`pending` / `accepted` / `rejected` / `superseded`。
- `proposedTasks[].subjectRemoteId` 引用快照中的科目 remoteId；TeacherAgent 生成建议时必须引用已上报科目，否则手机端无法采纳。
- 手机端只展示，**不自动创建**；只有用户明确点击「采纳」才写库。

### 4.3 proposalDecision（AlertTime → TeacherAgent）

`POST /v1/proposal-decisions` 请求体：

```json
{
  "format": "alerttime-teacher-sync",
  "schemaVersion": 1,
  "messageType": "proposalDecision",
  "deviceId": "…",
  "generatedAt": 1785600000000,
  "appVersion": "0.1.0",
  "protocolCapabilities": { "fullSnapshotV1": true, "proposalsV1": true },
  "cursor": null,
  "payload": {
    "proposalId": "…uuid…",
    "decision": "accepted",
    "decidedAt": 1785600000000
  }
}
```

- `decision`：`accepted` / `rejected`。
- 幂等：同一 `proposalId` 重复上报同一决策返回相同结果；已 accepted 后不可再 rejected（400）。
- 响应：`decisionAck`（payload：`{ proposalId, decision, recorded: true }`）。

## 5. 配对（QR 与设备凭据）

配对二维码内容（一行文本，禁止包含换行外的任意字符）：

```text
ta-sync://v1?host=192.168.1.5&port=8787&pin=<spki-sha256-hex>&token=<base64url-token>&expiresAt=<epoch_ms>&deviceId=<uuid>
```

- `host`：TeacherAgent 选择的私有局域网 IPv4。
- `pin`：服务证书 SPKI（SubjectPublicKeyInfo DER）的 SHA-256，hex 小写。
- `token`：一次性配对 token，高熵（≥ 32 字节随机数，base64url），短时有效（默认 10 分钟），只能使用一次。
- `expiresAt`：token 过期时间（epoch 毫秒）。
- `deviceId`：本次配对生成的设备 ID（UUID）。

配对流程：

1. 手机扫描二维码，展示配对信息（地址、过期时间），用户确认。
2. `POST /v1/pair`，body：`{ "token": "…", "deviceId": "…", "ownerIdentity": "<uuid>" }`；请求信封的
   `deviceId` 必须等于 payload 的 `deviceId`，`messageType` 必须为 `pair`。
   - `ownerIdentity`（可选，由手机端在安装期生成并持久化的稳定标识，跨重新配对保持不变）：
     用于把用户配置（如学科映射）归属到手机，使重新配对后配置不丢失。旧客户端可省略该字段。
3. TeacherAgent 校验 token（存在、未过期、未使用、deviceId 匹配），单事务内标记已使用，生成设备凭据（≥ 32 字节高熵随机串，base64url），只存 SHA-256 哈希，响应中下发明文一次。
4. 手机校验 `pairAck` 响应的 `deviceId` 与请求一致后，将设备凭据交给 Android Keystore 保护（AES 加密后密文可放 AppSetting，密钥不出 Keystore）。
5. 之后所有请求使用 `Authorization: Bearer <credential>`。

**token 与凭据的安全要求**：

- 配对 token 不得存入 AppSetting；明文只存在于配对响应的内存路径，日志必须脱敏。
- 设备凭据哈希使用 SHA-256 + 每设备随机盐。
- 撤销设备后旧凭据立即失效（服务端删除哈希并置 `revoked_at`）。
- 错误信息与日志中不得出现 token、凭据或证书私钥。

## 6. 数据所有权

| 数据 | 唯一权威来源 |
| --- | --- |
| 手机科目、周目标、任务、任务完成状态、学习会话、实际学习时长 | AlertTime |
| 周分析、诊断结果、掌握度、计划建议稿、建议理由、建议版本 | TeacherAgent |

- 禁止两端自由编辑同一实体。
- TeacherAgent 下发的是 proposal，不是 TaskEntity；不得直接修改手机已有任务。
- AlertTime 采纳 proposal 时：在**单个 Room 事务**中创建周目标与任务，并写入「已处理 proposalId」幂等标记（同一事务）；崩溃重试不重复创建；优先使用现有 AppSetting 保存非敏感幂等标记；配对 token 不得存入 AppSetting。
- 第一版不依赖 `sync_status` 筛选增量数据（完整业务快照），避免漏传未正确标脏的数据。

## 7. 学科映射与掌握度

- AlertTime 自定义科目不得静默映射到知识节点；用户必须在 TeacherAgent 显式选择映射学科。
- 学科映射归属到**手机稳定标识（ownerIdentity）**而非本次配对的 deviceId，使同一台手机重新配对后映射仍保留。
- 无映射的科目只参与执行情况分析，不参与掌握度更新。
- 掌握度只由 approved 题库的答题、诊断和明确评估证据驱动；学习时长只影响投入度判断；未答题不得更新 mastery。

## 8. 协议文件与 fixture

| 文件 | 说明 |
| --- | --- |
| `sync/protocol/protocol.md` | 本文件（两端逐字一致） |
| `sync/protocol/schema/alerttime-teacher-sync-v1.schema.json` | JSON Schema v1（两端逐字一致） |
| `sync/protocol/fixtures/*.json` | golden fixtures（两端逐字一致） |
| `sync/protocol/fixtures/SHA256SUMS` | fixture SHA-256 清单（两端逐字一致） |

fixture 清单：

| 文件 | 用途 |
| --- | --- |
| `snapshot-valid.json` | 合法完整快照：中文、特殊字符、nullable、未知字段、软删除行，以及带合法 `sourceProposalId` 的周目标/任务 |
| `snapshot-missing-field.json` | 缺少必需字段（拒绝） |
| `snapshot-unsupported-version.json` | schemaVersion=2（拒绝） |
| `snapshot-foreign-key-mismatch.json` | 外键引用不存在（拒绝） |
| `proposal-valid.json` | 合法建议稿 |
| `decision-valid.json` | 合法决策 |
| `pair-valid.json` | 合法配对请求 |

两端测试必须从各自仓库读取同一份 fixture，并校验 SHA-256 与 `SHA256SUMS` 一致；任何一侧修改 fixture 必须同步另一侧并重新生成 `SHA256SUMS`。
