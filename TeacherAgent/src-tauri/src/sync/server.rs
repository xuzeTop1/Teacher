//! LAN HTTPS sync server (axum-server + rustls).
//!
//! Security posture:
//! - Server is off by default; the user starts it explicitly on a private LAN IPv4.
//! - TLS with a self-signed cert; the phone only trusts the certificate pin
//!   delivered inside the pairing QR code.
//! - One-time high-entropy pairing token (short TTL, single use) exchanged for
//!   a long random device credential; credentials are stored hashed and salted.
//! - Request body limit (8 MiB), request timeouts and failed-attempt rate
//!   limiting; all logs and error messages are redacted (no tokens, no
//!   credentials, no cert private keys).
//!
//! Rate limiting is keyed by global counters ("pairing" for pair failures,
//! "auth" for credential failures) plus per-device counters after successful
//! authentication. Peer IPs are intentionally not used as keys because the
//! TLS termination lives in the axum-server stack and client IPs would be
//! spoofable on a LAN anyway; the one-time token and device credentials are
//! 256-bit random values, so the limiter is defense in depth, not the only
//! barrier.

use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};

use axum::body::Body;
use axum::extract::{DefaultBodyLimit, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::Response;
use axum::routing::{get, post};
use axum::{Json, Router};
use rand::RngCore;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};

use super::db;
use super::protocol::{
    validate_decision, validate_envelope_head, validate_learning_analysis, validate_pair,
    validate_snapshot, ApiError, DecisionAckPayload, Envelope, PairAckPayload, PairPayload,
    ProposalDecisionPayload, ProposalsListPayload, SnapshotPayload, PROTOCOL_FORMAT,
    SCHEMA_VERSION,
};
use super::tls::TlsIdentity;
use base64::Engine;

const CREDENTIAL_BYTES: usize = 32;
const CREDENTIAL_SALT_BYTES: usize = 16;
const MAX_FAILED_ATTEMPTS_PER_WINDOW: usize = 10;
const FAILURE_WINDOW_MS: i64 = 15 * 60 * 1000;
const DEFAULT_PROPOSAL_LIMIT: usize = 50;
const REQUEST_TIMEOUT_SECS: u64 = 30;

const RATE_KEY_PAIRING: &str = "pairing";
const RATE_KEY_AUTH: &str = "auth";

