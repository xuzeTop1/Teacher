/**
 * 题目归属与范围校验测试（验收组 B 延伸 + 五.1 题库检索硬约束）。
 *
 * 覆盖：
 * - approved 过滤：draft pack 不进入结果；
 * - 叶子范围过滤：只允许请求 subjectId 的题目进入；
 * - 父级范围（只有 408）拒绝出题，不允许仅有考试组标签的题目绕过筛选；
 * - 跨考试组、跨具体科目混入被拒绝；
 * - 结构化校验：题目归属与请求范围一致才通过。
 */

import { describe, expect, it } from "vitest"
import {
  attributionsForPack,
  collectApprovedKnowledgeNodeIdsForScope,
  deriveModuleId,
  filterSeedsToScope,
  isLeafApprovedForQuestions,
  isPackApproved,
  isPackInScope,
  validateQuestionScope,
  type ExamScopeFilter
} from "./questionScope"
import type { ExamCatalogNode } from "./catalogTypes"
import type { QuestionSeed, QuestionSeedItem } from "../../services/knowledge/packLoader"

function makeNode(stableId: string, nodeType: ExamCatalogNode["nodeType"]): ExamCatalogNode {
  return {
    stableId,
    code: null,
    displayName: stableId,
    shortName: stableId,
    aliases: [],
    parentId: null,
    nodeType,
    status: "approved",
    questionScope: [],
    source: { title: "test", license: "original" }
  }
}

function makeSeed(packId: string, status: "approved" | "draft", questions: QuestionSeedItem[]): QuestionSeed {
  return {
    __packId: packId,
    subject: "cs408",
    chapter: packId,
    status,
    questions
  }
}

function makeQuestion(id: string, overrides: Partial<QuestionSeedItem> = {}): QuestionSeedItem {
  return {
    id,
    title: `题-${id}`,
    content: "题目内容",
    type: "concept_check",
    difficulty: 2,
    knowledgeNodeIds: ["node-1"],
    answer: "A",
    source: { title: "test", license: "original" },
    ...overrides
  }
}

const NETWORK_FILTER: ExamScopeFilter = {
  examTrackId: "408",
  subjectId: "408.computer-networks",
  moduleId: null
}

const OS_FILTER: ExamScopeFilter = {
  examTrackId: "408",
  subjectId: "408.operating-systems",
  moduleId: null
}

describe("题目归属推导", () => {
  it("cs408-computer-networks pack 归属到 408.computer-networks 叶子", () => {
    const attributions = attributionsForPack("cs408-computer-networks")
    expect(attributions.length).toBeGreaterThanOrEqual(1)
    const network = attributions.find((a) => a.subjectId === "408.computer-networks")
    expect(network).toBeDefined()
    expect(network!.examTrackId).toBe("408")
    expect(network!.leafApproved).toBe(true)
  })

  it("draft 叶子（操作系统）leafApproved=false", () => {
    const attributions = attributionsForPack("cs408-operating-systems")
    const os = attributions.find((a) => a.subjectId === "408.operating-systems")
    expect(os).toBeDefined()
    expect(os!.leafApproved).toBe(false)
  })

  it("isLeafApprovedForQuestions：只有 approved 叶子可以出题", () => {
    expect(isLeafApprovedForQuestions("408.computer-networks")).toBe(true)
    expect(isLeafApprovedForQuestions("408.operating-systems")).toBe(false)
    expect(isLeafApprovedForQuestions("408")).toBe(false)
    expect(isLeafApprovedForQuestions("not-exist")).toBe(false)
  })

  it("isPackInScope：pack 必须属于请求的叶子范围", () => {
    expect(isPackInScope("cs408-computer-networks", NETWORK_FILTER)).toBe(true)
    expect(isPackInScope("cs408-computer-networks", OS_FILTER)).toBe(false)
    expect(isPackInScope("cs408-operating-systems", NETWORK_FILTER)).toBe(false)
  })
})

