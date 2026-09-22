/**
 * Knowledge Pack Manifest — 定义所有可用的知识库包
 *
 * 每个 pack 包含知识节点和题库数据，支持懒加载。
 * 这个文件是静态的，不包含实际数据，只包含路径和元信息。
 *
 * status 字段是强制契约：
 * - 必须与对应 seed JSON 的顶层 status 字段一致
 * - 缺失 status 或与 seed 不一致时，packValidator 应报告错误
 * - draft pack 默认不启用、不计入正式统计、不进入默认 RAG
 */

export interface KnowledgePack {
  /** 唯一标识符 */
  id: string
  /** 学科代码 */
  subject: string
  /** 章节标识 */
  chapter: string
  /** 中文全名（用于设置页等宽空间） */
  title: string
  /** 中文短标题（用于按钮等窄空间） */
  shortTitle: string
  /** 知识节点 JSON 文件路径（相对于本文件） */
  knowledgePath: string
  /** 题库 JSON 文件路径（相对于本文件） */
  questionPath: string
  /** 预期知识节点数量（用于跳过重复 seed） */
  expectedNodeCount: number
  /** 预期题目数量 */
  expectedQuestionCount: number
  /** 审核状态：approved 或 draft。必须与对应 seed JSON 的顶层 status 字段一致。 */
  status: "approved" | "draft"
}

/**
 * 所有可用的知识库包清单
 *
 * 路径使用相对于本文件的动态导入路径，
 * 实际加载由 packLoader.ts 的 dynamic import 完成。
 */
