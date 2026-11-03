# 两个 Prompt：civil-common-sense 的 A+D 交错落地 / 私有资料库修复

> 2026-09-11。事实部分均为本机实测，可直接采信。

---

## Prompt 1：A+D 交错实现（拆包）

```
任务：把 TeacherAgent 的 civil-common-sense 包按“角色分离 + 范围索引”交错落地。
仓库 <REPO_ROOT>-alerttime-json（不要动 <REPO_ROOT>）。

【为什么必须拆包，而不是在一个包里混】
- packValidator 把**包级** status 定为强制契约：必须与 src/services/knowledge/packManifest.ts
  的 PACK_MANIFEST 一致；ApprovedManifestRegistry 也从 approved 的知识种子文件派生。
  ⇒ 审批粒度是“包”，同一包内混 approved 范围节点 + draft 事实节点**不被现行机制支持**。
- 节点级 review_status 只在 src-tauri/src/assessment.rs 的 UPSERT 里用于保护已批准内容
  不被重新播种覆盖，不是准入或检索的过滤条件。

【现状事实】
- data/knowledge/civil-common-sense.seed.json 与 data/questions/civil-common-sense.seed.json：
  status=draft，5 个节点（政治与制度/法律基础/经济基础/科技与生活/人文历史）+ 4 道题。
- 来源是 国家公务员局《2026 年度考试录用公务员公共科目笔试考试大纲》URL，
  sourceType=ai_draft，sourceCategory=official_syllabus_reference。
- 治理规则 docs/knowledge-base-governance.md §4.3 与 docs/civil-service-governance.md §9：
  **考试大纲只能作为范围来源，不能作为事实来源**；事实性内容升 approved 前必须补权威来源
  或留人工复核记录。
- 该大纲**已经在系统里作为私有资料库存在**（private_documents 里的 考研政治.pdf、
  2024考研数学一大纲 等，共 50 片段，走 FTS 倒排通道，正文不出本机）——即“大纲=资料库”
  这件事无需再实现，只需在文档里点明。

【要做的事】
1. 拆成两个包（id 自拟，建议 scope 用 civil-common-sense-scope）：
   a. **范围包（新增，status=approved）**：节点表述改为“考查范围/题型/分值”这类
      **由大纲直接支撑**的内容，例如「常识判断的考查范围与题型分布」「政治与制度的考查要点范围」。
      来源字段填大纲本身（sourceType 用表明“官方大纲”的既有取值，sourceCategory=
      official_syllabus_reference），source.note 写明“本条为官方大纲所载考查范围，非事实断言”。
      **不得**在这类节点里保留法条/政策/科技事实断言。
   b. **事实包（沿用或新建，status=draft）**：承载需要事实来源的内容（法条、政策表述、科技事实），
      保持 draft，并在 source.note 保留 §9 要求的前置条件说明：
      “升 approved 前须补充权威来源（法条引用/官方统计/教科书）或由具备该领域知识的审核人
      逐条复核并在 source.note 记录审核人、日期、结论”。
2. 同步更新：PACK_MANIFEST（packManifest.ts）新增范围包条目；
   data/questions 侧对应题包；若 questions 也要拆，保持两侧 status 一致（packValidator 会校验）。
3. 跑门禁与回归，全部要绿：
   - npx vitest run src/services/knowledge/katexRenderGate.test.ts src/services/knowledge/packValidator.test.ts src/data/dataIntegrity.test.ts src/services/knowledge/manifestCountVerification.test.ts
   - npm test
   - cargo test --lib（当前 342 通过）
   注意：katexRenderGate.test.ts 的 AUDITED_PACKS 与 manifestCountVerification 里的计数断言
   需要按新包集合同步（此前的计数型元测试在扩集时必然要改，属预期）。
4. 更新文档（照既有格式）：
   - docs/knowledge-review/ 下新增本次拆包与范围包准入记录，声明性质为
     “负责人授权的代理内容审核，非外部独立学科专家认证”；
   - docs/knowledge-base-governance.md §11.2 发布基线表更新；
   - docs/project-status.md 同步。
5. 影响告知（写进记录，不要擅自改论文）：
   - 论文里的正式口径会从 50 Pack / 771 知识点 / 762 题变为新值（范围包节点为纯新增）；
   - 新 approved 节点需要重新生成 embedding（当前库内向量仍为 268 条，正式集合口径 1 533 条），
     重建前新内容不可被稠密通道检索。

【硬性约束】
- 不 commit / 不 push，改动留 working tree。
- 不许为了让门禁通过而降低门禁等级或删检查项。
- 事实类内容**不得**因为“拆出去了”就悄悄标成 approved。
- 私有资料库的 50 个片段不要动（那是另一条通道）。

【交付】
1. 两个包的文件路径与逐节点归属（哪些是范围、哪些留事实）；
2. 门禁与全量测试的实测结果；
3. 文档更新清单；
4. 未解决项（尤其：事实包的来源补充仍未做、向量未重建）。
```

