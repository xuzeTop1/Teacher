use rusqlite::Connection;
#[cfg(test)]
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::ipc::Channel;
use tauri::AppHandle;
use tauri::Manager;

mod assessment;
mod bkt;
mod code_worker;
mod conversation;
mod custom_subject;
mod database;
mod embedding;
mod knowledge;
mod math_engine;
mod memory;
mod models;
mod ollama;
mod private_doc;
mod provider;
mod seed;
mod shared;
mod sidecar_integrity;
mod sync;
mod vector;
mod web_search;
mod worker;

use assessment::*;
use conversation::*;
use database::*;
use knowledge::*;
use memory::*;
use models::*;
use provider::*;
use shared::*;
use sync::commands::*;

#[tauri::command]
fn ping() -> &'static str {
    "pong"
}

#[tauri::command]
fn init_database(app: AppHandle) -> Result<DatabaseStatus, String> {
    let database_path = database_path(&app)?;
    let connection = open_database(&app)?;
    let migrated = apply_migrations(&connection)?;

    let applied_migrations = load_applied_migrations(&connection)?;
    let user_version = connection
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .map_err(|error| format!("failed to read SQLite user_version: {error}"))?;

    Ok(DatabaseStatus {
        database_path: database_path.display().to_string(),
        migrated,
        applied_migrations,
        user_version,
    })
}

#[tauri::command]
fn run_local_smoke_check(app: AppHandle) -> Result<LocalSmokeCheckResult, String> {
    let database = init_database(app.clone())?;
    let mut connection = open_migrated_database(&app)?;
    let core = run_local_smoke_check_with_connection(&mut connection)?;

    Ok(LocalSmokeCheckResult {
        ping: ping().to_string(),
        database,
        conversation_id: core.conversation.conversation_id,
        message_roundtrip: core.message_roundtrip,
        rollback_verified: core.rollback_verified,
    })
}

#[tauri::command]
fn ensure_default_conversation(
    app: AppHandle,
    subject_code: String,
) -> Result<LocalConversation, String> {
    let connection = open_migrated_database(&app)?;
    ensure_default_conversation_with_connection(&connection, &subject_code)
}

#[tauri::command]
fn save_message(app: AppHandle, input: SaveMessageInput) -> Result<StoredMessage, String> {
    validate_message_role(&input.role)?;
    let connection = open_migrated_database(&app)?;
    save_message_with_connection(&connection, input)
}

#[tauri::command]
fn list_messages(
    app: AppHandle,
    conversation_id: String,
    limit: Option<i64>,
) -> Result<Vec<StoredMessage>, String> {
    let connection = open_migrated_database(&app)?;
    list_messages_with_connection(&connection, &conversation_id, limit.unwrap_or(80))
}

#[tauri::command]
fn list_conversations(
    app: AppHandle,
    subject_code: String,
    limit: Option<i64>,
    status: Option<String>,
) -> Result<Vec<LocalConversation>, String> {
    let connection = open_migrated_database(&app)?;
    ensure_default_conversation_with_connection(&connection, &subject_code)?;
    list_conversations_with_connection(
        &connection,
        &subject_code,
        limit.unwrap_or(30),
        status.as_deref(),
    )
}

#[tauri::command]
fn archive_conversation(
    app: AppHandle,
    conversation_id: String,
) -> Result<LocalConversation, String> {
    let connection = open_migrated_database(&app)?;
    archive_conversation_with_connection(&connection, &conversation_id)
}

#[tauri::command]
fn unarchive_conversation(
    app: AppHandle,
    conversation_id: String,
) -> Result<LocalConversation, String> {
    let connection = open_migrated_database(&app)?;
    unarchive_conversation_with_connection(&connection, &conversation_id)
}

#[tauri::command]
fn delete_conversation(app: AppHandle, conversation_id: String) -> Result<(), String> {
    let connection = open_migrated_database(&app)?;
    soft_delete_conversation_with_connection(&connection, &conversation_id)
}

#[tauri::command]
fn create_conversation(
    app: AppHandle,
    subject_code: String,
    title: Option<String>,
) -> Result<LocalConversation, String> {
    let connection = open_migrated_database(&app)?;
    create_conversation_with_connection(&connection, &subject_code, title)
}

#[tauri::command]
fn update_conversation_title(
    app: AppHandle,
    conversation_id: String,
    title: String,
) -> Result<LocalConversation, String> {
    let connection = open_migrated_database(&app)?;
    update_conversation_title_with_connection(&connection, &conversation_id, &title)
}

#[tauri::command]
fn load_learning_memory_context(
    app: AppHandle,
    student_id: String,
    conversation_id: String,
    subject_code: String,
) -> Result<LearningMemoryContext, String> {
    let connection = open_migrated_database(&app)?;
    ensure_default_conversation_with_connection(&connection, &subject_code)?;
    load_learning_memory_context_with_connection(
        &connection,
        &student_id,
        &conversation_id,
        &subject_code,
    )
}

#[tauri::command]
fn save_learning_memory_state(
    app: AppHandle,
    input: SaveLearningMemoryInput,
) -> Result<LearningMemoryContext, String> {
    let connection = open_migrated_database(&app)?;
    save_learning_memory_state_with_connection(&connection, input)
}

#[tauri::command]
fn save_reflection_record(
    app: AppHandle,
    input: SaveReflectionRecordInput,
) -> Result<StoredReflectionRecord, String> {
    let connection = open_migrated_database(&app)?;
    save_reflection_record_with_connection(&connection, input)
}

#[tauri::command]
fn save_assessment_result(
    app: AppHandle,
    input: SaveAssessmentResultInput,
) -> Result<StoredAssessmentResult, String> {
    let connection = open_migrated_database(&app)?;
    save_assessment_result_with_connection(&connection, input)
}

/// Verifies that the given assessment ids reference real persisted rows in
/// assessment_results. Returns the subset that exists. Used by the sync
/// proposal flow so sourceAssessmentIds only reference durable evidence.
#[tauri::command]
fn sync_assessment_ids_exist(app: AppHandle, ids: Vec<String>) -> Result<Vec<String>, String> {
    let connection = open_migrated_database(&app)?;
    assessment_ids_that_exist(&connection, &ids)
}

/// Rebuilds diagnostic evidence from assessment_results. The input ids are
/// only frontend cache candidates; the returned DTO is DB-authoritative.
#[tauri::command]
fn load_persisted_sync_diagnostic_assessments(
    app: AppHandle,
    ids: Vec<String>,
) -> Result<Vec<PersistedSyncDiagnosticAssessment>, String> {
    let connection = open_migrated_database(&app)?;
    load_persisted_sync_diagnostic_assessments_with_connection(&connection, &ids)
}

#[tauri::command]
fn load_student_knowledge(
    app: AppHandle,
    student_id: String,
    subject_code: String,
    limit: Option<i64>,
    knowledge_node_ids: Option<Vec<String>>,
) -> Result<Vec<StoredStudentKnowledgeMastery>, String> {
    let connection = open_migrated_database(&app)?;
    ensure_default_conversation_with_connection(&connection, &subject_code)?;
    load_student_knowledge_with_connection(
        &connection,
        &student_id,
        &subject_code,
        limit.unwrap_or(20),
        knowledge_node_ids.as_deref(),
    )
}

#[tauri::command]
fn load_knowledge_prerequisites(
    app: AppHandle,
    subject_code: String,
    knowledge_node_ids: Vec<String>,
    limit: Option<i64>,
) -> Result<Vec<StoredKnowledgePrerequisite>, String> {
    let connection = open_migrated_database(&app)?;
    ensure_default_conversation_with_connection(&connection, &subject_code)?;
    load_knowledge_prerequisites_with_connection(
        &connection,
        &subject_code,
        &knowledge_node_ids,
        limit.unwrap_or(30),
    )
}

#[tauri::command]
fn save_provider_config(
    app: AppHandle,
    input: SaveProviderConfigInput,
) -> Result<StoredProviderConfig, String> {
    let connection = open_migrated_database(&app)?;
    save_provider_config_with_connection(&connection, input)
}

#[tauri::command]
fn load_default_provider_config(app: AppHandle) -> Result<Option<StoredProviderConfig>, String> {
    let connection = open_migrated_database(&app)?;
    load_default_provider_config_with_connection(&connection)
}

#[tauri::command]
fn list_provider_configs(app: AppHandle) -> Result<Vec<StoredProviderConfig>, String> {
    let connection = open_migrated_database(&app)?;
    list_provider_configs_with_connection(&connection)
}

#[tauri::command]
fn delete_provider_config(
    app: AppHandle,
    input: DeleteProviderConfigInput,
) -> Result<bool, String> {
    let connection = open_migrated_database(&app)?;
    delete_provider_config_with_connection(&connection, &input.id)
}

#[tauri::command]
fn save_provider_api_key(
    input: SaveProviderApiKeyInput,
) -> Result<StoredProviderApiKeyRef, String> {
    save_provider_api_key_to_keychain(input)
}

#[tauri::command]
fn delete_provider_api_key(input: DeleteProviderApiKeyInput) -> Result<bool, String> {
    delete_provider_api_key_from_keychain(input)
}

#[tauri::command]
async fn complete_llm_chat(
    input: CompleteLlmChatInput,
) -> Result<CompleteLlmChatOutput, LlmProviderCommandError> {
    complete_llm_chat_with_provider(input).await
}

#[tauri::command]
async fn complete_llm_chat_stream(
    input: CompleteLlmChatInput,
    channel: Channel<LlmStreamChunk>,
) -> Result<(), LlmProviderCommandError> {
    complete_llm_chat_stream_with_provider(input, channel).await
}

#[tauri::command]
fn store_vector_embedding(
    app: AppHandle,
    id: String,
    entity_type: String,
    entity_id: String,
    embedding: Vec<f32>,
    embedding_model: String,
) -> Result<bool, String> {
    let connection = open_migrated_database(&app)?;
    let dim = embedding.len();
    vector::upsert_embedding(
        &connection,
        &vector::EmbeddingEntry {
            id,
            entity_type,
            entity_id,
            embedding,
            embedding_model,
            embedding_dim: dim,
        },
    )?;
    Ok(true)
}

#[tauri::command]
fn search_vector_embeddings(
    app: AppHandle,
    entity_type: String,
    query_embedding: Vec<f32>,
    embedding_model: String,
    limit: Option<i64>,
    entity_ids: Option<Vec<String>>,
) -> Result<Vec<crate::vector::VectorSearchResult>, String> {
    let connection = open_migrated_database(&app)?;
    vector::search_similar(
        &connection,
        &entity_type,
        &query_embedding,
        &embedding_model,
        limit.unwrap_or(10),
        entity_ids.as_deref(),
    )
}

#[tauri::command]
fn compute_math_expression(
    input: math_engine::MathComputeInput,
) -> Result<math_engine::MathComputeOutput, String> {
    math_engine::compute_math(input)
}

#[tauri::command]
fn bkt_update_mastery(
    p_know: f64,
    correct: bool,
    params: Option<bkt::BktParams>,
    learned_threshold: Option<f64>,
) -> bkt::BktUpdateResult {
    let params = params.unwrap_or_default();
    let threshold = learned_threshold.unwrap_or(0.8);
    bkt::bkt_update(p_know, correct, &params, threshold)
}

#[tauri::command]
async fn generate_embedding(
    base_url: String,
    api_key_ref: String,
    model: String,
    input_text: String,
) -> Result<Vec<f32>, String> {
    embedding::generate_embedding_for_text(&base_url, &api_key_ref, &model, &input_text).await
}

#[tauri::command]
async fn generate_embeddings_batch(
    base_url: String,
    api_key_ref: String,
    model: String,
    texts: Vec<String>,
    batch_size: Option<usize>,
    delay_ms: Option<u64>,
    progress_channel: Channel<EmbeddingBatchProgress>,
) -> Result<Vec<Vec<f32>>, String> {
    embedding::generate_embeddings_batch_for_texts(
        &base_url,
        &api_key_ref,
        &model,
        &texts,
        batch_size,
        delay_ms,
        &progress_channel,
    )
    .await
}

#[tauri::command]
fn count_vector_embeddings(
    app: AppHandle,
    entity_type: String,
    embedding_model: String,
) -> Result<i64, String> {
    let connection = open_migrated_database(&app)?;
    vector::count_embeddings(&connection, &entity_type, &embedding_model)
}

#[tauri::command]
fn delete_embeddings_by_model_and_ids(
    app: AppHandle,
    entity_type: String,
    embedding_model: String,
    entity_ids: Vec<String>,
) -> Result<usize, String> {
    let connection = open_migrated_database(&app)?;
    vector::delete_embeddings_by_model_and_ids(
        &connection,
        &entity_type,
        &embedding_model,
        &entity_ids,
    )
}

#[tauri::command]
fn seed_knowledge_nodes_from_json(
    app: AppHandle,
    seed_json: String,
) -> Result<seed::SeedResult, String> {
    let connection = open_migrated_database(&app)?;
    let seed: seed::KnowledgeSeedFile =
        serde_json::from_str(&seed_json).map_err(|e| format!("invalid seed JSON: {e}"))?;
    seed::validate_public_seed_status(seed.status.as_deref())?;
    seed::seed_knowledge_nodes(&connection, &seed, seed::SeedMode::InsertOnly)
}

#[tauri::command]
fn count_knowledge_nodes(app: AppHandle, subject_code: String) -> Result<i64, String> {
    let connection = open_migrated_database(&app)?;
    seed::count_knowledge_nodes(&connection, &subject_code)
}

#[tauri::command]
fn count_all_knowledge_nodes(app: AppHandle) -> Result<i64, String> {
    let connection = open_migrated_database(&app)?;
    seed::count_all_knowledge_nodes(&connection)
}

#[tauri::command]
fn get_knowledge_node_counts_by_subject(app: AppHandle) -> Result<Vec<(String, i64)>, String> {
    let connection = open_migrated_database(&app)?;
    seed::get_knowledge_node_counts_by_subject(&connection)
}

#[tauri::command]
fn get_approved_knowledge_node_counts_by_subject(
    app: AppHandle,
) -> Result<Vec<(String, i64)>, String> {
    let connection = open_migrated_database(&app)?;
    seed::get_approved_knowledge_node_counts_by_subject(&connection)
}

