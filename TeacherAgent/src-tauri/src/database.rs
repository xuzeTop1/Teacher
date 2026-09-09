use rusqlite::Connection;
use std::fs;
use tauri::{AppHandle, Manager};

const DATABASE_FILE_NAME: &str = "teacher_agent.sqlite3";
const MIGRATION_0001: &str = include_str!("../migrations/0001_initial.sql");
const MIGRATION_0002: &str = include_str!("../migrations/0002_vector_embeddings.sql");
const MIGRATION_0003: &str = include_str!("../migrations/0003_private_documents.sql");
const MIGRATION_0004: &str = include_str!("../migrations/0004_conversation_private_documents.sql");
const MIGRATION_0005: &str = include_str!("../migrations/0005_custom_subjects.sql");
const MIGRATION_0006: &str = include_str!("../migrations/0006_provider_multimodal.sql");
const MIGRATION_0007: &str = include_str!("../migrations/0007_message_attachments.sql");
const MIGRATION_0008: &str = include_str!("../migrations/0008_sync_tables.sql");
const MIGRATION_0009: &str = include_str!("../migrations/0009_exam_taxonomy.sql");
const MIGRATION_0010: &str = include_str!("../migrations/0010_sync_ai_usage.sql");
const MIGRATION_0011: &str = include_str!("../migrations/0011_sync_learning_analysis.sql");
const MIGRATION_0012: &str = include_str!("../migrations/0012_sync_snapshot_received_at_ms.sql");
const MIGRATION_0013: &str = include_str!("../migrations/0013_sync_proposal_source_ids.sql");
const MIGRATION_0014: &str = include_str!("../migrations/0014_sync_owner_identity.sql");
pub(crate) const MIGRATION_0001_ID: &str = "0001_initial";
pub(crate) const MIGRATION_0002_ID: &str = "0002_vector_embeddings";
pub(crate) const MIGRATION_0003_ID: &str = "0003_private_documents";
pub(crate) const MIGRATION_0004_ID: &str = "0004_conversation_private_documents";
pub(crate) const MIGRATION_0005_ID: &str = "0005_custom_subjects";
pub(crate) const MIGRATION_0006_ID: &str = "0006_provider_multimodal";
pub(crate) const MIGRATION_0007_ID: &str = "0007_message_attachments";
pub(crate) const MIGRATION_0008_ID: &str = "0008_sync_tables";
pub(crate) const MIGRATION_0009_ID: &str = "0009_exam_taxonomy";
pub(crate) const MIGRATION_0010_ID: &str = "0010_sync_ai_usage";
pub(crate) const MIGRATION_0011_ID: &str = "0011_sync_learning_analysis";
pub(crate) const MIGRATION_0012_ID: &str = "0012_sync_snapshot_received_at_ms";
pub(crate) const MIGRATION_0013_ID: &str = "0013_sync_proposal_source_ids";
pub(crate) const MIGRATION_0014_ID: &str = "0014_sync_owner_identity";

pub(crate) fn database_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|error| format!("failed to resolve app data directory: {error}"))?
        .join(DATABASE_FILE_NAME))
}

pub(crate) fn open_database(app: &AppHandle) -> Result<Connection, String> {
    let database_path = database_path(app)?;

    if let Some(parent) = database_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("failed to create app data directory: {error}"))?;
    }

    let connection = Connection::open(&database_path)
        .map_err(|error| format!("failed to open SQLite database: {error}"))?;
    connection
        .busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|error| format!("failed to configure SQLite busy timeout: {error}"))?;
    Ok(connection)
}

pub(crate) fn open_migrated_database(app: &AppHandle) -> Result<Connection, String> {
    let connection = open_database(app)?;
    apply_migrations(&connection)?;
    Ok(connection)
}

fn migration_exists(connection: &Connection, version: &str) -> Result<bool, String> {
    let count: i64 = connection
        .query_row(
            "SELECT COUNT(1) FROM schema_migrations WHERE version = ?1",
            [version],
            |row| row.get(0),
        )
        .map_err(|error| format!("failed to inspect schema_migrations: {error}"))?;

    Ok(count > 0)
}

