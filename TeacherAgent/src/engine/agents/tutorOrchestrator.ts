import type { HintLevel } from "../../types/agent"
import type { AssessmentResult } from "../../types/assessment"
import type { CloudPrivacyConfig } from "../../types/cloudPrivacy"
import { isLocalProvider } from "../../types/cloudPrivacy"
import type { KnowledgePrerequisite, StudentKnowledgeMastery, SubjectCode } from "../../types/learning"
import type { PlannerResult } from "../../types/planner"
import type { MathComputeOutput } from "../../types/tool"
import { createOpenAICompatibleProvider } from "../../services/llm/openAiCompatibleProvider"
import { normalizeProviderModel } from "../../services/llm/providerFormState"
import { raceAbort, throwIfAborted } from "../../services/llm/turnAbort"
import type { LlmProvider, LlmProviderConfig, LlmStreamChunk } from "../../services/llm/types"
import {
  DEFAULT_STUDENT_ID,
  learningMemoryService,
  type LearningMemoryPromptContext
} from "../../services/student/memoryService"
import { loadKnowledgePrerequisites, loadStudentKnowledge, saveAssessmentResult } from "../../services/tauri/commands"
import { assessTutorTurn } from "./assessmentAgent"
import {
  mergeGuardrailReviews,
  reviewTutorReply,
  reviewTutorReplyFast,
  reviewTutorReplyWithLlm,
  rewriteTutorReplyOnce,
  type GuardrailInput,
  type GuardrailReview,
  type GuardrailViolation
} from "./guardrailAgent"
import { formatPlannerResult, planNextLearningStep, shouldTriggerPlanner } from "./plannerAgent"
import { selectSocraticStrategy, type SocraticDecision } from "./socraticAgent"
import { runToolAgent, type RecentPrivateDocumentRef, type ToolAgentResult, isToolDebugMode } from "./toolAgent"
import { buildTutorPrompt, type TutorMode, type TutorPromptMessage } from "../prompts/tutorPromptBuilder"
import type { ChatAttachment } from "../../types/chat"

export interface TutorTurnInput {
  userMessage: string
  recentMessages: TutorPromptMessage[]
  subjectCode: SubjectCode
  /** 已启用的 pack IDs 列表，用于过滤搜索结果 */
  enabledPackIds?: string[]
  recentPrivateDocument?: RecentPrivateDocumentRef
  providerConfig?: LlmProviderConfig
  /** Dedicated embedding provider config for vector RAG (model-consistent with generation) */
  embeddingConfig?: import("../../stores/app").EmbeddingProviderConfig | null
  studentId?: string
  conversationId?: string
  mode?: TutorMode
  maxHintLevel?: HintLevel
  temperature?: number
  maxTokens?: number
  attachments?: ChatAttachment[]
  /** Cloud privacy config — when provider is cloud, controls what context is sent */
  cloudPrivacy?: CloudPrivacyConfig
  /**
   * Cancellation signal for this turn. When aborted, the turn rejects with
   * `TurnAbortedError` at the next pipeline boundary and guarantees:
   * - no `onStreamUpdate(_, done=true)` emission,
   * - no assessment / reflection / learning-memory persistence,
   * - no mutation of shared orchestrator state (turn state is request-local).
   * Cancellation is a distinct outcome from provider failure — callers should
   * detect it with `isTurnAborted` and must not render it as a model error.
   */
  signal?: AbortSignal
  onTiming?: (step: string, stepMs: number, totalMs: number) => void
  /**
   * Buffered-streaming callback (Strategy A): invoked at most once per turn,
   * with `done=true` and the FINAL content that has passed the same guardrail
   * pipeline as non-stream turns. It is never a per-token feed — the transport
   * streams, but display happens only after full guardrail review.
   */
  onStreamUpdate?: (content: string, done: boolean) => void
}

export interface TutorTurnResult {
  content: string
  rawDraft?: string
  mode: TutorMode
  maxHintLevel: HintLevel
  guardrailReview: GuardrailReview
  promptVersion: string
  providerName: string
  model: string
  socraticDecision: SocraticDecision
  toolAgentResult: ToolAgentResult
  assessmentResult?: AssessmentResult
  plannerResult?: PlannerResult
  memoryContext?: LearningMemoryPromptContext
}

