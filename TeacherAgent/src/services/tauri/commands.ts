import { invoke, Channel } from "@tauri-apps/api/core"
import type { AssessmentResult } from "../../types/assessment"
import type { LlmCompletionRequest, LlmCompletionResult, LlmProviderConfig, LlmStreamChunk } from "../llm/types"
import { raceAbort, throwIfAborted } from "../llm/turnAbort"
import { AsyncEventQueue } from "./streamQueue"
import type { KnowledgePrerequisite, StudentKnowledgeMastery } from "../../types/learning"
import type { LongTermMemoryEntry, ShortTermMemorySnapshot, StudentCognitiveProfile } from "../../types/memory"
import type { ReflectionRecord } from "../../types/reflection"

export interface DatabaseStatus {
  databasePath: string
  migrated: boolean
  appliedMigrations: string[]
  userVersion: number
}

export interface LocalSmokeCheckResult {
  ping: string
  database: DatabaseStatus
  conversationId: string
  messageRoundtrip: boolean
  rollbackVerified: boolean
}

export interface LocalConversation {
  studentId: string
  subjectId: string
  conversationId: string
  subjectCode: string
  title: string
  status: string
  createdAt: string
  updatedAt: string
}

export interface SaveMessageInput {
  id: string
  conversationId: string
  role: "student" | "tutor" | "system" | "tool"
  content: string
  contentFormat?: "markdown" | "text"
  knowledgeRefsJson?: string
  toolRefsJson?: string
  guardrailJson?: string
  attachmentsJson?: string
  createdAt?: string
}

export interface StoredMessage {
  id: string
  conversationId: string
  role: "student" | "tutor" | "system" | "tool"
  content: string
  contentFormat: string
  knowledgeRefsJson: string
  toolRefsJson: string
  guardrailJson: string
  attachmentsJson: string
  createdAt: string
}

export interface LearningMemoryContextPayload {
  profile?: StudentCognitiveProfile
  shortTermMemory?: ShortTermMemorySnapshot
  longTermMemories: LongTermMemoryEntry[]
}

export interface SaveLearningMemoryInput {
  profile?: StudentCognitiveProfile
  shortTermMemory?: ShortTermMemorySnapshot
  longTermMemories: LongTermMemoryEntry[]
}

export interface SaveReflectionRecordInput {
  id: string
  conversationId: string
  studentId: string
  summary: string
  knowledgeUpdatesJson: string
  misconceptionsJson: string
  strategyInsightsJson: string
  nextBestActionJson: string
  confidence: number
  createdAt?: string
}

export interface StoredReflectionRecord {
  id: string
  conversationId: string
  studentId: string
  summary: string
  confidence: number
  createdAt: string
}

export interface SaveAssessmentResultInput {
  id: string
  studentId: string
  subjectCode: string
  learningGoalId?: string
  conversationId?: string
  assessmentType: string
  overallLevel: string
  strengthsJson: string
  weaknessesJson: string
  recommendationsJson: string
  evidenceJson: string
  createdAt?: string
}

export interface StoredAssessmentResult {
  id: string
  studentId: string
  subjectId: string
  conversationId?: string
  assessmentType: string
  overallLevel: string
  createdAt: string
}

export interface StoredProviderConfig {
  id: string
  name: string
  providerType: string
  baseUrl: string
  model: string
  apiKeyRef?: string
  isDefault: boolean
  isLocal: boolean
  textModel?: string
  visionModel?: string
  supportsVision?: boolean
  createdAt: string
  updatedAt: string
}

export interface StoredProviderApiKeyRef {
  apiKeyRef: string
  hasApiKey: boolean
}

export interface SaveProviderConfigInput {
  id?: string
  name: string
  providerType: string
  baseUrl: string
  model: string
  apiKeyRef?: string
  isDefault: boolean
  isLocal: boolean
  textModel?: string
  visionModel?: string
  supportsVision?: boolean
}

export async function pingBackend(): Promise<string> {
  return invoke<string>("ping")
}