---

## Prompt 2：私有资料库修复

```
任务：修复 TeacherAgent 私有资料库（private_documents / private_document_chunks）里
已确认的两类数据质量问题。仓库 <REPO_ROOT>-alerttime-json（不要动 <REPO_ROOT>）。
数据库：<APPDATA>\Roaming\com.teacheragent.app\teacher_agent.sqlite3

【已确认的问题（实测）】
1. **标题未解码（mojibake）**
   id=privdoc-019f353b3e7d-42767e10 的 title 为：
     <4D6963726F736F667420576F7264202D2032303234BFBCD1D0CAFD1A7D1A7D2BBB4F3B8D9>
   （以实际库内字符串为准）。该串是十六进制转义：前半段是 ASCII「Microsoft Word - 2024」，
   后半段是 **GBK** 字节（考/研/数/学/一/大/纲），解码后应为
     Microsoft Word - 2024考研数学一大纲
2. **subject_code 错标**
   - 三篇 物理.pdf 中有一篇标成 math（应为 physics）
   - 考研政治.pdf 两篇分别标成 math 与 politics（都应为 politics）
   影响：检索的学科过滤（bm25_top_k 的 subject_code 条件）会失效。
3. 顺带核对是否存在**同一文件重复导入**（现有 7 篇里有同名多篇），若确为重复，
   在记录里说明并给出合并/保留建议（**先不要删**，只报告）。

【修复步骤】
1. **先快照**：拷贝一份 teacher_agent.sqlite3 到临时目录（含 WAL 时用 SQLite backup API，
   不要直接 cp 主文件）。记录修改前的行数与关键字段值。
2. **修数据**：
   - title：按“十六进制转义 → 字节 → 前半 ASCII + 后半 GBK”还原，写回 private_documents.title；
   - subject_code：按文件真实内容改正；若某篇内容与文件名不符，以**内容**为准并在记录里写明依据
     （可抽样 reading 该文档的 chunk 文本判断）。
3. **修导入路径（持久修复）**：定位 title/file_name 的生成处（很可能在
   src-tauri/src/private_doc.rs 的导入流程，或前端文件选择后传参处），确认它是否按错误编码
   解析了非 ASCII 文件名，修成按 UTF-8 解码；补一个针对非 ASCII 文件名的单测。
4. **验证**：
   - 重新查询 private_documents 确认 title/subject_code 正确；
   - FTS 倒排索引**无需重建**（该外部内容表只索引 text 与 heading，title/subject_code 不在其中，
     学科过滤是查询期 JOIN 条件）——但请实测一条按学科过滤的检索确认过滤生效；
   - npm test 与 cargo test --lib 回归；
   - 若应用有编辑文档科目的界面，优先用界面改并在记录里写明（比直接写库更安全）。

【硬性约束】
- 修改运行时库前必须快照；不得删除任何私有文档或片段（可以只报告重复）。
- 不 commit / 不 push；改动留 working tree。
- 不重建 FTS 索引、不触碰向量表（私有文档按设计不生成 embedding，这条边界不要破）。
- 若发现 title 的 mojibake 是**导入器系统性编码缺陷**（不止这一篇），修编码逻辑而不只是补数据。

【交付】
1. 修改前后对比表（id / title / subject_code）；实际解码结果与依据；
2. 导入路径是否有编码缺陷的结论与修法（含新增单测）；
3. 重复导入的核查结论（保留建议，不动数据）；
4. 回归测试结果与一条按学科过滤检索的实测输出；
5. 未解决项。
```