export interface TutorOrchestratorOptions {
  createProvider?: (config: LlmProviderConfig) => LlmProvider
  enableLocalKnowledgeSearch?: boolean
  enableLearningMemory?: boolean
}

// ── Shared context for pre-LLM pipeline ────────────────────────────────

interface TurnContext {
  socraticDecision: SocraticDecision
  mode: TutorMode
  maxHintLevel: HintLevel
  toolAgentResult: ToolAgentResult
  memoryContext: LearningMemoryPromptContext | undefined
  studentId: string
  conversationId: string
  toolDebugMode: boolean
}

// ── LLM call output ────────────────────────────────────────────────────

interface LlmTurnResult {
  content: string
  rawDraft?: string
  guardrailReview: GuardrailReview
  promptVersion: string
  providerName: string
  model: string
}

// ── Orchestrator ───────────────────────────────────────────────────────

export class TutorOrchestrator {
  constructor(private readonly options: TutorOrchestratorOptions = {}) {}

  async handleTurn(input: TutorTurnInput): Promise<TutorTurnResult> {
    return this.executeTurn(input, "complete")
  }

  async handleTurnStream(input: TutorTurnInput): Promise<TutorTurnResult> {
    return this.executeTurn(input, "stream")
  }

  /**
   * Shared turn pipeline for both entry points. `kind` only selects the LLM
   * execution strategy; every other stage (socratic decision, planner/tool
   * short-circuits, prompt building, guardrail terminal, assessment + memory
   * persistence) is identical, so stream and non-stream turns have the same
   * final GuardrailResult, fallback and persistence semantics.
   */
  private async executeTurn(input: TutorTurnInput, kind: "complete" | "stream"): Promise<TutorTurnResult> {
    const stamp = createStamp(input.onTiming)

    stamp("start")
    throwIfAborted(input.signal)

    const ctx = await this.prepareTurnContext(input, stamp)
    stamp("socratic")

    // A turn cancelled during prepareTurnContext must not return a short-circuit
    // result (Planner / ToolDebug) — it must reject so the caller discards it.
    throwIfAborted(input.signal)

    // Planner short-circuit: no LLM needed
    const plannerResult = await this.runPlannerPath(input, ctx, stamp)
    if (plannerResult) return plannerResult

    // Tool debug short-circuit: direct tool result, no LLM
    const toolDebugResult = this.runToolDebugPath(input, ctx, stamp)
    if (toolDebugResult) return toolDebugResult

    if (!input.providerConfig) {
      throw new Error("还没有可用的 LLM Provider 配置。请先在设置页填写 Base URL、模型和 API Key。")
    }

    // Request-local provider: never stored on the instance.
    const { provider, resolvedConfig } = this.createProviderForRequest(
      input.providerConfig,
      Boolean(input.attachments?.length)
    )

    // Build prompt
    const prompt = this.buildPromptFromContext(input, ctx)
    stamp("prompt-build")

    // Yield to Vue before LLM call
    await yieldToUi()
    throwIfAborted(input.signal)

    // Guarded LLM call (buffered or streamed; both end in the same guardrail terminal)
    const llmResult = await this.runGuardedLlmCall(kind, input, ctx, prompt, provider, resolvedConfig, stamp)

    // A cancelled turn must not persist assessment/reflection/memory.
    throwIfAborted(input.signal)

    // Post-LLM: assessment (returned) + memory (fire-and-forget)
    const assessmentResult = this.runPostLlmPipeline(input, ctx, llmResult.content, stamp)

    stamp("done")

    return {
      ...llmResult,
      mode: ctx.mode,
      maxHintLevel: ctx.maxHintLevel,
      socraticDecision: ctx.socraticDecision,
      toolAgentResult: ctx.toolAgentResult,
      assessmentResult,
      memoryContext: ctx.memoryContext
    }
  }

