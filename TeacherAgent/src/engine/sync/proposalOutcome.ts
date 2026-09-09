/**
 * Computes the execution outcome of an accepted proposal from the latest
 * AlertTime read model.
 *
 * This is deliberately a pure, fail-closed function.  A row is materialized
 * only when its sourceProposalId is exactly the accepted proposal id and all
 * fields that Teacher proposed for that item still match.  A matching title
 * without provenance is not sufficient evidence: old clients therefore show
 * missing/untracked work instead of inflating the completion rate.
 */

import type {
  ProposedTask,
  ProposedWeeklyGoal,
  SyncProposal,
  SyncReadModel,
  SyncTask,
  SyncWeeklyGoal
} from "../../types/sync"

export type ProposalOutcomeItemState = "completed" | "pending" | "closed" | "deleted" | "missing"

export type ProposalOutcomeWarningCode =
  | "PROPOSAL_NOT_ACCEPTED"
  | "SOURCE_PROPOSAL_ID_MISSING"
  | "SOURCE_PROPOSAL_CROSS_MATCH"
  | "SOURCE_PROPOSAL_FIELD_DRIFT"
  | "DUPLICATE_MATERIALIZATION"
  | "NO_EXACT_MATERIALIZATION"
  | "UNEXPECTED_SOURCE_ENTITY"

export interface ProposalOutcomeWarning {
  code: ProposalOutcomeWarningCode
  count: number
}

export interface ProposalOutcomeItem {
  expectedIndex: number
  title: string
  subjectRemoteId?: string | null
  weekStart?: number
  state: ProposalOutcomeItemState
  remoteId: string | null
}

export interface ProposalOutcomeSummary {
  expected: number
  materialized: number
  completed: number
  pending: number
  /** status 2/3（归档、延期、取消）等非待办终态。 */
  closed: number
  deleted: number
  missing: number
  /** Completed / expected, including missing items; null when expected is zero. */
  completionRate: number | null
}

export interface ProposalOutcome {
  proposalId: string
  status: SyncProposal["status"]
  createdAt: number
  /** False when no proposal item can be proven to have been materialized. */
  traceable: boolean
  weeklyGoals: ProposalOutcomeItem[]
  tasks: ProposalOutcomeItem[]
  weeklyGoalsSummary: ProposalOutcomeSummary
  tasksSummary: ProposalOutcomeSummary
  totalSummary: ProposalOutcomeSummary
  warnings: ProposalOutcomeWarning[]
}

interface WarningAccumulator {
  add(code: ProposalOutcomeWarningCode): void
  list(): ProposalOutcomeWarning[]
}

function warningAccumulator(): WarningAccumulator {
  const counts = new Map<ProposalOutcomeWarningCode, number>()
  return {
    add(code) {
      counts.set(code, (counts.get(code) ?? 0) + 1)
    },
    list() {
      return [...counts.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([code, count]) => ({ code, count }))
    }
  }
}

function emptySummary(): ProposalOutcomeSummary {
  return {
    expected: 0,
    materialized: 0,
    completed: 0,
    pending: 0,
    closed: 0,
    deleted: 0,
    missing: 0,
    completionRate: null
  }
}

function summarize(items: ProposalOutcomeItem[]): ProposalOutcomeSummary {
  const summary = items.reduce<ProposalOutcomeSummary>(
    (result, item) => {
      result.expected += 1
      if (item.state !== "missing") result.materialized += 1
      if (item.state === "completed") result.completed += 1
      if (item.state === "pending") result.pending += 1
      if (item.state === "closed") result.closed += 1
      if (item.state === "deleted") result.deleted += 1
      if (item.state === "missing") result.missing += 1
      return result
    },
    emptySummary()
  )
  summary.completionRate = summary.expected === 0 ? null : summary.completed / summary.expected
  return summary
}

function combineSummaries(left: ProposalOutcomeSummary, right: ProposalOutcomeSummary): ProposalOutcomeSummary {
  const summary: ProposalOutcomeSummary = {
    expected: left.expected + right.expected,
    materialized: left.materialized + right.materialized,
    completed: left.completed + right.completed,
    pending: left.pending + right.pending,
    closed: left.closed + right.closed,
    deleted: left.deleted + right.deleted,
    missing: left.missing + right.missing,
    completionRate: null
  }
  summary.completionRate = summary.expected === 0 ? null : summary.completed / summary.expected
  return summary
}

