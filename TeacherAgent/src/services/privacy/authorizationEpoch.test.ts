import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createPinia, setActivePinia } from "pinia"
import { AUTHORIZATION_EPOCH_STORAGE_KEY, createProviderMessageTimestamp, filterProviderHistory, getAuthorizationReducedAt } from "./authorizationEpoch"
import { useAppStore } from "../../stores/app"
import { generateConversationTitle } from "../conversation/conversationTitleService"
import { reflectOnTutorTurnWithLlm } from "../../engine/agents/reflectionAgent"
import { reviewTutorReplyWithLlm, rewriteTutorReplyOnce } from "../../engine/agents/guardrailAgent"
import { TutorOrchestrator } from "../../engine/agents/tutorOrchestrator"
import { restoreChatMessagesFromStoredMessages } from "../../components/chat/chatMessageMetadata"
import type { LlmCompletionRequest } from "../llm/types"

const mocks = vi.hoisted(() => ({ complete: vi.fn(), nativeComplete: vi.fn() }))
vi.mock("../llm/openAiCompatibleProvider", () => ({
  createOpenAICompatibleProvider: () => ({ providerName: "synthetic", complete: mocks.complete })
}))
vi.mock("../tauri/commands", async original => ({
  ...await original<typeof import("../tauri/commands")>(), completeLlmChat: mocks.nativeComplete
}))
vi.mock("../../engine/agents/toolAgent", async original => ({
  ...await original<typeof import("../../engine/agents/toolAgent")>(),
  runToolAgent: async () => ({ toolContextNotes: [] })
}))
vi.mock("../assessment/assessmentPersistence", () => ({ persistAssessment: async () => "saved" }))
vi.mock("../student/memoryService", () => ({ DEFAULT_STUDENT_ID: "synthetic-student", learningMemoryService: {
  getPromptContext: async () => ({ longTermMemories: [] }), recordTutorTurn: async () => ({ longTermMemories: [] })
} }))

const start = Date.parse("2026-10-19T00:00:00Z")
const oldAt = new Date(start - 1000).toISOString()
const newAt = new Date(start + 1000).toISOString()
const providerConfig = { providerName: "synthetic", baseUrl: "http://127.0.0.1:1/v1", apiKeyRef: "synthetic-ref", model: "synthetic" }
let storage: Map<string, string>
let store: ReturnType<typeof useAppStore>
beforeEach(() => {
  storage = new Map()
  vi.stubGlobal("localStorage", { getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => storage.set(k, v), removeItem: (k: string) => storage.delete(k) })
  vi.spyOn(Date, "now").mockReturnValue(start)
  setActivePinia(createPinia()); store = useAppStore()
  mocks.complete.mockReset().mockResolvedValue({ content: "你能先比较两个条件吗？", model: "synthetic", providerName: "synthetic" })
  mocks.nativeComplete.mockReset().mockResolvedValue({ content: "{}", model: "synthetic", providerName: "synthetic" })
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
function reduce() {
  store.updateCloudPrivacy({ sendStudentProfileToCloud: true })
  store.updateCloudPrivacy({ sendStudentProfileToCloud: false })
}

describe("authorization reduction barrier", () => {
  it("first run returns the original array even without timestamps", () => {
    const messages = [{ content: "OLD" }]
    expect(filterProviderHistory(messages)).toBe(messages)
    expect(getAuthorizationReducedAt()).toBeNull()
  })
  it.each(["sendStudentProfileToCloud", "sendSessionMemoryToCloud", "sendPrivateDocumentContextToCloud"] as const)("records a decrease of %s, not increases or reflection changes", key => {
    store.updateCloudPrivacy({ [key]: true }); expect(getAuthorizationReducedAt()).toBeNull()
    store.updateCloudPrivacy({ [key]: false }); expect(getAuthorizationReducedAt()).toBe(start)
    store.updateCloudPrivacy({ [key]: false, enableCloudReflection: true })
    store.updateCloudPrivacy({ [key]: true, enableCloudReflection: false })
    expect(getAuthorizationReducedAt()).toBe(start)
    expect(storage.get(AUTHORIZATION_EPOCH_STORAGE_KEY)).toBe(String(start))
  })
  it("withholds old, same-time, unknown and invalid timestamps without mutating local data", () => {
    reduce()
    const messages = [oldAt, new Date(start).toISOString(), newAt, undefined, "bad"].map(createdAt => ({ createdAt }))
    expect(filterProviderHistory(messages)).toEqual([messages[2]])
    expect(messages).toHaveLength(5)
    expect(filterProviderHistory(messages, true)).toBe(messages)
    expect(filterProviderHistory(messages, undefined)).toEqual([messages[2]])
  })
  it("persists across store recreation and never restores excluded history on regrant", () => {
    reduce(); setActivePinia(createPinia()); store = useAppStore()
    store.updateCloudPrivacy({ sendStudentProfileToCloud: true })
    expect(filterProviderHistory([{ createdAt: oldAt }, { createdAt: newAt }])).toEqual([{ createdAt: newAt }])
  })
  it("orders a newly composed message after a same-millisecond decrease", () => {
    reduce(); const createdAt = createProviderMessageTimestamp()
    expect(filterProviderHistory([{ createdAt }])).toHaveLength(1)
    store.updateCloudPrivacy({ sendStudentProfileToCloud: true })
    store.updateCloudPrivacy({ sendStudentProfileToCloud: false })
    expect(filterProviderHistory([{ createdAt }])).toHaveLength(0)
  })
  it("retains a runtime barrier if persistence fails", () => {
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => { throw new Error("storage denied") } })
    reduce(); expect(filterProviderHistory([{ createdAt: oldAt }])).toEqual([])
  })
  it("withholds cloud history if the persisted barrier is corrupt", () => {
    storage.set(AUTHORIZATION_EPOCH_STORAGE_KEY, "invalid")
    expect(filterProviderHistory([{ createdAt: newAt }])).toEqual([])
  })
  it("restores the existing database timestamp unchanged", () => {
    const [restored] = restoreChatMessagesFromStoredMessages([{ id: "synthetic", role: "student", content: "synthetic", createdAt: oldAt,
      knowledgeRefsJson: "[]", toolRefsJson: "[]", guardrailJson: "{}" }])
    expect(restored.createdAt).toBe(oldAt)
  })
})

