import type { ExamScopeFilter } from "../../types/examTaxonomy"
import type { QuestionScopeDecision } from "./planScope"
import type { LearnerGoalScope } from "./learnerGoalScope"
import { getExamNode, getExamPath } from "./registry"

export interface PracticeScopeSelection {
  trackId: string | null
  subjectId: string | null
  moduleId: string | null
  comprehensive: boolean
}

export interface PracticeScopeResolution {
  examScope: ExamScopeFilter | undefined
  blocked: boolean
  message: string | null
}

/** 为异步加载生成递增 token，只有最后启动的请求可以提交结果。 */
export function createLatestRequestGuard() {
  let latestToken = 0
  return {
    begin(): number {
      latestToken += 1
      return latestToken
    },
    isLatest(token: number): boolean {
      return token === latestToken
    }
  }
}

/** 将练习页选择与今日计划决策转换为检索门禁。 */
export function resolvePracticeScope(
  selection: PracticeScopeSelection,
  decision: QuestionScopeDecision | null,
  learnerGoal: LearnerGoalScope | null = null
): PracticeScopeResolution {
  // 手动选择始终优先；三级目录中的模块才是实际出题叶子。
  const manualLeafId = selection.moduleId ?? selection.subjectId
  if (manualLeafId) {
    return { examScope: scopeFromLeaf(manualLeafId, selection.trackId, selection.moduleId), blocked: false, message: null }
  }

  // 读模型存在时，综合模式必须使用决策实际选中的 approved 叶子。
  if (decision?.mode === "today-plan" || decision?.mode === "comprehensive") {
    if (learnerGoal?.status === "unmodeled") {
      return {
        examScope: undefined,
        blocked: true,
        message:
          `${learnerGoal.message} 今日范围为「${decision.evidenceText}」，` +
          "请先确认具体课程，避免把今日计划静默当作考研数学范围。"
      }
    }
    const leafId = decision.mode === "comprehensive"
      ? decision.strategy?.currentLeaf?.stableId ?? decision.subjectId
      : decision.subjectId
    if (leafId) {
      return { examScope: scopeFromLeaf(leafId, decision.examTrackId, decision.moduleId), blocked: false, message: null }
    }
  }

  // 同步读模型已生效但没有可靠叶子时，禁止退回普通学科任意题。
  if (decision?.mode === "requires-choice" || decision?.mode === "no-plan") {
    return {
      examScope: undefined,
      blocked: true,
      message: decision.reason ?? decision.evidenceText
    }
  }

  // 没有已选同步设备/读模型时保留历史平面学科行为。
  return { examScope: undefined, blocked: false, message: null }
}

function scopeFromLeaf(
  leafId: string,
  trackId: string | null,
  selectedModuleId: string | null
): ExamScopeFilter {
  const pathTrackId = getExamPath(leafId)[0]?.stableId ?? null
  const leaf = getExamNode(leafId)
  const moduleId = selectedModuleId ?? (leaf?.nodeType === "MODULE" ? leafId : null)
  return {
    examTrackId: trackId ?? pathTrackId,
    subjectId: leafId,
    moduleId
  }
}