export async function initializeDatabase(): Promise<DatabaseStatus> {
  return invoke<DatabaseStatus>("init_database")
}

export async function runLocalSmokeCheck(): Promise<LocalSmokeCheckResult> {
  return invoke<LocalSmokeCheckResult>("run_local_smoke_check")
}

export async function ensureDefaultConversation(subjectCode: string): Promise<LocalConversation> {
  return invoke<LocalConversation>("ensure_default_conversation", { subjectCode })
}

export async function listConversations(subjectCode: string, limit = 30, status?: string): Promise<LocalConversation[]> {
  return invoke<LocalConversation[]>("list_conversations", { subjectCode, limit, status })
}

export async function createConversation(subjectCode: string, title?: string): Promise<LocalConversation> {
  return invoke<LocalConversation>("create_conversation", { subjectCode, title })
}

export async function updateConversationTitle(conversationId: string, title: string): Promise<LocalConversation> {
  return invoke<LocalConversation>("update_conversation_title", { conversationId, title })
}

export async function archiveConversation(conversationId: string): Promise<LocalConversation> {
  return invoke<LocalConversation>("archive_conversation", { conversationId })
}

export async function unarchiveConversation(conversationId: string): Promise<LocalConversation> {
  return invoke<LocalConversation>("unarchive_conversation", { conversationId })
}

export async function deleteConversation(conversationId: string): Promise<void> {
  return invoke<void>("delete_conversation", { conversationId })
}

export async function saveMessage(input: SaveMessageInput): Promise<StoredMessage> {
  return invoke<StoredMessage>("save_message", { input })
}

export async function listMessages(conversationId: string, limit = 80): Promise<StoredMessage[]> {
  return invoke<StoredMessage[]>("list_messages", { conversationId, limit })
}

export async function loadStudentKnowledge(
  studentId: string,
  subjectCode: string,
  limit = 20,
  knowledgeNodeIds?: string[]
): Promise<StudentKnowledgeMastery[]> {
  return invoke<StudentKnowledgeMastery[]>("load_student_knowledge", {
    studentId,
    subjectCode,
    limit,
    ...(knowledgeNodeIds === undefined ? {} : { knowledgeNodeIds })
  })
}

export async function loadKnowledgePrerequisites(
  subjectCode: string,
  knowledgeNodeIds: string[],
  limit = 30
): Promise<KnowledgePrerequisite[]> {
  return invoke<KnowledgePrerequisite[]>("load_knowledge_prerequisites", {
    subjectCode,
    knowledgeNodeIds,
    limit
  })
}

export async function loadLearningMemoryContext(
  studentId: string,
  conversationId: string,
  subjectCode: string
): Promise<LearningMemoryContextPayload> {
  return invoke<LearningMemoryContextPayload>("load_learning_memory_context", {
    studentId,
    conversationId,
    subjectCode
  })
}

export async function saveLearningMemoryState(input: SaveLearningMemoryInput): Promise<LearningMemoryContextPayload> {
  return invoke<LearningMemoryContextPayload>("save_learning_memory_state", { input })
}

export async function saveReflectionRecord(record: ReflectionRecord): Promise<StoredReflectionRecord> {
  return invoke<StoredReflectionRecord>("save_reflection_record", {
    input: {
      id: record.id,
      conversationId: record.conversationId,
      studentId: record.studentId,
      summary: record.conversationSummary,
      knowledgeUpdatesJson: JSON.stringify({
        observations: record.observations,
        updates: record.knowledgeUpdates
      }),
      misconceptionsJson: JSON.stringify({
        inferences: record.inferences,
        uncertainties: record.uncertainties,
        items: record.misconceptions
      }),
      strategyInsightsJson: JSON.stringify(record.strategyInsights),
      nextBestActionJson: JSON.stringify(record.nextBestAction),
      confidence: record.confidence,
      createdAt: record.createdAt
    } satisfies SaveReflectionRecordInput
  })
}

