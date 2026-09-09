use rusqlite::{params, Connection, OptionalExtension};
use serde::Deserialize;
use std::collections::HashSet;

use crate::conversation::ensure_default_conversation_with_connection;
use crate::models::*;
use crate::{create_slug, current_timestamp, truncate_for_storage, validate_json_object_or_array};

pub(crate) fn save_reflection_record_with_connection(
    connection: &Connection,
    input: SaveReflectionRecordInput,
) -> Result<StoredReflectionRecord, String> {
    validate_json_object_or_array(&input.knowledge_updates_json, "knowledge_updates_json")?;
    validate_json_object_or_array(&input.misconceptions_json, "misconceptions_json")?;
    validate_json_object_or_array(&input.strategy_insights_json, "strategy_insights_json")?;
    validate_json_object_or_array(&input.next_best_action_json, "next_best_action_json")?;

    let created_at = input
        .created_at
        .unwrap_or_else(|| current_timestamp(connection).unwrap_or_else(|_| "unknown".to_string()));

    connection
        .execute(
            "INSERT INTO reflection_records (
               id, conversation_id, student_id, summary, knowledge_updates_json,
               misconceptions_json, strategy_insights_json, next_best_action_json,
               confidence, created_at
             )
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
             ON CONFLICT(id) DO UPDATE SET
               summary = excluded.summary,
               knowledge_updates_json = excluded.knowledge_updates_json,
               misconceptions_json = excluded.misconceptions_json,
               strategy_insights_json = excluded.strategy_insights_json,
               next_best_action_json = excluded.next_best_action_json,
               confidence = excluded.confidence",
            params![
                &input.id,
                &input.conversation_id,
                &input.student_id,
                &input.summary,
                &input.knowledge_updates_json,
                &input.misconceptions_json,
                &input.strategy_insights_json,
                &input.next_best_action_json,
                input.confidence,
                &created_at
            ],
        )
        .map_err(|error| format!("failed to save reflection record: {error}"))?;

    load_reflection_record(connection, &input.id)?
        .ok_or_else(|| "saved reflection record could not be loaded".to_string())
}

fn load_reflection_record(
    connection: &Connection,
    reflection_id: &str,
) -> Result<Option<StoredReflectionRecord>, String> {
    connection
        .query_row(
            "SELECT id, conversation_id, student_id, summary, confidence, created_at
             FROM reflection_records
             WHERE id = ?1",
            [reflection_id],
            |row| {
                Ok(StoredReflectionRecord {
                    id: row.get(0)?,
                    conversation_id: row.get(1)?,
                    student_id: row.get(2)?,
                    summary: row.get(3)?,
                    confidence: row.get(4)?,
                    created_at: row.get(5)?,
                })
            },
        )
        .optional()
        .map_err(|error| format!("failed to load reflection record: {error}"))
}

pub(crate) fn save_assessment_result_with_connection(
    connection: &Connection,
    input: SaveAssessmentResultInput,
) -> Result<StoredAssessmentResult, String> {
    validate_json_object_or_array(&input.strengths_json, "strengths_json")?;
    validate_json_object_or_array(&input.weaknesses_json, "weaknesses_json")?;
    validate_json_object_or_array(&input.recommendations_json, "recommendations_json")?;
    validate_json_object_or_array(&input.evidence_json, "evidence_json")?;

    let assessment_type = input.assessment_type.trim();
    let overall_level = input.overall_level.trim();

    if assessment_type.is_empty() {
        return Err("assessment_type cannot be empty".to_string());
    }
    if overall_level.is_empty() {
        return Err("overall_level cannot be empty".to_string());
    }

    let conversation =
        ensure_default_conversation_with_connection(connection, &input.subject_code)?;
    let subject_id = conversation.subject_id;
    let created_at = input
        .created_at
        .unwrap_or_else(|| current_timestamp(connection).unwrap_or_else(|_| "unknown".to_string()));

    // Idempotency: check if this assessment ID already exists before inserting.
    // Knowledge updates should only be applied once per assessment ID.
    let already_exists = assessment_exists(connection, &input.id)?;

    connection
        .execute(
            "INSERT INTO assessment_results (
               id, student_id, subject_id, learning_goal_id, conversation_id,
               assessment_type, overall_level, strengths_json, weaknesses_json,
               recommendations_json, evidence_json, created_at
             )
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
             ON CONFLICT(id) DO UPDATE SET
               learning_goal_id = excluded.learning_goal_id,
               conversation_id = excluded.conversation_id,
               assessment_type = excluded.assessment_type,
               overall_level = excluded.overall_level,
               strengths_json = excluded.strengths_json,
               weaknesses_json = excluded.weaknesses_json,
               recommendations_json = excluded.recommendations_json,
               evidence_json = excluded.evidence_json",
            params![
                &input.id,
                &input.student_id,
                &subject_id,
                input.learning_goal_id.as_deref(),
                input.conversation_id.as_deref(),
                assessment_type,
                overall_level,
                &input.strengths_json,
                &input.weaknesses_json,
                &input.recommendations_json,
                &input.evidence_json,
                &created_at
            ],
        )
        .map_err(|error| format!("failed to save assessment result: {error}"))?;

    // Only apply knowledge updates for NEW assessments (not re-saves of the same ID).
    if !already_exists {
        apply_assessment_knowledge_updates(
            connection,
            &input.student_id,
            &subject_id,
            &input.evidence_json,
            &created_at,
        )?;
    }

    load_assessment_result(connection, &input.id)?
        .ok_or_else(|| "saved assessment result could not be loaded".to_string())
}

