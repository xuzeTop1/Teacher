PRAGMA foreign_keys = ON;

-- AlertTime LAN sync read model + pairing/proposal storage.
-- See docs/data-model.md section 8.5 and sync/protocol/protocol.md.

CREATE TABLE IF NOT EXISTS sync_devices (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  credential_lookup TEXT NOT NULL UNIQUE,
  credential_hash TEXT NOT NULL,
  credential_salt TEXT NOT NULL,
  certificate_pin TEXT NOT NULL,
  paired_at TEXT NOT NULL,
  last_sync_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_pairing_tokens (
  token_hash TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_snapshots (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  received_at TEXT NOT NULL,
  status TEXT NOT NULL,
  subject_count INTEGER NOT NULL DEFAULT 0,
  goal_count INTEGER NOT NULL DEFAULT 0,
  task_count INTEGER NOT NULL DEFAULT 0,
  session_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sync_subjects (
  device_id TEXT NOT NULL,
  remote_id TEXT NOT NULL,
  name TEXT NOT NULL,
  is_archived INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  PRIMARY KEY (device_id, remote_id)
);

CREATE TABLE IF NOT EXISTS sync_weekly_goals (
  device_id TEXT NOT NULL,
  remote_id TEXT NOT NULL,
  week_start INTEGER NOT NULL,
  title TEXT NOT NULL,
  success_criteria TEXT,
  status INTEGER NOT NULL,
  completed_at INTEGER,
  deferred_to_week_start INTEGER,
  exception_reason TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  PRIMARY KEY (device_id, remote_id)
);

CREATE TABLE IF NOT EXISTS sync_tasks (
  device_id TEXT NOT NULL,
  remote_id TEXT NOT NULL,
  subject_remote_id TEXT,
  title TEXT NOT NULL,
  content TEXT,
  type INTEGER NOT NULL,
  priority INTEGER NOT NULL,
  status INTEGER NOT NULL,
  target_duration_seconds INTEGER,
  due_at INTEGER,
  completed_at INTEGER,
  sort_order INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  PRIMARY KEY (device_id, remote_id)
);

CREATE TABLE IF NOT EXISTS sync_study_sessions (
  device_id TEXT NOT NULL,
  remote_id TEXT NOT NULL,
  subject_remote_id TEXT,
  task_remote_id TEXT,
  title TEXT,
  start_time INTEGER NOT NULL,
  end_time INTEGER,
  duration_seconds INTEGER NOT NULL,
  pause_seconds INTEGER NOT NULL,
  focus_score INTEGER,
  note TEXT,
  status INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  PRIMARY KEY (device_id, remote_id)
);

CREATE TABLE IF NOT EXISTS subject_mappings (
  device_id TEXT NOT NULL,
  alert_subject_remote_id TEXT NOT NULL,
  teacher_subject_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (device_id, alert_subject_remote_id)
);

CREATE TABLE IF NOT EXISTS sync_proposals (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'pending',
  rationale TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  source_assessment_ids_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  expires_at INTEGER,
  decided_at INTEGER
);

CREATE TABLE IF NOT EXISTS sync_proposal_decisions (
  proposal_id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  decision TEXT NOT NULL,
  decided_at INTEGER NOT NULL,
  FOREIGN KEY (proposal_id) REFERENCES sync_proposals(id)
);