export async function saveAssessmentResult(result: AssessmentResult): Promise<StoredAssessmentResult> {
  return invoke<StoredAssessmentResult>("save_assessment_result", {
    input: {
      id: result.id,
      studentId: result.studentId,
      subjectCode: result.subjectCode,
      conversationId: result.conversationId,
      assessmentType: result.assessmentMode,
      overallLevel: result.diagnosticReport?.overallLevel ?? "unknown",
      strengthsJson: JSON.stringify(result.knowledgeUpdates.filter((update) => update.masteryDelta > 0)),
      weaknessesJson: JSON.stringify(result.detectedMisconceptions),
      recommendationsJson: JSON.stringify([
        {
          action: result.suggestedNextAction,
          correctness: result.correctness,
          confidence: result.confidence
        }
      ]),
      evidenceJson: JSON.stringify(result),
      createdAt: result.createdAt
    } satisfies SaveAssessmentResultInput
  })
}

export async function saveProviderConfig(input: SaveProviderConfigInput): Promise<StoredProviderConfig> {
  return invoke<StoredProviderConfig>("save_provider_config", { input })
}

export async function loadDefaultProviderConfig(): Promise<StoredProviderConfig | null> {
  return invoke<StoredProviderConfig | null>("load_default_provider_config")
}

export async function listProviderConfigs(): Promise<StoredProviderConfig[]> {
  return invoke<StoredProviderConfig[]>("list_provider_configs")
}

export async function deleteProviderConfig(id: string): Promise<boolean> {
  return invoke<boolean>("delete_provider_config", { input: { id } })
}

export async function saveProviderApiKey(
  providerId: string,
  apiKey: string,
  baseUrl: string
): Promise<StoredProviderApiKeyRef> {
  return invoke<StoredProviderApiKeyRef>("save_provider_api_key", {
    input: {
      providerId,
      apiKey,
      baseUrl
    }
  })
}

export async function deleteProviderApiKey(apiKeyRef: string): Promise<boolean> {
  return invoke<boolean>("delete_provider_api_key", {
    input: {
      apiKeyRef
    }
  })
}

/**
 * Non-streaming LLM completion via Rust backend.
 *
 * Cancellation: `request.signal` is honored on the JS side — an aborted request
 * rejects with `TurnAbortedError` and its late result is discarded. Tauri
 * `invoke` has no native cancellation, so the Rust-side HTTP request may still
 * run to completion; nothing after the abort observes its result.
 */
export async function completeLlmChat(
  config: LlmProviderConfig,
  request: LlmCompletionRequest
): Promise<LlmCompletionResult> {
  throwIfAborted(request.signal)

  return raceAbort(
    invoke<LlmCompletionResult>("complete_llm_chat", {
      input: {
        providerName: config.providerName,
        baseUrl: config.baseUrl,
        model: config.model,
        apiKeyRef: config.apiKeyRef,
        isLocal: Boolean(config.isLocal),
        messages: request.messages,
        temperature: request.temperature,
        maxTokens: request.maxTokens
      }
    }),
    request.signal
  )
}

/**
 * Stream LLM chat completion via Rust backend (Tauri 2 Channel).
 * API key never leaves the Rust process — all requests are made server-side.
 *
 * Transport: channel messages wake an event-driven `AsyncEventQueue` (no
 * polling). Cancellation: when `request.signal` aborts, the queue is sealed,
 * the parked consumer rejects with `TurnAbortedError`, and late channel
 * messages are discarded. The Rust-side stream may continue in the background
 * until the backend finishes; nothing after the abort observes its chunks.
 */
