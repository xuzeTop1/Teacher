# TeacherAgent 知识库治理文档

版本：v1.1
状态：发布基线
最后更新：2026-07-19
适用对象：知识库维护者、Codex、Claude Code、内容审核者

## 1. 治理目标

TeacherAgent 的知识库必须准确、可追溯、可审核，并且避免版权风险。知识库不是随意爬来的网页集合，而是经过许可证检查、结构化整理和教学审核的学习资源。

核心原则：

- 不野爬商业教材、培训机构资料、付费题库和版权不明内容。
- 优先使用原创内容、明确开放授权资源和人工审核资料。
- 每个知识节点和题目必须保留来源与许可证字段。
- Web 内容不能自动进入正式知识库。
- AI 生成内容可以进入候选池，但正式入库前必须审核。

## 2. 允许来源

| 来源类型 | 是否允许入库 | 条件 |
| --- | --- | --- |
| 原创内容 | 允许 | 标记 `source_type=original` |
| 明确开放授权 OER | 允许 | 必须记录 license、url、attribution |
| 公共领域/CC0 | 允许 | 记录来源 |
| CC BY | 允许 | 必须署名 |
| CC BY-SA | 谨慎允许 | 衍生内容可能需要同协议共享 |
| CC BY-NC | 原型可用，商业谨慎 | 不进入商业发布知识库，除非确认商业限制 |
| 用户自建内容 | 允许本地使用 | 不上传、不共享，标记 user_content |
| 商业教材/题库 | 禁止默认入库 | 除非取得授权 |
| 培训机构讲义/解析 | 禁止默认入库 | 除非取得授权 |
| 网页爬虫内容 | 禁止自动入库 | 只能作为候选来源，需许可证检查和审核 |

## 3. 禁止行为

- 抓取商业教材、付费题库、培训机构课程内容后打包进产品。
- 把网页内容原文复制到知识库。
- 用“AI 改写”掩盖版权不明内容来源。
- 不记录来源 URL 和许可证。
- 把 NC 授权内容用于商业版本。
- 把用户上传题目上传到云端公共知识库。
- 把考试真题或解析直接入库而未确认授权。

## 4. 内容入库流程

```text
候选资料
  ↓
许可证检查
  ↓
内容抽取
  ↓
结构化重写
  ↓
教学审核
  ↓
质量测试
  ↓
正式入库
```

### 4.1 许可证检查

必须确认：

- 是否允许复制。
- 是否允许改编。
- 是否允许商业使用。
- 是否要求署名。
- 是否要求同协议共享。
- 是否有额外网站条款限制。

无法确认时，默认不得入库。

### 4.2 结构化重写

允许参考开放资源，但正式知识节点应写成 TeacherAgent 自己的教学结构：

- 概念摘要。
- 前置知识。
- 常见误区。
- 苏格拉底式提示。
- 例题或练习建议。
- 来源元数据。

不得大段复制原文。

### 4.3 教学审核

审核者至少检查：

- 数学/学科内容准确。
- 前置关系合理。
- 常见误区真实。
- 提示不会直接泄露答案。
- 难度标注合理。
- 来源和许可证字段完整。

## 5. 知识节点 schema

当前有效的 `subject` 值：`math`、`cs408`、`physics`、`english`、`politics`、`management`、`education`、`psychology`、`lawmaster`、`xingce`、`shenlun`。`law`、`accounting`、`programming` 为早期预留，尚未有正式 Pack。

考公（`xingce`/`shenlun`）常识判断类内容（`civil-common-sense`）当前为 `draft`，考试大纲只能作为范围来源，不能作为事实来源；升为 `approved` 前必须补充权威来源或人工复核记录。详见 `docs/civil-service-governance.md` §9。

建议 JSON seed：

