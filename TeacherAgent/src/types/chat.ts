import type { PlannerResult } from "./planner"

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
  role: ChatRole
  content: string
  plannerResult?: PlannerResult
  knowledgeRefsJson?: string
  toolRefsJson?: string
  guardrailJson?: string
  isStreaming?: boolean
  attachments?: ChatAttachment[]
}