export async function* completeLlmChatStream(
  config: LlmProviderConfig,
  request: LlmCompletionRequest
): AsyncGenerator<LlmStreamChunk> {
  throwIfAborted(request.signal)

  const queue = new AsyncEventQueue<LlmStreamChunk>()

  const onChunk = new Channel<LlmStreamChunk>()
  onChunk.onmessage = (chunk: LlmStreamChunk) => {
    if (chunk.done) {
      queue.end()
    } else {
      queue.push(chunk)
    }
  }

  const onAbort = () => {
    queue.abort()
    // Detach the channel so late chunks after cancellation are dropped.
    onChunk.onmessage = () => undefined
  }
  request.signal?.addEventListener("abort", onAbort, { once: true })

  // Runs in background; completion/failure is surfaced through the queue.
  const invokePromise = invoke<void>("complete_llm_chat_stream", {
    input: {
      providerName: config.providerName,
      baseUrl: config.baseUrl,
      model: config.model,
      apiKeyRef: config.apiKeyRef,
      isLocal: Boolean(config.isLocal),
      messages: request.messages,
      temperature: request.temperature,
      maxTokens: request.maxTokens
    },
    channel: onChunk
  })
    .then(() => queue.end())
    .catch((err) => queue.fail(err instanceof Error ? err : new Error(String(err))))

  try {
    while (true) {
      // Check abort before calling queue.next() — when the signal is already
      // aborted, queue.next() would reject (ABORT_SENTINEL terminal) but
      // raceAbort would short-circuit and never await it, leaving an unhandled
      // rejection. throwIfAborted avoids calling queue.next() at all.
      throwIfAborted(request.signal)
      // raceAbort also covers an abort that fires while no consumer is parked.
      const next = await raceAbort(queue.next(), request.signal)
      if (next.done) break
      yield next.value
    }
    // Surface any late invoke settlement (always resolved; errors went through the queue).
    await invokePromise
  } finally {
    request.signal?.removeEventListener("abort", onAbort)
    // Stop observing the channel whether the consumer finished, failed, or was cancelled.
    onChunk.onmessage = () => undefined
    queue.abort()
  }
}

export interface VectorSearchResult {
  entityType: string
  entityId: string
  score: number
  embeddingModel: string
}

export interface MathComputeInput {
  operation: "simplify" | "limit" | "differentiate" | "integrate" | "solve" | "evaluate"
  expression: string
  variable?: string
  point?: number
  parameters?: Record<string, string>
}

export interface MathComputeOutput {
  result: string
  latex?: string
  normalizedExpression: string
  operation: string
  steps: string[]
  warnings: string[]
  confidence: number
  engine: string
}

export async function computeMathExpression(input: MathComputeInput): Promise<MathComputeOutput> {
  return invoke<MathComputeOutput>("compute_math_expression", { input })
}

export interface BktParams {
  pLo: number
  pT: number
  pG: number
  pS: number
}

export interface BktUpdateResult {
  pKnow: number
  learned: boolean
  observationLikelihood: number
}

export async function bktUpdateMastery(
  pKnow: number,
  correct: boolean,
  params?: BktParams,
  learnedThreshold?: number
): Promise<BktUpdateResult> {
  return invoke<BktUpdateResult>("bkt_update_mastery", {
    pKnow,
    correct,
    params: params ?? null,
    learnedThreshold: learnedThreshold ?? null
  })
}

export async function storeVectorEmbedding(
  id: string,
  entityType: string,
  entityId: string,
  embedding: number[],
  embeddingModel: string
): Promise<boolean> {
  return invoke<boolean>("store_vector_embedding", {
    id,
    entityType,
    entityId,
    embedding,
    embeddingModel
  })
}

export async function searchVectorEmbeddings(
  entityType: string,
  queryEmbedding: number[],
  embeddingModel: string,
  limit = 10,
  entityIds?: string[]
): Promise<VectorSearchResult[]> {
  return invoke<VectorSearchResult[]>("search_vector_embeddings", {
    entityType,
    queryEmbedding,
    embeddingModel,
    limit,
    entityIds: entityIds ?? null
  })
}

export async function generateEmbedding(
  baseUrl: string,
  apiKeyRef: string,
  model: string,
  inputText: string
): Promise<number[]> {
  return invoke<number[]>("generate_embedding", {
    baseUrl,
    apiKeyRef,
    model,
    inputText
  })
}

export interface EmbeddingBatchProgress {
  completed: number
  total: number
  batchIndex: number
  totalBatches: number
}