describe("approved 门禁（P1：防漂移硬校验）", () => {
  it("只有 PACK_MANIFEST approved 的 pack 通过白名单", () => {
    expect(isPackApproved("cs408-computer-networks")).toBe(true)
    expect(isPackApproved("cs408-operating-systems")).toBe(false)
    expect(isPackApproved("cs408-data-structures")).toBe(false)
    expect(isPackApproved("not-exist")).toBe(false)
  })

  it("叶子出题门禁：叶子 approved 且 questionScope 的 pack 全部 approved", () => {
    expect(isLeafApprovedForQuestions("408.computer-networks")).toBe(true)
    expect(isLeafApprovedForQuestions("408.operating-systems")).toBe(false)
    expect(isLeafApprovedForQuestions("408")).toBe(false)
  })

  it("Manifest 非 approved 的 pack 即使在请求范围内也被拒绝（白名单优先于归属）", () => {
    // OS pack 属于 OS 请求范围，但 Manifest 是 draft → 拒绝（门禁 1 先行）。
    const check = validateQuestionScope("cs408-operating-systems", makeQuestion("q-os"), OS_FILTER)
    expect(check.ok).toBe(false)
    expect(check.reason).toContain("不是 approved")
  })

  it("filterSeedsToScope 对 Manifest 非 approved 的 pack 直接过滤（不进结果）", () => {
    const { questions, rejected } = filterSeedsToScope(
      [makeSeed("cs408-operating-systems", "approved", [makeQuestion("q-os-1")])],
      OS_FILTER
    )
    // seed JSON 伪造为 approved 也不能绕过：Manifest 白名单为准。
    expect(questions).toHaveLength(0)
    expect(rejected).toHaveLength(0) // pack 级过滤，不进入 rejected 统计
  })
})

describe("moduleId 推导（P2：三层层级正确性）", () => {
  it("叶子是 MODULE 时 moduleId 返回自身（不会错误赋值为父级 Subject）", () => {
    const track = makeNode("track", "EXAM_TRACK")
    const subject = makeNode("track.subject", "SUBJECT")
    const module = makeNode("track.subject.module", "MODULE")
    const path = [track, subject, module]
    // 三层路径：moduleId 必须是 MODULE 自身，而不是 path[length-2]（父级 SUBJECT）。
    expect(deriveModuleId(module, path)).toBe("track.subject.module")
  })

  it("叶子是 SUBJECT 时 moduleId 为 null", () => {
    const track = makeNode("track", "EXAM_TRACK")
    const subject = makeNode("track.subject", "SUBJECT")
    expect(deriveModuleId(subject, [track, subject])).toBeNull()
  })
})

describe("共享 Pack 归属（P1/P2：attribution 必须匹配请求叶子）", () => {
  it("归属匹配：请求网络叶子时返回网络归属", () => {
    const check = validateQuestionScope("cs408-computer-networks", makeQuestion("q-net"), NETWORK_FILTER)
    expect(check.ok).toBe(true)
    expect(check.attribution?.subjectId).toBe("408.computer-networks")
    expect(check.attribution?.examTrackId).toBe("408")
  })

  it("pack approved 但归属不匹配时拒绝（不属于请求的叶子）", () => {
    // cs408-computer-networks 是 approved，但请求考研英语语法叶子 → 归属不匹配被拒绝。
    const englishFilter: ExamScopeFilter = {
      examTrackId: "kaoyan-english",
      subjectId: "kaoyan-english.grammar",
      moduleId: null
    }
    const check = validateQuestionScope("cs408-computer-networks", makeQuestion("q-net"), englishFilter)
    expect(check.ok).toBe(false)
    expect(check.reason).toContain("不属于请求的叶子")
  })

  it("filterSeedsToScope 返回的题目 attribution 与请求叶子一致（不取第一条归属）", () => {
    const { questions } = filterSeedsToScope(
      [makeSeed("cs408-computer-networks", "approved", [makeQuestion("q-net-1")])],
      NETWORK_FILTER
    )
    expect(questions[0].subjectId).toBe("408.computer-networks")
    expect(questions[0].examTrackId).toBe("408")
  })
})

describe("结构化校验（五.1 硬约束）", () => {
  it("请求范围缺少具体叶子 subjectId → 拒绝（只有考试组不得出题）", () => {
    const check = validateQuestionScope("cs408-computer-networks", makeQuestion("q1"), {
      examTrackId: "408",
      subjectId: null,
      moduleId: null
    })
    expect(check.ok).toBe(false)
    expect(check.reason).toContain("缺少具体叶子")
  })

  it("网络题校验通过（归属一致 + approved）", () => {
    const check = validateQuestionScope("cs408-computer-networks", makeQuestion("q1"), NETWORK_FILTER)
    expect(check.ok).toBe(true)
    expect(check.attribution?.subjectId).toBe("408.computer-networks")
  })

  it("操作系统 pack 的题在请求网络范围时被拒绝（draft pack 白名单拦截）", () => {
    const check = validateQuestionScope("cs408-operating-systems", makeQuestion("q-os"), NETWORK_FILTER)
    expect(check.ok).toBe(false)
    expect(check.reason).toContain("不是 approved")
  })

  it("不存在的 pack 被白名单拒绝（不是 approved）", () => {
    const check = validateQuestionScope("not-exist-pack", makeQuestion("q-x"), NETWORK_FILTER)
    expect(check.ok).toBe(false)
    expect(check.reason).toContain("不是 approved")
  })

  it("draft 叶子的题即使归属正确也被拒绝（未审核不得出题）", () => {
    const check = validateQuestionScope("cs408-operating-systems", makeQuestion("q-os"), OS_FILTER)
    expect(check.ok).toBe(false)
    expect(check.reason).toContain("approved")
  })

  it("跨考试组混入被拒绝（管理类联考 pack 请求 408 范围）", () => {
    const check = validateQuestionScope("management-logic", makeQuestion("q-mgmt"), NETWORK_FILTER)
    expect(check.ok).toBe(false)
  })
})

