/**
 * 今日计划驱动出题规则（Plan-Driven Question Scope）
 *
 * 依据：手机同步来的「今日真实计划、进行中计划、已完成计划、学习时长和科目映射」。
 * 规则优先级（docs/decisions/2026-08-03-alerttime-lan-sync.md 与考试体系扩展）：
 *
 * 1. 用户明确选择具体考试组 / 课程 / 模块 → 严格按所选叶子范围出题。
 * 2. 用户未选择，但今日计划已可靠映射到具体叶子科目 → 按今日计划的具体科目出题。
 * 3. 今日计划只映射到父级考试组（如只有「408」）→ 必须要求用户选择子科目，
 *    或明确进入「综合复习」模式（轮换 / 掌握度最低优先，且展示实际选择的子科目）。
 * 4. 没有今日计划或没有可靠映射 → 提示用户选择考试组和具体课程；
 *    不得伪造「根据今日计划」；不得返回任意默认 408 题。
 * 5. 学习时长只用于推荐难度、复习节奏与反馈，不得作为掌握度依据。
 *
 * 本模块只做「范围决策」，不加载题目；题目检索与校验在 questionScope.ts。
 */

import type { SyncReadModel, SyncTask } from "../../types/sync"
import type { ExamCatalogNode } from "./catalogTypes"
import {
  getDescendantLeaves,
  getExamNode,
  getExamPath,
  isQuestionScopeNode,
  resolveByLegacyCode,
  resolveByPhoneName
} from "./registry"
import { isLeafApprovedForQuestions } from "./questionScope"

export type PlanScopeMode =
  | "explicit" // 用户明确选择叶子范围
  | "today-plan" // 今日计划映射到叶子科目
  | "comprehensive" // 用户选择父级考试组并明确进入综合复习
  | "requires-choice" // 今日计划只到父级考试组，必须选择子科目或进入综合模式
  | "no-plan" // 没有今日计划 / 没有可靠映射

export type MappingStatus = "mapped" | "pending-confirm" | "unmapped"

/** 手机科目 → 考试体系节点的解析结果 */
export interface SubjectResolution {
  alertSubjectRemoteId: string
  alertSubjectName: string
  status: MappingStatus
  /** 解析到的节点；pending-confirm / unmapped 时为空 */
  node: ExamCatalogNode | null
  /** pending-confirm：同名候选（要求用户确认） */
  candidates: ExamCatalogNode[]
  /** 解析依据：user_mapping / alias / phone-declared / none */
  via: "user_mapping" | "alias" | "phone_declared" | "none"
  reason: string
}

/** 今日计划中单条任务的解析 */
export interface PlanTaskResolution {
  task: SyncTask
  subjectName: string | null
  resolution: SubjectResolution | null
}

export interface UserSelection {
  examTrackId: string | null
  subjectId: string | null
  moduleId: string | null
  /** 用户是否明确进入综合复习模式（父级范围） */
  comprehensive?: boolean
}

export interface ComprehensiveStrategy {
  kind: "rotation" | "weakness-first"
  /** 当前实际可出题（approved）且纳入轮换的叶子节点 */
  leaves: ExamCatalogNode[]
  /** 当前轮换命中的叶子（弱项优先时为掌握度最低的叶子） */
  currentLeaf: ExamCatalogNode | null
}

export interface PlanEvidence {
  taskRemoteId: string
  taskTitle: string
  subjectName: string
  status: "pending" | "completed"
  durationSeconds: number | null
}

export interface QuestionScopeDecision {
  mode: PlanScopeMode
  /** 考试组（父级） */
  examTrackId: string | null
  /** 具体叶子学科 */
  subjectId: string | null
  /** 知识模块（可选） */
  moduleId: string | null
  /** 展示给用户的推荐依据文本 */
  evidenceText: string
  /** 今日计划证据明细 */
  evidence: PlanEvidence[]
  /** 需要用户先做选择（UI 引导） */
  needsUserChoice: boolean
  /** 综合复习策略（mode=comprehensive 时非空） */
  strategy: ComprehensiveStrategy | null
  /** 未映射原因说明（mode=no-plan / requires-choice 时非空） */
  reason: string | null
}