```json
{
  "id": "math.limit.definition",
  "subject": "math",
  "course": "calculus",
  "title": "极限的直观定义",
  "summary": "极限描述自变量趋近某点时函数值趋近某个确定值的行为。",
  "level": "concept",
  "difficulty": 1,
  "prerequisites": [],
  "misconceptions": [
    "把极限值误认为函数在该点的函数值",
    "认为趋近必须等于"
  ],
  "socraticHints": [
    {
      "level": "L1",
      "text": "你先区分一下：x 趋近于 a，和 x 等于 a，是同一件事吗？"
    }
  ],
  "source": {
    "sourceTitle": "Original TeacherAgent seed",
    "sourceUrl": null,
    "sourceLicense": "original",
    "attributionRequired": false,
    "commercialUseAllowed": true,
    "derivedFromSource": false
  },
  "review": {
    "status": "approved",
    "reviewer": "project-owner",
    "reviewedAt": "2026-06-30"
  }
}
```

## 6. 题目 schema

```json
{
  "id": "math.limit.q001",
  "subject": "math",
  "knowledgeNodeIds": ["math.limit.definition"],
  "type": "solution",
  "difficulty": 1,
  "content": "判断 lim_{x→0} sin x / x 的类型，并说明为什么不能直接代入。",
  "answer": "这是 0/0 型不定式，不能只靠直接代入求值。",
  "solutionSteps": [
    "代入 x=0 时分子趋近 0，分母趋近 0。",
    "0/0 不是确定数值，需要使用等价无穷小、夹逼定理或其他方法。"
  ],
  "hints": [
    {
      "level": "L1",
      "text": "先看分子和分母分别趋近于什么。"
    }
  ],
  "source": {
    "sourceTitle": "Original TeacherAgent seed",
    "sourceLicense": "original",
    "commercialUseAllowed": true
  },
  "review": {
    "status": "approved"
  }
}
```

## 7. 来源字段要求

每个知识节点和题目必须有：

```ts
export interface ContentSourceMetadata {
  sourceTitle: string
  sourceUrl?: string
  sourceLicense: "original" | "CC0" | "CC BY 4.0" | "CC BY-SA 4.0" | "CC BY-NC 4.0" | "unknown"
  attributionRequired: boolean
  commercialUseAllowed: boolean
  derivativeAllowed: boolean
  shareAlikeRequired: boolean
  derivedFromSource: boolean
  reviewer?: string
  reviewedAt?: string
}
```

`unknown` 内容不得进入正式知识库。

## 8. 推荐开放资源方向

可优先评估：

- OpenStax。
- Open Textbook Library。
- LibreTexts。
- Wikipedia / Wikibooks，注意 CC BY-SA 要求。
- 大学公开课资料，必须核对许可证，尤其注意 NC 限制。

这些资源也不能默认整本导入；必须逐项检查许可证和网站条款。

## 9. MVP 种子计划

首批建议：

- 学科：数学。
- 课程：高等数学。
- 章节：极限与连续。
- 知识节点：30-50 个。
- 题目：10-20 道原创或明确授权题。
- 来源：优先原创 seed + OER 参考。

知识节点建议：

- 极限直观定义。
- 左极限和右极限。
- 极限存在条件。
- 无穷小。
- 无穷大。
- 等价无穷小。
- 夹逼定理。
- 连续定义。
- 间断点类型。
- 常见不定式。

## 10. Web Search 与知识库关系

`web_search` 只用于：

- 最新政策或考试信息。
- 查找开放资源来源。
- 核验技术文档。
- 回答本地知识库没有的临时问题。

`web_search` 不得：

- 自动写入正式知识库。
- 上传学生隐私。
- 把网页原文复制进知识节点。
- 替代教学审核。

## 11. 审核状态与运行时隔离

### 11.1 内容状态

- `draft`：草稿。默认不启用、不进入正式检索、不计入正式统计。
- `candidate`：候选，待审核。
- `approved`：已审核，可进入正式知识库。
- `rejected`：拒绝入库。
- `deprecated`：废弃。

### 11.2 运行时隔离契约

**发布基线（2026-09-11）**：

| 口径 | Pack 数 | 知识节点 | 题目 |
|------|---------|----------|------|
| **正式（approved）** | 51 | 773 | 764 |
| **待审核（draft）** | 1 | 5 | 4 |
| **总计** | 52 | 778 | 768 |

