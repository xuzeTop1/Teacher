use rusqlite::{params, Connection, OptionalExtension};

use crate::conversation::ensure_default_conversation_with_connection;
use crate::models::*;
use crate::shared::resolve_subject_id;
use crate::{normalize_subject_code, subject_code_from_subject_id};

pub(crate) fn load_learning_memory_context_with_connection(
    connection: &Connection,
    student_id: &str,
    conversation_id: &str,
    subject_code: &str,
) -> Result<LearningMemoryContext, String> {
    let subject_id = resolve_subject_id(connection, subject_code)?;
    let normalized_subject = normalize_subject_code(subject_code)?;
    let profile = load_cognitive_profile(connection, student_id, &subject_id)?;
    let short_term_memory = load_short_term_memory(connection, conversation_id)?;
    let long_term_memories =
        load_long_term_memories(connection, student_id, &normalized_subject, 12)?;

    Ok(LearningMemoryContext {
        profile,
        short_term_memory,
        long_term_memories,
    })
}

pub(crate) fn save_learning_memory_state_with_connection(
    connection: &Connection,
    input: SaveLearningMemoryInput,
) -> Result<LearningMemoryContext, String> {
    let mut context_key: Option<(String, String, String)> = None;

    if let Some(profile) = input.profile {
        let subject_code = profile
            .subject_code
            .clone()
            .unwrap_or_else(|| "math".to_string());
        let subject_id = resolve_subject_id(connection, &subject_code)?;
        ensure_default_conversation_with_connection(connection, &subject_code)?;
        upsert_cognitive_profile(connection, &profile, &subject_id)?;
        context_key = Some((profile.student_id.clone(), "".to_string(), subject_code));
    }

    if let Some(short_term_memory) = input.short_term_memory {
        let subject_code = short_term_memory
            .subject_code
            .clone()
            .unwrap_or_else(|| "math".to_string());
        let subject_id = resolve_subject_id(connection, &subject_code)?;
        ensure_default_conversation_with_connection(connection, &subject_code)?;
        upsert_short_term_memory(connection, &short_term_memory, &subject_id)?;
        context_key = Some((
            short_term_memory.student_id.clone(),
            short_term_memory.conversation_id.clone(),
            subject_code,
        ));
    }

    for memory in input.long_term_memories {
        let subject_code = memory
            .subject_code
            .clone()
            .unwrap_or_else(|| "math".to_string());
        let subject_id = resolve_subject_id(connection, &subject_code)?;
        ensure_default_conversation_with_connection(connection, &subject_code)?;
        upsert_long_term_memory(connection, &memory, &subject_id)?;
        if context_key.is_none() {
            context_key = Some((memory.student_id.clone(), "".to_string(), subject_code));
        }
    }

    let (student_id, conversation_id, subject_code) =
        context_key.ok_or_else(|| "no learning memory payload was provided".to_string())?;
    load_learning_memory_context_with_connection(
        connection,
        &student_id,
        &conversation_id,
        &subject_code,
    )
}

fn load_cognitive_profile(
    connection: &Connection,
    student_id: &str,
    subject_id: &str,
) -> Result<Option<StoredCognitiveProfile>, String> {
    connection
        .query_row(
            "SELECT id, student_id, subject_id, learning_goals_json,
                    explanation_preferences_json, recurring_misconceptions_json,
                    effective_strategies_json, affective_signals_json,
                    confidence, created_at, updated_at
             FROM student_cognitive_profiles
             WHERE student_id = ?1 AND subject_id = ?2 AND deleted_at IS NULL",
            params![student_id, subject_id],
            row_to_cognitive_profile,
        )
        .optional()
        .map_err(|error| format!("failed to load cognitive profile: {error}"))
}

