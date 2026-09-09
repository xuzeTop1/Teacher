/**
 * Pack Validator — 知识库 Pack 质量校验服务
 *
 * 校验所有 pack 的数据完整性，返回结构化结果。
 * 作为 miCode / Qoder / WorkBuddy 知识库产出的质量门禁。
 */

import type { KnowledgePack } from "./packManifest"
import { PACK_MANIFEST } from "./packManifest"
import {
  loadAllKnowledgePacks,
  loadAllQuestionPacks,
  type KnowledgeSeed,
  type KnowledgeSeedNode,
  type QuestionSeed,
  type QuestionSeedItem
} from "./packLoader"

// ── 类型定义 ──────────────────────────────────────────────────────────────

export interface ValidationError {
  packId?: string
  file?: string
  code: string
  message: string
}

export interface ValidationWarning {
  packId?: string
  file?: string
  code: string
  message: string
}

export interface ValidationResult {
  ok: boolean
  errors: ValidationError[]
  warnings: ValidationWarning[]
  summary: {
    packCount: number
    nodeCount: number
    questionCount: number
    subjectCounts: Record<string, number>
  }
}

// ── 校验规则常量 ──────────────────────────────────────────────────────────

/**
 * 已知的基础概念（中文描述），这些不是显式节点但是合法的 prerequisite
 */
const BASE_CONCEPTS = new Set([
  "0/0 型", "一点连续", "三角函数", "三角函数有界性", "不定式", "不等式",
  "乘除结构", "代数变形", "共轭式", "函数", "函数值", "函数值大小",
  "函数值符号", "函数可导", "函数图像", "函数极限", "分段函数",
  "分母趋近 0", "初等函数", "区间", "区间连续", "单侧极限", "参数方程",
  "反例", "发散", "变量代换", "右极限", "因式分解", "基本初等函数",
  "复合函数", "多项式次数", "多项式近似", "存在性证明", "定义域",
  "对数运算", "导数", "左右极限", "左极限", "平方差公式", "收敛",
  "数列", "数列单调性", "数列极限", "数轴方向", "无穷大", "无穷小",
  "无穷小阶", "无穷远极限", "无穷远趋近", "最高次项", "有理式",
  "有界性", "有界振荡", "极限为 0", "极限存在", "极限比值", "极限比较",
  "极限运算", "根式", "直接代入", "等价无穷小", "自变量趋近", "趋近过程",
  "连续", "连续函数", "连续条件", "闭区间", "闭区间连续", "间断点",
])

/**
 * 禁止的许可证列表。
 * 包含完整名称和常见缩写变体。
 */
const FORBIDDEN_LICENSES = [
  "CC-BY-NC", "CC-BY-NC-SA", "CC-BY-NC-ND",
  "NC", "SA",
  "proprietary", "all-rights-reserved", "unknown",
]

/** 允许的 difficulty 值 */
const VALID_DIFFICULTIES = new Set([1, 2, 3])

/** 允许的 question.type 值 */
const VALID_QUESTION_TYPES = new Set([
  "concept_check", "solution", "diagnostic",
  // 考公行测
  "verbal_cloze", "verbal_reading", "verbal_order",
  "logic_translate", "logic_analogy", "logic_strengthen", "logic_definition",
  "data_compare", "data_growth", "data_proportion", "data_estimate",
  "quant_word", "quant_substitute", "quant_permcomb", "quant_inclusion",
  "sense_politics", "sense_law", "sense_economy", "sense_tech",
  // 考公申论
  "summary_practice", "analysis_practice", "countermeasure_practice",
  "implementation_practice", "outline_practice", "rewrite_practice", "structure_practice"
])

/** 允许的 seed status 值 */
const VALID_STATUSES = new Set(["draft", "approved"])

// ── 主校验函数 ────────────────────────────────────────────────────────────