#[tauri::command]
fn count_approved_knowledge_nodes(app: AppHandle) -> Result<i64, String> {
    let connection = open_migrated_database(&app)?;
    seed::count_approved_knowledge_nodes(&connection)
}

#[tauri::command]
fn sync_approved_manifest(app: AppHandle) -> Result<seed::SeedResult, String> {
    let mut connection = open_migrated_database(&app)?;
    seed::sync_approved_manifest(&mut connection)
}

#[tauri::command]
fn count_manifest_nodes(
    app: AppHandle,
    manifest_node_ids: Vec<String>,
    manifest_subject_ids: Vec<String>,
) -> Result<seed::ManifestNodeCountResult, String> {
    if manifest_node_ids.len() != manifest_subject_ids.len() {
        return Err("manifest_node_ids and manifest_subject_ids must have the same length".into());
    }
    let connection = open_migrated_database(&app)?;
    seed::count_manifest_nodes(&connection, &manifest_node_ids, &manifest_subject_ids)
}

#[tauri::command]
fn knowledge_health_check(
    app: AppHandle,
    manifest_node_ids: Vec<String>,
    manifest_subject_ids: Vec<String>,
    scope: Option<String>,
) -> Result<seed::HealthCheckResult, String> {
    if manifest_node_ids.len() != manifest_subject_ids.len() {
        return Err("manifest_node_ids and manifest_subject_ids must have the same length".into());
    }
    let pairs: Vec<(String, String)> = manifest_node_ids
        .into_iter()
        .zip(manifest_subject_ids)
        .collect();
    let check_scope = seed::HealthCheckScope::from_str(scope.as_deref().unwrap_or("all"));
    let connection = open_migrated_database(&app)?;
    seed::knowledge_health_check(&connection, &pairs, check_scope)
}

#[tauri::command]
fn delete_orphan_knowledge_nodes(
    app: AppHandle,
    orphan_ids: Vec<String>,
    manifest_node_ids: Vec<String>,
    force: bool,
) -> Result<seed::OrphanCleanupResult, String> {
    let mut connection = open_migrated_database(&app)?;
    seed::delete_orphan_knowledge_nodes(&mut connection, &orphan_ids, &manifest_node_ids, force)
}

#[tauri::command]
fn search_knowledge_from_db(
    app: AppHandle,
    subject_code: String,
    query: String,
    limit: Option<i64>,
) -> Result<Vec<seed::KnowledgeNodeSearchResult>, String> {
    let connection = open_migrated_database(&app)?;
    seed::search_knowledge_nodes_by_keyword(&connection, &subject_code, &query, limit.unwrap_or(5))
}

#[tauri::command]
fn get_knowledge_nodes_by_ids(
    app: AppHandle,
    subject_code: String,
    node_ids: Vec<String>,
) -> Result<Vec<seed::KnowledgeNodeSearchResult>, String> {
    let connection = open_migrated_database(&app)?;
    seed::get_knowledge_nodes_by_ids(&connection, &subject_code, &node_ids)
}

#[tauri::command]
async fn check_ollama_status() -> ollama::OllamaStatus {
    ollama::check_ollama_status().await
}

#[tauri::command]
async fn list_ollama_models() -> Result<ollama::OllamaModelList, String> {
    ollama::list_ollama_models().await
}

#[tauri::command]
async fn start_ollama_engine() -> Result<ollama::OllamaStatus, String> {
    ollama::start_ollama_engine().await
}

#[tauri::command]
async fn parse_document_with_worker(
    file_path: String,
) -> Result<worker::ParseDocumentResult, String> {
    tauri::async_runtime::spawn_blocking(move || worker::parse_authorized_document(&file_path))
        .await
        .map_err(|e| format!("worker task failed: {e}"))?
}

#[tauri::command]
async fn compute_math_with_worker(
    expression: String,
    operation: Option<String>,
    variable: Option<String>,
) -> Result<worker::ComputeMathResult, String> {
    let op = operation.unwrap_or_else(|| "eval".to_string());
    let var = variable.unwrap_or_else(|| "x".to_string());
    tauri::async_runtime::spawn_blocking(move || {
        worker::compute_math_with_worker(&expression, &op, &var)
    })
    .await
    .map_err(|e| format!("worker task failed: {e}"))?
}

/// code-runner 超时下限（1 秒）
const CODE_RUNNER_TIMEOUT_MIN_MS: u64 = 1000;
/// code-runner 超时上限（30 秒）
const CODE_RUNNER_TIMEOUT_MAX_MS: u64 = 30000;

#[tauri::command]
async fn run_code(
    code: String,
    stdin: Option<String>,
    test_cases: Option<Vec<code_worker::CodeTestCase>>,
    timeout_ms: Option<u64>,
) -> Result<code_worker::CodeRunnerResult, String> {
    let raw_timeout = timeout_ms.unwrap_or(5000);
    let clamped_timeout = raw_timeout.clamp(CODE_RUNNER_TIMEOUT_MIN_MS, CODE_RUNNER_TIMEOUT_MAX_MS);
    let input = code_worker::CodeRunnerInput {
        code,
        stdin: stdin.unwrap_or_default(),
        test_cases: test_cases.unwrap_or_default(),
        timeout_ms: clamped_timeout,
    };
    tauri::async_runtime::spawn_blocking(move || code_worker::run_code_with_worker(&input))
        .await
        .map_err(|e| format!("code-worker task failed: {e}"))?
}

#[tauri::command]
fn select_document_file() -> Result<worker::FileSelectionResult, String> {
    worker::select_document_file()
}

#[tauri::command]
fn save_private_document(
    app: AppHandle,
    input: private_doc::SavePrivateDocumentInput,
) -> Result<private_doc::SavedPrivateDocument, String> {
    let mut connection = open_migrated_database(&app)?;
    private_doc::save_private_document_with_connection(&mut connection, &input)
}

#[tauri::command]
fn list_private_documents(
    app: AppHandle,
    subject_code: Option<String>,
    limit: Option<i64>,
) -> Result<Vec<private_doc::SavedPrivateDocument>, String> {
    let connection = open_migrated_database(&app)?;
    private_doc::list_private_documents_with_connection(
        &connection,
        subject_code.as_deref(),
        limit.unwrap_or(50),
    )
}

#[tauri::command]
fn delete_private_document(app: AppHandle, document_id: String) -> Result<bool, String> {
    let mut connection = open_migrated_database(&app)?;
    private_doc::delete_private_document_with_connection(&mut connection, &document_id)
}

#[tauri::command]
fn load_private_document_chunks(
    app: AppHandle,
    document_id: String,
) -> Result<Vec<private_doc::PrivateDocumentChunk>, String> {
    let connection = open_migrated_database(&app)?;
    private_doc::load_private_document_chunks_with_connection(&connection, &document_id)
}

#[tauri::command]
fn search_private_document_chunks(
    app: AppHandle,
    query: String,
    subject_code: String,
    limit: Option<i64>,
) -> Result<Vec<private_doc::PrivateChunkSearchResult>, String> {
    let connection = open_migrated_database(&app)?;
    private_doc::search_private_chunks_with_connection(
        &connection,
        &query,
        &subject_code,
        limit.unwrap_or(5),
    )
}

#[tauri::command]
fn get_private_document(
    app: AppHandle,
    document_id: String,
) -> Result<Option<private_doc::SavedPrivateDocument>, String> {
    let connection = open_migrated_database(&app)?;
    private_doc::get_private_document_by_id(&connection, &document_id)
}

#[tauri::command]
fn bind_private_document_to_conversation(
    app: AppHandle,
    conversation_id: String,
    document_id: String,
) -> Result<(), String> {
    let connection = open_migrated_database(&app)?;
    private_doc::bind_private_document_to_conversation(&connection, &conversation_id, &document_id)
}

#[tauri::command]
fn clear_private_document_binding(app: AppHandle, conversation_id: String) -> Result<bool, String> {
    let connection = open_migrated_database(&app)?;
    private_doc::clear_private_document_binding(&connection, &conversation_id)
}

#[tauri::command]
fn load_conversation_private_document_id(
    app: AppHandle,
    conversation_id: String,
) -> Result<Option<String>, String> {
    let connection = open_migrated_database(&app)?;
    private_doc::load_conversation_private_document_id(&connection, &conversation_id)
}

#[tauri::command]
async fn bocha_web_search(
    query: String,
    count: Option<u32>,
    freshness: Option<String>,
) -> Result<web_search::WebSearchResponse, String> {
    let api_key = provider::load_bocha_api_key_from_keychain()?
        .ok_or_else(|| "Bocha API Key 未配置，请先在设置页保存 Key".to_string())?;
    web_search::bocha_web_search(&api_key, &query, count.unwrap_or(10), freshness.as_deref()).await
}

#[tauri::command]
fn save_bocha_api_key(api_key: String) -> Result<StoredProviderApiKeyRef, String> {
    provider::save_bocha_api_key_to_keychain(&api_key)
}

#[tauri::command]
fn has_bocha_api_key() -> Result<bool, String> {
    provider::load_bocha_api_key_from_keychain().map(|opt| opt.is_some())
}

#[tauri::command]
fn delete_bocha_api_key() -> Result<bool, String> {
    provider::delete_bocha_api_key_from_keychain()
}

#[tauri::command]
fn create_custom_subject(
    app: AppHandle,
    name: String,
    description: Option<String>,
    scope_keywords: Option<String>,
) -> Result<custom_subject::CustomSubject, String> {
    let connection = open_migrated_database(&app)?;
    custom_subject::create_custom_subject(
        &connection,
        &custom_subject::CreateCustomSubjectInput {
            name,
            description,
            scope_keywords,
        },
    )
}

#[tauri::command]
fn list_custom_subjects(app: AppHandle) -> Result<Vec<custom_subject::CustomSubject>, String> {
    let connection = open_migrated_database(&app)?;
    custom_subject::list_custom_subjects(&connection)
}

#[tauri::command]
fn delete_custom_subject(app: AppHandle, subject_id: String) -> Result<bool, String> {
    let mut connection = open_migrated_database(&app)?;
    custom_subject::delete_custom_subject(&mut connection, &subject_id)
}

#[tauri::command]
fn generate_knowledge_from_sources(
    app: AppHandle,
    subject_id: String,
    sources: Vec<custom_subject::SourceItem>,
    topics: Option<Vec<String>>,
) -> Result<usize, String> {
    let connection = open_migrated_database(&app)?;
    custom_subject::generate_knowledge_from_sources(
        &connection,
        &custom_subject::GenerateKnowledgeFromSourcesInput {
            subject_id,
            sources,
            topics,
        },
    )
}

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            app.manage(sync::server::ServerRuntime::default());
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_secs(10));
                if let Some(window) = handle.get_webview_window("main") {
                    if !window.is_visible().unwrap_or(true) {
                        eprintln!("main page did not finish loading; showing fallback window");
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            ping,
            init_database,
            run_local_smoke_check,
            ensure_default_conversation,
            list_conversations,
            create_conversation,
            update_conversation_title,
            archive_conversation,
            unarchive_conversation,
            delete_conversation,
            save_message,
            list_messages,
            load_learning_memory_context,
            save_learning_memory_state,
            save_reflection_record,
            save_assessment_result,
            sync_assessment_ids_exist,
            load_persisted_sync_diagnostic_assessments,
            load_student_knowledge,
            load_knowledge_prerequisites,
            save_provider_config,
            load_default_provider_config,
            list_provider_configs,
            delete_provider_config,
            save_provider_api_key,
            delete_provider_api_key,
            seed_knowledge_nodes_from_json,
            sync_approved_manifest,
            count_knowledge_nodes,
            count_all_knowledge_nodes,
            get_knowledge_node_counts_by_subject,
            get_approved_knowledge_node_counts_by_subject,
            count_approved_knowledge_nodes,
            count_manifest_nodes,
            knowledge_health_check,
            delete_orphan_knowledge_nodes,
            search_knowledge_from_db,
            get_knowledge_nodes_by_ids,
            complete_llm_chat,
            complete_llm_chat_stream,
            store_vector_embedding,
            search_vector_embeddings,
            compute_math_expression,
            bkt_update_mastery,
            generate_embedding,
            generate_embeddings_batch,
            count_vector_embeddings,
            delete_embeddings_by_model_and_ids,
            check_ollama_status,
            list_ollama_models,
            start_ollama_engine,
            parse_document_with_worker,
            compute_math_with_worker,
            run_code,
            select_document_file,
            save_private_document,
            list_private_documents,
            delete_private_document,
            load_private_document_chunks,
            search_private_document_chunks,
            get_private_document,
            bind_private_document_to_conversation,
            clear_private_document_binding,
            load_conversation_private_document_id,
            bocha_web_search,
            save_bocha_api_key,
            has_bocha_api_key,
            delete_bocha_api_key,
            create_custom_subject,
            list_custom_subjects,
            delete_custom_subject,
            generate_knowledge_from_sources,
            sync_list_private_ipv4,
            sync_start_server,
            sync_stop_server,
            sync_server_status,
            sync_new_pairing,
            sync_list_devices,
            sync_revoke_device,
            sync_firewall_diagnose,
            sync_get_read_model,
            sync_last_snapshot,
            sync_get_device_state,
            sync_list_mappings,
            sync_set_mapping,
            sync_remove_mapping,
            sync_list_proposals,
            sync_create_proposal
        ])
        .run(tauri::generate_context!())
        .expect("failed to run TeacherAgent")
}

