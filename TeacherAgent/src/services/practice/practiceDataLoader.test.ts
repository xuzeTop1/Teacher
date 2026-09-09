import { describe, expect, it, vi } from "vitest"
import type { StudentKnowledgeMastery } from "../../types/learning"
import type { QuestionBankSearchInput } from "../../types/tool"
import {
  createPracticeDataLoader,
  type PracticeDataLoaderDependencies
} from "./practiceDataLoader"

function mastery(
  knowledgeNodeId: string,
  masteryProbability: number
): StudentKnowledgeMastery {
  return {
    knowledgeNodeId,
    title: knowledgeNodeId,
    masteryProbability,
    attemptsCount: 1,
    correctCount: 0,
    updatedAt: "2026-08-11T00:00:00Z"
  }
}

function searchInput(subjectId: string): QuestionBankSearchInput {
  return {
    subject: "cs408",
    purpose: "practice",
    topK: 10,
    excludeRecentlyUsed: false,
    examScope: {
      examTrackId: "408",
      subjectId,
      moduleId: null
    }
  }
}

function readySearch(questionId: string) {
  return {
    ok: true,
    data: {
      questions: [
        {
          questionId,
          content: questionId,
          type: "concept_check" as const,
          difficulty: 1,
          knowledgeNodeIds: [],
          hints: [],
          source: { id: "test", title: "test", license: "original" },
          score: 1
        }
      ]
    }
  }
}

