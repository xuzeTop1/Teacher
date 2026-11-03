import type { PlannerResult } from "./planner"
import type { AssessmentResult } from "./assessment"

export type ChatRole = "student" | "tutor"

export interface ChatAttachment {
  id: string
  type: "image"
  mimeType: string
  name?: string
  size?: number
  dataUrl: string
}

export interface ChatMessage {
  id: string
  createdAt?: string
  role: ChatRole
  content: string
  plannerResult?: PlannerResult
  knowledgeRefsJson?: string
  toolRefsJson?: string
  guardrailJson?: string
  isStreaming?: boolean
  attachments?: ChatAttachment[]
  isError?: boolean
  errorType?: "missing_provider" | "llm_error"
  retryPrompt?: string
  assessmentResult?: AssessmentResult
  isSavingAssessment?: boolean
}
