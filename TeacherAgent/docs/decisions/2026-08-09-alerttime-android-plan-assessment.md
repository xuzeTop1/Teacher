# ADR: AlertTime Android 计划评估与学习分析展示

## 状态

已接受，2026-08-09。

## 背景

AlertTime 用户不一定能随时与桌面端处于同一私有局域网。产品需要让用户先在手机独立生成并保存用户画像、计划执行评估和评估题草稿，之后连接 TeacherAgent 时再随新快照上传，同时保持本地优先、最小上下文和掌握度证据边界。

## 决策

1. `learningAnalysis` 是快照的可选扩展。桌面端只有在 `sourceSnapshotId` 与当前快照 ID 严格相等、字段枚举和范围均通过校验时才展示；否则按无分析处理。
2. 分析明确分成“手机同步事实”和“模型推断”。事实必须带 `evidenceRefs`；推断必须带 0..1 置信度和证据引用。计划评估单独展示 verdict、分数、维度、风险和建议。
3. `assessmentDraft.status` 固定为 `draft`。草稿题没有答案/解答字段，桌面端只读展示并明确“不计入掌握度”，不得调用 `saveAssessmentResult`、写入 `student_knowledge`，也不得混入 approved 题库诊断链路。掌握度只由真实 approved 题库答题产生。
4. Android 端在独立“学习分析与模型设置”中只接受用户自行填写的 OpenAI-compatible Base URL、模型和 API Key；应用不提供默认 Provider、默认模型或开发者公共 Key。API Key 只能进入 Android Keystore 保护的存储。
5. 用户可自行填写学习目的、考试/项目名称、考试或重点科目与目标日期。这些字段默认留空，只在用户主动生成或同步时作为 `<plan_data>.learnerContext` 写入版本化 Prompt；不得猜测缺失字段。请求仍只携带本次评估所需的最小计划与聚合执行数据。
6. 手机独立生成不检查 Teacher 配对、不访问桌面服务，结果先持久化在本机。每次实际同步仍生成绑定新 `snapshotId` 的分析，并在第一个桌面网络请求之前覆盖保存“最近分析”；桌面不可达不应导致已生成结果丢失。
7. 未配置、请求失败或响应不符合契约时必须生成并保存 `deterministic_fallback`。最近分析是可重新生成的派生缓存，不进入备份 JSON；用户填写的学习目标是普通本地设置，可随明文备份迁移。Provider 配置与 Key 不进入备份。
8. 该能力是对旧“移动端不做 LLM”范围的用户授权覆盖，仅限学习分析生成，不扩展为账号、云端画像或自动改写计划。云端数据库、公网同步和后台上传留待后续单独决策；数据所有权仍归用户，桌面端只保存收到的同步快照和分析。

## 非目标

- 不把学习时长直接转为掌握度或诊断证据。
- 不自动采纳计划、不自动创建手机任务。
- 不上传完整历史、API Key、配对 token 或无关隐私上下文。
- 不实现云端账号、多设备云同步、冲突合并或远程学生画像。
- 不实现云端数据库、后台定时分析或后台自动上传。
- 不让模型生成的题目进入 approved 题库或正式 `assessment_results`。

## 验收

- 旧版无 `learningAnalysis` 的快照仍能展示周报告。
- 合法分析能按四个区块展示：手机事实、模型推断、计划合理性、自评题草稿，并显示 generator、promptVersion、warnings 和 evidence。
- sourceSnapshotId 不匹配、非法枚举/分数/置信度、非 draft 或含 answer/solution 字段的 payload 不展示。
- Android LLM 成功与失败各有可验证路径；失败路径仍产生 deterministic fallback，且同步协议字段完整。
- 未配对且桌面离线时，用户仍可在手机保存学习目的/考试科目、生成并在进程重启后查看最近分析。
- 新安装时 Provider Base URL、模型和学习场景字段均为空；只有用户主动保存后才可调用其 Provider。
- 同步在桌面连接失败前已经保存本次新分析；稍后重试会生成新的 `analysisId` 和 `sourceSnapshotId`。
- 自评题展示链路不调用掌握度/assessment 写入命令；既有 approved 诊断链路保持不变。
