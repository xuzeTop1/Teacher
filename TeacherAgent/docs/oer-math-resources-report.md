# TeacherAgent 数学知识库开放教育资源调研报告

调研日期：2026-07-02

---

## 第一部分：资源对比表

### A. 许可证低风险资源（CC BY 4.0）

| 资源 | 官网 | 学科 | 许可证 | 改写 | 商用 | 署名 | ShareAlike | AI摄入 | GitHub适用 | 风险 | 许可证来源 |
|------|------|------|--------|------|------|------|------------|--------|-----------|------|-----------|
| OpenStax Algebra & Trig | https://openstax.org/books/algebra-and-trigonometry/pages/preface | 高数/代数/三角 | CC BY 4.0 | ✅ | ✅ | ✅ | ❌ | ❌ 禁止 | 极佳 | 低* | [Preface](https://openstax.org/books/algebra-and-trigonometry/pages/preface) |
| OpenStax Precalculus | https://openstax.org/books/precalculus/pages/preface | 预备微积分/三角 | CC BY 4.0 | ✅ | ✅ | ✅ | ❌ | ❌ 禁止 | 极佳 | 低* | [Preface](https://openstax.org/books/precalculus/pages/preface) |
| OpenStax Intro Statistics | https://openstax.org/books/introductory-statistics/pages/1-introduction | 概率统计 | CC BY 4.0 | ✅ | ✅ | ✅ | ❌ | ❌ 禁止 | 极佳 | 低* | [Ch.1 Introduction](https://openstax.org/books/introductory-statistics/pages/1-introduction) |

> \* 许可证风险为低，但 AI/LLM 使用风险为高。见下方"OpenStax AI / LLM 使用限制"章节。

**许可证说明**: OpenStax 各书许可证**不统一**，必须以每本书的 copyright/license 页面为准。上述三本经逐本核验为 CC BY 4.0。OpenStax Calculus Vol 1-3 为 CC BY-NC-SA 4.0，见 B 节。所有 OpenStax 书籍均声明未经许可不得用于 LLM training 或摄入 generative AI offerings。

### B. 中风险资源（NonCommercial 或 ShareAlike 限制）

| 资源 | 官网 | 学科 | 许可证 | 改写 | 商用 | 署名 | ShareAlike | GitHub适用 | 风险 | 许可证来源 |
|------|------|------|--------|------|------|------|------------|-----------|------|-----------|
| OpenStax Calculus Vol 1 | https://openstax.org/books/calculus-volume-1/pages/1-introduction | 微积分（极限/导数/积分） | CC BY-NC-SA 4.0 | ✅ | ❌ | ✅ | ✅ | 中 | 中 | [Ch.1 Introduction](https://openstax.org/books/calculus-volume-1/pages/1-introduction) |
| OpenStax Calculus Vol 2 | https://openstax.org/books/calculus-volume-2/pages/1-introduction | 微积分（积分技巧/级数） | CC BY-NC-SA 4.0 | ✅ | ❌ | ✅ | ✅ | 中 | 中 | [Ch.1 Introduction](https://openstax.org/books/calculus-volume-2/pages/1-introduction) |
| OpenStax Calculus Vol 3 | https://openstax.org/books/calculus-volume-3/pages/1-introduction | 微积分（多元/向量） | CC BY-NC-SA 4.0 | ✅ | ❌ | ✅ | ✅ | 中 | 中 | [Ch.1 Introduction](https://openstax.org/books/calculus-volume-3/pages/1-introduction) |
| MIT OCW | https://ocw.mit.edu | 高数/线代/概率/微分方程 | CC BY-NC-SA 4.0 | ✅ | ❌ | ✅ | ✅ | 中 | 中 | [About page](https://ocw.mit.edu/about/) |
| LibreTexts Math | https://math.libretexts.org | 高数/线代/概率/统计 | 逐本不同 | 视页面 | 视页面 | ✅ | 视页面 | 中 | 中 | 需逐本确认每本教材的 license 页面 |
| Hefferon 线性代数 | https://hefferon.net/linearalgebra/ | 线性代数 | CC BY-SA 2.5 | ✅ | ✅ | ✅ | ✅ | 中 | 中 | [OpenIntro book page](https://openintro.org/book/linalg) |
| OpenIntro 统计 | https://openintro.org/book/os | 统计学 | CC BY-SA 3.0 | ✅ | ✅ | ✅ | ✅ | 中 | 中 | [License page](https://openintro.org/license) |
| Wikibooks 数学 | https://en.wikibooks.org | 数学各分支 | CC BY-SA 3.0+ | ✅ | ✅ | ✅ | ✅ | 中 | 中 | 内容质量参差；需人工筛选 |

