# ADR：AlertTime 单手机局域网同步扩展（可选项）

日期：2026-08-03
状态：decided（本分支内生效）
范围：`codex/alerttime-json-integration` + `codex/teacheragent-json-integration`

## 背景

TeacherAgent 当前把「移动端」和「多端同步」列为非目标（`AGENTS.md` 当前非目标、`mvp-spec.md` 明确不做、`project-governance.md` 范围外）。用户本次明确授权一个新的可选范围：与 Android 端 AlertTime 在家庭 WiFi 或手机热点上进行单手机、单教师、手动触发的局域网同步闭环。

该扩展必须：

- 不改变 TeacherAgent 桌面优先、本地优先的产品原则；
- 不把 AlertTime 变成云端服务，不引入账号体系；
- 保持现有备份协议（`alerttime-backup`）与同步协议（`alerttime-teacher-sync`）完全分离；
- 不修改 AlertTime 现有 A+B 合并恢复规则；
- 不宣称支持公网多端同步。

## 决策

1. 新增可选的「AlertTime 同步」扩展，默认关闭，用户主动开启。
2. 同步服务位于 Tauri Rust 后端（局域网 HTTPS，axum + rustls），Vue 前端只通过 Tauri command 与显式 DTO 交互；禁止 Vue 组件监听端口、直连 SQLite、保存配对 token 或处理证书私钥。
3. 数据所有权分离：
   - AlertTime 是科目、周目标、任务、任务完成状态、学习会话、实际学习时长的唯一权威来源；
   - TeacherAgent 是周分析、诊断结果、掌握度、计划建议稿、建议理由、建议版本的唯一权威来源。
   - TeacherAgent 只下发 proposal（建议稿），绝不直接写入手机已有计划；手机用户明确点击「采纳」后，才在单个 Room 事务中创建周目标与任务。
4. 同步协议独立于备份协议：`format = "alerttime-teacher-sync"`、`schemaVersion = 1`。协议说明、JSON Schema、golden fixtures 与 fixture SHA-256 在两个仓库各保存一份；两端测试读取同一版本的 fixture，防协议漂移。
5. 第一版采用完整业务快照（非增量）：AlertTime 在单个 Room 只读事务中生成一致快照；实体以现有 `remote_id` 作为跨设备稳定 UUID，为空时在事务内生成并持久化；DTO 外键全部使用 `remote_id`。TeacherAgent 完整验证后在单个 SQLite 事务中更新该设备的读模型，`snapshotId` 重放幂等，数据非法整批拒绝。
6. 传输安全：局域网 HTTPS + 自签证书（SPKI SHA-256 pin）+ 一次性高熵配对 token（短时有效、只能使用一次）+ 配对成功后换发长随机设备凭据。TeacherAgent 侧 TLS 私钥存系统 keychain；Android 侧设备凭据由 Android Keystore 保护。支持撤销设备，撤销后旧凭据立即失效。
7. 掌握度只由答题、诊断和明确评估证据驱动（沿用现有 `assessment_results` + `student_knowledge` 链路，只使用 approved 题库）；学习时长只影响投入度判断，不得直接更新掌握度；未答题不得更新 mastery。不绕过 GuardrailAgent。
8. 学科映射必须由用户显式确认；AlertTime 自定义科目不得静默映射到知识节点。无映射时只分析执行情况，不更新掌握度。
9. 建议稿由 PlannerAgent 在主动规划/诊断完成/阶段完成时触发生成，只生成 proposal，不直接修改手机数据。
10. 网络与 UI 文案必须说明：学校、公司和公共 WiFi 可能存在 AP isolation、VLAN 或防火墙限制，局域网同步不能宣传为任意网络下均可使用。

## 替代方案

- **复用现有备份协议与 BackupRepository 合并逻辑**：拒绝。备份是「同设备本地恢复」语义，同步是「跨设备按数据所有权交换」语义；混用会破坏 A+B 合并恢复规则与数据所有权边界。
- **公网云服务（Spring Boot/PostgreSQL）**：超出本阶段范围，列入后续建议但不实现。
- **通用 CRDT / 增量同步**：第一版不引入；完整业务快照 + 幂等重放更简单可验证。
- **前端直接监听端口**：违反现有五层架构边界与安全治理（密钥、证书、鉴权必须留在 Rust）。

## 影响

- `docs/open-decisions.md` 追加决策记录（D-401）。
- `docs/project-governance.md`、`docs/design.md`、`docs/mvp-spec.md`、`docs/data-model.md` 同步更新，标明这是可选单手机局域网同步扩展。
- TeacherAgent 新增 Rust 同步模块、SQLite 读模型表与 Tauri command；AlertTime 新增同步协议模块、SyncCoordinator 与「Teacher 同步」UI。
- 不改 Room schema（本阶段使用 AppSetting 保存非敏感幂等标记与 proposal 列表）；配对 token 不落盘；若未来必须升级 Room schema，必须提供 Migration + MigrationTest 并保证 databaseVersion=4 备份仍可恢复。

## 后续验证

- 双端协议测试：fixture 一致、中文/特殊字符、nullable、未知字段兼容、缺字段拒绝、不支持版本拒绝、外键错误拒绝、超限拒绝、snapshotId 重放幂等、proposal 重复采纳不重复、token 不出现在日志和错误信息中。
- TeacherAgent：`npm run test -- --maxWorkers=1`、`npm run build`、`cargo fmt --check`、`cargo test`（基线允许时 `cargo clippy --all-targets -- -D warnings`）。
- AlertTime：`.\gradlew.bat testDebugUnitTest`、`lintDebug`、`assembleDebug assembleDebugAndroidTest`；设备在线时 `connectedDebugAndroidTest`。
- 实机验收：扫码配对 → 上报 → 周报告一致 → 连续两次同步无重复 → approved 题诊断 → 仅答题更新 mastery → proposal 生成 → 手机采纳恰好创建一次 → 拒绝不创建 → 撤销设备后旧凭据失效。

### GET /v1/proposals 分页游标错误语义

- 不带 `cursor` 参数表示首页。
- 显式提供空字符串或仅空白字符、找不到的游标，以及属于其他设备的游标，均返回 HTTP 400，结构化 `code = "invalid_cursor"`；响应不泄漏游标、数据库或设备归属信息。
- 数据库、锁或查询执行异常仍返回 HTTP 500、`code = "internal"`。
- 合法游标继续使用 `(created_at DESC, id DESC)` keyset 分页；同一毫秒内不会漏项或重复项。