fn load_assessment_result(
    connection: &Connection,
    assessment_id: &str,
) -> Result<Option<StoredAssessmentResult>, String> {
    connection
        .query_row(
            "SELECT id, student_id, subject_id, conversation_id,
                    assessment_type, overall_level, created_at
             FROM assessment_results
             WHERE id = ?1",
            [assessment_id],
            |row| {
                Ok(StoredAssessmentResult {
                    id: row.get(0)?,
                    student_id: row.get(1)?,
                    subject_id: row.get(2)?,
                    conversation_id: row.get(3)?,
                    assessment_type: row.get(4)?,
                    overall_level: row.get(5)?,
                    created_at: row.get(6)?,
                })
            },
        )
        .optional()
        .map_err(|error| format!("failed to load assessment result: {error}"))
}

fn apply_assessment_knowledge_updates(
    connection: &Connection,
    student_id: &str,
    subject_id: &str,
    evidence_json: &str,
    updated_at: &str,
) -> Result<(), String> {
    let evidence = serde_json::from_str::<AssessmentEvidencePayload>(evidence_json)
        .map_err(|error| format!("failed to parse assessment evidence_json: {error}"))?;

    for snapshot in &evidence.knowledge_snapshots {
        if is_private_knowledge_id(&snapshot.id)
            || snapshot.source_type.as_deref() == Some("private_document")
        {
            continue;
        }
        upsert_knowledge_node_snapshot(connection, subject_id, snapshot, updated_at)?;
    }

    // Use top-level correctness as fallback when per-update correctness is missing.
    let fallback_correctness = evidence.correctness.as_deref();
    for update in &evidence.knowledge_updates {
        if is_private_knowledge_id(&update.knowledge_node_id) {
            continue;
        }
        let effective_update = AssessmentKnowledgeUpdatePayload {
            correctness: update
                .correctness
                .clone()
                .or_else(|| fallback_correctness.map(|s| s.to_string())),
            ..update.clone()
        };
        upsert_student_knowledge_from_assessment(
            connection,
            student_id,
            &effective_update,
            updated_at,
        )?;
    }

    Ok(())
}

fn is_private_knowledge_id(value: &str) -> bool {
    value.trim_start().starts_with("private:")
}