describe("范围过滤（filterSeedsToScope）", () => {
  it("今日计划=计算机网络：只返回网络 pack 的题，其他 pack 的题被拒绝并统计", () => {
    const seeds = [
      makeSeed("cs408-computer-networks", "approved", [
        makeQuestion("q-net-1"),
        makeQuestion("q-net-2")
      ]),
      makeSeed("cs408-operating-systems", "draft", [makeQuestion("q-os-1")]),
      makeSeed("cs408-data-structures", "draft", [makeQuestion("q-ds-1")]),
      makeSeed("cs408-computer-organization", "draft", [makeQuestion("q-co-1")])
    ]
    const { questions, rejected } = filterSeedsToScope(seeds, NETWORK_FILTER)
    expect(questions.map((q) => q.id).sort()).toEqual(["q-net-1", "q-net-2"])
    expect(questions.every((q) => q.subjectId === "408.computer-networks")).toBe(true)
    expect(questions.every((q) => q.examTrackId === "408")).toBe(true)
    // 操作系统/数据结构/组成原理：draft 直接被 approved 过滤（不计入 rejected 统计），
    // 或者如果未来 approved 也会因范围不符被拒绝——总之绝不能进入结果。
    expect(rejected.some((r) => r.includes("q-os-1"))).toBe(false) // draft 未加载即被过滤
    expect(questions.some((q) => q.id.startsWith("q-os") || q.id.startsWith("q-ds") || q.id.startsWith("q-co"))).toBe(false)
  })

  it("请求操作系统范围时不会混入网络题", () => {
    const seeds = [
      makeSeed("cs408-computer-networks", "approved", [makeQuestion("q-net-1")])
    ]
    const { questions, rejected } = filterSeedsToScope(seeds, OS_FILTER)
    expect(questions).toHaveLength(0)
    expect(rejected.length).toBeGreaterThan(0)
    expect(rejected[0]).toContain("不属于请求的叶子")
  })

  it("非 408 范围（考研英语）请求网络题被拒绝", () => {
    const englishFilter: ExamScopeFilter = {
      examTrackId: "kaoyan-english",
      subjectId: "kaoyan-english.grammar",
      moduleId: null
    }
    const { questions, rejected } = filterSeedsToScope(
      [makeSeed("cs408-computer-networks", "approved", [makeQuestion("q-net-1")])],
      englishFilter
    )
    expect(questions).toHaveLength(0)
    expect(rejected.length).toBeGreaterThan(0)
  })

  it("返回的题目带完整归属（examTrackId/subjectId/moduleId/packId）", () => {
    const { questions } = filterSeedsToScope(
      [makeSeed("cs408-computer-networks", "approved", [makeQuestion("q-net-1")])],
      NETWORK_FILTER
    )
    const question = questions[0]
    expect(question.examTrackId).toBe("408")
    expect(question.subjectId).toBe("408.computer-networks")
    expect(question.moduleId).toBeNull()
    expect(question.packId).toBe("cs408-computer-networks")
    expect(question.leafApproved).toBe(true)
  })
})

describe("掌握度查询范围白名单", () => {
  it("approved 计网叶子返回自身知识点，draft 操作系统叶子返回空", async () => {
    const networkIds = await collectApprovedKnowledgeNodeIdsForScope(NETWORK_FILTER)
    expect(networkIds.length).toBeGreaterThan(0)
    expect(new Set(networkIds).size).toBe(networkIds.length)

    const operatingSystemIds = await collectApprovedKnowledgeNodeIdsForScope(OS_FILTER)
    expect(operatingSystemIds).toEqual([])
  })

  it("无具体叶子范围返回空，不允许退回 teacherSubjectId 全学科", async () => {
    await expect(collectApprovedKnowledgeNodeIdsForScope({ examTrackId: "408", subjectId: null, moduleId: null }))
      .resolves.toEqual([])
  })
})
