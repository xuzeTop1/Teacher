use rusqlite::{params, Connection, OptionalExtension, Transaction, TransactionBehavior};
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
    let transaction = Transaction::new_unchecked(connection, TransactionBehavior::Immediate)
        .map_err(|error| format!("failed to start assessment transaction: {error}"))?;
    let result = save_assessment_result_in_transaction(&transaction, input)?;
    transaction
        .commit()
        .map_err(|error| format!("failed to commit assessment transaction: {error}"))?;
    Ok(result)
}

fn save_assessment_result_in_transaction(
    connection: &Connection,
    input: SaveAssessmentResultInput,
) -> Result<StoredAssessmentResult, String> {
    validate_json_object_or_array(&input.strengths_json, "strengths_json")?;
    validate_json_object_or_array(&input.weaknesses_json, "weaknesses_json")?;
    validate_json_object_or_array(&input.recommendations_json, "recommendations_json")?;
    validate_json_object_or_array(&input.evidence_json, "evidence_json")?;
    let evidence = serde_json::from_str::<AssessmentEvidencePayload>(&input.evidence_json)
        .map_err(|error| format!("failed to parse assessment evidence_json: {error}"))?;

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
               recommendations_json, evidence_json, created_at, r_focus, n_distract
             )
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
             ON CONFLICT(id) DO UPDATE SET
               learning_goal_id = excluded.learning_goal_id,
               conversation_id = excluded.conversation_id,
               assessment_type = excluded.assessment_type,
               overall_level = excluded.overall_level,
               strengths_json = excluded.strengths_json,
               weaknesses_json = excluded.weaknesses_json,
               recommendations_json = excluded.recommendations_json,
               evidence_json = excluded.evidence_json,
               r_focus = excluded.r_focus,
               n_distract = excluded.n_distract",
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
                &created_at,
                input
                    .focus_features
                    .as_ref()
                    .map(|features| features.r_focus),
                input
                    .focus_features
                    .as_ref()
                    .map(|features| features.n_distract as i64)
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
            input.focus_features.as_ref(),
        )?;
    }

    let mut result = load_assessment_result(connection, &input.id)?
        .ok_or_else(|| "saved assessment result could not be loaded".to_string())?;
    let node_ids = evidence
        .knowledge_updates
        .iter()
        .filter(|update| !is_private_knowledge_id(&update.knowledge_node_id))
        .map(|update| update.knowledge_node_id.clone())
        .collect::<Vec<_>>();
    result.knowledge_updates = crate::knowledge::load_student_knowledge_with_connection(
        connection,
        &input.student_id,
        &input.subject_code,
        100,
        Some(&node_ids),
    )?;
    Ok(result)
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
                    knowledge_updates: Vec::new(),
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
    focus_features: Option<&FocusFeatures>,
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
            subject_id,
            &effective_update,
            updated_at,
            focus_features,
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

/// 从最近一次同步快照落库的聚合特征中，按学科映射取该 TeacherAgent 学科的最新一项。
/// 用于 FB-BKT：手机端只上报聚合，桌面端在评估时自动消费（论文 §4.3 的多端闭环）。
const SYNC_FOCUS_MAX_AGE_MS: i64 = 86_400_000;

fn latest_synced_focus_features(
    connection: &Connection,
    teacher_subject_id: &str,
) -> Option<FocusFeatures> {
    connection
        .query_row(
            "SELECT a.r_focus, a.n_distract, a.snapshot_id
             FROM sync_focus_aggregates a
             JOIN sync_devices d ON d.id = a.device_id
             JOIN subject_mappings m ON m.alert_subject_remote_id = a.subject_remote_id
               AND m.owner_identity = COALESCE(NULLIF(d.owner_identity, ''), d.id)
             JOIN subjects s ON s.code = m.teacher_subject_id
             WHERE s.id = ?1 AND d.revoked_at IS NULL
               AND a.received_at_ms BETWEEN ?2 AND ?3
             ORDER BY a.received_at_ms DESC
             LIMIT 1",
            params![
                teacher_subject_id,
                current_unix_ms() - SYNC_FOCUS_MAX_AGE_MS,
                current_unix_ms()
            ],
            |row| {
                Ok(FocusFeatures {
                    r_focus: row.get(0)?,
                    n_distract: row.get::<_, i64>(1)?.max(0) as u32,
                    snapshot_id: row.get(2)?,
                })
            },
        )
        .optional()
        .ok()
        .flatten()
}