/**
 * 校验全部 packs 的数据完整性
 *
 * @param inputKnowledgeSeeds - 可选，直接传入知识库 seeds（用于测试）
 * @param inputQuestionSeeds - 可选，直接传入题库 seeds（用于测试）
 */
export async function validateKnowledgePacks(
  inputKnowledgeSeeds?: KnowledgeSeed[],
  inputQuestionSeeds?: QuestionSeed[]
): Promise<ValidationResult> {
  const errors: ValidationError[] = []
  const warnings: ValidationWarning[] = []

  let knowledgeSeeds: KnowledgeSeed[] = inputKnowledgeSeeds ?? []
  let questionSeeds: QuestionSeed[] = inputQuestionSeeds ?? []

  // 1. 加载全部 seeds（如果未传入）
  if (!inputKnowledgeSeeds) {
    try {
      knowledgeSeeds = await loadAllKnowledgePacks()
    } catch (e) {
      errors.push({
        code: "LOAD_FAILED",
        message: `加载知识库 seeds 失败: ${e instanceof Error ? e.message : String(e)}`
      })
    }
  }

  if (!inputQuestionSeeds) {
    try {
      questionSeeds = await loadAllQuestionPacks()
    } catch (e) {
      errors.push({
        code: "LOAD_FAILED",
        message: `加载题库 seeds 失败: ${e instanceof Error ? e.message : String(e)}`
      })
    }
  }

  // 2. 校验 manifest expected count（按单个 pack 逐一校验）
  validateManifestCountsPerPack(PACK_MANIFEST, knowledgeSeeds, questionSeeds, errors, warnings)

  // 3. 全局唯一性
  const allNodes = knowledgeSeeds.flatMap((s) => s.nodes)
  const allQuestions = questionSeeds.flatMap((s) => s.questions)
  const allNodeIds = new Set(allNodes.map((n) => n.id))

  validateUniqueness(allNodes, "knowledge_node", errors)
  validateUniqueness(allQuestions, "question", errors)

  // 4. Prerequisite 引用有效性
  validatePrerequisites(allNodes, allNodeIds, errors)

  // 5. Question knowledgeNodeIds 引用有效性
  validateQuestionNodeRefs(allQuestions, allNodeIds, errors)

  // 6. Knowledge node required fields
  for (const seed of knowledgeSeeds) {
    for (const node of seed.nodes) {
      validateKnowledgeNode(node, seed.chapter ?? "unknown", errors, warnings)
    }
  }

  // 7. Question required fields（含 difficulty 范围校验）
  for (const seed of questionSeeds) {
    for (const question of seed.questions) {
      validateQuestion(question, seed.chapter ?? "unknown", errors, warnings)
    }
  }

  // 8. Source/license compliance（覆盖 knowledge 和 questions）
  validateSourceCompliance(allNodes, allQuestions, errors, warnings)

  // 9. Seed status validation
  validateSeedStatus(knowledgeSeeds, questionSeeds, errors, warnings)

  // 10. Approved content must also pass conservative formula-integrity checks.
  // Draft content is intentionally not blocked here: the same checks become
  // authoritative as soon as a pack is promoted to approved.
  validateApprovedContentIntegrity(knowledgeSeeds, questionSeeds, errors)

  // Summary
  const subjectCounts: Record<string, number> = {}
  for (const seed of knowledgeSeeds) {
    subjectCounts[seed.subject] = (subjectCounts[seed.subject] ?? 0) + seed.nodes.length
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    summary: {
      packCount: PACK_MANIFEST.length,
      nodeCount: allNodes.length,
      questionCount: allQuestions.length,
      subjectCounts
    }
  }
}

// ── 内部校验函数 ──────────────────────────────────────────────────────────