export interface PlanScopeInput {
  /** 今日任务（未删除的 type=1 计划，dueAt 在今日；已完成与未完成都算今日真实计划） */
  todayTasks: SyncTask[]
  /** 读模型中的科目（用于把 task.subjectRemoteId 解析为科目名） */
  subjects: SyncReadModel["subjects"]
  /** 用户映射表：alertSubjectRemoteId → teacherSubjectId（兼容旧值）或 examSubjectId（新值） */
  mappings: Array<{
    alertSubjectRemoteId: string
    teacherSubjectId: string
    examTrackId?: string | null
    examSubjectId?: string | null
  }>
  /** 用户显式选择（可为空） */
  selection: UserSelection
  /** 综合复习时的弱项顺序（stableId → mastery，弱项优先用） */
  weakMastery?: Record<string, number>
  /** 本轮轮换偏移（UI 可传入；默认 0 从第一门开始） */
  rotationOffset?: number
  /** 手机科目声明（DTO 可选字段），作为解析补充依据 */
  declaredExam?: Record<string, { trackId: string | null; subjectId: string | null; moduleId: string | null }>
  nowMs?: number
}

// ── 今日任务筛选 ─────────────────────────────────────────────────────────

/** 任务是否属于「今日真实计划」：type=1 计划、未删除、dueAt 在今日。 */
export function isTodayPlan(task: SyncTask, nowMs: number): boolean {
  if (task.deletedAt !== null) return false
  if (task.type !== 1) return false
  if (task.dueAt === null) return false
  return sameLocalDay(task.dueAt, nowMs)
}

export function sameLocalDay(leftMs: number, rightMs: number): boolean {
  const left = new Date(leftMs)
  const right = new Date(rightMs)
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  )
}

// ── 手机科目解析 ─────────────────────────────────────────────────────────

/**
 * 解析一个手机科目到考试体系节点。
 * 优先级：用户映射（考试叶子）→ 精确别名匹配（唯一命中）→ 手机声明字段（需确认）→ unresolved。
 * 映射结果必须可解释、可编辑、可撤销（UI 负责）；本函数不做任何写操作。
 */