### C. 高风险资源（NonCommercial + 其他限制）

| 资源 | 官网 | 学科 | 许可证 | 改写 | 商用 | 署名 | ShareAlike | GitHub适用 | 风险 | 许可证来源 |
|------|------|------|--------|------|------|------|------------|-----------|------|-----------|
| APEX Calculus | https://apexcalculus.com | 微积分(全) | CC BY-NC 4.0 | ✅ | ❌ | ✅ | ❌ | 低 | 高 | [GitHub README](https://github.com/APEXCalculus/APEXCalculusV5) |
| Stitz/Zeager 预备微积分 | https://stitz-zeager.com | 预备微积分/代数/三角 | CC BY-NC-SA 3.0 | ✅ | ❌ | ✅ | ✅ | 低 | 高 | [stitz-zeager.com](https://stitz-zeager.com) 首页CC图标 |
| Khan Academy | https://www.khanacademy.org | 全科 | 专有条款 | ❌ | ❌ | — | — | 不适用 | 高 | [Terms of Use](https://www.khanacademy.org/about/khan-academy-terms-of-use) |

### D. 不推荐资源

| 类型 | 原因 |
|------|------|
| 考研机构题库 | 版权不明，无开放许可 |
| 百度文库/知乎/CSDN | 内容来源不可追溯，版权风险高 |
| 出版社教辅扫描版 | 明确侵权 |
| 网盘分享资源 | 版权不明 |
| 未标注许可证的网站 | 无法确认授权 |

---

## OpenStax AI / LLM 使用限制

OpenStax 各书籍页面均包含以下声明：

> This book may not be used in the training of large language models or otherwise be ingested into large language models or generative AI offerings without OpenStax's permission.