pub(crate) fn apply_migrations(connection: &Connection) -> Result<bool, String> {
    connection
        .execute_batch(
            "PRAGMA foreign_keys = ON;
             CREATE TABLE IF NOT EXISTS schema_migrations (
               version TEXT PRIMARY KEY,
               applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
             );",
        )
        .map_err(|error| format!("failed to prepare migration table: {error}"))?;

    let mut applied_any = false;

    if !migration_exists(connection, MIGRATION_0001_ID)? {
        connection
            .execute_batch(MIGRATION_0001)
            .map_err(|error| format!("failed to apply {MIGRATION_0001_ID}: {error}"))?;
        connection
            .execute(
                "INSERT OR IGNORE INTO schema_migrations (version) VALUES (?1)",
                [MIGRATION_0001_ID],
            )
            .map_err(|error| format!("failed to record {MIGRATION_0001_ID}: {error}"))?;
        applied_any = true;
    }

    if !migration_exists(connection, MIGRATION_0002_ID)? {
        connection
            .execute_batch(MIGRATION_0002)
            .map_err(|error| format!("failed to apply {MIGRATION_0002_ID}: {error}"))?;
        connection
            .execute(
                "INSERT OR IGNORE INTO schema_migrations (version) VALUES (?1)",
                [MIGRATION_0002_ID],
            )
            .map_err(|error| format!("failed to record {MIGRATION_0002_ID}: {error}"))?;
        applied_any = true;
    }

    if !migration_exists(connection, MIGRATION_0003_ID)? {
        connection
            .execute_batch(MIGRATION_0003)
            .map_err(|error| format!("failed to apply {MIGRATION_0003_ID}: {error}"))?;
        connection
            .execute(
                "INSERT OR IGNORE INTO schema_migrations (version) VALUES (?1)",
                [MIGRATION_0003_ID],
            )
            .map_err(|error| format!("failed to record {MIGRATION_0003_ID}: {error}"))?;
        applied_any = true;
    }

    if !migration_exists(connection, MIGRATION_0004_ID)? {
        connection
            .execute_batch(MIGRATION_0004)
            .map_err(|error| format!("failed to apply {MIGRATION_0004_ID}: {error}"))?;
        connection
            .execute(
                "INSERT OR IGNORE INTO schema_migrations (version) VALUES (?1)",
                [MIGRATION_0004_ID],
            )
            .map_err(|error| format!("failed to record {MIGRATION_0004_ID}: {error}"))?;
        applied_any = true;
    }

    if !migration_exists(connection, MIGRATION_0005_ID)? {
        connection
            .execute_batch(MIGRATION_0005)
            .map_err(|error| format!("failed to apply {MIGRATION_0005_ID}: {error}"))?;
        connection
            .execute(
                "INSERT OR IGNORE INTO schema_migrations (version) VALUES (?1)",
                [MIGRATION_0005_ID],
            )
            .map_err(|error| format!("failed to record {MIGRATION_0005_ID}: {error}"))?;
        applied_any = true;
    }

    if !migration_exists(connection, MIGRATION_0006_ID)? {
        connection
            .execute_batch(MIGRATION_0006)
            .map_err(|error| format!("failed to apply {MIGRATION_0006_ID}: {error}"))?;
        connection
            .execute(
                "INSERT OR IGNORE INTO schema_migrations (version) VALUES (?1)",
                [MIGRATION_0006_ID],
            )
            .map_err(|error| format!("failed to record {MIGRATION_0006_ID}: {error}"))?;
        applied_any = true;
    }

    if !migration_exists(connection, MIGRATION_0007_ID)? {
        connection
            .execute_batch(MIGRATION_0007)
            .map_err(|error| format!("failed to apply {MIGRATION_0007_ID}: {error}"))?;
        connection
            .execute(
                "INSERT OR IGNORE INTO schema_migrations (version) VALUES (?1)",
                [MIGRATION_0007_ID],
            )
            .map_err(|error| format!("failed to record {MIGRATION_0007_ID}: {error}"))?;
        applied_any = true;
    }

    if !migration_exists(connection, MIGRATION_0008_ID)? {
        connection
            .execute_batch(MIGRATION_0008)
            .map_err(|error| format!("failed to apply {MIGRATION_0008_ID}: {error}"))?;
        connection
            .execute(
                "INSERT OR IGNORE INTO schema_migrations (version) VALUES (?1)",
                [MIGRATION_0008_ID],
            )
            .map_err(|error| format!("failed to record {MIGRATION_0008_ID}: {error}"))?;
        applied_any = true;
    }

    if !migration_exists(connection, MIGRATION_0009_ID)? {
        connection
            .execute_batch(MIGRATION_0009)
            .map_err(|error| format!("failed to apply {MIGRATION_0009_ID}: {error}"))?;
        connection
            .execute(
                "INSERT OR IGNORE INTO schema_migrations (version) VALUES (?1)",
                [MIGRATION_0009_ID],
            )
            .map_err(|error| format!("failed to record {MIGRATION_0009_ID}: {error}"))?;
        applied_any = true;
    }

    if !migration_exists(connection, MIGRATION_0010_ID)? {
        connection
            .execute_batch(MIGRATION_0010)
            .map_err(|error| format!("failed to apply {MIGRATION_0010_ID}: {error}"))?;
        connection
            .execute(
                "INSERT OR IGNORE INTO schema_migrations (version) VALUES (?1)",
                [MIGRATION_0010_ID],
            )
            .map_err(|error| format!("failed to record {MIGRATION_0010_ID}: {error}"))?;
        applied_any = true;
    }

    if !migration_exists(connection, MIGRATION_0011_ID)? {
        connection
            .execute_batch(MIGRATION_0011)
            .map_err(|error| format!("failed to apply {MIGRATION_0011_ID}: {error}"))?;
        connection
            .execute(
                "INSERT OR IGNORE INTO schema_migrations (version) VALUES (?1)",
                [MIGRATION_0011_ID],
            )
            .map_err(|error| format!("failed to record {MIGRATION_0011_ID}: {error}"))?;
        applied_any = true;
    }

    if !migration_exists(connection, MIGRATION_0012_ID)? {
        connection
            .execute_batch(MIGRATION_0012)
            .map_err(|error| format!("failed to apply {MIGRATION_0012_ID}: {error}"))?;
        connection
            .execute(
                "INSERT OR IGNORE INTO schema_migrations (version) VALUES (?1)",
                [MIGRATION_0012_ID],
            )
            .map_err(|error| format!("failed to record {MIGRATION_0012_ID}: {error}"))?;
        applied_any = true;
    }

    if !migration_exists(connection, MIGRATION_0013_ID)? {
        connection
            .execute_batch(MIGRATION_0013)
            .map_err(|error| format!("failed to apply {MIGRATION_0013_ID}: {error}"))?;
        connection
            .execute(
                "INSERT OR IGNORE INTO schema_migrations (version) VALUES (?1)",
                [MIGRATION_0013_ID],
            )
            .map_err(|error| format!("failed to record {MIGRATION_0013_ID}: {error}"))?;
        applied_any = true;
    }

    if !migration_exists(connection, MIGRATION_0014_ID)? {
        connection
            .execute_batch(MIGRATION_0014)
            .map_err(|error| format!("failed to apply {MIGRATION_0014_ID}: {error}"))?;
        connection
            .execute(
                "INSERT OR IGNORE INTO schema_migrations (version) VALUES (?1)",
                [MIGRATION_0014_ID],
            )
            .map_err(|error| format!("failed to record {MIGRATION_0014_ID}: {error}"))?;
        applied_any = true;
    }

    if applied_any {
        connection
            .execute_batch("PRAGMA user_version = 14;")
            .map_err(|error| format!("failed to update SQLite user_version: {error}"))?;
    }

    Ok(applied_any)
}

