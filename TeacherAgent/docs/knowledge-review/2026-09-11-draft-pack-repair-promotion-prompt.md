# 交给 Gemini 的 Prompt：知识包门禁修复与晋升

> 2026-09-11 实测快照。事实部分均为本机验证过，可直接采信；推测处已标注。

---

## 可直接粘贴的 Prompt

```
任务：修好并晋升 TeacherAgent 桌面端（仓库 <LOCAL_REPO>，**不要动 <REPO_ROOT>**）
处于 draft 的知识包。这是一个有治理规程的正式知识库，不是随手改数据。

【现状（已实测，可直接采信）】
- 包清单：data/knowledge/ 与 data/questions/ 各 51 个包 = 11 个 approved + 40 个 draft。
  draft 合计 631 个知识节点 / 643 道题，与 docs/knowledge-base-governance.md §11 的发布基线一致。
- 正式门禁（项目自己的，权威）：
  * src/data/dataIntegrity.test.ts —— 用 import.meta.glob 通配**全部** 51 个包，
    校验解析、ID 唯一、题目↔节点关联、来源字段、与 PACK_MANIFEST 一致；
  * src/services/knowledge/katexRenderGate.test.ts —— 严格 KaTeX 渲染 + 裸 TeX 检测，
    但它只覆盖常量 AUDITED_PACKS 里列出的包。
- 我把 AUDITED_PACKS 临时扩到 39 个候选包（40 个 draft 里排除 civil-common-sense）后跑出的结果：
  **21 项失败 / 150 项通过**，其中 13 个包未过渲染门禁：
    cs408-computer-organization(knowledge+questions)、cs408-data-structures(k+q)、
    cs408-operating-systems(questions)、english-cloze(knowledge)、english-grammar(knowledge)、
    english-reading(k+q)、english-translation(knowledge)、linear-algebra-expanded(knowledge)、
    physics-electromagnetism(k+q)、physics-mechanics(questions)、physics-modern(k+q)、
    physics-thermodynamics(questions)、physics-waves-optics(questions)
  ⇒ 其余 26 个候选包通过门禁。典型违规样本：
    「bare [\frac] in eng-grammar-005.content」（裸 LaTeX 未加 $...$）、
    「KaTeX error placeholder in output for: \lambda = \lambda_0√[\frac...」（公式渲染失败）。
  注意：那次运行里还有一个失败是元测试 "finds all 18 seed files (9 knowledge + 9 questions)"，
  它是断言审计集为 18 个文件，扩集后必须同步改，不是内容缺陷。
  我已把该测试文件还原（保持仓库测试为绿），你需要重新施加扩展。

【必须遵守的治理规则】
- docs/knowledge-base-governance.md §4.3：审核至少检查 学科内容准确 / 前置关系合理 /
  常见误区真实 / 提示不泄露答案 / 难度标注合理 / 来源与许可证字段完整。
- **civil-common-sense 不得晋升**：§4.3 与 docs/civil-service-governance.md §9 明确要求，
  考公常识判断类内容升为 approved 前必须补充权威来源或人工复核记录。本次保留为 draft。
- §11：draft 默认不启用、不进入正式检索、不计入正式统计；approved 才可进入正式知识库。
- **不要为了让测试通过而放宽门禁**（不许改断言、不许把严格级别降级、不许删检查项）。
  失败要修内容，或者把该包留在 draft 并写明原因。

【参考先例（照它们的格式与口径做）】
- 准入记录：docs/knowledge-review/2026-07-27-approved-pack-promotion.md
  （它明确声明"这不是外部独立学科专家认证"，是负责人授权的代理内容审核——保持这个诚实口径）
- 内容修复：docs/knowledge-review/2026-07-26-draft-pack-correction.md、
  docs/knowledge-review/2026-07-26-math-cs408-content-repair.md

【要做的事】
1. 把 katexRenderGate.test.ts 的 AUDITED_PACKS 扩到那 39 个候选包（排除 civil-common-sense），
   并同步修正 "finds all 18 seed files" 这类计数型元测试。
2. 修 13 个失败包的公式缺陷：裸 LaTeX 包上 $...$ 或 $$...$$、修复渲染失败的公式
   （例如上面那个 \lambda_0√[\frac 样本）。改完反复跑门禁直到这些包全部通过；
   确实修不好的包留在 draft 并在记录里写明。
3. 跑全量验证并留证据：
   - npm test（前端 71 文件 / 1341 项，当前全绿；扩集后应仍全绿）
   - 门禁单文件复跑命令：npx vitest run src/services/knowledge/katexRenderGate.test.ts
4. 对通过门禁的包做晋升：
   - 数据侧：data/knowledge/*.seed.json 与 data/questions/*.seed.json 的 status 由 draft 改 approved；
   - 清单/注册表：找到驱动 ApprovedManifestRegistry 的 PACK_MANIFEST
     （src/services/knowledge/packManifest.ts，被 dataIntegrity.test.ts 引用）并同步；
     若 Rust 侧有嵌入的 approved 种子派生逻辑（见先例记录的"ApprovedManifestRegistry 从嵌入的
     11 个 approved knowledge seed 派生"），一并同步并跑 cargo test --lib（当前 342 通过）。
5. 写准入记录 docs/knowledge-review/2026-09-11-<简述>.md：范围、逐包门禁结果、
   晋升数量、明确保留 draft 的包与理由（含 civil-common-sense）、
   并保留"负责人授权代理审核、非外部专家认证"的声明。
6. 影响告知（写进记录，不要擅自改论文）：
   - 论文里的正式口径将从 11 Pack / 145 节点 / 123 题变为新值；
   - 检索语料需按新的 approved 集合重新生成向量（当前 268 条 = 145 节点 + 123 题），
     否则桌面端稠密通道覆盖不到新晋升内容。

【硬性约束】
- 不 git commit / push，改动留 working tree。
- 用 PowerShell（该工程在 Windows 上 Bash 启动不可靠）。
- 不要动 <REPO_ROOT> 主目录。
- 不要用 <LOCAL_REPO>\scripts\review_knowledge_packs.py ——
  那是早前临时写的正则脚本，**有误报**（它标记的节点复检命中为 0），一律以 vitest 门禁为准。

【交付】
1. 逐包门禁结果表（39 个候选：通过/修复后通过/仍失败并保留 draft）；
2. 改动清单（哪些 seed 的状态/公式被改，清单与注册表怎么改）；
3. `npm test` 与 `cargo test --lib` 的实测结果；
4. 准入记录文件路径；
5. 未解决项与风险（含向量未重算这一条）。
```

---

## 附：本机已核实的坐标（供 prompt 校验）

| 项 | 值 |
|:--|:--|
| 包总数 | 51 = 11 approved + 40 draft（`data/knowledge` 与 `data/questions` 对称） |
| draft 规模 | 631 节点 / 643 题（与治理文档 §11 发布基线一致） |
| 正式门禁 | `src/data/dataIntegrity.test.ts`（通配全部包）、`src/services/knowledge/katexRenderGate.test.ts`（仅 `AUDITED_PACKS`） |
| 门禁原覆盖 | 9 个包（= 2026-07-27 晋升的那批） |
| 扩展后结果 | 39 个候选 → 21 项失败 / 150 通过；**13 个包未过**，26 个通过 |
| 计数型元测试 | `finds all 18 seed files (9 knowledge + 9 questions)`，扩集后须同步 |
| 当前基线 | `npm test` 71 文件 / 1341 项全绿；`cargo test --lib` 342 通过 |
| 禁晋升包 | `civil-common-sense`（§4.3 + `docs/civil-service-governance.md` §9） |