/**
 * Generate embeddings for multiple texts in batch via Rust backend.
 * Uses OpenAI-compatible /embeddings endpoint with array input.
 * Reports progress via Channel callback.
 */
export async function generateEmbeddingsBatch(
  baseUrl: string,
  apiKeyRef: string,
  model: string,
  texts: string[],
  batchSize?: number,
  delayMs?: number,
  onProgress?: (progress: EmbeddingBatchProgress) => void
): Promise<number[][]> {
  const progressChannel = new Channel<EmbeddingBatchProgress>()
  if (onProgress) {
    progressChannel.onmessage = onProgress
  }

  return invoke<number[][]>("generate_embeddings_batch", {
    baseUrl,
    apiKeyRef,
    model,
    texts,
    batchSize: batchSize ?? 64,
    delayMs: delayMs ?? 200,
    progressChannel
  })
}

/**
 * Count stored embeddings by entity type and model.
 */
export async function countVectorEmbeddings(
  entityType: string,
  embeddingModel: string
): Promise<number> {
  return invoke<number>("count_vector_embeddings", {
    entityType,
    embeddingModel
  })
}

/**
 * Delete embeddings matching entity_type + embedding_model + a set of entity_ids.
 * Used to clean stale vectors from a previous model before regenerating,
 * scoped to approved content only.
 */
export async function deleteEmbeddingsByModelAndIds(
  entityType: string,
  embeddingModel: string,
  entityIds: string[]
): Promise<number> {
  return invoke<number>("delete_embeddings_by_model_and_ids", {
    entityType,
    embeddingModel,
    entityIds
  })
}

// ─── Knowledge Seed Commands ────────────────────────────────────────────────────

export interface SeedResult {
  inserted: number
  updated: number
  skipped: number
  errors: string[]
}

export interface KnowledgeNodeSearchResult {
  id: string
  title: string
  summary: string
  level: string
  difficulty: number
  prerequisites: string[]
  misconceptions: string[]
  socraticHints: unknown[]
  reviewStatus: string
  sourceId?: string
  sourceTitle?: string
  licenseSnapshot?: string
}

/**
 * Seed knowledge nodes from a JSON seed file into the knowledge_nodes table.
 * Always uses InsertOnly mode — no caller can request authoritative or overwrite.
 */
export async function seedKnowledgeNodesFromJson(
  seedJson: string
): Promise<SeedResult> {
  return invoke<SeedResult>("seed_knowledge_nodes_from_json", { seedJson })
}

/**
 * Sync approved manifest: validate all node IDs against the built-in registry,
 * then repair review_status and subject_id in a single transaction.
 * This is the ONLY way to perform authoritative sync.
 */
export async function syncApprovedManifest(): Promise<SeedResult> {
  return invoke<SeedResult>("sync_approved_manifest")
}

/**
 * Count knowledge nodes by subject code.
 */
export async function countKnowledgeNodes(subjectCode: string): Promise<number> {
  return invoke<number>("count_knowledge_nodes", { subjectCode })
}

/**
 * Count all knowledge nodes in the database (across all subjects).
 */
export async function countAllKnowledgeNodes(): Promise<number> {
  return invoke<number>("count_all_knowledge_nodes")
}

/**
 * Count knowledge nodes with review_status = 'approved', grouped by subject.
 * Returns array of [subjectCode, approvedCount] tuples.
 */
export async function getApprovedKnowledgeNodeCountsBySubject(): Promise<[string, number][]> {
  return invoke<[string, number][]>("get_approved_knowledge_node_counts_by_subject")
}

/**
 * Count all knowledge nodes with review_status = 'approved'.
 */
export async function countApprovedKnowledgeNodes(): Promise<number> {
  return invoke<number>("count_approved_knowledge_nodes")
}

/**
 * Get knowledge node counts grouped by subject.
 * Returns array of [subjectCode, count] tuples.
 */