fn upsert_knowledge_node_snapshot(
    connection: &Connection,
    subject_id: &str,
    snapshot: &AssessmentKnowledgeSnapshotPayload,
    updated_at: &str,
) -> Result<(), String> {
    let id = snapshot.id.trim();
    let title = snapshot.title.trim();

    if id.is_empty() || title.is_empty() {
        return Ok(());
    }

    let summary = snapshot
        .summary
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(title);

    connection
        .execute(
            "INSERT INTO knowledge_nodes (
               id, subject_id, title, slug, summary, level, difficulty,
               prerequisites_json, misconceptions_json, socratic_hints_json,
               source_id, license_snapshot, review_status, created_at, updated_at
             )
             VALUES (?1, ?2, ?3, ?4, ?5, 'concept', 1, '[]', ?6, ?7,
                     NULL, NULL, 'draft', ?8, ?8)
             ON CONFLICT(id) DO UPDATE SET
               title = CASE WHEN knowledge_nodes.review_status = 'approved' THEN knowledge_nodes.title ELSE excluded.title END,
               summary = CASE WHEN knowledge_nodes.review_status = 'approved' THEN knowledge_nodes.summary ELSE excluded.summary END,
               misconceptions_json = CASE WHEN knowledge_nodes.review_status = 'approved' THEN knowledge_nodes.misconceptions_json ELSE excluded.misconceptions_json END,
               socratic_hints_json = CASE WHEN knowledge_nodes.review_status = 'approved' THEN knowledge_nodes.socratic_hints_json ELSE excluded.socratic_hints_json END,
               updated_at = CASE WHEN knowledge_nodes.review_status = 'approved' THEN knowledge_nodes.updated_at ELSE excluded.updated_at END",
            params![
                id,
                subject_id,
                truncate_for_storage(title, 160),
                create_slug(id),
                truncate_for_storage(summary, 800),
                serde_json::to_string(&snapshot.misconceptions).map_err(|error| format!(
                    "failed to encode knowledge node misconceptions: {error}"
                ))?,
                serde_json::to_string(&snapshot.socratic_hints)
                    .map_err(|error| format!("failed to encode knowledge node hints: {error}"))?,
                updated_at
            ],
        )
        .map_err(|error| format!("failed to upsert assessment knowledge node: {error}"))?;

    Ok(())
}

fn upsert_student_knowledge_from_assessment(
    connection: &Connection,
    student_id: &str,
    update: &AssessmentKnowledgeUpdatePayload,
    updated_at: &str,
) -> Result<(), String> {
    let knowledge_node_id = update.knowledge_node_id.trim();

    if knowledge_node_id.is_empty() || !knowledge_node_exists(connection, knowledge_node_id)? {
        return Ok(());
    }

    let existing = connection
        .query_row(
            "SELECT mastery_probability, attempts_count, correct_count
             FROM student_knowledge
             WHERE student_id = ?1 AND knowledge_node_id = ?2",
            params![student_id, knowledge_node_id],
            |row| {
                Ok((
                    row.get::<_, f64>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, i64>(2)?,
                ))
            },
        )
        .optional()
        .map_err(|error| format!("failed to load student knowledge: {error}"))?;
    let (previous_mastery, attempts_count, correct_count) = existing.unwrap_or((0.5, 0, 0));
    let next_mastery = clamp_probability(previous_mastery + update.mastery_delta);

    // Use correctness to determine attempt and correct counts.
    // - "correct": attempt+1, correct+1
    // - "partially_correct": attempt+1, correct unchanged
    // - "incorrect": attempt+1, correct unchanged
    // - "unknown" / anything else: no change (should not reach here, but guard defensively)
    let correctness = update.correctness.as_deref().unwrap_or("unknown");
    let (next_attempts, next_correct) = match correctness {
        "correct" => (attempts_count + 1, correct_count + 1),
        "partially_correct" | "incorrect" => (attempts_count + 1, correct_count),
        _ => (attempts_count, correct_count),
    };

    let evidence_summary = truncate_for_storage(
        update
            .reason
            .as_deref()
            .unwrap_or("AssessmentAgent updated mastery from this tutor turn."),
        240,
    );
    let id = create_student_knowledge_id(student_id, knowledge_node_id);

    connection
        .execute(
            "INSERT INTO student_knowledge (
               id, student_id, knowledge_node_id, mastery_probability,
               attempts_count, correct_count, last_practiced_at,
               last_evidence_message_id, evidence_summary, updated_at
             )
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL, ?8, ?7)
             ON CONFLICT(student_id, knowledge_node_id) DO UPDATE SET
               mastery_probability = excluded.mastery_probability,
               attempts_count = excluded.attempts_count,
               correct_count = excluded.correct_count,
               last_practiced_at = excluded.last_practiced_at,
               evidence_summary = excluded.evidence_summary,
               updated_at = excluded.updated_at",
            params![
                id,
                student_id,
                knowledge_node_id,
                next_mastery,
                next_attempts,
                next_correct,
                updated_at,
                evidence_summary
            ],
        )
        .map_err(|error| format!("failed to upsert student knowledge: {error}"))?;

    Ok(())
}

