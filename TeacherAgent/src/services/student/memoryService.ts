import type { HintLevel } from "../../types/agent"
import type { KnowledgeNodeRef, SubjectCode } from "../../types/learning"
import type {
  LongTermMemoryEntry,
  ShortTermMemorySnapshot,
  StudentCognitiveProfile,
  StudentMemoryState
} from "../../types/memory"
import type { ReflectionAgentResult, ReflectionRecord } from "../../types/reflection"
import { reflectOnTutorTurn, reflectOnTutorTurnWithLlm } from "../../engine/agents/reflectionAgent"
import type { TutorMode, TutorPromptMessage, TutorStudentContext } from "../../engine/prompts/tutorPromptBuilder"
import { subjectLabel } from "../../utils/subject"
import { createId, truncateText as truncate, uniqueStrings as unique } from "../../utils/text"
import {
  loadLearningMemoryContext,
  saveReflectionRecord,
  saveLearningMemoryState,
  type LearningMemoryContextPayload
} from "../tauri/commands"

export const DEFAULT_STUDENT_ID = "local-default-student"
export const DEFAULT_CONVERSATION_ID = "local-default-conversation"

const STORAGE_KEY = "teacher-agent:student-memory:v1"
const MAX_LONG_TERM_ENTRIES_PER_STUDENT = 50
const MAX_SESSION_NOTES = 6

export interface LearningMemoryContextInput {
  studentId?: string
  conversationId?: string
  subjectCode: SubjectCode
}

export interface LearningMemoryPromptContext {
  studentContext?: TutorStudentContext
  sessionMemory?: string
  shortTermMemory?: ShortTermMemorySnapshot
  profile?: StudentCognitiveProfile
  longTermMemories: LongTermMemoryEntry[]
  lastReflectionRecord?: ReflectionRecord
}

export interface LearningMemoryTurnInput extends LearningMemoryContextInput {
  userMessage: string
  tutorReply: string
  recentMessages?: TutorPromptMessage[]
  mode: TutorMode
  maxHintLevel: HintLevel
  strategy: string
  knowledgeNodes?: KnowledgeNodeRef[]
  providerConfig?: { baseUrl: string; apiKeyRef: string; model: string }
  /** Whether the active provider is local (runs on user's machine) */
  isLocalProvider?: boolean
  /** Whether cloud reflection is enabled by the user */
  enableCloudReflection?: boolean
}

export class LearningMemoryService {
  async getPromptContext(input: LearningMemoryContextInput): Promise<LearningMemoryPromptContext> {
    const studentId = input.studentId ?? DEFAULT_STUDENT_ID
    const conversationId = input.conversationId ?? DEFAULT_CONVERSATION_ID

    try {
      // 给 IPC 调用加 3 秒超时，避免卡死
      const remote = await Promise.race([
        loadLearningMemoryContext(studentId, conversationId, input.subjectCode),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("memory load timeout")), 3000)
        )
      ])
      return buildPromptContextFromPayload(remote)
    } catch {
      return getLocalPromptContext(input)
    }
  }

  async recordTutorTurn(input: LearningMemoryTurnInput): Promise<LearningMemoryPromptContext> {
    const state = await readStateForInput(input)
    const studentId = input.studentId ?? DEFAULT_STUDENT_ID
    const conversationId = input.conversationId ?? DEFAULT_CONVERSATION_ID
    const reflectionInput = {
      studentId,
      conversationId,
      subjectCode: input.subjectCode,
      userMessage: input.userMessage,
      tutorReply: input.tutorReply,
      recentMessages: input.recentMessages,
      mode: input.mode,
      maxHintLevel: input.maxHintLevel,
      strategy: input.strategy,
      knowledgeNodes: input.knowledgeNodes
    }
    // For cloud providers, LLM reflection requires explicit user opt-in.
    // Local providers always get LLM reflection when available.
    const useLlmReflection = Boolean(input.providerConfig)
      && (input.isLocalProvider || input.enableCloudReflection === true)
    const reflection = useLlmReflection && input.providerConfig
      ? await reflectOnTutorTurnWithLlm(reflectionInput, input.providerConfig)
      : reflectOnTutorTurn(reflectionInput)
    const updated = updateStateWithTutorTurn(state, input, reflection)
    writeState(updated.state)

    try {
      // 给 IPC 调用加 5 秒超时，避免卡死
      await Promise.race([
        saveReflectionRecord(reflection.record),
        new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error("save reflection timeout")), 5000)
        )
      ])
      const remote = await Promise.race([
        saveLearningMemoryState({
          profile: updated.profile,
          shortTermMemory: updated.shortTermMemory,
          longTermMemories: updated.longTermMemories
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("save memory timeout")), 5000)
        )
      ])
      return {
        ...buildPromptContextFromPayload(remote),
        lastReflectionRecord: reflection.record
      }
    } catch {
      return {
        ...getLocalPromptContext({
          studentId: input.studentId,
          conversationId: input.conversationId,
          subjectCode: input.subjectCode
        }),
        lastReflectionRecord: reflection.record
      }
    }
  }

  exportStudentMemory(studentId = DEFAULT_STUDENT_ID): StudentMemoryState {
    const state = readState()

    return {
      version: 1,
      profiles: Object.fromEntries(Object.entries(state.profiles).filter(([, profile]) => profile.studentId === studentId)),
      shortTermSnapshots: Object.fromEntries(
        Object.entries(state.shortTermSnapshots).filter(([, snapshot]) => snapshot.studentId === studentId)
      ),
      longTermEntries: state.longTermEntries.filter((entry) => entry.studentId === studentId)
    }
  }

  clearStudentMemory(studentId = DEFAULT_STUDENT_ID): void {
    const state = readState()

    for (const [key, profile] of Object.entries(state.profiles)) {
      if (profile.studentId === studentId) {
        delete state.profiles[key]
      }
    }

    for (const [key, snapshot] of Object.entries(state.shortTermSnapshots)) {
      if (snapshot.studentId === studentId) {
        delete state.shortTermSnapshots[key]
      }
    }

    state.longTermEntries = state.longTermEntries.filter((entry) => entry.studentId !== studentId)
    writeState(state)
  }
}