/**
 * 按单个 pack 逐一校验 manifest expected count。
 *
 * 严格匹配策略（双索引）：
 * 1. 优先按 (subject, chapter) 精确匹配 — 适用于 chapter 字段与 manifest 一致的 seed。
 * 2. 回退按 (subject, __packId) 精确匹配 — 适用于旧 seed 的 chapter 与 manifest 不一致的情况。
 *    __packId 由 packLoader 在运行时根据文件名注入，不写入 JSON 文件。
 * 3. 两种都匹配不到 → error（PACK_KNOWLEDGE_SEED_NOT_FOUND / PACK_QUESTION_SEED_NOT_FOUND）。
 * 4. 未被 manifest 覆盖的 orphan seed 仍报 warning。
 */
function validateManifestCountsPerPack(
  packs: KnowledgePack[],
  knowledgeSeeds: KnowledgeSeed[],
  questionSeeds: QuestionSeed[],
  errors: ValidationError[],
  warnings: ValidationWarning[]
) {
  // 索引 1：按 (subject, chapter) 精确匹配
  const knowledgeBySubjectChapter = new Map<string, KnowledgeSeed>()
  for (const seed of knowledgeSeeds) {
    if (seed.chapter) {
      knowledgeBySubjectChapter.set(`${seed.subject}::${seed.chapter}`, seed)
    }
  }
  const questionBySubjectChapter = new Map<string, QuestionSeed>()
  for (const seed of questionSeeds) {
    if (seed.chapter) {
      questionBySubjectChapter.set(`${seed.subject}::${seed.chapter}`, seed)
    }
  }

  // 索引 2：按 (subject, __packId) 精确匹配；禁止按 subject 顺序猜测。
  const knowledgeBySubjectPackId = new Map<string, KnowledgeSeed>()
  for (const seed of knowledgeSeeds) {
    if (seed.__packId) {
      knowledgeBySubjectPackId.set(`${seed.subject}::${seed.__packId}`, seed)
    }
  }
  const questionBySubjectPackId = new Map<string, QuestionSeed>()
  for (const seed of questionSeeds) {
    if (seed.__packId) {
      questionBySubjectPackId.set(`${seed.subject}::${seed.__packId}`, seed)
    }
  }

  // 跟踪哪些 seed 已被精确匹配消耗
  const consumedKnowledge = new Set<KnowledgeSeed>()
  const consumedQuestion = new Set<QuestionSeed>()

  // 逐一校验每个 pack
  for (const pack of packs) {
    const chapterKey = `${pack.subject}::${pack.chapter}`
    const packIdKey = `${pack.subject}::${pack.id}`

    // ── Knowledge seed 匹配 ──
    const knowledgeSeed =
      knowledgeBySubjectChapter.get(chapterKey) ??
      knowledgeBySubjectPackId.get(packIdKey)
    if (knowledgeSeed) {
      consumedKnowledge.add(knowledgeSeed)
    }

    if (knowledgeSeed) {
      if (knowledgeSeed.nodes.length !== pack.expectedNodeCount) {
        errors.push({
          packId: pack.id,
          code: "PACK_NODE_COUNT_MISMATCH",
          message: `Pack ${pack.id} (${pack.subject}/${pack.chapter}): manifest 预期 ${pack.expectedNodeCount} 节点，实际 ${knowledgeSeed.nodes.length}`
        })
      }
    } else {
      errors.push({
        packId: pack.id,
        code: "PACK_KNOWLEDGE_SEED_NOT_FOUND",
        message: `Pack ${pack.id} (${pack.subject}/${pack.chapter}): 未找到匹配的 knowledge seed`
      })
    }

    // ── Question seed 匹配 ──
    const questionSeed =
      questionBySubjectChapter.get(chapterKey) ??
      questionBySubjectPackId.get(packIdKey)
    if (questionSeed) {
      consumedQuestion.add(questionSeed)
    }

    if (questionSeed) {
      if (questionSeed.questions.length !== pack.expectedQuestionCount) {
        errors.push({
          packId: pack.id,
          code: "PACK_QUESTION_COUNT_MISMATCH",
          message: `Pack ${pack.id} (${pack.subject}/${pack.chapter}): manifest 预期 ${pack.expectedQuestionCount} 题目，实际 ${questionSeed.questions.length}`
        })
      }
    } else {
      errors.push({
        packId: pack.id,
        code: "PACK_QUESTION_SEED_NOT_FOUND",
        message: `Pack ${pack.id} (${pack.subject}/${pack.chapter}): 未找到匹配的 question seed`
      })
    }
  }

  // Orphan seed 检查（warning）
  for (const seed of knowledgeSeeds) {
    if (!consumedKnowledge.has(seed)) {
      warnings.push({
        code: "ORPHAN_KNOWLEDGE_SEED",
        message: `Knowledge seed (${seed.subject}/${seed.chapter ?? "?"}) 不在 PACK_MANIFEST 中，有 ${seed.nodes.length} 个节点`
      })
    }
  }
  for (const seed of questionSeeds) {
    if (!consumedQuestion.has(seed)) {
      warnings.push({
        code: "ORPHAN_QUESTION_SEED",
        message: `Question seed (${seed.subject}/${seed.chapter ?? "?"}) 不在 PACK_MANIFEST 中，有 ${seed.questions.length} 道题目`
      })
    }
  }
}

