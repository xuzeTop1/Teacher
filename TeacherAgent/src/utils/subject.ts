import type { SubjectCode } from "../types/learning"

const SUBJECT_LABELS: Record<SubjectCode, string> = {
  math: "数学",
  english: "英语",
  law: "法学",
  accounting: "会计",
  programming: "编程",
  cs408: "408",
  physics: "物理",
  politics: "政治",
  management: "管理类联考",
  education: "教育学311",
  psychology: "心理学312",
  lawmaster: "法律硕士",
  xingce: "行测",
  shenlun: "申论"
}

const SUBJECT_CATEGORY: Record<string, string> = {
  xingce: "考公",
  shenlun: "考公"
}

export function subjectCategory(subjectCode: string): string {
  return SUBJECT_CATEGORY[subjectCode] ?? "其他"
}

export function subjectLabel(subjectCode: string): string {
  return SUBJECT_LABELS[subjectCode as SubjectCode] ?? subjectCode
}