fn assessment_exists(connection: &Connection, assessment_id: &str) -> Result<bool, String> {
    let count: i64 = connection
        .query_row(
            "SELECT COUNT(1) FROM assessment_results WHERE id = ?1",
            [assessment_id],
            |row| row.get(0),
        )
        .map_err(|error| format!("failed to inspect assessment: {error}"))?;

    Ok(count > 0)
}

/// Returns the subset of assessment ids that actually exist in
/// assessment_results. Used by the sync proposal flow to verify that
/// sourceAssessmentIds reference real persisted assessment evidence.
pub(crate) fn assessment_ids_that_exist(
    connection: &Connection,
    ids: &[String],
) -> Result<Vec<String>, String> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    let placeholders = ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let sql = format!("SELECT id FROM assessment_results WHERE id IN ({placeholders})");
    let mut statement = connection
        .prepare(&sql)
        .map_err(|error| format!("failed to prepare assessment id check: {error}"))?;
    let rows = statement
        .query_map(rusqlite::params_from_iter(ids), |row| {
            row.get::<_, String>(0)
        })
        .map_err(|error| format!("failed to query assessment ids: {error}"))?;
    let mut existing = Vec::new();
    for row in rows {
        existing.push(row.map_err(|error| format!("failed to read assessment id: {error}"))?);
    }
    Ok(existing)
}

const MAX_SYNC_DIAGNOSTIC_ASSESSMENT_IDS: usize = 200;
const MAX_SYNC_DIAGNOSTIC_ID_LENGTH: usize = 200;
const MAX_SYNC_DIAGNOSTIC_FIELD_LENGTH: usize = 200;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PersistedAssessmentEvidenceDocument {
    correctness: Option<String>,
    diagnostic_provenance: Option<DiagnosticProvenancePayload>,
    question_id: Option<String>,
    evidence: Option<LegacyEvidenceValue>,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum LegacyEvidenceValue {
    Json(String),
    Object(LegacyDiagnosticEvidencePayload),
}

#[derive(Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct LegacyDiagnosticEvidencePayload {
    question_id: Option<String>,
    correct: Option<bool>,
    alert_subject_remote_id: Option<String>,
    exam_track_id: Option<String>,
    /// Historical submitPracticeAnswer used these flat scope names inside
    /// the nested evidence string.
    subject_id: Option<String>,
    module_id: Option<String>,
}

/// Rebuilds sync diagnostic evidence from the durable assessment rows.
///
/// `ids` is only a candidate list supplied by the frontend cache. The query
/// returns no row for ordinary practice results, malformed evidence, or
/// records that do not carry a verifiable diagnostic provenance.
pub(crate) fn load_persisted_sync_diagnostic_assessments_with_connection(
    connection: &Connection,
    ids: &[String],
) -> Result<Vec<PersistedSyncDiagnosticAssessment>, String> {
    validate_sync_diagnostic_ids(ids)?;
    if ids.is_empty() {
        return Ok(Vec::new());
    }

    let placeholders = ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let sql = format!(
        "SELECT assessment_results.id, subjects.code, assessment_results.evidence_json, assessment_results.created_at
         FROM assessment_results
         JOIN subjects ON subjects.id = assessment_results.subject_id
         WHERE assessment_results.id IN ({placeholders})"
    );
    let mut statement = connection
        .prepare(&sql)
        .map_err(|error| format!("failed to prepare persisted diagnostic query: {error}"))?;
    let rows = statement
        .query_map(rusqlite::params_from_iter(ids), |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
            ))
        })
        .map_err(|error| format!("failed to query persisted diagnostic assessments: {error}"))?;

    let mut results = Vec::new();
    for row in rows {
        let (assessment_id, teacher_subject_id, evidence_json, created_at) = row
            .map_err(|error| format!("failed to read persisted diagnostic assessment: {error}"))?;
        if let Some(record) = parse_persisted_sync_diagnostic_assessment(
            &assessment_id,
            &teacher_subject_id,
            &evidence_json,
            &created_at,
        ) {
            results.push(record);
        }
    }
    Ok(results)
}