export const PACK_MANIFEST: KnowledgePack[] = [
  {
    id: "math-limits",
    subject: "math",
    chapter: "math-limits",
    title: "极限与连续",
    shortTitle: "极限连续",
    knowledgePath: "../../../data/knowledge/math-limits.seed.json",
    questionPath: "../../../data/questions/math-limits.seed.json",
    expectedNodeCount: 35,
    expectedQuestionCount: 12,
    status: "approved"
  },
  {
    id: "linear-algebra-basics",
    subject: "math",
    chapter: "linear-algebra-basics",
    title: "线性代数基础",
    shortTitle: "线代基础",
    knowledgePath: "../../../data/knowledge/linear-algebra-basics.seed.json",
    questionPath: "../../../data/questions/linear-algebra-basics.seed.json",
    expectedNodeCount: 10,
    expectedQuestionCount: 5,
    status: "approved"
  },
  {
    id: "probability-basics",
    subject: "math",
    chapter: "probability-basics",
    title: "概率论基础",
    shortTitle: "概率基础",
    knowledgePath: "../../../data/knowledge/probability-basics.seed.json",
    questionPath: "../../../data/questions/probability-basics.seed.json",
    expectedNodeCount: 8,
    expectedQuestionCount: 5,
    status: "approved"
  },
  {
    id: "math-derivatives",
    subject: "math",
    chapter: "math-derivatives",
    title: "导数与微分",
    shortTitle: "导数微分",
    knowledgePath: "../../../data/knowledge/math-derivatives.seed.json",
    questionPath: "../../../data/questions/math-derivatives.seed.json",
    expectedNodeCount: 12,
    expectedQuestionCount: 9,
    status: "approved"
  },
  {
    id: "math-applications-of-derivatives",
    subject: "math",
    chapter: "math-applications-of-derivatives",
    title: "导数应用",
    shortTitle: "导数应用",
    knowledgePath: "../../../data/knowledge/math-applications-of-derivatives.seed.json",
    questionPath: "../../../data/questions/math-applications-of-derivatives.seed.json",
    expectedNodeCount: 7,
    expectedQuestionCount: 8,
    status: "approved"
  },
  {
    id: "math-indefinite-integrals",
    subject: "math",
    chapter: "math-indefinite-integrals",
    title: "不定积分",
    shortTitle: "不定积分",
    knowledgePath: "../../../data/knowledge/math-indefinite-integrals.seed.json",
    questionPath: "../../../data/questions/math-indefinite-integrals.seed.json",
    expectedNodeCount: 8,
    expectedQuestionCount: 8,
    status: "approved"
  },
  {
    id: "math-definite-integrals",
    subject: "math",
    chapter: "math-definite-integrals",
    title: "定积分",
    shortTitle: "定积分",
    knowledgePath: "../../../data/knowledge/math-definite-integrals.seed.json",
    questionPath: "../../../data/questions/math-definite-integrals.seed.json",
    expectedNodeCount: 8,
    expectedQuestionCount: 7,
    status: "approved"
  },
  {
    id: "math-integral-applications",
    subject: "math",
    chapter: "math-integral-applications",
    title: "定积分应用",
    shortTitle: "积分应用",
    knowledgePath: "../../../data/knowledge/math-integral-applications.seed.json",
    questionPath: "../../../data/questions/math-integral-applications.seed.json",
    expectedNodeCount: 6,
    expectedQuestionCount: 7,
    status: "approved"
  },
  {
    id: "math-mean-value-theorems",
    subject: "math",
    chapter: "math-mean-value-theorems",
    title: "中值定理",
    shortTitle: "中值定理",
    knowledgePath: "../../../data/knowledge/math-mean-value-theorems.seed.json",
    questionPath: "../../../data/questions/math-mean-value-theorems.seed.json",
    expectedNodeCount: 5,
    expectedQuestionCount: 7,
    status: "approved"
  },
  {
    id: "math-multivariable-calculus",
    subject: "math",
    chapter: "math-multivariable-calculus",
    title: "多元微积分",
    shortTitle: "多元微积分",
    knowledgePath: "../../../data/knowledge/math-multivariable-calculus.seed.json",
    questionPath: "../../../data/questions/math-multivariable-calculus.seed.json",
    expectedNodeCount: 7,
    expectedQuestionCount: 7,
    status: "approved"
  },
  {
    id: "probability-distributions",
    subject: "math",
    chapter: "probability-distributions",
    title: "概率分布",
    shortTitle: "概率分布",
    knowledgePath: "../../../data/knowledge/probability-distributions.seed.json",
    questionPath: "../../../data/questions/probability-distributions.seed.json",
    expectedNodeCount: 9,
    expectedQuestionCount: 10,
    status: "approved"
  },
  {
    id: "linear-algebra-expanded",
    subject: "math",
    chapter: "linear-algebra-expanded",
    title: "线性代数进阶",
    shortTitle: "线代进阶",
    knowledgePath: "../../../data/knowledge/linear-algebra-expanded.seed.json",
    questionPath: "../../../data/questions/linear-algebra-expanded.seed.json",
    expectedNodeCount: 7,
    expectedQuestionCount: 6,
    status: "approved"
  },
  // ── CS408 (408考研) ──────────────────────────────────────────────────────
  {
    id: "cs408-data-structures",
    subject: "cs408",
    chapter: "cs408-data-structures",
    title: "数据结构",
    shortTitle: "数据结构",
    knowledgePath: "../../../data/knowledge/cs408-data-structures.seed.json",
    questionPath: "../../../data/questions/cs408-data-structures.seed.json",
    expectedNodeCount: 40,
    expectedQuestionCount: 40,
    status: "approved"
  },
  {
    id: "cs408-computer-organization",
    subject: "cs408",
    chapter: "cs408-computer-organization",
    title: "计算机组成原理",
    shortTitle: "组成原理",
    knowledgePath: "../../../data/knowledge/cs408-computer-organization.seed.json",
    questionPath: "../../../data/questions/cs408-computer-organization.seed.json",
    expectedNodeCount: 40,
    expectedQuestionCount: 40,
    status: "approved"
  },
  {
    id: "cs408-operating-systems",
    subject: "cs408",
    chapter: "cs408-operating-systems",
    title: "操作系统",
    shortTitle: "操作系统",
    knowledgePath: "../../../data/knowledge/cs408-operating-systems.seed.json",
    questionPath: "../../../data/questions/cs408-operating-systems.seed.json",
    expectedNodeCount: 40,
    expectedQuestionCount: 40,
    status: "approved"
  },
  {
    id: "cs408-computer-networks",
    subject: "cs408",
    chapter: "cs408-computer-networks",
    title: "计算机网络",
    shortTitle: "计算机网络",
    knowledgePath: "../../../data/knowledge/cs408-computer-networks.seed.json",
    questionPath: "../../../data/questions/cs408-computer-networks.seed.json",
    expectedNodeCount: 40,
    expectedQuestionCount: 40,
    status: "approved"
  },
  // ── Physics (大学物理) ─────────────────────────────────────────────────
  {
    id: "physics-mechanics",
    subject: "physics",
    chapter: "physics-mechanics",
    title: "力学",
    shortTitle: "力学",
    knowledgePath: "../../../data/knowledge/physics-mechanics.seed.json",
    questionPath: "../../../data/questions/physics-mechanics.seed.json",
    expectedNodeCount: 9,
    expectedQuestionCount: 15,
    status: "approved"
  },
  {
    id: "physics-electromagnetism",
    subject: "physics",
    chapter: "physics-electromagnetism",
    title: "电磁学",
    shortTitle: "电磁学",
    knowledgePath: "../../../data/knowledge/physics-electromagnetism.seed.json",
    questionPath: "../../../data/questions/physics-electromagnetism.seed.json",
    expectedNodeCount: 10,
    expectedQuestionCount: 15,
    status: "approved"
  },
  {
    id: "physics-thermodynamics",
    subject: "physics",
    chapter: "physics-thermodynamics",
    title: "热学",
    shortTitle: "热学",
    knowledgePath: "../../../data/knowledge/physics-thermodynamics.seed.json",
    questionPath: "../../../data/questions/physics-thermodynamics.seed.json",
    expectedNodeCount: 6,
    expectedQuestionCount: 15,
    status: "approved"
  },
  {
    id: "physics-waves-optics",
    subject: "physics",
    chapter: "physics-waves-optics",
    title: "波动与光学",
    shortTitle: "波动光学",
    knowledgePath: "../../../data/knowledge/physics-waves-optics.seed.json",
    questionPath: "../../../data/questions/physics-waves-optics.seed.json",
    expectedNodeCount: 9,
    expectedQuestionCount: 15,
    status: "approved"
  },
  {
    id: "physics-modern",
    subject: "physics",
    chapter: "physics-modern",
    title: "近代物理",
    shortTitle: "近代物理",
    knowledgePath: "../../../data/knowledge/physics-modern.seed.json",
    questionPath: "../../../data/questions/physics-modern.seed.json",
    expectedNodeCount: 7,
    expectedQuestionCount: 15,
    status: "approved"
  },
  // ── English (考研英语) ──────────────────────────────────────────────────
  {
    id: "english-grammar",
    subject: "english",
    chapter: "english-grammar",
    title: "语法",
    shortTitle: "语法",
    knowledgePath: "../../../data/knowledge/english-grammar.seed.json",
    questionPath: "../../../data/questions/english-grammar.seed.json",
    expectedNodeCount: 20,
    expectedQuestionCount: 20,
    status: "approved"
  },
  {
    id: "english-reading",
    subject: "english",
    chapter: "english-reading",
    title: "阅读",
    shortTitle: "阅读",
    knowledgePath: "../../../data/knowledge/english-reading.seed.json",
    questionPath: "../../../data/questions/english-reading.seed.json",
    expectedNodeCount: 20,
    expectedQuestionCount: 20,
    status: "approved"
  },
  {
    id: "english-translation",
    subject: "english",
    chapter: "english-translation",
    title: "翻译",
    shortTitle: "翻译",
    knowledgePath: "../../../data/knowledge/english-translation.seed.json",
    questionPath: "../../../data/questions/english-translation.seed.json",
    expectedNodeCount: 20,
    expectedQuestionCount: 20,
    status: "approved"
  },
  {
    id: "english-cloze",
    subject: "english",
    chapter: "english-cloze",
    title: "完形填空",
    shortTitle: "完形填空",
    knowledgePath: "../../../data/knowledge/english-cloze.seed.json",
    questionPath: "../../../data/questions/english-cloze.seed.json",
    expectedNodeCount: 20,
    expectedQuestionCount: 20,
    status: "approved"
  },
  // ── Politics (考研政治) ──────────────────────────────────────────────────
  {
    id: "politics-marxism",
    subject: "politics",
    chapter: "politics-marxism",
    title: "马克思主义基本原理",
    shortTitle: "马原",
    knowledgePath: "../../../data/knowledge/politics-marxism.seed.json",
    questionPath: "../../../data/questions/politics-marxism.seed.json",
    expectedNodeCount: 20,
    expectedQuestionCount: 20,
    status: "approved"
  },
  {
    id: "politics-maoism",
    subject: "politics",
    chapter: "politics-maoism",
    title: "毛泽东思想概论",
    shortTitle: "毛概",
    knowledgePath: "../../../data/knowledge/politics-maoism.seed.json",
    questionPath: "../../../data/questions/politics-maoism.seed.json",
    expectedNodeCount: 20,
    expectedQuestionCount: 20,
    status: "approved"
  },
  {
    id: "politics-history",
    subject: "politics",
    chapter: "politics-history",
    title: "中国近现代史纲要",
    shortTitle: "史纲",
    knowledgePath: "../../../data/knowledge/politics-history.seed.json",
    questionPath: "../../../data/questions/politics-history.seed.json",
    expectedNodeCount: 20,
    expectedQuestionCount: 20,
    status: "approved"
  },
  {
    id: "politics-morals",
    subject: "politics",
    chapter: "politics-morals",
    title: "思想道德与法治",
    shortTitle: "思法",
    knowledgePath: "../../../data/knowledge/politics-morals.seed.json",
    questionPath: "../../../data/questions/politics-morals.seed.json",
    expectedNodeCount: 20,
    expectedQuestionCount: 20,
    status: "approved"
  },
  // ── Management (管理类联考) ───────────────────────────────────────
  {
    id: "management-math",
    subject: "management",
    chapter: "management-math",
    title: "初等数学",
    shortTitle: "初数",
    knowledgePath: "../../../data/knowledge/management-math.seed.json",
    questionPath: "../../../data/questions/management-math.seed.json",
    expectedNodeCount: 20,
    expectedQuestionCount: 20,
    status: "approved"
  },
  {
    id: "management-logic",
    subject: "management",
    chapter: "management-logic",
    title: "逻辑推理",
    shortTitle: "逻辑",
    knowledgePath: "../../../data/knowledge/management-logic.seed.json",
    questionPath: "../../../data/questions/management-logic.seed.json",
    expectedNodeCount: 20,
    expectedQuestionCount: 20,
    status: "approved"
  },
  {
    id: "management-writing",
    subject: "management",
    chapter: "management-writing",
    title: "写作",
    shortTitle: "写作",
    knowledgePath: "../../../data/knowledge/management-writing.seed.json",
    questionPath: "../../../data/questions/management-writing.seed.json",
    expectedNodeCount: 20,
    expectedQuestionCount: 20,
    status: "approved"
  },
  // ── Education (教育学) ─────────────────────────────────────────────
  {
    id: "education-pedagogy",
    subject: "education",
    chapter: "education-pedagogy",
    title: "教育学原理",
    shortTitle: "原理",
    knowledgePath: "../../../data/knowledge/education-pedagogy.seed.json",
    questionPath: "../../../data/questions/education-pedagogy.seed.json",
    expectedNodeCount: 20,
    expectedQuestionCount: 20,
    status: "approved"
  },
  {
    id: "education-psychology",
    subject: "education",
    chapter: "education-psychology",
    title: "教育心理学",
    shortTitle: "教心",
    knowledgePath: "../../../data/knowledge/education-psychology.seed.json",
    questionPath: "../../../data/questions/education-psychology.seed.json",
    expectedNodeCount: 20,
    expectedQuestionCount: 20,
    status: "approved"
  },
  {
    id: "education-history",
    subject: "education",
    chapter: "education-history",
    title: "中外教育史",
    shortTitle: "教育史",
    knowledgePath: "../../../data/knowledge/education-history.seed.json",
    questionPath: "../../../data/questions/education-history.seed.json",
    expectedNodeCount: 20,
    expectedQuestionCount: 20,
    status: "approved"
  },
  // ── Psychology (心理学) ───────────────────────────────────────────
  {
    id: "psychology-general",
    subject: "psychology",
    chapter: "psychology-general",
    title: "普通心理学",
    shortTitle: "普心",
    knowledgePath: "../../../data/knowledge/psychology-general.seed.json",
    questionPath: "../../../data/questions/psychology-general.seed.json",
    expectedNodeCount: 20,
    expectedQuestionCount: 20,
    status: "approved"
  },
  {
    id: "psychology-experimental",
    subject: "psychology",
    chapter: "psychology-experimental",
    title: "实验心理学",
    shortTitle: "实验",
    knowledgePath: "../../../data/knowledge/psychology-experimental.seed.json",
    questionPath: "../../../data/questions/psychology-experimental.seed.json",
    expectedNodeCount: 20,
    expectedQuestionCount: 20,
    status: "approved"
  },
  {
    id: "psychology-developmental",
    subject: "psychology",
    chapter: "psychology-developmental",
    title: "发展心理学",
    shortTitle: "发展",
    knowledgePath: "../../../data/knowledge/psychology-developmental.seed.json",
    questionPath: "../../../data/questions/psychology-developmental.seed.json",
    expectedNodeCount: 20,
    expectedQuestionCount: 20,
    status: "approved"
  },
  // ── Law Master (法律硕士) ──────────────────────────────────────────────
  {
    id: "lawmaster-civil",
    subject: "lawmaster",
    chapter: "lawmaster-civil",
    title: "民法",
    shortTitle: "民法",
    knowledgePath: "../../../data/knowledge/lawmaster-civil.seed.json",
    questionPath: "../../../data/questions/lawmaster-civil.seed.json",
    expectedNodeCount: 20,
    expectedQuestionCount: 20,
    status: "approved"
  },
  {
    id: "lawmaster-criminal",
    subject: "lawmaster",
    chapter: "lawmaster-criminal",
    title: "刑法",
    shortTitle: "刑法",
    knowledgePath: "../../../data/knowledge/lawmaster-criminal.seed.json",
    questionPath: "../../../data/questions/lawmaster-criminal.seed.json",
    expectedNodeCount: 20,
    expectedQuestionCount: 20,
    status: "approved"
  },
  {
    id: "lawmaster-jurisprudence",
    subject: "lawmaster",
    chapter: "lawmaster-jurisprudence",
    title: "法理学",
    shortTitle: "法理",
    knowledgePath: "../../../data/knowledge/lawmaster-jurisprudence.seed.json",
    questionPath: "../../../data/questions/lawmaster-jurisprudence.seed.json",
    expectedNodeCount: 20,
    expectedQuestionCount: 20,
    status: "approved"
  },
  // ── 考公 · 行测 ───────────────────────────────────────────────
  {
    id: "civil-verbal",
    subject: "xingce",
    chapter: "civil-verbal",
    title: "言语理解与表达",
    shortTitle: "言语理解",
    knowledgePath: "../../../data/knowledge/civil-verbal.seed.json",
    questionPath: "../../../data/questions/civil-verbal.seed.json",
    expectedNodeCount: 5,
    expectedQuestionCount: 4,
    status: "approved"
  },
  {
    id: "civil-logic",
    subject: "xingce",
    chapter: "civil-logic",
    title: "判断推理",
    shortTitle: "判断推理",
    knowledgePath: "../../../data/knowledge/civil-logic.seed.json",
    questionPath: "../../../data/questions/civil-logic.seed.json",
    expectedNodeCount: 5,
    expectedQuestionCount: 4,
    status: "approved"
  },
  {
    id: "civil-data-analysis",
    subject: "xingce",
    chapter: "civil-data-analysis",
    title: "资料分析",
    shortTitle: "资料分析",
    knowledgePath: "../../../data/knowledge/civil-data-analysis.seed.json",
    questionPath: "../../../data/questions/civil-data-analysis.seed.json",
    expectedNodeCount: 5,
    expectedQuestionCount: 4,
    status: "approved"
  },
  {
    id: "civil-quant",
    subject: "xingce",
    chapter: "civil-quant",
    title: "数量关系",
    shortTitle: "数量关系",
    knowledgePath: "../../../data/knowledge/civil-quant.seed.json",
    questionPath: "../../../data/questions/civil-quant.seed.json",
    expectedNodeCount: 5,
    expectedQuestionCount: 4,
    status: "approved"
  },
  {
    id: "civil-common-sense-scope",
    subject: "xingce",
    chapter: "civil-common-sense-scope",
    title: "常识判断（范围与题型）",
    shortTitle: "常识范围",
    knowledgePath: "../../../data/knowledge/civil-common-sense-scope.seed.json",
    questionPath: "../../../data/questions/civil-common-sense-scope.seed.json",
    expectedNodeCount: 2,
    expectedQuestionCount: 2,
    status: "approved"
  },
  {
    id: "civil-common-sense",
    subject: "xingce",
    chapter: "civil-common-sense",
    title: "常识判断",
    shortTitle: "常识判断",
    knowledgePath: "../../../data/knowledge/civil-common-sense.seed.json",
    questionPath: "../../../data/questions/civil-common-sense.seed.json",
    expectedNodeCount: 5,
    expectedQuestionCount: 4,
    status: "draft"
  },
  // ── 考公 · 申论 ───────────────────────────────────────────────
  {
    id: "civil-shenlun-summary",
    subject: "shenlun",
    chapter: "civil-shenlun-summary",
    title: "申论·归纳概括",
    shortTitle: "概括题",
    knowledgePath: "../../../data/knowledge/civil-shenlun-summary.seed.json",
    questionPath: "../../../data/questions/civil-shenlun-summary.seed.json",
    expectedNodeCount: 5,
    expectedQuestionCount: 3,
    status: "approved"
  },
  {
    id: "civil-shenlun-argument",
    subject: "shenlun",
    chapter: "civil-shenlun-argument",
    title: "申论·综合分析与对策",
    shortTitle: "对策题",
    knowledgePath: "../../../data/knowledge/civil-shenlun-argument.seed.json",
    questionPath: "../../../data/questions/civil-shenlun-argument.seed.json",
    expectedNodeCount: 5,
    expectedQuestionCount: 3,
    status: "approved"
  },
  {
    id: "civil-shenlun-implementation",
    subject: "shenlun",
    chapter: "civil-shenlun-implementation",
    title: "申论·贯彻执行",
    shortTitle: "贯彻执行",
    knowledgePath: "../../../data/knowledge/civil-shenlun-implementation.seed.json",
    questionPath: "../../../data/questions/civil-shenlun-implementation.seed.json",
    expectedNodeCount: 5,
    expectedQuestionCount: 3,
    status: "approved"
  },
  {
    id: "civil-shenlun-writing",
    subject: "shenlun",
    chapter: "civil-shenlun-writing",
    title: "申论·大作文",
    shortTitle: "大作文",
    knowledgePath: "../../../data/knowledge/civil-shenlun-writing.seed.json",
    questionPath: "../../../data/questions/civil-shenlun-writing.seed.json",
    expectedNodeCount: 5,
    expectedQuestionCount: 3,
    status: "approved"
  },
  // ── Programming ────────────────────────────────────────────────────
  {
    id: "python-basics",
    subject: "programming",
    chapter: "python-basics",
    title: "Python 基础",
    shortTitle: "Python 基础",
    knowledgePath: "../../../data/knowledge/python-basics.seed.json",
    questionPath: "../../../data/questions/python-basics.seed.json",
    expectedNodeCount: 8,
    expectedQuestionCount: 8,
    status: "approved"
  }
]