const cases = [
  { name: "first run", revoke: false, local: false, regrant: false, keepOld: true },
  { name: "authorization increase only", revoke: false, local: false, regrant: true, keepOld: true },
  { name: "after reduction", revoke: true, local: false, regrant: false, keepOld: false },
  { name: "after regrant", revoke: true, local: false, regrant: true, keepOld: false },
  { name: "local after reduction", revoke: true, local: true, regrant: false, keepOld: true }
]
describe.each(cases)("outbound paths: $name", ({ revoke, local, regrant, keepOld }) => {
  beforeEach(() => {
    if (revoke) reduce()
    if (regrant) store.updateCloudPrivacy({ sendStudentProfileToCloud: true })
  })
  const history = [{ role: "assistant" as const, content: "OLD_SYNTHETIC", createdAt: oldAt },
    { role: "user" as const, content: "NEW_SYNTHETIC", createdAt: newAt }]
  it("main dialogue uses only eligible history", async () => {
    const orchestrator = new TutorOrchestrator({ enableLearningMemory: false, enableLocalKnowledgeSearch: false,
      createProvider: () => ({ providerName: "synthetic", complete: mocks.complete }) })
    await orchestrator.handleTurn({ userMessage: "请解释极限概念", createdAt: newAt, recentMessages: history,
      subjectCode: "math", providerConfig: { ...providerConfig, isLocal: local } })
    const body = JSON.stringify(mocks.complete.mock.calls[0][0])
    expect(body.includes("OLD_SYNTHETIC")).toBe(keepOld); expect(body).toContain("NEW_SYNTHETIC")
    expect(history).toHaveLength(2)
  })
  it("title generation uses only eligible history", async () => {
    await generateConversationTitle({ messages: history.map(m => ({ ...m, role: m.role === "assistant" ? "tutor" : "student" })),
      subjectCode: "math", providerConfig: { ...providerConfig, isLocal: local } })
    const body = JSON.stringify(mocks.complete.mock.calls[0][0])
    expect(body.includes("OLD_SYNTHETIC")).toBe(keepOld); expect(body).toContain("NEW_SYNTHETIC")
  })
  it("reflection uses only eligible history", async () => {
    await reflectOnTutorTurnWithLlm({ studentId: "synthetic", conversationId: "synthetic", subjectCode: "math",
      userMessage: "NEW_CURRENT", tutorReply: "NEW_REPLY", createdAt: newAt, recentMessages: history,
      mode: "guide", maxHintLevel: "L3", strategy: "question" }, { ...providerConfig, isLocal: local })
    const body = JSON.stringify(mocks.nativeComplete.mock.calls[0])
    expect(body.includes("OLD_SYNTHETIC")).toBe(keepOld); expect(body).toContain("NEW_SYNTHETIC")
  })
  it("guardrail review and rewrite withhold a pre-reduction candidate", async () => {
    const provider = { providerName: "synthetic", complete: mocks.complete }
    const input = { studentMessage: "OLD_SYNTHETIC", candidateReply: "最终答案是：42。", createdAt: oldAt,
      isLocal: local, mode: "guide" as const, maxHintLevel: "L3" as const }
    await reviewTutorReplyWithLlm(provider, input); await rewriteTutorReplyOnce(provider, input)
    expect(mocks.complete).toHaveBeenCalledTimes(keepOld ? 2 : 0)
    mocks.complete.mockClear()
    await reviewTutorReplyWithLlm(provider, { ...input, createdAt: newAt })
    await rewriteTutorReplyOnce(provider, { ...input, createdAt: newAt })
    expect(mocks.complete).toHaveBeenCalledTimes(2)
  })
})

it("does not reflect an old in-flight turn after a reduction", async () => {
  reduce()
  await reflectOnTutorTurnWithLlm({ studentId: "synthetic", conversationId: "synthetic", subjectCode: "math",
    userMessage: "OLD_SYNTHETIC", tutorReply: "OLD_REPLY", createdAt: oldAt, mode: "guide", maxHintLevel: "L3", strategy: "question" }, providerConfig)
  expect(mocks.nativeComplete).not.toHaveBeenCalled()
})

it("main request withholds old current text and image attachments if the turn predates reduction", async () => {
  reduce()
  const orchestrator = new TutorOrchestrator({ enableLearningMemory: false, enableLocalKnowledgeSearch: false,
    createProvider: () => ({ providerName: "synthetic", complete: mocks.complete }) })
  await orchestrator.handleTurn({ userMessage: "OLD_SYNTHETIC", createdAt: oldAt, recentMessages: [], subjectCode: "math",
    providerConfig: { ...providerConfig, visionModel: "synthetic-vision" },
    attachments: [{ id: "synthetic", type: "image", mimeType: "image/png", dataUrl: "data:image/png;base64,OLD_IMAGE" }] })
  const body = JSON.stringify(mocks.complete.mock.calls[0][0] as LlmCompletionRequest)
  expect(body).not.toContain("OLD_SYNTHETIC"); expect(body).not.toContain("OLD_IMAGE")
})