function sameTaskFields(entity: SyncTask, proposed: ProposedTask): boolean {
  return (
    entity.type === 1 &&
    entity.title === proposed.title &&
    entity.subjectRemoteId === proposed.subjectRemoteId &&
    entity.targetDurationSeconds === proposed.targetDurationSeconds &&
    entity.dueAt === proposed.dueAt
  )
}

function sameGoalFields(entity: SyncWeeklyGoal, proposed: ProposedWeeklyGoal): boolean {
  return (
    entity.weekStart === proposed.weekStart &&
    entity.title === proposed.title &&
    entity.successCriteria === proposed.successCriteria
  )
}

function itemState(entity: SyncTask | SyncWeeklyGoal): ProposalOutcomeItemState {
  if (entity.deletedAt !== null) return "deleted"
  if (entity.status === 0) return "pending"
  if (entity.status === 1) return "completed"
  return "closed"
}

function isNearTaskFieldDrift(entity: SyncTask, proposed: ProposedTask): boolean {
  const sameFieldCount = [
    entity.title === proposed.title,
    entity.subjectRemoteId === proposed.subjectRemoteId,
    entity.targetDurationSeconds === proposed.targetDurationSeconds,
    entity.dueAt === proposed.dueAt
  ].filter(Boolean).length
  return sameFieldCount >= 3
}

function isNearGoalFieldDrift(entity: SyncWeeklyGoal, proposed: ProposedWeeklyGoal): boolean {
  const sameFieldCount = [
    entity.weekStart === proposed.weekStart,
    entity.title === proposed.title,
    entity.successCriteria === proposed.successCriteria
  ].filter(Boolean).length
  return sameFieldCount >= 2
}

function matchTask(
  proposed: ProposedTask,
  expectedIndex: number,
  proposalId: string,
  model: SyncReadModel,
  usedRemoteIds: Set<string>,
  warnings: WarningAccumulator
): ProposalOutcomeItem {
  const allSameSource = model.tasks.filter((task) => task.sourceProposalId === proposalId)
  const sameSource = allSameSource.filter((task) => !usedRemoteIds.has(task.remoteId))
  const exact = allSameSource.filter((task) => sameTaskFields(task, proposed))
  if (exact.length > 1) {
    exact.forEach((task) => usedRemoteIds.add(task.remoteId))
    warnings.add("DUPLICATE_MATERIALIZATION")
    return { expectedIndex, title: proposed.title, subjectRemoteId: proposed.subjectRemoteId, state: "missing", remoteId: null }
  }
  if (exact.length === 1) {
    const entity = exact[0]
    if (!sameSource.some((task) => task.remoteId === entity.remoteId)) {
      warnings.add("DUPLICATE_MATERIALIZATION")
      return { expectedIndex, title: proposed.title, subjectRemoteId: proposed.subjectRemoteId, state: "missing", remoteId: null }
    }
    usedRemoteIds.add(entity.remoteId)
    return {
      expectedIndex,
      title: proposed.title,
      subjectRemoteId: proposed.subjectRemoteId,
      state: itemState(entity),
      remoteId: entity.remoteId
    }
  }

  const drift = sameSource.find((task) => isNearTaskFieldDrift(task, proposed))
  if (drift) {
    usedRemoteIds.add(drift.remoteId)
    warnings.add("SOURCE_PROPOSAL_FIELD_DRIFT")
  } else {
    if (model.tasks.some((task) => task.sourceProposalId == null && sameTaskFields(task, proposed))) {
      warnings.add("SOURCE_PROPOSAL_ID_MISSING")
    } else if (model.tasks.some((task) => task.sourceProposalId != null && task.sourceProposalId !== proposalId && sameTaskFields(task, proposed))) {
      warnings.add("SOURCE_PROPOSAL_CROSS_MATCH")
    } else {
      warnings.add("NO_EXACT_MATERIALIZATION")
    }
  }
  return { expectedIndex, title: proposed.title, subjectRemoteId: proposed.subjectRemoteId, state: "missing", remoteId: null }
}