function validateUniqueness(
  items: Array<{ id: string }>,
  type: string,
  errors: ValidationError[]
) {
  const seen = new Set<string>()
  for (const item of items) {
    if (seen.has(item.id)) {
      errors.push({
        code: `${type.toUpperCase()}_DUPLICATE_ID`,
        message: `${type} ID 重复: ${item.id}`
      })
    }
    seen.add(item.id)
  }
}

function validatePrerequisites(
  nodes: KnowledgeSeedNode[],
  allNodeIds: Set<string>,
  errors: ValidationError[]
) {
  for (const node of nodes) {
    for (const prereq of node.prerequisites ?? []) {
      if (!allNodeIds.has(prereq) && !BASE_CONCEPTS.has(prereq)) {
        errors.push({
          code: "INVALID_PREREQUISITE",
          message: `节点 ${node.id} 引用了不存在的 prerequisite: ${prereq}`
        })
      }
    }
  }
}

function validateQuestionNodeRefs(
  questions: QuestionSeedItem[],
  allNodeIds: Set<string>,
  errors: ValidationError[]
) {
  for (const q of questions) {
    for (const nodeId of q.knowledgeNodeIds ?? []) {
      if (!allNodeIds.has(nodeId)) {
        errors.push({
          code: "INVALID_NODE_REFERENCE",
          message: `题目 ${q.id} 引用了不存在的节点: ${nodeId}`
        })
      }
    }
  }
}

function validateKnowledgeNode(
  node: KnowledgeSeedNode,
  chapter: string,
  errors: ValidationError[],
  warnings: ValidationWarning[]
) {
  // difficulty 校验：如果存在，只允许 1、2、3
  if (node.difficulty !== undefined && node.difficulty !== null && !VALID_DIFFICULTIES.has(node.difficulty)) {
    errors.push({
      packId: chapter,
      code: "INVALID_NODE_DIFFICULTY",
      message: `节点 ${node.id} difficulty=${node.difficulty}，只允许 1/2/3`
    })
  }

  if (!node.summary || node.summary.trim().length === 0) {
    errors.push({
      packId: chapter,
      code: "MISSING_SUMMARY",
      message: `节点 ${node.id} 缺少 summary`
    })
  }

  if (!Array.isArray(node.misconceptions) || node.misconceptions.length === 0) {
    warnings.push({
      packId: chapter,
      code: "MISSING_MISCONCEPTIONS",
      message: `节点 ${node.id} 缺少 misconceptions`
    })
  }

  if (!Array.isArray(node.socraticHints) || node.socraticHints.length < 3) {
    errors.push({
      packId: chapter,
      code: "MISSING_HINTS",
      message: `节点 ${node.id} socraticHints 不足 3 条`
    })
  } else {
    const levels = new Set(node.socraticHints.map((h) => h.level))
    if (!levels.has("L1") || !levels.has("L2") || !levels.has("L3")) {
      errors.push({
        packId: chapter,
        code: "INCOMPLETE_HINT_LEVELS",
        message: `节点 ${node.id} socraticHints 缺少 L1/L2/L3`
      })
    }
  }
}