pub(crate) fn load_applied_migrations(connection: &Connection) -> Result<Vec<String>, String> {
    let mut statement = connection
        .prepare("SELECT version FROM schema_migrations ORDER BY version")
        .map_err(|error| format!("failed to load migrations: {error}"))?;
    let rows = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|error| format!("failed to query migrations: {error}"))?;
    let mut versions = Vec::new();

    for row in rows {
        versions.push(row.map_err(|error| format!("failed to read migration row: {error}"))?);
    }

    Ok(versions)
}

#[cfg(test)]
mod tests {
    use super::*;

    const V12_MIGRATIONS: [(&str, &str); 12] = [
        (MIGRATION_0001_ID, MIGRATION_0001),
        (MIGRATION_0002_ID, MIGRATION_0002),
        (MIGRATION_0003_ID, MIGRATION_0003),
        (MIGRATION_0004_ID, MIGRATION_0004),
        (MIGRATION_0005_ID, MIGRATION_0005),
        (MIGRATION_0006_ID, MIGRATION_0006),
        (MIGRATION_0007_ID, MIGRATION_0007),
        (MIGRATION_0008_ID, MIGRATION_0008),
        (MIGRATION_0009_ID, MIGRATION_0009),
        (MIGRATION_0010_ID, MIGRATION_0010),
        (MIGRATION_0011_ID, MIGRATION_0011),
        (MIGRATION_0012_ID, MIGRATION_0012),
    ];