  /**
   * Dispatch the LLM execution strategy. Streaming falls back to the buffered
   * path when the provider does not implement `stream`, reusing the same
   * already-prepared prompt (no double tool execution).
   */
  private async runGuardedLlmCall(
    kind: "complete" | "stream",
    input: TutorTurnInput,
    ctx: TurnContext,
    prompt: ReturnType<typeof buildTutorPrompt>,
    provider: LlmProvider,
    resolvedConfig: LlmProviderConfig,
    stamp: (step: string) => void
  ): Promise<LlmTurnResult> {
    if (kind === "complete" || !provider.stream) {
      return this.runNonStreamLlmCall(input, ctx, prompt, provider, stamp)
    }
    return this.runStreamLlmCall(input, ctx, prompt, provider, resolvedConfig, stamp)
  }

  // ── Shared pre-LLM pipeline ──────────────────────────────────────────

  private async prepareTurnContext(
    input: TutorTurnInput,
    stamp: (step: string) => void
  ): Promise<TurnContext> {
    const socraticDecision = selectSocraticStrategy({
      userMessage: input.userMessage,
      recentMessages: input.recentMessages,
      subjectCode: input.subjectCode,
      requestedMode: input.mode,
      requestedMaxHintLevel: input.maxHintLevel
    })

    const mode = socraticDecision.mode
    const maxHintLevel = socraticDecision.maxHintLevel

    const toolAgentResult = await runToolAgent({
      userMessage: input.userMessage,
      subjectCode: input.subjectCode,
      enabledPackIds: input.enabledPackIds,
      recentPrivateDocument: input.recentPrivateDocument,
      recentMessages: input.recentMessages,
      enableLocalKnowledgeSearch: this.options.enableLocalKnowledgeSearch,
      providerConfig: input.providerConfig,
      embeddingConfig: input.embeddingConfig
    })
    stamp("tool-agent")

    let memoryContext: LearningMemoryPromptContext | undefined
    try {
      memoryContext = await learningMemoryService.getPromptContext({
        studentId: input.studentId,
        conversationId: input.conversationId,
        subjectCode: input.subjectCode
      })
    } catch (e) {
      console.warn("[TeacherAgent] memory-load failed:", e)
      memoryContext = undefined
    }
    stamp("memory-load")

    const studentId = input.studentId ?? DEFAULT_STUDENT_ID
    const conversationId = input.conversationId ?? createDefaultConversationId(input.subjectCode)

    return { socraticDecision, mode, maxHintLevel, toolAgentResult, memoryContext, studentId, conversationId, toolDebugMode: isToolDebugMode(input.userMessage) }
  }

  // ── Planner short-circuit ─────────────────────────────────────────────

  private async runPlannerPath(
    input: TutorTurnInput,
    ctx: TurnContext,
    stamp: (step: string) => void
  ): Promise<TutorTurnResult | null> {
    if (!shouldTriggerPlanner(input.userMessage)) return null

    const studentKnowledge = await loadPlannerStudentKnowledge(ctx.studentId, input.subjectCode)
    throwIfAborted(input.signal)
    const knowledgePrerequisites = await loadPlannerKnowledgePrerequisites(input.subjectCode, studentKnowledge)
    throwIfAborted(input.signal)
    const plannerResult = planNextLearningStep({
      userMessage: input.userMessage,
      subjectCode: input.subjectCode,
      memoryContext: ctx.memoryContext,
      studentKnowledge,
      knowledgePrerequisites
    })
    const plannerContent = formatPlannerResult(plannerResult)
    const guardrailReview = reviewTutorReply({
      studentMessage: input.userMessage,
      candidateReply: plannerContent,
      mode: ctx.mode,
      maxHintLevel: ctx.maxHintLevel
    })
    const content = guardrailReview.allowed ? plannerContent : guardrailReview.fallbackReply ?? createDefaultFallback()
    stamp("planner-done")

    return {
      content,
      rawDraft: plannerContent,
      mode: ctx.mode,
      maxHintLevel: ctx.maxHintLevel,
      guardrailReview,
      promptVersion: "planner-agent-v1",
      providerName: "TeacherAgent PlannerAgent",
      model: "rules-v1",
      socraticDecision: ctx.socraticDecision,
      toolAgentResult: ctx.toolAgentResult,
      plannerResult,
      memoryContext: ctx.memoryContext
    }
  }

  // ── Tool debug short-circuit ────────────────────────────────────────