describe("createPracticeDataLoader", () => {
  it("keeps the legacy no-examScope mastery query unchanged", async () => {
    const collectKnowledgeNodeIds = vi.fn()
    const loadMastery = vi.fn().mockResolvedValue([
      mastery("cs408-os-process", 0.2)
    ])
    const searchQuestions = vi.fn().mockResolvedValue(readySearch("q-legacy"))
    const loader = createPracticeDataLoader({
      collectKnowledgeNodeIds,
      loadMastery,
      searchQuestions
    } as PracticeDataLoaderDependencies)

    await loader.load({
      studentId: "student-1",
      subjectCode: "cs408",
      searchInput: {
        subject: "cs408",
        purpose: "practice",
        topK: 10,
        excludeRecentlyUsed: false
      },
      blocked: false,
      blockedMessage: null
    })

    expect(collectKnowledgeNodeIds).not.toHaveBeenCalled()
    expect(loadMastery).toHaveBeenCalledWith(
      "student-1",
      "cs408",
      20,
      undefined
    )
    expect(searchQuestions).toHaveBeenCalledWith(
      expect.objectContaining({ knowledgeNodeIds: ["cs408-os-process"] })
    )
  })

  it("loads cs408 network mastery with the approved leaf whitelist only", async () => {
    const collectKnowledgeNodeIds = vi.fn().mockResolvedValue([
      "cs408-cn-ip",
      "cs408-cn-tcp"
    ])
    const loadMastery = vi.fn().mockResolvedValue([
      mastery("cs408-cn-ip", 0.2),
      mastery("cs408-cn-tcp", 0.9)
    ])
    const searchQuestions = vi.fn().mockResolvedValue(readySearch("q-network"))
    const loader = createPracticeDataLoader({
      collectKnowledgeNodeIds,
      loadMastery,
      searchQuestions
    } as PracticeDataLoaderDependencies)

    const result = await loader.load({
      studentId: "student-1",
      subjectCode: "cs408",
      searchInput: searchInput("408.computer-networks"),
      blocked: false,
      blockedMessage: null
    })

    expect(loadMastery).toHaveBeenCalledWith(
      "student-1",
      "cs408",
      20,
      ["cs408-cn-ip", "cs408-cn-tcp"]
    )
    expect(loadMastery.mock.calls[0][3]).not.toContain("cs408-os-process")
    expect(searchQuestions).toHaveBeenCalledWith(
      expect.objectContaining({ knowledgeNodeIds: ["cs408-cn-ip"] })
    )
    expect(result).toMatchObject({
      status: "ready",
      snapshot: {
        studentKnowledge: [
          expect.objectContaining({ knowledgeNodeId: "cs408-cn-ip" }),
          expect.objectContaining({ knowledgeNodeId: "cs408-cn-tcp" })
        ]
      }
    })
  })

  it("passes an explicit empty whitelist instead of falling back to subject mastery", async () => {
    const loadMastery = vi.fn().mockResolvedValue([])
    const loader = createPracticeDataLoader({
      collectKnowledgeNodeIds: vi.fn().mockResolvedValue([]),
      loadMastery,
      searchQuestions: vi.fn().mockResolvedValue(readySearch("q-empty"))
    } as PracticeDataLoaderDependencies)

    await loader.load({
      studentId: "student-1",
      subjectCode: "cs408",
      searchInput: searchInput("408.empty-leaf"),
      blocked: false,
      blockedMessage: null
    })

    expect(loadMastery).toHaveBeenCalledWith("student-1", "cs408", 20, [])
  })

  it("prevents an old scope mastery request from committing after a rapid switch", async () => {
    let releaseOld = (_value: StudentKnowledgeMastery[]) => {}
    const oldMastery = new Promise<StudentKnowledgeMastery[]>((resolve) => {
      releaseOld = resolve
    })
    const loadMastery = vi.fn(
      async (_studentId: string, _subjectCode: string, _limit: number, ids?: string[]) => {
        if (ids?.includes("old-node")) return oldMastery
        return [mastery("new-node", 0.3)]
      }
    )
    const loader = createPracticeDataLoader({
      collectKnowledgeNodeIds: vi.fn(async (scope) =>
        scope.subjectId === "408.old" ? ["old-node"] : ["new-node"]
      ),
      loadMastery,
      searchQuestions: vi.fn().mockResolvedValue(readySearch("q-new"))
    } as PracticeDataLoaderDependencies)

    const oldRequest = loader.load({
      studentId: "student-1",
      subjectCode: "cs408",
      searchInput: searchInput("408.old"),
      blocked: false,
      blockedMessage: null
    })
    await vi.waitFor(() => expect(loadMastery).toHaveBeenCalledTimes(1))

    const newResult = await loader.load({
      studentId: "student-1",
      subjectCode: "cs408",
      searchInput: searchInput("408.new"),
      blocked: false,
      blockedMessage: null
    })
    releaseOld([mastery("old-node", 0.1)])
    const oldResult = await oldRequest

    expect(newResult).toMatchObject({
      status: "ready",
      snapshot: {
        studentKnowledge: [expect.objectContaining({ knowledgeNodeId: "new-node" })]
      }
    })
    expect(oldResult).toEqual({ status: "stale" })
  })

  it("a blocked scope invalidates pending work and returns empty mastery and questions", async () => {
    let releaseOld = (_value: StudentKnowledgeMastery[]) => {}
    const oldMastery = new Promise<StudentKnowledgeMastery[]>((resolve) => {
      releaseOld = resolve
    })
    const loader = createPracticeDataLoader({
      collectKnowledgeNodeIds: vi.fn().mockResolvedValue(["old-node"]),
      loadMastery: vi.fn().mockReturnValue(oldMastery),
      searchQuestions: vi.fn().mockResolvedValue(readySearch("q-old"))
    } as PracticeDataLoaderDependencies)

    const oldRequest = loader.load({
      studentId: "student-1",
      subjectCode: "cs408",
      searchInput: searchInput("408.old"),
      blocked: false,
      blockedMessage: null
    })
    const blockedResult = await loader.load({
      studentId: "student-1",
      subjectCode: "cs408",
      searchInput: searchInput("408"),
      blocked: true,
      blockedMessage: "请选择具体课程"
    })
    releaseOld([mastery("old-node", 0.1)])

    expect(await oldRequest).toEqual({ status: "stale" })
    expect(blockedResult).toEqual({
      status: "ready",
      snapshot: {
        studentKnowledge: [],
        questions: [],
        error: "请选择具体课程",
        rejected: []
      }
    })
  })
})