function matchGoal(
  proposed: ProposedWeeklyGoal,
  expectedIndex: number,
  proposalId: string,
  model: SyncReadModel,
  usedRemoteIds: Set<string>,
  warnings: WarningAccumulator
): ProposalOutcomeItem {
  const allSameSource = model.weeklyGoals.filter((goal) => goal.sourceProposalId === proposalId)
  const sameSource = allSameSource.filter((goal) => !usedRemoteIds.has(goal.remoteId))
  const exact = allSameSource.filter((goal) => sameGoalFields(goal, proposed))
  if (exact.length > 1) {
    exact.forEach((goal) => usedRemoteIds.add(goal.remoteId))
    warnings.add("DUPLICATE_MATERIALIZATION")
    return { expectedIndex, title: proposed.title, weekStart: proposed.weekStart, state: "missing", remoteId: null }
  }
  if (exact.length === 1) {
    const entity = exact[0]
    if (usedRemoteIds.has(entity.remoteId)) {
      warnings.add("DUPLICATE_MATERIALIZATION")
      return { expectedIndex, title: proposed.title, weekStart: proposed.weekStart, state: "missing", remoteId: null }
    }
    usedRemoteIds.add(entity.remoteId)
    return { expectedIndex, title: proposed.title, weekStart: proposed.weekStart, state: itemState(entity), remoteId: entity.remoteId }
  }

  const drift = sameSource.find((goal) => isNearGoalFieldDrift(goal, proposed))
  if (drift) {
    usedRemoteIds.add(drift.remoteId)
    warnings.add("SOURCE_PROPOSAL_FIELD_DRIFT")
  } else {
    if (model.weeklyGoals.some((goal) => goal.sourceProposalId == null && sameGoalFields(goal, proposed))) {
      warnings.add("SOURCE_PROPOSAL_ID_MISSING")
    } else if (model.weeklyGoals.some((goal) => goal.sourceProposalId != null && goal.sourceProposalId !== proposalId && sameGoalFields(goal, proposed))) {
      warnings.add("SOURCE_PROPOSAL_CROSS_MATCH")
    } else {
      warnings.add("NO_EXACT_MATERIALIZATION")
    }
  }
  return { expectedIndex, title: proposed.title, weekStart: proposed.weekStart, state: "missing", remoteId: null }
}

function emptyOutcome(proposal: SyncProposal, warnings: ProposalOutcomeWarning[]): ProposalOutcome {
  const summary = emptySummary()
  return {
    proposalId: proposal.proposalId,
    status: proposal.status,
    createdAt: proposal.createdAt,
    traceable: false,
    weeklyGoals: [],
    tasks: [],
    weeklyGoalsSummary: summary,
    tasksSummary: summary,
    totalSummary: summary,
    warnings
  }
}

/** Computes a conservative execution outcome for one proposal. */
export function proposalOutcome(proposal: SyncProposal, model: SyncReadModel): ProposalOutcome {
  const warnings = warningAccumulator()
  if (proposal.status !== "accepted") {
    warnings.add("PROPOSAL_NOT_ACCEPTED")
    return emptyOutcome(proposal, warnings.list())
  }

  const usedTaskIds = new Set<string>()
  const usedGoalIds = new Set<string>()
  const tasks = proposal.proposedTasks.map((item, index) =>
    matchTask(item, index, proposal.proposalId, model, usedTaskIds, warnings)
  )
  const weeklyGoals = proposal.proposedWeeklyGoals.map((item, index) =>
    matchGoal(item, index, proposal.proposalId, model, usedGoalIds, warnings)
  )
  for (const task of model.tasks) {
    if (
      task.sourceProposalId === proposal.proposalId &&
      !proposal.proposedTasks.some((expected) => sameTaskFields(task, expected))
    ) {
      warnings.add("UNEXPECTED_SOURCE_ENTITY")
    }
  }
  for (const goal of model.weeklyGoals) {
    if (
      goal.sourceProposalId === proposal.proposalId &&
      !proposal.proposedWeeklyGoals.some((expected) => sameGoalFields(goal, expected))
    ) {
      warnings.add("UNEXPECTED_SOURCE_ENTITY")
    }
  }
  const weeklyGoalsSummary = summarize(weeklyGoals)
  const tasksSummary = summarize(tasks)
  const totalSummary = combineSummaries(weeklyGoalsSummary, tasksSummary)
  const expected = totalSummary.expected
  const traceable = expected === 0 || totalSummary.materialized > 0

  return {
    proposalId: proposal.proposalId,
    status: proposal.status,
    createdAt: proposal.createdAt,
    traceable,
    weeklyGoals,
    tasks,
    weeklyGoalsSummary,
    tasksSummary,
    totalSummary,
    warnings: warnings.list()
  }
}