  private runToolDebugPath(
    input: TutorTurnInput,
    ctx: TurnContext,
    stamp: (step: string) => void
  ): TutorTurnResult | null {
    if (!ctx.toolDebugMode) return null
    throwIfAborted(input.signal)

    const mathResult = ctx.toolAgentResult.mathCompute

    if (mathResult?.ok && mathResult.data) {
      const content = formatToolDebugSuccess(mathResult.data)
      stamp("tool-debug-done")
      return {
        content,
        mode: ctx.mode,
        maxHintLevel: ctx.maxHintLevel,
        guardrailReview: {
          allowed: true,
          maxHintLevelDetected: "L0",
          violations: [],
          rewriteRequired: false,
          source: "rule",
          rewriteAttempts: 0
        },
        promptVersion: "tool-debug-v1",
        providerName: "TeacherAgent ToolDebug",
        model: "tool-direct-result",
        socraticDecision: ctx.socraticDecision,
        toolAgentResult: ctx.toolAgentResult
      }
    }

    if (mathResult && !mathResult.ok) {
      const content = formatToolDebugFailure(mathResult)
      stamp("tool-debug-done")
      return {
        content,
        mode: ctx.mode,
        maxHintLevel: ctx.maxHintLevel,
        guardrailReview: {
          allowed: true,
          maxHintLevelDetected: "L0",
          violations: [],
          rewriteRequired: false,
          source: "rule",
          rewriteAttempts: 0
        },
        promptVersion: "tool-debug-v1",
        providerName: "TeacherAgent ToolDebug",
        model: "tool-direct-result",
        socraticDecision: ctx.socraticDecision,
        toolAgentResult: ctx.toolAgentResult
      }
    }

    // No math compute result at all (e.g., non-math subject in tool debug mode)
    // Fall through to normal LLM path
    return null
  }

  // ── Prompt building ───────────────────────────────────────────────────

  private buildPromptFromContext(input: TutorTurnInput, ctx: TurnContext) {
    const isLocal = isLocalProvider(input.providerConfig?.isLocal)
    const privacy = input.cloudPrivacy

    // For cloud providers, filter out private context unless explicitly authorized.
    // Local providers always get full context.
    const shouldSendStudentContext = isLocal || privacy?.sendStudentProfileToCloud === true
    const shouldSendSessionMemory = isLocal || privacy?.sendSessionMemoryToCloud === true
    const shouldSendPrivateDocs = isLocal || privacy?.sendPrivateDocumentContextToCloud === true

    // Filter knowledge context to remove private document nodes if not authorized for cloud
    let knowledgeContext = ctx.toolAgentResult.knowledgeContext
    if (!shouldSendPrivateDocs && knowledgeContext) {
      const filteredNodes = knowledgeContext.nodes.filter((n) => n.sourceType !== "private_document")
      if (filteredNodes.length !== knowledgeContext.nodes.length) {
        knowledgeContext = { ...knowledgeContext, nodes: filteredNodes }
      }
    }

    return buildTutorPrompt({
      subjectCode: input.subjectCode,
      mode: ctx.mode,
      maxHintLevel: ctx.maxHintLevel,
      userMessage: input.userMessage,
      recentMessages: input.recentMessages,
      knowledgeContext,
      toolContextNotes: ctx.toolAgentResult.toolContextNotes,
      studentContext: shouldSendStudentContext ? ctx.memoryContext?.studentContext : undefined,
      sessionMemory: shouldSendSessionMemory ? ctx.memoryContext?.sessionMemory : undefined,
      attachments: input.attachments,
      teachingStrategy: {
        strategy: ctx.socraticDecision.strategy,
        shouldAskQuestion: ctx.socraticDecision.shouldAskQuestion,
        explanationDepth: ctx.socraticDecision.explanationDepth,
        intent: ctx.socraticDecision.intent,
        rationale: ctx.socraticDecision.rationale
      }
    })
  }

  // ── Non-stream LLM call ───────────────────────────────────────────────