export const learningMemoryService = new LearningMemoryService()

async function readStateForInput(input: LearningMemoryContextInput): Promise<StudentMemoryState> {
  const studentId = input.studentId ?? DEFAULT_STUDENT_ID
  const conversationId = input.conversationId ?? DEFAULT_CONVERSATION_ID

  try {
    // 给 IPC 调用加 3 秒超时，避免卡死
    const payload = await Promise.race([
      loadLearningMemoryContext(studentId, conversationId, input.subjectCode),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("read state timeout")), 3000)
      )
    ])
    return stateFromPayload(
      payload,
      studentId,
      conversationId,
      input.subjectCode
    )
  } catch {
    return readState()
  }
}

export function getLocalPromptContext(input: LearningMemoryContextInput): LearningMemoryPromptContext {
  const state = readState()
  const studentId = input.studentId ?? DEFAULT_STUDENT_ID
  const conversationId = input.conversationId ?? DEFAULT_CONVERSATION_ID
  const profile = state.profiles[profileKey(studentId, input.subjectCode)]
  const shortTermMemory = state.shortTermSnapshots[conversationId]
  const longTermMemories = state.longTermEntries
    .filter((entry) => entry.studentId === studentId && (!entry.subjectCode || entry.subjectCode === input.subjectCode))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, MAX_SESSION_NOTES)

  return {
    studentContext: buildStudentContext(profile, longTermMemories),
    sessionMemory: buildSessionMemory(shortTermMemory, longTermMemories),
    shortTermMemory,
    profile,
    longTermMemories
  }
}

function buildPromptContextFromPayload(payload: LearningMemoryContextPayload): LearningMemoryPromptContext {
  return {
    studentContext: buildStudentContext(payload.profile, payload.longTermMemories),
    sessionMemory: buildSessionMemory(payload.shortTermMemory, payload.longTermMemories),
    shortTermMemory: payload.shortTermMemory,
    profile: payload.profile,
    longTermMemories: payload.longTermMemories
  }
}

function stateFromPayload(
  payload: LearningMemoryContextPayload,
  studentId: string,
  conversationId: string,
  subjectCode: SubjectCode
): StudentMemoryState {
  const state = readState()

  if (payload.profile) {
    state.profiles[profileKey(studentId, subjectCode)] = payload.profile
  }

  if (payload.shortTermMemory) {
    state.shortTermSnapshots[conversationId] = payload.shortTermMemory
  }

  for (const memory of payload.longTermMemories) {
    upsertLongTermMemory(state, memory)
  }

  return state
}