/**
 * 校验题目字段。
 * difficulty 只允许 1、2、3；4/5/字符串/null 均报错。
 * type 只允许 concept_check / solution / diagnostic。
 */
function validateQuestion(
  question: QuestionSeedItem,
  chapter: string,
  errors: ValidationError[],
  warnings: ValidationWarning[]
) {
  // type 校验：只允许 concept_check / solution / diagnostic
  if (!question.type || question.type.trim().length === 0) {
    errors.push({
      packId: chapter,
      code: "MISSING_QUESTION_TYPE",
      message: `题目 ${question.id} 缺少 type 字段`
    })
  } else if (!VALID_QUESTION_TYPES.has(question.type)) {
    errors.push({
      packId: chapter,
      code: "INVALID_QUESTION_TYPE",
      message: `题目 ${question.id} type="${question.type}"，只允许 concept_check / solution / diagnostic`
    })
  }

  // difficulty 校验：只允许 1、2、3
  if (question.difficulty === undefined || question.difficulty === null) {
    errors.push({
      packId: chapter,
      code: "INVALID_DIFFICULTY",
      message: `题目 ${question.id} difficulty 缺失`
    })
  } else if (!VALID_DIFFICULTIES.has(question.difficulty)) {
    errors.push({
      packId: chapter,
      code: "INVALID_DIFFICULTY",
      message: `题目 ${question.id} difficulty=${question.difficulty}，只允许 1/2/3`
    })
  }

  if (!Array.isArray(question.hints) || question.hints.length < 3) {
    errors.push({
      packId: chapter,
      code: "MISSING_HINTS",
      message: `题目 ${question.id} hints 不足 3 条`
    })
  } else {
    const levels = new Set(question.hints.map((h) => h.level))
    if (!levels.has("L1") || !levels.has("L2") || !levels.has("L3")) {
      errors.push({
        packId: chapter,
        code: "INCOMPLETE_HINT_LEVELS",
        message: `题目 ${question.id} hints 缺少 L1/L2/L3`
      })
    }
  }

  if (!question.answer || question.answer.trim().length === 0) {
    errors.push({
      packId: chapter,
      code: "MISSING_ANSWER",
      message: `题目 ${question.id} 缺少 answer`
    })
  }

  if (!Array.isArray(question.solutionSteps) || question.solutionSteps.length === 0) {
    warnings.push({
      packId: chapter,
      code: "MISSING_SOLUTION_STEPS",
      message: `题目 ${question.id} 缺少 solutionSteps`
    })
  }
}

/**
 * 校验 source/license 合规性，同时覆盖 knowledge nodes 和 questions。
 *
 * - source.title 和 source.license 缺失 → error
 * - sourceType 缺失 → warning
 * - 使用禁止许可证 → error
 */