该声明出现在以下页面的 Citation/Attribution 区域：
- [Algebra and Trigonometry — Preface](https://openstax.org/books/algebra-and-trigonometry/pages/preface)
- [Precalculus — Preface](https://openstax.org/books/precalculus/pages/preface)
- [Introductory Statistics — Ch.1 Introduction](https://openstax.org/books/introductory-statistics/pages/1-introduction)
- [Calculus Volume 1 — Ch.1 Introduction](https://openstax.org/books/calculus-volume-1/pages/1-introduction)
- [Calculus Volume 2 — Ch.1 Introduction](https://openstax.org/books/calculus-volume-2/pages/1-introduction)
- [Calculus Volume 3 — Ch.1 Introduction](https://openstax.org/books/calculus-volume-3/pages/1-introduction)

**对 TeacherAgent 的影响：**

TeacherAgent 是 AI/RAG 辅导应用。即使部分 OpenStax 书籍为 CC BY 4.0，许可证层面允许改写和商用，但 OpenStax 的 AI 使用限制是**独立于 CC 许可证的额外约束**。这意味着：

- 许可证（CC BY / CC BY-NC-SA）管辖的是传统版权意义上的复制、改写、再分发
- AI 使用限制管辖的是将内容用于 LLM training、RAG ingestion、embedding 生成等 AI 场景
- 两者并存，必须同时满足

因此，**所有 OpenStax 内容不得直接用于 TeacherAgent 的 RAG/embedding/LLM 改写流水线**，除非获得 OpenStax 明确许可。

---

## 第二部分：TeacherAgent 建议

### 1. 许可证低风险来源（但 AI 使用受限）

以下三本 OpenStax 教材为 CC BY 4.0，许可证层面最宽松：

- **OpenStax Algebra and Trigonometry** — 高数、代数、三角函数
- **OpenStax Precalculus** — 预备微积分、函数、三角
- **OpenStax Introductory Statistics** — 概率统计、假设检验、回归

**但 OpenStax 明确禁止未经许可将内容用于 LLM training 或摄入 generative AI offerings。** 因此：

- 可作为人工阅读参考、课程结构参考、知识点目录参考
- 不建议直接把原文、例题、解析作为 RAG chunk 或 embedding 数据摄入
- 如需自动化抽取、embedding、LLM 改写，应先取得 OpenStax 明确许可

### 2. 中风险参考来源

- **OpenStax Calculus Vol 1-3**: 实际许可证为 **CC BY-NC-SA 4.0**（非 CC BY 4.0）。非商业限制 + ShareAlike。如果 TeacherAgent 项目始终保持开源非商业，可以考虑使用，但需在应用中注明 NC 限制并以相同方式共享。来源：[Vol1](https://openstax.org/books/calculus-volume-1/pages/1-introduction)、[Vol2](https://openstax.org/books/calculus-volume-2/pages/1-introduction)、[Vol3](https://openstax.org/books/calculus-volume-3/pages/1-introduction)
- **Hefferon 线性代数**: CC BY-SA 2.5，允许商用但要求 ShareAlike。如果纳入知识库，改写后的衍生内容需以 CC BY-SA 发布。来源：[OpenIntro book page](https://openintro.org/book/linalg)
- **MIT OCW**: CC BY-NC-SA 4.0。建议仅作为教学设计参考，不直接复制内容。来源：[About page](https://ocw.mit.edu/about/)
- **LibreTexts**: 许可证因教材而异，需逐本确认 license 页面。部分为 CC BY，部分为 CC BY-NC。适合挑选 CC BY 授权的特定教材。来源：[LibreTexts Terms](https://libretexts.org/terms-conditions)
- **Wikibooks**: CC BY-SA 3.0+，内容质量参差，适合补充参考。

### 3. 不建议使用

- **Khan Academy**: 专有条款，禁止复制和再分发。来源：[Terms of Use](https://www.khanacademy.org/about/khan-academy-terms-of-use)
- **APEX Calculus**: CC BY-NC 4.0，非商业限制。不建议纳入知识库，只能作为人工教学参考。来源：[GitHub README](https://github.com/APEXCalculus/APEXCalculusV5)
- **Stitz/Zeager**: CC BY-NC-SA 3.0，双重限制。来源：[stitz-zeager.com](https://stitz-zeager.com)
- 所有未明确标注许可证的内容（考研机构题库、百度文库、CSDN、出版社教辅扫描版等）

### 4. TeacherAgent 知识库入库策略

**核心原则：不直接摄入任何 OER 原文**

由于 OpenStax 的 AI 使用限制，TeacherAgent 不应直接将任何 OER 内容摄入 RAG/embedding 流水线。推荐策略如下：

**第一步：人工阅读 + 整理知识点大纲**

1. 人工阅读 OpenStax、MIT OCW、LibreTexts 等 OER 教材
2. 整理原创的知识点大纲（标题、子主题、前置关系）
3. 不复制原文的段落、例题、解析、图表

**第二步：AI 辅助生成原创内容**

基于知识点大纲，由 TeacherAgent 自创：
- `summary` — 知识点的原创摘要
- `misconceptions` — 常见误区
- `socraticHints` — 苏格拉底式引导提示
- 练习题 — 由 LLM 生成，不复制外部题库

**第三步：数据标记**

每条知识节点的元数据：
- `source`: `"human_authored_with_oer_reference"`
- `license`: `"original_generated"`
- `source.references`: 可记录参考过的 OER 书名和章节链接（仅作溯源，非内容复制）

**禁止事项**

- 禁止直接下载 OpenStax PDF 后让 LLM 批量总结
- 禁止直接将 OpenStax HTML/PDF 切 chunk 写入 vector_embeddings
- 禁止直接把 OpenStax 题目、例题、解析写入 data/questions
- 禁止直接让 LLM 基于 OpenStax 原文生成改写版后声称原创
- 禁止提交 OpenStax 原文、截图、PDF 到仓库

**许可证合规要点**

- CC BY 要求：在应用中标注原作者和来源（适用于人工参考后的知识大纲）
- CC BY-SA 要求：如果直接使用改写内容，整个知识库可能需要以相同方式共享
- CC BY-NC 要求：禁止商业使用，需评估 TeacherAgent 是否会涉及商业场景
- OpenStax AI 限制：未经许可不得用于 LLM training 或摄入 generative AI offerings

---

## 第三部分：JSON 清单

```json
[
  {
    "id": "openstax-algebra-trig",
    "name": "OpenStax Algebra and Trigonometry",
    "officialUrl": "https://openstax.org/books/algebra-and-trigonometry/pages/preface",
    "license": "CC BY 4.0",
    "subjects": ["algebra", "trigonometry", "precalculus"],
    "canAdapt": true,
    "commercialUseAllowed": true,
    "attributionRequired": true,
    "shareAlikeRequired": false,
    "aiUseRestriction": true,
    "llmIngestionAllowed": false,
    "recommendedUse": "human_reference_and_manual_outline",
    "riskLevel": "low",
    "notes": "许可证允许复用，但 OpenStax 页面声明未经许可不得用于 LLM training 或摄入 generative AI offerings；TeacherAgent 不应直接摄入原文作为 RAG/embedding。"
  },
  {
    "id": "openstax-precalculus",
    "name": "OpenStax Precalculus",
    "officialUrl": "https://openstax.org/books/precalculus/pages/preface",
    "license": "CC BY 4.0",
    "subjects": ["precalculus", "functions", "trigonometry"],
    "canAdapt": true,
    "commercialUseAllowed": true,
    "attributionRequired": true,
    "shareAlikeRequired": false,
    "aiUseRestriction": true,
    "llmIngestionAllowed": false,
    "recommendedUse": "human_reference_and_manual_outline",
    "riskLevel": "low",
    "notes": "许可证允许复用，但 OpenStax 页面声明未经许可不得用于 LLM training 或摄入 generative AI offerings；TeacherAgent 不应直接摄入原文作为 RAG/embedding。"
  },
  {
    "id": "openstax-intro-stats",
    "name": "OpenStax Introductory Statistics",
    "officialUrl": "https://openstax.org/books/introductory-statistics/pages/1-introduction",
    "license": "CC BY 4.0",
    "subjects": ["statistics", "probability", "hypothesis_testing"],
    "canAdapt": true,
    "commercialUseAllowed": true,
    "attributionRequired": true,
    "shareAlikeRequired": false,
    "aiUseRestriction": true,
    "llmIngestionAllowed": false,
    "recommendedUse": "human_reference_and_manual_outline",
    "riskLevel": "low",
    "notes": "许可证允许复用，但 OpenStax 页面声明未经许可不得用于 LLM training 或摄入 generative AI offerings；TeacherAgent 不应直接摄入原文作为 RAG/embedding。"
  },
  {
    "id": "openstax-calculus-vol1",
    "name": "OpenStax Calculus Volume 1",
    "officialUrl": "https://openstax.org/books/calculus-volume-1/pages/1-introduction",
    "license": "CC BY-NC-SA 4.0",
    "subjects": ["calculus", "limits", "derivatives", "integration"],
    "canAdapt": true,
    "commercialUseAllowed": false,
    "attributionRequired": true,
    "shareAlikeRequired": true,
    "aiUseRestriction": true,
    "llmIngestionAllowed": false,
    "recommendedUse": "human_reference_and_manual_outline",
    "riskLevel": "medium",
    "notes": "非商业+ShareAlike，且 OpenStax 声明未经许可不得用于 LLM training 或摄入 generative AI offerings。"
  },
  {
    "id": "openstax-calculus-vol2",
    "name": "OpenStax Calculus Volume 2",
    "officialUrl": "https://openstax.org/books/calculus-volume-2/pages/1-introduction",
    "license": "CC BY-NC-SA 4.0",
    "subjects": ["calculus", "integration_techniques", "sequences", "series"],
    "canAdapt": true,
    "commercialUseAllowed": false,
    "attributionRequired": true,
    "shareAlikeRequired": true,
    "aiUseRestriction": true,
    "llmIngestionAllowed": false,
    "recommendedUse": "human_reference_and_manual_outline",
    "riskLevel": "medium",
    "notes": "非商业+ShareAlike，且 OpenStax 声明未经许可不得用于 LLM training 或摄入 generative AI offerings。"
  },
  {
    "id": "openstax-calculus-vol3",
    "name": "OpenStax Calculus Volume 3",
    "officialUrl": "https://openstax.org/books/calculus-volume-3/pages/1-introduction",
    "license": "CC BY-NC-SA 4.0",
    "subjects": ["calculus", "multivariable", "vectors", "partial_derivatives"],
    "canAdapt": true,
    "commercialUseAllowed": false,
    "attributionRequired": true,
    "shareAlikeRequired": true,
    "aiUseRestriction": true,
    "llmIngestionAllowed": false,
    "recommendedUse": "human_reference_and_manual_outline",
    "riskLevel": "medium",
    "notes": "非商业+ShareAlike，且 OpenStax 声明未经许可不得用于 LLM training 或摄入 generative AI offerings。"
  },
  {
    "id": "hefferon-linear-algebra",
    "name": "Linear Algebra by Jim Hefferon",
    "officialUrl": "https://hefferon.net/linearalgebra/",
    "license": "CC BY-SA 2.5",
    "subjects": ["linear_algebra"],
    "canAdapt": true,
    "commercialUseAllowed": true,
    "attributionRequired": true,
    "shareAlikeRequired": true,
    "recommendedUse": "cautious_adapt",
    "riskLevel": "medium",
    "notes": "经典线代教材。允许商用但要求 ShareAlike，改写分发时需以相同协议发布。"
  },
  {
    "id": "mit-ocw-math",
    "name": "MIT OpenCourseWare Mathematics",
    "officialUrl": "https://ocw.mit.edu",
    "license": "CC BY-NC-SA 4.0",
    "subjects": ["calculus", "linear_algebra", "probability", "differential_equations"],
    "canAdapt": true,
    "commercialUseAllowed": false,
    "attributionRequired": true,
    "shareAlikeRequired": true,
    "recommendedUse": "reference_only",
    "riskLevel": "medium",
    "notes": "非商业+ShareAlike。建议仅作为教学设计参考，不直接复制内容。"
  },
  {
    "id": "libretexts-math",
    "name": "LibreTexts Mathematics Library",
    "officialUrl": "https://math.libretexts.org",
    "license": "varies_by_book",
    "subjects": ["algebra", "calculus", "linear_algebra", "probability", "statistics"],
    "canAdapt": true,
    "commercialUseAllowed": "varies",
    "attributionRequired": true,
    "shareAlikeRequired": "varies",
    "recommendedUse": "selective_use",
    "riskLevel": "medium",
    "notes": "许可证因教材而异，需逐本确认。部分为 CC BY，部分为 CC BY-NC。只选取 CC BY 授权的教材。"
  },
  {
    "id": "openintro-statistics",
    "name": "OpenIntro Statistics",
    "officialUrl": "https://openintro.org/book/os",
    "license": "CC BY-SA 3.0",
    "subjects": ["statistics", "probability", "regression"],
    "canAdapt": true,
    "commercialUseAllowed": true,
    "attributionRequired": true,
    "shareAlikeRequired": true,
    "recommendedUse": "reference_and_adapt",
    "riskLevel": "medium",
    "notes": "优质统计教材。需 ShareAlike 且不可用 OpenIntro 品牌。"
  },
  {
    "id": "wikibooks-math",
    "name": "Wikibooks Mathematics",
    "officialUrl": "https://en.wikibooks.org/wiki/Subject:Mathematics",
    "license": "CC BY-SA 3.0+",
    "subjects": ["algebra", "calculus", "linear_algebra", "probability"],
    "canAdapt": true,
    "commercialUseAllowed": true,
    "attributionRequired": true,
    "shareAlikeRequired": true,
    "recommendedUse": "supplementary_reference",
    "riskLevel": "medium",
    "notes": "内容由社区维护，质量参差。适合补充特定知识点。"
  },
  {
    "id": "apex-calculus",
    "name": "APEX Calculus",
    "officialUrl": "https://apexcalculus.com",
    "license": "CC BY-NC 4.0",
    "subjects": ["calculus", "multivariable", "vectors", "series"],
    "canAdapt": true,
    "commercialUseAllowed": false,
    "attributionRequired": true,
    "shareAlikeRequired": false,
    "recommendedUse": "not_recommended",
    "riskLevel": "high",
    "notes": "非商业限制。不建议纳入知识库，仅可作为人工教学参考。"
  },
  {
    "id": "stitz-zeager-precalc",
    "name": "Stitz/Zeager Precalculus",
    "officialUrl": "https://stitz-zeager.com",
    "license": "CC BY-NC-SA 3.0",
    "subjects": ["precalculus", "algebra", "trigonometry"],
    "canAdapt": true,
    "commercialUseAllowed": false,
    "attributionRequired": true,
    "shareAlikeRequired": true,
    "recommendedUse": "not_recommended",
    "riskLevel": "high",
    "notes": "双重限制（非商业+ShareAlike）。不建议使用。"
  },
  {
    "id": "khan-academy",
    "name": "Khan Academy",
    "officialUrl": "https://www.khanacademy.org",
    "license": "proprietary",
    "subjects": ["calculus", "algebra", "statistics", "linear_algebra"],
    "canAdapt": false,
    "commercialUseAllowed": false,
    "attributionRequired": false,
    "shareAlikeRequired": false,
    "recommendedUse": "not_recommended",
    "riskLevel": "high",
    "notes": "专有条款，禁止复制和再分发。不可用于 OER。"
  }
]
```

---

## 附录：许可证速查

| 许可证 | 改写 | 商用 | 署名 | ShareAlike | 对开源项目影响 |
|--------|------|------|------|------------|--------------|
| CC BY 4.0 | ✅ | ✅ | ✅ | ❌ | 最宽松，推荐首选 |
| CC BY-SA 3.0/4.0 | ✅ | ✅ | ✅ | ✅ | 改写分发需同协议 |
| CC BY-NC 4.0 | ✅ | ❌ | ✅ | ❌ | 禁止商用 |
| CC BY-NC-SA 4.0 | ✅ | ❌ | ✅ | ✅ | 禁止商用+同协议 |
| Public Domain | ✅ | ✅ | ❌ | ❌ | 无限制 |
| 专有条款 | ❌ | ❌ | — | — | 不可用于OER |
