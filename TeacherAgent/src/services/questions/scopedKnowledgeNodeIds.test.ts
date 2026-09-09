import { describe, expect, it } from "vitest"
import type { ExamScopeFilter } from "../../types/examTaxonomy"
import type { QuestionSeed } from "../knowledge/packLoader"
import {
  collectApprovedKnowledgeNodeIdsForScope,
  collectApprovedKnowledgeNodeIdsFromSeeds
} from "./scopedKnowledgeNodeIds"

const NETWORK_SCOPE: ExamScopeFilter = {
  examTrackId: "408",
  subjectId: "408.computer-networks",
  moduleId: null
}

describe("collectApprovedKnowledgeNodeIdsForScope", () => {
  it("collects all unique approved network node ids without operating-system nodes", async () => {
    const ids = await collectApprovedKnowledgeNodeIdsForScope(NETWORK_SCOPE)

    expect(ids.length).toBeGreaterThan(10)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.some((id) => id.startsWith("cs408-cn-"))).toBe(true)
    // 该节点来自题库最后一题，证明收集基于全量 scoped 题目而非最终 topK 10。
    expect(ids).toContain("cs408-cn-nat")
    expect(ids.some((id) => id.startsWith("cs408-os-"))).toBe(false)
  })

  it("does not trust a draft Manifest pack even when its seed claims approved", () => {
    const forgedDraftSeed: QuestionSeed = {
      __packId: "cs408-operating-systems",
      subject: "cs408",
      status: "approved",
      questions: [
        {
          id: "q-os",
          content: "操作系统题",
          type: "concept_check",
          difficulty: 1,
          knowledgeNodeIds: ["cs408-os-process"],
          source: { title: "test", license: "original" }
        }
      ]
    }

    expect(
      collectApprovedKnowledgeNodeIdsFromSeeds([forgedDraftSeed], {
        examTrackId: "408",
        subjectId: "408.operating-systems",
        moduleId: null
      })
    ).toEqual([])
  })
})
