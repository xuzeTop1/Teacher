import type { SubjectCode } from "./learning"

export type MemoryKind =
  | "learning_goal"
  | "preference"
  | "misconception"
  | "mastery_signal"
  | "strategy_signal"
  | "affective_signal"

export interface StudentCognitiveProfile {
  id: string
  studentId: string
  subjectCode?: SubjectCode
  learningGoals: string[]
  explanationPreferences: string[]
  recurringMisconceptions: string[]
  effectiveStrategies: string[]
  affectiveSignals: string[]
  confidence: number
  createdAt: string
  updatedAt: string
}

export interface LongTermMemoryEntry {
  id: string
  studentId: string
  subjectCode?: SubjectCode
  kind: MemoryKind
  summary: string
  evidence: string
  confidence: number
  source: "rule_reflection" | "assessment" | "user_explicit"
  createdAt: string
  updatedAt: string
}

export interface ShortTermMemorySnapshot {
  id: string
  conversationId: string
  studentId: string
  subjectCode?: SubjectCode
  summary: string
  recentFocus: string[]
  openQuestions: string[]
  lastMisconceptions: string[]
  lastMode?: string
  turnCount: number
  createdAt: string
  updatedAt: string
}

export interface StudentMemoryState {
  version: 1
  profiles: Record<string, StudentCognitiveProfile>
  shortTermSnapshots: Record<string, ShortTermMemorySnapshot>
  longTermEntries: LongTermMemoryEntry[]
}
