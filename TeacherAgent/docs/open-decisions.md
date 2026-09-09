# TeacherAgent 待决策清单

版本：v1.1  
状态：开放决策池  
最后更新：2026-08-09
适用对象：产品负责人、Codex、Claude Code、项目维护者

## 1. 用途

本文件集中记录尚未拍板、但会影响实现方向的产品和架构问题。其他文档不再散落“待用户确认”清单；若遇到需要用户决策的问题，统一追加到这里，并在相关文档中引用本文件。

决策状态：

- `open`：尚未决定。
- `proposed`：已有建议，等待确认。
- `decided`：已决定，需同步到相关规范。
- `deferred`：暂不处理。

## 2. Prompt 与教学风格

| ID | 状态 | 决策问题 | 默认建议 | 影响文档 |
| --- | --- | --- | --- | --- |
| D-001 | proposed | 默认导师风格是“温和大学助教”还是“严格考试教练”？ | 默认温和大学助教；考研冲刺时可切换严格教练 | `docs/prompt-governance.md` |
| D-002 | proposed | 英语类学科幽默程度默认是多少？ | `medium`，但只允许轻微诙谐，不牺牲准确性 | `docs/prompt-governance.md` |
| D-003 | open | 是否提供“冲刺讲解模式”开关？ | Phase 1 可先定义模式，Phase 2 做 UI 开关 | `docs/prompt-governance.md` |
| D-004 | open | 学生连续要求“直接给答案”时，最多妥协到哪一级？ | 默认到 L3；L4 需要显式进入复盘模式 | `docs/prompt-governance.md` |
| D-005 | proposed | 法学、会计、医学等高风险学科是否启用谨慎提示？ | 是；只在涉及现实决策、政策、准则时显示 | `docs/prompt-governance.md` |

## 3. Agent 与工具范围

| ID | 状态 | 决策问题 | 默认建议 | 影响文档 |
| --- | --- | --- | --- | --- |
| D-101 | deferred | `web_search` 是否 MVP 必须可用？ | MVP 不接入，只保留接口和隐私过滤 | `docs/tool-interface.md` |
| D-102 | decided | `code_runner` 首批支持哪些语言？ | Python 优先（独立 code-worker sidecar） | `docs/tool-interface.md` |
| D-111 | decided | code-worker 安全分类？ | Phase 1 = 教学护栏（guardrails），非安全沙箱。纯 Python wrapper 存在 CPython 级逃逸；在 OS 级隔离完成前，Release 无条件关闭，Debug 仅双重显式 opt-in 的可信开发模式可用，普通学生输入 fail-closed | `docs/code-worker.md`, `docs/tool-interface.md` |
| D-112 | open | 不受信 Python 代码采用哪种 OS 级隔离？ | 优先做 Windows Job Object + 受限令牌/网络与文件系统边界的可验证原型；若无法同时限制网络、文件、进程树、CPU、内存和输出，则维持 fail-closed，并评估 Wasmtime。当前 `memoryLimitMb` 输入明确拒绝，不保留未执行的假契约 | `docs/code-worker.md`, `docs/decisions/2026-07-30-security-hardening.md` |
| D-113 | open | Python sidecar 构建依赖如何做哈希锁定？ | 为 Windows x86_64 构建链生成可审阅的 hash lock，并让 build 脚本使用 `--require-hashes`；在完成前不得宣称 PyInstaller/pytest 供应链已完全可复现。已构建 sidecar 仍按发布 manifest 做 SHA-256 运行时校验 | `docs/code-worker.md`, `docs/document-worker.md` |
| D-103 | proposed | 是否允许 AI 生成原创题进入题库？ | 允许进入候选池；正式题库必须审核 | `docs/tool-interface.md` |
| D-104 | decided | 对话式评估引擎是否独立成 Agent？ | 归入 `AssessmentAgent`，包含 turn assessment 和 diagnostic assessment 两种模式 | `docs/agent-architecture.md` |
| D-105 | decided | MVP 是否每个 Agent 都独立调用 LLM？ | 否；保留 Agent 代码边界，但普通轮次合并为 1-2 次同步 LLM 调用，复杂轮次最多 3 次 | `docs/agent-architecture.md` |
| D-106 | decided | PlannerAgent 是否每轮默认触发？ | 否；只在目标设定、阶段完成、诊断完成或用户主动规划时触发 | `docs/agent-architecture.md` |
| D-107 | decided | Python 工具如何集成？ | 作为独立 sidecar 进程，通过 CLI + JSON 通信，不嵌入 Tauri 主进程 | `docs/document-worker.md` |
| D-108 | decided | 生产版 Python worker 如何分发？ | 随 Tauri 打包 PyInstaller exe sidecar，用户无需安装 Python；开发期保留 python -m 模式 | `docs/document-worker.md` |
| D-109 | decided | 私有文档解析结果存 SQLite 还是临时缓存？ | 已决定存 SQLite（`private_documents` + `private_document_chunks` 表，migration 0003），支持离线访问和后续 RAG | `docs/data-model.md`, `docs/document-worker.md` |
| D-110 | open | 私有题库是否允许用户导入真题？ | 允许导入但需版权责任提示：用户确认"我有权使用此资料"；TeacherAgent 不验证版权，不自动上传；解析结果标记为 `private_user_import` | `docs/knowledge-base-governance.md` |

