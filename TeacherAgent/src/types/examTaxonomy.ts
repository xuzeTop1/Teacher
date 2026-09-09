/**
 * 考试体系（ExamTaxonomy）共享类型。
 *
 * 层级模型：EXAM_TRACK（考试组）→ SUBJECT（学科/课程）→ MODULE（知识模块）。
 * 数据权威来源：data/exam-taxonomy/catalog.json + src/services/knowledge/packManifest.ts。
 * 本文件只放跨模块共享的类型，分类规则在 src/engine/examTaxonomy/。
 */

/** 节点类型：考试组 / 学科 / 知识模块 */
export type ExamNodeType = "EXAM_TRACK" | "SUBJECT" | "MODULE"

/** 题目检索范围过滤（硬约束：必须有具体叶子 subjectId，不允许只有考试组） */
export interface ExamScopeFilter {
  examTrackId: string | null
  subjectId: string | null
  moduleId: string | null
}

/** 题目归属信息（由 pack → 目录叶子推导，随题目返回） */
export interface QuestionAttribution {
  examTrackId: string | null
  subjectId: string
  moduleId: string | null
  /** 归属推导依据的 pack */
  packId: string
  /** 叶子节点是否 approved（draft 叶子不得出题） */
  leafApproved: boolean
}
