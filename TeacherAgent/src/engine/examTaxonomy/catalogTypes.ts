/**
 * 考试体系目录（ExamTaxonomy Catalog）类型定义。
 *
 * 层级模型：EXAM_TRACK（考试组）→ SUBJECT（学科/课程）→ MODULE（知识模块，可选）。
 * 数据权威来源：data/exam-taxonomy/catalog.json + src/services/knowledge/packManifest.ts。
 * 分类规则只存在于数据与 Registry 服务中，不散落在 Vue 组件或 Prompt 字符串。
 */

/** 节点类型：考试组 / 学科 / 知识模块 */
export type ExamNodeType = "EXAM_TRACK" | "SUBJECT" | "MODULE"

/** 节点审核状态：与对应 Pack 的 status 一致；draft 节点不得出题 */
export type ExamNodeStatus = "approved" | "draft"

/** 出题范围声明：一个叶子节点可覆盖多个 Pack（pack id 以 PACK_MANIFEST 为准） */
export interface QuestionScopeEntry {
  packIds: string[]
}

/** 节点来源与许可信息（遵守 docs/knowledge-base-governance.md） */
export interface ExamNodeSource {
  title: string
  license: string
  sourceType?: string
  note?: string
}

export interface ExamCatalogNode {
  /** 稳定 ID，可迁移、不依赖中文显示名；全局唯一（如 "408.data-structures"） */
  stableId: string
  /** 可选考试代码，例如 "408"；无代码为 null */
  code: string | null
  /** 中文展示名 */
  displayName: string
  /** 短标题（按钮等窄空间） */
  shortName: string
  /** 别名（精确匹配用）：中文常用简称与英文名 */
  aliases: string[]
  /** 父级 stableId；根节点（EXAM_TRACK）为 null */
  parentId: string | null
  nodeType: ExamNodeType
  status: ExamNodeStatus
  /** 该节点可检索的题目范围；只有叶子 SUBJECT/MODULE 可以非空 */
  questionScope: QuestionScopeEntry[]
  /** 旧平面学科代码（如 "cs408"），用于兼容历史 subject_mappings 与题库 seed */
  legacySubjectCode?: string
  source: ExamNodeSource
}

export interface ExamCatalogFile {
  schemaVersion: number
  catalogName: string
  updatedAt: string
  source: ExamNodeSource
  nodes: ExamCatalogNode[]
}