  private async runNonStreamLlmCall(
    input: TutorTurnInput,
    ctx: TurnContext,
    prompt: ReturnType<typeof buildTutorPrompt>,
    provider: LlmProvider,
    stamp: (step: string) => void
  ): Promise<LlmTurnResult> {
    stamp("llm-start")

    const draft = await provider.complete({
      messages: prompt.messages,
      temperature: input.temperature ?? 0.4,
      maxTokens: input.maxTokens ?? 4096,
      signal: input.signal
    })
    stamp("llm-complete")

    // Never run the guardrail/rewrite budget on behalf of a cancelled turn.
    throwIfAborted(input.signal)

    const guardrailResult = await applyGuardrail({
      provider,
      studentMessage: input.userMessage,
      candidateReply: draft.content,
      mode: ctx.mode,
      maxHintLevel: ctx.maxHintLevel
    })
    stamp("guardrail")

    return {
      content: guardrailResult.content,
      rawDraft: draft.content,
      guardrailReview: guardrailResult.guardrailReview,
      promptVersion: prompt.promptVersion,
      providerName: draft.providerName,
      model: draft.model
    }
  }

  // ── Stream LLM call ──────────────────────────────────────────────────

  private async runStreamLlmCall(
    input: TutorTurnInput,
    ctx: TurnContext,
    prompt: ReturnType<typeof buildTutorPrompt>,
    provider: LlmProvider,
    resolvedConfig: LlmProviderConfig,
    stamp: (step: string) => void
  ): Promise<LlmTurnResult> {
    stamp("llm-start")
    throwIfAborted(input.signal)

    let fullContent = ""
    let buffer = ""
    let aborted = false
    let fallbackReply: string | undefined
    let rejectedDraft = ""

    const sentenceEndPattern = /[。！？.!?\n]/
    const violationSentinel: GuardrailViolation[] = []

    const stream = provider.stream!({
      messages: prompt.messages,
      temperature: input.temperature ?? 0.4,
      maxTokens: input.maxTokens ?? 4096,
      signal: input.signal
    })
    const iterator = stream[Symbol.asyncIterator]()
    let completedNormally = false

    try {
      while (true) {
        throwIfAborted(input.signal)
        // raceAbort makes cancellation effective even when the provider's
        // iterator parks without honoring the signal itself.
        const next = await raceAbort(iterator.next(), input.signal)
        const chunk: LlmStreamChunk = next.done ? { content: "", done: true } : next.value

        if (chunk.done) {
          if (buffer.length > 0) {
            const check = reviewTutorReplyFast(buffer, ctx.mode, ctx.maxHintLevel)
            if (check.allowed) {
              fullContent += buffer
            } else {
              violationSentinel.push(...check.violations)
              aborted = true
              rejectedDraft = fullContent + buffer
              fallbackReply = createFallbackForViolations(check.violations, input.userMessage)
              break
            }
          }
          completedNormally = true
          break
        }

        buffer += chunk.content

        let sentenceEndIndex: number
        while ((sentenceEndIndex = buffer.search(sentenceEndPattern)) !== -1) {
          const sentence = buffer.slice(0, sentenceEndIndex + 1)
          buffer = buffer.slice(sentenceEndIndex + 1)

          // Check sentence-level guardrail (fast check)
          const check = reviewTutorReplyFast(sentence, ctx.mode, ctx.maxHintLevel)
          if (!check.allowed) {
            violationSentinel.push(...check.violations)
            aborted = true
            rejectedDraft = fullContent + sentence
            fallbackReply = createFallbackForViolations(check.violations, input.userMessage)
            break
          }

          // Also check cumulative content to catch multi-sentence violations
          const cumulativeCheck = reviewTutorReplyFast(fullContent + sentence, ctx.mode, ctx.maxHintLevel)
          if (!cumulativeCheck.allowed) {
            violationSentinel.push(...cumulativeCheck.violations)
            aborted = true
            rejectedDraft = fullContent + sentence
            fallbackReply = createFallbackForViolations(cumulativeCheck.violations, input.userMessage)
            break
          }

          fullContent += sentence
        }

        if (aborted) break
      }
    } catch (error) {
      // Cancellation is not a provider error: do not stamp it as one.
      if (!input.signal?.aborted) stamp("llm-error")
      throw error
    } finally {
      // Release the underlying generator (detaches IPC channel listeners) when
      // we stop consuming early — violation abort, cancellation, or error.
      if (!completedNormally) {
        void iterator.return?.()
      }
    }

    stamp("llm-complete")

    // Unified guardrail terminal — identical semantics to the non-stream path.
    let content: string
    let guardrailReview: GuardrailReview

    if (aborted) {
      // Hard violation detected mid-transport: deterministic fallback terminal.
      // The student never sees any part of the rejected draft.
      const violations = [...new Set(violationSentinel)]
      content = fallbackReply ?? createFallbackForViolations(violations, input.userMessage)
      guardrailReview = {
        allowed: false,
        maxHintLevelDetected: detectHintLevelFromContent(rejectedDraft),
        violations,
        rewriteRequired: true,
        fallbackReply: content,
        source: "rule",
        rewriteAttempts: 0
      }
    } else {
      // Clean completion: run the exact same full guardrail pipeline as
      // non-stream turns (rule → LLM review if flagged → rewrite once → fallback).
      const guardrailResult = await applyGuardrail({
        provider,
        studentMessage: input.userMessage,
        candidateReply: fullContent,
        mode: ctx.mode,
        maxHintLevel: ctx.maxHintLevel
      })
      content = guardrailResult.content
      guardrailReview = guardrailResult.guardrailReview
    }

    stamp("guardrail")

    // A turn cancelled right before completion must not update the UI.
    throwIfAborted(input.signal)

    // Notify UI that streaming is complete — only send the final reviewed content
    input.onStreamUpdate?.(content, true)

    return {
      content,
      rawDraft: aborted ? undefined : fullContent,
      guardrailReview,
      promptVersion: prompt.promptVersion,
      providerName: provider.providerName,
      model: resolvedConfig.model
    }
  }