fn validate_sync_diagnostic_ids(ids: &[String]) -> Result<(), String> {
    if ids.len() > MAX_SYNC_DIAGNOSTIC_ASSESSMENT_IDS {
        return Err("too many persisted diagnostic assessment ids".to_string());
    }
    let mut seen = HashSet::with_capacity(ids.len());
    for id in ids {
        if id.is_empty() || id.len() > MAX_SYNC_DIAGNOSTIC_ID_LENGTH {
            return Err("invalid persisted diagnostic assessment id".to_string());
        }
        if !seen.insert(id) {
            return Err("duplicate persisted diagnostic assessment id".to_string());
        }
    }
    Ok(())
}

fn parse_persisted_sync_diagnostic_assessment(
    assessment_id: &str,
    teacher_subject_id: &str,
    evidence_json: &str,
    created_at: &str,
) -> Option<PersistedSyncDiagnosticAssessment> {
    let document =
        serde_json::from_str::<PersistedAssessmentEvidenceDocument>(evidence_json).ok()?;
    let correctness = parse_diagnostic_correctness(document.correctness.as_deref())?;

    if let Some(provenance) = document.diagnostic_provenance {
        // The new provenance is only valid when it agrees with the older
        // question evidence stored in the same durable JSON document. This
        // prevents a newly added self-reported field from becoming the sole
        // authority when the persisted answer payload has drifted.
        let nested = parse_legacy_evidence(document.evidence.as_ref())?;
        if nested.question_id.as_deref() != Some(provenance.question_id.as_str())
            || nested.correct != Some(correctness)
            || nested.exam_track_id.as_deref() != provenance.exam_track_id.as_deref()
            || nested.subject_id.as_deref() != provenance.exam_subject_id.as_deref()
            || nested.module_id.as_deref() != provenance.exam_module_id.as_deref()
        {
            return None;
        }
        if provenance.origin != "alerttime_sync_diagnostic_v1"
            || !valid_sync_diagnostic_field(&provenance.question_id)
            || !valid_sync_diagnostic_field(&provenance.alert_subject_remote_id)
            || !valid_optional_sync_diagnostic_field(provenance.exam_track_id.as_deref())
            || !valid_optional_sync_diagnostic_field(provenance.exam_subject_id.as_deref())
            || !valid_optional_sync_diagnostic_field(provenance.exam_module_id.as_deref())
        {
            return None;
        }
        return Some(PersistedSyncDiagnosticAssessment {
            assessment_id: assessment_id.to_string(),
            teacher_subject_id: teacher_subject_id.to_string(),
            correct: correctness,
            question_id: provenance.question_id,
            alert_subject_remote_id: Some(provenance.alert_subject_remote_id),
            exam_track_id: provenance.exam_track_id,
            exam_subject_id: provenance.exam_subject_id,
            exam_module_id: provenance.exam_module_id,
            created_at: created_at.to_string(),
        });
    }

    // Legacy diagnostic rows predate explicit provenance. They are accepted
    // only for the historical id namespace and never invent a remoteId.
    if !assessment_id.starts_with("diag-") {
        return None;
    }
    let legacy = match document.evidence {
        Some(value) => parse_legacy_evidence(Some(&value)),
        None => None,
    };
    let question_id = document
        .question_id
        .or_else(|| legacy.as_ref().and_then(|value| value.question_id.clone()))?;
    if !valid_sync_diagnostic_field(&question_id) {
        return None;
    }
    let legacy = legacy.unwrap_or_default();
    if !valid_optional_sync_diagnostic_field(legacy.alert_subject_remote_id.as_deref())
        || !valid_optional_sync_diagnostic_field(legacy.exam_track_id.as_deref())
        || !valid_optional_sync_diagnostic_field(legacy.subject_id.as_deref())
        || !valid_optional_sync_diagnostic_field(legacy.module_id.as_deref())
    {
        return None;
    }
    Some(PersistedSyncDiagnosticAssessment {
        assessment_id: assessment_id.to_string(),
        teacher_subject_id: teacher_subject_id.to_string(),
        correct: correctness,
        question_id,
        // Legacy rows are resolved against the current unique mapping by the
        // TS sync layer; any stale embedded remoteId is intentionally ignored.
        alert_subject_remote_id: None,
        exam_track_id: legacy.exam_track_id,
        exam_subject_id: legacy.subject_id,
        exam_module_id: legacy.module_id,
        created_at: created_at.to_string(),
    })
}