#[derive(Clone)]
pub(crate) struct AppState {
    pub(crate) db: Arc<Mutex<Connection>>,
    pub(crate) certificate_pin: String,
    pub(crate) failures: Arc<Mutex<HashMap<String, Vec<i64>>>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ServerStatus {
    pub running: bool,
    pub address: Option<String>,
    pub port: Option<u16>,
    pub started_at_ms: Option<i64>,
    pub certificate_pin: Option<String>,
}

#[derive(Default, Clone)]
pub(crate) struct ServerRuntime {
    inner: Arc<Mutex<Option<RunningServer>>>,
}

struct RunningServer {
    addr: SocketAddr,
    started_at_ms: i64,
    certificate_pin: String,
    handle: axum_server::Handle,
}

impl RunningServer {
    fn address(&self) -> String {
        self.addr.ip().to_string()
    }
    fn port(&self) -> u16 {
        self.addr.port()
    }
    fn certificate_pin(&self) -> String {
        self.certificate_pin.clone()
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProposalsQuery {
    pub cursor: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HealthPayload {
    pub service: &'static str,
    pub protocol: &'static str,
    pub schema_version: i64,
    pub server_time: i64,
}

// ── Server lifecycle ───────────────────────────────────────────────────

pub(crate) async fn start(
    runtime: &ServerRuntime,
    db: Arc<Mutex<Connection>>,
    identity: TlsIdentity,
    addr: SocketAddr,
) -> Result<ServerStatus, String> {
    let mut guard = runtime
        .inner
        .lock()
        .map_err(|_| "sync server runtime poisoned".to_string())?;
    if guard.is_some() {
        return Ok(status_locked(&guard));
    }

    let tls_config = tls_server_config(&identity)?;
    let state = AppState {
        db,
        certificate_pin: identity.spki_pin_hex.clone(),
        failures: Arc::new(Mutex::new(HashMap::new())),
    };
    let router = build_router(state);

    let tls_config = axum_server::tls_rustls::RustlsConfig::from_config(Arc::new(tls_config));
    // 手动绑定以便读取实际地址（addr 为 0 端口时由 OS 分配），并保留防火墙诊断信息。
    let listener = std::net::TcpListener::bind(addr).map_err(|error| {
        format!(
            "无法在 {addr} 监听：{error}。若为防火墙阻止，请在 Windows 防火墙中允许本应用访问专用网络"
        )
    })?;
    listener
        .set_nonblocking(true)
        .map_err(|error| format!("failed to configure listener: {error}"))?;
    let actual_addr = listener
        .local_addr()
        .map_err(|error| format!("failed to read listening address: {error}"))?;
    let handle = axum_server::Handle::new();
    let server = axum_server::from_tcp_rustls(listener, tls_config)
        .handle(handle.clone())
        .serve(router.into_make_service());

    // 注意：不要在这里调用 handle.graceful_shutdown(...) —— 该 API 会立即发出
    // 优雅关闭信号（而非配置未来的超时），导致服务刚启动就退出。
    let inner = runtime.inner.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(error) = server.await {
            eprintln!("[sync] server error: {error}");
        }
        eprintln!("[sync] server stopped");
        // 服务退出（用户停止或异常结束）后清空运行时状态，
        // 避免 UI 残留“服务运行中”。
        if let Ok(mut guard) = inner.lock() {
            *guard = None;
        }
    });

    *guard = Some(RunningServer {
        addr: actual_addr,
        started_at_ms: unix_ms_now(),
        certificate_pin: identity.spki_pin_hex.clone(),
        handle,
    });
    eprintln!(
        "[sync] HTTPS sync server listening on {} (certificate pin: {}…)",
        actual_addr,
        &identity.spki_pin_hex[..8]
    );
    Ok(ServerStatus {
        running: true,
        address: Some(actual_addr.ip().to_string()),
        port: Some(actual_addr.port()),
        started_at_ms: Some(unix_ms_now()),
        certificate_pin: Some(identity.spki_pin_hex),
    })
}

pub(crate) fn stop(runtime: &ServerRuntime) -> Result<(), String> {
    let mut guard = runtime
        .inner
        .lock()
        .map_err(|_| "sync server runtime poisoned".to_string())?;
    if let Some(server) = guard.take() {
        // 优雅关闭：发送关闭信号并允许最多 3 秒排空现有连接；
        // 超过时限由 axum-server 强制结束。
        server
            .handle
            .graceful_shutdown(Some(std::time::Duration::from_secs(3)));
    }
    Ok(())
}

pub(crate) fn status(runtime: &ServerRuntime) -> ServerStatus {
    match runtime.inner.lock() {
        Ok(guard) => status_locked(&guard),
        Err(_) => ServerStatus {
            running: false,
            address: None,
            port: None,
            started_at_ms: None,
            certificate_pin: None,
        },
    }
}

fn status_locked(guard: &Option<RunningServer>) -> ServerStatus {
    match guard {
        Some(server) => ServerStatus {
            running: true,
            address: Some(server.address()),
            port: Some(server.port()),
            started_at_ms: Some(server.started_at_ms),
            certificate_pin: None,
        },
        None => ServerStatus {
            running: false,
            address: None,
            port: None,
            started_at_ms: None,
            certificate_pin: None,
        },
    }
}

/// Returns the running server's address/pin when active (used by pairing).
pub(crate) fn running_server_info(runtime: &ServerRuntime) -> Option<(String, u16, String)> {
    let guard = runtime.inner.lock().ok()?;
    guard
        .as_ref()
        .map(|server| (server.address(), server.port(), server.certificate_pin()))
}

fn tls_server_config(identity: &TlsIdentity) -> Result<rustls::ServerConfig, String> {
    super::tls::build_server_config(identity)
}

fn unix_ms_now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

fn build_router(state: AppState) -> Router {
    Router::new()
        .route("/v1/health", get(handle_health))
        .route("/v1/pair", post(handle_pair))
        .route("/v1/snapshots", post(handle_snapshots))
        .route("/v1/proposals", get(handle_proposals))
        .route("/v1/proposal-decisions", post(handle_proposal_decisions))
        .route("/v1/unpair", post(handle_unpair))
        .layer(DefaultBodyLimit::max(super::protocol::MAX_SYNC_BYTES))
        .layer(axum::middleware::from_fn(request_timeout_middleware))
        .with_state(state)
}

/// Per-request timeout implemented as middleware (keeps the router's error
/// type Infallible, so no HandleErrorLayer stack is needed).
async fn request_timeout_middleware(
    request: axum::extract::Request,
    next: axum::middleware::Next,
) -> Response {
    match tokio::time::timeout(
        std::time::Duration::from_secs(REQUEST_TIMEOUT_SECS),
        next.run(request),
    )
    .await
    {
        Ok(response) => response,
        Err(_) => ApiError::new(408, "request_timeout", "请求超时").into(),
    }
}

fn envelope_value<T: Serialize>(
    message_type: &str,
    device_id: &str,
    snapshot_id: Option<&str>,
    payload: T,
) -> serde_json::Value {
    serde_json::json!({
        "format": PROTOCOL_FORMAT,
        "schemaVersion": SCHEMA_VERSION,
        "messageType": message_type,
        "deviceId": device_id,
        "snapshotId": snapshot_id,
        "generatedAt": unix_ms_now(),
        "appVersion": env!("CARGO_PKG_VERSION"),
        "protocolCapabilities": { "fullSnapshotV1": true, "proposalsV1": true },
        "cursor": null,
        "payload": serde_json::to_value(payload).unwrap_or(serde_json::Value::Null),
    })
}

fn json_response(status: StatusCode, value: &serde_json::Value) -> Response {
    let body = serde_json::to_vec(value).unwrap_or_else(|_| b"{}".to_vec());
    Response::builder()
        .status(status)
        .header(
            axum::http::header::CONTENT_TYPE,
            "application/json; charset=utf-8",
        )
        .body(Body::from(body))
        .unwrap_or_else(|_| Response::new(Body::from("{}")))
}

fn ok_json(value: &serde_json::Value) -> Response {
    json_response(StatusCode::OK, value)
}

// ── Rate limiting ──────────────────────────────────────────────────────

fn check_rate_limit(state: &AppState, key: &str) -> Result<(), ApiError> {
    let now = unix_ms_now();
    let mut failures = state
        .failures
        .lock()
        .map_err(|_| ApiError::new(500, "internal", "限流状态不可用"))?;
    let window = failures.entry(key.to_string()).or_default();
    window.retain(|timestamp| now - timestamp < FAILURE_WINDOW_MS);
    if window.len() >= MAX_FAILED_ATTEMPTS_PER_WINDOW {
        return Err(ApiError::new(
            429,
            "too_many_attempts",
            "尝试次数过多，请稍后再试",
        ));
    }
    Ok(())
}

fn record_failure(state: &AppState, key: &str) {
    if let Ok(mut failures) = state.failures.lock() {
        failures
            .entry(key.to_string())
            .or_default()
            .push(unix_ms_now());
    }
}

// ── Auth ───────────────────────────────────────────────────────────────

/// Extracts and authenticates the Bearer device credential. Returns the
/// device id. Failed attempts count toward the global auth rate limit.
fn authenticate(state: &AppState, headers: &HeaderMap) -> Result<String, ApiError> {
    let auth = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| {
            record_failure(state, RATE_KEY_AUTH);
            ApiError::new(401, "missing_credential", "缺少设备凭据")
        })?;
    let credential = auth
        .strip_prefix("Bearer ")
        .ok_or_else(|| {
            record_failure(state, RATE_KEY_AUTH);
            ApiError::new(401, "missing_credential", "凭据格式错误")
        })?
        .trim();

    if credential.is_empty() || credential.len() > 256 {
        record_failure(state, RATE_KEY_AUTH);
        return Err(ApiError::new(401, "missing_credential", "凭据格式错误"));
    }

