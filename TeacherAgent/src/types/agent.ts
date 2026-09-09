export type HintLevel = "L0" | "L1" | "L2" | "L3" | "L4"

export interface AgentContext {
  conversationId: string
  studentId: string
  subjectCode: string
  hintCeiling: HintLevel
}

export interface CombinedPlanDraft {
  intent: string
  strategy: string
  hintLevel: HintLevel
  draft: string
  requiresGuardrailLlm: boolean
}