fn upsert_student_knowledge_from_assessment(
    connection: &Connection,
    student_id: &str,
    teacher_subject_id: &str,
    update: &AssessmentKnowledgeUpdatePayload,
    updated_at: &str,
    focus_features: Option<&FocusFeatures>,
) -> Result<(), String> {
    // 显式特征优先；否则回退到手机端随快照上报、已按学科映射落库的最新聚合。
    let resolved_focus = focus_features
        .cloned()
        .or_else(|| latest_synced_focus_features(connection, teacher_subject_id));
    let focus_features = resolved_focus.as_ref();
    let knowledge_node_id = update.knowledge_node_id.trim();

    if knowledge_node_id.is_empty() || !knowledge_node_exists(connection, knowledge_node_id)? {
        return Ok(());
    }

    let existing = connection
        .query_row(
            "SELECT mastery_probability, attempts_count, correct_count,
                    last_response_at, lambda, alpha, beta
             FROM student_knowledge
             WHERE student_id = ?1 AND knowledge_node_id = ?2",
            params![student_id, knowledge_node_id],
            |row| {
                Ok((
                    row.get::<_, f64>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, Option<i64>>(3)?,
                    row.get::<_, Option<f64>>(4)?,
                    row.get::<_, Option<f64>>(5)?,
                    row.get::<_, Option<f64>>(6)?,
                ))
            },
        )
        .optional()
        .map_err(|error| format!("failed to load student knowledge: {error}"))?;

    // 论文 §4.3：提供端侧专注特征且作答结果可判定时走 FB-BKT；否则沿用原 delta 路径。
    let fb_bkt_outcome = match (focus_features, update.correctness.as_deref()) {
        (Some(features), Some(correctness)) => match correctness {
            "correct" | "incorrect" => {
                let params = crate::bkt::fb_bkt::FbBktParams::default();
                let (p_l_prev, last_response_at, lambda, alpha, beta) = match &existing {
                    Some((mastery, _, _, last_response_at, lambda, alpha, beta)) => (
                        *mastery,
                        *last_response_at,
                        lambda.unwrap_or(params.lambda),
                        alpha.unwrap_or(params.alpha),
                        beta.unwrap_or(params.beta),
                    ),
                    None => (params.p_l0, None, params.lambda, params.alpha, params.beta),
                };
                let now_ms = current_unix_ms();
                let delta_t_days = last_response_at
                    .map(|previous| (now_ms - previous).max(0) as f64 / 86_400_000.0)
                    .unwrap_or(0.0);
                let effective_params = crate::bkt::fb_bkt::FbBktParams {
                    lambda,
                    alpha,
                    beta,
                    ..params
                };
                let outcome = crate::bkt::fb_bkt::update(
                    &effective_params,
                    &crate::bkt::fb_bkt::FbBktInputs {
                        p_l_prev,
                        delta_t_days,
                        r_focus: features.r_focus,
                        n_distract: features.n_distract,
                        obs: correctness == "correct",
                    },
                );
                Some((outcome, now_ms))
            }
            _ => None,
        },
        _ => None,
    };

    let (previous_mastery, attempts_count, correct_count) = match &existing {
        Some((mastery, attempts, correct, ..)) => (*mastery, *attempts, *correct),
        None => (0.5, 0, 0),
    };
    let next_mastery = match &fb_bkt_outcome {
        Some((outcome, _)) => outcome.p_l_final,
        None => clamp_probability(previous_mastery + update.mastery_delta),
    };

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

    if let Some((outcome, now_ms)) = &fb_bkt_outcome {
        let params_default = crate::bkt::fb_bkt::FbBktParams::default();
        let lambda = existing
            .as_ref()
            .and_then(|row| row.4)
            .unwrap_or(params_default.lambda);
        let alpha = existing
            .as_ref()
            .and_then(|row| row.5)
            .unwrap_or(params_default.alpha);
        let beta = existing
            .as_ref()
            .and_then(|row| row.6)
            .unwrap_or(params_default.beta);
        connection
            .execute(
                "INSERT INTO student_knowledge (
                   id, student_id, knowledge_node_id, mastery_probability,
                   attempts_count, correct_count, last_practiced_at,
                   last_evidence_message_id, evidence_summary, updated_at,
                   last_response_at, lambda, alpha, beta, p_l_minus, p_t_prime, last_snapshot_id
                 )
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL, ?8, ?7, ?9, ?10, ?11, ?12, ?13, ?14, ?15)
                 ON CONFLICT(student_id, knowledge_node_id) DO UPDATE SET
                   mastery_probability = excluded.mastery_probability,
                   attempts_count = excluded.attempts_count,
                   correct_count = excluded.correct_count,
                   last_practiced_at = excluded.last_practiced_at,
                   evidence_summary = excluded.evidence_summary,
                   updated_at = excluded.updated_at,
                   last_response_at = excluded.last_response_at,
                   lambda = excluded.lambda,
                   alpha = excluded.alpha,
                   beta = excluded.beta,
                   p_l_minus = excluded.p_l_minus,
                   p_t_prime = excluded.p_t_prime,
                   last_snapshot_id = excluded.last_snapshot_id",
                params![
                    id,
                    student_id,
                    knowledge_node_id,
                    outcome.p_l_final,
                    next_attempts,
                    next_correct,
                    updated_at,
                    evidence_summary,
                    now_ms,
                    lambda,
                    alpha,
                    beta,
                    outcome.p_l_minus,
                    outcome.p_t_prime,
                    focus_features.and_then(|features| features.snapshot_id.as_deref())
                ],
            )
            .map_err(|error| format!("failed to upsert student knowledge (fb-bkt): {error}"))?;
        return Ok(());
    }

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