## 4. 知识库与版权

| ID | 状态 | 决策问题 | 默认建议 | 影响文档 |
| --- | --- | --- | --- | --- |
| D-201 | decided | 本地知识库是否允许爬虫采集？ | 不以野爬为主；只使用明确授权的 OER、原创内容或人工审核资料；禁止导入版权不明内容 | `docs/knowledge-base-governance.md` |
| D-202 | proposed | 第一批知识库从哪个学科开始？ | 数学，优先高等数学“极限与连续” | `docs/mvp-spec.md`, `docs/knowledge-base-governance.md` |
| D-203 | decided | 题库来源优先级如何排序？ | 原创审核题 > OER 题 > 用户自建题；版权不明内容禁止入库 | `docs/knowledge-base-governance.md` |

## 4.5 局域网同步扩展（2026-08-03 新增）

| ID | 状态 | 决策问题 | 默认建议 | 影响文档 |
| --- | --- | --- | --- | --- |
| D-401 | decided | 是否新增 AlertTime 单手机局域网同步扩展？ | 是；用户明确授权的可选范围。单 TeacherAgent + 单 Android 手机、手动「立即同步」、家庭 WiFi/手机热点、本地局域网 HTTPS、幂等快照上报与 proposal 建议稿下发；不是公网多端同步，不能宣传为任意网络可用 | `docs/decisions/2026-08-03-alerttime-lan-sync.md`, `docs/project-governance.md`, `docs/design.md`, `docs/mvp-spec.md`, `docs/data-model.md` |
| D-402 | decided | 同步协议与备份协议是否分离？ | 是；`alerttime-backup`（本地恢复）与 `alerttime-teacher-sync`（跨设备同步，schemaVersion=1）是两套独立协议，禁止互借；不得调用 BackupRepository.restore/merge 完成同步 | 同上 |
| D-403 | decided | 手机端执行数据如何影响掌握度？ | 学习时长只影响投入度判断；掌握度只由 approved 题库的答题、诊断和明确评估证据驱动；未答题不得更新 mastery | `docs/decisions/2026-08-03-alerttime-lan-sync.md`, `docs/data-model.md` |
| D-404 | decided | TeacherAgent 如何写入手机计划？ | 只下发 proposal（建议稿）；手机用户明确采纳后才在单个 Room 事务中创建；proposalId 幂等，崩溃重试不重复创建 | 同上 |
| D-405 | decided | 是否引入考试体系（ExamTaxonomy）层级模型？ | 是；数据驱动目录 `data/exam-taxonomy/catalog.json`（考试组→学科→模块，stableId/别名/状态/questionScope/来源许可），Registry 加载并与 PACK_MANIFEST 交叉校验；只有叶子 SUBJECT/MODULE 可出题，父级考试组只做聚合与综合复习；同名课程在不同考试组使用不同 stableId；同步协议 subject 增加可选 examTrackId/examSubjectId/examModuleId（旧版兼容）；手机科目按「用户映射表 + 精确别名匹配」解析，未映射保留 unresolved 不猜测 | `docs/exam-taxonomy.md`, `docs/data-model.md`, `docs/decisions/2026-08-07-exam-taxonomy.md` |
| D-406 | decided | 是否允许 AlertTime Android 调用 LLM 生成学习分析？ | 用户明确授权对“手机端不做 LLM”的窄范围覆盖：Provider 地址/模型/Key 全部由用户在 Android 独立设置中填写，不内置默认；手机在未配对、桌面离线时也可生成并本地保存 profile、planEvaluation 与无答案 assessmentDraft，稍后同步再生成绑定新 snapshotId 的分析。用户填写的学习目的、考试/项目、科目和目标日期进入版本化最小 Prompt；API Key Keystore，失败 deterministic_fallback。学习时长不更新 mastery，draft 不进入 approved/assessment_results/student_knowledge；Teacher 按 untrusted sync-side data 校验后只读展示。云端数据库、账号和后台上传留待后续决策；自动验证已完成，真实 Provider 与实机仍待验收 | `docs/decisions/2026-08-09-alerttime-android-plan-assessment.md`, `docs/project-governance.md`, `docs/prompt-governance.md`, `docs/data-model.md` |

## 5. 目录与工程结构

| ID | 状态 | 决策问题 | 默认建议 | 影响文档 |
| --- | --- | --- | --- | --- |
| D-301 | decided | 项目目录按 Agent 角色还是架构层组织？ | 以架构层为主，Agent/Prompt/Tool 放入对应层目录 | `docs/project-governance.md`, `docs/agent-architecture.md`, `docs/design.md` |
| D-302 | decided | MVP UI 组件库选择什么？ | 使用 Vuetify 3，并避免混用 Element Plus | `docs/project-governance.md`, `AGENTS.md`, `package.json` |

## 6. 决策记录流程

当某个问题从 `open` 或 `proposed` 变成 `decided`：

1. 更新本文件状态。
2. 将最终决定同步到受影响文档。
3. 如属于架构级或长期影响决策，在 `docs/decisions/` 下新增 ADR。
4. 如果影响代码结构，同步更新 `AGENTS.md` 和 `CLAUDE.md`。