export async function getKnowledgeNodeCountsBySubject(): Promise<[string, number][]> {
  return invoke<[string, number][]>("get_knowledge_node_counts_by_subject")
}

/**
 * Structured result of counting manifest node IDs against DB.
 */
export interface ManifestNodeCountResult {
  totalExpected: number
  matchedCount: number
  missingIds: string[]
  statusMismatchIds: string[]
  subjectMismatchIds: string[]
  matchedCountsBySubject: Record<string, number>
}

/**
 * Count manifest node IDs against DB, returning structured result.
 * Each ID is classified: matched, missing, status_mismatch, or subject_mismatch.
 */
export async function countManifestNodes(
  manifestNodeIds: string[],
  manifestSubjectIds: string[]
): Promise<ManifestNodeCountResult> {
  return invoke<ManifestNodeCountResult>("count_manifest_nodes", {
    manifestNodeIds,
    manifestSubjectIds
  })
}

export interface HealthCheckResult {
  totalExpected: number
  totalDb: number
  missingCount: number
  orphanCount: number
  subjectMismatchCount: number
  statusMismatchCount: number
  missingIds: string[]
  orphanIds: string[]
  mismatchIds: string[]
  orphanDetails: OrphanNodeDetail[]
  statusMismatchIds: string[]
  safeToSync: boolean
  message: string
}

/**
 * Compare manifest node IDs and expected subjects against the DB.
 * Returns missing, orphan, and subject-mismatch nodes.
 *
 * @param scope - "all" (full catalog, default) or "approved_builtin" (approved-only, no orphan detection)
 */
export async function knowledgeHealthCheck(
  manifestNodeIds: string[],
  manifestSubjectIds: string[],
  scope: "all" | "approved_builtin" = "all"
): Promise<HealthCheckResult> {
  return invoke<HealthCheckResult>("knowledge_health_check", {
    manifestNodeIds,
    manifestSubjectIds,
    scope
  })
}

export interface OrphanNodeDetail {
  id: string
  title: string
  subjectCode: string
  reviewStatus: string
}

export interface OrphanCleanupResult {
  nodesDeleted: number
  edgesDeleted: number
  deletedIds: string[]
  skippedIds: string[]
  blockedByStudentKnowledgeIds: string[]
  message: string
}

/**
 * Safely delete orphan knowledge nodes from the database.
 * Only deletes nodes not in the manifest; cleans up edges and student_knowledge first.
 */
export async function deleteOrphanKnowledgeNodes(
  orphanIds: string[],
  manifestNodeIds: string[],
  force: boolean = false
): Promise<OrphanCleanupResult> {
  return invoke<OrphanCleanupResult>("delete_orphan_knowledge_nodes", {
    orphanIds,
    manifestNodeIds,
    force
  })
}

/**
 * Search knowledge nodes by keyword from the database.
 */
export async function searchKnowledgeFromDb(
  subjectCode: string,
  query: string,
  limit = 5
): Promise<KnowledgeNodeSearchResult[]> {
  return invoke<KnowledgeNodeSearchResult[]>("search_knowledge_from_db", {
    subjectCode,
    query,
    limit
  })
}

/**
 * Fetch knowledge nodes by their IDs (for vector search result enrichment).
 * Returns nodes in the same order as nodeIds, skipping missing IDs.
 */
export async function getKnowledgeNodesByIds(
  subjectCode: string,
  nodeIds: string[]
): Promise<KnowledgeNodeSearchResult[]> {
  return invoke<KnowledgeNodeSearchResult[]>("get_knowledge_nodes_by_ids", {
    subjectCode,
    nodeIds
  })
}

// ─── Ollama Commands ────────────────────────────────────────────────────────────

export interface OllamaStatus {
  running: boolean
  message: string
  version?: string
}

export interface OllamaModelInfo {
  name: string
  model?: string
  modifiedAt?: string
  size?: number
  family?: string
  families: string[]
  parameterSize?: string
  quantizationLevel?: string
}

export interface OllamaModelList {
  running: boolean
  message: string
  models: OllamaModelInfo[]
  embeddingRecommendation?: string
}