/**
 * 按学科获取 pack 列表
 */
export function getPacksBySubject(subject: string): KnowledgePack[] {
  return PACK_MANIFEST.filter((pack) => pack.subject === subject)
}

/**
 * 按 ID 获取 pack
 */
export function getPackById(packId: string): KnowledgePack | undefined {
  return PACK_MANIFEST.find((pack) => pack.id === packId)
}

/**
 * 获取所有 pack 的总预期节点数
 */
export function getTotalExpectedNodeCount(): number {
  return PACK_MANIFEST.reduce((sum, pack) => sum + pack.expectedNodeCount, 0)
}

/**
 * 获取所有 pack 的总预期题目数
 */
export function getTotalExpectedQuestionCount(): number {
  return PACK_MANIFEST.reduce((sum, pack) => sum + pack.expectedQuestionCount, 0)
}

/**
 * 获取 approved pack 的总预期节点数
 */
export function getApprovedExpectedNodeCount(): number {
  return PACK_MANIFEST
    .filter((pack) => pack.status === "approved")
    .reduce((sum, pack) => sum + pack.expectedNodeCount, 0)
}

/**
 * 获取 approved pack 的总预期题目数
 */
export function getApprovedExpectedQuestionCount(): number {
  return PACK_MANIFEST
    .filter((pack) => pack.status === "approved")
    .reduce((sum, pack) => sum + pack.expectedQuestionCount, 0)
}

/**
 * 获取 draft pack 的总预期节点数
 */
export function getDraftExpectedNodeCount(): number {
  return PACK_MANIFEST
    .filter((pack) => pack.status === "draft")
    .reduce((sum, pack) => sum + pack.expectedNodeCount, 0)
}

/**
 * 获取 draft pack 的总预期题目数
 */
export function getDraftExpectedQuestionCount(): number {
  return PACK_MANIFEST
    .filter((pack) => pack.status === "draft")
    .reduce((sum, pack) => sum + pack.expectedQuestionCount, 0)
}