  // ── Post-LLM pipeline (assessment + memory, fire-and-forget) ──────────

  private runPostLlmPipeline(
    input: TutorTurnInput,
    ctx: TurnContext,
    content: string,
    stamp: (step: string) => void
  ): AssessmentResult {
    const assessmentResult = assessTutorTurn({
      studentId: ctx.studentId,
      conversationId: ctx.conversationId,
      subjectCode: input.subjectCode,
      userMessage: input.userMessage,
      tutorReply: content,
      recentMessages: input.recentMessages,
      mode: ctx.mode,
      maxHintLevel: ctx.maxHintLevel,
      knowledgeNodes: ctx.toolAgentResult.knowledgeContext?.nodes
    })
    stamp("assessment")

    void persistAssessmentResult(assessmentResult).catch((e) => {
      console.warn("[TeacherAgent] assessment persist failed:", e)
    })

    void learningMemoryService.recordTutorTurn({
      studentId: input.studentId,
      conversationId: input.conversationId,
      subjectCode: input.subjectCode,
      userMessage: input.userMessage,
      tutorReply: content,
      recentMessages: input.recentMessages,
      mode: ctx.mode,
      maxHintLevel: ctx.maxHintLevel,
      strategy: ctx.socraticDecision.strategy,
      knowledgeNodes: ctx.toolAgentResult.knowledgeContext?.nodes,
      providerConfig: input.providerConfig
        ? { baseUrl: input.providerConfig.baseUrl, apiKeyRef: input.providerConfig.apiKeyRef ?? "", model: input.providerConfig.model }
        : undefined,
      isLocalProvider: isLocalProvider(input.providerConfig?.isLocal),
      enableCloudReflection: input.cloudPrivacy?.enableCloudReflection ?? false
    }).catch((e) => {
      console.warn("[TeacherAgent] memory-save failed:", e)
    })

    return assessmentResult
  }

  /**
   * Build the provider for a single turn and return it together with the
   * request-local resolved config. Nothing is stored on the orchestrator
   * instance: concurrent turns with different models or attachments keep
   * fully isolated provider/config state, so result metadata cannot cross-wire.
   */
  private createProviderForRequest(
    config: LlmProviderConfig,
    hasAttachments = false
  ): { provider: LlmProvider; resolvedConfig: LlmProviderConfig } {
    const resolvedConfig = resolveModelForAttachments(config, hasAttachments)
    const provider = this.options.createProvider?.(resolvedConfig) ?? createOpenAICompatibleProvider(resolvedConfig)
    return { provider, resolvedConfig }
  }
}