/**
 * Check if Ollama is running.
 */
export async function checkOllamaStatus(): Promise<OllamaStatus> {
  return invoke<OllamaStatus>("check_ollama_status")
}

/**
 * List locally installed Ollama models.
 */
export async function listOllamaModels(): Promise<OllamaModelList> {
  return invoke<OllamaModelList>("list_ollama_models")
}

/**
 * Start Ollama engine as a background process.
 */
export async function startOllamaEngine(): Promise<OllamaStatus> {
  return invoke<OllamaStatus>("start_ollama_engine")
}

// ─── Worker Commands ──────────────────────────────────────────────────────────

export interface PageOrSheet {
  name: string
  text: string
}

export interface ParseDocumentResult {
  ok: boolean
  fileType?: string
  title?: string
  plainText?: string
  pagesOrSheets: PageOrSheet[]
  error?: string
  warnings: string[]
}

export interface ComputeMathWorkerResult {
  ok: boolean
  input?: string
  result?: string
  latex?: string
  steps: string[]
  warnings: string[]
  error?: string
}

/**
 * Parse a document (PDF/DOCX/XLSX) using the Python document-worker.
 */
export async function parseDocumentWithWorker(filePath: string): Promise<ParseDocumentResult> {
  return invoke<ParseDocumentResult>("parse_document_with_worker", { filePath })
}

/**
 * Compute a math expression using the Python document-worker (SymPy).
 */
export async function computeMathWithWorker(
  expression: string,
  operation = "eval",
  variable = "x"
): Promise<ComputeMathWorkerResult> {
  return invoke<ComputeMathWorkerResult>("compute_math_with_worker", {
    expression,
    operation,
    variable
  })
}

export interface FileSelectionResult {
  selected: boolean
  filePath?: string
  fileName?: string
}

/**
 * Open a native file dialog to select a document (PDF/DOCX/XLSX).
 */
export async function selectDocumentFile(): Promise<FileSelectionResult> {
  return invoke<FileSelectionResult>("select_document_file")
}

// ── Private Document commands ──────────────────────────────────────────────

export interface SavePrivateDocumentInput {
  fileName: string
  fileType: string
  title?: string
  subjectCode: string
  pagesOrSheets: Array<{ name: string; text: string }>
  plainText: string
}

export interface SavedPrivateDocument {
  id: string
  fileName: string
  fileType: string
  title: string
  subjectCode: string
  sourceType: string
  status: string
  chunkCount: number
  createdAt: string
}

export interface PrivateDocumentChunk {
  id: string
  documentId: string
  chunkIndex: number
  heading?: string
  text: string
  tokenEstimate?: number
}

/**
 * Save a parsed document as private draft to local SQLite.
 */
export async function savePrivateDocument(
  input: SavePrivateDocumentInput
): Promise<SavedPrivateDocument> {
  return invoke<SavedPrivateDocument>("save_private_document", { input })
}

/**
 * List private documents, optionally filtered by subject code.
 */
export async function listPrivateDocuments(
  subjectCode?: string,
  limit?: number
): Promise<SavedPrivateDocument[]> {
  return invoke<SavedPrivateDocument[]>("list_private_documents", {
    subjectCode: subjectCode ?? null,
    limit: limit ?? 50
  })
}

/**
 * 彻底删除已导入的私有文档（hard delete: chunks + document，不可恢复）。
 */
export async function deletePrivateDocument(documentId: string): Promise<boolean> {
  return invoke<boolean>("delete_private_document", { documentId })
}

/**
 * Load chunks for a private document.
 */
export async function loadPrivateDocumentChunks(
  documentId: string
): Promise<PrivateDocumentChunk[]> {
  return invoke<PrivateDocumentChunk[]>("load_private_document_chunks", { documentId })
}

/**
 * Search result from private document chunks.
 */
export interface PrivateChunkSearchResult {
  documentId: string
  documentTitle: string
  fileName: string
  heading: string | null
  text: string
  score: number
  sourceType: string
}

