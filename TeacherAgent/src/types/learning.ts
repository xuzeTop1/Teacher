/** Built-in subject codes — exhaustive union for type safety */
export type BuiltInSubjectCode = "math" | "english" | "law" | "accounting" | "programming" | "cs408" | "physics" | "politics" | "management" | "education" | "psychology" | "lawmaster" | "xingce" | "shenlun"

/**
 * Subject code — either a built-in code or a custom subject ID (prefixed "custom-").
 * Custom subjects are user-created and stored in SQLite `custom_subjects` table.
 */
export type SubjectCode = BuiltInSubjectCode | (string & {})

/** Type guard: checks if a subject code is a built-in code */
export function isBuiltInSubject(code: string): code is BuiltInSubjectCode {
  const BUILT_IN: readonly string[] = [
    "math", "english", "law", "accounting", "programming", "cs408",
    "physics", "politics", "management", "education", "psychology",
    "lawmaster", "xingce", "shenlun"
  ]
  return BUILT_IN.includes(code)
}

/** Type guard: checks if a subject code is a custom subject (starts with "custom-") */
export function isCustomSubject(code: string): boolean {
  return code.startsWith("custom-")
}

/** Custom subject descriptor — returned from Rust list_custom_subjects */
export interface CustomSubjectDescriptor {
  id: string
  name: string
  description?: string
  scopeKeywords?: string
  reviewStatus: string
  createdAt: string
  updatedAt: string
}

/** All available subjects: built-in + custom */
export interface SubjectDescriptor {
  code: SubjectCode
  name: string
  isCustom: boolean
  /** Review status from custom_subjects table. Only set for custom subjects. */
  reviewStatus?: string
}

export interface Student {
  id: string
  displayName: string
  stage?: "college" | "postgraduate_exam" | "certification"
}

export interface KnowledgeNodeRef {
  id: string
  title: string
  subjectCode: SubjectCode
  summary?: string
  misconceptions?: string[]
  socraticHints?: Array<{
    level: "L1" | "L2" | "L3"
    text: string
  }>
  /** Private-document nodes are prompt-only and must never become shared knowledge snapshots. */
  sourceType?: "built_in_pack" | "private_document"
}

export interface StudentKnowledgeMastery {
  knowledgeNodeId: string
  title: string
  summary?: string
  masteryProbability: number
  attemptsCount: number
  correctCount: number
  lastPracticedAt?: string
  evidenceSummary?: string
  updatedAt: string
}

export interface KnowledgePrerequisite {
  targetNodeId: string
  targetTitle: string
  prerequisiteNodeId?: string
  title: string
  summary?: string
  relationType: "prerequisite" | "prerequisite_text"
  source: "knowledge_edges" | "prerequisites_json"
  weight?: number
}