export function createTutorOrchestrator(options?: TutorOrchestratorOptions): TutorOrchestrator {
  return new TutorOrchestrator(options)
}

/**
 * Resolve the correct model based on whether image attachments are present.
 * - With images: use visionModel ?? model (and verify vision capability)
 * - Without images: use textModel ?? model
 */
function resolveModelForAttachments(config: LlmProviderConfig, hasAttachments: boolean): LlmProviderConfig {
  if (!hasAttachments) {
    return withResolvedModel(config, config.textModel?.trim() || config.model)
  }
  // Image path: must have visionModel or vision capability
  if (!config.visionModel && !config.capabilities?.vision) {
    throw new Error(
      "当前 Provider 未配置视觉模型，无法处理图片。请在设置中配置 visionModel，或先手动输入图片中的题目文字。"
    )
  }
  return withResolvedModel(config, config.visionModel?.trim() || config.model)
}

function withResolvedModel(config: LlmProviderConfig, model: string): LlmProviderConfig {
  return {
    ...config,
    model: normalizeProviderModel({
      providerName: config.providerName,
      baseUrl: config.baseUrl,
      model
    })
  }
}

// ── Shared helpers ──────────────────────────────────────────────────────

function createStamp(onTiming?: (step: string, stepMs: number, totalMs: number) => void) {
  const turnStartedAt = performance.now()
  let lastStampTime = turnStartedAt

  return (step: string) => {
    const now = performance.now()
    const stepMs = Math.round(now - lastStampTime)
    const totalMs = Math.round(now - turnStartedAt)
    lastStampTime = now
    onTiming?.(step, stepMs, totalMs)
  }
}

