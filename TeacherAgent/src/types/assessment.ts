import type { HintLevel } from "./agent"
import type { KnowledgeNodeRef, SubjectCode } from "./learning"

export type AssessmentMode = "turn_assessment" | "diagnostic_assessment"
export type AssessmentCorrectness = "correct" | "partially_correct" | "incorrect" | "unknown"
export type AssessmentNextAction = "continue" | "hint" | "explain_concept" | "practice" | "review"
export type DiagnosticOverallLevel = "foundation_gap" | "developing" | "solid" | "advanced" | "unknown"

/** Durable provenance written only by the AlertTime sync diagnostic path. */
export interface DiagnosticProvenance {
  origin: "alerttime_sync_diagnostic_v1"
  questionId: string
  alertSubjectRemoteId: string
  examTrackId: string | null
  examSubjectId: string | null
  examModuleId: string | null
}

export interface AssessmentKnowledgeUpdate {
  knowledgeNodeId: string
  masteryDelta: number
  correctness: AssessmentCorrectness
  reason: string
}

export interface AssessmentDiagnosticReport {
  overallLevel: DiagnosticOverallLevel
  strengths: string[]
  weaknesses: string[]
  recommendedPriorities: string[]
  evidenceSummary: string
}

export interface AssessmentResult {
  id: string
  studentId: string
  conversationId: string
  subjectCode: SubjectCode
  assessmentMode: AssessmentMode
  correctness: AssessmentCorrectness
  confidence: number
  evidence: string
  knowledgeUpdates: AssessmentKnowledgeUpdate[]
  knowledgeSnapshots: KnowledgeNodeRef[]
  detectedMisconceptions: string[]
  suggestedNextAction: AssessmentNextAction
  diagnosticReport?: AssessmentDiagnosticReport
  diagnosticProvenance?: DiagnosticProvenance
  createdAt: string
}

export interface AssessmentAgentInput {
  studentId: string
  conversationId: string
  subjectCode: SubjectCode
  userMessage: string
  tutorReply: string
  mode?: string
  maxHintLevel: HintLevel
  knowledgeNodes?: KnowledgeNodeRef[]
  recentMessages?: Array<{ role: string; content: string }>
}