function validateSourceCompliance(
  nodes: KnowledgeSeedNode[],
  questions: QuestionSeedItem[],
  errors: ValidationError[],
  warnings: ValidationWarning[]
) {
  for (const node of nodes) {
    if (!node.source?.title || !node.source?.license) {
      errors.push({
        code: "MISSING_SOURCE",
        message: `节点 ${node.id} 缺少 source.title 或 source.license`
      })
    }
    if (!node.source?.sourceType) {
      warnings.push({
        code: "MISSING_SOURCE_TYPE",
        message: `节点 ${node.id} 缺少 source.sourceType`
      })
    }

    const license = (node.source?.license ?? "").toUpperCase()
    for (const forbidden of FORBIDDEN_LICENSES) {
      if (license.includes(forbidden.toUpperCase())) {
        errors.push({
          code: "FORBIDDEN_LICENSE",
          message: `节点 ${node.id} 使用了禁止的 license: ${node.source?.license}`
        })
      }
    }
  }

  for (const q of questions) {
    if (!q.source?.title || !q.source?.license) {
      errors.push({
        code: "MISSING_SOURCE",
        message: `题目 ${q.id} 缺少 source.title 或 source.license`
      })
    }
    if (!q.source?.sourceType) {
      warnings.push({
        code: "MISSING_SOURCE_TYPE",
        message: `题目 ${q.id} 缺少 source.sourceType`
      })
    }

    // 题目也要检查禁止许可证
    const license = (q.source?.license ?? "").toUpperCase()
    for (const forbidden of FORBIDDEN_LICENSES) {
      if (license.includes(forbidden.toUpperCase())) {
        errors.push({
          code: "FORBIDDEN_LICENSE",
          message: `题目 ${q.id} 使用了禁止的 license: ${q.source?.license}`
        })
      }
    }
  }
}

/**
 * 校验 seed root status 和 manifest-seed 一致性。
 *
 * - 缺失 status → error（不允许静默当成 approved）
 * - 不允许的值 → error
 * - manifest status 与 seed status 不一致 → error
 */
function seedLabel(seed: { __packId?: string; subject?: string; chapter?: string }): string {
  return seed.__packId ?? [seed.subject, seed.chapter].filter(Boolean).join("/") ?? "unknown"
}

function validateSeedStatus(
  knowledgeSeeds: KnowledgeSeed[],
  questionSeeds: QuestionSeed[],
  errors: ValidationError[],
  warnings: ValidationWarning[]
) {
  // 构建 packId → manifest status 映射
  const manifestStatusMap = new Map<string, string>()
  for (const pack of PACK_MANIFEST) {
    manifestStatusMap.set(pack.id, pack.status)
  }

  for (const seed of knowledgeSeeds) {
    const label = seedLabel(seed)
    const packId = seed.__packId
    if (!seed.status) {
      errors.push({
        packId: packId ?? seed.chapter,
        code: "MISSING_STATUS",
        message: `知识库 ${label} 缺少 status 字段。每个 seed 文件必须声明 status 为 "approved" 或 "draft"。`
      })
    } else if (!VALID_STATUSES.has(seed.status)) {
      errors.push({
        packId: packId ?? seed.chapter,
        code: "INVALID_STATUS",
        message: `知识库 ${label} status="${seed.status}"，只允许 draft 或 approved`
      })
    } else if (packId && manifestStatusMap.has(packId)) {
      const manifestStatus = manifestStatusMap.get(packId)
      if (manifestStatus !== seed.status) {
        errors.push({
          packId,
          code: "STATUS_MISMATCH",
          message: `知识库 ${label} manifest 声明 status="${manifestStatus}"，但 seed JSON 声明 status="${seed.status}"。两者必须一致。`
        })
      }
    }
  }

  for (const seed of questionSeeds) {
    const label = seedLabel(seed)
    const packId = seed.__packId
    if (!seed.status) {
      errors.push({
        packId: packId ?? seed.chapter,
        code: "MISSING_STATUS",
        message: `题库 ${label} 缺少 status 字段。每个 seed 文件必须声明 status 为 "approved" 或 "draft"。`
      })
    } else if (!VALID_STATUSES.has(seed.status)) {
      errors.push({
        packId: packId ?? seed.chapter,
        code: "INVALID_STATUS",
        message: `题库 ${label} status="${seed.status}"，只允许 draft 或 approved`
      })
    } else if (packId && manifestStatusMap.has(packId)) {
      const manifestStatus = manifestStatusMap.get(packId)
      if (manifestStatus !== seed.status) {
        errors.push({
          packId,
          code: "STATUS_MISMATCH",
          message: `题库 ${label} manifest 声明 status="${manifestStatus}"，但 seed JSON 声明 status="${seed.status}"。两者必须一致。`
        })
      }
    }
  }
}