/**
 * Search private document chunks by keyword.
 * Only returns chunks from documents matching the given subject code.
 */
export async function searchPrivateDocumentChunks(
  query: string,
  subjectCode: string,
  limit?: number
): Promise<PrivateChunkSearchResult[]> {
  return invoke<PrivateChunkSearchResult[]>("search_private_document_chunks", {
    query,
    subjectCode,
    limit: limit ?? 5
  })
}

/**
 * 按 ID 加载单个私有文档。不存在返回 null。
 */
export async function getPrivateDocument(
  documentId: string
): Promise<SavedPrivateDocument | null> {
  return invoke<SavedPrivateDocument | null>("get_private_document", { documentId })
}

/**
 * 绑定一份私有资料到指定会话（每个会话最多绑定 1 份）。
 */
export async function bindPrivateDocumentToConversation(
  conversationId: string,
  documentId: string
): Promise<void> {
  return invoke<void>("bind_private_document_to_conversation", { conversationId, documentId })
}

/**
 * 清空指定会话的资料绑定。
 */
export async function clearPrivateDocumentBinding(
  conversationId: string
): Promise<boolean> {
  return invoke<boolean>("clear_private_document_binding", { conversationId })
}

/**
 * 读取指定会话绑定的资料 ID。无绑定返回 null。
 */
export async function loadConversationPrivateDocumentId(
  conversationId: string
): Promise<string | null> {
  return invoke<string | null>("load_conversation_private_document_id", { conversationId })
}

// ── Bocha Web Search & Custom Subject ──────────────────────────────

export interface WebSearchResult {
  title: string
  url: string
  siteName: string
  summary: string
  publishedTime?: string
}

export interface WebSearchResponse {
  query: string
  results: WebSearchResult[]
  total: number
}

export interface CustomSubject {
  id: string
  name: string
  description?: string
  scopeKeywords?: string
  reviewStatus: string
  createdAt: string
  updatedAt: string
}

export interface SourceItem {
  title: string
  url: string
  summary: string
  siteName?: string
}

/**
 * Perform a web search using the Bocha API (key loaded from keychain).
 */
export async function bochaWebSearch(
  query: string,
  count?: number,
  freshness?: string
): Promise<WebSearchResponse> {
  return invoke<WebSearchResponse>("bocha_web_search", { query, count, freshness })
}

/**
 * Save Bocha API key to system keychain.
 */
export async function saveBochaApiKey(apiKey: string): Promise<StoredProviderApiKeyRef> {
  return invoke<StoredProviderApiKeyRef>("save_bocha_api_key", { apiKey })
}

/**
 * Check if Bocha API key exists in system keychain.
 */
export async function hasBochaApiKey(): Promise<boolean> {
  return invoke<boolean>("has_bocha_api_key")
}

/**
 * Delete Bocha API key from system keychain.
 */
export async function deleteBochaApiKey(): Promise<boolean> {
  return invoke<boolean>("delete_bocha_api_key")
}

/**
 * Create a new custom subject.
 */
export async function createCustomSubject(
  name: string,
  description?: string,
  scopeKeywords?: string
): Promise<CustomSubject> {
  return invoke<CustomSubject>("create_custom_subject", { name, description, scopeKeywords })
}

/**
 * List all custom subjects.
 */
export async function listCustomSubjects(): Promise<CustomSubject[]> {
  return invoke<CustomSubject[]>("list_custom_subjects")
}

/**
 * Delete a custom subject and its associated data.
 */
export async function deleteCustomSubject(subjectId: string): Promise<boolean> {
  return invoke<boolean>("delete_custom_subject", { subjectId })
}

/**
 * Generate knowledge nodes from user-confirmed web sources.
 */
export async function generateKnowledgeFromSources(
  subjectId: string,
  sources: SourceItem[],
  topics?: string[]
): Promise<number> {
  return invoke<number>("generate_knowledge_from_sources", { subjectId, sources, topics })
}
