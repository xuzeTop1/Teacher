import type { SubjectCode } from "./learning"

export type PlannerTrigger =
  | "user_requested_next_step"
  | "user_requested_schedule"
  | "phase_completed"
  | "diagnostic_completed"
  | "review_due"

export type PlannerTaskType = "learn" | "review" | "practice" | "diagnose" | "reflect"

export interface PlannerTask {
  id: string
  type: PlannerTaskType
  title: string
  rationale: string
  estimatedMinutes: number
  priority: "low" | "medium" | "high"
}

export interface PlannerResult {
  trigger: PlannerTrigger
  subjectCode: SubjectCode
  summary: string
  nextTasks: PlannerTask[]
  reviewFocus: string[]
  masterySignals: string[]
  prerequisiteSignals: string[]
  reviewDueSignals: string[]
  chapterSignals: string[]
  planningHorizon: "next_turn" | "today" | "this_week"
  confidence: number
}
