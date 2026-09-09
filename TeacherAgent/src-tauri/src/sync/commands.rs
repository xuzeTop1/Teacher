//! Thin Tauri command wrappers for the LAN sync feature. The Vue frontend
//! talks to these commands only; it never binds ports, opens SQLite directly,
//! stores pairing tokens or touches certificate private keys.

use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::sync::{Arc, Mutex};

use base64::Engine;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};

use crate::sync::db;
use crate::sync::server::{self, ServerRuntime};
use crate::sync::tls;

const DEFAULT_SYNC_PORT: u16 = 8787;
const PAIRING_TOKEN_TTL_MS: i64 = 10 * 60 * 1000;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PairingInfo {
    pub qr_text: String,
    pub token: String,
    pub expires_at_ms: i64,
    pub device_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CreateProposalInput {
    pub device_id: String,
    pub rationale: String,
    pub proposed_weekly_goals: Vec<crate::sync::protocol::ProposedWeeklyGoalDto>,
    pub proposed_tasks: Vec<crate::sync::protocol::ProposedTaskDto>,
    pub source_assessment_ids: Vec<String>,
    pub expires_at_ms: Option<i64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FirewallDiagnosis {
    pub firewall_enabled: Option<bool>,
    pub self_test_ok: bool,
    pub self_test_message: String,
    pub guidance: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SyncDeviceState {
    pub read_model: db::ReadModel,
    pub last_snapshot: Option<db::LastSnapshotInfo>,
}

fn open_connection(app: &AppHandle) -> Result<rusqlite::Connection, String> {
    crate::database::open_migrated_database(app)
}

// ── Server lifecycle ───────────────────────────────────────────────────

/// 虚拟/隧道/非直连网卡名称片断，枚举局域网 IPv4 时排除，避免把已断开或
/// 虚拟网卡（VirtualBox、OpenVPN、Teredo、蓝牙 PAN 等）的遗留地址当可用接口。
const VIRTUAL_IFACE_KEYWORDS: &[&str] = &[
    "virtualbox", "vmware", "vbox", "virtual", "teredo", "wintun", "openvpn",
    "surfshark", "tailscale", "zerotier", "tunnel", "vpn", "bluetooth",
    "蓝牙", "虚拟", "windows.nt.host-window", "wi-fi direct", "热点", "wlan 2",
];

fn is_usable_ipv4(ip: &Ipv4Addr, iface_name: &str) -> bool {
    if ip.is_loopback() || ip.is_unspecified() || ip.is_multicast() {
        return false;
    }
    // APIPA（169.254.0.0/16）：网卡无 DHCP 地址时自动配置的无效地址。
    if ip.octets()[0] == 169 && ip.octets()[1] == 254 {
        return false;
    }
    let lower = iface_name.to_ascii_lowercase();
    VIRTUAL_IFACE_KEYWORDS.iter().all(|k| !lower.contains(k))
}

#[cfg(windows)]
mod windows_net {
    //! 用 GetAdaptersAddresses 精确枚举仅处于 Up 状态的适配器。曲线道路是
    //! local_ip_address::list_afinet_netifas 会包含已断开网卡的遗留 IP
    //! （例如拔掉网线后仍保留的静态地址），导致同步界面出现无法连接的地址。

    use std::ptr;
    use std::slice;

    use windows_sys::Win32::NetworkManagement::IpHelper::{
        GetAdaptersAddresses, IP_ADAPTER_ADDRESSES_LH,
    };
    use windows_sys::Win32::NetworkManagement::Ndis::IfOperStatusUp;
    use windows_sys::Win32::Networking::WinSock::{AF_INET, SOCKADDR_IN};

    pub(super) fn list() -> Vec<(String, String, std::net::Ipv4Addr)> {
        let mut result = Vec::new();
        let mut size: u32 = 0;
        // 先获取所需缓冲区大小。
        let flags = 0u32;
        let err = unsafe {
            GetAdaptersAddresses(AF_INET as u32, flags, ptr::null(), ptr::null_mut(), &mut size)
        };
        if err != windows_sys::Win32::Foundation::ERROR_BUFFER_OVERFLOW && size == 0 {
            return result;
        }
        let mut buffer = vec![0u8; size as usize];
        let adapter = buffer.as_mut_ptr() as *mut IP_ADAPTER_ADDRESSES_LH;
        let err = unsafe {
            GetAdaptersAddresses(AF_INET as u32, flags, ptr::null(), adapter, &mut size)
        };
        if err != 0 {
            return result;
        }
        let mut current = adapter;
        while !current.is_null() {
            let entry = unsafe { &*current };
            if entry.OperStatus == IfOperStatusUp {
                let friendly_name = unsafe {
                    if entry.FriendlyName.is_null() {
                        String::new()
                    } else {
                        let len = {
                            let mut p = entry.FriendlyName;
                            while *p != 0 {
                                p = p.wrapping_offset(1);
                            }
                            p.offset_from(entry.FriendlyName) as usize
                        };
                        String::from_utf16_lossy(slice::from_raw_parts(entry.FriendlyName, len))
                    }
                };
                let description = unsafe {
                    if entry.Description.is_null() {
                        String::new()
                    } else {
                        let len = {
                            let mut p = entry.Description;
                            while *p != 0 {
                                p = p.wrapping_offset(1);
                            }
                            p.offset_from(entry.Description) as usize
                        };
                        String::from_utf16_lossy(slice::from_raw_parts(entry.Description, len))
                    }
                };
                let mut uaddr = entry.FirstUnicastAddress;
                while !uaddr.is_null() {
                    let uentry = unsafe { &*uaddr };
                    if !uentry.Address.lpSockaddr.is_null() {
                        let sa = unsafe { &*(uentry.Address.lpSockaddr as *const SOCKADDR_IN) };
                        // SIN_FAMILY 用 ADDRESS_FAMILY(u16)，AF_INET=2。
                        if sa.sin_family == windows_sys::Win32::Networking::WinSock::AF_INET {
                            let oct = unsafe { sa.sin_addr.S_un.S_addr.to_ne_bytes() };
                            let ip = std::net::Ipv4Addr::new(oct[0], oct[1], oct[2], oct[3]);
                            result.push((friendly_name.clone(), description.clone(), ip));
                        }
                    }
                    uaddr = uentry.Next;
                }
            }
            current = entry.Next;
        }
        result
    }
}

#[cfg(windows)]
fn list_private_ipv4() -> Result<Vec<String>, String> {
    let addrs = windows_net::list();
    let mut result: Vec<String> = addrs
        .into_iter()
        .filter_map(|(friendly, description, ip)| {
            // Description 含硬件名（如 "Remote NDIS Compatible Device"），
            // 用于更精确地命中虚拟网卡黑名单。
            let label = if description.is_empty() {
                friendly
            } else if description.contains(&friendly) {
                description
            } else {
                format!("{friendly} ({description})")
            };
            if is_usable_ipv4(&ip, &label) {
                Some(format!("{label} ({ip})"))
            } else {
                None
            }
        })
        .collect();
    result.sort();
    if result.is_empty() {
        return Err("未找到可用的活动局域网 IPv4 地址".to_string());
    }
    Ok(result)
}

#[cfg(not(windows))]
fn list_private_ipv4() -> Result<Vec<String>, String> {
    // 非 Windows 平台暂时没有适配器操作状态，退化为「枚举 + 名称/APIPA 过滤」。
    let addresses = local_ip_address::list_afinet_netifas()
        .map_err(|error| format!("无法枚举本机网络接口：{error}"))?;
    let mut result: Vec<String> = addresses
        .into_iter()
        .filter_map(|(name, ip)| match ip {
            IpAddr::V4(ipv4) if is_usable_ipv4(&ipv4, &name) => Some(format!("{name} ({ipv4})")),
            _ => None,
        })
        .collect();
    result.sort();
    if result.is_empty() {
        return Err("未找到可用的私有局域网 IPv4 地址".to_string());
    }
    Ok(result)
}

#[tauri::command]
pub(crate) fn sync_list_private_ipv4() -> Result<Vec<String>, String> {
    list_private_ipv4()
}

#[tauri::command]
pub(crate) async fn sync_start_server(
    app: AppHandle,
    runtime: State<'_, ServerRuntime>,
    interface: String,
    port: Option<u16>,
) -> Result<server::ServerStatus, String> {
    let port = port.unwrap_or(DEFAULT_SYNC_PORT);
    if port == 0 {
        return Err("端口必须在 1-65535 之间".to_string());
    }
    let ipv4 = parse_interface(&interface)?;
    let identity = tls::load_or_create_identity(Some(&ipv4.to_string()))?;
    let connection = Arc::new(Mutex::new(open_connection(&app)?));
    let addr = SocketAddr::new(IpAddr::V4(ipv4), port);
    server::start(runtime.inner(), connection, identity, addr).await
}

fn parse_interface(interface: &str) -> Result<Ipv4Addr, String> {
    // Accept either a bare IPv4 or "<iface-name> (<ip>)" produced by
    // sync_list_private_ipv4. The name part may itself contain parentheses
    // (e.g. "以太网 3 (Remote NDIS Compatible Device) (10.248.148.58)"), so
    // the IP is always the LAST parenthesized group, not first-'(' to last-')'.
    let candidate = match (interface.rfind('('), interface.rfind(')')) {
        (Some(start), Some(end)) if end > start => interface[start + 1..end].trim(),
        _ => interface,
    };
    let ipv4: Ipv4Addr = candidate
        .parse()
        .map_err(|_| format!("不是有效的 IPv4 地址: {interface}"))?;
    if ipv4.is_loopback() {
        return Err("不能使用回环地址，请选择私有局域网 IPv4".to_string());
    }
    Ok(ipv4)
}

#[tauri::command]
pub(crate) fn sync_stop_server(runtime: State<'_, ServerRuntime>) -> Result<(), String> {
    server::stop(runtime.inner())
}

#[tauri::command]
pub(crate) fn sync_server_status(runtime: State<'_, ServerRuntime>) -> server::ServerStatus {
    server::status(runtime.inner())
}

// ── Pairing ────────────────────────────────────────────────────────────

#[tauri::command]
pub(crate) fn sync_new_pairing(
    app: AppHandle,
    runtime: State<'_, ServerRuntime>,
) -> Result<PairingInfo, String> {
    let (address, port, pin) = server::running_server_info(runtime.inner())
        .ok_or_else(|| "同步服务未开启，请先开启服务再配对".to_string())?;

    let mut token_bytes = [0u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut token_bytes);
    let token = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(token_bytes);
    let expires_at_ms = unix_ms_now() + PAIRING_TOKEN_TTL_MS;

    let mut device_bytes = [0u8; 16];
    rand::rngs::OsRng.fill_bytes(&mut device_bytes);
    device_bytes[6] = (device_bytes[6] & 0x0f) | 0x40; // version 4
    device_bytes[8] = (device_bytes[8] & 0x3f) | 0x80; // variant
    let device_id = format_uuid(&device_bytes);

    let connection = open_connection(&app)?;
    let token_hash = db::sha256_hex(token.as_bytes());
    db::insert_pairing_token(&connection, &token_hash, &device_id, expires_at_ms)?;

    let qr_text = format!(
        "ta-sync://v1?host={address}&port={port}&pin={pin}&token={token}&expiresAt={expires_at_ms}&deviceId={device_id}"
    );
    eprintln!(
        "[sync] pairing token issued: device={} expires_in={}s",
        &device_id[..8],
        PAIRING_TOKEN_TTL_MS / 1000
    );
    Ok(PairingInfo {
        qr_text,
        token,
        expires_at_ms,
        device_id,
    })
}

fn format_uuid(bytes: &[u8; 16]) -> String {
    let hex_string = hex::encode(bytes);
    format!(
        "{}-{}-{}-{}-{}",
        &hex_string[0..8],
        &hex_string[8..12],
        &hex_string[12..16],
        &hex_string[16..20],
        &hex_string[20..32]
    )
}

fn unix_ms_now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

// ── Devices ────────────────────────────────────────────────────────────

#[tauri::command]
pub(crate) fn sync_list_devices(app: AppHandle) -> Result<Vec<db::DeviceInfo>, String> {
    let connection = open_connection(&app)?;
    db::list_devices(&connection)
}

#[tauri::command]
pub(crate) fn sync_revoke_device(app: AppHandle, device_id: String) -> Result<bool, String> {
    if !crate::sync::protocol::plausible_id(&device_id) {
        return Err("deviceId 非法".to_string());
    }
    let connection = open_connection(&app)?;
    let revoked = db::revoke_device(&connection, &device_id)?;
    if revoked {
        eprintln!("[sync] device revoked: {}", &device_id[..8]);
    }
    Ok(revoked)
}

// ── Read model / mappings / proposals (desktop-side UI) ────────────────

#[tauri::command]
pub(crate) fn sync_get_read_model(
    app: AppHandle,
    device_id: String,
) -> Result<db::ReadModel, String> {
    let connection = open_connection(&app)?;
    db::load_read_model(&connection, &device_id)
}

#[tauri::command]
pub(crate) fn sync_last_snapshot(
    app: AppHandle,
    device_id: String,
) -> Result<Option<db::LastSnapshotInfo>, String> {
    let connection = open_connection(&app)?;
    db::last_snapshot(&connection, &device_id)
}

fn load_device_state(
    connection: &mut rusqlite::Connection,
    device_id: &str,
) -> Result<SyncDeviceState, String> {
    let transaction = connection
        .transaction()
        .map_err(|error| format!("failed to start device state read transaction: {error}"))?;
    let read_model = db::load_read_model(&transaction, device_id)?;
    let last_snapshot = db::last_snapshot(&transaction, device_id)?;
    transaction
        .commit()
        .map_err(|error| format!("failed to commit device state read transaction: {error}"))?;
    Ok(SyncDeviceState {
        read_model,
        last_snapshot,
    })
}

#[tauri::command]
pub(crate) fn sync_get_device_state(
    app: AppHandle,
    device_id: String,
) -> Result<SyncDeviceState, String> {
    let mut connection = open_connection(&app)?;
    load_device_state(&mut connection, &device_id)
}

#[tauri::command]
pub(crate) fn sync_list_mappings(
    app: AppHandle,
    device_id: String,
) -> Result<Vec<db::SubjectMappingRow>, String> {
    let connection = open_connection(&app)?;
    db::list_mappings(&connection, &device_id)
}

#[tauri::command]
pub(crate) fn sync_set_mapping(
    app: AppHandle,
    device_id: String,
    alert_subject_remote_id: String,
    teacher_subject_id: String,
    exam_track_id: Option<String>,
    exam_subject_id: Option<String>,
    exam_module_id: Option<String>,
) -> Result<(), String> {
    if !crate::sync::protocol::plausible_id(&alert_subject_remote_id) {
        return Err("alertSubjectRemoteId 非法".to_string());
    }
    if teacher_subject_id.trim().is_empty() || teacher_subject_id.len() > 64 {
        return Err("teacherSubjectId 非法".to_string());
    }
    for (value, what) in [
        (exam_track_id.as_deref(), "examTrackId"),
        (exam_subject_id.as_deref(), "examSubjectId"),
        (exam_module_id.as_deref(), "examModuleId"),
    ] {
        if let Some(value) = value {
            if value.trim().is_empty() || value.chars().count() > 200 {
                return Err(format!("{what} 非法"));
            }
        }
    }
    let connection = open_connection(&app)?;
    db::set_mapping(
        &connection,
        &device_id,
        &alert_subject_remote_id,
        &teacher_subject_id,
        exam_track_id,
        exam_subject_id,
        exam_module_id,
    )
}

#[tauri::command]
pub(crate) fn sync_remove_mapping(
    app: AppHandle,
    device_id: String,
    alert_subject_remote_id: String,
) -> Result<bool, String> {
    let connection = open_connection(&app)?;
    db::remove_mapping(&connection, &device_id, &alert_subject_remote_id)
}

#[tauri::command]
pub(crate) fn sync_list_proposals(
    app: AppHandle,
    device_id: String,
) -> Result<Vec<crate::sync::protocol::ProposalDto>, String> {
    let connection = open_connection(&app)?;
    db::list_proposals(&connection, &device_id, None, 200).map_err(|error| match error {
        db::ProposalListError::InvalidCursor => "invalid proposal cursor".to_string(),
        db::ProposalListError::Database(error) => error,
    })
}

/// Creates a plan proposal for a device (TeacherAgent is the only writer).
/// Any previously pending proposal of the same device is superseded.
#[tauri::command]
pub(crate) fn sync_create_proposal(
    app: AppHandle,
    input: CreateProposalInput,
) -> Result<crate::sync::protocol::ProposalDto, String> {
    // 桌面端是 proposal 的唯一创建方；这里必须执行与 Android
    // validateProposalsResponse 相同的契约，否则手机会整页拒绝建议。
    validate_create_proposal_input(&input, unix_ms_now())?;

    let mut proposal_bytes = [0u8; 16];
    rand::rngs::OsRng.fill_bytes(&mut proposal_bytes);
    proposal_bytes[6] = (proposal_bytes[6] & 0x0f) | 0x40;
    proposal_bytes[8] = (proposal_bytes[8] & 0x3f) | 0x80;
    let proposal_id = format_uuid(&proposal_bytes);

    let proposal = crate::sync::protocol::ProposalDto {
        proposal_id,
        device_id: input.device_id.clone(),
        version: 1,
        status: "pending".to_string(),
        rationale: input.rationale,
        proposed_weekly_goals: input.proposed_weekly_goals,
        proposed_tasks: input.proposed_tasks,
        source_assessment_ids: input.source_assessment_ids,
        created_at: unix_ms_now(),
        expires_at: input.expires_at_ms,
    };
    let mut connection = open_connection(&app)?;
    db::create_proposal(&mut connection, &proposal)?;
    eprintln!(
        "[sync] proposal created: device={} proposal={} goals={} tasks={}",
        &input.device_id[..8],
        &proposal.proposal_id[..8],
        proposal.proposed_weekly_goals.len(),
        proposal.proposed_tasks.len()
    );
    Ok(proposal)
}

// ── Diagnostics ────────────────────────────────────────────────────────

#[tauri::command]
pub(crate) fn sync_firewall_diagnose(
    runtime: State<'_, ServerRuntime>,
) -> Result<FirewallDiagnosis, String> {
    let status = server::status(runtime.inner());
    let mut firewall_enabled: Option<bool> = None;
    let firewall_output = std::process::Command::new("netsh")
        .args(["advfirewall", "show", "allprofiles", "state"])
        .output();
    if let Ok(output) = firewall_output {
        let text = String::from_utf8_lossy(&output.stdout).to_lowercase();
        firewall_enabled = Some(text.contains("state on"));
    }

    let (self_test_ok, self_test_message) = match (status.address.clone(), status.port) {
        (Some(address), Some(port)) => {
            let ipv4: Ipv4Addr = match address.parse() {
                Ok(ipv4) => ipv4,
                Err(_) => {
                    return Ok(FirewallDiagnosis {
                        firewall_enabled,
                        self_test_ok: false,
                        self_test_message: "无法解析监听地址".to_string(),
                        guidance: "请重新开启同步服务".to_string(),
                    });
                }
            };
            let target = SocketAddr::new(IpAddr::V4(ipv4), port);
            match std::net::TcpStream::connect_timeout(&target, std::time::Duration::from_secs(2)) {
                Ok(_) => (true, "本机可连接到同步服务端口".to_string()),
                Err(error) => (false, format!("本机无法连接同步服务端口：{error}")),
            }
        }
        _ => (false, "同步服务未开启".to_string()),
    };

    let guidance = match (firewall_enabled, self_test_ok) {
        (_, true) => "本机自检通过。若手机仍无法连接，请确认：1) 手机与电脑在同一 WiFi/热点；2) 路由器未开启 AP isolation；3) Windows 防火墙允许本应用访问专用网络（首次启动时弹出的允许框需要勾选「专用网络」）。学校、公司和公共 WiFi 可能存在 AP isolation、VLAN 或防火墙限制，局域网同步不能保证可用。".to_string(),
        (Some(true), false) => "Windows 防火墙已开启且本机自检未通过。请在「Windows 安全中心 → 防火墙和网络保护 → 允许应用通过防火墙」中允许本应用访问专用网络，然后重新开启同步服务并重试。".to_string(),
        (_, false) => self_test_message.clone(),
    };
    Ok(FirewallDiagnosis {
        firewall_enabled,
        self_test_ok,
        self_test_message,
        guidance,
    })
}

/// Proposal 创建输入校验：与 Android validateProposalsResponse / 协议 schema 的
/// proposedWeeklyGoal、proposedTask 定义逐条对齐（fail-closed，创建前拒绝）。
fn validate_create_proposal_input(input: &CreateProposalInput, now_ms: i64) -> Result<(), String> {
    if !crate::sync::protocol::plausible_id(&input.device_id) {
        return Err("deviceId 非法".to_string());
    }
    if input.rationale.trim().is_empty() || input.rationale.chars().count() > 20_000 {
        return Err("rationale 非法".to_string());
    }
    if input.proposed_weekly_goals.len() > crate::sync::protocol::MAX_PROPOSED_WEEKLY_GOALS
        || input.proposed_tasks.len() > crate::sync::protocol::MAX_PROPOSED_TASKS
    {
        return Err("建议内容超出上限".to_string());
    }
    if input.source_assessment_ids.len() > crate::sync::protocol::MAX_SOURCE_ASSESSMENT_IDS {
        return Err("sourceAssessmentIds 超出上限".to_string());
    }
    for task in &input.proposed_tasks {
        if task.title.trim().is_empty() || task.title.chars().count() > 200 {
            return Err("建议任务标题非法".to_string());
        }
        if let Some(subject_id) = &task.subject_remote_id {
            if !crate::sync::protocol::plausible_id(subject_id) {
                return Err("建议任务 subjectRemoteId 非法".to_string());
            }
        }
        if task.target_duration_seconds.is_some_and(|value| value < 0) {
            return Err("建议任务 targetDurationSeconds 非法".to_string());
        }
        if task.due_at.is_some_and(|value| value < 0) {
            return Err("建议任务 dueAt 非法".to_string());
        }
    }
    for goal in &input.proposed_weekly_goals {
        if goal.title.trim().is_empty() || goal.title.chars().count() > 200 {
            return Err("建议周目标标题非法".to_string());
        }
        if goal.week_start <= 0 {
            return Err("建议周目标 weekStart 非法".to_string());
        }
        if let Some(criteria) = &goal.success_criteria {
            if criteria.chars().count()
                > crate::sync::protocol::MAX_PROPOSED_SUCCESS_CRITERIA_LENGTH
            {
                return Err("建议周目标 successCriteria 超过上限".to_string());
            }
        }
    }
    let mut seen_source_ids = std::collections::HashSet::new();
    for id in &input.source_assessment_ids {
        if !crate::sync::protocol::plausible_id(id) {
            return Err("sourceAssessmentId 非法".to_string());
        }
        if !seen_source_ids.insert(id.as_str()) {
            return Err("sourceAssessmentIds 重复".to_string());
        }
    }
    if let Some(expires_at) = input.expires_at_ms {
        if expires_at < now_ms {
            return Err("建议有效期已过期".to_string());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn valid_create_proposal_input() -> CreateProposalInput {
        CreateProposalInput {
            device_id: "f0a24c19-0f8e-4b6d-9a3c-77e1b2d4c5a6".to_string(),
            rationale: "基于本周诊断证据的建议".to_string(),
            proposed_weekly_goals: vec![crate::sync::protocol::ProposedWeeklyGoalDto {
                week_start: 1_000,
                title: "完成英语巩固计划".to_string(),
                success_criteria: Some("诊断正确率 ≥ 80%".to_string()),
            }],
            proposed_tasks: vec![crate::sync::protocol::ProposedTaskDto {
                title: "完成 20 道时态选择题".to_string(),
                subject_remote_id: Some("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee".to_string()),
                target_duration_seconds: Some(1_800),
                due_at: Some(2_000),
            }],
            source_assessment_ids: vec!["9c2d6e5f-4a7b-4c8d-9e0f-1a2b3c4d5e6f".to_string()],
            expires_at_ms: Some(5_000),
        }
    }

    #[test]
    fn create_proposal_input_accepts_contract_valid_payload() {
        assert!(validate_create_proposal_input(&valid_create_proposal_input(), 1_000).is_ok());
    }

    #[test]
    fn usable_ipv4_accepts_private_and_public_rfc1918() {
        assert!(is_usable_ipv4(&"10.248.148.58".parse().unwrap(), "Remote NDIS Compatible Device"));
        assert!(is_usable_ipv4(&"192.168.1.5".parse().unwrap(), "以太网"));
        assert!(is_usable_ipv4(&"172.16.0.9".parse().unwrap(), "Wi-Fi"));
    }

    #[test]
    fn usable_ipv4_rejects_loopback_apipa_and_unspecified() {
        assert!(!is_usable_ipv4(&"127.0.0.1".parse().unwrap(), "Loopback"));
        assert!(!is_usable_ipv4(&"169.254.250.250".parse().unwrap(), "以太网 3"));
        assert!(!is_usable_ipv4(&"0.0.0.0".parse().unwrap(), "以太网"));
    }

    #[test]
    fn usable_ipv4_rejects_virtual_tunnel_and_bluetooth_ifaces() {
        assert!(!is_usable_ipv4(&"192.168.56.1".parse().unwrap(), "VirtualBox Host-Only Ethernet Adapter"));
        assert!(!is_usable_ipv4(&"10.248.148.58".parse().unwrap(), "Teredo Tunneling Pseudo-Interface"));
        assert!(!is_usable_ipv4(&"192.168.50.1".parse().unwrap(), "OpenVPN Data Channel Offload"));
        assert!(!is_usable_ipv4(&"10.64.219.224".parse().unwrap(), "蓝牙网络连接"));
    }

    #[test]
    fn usable_ipv4_rejects_disconnected_names_case_insensitive() {
        // Wintun（WireGuard）与 Wi-Fi Direct 不应出现在局域网同步列表。
        assert!(!is_usable_ipv4(&"10.0.0.5".parse().unwrap(), "Wintun Userspace Tunnel"));
        assert!(!is_usable_ipv4(&"10.0.0.6".parse().unwrap(), "Microsoft Wi-Fi Direct Virtual Adapter #3"));
    }

    #[test]
    fn create_proposal_input_rejects_android_contract_violations() {
        let now = 1_000_i64;

        let mut oversized_criteria = valid_create_proposal_input();
        oversized_criteria.proposed_weekly_goals[0].success_criteria =
            Some("x".repeat(crate::sync::protocol::MAX_PROPOSED_SUCCESS_CRITERIA_LENGTH + 1));
        assert!(validate_create_proposal_input(&oversized_criteria, now).is_err());

        let mut negative_duration = valid_create_proposal_input();
        negative_duration.proposed_tasks[0].target_duration_seconds = Some(-1);
        assert!(validate_create_proposal_input(&negative_duration, now).is_err());

        let mut negative_due = valid_create_proposal_input();
        negative_due.proposed_tasks[0].due_at = Some(-5);
        assert!(validate_create_proposal_input(&negative_due, now).is_err());

        let mut duplicate_sources = valid_create_proposal_input();
        duplicate_sources.source_assessment_ids = vec![
            "9c2d6e5f-4a7b-4c8d-9e0f-1a2b3c4d5e6f".to_string(),
            "9c2d6e5f-4a7b-4c8d-9e0f-1a2b3c4d5e6f".to_string(),
        ];
        assert!(validate_create_proposal_input(&duplicate_sources, now).is_err());

        let mut implausible_source = valid_create_proposal_input();
        implausible_source.source_assessment_ids = vec!["bad id".to_string()];
        assert!(validate_create_proposal_input(&implausible_source, now).is_err());

        let mut expired = valid_create_proposal_input();
        expired.expires_at_ms = Some(999);
        assert!(validate_create_proposal_input(&expired, now).is_err());

        let mut bad_device = valid_create_proposal_input();
        bad_device.device_id = "short".to_string();
        assert!(validate_create_proposal_input(&bad_device, now).is_err());
    }

    #[test]
    fn parse_interface_accepts_bare_ip_and_parenthesized_label() {
        assert_eq!(
            parse_interface("192.168.1.50").expect("bare"),
            "192.168.1.50".parse::<Ipv4Addr>().unwrap()
        );
        assert_eq!(
            parse_interface("以太网 (192.168.1.50)").expect("labeled"),
            "192.168.1.50".parse::<Ipv4Addr>().unwrap()
        );
        assert_eq!(
            parse_interface("以太网 3 (Remote NDIS Compatible Device) (10.248.148.58)")
                .expect("nested parens"),
            "10.248.148.58".parse::<Ipv4Addr>().unwrap()
        );
        assert!(parse_interface("localhost").is_err());
        assert!(parse_interface("127.0.0.1").is_err());
        assert!(parse_interface("999.1.1.1").is_err());
        assert!(parse_interface("以太网 3 (Remote NDIS Compatible Device)").is_err());
    }

    #[test]
    fn format_uuid_is_version_4() {
        let mut bytes = [0x12u8; 16];
        bytes[6] = (bytes[6] & 0x0f) | 0x40;
        bytes[8] = (bytes[8] & 0x3f) | 0x80;
        let uuid = format_uuid(&bytes);
        assert_eq!(uuid.len(), 36);
        // character at position 14 (after 8-4-4) is '4'.
        assert_eq!(&uuid[14..15], "4");
        // variant nibble at position 19 is '8'/'9'/'a'/'b'.
        assert!(matches!(&uuid[19..20], "8" | "9" | "a" | "b"));
    }

    #[test]
    fn pairing_qr_contains_required_parts() {
        let qr = "ta-sync://v1?host=192.168.1.50&port=8787&pin=abc123&token=xyz&expiresAt=1785600000000&deviceId=f0a24c19-0f8e-4b6d-9a3c-77e1b2d4c5a6";
        for part in [
            "ta-sync://v1",
            "host=192.168.1.50",
            "port=8787",
            "pin=abc123",
            "token=xyz",
            "expiresAt=",
            "deviceId=",
        ] {
            assert!(qr.contains(part), "missing {part}");
        }
        // No raw newlines (QR-safe).
        assert!(!qr.contains('\n'));
    }

    fn in_memory_sync_connection() -> rusqlite::Connection {
        let connection = rusqlite::Connection::open_in_memory().expect("in-memory db");
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
            .expect("snapshot timestamp schema");
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

    #[test]
    fn device_state_without_snapshot_returns_empty_read_model_and_no_snapshot() {
        let mut connection = in_memory_sync_connection();
        let state = load_device_state(&mut connection, "missing-device").expect("device state");

        assert!(state.read_model.subjects.is_empty());
        assert!(state.read_model.weekly_goals.is_empty());
        assert!(state.read_model.tasks.is_empty());
        assert!(state.read_model.study_sessions.is_empty());
        assert!(state.read_model.latest_learning_analysis.is_none());
        assert!(state.last_snapshot.is_none());
    }

    #[test]
    fn device_state_keeps_learning_analysis_bound_to_last_snapshot() {
        let mut connection = in_memory_sync_connection();
        let device_id = "f0a24c19-0f8e-4b6d-9a3c-77e1b2d4c5a6";
        let envelope: crate::sync::protocol::Envelope<crate::sync::protocol::SnapshotPayload> =
            serde_json::from_str(include_str!(
                "../../../sync/protocol/fixtures/snapshot-valid.json"
            ))
            .expect("valid snapshot fixture");
        let snapshot_id = envelope.snapshot_id.clone().expect("snapshot id");
        db::insert_device(
            &connection,
            device_id,
            "测试手机",
            "lookup-device",
            "test-salt",
            "test-hash",
            "test-pin",
            None,
        )
        .expect("device");
        db::import_snapshot(
            &mut connection,
            device_id,
            &snapshot_id,
            &envelope.payload,
            1,
        )
        .expect("snapshot import");

        let state = load_device_state(&mut connection, device_id).expect("device state");
        let analysis = state
            .read_model
            .latest_learning_analysis
            .expect("learning analysis");
        let last_snapshot = state.last_snapshot.expect("last snapshot");
        assert_eq!(analysis.source_snapshot_id, last_snapshot.snapshot_id);
    }
}
