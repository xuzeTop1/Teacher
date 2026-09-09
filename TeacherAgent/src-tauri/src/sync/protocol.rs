//! AlertTime <-> TeacherAgent LAN sync protocol v1: DTOs and validation.
//! Canonical spec: sync/protocol/protocol.md (identical copy in both repos).

use serde::{Deserialize, Deserializer, Serialize};

pub(crate) const PROTOCOL_FORMAT: &str = "alerttime-teacher-sync";
pub(crate) const SCHEMA_VERSION: i64 = 1;

/// Request body limit for the sync HTTP server (bytes).
pub(crate) const MAX_SYNC_BYTES: usize = 8 * 1024 * 1024;

pub(crate) const MAX_COLLECTION_SIZE_SUBJECTS: usize = 5_000;
pub(crate) const MAX_COLLECTION_SIZE_WEEKLY_GOALS: usize = 50_000;
pub(crate) const MAX_COLLECTION_SIZE_TASKS: usize = 100_000;
pub(crate) const MAX_COLLECTION_SIZE_SESSIONS: usize = 200_000;

pub(crate) const MAX_STRING_LENGTH: usize = 20_000;
pub(crate) const MAX_TITLE_LENGTH: usize = 200;
pub(crate) const MAX_NAME_LENGTH: usize = 100;
pub(crate) const MAX_ID_LENGTH: usize = 64;
pub(crate) const MIN_ID_LENGTH: usize = 8;

pub(crate) const MAX_PROPOSED_WEEKLY_GOALS: usize = 20;
pub(crate) const MAX_PROPOSED_TASKS: usize = 100;
pub(crate) const MAX_SOURCE_ASSESSMENT_IDS: usize = 200;
pub(crate) const MAX_PROPOSED_SUCCESS_CRITERIA_LENGTH: usize = 2_000;
pub(crate) const MAX_ANALYSIS_QUESTIONS: usize = 50;
pub(crate) const MAX_ANALYSIS_WARNINGS: usize = 50;

