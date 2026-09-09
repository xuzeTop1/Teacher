import type { HintLevel } from "./agent"
import type { KnowledgeNodeRef, SubjectCode } from "./learning"
import type { MemoryKind } from "./memory"

export type ObservedPerformance = "correct" | "partially_correct" | "incorrect" | "unknown"
export type ReflectionStrategy = "socratic_question" | "analogy" | "counterexample" | "step_hint" | "direct_explanation"
export type StrategyEffect = "helpful" | "neutral" | "unhelpful" | "unknown"
export type NextBestActionType = "review" | "practice" | "explain_concept" | "continue_problem" | "assess"

export interface ReflectionKnowledgeUpdate {
  knowledgeNodeId: string
  observedPerformance: ObservedPerformance
  masteryDelta: number
  evidence: string
  confidence: number
}

export interface ReflectionMisconception {
  type: string
  observation: string
  inference: string
  confidence: number
}

export interface ReflectionStrategyInsight {
  strategy: ReflectionStrategy
  effect: StrategyEffect
  evidence: string
}

export interface ReflectionNextBestAction {
  type: NextBestActionType
  reason: string
}

export interface ReflectionRecord {
  id: string
  conversationId: string
  studentId: string
  subjectCode: SubjectCode
  conversationSummary: string
  observations: string[]
  inferences: string[]
  uncertainties: string[]
  knowledgeUpdates: ReflectionKnowledgeUpdate[]
  misconceptions: ReflectionMisconception[]
  strategyInsights: ReflectionStrategyInsight[]
  nextBestAction: ReflectionNextBestAction
  confidence: number
  createdAt: string
}

export interface ReflectionMemoryCandidate {
  kind: MemoryKind
  summary: string
  evidence: string
  confidence: number
  source: "rule_reflection" | "user_explicit"
}

export interface ReflectionProfileUpdates {
  learningGoals: string[]
  explanationPreferences: string[]
  recurringMisconceptions: string[]
  effectiveStrategies: string[]
  affectiveSignals: string[]
  confidenceDelta: number
}

export interface ReflectionAgentInput {
  studentId: string
  conversationId: string
  subjectCode: SubjectCode
  userMessage: string
  tutorReply: string
  recentMessages?: Array<{ role: string; content: string }>
  mode: string
  maxHintLevel: HintLevel
  strategy: string
  knowledgeNodes?: KnowledgeNodeRef[]
}

export interface ReflectionAgentResult {
  record: ReflectionRecord
  profileUpdates: ReflectionProfileUpdates
  memoryCandidates: ReflectionMemoryCandidate[]
}