export function resolveSubject(
  alertSubjectRemoteId: string,
  alertSubjectName: string,
  mappings: PlanScopeInput["mappings"],
  declaredExam: PlanScopeInput["declaredExam"]
): SubjectResolution {
  // 1. 用户映射表：优先解析为考试体系叶子（examSubjectId），兼容旧 teacherSubjectId 值。
  const mapping = mappings.find((m) => m.alertSubjectRemoteId === alertSubjectRemoteId)
  if (mapping) {
    const mappedLeaf = mapping.examSubjectId ? getExamNode(mapping.examSubjectId) : null
    if (mappedLeaf && isQuestionScopeNode(mappedLeaf.stableId)) {
      return {
        alertSubjectRemoteId,
        alertSubjectName,
        status: "mapped",
        node: mappedLeaf,
        candidates: [],
        via: "user_mapping",
        reason: `用户已映射到 ${mappedLeaf.displayName}`
      }
    }
    // 旧映射值（如 "cs408" 或考试组 stableId "408"）不能直接当叶子：
    // 它是考试组，必须由用户重新选择子科目。
    const trackCandidate =
      getExamNode(mapping.teacherSubjectId) ??
      resolveByLegacyCode(mapping.teacherSubjectId).find((n) => n.nodeType === "EXAM_TRACK") ??
      null
    if (trackCandidate && trackCandidate.nodeType === "EXAM_TRACK") {
      return {
        alertSubjectRemoteId,
        alertSubjectName,
        status: "pending-confirm",
        node: trackCandidate,
        candidates: [],
        via: "user_mapping",
        reason: `旧映射「${trackCandidate.displayName}」是考试组，需要选择具体子科目`
      }
    }
    if (mappedLeaf) {
      return {
        alertSubjectRemoteId,
        alertSubjectName,
        status: "pending-confirm",
        node: mappedLeaf,
        candidates: [],
        via: "user_mapping",
        reason: "映射目标不是叶子出题节点，需要确认具体课程"
      }
    }
    return {
      alertSubjectRemoteId,
      alertSubjectName,
      status: "unmapped",
      node: null,
      candidates: [],
      via: "none",
      reason: "用户映射目标已失效"
    }
  }

  // 2. 精确别名匹配（含展示名与短名）。
  const candidates = resolveByPhoneName(alertSubjectName)
  if (candidates.length === 1) {
    const node = candidates[0]
    if (node.nodeType === "EXAM_TRACK" || !isQuestionScopeNode(node.stableId)) {
      return {
        alertSubjectRemoteId,
        alertSubjectName,
        status: "pending-confirm",
        node,
        candidates: [node],
        via: "alias",
        reason: `「${alertSubjectName}」匹配到考试组/非叶子节点，需要选择具体课程`
      }
    }
    return {
      alertSubjectRemoteId,
      alertSubjectName,
      status: "mapped",
      node,
      candidates: [node],
      via: "alias",
      reason: `「${alertSubjectName}」精确匹配 ${node.displayName}`
    }
  }
  if (candidates.length > 1) {
    return {
      alertSubjectRemoteId,
      alertSubjectName,
      status: "pending-confirm",
      node: null,
      candidates,
      via: "alias",
      reason: `「${alertSubjectName}」匹配到多个候选，需要用户确认`
    }
  }

  // 3. 手机端声明字段（DTO 可选字段）作为补充依据，但不能自动采用（需用户确认）。
  const declared = declaredExam?.[alertSubjectRemoteId]
  if (declared?.subjectId) {
    const node = getExamNode(declared.subjectId)
    if (node && isQuestionScopeNode(node.stableId)) {
      return {
        alertSubjectRemoteId,
        alertSubjectName,
        status: "pending-confirm",
        node,
        candidates: [node],
        via: "phone_declared",
        reason: `手机端声明属于 ${node.displayName}，需要用户确认映射`
      }
    }
  }

  // 4. 未解析。
  return {
    alertSubjectRemoteId,
    alertSubjectName,
    status: "unmapped",
    node: null,
    candidates: [],
    via: "none",
    reason: `「${alertSubjectName}」未映射到考试体系，保留为未映射自定义科目`
  }
}

// ── 今日计划解析 ─────────────────────────────────────────────────────────

/** 解析全部今日计划到考试体系叶子。 */
export function resolveTodayPlan(
  todayTasks: SyncTask[],
  subjects: SyncReadModel["subjects"],
  mappings: PlanScopeInput["mappings"],
  declaredExam: PlanScopeInput["declaredExam"]
): PlanTaskResolution[] {
  const nameOf = new Map<string, string>()
  for (const subject of subjects) {
    nameOf.set(subject.remoteId, subject.name)
  }
  return todayTasks.map((task) => {
    const subjectName = task.subjectRemoteId ? (nameOf.get(task.subjectRemoteId) ?? null) : null
    const resolution =
      task.subjectRemoteId && subjectName
        ? resolveSubject(task.subjectRemoteId, subjectName, mappings, declaredExam)
        : null
    return { task, subjectName, resolution }
  })
}

// ── 范围决策 ─────────────────────────────────────────────────────────────

/**
 * 出题范围决策（规则优先级见文件头注释）。
 * 纯函数：不做 I/O、不写映射表；UI 根据结果引导用户。
 */
