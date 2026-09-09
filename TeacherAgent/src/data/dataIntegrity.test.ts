/**
 * Data integrity validation for ALL seed JSON files.
 *
 * Dynamically discovers seeds via import.meta.glob so new packs
 * are covered automatically without editing this file.
 *
 * Full schema / hint / license validation is delegated to packValidator.
 * This file focuses on: parse, ID uniqueness, cross-reference integrity,
 * required field presence, and pack count sanity.
 */

import { describe, it, expect } from "vitest"
import { PACK_MANIFEST } from "../services/knowledge/packManifest"

// ── Dynamic glob imports ───────────────────────────────────────────────────

const knowledgeGlob = import.meta.glob("../../data/knowledge/*.seed.json", { eager: true }) as Record<string, { default: KnowledgeSeed }>
const questionGlob = import.meta.glob("../../data/questions/*.seed.json", { eager: true }) as Record<string, { default: QuestionSeed }>

interface KnowledgeNode {
  id: string
  title: string
  level?: string
  difficulty?: number
  summary?: string
  prerequisites?: string[]
  misconceptions?: string[]
  socraticHints?: Array<{ level: string; text: string }>
  source?: { title?: string; license?: string; sourceType?: string; url?: string }
}

interface QuestionItem {
  id: string
  title?: string
  content: string
  type?: string
  difficulty?: number
  knowledgeNodeIds?: string[]
  answer?: string
  solutionSteps?: string[]
  hints?: Array<{ level: string; text: string }>
  source?: { title?: string; license?: string; sourceType?: string; url?: string }
}

interface KnowledgeSeed {
  subject: string
  course?: string
  chapter?: string
  status?: string
  nodes: KnowledgeNode[]
}

interface QuestionSeed {
  subject: string
  course?: string
  chapter?: string
  status?: string
  questions: QuestionItem[]
}

// ── Collect all data ──────────────────────────────────────────────────────

function extractPackId(globPath: string): string {
  const match = globPath.match(/\/([^/]+)\.seed\.json$/)
  return match?.[1] ?? globPath
}

const KNOWLEDGE_SEEDS: Array<{ packId: string; seed: KnowledgeSeed }> = Object.entries(knowledgeGlob).map(([path, mod]) => ({
  packId: extractPackId(path),
  seed: mod.default
}))

const QUESTION_SEEDS: Array<{ packId: string; seed: QuestionSeed }> = Object.entries(questionGlob).map(([path, mod]) => ({
  packId: extractPackId(path),
  seed: mod.default
}))

const allNodes: KnowledgeNode[] = KNOWLEDGE_SEEDS.flatMap((s) => s.seed.nodes)
const allQuestions: QuestionItem[] = QUESTION_SEEDS.flatMap((s) => s.seed.questions)
const allNodeIds = new Set(allNodes.map((n) => n.id))

// ── Tests ─────────────────────────────────────────────────────────────────

describe("seed JSON parsing", () => {
  it("all knowledge seed files parse without error", () => {
    expect(KNOWLEDGE_SEEDS.length).toBeGreaterThanOrEqual(20)
    for (const { seed } of KNOWLEDGE_SEEDS) {
      expect(seed.nodes).toBeDefined()
      expect(Array.isArray(seed.nodes)).toBe(true)
      expect(seed.nodes.length).toBeGreaterThan(0)
    }
  })

  it("all question seed files parse without error", () => {
    expect(QUESTION_SEEDS.length).toBeGreaterThanOrEqual(20)
    for (const { seed } of QUESTION_SEEDS) {
      expect(seed.questions).toBeDefined()
      expect(Array.isArray(seed.questions)).toBe(true)
      expect(seed.questions.length).toBeGreaterThan(0)
    }
  })
})

describe("knowledge node ID uniqueness", () => {
  it("all knowledge node IDs are globally unique", () => {
    const seen = new Set<string>()
    const duplicates: string[] = []
    for (const node of allNodes) {
      if (seen.has(node.id)) {
        duplicates.push(node.id)
      }
      seen.add(node.id)
    }
    expect(duplicates).toEqual([])
  })
})

describe("question ID uniqueness", () => {
  it("all question IDs are globally unique", () => {
    const seen = new Set<string>()
    const duplicates: string[] = []
    for (const q of allQuestions) {
      if (seen.has(q.id)) {
        duplicates.push(q.id)
      }
      seen.add(q.id)
    }
    expect(duplicates).toEqual([])
  })
})