fn parse_legacy_evidence(
    value: Option<&LegacyEvidenceValue>,
) -> Option<LegacyDiagnosticEvidencePayload> {
    match value? {
        LegacyEvidenceValue::Json(raw) => {
            serde_json::from_str::<LegacyDiagnosticEvidencePayload>(raw).ok()
        }
        LegacyEvidenceValue::Object(value) => Some(value.clone()),
    }
}

fn parse_diagnostic_correctness(value: Option<&str>) -> Option<bool> {
    match value? {
        "correct" => Some(true),
        "incorrect" | "partially_correct" => Some(false),
        _ => None,
    }
}

fn valid_sync_diagnostic_field(value: &str) -> bool {
    !value.trim().is_empty() && value.len() <= MAX_SYNC_DIAGNOSTIC_FIELD_LENGTH
}

fn valid_optional_sync_diagnostic_field(value: Option<&str>) -> bool {
    value.map(valid_sync_diagnostic_field).unwrap_or(true)
}

fn knowledge_node_exists(connection: &Connection, knowledge_node_id: &str) -> Result<bool, String> {
    let count: i64 = connection
        .query_row(
            "SELECT COUNT(1) FROM knowledge_nodes WHERE id = ?1",
            [knowledge_node_id],
            |row| row.get(0),
        )
        .map_err(|error| format!("failed to inspect knowledge node: {error}"))?;

    Ok(count > 0)
}

fn create_student_knowledge_id(student_id: &str, knowledge_node_id: &str) -> String {
    format!("sk-{}-{}", student_id, knowledge_node_id)
}