/**
 * Detect high-confidence formula corruption in approved content.
 *
 * This is deliberately conservative. It does not attempt to prove mathematical
 * correctness; it only blocks mechanical damage that has previously reached
 * release candidates:
 * - a JSON string decoding to two consecutive backslashes before a TeX command;
 * - decimal/CIDR digits rewritten as a fraction followed by another digit;
 * - unmatched TeX braces inside an inline-math segment;
 * - mismatched parentheses split across a \frac numerator/denominator.
 *
 * Draft packs remain editable and are not rejected by this gate. Promotion to
 * approved automatically activates the checks without needing another allowlist.
 */
function validateApprovedContentIntegrity(
  knowledgeSeeds: KnowledgeSeed[],
  questionSeeds: QuestionSeed[],
  errors: ValidationError[]
) {
  const approvedSeeds: Array<{
    packId: string
    items: Array<KnowledgeSeedNode | QuestionSeedItem>
  }> = [
    ...knowledgeSeeds
      .filter((seed) => seed.status === "approved")
      .map((seed) => ({
        packId: seedLabel(seed),
        items: seed.nodes
      })),
    ...questionSeeds
      .filter((seed) => seed.status === "approved")
      .map((seed) => ({
        packId: seedLabel(seed),
        items: seed.questions
      }))
  ]

  for (const seed of approvedSeeds) {
    for (const item of seed.items) {
      visitContentStrings(item, "", (field, value) => {
        const location = `${item.id}.${field}`

        if (/\\\\/.test(value)) {
          errors.push({
            packId: seed.packId,
            code: "APPROVED_LATEX_DOUBLE_ESCAPE",
            message: `${location} 解码后包含连续反斜杠，可能把 TeX 命令变成换行命令`
          })
        }

        if (/\\frac\{\d+\}\{\d+\}\d/.test(value)) {
          errors.push({
            packId: seed.packId,
            code: "APPROVED_LATEX_DIGIT_SPLIT",
            message: `${location} 包含“分数后紧跟数字”的可疑结构，可能是小数、CIDR 或整数被错误改写`
          })
        }

        for (const fraction of value.matchAll(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g)) {
          if (!hasBalancedParentheses(fraction[1]) || !hasBalancedParentheses(fraction[2])) {
            errors.push({
              packId: seed.packId,
              code: "APPROVED_LATEX_MALFORMED_FRACTION",
              message: `${location} 的分子/分母包含跨边界的不配对括号`
            })
            break
          }
        }

        for (const segment of value.matchAll(/\$([^$]*)\$/g)) {
          if (!hasBalancedTeXBraces(segment[1])) {
            errors.push({
              packId: seed.packId,
              code: "APPROVED_LATEX_UNBALANCED_BRACES",
              message: `${location} 的行内公式包含不配对的 TeX 花括号`
            })
            break
          }
        }
      })
    }
  }
}

function visitContentStrings(
  value: unknown,
  path: string,
  visitor: (path: string, value: string) => void
) {
  if (typeof value === "string") {
    visitor(path || "value", value)
    return
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => visitContentStrings(entry, `${path}[${index}]`, visitor))
    return
  }
  if (!value || typeof value !== "object") return

  for (const [key, entry] of Object.entries(value)) {
    const childPath = path ? `${path}.${key}` : key
    visitContentStrings(entry, childPath, visitor)
  }
}

function hasBalancedTeXBraces(value: string): boolean {
  let depth = 0
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]
    const escaped = index > 0 && value[index - 1] === "\\"
    if (escaped) continue
    if (char === "{") depth += 1
    if (char === "}") {
      depth -= 1
      if (depth < 0) return false
    }
  }
  return depth === 0
}

function hasBalancedParentheses(value: string): boolean {
  let depth = 0
  for (const char of value) {
    if (char === "(") depth += 1
    if (char === ")") {
      depth -= 1
      if (depth < 0) return false
    }
  }
  return depth === 0
}