fn load_short_term_memory(
    connection: &Connection,
    conversation_id: &str,
) -> Result<Option<StoredShortTermMemory>, String> {
    connection
        .query_row(
            "SELECT id, conversation_id, student_id, subject_id, summary, recent_focus_json,
                    open_questions_json, last_misconceptions_json, last_mode, turn_count,
                    created_at, updated_at
             FROM short_term_memories
             WHERE conversation_id = ?1",
            [conversation_id],
            row_to_short_term_memory,
        )
        .optional()
        .map_err(|error| format!("failed to load short-term memory: {error}"))
}

fn load_long_term_memories(
    connection: &Connection,
    student_id: &str,
    subject_code: &str,
    limit: i64,
) -> Result<Vec<StoredLongTermMemory>, String> {
    let subject_id = resolve_subject_id(connection, subject_code)?;
    let bounded_limit = limit.clamp(1, 100);
    let mut statement = connection
        .prepare(
            "SELECT id, student_id, subject_id, memory_kind, summary, evidence,
                    confidence, source, created_at, updated_at
             FROM long_term_memories
             WHERE student_id = ?1
               AND (subject_id IS NULL OR subject_id = ?2)
               AND deleted_at IS NULL
             ORDER BY updated_at DESC, rowid DESC
             LIMIT ?3",
        )
        .map_err(|error| format!("failed to prepare long-term memory query: {error}"))?;
    let rows = statement
        .query_map(
            params![student_id, subject_id, bounded_limit],
            row_to_long_term_memory,
        )
        .map_err(|error| format!("failed to query long-term memories: {error}"))?;
    let mut memories = Vec::new();

    for row in rows {
        memories
            .push(row.map_err(|error| format!("failed to read long-term memory row: {error}"))?);
    }

    Ok(memories)
}

fn upsert_cognitive_profile(
    connection: &Connection,
    profile: &StoredCognitiveProfile,
    subject_id: &str,
) -> Result<(), String> {
    connection
        .execute(
            "INSERT INTO student_cognitive_profiles (
               id, student_id, subject_id, learning_goals_json, explanation_preferences_json,
               recurring_misconceptions_json, effective_strategies_json, affective_signals_json,
               confidence, created_at, updated_at
             )
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
             ON CONFLICT(student_id, subject_id) DO UPDATE SET
               learning_goals_json = excluded.learning_goals_json,
               explanation_preferences_json = excluded.explanation_preferences_json,
               recurring_misconceptions_json = excluded.recurring_misconceptions_json,
               effective_strategies_json = excluded.effective_strategies_json,
               affective_signals_json = excluded.affective_signals_json,
               confidence = excluded.confidence,
               updated_at = excluded.updated_at,
               deleted_at = NULL",
            params![
                &profile.id,
                &profile.student_id,
                subject_id,
                to_json(&profile.learning_goals)?,
                to_json(&profile.explanation_preferences)?,
                to_json(&profile.recurring_misconceptions)?,
                to_json(&profile.effective_strategies)?,
                to_json(&profile.affective_signals)?,
                profile.confidence,
                &profile.created_at,
                &profile.updated_at
            ],
        )
        .map_err(|error| format!("failed to upsert cognitive profile: {error}"))?;

    Ok(())
}

fn upsert_short_term_memory(
    connection: &Connection,
    memory: &StoredShortTermMemory,
    subject_id: &str,
) -> Result<(), String> {
    connection
        .execute(
            "INSERT INTO short_term_memories (
               id, conversation_id, student_id, subject_id, summary, recent_focus_json,
               open_questions_json, last_misconceptions_json, last_mode, turn_count,
               created_at, updated_at
             )
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
             ON CONFLICT(conversation_id) DO UPDATE SET
               summary = excluded.summary,
               recent_focus_json = excluded.recent_focus_json,
               open_questions_json = excluded.open_questions_json,
               last_misconceptions_json = excluded.last_misconceptions_json,
               last_mode = excluded.last_mode,
               turn_count = excluded.turn_count,
               updated_at = excluded.updated_at",
            params![
                &memory.id,
                &memory.conversation_id,
                &memory.student_id,
                subject_id,
                &memory.summary,
                to_json(&memory.recent_focus)?,
                to_json(&memory.open_questions)?,
                to_json(&memory.last_misconceptions)?,
                memory.last_mode.as_deref(),
                memory.turn_count,
                &memory.created_at,
                &memory.updated_at
            ],
        )
        .map_err(|error| format!("failed to upsert short-term memory: {error}"))?;

    Ok(())
}