fn clamp_probability(value: f64) -> f64 {
    value.clamp(0.0, 1.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn connection() -> Connection {
        let connection = Connection::open_in_memory().expect("in-memory database");
        connection
            .execute_batch(
                "CREATE TABLE subjects (id TEXT PRIMARY KEY, code TEXT NOT NULL);
                 CREATE TABLE assessment_results (
                   id TEXT PRIMARY KEY,
                   subject_id TEXT NOT NULL,
                   evidence_json TEXT NOT NULL,
                   created_at TEXT NOT NULL
                 );
                 INSERT INTO subjects (id, code) VALUES ('subject-cn', 'cs408');",
            )
            .expect("test schema");
        connection
    }

    fn insert(connection: &Connection, id: &str, evidence: &str, created_at: &str) {
        connection
            .execute(
                "INSERT INTO assessment_results (id, subject_id, evidence_json, created_at)
                 VALUES (?1, 'subject-cn', ?2, ?3)",
                params![id, evidence, created_at],
            )
            .expect("assessment row");
    }

    #[test]
    fn rebuilds_new_provenance_from_db_and_ignores_normal_practice() {
        let connection = connection();
        insert(
            &connection,
            "diag-new-1",
            r#"{
              "correctness":"correct",
              "evidence":"{\"questionId\":\"q-cn-1\",\"correct\":true,\"examTrackId\":\"408\",\"subjectId\":\"408.computer-networks\",\"moduleId\":null}",
              "diagnosticProvenance":{
                "origin":"alerttime_sync_diagnostic_v1",
                "questionId":"q-cn-1",
                "alertSubjectRemoteId":"alert-cn",
                "examTrackId":"408",
                "examSubjectId":"408.computer-networks",
                "examModuleId":null
              }
            }"#,
            "2026-08-11T10:00:00.000Z",
        );
        insert(
            &connection,
            "practice-q-cn-2",
            r#"{"correctness":"correct","questionId":"q-cn-2"}"#,
            "2026-08-11T10:01:00.000Z",
        );

        let records = load_persisted_sync_diagnostic_assessments_with_connection(
            &connection,
            &["diag-new-1".to_string(), "practice-q-cn-2".to_string()],
        )
        .expect("typed query");
        assert_eq!(records.len(), 1);
        assert_eq!(records[0].teacher_subject_id, "cs408");
        assert!(records[0].correct);
        assert_eq!(records[0].question_id, "q-cn-1");
        assert_eq!(
            records[0].alert_subject_remote_id.as_deref(),
            Some("alert-cn")
        );
        assert_eq!(
            records[0].exam_subject_id.as_deref(),
            Some("408.computer-networks")
        );
        assert_eq!(records[0].created_at, "2026-08-11T10:00:00.000Z");
    }

    #[test]
    fn skips_new_provenance_when_nested_evidence_drifts() {
        let connection = connection();
        insert(
            &connection,
            "diag-new-mismatch",
            r#"{
              "correctness":"correct",
              "evidence":"{\"questionId\":\"q-other\",\"correct\":false,\"examTrackId\":\"408\",\"subjectId\":\"408.operating-systems\",\"moduleId\":null}",
              "diagnosticProvenance":{
                "origin":"alerttime_sync_diagnostic_v1",
                "questionId":"q-cn-1",
                "alertSubjectRemoteId":"alert-cn",
                "examTrackId":"408",
                "examSubjectId":"408.computer-networks",
                "examModuleId":null
              }
            }"#,
            "2026-08-11T10:00:00.000Z",
        );
        let records = load_persisted_sync_diagnostic_assessments_with_connection(
            &connection,
            &["diag-new-mismatch".to_string()],
        )
        .expect("mismatch query");
        assert!(records.is_empty());
    }

    #[test]
    fn legacy_diag_requires_valid_evidence_and_has_no_remote_id() {
        let connection = connection();
        insert(
            &connection,
            "diag-legacy-1",
            r#"{
              "correctness":"incorrect",
              "evidence":"{\"questionId\":\"q-old\",\"examTrackId\":\"408\",\"subjectId\":\"408.computer-networks\",\"moduleId\":null}"
            }"#,
            "2026-08-11T10:00:00.000Z",
        );
        insert(
            &connection,
            "diag-bad-json",
            "not-json",
            "2026-08-11T10:00:00.000Z",
        );
        insert(
            &connection,
            "diag-missing-question",
            r#"{"correctness":"correct","evidence":"{}"}"#,
            "2026-08-11T10:00:00.000Z",
        );

        let records = load_persisted_sync_diagnostic_assessments_with_connection(
            &connection,
            &[
                "diag-legacy-1".to_string(),
                "diag-bad-json".to_string(),
                "diag-missing-question".to_string(),
            ],
        )
        .expect("legacy query");
        assert_eq!(records.len(), 1);
        assert!(!records[0].correct);
        assert_eq!(records[0].question_id, "q-old");
        assert_eq!(records[0].alert_subject_remote_id, None);
        assert_eq!(
            records[0].exam_subject_id.as_deref(),
            Some("408.computer-networks")
        );
    }

    #[test]
    fn rejects_id_boundaries_and_duplicates_before_query() {
        let connection = connection();
        let too_long = "x".repeat(MAX_SYNC_DIAGNOSTIC_ID_LENGTH + 1);
        assert!(load_persisted_sync_diagnostic_assessments_with_connection(
            &connection,
            &[too_long]
        )
        .is_err());
        assert!(load_persisted_sync_diagnostic_assessments_with_connection(
            &connection,
            &["same".to_string(), "same".to_string()]
        )
        .is_err());
        let too_many = (0..=MAX_SYNC_DIAGNOSTIC_ASSESSMENT_IDS)
            .map(|index| format!("id-{index}"))
            .collect::<Vec<_>>();
        assert!(
            load_persisted_sync_diagnostic_assessments_with_connection(&connection, &too_many)
                .is_err()
        );
    }

    #[test]
    fn uses_parameterized_ids() {
        let connection = connection();
        insert(
            &connection,
            "diag-safe",
            r#"{"correctness":"correct","diagnosticProvenance":{"origin":"alerttime_sync_diagnostic_v1","questionId":"q-safe","alertSubjectRemoteId":"a","examTrackId":null,"examSubjectId":null,"examModuleId":null}}"#,
            "2026-08-11T10:00:00.000Z",
        );
        let records = load_persisted_sync_diagnostic_assessments_with_connection(
            &connection,
            &["diag-safe' OR 1=1 --".to_string()],
        )
        .expect("parameterized query");
        assert!(records.is_empty());
    }
}