/// 当前 Unix 毫秒时间戳，供 FB-BKT 的作答间隔 Δt 计算使用。
fn current_unix_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
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

#[cfg(test)]
mod fb_bkt_integration_tests {
    use super::*;
    use crate::bkt::fb_bkt::{update as fb_update, FbBktInputs, FbBktParams};
    use crate::database::apply_migrations;
    use crate::seed::{seed_knowledge_nodes, KnowledgeSeedFile, SeedMode, SeedNode};
    use crate::shared::DEFAULT_STUDENT_ID;

    const NODE_ID: &str = "fb-bkt-integration-node";

    fn connection() -> Connection {
        let connection = Connection::open_in_memory().expect("in-memory db");
        apply_migrations(&connection).expect("migrations");
        seed_knowledge_nodes(
            &connection,
            &KnowledgeSeedFile {
                subject: "math".to_string(),
                course: None,
                chapter: None,
                status: Some("approved".to_string()),
                nodes: vec![SeedNode {
                    id: NODE_ID.to_string(),
                    title: "二元一次方程组".to_string(),
                    level: "concept".to_string(),
                    difficulty: 1,
                    summary: "测试用知识点".to_string(),
                    prerequisites: vec![],
                    misconceptions: vec![],
                    socratic_hints: vec![],
                    source: None,
                }],
            },
            SeedMode::InsertOnly,
        )
        .expect("seed knowledge node");
        connection
    }

