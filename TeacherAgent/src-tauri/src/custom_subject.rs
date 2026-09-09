use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::shared::{create_slug, current_timestamp, truncate_for_storage};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CustomSubject {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) description: Option<String>,
    pub(crate) scope_keywords: Option<String>,
    pub(crate) review_status: String,
    pub(crate) created_at: String,
    pub(crate) updated_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CreateCustomSubjectInput {
    pub(crate) name: String,
    pub(crate) description: Option<String>,
    pub(crate) scope_keywords: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GenerateKnowledgeFromSourcesInput {
    pub(crate) subject_id: String,
    pub(crate) sources: Vec<SourceItem>,
    pub(crate) topics: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SourceItem {
    pub(crate) title: String,
    pub(crate) url: String,
    pub(crate) summary: String,
    pub(crate) site_name: Option<String>,
}

/// Create a new custom subject and its corresponding entry in the subjects table.
pub(crate) fn create_custom_subject(
    connection: &Connection,
    input: &CreateCustomSubjectInput,
) -> Result<CustomSubject, String> {
    let id = format!("custom-{}", time_based_id());
    let subject_id = id.clone();
    let now = current_timestamp(connection)?;

    // Insert into subjects table
    connection
        .execute(
            "INSERT INTO subjects (id, name, code, style_key, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![subject_id, input.name, id, "rigorous_patient", now, now],
        )
        .map_err(|error| format!("failed to insert subject: {error}"))?;

    // Insert into custom_subjects table
    connection
        .execute(
            "INSERT INTO custom_subjects (id, name, description, scope_keywords, review_status, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![id, input.name, input.description, input.scope_keywords, "draft", now, now],
        )
        .map_err(|error| format!("failed to insert custom_subject: {error}"))?;

    Ok(CustomSubject {
        id,
        name: input.name.clone(),
        description: input.description.clone(),
        scope_keywords: input.scope_keywords.clone(),
        review_status: "draft".to_string(),
        created_at: now.clone(),
        updated_at: now,
    })
}

/// Generate knowledge nodes from user-confirmed web sources.
pub(crate) fn generate_knowledge_from_sources(
    connection: &Connection,
    input: &GenerateKnowledgeFromSourcesInput,
) -> Result<usize, String> {
    let subject_id = input.subject_id.trim();
    if !subject_id.starts_with("custom-") {
        return Err(
            "knowledge generation is only allowed for an existing custom subject".to_string(),
        );
    }
    let exists = connection
        .query_row(
            "SELECT 1 FROM custom_subjects WHERE id = ?1",
            [subject_id],
            |_| Ok(()),
        )
        .optional()
        .map_err(|error| format!("failed to validate custom subject: {error}"))?
        .is_some();
    if !exists {
        return Err("custom subject does not exist".to_string());
    }
    let now = current_timestamp(connection)?;
    let mut count = 0;
    let has_llm_synthesis = input.sources.iter().any(|source| {
        source.title.starts_with("AI 归纳：")
            || source
                .site_name
                .as_deref()
                .is_some_and(|site| site == "LLM synthesized from confirmed sources")
    });

    if !has_llm_synthesis {
        if let Some(topics) = &input.topics {
            for topic in topics
                .iter()
                .map(|topic| topic.trim())
                .filter(|topic| !topic.is_empty())
            {
                let topic_lower = topic.to_lowercase();
                let matching_titles = input
                    .sources
                    .iter()
                    .filter(|source| {
                        let haystack =
                            format!("{} {}", source.title, source.summary).to_lowercase();
                        haystack.contains(&topic_lower)
                    })
                    .take(4)
                    .map(|source| source.title.as_str())
                    .collect::<Vec<_>>();

                let summary = if matching_titles.is_empty() {
                    format!(
                        "围绕「{topic}」的自建学习主题。该节点由用户输入关键词创建，后续应结合已确认资料继续补充定义、核心概念、学习顺序、常见误区和练习入口。"
                    )
                } else {
                    format!(
                        "围绕「{topic}」的自建学习主题。已确认资料包括：{}。建议先梳理核心定义和适用场景，再补充前置知识、典型例题、常见误区和复盘问题。",
                        matching_titles.join("；")
                    )
                };

                let node_id = format!("custom-node-{}", time_based_id());
                connection
                    .execute(
                        "INSERT INTO knowledge_nodes (id, subject_id, title, slug, summary, level, difficulty, prerequisites_json, misconceptions_json, socratic_hints_json, source_id, license_snapshot, review_status, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
                        params![
                            node_id,
                            input.subject_id,
                            topic,
                            create_slug(topic),
                            truncate_for_storage(&summary, 500),
                            "concept",
                            1,
                            "[]",
                            "[]",
                            "[]",
                            Option::<String>::None,
                            "generated_from_user_confirmed_sources",
                            "draft",
                            now,
                            now
                        ],
                    )
                    .map_err(|error| format!("failed to insert topic knowledge_node: {error}"))?;

                count += 1;
            }
        }
    }

    for source in input.sources.iter() {
        // Create content_source entry
        let source_id = format!("custom-src-{}", time_based_id());
        connection
            .execute(
                "INSERT INTO content_sources (id, title, url, source_type, license, attribution_required, commercial_use_allowed, derivative_allowed, share_alike_required, notes, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
                params![
                    source_id,
                    source.title,
                    source.url,
                    "custom_web_source",
                    "user_confirmed",
                    1,
                    0,
                    1,
                    0,
                    format!("Bocha search result, confirmed by user"),
                    now,
                    now
                ],
            )
            .map_err(|error| format!("failed to insert content_source: {error}"))?;

        // Create knowledge_node from source
        let node_id = format!("custom-node-{}", time_based_id());
        let summary = truncate_for_storage(&source.summary, 500);

        connection
            .execute(
                "INSERT INTO knowledge_nodes (id, subject_id, title, slug, summary, level, difficulty, prerequisites_json, misconceptions_json, socratic_hints_json, source_id, license_snapshot, review_status, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
                params![
                    node_id,
                    input.subject_id,
                    source.title,
                    create_slug(&source.title),
                    summary,
                    "concept",
                    1,
                    "[]",
                    "[]",
                    "[]",
                    source_id,
                    "user_confirmed",
                    "draft",
                    now,
                    now
                ],
            )
            .map_err(|error| format!("failed to insert knowledge_node: {error}"))?;

        count += 1;
    }

    Ok(count)
}

/// List all custom subjects.
pub(crate) fn list_custom_subjects(connection: &Connection) -> Result<Vec<CustomSubject>, String> {
    let mut statement = connection
        .prepare("SELECT id, name, description, scope_keywords, review_status, created_at, updated_at FROM custom_subjects ORDER BY created_at DESC")
        .map_err(|error| format!("failed to prepare list_custom_subjects: {error}"))?;

    let rows = statement
        .query_map([], |row| {
            Ok(CustomSubject {
                id: row.get(0)?,
                name: row.get(1)?,
                description: row.get(2)?,
                scope_keywords: row.get(3)?,
                review_status: row.get(4)?,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
            })
        })
        .map_err(|error| format!("failed to query custom_subjects: {error}"))?;

    let mut subjects = Vec::new();
    for row in rows {
        subjects.push(row.map_err(|error| format!("failed to read custom_subject row: {error}"))?);
    }

    Ok(subjects)
}

/// Delete a custom subject and its associated data (transactional).
/// Verifies the target is actually a custom subject before any cleanup.
pub(crate) fn delete_custom_subject(
    connection: &mut Connection,
    subject_id: &str,
) -> Result<bool, String> {
    // 1. Verify target exists in custom_subjects table — reject built-in subjects
    let exists: bool = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM custom_subjects WHERE id = ?1)",
            params![subject_id],
            |row| row.get(0),
        )
        .map_err(|error| format!("failed to verify custom subject: {error}"))?;
    if !exists {
        return Ok(false);
    }

    let tx = connection
        .transaction()
        .map_err(|error| format!("failed to begin transaction: {error}"))?;

    // 2. Collect IDs for scoped cleanup of non-FK data
    let node_ids = collect_ids(
        &tx,
        "SELECT id FROM knowledge_nodes WHERE subject_id = ?1",
        subject_id,
    )?;
    let question_ids = collect_ids(
        &tx,
        "SELECT id FROM questions WHERE subject_id = ?1",
        subject_id,
    )?;

    // Collect source IDs owned by this subject's nodes and questions
    let mut owned_source_ids: Vec<String> = Vec::new();
    if !node_ids.is_empty() {
        owned_source_ids.extend(collect_ids(
            &tx,
            "SELECT DISTINCT source_id FROM knowledge_nodes WHERE subject_id = ?1 AND source_id IS NOT NULL",
            subject_id,
        )?);
    }
    if !question_ids.is_empty() {
        owned_source_ids.extend(collect_ids(
            &tx,
            "SELECT DISTINCT source_id FROM questions WHERE subject_id = ?1 AND source_id IS NOT NULL",
            subject_id,
        )?);
    }

    // 3. Delete in strict FK dependency order
    //
    // Dependency graph (A → B means "delete A before B"):
    //   conversation_private_documents → private_documents, conversations
    //   private_document_chunks → private_documents
    //   messages → conversations
    //   student_knowledge.last_evidence_message_id → messages
    //   assessment_results → conversations, learning_goals
    //   reflection_records → conversations
    //   short_term_memories → conversations
    //   conversations → subjects
    //   learning_goals → subjects
    //   questions → content_sources
    //   knowledge_nodes → content_sources
    //   knowledge_edges → knowledge_nodes, subjects

    // 3a. Non-FK data: vector embeddings for this subject's nodes and questions
    for entity_id in &node_ids {
        tx.execute(
            "DELETE FROM vector_embeddings WHERE entity_type = 'knowledge_node' AND entity_id = ?1",
            params![entity_id],
        )
        .map_err(|error| format!("failed to delete node embedding: {error}"))?;
    }
    for entity_id in &question_ids {
        tx.execute(
            "DELETE FROM vector_embeddings WHERE entity_type = 'question' AND entity_id = ?1",
            params![entity_id],
        )
        .map_err(|error| format!("failed to delete question embedding: {error}"))?;
    }

    // 3b. conversation_private_documents (FK to conversations + private_documents)
    //     Must be deleted BEFORE both private_documents and conversations.
    tx.execute(
        "DELETE FROM conversation_private_documents WHERE conversation_id IN (SELECT id FROM conversations WHERE subject_id = ?1)",
        params![subject_id],
    )
    .map_err(|error| format!("failed to delete conversation_private_documents: {error}"))?;

    // 3c. private_document_chunks (FK to private_documents)
    let private_doc_ids = collect_ids(
        &tx,
        "SELECT id FROM private_documents WHERE subject_code = ?1",
        subject_id,
    )?;
    for doc_id in &private_doc_ids {
        tx.execute(
            "DELETE FROM private_document_chunks WHERE document_id = ?1",
            params![doc_id],
        )
        .map_err(|error| format!("failed to delete private doc chunks: {error}"))?;
    }

    // 3d. private_documents (safe now — conversation_private_documents and chunks removed)
    if !private_doc_ids.is_empty() {
        tx.execute(
            "DELETE FROM private_documents WHERE subject_code = ?1",
            params![subject_id],
        )
        .map_err(|error| format!("failed to delete private_documents: {error}"))?;
    }

    // 3e. student_knowledge (FK to messages via last_evidence_message_id)
    //     Must be deleted BEFORE messages.
    tx.execute(
        "DELETE FROM student_knowledge WHERE knowledge_node_id IN (SELECT id FROM knowledge_nodes WHERE subject_id = ?1)",
        params![subject_id],
    )
    .map_err(|error| format!("failed to delete student_knowledge: {error}"))?;

    // 3f. assessment_results (FK to conversations + learning_goals)
    //     Must be deleted BEFORE conversations and learning_goals.
    tx.execute(
        "DELETE FROM assessment_results WHERE subject_id = ?1",
        params![subject_id],
    )
    .map_err(|error| format!("failed to delete assessment_results: {error}"))?;

    // 3g. messages (FK to conversations) — safe now, student_knowledge removed
    tx.execute(
        "DELETE FROM messages WHERE conversation_id IN (SELECT id FROM conversations WHERE subject_id = ?1)",
        params![subject_id],
    )
    .map_err(|error| format!("failed to delete messages: {error}"))?;

    // 3h. reflection_records (FK to conversations)
    tx.execute(
        "DELETE FROM reflection_records WHERE conversation_id IN (SELECT id FROM conversations WHERE subject_id = ?1)",
        params![subject_id],
    )
    .map_err(|error| format!("failed to delete reflection_records: {error}"))?;

    // 3i. short_term_memories (FK to conversations)
    tx.execute(
        "DELETE FROM short_term_memories WHERE conversation_id IN (SELECT id FROM conversations WHERE subject_id = ?1)",
        params![subject_id],
    )
    .map_err(|error| format!("failed to delete short_term_memories: {error}"))?;

    // 3j. conversations (FK to subjects) — safe now, all children removed
    tx.execute(
        "DELETE FROM conversations WHERE subject_id = ?1",
        params![subject_id],
    )
    .map_err(|error| format!("failed to delete conversations: {error}"))?;

    // 3k. learning_goals (FK to subjects) — safe now, assessment_results and conversations removed
    tx.execute(
        "DELETE FROM learning_goals WHERE subject_id = ?1",
        params![subject_id],
    )
    .map_err(|error| format!("failed to delete learning_goals: {error}"))?;

    // 3l. Remaining tables with direct FK to subjects.id
    for table in &[
        "student_cognitive_profiles",
        "long_term_memories",
        "knowledge_edges",
    ] {
        tx.execute(
            &format!("DELETE FROM {table} WHERE subject_id = ?1"),
            params![subject_id],
        )
        .map_err(|error| format!("failed to delete from {table}: {error}"))?;
    }

    // 3m. questions (FK to content_sources) — must delete before content_sources
    tx.execute(
        "DELETE FROM questions WHERE subject_id = ?1",
        params![subject_id],
    )
    .map_err(|error| format!("failed to delete questions: {error}"))?;

    // 3n. knowledge_nodes (FK to content_sources) — must delete before content_sources
    tx.execute(
        "DELETE FROM knowledge_nodes WHERE subject_id = ?1",
        params![subject_id],
    )
    .map_err(|error| format!("failed to delete knowledge_nodes: {error}"))?;

    // 3o. Scoped content_sources cleanup — only sources owned by this subject,
    //     and only if no other table still references them
    for source_id in &owned_source_ids {
        tx.execute(
            "DELETE FROM content_sources WHERE id = ?1
               AND NOT EXISTS (SELECT 1 FROM knowledge_nodes WHERE source_id = ?1)
               AND NOT EXISTS (SELECT 1 FROM questions WHERE source_id = ?1)",
            params![source_id],
        )
        .map_err(|error| format!("failed to delete content_source {source_id}: {error}"))?;
    }

    // 3p. custom_subjects record
    tx.execute(
        "DELETE FROM custom_subjects WHERE id = ?1",
        params![subject_id],
    )
    .map_err(|error| format!("failed to delete custom_subject: {error}"))?;

    // 3q. subjects record
    let deleted = tx
        .execute("DELETE FROM subjects WHERE id = ?1", params![subject_id])
        .map_err(|error| format!("failed to delete subject: {error}"))?;

    tx.commit()
        .map_err(|error| format!("failed to commit transaction: {error}"))?;

    Ok(deleted > 0)
}

// ── Helpers ──────────────────────────────────────────────────────────

/// Collect a single column of String values from a query.
fn collect_ids(
    tx: &rusqlite::Transaction<'_>,
    sql: &str,
    param: &str,
) -> Result<Vec<String>, String> {
    let mut stmt = tx
        .prepare(sql)
        .map_err(|error| format!("failed to prepare query: {error}"))?;
    let rows = stmt
        .query_map(params![param], |row| row.get(0))
        .map_err(|error| format!("failed to execute query: {error}"))?;
    let mut values = Vec::new();
    for row in rows {
        values.push(row.map_err(|error| format!("failed to read id row: {error}"))?);
    }
    Ok(values)
}

/// Generate a time-based unique ID. Not a standard UUID v7 — uses millis + rand
/// for uniqueness only.
fn time_based_id() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let millis = duration.as_millis() as u64;
    let rand: u32 = rand::random();
    format!("{:012x}-{:08x}", millis, rand)
}
