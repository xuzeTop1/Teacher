import type { StudentKnowledgeMastery } from "../../types/learning"
import type {
  QuestionBankSearchInput,
  QuestionBankSearchOutput,
  ToolResult
} from "../../types/tool"
import { searchLocalQuestionBankLazy } from "../questions/localQuestionBankSearch"
import { collectApprovedKnowledgeNodeIdsForScope } from "../questions/scopedKnowledgeNodeIds"
import { loadStudentKnowledge } from "../tauri/commands"

export interface PracticeDataLoadInput {
  studentId: string
  subjectCode: string
  searchInput: QuestionBankSearchInput
  blocked: boolean
  blockedMessage: string | null
}

export interface PracticeDataSnapshot {
  studentKnowledge: StudentKnowledgeMastery[]
  questions: QuestionBankSearchOutput["questions"]
  error: string | null
  rejected: string[]
}

export type PracticeDataLoadResult =
  | { status: "stale" }
  | { status: "ready"; snapshot: PracticeDataSnapshot }

export interface PracticeDataLoaderDependencies {
  collectKnowledgeNodeIds: typeof collectApprovedKnowledgeNodeIdsForScope
  loadMastery: typeof loadStudentKnowledge
  searchQuestions: typeof searchLocalQuestionBankLazy
}

const defaultDependencies: PracticeDataLoaderDependencies = {
  collectKnowledgeNodeIds: collectApprovedKnowledgeNodeIdsForScope,
  loadMastery: loadStudentKnowledge,
  searchQuestions: searchLocalQuestionBankLazy
}

export function selectWeakKnowledgeNodeIds(
  mastery: StudentKnowledgeMastery[]
): string[] {
  return mastery
    .filter((item) => item.masteryProbability < 0.7)
    .sort((left, right) => left.masteryProbability - right.masteryProbability)
    .slice(0, 5)
    .map((item) => item.knowledgeNodeId)
}

/**
 * 串行完成 scope 白名单、掌握度与最终题目搜索。
 *
 * 每次 load 都推进 generation；任何旧 generation 在异步边界后只返回 stale，
 * 因而不能把旧叶子的 mastery 或题目提交到新范围。
 */
export function createPracticeDataLoader(
  dependencies: PracticeDataLoaderDependencies = defaultDependencies
) {
  let generation = 0

  return {
    invalidate(): void {
      generation += 1
    },

    async load(input: PracticeDataLoadInput): Promise<PracticeDataLoadResult> {
      const requestGeneration = ++generation
      const isLatest = () => requestGeneration === generation

      if (input.blocked) {
        return {
          status: "ready",
          snapshot: {
            studentKnowledge: [],
            questions: [],
            error: input.blockedMessage ?? "请先选择具体考试课程",
            rejected: []
          }
        }
      }

      try {
        const whitelist = input.searchInput.examScope
          ? await dependencies.collectKnowledgeNodeIds(input.searchInput.examScope)
          : undefined
        if (!isLatest()) return { status: "stale" }

        let studentKnowledge: StudentKnowledgeMastery[] = []
        try {
          studentKnowledge = await dependencies.loadMastery(
            input.studentId,
            input.subjectCode,
            20,
            whitelist
          )
        } catch {
          // Web preview / unavailable Tauri keeps the historical question fallback.
        }
        if (!isLatest()) return { status: "stale" }

        const weakNodeIds = selectWeakKnowledgeNodeIds(studentKnowledge)
        const searchResult = await dependencies.searchQuestions({
          ...input.searchInput,
          knowledgeNodeIds: weakNodeIds.length > 0 ? weakNodeIds : undefined
        })
        if (!isLatest()) return { status: "stale" }

        return {
          status: "ready",
          snapshot: snapshotFromSearch(studentKnowledge, searchResult)
        }
      } catch (error) {
        if (!isLatest()) return { status: "stale" }
        return {
          status: "ready",
          snapshot: {
            studentKnowledge: [],
            questions: [],
            error: error instanceof Error ? error.message : "加载题目失败",
            rejected: []
          }
        }
      }
    }
  }
}

function snapshotFromSearch(
  studentKnowledge: StudentKnowledgeMastery[],
  result: ToolResult<QuestionBankSearchOutput>
): PracticeDataSnapshot {
  const questions = result.ok && result.data ? result.data.questions : []
  let error = result.ok ? null : result.error ?? "加载题目失败"
  if (result.ok && result.rejected?.length && questions.length === 0) {
    error = "该课程没有可用的 approved 题目（题库待审核或不属于该范围）"
  }
  return {
    studentKnowledge,
    questions,
    error,
    rejected: result.rejected ?? []
  }
}
