# TeacherAgent 待决策清单

版本：v1.2  
状态：开放决策池  
最后更新：2026-10-03
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

## 4.6 检索链路缺陷与排序（2026-09-11 新增）

背景：工作项 E 的检索质量评测（`experiments/hybrid_retrieval/`）暴露了倒排通道两处缺陷
与融合层一处排序偏置，详见 `docs/decisions/2026-09-11-hybrid-retrieval-optimization.md`。
其中"索引与主表脱节"已按 `0018_private_chunks_fts_rebuild.sql` 修复，以下两条改变
检索返回结果，待拍板。

| ID | 状态 | 决策问题 | 默认建议 | 影响文档 |
| --- | --- | --- | --- | --- |
| D-407 | decided | 【已实施 2026-09-11】无空格的自然问句（如"偏振光是什么意思"）应如何在倒排通道召回？现状是整串短语匹配，trigram 下等价于要求文档包含该整串，导致召回为空、混合检索静默退化为纯稠密（实测问句形态 BM25 Hit@3 仅 0.07，裸词形态 0.39） | 已按两步实施：三阶段召回 = OR 分词（原有）→ 剥离问句壳后的整串短语 → 3-gram OR 兜底（上限 32 窗口）。不引入分词依赖，保留"无 C++ 外部依赖"立论。接入 jieba-rs 真正分词留待后续版本。回归测试 `bm25_channel_recalls_question_form_query`、`trigram_fallback_recalls_when_phrase_misses`、`question_shell_stripping_keeps_core_term` | `docs/decisions/2026-09-11-hybrid-retrieval-optimization.md`, 论文 §4.2/§7.8 |
| D-408 | decided | 【已实施 2026-09-11】RRF 融合在并列分时按 id 字典序排序，`knowledge_node:`/`question:` 恒排在 `private_chunk:` 之前，导致私有文档片段被系统性压低（实测片段金标 MRR 由纯 BM25 的 0.962 降到融合后 0.635，Hit@3 不变） | 已实施：① 去掉 `K+1` 平坦兜底改用标准 RRF（未入榜记 0，双通道命中者自然优先）；② 并列破局改为**按名次奇偶交替**（奇数名次倒排优先、偶数名次稠密优先），以全序排序键实现，保证比较器传递；③ `retrieve_context` 增加每源保底槽位 `PER_SOURCE_FLOOR=2` 抗饿死；④ `eval.rs` 输出补齐 `rrfScore`/`bm25Rank`/`denseRank`。不做通道加权。回归测试 `tied_ranks_alternate_between_sources`、`source_quota_reserves_slots_for_each_source`、`rrf_fusion_matches_hand_computed_scores` | `docs/decisions/2026-09-11-hybrid-retrieval-optimization.md`, 论文 §4.2 |

## 4.7 学情回显与输出侧护栏（2026-09-22 新增）

背景：`experiments/privacy_egress/` 的 D 组用植入私有资料正文的越权指令 + 写死的"已服从"回复
测出：当学情数据**确实已随授权进入出站 payload** 时，把该数据原样回显给学生的回复
4/4 全部通过护栏（0 项违规），而 PII 形态与内部组件名两个阳性对照都能被拦。根因是
`GuardrailInput` 不含授权上下文，护栏在结构上无法判断"这条回复是否回显了学生数据"。
同轮已修掉一个真实缺陷：扣留私有资料时 `topic`/`notes` 仍带出文档标题（见 §7.1.2）。

| ID | 状态 | 决策问题 | 默认建议 | 影响文档 |
| --- | --- | --- | --- | --- |
| D-409 | decided | 学情数据回显要不要加一道确定性输出侧关卡？候选做法是把本轮**已授权注入的字符串集合**（画像字段值、私有资料正文）随 `GuardrailInput` 传给护栏，对回复做原文重叠检测 | **不加**（2026-09-22 定案）。① 回复不出设备：同步协议两个方向都不含对话消息——`SnapshotPayload` 只有 subjects / weekly_goals / tasks / study_sessions / learning_analysis / focus_aggregates，桌面→手机只有 `proposal`，其 `rationale` 由 `src/engine/sync/proposalPlanner.ts` **纯规则**生成，无 LLM 调用、不引用私有资料（见 `sync/protocol/protocol.md` §4.1/§4.2，`sync/server.rs` 仅 6 条路由）。② 出站那一跳已由默认拒绝覆盖。③ 输出侧过滤对"接收者即数据主体"的场景没有可保护对象，且**不可完备**（改写/概述/翻译可绕过子串检测），加上它会让文档与论文能声称一个并不成立的控制，比不加更糟。**更正记录**：本行初稿写作"对话会落 SQLite 并经局域网同步到手机"，该陈述与同步协议不符（协议不含消息），据此推出的"回显延长手机侧驻留"论据不成立，已于同日删除。若后续出现共享账号、家长查看，或新增对话导出/分享功能，本项须重新评估 | `docs/project-governance.md` §7.1.2, `experiments/privacy_egress/README.md` §五, 论文隐私小节 |
| D-410 | open | 真实模型的指令遵循率是否要测？D 组刻意把回复写死，未测任何模型会不会服从注入 | 若要测，需要用户自行配置 Provider 与 Key、固定 N 次重复、人工判读，且不进无头闸门；论文当前措辞已限定为"系统分层验证"，不含遵循率主张，故可按 deferred 处理 | `experiments/privacy_egress/README.md` §六 |

## 5. 目录与工程结构

### 2026-10-03 审计修复决定

| ID | 状态 | 决定 | 原因与边界 | 影响文档 |
| --- | --- | --- | --- | --- |
| D-410 | decided | 隐式同步专注聚合仅使用未撤销设备最近 24 小时内收到的数据 | 用户授权修复 R04 后采用保守接收时效，避免无限复用历史特征；不是对原始活动时间的质量认证；无有效数据时回退普通更新 | `docs/data-model.md`, `docs/project-governance.md` |
| D-411 | decided | 部分正确保留既有 delta 路径，不进入二元 FB-BKT，不增加正确次数 | 用户授权修复 R07 后消除与完全正确相同的观测；不在修复中扩展模型或重算历史记录 | `docs/data-model.md`, `docs/project-governance.md` |

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