    fn input(
        id: &str,
        correctness: &str,
        focus: Option<FocusFeatures>,
    ) -> SaveAssessmentResultInput {
        SaveAssessmentResultInput {
            id: id.to_string(),
            student_id: DEFAULT_STUDENT_ID.to_string(),
            subject_code: "math".to_string(),
            learning_goal_id: None,
            conversation_id: None,
            assessment_type: "turn_assessment".to_string(),
            overall_level: "unknown".to_string(),
            strengths_json: "[]".to_string(),
            weaknesses_json: "[]".to_string(),
            recommendations_json: "[]".to_string(),
            evidence_json: format!(
                r#"{{"correctness":"{correctness}","knowledgeUpdates":[{{"knowledgeNodeId":"{NODE_ID}","masteryDelta":0.05,"correctness":"{correctness}"}}]}}"#
            ),
            created_at: None,
            focus_features: focus,
        }
    }

    fn load_row(
        connection: &Connection,
    ) -> (f64, Option<f64>, Option<f64>, Option<String>, Option<i64>) {
        connection
            .query_row(
                "SELECT mastery_probability, p_l_minus, p_t_prime, last_snapshot_id, last_response_at
                 FROM student_knowledge WHERE student_id = ?1 AND knowledge_node_id = ?2",
                params![DEFAULT_STUDENT_ID, NODE_ID],
                |row| {
                    Ok((
                        row.get::<_, f64>(0)?,
                        row.get::<_, Option<f64>>(1)?,
                        row.get::<_, Option<f64>>(2)?,
                        row.get::<_, Option<String>>(3)?,
                        row.get::<_, Option<i64>>(4)?,
                    ))
                },
            )
            .expect("student knowledge row")
    }