export function decideQuestionScope(input: PlanScopeInput): QuestionScopeDecision {
  const nowMs = input.nowMs ?? Date.now()
  const todayTasks = input.todayTasks.filter((task) => isTodayPlan(task, nowMs))
  const resolutions = resolveTodayPlan(todayTasks, input.subjects, input.mappings, input.declaredExam)
  const evidence: PlanEvidence[] = resolutions.map(({ task, subjectName, resolution }) => ({
    taskRemoteId: task.remoteId,
    taskTitle: task.title,
    subjectName: subjectName ?? "未分类",
    status: task.status === 1 ? "completed" : "pending",
    durationSeconds: task.targetDurationSeconds
  }))

  // 规则 1：用户明确选择 → 严格按所选叶子范围出题（含综合模式）。
  if (input.selection.moduleId) {
    if (isQuestionScopeNode(input.selection.moduleId)) {
      return leafDecision("explicit", input.selection.moduleId, evidence, "用户明确选择了模块范围")
    }
    return blockedDecision(
      "requires-choice",
      input.selection.examTrackId ?? input.selection.subjectId ?? input.selection.moduleId,
      evidence,
      "所选模块不是可出题的叶子节点"
    )
  }
  if (input.selection.subjectId) {
    if (isQuestionScopeNode(input.selection.subjectId)) {
      return leafDecision("explicit", input.selection.subjectId, evidence, "用户明确选择了课程范围")
    }
    return blockedDecision(
      "requires-choice",
      input.selection.examTrackId ?? input.selection.subjectId,
      evidence,
      "所选课程不是可出题的叶子节点"
    )
  }
  if (input.selection.examTrackId) {
    if (input.selection.comprehensive) {
      return comprehensiveDecision(input, evidence)
    }
    // 用户只选了考试组但未进入综合模式：不能直接出题。
    return blockedDecision(
      "requires-choice",
      input.selection.examTrackId,
      evidence,
      "已选择考试组，请选择具体课程或进入综合复习模式"
    )
  }

  // 规则 2/3：基于今日计划。
  if (todayTasks.length > 0) {
    // 今日计划映射到的叶子集合（去重）。
    const leafHits = resolutions
      .map((r) => r.resolution)
      .filter((r): r is SubjectResolution & { node: ExamCatalogNode } =>
        Boolean(r && r.status === "mapped" && r.node && isQuestionScopeNode(r.node.stableId))
      )
    const uniqueLeaves = dedupeByStableId(leafHits.map((r) => r.node))

    if (uniqueLeaves.length === 1) {
      // 规则 2：今日计划已可靠映射到具体叶子科目。
      const leaf = uniqueLeaves[0]
      const planTitle = evidence.map((e) => `『${e.taskTitle}』`).join("、")
      return leafDecision(
        "today-plan",
        leaf.stableId,
        evidence,
        `根据你今天的${leaf.displayName}计划（${planTitle}）与学习记录生成`
      )
    }
    if (uniqueLeaves.length > 1) {
      // 多门叶子科目同日：不可混合出题（不允许跨科目混入题目），要求用户选择或按其中一门。
      return blockedDecision(
        "requires-choice",
        null,
        evidence,
        `今日计划包含多门科目（${uniqueLeaves.map((l) => l.displayName).join("、")}），请选择要练习的具体课程`
      )
    }

    // 规则 3：今日计划只映射到父级考试组（或未映射）。
    const trackHits = resolutions
      .map((r) => r.resolution)
      .filter((r): r is SubjectResolution => Boolean(r && r.node && r.node.nodeType === "EXAM_TRACK"))
    const uniqueTracks = dedupeByStableId(trackHits.map((r) => r.node!))
    if (uniqueTracks.length === 1) {
      const track = uniqueTracks[0]
      const trackLabel = track.code ? `${track.code}（${track.displayName}）` : track.displayName
      return blockedDecision(
        "requires-choice",
        track.stableId,
        evidence,
        `今日计划只映射到考试组「${trackLabel}」。请选择具体课程（如 ${trackDisplayLeaves(track.stableId)}），或进入「综合复习」模式；不会随机抽取一门子科目并声称基于今日计划`
      )
    }

    // 今日计划存在但未映射到任何考试体系节点。
    return blockedDecision(
      "no-plan",
      null,
      evidence,
      "今日计划存在，但没有可靠映射到具体考试科目。请在映射页确认科目后重试"
    )
  }

  // 规则 4：没有今日计划。
  return blockedDecision(
    "no-plan",
    null,
    [],
    "今天还没有同步的计划。请选择考试组和具体课程后出题，或先在手机上创建今天的计划并同步"
  )
}