/// Envelope shared by every message. Unknown JSON fields are ignored; missing
/// required fields fail deserialization (whole batch rejected).
#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Envelope<T> {
    pub format: String,
    pub schema_version: i64,
    pub message_type: String,
    pub device_id: String,
    pub snapshot_id: Option<String>,
    pub generated_at: i64,
    pub app_version: Option<String>,
    pub protocol_capabilities: Option<serde_json::Value>,
    pub cursor: Option<serde_json::Value>,
    pub payload: T,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SnapshotPayload {
    pub subjects: Vec<SubjectDto>,
    pub weekly_goals: Vec<WeeklyGoalDto>,
    pub tasks: Vec<TaskDto>,
    pub study_sessions: Vec<StudySessionDto>,
    /// Android 端每次同步生成的学习分析。缺失时兼容旧版快照；新版客户端必须生成。
    #[serde(default)]
    pub learning_analysis: Option<LearningAnalysisDto>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LearningAnalysisDto {
    pub analysis_id: String,
    pub source_snapshot_id: String,
    pub generated_at: i64,
    pub prompt_version: String,
    pub generator: String,
    /// Android 端声明的输入范围审计摘要（可选）。缺失时兼容旧版客户端；
    /// 存在时必须与同一快照的未软删除实体计数完全一致（见 validate_learning_analysis）。
    #[serde(default)]
    pub input_summary: Option<LearningInputSummaryDto>,
    pub profile: LearningProfileDto,
    pub plan_evaluation: PlanEvaluationDto,
    pub assessment_draft: AssessmentDraftDto,
    pub warnings: Vec<String>,
}

/// 固定语义标识：inputSummary 只描述本次同一分析输入的计数，不含 ID 或正文。
pub(crate) const LEARNING_INPUT_SUMMARY_SOURCE: &str = "same_analysis_input_v1";

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LearningInputSummaryDto {
    pub subject_count: i64,
    pub weekly_goal_count: i64,
    pub task_count: i64,
    pub completed_session_count: i64,
    pub source: String,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LearningProfileDto {
    pub facts: Vec<LearningFactDto>,
    pub inferences: Vec<LearningInferenceDto>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LearningFactDto {
    pub code: String,
    pub label: String,
    pub value: serde_json::Value,
    pub evidence_refs: Vec<String>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LearningInferenceDto {
    pub statement: String,
    pub confidence: f64,
    pub evidence_refs: Vec<String>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PlanEvaluationDto {
    pub verdict: String,
    #[serde(deserialize_with = "deserialize_required_nullable")]
    pub score: Option<f64>,
    pub dimensions: Vec<PlanEvaluationDimensionDto>,
    pub risks: Vec<String>,
    pub suggestions: Vec<String>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PlanEvaluationDimensionDto {
    pub code: String,
    #[serde(deserialize_with = "deserialize_required_nullable")]
    pub score: Option<f64>,
    pub summary: String,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AssessmentDraftDto {
    pub status: String,
    pub scope_summary: String,
    pub questions: Vec<AssessmentDraftQuestionDto>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AssessmentDraftQuestionDto {
    pub question_id: String,
    pub subject_remote_id: Option<String>,
    pub task_remote_id: Option<String>,
    pub r#type: String,
    pub prompt: String,
    pub rationale: String,
    pub rubric: Vec<String>,
}

fn deserialize_required_nullable<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(deserializer)
}

// The protocol ignores future fields in general, but assessment drafts have
// one deliberate fail-closed exception: generated questions must never carry
// an answer or solution payload. Keep this check at deserialization time so a
// server cannot accidentally persist such fields before semantic validation.
impl<'de> Deserialize<'de> for AssessmentDraftQuestionDto {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = serde_json::Value::deserialize(deserializer)?;
        let object = value
            .as_object()
            .ok_or_else(|| serde::de::Error::custom("assessmentDraft.question 必须是对象"))?;
        if let Some(key) = object.keys().find(|key| {
            let normalized = key.to_ascii_lowercase();
            normalized.contains("answer")
                || normalized.contains("solution")
                || normalized == "explanation"
        }) {
            return Err(serde::de::Error::custom(format!(
                "assessmentDraft.question 禁止字段: {key}"
            )));
        }
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Fields {
            question_id: String,
            subject_remote_id: Option<String>,
            task_remote_id: Option<String>,
            r#type: String,
            prompt: String,
            rationale: String,
            rubric: Vec<String>,
        }
        let fields: Fields = serde_json::from_value(value).map_err(serde::de::Error::custom)?;
        Ok(Self {
            question_id: fields.question_id,
            subject_remote_id: fields.subject_remote_id,
            task_remote_id: fields.task_remote_id,
            r#type: fields.r#type,
            prompt: fields.prompt,
            rationale: fields.rationale,
            rubric: fields.rubric,
        })
    }
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SubjectDto {
    pub remote_id: String,
    pub name: String,
    pub color: Option<String>,
    pub icon: Option<String>,
    pub sort_order: i64,
    pub is_archived: bool,
    pub created_at: i64,
    pub updated_at: i64,
    pub deleted_at: Option<i64>,
    /// 考试体系归属（可选，v1 扩展）：手机端声明，仅作展示与映射建议。
    /// 旧版手机端不发送这些字段（serde default → None），必须兼容。
    #[serde(default)]
    pub exam_track_id: Option<String>,
    #[serde(default)]
    pub exam_subject_id: Option<String>,
    #[serde(default)]
    pub exam_module_id: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WeeklyGoalDto {
    pub remote_id: String,
    pub week_start: i64,
    pub title: String,
    pub success_criteria: Option<String>,
    /// Proposal that the phone user explicitly accepted before creating this goal.
    /// Missing/null is the compatibility-safe representation for a manual goal.
    #[serde(default)]
    pub source_proposal_id: Option<String>,
    pub status: i64,
    pub completed_at: Option<i64>,
    pub deferred_to_week_start: Option<i64>,
    pub exception_reason: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub deleted_at: Option<i64>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TaskDto {
    pub remote_id: String,
    pub subject_remote_id: Option<String>,
    pub title: String,
    pub content: Option<String>,
    /// Proposal that the phone user explicitly accepted before creating this task.
    /// Missing/null is the compatibility-safe representation for a manual task.
    #[serde(default)]
    pub source_proposal_id: Option<String>,
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

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StudySessionDto {
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
    /// AI 使用时间（可选，v1 扩展）：旧版手机端不发送（serde default），必须兼容。
    #[serde(default)]
    pub ai_help_seconds: i64,
    #[serde(default)]
    pub ai_help_count: i64,
    #[serde(default)]
    pub external_ai_app_seconds: Option<i64>,
    #[serde(default)]
    pub ai_usage_source: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PairPayload {
    pub token: String,
    pub device_id: String,
    /// 手机端安装期生成的稳定身份标识（跨重配对保持不变，用于归属用户配置如学科映射）。
    #[serde(default)]
    pub owner_identity: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PairAckPayload {
    pub credential: String,
    pub device_id: String,
    pub display_name: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SnapshotAckPayload {
    pub accepted: bool,
    pub received_at: i64,
    pub entity_counts: EntityCounts,
}

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EntityCounts {
    pub subjects: usize,
    pub weekly_goals: usize,
    pub tasks: usize,
    pub study_sessions: usize,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DecisionAckPayload {
    pub proposal_id: String,
    pub decision: String,
    pub recorded: bool,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProposalDto {
    pub proposal_id: String,
    pub device_id: String,
    pub version: i64,
    pub status: String,
    pub rationale: String,
    pub proposed_weekly_goals: Vec<ProposedWeeklyGoalDto>,
    pub proposed_tasks: Vec<ProposedTaskDto>,
    pub source_assessment_ids: Vec<String>,
    pub created_at: i64,
    pub expires_at: Option<i64>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProposedWeeklyGoalDto {
    pub week_start: i64,
    pub title: String,
    pub success_criteria: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProposedTaskDto {
    pub title: String,
    pub subject_remote_id: Option<String>,
    pub target_duration_seconds: Option<i64>,
    pub due_at: Option<i64>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProposalsListPayload {
    pub proposals: Vec<ProposalDto>,
    pub next_cursor: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProposalDecisionPayload {
    pub proposal_id: String,
    pub decision: String,
    pub decided_at: i64,
}

/// Structured error returned by the sync HTTP server. `message` must never
/// contain tokens, credentials or certificate private keys.
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ApiErrorDto {
    pub code: String,
    pub message: String,
}

#[derive(Debug, Clone)]
pub(crate) struct ApiError {
    pub status: u16,
    pub code: &'static str,
    pub message: String,
}

impl ApiError {
    pub(crate) fn new(status: u16, code: &'static str, message: impl Into<String>) -> Self {
        Self {
            status,
            code,
            message: message.into(),
        }
    }
    pub(crate) fn into_response(self) -> axum::response::Response {
        let body = serde_json::to_vec(&ApiErrorDto {
            code: self.code.into(),
            message: self.message,
        })
        .unwrap_or_else(|_| br#"{"code":"internal","message":"internal error"}"#.to_vec());
        axum::response::Response::builder()
            .status(
                axum::http::StatusCode::from_u16(self.status)
                    .unwrap_or(axum::http::StatusCode::INTERNAL_SERVER_ERROR),
            )
            .header(
                axum::http::header::CONTENT_TYPE,
                "application/json; charset=utf-8",
            )
            .body(axum::body::Body::from(body))
            .unwrap_or_else(|_| axum::response::Response::new(axum::body::Body::from("{}")))
    }
}

impl From<ApiError> for axum::response::Response {
    fn from(error: ApiError) -> Self {
        error.into_response()
    }
}

pub(crate) fn plausible_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() >= MIN_ID_LENGTH
        && value.len() <= MAX_ID_LENGTH
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

fn check(ok: bool, errors: &mut Vec<String>, message: &str) {
    if !ok {
        errors.push(message.to_string());
    }
}

fn check_len(value: &str, max: usize, errors: &mut Vec<String>, what: &str) {
    if value.chars().count() > max {
        errors.push(format!("{what} 超过长度上限 {max}"));
    }
}

fn check_non_negative(value: i64, errors: &mut Vec<String>, what: &str) {
    if value < 0 {
        errors.push(format!("{what} 不能为负数"));
    }
}

/// Validates an envelope head (shared by every message type). Returns an
/// error string list; callers must reject the whole batch on any error.
pub(crate) fn validate_envelope_head(
    format: &str,
    schema_version: i64,
    message_type: &str,
    device_id: &str,
    generated_at: i64,
    app_version: Option<&str>,
) -> Result<(), Vec<String>> {
    let mut errors = Vec::new();
    if format != PROTOCOL_FORMAT {
        errors.push(format!("不支持的协议 format: {format}"));
    }
    if schema_version != SCHEMA_VERSION {
        errors.push(format!("不支持的协议版本: {schema_version}"));
    }
    if !matches!(message_type, "pair" | "snapshot" | "proposalDecision") {
        errors.push(format!("不支持的消息类型: {message_type}"));
    }
    if !plausible_id(device_id) {
        errors.push("deviceId 非法".to_string());
    }
    check_non_negative(generated_at, &mut errors, "generatedAt");
    if let Some(version) = app_version {
        if version.is_empty() || version.chars().count() > 64 {
            errors.push("appVersion 非法".to_string());
        }
    }
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors)
    }
}

/// Full snapshot validation. All errors are collected; callers must reject
/// the whole batch without writing any row.
pub(crate) fn validate_snapshot(payload: &SnapshotPayload) -> Result<(), Vec<String>> {
    let mut errors = Vec::new();

    if payload.subjects.len() > MAX_COLLECTION_SIZE_SUBJECTS {
        errors.push(format!(
            "subjects 数量超过上限 {MAX_COLLECTION_SIZE_SUBJECTS}"
        ));
    }
    if payload.weekly_goals.len() > MAX_COLLECTION_SIZE_WEEKLY_GOALS {
        errors.push(format!(
            "weeklyGoals 数量超过上限 {MAX_COLLECTION_SIZE_WEEKLY_GOALS}"
        ));
    }
    if payload.tasks.len() > MAX_COLLECTION_SIZE_TASKS {
        errors.push(format!("tasks 数量超过上限 {MAX_COLLECTION_SIZE_TASKS}"));
    }
    if payload.study_sessions.len() > MAX_COLLECTION_SIZE_SESSIONS {
        errors.push(format!(
            "studySessions 数量超过上限 {MAX_COLLECTION_SIZE_SESSIONS}"
        ));
    }

    // Duplicate remote ids within a collection are invalid (primary key).
    for (collection, ids) in [
        (
            "subjects",
            payload
                .subjects
                .iter()
                .map(|s| s.remote_id.clone())
                .collect::<Vec<_>>(),
        ),
        (
            "weeklyGoals",
            payload
                .weekly_goals
                .iter()
                .map(|s| s.remote_id.clone())
                .collect::<Vec<_>>(),
        ),
        (
            "tasks",
            payload
                .tasks
                .iter()
                .map(|s| s.remote_id.clone())
                .collect::<Vec<_>>(),
        ),
        (
            "studySessions",
            payload
                .study_sessions
                .iter()
                .map(|s| s.remote_id.clone())
                .collect::<Vec<_>>(),
        ),
    ] {
        let mut seen = std::collections::HashSet::new();
        for id in ids {
            if !seen.insert(id) {
                errors.push(format!("{collection} 存在重复 remoteId"));
                break;
            }
        }
    }

    for subject in &payload.subjects {
        check(
            plausible_id(&subject.remote_id),
            &mut errors,
            "subject.remoteId 非法",
        );
        check_len(&subject.name, MAX_NAME_LENGTH, &mut errors, "subject.name");
        if let Some(color) = &subject.color {
            check_len(color, 32, &mut errors, "subject.color");
        }
        if let Some(icon) = &subject.icon {
            check_len(icon, 64, &mut errors, "subject.icon");
        }
        check_non_negative(subject.created_at, &mut errors, "subject.createdAt");
        check_non_negative(subject.updated_at, &mut errors, "subject.updatedAt");
        if let Some(deleted_at) = subject.deleted_at {
            check_non_negative(deleted_at, &mut errors, "subject.deletedAt");
        }
        // 考试体系声明（可选）：非空校验 + 长度上限；不校验格式（stableId 含点号）。
        for (value, what) in [
            (&subject.exam_track_id, "subject.examTrackId"),
            (&subject.exam_subject_id, "subject.examSubjectId"),
            (&subject.exam_module_id, "subject.examModuleId"),
        ] {
            if let Some(value) = value {
                if value.trim().is_empty() {
                    errors.push(format!("{what} 不能为空字符串"));
                }
                check_len(value, 200, &mut errors, what);
            }
        }
    }

    for goal in &payload.weekly_goals {
        check(
            plausible_id(&goal.remote_id),
            &mut errors,
            "weeklyGoal.remoteId 非法",
        );
        check_non_negative(goal.week_start, &mut errors, "weeklyGoal.weekStart");
        check_len(
            &goal.title,
            MAX_TITLE_LENGTH,
            &mut errors,
            "weeklyGoal.title",
        );
        if !(0..=3).contains(&goal.status) {
            errors.push(format!("weeklyGoal.status 不支持: {}", goal.status));
        }
        check_non_negative(goal.created_at, &mut errors, "weeklyGoal.createdAt");
        check_non_negative(goal.updated_at, &mut errors, "weeklyGoal.updatedAt");
        if let Some(criteria) = &goal.success_criteria {
            check_len(
                criteria,
                MAX_STRING_LENGTH,
                &mut errors,
                "weeklyGoal.successCriteria",
            );
        }
        if let Some(reason) = &goal.exception_reason {
            check_len(
                reason,
                MAX_STRING_LENGTH,
                &mut errors,
                "weeklyGoal.exceptionReason",
            );
        }
        if let Some(source_proposal_id) = &goal.source_proposal_id {
            check(
                plausible_id(source_proposal_id),
                &mut errors,
                "weeklyGoal.sourceProposalId 非法",
            );
        }
        for (value, what) in [
            (goal.completed_at, "weeklyGoal.completedAt"),
            (
                goal.deferred_to_week_start,
                "weeklyGoal.deferredToWeekStart",
            ),
            (goal.deleted_at, "weeklyGoal.deletedAt"),
        ] {
            if let Some(value) = value {
                check_non_negative(value, &mut errors, what);
            }
        }
    }

    for task in &payload.tasks {
        check(
            plausible_id(&task.remote_id),
            &mut errors,
            "task.remoteId 非法",
        );
        if let Some(subject_id) = &task.subject_remote_id {
            check(
                plausible_id(subject_id),
                &mut errors,
                "task.subjectRemoteId 非法",
            );
        }
        check_len(&task.title, MAX_TITLE_LENGTH, &mut errors, "task.title");
        if let Some(content) = &task.content {
            check_len(content, MAX_STRING_LENGTH, &mut errors, "task.content");
        }
        if let Some(source_proposal_id) = &task.source_proposal_id {
            check(
                plausible_id(source_proposal_id),
                &mut errors,
                "task.sourceProposalId 非法",
            );
        }
        if !(0..=2).contains(&task.r#type) {
            errors.push(format!("task.type 不支持: {}", task.r#type));
        }
        if !(0..=2).contains(&task.priority) {
            errors.push(format!("task.priority 不支持: {}", task.priority));
        }
        if !(0..=2).contains(&task.status) {
            errors.push(format!("task.status 不支持: {}", task.status));
        }
        check_non_negative(task.sort_order, &mut errors, "task.sortOrder");
        check_non_negative(task.created_at, &mut errors, "task.createdAt");
        check_non_negative(task.updated_at, &mut errors, "task.updatedAt");
        for (value, what) in [
            (task.target_duration_seconds, "task.targetDurationSeconds"),
            (task.due_at, "task.dueAt"),
            (task.completed_at, "task.completedAt"),
            (task.deleted_at, "task.deletedAt"),
        ] {
            if let Some(value) = value {
                check_non_negative(value, &mut errors, what);
            }
        }
    }

    for session in &payload.study_sessions {
        check(
            plausible_id(&session.remote_id),
            &mut errors,
            "studySession.remoteId 非法",
        );
        if let Some(subject_id) = &session.subject_remote_id {
            check(
                plausible_id(subject_id),
                &mut errors,
                "studySession.subjectRemoteId 非法",
            );
        }
        if let Some(task_id) = &session.task_remote_id {
            check(
                plausible_id(task_id),
                &mut errors,
                "studySession.taskRemoteId 非法",
            );
        }
        if let Some(title) = &session.title {
            check_len(title, MAX_TITLE_LENGTH, &mut errors, "studySession.title");
        }
        check_non_negative(session.start_time, &mut errors, "studySession.startTime");
        if let Some(end_time) = session.end_time {
            check_non_negative(end_time, &mut errors, "studySession.endTime");
            if end_time < session.start_time {
                errors.push("studySession.endTime 早于 startTime".to_string());
            }
        }
        check_non_negative(
            session.duration_seconds,
            &mut errors,
            "studySession.durationSeconds",
        );
        check_non_negative(
            session.pause_seconds,
            &mut errors,
            "studySession.pauseSeconds",
        );
        if let Some(score) = session.focus_score {
            if !(0..=100).contains(&score) {
                errors.push(format!("studySession.focusScore 超出范围: {score}"));
            }
        }
        if let Some(note) = &session.note {
            check_len(note, MAX_STRING_LENGTH, &mut errors, "studySession.note");
        }
        if !(0..=3).contains(&session.status) {
            errors.push(format!("studySession.status 不支持: {}", session.status));
        }
        check_non_negative(session.created_at, &mut errors, "studySession.createdAt");
        check_non_negative(session.updated_at, &mut errors, "studySession.updatedAt");
        if let Some(deleted_at) = session.deleted_at {
            check_non_negative(deleted_at, &mut errors, "studySession.deletedAt");
        }
        // AI 使用时间（可选扩展）：非负；来源枚举白名单；缺失时默认值合法。
        check_non_negative(
            session.ai_help_seconds,
            &mut errors,
            "studySession.aiHelpSeconds",
        );
        check_non_negative(
            session.ai_help_count,
            &mut errors,
            "studySession.aiHelpCount",
        );
        if let Some(seconds) = session.external_ai_app_seconds {
            check_non_negative(seconds, &mut errors, "studySession.externalAiAppSeconds");
        }
        if let Some(source) = &session.ai_usage_source {
            if !matches!(
                source.as_str(),
                "alerttime_ai_help" | "usage_stats" | "unknown"
            ) {
                errors.push(format!("studySession.aiUsageSource 不支持: {source}"));
            }
        }
    }

    // Cross-collection foreign keys (remote id based).
    let subject_ids: std::collections::HashSet<&str> = payload
        .subjects
        .iter()
        .map(|s| s.remote_id.as_str())
        .collect();
    let task_ids: std::collections::HashSet<&str> =
        payload.tasks.iter().map(|s| s.remote_id.as_str()).collect();
    for task in &payload.tasks {
        if let Some(subject_id) = &task.subject_remote_id {
            if !subject_ids.contains(subject_id.as_str()) {
                errors.push(format!(
                    "task.subjectRemoteId 引用了不存在的科目: {subject_id}"
                ));
            }
        }
    }
    for session in &payload.study_sessions {
        if let Some(subject_id) = &session.subject_remote_id {
            if !subject_ids.contains(subject_id.as_str()) {
                errors.push(format!(
                    "studySession.subjectRemoteId 引用了不存在的科目: {subject_id}"
                ));
            }
        }
        if let Some(task_id) = &session.task_remote_id {
            if !task_ids.contains(task_id.as_str()) {
                errors.push(format!(
                    "studySession.taskRemoteId 引用了不存在的任务: {task_id}"
                ));
            }
        }
    }

    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors)
    }
}

/// Validate the optional analysis after the envelope snapshotId is known.
/// Missing analysis is accepted for old Android clients; if present it is
/// never treated as assessment evidence or approved question-bank content.
pub(crate) fn validate_learning_analysis(
    payload: &SnapshotPayload,
    snapshot_id: &str,
) -> Result<(), Vec<String>> {
    let Some(analysis) = payload.learning_analysis.as_ref() else {
        return Ok(());
    };
    let subject_ids: std::collections::HashSet<&str> = payload
        .subjects
        .iter()
        .map(|subject| subject.remote_id.as_str())
        .collect();
    let weekly_goal_ids: std::collections::HashSet<&str> = payload
        .weekly_goals
        .iter()
        .map(|goal| goal.remote_id.as_str())
        .collect();
    let task_ids: std::collections::HashSet<&str> = payload
        .tasks
        .iter()
        .map(|task| task.remote_id.as_str())
        .collect();
    let session_ids: std::collections::HashSet<&str> = payload
        .study_sessions
        .iter()
        .map(|session| session.remote_id.as_str())
        .collect();
    validate_learning_analysis_against_ids(
        analysis,
        snapshot_id,
        &subject_ids,
        &weekly_goal_ids,
        &task_ids,
        &session_ids,
    )?;
    validate_input_summary_counts(analysis, payload)
}

/// inputSummary（可选）存在时必须与同一快照内全部未软删除科目、周目标、计划和
/// 已结束会话的计数完全一致。接收端 fail-closed：审计摘要不得与真实输入范围脱钩。
fn validate_input_summary_counts(
    analysis: &LearningAnalysisDto,
    payload: &SnapshotPayload,
) -> Result<(), Vec<String>> {
    let Some(summary) = analysis.input_summary.as_ref() else {
        return Ok(());
    };
    let mut errors = Vec::new();
    check(
        summary.source == LEARNING_INPUT_SUMMARY_SOURCE,
        &mut errors,
        "learningAnalysis.inputSummary.source 不支持",
    );
    check(
        summary.subject_count >= 0
            && summary.weekly_goal_count >= 0
            && summary.task_count >= 0
            && summary.completed_session_count >= 0,
        &mut errors,
        "learningAnalysis.inputSummary 计数不能为负",
    );
    let expected_subjects = payload
        .subjects
        .iter()
        .filter(|subject| subject.deleted_at.is_none())
        .count() as i64;
    let expected_goals = payload
        .weekly_goals
        .iter()
        .filter(|goal| goal.deleted_at.is_none())
        .count() as i64;
    let expected_tasks = payload
        .tasks
        .iter()
        .filter(|task| task.deleted_at.is_none())
        .count() as i64;
    let expected_sessions = payload
        .study_sessions
        .iter()
        .filter(|session| session.deleted_at.is_none() && session.end_time.is_some())
        .count() as i64;
    check(
        summary.subject_count == expected_subjects
            && summary.weekly_goal_count == expected_goals
            && summary.task_count == expected_tasks
            && summary.completed_session_count == expected_sessions,
        &mut errors,
        "learningAnalysis.inputSummary 必须匹配同一 snapshot 的完整未删除输入范围",
    );
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors)
    }
}

pub(crate) fn validate_learning_analysis_against_ids(
    analysis: &LearningAnalysisDto,
    snapshot_id: &str,
    subject_ids: &std::collections::HashSet<&str>,
    weekly_goal_ids: &std::collections::HashSet<&str>,
    task_ids: &std::collections::HashSet<&str>,
    session_ids: &std::collections::HashSet<&str>,
) -> Result<(), Vec<String>> {
    let mut errors = Vec::new();
    check(
        plausible_id(&analysis.analysis_id),
        &mut errors,
        "learningAnalysis.analysisId 非法",
    );
    check(
        analysis.source_snapshot_id == snapshot_id,
        &mut errors,
        "learningAnalysis.sourceSnapshotId 必须等于 envelope.snapshotId",
    );
    check_non_negative(
        analysis.generated_at,
        &mut errors,
        "learningAnalysis.generatedAt",
    );
    check(
        !analysis.prompt_version.trim().is_empty(),
        &mut errors,
        "learningAnalysis.promptVersion 不能为空",
    );
    check_len(
        &analysis.prompt_version,
        100,
        &mut errors,
        "learningAnalysis.promptVersion",
    );
    if !matches!(
        analysis.generator.as_str(),
        "android_llm" | "deterministic_fallback"
    ) {
        errors.push(format!(
            "learningAnalysis.generator 不支持: {}",
            analysis.generator
        ));
    }
    check(
        analysis.profile.facts.len() <= 100,
        &mut errors,
        "learningAnalysis.profile.facts 数量超过上限",
    );
    check(
        analysis.profile.inferences.len() <= 100,
        &mut errors,
        "learningAnalysis.profile.inferences 数量超过上限",
    );
    let mut fact_codes = std::collections::HashSet::new();
    for fact in &analysis.profile.facts {
        check(
            !fact.code.trim().is_empty(),
            &mut errors,
            "learningAnalysis.profile.fact.code 不能为空",
        );
        check_len(
            &fact.code,
            100,
            &mut errors,
            "learningAnalysis.profile.fact.code",
        );
        if !fact_codes.insert(fact.code.as_str()) {
            errors.push(format!(
                "learningAnalysis.profile.fact.code 重复: {}",
                fact.code
            ));
        }
        check(
            !fact.label.trim().is_empty(),
            &mut errors,
            "learningAnalysis.profile.fact.label 不能为空",
        );
        check_len(
            &fact.label,
            MAX_TITLE_LENGTH,
            &mut errors,
            "learningAnalysis.profile.fact.label",
        );
        check(
            fact.evidence_refs.len() <= 20,
            &mut errors,
            "learningAnalysis.profile.fact.evidenceRefs 数量超过上限",
        );
        for evidence_ref in &fact.evidence_refs {
            check(
                !evidence_ref.trim().is_empty(),
                &mut errors,
                "learningAnalysis.profile.fact.evidenceRef 不能为空",
            );
            check_len(
                evidence_ref,
                200,
                &mut errors,
                "learningAnalysis.profile.fact.evidenceRef",
            );
            check(
                learning_analysis_evidence_ref_is_bound(
                    evidence_ref,
                    subject_ids,
                    weekly_goal_ids,
                    task_ids,
                    session_ids,
                ),
                &mut errors,
                "learningAnalysis.profile.fact.evidenceRef 未绑定本快照证据",
            );
        }
        if serde_json::to_string(&fact.value)
            .map(|value| value.len() > MAX_STRING_LENGTH)
            .unwrap_or(true)
        {
            errors.push("learningAnalysis.profile.fact.value 超过长度上限".to_string());
        }
    }
    for inference in &analysis.profile.inferences {
        check(
            !inference.statement.trim().is_empty(),
            &mut errors,
            "learningAnalysis.profile.inference.statement 不能为空",
        );
        check_len(
            &inference.statement,
            MAX_STRING_LENGTH,
            &mut errors,
            "learningAnalysis.profile.inference.statement",
        );
        if !inference.confidence.is_finite() || !(0.0..=1.0).contains(&inference.confidence) {
            errors.push("learningAnalysis.profile.inference.confidence 超出范围".to_string());
        }
        check(
            inference.evidence_refs.len() <= 20,
            &mut errors,
            "learningAnalysis.profile.inference.evidenceRefs 数量超过上限",
        );
        for evidence_ref in &inference.evidence_refs {
            check(
                !evidence_ref.trim().is_empty(),
                &mut errors,
                "learningAnalysis.profile.inference.evidenceRef 不能为空",
            );
            check_len(
                evidence_ref,
                200,
                &mut errors,
                "learningAnalysis.profile.inference.evidenceRef",
            );
            check(
                learning_analysis_evidence_ref_is_bound(
                    evidence_ref,
                    subject_ids,
                    weekly_goal_ids,
                    task_ids,
                    session_ids,
                ),
                &mut errors,
                "learningAnalysis.profile.inference.evidenceRef 未绑定本快照证据",
            );
        }
    }
    if !matches!(
        analysis.plan_evaluation.verdict.as_str(),
        "reasonable" | "needs_adjustment" | "insufficient_data"
    ) {
        errors.push(format!(
            "learningAnalysis.planEvaluation.verdict 不支持: {}",
            analysis.plan_evaluation.verdict
        ));
    }
    if let Some(score) = analysis.plan_evaluation.score {
        if !score.is_finite() || !(0.0..=100.0).contains(&score) {
            errors.push("learningAnalysis.planEvaluation.score 超出范围".to_string());
        }
    }
    check(
        analysis.plan_evaluation.dimensions.len() <= 20,
        &mut errors,
        "learningAnalysis.planEvaluation.dimensions 数量超过上限",
    );
    for dimension in &analysis.plan_evaluation.dimensions {
        check(
            !dimension.code.trim().is_empty(),
            &mut errors,
            "learningAnalysis.planEvaluation.dimension.code 不能为空",
        );
        check_len(
            &dimension.code,
            100,
            &mut errors,
            "learningAnalysis.planEvaluation.dimension.code",
        );
        if let Some(score) = dimension.score {
            if !score.is_finite() || !(0.0..=100.0).contains(&score) {
                errors.push("learningAnalysis.planEvaluation.dimension.score 超出范围".to_string());
            }
        }
        check_len(
            &dimension.summary,
            MAX_STRING_LENGTH,
            &mut errors,
            "learningAnalysis.planEvaluation.dimension.summary",
        );
        check(
            !dimension.summary.trim().is_empty(),
            &mut errors,
            "learningAnalysis.planEvaluation.dimension.summary 不能为空",
        );
    }
    check(
        analysis.plan_evaluation.risks.len() <= 20,
        &mut errors,
        "learningAnalysis.planEvaluation.risks 数量超过上限",
    );
    check(
        analysis.plan_evaluation.suggestions.len() <= 20,
        &mut errors,
        "learningAnalysis.planEvaluation.suggestions 数量超过上限",
    );
    for value in analysis
        .plan_evaluation
        .risks
        .iter()
        .chain(analysis.plan_evaluation.suggestions.iter())
    {
        check(
            !value.trim().is_empty(),
            &mut errors,
            "learningAnalysis.planEvaluation.text 不能为空",
        );
        check_len(
            value,
            MAX_STRING_LENGTH,
            &mut errors,
            "learningAnalysis.planEvaluation.text",
        );
    }
    check(
        analysis.assessment_draft.status == "draft",
        &mut errors,
        "learningAnalysis.assessmentDraft.status 必须为 draft",
    );
    check_len(
        &analysis.assessment_draft.scope_summary,
        MAX_STRING_LENGTH,
        &mut errors,
        "learningAnalysis.assessmentDraft.scopeSummary",
    );
    check(
        !analysis.assessment_draft.scope_summary.trim().is_empty(),
        &mut errors,
        "learningAnalysis.assessmentDraft.scopeSummary 不能为空",
    );
    if analysis.assessment_draft.questions.len() > MAX_ANALYSIS_QUESTIONS {
        errors.push("learningAnalysis.assessmentDraft.questions 数量超过上限".to_string());
    }
    let mut question_ids = std::collections::HashSet::new();
    for question in &analysis.assessment_draft.questions {
        check(
            plausible_id(&question.question_id),
            &mut errors,
            "learningAnalysis.assessmentDraft.questionId 非法",
        );
        if !question_ids.insert(question.question_id.as_str()) {
            errors.push(format!(
                "learningAnalysis.assessmentDraft.questionId 重复: {}",
                question.question_id
            ));
        }
        if !matches!(
            question.r#type.as_str(),
            "concept_check" | "diagnostic" | "reflection"
        ) {
            errors.push(format!(
                "learningAnalysis.assessmentDraft.question.type 不支持: {}",
                question.r#type
            ));
        }
        check(
            !question.prompt.trim().is_empty(),
            &mut errors,
            "learningAnalysis.assessmentDraft.question.prompt 不能为空",
        );
        check_len(
            &question.prompt,
            MAX_STRING_LENGTH,
            &mut errors,
            "learningAnalysis.assessmentDraft.question.prompt",
        );
        check_len(
            &question.rationale,
            MAX_STRING_LENGTH,
            &mut errors,
            "learningAnalysis.assessmentDraft.question.rationale",
        );
        check(
            !question.rationale.trim().is_empty(),
            &mut errors,
            "learningAnalysis.assessmentDraft.question.rationale 不能为空",
        );
        check(
            question.rubric.len() <= 20,
            &mut errors,
            "learningAnalysis.assessmentDraft.question.rubric 数量超过上限",
        );
        if let Some(subject_id) = &question.subject_remote_id {
            check(
                plausible_id(subject_id),
                &mut errors,
                "learningAnalysis.assessmentDraft.question.subjectRemoteId 非法",
            );
            if !subject_ids.contains(subject_id.as_str()) {
                errors.push(format!(
                    "learningAnalysis.assessmentDraft.question.subjectRemoteId 引用了本快照中不存在的科目: {subject_id}"
                ));
            }
        }
        if let Some(task_id) = &question.task_remote_id {
            check(
                plausible_id(task_id),
                &mut errors,
                "learningAnalysis.assessmentDraft.question.taskRemoteId 非法",
            );
            if !task_ids.contains(task_id.as_str()) {
                errors.push(format!(
                    "learningAnalysis.assessmentDraft.question.taskRemoteId 引用了本快照中不存在的任务: {task_id}"
                ));
            }
        }
        for rubric in &question.rubric {
            check(
                !rubric.trim().is_empty(),
                &mut errors,
                "learningAnalysis.assessmentDraft.question.rubric 不能为空",
            );
            check_len(
                rubric,
                MAX_STRING_LENGTH,
                &mut errors,
                "learningAnalysis.assessmentDraft.question.rubric",
            );
        }
    }
    if analysis.warnings.len() > MAX_ANALYSIS_WARNINGS {
        errors.push("learningAnalysis.warnings 数量超过上限".to_string());
    }
    for warning in &analysis.warnings {
        check(
            !warning.trim().is_empty(),
            &mut errors,
            "learningAnalysis.warning 不能为空",
        );
        check_len(
            warning,
            MAX_STRING_LENGTH,
            &mut errors,
            "learningAnalysis.warning",
        );
    }
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors)
    }
}

const LEARNING_ANALYSIS_AGGREGATE_EVIDENCE_REFS: &[&str] = &[
    "scope:today",
    "scope:current_week",
    "scope:historical",
    "session_summary:today",
    "session_summary:all",
];

const LEARNING_ANALYSIS_USER_SETTING_EVIDENCE_REFS: &[&str] = &[
    "user_setting:purpose",
    "user_setting:examName",
    "user_setting:focusSubjects",
    "user_setting:targetDate",
];

fn learning_analysis_evidence_ref_is_bound(
    evidence_ref: &str,
    subject_ids: &std::collections::HashSet<&str>,
    weekly_goal_ids: &std::collections::HashSet<&str>,
    task_ids: &std::collections::HashSet<&str>,
    session_ids: &std::collections::HashSet<&str>,
) -> bool {
    if LEARNING_ANALYSIS_AGGREGATE_EVIDENCE_REFS.contains(&evidence_ref)
        || LEARNING_ANALYSIS_USER_SETTING_EVIDENCE_REFS.contains(&evidence_ref)
    {
        return true;
    }
    if let Some(task_id) = evidence_ref.strip_prefix("task:") {
        return task_ids.contains(task_id);
    }
    subject_ids.contains(evidence_ref)
        || weekly_goal_ids.contains(evidence_ref)
        || task_ids.contains(evidence_ref)
        || session_ids.contains(evidence_ref)
}

pub(crate) fn validate_pair(payload: &PairPayload) -> Result<(), Vec<String>> {
    let mut errors = Vec::new();
    if payload.token.is_empty() || payload.token.len() > 256 {
        errors.push("token 非法".to_string());
    }
    if !plausible_id(&payload.device_id) {
        errors.push("deviceId 非法".to_string());
    }
    if let Some(owner) = payload.owner_identity.as_deref() {
        if !plausible_id(owner) || owner.len() > 64 {
            errors.push("ownerIdentity 非法".to_string());
        }
    }
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors)
    }
}

pub(crate) fn validate_decision(payload: &ProposalDecisionPayload) -> Result<(), Vec<String>> {
    let mut errors = Vec::new();
    if !plausible_id(&payload.proposal_id) {
        errors.push("proposalId 非法".to_string());
    }
    if !matches!(payload.decision.as_str(), "accepted" | "rejected") {
        errors.push(format!("decision 不支持: {}", payload.decision));
    }
    if payload.decided_at <= 0 {
        errors.push("decidedAt 非法".to_string());
    }
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::{HashMap, HashSet};

    const FIXTURES_DIR: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../sync/protocol/fixtures");
    const SCHEMA_PATH: &str = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../sync/protocol/schema/alerttime-teacher-sync-v1.schema.json"
    );

    fn fixture_path(name: &str) -> String {
        format!("{FIXTURES_DIR}/{name}")
    }

    fn read_fixture(name: &str) -> String {
        std::fs::read_to_string(fixture_path(name))
            .unwrap_or_else(|error| panic!("failed to read fixture {name}: {error}"))
    }

    fn read_schema() -> serde_json::Value {
        let text = std::fs::read_to_string(SCHEMA_PATH)
            .unwrap_or_else(|error| panic!("failed to read protocol schema: {error}"));
        serde_json::from_str(&text).expect("protocol schema must be valid JSON")
    }

    fn sha256_hex(bytes: &[u8]) -> String {
        use sha2::Digest;
        let digest = sha2::Sha256::digest(bytes);
        hex::encode(digest)
    }

    fn valid_snapshot_with_analysis() -> (String, SnapshotPayload) {
        let text = read_fixture("snapshot-valid.json");
        let envelope: Envelope<SnapshotPayload> = serde_json::from_str(&text).expect("parse");
        let snapshot_id = envelope.snapshot_id.expect("snapshot id");
        assert!(envelope.payload.learning_analysis.is_some());
        (snapshot_id, envelope.payload)
    }

    fn canonical_source_claim_envelopes(
    ) -> (Envelope<SnapshotPayload>, Envelope<ProposalsListPayload>) {
        let snapshot = serde_json::from_str(&read_fixture("snapshot-valid.json"))
            .expect("canonical snapshot parse");
        let proposals = serde_json::from_str(&read_fixture("proposal-valid.json"))
            .expect("canonical proposals parse");
        (snapshot, proposals)
    }

    fn proposal_mut<'a>(
        envelope: &'a mut Envelope<ProposalsListPayload>,
        proposal_id: &str,
    ) -> &'a mut ProposalDto {
        envelope
            .payload
            .proposals
            .iter_mut()
            .find(|proposal| proposal.proposal_id == proposal_id)
            .expect("canonical proposal")
    }

    fn validate_source_proposal_claims(
        snapshot: &Envelope<SnapshotPayload>,
        proposals: &Envelope<ProposalsListPayload>,
    ) -> Result<(), String> {
        if proposals.device_id != snapshot.device_id {
            return Err("proposal envelope device mismatch".to_string());
        }

        let mut proposals_by_id = HashMap::new();
        for proposal in &proposals.payload.proposals {
            if proposals_by_id
                .insert(proposal.proposal_id.as_str(), proposal)
                .is_some()
            {
                return Err("duplicate proposalId".to_string());
            }
        }

        let mut claimed_goals = HashSet::new();
        for goal in &snapshot.payload.weekly_goals {
            let Some(source_id) = goal.source_proposal_id.as_deref() else {
                continue;
            };
            let proposal = proposals_by_id
                .get(source_id)
                .ok_or_else(|| "source proposal missing".to_string())?;
            if proposal.device_id != snapshot.device_id {
                return Err("proposal device mismatch".to_string());
            }
            if proposal.status != "accepted" {
                return Err("source proposal is not accepted".to_string());
            }
            if proposal.created_at > goal.created_at {
                return Err("proposal created after weekly goal".to_string());
            }
            if goal.created_at > snapshot.generated_at {
                return Err("weekly goal created after snapshot".to_string());
            }
            let matches = proposal
                .proposed_weekly_goals
                .iter()
                .enumerate()
                .filter(|(_, candidate)| {
                    candidate.week_start == goal.week_start
                        && candidate.title == goal.title
                        && candidate.success_criteria == goal.success_criteria
                })
                .map(|(index, _)| index)
                .collect::<Vec<_>>();
            if matches.len() != 1 {
                return Err("weekly goal does not exactly match one proposal item".to_string());
            }
            if !claimed_goals.insert((source_id.to_string(), matches[0])) {
                return Err("duplicate weekly goal claim".to_string());
            }
        }

        let mut claimed_tasks = HashSet::new();
        for task in &snapshot.payload.tasks {
            let Some(source_id) = task.source_proposal_id.as_deref() else {
                continue;
            };
            let proposal = proposals_by_id
                .get(source_id)
                .ok_or_else(|| "source proposal missing".to_string())?;
            if proposal.device_id != snapshot.device_id {
                return Err("proposal device mismatch".to_string());
            }
            if proposal.status != "accepted" {
                return Err("source proposal is not accepted".to_string());
            }
            if proposal.created_at > task.created_at {
                return Err("proposal created after task".to_string());
            }
            if task.created_at > snapshot.generated_at {
                return Err("task created after snapshot".to_string());
            }
            if task.r#type != 1 {
                return Err("attributed task type must be 1".to_string());
            }
            let matches = proposal
                .proposed_tasks
                .iter()
                .enumerate()
                .filter(|(_, candidate)| {
                    candidate.title == task.title
                        && candidate.subject_remote_id == task.subject_remote_id
                        && candidate.target_duration_seconds == task.target_duration_seconds
                        && candidate.due_at == task.due_at
                })
                .map(|(index, _)| index)
                .collect::<Vec<_>>();
            if matches.len() != 1 {
                return Err("task does not exactly match one proposal item".to_string());
            }
            if !claimed_tasks.insert((source_id.to_string(), matches[0])) {
                return Err("duplicate task claim".to_string());
            }
        }
        Ok(())
    }

    #[test]
    fn fixtures_match_sha256_manifest() {
        // Both repositories keep an identical copy of these fixtures; the
        // SHA-256 manifest is the cross-repo agreement point that detects drift.
        let manifest = read_fixture("SHA256SUMS");
        for line in manifest.lines() {
            let mut parts = line.split_whitespace();
            let expected = parts.next().expect("manifest line missing hash");
            let file = parts.next().expect("manifest line missing filename");
            let actual = sha256_hex(
                &std::fs::read(fixture_path(file))
                    .unwrap_or_else(|error| panic!("failed to read {file}: {error}")),
            );
            assert_eq!(
                actual, expected,
                "fixture {file} 的 SHA-256 与清单不一致，可能协议漂移"
            );
        }
    }

    #[test]
    fn source_proposal_id_schema_matches_rust_and_fixture_contract() {
        let schema = read_schema();
        for entity in ["weeklyGoal", "task"] {
            let field = &schema["$defs"][entity]["properties"]["sourceProposalId"];
            assert_eq!(field["type"], serde_json::json!(["string", "null"]));
            assert_eq!(field["minLength"], 8);
            assert_eq!(field["maxLength"], 64);
            assert_eq!(field["pattern"], "^[A-Za-z0-9_-]{8,64}$");
        }

        let envelope: Envelope<SnapshotPayload> =
            serde_json::from_str(&read_fixture("snapshot-valid.json")).expect("fixture parse");
        let source_ids = envelope
            .payload
            .weekly_goals
            .iter()
            .filter_map(|goal| goal.source_proposal_id.as_deref())
            .chain(
                envelope
                    .payload
                    .tasks
                    .iter()
                    .filter_map(|task| task.source_proposal_id.as_deref()),
            )
            .collect::<Vec<_>>();
        assert!(
            !source_ids.is_empty(),
            "canonical fixture must cover sourceProposalId"
        );
        assert!(source_ids.into_iter().all(plausible_id));
    }

    #[test]
    fn canonical_source_proposal_claims_are_semantically_consistent() {
        let (snapshot, proposals) = canonical_source_claim_envelopes();
        validate_source_proposal_claims(&snapshot, &proposals)
            .expect("canonical sourceProposalId claims must be valid");
    }

    #[test]
    fn canonical_source_proposal_claims_reject_semantic_drift_and_duplicates() {
        const SOURCE_ID: &str = "7e8f9a0b-1c2d-4e5f-8a9b-0c1d2e3f4a5b";
        let (snapshot, proposals) = canonical_source_claim_envelopes();

        let mut wrong_device = proposals.clone();
        proposal_mut(&mut wrong_device, SOURCE_ID).device_id =
            "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee".to_string();
        assert!(validate_source_proposal_claims(&snapshot, &wrong_device)
            .expect_err("device drift rejected")
            .contains("device"));

        let mut pending = proposals.clone();
        proposal_mut(&mut pending, SOURCE_ID).status = "pending".to_string();
        assert!(validate_source_proposal_claims(&snapshot, &pending)
            .expect_err("non-accepted proposal rejected")
            .contains("not accepted"));

        let mut late_proposal = proposals.clone();
        proposal_mut(&mut late_proposal, SOURCE_ID).created_at =
            snapshot.payload.weekly_goals[0].created_at + 1;
        assert!(validate_source_proposal_claims(&snapshot, &late_proposal)
            .expect_err("proposal after entity rejected")
            .contains("created after"));

        let mut future_entity = snapshot.clone();
        future_entity.payload.weekly_goals[0].created_at = snapshot.generated_at + 1;
        assert!(validate_source_proposal_claims(&future_entity, &proposals)
            .expect_err("entity after snapshot rejected")
            .contains("after snapshot"));

        let mut mismatched_fields = proposals.clone();
        proposal_mut(&mut mismatched_fields, SOURCE_ID).proposed_tasks[0].due_at = None;
        assert!(
            validate_source_proposal_claims(&snapshot, &mismatched_fields)
                .expect_err("field drift rejected")
                .contains("exactly match")
        );

        let mut wrong_task_type = snapshot.clone();
        wrong_task_type.payload.tasks[0].r#type = 0;
        assert!(
            validate_source_proposal_claims(&wrong_task_type, &proposals)
                .expect_err("attributed task type drift rejected")
                .contains("type must be 1")
        );

        let mut duplicate_claim = snapshot.clone();
        let mut duplicate_goal = duplicate_claim.payload.weekly_goals[0].clone();
        duplicate_goal.remote_id = "duplicate-goal-0001".to_string();
        duplicate_claim.payload.weekly_goals.push(duplicate_goal);
        assert!(
            validate_source_proposal_claims(&duplicate_claim, &proposals)
                .expect_err("duplicate claim rejected")
                .contains("duplicate weekly goal claim")
        );
    }

    #[test]
    fn snapshot_valid_fixture_parses_and_validates() {
        let text = read_fixture("snapshot-valid.json");
        let envelope: Envelope<SnapshotPayload> = serde_json::from_str(&text).expect("parse");
        assert_eq!(envelope.format, PROTOCOL_FORMAT);
        assert_eq!(envelope.schema_version, SCHEMA_VERSION);
        assert_eq!(envelope.message_type, "snapshot");
        validate_envelope_head(
            &envelope.format,
            envelope.schema_version,
            &envelope.message_type,
            &envelope.device_id,
            envelope.generated_at,
            envelope.app_version.as_deref(),
        )
        .expect("envelope head valid");
        validate_snapshot(&envelope.payload).expect("snapshot valid");
        validate_learning_analysis(
            &envelope.payload,
            envelope.snapshot_id.as_deref().expect("snapshot id"),
        )
        .expect("learning analysis valid");

        // Chinese + special characters survived.
        assert_eq!(
            envelope.payload.subjects[1].name,
            "高等数学（含特殊字符：π ≥ 1/2、emoji 🎓、换行\n第二行）"
        );
        assert_eq!(envelope.payload.tasks.len(), 4);
        // Soft-deleted rows are present.
        assert!(envelope
            .payload
            .subjects
            .iter()
            .any(|s| s.deleted_at.is_some()));
        // Running session is present but the validator must not reject it.
        assert!(envelope
            .payload
            .study_sessions
            .iter()
            .any(|s| s.status == 1));
    }

    #[test]
    fn learning_analysis_accepts_valid_snapshot_references() {
        let (snapshot_id, payload) = valid_snapshot_with_analysis();
        validate_learning_analysis(&payload, &snapshot_id).expect("valid learning analysis");
    }

    #[test]
    fn learning_analysis_rejects_missing_subject_and_task_references() {
        let (snapshot_id, mut payload) = valid_snapshot_with_analysis();
        let question = &mut payload
            .learning_analysis
            .as_mut()
            .expect("analysis")
            .assessment_draft
            .questions[0];
        question.subject_remote_id = Some("ffffffff-ffff-4fff-8fff-ffffffffffff".to_string());
        question.task_remote_id = Some("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee".to_string());

        let errors = validate_learning_analysis(&payload, &snapshot_id)
            .expect_err("cross-snapshot references must be rejected");
        assert!(errors
            .iter()
            .any(|error| error.contains("本快照中不存在的科目")));
        assert!(errors
            .iter()
            .any(|error| error.contains("本快照中不存在的任务")));
    }

    #[test]
    fn learning_analysis_rejects_duplicate_question_id() {
        let (snapshot_id, mut payload) = valid_snapshot_with_analysis();
        let analysis = payload.learning_analysis.as_mut().expect("analysis");
        analysis
            .assessment_draft
            .questions
            .push(analysis.assessment_draft.questions[0].clone());

        let errors = validate_learning_analysis(&payload, &snapshot_id)
            .expect_err("duplicate questionId must be rejected");
        assert!(errors.iter().any(|error| error.contains("questionId 重复")));
    }

    #[test]
    fn learning_analysis_rejects_evidence_not_bound_to_snapshot() {
        let (snapshot_id, mut payload) = valid_snapshot_with_analysis();
        let analysis = payload.learning_analysis.as_mut().expect("analysis");
        analysis.profile.facts[0].evidence_refs = vec!["invented-evidence".to_string()];
        analysis.profile.inferences[0].evidence_refs =
            vec!["task:ffffffff-ffff-4fff-8fff-ffffffffffff".to_string()];

        let errors = validate_learning_analysis(&payload, &snapshot_id)
            .expect_err("unbound evidence must be rejected before persistence");
        assert!(errors
            .iter()
            .any(|error| error.contains("未绑定本快照证据")));
    }

    #[test]
    fn learning_analysis_accepts_historical_aggregate_evidence_refs() {
        let (snapshot_id, mut payload) = valid_snapshot_with_analysis();
        let analysis = payload.learning_analysis.as_mut().expect("analysis");
        analysis.profile.inferences[0].evidence_refs = vec![
            "scope:historical".to_string(),
            "session_summary:all".to_string(),
        ];

        validate_learning_analysis(&payload, &snapshot_id)
            .expect("protocol-approved historical aggregate evidence must remain accepted");
    }

    #[test]
    fn learning_analysis_rejects_blank_nested_list_items() {
        let (snapshot_id, mut payload) = valid_snapshot_with_analysis();
        let analysis = payload.learning_analysis.as_mut().expect("analysis");
        analysis.profile.facts[0].evidence_refs = vec![" ".to_string()];
        analysis.plan_evaluation.risks = vec!["".to_string()];
        analysis.assessment_draft.questions[0].rationale = " ".to_string();
        analysis.assessment_draft.questions[0].rubric = vec!["".to_string()];
        analysis.warnings = vec![" ".to_string()];

        let errors = validate_learning_analysis(&payload, &snapshot_id)
            .expect_err("blank nested strings must be rejected before persistence");
        for field in [
            "evidenceRef",
            "planEvaluation.text",
            "rationale",
            "rubric",
            "warning",
        ] {
            assert!(
                errors.iter().any(|error| error.contains(field)),
                "missing error for {field}: {errors:?}"
            );
        }
    }

    #[test]
    fn old_snapshot_without_learning_analysis_is_accepted() {
        let (snapshot_id, mut payload) = valid_snapshot_with_analysis();
        payload.learning_analysis = None;
        validate_learning_analysis(&payload, &snapshot_id)
            .expect("legacy snapshot without analysis remains valid");
    }

    fn expected_input_summary(payload: &SnapshotPayload) -> LearningInputSummaryDto {
        LearningInputSummaryDto {
            subject_count: payload
                .subjects
                .iter()
                .filter(|subject| subject.deleted_at.is_none())
                .count() as i64,
            weekly_goal_count: payload
                .weekly_goals
                .iter()
                .filter(|goal| goal.deleted_at.is_none())
                .count() as i64,
            task_count: payload
                .tasks
                .iter()
                .filter(|task| task.deleted_at.is_none())
                .count() as i64,
            completed_session_count: payload
                .study_sessions
                .iter()
                .filter(|session| session.deleted_at.is_none() && session.end_time.is_some())
                .count() as i64,
            source: LEARNING_INPUT_SUMMARY_SOURCE.to_string(),
        }
    }

    #[test]
    fn learning_analysis_accepts_input_summary_matching_snapshot_input() {
        let (snapshot_id, mut payload) = valid_snapshot_with_analysis();
        let summary = expected_input_summary(&payload);
        let analysis = payload.learning_analysis.as_mut().expect("analysis");
        assert!(analysis.input_summary.is_none(), "fixture stays legacy");
        analysis.input_summary = Some(summary);
        validate_learning_analysis(&payload, &snapshot_id)
            .expect("matching inputSummary must be accepted");
    }

    #[test]
    fn learning_analysis_rejects_input_summary_mismatching_snapshot_counts() {
        let (snapshot_id, mut payload) = valid_snapshot_with_analysis();
        let mut summary = expected_input_summary(&payload);
        summary.subject_count += 1;
        let analysis = payload.learning_analysis.as_mut().expect("analysis");
        analysis.input_summary = Some(summary);
        let errors = validate_learning_analysis(&payload, &snapshot_id)
            .expect_err("mismatched inputSummary must be rejected");
        assert!(
            errors.iter().any(|error| error.contains("inputSummary")),
            "missing inputSummary error: {errors:?}"
        );
    }

    #[test]
    fn learning_analysis_rejects_input_summary_bad_source_and_negative_counts() {
        let (snapshot_id, mut payload) = valid_snapshot_with_analysis();

        let mut bad_source = expected_input_summary(&payload);
        bad_source.source = "made_up_source".to_string();
        payload
            .learning_analysis
            .as_mut()
            .expect("analysis")
            .input_summary = Some(bad_source);
        let errors = validate_learning_analysis(&payload, &snapshot_id)
            .expect_err("unknown source must be rejected");
        assert!(
            errors
                .iter()
                .any(|error| error.contains("inputSummary.source")),
            "missing source error: {errors:?}"
        );

        let (snapshot_id, mut payload) = valid_snapshot_with_analysis();
        let mut negative = expected_input_summary(&payload);
        negative.completed_session_count = -1;
        payload
            .learning_analysis
            .as_mut()
            .expect("analysis")
            .input_summary = Some(negative);
        let errors = validate_learning_analysis(&payload, &snapshot_id)
            .expect_err("negative counts must be rejected");
        assert!(
            errors.iter().any(|error| error.contains("计数不能为负")),
            "missing negative-count error: {errors:?}"
        );
    }

    #[test]
    fn assessment_question_rejects_answer_solution_and_explanation_variants() {
        for forbidden_key in [
            "answer",
            "solution",
            "Answer",
            "finalAnswer",
            "workedSolution",
            "explanation",
            "Explanation",
        ] {
            let mut value = serde_json::json!({
                "questionId": "question-0001",
                "subjectRemoteId": null,
                "taskRemoteId": null,
                "type": "diagnostic",
                "prompt": "请解释核心概念。",
                "rationale": "用于定位概念理解。",
                "rubric": ["能说明核心关系"]
            });
            value
                .as_object_mut()
                .expect("question object")
                .insert(forbidden_key.to_string(), serde_json::json!("禁止内容"));

            let error = serde_json::from_value::<AssessmentDraftQuestionDto>(value)
                .expect_err("answer/solution must be rejected")
                .to_string();
            assert!(error.contains("禁止字段"), "unexpected error: {error}");
        }
    }

    #[test]
    fn assessment_question_allows_prompt_rationale_and_rubric() {
        let value = serde_json::json!({
            "questionId": "question-0001",
            "subjectRemoteId": null,
            "taskRemoteId": null,
            "type": "diagnostic",
            "prompt": "请解释核心概念。",
            "rationale": "用于定位概念理解。",
            "rubric": ["能说明核心关系"]
        });

        serde_json::from_value::<AssessmentDraftQuestionDto>(value)
            .expect("prompt/rationale/rubric must remain allowed");
    }

    #[test]
    fn learning_analysis_nullable_scores_are_required_fields() {
        let fixture = read_fixture("snapshot-valid.json");

        let mut missing_plan_score: serde_json::Value =
            serde_json::from_str(&fixture).expect("fixture json");
        missing_plan_score["payload"]["learningAnalysis"]["planEvaluation"]
            .as_object_mut()
            .expect("planEvaluation object")
            .remove("score");
        serde_json::from_value::<Envelope<SnapshotPayload>>(missing_plan_score)
            .expect_err("planEvaluation.score may be null but may not be missing");

        let mut missing_dimension_score: serde_json::Value =
            serde_json::from_str(&fixture).expect("fixture json");
        missing_dimension_score["payload"]["learningAnalysis"]["planEvaluation"]["dimensions"][0]
            .as_object_mut()
            .expect("dimension object")
            .remove("score");
        serde_json::from_value::<Envelope<SnapshotPayload>>(missing_dimension_score)
            .expect_err("dimension.score may be null but may not be missing");
    }

    #[test]
    fn snapshot_missing_field_fixture_rejected() {
        let text = read_fixture("snapshot-missing-field.json");
        // task.title is required -> serde fails before validation.
        let result: Result<Envelope<SnapshotPayload>, _> = serde_json::from_str(&text);
        assert!(result.is_err(), "missing required field must be rejected");
    }

    #[test]
    fn snapshot_unsupported_version_fixture_rejected() {
        let text = read_fixture("snapshot-unsupported-version.json");
        let envelope: Envelope<serde_json::Value> = serde_json::from_str(&text).expect("parse");
        let errors = validate_envelope_head(
            &envelope.format,
            envelope.schema_version,
            &envelope.message_type,
            &envelope.device_id,
            envelope.generated_at,
            envelope.app_version.as_deref(),
        )
        .expect_err("unsupported version must be rejected");
        assert!(errors.iter().any(|e| e.contains("协议版本")));
    }

    #[test]
    fn envelope_rejects_invalid_generated_at_and_app_version() {
        let errors = validate_envelope_head(
            PROTOCOL_FORMAT,
            SCHEMA_VERSION,
            "snapshot",
            "f0a24c19-0f8e-4b6d-9a3c-77e1b2d4c5a6",
            -1,
            Some(""),
        )
        .expect_err("invalid envelope fields must be rejected");
        assert!(errors.iter().any(|error| error.contains("generatedAt")));
        assert!(errors.iter().any(|error| error.contains("appVersion")));

        let oversized = "x".repeat(65);
        let errors = validate_envelope_head(
            PROTOCOL_FORMAT,
            SCHEMA_VERSION,
            "snapshot",
            "f0a24c19-0f8e-4b6d-9a3c-77e1b2d4c5a6",
            0,
            Some(&oversized),
        )
        .expect_err("oversized app version must be rejected");
        assert!(errors.iter().any(|error| error.contains("appVersion")));
    }

    #[test]
    fn snapshot_foreign_key_mismatch_fixture_rejected() {
        let text = read_fixture("snapshot-foreign-key-mismatch.json");
        let envelope: Envelope<SnapshotPayload> = serde_json::from_str(&text).expect("parse");
        let errors = validate_snapshot(&envelope.payload)
            .expect_err("foreign key mismatch must be rejected");
        assert!(errors.iter().any(|e| e.contains("引用了不存在的科目")));
        assert!(errors.iter().any(|e| e.contains("引用了不存在的任务")));
    }

    #[test]
    fn proposal_fixture_parses() {
        let text = read_fixture("proposal-valid.json");
        let envelope: Envelope<ProposalsListPayload> = serde_json::from_str(&text).expect("parse");
        assert_eq!(envelope.message_type, "proposal");
        assert_eq!(envelope.payload.proposals.len(), 2);
        assert_eq!(
            envelope.payload.proposals[0].proposal_id,
            "9c2d6e5f-4a7b-4c8d-9e0f-1a2b3c4d5e6f"
        );
        assert_eq!(
            envelope.payload.proposals[1].proposal_id,
            "7e8f9a0b-1c2d-4e5f-8a9b-0c1d2e3f4a5b"
        );
        assert_eq!(envelope.payload.proposals[0].created_at, 1785603600000);
        assert_eq!(envelope.payload.proposals[1].created_at, 1785369000000);
        assert!(
            envelope.payload.proposals[0].created_at > envelope.payload.proposals[1].created_at
        );
        assert!(envelope.payload.proposals[0].rationale.contains("英语"));
        assert!(!envelope.payload.proposals[0]
            .proposed_weekly_goals
            .is_empty());
        assert!(!envelope.payload.proposals[0].proposed_tasks.is_empty());
        assert!(!envelope.payload.proposals[0]
            .source_assessment_ids
            .is_empty());
        assert_eq!(envelope.payload.proposals[1].status, "accepted");
        assert_eq!(
            envelope.payload.next_cursor.as_deref(),
            Some("7e8f9a0b-1c2d-4e5f-8a9b-0c1d2e3f4a5b")
        );
        assert_eq!(
            envelope.payload.next_cursor.as_deref(),
            envelope
                .payload
                .proposals
                .last()
                .map(|proposal| proposal.proposal_id.as_str())
        );
    }

    #[test]
    fn decision_fixture_parses_and_validates() {
        let text = read_fixture("decision-valid.json");
        let envelope: Envelope<ProposalDecisionPayload> =
            serde_json::from_str(&text).expect("parse");
        assert_eq!(envelope.message_type, "proposalDecision");
        validate_decision(&envelope.payload).expect("decision valid");
    }

    #[test]
    fn pair_fixture_parses_and_validates() {
        let text = read_fixture("pair-valid.json");
        let envelope: Envelope<PairPayload> = serde_json::from_str(&text).expect("parse");
        assert_eq!(envelope.message_type, "pair");
        validate_pair(&envelope.payload).expect("pair valid");
    }

    #[test]
    fn unknown_fields_are_ignored() {
        let text = read_fixture("snapshot-valid.json");
        let envelope: Envelope<SnapshotPayload> = serde_json::from_str(&text).expect("parse");
        // snapshot-valid.json contains "futureUnknownField" at envelope level
        // and "unknownFutureField" inside a subject; parsing must succeed.
        assert_eq!(envelope.device_id, "f0a24c19-0f8e-4b6d-9a3c-77e1b2d4c5a6");
    }

    #[test]
    fn nullables_are_accepted() {
        let text = read_fixture("snapshot-valid.json");
        let envelope: Envelope<SnapshotPayload> = serde_json::from_str(&text).expect("parse");
        assert!(envelope.payload.subjects.iter().any(|s| s.color.is_none()));
        assert!(envelope
            .payload
            .weekly_goals
            .iter()
            .any(|goal| { goal.source_proposal_id.is_none() }));
        assert!(envelope
            .payload
            .tasks
            .iter()
            .any(|task| task.subject_remote_id.is_none() && task.source_proposal_id.is_none()));
        assert!(envelope
            .payload
            .study_sessions
            .iter()
            .any(|s| s.title.is_none() && s.note.is_none()));
    }

    #[test]
    fn source_proposal_ids_survive_production_decode_roundtrip() {
        let text = read_fixture("snapshot-valid.json");
        let envelope: Envelope<SnapshotPayload> = serde_json::from_str(&text).expect("parse");
        let goal_source = envelope.payload.weekly_goals[0]
            .source_proposal_id
            .as_deref();
        let task_source = envelope.payload.tasks[0].source_proposal_id.as_deref();
        assert_eq!(goal_source, Some("7e8f9a0b-1c2d-4e5f-8a9b-0c1d2e3f4a5b"));
        assert_eq!(task_source, Some("7e8f9a0b-1c2d-4e5f-8a9b-0c1d2e3f4a5b"));
        validate_snapshot(&envelope.payload).expect("source proposal ids valid");

        let encoded = serde_json::to_value(&envelope).expect("serialize");
        assert_eq!(
            encoded["payload"]["weeklyGoals"][0]["sourceProposalId"],
            "7e8f9a0b-1c2d-4e5f-8a9b-0c1d2e3f4a5b"
        );
        assert_eq!(
            encoded["payload"]["tasks"][0]["sourceProposalId"],
            "7e8f9a0b-1c2d-4e5f-8a9b-0c1d2e3f4a5b"
        );
        let decoded_again: Envelope<SnapshotPayload> =
            serde_json::from_value(encoded).expect("roundtrip decode");
        assert_eq!(
            decoded_again.payload.weekly_goals[0].source_proposal_id,
            envelope.payload.weekly_goals[0].source_proposal_id
        );
        assert_eq!(
            decoded_again.payload.tasks[0].source_proposal_id,
            envelope.payload.tasks[0].source_proposal_id
        );
    }

    #[test]
    fn source_proposal_ids_with_invalid_id_are_rejected() {
        let text = read_fixture("snapshot-valid.json");
        let mut value: serde_json::Value = serde_json::from_str(&text).expect("fixture json");
        value["payload"]["weeklyGoals"][0]["sourceProposalId"] = serde_json::json!("bad/id");
        value["payload"]["tasks"][0]["sourceProposalId"] = serde_json::json!("short");
        let envelope: Envelope<SnapshotPayload> = serde_json::from_value(value).expect("parse");
        let errors = validate_snapshot(&envelope.payload).expect_err("invalid IDs rejected");
        assert!(errors
            .iter()
            .any(|error| error.contains("weeklyGoal.sourceProposalId")));
        assert!(errors
            .iter()
            .any(|error| error.contains("task.sourceProposalId")));
    }

    #[test]
    fn old_snapshot_without_source_proposal_ids_is_accepted() {
        let text = read_fixture("snapshot-valid.json");
        let mut value: serde_json::Value = serde_json::from_str(&text).expect("fixture json");
        for goal in value["payload"]["weeklyGoals"]
            .as_array_mut()
            .expect("weeklyGoals")
        {
            goal.as_object_mut()
                .expect("weeklyGoal")
                .remove("sourceProposalId");
        }
        for task in value["payload"]["tasks"].as_array_mut().expect("tasks") {
            task.as_object_mut()
                .expect("task")
                .remove("sourceProposalId");
        }
        let envelope: Envelope<SnapshotPayload> = serde_json::from_value(value).expect("parse");
        assert!(envelope
            .payload
            .weekly_goals
            .iter()
            .all(|goal| goal.source_proposal_id.is_none()));
        assert!(envelope
            .payload
            .tasks
            .iter()
            .all(|task| task.source_proposal_id.is_none()));
        validate_snapshot(&envelope.payload).expect("old snapshot remains valid");
    }

    #[test]
    fn oversized_collection_rejected() {
        let subject = SubjectDto {
            remote_id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee".to_string(),
            name: "x".to_string(),
            color: None,
            icon: None,
            sort_order: 0,
            is_archived: false,
            created_at: 1,
            updated_at: 1,
            deleted_at: None,
            exam_track_id: None,
            exam_subject_id: None,
            exam_module_id: None,
        };
        let payload = SnapshotPayload {
            subjects: vec![subject; MAX_COLLECTION_SIZE_SUBJECTS + 1],
            weekly_goals: vec![],
            tasks: vec![],
            study_sessions: vec![],
            learning_analysis: None,
        };
        let errors = validate_snapshot(&payload).expect_err("oversized must be rejected");
        assert!(errors.iter().any(|e| e.contains("数量超过上限")));
    }

    #[test]
    fn negative_duration_rejected() {
        let mut session = StudySessionDto {
            remote_id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee".to_string(),
            subject_remote_id: None,
            task_remote_id: None,
            title: None,
            start_time: 100,
            end_time: None,
            duration_seconds: -1,
            pause_seconds: 0,
            focus_score: None,
            note: None,
            status: 0,
            created_at: 1,
            updated_at: 1,
            deleted_at: None,
            ai_help_seconds: 0,
            ai_help_count: 0,
            external_ai_app_seconds: None,
            ai_usage_source: None,
        };
        let _ = &mut session;
        let errors = validate_snapshot(&SnapshotPayload {
            subjects: vec![],
            weekly_goals: vec![],
            tasks: vec![],
            study_sessions: vec![session],
            learning_analysis: None,
        })
        .expect_err("negative duration must be rejected");
        assert!(errors.iter().any(|e| e.contains("不能为负数")));
    }

    #[test]
    fn ai_usage_fields_validate_and_backward_compatible() {
        // 新字段合法值通过校验。
        let session = StudySessionDto {
            remote_id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee".to_string(),
            subject_remote_id: None,
            task_remote_id: None,
            title: None,
            start_time: 100,
            end_time: Some(200),
            duration_seconds: 50,
            pause_seconds: 10,
            focus_score: None,
            note: None,
            status: 0,
            created_at: 1,
            updated_at: 1,
            deleted_at: None,
            ai_help_seconds: 30,
            ai_help_count: 2,
            external_ai_app_seconds: Some(120),
            ai_usage_source: Some("usage_stats".to_string()),
        };
        validate_snapshot(&SnapshotPayload {
            subjects: vec![],
            weekly_goals: vec![],
            tasks: vec![],
            study_sessions: vec![session.clone()],
            learning_analysis: None,
        })
        .expect("ai fields valid");

        // 非法来源拒绝。
        let bad = StudySessionDto {
            ai_usage_source: Some("unknown_source_x".to_string()),
            ..session.clone()
        };
        let errors = validate_snapshot(&SnapshotPayload {
            subjects: vec![],
            weekly_goals: vec![],
            tasks: vec![],
            study_sessions: vec![bad],
            learning_analysis: None,
        })
        .expect_err("bad aiUsageSource must be rejected");
        assert!(errors.iter().any(|e| e.contains("aiUsageSource")));

        // 负值拒绝。
        let negative = StudySessionDto {
            ai_help_seconds: -1,
            ..session.clone()
        };
        let errors = validate_snapshot(&SnapshotPayload {
            subjects: vec![],
            weekly_goals: vec![],
            tasks: vec![],
            study_sessions: vec![negative],
            learning_analysis: None,
        })
        .expect_err("negative aiHelpSeconds must be rejected");
        assert!(errors.iter().any(|e| e.contains("aiHelpSeconds")));
    }

    #[test]
    fn old_session_without_ai_fields_still_parses() {
        // 旧版手机端快照没有 AI 字段 → serde default（0 / None），兼容。
        let json = serde_json::json!({
            "remoteId": "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
            "title": null,
            "startTime": 100,
            "endTime": 200,
            "durationSeconds": 50,
            "pauseSeconds": 10,
            "status": 0,
            "createdAt": 1,
            "updatedAt": 1
        });
        let session: StudySessionDto = serde_json::from_value(json).expect("parse");
        assert_eq!(session.ai_help_seconds, 0);
        assert_eq!(session.ai_help_count, 0);
        assert_eq!(session.external_ai_app_seconds, None);
        assert_eq!(session.ai_usage_source, None);
    }

    #[test]
    fn token_never_appears_in_error_messages() {
        // Regression guard: validation errors must not echo the pairing token.
        let errors = validate_pair(&PairPayload {
            token: "s3cr3t-pairing-token-abcdef".to_string(),
            device_id: "bad".to_string(),
            owner_identity: None,
        })
        .expect_err("invalid device id");
        let joined = errors.join(";");
        assert!(
            !joined.contains("s3cr3t"),
            "error must not contain token: {joined}"
        );

        let errors = validate_pair(&PairPayload {
            token: "s3cr3t-pairing-token-abcdef".to_string(),
            device_id: String::new(),
            owner_identity: None,
        })
        .expect_err("invalid device id");
        let joined = errors.join(";");
        assert!(
            !joined.contains("s3cr3t"),
            "error must not contain token: {joined}"
        );
    }

    #[test]
    fn snapshot_with_exam_declared_fields_validates() {
        // 手机端可选的考试体系声明字段：合法时通过校验。
        let snapshot = serde_json::json!({
            "subjects": [{
                "remoteId": "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
                "name": "计算机网络",
                "color": null,
                "icon": null,
                "sortOrder": 0,
                "isArchived": false,
                "createdAt": 1,
                "updatedAt": 1,
                "deletedAt": null,
                "examTrackId": "408",
                "examSubjectId": "408.computer-networks",
                "examModuleId": null
            }],
            "weeklyGoals": [],
            "tasks": [],
            "studySessions": []
        });
        let payload: SnapshotPayload = serde_json::from_value(snapshot).expect("parse");
        assert_eq!(payload.subjects[0].exam_track_id.as_deref(), Some("408"));
        assert_eq!(
            payload.subjects[0].exam_subject_id.as_deref(),
            Some("408.computer-networks")
        );
        validate_snapshot(&payload).expect("exam fields valid");
    }

    #[test]
    fn snapshot_with_empty_exam_fields_rejected() {
        let snapshot = serde_json::json!({
            "subjects": [{
                "remoteId": "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
                "name": "计算机网络",
                "color": null,
                "icon": null,
                "sortOrder": 0,
                "isArchived": false,
                "createdAt": 1,
                "updatedAt": 1,
                "deletedAt": null,
                "examTrackId": "  "
            }],
            "weeklyGoals": [],
            "tasks": [],
            "studySessions": []
        });
        let payload: SnapshotPayload = serde_json::from_value(snapshot).expect("parse");
        let errors = validate_snapshot(&payload).expect_err("empty exam field must be rejected");
        assert!(errors.iter().any(|e| e.contains("examTrackId")));
    }

    #[test]
    fn old_snapshot_without_exam_fields_still_parses() {
        // 旧版手机端快照没有 exam 字段 → serde default None，兼容。
        let text = r#"{
            "format": "alerttime-teacher-sync",
            "schemaVersion": 1,
            "messageType": "snapshot",
            "deviceId": "f0a24c19-0f8e-4b6d-9a3c-77e1b2d4c5a6",
            "snapshotId": "5e8f2a91-b3c4-4d5e-9f01-23456789abcd",
            "generatedAt": 1785600000000,
            "payload": {
                "subjects": [{
                    "remoteId": "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
                    "name": "英语",
                    "sortOrder": 0,
                    "isArchived": false,
                    "createdAt": 1,
                    "updatedAt": 1
                }],
                "weeklyGoals": [],
                "tasks": [],
                "studySessions": []
            }
        }"#;
        let envelope: Envelope<SnapshotPayload> = serde_json::from_str(text).expect("parse");
        assert_eq!(envelope.payload.subjects[0].exam_track_id, None);
        assert_eq!(envelope.payload.subjects[0].exam_subject_id, None);
        assert_eq!(envelope.payload.subjects[0].exam_module_id, None);
        validate_snapshot(&envelope.payload).expect("old snapshot valid");
    }

    #[test]
    fn manual_snapshot_roundtrip_json() {
        // Prove the JSON field names match the protocol (camelCase).
        let snapshot = serde_json::json!({
            "subjects": [{
                "remoteId": "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
                "name": "英语",
                "color": null,
                "icon": null,
                "sortOrder": 0,
                "isArchived": false,
                "createdAt": 1,
                "updatedAt": 1,
                "deletedAt": null
            }],
            "weeklyGoals": [],
            "tasks": [],
            "studySessions": []
        });
        let payload: SnapshotPayload = serde_json::from_value(snapshot).expect("camelCase mapping");
        assert_eq!(payload.subjects[0].name, "英语");
        assert_eq!(payload.subjects[0].sort_order, 0);
    }

    #[test]
    fn id_validation_rejects_junk() {
        assert!(!plausible_id(""));
        assert!(!plausible_id("a"));
        assert!(plausible_id("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"));
        assert!(plausible_id("custom-1234567890"));
        let _ = HashMap::<String, String>::new();
    }
}