    const V13_MIGRATIONS: [(&str, &str); 13] = [
        (MIGRATION_0001_ID, MIGRATION_0001),
        (MIGRATION_0002_ID, MIGRATION_0002),
        (MIGRATION_0003_ID, MIGRATION_0003),
        (MIGRATION_0004_ID, MIGRATION_0004),
        (MIGRATION_0005_ID, MIGRATION_0005),
        (MIGRATION_0006_ID, MIGRATION_0006),
        (MIGRATION_0007_ID, MIGRATION_0007),
        (MIGRATION_0008_ID, MIGRATION_0008),
        (MIGRATION_0009_ID, MIGRATION_0009),
        (MIGRATION_0010_ID, MIGRATION_0010),
        (MIGRATION_0011_ID, MIGRATION_0011),
        (MIGRATION_0012_ID, MIGRATION_0012),
        (MIGRATION_0013_ID, MIGRATION_0013),
    ];

    fn v12_database_with_sync_rows() -> Connection {
        let connection = Connection::open_in_memory().expect("v12 test database");
        connection
            .execute_batch(
                "PRAGMA foreign_keys = ON;
                 CREATE TABLE schema_migrations (
                   version TEXT PRIMARY KEY,
                   applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                 );",
            )
            .expect("v12 migration table");

        for (version, migration) in V12_MIGRATIONS {
            connection
                .execute_batch(migration)
                .unwrap_or_else(|error| panic!("apply v12 migration {version}: {error}"));
            connection
                .execute(
                    "INSERT INTO schema_migrations (version) VALUES (?1)",
                    [version],
                )
                .unwrap_or_else(|error| panic!("record v12 migration {version}: {error}"));
        }
        connection
            .execute_batch("PRAGMA user_version = 12;")
            .expect("v12 user version");
        connection
            .execute(
                "INSERT INTO sync_weekly_goals
                   (device_id, remote_id, week_start, title, success_criteria, status,
                    completed_at, deferred_to_week_start, exception_reason, created_at,
                    updated_at, deleted_at)
                 VALUES ('device-v12', 'goal-v12', 1000, '旧周目标', NULL, 0,
                         NULL, NULL, NULL, 1, 2, NULL)",
                [],
            )
            .expect("v12 weekly goal");
        connection
            .execute(
                "INSERT INTO sync_tasks
                   (device_id, remote_id, subject_remote_id, title, content, type, priority,
                    status, target_duration_seconds, due_at, completed_at, sort_order,
                    created_at, updated_at, deleted_at)
                 VALUES ('device-v12', 'task-v12', NULL, '旧任务', NULL, 1, 0,
                         0, 600, NULL, NULL, 0, 1, 2, NULL)",
                [],
            )
            .expect("v12 task");
        connection
    }

