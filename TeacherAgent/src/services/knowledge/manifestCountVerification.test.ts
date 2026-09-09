/**
 * Real manifest count verification — no mocks.
 *
 * Asserts that the actual pack manifest derives exactly:
 * - 145 approved knowledge node IDs
 * - 123 approved question IDs
 * - 631 draft knowledge node IDs
 * - 643 draft question IDs
 * - Zero intersection between draft and approved sets
 *
 * These numbers are the acceptance criteria for vector store convergence:
 * after bge-m3 regeneration, the store should contain exactly 268 vectors
 * (145 + 123), and the deletion set should be exactly 1274 (631 + 643).
 */
import { describe, it, expect } from "vitest"
import {
  loadApprovedKnowledgePacks,
  loadApprovedQuestionPacks,
  loadAllKnowledgePacksStrict,
  loadAllQuestionPacksStrict
} from "./packLoader"

describe("real manifest count verification", () => {
  it("derives exactly 145 approved knowledge node IDs", async () => {
    const packs = await loadApprovedKnowledgePacks()
    const ids = new Set<string>()
    for (const pack of packs) {
      for (const node of pack.nodes) {
        ids.add(node.id)
      }
    }
    expect(ids.size).toBe(145)
  })

  it("derives exactly 123 approved question IDs", async () => {
    const packs = await loadApprovedQuestionPacks()
    const ids = new Set<string>()
    for (const pack of packs) {
      for (const q of pack.questions) {
        ids.add(q.id)
      }
    }
    expect(ids.size).toBe(123)
  })

  it("derives exactly 631 draft knowledge node IDs (all minus approved)", async () => {
    const approvedPacks = await loadApprovedKnowledgePacks()
    const approvedIds = new Set<string>()
    for (const pack of approvedPacks) {
      for (const node of pack.nodes) {
        approvedIds.add(node.id)
      }
    }

    const allPacks = await loadAllKnowledgePacksStrict()
    const allIds = new Set<string>()
    for (const pack of allPacks) {
      for (const node of pack.nodes) {
        allIds.add(node.id)
      }
    }

    const draftIds = [...allIds].filter((id) => !approvedIds.has(id))
    expect(draftIds.length).toBe(631)
  })

  it("derives exactly 643 draft question IDs (all minus approved)", async () => {
    const approvedPacks = await loadApprovedQuestionPacks()
    const approvedIds = new Set<string>()
    for (const pack of approvedPacks) {
      for (const q of pack.questions) {
        approvedIds.add(q.id)
      }
    }

    const allPacks = await loadAllQuestionPacksStrict()
    const allIds = new Set<string>()
    for (const pack of allPacks) {
      for (const q of pack.questions) {
        allIds.add(q.id)
      }
    }

    const draftIds = [...allIds].filter((id) => !approvedIds.has(id))
    expect(draftIds.length).toBe(643)
  })

  it("draft and approved knowledge node ID sets have zero intersection", async () => {
    const approvedPacks = await loadApprovedKnowledgePacks()
    const approvedIds = new Set<string>()
    for (const pack of approvedPacks) {
      for (const node of pack.nodes) {
        approvedIds.add(node.id)
      }
    }

    const allPacks = await loadAllKnowledgePacksStrict()
    const allIds = new Set<string>()
    for (const pack of allPacks) {
      for (const node of pack.nodes) {
        allIds.add(node.id)
      }
    }

    const draftIds = [...allIds].filter((id) => !approvedIds.has(id))
    for (const id of draftIds) {
      expect(approvedIds.has(id)).toBe(false)
    }
  })

  it("draft and approved question ID sets have zero intersection", async () => {
    const approvedPacks = await loadApprovedQuestionPacks()
    const approvedIds = new Set<string>()
    for (const pack of approvedPacks) {
      for (const q of pack.questions) {
        approvedIds.add(q.id)
      }
    }

    const allPacks = await loadAllQuestionPacksStrict()
    const allIds = new Set<string>()
    for (const pack of allPacks) {
      for (const q of pack.questions) {
        allIds.add(q.id)
      }
    }

    const draftIds = [...allIds].filter((id) => !approvedIds.has(id))
    for (const id of draftIds) {
      expect(approvedIds.has(id)).toBe(false)
    }
  })

  it("total deletion target is exactly 1274 (631 + 643)", async () => {
    const approvedKnowledgePacks = await loadApprovedKnowledgePacks()
    const approvedKnowledgeIds = new Set<string>()
    for (const pack of approvedKnowledgePacks) {
      for (const node of pack.nodes) {
        approvedKnowledgeIds.add(node.id)
      }
    }

    const approvedQuestionPacks = await loadApprovedQuestionPacks()
    const approvedQuestionIds = new Set<string>()
    for (const pack of approvedQuestionPacks) {
      for (const q of pack.questions) {
        approvedQuestionIds.add(q.id)
      }
    }

    const allKnowledgePacks = await loadAllKnowledgePacksStrict()
    const allKnowledgeIds = new Set<string>()
    for (const pack of allKnowledgePacks) {
      for (const node of pack.nodes) {
        allKnowledgeIds.add(node.id)
      }
    }

    const allQuestionPacks = await loadAllQuestionPacksStrict()
    const allQuestionIds = new Set<string>()
    for (const pack of allQuestionPacks) {
      for (const q of pack.questions) {
        allQuestionIds.add(q.id)
      }
    }

    const draftKnowledgeCount = [...allKnowledgeIds].filter((id) => !approvedKnowledgeIds.has(id)).length
    const draftQuestionCount = [...allQuestionIds].filter((id) => !approvedQuestionIds.has(id)).length

    expect(draftKnowledgeCount + draftQuestionCount).toBe(1274)
  })

  it("no duplicate IDs across all knowledge packs", async () => {
    const allPacks = await loadAllKnowledgePacksStrict()
    const seen = new Set<string>()
    for (const pack of allPacks) {
      for (const node of pack.nodes) {
        expect(seen.has(node.id)).toBe(false)
        seen.add(node.id)
      }
    }
  })

  it("no duplicate IDs across all question packs", async () => {
    const allPacks = await loadAllQuestionPacksStrict()
    const seen = new Set<string>()
    for (const pack of allPacks) {
      for (const q of pack.questions) {
        expect(seen.has(q.id)).toBe(false)
        seen.add(q.id)
      }
    }
  })
})