function trackDisplayLeaves(trackId: string): string {
  // 展示前 2 个子科目的显示名，避免长列表刷屏。
  const leaves = getExamLeavesOfTrack(trackId).slice(0, 2)
  return leaves.map((leaf) => leaf.displayName).join("、") || "具体课程"
}

function getExamLeavesOfTrack(trackId: string): ExamCatalogNode[] {
  return getDescendantLeaves(trackId)
}

function leafDecision(
  mode: "explicit" | "today-plan",
  subjectId: string,
  evidence: PlanEvidence[],
  evidenceText: string
): QuestionScopeDecision {
  const path = getExamPath(subjectId)
  const track = path[0] ?? null
  return {
    mode,
    examTrackId: track?.stableId ?? null,
    subjectId,
    moduleId: null,
    evidenceText,
    evidence,
    needsUserChoice: false,
    strategy: null,
    reason: null
  }
}

function blockedDecision(
  mode: "requires-choice" | "no-plan",
  examTrackId: string | null,
  evidence: PlanEvidence[],
  reason: string
): QuestionScopeDecision {
  return {
    mode,
    examTrackId,
    subjectId: null,
    moduleId: null,
    evidenceText: reason,
    evidence,
    needsUserChoice: true,
    strategy: null,
    reason
  }
}

function comprehensiveDecision(
  input: PlanScopeInput,
  evidence: PlanEvidence[]
): QuestionScopeDecision {
  const trackId = input.selection.examTrackId!
  const track = getExamNode(trackId)
  if (!track || track.nodeType !== "EXAM_TRACK") {
    return blockedDecision("requires-choice", trackId, evidence, "所选范围不是考试组，无法进入综合复习")
  }
  // 综合复习只轮换「可出题」的叶子；门禁 = 叶子 approved 且其 questionScope 的
  // Pack 在 PACK_MANIFEST 中全部 approved（目录状态与 Manifest 状态双重校验，
  // 防止目录与 Manifest 漂移后选中实际不可出题的课程）。draft 叶子如实展示但不出题。
  const allLeaves = getExamLeavesOfTrack(trackId)
  const approvedLeaves = allLeaves.filter((leaf) => isLeafApprovedForQuestions(leaf.stableId))
  if (approvedLeaves.length === 0) {
    return blockedDecision(
      "requires-choice",
      trackId,
      evidence,
      `「${track.displayName}」综合复习：当前没有已审核（approved）子科目题库，暂无法出题`
    )
  }
  // 策略：掌握度最低优先（weakness-first）或按目录顺序轮换（rotation）。
  const weak = input.weakMastery ?? {}
  const weakFirst = [...approvedLeaves].sort((a, b) => {
    const aWeak = weak[a.stableId] ?? 0.5
    const bWeak = weak[b.stableId] ?? 0.5
    return aWeak - bWeak
  })
  const offset = Math.max(0, input.rotationOffset ?? 0)
  const currentLeaf = (input.weakMastery ? weakFirst : [...approvedLeaves].sort((a, b) => a.stableId.localeCompare(b.stableId)))[
    offset % approvedLeaves.length
  ]
  const strategy: ComprehensiveStrategy = {
    kind: input.weakMastery ? "weakness-first" : "rotation",
    leaves: approvedLeaves,
    currentLeaf
  }
  return {
    mode: "comprehensive",
    examTrackId: trackId,
    subjectId: currentLeaf.stableId,
    moduleId: null,
    evidenceText:
      `「${track.displayName}」综合复习模式：按${
        strategy.kind === "weakness-first"
          ? "掌握度最低优先"
          : `${strategy.leaves.length} 门课程轮换`
      }策略选择，当前实际出题子科目为「${currentLeaf.displayName}」`,
    evidence,
    needsUserChoice: false,
    strategy,
    reason: null
  }
}

function dedupeByStableId(nodes: ExamCatalogNode[]): ExamCatalogNode[] {
  const seen = new Set<string>()
  const result: ExamCatalogNode[] = []
  for (const node of nodes) {
    if (seen.has(node.stableId)) continue
    seen.add(node.stableId)
    result.push(node)
  }
  return result
}
