//! SQLite repository for the LAN sync read model, pairing, devices,
//! proposals and decisions. All mutation functions used by the HTTP server
//! run inside a single transaction.

use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::Serialize;
use sha2::Digest;

use super::protocol::{
    validate_learning_analysis, validate_learning_analysis_against_ids, EntityCounts,
    LearningAnalysisDto, ProposalDecisionPayload, ProposalDto, SnapshotAckPayload, SnapshotPayload,
};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DeviceInfo {
    pub device_id: String,
    pub display_name: String,
    pub paired_at: String,
    pub last_sync_at: Option<String>,
    pub revoked: bool,
    pub certificate_pin: String,
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum ProposalListError {
    InvalidCursor,
    Database(String),
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReadModel {
    pub subjects: Vec<ReadSubject>,
    pub weekly_goals: Vec<ReadWeeklyGoal>,
    pub tasks: Vec<ReadTask>,
    pub study_sessions: Vec<ReadStudySession>,
    pub latest_learning_analysis: Option<LearningAnalysisDto>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReadSubject {
    pub remote_id: String,
    pub name: String,
    pub is_archived: bool,
    pub created_at: i64,
    pub updated_at: i64,
    pub deleted_at: Option<i64>,
    /// 手机端声明的考试体系归属（可选；仅展示与映射建议，不是权威映射）。
    pub exam_track_id: Option<String>,
    pub exam_subject_id: Option<String>,
    pub exam_module_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReadWeeklyGoal {
    pub remote_id: String,
    pub source_proposal_id: Option<String>,
    pub week_start: i64,
    pub title: String,
    pub success_criteria: Option<String>,
    pub status: i64,
    pub completed_at: Option<i64>,
    pub deferred_to_week_start: Option<i64>,
    pub exception_reason: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub deleted_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReadTask {
    pub remote_id: String,
    pub source_proposal_id: Option<String>,
    pub subject_remote_id: Option<String>,
    pub title: String,
    pub content: Option<String>,
    pub r#type: i64,
    pub priority: i64,
    pub status: i64,
    pub target_duration_seconds: Option<i64>,
    pub due_at: Option<i64>,
    pub completed_at: Option<i64>,
    pub sort_order: i64,
    pub created_at: i64,
    pub updated_at: i64,
    pub deleted_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReadStudySession {
    pub remote_id: String,
    pub subject_remote_id: Option<String>,
    pub task_remote_id: Option<String>,
    pub title: Option<String>,
    pub start_time: i64,
    pub end_time: Option<i64>,
    pub duration_seconds: i64,
    pub pause_seconds: i64,
    pub focus_score: Option<i64>,
    pub note: Option<String>,
    pub status: i64,
    pub created_at: i64,
    pub updated_at: i64,
    pub deleted_at: Option<i64>,
    /// AI 使用时间（可选；旧快照默认 0 / null）。
    pub ai_help_seconds: i64,
    pub ai_help_count: i64,
    pub external_ai_app_seconds: Option<i64>,
    pub ai_usage_source: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SubjectMappingRow {
    pub alert_subject_remote_id: String,
    pub teacher_subject_id: String,
    /// 考试体系叶子映射（优先于 teacher_subject_id；旧平面码/自定义学科保留旧字段）。
    pub exam_track_id: Option<String>,
    pub exam_subject_id: Option<String>,
    pub exam_module_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LastSnapshotInfo {
    pub snapshot_id: String,
    pub received_at: String,
    pub subject_count: i64,
    pub goal_count: i64,
    pub task_count: i64,
    pub session_count: i64,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) enum ImportOutcome {
    /// snapshotId was already processed; nothing was re-imported. Carries the
    /// counts of the already-stored snapshot so an idempotent re-send gets an
    /// ack whose entityCounts match what the client uploaded (the phone
    /// validates them against the snapshot it sent).
    Idempotent(EntityCounts),
    /// New snapshot was fully applied inside one transaction.
    Applied(EntityCounts),
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) enum DecisionOutcome {
    Recorded,
    AlreadyRecorded,
    NotFound,
    StatusConflict,
}

pub(crate) fn now_iso(connection: &Connection) -> Result<String, String> {
    connection
        .query_row("SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now')", [], |row| {
            row.get(0)
        })
        .map_err(|error| format!("failed to read current time: {error}"))
}

#[cfg(test)]
fn unix_ms_now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

pub(crate) fn sha256_hex(bytes: &[u8]) -> String {
    hex::encode(sha2::Sha256::digest(bytes))
}

pub(crate) fn credential_hash(salt: &str, credential: &str) -> String {
    sha256_hex(format!("{salt}:{credential}").as_bytes())
}

/// Unsalted lookup key (SHA-256 of the credential). The credential is a
/// 256-bit random secret, so the unsalted hash is safe for indexing; the
/// salted hash is used for the final constant-time verification.
pub(crate) fn credential_lookup_key(credential: &str) -> String {
    sha256_hex(credential.as_bytes())
}

// ── Pairing ────────────────────────────────────────────────────────────

pub(crate) fn insert_pairing_token(
    connection: &Connection,
    token_hash: &str,
    device_id: &str,
    expires_at_ms: i64,
) -> Result<(), String> {
    let now = now_iso(connection)?;
    connection
        .execute(
            "INSERT INTO sync_pairing_tokens (token_hash, device_id, expires_at, created_at)
             VALUES (?1, ?2, ?3, ?4)",
            params![token_hash, device_id, expires_at_ms, now],
        )
        .map_err(|error| format!("failed to store pairing token: {error}"))?;
    Ok(())
}

/// Consumes a one-time pairing token inside a transaction. Returns Ok(true)
/// when the token was valid, unused, unexpired and device-bound.
pub(crate) fn consume_pairing_token(
    transaction: &Transaction,
    token_hash: &str,
    device_id: &str,
    now_ms: i64,
) -> Result<bool, String> {
    let row = transaction
        .query_row(
            "SELECT expires_at, used_at, device_id FROM sync_pairing_tokens WHERE token_hash = ?1",
            [token_hash],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, String>(2)?,
                ))
            },
        )
        .optional()
        .map_err(|error| format!("failed to read pairing token: {error}"))?;

    let Some((expires_at, used_at, bound_device)) = row else {
        return Ok(false);
    };
    if used_at.is_some() || now_ms > expires_at || bound_device != device_id {
        return Ok(false);
    }
    let now = now_iso(transaction)?;
    transaction
        .execute(
            "UPDATE sync_pairing_tokens SET used_at = ?1 WHERE token_hash = ?2",
            params![now, token_hash],
        )
        .map_err(|error| format!("failed to consume pairing token: {error}"))?;
    Ok(true)
}

// ── Devices ────────────────────────────────────────────────────────────

#[allow(clippy::too_many_arguments)]
pub(crate) fn insert_device(
    connection: &Connection,
    device_id: &str,
    display_name: &str,
    credential_lookup: &str,
    credential_salt: &str,
    credential_hash: &str,
    certificate_pin: &str,
    owner_identity: Option<&str>,
) -> Result<(), String> {
    let now = now_iso(connection)?;
    connection
        .execute(
            "INSERT INTO sync_devices
               (id, display_name, credential_lookup, credential_hash, credential_salt, certificate_pin, owner_identity, paired_at, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                device_id,
                display_name,
                credential_lookup,
                credential_hash,
                credential_salt,
                certificate_pin,
                owner_identity,
                now,
                now
            ],
        )
        .map_err(|error| format!("failed to store device: {error}"))?;
    Ok(())
}

/// 把 device_id 解析为归属的 owner_identity（用于 subject_mappings 等用户配置）。
/// legacy 设备（owner_identity 为空）回退到自身 device_id，保证映射始终可保存/读取。
pub(crate) fn owner_identity_for_device(
    connection: &Connection,
    device_id: &str,
) -> Result<Option<String>, String> {
    let owner: Option<String> = connection
        .query_row(
            "SELECT owner_identity FROM sync_devices WHERE id = ?1",
            [device_id],
            |row| row.get::<_, Option<String>>(0),
        )
        .optional()
        .map_err(|error| format!("failed to read device owner identity: {error}"))?
        .flatten();
    match owner {
        Some(o) if !o.is_empty() => Ok(Some(o)),
        _ => Ok(Some(device_id.to_string())),
    }
}

/// Authenticates a raw device credential: lookup by the unsalted hash, then
/// constant-time verification of the salted hash. Revoked devices fail.
/// Returns the device id when the credential is valid.
pub(crate) fn find_device_by_credential(
    connection: &Connection,
    credential: &str,
) -> Result<Option<String>, String> {
    let lookup = credential_lookup_key(credential);
    let candidate: Option<(String, String, String)> = connection
        .query_row(
            "SELECT id, credential_hash, credential_salt
             FROM sync_devices WHERE credential_lookup = ?1 AND revoked_at IS NULL LIMIT 1",
            [&lookup],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()
        .map_err(|error| format!("failed to read device: {error}"))?;

    let Some((id, stored_hash, salt)) = candidate else {
        return Ok(None);
    };
    let expected = credential_hash(&salt, credential);
    use subtle::ConstantTimeEq;
    if expected
        .as_bytes()
        .ct_eq(stored_hash.as_bytes())
        .unwrap_u8()
        != 1
    {
        return Ok(None);
    }
    Ok(Some(id))
}

pub(crate) fn list_devices(connection: &Connection) -> Result<Vec<DeviceInfo>, String> {
    let mut statement = connection
        .prepare(
            "SELECT id, display_name, paired_at, last_sync_at, revoked_at, certificate_pin
             FROM sync_devices ORDER BY paired_at DESC",
        )
        .map_err(|error| format!("failed to prepare device list: {error}"))?;
    let rows = statement
        .query_map([], |row| {
            Ok(DeviceInfo {
                device_id: row.get(0)?,
                display_name: row.get(1)?,
                paired_at: row.get(2)?,
                last_sync_at: row.get(3)?,
                revoked: row.get::<_, Option<String>>(4)?.is_some(),
                certificate_pin: row.get(5)?,
            })
        })
        .map_err(|error| format!("failed to query device list: {error}"))?;
    let mut devices = Vec::new();
    for row in rows {
        devices.push(row.map_err(|error| format!("failed to read device row: {error}"))?);
    }
    Ok(devices)
}

pub(crate) fn revoke_device(connection: &Connection, device_id: &str) -> Result<bool, String> {
    let now = now_iso(connection)?;
    let updated = connection
        .execute(
            "UPDATE sync_devices SET revoked_at = ?1 WHERE id = ?2 AND revoked_at IS NULL",
            params![now, device_id],
        )
        .map_err(|error| format!("failed to revoke device: {error}"))?;
    Ok(updated > 0)
}

pub(crate) fn touch_last_sync(connection: &Connection, device_id: &str) -> Result<(), String> {
    let now = now_iso(connection)?;
    connection
        .execute(
            "UPDATE sync_devices SET last_sync_at = ?1 WHERE id = ?2",
            params![now, device_id],
        )
        .map_err(|error| format!("failed to update last sync time: {error}"))?;
    Ok(())
}

// ── Snapshot import (single transaction, idempotent) ───────────────────

pub(crate) fn import_snapshot(
    connection: &mut Connection,
    device_id: &str,
    snapshot_id: &str,
    payload: &SnapshotPayload,
    received_at_ms: i64,
) -> Result<ImportOutcome, String> {
    validate_learning_analysis(payload, snapshot_id)
        .map_err(|errors| format!("invalid learning analysis: {}", errors.join("；")))?;
    let transaction = connection
        .transaction()
        .map_err(|error| format!("failed to start snapshot transaction: {error}"))?;

    let stored_counts: Option<(i64, i64, i64, i64)> = transaction
        .query_row(
            "SELECT subject_count, goal_count, task_count, session_count
             FROM sync_snapshots WHERE id = ?1 AND device_id = ?2",
            params![snapshot_id, device_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .ok();
    if let Some((subjects, goals, tasks, sessions)) = stored_counts {
        return Ok(ImportOutcome::Idempotent(EntityCounts {
            subjects: subjects as usize,
            weekly_goals: goals as usize,
            tasks: tasks as usize,
            study_sessions: sessions as usize,
        }));
    }

    let counts = EntityCounts {
        subjects: payload.subjects.len(),
        weekly_goals: payload.weekly_goals.len(),
        tasks: payload.tasks.len(),
        study_sessions: payload.study_sessions.len(),
    };

    // Full snapshot semantics: replace this device's read model in one
    // transaction; any failure rolls everything back and old data survives.
    transaction
        .execute(
            "DELETE FROM sync_study_sessions WHERE device_id = ?1",
            [device_id],
        )
        .map_err(|error| format!("failed to clear old sessions: {error}"))?;
    transaction
        .execute("DELETE FROM sync_tasks WHERE device_id = ?1", [device_id])
        .map_err(|error| format!("failed to clear old tasks: {error}"))?;
    transaction
        .execute(
            "DELETE FROM sync_weekly_goals WHERE device_id = ?1",
            [device_id],
        )
        .map_err(|error| format!("failed to clear old goals: {error}"))?;
    transaction
        .execute(
            "DELETE FROM sync_subjects WHERE device_id = ?1",
            [device_id],
        )
        .map_err(|error| format!("failed to clear old subjects: {error}"))?;

    insert_subjects(&transaction, device_id, payload)?;
    insert_weekly_goals(&transaction, device_id, payload)?;
    insert_tasks(&transaction, device_id, payload)?;
    insert_sessions(&transaction, device_id, payload)?;

    let received_at = now_iso(&transaction)?;
    transaction
        .execute(
            "INSERT INTO sync_snapshots
               (id, device_id, received_at, received_at_ms, status, subject_count, goal_count, task_count, session_count)
             VALUES (?1, ?2, ?3, ?4, 'applied', ?5, ?6, ?7, ?8)",
            params![
                snapshot_id,
                device_id,
                received_at,
                received_at_ms,
                counts.subjects as i64,
                counts.weekly_goals as i64,
                counts.tasks as i64,
                counts.study_sessions as i64,
            ],
        )
        .map_err(|error| format!("failed to record snapshot: {error}"))?;

    if let Some(analysis) = payload.learning_analysis.as_ref() {
        let payload_json = serde_json::to_string(analysis)
            .map_err(|error| format!("failed to encode learning analysis: {error}"))?;
        transaction
            .execute(
                "INSERT INTO sync_learning_analyses
                   (analysis_id, device_id, snapshot_id, generated_at, prompt_version, generator, payload_json, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![
                    analysis.analysis_id,
                    device_id,
                    snapshot_id,
                    analysis.generated_at,
                    analysis.prompt_version,
                    analysis.generator,
                    payload_json,
                    received_at,
                ],
            )
            .map_err(|error| format!("failed to record learning analysis: {error}"))?;
    }

    touch_last_sync(&transaction, device_id)?;

    transaction
        .commit()
        .map_err(|error| format!("failed to commit snapshot import: {error}"))?;
    Ok(ImportOutcome::Applied(counts))
}

fn insert_subjects(
    transaction: &Transaction,
    device_id: &str,
    payload: &SnapshotPayload,
) -> Result<(), String> {
    let mut statement = transaction
        .prepare(
            "INSERT INTO sync_subjects
               (device_id, remote_id, name, is_archived, created_at, updated_at, deleted_at,
                exam_track_id, exam_subject_id, exam_module_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        )
        .map_err(|error| format!("failed to prepare subject insert: {error}"))?;
    for subject in &payload.subjects {
        statement
            .execute(params![
                device_id,
                subject.remote_id,
                subject.name,
                subject.is_archived as i64,
                subject.created_at,
                subject.updated_at,
                subject.deleted_at,
                subject.exam_track_id,
                subject.exam_subject_id,
                subject.exam_module_id
            ])
            .map_err(|error| format!("failed to insert subject: {error}"))?;
    }
    Ok(())
}

fn insert_weekly_goals(
    transaction: &Transaction,
    device_id: &str,
    payload: &SnapshotPayload,
) -> Result<(), String> {
    let mut statement = transaction
        .prepare(
            "INSERT INTO sync_weekly_goals
               (device_id, remote_id, source_proposal_id, week_start, title, success_criteria,
                status, completed_at, deferred_to_week_start, exception_reason, created_at,
                updated_at, deleted_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
        )
        .map_err(|error| format!("failed to prepare goal insert: {error}"))?;
    for goal in &payload.weekly_goals {
        statement
            .execute(params![
                device_id,
                goal.remote_id,
                goal.source_proposal_id,
                goal.week_start,
                goal.title,
                goal.success_criteria,
                goal.status,
                goal.completed_at,
                goal.deferred_to_week_start,
                goal.exception_reason,
                goal.created_at,
                goal.updated_at,
                goal.deleted_at,
            ])
            .map_err(|error| format!("failed to insert weekly goal: {error}"))?;
    }
    Ok(())
}

fn insert_tasks(
    transaction: &Transaction,
    device_id: &str,
    payload: &SnapshotPayload,
) -> Result<(), String> {
    let mut statement = transaction
        .prepare(
            "INSERT INTO sync_tasks
               (device_id, remote_id, source_proposal_id, subject_remote_id, title, content,
                type, priority, status, target_duration_seconds, due_at, completed_at, sort_order,
                created_at, updated_at, deleted_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)",
        )
        .map_err(|error| format!("failed to prepare task insert: {error}"))?;
    for task in &payload.tasks {
        statement
            .execute(params![
                device_id,
                task.remote_id,
                task.source_proposal_id,
                task.subject_remote_id,
                task.title,
                task.content,
                task.r#type,
                task.priority,
                task.status,
                task.target_duration_seconds,
                task.due_at,
                task.completed_at,
                task.sort_order,
                task.created_at,
                task.updated_at,
                task.deleted_at,
            ])
            .map_err(|error| format!("failed to insert task: {error}"))?;
    }
    Ok(())
}

fn insert_sessions(
    transaction: &Transaction,
    device_id: &str,
    payload: &SnapshotPayload,
) -> Result<(), String> {
    let mut statement = transaction
        .prepare(
            "INSERT INTO sync_study_sessions
               (device_id, remote_id, subject_remote_id, task_remote_id, title, start_time, end_time,
                duration_seconds, pause_seconds, focus_score, note, status, created_at, updated_at, deleted_at,
                ai_help_seconds, ai_help_count, external_ai_app_seconds, ai_usage_source)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19)",
        )
        .map_err(|error| format!("failed to prepare session insert: {error}"))?;
    for session in &payload.study_sessions {
        statement
            .execute(params![
                device_id,
                session.remote_id,
                session.subject_remote_id,
                session.task_remote_id,
                session.title,
                session.start_time,
                session.end_time,
                session.duration_seconds,
                session.pause_seconds,
                session.focus_score,
                session.note,
                session.status,
                session.created_at,
                session.updated_at,
                session.deleted_at,
                session.ai_help_seconds,
                session.ai_help_count,
                session.external_ai_app_seconds,
                session.ai_usage_source
            ])
            .map_err(|error| format!("failed to insert study session: {error}"))?;
    }
    Ok(())
}

pub(crate) fn last_snapshot(
    connection: &Connection,
    device_id: &str,
) -> Result<Option<LastSnapshotInfo>, String> {
    connection
        .query_row(
            "SELECT id, received_at, subject_count, goal_count, task_count, session_count
             FROM sync_snapshots
             WHERE device_id = ?1
             ORDER BY received_at_ms DESC, received_at DESC,
                      sync_snapshots.rowid DESC, id DESC
             LIMIT 1",
            [device_id],
            |row| {
                Ok(LastSnapshotInfo {
                    snapshot_id: row.get(0)?,
                    received_at: row.get(1)?,
                    subject_count: row.get(2)?,
                    goal_count: row.get(3)?,
                    task_count: row.get(4)?,
                    session_count: row.get(5)?,
                })
            },
        )
        .optional()
        .map_err(|error| format!("failed to read last snapshot: {error}"))
}

// ── Read model queries ─────────────────────────────────────────────────

pub(crate) fn load_read_model(
    connection: &Connection,
    device_id: &str,
) -> Result<ReadModel, String> {
    let subjects = load_read_subjects(connection, device_id)?;
    let weekly_goals = load_read_goals(connection, device_id)?;
    let tasks = load_read_tasks(connection, device_id)?;
    let study_sessions = load_read_sessions(connection, device_id)?;
    let latest_learning_analysis = load_latest_learning_analysis(
        connection,
        device_id,
        &subjects,
        &weekly_goals,
        &tasks,
        &study_sessions,
    )?;
    Ok(ReadModel {
        subjects,
        weekly_goals,
        tasks,
        study_sessions,
        latest_learning_analysis,
    })
}

fn load_latest_learning_analysis(
    connection: &Connection,
    device_id: &str,
    subjects: &[ReadSubject],
    weekly_goals: &[ReadWeeklyGoal],
    tasks: &[ReadTask],
    study_sessions: &[ReadStudySession],
) -> Result<Option<LearningAnalysisDto>, String> {
    let latest: Option<(String, Option<String>)> = connection
        .query_row(
            "SELECT snapshot.id, analysis.payload_json
             FROM sync_snapshots AS snapshot
             LEFT JOIN sync_learning_analyses AS analysis ON analysis.snapshot_id = snapshot.id
             WHERE snapshot.device_id = ?1
             ORDER BY snapshot.received_at_ms DESC, snapshot.received_at DESC,
                      snapshot.rowid DESC, snapshot.id DESC
             LIMIT 1",
            [device_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|error| format!("failed to query latest learning analysis: {error}"))?;
    let Some((snapshot_id, Some(json))) = latest else {
        return Ok(None);
    };
    let Ok(analysis) = serde_json::from_str::<LearningAnalysisDto>(&json) else {
        // 派生分析损坏时只丢弃该缓存，不能拖垮科目、计划和会话读模型。
        // 不输出 payload 或解析详情，避免把同步内容带入日志。
        eprintln!("ignored invalid cached learning analysis payload");
        return Ok(None);
    };
    let subject_ids = subjects
        .iter()
        .map(|subject| subject.remote_id.as_str())
        .collect();
    let weekly_goal_ids = weekly_goals
        .iter()
        .map(|goal| goal.remote_id.as_str())
        .collect();
    let task_ids = tasks.iter().map(|task| task.remote_id.as_str()).collect();
    let session_ids = study_sessions
        .iter()
        .map(|session| session.remote_id.as_str())
        .collect();
    if validate_learning_analysis_against_ids(
        &analysis,
        &snapshot_id,
        &subject_ids,
        &weekly_goal_ids,
        &task_ids,
        &session_ids,
    )
    .is_err()
    {
        eprintln!("ignored invalid cached learning analysis payload");
        return Ok(None);
    }
    Ok(Some(analysis))
}

fn load_read_subjects(
    connection: &Connection,
    device_id: &str,
) -> Result<Vec<ReadSubject>, String> {
    let mut statement = connection
        .prepare(
            "SELECT remote_id, name, is_archived, created_at, updated_at, deleted_at,
                    exam_track_id, exam_subject_id, exam_module_id
             FROM sync_subjects WHERE device_id = ?1 ORDER BY created_at",
        )
        .map_err(|error| format!("failed to prepare subjects query: {error}"))?;
    let rows = statement
        .query_map([device_id], |row| {
            Ok(ReadSubject {
                remote_id: row.get(0)?,
                name: row.get(1)?,
                is_archived: row.get::<_, i64>(2)? != 0,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
                deleted_at: row.get(5)?,
                exam_track_id: row.get(6)?,
                exam_subject_id: row.get(7)?,
                exam_module_id: row.get(8)?,
            })
        })
        .map_err(|error| format!("failed to query subjects: {error}"))?;
    let mut result = Vec::new();
    for row in rows {
        result.push(row.map_err(|error| format!("failed to read subject row: {error}"))?);
    }
    Ok(result)
}

fn load_read_goals(
    connection: &Connection,
    device_id: &str,
) -> Result<Vec<ReadWeeklyGoal>, String> {
    let mut statement = connection
        .prepare(
            "SELECT remote_id, source_proposal_id, week_start, title, success_criteria, status,
                    completed_at, deferred_to_week_start, exception_reason, created_at, updated_at,
                    deleted_at
             FROM sync_weekly_goals WHERE device_id = ?1 ORDER BY week_start, created_at",
        )
        .map_err(|error| format!("failed to prepare goals query: {error}"))?;
    let rows = statement
        .query_map([device_id], |row| {
            Ok(ReadWeeklyGoal {
                remote_id: row.get(0)?,
                source_proposal_id: row.get(1)?,
                week_start: row.get(2)?,
                title: row.get(3)?,
                success_criteria: row.get(4)?,
                status: row.get(5)?,
                completed_at: row.get(6)?,
                deferred_to_week_start: row.get(7)?,
                exception_reason: row.get(8)?,
                created_at: row.get(9)?,
                updated_at: row.get(10)?,
                deleted_at: row.get(11)?,
            })
        })
        .map_err(|error| format!("failed to query goals: {error}"))?;
    let mut result = Vec::new();
    for row in rows {
        result.push(row.map_err(|error| format!("failed to read goal row: {error}"))?);
    }
    Ok(result)
}

fn load_read_tasks(connection: &Connection, device_id: &str) -> Result<Vec<ReadTask>, String> {
    let mut statement = connection
        .prepare(
            "SELECT remote_id, source_proposal_id, subject_remote_id, title, content, type, priority,
                    status, target_duration_seconds, due_at, completed_at, sort_order, created_at,
                    updated_at, deleted_at
             FROM sync_tasks WHERE device_id = ?1 ORDER BY created_at",
        )
        .map_err(|error| format!("failed to prepare tasks query: {error}"))?;
    let rows = statement
        .query_map([device_id], |row| {
            Ok(ReadTask {
                remote_id: row.get(0)?,
                source_proposal_id: row.get(1)?,
                subject_remote_id: row.get(2)?,
                title: row.get(3)?,
                content: row.get(4)?,
                r#type: row.get(5)?,
                priority: row.get(6)?,
                status: row.get(7)?,
                target_duration_seconds: row.get(8)?,
                due_at: row.get(9)?,
                completed_at: row.get(10)?,
                sort_order: row.get(11)?,
                created_at: row.get(12)?,
                updated_at: row.get(13)?,
                deleted_at: row.get(14)?,
            })
        })
        .map_err(|error| format!("failed to query tasks: {error}"))?;
    let mut result = Vec::new();
    for row in rows {
        result.push(row.map_err(|error| format!("failed to read task row: {error}"))?);
    }
    Ok(result)
}

fn load_read_sessions(
    connection: &Connection,
    device_id: &str,
) -> Result<Vec<ReadStudySession>, String> {
    let mut statement = connection
        .prepare(
            "SELECT remote_id, subject_remote_id, task_remote_id, title, start_time, end_time,
                    duration_seconds, pause_seconds, focus_score, note, status, created_at, updated_at, deleted_at,
                    ai_help_seconds, ai_help_count, external_ai_app_seconds, ai_usage_source
             FROM sync_study_sessions WHERE device_id = ?1 ORDER BY start_time",
        )
        .map_err(|error| format!("failed to prepare sessions query: {error}"))?;
    let rows = statement
        .query_map([device_id], |row| {
            Ok(ReadStudySession {
                remote_id: row.get(0)?,
                subject_remote_id: row.get(1)?,
                task_remote_id: row.get(2)?,
                title: row.get(3)?,
                start_time: row.get(4)?,
                end_time: row.get(5)?,
                duration_seconds: row.get(6)?,
                pause_seconds: row.get(7)?,
                focus_score: row.get(8)?,
                note: row.get(9)?,
                status: row.get(10)?,
                created_at: row.get(11)?,
                updated_at: row.get(12)?,
                deleted_at: row.get(13)?,
                ai_help_seconds: row.get(14)?,
                ai_help_count: row.get(15)?,
                external_ai_app_seconds: row.get(16)?,
                ai_usage_source: row.get(17)?,
            })
        })
        .map_err(|error| format!("failed to query sessions: {error}"))?;
    let mut result = Vec::new();
    for row in rows {
        result.push(row.map_err(|error| format!("failed to read session row: {error}"))?);
    }
    Ok(result)
}

// ── Subject mappings ───────────────────────────────────────────────────

pub(crate) fn list_mappings(
    connection: &Connection,
    device_id: &str,
) -> Result<Vec<SubjectMappingRow>, String> {
    let Some(owner) = owner_identity_for_device(connection, device_id)? else {
        return Ok(Vec::new());
    };
    let mut statement = connection
        .prepare(
            "SELECT alert_subject_remote_id, teacher_subject_id,
                    exam_track_id, exam_subject_id, exam_module_id
             FROM subject_mappings WHERE owner_identity = ?1 ORDER BY alert_subject_remote_id",
        )
        .map_err(|error| format!("failed to prepare mappings query: {error}"))?;
    let rows = statement
        .query_map([owner], |row| {
            Ok(SubjectMappingRow {
                alert_subject_remote_id: row.get(0)?,
                teacher_subject_id: row.get(1)?,
                exam_track_id: row.get(2)?,
                exam_subject_id: row.get(3)?,
                exam_module_id: row.get(4)?,
            })
        })
        .map_err(|error| format!("failed to query mappings: {error}"))?;
    let mut result = Vec::new();
    for row in rows {
        result.push(row.map_err(|error| format!("failed to read mapping row: {error}"))?);
    }
    Ok(result)
}

pub(crate) fn set_mapping(
    connection: &Connection,
    device_id: &str,
    alert_subject_remote_id: &str,
    teacher_subject_id: &str,
    exam_track_id: Option<String>,
    exam_subject_id: Option<String>,
    exam_module_id: Option<String>,
) -> Result<(), String> {
    let Some(owner) = owner_identity_for_device(connection, device_id)? else {
        return Err("设备不存在，无法保存学科映射".to_string());
    };
    let now = now_iso(connection)?;
    connection
        .execute(
            "INSERT INTO subject_mappings
               (owner_identity, alert_subject_remote_id, teacher_subject_id,
                exam_track_id, exam_subject_id, exam_module_id, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
             ON CONFLICT(owner_identity, alert_subject_remote_id)
             DO UPDATE SET teacher_subject_id = excluded.teacher_subject_id,
                           exam_track_id = excluded.exam_track_id,
                           exam_subject_id = excluded.exam_subject_id,
                           exam_module_id = excluded.exam_module_id,
                           updated_at = excluded.updated_at",
            params![
                owner,
                alert_subject_remote_id,
                teacher_subject_id,
                exam_track_id,
                exam_subject_id,
                exam_module_id,
                now,
                now
            ],
        )
        .map_err(|error| format!("failed to save subject mapping: {error}"))?;
    Ok(())
}

pub(crate) fn remove_mapping(
    connection: &Connection,
    device_id: &str,
    alert_subject_remote_id: &str,
) -> Result<bool, String> {
    let Some(owner) = owner_identity_for_device(connection, device_id)? else {
        return Ok(false);
    };
    let updated = connection
        .execute(
            "DELETE FROM subject_mappings WHERE owner_identity = ?1 AND alert_subject_remote_id = ?2",
            params![owner, alert_subject_remote_id],
        )
        .map_err(|error| format!("failed to remove subject mapping: {error}"))?;
    Ok(updated > 0)
}

// ── Proposals ──────────────────────────────────────────────────────────

pub(crate) fn create_proposal(
    connection: &mut Connection,
    proposal: &ProposalDto,
) -> Result<(), String> {
    let transaction = connection
        .transaction()
        .map_err(|error| format!("failed to start proposal transaction: {error}"))?;

    // A new proposal supersedes all pending proposals of the same device.
    // Timestamps follow the protocol convention: epoch milliseconds.
    transaction
        .execute(
            "UPDATE sync_proposals SET status = 'superseded', decided_at = COALESCE(decided_at, ?1)
             WHERE device_id = ?2 AND status = 'pending'",
            params![proposal.created_at, proposal.device_id],
        )
        .map_err(|error| format!("failed to supersede previous proposals: {error}"))?;

    let payload = serde_json::to_string(&serde_json::json!({
        "proposedWeeklyGoals": proposal.proposed_weekly_goals,
        "proposedTasks": proposal.proposed_tasks,
    }))
    .map_err(|error| format!("failed to encode proposal payload: {error}"))?;
    let source_ids = serde_json::to_string(&proposal.source_assessment_ids)
        .map_err(|error| format!("failed to encode proposal sources: {error}"))?;
    let created_at = proposal.created_at;

    transaction
        .execute(
            "INSERT INTO sync_proposals
               (id, device_id, version, status, rationale, payload_json, source_assessment_ids_json, created_at, expires_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                proposal.proposal_id,
                proposal.device_id,
                proposal.version,
                proposal.status,
                proposal.rationale,
                payload,
                source_ids,
                created_at,
                proposal.expires_at,
            ],
        )
        .map_err(|error| format!("failed to insert proposal: {error}"))?;

    transaction
        .commit()
        .map_err(|error| format!("failed to commit proposal: {error}"))?;
    Ok(())
}

pub(crate) fn list_proposals(
    connection: &Connection,
    device_id: &str,
    cursor: Option<&str>,
    limit: usize,
) -> Result<Vec<ProposalDto>, ProposalListError> {
    let cursor_boundary = if let Some(cursor_id) = cursor {
        connection
            .query_row(
                "SELECT created_at, id FROM sync_proposals
                 WHERE device_id = ?1 AND id = ?2",
                params![device_id, cursor_id],
                |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)),
            )
            .optional()
            .map_err(|error| {
                ProposalListError::Database(format!("failed to resolve proposal cursor: {error}"))
            })?
            .ok_or(ProposalListError::InvalidCursor)?
    } else {
        (0, String::new())
    };

    let mut statement = if cursor.is_some() {
        connection
            .prepare(
                "SELECT id, device_id, version, status, rationale, payload_json,
                        source_assessment_ids_json, created_at, expires_at
                 FROM sync_proposals
                 WHERE device_id = ?1
                   AND (created_at < ?2 OR (created_at = ?2 AND id < ?3))
                 ORDER BY created_at DESC, id DESC
                 LIMIT ?4",
            )
            .map_err(|error| {
                ProposalListError::Database(format!("failed to prepare proposals query: {error}"))
            })?
    } else {
        connection
            .prepare(
                "SELECT id, device_id, version, status, rationale, payload_json,
                        source_assessment_ids_json, created_at, expires_at
                 FROM sync_proposals
                 WHERE device_id = ?1
                 ORDER BY created_at DESC, id DESC
                 LIMIT ?2",
            )
            .map_err(|error| {
                ProposalListError::Database(format!("failed to prepare proposals query: {error}"))
            })?
    };
    let values = if cursor.is_some() {
        vec![
            device_id.to_string(),
            cursor_boundary.0.to_string(),
            cursor_boundary.1.clone(),
            limit.to_string(),
        ]
    } else {
        vec![device_id.to_string(), limit.to_string()]
    };
    let query_params: Vec<&dyn rusqlite::ToSql> = values
        .iter()
        .map(|value| value as &dyn rusqlite::ToSql)
        .collect();
    let rows = statement
        .query_map(query_params.as_slice(), |row| {
            let payload_json: String = row.get(5)?;
            let source_json: String = row.get(6)?;
            let payload: serde_json::Value = serde_json::from_str(&payload_json).map_err(|_| {
                rusqlite::Error::InvalidColumnType(
                    5,
                    "payload_json".to_string(),
                    rusqlite::types::Type::Text,
                )
            })?;
            let source_ids: Vec<String> = serde_json::from_str(&source_json).map_err(|_| {
                rusqlite::Error::InvalidColumnType(
                    6,
                    "source_json".to_string(),
                    rusqlite::types::Type::Text,
                )
            })?;
            Ok(ProposalDto {
                proposal_id: row.get(0)?,
                device_id: row.get(1)?,
                version: row.get(2)?,
                status: row.get(3)?,
                rationale: row.get(4)?,
                proposed_weekly_goals: serde_json::from_value(
                    payload
                        .get("proposedWeeklyGoals")
                        .cloned()
                        .unwrap_or(serde_json::Value::Array(vec![])),
                )
                .map_err(|_| {
                    rusqlite::Error::InvalidColumnType(
                        5,
                        "proposedWeeklyGoals".to_string(),
                        rusqlite::types::Type::Text,
                    )
                })?,
                proposed_tasks: serde_json::from_value(
                    payload
                        .get("proposedTasks")
                        .cloned()
                        .unwrap_or(serde_json::Value::Array(vec![])),
                )
                .map_err(|_| {
                    rusqlite::Error::InvalidColumnType(
                        5,
                        "proposedTasks".to_string(),
                        rusqlite::types::Type::Text,
                    )
                })?,
                source_assessment_ids: source_ids,
                created_at: row.get(7)?,
                expires_at: row.get(8)?,
            })
        })
        .map_err(|error| {
            ProposalListError::Database(format!("failed to query proposals: {error}"))
        })?;
    let mut result = Vec::new();
    for row in rows {
        result.push(row.map_err(|error| {
            ProposalListError::Database(format!("failed to read proposal row: {error}"))
        })?);
    }
    Ok(result)
}

/// Applies an accept/reject decision idempotently. The proposal must belong
/// to the requesting device and must not already be accepted.
pub(crate) fn apply_decision(
    connection: &mut Connection,
    device_id: &str,
    decision: &ProposalDecisionPayload,
) -> Result<DecisionOutcome, String> {
    let transaction = connection
        .transaction()
        .map_err(|error| format!("failed to start decision transaction: {error}"))?;

    let proposal: Option<(String, String)> = transaction
        .query_row(
            "SELECT device_id, status FROM sync_proposals WHERE id = ?1",
            [&decision.proposal_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|error| format!("failed to read proposal for decision: {error}"))?;

    let Some((owner, _status)) = proposal else {
        return Ok(DecisionOutcome::NotFound);
    };
    if owner != device_id {
        return Ok(DecisionOutcome::NotFound);
    }

    let existing: Option<String> = transaction
        .query_row(
            "SELECT decision FROM sync_proposal_decisions WHERE proposal_id = ?1",
            [&decision.proposal_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| format!("failed to read existing decision: {error}"))?;

    if let Some(previous) = existing {
        if previous == decision.decision {
            return Ok(DecisionOutcome::AlreadyRecorded);
        }
        return Ok(DecisionOutcome::StatusConflict);
    }

    let decided_at = decision.decided_at;
    transaction
        .execute(
            "INSERT INTO sync_proposal_decisions (proposal_id, device_id, decision, decided_at) VALUES (?1, ?2, ?3, ?4)",
            params![decision.proposal_id, device_id, decision.decision, decided_at],
        )
        .map_err(|error| format!("failed to record decision: {error}"))?;
    transaction
        .execute(
            "UPDATE sync_proposals SET status = ?1, decided_at = ?2 WHERE id = ?3",
            params![decision.decision, decided_at, decision.proposal_id],
        )
        .map_err(|error| format!("failed to update proposal status: {error}"))?;

    transaction
        .commit()
        .map_err(|error| format!("failed to commit decision: {error}"))?;
    Ok(DecisionOutcome::Recorded)
}

/// Builds an ack payload for an imported (or idempotently replayed) snapshot.
pub(crate) fn build_snapshot_ack(
    outcome: ImportOutcome,
    received_at_ms: i64,
) -> SnapshotAckPayload {
    let (accepted, counts) = match outcome {
        ImportOutcome::Applied(counts) => (true, counts),
        ImportOutcome::Idempotent(counts) => (true, counts),
    };
    SnapshotAckPayload {
        accepted,
        received_at: received_at_ms,
        entity_counts: counts,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::{Path, PathBuf};

    fn in_memory_connection() -> Connection {
        let connection = Connection::open_in_memory().expect("in-memory db");
        connection
            .execute_batch("PRAGMA foreign_keys = ON;")
            .expect("fk pragma");
        connection
            .execute_batch(include_str!("../../migrations/0008_sync_tables.sql"))
            .expect("sync schema");
        connection
            .execute_batch(include_str!("../../migrations/0009_exam_taxonomy.sql"))
            .expect("exam taxonomy schema");
        connection
            .execute_batch(include_str!("../../migrations/0010_sync_ai_usage.sql"))
            .expect("ai usage schema");
        connection
            .execute_batch(include_str!(
                "../../migrations/0011_sync_learning_analysis.sql"
            ))
            .expect("learning analysis schema");
        connection
            .execute_batch(include_str!(
                "../../migrations/0012_sync_snapshot_received_at_ms.sql"
            ))
            .expect("snapshot received timestamp schema");
        connection
            .execute_batch(include_str!(
                "../../migrations/0013_sync_proposal_source_ids.sql"
            ))
            .expect("proposal source id schema");
        connection
            .execute_batch(include_str!("../../migrations/0014_sync_owner_identity.sql"))
            .expect("owner identity schema");
        connection
    }

    fn valid_snapshot_with_id() -> (String, SnapshotPayload) {
        let envelope: super::super::protocol::Envelope<SnapshotPayload> = serde_json::from_str(
            include_str!("../../../sync/protocol/fixtures/snapshot-valid.json"),
        )
        .expect("fixture snapshot envelope");
        (
            envelope.snapshot_id.expect("fixture snapshot id"),
            envelope.payload,
        )
    }

    fn snapshot_with_analysis_ids(snapshot_id: &str, analysis_id: &str) -> SnapshotPayload {
        let mut snapshot = valid_snapshot_with_id().1;
        let analysis = snapshot
            .learning_analysis
            .as_mut()
            .expect("fixture learning analysis");
        analysis.analysis_id = analysis_id.to_string();
        analysis.source_snapshot_id = snapshot_id.to_string();
        snapshot
    }

    fn seed_test_device(connection: &Connection, device_id: &str) {
        insert_device(
            connection,
            device_id,
            "测试手机",
            &format!("lookup-{device_id}"),
            "test-salt",
            "test-hash",
            "test-pin",
            None,
        )
        .expect("test device");
    }

    struct TempDatabase {
        path: PathBuf,
    }

    impl TempDatabase {
        fn new() -> Self {
            let parent = std::env::temp_dir();
            let timestamp = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system clock")
                .as_nanos();
            let path = parent.join(format!(
                "teacher-agent-sync-test-{}-{timestamp}-{:032x}.sqlite3",
                std::process::id(),
                rand::random::<u128>()
            ));
            assert_eq!(path.parent(), Some(parent.as_path()));
            assert!(
                !path.exists(),
                "temporary database path unexpectedly exists"
            );
            Self { path }
        }
    }

    impl Drop for TempDatabase {
        fn drop(&mut self) {
            let parent = std::env::temp_dir();
            if self.path.parent() != Some(parent.as_path()) {
                return;
            }
            let _ = fs::remove_file(&self.path);
        }
    }

    fn open_production_test_database(path: &Path) -> Connection {
        let connection = Connection::open(path).expect("temporary SQLite database");
        crate::database::apply_migrations(&connection).expect("production migrations");
        connection
    }

    fn valid_snapshot() -> SnapshotPayload {
        serde_json::from_str(include_str!(
            "../../../sync/protocol/fixtures/snapshot-valid.json"
        ))
        .map(|envelope: super::super::protocol::Envelope<SnapshotPayload>| envelope.payload)
        .expect("fixture snapshot payload")
    }

    #[test]
    fn migration_backfills_parseable_received_at_without_rejecting_invalid_rows() {
        let connection = Connection::open_in_memory().expect("in-memory db");
        connection
            .execute_batch(include_str!("../../migrations/0008_sync_tables.sql"))
            .expect("sync schema");
        connection
            .execute_batch(include_str!("../../migrations/0009_exam_taxonomy.sql"))
            .expect("exam taxonomy schema");
        connection
            .execute_batch(include_str!("../../migrations/0010_sync_ai_usage.sql"))
            .expect("ai usage schema");
        connection
            .execute_batch(include_str!(
                "../../migrations/0011_sync_learning_analysis.sql"
            ))
            .expect("learning analysis schema");
        connection
            .execute(
                "INSERT INTO sync_snapshots
                   (id, device_id, received_at, status, subject_count, goal_count, task_count, session_count)
                 VALUES ('old-valid', 'device', '2026-08-10T12:34:56.789Z', 'applied', 0, 0, 0, 0)",
                [],
            )
            .expect("old valid snapshot");
        connection
            .execute(
                "INSERT INTO sync_snapshots
                   (id, device_id, received_at, status, subject_count, goal_count, task_count, session_count)
                 VALUES ('old-invalid', 'device', 'not-an-iso-time', 'applied', 0, 0, 0, 0)",
                [],
            )
            .expect("old invalid snapshot");

        connection
            .execute_batch(include_str!(
                "../../migrations/0012_sync_snapshot_received_at_ms.sql"
            ))
            .expect("received timestamp migration");
        connection
            .execute_batch(include_str!(
                "../../migrations/0013_sync_proposal_source_ids.sql"
            ))
            .expect("proposal source id migration");

        let valid: i64 = connection
            .query_row(
                "SELECT received_at_ms FROM sync_snapshots WHERE id = 'old-valid'",
                [],
                |row| row.get(0),
            )
            .expect("backfilled timestamp");
        assert_eq!(valid, 1_786_365_296_789);
        let invalid: Option<i64> = connection
            .query_row(
                "SELECT received_at_ms FROM sync_snapshots WHERE id = 'old-invalid'",
                [],
                |row| row.get(0),
            )
            .expect("invalid timestamp remains nullable");
        assert!(invalid.is_none());
    }

    #[test]
    fn canonical_snapshot_import_persists_and_rebuilds_after_file_reopen() {
        let temporary = TempDatabase::new();
        let (snapshot_id, snapshot) = valid_snapshot_with_id();
        let analysis_id = snapshot
            .learning_analysis
            .as_ref()
            .expect("fixture learning analysis")
            .analysis_id
            .clone();
        let device_id = "f0a24c19-0f8e-4b6d-9a3c-77e1b2d4c5a6";

        let mut connection = open_production_test_database(&temporary.path);
        seed_test_device(&connection, device_id);
        import_snapshot(&mut connection, device_id, &snapshot_id, &snapshot, 1)
            .expect("canonical snapshot import");
        let before = load_read_model(&connection, device_id).expect("read model before reopen");
        assert_eq!(before.subjects.len(), snapshot.subjects.len());
        assert_eq!(before.weekly_goals.len(), snapshot.weekly_goals.len());
        assert_eq!(before.tasks.len(), snapshot.tasks.len());
        assert_eq!(before.study_sessions.len(), snapshot.study_sessions.len());
        let expected_goal = &snapshot.weekly_goals[0];
        let before_goal = before
            .weekly_goals
            .iter()
            .find(|goal| goal.remote_id == expected_goal.remote_id)
            .expect("canonical goal in read model");
        assert_eq!(
            before_goal.source_proposal_id,
            expected_goal.source_proposal_id
        );
        let expected_task = &snapshot.tasks[0];
        let before_task = before
            .tasks
            .iter()
            .find(|task| task.remote_id == expected_task.remote_id)
            .expect("canonical task in read model");
        assert_eq!(
            before_task.source_proposal_id,
            expected_task.source_proposal_id
        );
        let before_analysis = before
            .latest_learning_analysis
            .as_ref()
            .expect("analysis before reopen");
        assert_eq!(before_analysis.analysis_id, analysis_id);
        assert_eq!(before_analysis.source_snapshot_id, snapshot_id);
        assert_eq!(before_analysis.generator, "deterministic_fallback");
        let before_json = serde_json::to_string(&before).expect("serialize read model");
        let snapshot_received_at_ms: i64 = connection
            .query_row(
                "SELECT received_at_ms FROM sync_snapshots WHERE id = ?1",
                [&snapshot_id],
                |row| row.get(0),
            )
            .expect("received timestamp");
        assert_eq!(snapshot_received_at_ms, 1);
        let snapshot_rows: i64 = connection
            .query_row("SELECT COUNT(1) FROM sync_snapshots", [], |row| row.get(0))
            .expect("snapshot row count");
        let analysis_rows: i64 = connection
            .query_row("SELECT COUNT(1) FROM sync_learning_analyses", [], |row| {
                row.get(0)
            })
            .expect("analysis row count");
        assert_eq!(snapshot_rows, 1);
        assert_eq!(analysis_rows, 1);
        drop(connection);

        let reopened = open_production_test_database(&temporary.path);
        assert!(!crate::database::apply_migrations(&reopened).expect("idempotent migrations"));
        let after = load_read_model(&reopened, device_id).expect("read model after reopen");
        assert_eq!(
            serde_json::to_string(&after).expect("serialize reopened read model"),
            before_json
        );
        let after_analysis = after
            .latest_learning_analysis
            .as_ref()
            .expect("analysis after reopen");
        assert_eq!(after_analysis.analysis_id, analysis_id);
        assert_eq!(after_analysis.source_snapshot_id, snapshot_id);
        assert_eq!(after_analysis.generator, "deterministic_fallback");
        let user_version: i64 = reopened
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .expect("SQLite user version");
        assert_eq!(user_version, 14);
        let reopened_snapshot_rows: i64 = reopened
            .query_row("SELECT COUNT(1) FROM sync_snapshots", [], |row| row.get(0))
            .expect("reopened snapshot row count");
        let reopened_analysis_rows: i64 = reopened
            .query_row("SELECT COUNT(1) FROM sync_learning_analyses", [], |row| {
                row.get(0)
            })
            .expect("reopened analysis row count");
        assert_eq!(reopened_snapshot_rows, 1);
        assert_eq!(reopened_analysis_rows, 1);
    }

    #[test]
    fn old_snapshot_without_source_proposal_ids_roundtrips_as_null() {
        let mut connection = in_memory_connection();
        let device_id = "f0a24c19-0f8e-4b6d-9a3c-77e1b2d4c5a6";
        let mut snapshot = valid_snapshot();
        for goal in &mut snapshot.weekly_goals {
            goal.source_proposal_id = None;
        }
        for task in &mut snapshot.tasks {
            task.source_proposal_id = None;
        }
        let snapshot_id = "77777777-7777-4777-8777-777777777777";
        snapshot
            .learning_analysis
            .as_mut()
            .expect("legacy fixture learning analysis")
            .source_snapshot_id = snapshot_id.to_string();

        import_snapshot(&mut connection, device_id, snapshot_id, &snapshot, 1)
            .expect("legacy snapshot import");

        let model = load_read_model(&connection, device_id).expect("legacy read model");
        assert!(model
            .weekly_goals
            .iter()
            .all(|goal| goal.source_proposal_id.is_none()));
        assert!(model
            .tasks
            .iter()
            .all(|task| task.source_proposal_id.is_none()));
    }

    #[test]
    fn latest_snapshot_uses_insert_order_before_id_for_equal_received_times() {
        let mut connection = in_memory_connection();
        let device_id = "f0a24c19-0f8e-4b6d-9a3c-77e1b2d4c5a6";
        // A intentionally sorts after B lexicographically. If rowid is not
        // used, id DESC would incorrectly select A despite B being imported later.
        let snapshot_a_id = "ffffffff-ffff-4fff-8fff-ffffffffffff";
        let snapshot_b_id = "00000000-0000-4000-8000-000000000000";
        let snapshot_a =
            snapshot_with_analysis_ids(snapshot_a_id, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
        let snapshot_b =
            snapshot_with_analysis_ids(snapshot_b_id, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");

        import_snapshot(&mut connection, device_id, snapshot_a_id, &snapshot_a, 100)
            .expect("snapshot A");
        import_snapshot(&mut connection, device_id, snapshot_b_id, &snapshot_b, 100)
            .expect("snapshot B");
        connection
            .execute(
                "UPDATE sync_snapshots SET received_at = '2026-08-11T00:00:00.000Z' WHERE id IN (?1, ?2)",
                params![snapshot_a_id, snapshot_b_id],
            )
            .expect("same received_at text");

        let last = last_snapshot(&connection, device_id)
            .expect("last snapshot")
            .expect("snapshot exists");
        assert_eq!(last.snapshot_id, snapshot_b_id);
        let model = load_read_model(&connection, device_id).expect("read model");
        assert_eq!(
            model
                .latest_learning_analysis
                .expect("latest analysis")
                .source_snapshot_id,
            snapshot_b_id
        );
    }

    #[test]
    fn latest_snapshot_without_analysis_does_not_fallback_to_older_analysis() {
        let mut connection = in_memory_connection();
        let device_id = "f0a24c19-0f8e-4b6d-9a3c-77e1b2d4c5a6";
        let snapshot_a_id = "33333333-3333-4333-8333-333333333333";
        let snapshot_b_id = "44444444-4444-4444-8444-444444444444";
        let snapshot_a =
            snapshot_with_analysis_ids(snapshot_a_id, "cccccccc-cccc-4ccc-8ccc-cccccccccccc");
        let mut snapshot_b = snapshot_a.clone();
        snapshot_b.learning_analysis = None;

        import_snapshot(&mut connection, device_id, snapshot_a_id, &snapshot_a, 100)
            .expect("snapshot A");
        import_snapshot(&mut connection, device_id, snapshot_b_id, &snapshot_b, 200)
            .expect("snapshot B");

        let last = last_snapshot(&connection, device_id)
            .expect("last snapshot")
            .expect("snapshot exists");
        assert_eq!(last.snapshot_id, snapshot_b_id);
        let model = load_read_model(&connection, device_id).expect("read model");
        assert!(!model.subjects.is_empty());
        assert!(model.latest_learning_analysis.is_none());
    }

    #[test]
    fn snapshot_import_rolls_back_mid_transaction_analysis_conflict() {
        let mut connection = in_memory_connection();
        let device_id = "f0a24c19-0f8e-4b6d-9a3c-77e1b2d4c5a6";
        let snapshot_a_id = "55555555-5555-4555-8555-555555555555";
        let snapshot_b_id = "66666666-6666-4666-8666-666666666666";
        seed_test_device(&connection, device_id);
        let snapshot_a =
            snapshot_with_analysis_ids(snapshot_a_id, "dddddddd-dddd-4ddd-8ddd-dddddddddddd");
        import_snapshot(&mut connection, device_id, snapshot_a_id, &snapshot_a, 100)
            .expect("snapshot A");
        let before_model = load_read_model(&connection, device_id).expect("old read model");
        let before_model_json =
            serde_json::to_string(&before_model).expect("serialize old read model");
        let before_last_sync: Option<String> = connection
            .query_row(
                "SELECT last_sync_at FROM sync_devices WHERE id = ?1",
                [device_id],
                |row| row.get(0),
            )
            .expect("old last sync");

        let snapshot_b =
            snapshot_with_analysis_ids(snapshot_b_id, "dddddddd-dddd-4ddd-8ddd-dddddddddddd");
        let error = import_snapshot(&mut connection, device_id, snapshot_b_id, &snapshot_b, 200)
            .expect_err("duplicate analysis id must fail inside transaction");
        assert!(error.contains("learning analysis"));

        let after_model = load_read_model(&connection, device_id).expect("restored read model");
        assert_eq!(
            serde_json::to_string(&after_model).expect("serialize restored read model"),
            before_model_json
        );
        let after_last_sync: Option<String> = connection
            .query_row(
                "SELECT last_sync_at FROM sync_devices WHERE id = ?1",
                [device_id],
                |row| row.get(0),
            )
            .expect("restored last sync");
        assert_eq!(after_last_sync, before_last_sync);
        let snapshot_b_rows: i64 = connection
            .query_row(
                "SELECT COUNT(1) FROM sync_snapshots WHERE id = ?1",
                [snapshot_b_id],
                |row| row.get(0),
            )
            .expect("snapshot B row count");
        let snapshot_rows: i64 = connection
            .query_row("SELECT COUNT(1) FROM sync_snapshots", [], |row| row.get(0))
            .expect("snapshot row count");
        let analysis_rows: i64 = connection
            .query_row("SELECT COUNT(1) FROM sync_learning_analyses", [], |row| {
                row.get(0)
            })
            .expect("analysis row count");
        assert_eq!(snapshot_b_rows, 0);
        assert_eq!(snapshot_rows, 1);
        assert_eq!(analysis_rows, 1);
    }

    #[test]
    fn snapshot_import_preserves_declared_exam_fields() {
        let mut connection = in_memory_connection();
        let device = "f0a24c19-0f8e-4b6d-9a3c-77e1b2d4c5a6";
        let mut snapshot = valid_snapshot();
        snapshot.subjects[0].exam_track_id = Some("408".to_string());
        snapshot.subjects[0].exam_subject_id = Some("408.computer-networks".to_string());
        snapshot.subjects[0].exam_module_id = None;
        import_snapshot(
            &mut connection,
            device,
            "5e8f2a91-b3c4-4d5e-9f01-23456789abcd",
            &snapshot,
            1,
        )
        .expect("import");

        let model = load_read_model(&connection, device).expect("read model");
        let subject = model
            .subjects
            .iter()
            .find(|s| s.remote_id == snapshot.subjects[0].remote_id)
            .expect("subject");
        assert_eq!(subject.exam_track_id.as_deref(), Some("408"));
        assert_eq!(
            subject.exam_subject_id.as_deref(),
            Some("408.computer-networks")
        );
        // 旧快照（无 exam 字段）也保持可读：其余科目为 None（按 remoteId 定位，避免顺序假设）。
        const OTHER_REMOTE_ID: &str = "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e";
        let other = model
            .subjects
            .iter()
            .find(|s| s.remote_id == OTHER_REMOTE_ID)
            .expect("other subject");
        assert_eq!(other.exam_subject_id, None);
    }

    #[test]
    fn snapshot_import_is_idempotent() {
        let mut connection = in_memory_connection();
        let device = "f0a24c19-0f8e-4b6d-9a3c-77e1b2d4c5a6";
        let snapshot = valid_snapshot();
        let snapshot_id = "5e8f2a91-b3c4-4d5e-9f01-23456789abcd";

        let first =
            import_snapshot(&mut connection, device, snapshot_id, &snapshot, 1).expect("import");
        assert!(matches!(first, ImportOutcome::Applied(_)));

        // Replay the same snapshotId: no double import, and the ack counts echo
        // the stored snapshot (the phone validates them against what it sent).
        let second =
            import_snapshot(&mut connection, device, snapshot_id, &snapshot, 2).expect("replay");
        assert_eq!(
            second,
            ImportOutcome::Idempotent(EntityCounts {
                subjects: 3,
                weekly_goals: 5,
                tasks: 4,
                study_sessions: 5,
            })
        );

        let model = load_read_model(&connection, device).expect("read model");
        assert_eq!(model.subjects.len(), 3);
        assert_eq!(model.tasks.len(), 4);
        assert_eq!(model.study_sessions.len(), 5);
        assert_eq!(model.weekly_goals.len(), 5);
    }

    #[test]
    fn snapshot_import_replaces_previous_read_model() {
        let mut connection = in_memory_connection();
        let device = "f0a24c19-0f8e-4b6d-9a3c-77e1b2d4c5a6";
        let mut snapshot = valid_snapshot();
        snapshot
            .learning_analysis
            .as_mut()
            .expect("fixture learning analysis")
            .source_snapshot_id = "11111111-1111-4111-8111-111111111111".to_string();
        import_snapshot(
            &mut connection,
            device,
            "11111111-1111-4111-8111-111111111111",
            &snapshot,
            1,
        )
        .expect("import 1");

        // A later snapshot with only one subject replaces the whole model.
        let smaller = SnapshotPayload {
            subjects: vec![super::super::protocol::SubjectDto {
                remote_id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee".to_string(),
                name: "新科目".to_string(),
                color: None,
                icon: None,
                sort_order: 0,
                is_archived: false,
                created_at: 1,
                updated_at: 1,
                deleted_at: None,
                exam_track_id: Some("408".to_string()),
                exam_subject_id: Some("408.computer-networks".to_string()),
                exam_module_id: None,
            }],
            weekly_goals: vec![],
            tasks: vec![],
            study_sessions: vec![],
            learning_analysis: None,
        };
        import_snapshot(
            &mut connection,
            device,
            "22222222-2222-4222-8222-222222222222",
            &smaller,
            2,
        )
        .expect("import 2");

        let model = load_read_model(&connection, device).expect("read model");
        assert_eq!(model.subjects.len(), 1);
        assert_eq!(model.tasks.len(), 0);
        assert_eq!(model.study_sessions.len(), 0);
    }

    #[test]
    fn corrupted_learning_analysis_does_not_break_the_read_model() {
        let mut connection = in_memory_connection();
        let device = "f0a24c19-0f8e-4b6d-9a3c-77e1b2d4c5a6";
        let snapshot = valid_snapshot();
        let snapshot_id = "5e8f2a91-b3c4-4d5e-9f01-23456789abcd";
        import_snapshot(&mut connection, device, snapshot_id, &snapshot, 1).expect("import");
        connection
            .execute(
                "UPDATE sync_learning_analyses SET payload_json = 'not-json' WHERE snapshot_id = ?1",
                [snapshot_id],
            )
            .expect("corrupt cached analysis");

        let model =
            load_read_model(&connection, device).expect("other read model data remains readable");

        assert!(!model.subjects.is_empty());
        assert!(!model.tasks.is_empty());
        assert!(model.latest_learning_analysis.is_none());
    }

    #[test]
    fn semantically_invalid_learning_analysis_does_not_break_the_read_model() {
        let mut connection = in_memory_connection();
        let device = "f0a24c19-0f8e-4b6d-9a3c-77e1b2d4c5a6";
        let snapshot = valid_snapshot();
        let snapshot_id = "5e8f2a91-b3c4-4d5e-9f01-23456789abcd";
        import_snapshot(&mut connection, device, snapshot_id, &snapshot, 1).expect("import");
        let payload_json: String = connection
            .query_row(
                "SELECT payload_json FROM sync_learning_analyses WHERE snapshot_id = ?1",
                [snapshot_id],
                |row| row.get(0),
            )
            .expect("cached analysis");
        let mut payload: serde_json::Value =
            serde_json::from_str(&payload_json).expect("valid cached analysis json");
        payload["profile"]["facts"][0]["evidenceRefs"] = serde_json::json!(["invented-evidence"]);
        connection
            .execute(
                "UPDATE sync_learning_analyses SET payload_json = ?1 WHERE snapshot_id = ?2",
                params![payload.to_string(), snapshot_id],
            )
            .expect("corrupt cached analysis semantics");

        let model =
            load_read_model(&connection, device).expect("other read model data remains readable");

        assert!(!model.subjects.is_empty());
        assert!(!model.tasks.is_empty());
        assert!(model.latest_learning_analysis.is_none());
    }

    #[test]
    fn device_credential_flow() {
        let mut connection = in_memory_connection();
        let device = "f0a24c19-0f8e-4b6d-9a3c-77e1b2d4c5a6";
        let token_hash = sha256_hex(b"token-value");
        insert_pairing_token(&connection, &token_hash, device, unix_ms_now() + 600_000)
            .expect("token");

        let transaction = connection.transaction().expect("tx");
        let consumed = consume_pairing_token(&transaction, &token_hash, device, unix_ms_now())
            .expect("consume");
        assert!(consumed);
        transaction.commit().expect("commit");

        // Second consumption attempt fails.
        let transaction = connection.transaction().expect("tx");
        let again = consume_pairing_token(&transaction, &token_hash, device, unix_ms_now())
            .expect("consume");
        assert!(!again);
        transaction.commit().expect("commit");
    }

    #[test]
    fn revoked_device_cannot_authenticate() {
        let connection = in_memory_connection();
        let device = "f0a24c19-0f8e-4b6d-9a3c-77e1b2d4c5a6";
        let credential = "secret-credential-1234567890";
        let salt = "salt";
        let hash = credential_hash(salt, credential);
        let lookup = credential_lookup_key(credential);
        insert_device(
            &connection,
            device,
            "测试手机",
            &lookup,
            salt,
            &hash,
            "aabbcc",
            None,
        )
        .expect("device");
        assert!(find_device_by_credential(&connection, credential)
            .expect("found")
            .is_some());
        // Wrong credential must fail.
        assert!(
            find_device_by_credential(&connection, "wrong-credential-99999")
                .expect("not found")
                .is_none()
        );

        revoke_device(&connection, device).expect("revoke");
        assert!(find_device_by_credential(&connection, credential)
            .expect("gone")
            .is_none());
    }

    #[test]
    fn proposal_decision_idempotency_and_conflict() {
        let mut connection = in_memory_connection();
        let device = "f0a24c19-0f8e-4b6d-9a3c-77e1b2d4c5a6";
        let proposal_id = "9c2d6e5f-4a7b-4c8d-9e0f-1a2b3c4d5e6f";

        create_proposal(
            &mut connection,
            &ProposalDto {
                proposal_id: proposal_id.to_string(),
                device_id: device.to_string(),
                version: 1,
                status: "pending".to_string(),
                rationale: "测试建议".to_string(),
                proposed_weekly_goals: vec![],
                proposed_tasks: vec![],
                source_assessment_ids: vec![],
                created_at: unix_ms_now(),
                expires_at: None,
            },
        )
        .expect("proposal");

        let decision = ProposalDecisionPayload {
            proposal_id: proposal_id.to_string(),
            decision: "accepted".to_string(),
            decided_at: unix_ms_now(),
        };
        assert_eq!(
            apply_decision(&mut connection, device, &decision).expect("apply"),
            DecisionOutcome::Recorded
        );
        // Replay: idempotent.
        assert_eq!(
            apply_decision(&mut connection, device, &decision).expect("replay"),
            DecisionOutcome::AlreadyRecorded
        );
        // Changing to rejected after accepted is a conflict.
        let conflict = ProposalDecisionPayload {
            proposal_id: proposal_id.to_string(),
            decision: "rejected".to_string(),
            decided_at: unix_ms_now(),
        };
        assert_eq!(
            apply_decision(&mut connection, device, &conflict).expect("conflict"),
            DecisionOutcome::StatusConflict
        );

        let proposals = list_proposals(&connection, device, None, 10).expect("list");
        assert_eq!(proposals.len(), 1);
        assert_eq!(proposals[0].status, "accepted");
    }

    #[test]
    fn new_proposal_supersedes_pending() {
        let mut connection = in_memory_connection();
        let device = "f0a24c19-0f8e-4b6d-9a3c-77e1b2d4c5a6";
        for (index, id) in [
            "11111111-1111-4111-8111-111111111111",
            "22222222-2222-4222-8222-222222222222",
        ]
        .iter()
        .enumerate()
        {
            create_proposal(
                &mut connection,
                &ProposalDto {
                    proposal_id: id.to_string(),
                    device_id: device.to_string(),
                    version: 1,
                    status: "pending".to_string(),
                    rationale: format!("建议 {index}"),
                    proposed_weekly_goals: vec![],
                    proposed_tasks: vec![],
                    source_assessment_ids: vec![],
                    created_at: unix_ms_now() + index as i64,
                    expires_at: None,
                },
            )
            .expect("proposal");
        }
        let proposals = list_proposals(&connection, device, None, 10).expect("list");
        assert_eq!(proposals.len(), 2);
        assert_eq!(proposals[0].status, "pending"); // newest
        assert_eq!(proposals[1].status, "superseded");
    }

    #[test]
    fn proposals_use_stable_keyset_pagination_for_equal_timestamps() {
        let mut connection = in_memory_connection();
        let device = "f0a24c19-0f8e-4b6d-9a3c-77e1b2d4c5a6";
        let created_at = 1_800_000_000_000;
        let ids: Vec<String> = (0..7)
            .map(|index| format!("00000000-0000-4000-8000-{index:012}"))
            .collect();
        for id in &ids {
            create_proposal(
                &mut connection,
                &ProposalDto {
                    proposal_id: id.clone(),
                    device_id: device.to_string(),
                    version: 1,
                    status: "pending".to_string(),
                    rationale: "分页测试".to_string(),
                    proposed_weekly_goals: vec![],
                    proposed_tasks: vec![],
                    source_assessment_ids: vec![],
                    created_at,
                    expires_at: None,
                },
            )
            .expect("proposal");
        }

        let mut seen = Vec::new();
        let mut cursor = None;
        loop {
            let page = list_proposals(&connection, device, cursor.as_deref(), 3).expect("page");
            if page.is_empty() {
                break;
            }
            cursor = page.last().map(|proposal| proposal.proposal_id.clone());
            seen.extend(page.into_iter().map(|proposal| proposal.proposal_id));
        }

        let mut expected = ids;
        expected.sort_by(|left, right| right.cmp(left));
        assert_eq!(seen, expected);

        assert_eq!(
            list_proposals(&connection, device, Some("missing-cursor"), 3)
                .expect_err("invalid cursor must fail closed"),
            ProposalListError::InvalidCursor
        );
        let other_device = "a0a24c19-0f8e-4b6d-9a3c-77e1b2d4c5a6";
        assert_eq!(
            list_proposals(&connection, other_device, Some(&seen[0]), 3)
                .expect_err("foreign cursor must fail closed"),
            ProposalListError::InvalidCursor
        );
    }

    #[test]
    fn revoke_is_idempotent_and_blocks_old_credential() {
        let connection = in_memory_connection();
        let device = "f0a24c19-0f8e-4b6d-9a3c-77e1b2d4c5a6";
        let credential = "secret-credential-1234567890";
        let salt = "salt";
        let hash = credential_hash(salt, credential);
        let lookup = credential_lookup_key(credential);
        insert_device(
            &connection,
            device,
            "测试手机",
            &lookup,
            salt,
            &hash,
            "aabbcc",
            None,
        )
        .expect("device");

        // 第一次撤销成功；重复撤销幂等返回 false。
        assert!(revoke_device(&connection, device).expect("revoke once"));
        assert!(!revoke_device(&connection, device).expect("revoke again is idempotent"));

        // 撤销后旧凭据立即失效。
        assert!(find_device_by_credential(&connection, credential)
            .expect("credential gone")
            .is_none());
    }

    #[test]
    fn subject_mapping_upsert() {
        let connection = in_memory_connection();
        let device = "f0a24c19-0f8e-4b6d-9a3c-77e1b2d4c5a6";
        seed_test_device(&connection, device);
        set_mapping(
            &connection,
            device,
            "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
            "math",
            None,
            None,
            None,
        )
        .expect("set");
        set_mapping(
            &connection,
            device,
            "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
            "cs408",
            Some("408".to_string()),
            Some("408.computer-networks".to_string()),
            None,
        )
        .expect("update");
        let mappings = list_mappings(&connection, device).expect("list");
        assert_eq!(mappings.len(), 1);
        assert_eq!(mappings[0].teacher_subject_id, "cs408");
        assert_eq!(
            mappings[0].exam_subject_id.as_deref(),
            Some("408.computer-networks")
        );
        assert_eq!(mappings[0].exam_track_id.as_deref(), Some("408"));
        remove_mapping(&connection, device, "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d")
            .expect("remove");
        assert!(list_mappings(&connection, device).expect("list").is_empty());
    }

    #[test]
    fn foreign_key_validator_rejects_bad_snapshot_before_db_touch() {
        let text =
            include_str!("../../../sync/protocol/fixtures/snapshot-foreign-key-mismatch.json");
        let envelope: super::super::protocol::Envelope<SnapshotPayload> =
            serde_json::from_str(text).expect("parse");
        let errors =
            super::super::protocol::validate_snapshot(&envelope.payload).expect_err("reject");
        assert!(!errors.is_empty());
    }
}
