/**
 * Tauri command wrappers for the AlertTime LAN sync feature.
 * Thin wrappers only — no port binding, no SQLite access, no token storage
 * happens in the frontend (see docs/decisions/2026-08-03-alerttime-lan-sync.md).
 */

import { invoke } from "@tauri-apps/api/core"
import type {
  CreateProposalInput,
  FirewallDiagnosis,
  LastSnapshotInfo,
  SubjectMapping,
  SyncDeviceInfo,
  SyncDeviceState,
  SyncPairingInfo,
  SyncProposal,
  SyncReadModel,
  SyncServerStatus
} from "../../types/sync"

/** Lists private LAN IPv4 addresses (label + address) for the user to pick. */
export async function listSyncInterfaces(): Promise<string[]> {
  return invoke<string[]>("sync_list_private_ipv4")
}

/** Starts the HTTPS sync server on the given interface/port. */
export async function startSyncServer(interfaceLabel: string, port?: number): Promise<SyncServerStatus> {
  return invoke<SyncServerStatus>("sync_start_server", { interface: interfaceLabel, port: port ?? null })
}

export async function stopSyncServer(): Promise<void> {
  return invoke<void>("sync_stop_server")
}

export async function syncServerStatus(): Promise<SyncServerStatus> {
  return invoke<SyncServerStatus>("sync_server_status")
}

/** Issues a one-time pairing token and returns the QR payload text. */
export async function newSyncPairing(): Promise<SyncPairingInfo> {
  return invoke<SyncPairingInfo>("sync_new_pairing")
}

export async function listSyncDevices(): Promise<SyncDeviceInfo[]> {
  return invoke<SyncDeviceInfo[]>("sync_list_devices")
}

export async function revokeSyncDevice(deviceId: string): Promise<boolean> {
  return invoke<boolean>("sync_revoke_device", { deviceId })
}

export async function firewallDiagnose(): Promise<FirewallDiagnosis> {
  return invoke<FirewallDiagnosis>("sync_firewall_diagnose")
}

/** Loads the device read model for the weekly report engine. */
export async function getSyncReadModel(deviceId: string): Promise<SyncReadModel> {
  return invoke<SyncReadModel>("sync_get_read_model", { deviceId })
}

export async function lastSyncSnapshot(deviceId: string): Promise<LastSnapshotInfo | null> {
  return invoke<LastSnapshotInfo | null>("sync_last_snapshot", { deviceId })
}

/** Loads the read model and its snapshot marker from one SQLite read snapshot. */
export async function getSyncDeviceState(deviceId: string): Promise<SyncDeviceState> {
  return invoke<SyncDeviceState>("sync_get_device_state", { deviceId })
}

export async function listSyncMappings(deviceId: string): Promise<SubjectMapping[]> {
  return invoke<SubjectMapping[]>("sync_list_mappings", { deviceId })
}

export interface SetSyncMappingInput {
  deviceId: string
  alertSubjectRemoteId: string
  teacherSubjectId: string
  /** 考试体系叶子映射（可选；examSubjectId 优先于 teacherSubjectId） */
  examTrackId?: string | null
  examSubjectId?: string | null
  examModuleId?: string | null
}

export async function setSyncMapping(input: SetSyncMappingInput): Promise<void> {
  return invoke<void>("sync_set_mapping", {
    deviceId: input.deviceId,
    alertSubjectRemoteId: input.alertSubjectRemoteId,
    teacherSubjectId: input.teacherSubjectId,
    examTrackId: input.examTrackId ?? null,
    examSubjectId: input.examSubjectId ?? null,
    examModuleId: input.examModuleId ?? null
  })
}

export async function removeSyncMapping(deviceId: string, alertSubjectRemoteId: string): Promise<boolean> {
  return invoke<boolean>("sync_remove_mapping", { deviceId, alertSubjectRemoteId })
}

export async function listSyncProposals(deviceId: string): Promise<SyncProposal[]> {
  return invoke<SyncProposal[]>("sync_list_proposals", { deviceId })
}

/** Creates a plan proposal for a device (TeacherAgent is the only writer). */
export async function createSyncProposal(input: CreateProposalInput): Promise<SyncProposal> {
  return invoke<SyncProposal>("sync_create_proposal", { input })
}

/**
 * Returns the subset of assessment ids that reference real persisted rows in
 * assessment_results. Proposal sourceAssessmentIds must only reference
 * durable evidence; localStorage alone is never treated as authoritative.
 */
export async function syncAssessmentIdsExist(ids: string[]): Promise<string[]> {
  return invoke<string[]>("sync_assessment_ids_exist", { ids })
}

export interface PersistedSyncDiagnosticAssessment {
  assessmentId: string
  teacherSubjectId: string
  correct: boolean
  questionId: string
  alertSubjectRemoteId: string | null
  examTrackId: string | null
  examSubjectId: string | null
  examModuleId: string | null
  createdAt: string
}

/** Loads only verifiable diagnostic rows from assessment_results. */
export async function loadPersistedSyncDiagnosticAssessments(
  ids: string[]
): Promise<PersistedSyncDiagnosticAssessment[]> {
  return invoke<PersistedSyncDiagnosticAssessment[]>("load_persisted_sync_diagnostic_assessments", { ids })
}