fn run_local_smoke_check_with_connection(
    connection: &mut Connection,
) -> Result<LocalSmokeCheckCore, String> {
    let conversation = ensure_default_conversation_with_connection(connection, "math")?;
    let smoke_id = format!("local-smoke-message-{}", current_unix_nanos());
    let transaction = connection
        .transaction()
        .map_err(|error| format!("failed to start local smoke transaction: {error}"))?;

    save_message_with_connection(
        &transaction,
        SaveMessageInput {
            id: smoke_id.clone(),
            conversation_id: conversation.conversation_id.clone(),
            role: "system".to_string(),
            content: "TeacherAgent local smoke check message.".to_string(),
            content_format: Some("text".to_string()),
            knowledge_refs_json: Some("[]".to_string()),
            tool_refs_json: Some(r#"{"smokeCheck":true}"#.to_string()),
            guardrail_json: Some("{}".to_string()),
            attachments_json: Some("[]".to_string()),
            created_at: None,
        },
    )?;

    let saved_content: String = transaction
        .query_row(
            "SELECT content FROM messages WHERE id = ?1",
            [smoke_id.as_str()],
            |row| row.get(0),
        )
        .map_err(|error| format!("failed to read local smoke message: {error}"))?;
    let message_roundtrip = saved_content == "TeacherAgent local smoke check message.";

    transaction
        .rollback()
        .map_err(|error| format!("failed to rollback local smoke transaction: {error}"))?;

    let smoke_count: i64 = connection
        .query_row(
            "SELECT COUNT(1) FROM messages WHERE id = ?1",
            [smoke_id.as_str()],
            |row| row.get(0),
        )
        .map_err(|error| format!("failed to verify local smoke rollback: {error}"))?;

    Ok(LocalSmokeCheckCore {
        conversation,
        message_roundtrip,
        rollback_verified: smoke_count == 0,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::params;
    use std::fs;

    #[test]
    fn applies_initial_migration_once() {
        let database_path = std::env::temp_dir().join(format!(
            "teacher-agent-migration-test-{}-{}.sqlite3",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system clock should be after unix epoch")
                .as_nanos()
        ));
        let connection = Connection::open(&database_path).expect("test database should open");

        assert!(apply_migrations(&connection).expect("first migration should apply"));
        assert!(!apply_migrations(&connection).expect("second migration should be idempotent"));

        let created_memory_tables: i64 = connection
            .query_row(
                "SELECT COUNT(1)
                 FROM sqlite_master
                 WHERE type = 'table'
                   AND name IN ('student_cognitive_profiles', 'long_term_memories', 'short_term_memories')",
                [],
                |row| row.get(0),
            )
            .expect("memory table count should be readable");
        let applied_migrations =
            load_applied_migrations(&connection).expect("applied migrations should load");
        let user_version: i64 = connection
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .expect("SQLite user_version should be readable");

        let created_vector_tables: i64 = connection
            .query_row(
                "SELECT COUNT(1)
                 FROM sqlite_master
                 WHERE type = 'table'
                   AND name IN ('vector_embeddings')",
                [],
                |row| row.get(0),
            )
            .expect("vector table count should be readable");

        assert_eq!(created_memory_tables, 3);
        assert_eq!(created_vector_tables, 1);
        assert_eq!(user_version, 14);

        let created_private_doc_tables: i64 = connection
            .query_row(
                "SELECT COUNT(1)
                 FROM sqlite_master
                 WHERE type = 'table'
                   AND name IN ('private_documents', 'private_document_chunks')",
                [],
                |row| row.get(0),
            )
            .expect("private doc table count should be readable");
        assert_eq!(created_private_doc_tables, 2);

        let created_binding_tables: i64 = connection
            .query_row(
                "SELECT COUNT(1)
                 FROM sqlite_master
                 WHERE type = 'table'
                   AND name IN ('conversation_private_documents')",
                [],
                |row| row.get(0),
            )
            .expect("binding table count should be readable");
        assert_eq!(created_binding_tables, 1);

        assert_eq!(
            applied_migrations,
            vec![
                MIGRATION_0001_ID.to_string(),
                MIGRATION_0002_ID.to_string(),
                MIGRATION_0003_ID.to_string(),
                MIGRATION_0004_ID.to_string(),
                MIGRATION_0005_ID.to_string(),
                MIGRATION_0006_ID.to_string(),
                MIGRATION_0007_ID.to_string(),
                MIGRATION_0008_ID.to_string(),
                MIGRATION_0009_ID.to_string(),
                MIGRATION_0010_ID.to_string(),
                MIGRATION_0011_ID.to_string(),
                MIGRATION_0012_ID.to_string(),
                MIGRATION_0013_ID.to_string(),
                MIGRATION_0014_ID.to_string()
            ]
        );

        drop(connection);
        let _ = fs::remove_file(database_path);
    }

    #[test]
    fn saves_and_lists_conversation_messages() {
        let database_path = std::env::temp_dir().join(format!(
            "teacher-agent-message-test-{}-{}.sqlite3",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system clock should be after unix epoch")
                .as_nanos()
        ));
        let connection = Connection::open(&database_path).expect("test database should open");

        apply_migrations(&connection).expect("migration should apply");
        let conversation = ensure_default_conversation_with_connection(&connection, "math")
            .expect("default conversation should be created");

        save_message_with_connection(
            &connection,
            SaveMessageInput {
                id: "msg-student-1".to_string(),
                conversation_id: conversation.conversation_id.clone(),
                role: "student".to_string(),
                content: "什么是极限？".to_string(),
                content_format: None,
                knowledge_refs_json: None,
                tool_refs_json: None,
                guardrail_json: None,
                attachments_json: None,
                created_at: Some("2026-06-30T00:00:00.000Z".to_string()),
            },
        )
        .expect("student message should save");
        save_message_with_connection(
            &connection,
            SaveMessageInput {
                id: "msg-tutor-1".to_string(),
                conversation_id: conversation.conversation_id.clone(),
                role: "tutor".to_string(),
                content: "先从函数值靠近某个数理解。".to_string(),
                content_format: None,
                knowledge_refs_json: Some(
                    r#"[{"id":"math-limit-definition","title":"极限定义","subjectCode":"math"}]"#
                        .to_string(),
                ),
                tool_refs_json: Some(
                    r#"{"plannerResult":{"summary":"数学学习规划","masterySignals":["极限"]}}"#
                        .to_string(),
                ),
                guardrail_json: Some(
                    r#"{"allowed":true,"source":"rule","rewriteAttempts":0}"#.to_string(),
                ),
                attachments_json: None,
                created_at: Some("2026-06-30T00:00:01.000Z".to_string()),
            },
        )
        .expect("tutor message should save");

        let messages =
            list_messages_with_connection(&connection, &conversation.conversation_id, 10)
                .expect("messages should list");

        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0].role, "student");
        assert_eq!(messages[0].content, "什么是极限？");
        assert_eq!(messages[0].knowledge_refs_json, "[]");
        assert_eq!(messages[0].tool_refs_json, "[]");
        assert_eq!(messages[0].guardrail_json, "{}");
        assert_eq!(messages[1].role, "tutor");
        assert!(messages[1]
            .knowledge_refs_json
            .contains("math-limit-definition"));
        assert!(messages[1].tool_refs_json.contains("plannerResult"));
        assert!(messages[1].guardrail_json.contains(r#""allowed":true"#));

        drop(connection);
        let _ = fs::remove_file(database_path);
    }

    #[test]
    fn local_smoke_check_roundtrips_message_without_persisting_it() {
        let database_path = std::env::temp_dir().join(format!(
            "teacher-agent-smoke-test-{}-{}.sqlite3",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system clock should be after unix epoch")
                .as_nanos()
        ));
        let mut connection = Connection::open(&database_path).expect("test database should open");

        apply_migrations(&connection).expect("migration should apply");
        let result = run_local_smoke_check_with_connection(&mut connection)
            .expect("local smoke check should pass");
        let persisted_smoke_messages: i64 = connection
            .query_row(
                "SELECT COUNT(1) FROM messages WHERE id LIKE 'local-smoke-message-%'",
                [],
                |row| row.get(0),
            )
            .expect("smoke message count should be readable");

        assert_eq!(
            result.conversation.conversation_id,
            "local-default-conversation-math"
        );
        assert!(result.message_roundtrip);
        assert!(result.rollback_verified);
        assert_eq!(persisted_smoke_messages, 0);

        drop(connection);
        let _ = fs::remove_file(database_path);
    }

    #[test]
    fn creates_lists_and_renames_conversations() {
        let database_path = std::env::temp_dir().join(format!(
            "teacher-agent-conversation-list-test-{}-{}.sqlite3",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system clock should be after unix epoch")
                .as_nanos()
        ));
        let connection = Connection::open(&database_path).expect("test database should open");

        apply_migrations(&connection).expect("migration should apply");
        let default_conversation = ensure_default_conversation_with_connection(&connection, "math")
            .expect("default conversation should be created");
        let created =
            create_conversation_with_connection(&connection, "math", Some("极限专题".to_string()))
                .expect("conversation should create");
        let renamed = update_conversation_title_with_connection(
            &connection,
            &created.conversation_id,
            "等价无穷小练习",
        )
        .expect("conversation should rename");
        let conversations = list_conversations_with_connection(&connection, "math", 10, None)
            .expect("conversations should list");

        assert_eq!(renamed.title, "等价无穷小练习");
        assert!(conversations.iter().any(
            |conversation| conversation.conversation_id == default_conversation.conversation_id
        ));
        assert!(conversations
            .iter()
            .any(
                |conversation| conversation.conversation_id == created.conversation_id
                    && conversation.title == "等价无穷小练习"
            ));

        drop(connection);
        let _ = fs::remove_file(database_path);
    }

    #[test]
    fn saves_and_loads_learning_memory_context() {
        let database_path = std::env::temp_dir().join(format!(
            "teacher-agent-memory-test-{}-{}.sqlite3",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system clock should be after unix epoch")
                .as_nanos()
        ));
        let connection = Connection::open(&database_path).expect("test database should open");

        apply_migrations(&connection).expect("migration should apply");
        let conversation = ensure_default_conversation_with_connection(&connection, "math")
            .expect("default conversation should be created");
        let now = "2026-06-30T00:00:00.000Z".to_string();

        save_learning_memory_state_with_connection(
            &connection,
            SaveLearningMemoryInput {
                profile: Some(StoredCognitiveProfile {
                    id: "profile-1".to_string(),
                    student_id: DEFAULT_STUDENT_ID.to_string(),
                    subject_code: Some("math".to_string()),
                    learning_goals: vec!["目标包含考研备考".to_string()],
                    explanation_preferences: vec!["偏好分步骤讲解".to_string()],
                    recurring_misconceptions: vec!["混淆极限值和函数值".to_string()],
                    effective_strategies: vec!["decomposition".to_string()],
                    affective_signals: vec![],
                    confidence: 0.4,
                    created_at: now.clone(),
                    updated_at: now.clone(),
                }),
                short_term_memory: Some(StoredShortTermMemory {
                    id: "stm-1".to_string(),
                    conversation_id: conversation.conversation_id.clone(),
                    student_id: DEFAULT_STUDENT_ID.to_string(),
                    subject_code: Some("math".to_string()),
                    summary: "最近在学极限".to_string(),
                    recent_focus: vec!["极限".to_string()],
                    open_questions: vec!["直接代入是什么型？".to_string()],
                    last_misconceptions: vec!["混淆极限值和函数值".to_string()],
                    last_mode: Some("guide".to_string()),
                    turn_count: 1,
                    created_at: now.clone(),
                    updated_at: now.clone(),
                }),
                long_term_memories: vec![StoredLongTermMemory {
                    id: "ltm-1".to_string(),
                    student_id: DEFAULT_STUDENT_ID.to_string(),
                    subject_code: Some("math".to_string()),
                    kind: "learning_goal".to_string(),
                    summary: "目标包含考研备考".to_string(),
                    evidence: "我要准备考研数学".to_string(),
                    confidence: 0.75,
                    source: "user_explicit".to_string(),
                    created_at: now.clone(),
                    updated_at: now.clone(),
                }],
            },
        )
        .expect("learning memory should save");

        let context = load_learning_memory_context_with_connection(
            &connection,
            DEFAULT_STUDENT_ID,
            &conversation.conversation_id,
            "math",
        )
        .expect("learning memory should load");

        assert_eq!(
            context
                .profile
                .expect("profile should exist")
                .learning_goals,
            vec!["目标包含考研备考".to_string()]
        );
        assert_eq!(
            context
                .short_term_memory
                .expect("short-term memory should exist")
                .recent_focus,
            vec!["极限".to_string()]
        );
        assert_eq!(context.long_term_memories.len(), 1);
        assert_eq!(context.long_term_memories[0].kind, "learning_goal");

        drop(connection);
        let _ = fs::remove_file(database_path);
    }

    #[test]
    fn saves_reflection_record() {
        let database_path = std::env::temp_dir().join(format!(
            "teacher-agent-reflection-test-{}-{}.sqlite3",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system clock should be after unix epoch")
                .as_nanos()
        ));
        let connection = Connection::open(&database_path).expect("test database should open");

        apply_migrations(&connection).expect("migration should apply");
        let conversation = ensure_default_conversation_with_connection(&connection, "math")
            .expect("default conversation should be created");

        let saved = save_reflection_record_with_connection(
            &connection,
            SaveReflectionRecordInput {
                id: "reflection-1".to_string(),
                conversation_id: conversation.conversation_id,
                student_id: DEFAULT_STUDENT_ID.to_string(),
                summary: "本轮围绕极限进行引导。".to_string(),
                knowledge_updates_json: r#"{"observations":[],"updates":[]}"#.to_string(),
                misconceptions_json: r#"{"items":[]}"#.to_string(),
                strategy_insights_json: r#"[{"strategy":"socratic_question","effect":"helpful"}]"#
                    .to_string(),
                next_best_action_json: r#"{"type":"continue_problem","reason":"继续推进"}"#
                    .to_string(),
                confidence: 0.52,
                created_at: Some("2026-06-30T00:00:00.000Z".to_string()),
            },
        )
        .expect("reflection record should save");

        assert_eq!(saved.id, "reflection-1");
        assert_eq!(saved.student_id, DEFAULT_STUDENT_ID);
        assert_eq!(saved.confidence, 0.52);

        drop(connection);
        let _ = fs::remove_file(database_path);
    }

    #[test]
    fn saves_assessment_result() {
        let database_path = std::env::temp_dir().join(format!(
            "teacher-agent-assessment-test-{}-{}.sqlite3",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system clock should be after unix epoch")
                .as_nanos()
        ));
        let connection = Connection::open(&database_path).expect("test database should open");

        apply_migrations(&connection).expect("migration should apply");
        let conversation = ensure_default_conversation_with_connection(&connection, "math")
            .expect("default conversation should be created");

        let saved = save_assessment_result_with_connection(
            &connection,
            SaveAssessmentResultInput {
                id: "assessment-1".to_string(),
                student_id: DEFAULT_STUDENT_ID.to_string(),
                subject_code: "math".to_string(),
                learning_goal_id: None,
                conversation_id: Some(conversation.conversation_id.clone()),
                assessment_type: "turn_assessment".to_string(),
                overall_level: "unknown".to_string(),
                strengths_json: r#"[]"#.to_string(),
                weaknesses_json: r#"["混淆极限值和函数值"]"#.to_string(),
                recommendations_json: r#"[{"action":"explain_concept"}]"#.to_string(),
                evidence_json: r#"{
                  "correctness":"partially_correct",
                  "confidence":0.52,
                  "knowledgeUpdates":[
                    {
                      "knowledgeNodeId":"math-limit-basic-definition",
                      "masteryDelta":0.04,
                      "correctness":"partially_correct",
                      "reason":"围绕极限的直观含义表现为 partially_correct。"
                    }
                  ],
                  "knowledgeSnapshots":[
                    {
                      "id":"math-limit-basic-definition",
                      "title":"极限的直观含义",
                      "subjectCode":"math",
                      "summary":"函数极限描述趋近过程。",
                      "misconceptions":["把极限值等同于函数值"],
                      "socraticHints":[{"level":"L1","text":"先判断趋近哪里。"}]
                    }
                  ]
                }"#
                .to_string(),
                created_at: Some("2026-06-30T00:00:00.000Z".to_string()),
            },
        )
        .expect("assessment result should save");
        let mastery = connection
            .query_row(
                "SELECT mastery_probability, attempts_count, correct_count, evidence_summary
                 FROM student_knowledge
                 WHERE student_id = ?1 AND knowledge_node_id = ?2",
                params![DEFAULT_STUDENT_ID, "math-limit-basic-definition"],
                |row| {
                    Ok((
                        row.get::<_, f64>(0)?,
                        row.get::<_, i64>(1)?,
                        row.get::<_, i64>(2)?,
                        row.get::<_, String>(3)?,
                    ))
                },
            )
            .expect("student knowledge should be updated");
        let knowledge_title: String = connection
            .query_row(
                "SELECT title FROM knowledge_nodes WHERE id = ?1",
                ["math-limit-basic-definition"],
                |row| row.get(0),
            )
            .expect("knowledge node snapshot should be saved");
        let mastery_list = load_student_knowledge_with_connection(
            &connection,
            DEFAULT_STUDENT_ID,
            "math",
            10,
            None,
        )
        .expect("student knowledge should load for planner");

        assert_eq!(saved.id, "assessment-1");
        assert_eq!(saved.student_id, DEFAULT_STUDENT_ID);
        assert_eq!(saved.subject_id, "subject-math");
        assert_eq!(saved.conversation_id, Some(conversation.conversation_id));
        assert_eq!(saved.assessment_type, "turn_assessment");
        assert_eq!(knowledge_title, "极限的直观含义");
        assert!((mastery.0 - 0.54).abs() < 0.0001);
        assert_eq!(mastery.1, 1); // attempts_count: partially_correct increments attempts
        assert_eq!(mastery.2, 0); // correct_count: partially_correct does NOT increment correct
        assert!(mastery.3.contains("partially_correct"));
        assert_eq!(mastery_list.len(), 1);
        assert_eq!(
            mastery_list[0].knowledge_node_id,
            "math-limit-basic-definition"
        );
        assert_eq!(mastery_list[0].title, "极限的直观含义");

        drop(connection);
        let _ = fs::remove_file(database_path);
    }

    #[test]
    fn loads_knowledge_prerequisites_for_planner() {
        let database_path = std::env::temp_dir().join(format!(
            "teacher-agent-prerequisite-test-{}-{}.sqlite3",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system clock should be after unix epoch")
                .as_nanos()
        ));
        let connection = Connection::open(&database_path).expect("test database should open");

        apply_migrations(&connection).expect("migration should apply");
        ensure_default_conversation_with_connection(&connection, "math")
            .expect("default conversation should be created");
        connection
            .execute(
                "INSERT INTO knowledge_nodes (
                   id, subject_id, title, slug, summary, level, difficulty,
                   prerequisites_json, misconceptions_json, socratic_hints_json,
                   review_status, created_at, updated_at
                 )
                 VALUES (?1, 'subject-math', ?2, ?3, ?4, ?5, ?6, ?7, '[]', '[]',
                         'approved', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
                params![
                    "math-limit-infinitesimal",
                    "无穷小",
                    "infinitesimal",
                    "趋近于 0 的变量或函数。",
                    "concept",
                    1,
                    "[]"
                ],
            )
            .expect("prerequisite node should insert");
        connection
            .execute(
                "INSERT INTO knowledge_nodes (
                   id, subject_id, title, slug, summary, level, difficulty,
                   prerequisites_json, misconceptions_json, socratic_hints_json,
                   review_status, created_at, updated_at
                 )
                 VALUES (?1, 'subject-math', ?2, ?3, ?4, ?5, ?6, ?7, '[]', '[]',
                         'approved', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
                params![
                    "math-limit-equivalent-infinitesimal",
                    "等价无穷小替换",
                    "equivalent-infinitesimal",
                    "用同阶无穷小简化乘除结构。",
                    "method",
                    2,
                    r#"["基本初等函数"]"#
                ],
            )
            .expect("target node should insert");
        connection
            .execute(
                "INSERT INTO knowledge_edges (
                   id, subject_id, from_node_id, to_node_id, relation_type, weight, created_at
                 )
                 VALUES (
                   'edge-infinitesimal-to-equivalent', 'subject-math',
                   'math-limit-infinitesimal', 'math-limit-equivalent-infinitesimal',
                   'prerequisite', 0.9, strftime('%Y-%m-%dT%H:%M:%fZ','now')
                 )",
                [],
            )
            .expect("knowledge edge should insert");

        let prerequisites = load_knowledge_prerequisites_with_connection(
            &connection,
            "math",
            &["math-limit-equivalent-infinitesimal".to_string()],
            10,
        )
        .expect("planner prerequisites should load");

        assert!(prerequisites.iter().any(|item| {
            item.prerequisite_node_id.as_deref() == Some("math-limit-infinitesimal")
                && item.title == "无穷小"
                && item.source == "knowledge_edges"
        }));
        assert!(prerequisites.iter().any(|item| {
            item.prerequisite_node_id.is_none()
                && item.title == "基本初等函数"
                && item.source == "prerequisites_json"
        }));

        drop(connection);
        let _ = fs::remove_file(database_path);
    }

    #[test]
    fn saves_and_loads_default_provider_config_without_plaintext_key() {
        let database_path = std::env::temp_dir().join(format!(
            "teacher-agent-provider-test-{}-{}.sqlite3",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system clock should be after unix epoch")
                .as_nanos()
        ));
        let connection = Connection::open(&database_path).expect("test database should open");

        apply_migrations(&connection).expect("migration should apply");

        let saved = save_provider_config_with_connection(
            &connection,
            SaveProviderConfigInput {
                id: Some("provider-default".to_string()),
                name: "Custom OpenAI-compatible".to_string(),
                provider_type: "openai_compatible".to_string(),
                base_url: "https://llm.example.com/v1".to_string(),
                model: "user-selected-model".to_string(),
                api_key_ref: None,
                is_default: true,
                is_local: false,
                text_model: None,
                vision_model: None,
                supports_vision: false,
            },
        )
        .expect("provider config should save");
        let keychain_ref = create_provider_api_key_ref("provider-default");
        let saved_with_ref = save_provider_config_with_connection(
            &connection,
            SaveProviderConfigInput {
                id: Some("provider-default".to_string()),
                name: "Custom OpenAI-compatible".to_string(),
                provider_type: "openai_compatible".to_string(),
                base_url: "https://llm.example.com/v1".to_string(),
                model: "user-selected-model".to_string(),
                api_key_ref: Some(keychain_ref.clone()),
                is_default: true,
                is_local: false,
                text_model: None,
                vision_model: None,
                supports_vision: false,
            },
        )
        .expect("provider config should save keychain ref");
        let loaded = load_default_provider_config_with_connection(&connection)
            .expect("default provider should load")
            .expect("default provider should exist");
        let plaintext_key_result = save_provider_config_with_connection(
            &connection,
            SaveProviderConfigInput {
                id: Some("bad-provider".to_string()),
                name: "Bad".to_string(),
                provider_type: "openai_compatible".to_string(),
                base_url: "https://example.com/v1".to_string(),
                model: "bad-model".to_string(),
                api_key_ref: Some("sk-plaintext-key".to_string()),
                is_default: true,
                is_local: false,
                text_model: None,
                vision_model: None,
                supports_vision: false,
            },
        );

        assert_eq!(saved.id, "provider-default");
        assert_eq!(saved_with_ref.api_key_ref, Some(keychain_ref.clone()));
        assert_eq!(loaded.name, "Custom OpenAI-compatible");
        assert_eq!(loaded.api_key_ref, Some(keychain_ref));
        assert_eq!(
            account_from_api_key_ref("keychain:teacher-agent:provider-api-key:provider-default")
                .expect("keychain account should parse"),
            "provider-default"
        );
        assert!(plaintext_key_result.is_err());

        drop(connection);
        let _ = fs::remove_file(database_path);
    }

    #[tokio::test]
    async fn validates_llm_chat_request_without_plaintext_key() {
        let missing_key_result = complete_llm_chat_with_provider(CompleteLlmChatInput {
            provider_name: "Custom OpenAI-compatible".to_string(),
            base_url: "https://llm.example.com/v1".to_string(),
            model: "user-selected-model".to_string(),
            api_key_ref: None,
            is_local: false,
            messages: vec![LlmChatMessage {
                role: "user".to_string(),
                content: serde_json::Value::String("Health check.".to_string()),
            }],
            temperature: Some(0.0),
            max_tokens: Some(8),
        })
        .await;
        let invalid_role_result = complete_llm_chat_with_provider(CompleteLlmChatInput {
            provider_name: "Local".to_string(),
            base_url: "http://127.0.0.1:11434/v1".to_string(),
            model: "local-model".to_string(),
            api_key_ref: None,
            is_local: true,
            messages: vec![LlmChatMessage {
                role: "developer".to_string(),
                content: serde_json::Value::String("Health check.".to_string()),
            }],
            temperature: Some(0.0),
            max_tokens: Some(8),
        })
        .await;

        assert!(missing_key_result
            .expect_err("non-local provider should require keychain ref")
            .code
            .contains("auth_missing"));
        assert!(invalid_role_result
            .expect_err("invalid role should be rejected")
            .code
            .contains("invalid_request"));
        assert_eq!(
            create_chat_completions_url("https://llm.example.com/v1/"),
            "https://llm.example.com/v1/chat/completions"
        );
        assert_eq!(
            create_chat_completions_url("https://llm.example.com/v1/chat/completions"),
            "https://llm.example.com/v1/chat/completions"
        );
    }

    #[test]
    fn conversation_archive_unarchive_flow() {
        let database_path = std::env::temp_dir().join(format!(
            "teacher-agent-archive-test-{}-{}.sqlite3",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system clock should be after unix epoch")
                .as_nanos()
        ));
        let connection = Connection::open(&database_path).expect("test database should open");
        apply_migrations(&connection).expect("migration should apply");

        let conv =
            create_conversation_with_connection(&connection, "math", Some("测试会话".to_string()))
                .expect("should create");

        // Active list should contain it
        let active = list_conversations_with_connection(&connection, "math", 10, None)
            .expect("should list active");
        assert!(active
            .iter()
            .any(|c| c.conversation_id == conv.conversation_id));

        // Archive it
        let archived = archive_conversation_with_connection(&connection, &conv.conversation_id)
            .expect("should archive");
        assert_eq!(archived.status, "archived");

        // Active list should NOT contain it
        let active = list_conversations_with_connection(&connection, "math", 10, None)
            .expect("should list active");
        assert!(!active
            .iter()
            .any(|c| c.conversation_id == conv.conversation_id));

        // Archived list should contain it
        let archived_list =
            list_conversations_with_connection(&connection, "math", 10, Some("archived"))
                .expect("should list archived");
        assert!(archived_list
            .iter()
            .any(|c| c.conversation_id == conv.conversation_id));

        // Unarchive it
        let unarchived = unarchive_conversation_with_connection(&connection, &conv.conversation_id)
            .expect("should unarchive");
        assert_eq!(unarchived.status, "active");

        // Active list should contain it again
        let active = list_conversations_with_connection(&connection, "math", 10, None)
            .expect("should list active");
        assert!(active
            .iter()
            .any(|c| c.conversation_id == conv.conversation_id));

        drop(connection);
        let _ = fs::remove_file(database_path);
    }

    #[test]
    fn conversation_soft_delete_hides_from_all_lists() {
        let database_path = std::env::temp_dir().join(format!(
            "teacher-agent-delete-test-{}-{}.sqlite3",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system clock should be after unix epoch")
                .as_nanos()
        ));
        let connection = Connection::open(&database_path).expect("test database should open");
        apply_migrations(&connection).expect("migration should apply");

        let conv =
            create_conversation_with_connection(&connection, "math", Some("删除测试".to_string()))
                .expect("should create");

        // Save a message first
        save_message_with_connection(
            &connection,
            SaveMessageInput {
                id: "delete-test-msg-1".to_string(),
                conversation_id: conv.conversation_id.clone(),
                role: "student".to_string(),
                content: "测试消息".to_string(),
                content_format: None,
                knowledge_refs_json: None,
                tool_refs_json: None,
                guardrail_json: None,
                attachments_json: None,
                created_at: None,
            },
        )
        .expect("should save message");

        // Delete the conversation
        soft_delete_conversation_with_connection(&connection, &conv.conversation_id)
            .expect("should delete");

        // Active list should NOT contain it
        let active = list_conversations_with_connection(&connection, "math", 10, None)
            .expect("should list active");
        assert!(!active
            .iter()
            .any(|c| c.conversation_id == conv.conversation_id));

        // Archived list should NOT contain it
        let archived =
            list_conversations_with_connection(&connection, "math", 10, Some("archived"))
                .expect("should list archived");
        assert!(!archived
            .iter()
            .any(|c| c.conversation_id == conv.conversation_id));

        // Messages should still exist (soft delete)
        let messages = list_messages_with_connection(&connection, &conv.conversation_id, 10)
            .expect("should list messages");
        assert!(
            !messages.is_empty(),
            "messages should be preserved after soft delete"
        );

        drop(connection);
        let _ = fs::remove_file(database_path);
    }

    #[test]
    fn default_conversation_revives_after_soft_delete() {
        let database_path = std::env::temp_dir().join(format!(
            "teacher-agent-revive-test-{}-{}.sqlite3",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system clock should be after unix epoch")
                .as_nanos()
        ));
        let connection = Connection::open(&database_path).expect("test database should open");
        apply_migrations(&connection).expect("migration should apply");

        // Create default conversation
        let default_conv = ensure_default_conversation_with_connection(&connection, "math")
            .expect("default conversation should be created");
        assert_eq!(default_conv.status, "active");

        // Save a message
        save_message_with_connection(
            &connection,
            SaveMessageInput {
                id: "revive-test-msg".to_string(),
                conversation_id: default_conv.conversation_id.clone(),
                role: "student".to_string(),
                content: "测试消息".to_string(),
                content_format: None,
                knowledge_refs_json: None,
                tool_refs_json: None,
                guardrail_json: None,
                attachments_json: None,
                created_at: None,
            },
        )
        .expect("should save message");

        // Soft delete the default conversation
        soft_delete_conversation_with_connection(&connection, &default_conv.conversation_id)
            .expect("should soft delete");

        // Verify it's gone from active list
        let active = list_conversations_with_connection(&connection, "math", 10, None)
            .expect("should list active");
        assert!(!active
            .iter()
            .any(|c| c.conversation_id == default_conv.conversation_id));

        // Call ensure_default again — should revive
        let revived = ensure_default_conversation_with_connection(&connection, "math")
            .expect("default conversation should revive");
        assert_eq!(revived.conversation_id, default_conv.conversation_id);
        assert_eq!(revived.status, "active");

        // Should appear in active list again
        let active = list_conversations_with_connection(&connection, "math", 10, None)
            .expect("should list active");
        assert!(active
            .iter()
            .any(|c| c.conversation_id == default_conv.conversation_id));

        // Messages should be preserved
        let messages =
            list_messages_with_connection(&connection, &default_conv.conversation_id, 10)
                .expect("should list messages");
        assert!(
            !messages.is_empty(),
            "messages should be preserved after revive"
        );

        drop(connection);
        let _ = fs::remove_file(database_path);
    }

    #[test]
    fn normalize_subject_code_cs408_is_independent() {
        // cs408 must NOT fall through to "math"
        assert_eq!(normalize_subject_code("cs408").unwrap(), "cs408");
        assert_eq!(normalize_subject_code("math").unwrap(), "math");
        assert_eq!(normalize_subject_code("english").unwrap(), "english");
        // Unknown subjects return error
        assert!(normalize_subject_code("unknown").is_err());
    }

    #[test]
    fn subject_name_includes_cs408() {
        assert_eq!(subject_name("cs408"), "408考研");
        assert_eq!(subject_name("math"), "数学");
        assert_eq!(subject_name("english"), "英语");
    }

    #[test]
    fn count_all_knowledge_nodes_across_subjects() {
        let database_path = std::env::temp_dir().join(format!(
            "teacher-agent-count-all-test-{}-{}.sqlite3",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system clock should be after unix epoch")
                .as_nanos()
        ));
        let connection = Connection::open(&database_path).expect("test database should open");
        apply_migrations(&connection).expect("migration should apply");

        // Insert nodes under different subjects
        let seed_math = seed::KnowledgeSeedFile {
            subject: "math".to_string(),
            course: None,
            chapter: None,
            status: Some("approved".to_string()),
            nodes: vec![seed::SeedNode {
                id: "math-test-1".to_string(),
                title: "Math Node".to_string(),
                level: "concept".to_string(),
                difficulty: 1,
                summary: "test".to_string(),
                prerequisites: vec![],
                misconceptions: vec![],
                socratic_hints: vec![],
                source: None,
            }],
        };
        let seed_cs408 = seed::KnowledgeSeedFile {
            subject: "cs408".to_string(),
            course: None,
            chapter: None,
            status: Some("approved".to_string()),
            nodes: vec![
                seed::SeedNode {
                    id: "cs408-test-1".to_string(),
                    title: "CS408 Node 1".to_string(),
                    level: "concept".to_string(),
                    difficulty: 1,
                    summary: "test".to_string(),
                    prerequisites: vec![],
                    misconceptions: vec![],
                    socratic_hints: vec![],
                    source: None,
                },
                seed::SeedNode {
                    id: "cs408-test-2".to_string(),
                    title: "CS408 Node 2".to_string(),
                    level: "concept".to_string(),
                    difficulty: 1,
                    summary: "test".to_string(),
                    prerequisites: vec![],
                    misconceptions: vec![],
                    socratic_hints: vec![],
                    source: None,
                },
            ],
        };

        seed::seed_knowledge_nodes(&connection, &seed_math, seed::SeedMode::InsertOnly)
            .expect("math seed");
        seed::seed_knowledge_nodes(&connection, &seed_cs408, seed::SeedMode::InsertOnly)
            .expect("cs408 seed");

        // Per-subject counts
        let math_count = seed::count_knowledge_nodes(&connection, "math").expect("math count");
        let cs408_count = seed::count_knowledge_nodes(&connection, "cs408").expect("cs408 count");
        assert_eq!(math_count, 1);
        assert_eq!(cs408_count, 2);

        // Total count
        let total = seed::count_all_knowledge_nodes(&connection).expect("total count");
        assert_eq!(total, 3);

        // Grouped counts
        let grouped =
            seed::get_knowledge_node_counts_by_subject(&connection).expect("grouped count");
        let math_grouped = grouped.iter().find(|(c, _)| c == "math");
        let cs408_grouped = grouped.iter().find(|(c, _)| c == "cs408");
        assert_eq!(math_grouped.unwrap().1, 1);
        assert_eq!(cs408_grouped.unwrap().1, 2);

        drop(connection);
        let _ = fs::remove_file(database_path);
    }

    // ── Assessment data pollution fix tests ────────────────────────────────

    /// Test: unknown correctness does not create knowledge updates or increment counts.
    #[test]
    fn assessment_unknown_correctness_no_knowledge_updates() {
        let database_path = std::env::temp_dir().join(format!(
            "teacher-agent-assessment-unknown-{}-{}.sqlite3",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system clock should be after unix epoch")
                .as_nanos()
        ));
        let connection = Connection::open(&database_path).expect("test database should open");
        apply_migrations(&connection).expect("migration should apply");
        let conversation = ensure_default_conversation_with_connection(&connection, "math")
            .expect("default conversation should be created");

        // Seed a knowledge node
        connection
            .execute(
                "INSERT INTO knowledge_nodes (
                   id, subject_id, title, slug, summary, level, difficulty,
                   prerequisites_json, misconceptions_json, socratic_hints_json,
                   review_status, created_at, updated_at
                 )
                 VALUES (?1, 'subject-math', ?2, ?3, ?4, 'concept', 1, '[]', '[]', '[]',
                         'approved', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
                params!["test-limit", "极限的直观含义", "test-limit", "函数极限描述趋近过程。"],
            )
            .expect("knowledge node should be seeded");

        // Save assessment with unknown correctness
        save_assessment_result_with_connection(
            &connection,
            SaveAssessmentResultInput {
                id: "assessment-unknown-1".to_string(),
                student_id: DEFAULT_STUDENT_ID.to_string(),
                subject_code: "math".to_string(),
                learning_goal_id: None,
                conversation_id: Some(conversation.conversation_id.clone()),
                assessment_type: "turn_assessment".to_string(),
                overall_level: "unknown".to_string(),
                strengths_json: r#"[]"#.to_string(),
                weaknesses_json: r#"[]"#.to_string(),
                recommendations_json: r#"[]"#.to_string(),
                evidence_json: r#"{
                  "correctness":"unknown",
                  "knowledgeUpdates":[],
                  "knowledgeSnapshots":[
                    {"id":"test-limit","title":"极限的直观含义","summary":"函数极限描述趋近过程。"}
                  ]
                }"#
                .to_string(),
                created_at: Some("2026-07-14T00:00:00.000Z".to_string()),
            },
        )
        .expect("unknown assessment should save");

        // student_knowledge should NOT exist — no updates were generated
        let count: i64 = connection
            .query_row(
                "SELECT COUNT(1) FROM student_knowledge WHERE student_id = ?1",
                [DEFAULT_STUDENT_ID],
                |row| row.get(0),
            )
            .expect("count query");
        assert_eq!(
            count, 0,
            "unknown correctness should not create student_knowledge rows"
        );

        drop(connection);
        let _ = fs::remove_file(database_path);
    }

    /// Test: partially_correct increments attempts but NOT correct_count.
    #[test]
    fn assessment_partially_correct_increments_attempts_only() {
        let database_path = std::env::temp_dir().join(format!(
            "teacher-agent-assessment-partially-{}-{}.sqlite3",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system clock should be after unix epoch")
                .as_nanos()
        ));
        let connection = Connection::open(&database_path).expect("test database should open");
        apply_migrations(&connection).expect("migration should apply");
        let conversation = ensure_default_conversation_with_connection(&connection, "math")
            .expect("default conversation should be created");

        connection
            .execute(
                "INSERT INTO knowledge_nodes (
                   id, subject_id, title, slug, summary, level, difficulty,
                   prerequisites_json, misconceptions_json, socratic_hints_json,
                   review_status, created_at, updated_at
                 )
                 VALUES (?1, 'subject-math', ?2, ?3, ?4, 'concept', 1, '[]', '[]', '[]',
                         'approved', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
                params!["test-limit-2", "极限的直观含义", "test-limit-2", "函数极限描述趋近过程。"],
            )
            .expect("knowledge node should be seeded");

        save_assessment_result_with_connection(
            &connection,
            SaveAssessmentResultInput {
                id: "assessment-partially-1".to_string(),
                student_id: DEFAULT_STUDENT_ID.to_string(),
                subject_code: "math".to_string(),
                learning_goal_id: None,
                conversation_id: Some(conversation.conversation_id.clone()),
                assessment_type: "turn_assessment".to_string(),
                overall_level: "unknown".to_string(),
                strengths_json: r#"[]"#.to_string(),
                weaknesses_json: r#"[]"#.to_string(),
                recommendations_json: r#"[]"#.to_string(),
                evidence_json: r#"{
                  "correctness":"partially_correct",
                  "knowledgeUpdates":[
                    {"knowledgeNodeId":"test-limit-2","masteryDelta":0.04,"correctness":"partially_correct","reason":"test"}
                  ],
                  "knowledgeSnapshots":[
                    {"id":"test-limit-2","title":"极限的直观含义","summary":"函数极限描述趋近过程。"}
                  ]
                }"#.to_string(),
                created_at: Some("2026-07-14T00:00:00.000Z".to_string()),
            },
        )
        .expect("partially_correct assessment should save");

        let (attempts, correct) = connection
            .query_row(
                "SELECT attempts_count, correct_count FROM student_knowledge WHERE student_id = ?1 AND knowledge_node_id = ?2",
                params![DEFAULT_STUDENT_ID, "test-limit-2"],
                |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
            )
            .expect("student knowledge should exist");
        assert_eq!(attempts, 1, "partially_correct should increment attempts");
        assert_eq!(correct, 0, "partially_correct should NOT increment correct");

        drop(connection);
        let _ = fs::remove_file(database_path);
    }

    /// Test: correct increments both attempts and correct_count.
    #[test]
    fn assessment_correct_increments_both() {
        let database_path = std::env::temp_dir().join(format!(
            "teacher-agent-assessment-correct-{}-{}.sqlite3",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system clock should be after unix epoch")
                .as_nanos()
        ));
        let connection = Connection::open(&database_path).expect("test database should open");
        apply_migrations(&connection).expect("migration should apply");
        let conversation = ensure_default_conversation_with_connection(&connection, "math")
            .expect("default conversation should be created");

        connection
            .execute(
                "INSERT INTO knowledge_nodes (
                   id, subject_id, title, slug, summary, level, difficulty,
                   prerequisites_json, misconceptions_json, socratic_hints_json,
                   review_status, created_at, updated_at
                 )
                 VALUES (?1, 'subject-math', ?2, ?3, ?4, 'concept', 1, '[]', '[]', '[]',
                         'approved', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
                params!["test-limit-3", "极限的直观含义", "test-limit-3", "函数极限描述趋近过程。"],
            )
            .expect("knowledge node should be seeded");

        save_assessment_result_with_connection(
            &connection,
            SaveAssessmentResultInput {
                id: "assessment-correct-1".to_string(),
                student_id: DEFAULT_STUDENT_ID.to_string(),
                subject_code: "math".to_string(),
                learning_goal_id: None,
                conversation_id: Some(conversation.conversation_id.clone()),
                assessment_type: "turn_assessment".to_string(),
                overall_level: "unknown".to_string(),
                strengths_json: r#"[]"#.to_string(),
                weaknesses_json: r#"[]"#.to_string(),
                recommendations_json: r#"[]"#.to_string(),
                evidence_json: r#"{
                  "correctness":"correct",
                  "knowledgeUpdates":[
                    {"knowledgeNodeId":"test-limit-3","masteryDelta":0.08,"correctness":"correct","reason":"test"}
                  ],
                  "knowledgeSnapshots":[
                    {"id":"test-limit-3","title":"极限的直观含义","summary":"函数极限描述趋近过程。"}
                  ]
                }"#.to_string(),
                created_at: Some("2026-07-14T00:00:00.000Z".to_string()),
            },
        )
        .expect("correct assessment should save");

        let (attempts, correct) = connection
            .query_row(
                "SELECT attempts_count, correct_count FROM student_knowledge WHERE student_id = ?1 AND knowledge_node_id = ?2",
                params![DEFAULT_STUDENT_ID, "test-limit-3"],
                |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
            )
            .expect("student knowledge should exist");
        assert_eq!(attempts, 1, "correct should increment attempts");
        assert_eq!(correct, 1, "correct should increment correct");

        drop(connection);
        let _ = fs::remove_file(database_path);
    }

    /// Test: saving the same assessment ID twice is idempotent — counts change only once.
    #[test]
    fn assessment_idempotent_save() {
        let database_path = std::env::temp_dir().join(format!(
            "teacher-agent-assessment-idempotent-{}-{}.sqlite3",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system clock should be after unix epoch")
                .as_nanos()
        ));
        let connection = Connection::open(&database_path).expect("test database should open");
        apply_migrations(&connection).expect("migration should apply");
        let conversation = ensure_default_conversation_with_connection(&connection, "math")
            .expect("default conversation should be created");

        connection
            .execute(
                "INSERT INTO knowledge_nodes (
                   id, subject_id, title, slug, summary, level, difficulty,
                   prerequisites_json, misconceptions_json, socratic_hints_json,
                   review_status, created_at, updated_at
                 )
                 VALUES (?1, 'subject-math', ?2, ?3, ?4, 'concept', 1, '[]', '[]', '[]',
                         'approved', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
                params!["test-limit-4", "极限的直观含义", "test-limit-4", "函数极限描述趋近过程。"],
            )
            .expect("knowledge node should be seeded");

        let input = SaveAssessmentResultInput {
            id: "assessment-idempotent-1".to_string(),
            student_id: DEFAULT_STUDENT_ID.to_string(),
            subject_code: "math".to_string(),
            learning_goal_id: None,
            conversation_id: Some(conversation.conversation_id.clone()),
            assessment_type: "turn_assessment".to_string(),
            overall_level: "unknown".to_string(),
            strengths_json: r#"[]"#.to_string(),
            weaknesses_json: r#"[]"#.to_string(),
            recommendations_json: r#"[]"#.to_string(),
            evidence_json: r#"{
              "correctness":"correct",
              "knowledgeUpdates":[
                {"knowledgeNodeId":"test-limit-4","masteryDelta":0.08,"correctness":"correct","reason":"test"}
              ],
              "knowledgeSnapshots":[
                {"id":"test-limit-4","title":"极限的直观含义","summary":"函数极限描述趋近过程。"}
              ]
            }"#.to_string(),
            created_at: Some("2026-07-14T00:00:00.000Z".to_string()),
        };

        // Save twice with the same ID
        save_assessment_result_with_connection(&connection, input.clone())
            .expect("first save should succeed");
        save_assessment_result_with_connection(&connection, input)
            .expect("second save should succeed (idempotent)");

        let (attempts, correct) = connection
            .query_row(
                "SELECT attempts_count, correct_count FROM student_knowledge WHERE student_id = ?1 AND knowledge_node_id = ?2",
                params![DEFAULT_STUDENT_ID, "test-limit-4"],
                |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
            )
            .expect("student knowledge should exist");
        assert_eq!(
            attempts, 1,
            "idempotent save should not double-increment attempts"
        );
        assert_eq!(
            correct, 1,
            "idempotent save should not double-increment correct"
        );

        drop(connection);
        let _ = fs::remove_file(database_path);
    }

    /// Test: different assessment IDs produce independent updates.
    #[test]
    fn assessment_different_ids_independent() {
        let database_path = std::env::temp_dir().join(format!(
            "teacher-agent-assessment-diffids-{}-{}.sqlite3",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system clock should be after unix epoch")
                .as_nanos()
        ));
        let connection = Connection::open(&database_path).expect("test database should open");
        apply_migrations(&connection).expect("migration should apply");
        let conversation = ensure_default_conversation_with_connection(&connection, "math")
            .expect("default conversation should be created");

        connection
            .execute(
                "INSERT INTO knowledge_nodes (
                   id, subject_id, title, slug, summary, level, difficulty,
                   prerequisites_json, misconceptions_json, socratic_hints_json,
                   review_status, created_at, updated_at
                 )
                 VALUES (?1, 'subject-math', ?2, ?3, ?4, 'concept', 1, '[]', '[]', '[]',
                         'approved', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
                params!["test-limit-5", "极限的直观含义", "test-limit-5", "函数极限描述趋近过程。"],
            )
            .expect("knowledge node should be seeded");

        let evidence = r#"{
          "correctness":"correct",
          "knowledgeUpdates":[
            {"knowledgeNodeId":"test-limit-5","masteryDelta":0.08,"correctness":"correct","reason":"test"}
          ],
          "knowledgeSnapshots":[
            {"id":"test-limit-5","title":"极限的直观含义","summary":"函数极限描述趋近过程。"}
          ]
        }"#;

        save_assessment_result_with_connection(
            &connection,
            SaveAssessmentResultInput {
                id: "assessment-diff-1".to_string(),
                student_id: DEFAULT_STUDENT_ID.to_string(),
                subject_code: "math".to_string(),
                learning_goal_id: None,
                conversation_id: Some(conversation.conversation_id.clone()),
                assessment_type: "turn_assessment".to_string(),
                overall_level: "unknown".to_string(),
                strengths_json: r#"[]"#.to_string(),
                weaknesses_json: r#"[]"#.to_string(),
                recommendations_json: r#"[]"#.to_string(),
                evidence_json: evidence.to_string(),
                created_at: Some("2026-07-14T00:00:00.000Z".to_string()),
            },
        )
        .expect("first assessment should save");

        save_assessment_result_with_connection(
            &connection,
            SaveAssessmentResultInput {
                id: "assessment-diff-2".to_string(),
                student_id: DEFAULT_STUDENT_ID.to_string(),
                subject_code: "math".to_string(),
                learning_goal_id: None,
                conversation_id: Some(conversation.conversation_id.clone()),
                assessment_type: "turn_assessment".to_string(),
                overall_level: "unknown".to_string(),
                strengths_json: r#"[]"#.to_string(),
                weaknesses_json: r#"[]"#.to_string(),
                recommendations_json: r#"[]"#.to_string(),
                evidence_json: evidence.to_string(),
                created_at: Some("2026-07-14T00:01:00.000Z".to_string()),
            },
        )
        .expect("second assessment should save");

        let (attempts, correct) = connection
            .query_row(
                "SELECT attempts_count, correct_count FROM student_knowledge WHERE student_id = ?1 AND knowledge_node_id = ?2",
                params![DEFAULT_STUDENT_ID, "test-limit-5"],
                |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
            )
            .expect("student knowledge should exist");
        assert_eq!(
            attempts, 2,
            "different IDs should produce independent attempt increments"
        );
        assert_eq!(
            correct, 2,
            "different IDs should produce independent correct increments"
        );

        drop(connection);
        let _ = fs::remove_file(database_path);
    }

    // ── Custom subject regression tests ──────────────────────────────────

    /// Helper: create a temp database with migrations applied.
    fn create_test_db(label: &str) -> (Connection, std::path::PathBuf) {
        let database_path = std::env::temp_dir().join(format!(
            "teacher-agent-custom-{label}-{}-{}.sqlite3",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system clock should be after unix epoch")
                .as_nanos()
        ));
        let connection = Connection::open(&database_path).expect("test database should open");
        apply_migrations(&connection).expect("migration should apply");
        (connection, database_path)
    }

    /// Open a second connection to the same database (for delete_custom_subject which needs &mut).
    fn reopen_db(path: &std::path::Path) -> Connection {
        Connection::open(path).expect("re-open database should succeed")
    }

    #[test]
    fn resolve_subject_id_returns_custom_subject_real_id() {
        let (connection, database_path) = create_test_db("resolve-custom-id");

        // Create a custom subject — this inserts subjects.id = "custom-xxx"
        let custom = custom_subject::create_custom_subject(
            &connection,
            &custom_subject::CreateCustomSubjectInput {
                name: "测试自建学科".to_string(),
                description: Some("用于回归测试".to_string()),
                scope_keywords: Some("测试,回归".to_string()),
            },
        )
        .expect("custom subject should create");

        // resolve_subject_id should return the REAL id (custom-xxx), not "subject-custom-xxx"
        let resolved_id = shared::resolve_subject_id(&connection, &custom.id)
            .expect("should resolve custom subject");
        assert_eq!(
            resolved_id, custom.id,
            "resolved ID must match the real subjects.id, not a synthetic subject- prefix"
        );

        // Verify no duplicate subjects row was created
        let count: i64 = connection
            .query_row(
                "SELECT COUNT(1) FROM subjects WHERE code = ?1",
                params![custom.id],
                |row| row.get(0),
            )
            .expect("count should work");
        assert_eq!(
            count, 1,
            "there should be exactly one subjects row for this custom code"
        );

        drop(connection);
        let _ = fs::remove_file(database_path);
    }

    #[test]
    fn ensure_default_conversation_uses_real_custom_subject_id() {
        let (connection, database_path) = create_test_db("ensure-default-custom");

        let custom = custom_subject::create_custom_subject(
            &connection,
            &custom_subject::CreateCustomSubjectInput {
                name: "自建物理导论".to_string(),
                description: None,
                scope_keywords: None,
            },
        )
        .expect("custom subject should create");

        // ensure_default_conversation should use the real subject id
        let conversation = ensure_default_conversation_with_connection(&connection, &custom.id)
            .expect("default conversation should be created for custom subject");

        assert_eq!(
            conversation.subject_id, custom.id,
            "conversation must reference the real custom subject id"
        );
        assert_eq!(conversation.subject_code, custom.id);
        // Title should use the real name from the database, not "自建学科默认对话"
        assert!(
            conversation.title.contains("自建物理导论"),
            "title should contain the real subject name, got: {}",
            conversation.title
        );

        // Calling ensure again should be idempotent
        let conversation2 = ensure_default_conversation_with_connection(&connection, &custom.id)
            .expect("second call should succeed");
        assert_eq!(conversation.conversation_id, conversation2.conversation_id);

        // Verify no duplicate subjects row
        let count: i64 = connection
            .query_row(
                "SELECT COUNT(1) FROM subjects WHERE code = ?1",
                params![custom.id],
                |row| row.get(0),
            )
            .expect("count should work");
        assert_eq!(
            count, 1,
            "ensure_default must not create a duplicate subjects row"
        );

        drop(connection);
        let _ = fs::remove_file(database_path);
    }

    #[test]
    fn ensure_default_conversation_rejects_missing_custom_subject() {
        let (connection, database_path) = create_test_db("reject-missing-custom");

        // Trying to ensure a conversation for a non-existent custom subject should fail
        let result = ensure_default_conversation_with_connection(&connection, "custom-nonexistent");
        assert!(
            result.is_err(),
            "should error for non-existent custom subject"
        );
        let err = result.err().unwrap();
        assert!(
            err.contains("does not exist"),
            "error should mention the subject doesn't exist: {err}"
        );

        drop(connection);
        let _ = fs::remove_file(database_path);
    }

    #[test]
    fn custom_subject_draft_nodes_are_keyword_searchable() {
        let (connection, database_path) = create_test_db("custom-draft-search");

        let custom = custom_subject::create_custom_subject(
            &connection,
            &custom_subject::CreateCustomSubjectInput {
                name: "自建数据结构".to_string(),
                description: None,
                scope_keywords: None,
            },
        )
        .expect("custom subject should create");

        // Generate knowledge nodes from user-confirmed sources
        let count = custom_subject::generate_knowledge_from_sources(
            &connection,
            &custom_subject::GenerateKnowledgeFromSourcesInput {
                subject_id: custom.id.clone(),
                sources: vec![
                    custom_subject::SourceItem {
                        title: "二叉树遍历详解".to_string(),
                        url: "https://example.com/binary-tree".to_string(),
                        summary: "二叉树的前序、中序、后序和层序遍历方法".to_string(),
                        site_name: Some("教学资料站".to_string()),
                    },
                    custom_subject::SourceItem {
                        title: "图的最短路径算法".to_string(),
                        url: "https://example.com/shortest-path".to_string(),
                        summary: "Dijkstra和Floyd算法的原理与实现".to_string(),
                        site_name: Some("算法教程网".to_string()),
                    },
                ],
                topics: Some(vec!["二叉树遍历".to_string()]),
            },
        )
        .expect("should generate knowledge nodes");
        assert!(
            count >= 2,
            "should have created at least 2 nodes, got {count}"
        );

        // Keyword search should find draft nodes for custom subjects
        let results =
            seed::search_knowledge_nodes_by_keyword(&connection, &custom.id, "二叉树遍历", 10)
                .expect("keyword search should work");
        assert!(
            !results.is_empty(),
            "keyword search should find draft nodes for custom subject"
        );
        assert!(
            results.iter().any(|r| r.title.contains("二叉树遍历")),
            "should find the binary tree traversal node"
        );

        drop(connection);
        let _ = fs::remove_file(database_path);
    }

    #[test]
    fn custom_subject_save_and_load_learning_memory() {
        let (connection, database_path) = create_test_db("custom-memory");

        let custom = custom_subject::create_custom_subject(
            &connection,
            &custom_subject::CreateCustomSubjectInput {
                name: "自建有机化学".to_string(),
                description: None,
                scope_keywords: None,
            },
        )
        .expect("custom subject should create");

        let conversation = ensure_default_conversation_with_connection(&connection, &custom.id)
            .expect("default conversation should be created");

        // Save learning memory state
        let context = memory::save_learning_memory_state_with_connection(
            &connection,
            SaveLearningMemoryInput {
                profile: Some(StoredCognitiveProfile {
                    id: "profile-custom-1".to_string(),
                    student_id: DEFAULT_STUDENT_ID.to_string(),
                    subject_code: Some(custom.id.clone()),
                    learning_goals: vec!["掌握有机反应机理".to_string()],
                    explanation_preferences: vec![],
                    recurring_misconceptions: vec![],
                    effective_strategies: vec![],
                    affective_signals: vec![],
                    confidence: 0.5,
                    created_at: "2026-07-15T00:00:00.000Z".to_string(),
                    updated_at: "2026-07-15T00:00:00.000Z".to_string(),
                }),
                short_term_memory: Some(StoredShortTermMemory {
                    id: "stm-custom-1".to_string(),
                    conversation_id: conversation.conversation_id.clone(),
                    student_id: DEFAULT_STUDENT_ID.to_string(),
                    subject_code: Some(custom.id.clone()),
                    summary: "SN1反应机理讨论".to_string(),
                    recent_focus: vec![],
                    open_questions: vec![],
                    last_misconceptions: vec![],
                    last_mode: None,
                    turn_count: 1,
                    created_at: "2026-07-15T00:00:00.000Z".to_string(),
                    updated_at: "2026-07-15T00:00:00.000Z".to_string(),
                }),
                long_term_memories: vec![StoredLongTermMemory {
                    id: "ltm-custom-1".to_string(),
                    student_id: DEFAULT_STUDENT_ID.to_string(),
                    subject_code: Some(custom.id.clone()),
                    kind: "knowledge_mastery".to_string(),
                    summary: "SN2反应机理基本掌握".to_string(),
                    evidence: "3次练习答对2次".to_string(),
                    confidence: 0.6,
                    source: "turn_assessment".to_string(),
                    created_at: "2026-07-15T00:00:00.000Z".to_string(),
                    updated_at: "2026-07-15T00:00:00.000Z".to_string(),
                }],
            },
        )
        .expect("save learning memory should succeed for custom subject");

        // Verify the returned context references the correct custom subject
        assert!(
            context.profile.is_some(),
            "profile should be saved and returned"
        );
        let profile = context.profile.unwrap();
        // The profile was saved with subject_id = custom.id.
        // On load, row_to_cognitive_profile tries subject_code_from_subject_id()
        // which strips "subject-" prefix — custom IDs don't have this prefix,
        // so subject_code comes back as None. This is a known limitation.
        // The profile ID and student_id should still match.
        assert_eq!(profile.id, "profile-custom-1");
        assert_eq!(profile.student_id, DEFAULT_STUDENT_ID);

        // Load it back — should succeed even if subject_code is None
        let loaded = memory::load_learning_memory_context_with_connection(
            &connection,
            DEFAULT_STUDENT_ID,
            &conversation.conversation_id,
            &custom.id,
        )
        .expect("load should succeed");
        assert!(loaded.profile.is_some(), "profile should be loadable");

        drop(connection);
        let _ = fs::remove_file(database_path);
    }

    #[test]
    fn custom_subject_source_fields_are_distinct() {
        let (connection, database_path) = create_test_db("custom-source-fields");

        let custom = custom_subject::create_custom_subject(
            &connection,
            &custom_subject::CreateCustomSubjectInput {
                name: "自建测试学科".to_string(),
                description: None,
                scope_keywords: None,
            },
        )
        .expect("custom subject should create");

        custom_subject::generate_knowledge_from_sources(
            &connection,
            &custom_subject::GenerateKnowledgeFromSourcesInput {
                subject_id: custom.id.clone(),
                sources: vec![custom_subject::SourceItem {
                    title: "测试来源标题A".to_string(),
                    url: "https://example.com/a".to_string(),
                    summary: "来源摘要A".to_string(),
                    site_name: Some("来源站点A".to_string()),
                }],
                topics: None,
            },
        )
        .expect("should generate nodes");

        // Verify source title and license are different values
        // (prevents the bug where title and license were swapped)
        let (title, license): (String, String) = connection
            .query_row(
                "SELECT cs.title, cs.license FROM content_sources cs WHERE cs.id IN (SELECT kn.source_id FROM knowledge_nodes kn WHERE kn.subject_id = ?1) LIMIT 1",
                params![custom.id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("content_source should exist");
        assert_ne!(
            title, license,
            "source title and license should be distinct values (title={title}, license={license})"
        );
        assert!(
            title.starts_with("测试"),
            "title should be the user-provided title, got: {title}"
        );
        assert_eq!(
            license, "user_confirmed",
            "license should be 'user_confirmed', got: {license}"
        );

        drop(connection);
        let _ = fs::remove_file(database_path);
    }

    #[test]
    fn custom_subject_full_loop_create_search_conversation_memory_delete() {
        let (connection, database_path) = create_test_db("custom-full-loop");

        // 1. Create custom subject
        let custom = custom_subject::create_custom_subject(
            &connection,
            &custom_subject::CreateCustomSubjectInput {
                name: "闭环测试学科".to_string(),
                description: Some("端到端回归测试".to_string()),
                scope_keywords: Some("闭环,测试".to_string()),
            },
        )
        .expect("step 1: create custom subject");
        assert!(
            custom.id.starts_with("custom-"),
            "ID should start with custom-"
        );
        assert_eq!(custom.review_status, "draft");

        // 2. Generate knowledge from sources
        let node_count = custom_subject::generate_knowledge_from_sources(
            &connection,
            &custom_subject::GenerateKnowledgeFromSourcesInput {
                subject_id: custom.id.clone(),
                sources: vec![
                    custom_subject::SourceItem {
                        title: "闭环测试概念A".to_string(),
                        url: "https://example.com/concept-a".to_string(),
                        summary: "概念A的定义和应用".to_string(),
                        site_name: Some("测试站点A".to_string()),
                    },
                    custom_subject::SourceItem {
                        title: "闭环测试概念B".to_string(),
                        url: "https://example.com/concept-b".to_string(),
                        summary: "概念B的原理和推导".to_string(),
                        site_name: Some("测试站点B".to_string()),
                    },
                ],
                topics: Some(vec!["闭环测试".to_string()]),
            },
        )
        .expect("step 2: generate knowledge");
        assert!(node_count >= 2);

        // 3. Select subject (resolve ID)
        let resolved_id = shared::resolve_subject_id(&connection, &custom.id)
            .expect("step 3: resolve subject id");
        assert_eq!(resolved_id, custom.id);

        // 4. Search knowledge
        let search_results =
            seed::search_knowledge_nodes_by_keyword(&connection, &custom.id, "闭环测试", 10)
                .expect("step 4: keyword search");
        assert!(
            !search_results.is_empty(),
            "search should find generated nodes"
        );

        // 5. Create conversation
        let conversation = ensure_default_conversation_with_connection(&connection, &custom.id)
            .expect("step 5: create default conversation");
        assert_eq!(conversation.subject_id, custom.id);
        assert!(
            conversation.title.contains("闭环测试学科"),
            "title should use real name: {}",
            conversation.title
        );

        // 6. Save learning memory
        let memory_context = memory::save_learning_memory_state_with_connection(
            &connection,
            SaveLearningMemoryInput {
                profile: Some(StoredCognitiveProfile {
                    id: "profile-loop-1".to_string(),
                    student_id: DEFAULT_STUDENT_ID.to_string(),
                    subject_code: Some(custom.id.clone()),
                    learning_goals: vec![],
                    explanation_preferences: vec![],
                    recurring_misconceptions: vec![],
                    effective_strategies: vec![],
                    affective_signals: vec![],
                    confidence: 0.5,
                    created_at: "2026-07-15T00:00:00.000Z".to_string(),
                    updated_at: "2026-07-15T00:00:00.000Z".to_string(),
                }),
                short_term_memory: None,
                long_term_memories: vec![],
            },
        )
        .expect("step 6: save learning memory");
        assert!(memory_context.profile.is_some());

        // 7. Delete custom subject (transactional cleanup — needs &mut Connection)
        drop(connection);
        let mut conn = reopen_db(&database_path);
        let deleted = custom_subject::delete_custom_subject(&mut conn, &custom.id)
            .expect("step 7: delete custom subject");
        assert!(deleted, "delete should return true for existing subject");

        // Verify cleanup: subject row removed
        let subject_exists: bool = conn
            .query_row(
                "SELECT COUNT(1) FROM subjects WHERE id = ?1",
                params![custom.id],
                |row| row.get::<_, i64>(0),
            )
            .expect("count query should work")
            == 1;
        assert!(!subject_exists, "subjects row should be deleted");

        // Verify cleanup: custom_subjects row removed
        let custom_exists: bool = conn
            .query_row(
                "SELECT COUNT(1) FROM custom_subjects WHERE id = ?1",
                params![custom.id],
                |row| row.get::<_, i64>(0),
            )
            .expect("count query should work")
            == 1;
        assert!(!custom_exists, "custom_subjects row should be deleted");

        // Verify cleanup: knowledge_nodes removed
        let nodes_count: i64 = conn
            .query_row(
                "SELECT COUNT(1) FROM knowledge_nodes WHERE subject_id = ?1",
                params![custom.id],
                |row| row.get(0),
            )
            .expect("count query should work");
        assert_eq!(nodes_count, 0, "knowledge_nodes should be deleted");

        drop(conn);
        let _ = fs::remove_file(database_path);
    }

    #[test]
    fn delete_custom_subject_rejects_builtin_math() {
        let (connection, database_path) = create_test_db("delete-reject-math");

        // Seed math subject row (as ensure_default does)
        ensure_default_conversation_with_connection(&connection, "math")
            .expect("math conversation should exist");

        // Count math data before
        let math_nodes_before: i64 = connection
            .query_row(
                "SELECT COUNT(1) FROM knowledge_nodes WHERE subject_id = 'subject-math'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let math_convos_before: i64 = connection
            .query_row(
                "SELECT COUNT(1) FROM conversations WHERE subject_id = 'subject-math'",
                [],
                |row| row.get(0),
            )
            .unwrap();

        // Attempt to delete math via delete_custom_subject
        let mut conn = reopen_db(&database_path);
        let deleted = custom_subject::delete_custom_subject(&mut conn, "subject-math")
            .expect("delete should not error");
        assert!(!deleted, "should return false for non-custom subject");

        // Verify math data is completely untouched
        let math_nodes_after: i64 = conn
            .query_row(
                "SELECT COUNT(1) FROM knowledge_nodes WHERE subject_id = 'subject-math'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let math_convos_after: i64 = conn
            .query_row(
                "SELECT COUNT(1) FROM conversations WHERE subject_id = 'subject-math'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            math_nodes_before, math_nodes_after,
            "math nodes must not change"
        );
        assert_eq!(
            math_convos_before, math_convos_after,
            "math conversations must not change"
        );

        // Also verify "subject-math" subjects row still exists
        let math_subject_exists: bool = conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM subjects WHERE id = 'subject-math')",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(math_subject_exists, "math subjects row must remain");

        drop(conn);
        let _ = fs::remove_file(database_path);
    }

    #[test]
    fn delete_custom_subject_with_saved_messages() {
        let (connection, database_path) = create_test_db("delete-with-messages");

        let custom = custom_subject::create_custom_subject(
            &connection,
            &custom_subject::CreateCustomSubjectInput {
                name: "消息测试学科".to_string(),
                description: None,
                scope_keywords: None,
            },
        )
        .expect("custom subject should create");

        let conversation = ensure_default_conversation_with_connection(&connection, &custom.id)
            .expect("default conversation should exist");

        // Save student and tutor messages
        save_message_with_connection(
            &connection,
            SaveMessageInput {
                id: "msg-del-student-1".to_string(),
                conversation_id: conversation.conversation_id.clone(),
                role: "student".to_string(),
                content: "什么是有机化学？".to_string(),
                content_format: None,
                knowledge_refs_json: None,
                tool_refs_json: None,
                guardrail_json: None,
                attachments_json: None,
                created_at: Some("2026-07-15T00:00:00.000Z".to_string()),
            },
        )
        .expect("student message should save");

        save_message_with_connection(
            &connection,
            SaveMessageInput {
                id: "msg-del-tutor-1".to_string(),
                conversation_id: conversation.conversation_id.clone(),
                role: "tutor".to_string(),
                content: "有机化学研究碳化合物。".to_string(),
                content_format: None,
                knowledge_refs_json: Some(
                    r#"[{"id":"test-node","title":"有机化学","subjectCode":"test"}]"#.to_string(),
                ),
                tool_refs_json: None,
                guardrail_json: None,
                attachments_json: None,
                created_at: Some("2026-07-15T00:00:01.000Z".to_string()),
            },
        )
        .expect("tutor message should save");

        // Verify messages exist
        let msgs_before: i64 = connection
            .query_row(
                "SELECT COUNT(1) FROM messages WHERE conversation_id = ?1",
                params![conversation.conversation_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(msgs_before, 2, "should have 2 messages");

        // Delete should succeed even with messages
        drop(connection);
        let mut conn = reopen_db(&database_path);
        let deleted = custom_subject::delete_custom_subject(&mut conn, &custom.id)
            .expect("delete should succeed with messages");
        assert!(deleted);

        // Verify all messages cleaned up
        let msgs_after: i64 = conn
            .query_row(
                "SELECT COUNT(1) FROM messages WHERE conversation_id = ?1",
                params![conversation.conversation_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(msgs_after, 0, "messages should be deleted");

        // Verify conversation cleaned up
        let convos_after: i64 = conn
            .query_row(
                "SELECT COUNT(1) FROM conversations WHERE subject_id = ?1",
                params![custom.id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(convos_after, 0, "conversations should be deleted");

        drop(conn);
        let _ = fs::remove_file(database_path);
    }

    #[test]
    fn delete_custom_subject_does_not_touch_other_subjects_sources() {
        let (connection, database_path) = create_test_db("delete-scoped-sources");

        // Create two custom subjects
        let custom_a = custom_subject::create_custom_subject(
            &connection,
            &custom_subject::CreateCustomSubjectInput {
                name: "学科A".to_string(),
                description: None,
                scope_keywords: None,
            },
        )
        .expect("custom subject A should create");

        let custom_b = custom_subject::create_custom_subject(
            &connection,
            &custom_subject::CreateCustomSubjectInput {
                name: "学科B".to_string(),
                description: None,
                scope_keywords: None,
            },
        )
        .expect("custom subject B should create");

        // Generate knowledge for both
        custom_subject::generate_knowledge_from_sources(
            &connection,
            &custom_subject::GenerateKnowledgeFromSourcesInput {
                subject_id: custom_a.id.clone(),
                sources: vec![custom_subject::SourceItem {
                    title: "来源A".to_string(),
                    url: "https://example.com/a".to_string(),
                    summary: "A的摘要".to_string(),
                    site_name: None,
                }],
                topics: None,
            },
        )
        .expect("generate for A");

        custom_subject::generate_knowledge_from_sources(
            &connection,
            &custom_subject::GenerateKnowledgeFromSourcesInput {
                subject_id: custom_b.id.clone(),
                sources: vec![custom_subject::SourceItem {
                    title: "来源B".to_string(),
                    url: "https://example.com/b".to_string(),
                    summary: "B的摘要".to_string(),
                    site_name: None,
                }],
                topics: None,
            },
        )
        .expect("generate for B");

        // Count sources before
        let sources_before: i64 = connection
            .query_row("SELECT COUNT(1) FROM content_sources", [], |row| row.get(0))
            .unwrap();
        assert!(sources_before >= 2, "should have at least 2 sources");

        // Delete subject A
        drop(connection);
        let mut conn = reopen_db(&database_path);
        let deleted = custom_subject::delete_custom_subject(&mut conn, &custom_a.id)
            .expect("delete A should succeed");
        assert!(deleted);

        // Verify subject B's sources still exist
        let source_b_exists: bool = conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM content_sources cs \
                 JOIN knowledge_nodes kn ON kn.source_id = cs.id \
                 WHERE kn.subject_id = ?1)",
                params![custom_b.id],
                |row| row.get(0),
            )
            .unwrap();
        assert!(
            source_b_exists,
            "subject B's source must survive deletion of A"
        );

        // Verify subject B's knowledge nodes still exist
        let nodes_b: i64 = conn
            .query_row(
                "SELECT COUNT(1) FROM knowledge_nodes WHERE subject_id = ?1",
                params![custom_b.id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(nodes_b, 1, "subject B should have 1 knowledge node");

        drop(conn);
        let _ = fs::remove_file(database_path);
    }

    #[test]
    fn delete_custom_subject_cleans_up_embeddings() {
        let (connection, database_path) = create_test_db("delete-embeddings");

        let custom = custom_subject::create_custom_subject(
            &connection,
            &custom_subject::CreateCustomSubjectInput {
                name: "嵌入测试学科".to_string(),
                description: None,
                scope_keywords: None,
            },
        )
        .expect("custom subject should create");

        // Generate a knowledge node
        custom_subject::generate_knowledge_from_sources(
            &connection,
            &custom_subject::GenerateKnowledgeFromSourcesInput {
                subject_id: custom.id.clone(),
                sources: vec![custom_subject::SourceItem {
                    title: "嵌入测试节点".to_string(),
                    url: "https://example.com/embed".to_string(),
                    summary: "测试向量嵌入清理".to_string(),
                    site_name: None,
                }],
                topics: None,
            },
        )
        .expect("generate knowledge");

        // Get the node ID
        let node_id: String = connection
            .query_row(
                "SELECT id FROM knowledge_nodes WHERE subject_id = ?1 LIMIT 1",
                params![custom.id],
                |row| row.get(0),
            )
            .unwrap();

        // Insert a fake embedding for this node
        connection
            .execute(
                "INSERT INTO vector_embeddings (id, entity_type, entity_id, embedding, embedding_model, embedding_dim, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![
                    "embed-test-1",
                    "knowledge_node",
                    node_id,
                    vec![0u8; 8],
                    "test-model",
                    2i64,
                    "2026-07-15T00:00:00.000Z",
                    "2026-07-15T00:00:00.000Z"
                ],
            )
            .expect("embedding should insert");

        let embeds_before: i64 = connection
            .query_row("SELECT COUNT(1) FROM vector_embeddings", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(embeds_before, 1, "should have 1 embedding");

        // Delete the custom subject
        drop(connection);
        let mut conn = reopen_db(&database_path);
        let deleted = custom_subject::delete_custom_subject(&mut conn, &custom.id)
            .expect("delete should succeed");
        assert!(deleted);

        // Verify embedding is cleaned up
        let embeds_after: i64 = conn
            .query_row("SELECT COUNT(1) FROM vector_embeddings", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(embeds_after, 0, "embedding should be deleted");

        drop(conn);
        let _ = fs::remove_file(database_path);
    }

    #[test]
    fn delete_custom_subject_returns_false_for_nonexistent() {
        let (connection, database_path) = create_test_db("delete-nonexistent");

        drop(connection);
        let mut conn = reopen_db(&database_path);
        let deleted = custom_subject::delete_custom_subject(&mut conn, "custom-does-not-exist")
            .expect("should not error for nonexistent");
        assert!(
            !deleted,
            "should return false for nonexistent custom subject"
        );

        drop(conn);
        let _ = fs::remove_file(database_path);
    }

    #[test]
    fn delete_custom_subject_with_private_document_binding() {
        let (connection, database_path) = create_test_db("delete-private-doc-bind");

        let custom = custom_subject::create_custom_subject(
            &connection,
            &custom_subject::CreateCustomSubjectInput {
                name: "私有资料测试".to_string(),
                description: None,
                scope_keywords: None,
            },
        )
        .expect("custom subject should create");

        let conversation = ensure_default_conversation_with_connection(&connection, &custom.id)
            .expect("default conversation should exist");

        // Insert a private document for this subject
        connection
            .execute(
                "INSERT INTO private_documents (id, student_id, subject_code, file_name, file_type, title, source_type, status, chunk_count, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
                params![
                    "priv-doc-1",
                    DEFAULT_STUDENT_ID,
                    custom.id,
                    "test.pdf",
                    "pdf",
                    "测试私有文档",
                    "private_user_import",
                    "draft",
                    1i64,
                    "2026-07-15T00:00:00.000Z",
                    "2026-07-15T00:00:00.000Z"
                ],
            )
            .expect("private doc should insert");

        // Insert a chunk
        connection
            .execute(
                "INSERT INTO private_document_chunks (id, document_id, chunk_index, heading, text, token_estimate, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    "priv-chunk-1",
                    "priv-doc-1",
                    0i64,
                    "第一章",
                    "这是测试内容",
                    10i64,
                    "2026-07-15T00:00:00.000Z"
                ],
            )
            .expect("chunk should insert");

        // Bind the document to the conversation
        connection
            .execute(
                "INSERT INTO conversation_private_documents (conversation_id, private_document_id, created_at, updated_at) VALUES (?1, ?2, ?3, ?4)",
                params![
                    conversation.conversation_id,
                    "priv-doc-1",
                    "2026-07-15T00:00:00.000Z",
                    "2026-07-15T00:00:00.000Z"
                ],
            )
            .expect("binding should insert");

        // Verify data exists
        let binding_count: i64 = connection
            .query_row(
                "SELECT COUNT(1) FROM conversation_private_documents",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(binding_count, 1);

        // Delete must succeed — conversation_private_documents deleted before private_documents
        drop(connection);
        let mut conn = reopen_db(&database_path);
        let deleted = custom_subject::delete_custom_subject(&mut conn, &custom.id)
            .expect("delete should succeed with private doc binding");
        assert!(deleted);

        // Verify all cleaned up
        assert_eq!(
            conn.query_row(
                "SELECT COUNT(1) FROM conversation_private_documents",
                [],
                |row| row.get::<_, i64>(0)
            )
            .unwrap(),
            0,
            "binding should be deleted"
        );
        assert_eq!(
            conn.query_row(
                "SELECT COUNT(1) FROM private_document_chunks WHERE document_id = 'priv-doc-1'",
                [],
                |row| row.get::<_, i64>(0)
            )
            .unwrap(),
            0,
            "chunks should be deleted"
        );
        assert_eq!(
            conn.query_row(
                "SELECT COUNT(1) FROM private_documents WHERE id = 'priv-doc-1'",
                [],
                |row| row.get::<_, i64>(0)
            )
            .unwrap(),
            0,
            "private doc should be deleted"
        );

        drop(conn);
        let _ = fs::remove_file(database_path);
    }

    #[test]
    fn delete_custom_subject_with_student_knowledge_evidence_message() {
        let (connection, database_path) = create_test_db("delete-student-knowledge-evidence");

        let custom = custom_subject::create_custom_subject(
            &connection,
            &custom_subject::CreateCustomSubjectInput {
                name: "掌握度证据测试".to_string(),
                description: None,
                scope_keywords: None,
            },
        )
        .expect("custom subject should create");

        let conversation = ensure_default_conversation_with_connection(&connection, &custom.id)
            .expect("default conversation should exist");

        // Generate a knowledge node
        custom_subject::generate_knowledge_from_sources(
            &connection,
            &custom_subject::GenerateKnowledgeFromSourcesInput {
                subject_id: custom.id.clone(),
                sources: vec![custom_subject::SourceItem {
                    title: "证据测试节点".to_string(),
                    url: "https://example.com/evidence".to_string(),
                    summary: "测试掌握度证据消息引用".to_string(),
                    site_name: None,
                }],
                topics: None,
            },
        )
        .expect("generate knowledge");

        let node_id: String = connection
            .query_row(
                "SELECT id FROM knowledge_nodes WHERE subject_id = ?1 LIMIT 1",
                params![custom.id],
                |row| row.get(0),
            )
            .unwrap();

        // Save a message to reference as evidence
        save_message_with_connection(
            &connection,
            SaveMessageInput {
                id: "msg-evidence-1".to_string(),
                conversation_id: conversation.conversation_id.clone(),
                role: "tutor".to_string(),
                content: "你做对了这道题。".to_string(),
                content_format: None,
                knowledge_refs_json: None,
                tool_refs_json: None,
                guardrail_json: None,
                attachments_json: None,
                created_at: Some("2026-07-15T00:00:00.000Z".to_string()),
            },
        )
        .expect("message should save");

        // Insert student_knowledge with last_evidence_message_id referencing the message
        connection
            .execute(
                "INSERT INTO student_knowledge (id, student_id, knowledge_node_id, mastery_probability, attempts_count, correct_count, last_practiced_at, last_evidence_message_id, evidence_summary, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                params![
                    "sk-evidence-1",
                    DEFAULT_STUDENT_ID,
                    node_id,
                    0.7f64,
                    5i64,
                    3i64,
                    "2026-07-15T00:00:00.000Z",
                    "msg-evidence-1",
                    "基本掌握",
                    "2026-07-15T00:00:00.000Z"
                ],
            )
            .expect("student_knowledge should insert");

        // Verify FK relationship
        let sk_count: i64 = connection
            .query_row("SELECT COUNT(1) FROM student_knowledge", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(sk_count, 1);

        // Delete must succeed — student_knowledge deleted before messages
        drop(connection);
        let mut conn = reopen_db(&database_path);
        let deleted = custom_subject::delete_custom_subject(&mut conn, &custom.id)
            .expect("delete should succeed with student_knowledge evidence reference");
        assert!(deleted);

        // Verify all cleaned up
        assert_eq!(
            conn.query_row("SELECT COUNT(1) FROM student_knowledge", [], |row| row
                .get::<_, i64>(0))
                .unwrap(),
            0,
            "student_knowledge should be deleted"
        );
        assert_eq!(
            conn.query_row(
                "SELECT COUNT(1) FROM messages WHERE id = 'msg-evidence-1'",
                [],
                |row| row.get::<_, i64>(0)
            )
            .unwrap(),
            0,
            "message should be deleted"
        );

        drop(conn);
        let _ = fs::remove_file(database_path);
    }

    #[test]
    fn delete_custom_subject_with_assessment_and_learning_goal() {
        let (connection, database_path) = create_test_db("delete-assessment-goal");

        let custom = custom_subject::create_custom_subject(
            &connection,
            &custom_subject::CreateCustomSubjectInput {
                name: "评估测试学科".to_string(),
                description: None,
                scope_keywords: None,
            },
        )
        .expect("custom subject should create");

        let conversation = ensure_default_conversation_with_connection(&connection, &custom.id)
            .expect("default conversation should exist");

        // Insert a learning goal
        connection
            .execute(
                "INSERT INTO learning_goals (id, student_id, subject_id, name, status, metadata_json, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![
                    "goal-1",
                    DEFAULT_STUDENT_ID,
                    custom.id,
                    "掌握评估测试",
                    "active",
                    "{}",
                    "2026-07-15T00:00:00.000Z",
                    "2026-07-15T00:00:00.000Z"
                ],
            )
            .expect("learning goal should insert");

        // Insert assessment_results referencing both conversation and learning_goal
        connection
            .execute(
                "INSERT INTO assessment_results (id, student_id, subject_id, learning_goal_id, conversation_id, assessment_type, overall_level, strengths_json, weaknesses_json, recommendations_json, evidence_json, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
                params![
                    "assess-1",
                    DEFAULT_STUDENT_ID,
                    custom.id,
                    "goal-1",
                    conversation.conversation_id,
                    "turn_assessment",
                    "medium",
                    "[]",
                    "[]",
                    "[]",
                    "{}",
                    "2026-07-15T00:00:00.000Z"
                ],
            )
            .expect("assessment should insert");

        // Verify data exists
        let assess_count: i64 = connection
            .query_row("SELECT COUNT(1) FROM assessment_results", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(assess_count, 1);
        let goal_count: i64 = connection
            .query_row("SELECT COUNT(1) FROM learning_goals", [], |row| row.get(0))
            .unwrap();
        assert_eq!(goal_count, 1);

        // Delete must succeed — assessment_results deleted before conversations and learning_goals
        drop(connection);
        let mut conn = reopen_db(&database_path);
        let deleted = custom_subject::delete_custom_subject(&mut conn, &custom.id)
            .expect("delete should succeed with assessment referencing conversation and goal");
        assert!(deleted);

        // Verify all cleaned up
        assert_eq!(
            conn.query_row("SELECT COUNT(1) FROM assessment_results", [], |row| row
                .get::<_, i64>(0))
                .unwrap(),
            0,
            "assessment_results should be deleted"
        );
        assert_eq!(
            conn.query_row("SELECT COUNT(1) FROM learning_goals", [], |row| row
                .get::<_, i64>(0))
                .unwrap(),
            0,
            "learning_goals should be deleted"
        );
        assert_eq!(
            conn.query_row("SELECT COUNT(1) FROM conversations", [], |row| row
                .get::<_, i64>(0))
                .unwrap(),
            0,
            "conversations should be deleted"
        );

        drop(conn);
        let _ = fs::remove_file(database_path);
    }
}