    fn assert_v12_rows_survive_with_null_source(connection: &Connection) {
        let goal: (String, Option<String>) = connection
            .query_row(
                "SELECT title, source_proposal_id
                 FROM sync_weekly_goals
                 WHERE device_id = 'device-v12' AND remote_id = 'goal-v12'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("upgraded weekly goal");
        assert_eq!(goal, ("旧周目标".to_string(), None));

        let task: (String, Option<String>) = connection
            .query_row(
                "SELECT title, source_proposal_id
                 FROM sync_tasks
                 WHERE device_id = 'device-v12' AND remote_id = 'task-v12'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("upgraded task");
        assert_eq!(task, ("旧任务".to_string(), None));
    }

    #[test]
    fn production_migration_upgrades_v12_sync_rows_to_v13_idempotently() {
        let connection = v12_database_with_sync_rows();
        let expected_v12: Vec<String> = V12_MIGRATIONS
            .iter()
            .map(|(version, _)| (*version).to_string())
            .collect();
        assert_eq!(load_applied_migrations(&connection).unwrap(), expected_v12);
        assert_eq!(
            connection
                .query_row("PRAGMA user_version", [], |row| row.get::<_, i64>(0))
                .unwrap(),
            12
        );

        assert!(apply_migrations(&connection).expect("upgrade v12 to v13"));

        let goal_source_columns: i64 = connection
            .query_row(
                "SELECT COUNT(1) FROM pragma_table_info('sync_weekly_goals')
                 WHERE name = 'source_proposal_id'",
                [],
                |row| row.get(0),
            )
            .expect("weekly goal source column");
        let task_source_columns: i64 = connection
            .query_row(
                "SELECT COUNT(1) FROM pragma_table_info('sync_tasks')
                 WHERE name = 'source_proposal_id'",
                [],
                |row| row.get(0),
            )
            .expect("task source column");
        assert_eq!(goal_source_columns, 1);
        assert_eq!(task_source_columns, 1);
        assert_v12_rows_survive_with_null_source(&connection);

        // apply_migrations 会把 v12 一路升到最新（含 0013、0014）
        let mut expected_latest = expected_v12;
        expected_latest.push(MIGRATION_0013_ID.to_string());
        expected_latest.push(MIGRATION_0014_ID.to_string());
        assert_eq!(load_applied_migrations(&connection).unwrap(), expected_latest);
        assert_eq!(
            connection
                .query_row("PRAGMA user_version", [], |row| row.get::<_, i64>(0))
                .unwrap(),
            14
        );

        assert!(!apply_migrations(&connection).expect("migrations idempotent"));
        assert_eq!(load_applied_migrations(&connection).unwrap(), expected_latest);
        assert_v12_rows_survive_with_null_source(&connection);
    }

    #[test]
    fn v14_adds_owner_identity_and_rekeys_mappings() {
        let connection = Connection::open_in_memory().expect("in-memory db");
        connection
            .execute_batch(
                "PRAGMA foreign_keys = ON;
                 CREATE TABLE schema_migrations (
                   version TEXT PRIMARY KEY,
                   applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                 );",
            )
            .expect("v13 migration table");
        for (version, migration) in V13_MIGRATIONS {
            connection
                .execute_batch(migration)
                .unwrap_or_else(|panic| panic!("apply v13 migration {version}: {panic}"));
            connection
                .execute(
                    "INSERT INTO schema_migrations (version) VALUES (?1)",
                    [version],
                )
                .unwrap_or_else(|error| panic!("record v13 migration {version}: {error}"));
        }
        connection
            .execute_batch("PRAGMA user_version = 13;")
            .expect("v13 user version");

        // 预置 legacy 设备与映射（按 device_id 归属，模拟本功能前的数据）
        connection
            .execute(
                "INSERT INTO sync_devices
                   (id, display_name, credential_lookup, credential_hash, credential_salt,
                    certificate_pin, paired_at, created_at)
                 VALUES ('dev-a', '手机A', 'la', 'h', 's', 'p', 't', 't'),
                        ('dev-b', '手机B', 'lb', 'h', 's', 'p', 't', 't')",
                [],
            )
            .expect("seed devices");
        connection
            .execute(
                "INSERT INTO subject_mappings
                   (device_id, alert_subject_remote_id, teacher_subject_id, created_at, updated_at)
                 VALUES ('dev-a', 'sub-1', 'math', 't', 't'),
                        ('dev-b', 'sub-2', 'english', 't', 't')",
                [],
            )
            .expect("seed mappings");

        assert!(apply_migrations(&connection).expect("apply 0014"));
        assert_eq!(
            connection
                .query_row("PRAGMA user_version", [], |row| row.get::<_, i64>(0))
                .unwrap(),
            14
        );
        // sync_devices 有 owner_identity 且 legacy 回填为自身 id
        let counts: (i64, i64) = connection
            .query_row(
                "SELECT SUM(owner_identity = id), COUNT(*) FROM sync_devices",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("owner backfill");
        assert_eq!(counts, (2, 2));
        // 映射改用 owner_identity 归属（= 本设备 id）且可读
        let mapped: Vec<(String, String)> = connection
            .prepare(
                "SELECT owner_identity, teacher_subject_id FROM subject_mappings WHERE owner_identity='dev-a'",
            )
            .unwrap()
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .unwrap()
            .collect::<Result<_, _>>()
            .expect("read mappings");
        assert_eq!(mapped, vec![("dev-a".to_string(), "math".to_string())]);
        // 0014 幂等
        assert!(!apply_migrations(&connection).expect("v14 idempotent"));
    }
}