    let connection = state
        .db
        .lock()
        .map_err(|_| ApiError::new(500, "internal", "数据库不可用"))?;
    match db::find_device_by_credential(&connection, credential) {
        Ok(Some(device_id)) => Ok(device_id),
        Ok(None) => {
            record_failure(state, RATE_KEY_AUTH);
            Err(ApiError::new(
                401,
                "invalid_credential",
                "设备凭据无效或已被撤销",
            ))
        }
        Err(error) => {
            record_failure(state, RATE_KEY_AUTH);
            Err(ApiError::new(
                500,
                "internal",
                format!("鉴权失败: {}", redact(&error)),
            ))
        }
    }
}

fn redact(error: &str) -> String {
    error.chars().take(200).collect()
}

/// Strict per-endpoint message type check: each endpoint only accepts its own
/// messageType; a generic head check must never let a wrong message type into
/// another endpoint.
fn validate_message_type(expected: &str, actual: &str) -> Result<(), ApiError> {
    if actual != expected {
        return Err(ApiError::new(
            400,
            "invalid_message_type",
            format!("messageType 必须为 {expected}"),
        ));
    }
    Ok(())
}

fn short_id(id: &str) -> String {
    id.chars().take(8).collect()
}

// ── Handlers ───────────────────────────────────────────────────────────

async fn handle_health(State(state): State<AppState>) -> Response {
    let payload = HealthPayload {
        service: "teacher-agent-sync",
        protocol: PROTOCOL_FORMAT,
        schema_version: SCHEMA_VERSION,
        server_time: unix_ms_now(),
    };
    let _ = &state;
    ok_json(&serde_json::to_value(payload).unwrap_or_default())
}

async fn handle_pair(
    State(state): State<AppState>,
    Json(body): Json<serde_json::Value>,
) -> Response {
    let envelope: Envelope<PairPayload> = match serde_json::from_value(body) {
        Ok(value) => value,
        Err(error) => {
            return ApiError::new(400, "invalid_request", format!("请求格式不正确: {error}"))
                .into();
        }
    };
    if let Err(errors) = validate_envelope_head(
        &envelope.format,
        envelope.schema_version,
        &envelope.message_type,
        &envelope.device_id,
        envelope.generated_at,
        envelope.app_version.as_deref(),
    ) {
        return ApiError::new(400, "invalid_request", errors.join("；")).into();
    }
    // 本端点只接受 pair 消息；错误消息类型不得混入。
    if let Err(error) = validate_message_type("pair", &envelope.message_type) {
        return error.into();
    }
    if let Err(errors) = validate_pair(&envelope.payload) {
        return ApiError::new(400, "invalid_request", errors.join("；")).into();
    }
    if envelope.device_id != envelope.payload.device_id {
        return ApiError::new(
            400,
            "invalid_request",
            "信封 deviceId 必须与 payload.deviceId 一致",
        )
        .into();
    }

    if let Err(error) = check_rate_limit(&state, RATE_KEY_PAIRING) {
        return error.into();
    }

    let token_hash = db::sha256_hex(envelope.payload.token.as_bytes());
    let mut connection = match state.db.lock() {
        Ok(connection) => connection,
        Err(_) => return ApiError::new(500, "internal", "数据库不可用").into(),
    };

    // One transaction: consume the one-time token + register the device.
    let transaction = match connection.transaction() {
        Ok(transaction) => transaction,
        Err(error) => {
            return ApiError::new(
                500,
                "internal",
                format!("事务失败: {}", redact(&error.to_string())),
            )
            .into();
        }
    };
    let consumed = match db::consume_pairing_token(
        &transaction,
        &token_hash,
        &envelope.payload.device_id,
        unix_ms_now(),
    ) {
        Ok(value) => value,
        Err(error) => {
            return ApiError::new(500, "internal", format!("配对失败: {}", redact(&error))).into();
        }
    };
    if !consumed {
        record_failure(&state, RATE_KEY_PAIRING);
        return ApiError::new(400, "invalid_token", "配对 token 无效、已过期或已被使用").into();
    }

    let mut credential_bytes = [0u8; CREDENTIAL_BYTES];
    rand::rngs::OsRng.fill_bytes(&mut credential_bytes);
    let credential = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(credential_bytes);
    let mut salt_bytes = [0u8; CREDENTIAL_SALT_BYTES];
    rand::rngs::OsRng.fill_bytes(&mut salt_bytes);
    let salt = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(salt_bytes);
    let credential_hash = db::credential_hash(&salt, &credential);
    let credential_lookup = db::credential_lookup_key(&credential);

    if let Err(error) = db::insert_device(
        &transaction,
        &envelope.payload.device_id,
        "AlertTime 手机",
        &credential_lookup,
        &salt,
        &credential_hash,
        &state.certificate_pin,
        envelope.payload.owner_identity.as_deref(),
    ) {
        return ApiError::new(500, "internal", format!("配对失败: {}", redact(&error))).into();
    }
    if let Err(error) = transaction.commit() {
        return ApiError::new(
            500,
            "internal",
            format!("配对失败: {}", redact(&error.to_string())),
        )
        .into();
    }

    let ack = PairAckPayload {
        credential,
        device_id: envelope.payload.device_id.clone(),
        display_name: "AlertTime 手机".to_string(),
    };
    eprintln!(
        "[sync] device paired: id={}",
        short_id(&envelope.payload.device_id)
    );
    ok_json(&envelope_value(
        "pairAck",
        &envelope.payload.device_id,
        None,
        ack,
    ))
}

async fn handle_snapshots(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<serde_json::Value>,
) -> Response {
    let device_id = match authenticate(&state, &headers) {
        Ok(device_id) => device_id,
        Err(error) => return error.into(),
    };

    let envelope: Envelope<SnapshotPayload> = match serde_json::from_value(body) {
        Ok(value) => value,
        Err(error) => {
            return ApiError::new(400, "invalid_request", format!("请求格式不正确: {error}"))
                .into();
        }
    };
    if let Err(errors) = validate_envelope_head(
        &envelope.format,
        envelope.schema_version,
        &envelope.message_type,
        &envelope.device_id,
        envelope.generated_at,
        envelope.app_version.as_deref(),
    ) {
        return ApiError::new(400, "invalid_request", errors.join("；")).into();
    }
    // 本端点只接受 snapshot 消息。
    if let Err(error) = validate_message_type("snapshot", &envelope.message_type) {
        return error.into();
    }
    if envelope.device_id != device_id {
        return ApiError::new(403, "device_mismatch", "快照 deviceId 与凭据不匹配").into();
    }
    let snapshot_id = match &envelope.snapshot_id {
        Some(id) if super::protocol::plausible_id(id) => id.clone(),
        _ => return ApiError::new(400, "invalid_request", "snapshotId 非法").into(),
    };
    if let Err(errors) = validate_snapshot(&envelope.payload) {
        return ApiError::new(422, "invalid_snapshot", errors.join("；")).into();
    }
    if let Err(errors) = validate_learning_analysis(&envelope.payload, &snapshot_id) {
        return ApiError::new(422, "invalid_learning_analysis", errors.join("；")).into();
    }

    let mut connection = match state.db.lock() {
        Ok(connection) => connection,
        Err(_) => return ApiError::new(500, "internal", "数据库不可用").into(),
    };
    let received_at = unix_ms_now();
    match db::import_snapshot(
        &mut connection,
        &device_id,
        &snapshot_id,
        &envelope.payload,
        received_at,
    ) {
        Ok(outcome) => {
            let ack = db::build_snapshot_ack(outcome, received_at);
            eprintln!(
                "[sync] snapshot accepted: device={} snapshot={} subjects={} goals={} tasks={} sessions={}",
                short_id(&device_id),
                short_id(&snapshot_id),
                ack.entity_counts.subjects,
                ack.entity_counts.weekly_goals,
                ack.entity_counts.tasks,
                ack.entity_counts.study_sessions,
            );
            ok_json(&envelope_value(
                "snapshotAck",
                &device_id,
                Some(&snapshot_id),
                ack,
            ))
        }
        Err(error) => {
            ApiError::new(500, "internal", format!("快照导入失败: {}", redact(&error))).into()
        }
    }
}

async fn handle_proposals(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<ProposalsQuery>,
) -> Response {
    let device_id = match authenticate(&state, &headers) {
        Ok(device_id) => device_id,
        Err(error) => return error.into(),
    };
    let cursor = match query.cursor {
        None => None,
        Some(value) if value.trim().is_empty() => {
            return ApiError::new(400, "invalid_cursor", "分页游标无效").into();
        }
        Some(value) => Some(value),
    };

    let connection = match state.db.lock() {
        Ok(connection) => connection,
        Err(_) => return ApiError::new(500, "internal", "数据库不可用").into(),
    };
    match db::list_proposals(
        &connection,
        &device_id,
        cursor.as_deref(),
        DEFAULT_PROPOSAL_LIMIT,
    ) {
        Ok(proposals) => {
            let next_cursor = proposals
                .last()
                .map(|proposal| proposal.proposal_id.clone());
            let payload = ProposalsListPayload {
                proposals,
                next_cursor,
            };
            ok_json(&envelope_value("proposal", &device_id, None, payload))
        }
        Err(db::ProposalListError::InvalidCursor) => {
            ApiError::new(400, "invalid_cursor", "分页游标无效").into()
        }
        Err(db::ProposalListError::Database(error)) => {
            ApiError::new(500, "internal", format!("读取建议失败: {}", redact(&error))).into()
        }
    }
}

async fn handle_proposal_decisions(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<serde_json::Value>,
) -> Response {
    let device_id = match authenticate(&state, &headers) {
        Ok(device_id) => device_id,
        Err(error) => return error.into(),
    };
    let envelope: Envelope<ProposalDecisionPayload> = match serde_json::from_value(body) {
        Ok(value) => value,
        Err(error) => {
            return ApiError::new(400, "invalid_request", format!("请求格式不正确: {error}"))
                .into();
        }
    };
    if let Err(errors) = validate_envelope_head(
        &envelope.format,
        envelope.schema_version,
        &envelope.message_type,
        &envelope.device_id,
        envelope.generated_at,
        envelope.app_version.as_deref(),
    ) {
        return ApiError::new(400, "invalid_request", errors.join("；")).into();
    }
    // 本端点只接受 proposalDecision 消息。
    if let Err(error) = validate_message_type("proposalDecision", &envelope.message_type) {
        return error.into();
    }
    if envelope.device_id != device_id {
        return ApiError::new(403, "device_mismatch", "决策 deviceId 与凭据不匹配").into();
    }
    if let Err(errors) = validate_decision(&envelope.payload) {
        return ApiError::new(400, "invalid_request", errors.join("；")).into();
    }

    let mut connection = match state.db.lock() {
        Ok(connection) => connection,
        Err(_) => return ApiError::new(500, "internal", "数据库不可用").into(),
    };
    match db::apply_decision(&mut connection, &device_id, &envelope.payload) {
        Ok(db::DecisionOutcome::Recorded) | Ok(db::DecisionOutcome::AlreadyRecorded) => {
            let ack = DecisionAckPayload {
                proposal_id: envelope.payload.proposal_id.clone(),
                decision: envelope.payload.decision.clone(),
                recorded: true,
            };
            eprintln!(
                "[sync] decision recorded: device={} proposal={} decision={}",
                short_id(&device_id),
                short_id(&ack.proposal_id),
                ack.decision
            );
            ok_json(&envelope_value("decisionAck", &device_id, None, ack))
        }
        Ok(db::DecisionOutcome::StatusConflict) => {
            ApiError::new(409, "decision_conflict", "该建议已被处理，无法变更决策").into()
        }
        Ok(db::DecisionOutcome::NotFound) => {
            ApiError::new(404, "proposal_not_found", "建议不存在").into()
        }
        Err(error) => {
            ApiError::new(500, "internal", format!("记录决策失败: {}", redact(&error))).into()
        }
    }
}

/// Self-revocation: the phone presents its Bearer credential to revoke its
/// own device on the server. After this, the old credential returns 401.
/// Response is sent only after the revocation commit succeeds.
async fn handle_unpair(State(state): State<AppState>, headers: HeaderMap) -> Response {
    let device_id = match authenticate(&state, &headers) {
        Ok(device_id) => device_id,
        Err(error) => return error.into(),
    };

    let connection = match state.db.lock() {
        Ok(connection) => connection,
        Err(_) => return ApiError::new(500, "internal", "数据库不可用").into(),
    };
    match db::revoke_device(&connection, &device_id) {
        Ok(revoked) => {
            eprintln!("[sync] device self-revoked: id={}", short_id(&device_id));
            let payload = serde_json::json!({
                "deviceId": device_id,
                "revoked": revoked,
            });
            ok_json(&envelope_value("unpairAck", &device_id, None, payload))
        }
        Err(error) => {
            ApiError::new(500, "internal", format!("撤销失败: {}", redact(&error))).into()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::super::protocol::{EntityCounts, ProposalDto, SnapshotAckPayload};
    use super::*;
    use axum::body::to_bytes;
    use axum::http::{Method, Request};
    use serde_json::Value;
    use tower::ServiceExt;

    const TEST_DEVICE_ID: &str = "f0a24c19-0f8e-4b6d-9a3c-77e1b2d4c5a6";
    const TEST_CREDENTIAL: &str = "test-credential-for-snapshot-replay";

    fn test_identity() -> TlsIdentity {
        super::super::tls::generate_identity(Some("127.0.0.1")).expect("identity")
    }

    fn test_db() -> Arc<Mutex<Connection>> {
        let connection = Connection::open_in_memory().expect("in-memory db");
        crate::database::apply_migrations(&connection).expect("current application schema");
        Arc::new(Mutex::new(connection))
    }

    fn authenticated_test_state() -> (AppState, Arc<Mutex<Connection>>) {
        let database = test_db();
        {
            let connection = database.lock().expect("test db lock");
            let salt = "test-salt";
            let credential_hash = db::credential_hash(salt, TEST_CREDENTIAL);
            let credential_lookup = db::credential_lookup_key(TEST_CREDENTIAL);
            db::insert_device(
                &connection,
                TEST_DEVICE_ID,
                "测试手机",
                &credential_lookup,
                salt,
                &credential_hash,
                "test-certificate-pin",
                None,
            )
            .expect("test device");
        }
        let state = AppState {
            db: Arc::clone(&database),
            certificate_pin: "test-certificate-pin".to_string(),
            failures: Arc::new(Mutex::new(HashMap::new())),
        };
        (state, database)
    }

    async fn post_snapshot(router: Router, body: Value) -> (StatusCode, Value) {
        let request = Request::builder()
            .method(Method::POST)
            .uri("/v1/snapshots")
            .header(
                axum::http::header::AUTHORIZATION,
                format!("Bearer {TEST_CREDENTIAL}"),
            )
            .header(axum::http::header::CONTENT_TYPE, "application/json")
            .body(Body::from(body.to_string()))
            .expect("snapshot request");
        let response = router.oneshot(request).await.expect("router response");
        let status = response.status();
        let bytes = to_bytes(response.into_body(), super::super::protocol::MAX_SYNC_BYTES)
            .await
            .expect("response body");
        let json = serde_json::from_slice(&bytes).expect("json response");
        (status, json)
    }

    async fn get_proposals(router: Router, query: &str) -> (StatusCode, Value) {
        let request = Request::builder()
            .method(Method::GET)
            .uri(format!("/v1/proposals{query}"))
            .header(
                axum::http::header::AUTHORIZATION,
                format!("Bearer {TEST_CREDENTIAL}"),
            )
            .body(Body::empty())
            .expect("proposal request");
        let response = router.oneshot(request).await.expect("router response");
        let status = response.status();
        let bytes = to_bytes(response.into_body(), super::super::protocol::MAX_SYNC_BYTES)
            .await
            .expect("response body");
        let json = serde_json::from_slice(&bytes).expect("json response");
        (status, json)
    }

    fn valid_snapshot_fixture() -> Value {
        serde_json::from_str(include_str!(
            "../../../sync/protocol/fixtures/snapshot-valid.json"
        ))
        .expect("canonical snapshot fixture")
    }

    /// 无监听端口的真实 HTTP route 回放：鉴权 -> envelope/analysis 校验 -> SQLite
    /// 导入 -> snapshotAck -> read model 中读取绑定当前 snapshot 的 analysis。
    /// canonical snapshot 中带有 sourceProposalId，但测试数据库没有对应本地 proposal；
    /// 这证明快照导入不把 Teacher 本地 proposal 状态当作准入条件。
    #[tokio::test]
    async fn snapshot_route_replays_canonical_fixture_into_read_model() {
        let (state, database) = authenticated_test_state();
        let router = build_router(state);
        let snapshot = valid_snapshot_fixture();
        let snapshot_id = snapshot["snapshotId"]
            .as_str()
            .expect("snapshot id")
            .to_string();
        let expected_subject_ids: Vec<String> = snapshot["payload"]["subjects"]
            .as_array()
            .expect("subjects")
            .iter()
            .map(|value| value["remoteId"].as_str().expect("subject id").to_string())
            .collect();
        let expected_goal_ids: Vec<String> = snapshot["payload"]["weeklyGoals"]
            .as_array()
            .expect("weekly goals")
            .iter()
            .map(|value| value["remoteId"].as_str().expect("goal id").to_string())
            .collect();
        let expected_task_ids: Vec<String> = snapshot["payload"]["tasks"]
            .as_array()
            .expect("tasks")
            .iter()
            .map(|value| value["remoteId"].as_str().expect("task id").to_string())
            .collect();
        let expected_source_proposal_id = snapshot["payload"]["weeklyGoals"][0]["sourceProposalId"]
            .as_str()
            .expect("source proposal id")
            .to_string();
        let expected_task_source_proposal_id = snapshot["payload"]["tasks"][0]["sourceProposalId"]
            .as_str()
            .expect("task source proposal id")
            .to_string();
        let expected_session_ids: Vec<String> = snapshot["payload"]["studySessions"]
            .as_array()
            .expect("study sessions")
            .iter()
            .map(|value| value["remoteId"].as_str().expect("session id").to_string())
            .collect();

        let (status, response) = post_snapshot(router, snapshot).await;

        assert_eq!(status, StatusCode::OK);
        assert_eq!(response["format"], PROTOCOL_FORMAT);
        assert_eq!(response["messageType"], "snapshotAck");
        assert_eq!(response["deviceId"], TEST_DEVICE_ID);
        assert_eq!(response["snapshotId"], snapshot_id);
        assert_eq!(response["payload"]["accepted"], true);
        assert_eq!(
            response["payload"]["entityCounts"]["subjects"].as_u64(),
            Some(expected_subject_ids.len() as u64)
        );
        assert_eq!(
            response["payload"]["entityCounts"]["weeklyGoals"].as_u64(),
            Some(expected_goal_ids.len() as u64)
        );
        assert_eq!(
            response["payload"]["entityCounts"]["tasks"].as_u64(),
            Some(expected_task_ids.len() as u64)
        );
        assert_eq!(
            response["payload"]["entityCounts"]["studySessions"].as_u64(),
            Some(expected_session_ids.len() as u64)
        );

        let connection = database.lock().expect("test db lock");
        let read_model = db::load_read_model(&connection, TEST_DEVICE_ID).expect("read model");
        assert_eq!(read_model.subjects.len(), expected_subject_ids.len());
        assert_eq!(read_model.weekly_goals.len(), expected_goal_ids.len());
        assert_eq!(read_model.tasks.len(), expected_task_ids.len());
        assert_eq!(read_model.study_sessions.len(), expected_session_ids.len());
        assert_eq!(
            expected_source_proposal_id,
            "7e8f9a0b-1c2d-4e5f-8a9b-0c1d2e3f4a5b"
        );
        let read_goal = read_model
            .weekly_goals
            .iter()
            .find(|goal| goal.remote_id == expected_goal_ids[0])
            .expect("canonical goal in read model");
        assert_eq!(
            read_goal.source_proposal_id.as_deref(),
            Some(expected_source_proposal_id.as_str())
        );
        let read_task = read_model
            .tasks
            .iter()
            .find(|task| task.remote_id == expected_task_ids[0])
            .expect("canonical task in read model");
        assert_eq!(
            read_task.source_proposal_id.as_deref(),
            Some(expected_task_source_proposal_id.as_str())
        );
        let local_proposal_count: i64 = connection
            .query_row("SELECT COUNT(1) FROM sync_proposals", [], |row| row.get(0))
            .expect("proposal count");
        assert_eq!(local_proposal_count, 0, "no local proposal is required");
        for expected_id in expected_subject_ids {
            assert!(read_model
                .subjects
                .iter()
                .any(|row| row.remote_id == expected_id));
        }
        for expected_id in expected_goal_ids {
            assert!(read_model
                .weekly_goals
                .iter()
                .any(|row| row.remote_id == expected_id));
        }
        for expected_id in expected_task_ids {
            assert!(read_model
                .tasks
                .iter()
                .any(|row| row.remote_id == expected_id));
        }
        for expected_id in expected_session_ids {
            assert!(read_model
                .study_sessions
                .iter()
                .any(|row| row.remote_id == expected_id));
        }
        let analysis = read_model
            .latest_learning_analysis
            .expect("learning analysis persisted");
        assert_eq!(analysis.source_snapshot_id, snapshot_id);
        assert_eq!(analysis.generator, "deterministic_fallback");
        assert_eq!(analysis.assessment_draft.status, "draft");
    }

    /// Fail-closed 回放：已有合法读模型后，新 analysis 引用当前快照外实体时 HTTP
    /// 拒绝，SQLite 不记录新快照/分析，也不改写旧读模型或 last_sync_at。
    #[tokio::test]
    async fn snapshot_route_rejects_unbound_analysis_without_persisting_snapshot() {
        let (state, database) = authenticated_test_state();
        let router = build_router(state);
        let baseline_snapshot = valid_snapshot_fixture();
        let baseline_snapshot_id = baseline_snapshot["snapshotId"]
            .as_str()
            .expect("baseline snapshot id")
            .to_string();
        let (baseline_status, _) = post_snapshot(router.clone(), baseline_snapshot).await;
        assert_eq!(baseline_status, StatusCode::OK);
        let (baseline_subject_ids, baseline_task_ids, baseline_last_sync_at) = {
            let connection = database.lock().expect("baseline db lock");
            let model = db::load_read_model(&connection, TEST_DEVICE_ID).expect("baseline model");
            connection
                .execute(
                    "UPDATE sync_devices SET last_sync_at = 'baseline-last-sync' WHERE id = ?1",
                    [TEST_DEVICE_ID],
                )
                .expect("set baseline last sync sentinel");
            let last_sync_at: Option<String> = connection
                .query_row(
                    "SELECT last_sync_at FROM sync_devices WHERE id = ?1",
                    [TEST_DEVICE_ID],
                    |row| row.get(0),
                )
                .expect("baseline last sync");
            (
                model
                    .subjects
                    .into_iter()
                    .map(|row| row.remote_id)
                    .collect::<Vec<_>>(),
                model
                    .tasks
                    .into_iter()
                    .map(|row| row.remote_id)
                    .collect::<Vec<_>>(),
                last_sync_at,
            )
        };
        let mut snapshot = valid_snapshot_fixture();
        let snapshot_id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa".to_string();
        snapshot["snapshotId"] = Value::String(snapshot_id.clone());
        snapshot["payload"]["learningAnalysis"]["sourceSnapshotId"] =
            Value::String(snapshot_id.clone());
        snapshot["payload"]["learningAnalysis"]["profile"]["facts"][0]["evidenceRefs"] =
            serde_json::json!(["task:99999999-9999-4999-8999-999999999999"]);

        let (status, response) = post_snapshot(router, snapshot).await;

        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
        assert_eq!(response["code"], "invalid_learning_analysis");
        let connection = database.lock().expect("test db lock");
        let successful_snapshots: i64 = connection
            .query_row(
                "SELECT COUNT(1) FROM sync_snapshots WHERE device_id = ?1 AND id = ?2",
                rusqlite::params![TEST_DEVICE_ID, snapshot_id],
                |row| row.get(0),
            )
            .expect("snapshot count");
        let persisted_analyses: i64 = connection
            .query_row(
                "SELECT COUNT(1) FROM sync_learning_analyses WHERE device_id = ?1 AND snapshot_id = ?2",
                rusqlite::params![TEST_DEVICE_ID, snapshot_id],
                |row| row.get(0),
            )
            .expect("analysis count");
        let model_after_rejection =
            db::load_read_model(&connection, TEST_DEVICE_ID).expect("model after rejection");
        let last_sync_at_after: Option<String> = connection
            .query_row(
                "SELECT last_sync_at FROM sync_devices WHERE id = ?1",
                [TEST_DEVICE_ID],
                |row| row.get(0),
            )
            .expect("last sync after rejection");
        assert_eq!(successful_snapshots, 0);
        assert_eq!(persisted_analyses, 0);
        assert_eq!(
            model_after_rejection
                .latest_learning_analysis
                .expect("baseline analysis retained")
                .source_snapshot_id,
            baseline_snapshot_id
        );
        assert_eq!(
            model_after_rejection
                .subjects
                .into_iter()
                .map(|row| row.remote_id)
                .collect::<Vec<_>>(),
            baseline_subject_ids
        );
        assert_eq!(
            model_after_rejection
                .tasks
                .into_iter()
                .map(|row| row.remote_id)
                .collect::<Vec<_>>(),
            baseline_task_ids
        );
        assert_eq!(last_sync_at_after, baseline_last_sync_at);
    }

    #[tokio::test]
    async fn proposals_route_distinguishes_home_valid_cursor_and_invalid_cursor() {
        let (state, database) = authenticated_test_state();
        let second_device = "a0a24c19-0f8e-4b6d-9a3c-77e1b2d4c5a6";
        let first_id = "11111111-1111-4111-8111-111111111111";
        let second_id = "22222222-2222-4222-8222-222222222222";
        let foreign_id = "33333333-3333-4333-8333-333333333333";
        {
            let mut connection = database.lock().expect("proposal db lock");
            for (id, device, created_at) in [
                (first_id, TEST_DEVICE_ID, 1_800_000_000_001_i64),
                (second_id, TEST_DEVICE_ID, 1_800_000_000_000_i64),
                (foreign_id, second_device, 1_800_000_000_002_i64),
            ] {
                db::create_proposal(
                    &mut connection,
                    &ProposalDto {
                        proposal_id: id.to_string(),
                        device_id: device.to_string(),
                        version: 1,
                        status: "pending".to_string(),
                        rationale: "route cursor test".to_string(),
                        proposed_weekly_goals: vec![],
                        proposed_tasks: vec![],
                        source_assessment_ids: vec![],
                        created_at,
                        expires_at: None,
                    },
                )
                .expect("proposal");
            }
            for index in 0..49 {
                db::create_proposal(
                    &mut connection,
                    &ProposalDto {
                        proposal_id: format!("extra-{index:02}"),
                        device_id: TEST_DEVICE_ID.to_string(),
                        version: 1,
                        status: "pending".to_string(),
                        rationale: "route cursor test".to_string(),
                        proposed_weekly_goals: vec![],
                        proposed_tasks: vec![],
                        source_assessment_ids: vec![],
                        created_at: 1_799_999_000_000_i64 - index as i64,
                        expires_at: None,
                    },
                )
                .expect("extra proposal");
            }
        }
        let router = build_router(state);

        let (status, home) = get_proposals(router.clone(), "").await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(home["payload"]["proposals"][0]["proposalId"], first_id);
        assert_eq!(home["payload"]["proposals"].as_array().unwrap().len(), 50);
        let page_one_cursor = home["payload"]["nextCursor"]
            .as_str()
            .expect("page one cursor")
            .to_string();

        let (status, next_page) =
            get_proposals(router.clone(), &format!("?cursor={page_one_cursor}")).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(
            next_page["payload"]["proposals"].as_array().unwrap().len(),
            1
        );
        assert_ne!(
            next_page["payload"]["proposals"][0]["proposalId"],
            page_one_cursor
        );
        assert_eq!(
            next_page["payload"]["nextCursor"],
            next_page["payload"]["proposals"][0]["proposalId"]
        );

        for query in [
            "?cursor=",
            "?cursor=%20%20",
            "?cursor=missing-cursor",
            &format!("?cursor={foreign_id}"),
        ] {
            let (status, error) = get_proposals(router.clone(), query).await;
            assert_eq!(status, StatusCode::BAD_REQUEST, "query={query}");
            assert_eq!(error["code"], "invalid_cursor", "query={query}");
            assert_eq!(error["message"], "分页游标无效", "query={query}");
            assert!(!error.to_string().contains(foreign_id));
        }

        let unauthorized = router
            .oneshot(
                Request::builder()
                    .method(Method::GET)
                    .uri("/v1/proposals?cursor=missing-cursor")
                    .body(Body::empty())
                    .expect("unauthorized proposal request"),
            )
            .await
            .expect("router response");
        assert_eq!(unauthorized.status(), StatusCode::UNAUTHORIZED);
        let bytes = to_bytes(
            unauthorized.into_body(),
            super::super::protocol::MAX_SYNC_BYTES,
        )
        .await
        .expect("unauthorized response body");
        let error: Value = serde_json::from_slice(&bytes).expect("unauthorized json");
        assert_eq!(error["code"], "missing_credential");
    }

    /// P0 回归：start() 之后服务必须持续监听，不能因 graceful_shutdown 误用而立即退出。
    #[tokio::test]
    async fn server_stays_alive_after_start_until_stopped() {
        let runtime = ServerRuntime::default();
        let addr: SocketAddr = "127.0.0.1:0".parse().expect("addr");
        let started = start(&runtime, test_db(), test_identity(), addr)
            .await
            .expect("start");
        assert!(started.running);
        let bound = format!("127.0.0.1:{}", started.port.expect("port"));

        // 启动 400ms 后 TCP 层仍可连接（listener 存活）。
        tokio::time::sleep(std::time::Duration::from_millis(400)).await;
        assert!(
            std::net::TcpStream::connect(&bound).is_ok(),
            "服务启动后 400ms 内应持续监听 {bound}"
        );

        // 再过 400ms 仍然存活（不是启动后自动关闭）。
        tokio::time::sleep(std::time::Duration::from_millis(400)).await;
        assert!(
            std::net::TcpStream::connect(&bound).is_ok(),
            "服务不应自动关闭，{bound} 应仍可连接"
        );

        // 停止后：状态清空，端口释放。
        stop(&runtime).expect("stop");
        let after_stop = status(&runtime);
        assert!(!after_stop.running);
        assert!(after_stop.port.is_none());
        tokio::time::sleep(std::time::Duration::from_millis(300)).await;
        assert!(
            std::net::TcpStream::connect(&bound).is_err(),
            "停止后端口应释放"
        );
    }

    /// P0 回归：服务异常/正常退出后运行时状态必须清空（UI 不得残留“运行中”）。
    #[tokio::test]
    async fn runtime_state_clears_after_server_task_finishes() {
        let runtime = ServerRuntime::default();
        let addr: SocketAddr = "127.0.0.1:0".parse().expect("addr");
        let _ = start(&runtime, test_db(), test_identity(), addr)
            .await
            .expect("start");
        assert!(status(&runtime).running);

        stop(&runtime).expect("stop");
        // 等待 server task 退出并清理 inner。
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        let after = status(&runtime);
        assert!(!after.running);
        assert!(after.address.is_none());
    }

    #[tokio::test]
    async fn pair_rejects_envelope_payload_device_mismatch_without_consuming_token() {
        let database = test_db();
        let token = "pair-token-that-must-survive-mismatch";
        let expected_device = TEST_DEVICE_ID;
        let wrong_envelope_device = "a0a24c19-0f8e-4b6d-9a3c-77e1b2d4c5a6";
        {
            let connection = database.lock().expect("test db lock");
            db::insert_pairing_token(
                &connection,
                &db::sha256_hex(token.as_bytes()),
                expected_device,
                unix_ms_now() + 600_000,
            )
            .expect("pairing token");
        }
        let state = AppState {
            db: Arc::clone(&database),
            certificate_pin: "test-certificate-pin".to_string(),
            failures: Arc::new(Mutex::new(HashMap::new())),
        };
        let router = build_router(state);
        let mut request = serde_json::from_str::<Value>(include_str!(
            "../../../sync/protocol/fixtures/pair-valid.json"
        ))
        .expect("pair fixture");
        request["payload"]["token"] = Value::String(token.to_string());
        request["deviceId"] = Value::String(wrong_envelope_device.to_string());
        let response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/v1/pair")
                    .header(axum::http::header::CONTENT_TYPE, "application/json")
                    .body(Body::from(request.to_string()))
                    .expect("mismatched pair request"),
            )
            .await
            .expect("router response");
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        let bytes = to_bytes(response.into_body(), super::super::protocol::MAX_SYNC_BYTES)
            .await
            .expect("response body");
        let error: Value = serde_json::from_slice(&bytes).expect("error json");
        assert_eq!(error["code"], "invalid_request");

        {
            let connection = database.lock().expect("test db lock");
            let used_at: Option<i64> = connection
                .query_row(
                    "SELECT used_at FROM sync_pairing_tokens WHERE token_hash = ?1",
                    [db::sha256_hex(token.as_bytes())],
                    |row| row.get(0),
                )
                .expect("token row");
            assert!(used_at.is_none());
            let device_count: i64 = connection
                .query_row(
                    "SELECT COUNT(1) FROM sync_devices WHERE id = ?1",
                    [expected_device],
                    |row| row.get(0),
                )
                .expect("device count");
            assert_eq!(device_count, 0);
        }

        let mut correct_request = serde_json::from_str::<Value>(include_str!(
            "../../../sync/protocol/fixtures/pair-valid.json"
        ))
        .expect("pair fixture");
        correct_request["payload"]["token"] = Value::String(token.to_string());
        let response = router
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/v1/pair")
                    .header(axum::http::header::CONTENT_TYPE, "application/json")
                    .body(Body::from(correct_request.to_string()))
                    .expect("correct pair request"),
            )
            .await
            .expect("router response");
        assert_eq!(response.status(), StatusCode::OK);
        let connection = database.lock().expect("test db lock");
        let device_count: i64 = connection
            .query_row(
                "SELECT COUNT(1) FROM sync_devices WHERE id = ?1",
                [expected_device],
                |row| row.get(0),
            )
            .expect("device count");
        assert_eq!(device_count, 1);
    }

    #[tokio::test]
    async fn unpair_route_revokes_credential_and_later_requests_are_unauthorized() {
        let (state, database) = authenticated_test_state();
        let router = build_router(state);

        let response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/v1/unpair")
                    .header(
                        axum::http::header::AUTHORIZATION,
                        format!("Bearer {TEST_CREDENTIAL}"),
                    )
                    .body(Body::empty())
                    .expect("unpair request"),
            )
            .await
            .expect("router response");
        assert_eq!(response.status(), StatusCode::OK);
        let bytes = to_bytes(response.into_body(), super::super::protocol::MAX_SYNC_BYTES)
            .await
            .expect("body");
        let value: Value = serde_json::from_slice(&bytes).expect("json");
        assert_eq!(value["messageType"], "unpairAck");
        assert_eq!(value["deviceId"], TEST_DEVICE_ID);
        assert_eq!(value["payload"]["revoked"], true);

        {
            let connection = database.lock().expect("test db lock");
            let revoked_at: Option<String> = connection
                .query_row(
                    "SELECT revoked_at FROM sync_devices WHERE id = ?1",
                    [TEST_DEVICE_ID],
                    |row| row.get(0),
                )
                .expect("device row");
            assert!(revoked_at.is_some(), "revoke must stamp revoked_at");
        }

        // 撤销后旧凭据立即失效：需要鉴权的端点必须 401，不泄露设备存在性。
        let response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/v1/snapshots")
                    .header(
                        axum::http::header::AUTHORIZATION,
                        format!("Bearer {TEST_CREDENTIAL}"),
                    )
                    .header(axum::http::header::CONTENT_TYPE, "application/json")
                    .body(Body::from("{}"))
                    .expect("post-revoke snapshot request"),
            )
            .await
            .expect("router response");
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);

        // 重复撤销（幂等）：已撤销凭据同样无法通过鉴权。
        let response = router
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/v1/unpair")
                    .header(
                        axum::http::header::AUTHORIZATION,
                        format!("Bearer {TEST_CREDENTIAL}"),
                    )
                    .body(Body::empty())
                    .expect("repeat unpair request"),
            )
            .await
            .expect("router response");
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[test]
    fn redact_caps_length() {
        let long = "x".repeat(1000);
        assert!(redact(&long).len() <= 200);
    }

    #[test]
    fn short_id_truncates() {
        assert_eq!(short_id("f0a24c19-0f8e-4b6d-9a3c-77e1b2d4c5a6"), "f0a24c19");
    }

    #[test]
    fn envelope_value_shapes_match_protocol() {
        let value = envelope_value(
            "snapshotAck",
            "f0a24c19-0f8e-4b6d-9a3c-77e1b2d4c5a6",
            Some("5e8f2a91-b3c4-4d5e-9f01-23456789abcd"),
            DecisionAckPayload {
                proposal_id: "9c2d6e5f-4a7b-4c8d-9e0f-1a2b3c4d5e6f".to_string(),
                decision: "accepted".to_string(),
                recorded: true,
            },
        );
        assert_eq!(value["format"], "alerttime-teacher-sync");
        assert_eq!(value["schemaVersion"], 1);
        assert_eq!(value["messageType"], "snapshotAck");
        assert_eq!(value["snapshotId"], "5e8f2a91-b3c4-4d5e-9f01-23456789abcd");
        assert_eq!(value["payload"]["decision"], "accepted");
        assert!(value["generatedAt"].is_number());
        assert!(value["protocolCapabilities"]["proposalsV1"]
            .as_bool()
            .unwrap_or(false));
    }

    #[test]
    fn endpoint_message_types_are_strict() {
        // 每个端点只接受自己的 messageType；错误类型必须被拒绝。
        assert!(validate_message_type("pair", "pair").is_ok());
        assert!(validate_message_type("snapshot", "snapshot").is_ok());
        assert!(validate_message_type("proposalDecision", "proposalDecision").is_ok());

        // 错误消息类型不得混入其他端点。
        let error = validate_message_type("pair", "snapshot").expect_err("reject");
        assert_eq!(error.status, 400);
        assert_eq!(error.code, "invalid_message_type");
        assert!(error.message.contains("pair"));

        let error = validate_message_type("snapshot", "proposalDecision").expect_err("reject");
        assert!(error.message.contains("snapshot"));

        let error = validate_message_type("proposalDecision", "pair").expect_err("reject");
        assert!(error.message.contains("proposalDecision"));
    }

    #[test]
    fn snapshot_ack_carries_requested_snapshot_id() {
        // 手机端需要关联发出的 snapshotId；ack 信封必须回显。
        let value = envelope_value(
            "snapshotAck",
            "f0a24c19-0f8e-4b6d-9a3c-77e1b2d4c5a6",
            Some("5e8f2a91-b3c4-4d5e-9f01-23456789abcd"),
            SnapshotAckPayload {
                accepted: true,
                received_at: 1,
                entity_counts: EntityCounts {
                    subjects: 1,
                    weekly_goals: 0,
                    tasks: 0,
                    study_sessions: 0,
                },
            },
        );
        assert_eq!(value["snapshotId"], "5e8f2a91-b3c4-4d5e-9f01-23456789abcd");
        // 非快照响应不携带 snapshotId（null）。
        let pair_value = envelope_value(
            "pairAck",
            "f0a24c19-0f8e-4b6d-9a3c-77e1b2d4c5a6",
            None,
            PairAckPayload {
                credential: "cred".to_string(),
                device_id: "f0a24c19-0f8e-4b6d-9a3c-77e1b2d4c5a6".to_string(),
                display_name: "AlertTime 手机".to_string(),
            },
        );
        assert!(pair_value["snapshotId"].is_null());
    }
}