function yieldToUi(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function createDefaultFallback(): string {
  return "我先不直接给完整答案。我们把问题缩小到下一步：你能先说说自己的第一步思路吗？"
}

async function loadPlannerStudentKnowledge(
  studentId: string,
  subjectCode: SubjectCode
): Promise<StudentKnowledgeMastery[]> {
  try {
    return await loadStudentKnowledge(studentId, subjectCode, 20)
  } catch {
    return []
  }
}

async function loadPlannerKnowledgePrerequisites(
  subjectCode: SubjectCode,
  studentKnowledge: StudentKnowledgeMastery[]
): Promise<KnowledgePrerequisite[]> {
  const weakNodeIds = studentKnowledge
    .filter((item) => item.masteryProbability < 0.8 || item.attemptsCount < 2)
    .sort((left, right) => left.masteryProbability - right.masteryProbability)
    .map((item) => item.knowledgeNodeId)
    .slice(0, 8)

  if (!weakNodeIds.length) {
    return []
  }

  try {
    return await loadKnowledgePrerequisites(subjectCode, weakNodeIds, 30)
  } catch {
    return []
  }
}

async function applyGuardrail(input: GuardrailInput & { provider: LlmProvider }): Promise<{
  content: string
  guardrailReview: GuardrailReview
}> {
  const ruleReview = reviewTutorReply(input)
  if (ruleReview.allowed) {
    return {
      content: input.candidateReply,
      guardrailReview: ruleReview
    }
  }

  let review = ruleReview
  try {
    const llmReview = await reviewTutorReplyWithLlm(input.provider, input)
    review = mergeGuardrailReviews(ruleReview, llmReview)
  } catch {
    review = ruleReview
  }

  try {
    const rewritten = await rewriteTutorReplyOnce(input.provider, {
      ...input,
      rewriteInstruction: review.rewriteInstruction
    })
    if (!rewritten) {
      throw new Error("Guardrail rewrite returned an empty reply.")
    }

    const rewriteReview = reviewTutorReply({
      ...input,
      candidateReply: rewritten
    })

    if (rewriteReview.allowed) {
      return {
        content: rewritten,
        guardrailReview: {
          ...rewriteReview,
          source: review.source === "merged" ? "merged" : rewriteReview.source,
          rewriteAttempts: 1
        }
      }
    }
  } catch {
    // If review or rewrite fails, do not expose the rejected draft.
  }

  return {
    content: review.fallbackReply ?? createDefaultFallback(),
    guardrailReview: {
      ...review,
      allowed: false,
      rewriteRequired: true,
      rewriteAttempts: 1
    }
  }
}

async function persistAssessmentResult(result: AssessmentResult): Promise<void> {
  try {
    await saveAssessmentResult(result)
  } catch {
    // Browser preview and early desktop setup can run without Tauri IPC; assessment still returns to callers.
  }
}

function createDefaultConversationId(subjectCode: SubjectCode): string {
  return `local-default-conversation-${subjectCode}`
}

function createFallbackForViolations(violations: GuardrailViolation[], studentMessage: string): string {
  if (violations.includes("internal_leak")) {
    return "我先不直接给完整答案。我们从最小的一步开始：你先判断这题最像哪一类问题，或者把你第一眼看到的条件说出来。"
  }

  if (violations.includes("privacy_risk")) {
    return "我不会索要你的个人信息。我们回到学习本身：你能说说对这道题的第一印象吗？"
  }

  if (violations.includes("tone_problem")) {
    return "我们保持友好的学习氛围。你能重新描述一下你的问题吗？"
  }

  const hasAttempt = /(?:我觉得|我认为|我算|我的思路|是不是|因为|所以|=|答案)/.test(studentMessage)

  if (hasAttempt) {
    return "我先不直接给完整答案，避免把关键训练步骤跳过去。你已经给出了一点思路，我们把范围缩小：你能指出自己这一步用到的定义或公式是什么吗？"
  }

  return "我先不直接给完整答案。我们从最小的一步开始：你先判断这题最像哪一类问题，或者把你第一眼看到的条件说出来。"
}

function detectHintLevelFromContent(content: string): HintLevel {
  if (/(?:完整解法|完整过程|详细解答|照抄|直接抄)/.test(content) ||
      /(?:complete\s+solution|full\s+solution|detailed\s+solution)/i.test(content)) {
    return "L4"
  }

  if (/(?:最终答案|答案是|所以答案|正确选项|选项为)\s*[:：]?\s*[A-D]/i.test(content) ||
      /(?:final\s+answer|the\s+answer\s+is)/i.test(content)) {
    return "L3"
  }

  if (/(?:可以先|试着|关键是|下一步|把.*改写|代入|化简|比较)/.test(content) ||
      /(?:you\s+can\s+start|try\s+to|the\s+key\s+is|next\s+step)/i.test(content)) {
    return "L2"
  }

  if (/(?:想一想|先判断|你先看|它属于哪一类|从哪里入手)/.test(content) ||
      /(?:think\s+about|first\s+decide|look\s+at)/i.test(content)) {
    return "L1"
  }

  return "L0"
}

function formatToolDebugSuccess(data: MathComputeOutput): string {
  const sections = [
    "[tool_debug]",
    "",
    `- engine: ${wrapInlineCode(data.engine)}`,
    `- confidence: ${wrapInlineCode(String(data.confidence))}`,
    `- operation: ${wrapInlineCode(data.operation)}`,
    `- expression: ${wrapInlineCode(data.normalizedExpression)}`,
    `- raw result: ${wrapInlineCode(data.result)}`,
    data.latex ? "- rendered result:" : "",
    data.latex ? "" : "",
    data.latex ? `$$\n${data.latex}\n$$` : "",
    data.warnings.length > 0 ? `- warnings: ${wrapInlineCode(data.warnings.join("; "))}` : "",
    `- is_fallback: ${wrapInlineCode(String(data.isFallback ?? false))}`
  ]

  return sections.filter(Boolean).join("\n")
}

function formatToolDebugFailure(mathResult: NonNullable<ToolAgentResult["mathCompute"]>): string {
  const errorCode = mathResult.errorCode ?? "EXECUTION_ERROR"
  const errorMsg = mathResult.error ?? "unknown error"
  const warnings = mathResult.data?.warnings ?? []

  const sections = [
    "[tool_debug]",
    "",
    "- status: `failed`",
    `- error_code: ${wrapInlineCode(errorCode)}`,
    `- error: ${wrapInlineCode(errorMsg)}`,
    warnings.length > 0 ? `- warnings: ${wrapInlineCode(warnings.join("; "))}` : ""
  ]

  return sections.filter(Boolean).join("\n")
}

function wrapInlineCode(value: string): string {
  return `\`${value.replace(/`/g, "\\`")}\``
}