function updateStateWithTutorTurn(
  state: StudentMemoryState,
  input: LearningMemoryTurnInput,
  reflection: ReflectionAgentResult
): {
  state: StudentMemoryState
  profile: StudentCognitiveProfile
  shortTermMemory: ShortTermMemorySnapshot
  longTermMemories: LongTermMemoryEntry[]
} {
  const now = new Date().toISOString()
  const studentId = input.studentId ?? DEFAULT_STUDENT_ID
  const conversationId = input.conversationId ?? DEFAULT_CONVERSATION_ID
  const key = profileKey(studentId, input.subjectCode)
  const profile = state.profiles[key] ?? createProfile(studentId, input.subjectCode, now)

  mergeUnique(profile.learningGoals, reflection.profileUpdates.learningGoals)
  mergeUnique(profile.explanationPreferences, reflection.profileUpdates.explanationPreferences)
  mergeUnique(profile.recurringMisconceptions, reflection.profileUpdates.recurringMisconceptions)
  mergeUnique(profile.effectiveStrategies, reflection.profileUpdates.effectiveStrategies)
  mergeUnique(profile.affectiveSignals, reflection.profileUpdates.affectiveSignals)
  profile.confidence = clamp(profile.confidence + reflection.profileUpdates.confidenceDelta, 0.1, 0.9)
  profile.updatedAt = now
  state.profiles[key] = profile

  for (const memory of reflection.memoryCandidates) {
    upsertLongTermMemory(state, {
      ...memory,
      studentId,
      subjectCode: input.subjectCode,
      createdAt: now,
      updatedAt: now
    })
  }

  state.shortTermSnapshots[conversationId] = buildShortTermSnapshot({
    existing: state.shortTermSnapshots[conversationId],
    input,
    studentId,
    conversationId,
    now,
    reflection
  })

  pruneLongTermEntries(state, studentId)
  const longTermMemories = state.longTermEntries.filter(
    (entry) => entry.studentId === studentId && (!entry.subjectCode || entry.subjectCode === input.subjectCode)
  )

  return {
    state,
    profile,
    shortTermMemory: state.shortTermSnapshots[conversationId],
    longTermMemories
  }
}

function buildShortTermSnapshot(args: {
  existing?: ShortTermMemorySnapshot
  input: LearningMemoryTurnInput
  studentId: string
  conversationId: string
  now: string
  reflection: ReflectionAgentResult
}): ShortTermMemorySnapshot {
  const recentFocus = [
    ...(args.input.knowledgeNodes?.map((node) => node.title) ?? []),
    subjectFallback(args.input.subjectCode)
  ].filter(Boolean)
  const openQuestions = extractOpenQuestions(args.input.tutorReply)
  const summary = [
    `最近一轮主题：${recentFocus.slice(0, 2).join(" / ") || subjectFallback(args.input.subjectCode)}`,
    `教学模式：${args.input.mode}，策略：${args.input.strategy}`,
    args.reflection.record.misconceptions[0] ? `可能误区：${args.reflection.record.misconceptions[0].inference}` : "",
    `学生最新输入摘要：${truncate(args.input.userMessage, 90)}`
  ]
    .filter(Boolean)
    .join("；")

  return {
    id: args.existing?.id ?? createId("stm"),
    conversationId: args.conversationId,
    studentId: args.studentId,
    subjectCode: args.input.subjectCode,
    summary,
    recentFocus: unique([...recentFocus, ...(args.existing?.recentFocus ?? [])]).slice(0, 6),
    openQuestions: unique([...openQuestions, ...(args.existing?.openQuestions ?? [])]).slice(0, 4),
    lastMisconceptions: unique([
      ...args.reflection.record.misconceptions.map((item) => item.inference),
      ...(args.existing?.lastMisconceptions ?? [])
    ]).slice(0, 4),
    lastMode: args.input.mode,
    turnCount: (args.existing?.turnCount ?? 0) + 1,
    createdAt: args.existing?.createdAt ?? args.now,
    updatedAt: args.now
  }
}

function buildStudentContext(
  profile: StudentCognitiveProfile | undefined,
  memories: LongTermMemoryEntry[]
): TutorStudentContext | undefined {
  if (!profile && memories.length === 0) {
    return undefined
  }

  const goals = profile?.learningGoals.length
    ? profile.learningGoals
    : memories.filter((memory) => memory.kind === "learning_goal").map((memory) => memory.summary)
  const preferences = profile?.explanationPreferences.length
    ? profile.explanationPreferences
    : memories.filter((memory) => memory.kind === "preference").map((memory) => memory.summary)
  const misconceptions = profile?.recurringMisconceptions.length
    ? profile.recurringMisconceptions
    : memories.filter((memory) => memory.kind === "misconception").map((memory) => memory.summary)

  return {
    learningGoal: goals.slice(0, 2).join("；") || undefined,
    masterySummary: buildMasterySummary(memories),
    misconceptionPatterns: misconceptions.slice(0, 4),
    preferenceSummary: preferences.slice(0, 4).join("；") || undefined
  }
}