- 正式 Pack：51 个审核通过的 Pack（详见 `docs/knowledge-review/2026-09-11-approved-pack-promotion.md` 及 `docs/knowledge-review/2026-09-11-civil-common-sense-scope-promotion.md`）
- 待审核 Pack：仅 `civil-common-sense`（行测常识判断事实包，5 节点 / 4 题），不进入默认检索、不计入正式统计

**隔离规则**：

1. **默认 Seed**：只处理 approved Pack（`seedAllKnowledgeNodes`）。`packLoader` 使用 `loadApprovedKnowledgePacks()`，任一 approved pack 加载失败则 reject（fail-closed）。
2. **默认 Embedding**：只处理 approved Pack（`generateSeedEmbeddings`）。draft 内容不会被发送给 Provider 或存储向量。
3. **默认检索**：`packSelection` store 默认只启用 approved Pack。draft Pack 需用户显式启用。
4. **统计报告**：UI 使用 `getCatalogStatistics()` 同时显示 approved 和 draft 双口径。
5. **Manifest 契约**：`PACK_MANIFEST` 中 `status` 为必填字段，必须与 seed JSON 的 `status` 一致。缺失或不匹配时 `packValidator` 报错。
6. **Draft 维护入口**：如需 seed draft 内容，必须使用显式 `seedDraftKnowledgeNodes()` 函数，不会被普通启动或"正式内容同步"默认触发。
7. **不自动删除 draft 数据**：现有数据库中的 draft 节点不会被自动删除。
8. **localStorage 迁移**：旧格式（v1）中存储的 draft Pack ID 在迁移时被丢弃，不视为用户在新契约下的显式授权。
9. **Approved 内容完整性门禁**：`packValidator` 对 approved seed 的所有用户可见字符串执行保守的公式完整性检查，拦截连续反斜杠、数字被拆进分式、行内公式花括号不配对和分式括号跨边界。draft 不因该检查自动获得批准；迁移为 approved 后门禁立即生效。

## 11.3 审核授权契约（2026-09-19 补）

本节回答一个此前未定义的问题：**§4.3 要求的"审核者"可以是受委托的自动化审查吗，包级 `approved` 到底认证了什么。**

### 11.3.1 两级状态是两个不同的轴

| 轴 | 载体 | 取值 | 含义 |
|----|------|------|------|
| **包级发布状态** | seed JSON 顶层 `status`、`PACK_MANIFEST.status` | `draft` / `approved` | 是否通过**发布门禁**，可进入默认 Seed / Embedding / 检索 |
| **条目级事实复核** | 节点与题目内的 `reviewStatus`、`source.sourceType`、`source.note` | `draft` / `ai_draft` / 已复核 | 该条内容的**学科事实准确性**是否已被具领域知识的复核人确认 |

**两轴独立。包级 `approved` 不蕴含条目级事实复核已完成。** 因此一个 pack 可以同时出现
"顶层 `status: approved`" 与 "每条 `reviewStatus: draft`、`sourceType: ai_draft`、note 写着待人工复核"，
这不是数据不一致，而是两类审核分别处于不同状态。**不得**为了让两者看起来一致而批量改写条目级字段。

### 11.3.2 负责人可授权的代理审核及其边界

项目负责人可以把审核工作委托给自动化门禁与 AI 代理执行。此类委托审核**必须**在晋升记录开头声明性质，
措辞与 `docs/knowledge-review/2026-09-11-approved-pack-promotion.md:4` 一致：

> 审查性质：负责人授权的代理内容审核（非外部独立学科专家认证）

**代理审核可以认证**（这些是可判定、可回归的）：

1. 公式可渲染：`katexRenderGate` 严格模式，零警告零抛错。
2. 结构完整：`packValidator` 的 approved 高压线（连续反斜杠、数字被拆进分式、花括号/括号跨边界）。
3. 数据一致：`dataIntegrity`、`manifestCountVerification`，manifest 与 seed 的 status 和计数相符。
4. 来源标注齐备：每个节点与题目都有 `source` 的 title / license / sourceType / note，且 `license`
   取值落在 §7 枚举内；`unknown` 不得 approved。
5. 版权边界：内容为原创或明确开放授权，未复制商业教材、培训机构讲义、题库原文。

**代理审核不能认证**（这些必须由具领域知识的人完成，代理审核无权代签）：