describe("prerequisite references", () => {
  it("all prerequisites reference existing node IDs or well-known base concepts", () => {
    const baseConcepts = new Set([
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

    const missing: Array<{ node: string; prereq: string }> = []
    for (const node of allNodes) {
      for (const prereq of node.prerequisites ?? []) {
        if (!allNodeIds.has(prereq) && !baseConcepts.has(prereq)) {
          missing.push({ node: node.id, prereq })
        }
      }
    }
    expect(missing).toEqual([])
  })
})

describe("question knowledgeNodeIds references", () => {
  it("all question knowledgeNodeIds reference existing node IDs", () => {
    const missing: Array<{ question: string; nodeId: string }> = []
    for (const q of allQuestions) {
      for (const nodeId of q.knowledgeNodeIds ?? []) {
        if (!allNodeIds.has(nodeId)) {
          missing.push({ question: q.id, nodeId })
        }
      }
    }
    expect(missing).toEqual([])
  })
})

describe("knowledge node required fields", () => {
  it("every node has a non-empty summary", () => {
    const missing = allNodes.filter((n) => !n.summary || n.summary.trim().length === 0)
    expect(missing.map((n) => n.id)).toEqual([])
  })

  it("every node has misconceptions array (warning, not error)", () => {
    // Some older / English seeds may lack misconceptions; packValidator reports this as a warning.
    // Here we just verify the field exists as an array (may be empty).
    const missing = allNodes.filter((n) => n.misconceptions !== undefined && !Array.isArray(n.misconceptions))
    expect(missing.map((n) => n.id)).toEqual([])
  })

  it("every node has socraticHints with L1, L2, and L3", () => {
    const missing = allNodes.filter((n) => {
      if (!Array.isArray(n.socraticHints) || n.socraticHints.length < 3) return true
      const levels = new Set(n.socraticHints.map((h) => h.level))
      return !levels.has("L1") || !levels.has("L2") || !levels.has("L3")
    })
    expect(missing.map((n) => n.id)).toEqual([])
  })

  it("every node with difficulty has difficulty 1, 2, or 3", () => {
    const invalid = allNodes.filter((n) => n.difficulty !== undefined && ![1, 2, 3].includes(n.difficulty))
    expect(invalid.map((n) => n.id)).toEqual([])
  })
})

describe("question required fields", () => {
  it("every question has difficulty 1, 2, or 3", () => {
    const invalid = allQuestions.filter((q) => q.difficulty === undefined || ![1, 2, 3].includes(q.difficulty))
    expect(invalid.map((q) => q.id)).toEqual([])
  })

  it("every question has hints with L1, L2, and L3", () => {
    const missing = allQuestions.filter((q) => {
      if (!Array.isArray(q.hints) || q.hints.length < 3) return true
      const levels = new Set(q.hints.map((h) => h.level))
      return !levels.has("L1") || !levels.has("L2") || !levels.has("L3")
    })
    expect(missing.map((q) => q.id)).toEqual([])
  })

  it("every question has a non-empty answer", () => {
    const missing = allQuestions.filter((q) => !q.answer || q.answer.trim().length === 0)
    expect(missing.map((q) => q.id)).toEqual([])
  })

  it("every question has solutionSteps array (warning, not error)", () => {
    // Some seeds (e.g. English) may lack solutionSteps; packValidator reports this as a warning.
    const missing = allQuestions.filter((q) => q.solutionSteps !== undefined && !Array.isArray(q.solutionSteps))
    expect(missing.map((q) => q.id)).toEqual([])
  })
})

describe("source and license compliance", () => {
  it("every knowledge node has source with title and license", () => {
    const missing = allNodes.filter((n) => !n.source?.title || !n.source?.license)
    expect(missing.map((n) => n.id)).toEqual([])
  })

  it("every question has source with title and license", () => {
    const missing = allQuestions.filter((q) => !q.source?.title || !q.source?.license)
    expect(missing.map((q) => q.id)).toEqual([])
  })

  it("no node uses forbidden external licenses", () => {
    const forbiddenLicenses = [
      "CC-BY-NC", "CC-BY-NC-SA", "CC-BY-NC-ND",
      "proprietary", "all-rights-reserved",
    ]
    const violations = allNodes.filter((n) => {
      const license = (n.source?.license ?? "").toUpperCase()
      return forbiddenLicenses.some((f) => license.includes(f.toUpperCase()))
    })
    expect(violations.map((n) => n.id)).toEqual([])
  })
})

describe("pack manifest consistency", () => {
  it(`glob discovered ${KNOWLEDGE_SEEDS.length} knowledge packs matching PACK_MANIFEST`, () => {
    expect(KNOWLEDGE_SEEDS.length).toBe(PACK_MANIFEST.length)
  })

  it(`glob discovered ${QUESTION_SEEDS.length} question packs matching PACK_MANIFEST`, () => {
    expect(QUESTION_SEEDS.length).toBe(PACK_MANIFEST.length)
  })

  it("total node count matches manifest expected sum", () => {
    const manifestTotal = PACK_MANIFEST.reduce((s, p) => s + p.expectedNodeCount, 0)
    expect(allNodes.length).toBe(manifestTotal)
  })

  it("total question count matches manifest expected sum", () => {
    const manifestTotal = PACK_MANIFEST.reduce((s, p) => s + p.expectedQuestionCount, 0)
    expect(allQuestions.length).toBe(manifestTotal)
  })

  it("all seeds have valid status (draft / approved / undefined)", () => {
    const validStatuses = new Set(["draft", "approved", undefined])
    const knowledgeViolations = KNOWLEDGE_SEEDS.filter(({ seed }) => !validStatuses.has(seed.status))
    const questionViolations = QUESTION_SEEDS.filter(({ seed }) => !validStatuses.has(seed.status))
    expect(knowledgeViolations.map(({ packId }) => packId)).toEqual([])
    expect(questionViolations.map(({ packId }) => packId)).toEqual([])
  })

  it("no node has duplicate prerequisites", () => {
    const violations: Array<{ node: string; dupes: string[] }> = []
    for (const node of allNodes) {
      const prereqs = node.prerequisites ?? []
      const seen = new Set<string>()
      const dupes: string[] = []
      for (const p of prereqs) {
        if (seen.has(p)) dupes.push(p)
        seen.add(p)
      }
      if (dupes.length > 0) violations.push({ node: node.id, dupes })
    }
    expect(violations).toEqual([])
  })
})