    #[test]
    fn focus_features_route_through_fb_bkt_and_persist_intermediates() {
        let connection = connection();
        let features = FocusFeatures {
            r_focus: 0.813,
            n_distract: 3,
            snapshot_id: Some("snapshot-case-1".to_string()),
        };
        save_assessment_result_with_connection(
            &connection,
            input("fb-bkt-1", "incorrect", Some(features.clone())),
        )
        .expect("assessment with focus features");

        let params = FbBktParams::default();
        let expected = fb_update(
            &params,
            &FbBktInputs {
                p_l_prev: params.p_l0,
                delta_t_days: 0.0,
                r_focus: features.r_focus,
                n_distract: features.n_distract,
                obs: false,
            },
        );

        let (mastery, p_l_minus, p_t_prime, snapshot_id, last_response_at) = load_row(&connection);
        assert!(
            (mastery - expected.p_l_final).abs() < 1e-12,
            "mastery 应等于 FB-BKT 输出 {}，实际 {mastery}",
            expected.p_l_final
        );
        assert!((p_l_minus.expect("p_l_minus") - expected.p_l_minus).abs() < 1e-12);
        assert!((p_t_prime.expect("p_t_prime") - expected.p_t_prime).abs() < 1e-12);
        assert_eq!(snapshot_id.as_deref(), Some("snapshot-case-1"));
        assert!(last_response_at.expect("last_response_at") > 0);

        let (r_focus, n_distract): (Option<f64>, Option<i64>) = connection
            .query_row(
                "SELECT r_focus, n_distract FROM assessment_results WHERE id = 'fb-bkt-1'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("assessment row");
        assert!((r_focus.expect("r_focus") - 0.813).abs() < 1e-12);
        assert_eq!(n_distract, Some(3));
    }

    #[test]
    fn missing_focus_features_keep_legacy_delta_path() {
        let connection = connection();
        save_assessment_result_with_connection(&connection, input("legacy-1", "correct", None))
            .expect("assessment without focus features");

        let (mastery, p_l_minus, p_t_prime, snapshot_id, last_response_at) = load_row(&connection);
        assert!(
            (mastery - 0.55).abs() < 1e-12,
            "legacy 路径应保持原 delta 行为，got {mastery}"
        );
        assert!(p_l_minus.is_none());
        assert!(p_t_prime.is_none());
        assert!(snapshot_id.is_none());
        assert!(last_response_at.is_none());
    }

    #[test]
    fn second_update_applies_decay_from_previous_response_timestamp() {
        let connection = connection();
        let features = FocusFeatures {
            r_focus: 0.6,
            n_distract: 1,
            snapshot_id: Some("snapshot-case-2".to_string()),
        };
        save_assessment_result_with_connection(
            &connection,
            input("fb-bkt-2a", "correct", Some(features.clone())),
        )
        .expect("first update");
        let (first_mastery, ..) = load_row(&connection);

        let six_days_ago = current_unix_ms() - 6 * 86_400_000;
        connection
            .execute(
                "UPDATE student_knowledge SET last_response_at = ?1
                 WHERE student_id = ?2 AND knowledge_node_id = ?3",
                params![six_days_ago, DEFAULT_STUDENT_ID, NODE_ID],
            )
            .expect("rewind last response");

        save_assessment_result_with_connection(
            &connection,
            input("fb-bkt-2b", "incorrect", Some(features.clone())),
        )
        .expect("second update");

        let params = FbBktParams::default();
        let expected = fb_update(
            &params,
            &FbBktInputs {
                p_l_prev: first_mastery,
                delta_t_days: 6.0,
                r_focus: features.r_focus,
                n_distract: features.n_distract,
                obs: false,
            },
        );
        let (mastery, p_l_minus, p_t_prime, ..) = load_row(&connection);
        let p_l_minus = p_l_minus.expect("p_l_minus");
        assert!(
            (p_l_minus - expected.p_l_minus).abs() < 1e-6,
            "Δt=6 天的衰减先验应可回放"
        );
        assert!((p_t_prime.expect("p_t_prime") - expected.p_t_prime).abs() < 1e-12);
        assert!(
            (p_l_minus - first_mastery).abs() > 0.01,
            "Δt=6 天应产生可观测的衰减"
        );
        assert!((mastery - expected.p_l_final).abs() < 1e-6);
    }

    #[test]
    fn failed_node_write_rolls_back_and_retry_applies_exactly_once() {
        let connection = connection();
        connection
            .execute_batch(
                "CREATE TRIGGER fail_assessment_node BEFORE INSERT ON student_knowledge
             WHEN NEW.knowledge_node_id = 'second-node'
             BEGIN SELECT RAISE(ABORT, 'injected second node failure'); END;",
            )
            .unwrap();
        let mut assessment = input("atomic-assessment", "correct", None);
        assessment.evidence_json = format!(
            r#"{{"correctness":"correct",
          "knowledgeSnapshots":[{{"id":"second-node","title":"Second node"}}],
          "knowledgeUpdates":[{{"knowledgeNodeId":"{NODE_ID}","masteryDelta":0.05}},
                              {{"knowledgeNodeId":"second-node","masteryDelta":0.1}}]}}"#
        );
        assert!(save_assessment_result_with_connection(&connection, assessment.clone()).is_err());
        for table in ["assessment_results", "student_knowledge"] {
            let count: i64 = connection
                .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                    row.get(0)
                })
                .unwrap();
            assert_eq!(count, 0, "rollback must include {table}");
        }
        assert!(!knowledge_node_exists(&connection, "second-node").unwrap());
        connection
            .execute_batch("DROP TRIGGER fail_assessment_node;")
            .unwrap();
        let saved =
            save_assessment_result_with_connection(&connection, assessment.clone()).unwrap();
        assert_eq!(saved.knowledge_updates.len(), 2);
        assert!(saved
            .knowledge_updates
            .iter()
            .all(|row| row.attempts_count == 1));
        let retried = save_assessment_result_with_connection(&connection, assessment).unwrap();
        assert!(retried
            .knowledge_updates
            .iter()
            .all(|row| row.attempts_count == 1));
    }

    #[test]
    fn malformed_evidence_does_not_leave_an_assessment_row() {
        let connection = connection();
        let mut assessment = input("malformed", "correct", None);
        assessment.evidence_json = r#"{"knowledgeUpdates":"invalid"}"#.into();
        assert!(save_assessment_result_with_connection(&connection, assessment).is_err());
        assert!(!assessment_exists(&connection, "malformed").unwrap());
    }

    #[test]
    fn partial_correct_keeps_small_delta_instead_of_a_correct_fb_observation() {
        let connection = connection();
        let saved = save_assessment_result_with_connection(
            &connection,
            input(
                "partial",
                "partially_correct",
                Some(FocusFeatures {
                    r_focus: 1.0,
                    n_distract: 0,
                    snapshot_id: None,
                }),
            ),
        )
        .unwrap();
        let row = &saved.knowledge_updates[0];
        assert!((row.mastery_probability - 0.55).abs() < 1e-12);
        assert_eq!((row.attempts_count, row.correct_count), (1, 0));
        assert!(load_row(&connection).1.is_none());
    }

    #[test]
    fn synced_focus_respects_owner_revocation_subject_code_and_age() {
        let connection = connection();
        let subject_id = ensure_default_conversation_with_connection(&connection, "math")
            .unwrap()
            .subject_id;
        for (device, owner) in [("a", "owner-a"), ("b", "owner-b")] {
            connection.execute("INSERT INTO sync_devices
              (id,display_name,credential_lookup,credential_hash,credential_salt,certificate_pin,paired_at,created_at,owner_identity)
              VALUES (?1,?1,?1,'hash','salt','pin','now','now',?2)",params![device,owner]).unwrap();
        }
        connection.execute_batch("INSERT INTO subject_mappings
          (owner_identity,alert_subject_remote_id,teacher_subject_id,created_at,updated_at)
          VALUES ('owner-a','shared','math','now','now'),('owner-b','shared','physics','now','now');").unwrap();
        let now = current_unix_ms();
        for (device, focus, timestamp) in [("a", 0.2, now - 2), ("b", 0.9, now - 1)] {
            connection.execute("INSERT INTO sync_focus_aggregates
              (device_id,subject_temp_id,subject_remote_id,r_focus,n_distract,snapshot_id,received_at_ms)
              VALUES (?1,1,'shared',?2,0,?1,?3)",params![device,focus,timestamp]).unwrap();
        }
        let resolved = latest_synced_focus_features(&connection, &subject_id).unwrap();
        assert_eq!(resolved.r_focus, 0.2);
        assert_eq!(resolved.snapshot_id.as_deref(), Some("a"));
        connection
            .execute_batch("UPDATE sync_devices SET revoked_at='now' WHERE id='a';")
            .unwrap();
        assert!(latest_synced_focus_features(&connection, &subject_id).is_none());
        connection
            .execute_batch("UPDATE sync_devices SET revoked_at=NULL WHERE id='a';")
            .unwrap();
        connection
            .execute(
                "UPDATE sync_focus_aggregates SET received_at_ms=?1 WHERE device_id='a'",
                [now - SYNC_FOCUS_MAX_AGE_MS - 1],
            )
            .unwrap();
        assert!(latest_synced_focus_features(&connection, &subject_id).is_none());
    }

    #[test]
    fn unknown_correctness_falls_back_to_legacy_even_with_focus_features() {
        let connection = connection();
        let features = FocusFeatures {
            r_focus: 0.9,
            n_distract: 0,
            snapshot_id: Some("snapshot-case-3".to_string()),
        };
        save_assessment_result_with_connection(
            &connection,
            input("fb-bkt-3", "unknown", Some(features)),
        )
        .expect("unknown correctness");

        let (mastery, p_l_minus, ..) = load_row(&connection);
        assert!(
            (mastery - 0.55).abs() < 1e-12,
            "无法判定作答时不应触发 FB-BKT"
        );
        assert!(p_l_minus.is_none());
    }
}
