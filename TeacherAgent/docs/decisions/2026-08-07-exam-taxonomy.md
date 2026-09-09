# ADR：考试体系（ExamTaxonomy）层级模型

日期：2026-08-07
状态：decided（本分支内生效）
范围：`codex/alerttime-json-integration` + `codex/teacheragent-json-integration`
权威说明：`docs/exam-taxonomy.md`；数据：`data/exam-taxonomy/catalog.json`

## 背景

AlertTime 手机端的科目/计划是用户自定义名称，TeacherAgent 需要在不破坏原始手机数据的前提下，把它们映射到可解释的考研考试体系，并让「今日真实计划」驱动出题。此前体系是平面学科码（`subject`），408 被当成一个学科而不是考试组，无法区分「408」整体与具体子科目，也无法支持其他考试组的同类问题。

## 决策

1. 建立数据驱动的考试体系目录 `data/exam-taxonomy/catalog.json`：EXAM_TRACK → SUBJECT → MODULE（可选），节点含 stableId / code / displayName / aliases / parentId / nodeType / status / questionScope / legacySubjectCode / source-license。分类规则只存在目录与 Registry 服务中，不散落在 UI 或 Prompt。
2. 只有叶子 SUBJECT / MODULE 可作为出题与掌握度范围；父级 EXAM_TRACK 只用于聚合、统计、导航与「综合复习」；不得把「408」本身作为题目的唯一归属。同名课程在不同考试组必须不同 stableId。
3. Registry 从目录与 PACK_MANIFEST 交叉校验加载（`src/engine/examTaxonomy/`）；题目归属由 pack → 叶子推导（`questionScope.ts`），approved 过滤 → 范围过滤 → 校验，fail-closed。
4. 今日计划驱动出题（`planScope.ts`）按五级优先级：显式选择 > 今日计划叶子 > 考试组需选择或综合复习 > 无计划提示 > 时长仅参考；不伪造依据、不随机归科。
5. 同步协议 subject 增加可选字段 examTrackId / examSubjectId / examModuleId：旧版手机端不发送（serde default / Kotlin null）完全兼容；非空长度 ≤ 200 且不能为空串。`sync_subjects` 与 `subject_mappings` 只加可选列（迁移 0009）。手机科目解析 = 用户映射表 + 精确别名匹配，手机声明字段只作建议；未映射保留 unresolved。
6. AlertTime 保持通用学习 App：不改 Room schema（databaseVersion=4 不变）；可选「考试体系标签」存 AppSetting（`exam_tag_` 前缀，不属 `sync_` 排除范围，可随备份保留），只影响同步上报与展示。

## 替代方案

- **在 seed JSON 中为每个题目加 examTrackId/subjectId**：51 个 pack 全量改数据、易漂移；放弃，改为由 Registry 按 pack 推导（「题目全部增加或推导出」满足推导语义）。
- **在 UI/Prompt 中硬编码 408 四门**：违反数据驱动原则；放弃。
- **让「408」继续当平面学科**：无法表达父级聚合与子科目独立语义；放弃。

## 影响

- 新增：catalog.json、registry/planScope/questionScope（前端）、迁移 0009、协议可选字段（双仓库）、AlertTime 标签存储与 DTO 字段。
- 兼容：旧快照/旧备份可读；映射旧值（如 cs408）保留并提示重新选择子科目；不删除、清空、重建用户数据库；不覆盖用户脏改动；不提交 Git。

## 后续验证

- 前端 `npm run test` / `npm run build`；Rust `cargo test`；AlertTime `testDebugUnitTest`、`lintDebug`、`assembleDebug`。
- 实机：同步 → 今日计划=计算机网络只出网络题；今日计划=408 要求选择或综合复习；映射修正/撤销；旧快照导入不报错。