1. 学科事实正确性——定义、定理、公式适用条件、史实、法条、政策表述是否准确。
2. 题目答案与解析的学术正确性，以及干扰项的教学合理性。
3. 时效性内容（时政、法律修订、考纲变化）的当前有效性。
4. 是否符合外部专家认证或机构审定的要求。

### 11.3.3 对表述的限制

因为 11.3.2 后半部分尚未系统完成，对外文档与论文中：

- **可以写**："通过 KaTeX 严格渲染门禁与包完整性校验""项目负责人授权的内容审核""原创撰写，逐条记录来源与许可"。
- **不得写**："经人工审核""经学科专家审核""内容准确性已复核"这类会让读者认为完成了 11.3.2 后半部分的表述。
- 若某 pack 的条目级事实复核确已完成，须把该条的 `reviewStatus` 与 `source.note` 更新为记录
  **审核人、日期、结论**（§4.3 与 `docs/civil-service-governance.md:170` 的要求），逐条生效，不做批量。

### 11.3.4 晋升记录必须入库

晋升记录是 catalog 可复现性的唯一依据，**不得只存在于未跟踪文件**。任何把 pack 从 `draft` 改为
`approved` 的变更，其对应记录必须与 seed、`PACK_MANIFEST` 在**同一提交**内，否则仓库的
approved catalog 无法从版本库重建。

## 12. 孤立节点清理规则

孤立节点指 DB 中存在但当前 `PACK_MANIFEST` 中未声明的知识节点。清理规则：

1. **不删除学习进度**：如果孤立节点有 `student_knowledge` 引用（学生做过练习或有掌握度记录），该节点必须跳过，不删除。
2. **不删除 manifest 内容**：manifest 中声明的节点永远不会被清理。
3. **只清理安全节点**：同时满足以下条件的节点才可被清理：
   - 不在当前 manifest 中
   - 没有 `student_knowledge` 引用
4. **清理时同步清理边**：`knowledge_edges` 中引用被清理节点的边会被同步删除。
5. **严格加载保障**：健康检查和清理操作必须使用严格 pack 加载（`loadAllKnowledgePacksStrict`），任一 pack 加载失败则拒绝执行清理，避免部分 manifest 导致误删。
6. **用户确认**：清理操作需要用户明确确认，确认文案必须说明"不会删除对话、练习结果、私有资料或学习进度"。
7. **入口可发现性**：知识图谱页底部提供"打开知识库管理"链接，引导用户到 设置 → 知识库管理 → 健康检查。孤立节点清理的真实执行逻辑只在设置页，不在知识图谱页。

## 13. 草稿 Pack 管理

未完成的 seed 文件应放在 `data/drafts/` 目录下，不参与 `import.meta.glob` 自动发现和构建。

正式接入流程：
1. 将 draft 文件移至 `data/knowledge/` 和 `data/questions/`
2. 在 `PACK_MANIFEST` 中注册 pack
3. 在 `src/types/learning.ts` 中注册 subject code
4. 在 `src/utils/subject.ts` 中添加中文名称
5. 在 `src/stores/packSelection.ts` 中添加学科选项
6. 在 `src/engine/policies/subjectStyle.ts` 中添加学科风格
7. 运行 `packValidator` 和 `dataIntegrity` 测试确保数据质量

当前状态：management、education、psychology、lawmaster 四个学科已注册到 `PACK_MANIFEST`（12 个 pack），seed 文件在 `data/knowledge/` 和 `data/questions/`，SubjectCode / subject label / subject style 已补齐。内容为 AI 生成草稿，需学科专家复核后才可标记为 `approved`。注册只提供显式维护和用户选择入口；这些 draft Pack 不进入默认 Seed、Embedding、RAG 或正式统计。

2026-07-26 全部 draft Pack 的批量审批纠正与逐 Pack 阻塞项见
`docs/knowledge-review/2026-07-26-draft-pack-correction.md`。

## 14. 与其他文档的关系

- 数据表：`docs/data-model.md`
- 工具接口：`docs/tool-interface.md`
- MVP 种子范围：`docs/mvp-spec.md`
- 待决策项：`docs/open-decisions.md`