function buildSessionMemory(
  snapshot: ShortTermMemorySnapshot | undefined,
  memories: LongTermMemoryEntry[]
): string | undefined {
  const lines: string[] = []

  if (snapshot) {
    lines.push(`短期记忆：${snapshot.summary}`)
    if (snapshot.openQuestions.length) lines.push(`待跟进问题：${snapshot.openQuestions.join("；")}`)
    if (snapshot.recentFocus.length) lines.push(`近期关注：${snapshot.recentFocus.join("；")}`)
  }

  const durable = memories
    .filter((memory) => memory.kind !== "affective_signal")
    .slice(0, 4)
    .map((memory) => `${memory.kind}: ${memory.summary}`)

  if (durable.length) {
    lines.push(`长期记忆摘要：${durable.join("；")}`)
  }

  if (!lines.length) {
    return undefined
  }

  lines.push("使用规则：这些记忆用于连续性和个性化，不要直接说“你的画像显示”。")
  return lines.join("\n")
}

function buildMasterySummary(memories: LongTermMemoryEntry[]): string | undefined {
  const mastery = memories.filter((memory) => memory.kind === "mastery_signal").slice(0, 3)
  if (mastery.length) {
    return mastery.map((memory) => memory.summary).join("；")
  }

  const misconception = memories.find((memory) => memory.kind === "misconception")
  return misconception ? `需关注：${misconception.summary}` : undefined
}

function upsertLongTermMemory(
  state: StudentMemoryState,
  memory: Omit<LongTermMemoryEntry, "id"> & Partial<Pick<LongTermMemoryEntry, "id">> & { createdAt: string; updatedAt: string }
): void {
  const existing = state.longTermEntries.find(
    (entry) =>
      entry.studentId === memory.studentId &&
      entry.subjectCode === memory.subjectCode &&
      entry.kind === memory.kind &&
      entry.summary === memory.summary
  )

  if (existing) {
    existing.evidence = memory.evidence
    existing.confidence = Math.max(existing.confidence, memory.confidence)
    existing.updatedAt = memory.updatedAt
    return
  }

  state.longTermEntries.push({
    ...memory,
    id: memory.id ?? createId("ltm")
  })
}

function pruneLongTermEntries(state: StudentMemoryState, studentId: string): void {
  const entries = state.longTermEntries
    .filter((entry) => entry.studentId === studentId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  const keep = new Set(entries.slice(0, MAX_LONG_TERM_ENTRIES_PER_STUDENT).map((entry) => entry.id))

  state.longTermEntries = state.longTermEntries.filter((entry) => entry.studentId !== studentId || keep.has(entry.id))
}

function createProfile(studentId: string, subjectCode: SubjectCode, now: string): StudentCognitiveProfile {
  return {
    id: createId("profile"),
    studentId,
    subjectCode,
    learningGoals: [],
    explanationPreferences: [],
    recurringMisconceptions: [],
    effectiveStrategies: [],
    affectiveSignals: [],
    confidence: 0.1,
    createdAt: now,
    updatedAt: now
  }
}

function readState(): StudentMemoryState {
  const empty: StudentMemoryState = {
    version: 1,
    profiles: {},
    shortTermSnapshots: {},
    longTermEntries: []
  }

  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY)
    if (!raw) return empty
    const parsed = JSON.parse(raw) as StudentMemoryState
    return parsed.version === 1 ? { ...empty, ...parsed } : empty
  } catch {
    return empty
  }
}

function writeState(state: StudentMemoryState): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // localStorage can be unavailable in tests or restricted runtimes; losing Phase 0 memory is acceptable.
  }
}

function extractOpenQuestions(reply: string): string[] {
  return reply
    .split(/(?<=[？?])\s*/)
    .filter((part) => /[？?]$/.test(part.trim()))
    .map((part) => truncate(part.trim(), 80))
    .slice(-2)
}

function profileKey(studentId: string, subjectCode?: SubjectCode): string {
  return `${studentId}:${subjectCode ?? "global"}`
}

function mergeUnique(target: string[], values: string[]): void {
  for (const value of values) {
    if (value && !target.includes(value)) {
      target.push(value)
    }
  }

  target.splice(8)
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function subjectFallback(subjectCode: SubjectCode): string {
  return subjectLabel(subjectCode)
}
