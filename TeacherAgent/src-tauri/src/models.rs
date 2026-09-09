use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DatabaseStatus {
    pub(crate) database_path: String,
    pub(crate) migrated: bool,
    pub(crate) applied_migrations: Vec<String>,
    pub(crate) user_version: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalSmokeCheckResult {
    pub(crate) ping: String,
    pub(crate) database: DatabaseStatus,
    pub(crate) conversation_id: String,
    pub(crate) message_roundtrip: bool,
    pub(crate) rollback_verified: bool,
}

pub(crate) struct LocalSmokeCheckCore {
    pub(crate) conversation: LocalConversation,
    pub(crate) message_roundtrip: bool,
    pub(crate) rollback_verified: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalConversation {
    pub(crate) student_id: String,
    pub(crate) subject_id: String,
    pub(crate) conversation_id: String,
    pub(crate) subject_code: String,
    pub(crate) title: String,
    pub(crate) status: String,
    pub(crate) created_at: String,
    pub(crate) updated_at: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SaveMessageInput {
    pub(crate) id: String,
    pub(crate) conversation_id: String,
    pub(crate) role: String,
    pub(crate) content: String,
    pub(crate) content_format: Option<String>,
    pub(crate) knowledge_refs_json: Option<String>,
    pub(crate) tool_refs_json: Option<String>,
    pub(crate) guardrail_json: Option<String>,
    pub(crate) attachments_json: Option<String>,
    pub(crate) created_at: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StoredMessage {
    pub(crate) id: String,
    pub(crate) conversation_id: String,
    pub(crate) role: String,
    pub(crate) content: String,
    pub(crate) content_format: String,
    pub(crate) knowledge_refs_json: String,
    pub(crate) tool_refs_json: String,
    pub(crate) guardrail_json: String,
    pub(crate) attachments_json: String,
    pub(crate) created_at: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SaveReflectionRecordInput {
    pub(crate) id: String,
    pub(crate) conversation_id: String,
    pub(crate) student_id: String,
    pub(crate) summary: String,
    pub(crate) knowledge_updates_json: String,
    pub(crate) misconceptions_json: String,
    pub(crate) strategy_insights_json: String,
    pub(crate) next_best_action_json: String,
    pub(crate) confidence: f64,
    pub(crate) created_at: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StoredReflectionRecord {
    pub(crate) id: String,
    pub(crate) conversation_id: String,
    pub(crate) student_id: String,
    pub(crate) summary: String,
    pub(crate) confidence: f64,
    pub(crate) created_at: String,
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SaveAssessmentResultInput {
    pub(crate) id: String,
    pub(crate) student_id: String,
    pub(crate) subject_code: String,
    pub(crate) learning_goal_id: Option<String>,
    pub(crate) conversation_id: Option<String>,
    pub(crate) assessment_type: String,
    pub(crate) overall_level: String,
    pub(crate) strengths_json: String,
    pub(crate) weaknesses_json: String,
    pub(crate) recommendations_json: String,
    pub(crate) evidence_json: String,
    pub(crate) created_at: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StoredAssessmentResult {
    pub(crate) id: String,
    pub(crate) student_id: String,
    pub(crate) subject_id: String,
    pub(crate) conversation_id: Option<String>,
    pub(crate) assessment_type: String,
    pub(crate) overall_level: String,
    pub(crate) created_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PersistedSyncDiagnosticAssessment {
    pub(crate) assessment_id: String,
    pub(crate) teacher_subject_id: String,
    pub(crate) correct: bool,
    pub(crate) question_id: String,
    pub(crate) alert_subject_remote_id: Option<String>,
    pub(crate) exam_track_id: Option<String>,
    pub(crate) exam_subject_id: Option<String>,
    pub(crate) exam_module_id: Option<String>,
    pub(crate) created_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StoredStudentKnowledgeMastery {
    pub(crate) knowledge_node_id: String,
    pub(crate) title: String,
    pub(crate) summary: Option<String>,
    pub(crate) mastery_probability: f64,
    pub(crate) attempts_count: i64,
    pub(crate) correct_count: i64,
    pub(crate) last_practiced_at: Option<String>,
    pub(crate) evidence_summary: Option<String>,
    pub(crate) updated_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StoredKnowledgePrerequisite {
    pub(crate) target_node_id: String,
    pub(crate) target_title: String,
    pub(crate) prerequisite_node_id: Option<String>,
    pub(crate) title: String,
    pub(crate) summary: Option<String>,
    pub(crate) relation_type: String,
    pub(crate) source: String,
    pub(crate) weight: Option<f64>,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AssessmentEvidencePayload {
    #[serde(default)]
    pub(crate) correctness: Option<String>,
    #[serde(default)]
    pub(crate) knowledge_updates: Vec<AssessmentKnowledgeUpdatePayload>,
    #[serde(default)]
    pub(crate) knowledge_snapshots: Vec<AssessmentKnowledgeSnapshotPayload>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DiagnosticProvenancePayload {
    pub(crate) origin: String,
    pub(crate) question_id: String,
    pub(crate) alert_subject_remote_id: String,
    pub(crate) exam_track_id: Option<String>,
    pub(crate) exam_subject_id: Option<String>,
    pub(crate) exam_module_id: Option<String>,
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AssessmentKnowledgeUpdatePayload {
    pub(crate) knowledge_node_id: String,
    pub(crate) mastery_delta: f64,
    #[serde(default)]
    pub(crate) correctness: Option<String>,
    pub(crate) reason: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AssessmentKnowledgeSnapshotPayload {
    pub(crate) id: String,
    pub(crate) title: String,
    pub(crate) summary: Option<String>,
    #[serde(default)]
    pub(crate) misconceptions: Vec<String>,
    #[serde(default)]
    pub(crate) socratic_hints: Vec<Value>,
    #[serde(default)]
    pub(crate) source_type: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SaveProviderConfigInput {
    pub(crate) id: Option<String>,
    pub(crate) name: String,
    pub(crate) provider_type: String,
    pub(crate) base_url: String,
    pub(crate) model: String,
    pub(crate) api_key_ref: Option<String>,
    pub(crate) is_default: bool,
    pub(crate) is_local: bool,
    pub(crate) text_model: Option<String>,
    pub(crate) vision_model: Option<String>,
    pub(crate) supports_vision: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StoredProviderConfig {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) provider_type: String,
    pub(crate) base_url: String,
    pub(crate) model: String,
    pub(crate) api_key_ref: Option<String>,
    pub(crate) is_default: bool,
    pub(crate) is_local: bool,
    pub(crate) text_model: Option<String>,
    pub(crate) vision_model: Option<String>,
    pub(crate) supports_vision: bool,
    pub(crate) created_at: String,
    pub(crate) updated_at: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SaveProviderApiKeyInput {
    pub(crate) provider_id: String,
    pub(crate) api_key: String,
    pub(crate) base_url: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DeleteProviderApiKeyInput {
    pub(crate) api_key_ref: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DeleteProviderConfigInput {
    pub(crate) id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StoredProviderApiKeyRef {
    pub(crate) api_key_ref: String,
    pub(crate) has_api_key: bool,
}

#[derive(Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LlmChatMessage {
    pub(crate) role: String,
    pub(crate) content: serde_json::Value,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CompleteLlmChatInput {
    pub(crate) provider_name: String,
    pub(crate) base_url: String,
    pub(crate) model: String,
    pub(crate) api_key_ref: Option<String>,
    pub(crate) is_local: bool,
    pub(crate) messages: Vec<LlmChatMessage>,
    pub(crate) temperature: Option<f64>,
    pub(crate) max_tokens: Option<u32>,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CompleteLlmChatOutput {
    pub(crate) content: String,
    pub(crate) provider_name: String,
    pub(crate) model: String,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LlmProviderCommandError {
    pub(crate) code: String,
    pub(crate) message: String,
    pub(crate) provider_name: Option<String>,
    pub(crate) status: Option<u16>,
    pub(crate) retryable: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LlmStreamChunk {
    pub(crate) content: String,
    pub(crate) done: bool,
}

#[derive(Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StoredCognitiveProfile {
    pub(crate) id: String,
    pub(crate) student_id: String,
    pub(crate) subject_code: Option<String>,
    pub(crate) learning_goals: Vec<String>,
    pub(crate) explanation_preferences: Vec<String>,
    pub(crate) recurring_misconceptions: Vec<String>,
    pub(crate) effective_strategies: Vec<String>,
    pub(crate) affective_signals: Vec<String>,
    pub(crate) confidence: f64,
    pub(crate) created_at: String,
    pub(crate) updated_at: String,
}

#[derive(Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StoredShortTermMemory {
    pub(crate) id: String,
    pub(crate) conversation_id: String,
    pub(crate) student_id: String,
    pub(crate) subject_code: Option<String>,
    pub(crate) summary: String,
    pub(crate) recent_focus: Vec<String>,
    pub(crate) open_questions: Vec<String>,
    pub(crate) last_misconceptions: Vec<String>,
    pub(crate) last_mode: Option<String>,
    pub(crate) turn_count: i64,
    pub(crate) created_at: String,
    pub(crate) updated_at: String,
}

#[derive(Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StoredLongTermMemory {
    pub(crate) id: String,
    pub(crate) student_id: String,
    pub(crate) subject_code: Option<String>,
    pub(crate) kind: String,
    pub(crate) summary: String,
    pub(crate) evidence: String,
    pub(crate) confidence: f64,
    pub(crate) source: String,
    pub(crate) created_at: String,
    pub(crate) updated_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LearningMemoryContext {
    pub(crate) profile: Option<StoredCognitiveProfile>,
    pub(crate) short_term_memory: Option<StoredShortTermMemory>,
    pub(crate) long_term_memories: Vec<StoredLongTermMemory>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SaveLearningMemoryInput {
    pub(crate) profile: Option<StoredCognitiveProfile>,
    pub(crate) short_term_memory: Option<StoredShortTermMemory>,
    pub(crate) long_term_memories: Vec<StoredLongTermMemory>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EmbeddingBatchProgress {
    pub(crate) completed: usize,
    pub(crate) total: usize,
    pub(crate) batch_index: usize,
    pub(crate) total_batches: usize,
}