fn upsert_long_term_memory(
    connection: &Connection,
    memory: &StoredLongTermMemory,
    subject_id: &str,
) -> Result<(), String> {
    connection
        .execute(
            "INSERT INTO long_term_memories (
               id, student_id, subject_id, memory_kind, summary, evidence, confidence,
               source, created_at, updated_at
             )
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
             ON CONFLICT(id) DO UPDATE SET
               summary = excluded.summary,
               evidence = excluded.evidence,
               confidence = excluded.confidence,
               source = excluded.source,
               updated_at = excluded.updated_at,
               deleted_at = NULL",
            params![
                &memory.id,
                &memory.student_id,
                subject_id,
                &memory.kind,
                &memory.summary,
                &memory.evidence,
                memory.confidence,
                &memory.source,
                &memory.created_at,
                &memory.updated_at
            ],
        )
        .map_err(|error| format!("failed to upsert long-term memory: {error}"))?;

    Ok(())
}

fn row_to_cognitive_profile(row: &rusqlite::Row<'_>) -> rusqlite::Result<StoredCognitiveProfile> {
    let subject_id: Option<String> = row.get(2)?;

    Ok(StoredCognitiveProfile {
        id: row.get(0)?,
        student_id: row.get(1)?,
        subject_code: subject_id.as_deref().and_then(subject_code_from_subject_id),
        learning_goals: parse_json_array(row.get::<_, String>(3)?),
        explanation_preferences: parse_json_array(row.get::<_, String>(4)?),
        recurring_misconceptions: parse_json_array(row.get::<_, String>(5)?),
        effective_strategies: parse_json_array(row.get::<_, String>(6)?),
        affective_signals: parse_json_array(row.get::<_, String>(7)?),
        confidence: row.get(8)?,
        created_at: row.get(9)?,
        updated_at: row.get(10)?,
    })
}

fn row_to_short_term_memory(row: &rusqlite::Row<'_>) -> rusqlite::Result<StoredShortTermMemory> {
    let subject_id: Option<String> = row.get(3)?;

    Ok(StoredShortTermMemory {
        id: row.get(0)?,
        conversation_id: row.get(1)?,
        student_id: row.get(2)?,
        subject_code: subject_id.as_deref().and_then(subject_code_from_subject_id),
        summary: row.get(4)?,
        recent_focus: parse_json_array(row.get::<_, String>(5)?),
        open_questions: parse_json_array(row.get::<_, String>(6)?),
        last_misconceptions: parse_json_array(row.get::<_, String>(7)?),
        last_mode: row.get(8)?,
        turn_count: row.get(9)?,
        created_at: row.get(10)?,
        updated_at: row.get(11)?,
    })
}

fn row_to_long_term_memory(row: &rusqlite::Row<'_>) -> rusqlite::Result<StoredLongTermMemory> {
    let subject_id: Option<String> = row.get(2)?;

    Ok(StoredLongTermMemory {
        id: row.get(0)?,
        student_id: row.get(1)?,
        subject_code: subject_id.as_deref().and_then(subject_code_from_subject_id),
        kind: row.get(3)?,
        summary: row.get(4)?,
        evidence: row.get(5)?,
        confidence: row.get(6)?,
        source: row.get(7)?,
        created_at: row.get(8)?,
        updated_at: row.get(9)?,
    })
}

fn to_json(values: &[String]) -> Result<String, String> {
    serde_json::to_string(values).map_err(|error| format!("failed to encode JSON array: {error}"))
}

fn parse_json_array(raw: String) -> Vec<String> {
    serde_json::from_str::<Vec<String>>(&raw).unwrap_or_default()
}
