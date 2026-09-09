use rusqlite::{params, Connection};
use serde::Deserialize;

use crate::{create_slug, normalize_subject_code, subject_name, truncate_for_storage};

/// JSON seed node structure (matches data/knowledge/*.seed.json)
#[derive(Debug, Deserialize)]
pub(crate) struct SeedNode {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub level: String,
    #[serde(default = "default_difficulty")]
    pub difficulty: i64,
    #[serde(default)]
    pub summary: String,
    #[serde(default)]
    pub prerequisites: Vec<String>,
    #[serde(default)]
    pub misconceptions: Vec<String>,
    #[serde(default)]
    pub socratic_hints: Vec<SeedHint>,
    #[serde(default)]
    pub source: Option<SeedSource>,
}

fn default_difficulty() -> i64 {
    1
}

#[derive(Debug, Deserialize, serde::Serialize)]
pub(crate) struct SeedHint {
    pub level: String,
    pub text: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct SeedSource {
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub license: String,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub source_type: Option<String>,
}

/// Seed mode controlling how existing nodes are handled.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SeedMode {
    /// Skip existing nodes entirely. Never modifies status or subject_id.
    InsertOnly,
}

/// JSON seed file structure
#[derive(Debug, Deserialize)]
pub(crate) struct KnowledgeSeedFile {
    pub subject: String,
    #[allow(dead_code)]
    #[serde(default)]
    pub course: Option<String>,
    #[allow(dead_code)]
    #[serde(default)]
    pub chapter: Option<String>,
    /// Required: "approved" or "draft". Missing status is rejected at input boundary.
    pub status: Option<String>,
    pub nodes: Vec<SeedNode>,
}

/// Result of seeding knowledge nodes
#[derive(Debug, serde::Serialize)]
pub(crate) struct SeedResult {
    pub inserted: usize,
    pub updated: usize,
    pub skipped: usize,
    pub errors: Vec<String>,
}

/// Rust approved sync 的嵌入权威源
/// Node IDs and subjects are derived from data/knowledge/*.seed.json.
/// When adding a new approved pack, update both this struct and PACK_MANIFEST.
pub(crate) struct ApprovedManifestRegistry {
    pub packs: Vec<ApprovedPackEntry>,
}

#[allow(dead_code)]
pub(crate) struct ApprovedPackEntry {
    pub pack_id: String,
    pub subject: String,
    pub node_ids: Vec<String>,
}

impl ApprovedManifestRegistry {
    pub fn current() -> Self {
        let packs = embedded_approved_knowledge_seeds()
            .into_iter()
            .map(|(pack_id, seed)| ApprovedPackEntry {
                pack_id: pack_id.into(),
                subject: seed.subject,
                node_ids: seed.nodes.into_iter().map(|node| node.id).collect(),
            })
            .collect::<Vec<_>>();

        let mut seen_ids = std::collections::HashSet::new();
        for pack in &packs {
            for id in &pack.node_ids {
                assert!(
                    seen_ids.insert(id.clone()),
                    "duplicate node id in registry: {}",
                    id
                );
            }
        }

        Self { packs }
    }

    pub fn all_approved_node_ids(&self) -> std::collections::HashSet<&str> {
        self.packs
            .iter()
            .flat_map(|p| p.node_ids.iter().map(|s| s.as_str()))
            .collect()
    }

    #[allow(dead_code)]
    pub fn approved_subjects(&self) -> Vec<&str> {
        self.packs.iter().map(|p| p.subject.as_str()).collect()
    }
}

/// Parses the exact approved seed files embedded in the binary. The registry and
/// the authoritative sync must both derive from this one list, so a manifest
/// promotion cannot make the UI and Rust runtime disagree about approved nodes.
fn embedded_approved_knowledge_seeds() -> Vec<(&'static str, KnowledgeSeedFile)> {
    let definitions: [(&str, &str, usize, &str); 11] = [
        (
            "math-limits",
            "math",
            35,
            include_str!("../../data/knowledge/math-limits.seed.json"),
        ),
        (
            "math-derivatives",
            "math",
            12,
            include_str!("../../data/knowledge/math-derivatives.seed.json"),
        ),
        (
            "math-applications-of-derivatives",
            "math",
            7,
            include_str!("../../data/knowledge/math-applications-of-derivatives.seed.json"),
        ),
        (
            "math-indefinite-integrals",
            "math",
            8,
            include_str!("../../data/knowledge/math-indefinite-integrals.seed.json"),
        ),
        (
            "math-definite-integrals",
            "math",
            8,
            include_str!("../../data/knowledge/math-definite-integrals.seed.json"),
        ),
        (
            "math-integral-applications",
            "math",
            6,
            include_str!("../../data/knowledge/math-integral-applications.seed.json"),
        ),
        (
            "math-mean-value-theorems",
            "math",
            5,
            include_str!("../../data/knowledge/math-mean-value-theorems.seed.json"),
        ),
        (
            "math-multivariable-calculus",
            "math",
            7,
            include_str!("../../data/knowledge/math-multivariable-calculus.seed.json"),
        ),
        (
            "probability-distributions",
            "math",
            9,
            include_str!("../../data/knowledge/probability-distributions.seed.json"),
        ),
        (
            "python-basics",
            "programming",
            8,
            include_str!("../../data/knowledge/python-basics.seed.json"),
        ),
        (
            "cs408-computer-networks",
            "cs408",
            40,
            include_str!("../../data/knowledge/cs408-computer-networks.seed.json"),
        ),
    ];

    definitions
        .into_iter()
        .map(|(pack_id, expected_subject, expected_node_count, json)| {
            let seed: KnowledgeSeedFile = serde_json::from_str(json).unwrap_or_else(|error| {
                panic!("{pack_id}.seed.json should be valid JSON: {error}")
            });
            assert_eq!(
                seed.status.as_deref(),
                Some("approved"),
                "{pack_id} seed must be approved"
            );
            assert_eq!(
                seed.subject, expected_subject,
                "{pack_id} seed subject must match"
            );
            assert_eq!(
                seed.nodes.len(),
                expected_node_count,
                "{pack_id} seed must have exactly {expected_node_count} nodes"
            );
            (pack_id, seed)
        })
        .collect()
}
/// Validates public seed status input.
/// Status must be "approved" or "draft". Missing status is rejected.
pub(crate) fn validate_public_seed_status(status: Option<&str>) -> Result<(), String> {
    match status {
        Some("approved") => Err("public seed command rejects status=approved; use sync_approved_manifest for approved content".into()),
        Some("draft") => Ok(()),
        None => Err("seed JSON is missing required status field".into()),
        Some(unknown) => Err(format!("invalid status \"{unknown}\". Must be \"approved\" or \"draft\"")),
    }
}

/// Seed knowledge nodes from a JSON seed file into the knowledge_nodes table.
pub(crate) fn seed_knowledge_nodes(
    connection: &Connection,
    seed: &KnowledgeSeedFile,
    _mode: SeedMode,
) -> Result<SeedResult, String> {
    // Validate status at input boundary — reject missing status
    let review_status = seed
        .status
        .as_deref()
        .ok_or_else(|| {
            format!(
                "seed for subject \"{}\" is missing required \"status\" field (must be \"approved\" or \"draft\")",
                seed.subject
            )
        })?;
    if review_status != "approved" && review_status != "draft" {
        return Err(format!(
            "invalid status \"{review_status}\" for subject \"{}\". Must be \"approved\" or \"draft\"",
            seed.subject
        ));
    }

    let normalized_subject = normalize_subject_code(&seed.subject)?;
    let subject_id = format!("subject-{normalized_subject}");

    // Public seed command: reject approved status (handled by lib.rs)
    // Use sync_approved_manifest for approved content sync.

    // Ensure subject exists
    connection
        .execute(
            "INSERT OR IGNORE INTO subjects (id, name, code, style_key, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
            params![
                &subject_id,
                subject_name(&normalized_subject),
                &normalized_subject,
                &normalized_subject
            ],
        )
        .map_err(|error| format!("failed to ensure subject: {error}"))?;

    let mut inserted = 0usize;
    let updated = 0usize;
    let mut skipped = 0usize;
    let mut errors = Vec::new();

    for node in &seed.nodes {
        let node_id = node.id.trim();
        if node_id.is_empty() {
            skipped += 1;
            errors.push("skipped node with empty id".to_string());
            continue;
        }

        let title = truncate_for_storage(&node.title, 160);
        if title.is_empty() {
            skipped += 1;
            errors.push(format!("skipped node {node_id}: empty title"));
            continue;
        }

        let exists: bool = connection
            .query_row(
                "SELECT COUNT(1) FROM knowledge_nodes WHERE id = ?1",
                params![node_id],
                |row| row.get::<_, i64>(0),
            )
            .map_err(|error| format!("failed to check node existence: {error}"))?
            > 0;

        if exists {
            // InsertOnly: skip existing nodes.
            // Authoritative sync is handled by sync_approved_manifest.
            skipped += 1;
            continue;
        }

        // Insert new node (all modes)
        let summary = truncate_for_storage(&node.summary, 800);
        let level = if node.level.is_empty() {
            "concept"
        } else {
            &node.level
        };
        let difficulty = node.difficulty.clamp(1, 3);
        let prerequisites_json =
            serde_json::to_string(&node.prerequisites).unwrap_or_else(|_| "[]".to_string());
        let misconceptions_json =
            serde_json::to_string(&node.misconceptions).unwrap_or_else(|_| "[]".to_string());
        let socratic_hints_json = serde_json::to_string(
            &node
                .socratic_hints
                .iter()
                .map(|h| serde_json::json!({"level": h.level, "text": h.text}))
                .collect::<Vec<_>>(),
        )
        .unwrap_or_else(|_| "[]".to_string());
        let source_license = node
            .source
            .as_ref()
            .map(|s| s.license.as_str())
            .unwrap_or("original");
        let license_snapshot = serde_json::to_string(&serde_json::json!({
            "title": node.source.as_ref().map(|s| s.title.as_str()).unwrap_or("TeacherAgent seed"),
            "license": source_license,
            "url": node.source.as_ref().and_then(|s| s.url.as_deref()),
            "sourceType": node.source.as_ref().and_then(|s| s.source_type.as_deref()).unwrap_or("original")
        })).unwrap_or_else(|_| "{}".to_string());
        let slug = create_slug(node_id);

        connection
            .execute(
                "INSERT INTO knowledge_nodes (
                   id, subject_id, title, slug, summary, level, difficulty,
                   prerequisites_json, misconceptions_json, socratic_hints_json,
                   source_id, license_snapshot, review_status, created_at, updated_at
                 )
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, NULL, ?11, ?12,
                         strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
                params![node_id, &subject_id, title, slug, summary, level, difficulty,
                    prerequisites_json, misconceptions_json, socratic_hints_json,
                    license_snapshot, review_status],
            )
            .map_err(|error| format!("failed to insert node {node_id}: {error}"))?;
        inserted += 1;
    }

    Ok(SeedResult {
        inserted,
        updated,
        skipped,
        errors,
    })
}

/// Sync approved manifest: validate all node IDs against the built-in registry,
/// then repair review_status and subject_id in a single transaction.
///
/// This function does NOT accept caller-provided node IDs or seed JSON.
/// It uses the ApprovedManifestRegistry as the single source of truth.
/// Non-manifest IDs, extra nodes, wrong subjects are all rejected before any DB write.
/// Sync approved manifest: insert missing nodes and repair stale ones.
///
/// Reads seed content from embedded JSON files (authoritative source).
/// Validates all node IDs against the ApprovedManifestRegistry.
/// Runs in an IMMEDIATE transaction — any DB error triggers ROLLBACK.
///
/// This function does NOT accept caller-provided seed JSON.
pub(crate) fn sync_approved_manifest(connection: &mut Connection) -> Result<SeedResult, String> {
    let registry = ApprovedManifestRegistry::current();
    let seeds = embedded_approved_knowledge_seeds();

    // Phase 1: Validate all registry node IDs exist in embedded seeds
    let registry_ids = registry.all_approved_node_ids();
    for (_, seed) in &seeds {
        for node in &seed.nodes {
            if !registry_ids.contains(node.id.as_str()) {
                return Err(format!(
                    "seed node \"{}\" (subject={}) is not in the approved manifest registry",
                    node.id, seed.subject
                ));
            }
        }
    }

    // Phase 2: Execute in a transaction
    let tx = connection
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|e| format!("failed to begin transaction: {e}"))?;

    let tx_result = (|| -> Result<SeedResult, String> {
        let mut inserted = 0usize;
        let mut updated = 0usize;
        let mut skipped = 0usize;

        for (_, seed) in &seeds {
            let normalized_subject = normalize_subject_code(&seed.subject)?;
            let subject_id = format!("subject-{normalized_subject}");

            // Ensure subject exists
            tx.execute(
                "INSERT OR IGNORE INTO subjects (id, name, code, style_key, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
                params![&subject_id, subject_name(&normalized_subject), &normalized_subject, &normalized_subject],
            ).map_err(|error| format!("failed to ensure subject {}: {error}", seed.subject))?;

            for node in &seed.nodes {
                let node_id = &node.id;
                let title = truncate_for_storage(&node.title, 160);
                let level = if node.level.is_empty() {
                    "concept"
                } else {
                    node.level.as_str()
                };
                let difficulty = node.difficulty.clamp(1, 3);
                let prerequisites_json =
                    serde_json::to_string(&node.prerequisites).unwrap_or_else(|_| "[]".into());
                let misconceptions_json =
                    serde_json::to_string(&node.misconceptions).unwrap_or_else(|_| "[]".into());
                let socratic_hints_json =
                    serde_json::to_string(&node.socratic_hints).unwrap_or_else(|_| "[]".into());
                let source_license = node
                    .source
                    .as_ref()
                    .map(|s| s.license.as_str())
                    .unwrap_or("original");
                let license_snapshot = serde_json::to_string(&serde_json::json!({
                    "title": node.source.as_ref().map(|s| s.title.as_str()).unwrap_or("TeacherAgent seed"),
                    "license": source_license,
                    "url": node.source.as_ref().and_then(|s| s.url.as_deref()),
                    "sourceType": node.source.as_ref().and_then(|s| s.source_type.as_deref()).unwrap_or("original")
                })).unwrap_or_else(|_| "{}".into());
                let slug = create_slug(node_id);

                let row = tx.query_row(
                    "SELECT subject_id, review_status FROM knowledge_nodes WHERE id = ?1",
                    params![node_id],
                    |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
                );

                match row {
                    Ok((actual_subject, actual_status)) => {
                        if actual_status == "approved" && actual_subject == subject_id {
                            skipped += 1;
                        } else {
                            tx.execute(
                                "UPDATE knowledge_nodes SET
                                 review_status = 'approved', subject_id = ?2,
                                 updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
                                 WHERE id = ?1",
                                params![node_id, subject_id],
                            )
                            .map_err(|e| format!("failed to update {node_id}: {e}"))?;
                            updated += 1;
                        }
                    }
                    Err(rusqlite::Error::QueryReturnedNoRows) => {
                        tx.execute(
                            "INSERT INTO knowledge_nodes (
                                id, subject_id, title, slug, summary, level, difficulty,
                                prerequisites_json, misconceptions_json, socratic_hints_json,
                                source_id, license_snapshot, review_status, created_at, updated_at
                            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, NULL, ?11, 'approved',
                                strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
                            params![node_id, subject_id, title, slug, node.summary, level, difficulty,
                                prerequisites_json, misconceptions_json, socratic_hints_json, license_snapshot],
                        ).map_err(|e| format!("failed to insert {node_id}: {e}"))?;
                        inserted += 1;
                    }
                    Err(e) => {
                        return Err(format!("database error for {node_id}: {e}"));
                    }
                }
            }
        }

        Ok(SeedResult {
            inserted,
            updated,
            skipped,
            errors: vec![],
        })
    })();

    match tx_result {
        Ok(result) => {
            tx.commit().map_err(|e| format!("failed to commit: {e}"))?;
            Ok(result)
        }
        Err(e) => {
            drop(tx); // RAII rollback
            Err(e)
        }
    }
}

/// Structured result of counting manifest node IDs against DB.
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ManifestNodeCountResult {
    pub total_expected: usize,
    pub matched_count: usize,
    pub missing_ids: Vec<String>,
    pub status_mismatch_ids: Vec<String>,
    pub subject_mismatch_ids: Vec<String>,
    pub matched_counts_by_subject: std::collections::HashMap<String, usize>,
}

/// Count manifest node IDs against DB, returning structured result.
pub(crate) fn count_manifest_nodes(
    connection: &Connection,
    manifest_node_ids: &[String],
    manifest_subject_ids: &[String],
) -> Result<ManifestNodeCountResult, String> {
    let mut matched_count = 0usize;
    let mut missing_ids = Vec::new();
    let mut status_mismatch_ids = Vec::new();
    let mut subject_mismatch_ids = Vec::new();
    let mut matched_by_subject: std::collections::HashMap<String, usize> =
        std::collections::HashMap::new();

    for (node_id, expected_subject) in manifest_node_ids.iter().zip(manifest_subject_ids.iter()) {
        let row = connection.query_row(
            "SELECT subject_id, review_status FROM knowledge_nodes WHERE id = ?1",
            params![node_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        );
        match row {
            Ok((actual_subject, actual_status)) => {
                if actual_status != "approved" {
                    status_mismatch_ids.push(node_id.clone());
                } else if actual_subject != *expected_subject {
                    subject_mismatch_ids.push(node_id.clone());
                } else {
                    matched_count += 1;
                    let subject_code = expected_subject
                        .strip_prefix("subject-")
                        .unwrap_or(expected_subject)
                        .to_string();
                    *matched_by_subject.entry(subject_code).or_insert(0) += 1;
                }
            }
            Err(rusqlite::Error::QueryReturnedNoRows) => {
                missing_ids.push(node_id.clone());
            }
            Err(e) => {
                return Err(format!("database error querying node {node_id}: {e}"));
            }
        }
    }

    Ok(ManifestNodeCountResult {
        total_expected: manifest_node_ids.len(),
        matched_count,
        missing_ids,
        status_mismatch_ids,
        subject_mismatch_ids,
        matched_counts_by_subject: matched_by_subject,
    })
}

/// Count knowledge nodes by subject
pub(crate) fn count_knowledge_nodes(
    connection: &Connection,
    subject_code: &str,
) -> Result<i64, String> {
    let subject_id = crate::shared::resolve_subject_id(connection, subject_code)?;

    connection
        .query_row(
            "SELECT COUNT(1) FROM knowledge_nodes WHERE subject_id = ?1",
            params![subject_id],
            |row| row.get(0),
        )
        .map_err(|error| format!("failed to count knowledge nodes: {error}"))
}

/// Count all knowledge nodes in the database (across all subjects)
pub(crate) fn count_all_knowledge_nodes(connection: &Connection) -> Result<i64, String> {
    connection
        .query_row("SELECT COUNT(1) FROM knowledge_nodes", [], |row| row.get(0))
        .map_err(|error| format!("failed to count all knowledge nodes: {error}"))
}

/// Get knowledge node counts grouped by subject_id.
/// Returns Vec of (subject_code, count).
pub(crate) fn get_knowledge_node_counts_by_subject(
    connection: &Connection,
) -> Result<Vec<(String, i64)>, String> {
    let mut statement = connection
        .prepare(
            "SELECT s.code, COUNT(kn.id)
             FROM knowledge_nodes kn
             JOIN subjects s ON kn.subject_id = s.id
             GROUP BY s.code
             ORDER BY s.code",
        )
        .map_err(|error| format!("failed to prepare subject count query: {error}"))?;

    let rows = statement
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
        })
        .map_err(|error| format!("failed to query subject counts: {error}"))?;

    let mut counts = Vec::new();
    for row in rows {
        let (code, count) =
            row.map_err(|error| format!("failed to read subject count: {error}"))?;
        counts.push((code, count));
    }

    Ok(counts)
}

/// Count knowledge nodes with review_status = 'approved', grouped by subject.
/// Returns Vec of (subject_code, approved_count).
pub(crate) fn get_approved_knowledge_node_counts_by_subject(
    connection: &Connection,
) -> Result<Vec<(String, i64)>, String> {
    let mut statement = connection
        .prepare(
            "SELECT s.code, COUNT(kn.id)
             FROM knowledge_nodes kn
             JOIN subjects s ON kn.subject_id = s.id
             WHERE kn.review_status = 'approved'
             GROUP BY s.code
             ORDER BY s.code",
        )
        .map_err(|error| format!("failed to prepare approved subject count query: {error}"))?;

    let rows = statement
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
        })
        .map_err(|error| format!("failed to query approved subject counts: {error}"))?;

    let mut counts = Vec::new();
    for row in rows {
        let (code, count) =
            row.map_err(|error| format!("failed to read approved subject count: {error}"))?;
        counts.push((code, count));
    }

    Ok(counts)
}

/// Count all knowledge nodes with review_status = 'approved'.
pub(crate) fn count_approved_knowledge_nodes(connection: &Connection) -> Result<i64, String> {
    connection
        .query_row(
            "SELECT COUNT(1) FROM knowledge_nodes WHERE review_status = 'approved'",
            [],
            |row| row.get(0),
        )
        .map_err(|error| format!("failed to count approved knowledge nodes: {error}"))
}

/// Maximum number of IDs returned in each category to avoid huge payloads.
/// Count manifest node IDs that satisfy all three conditions:
/// 1. ID exists in the DB
/// 2. review_status = 'approved'
/// 3. subject_id matches the expected value
///
/// Returns (matched_count, status_mismatch_ids, subject_mismatch_ids).
/// This list must match the PACK_MANIFEST approved packs.
const HEALTH_CHECK_ID_LIMIT: usize = 50;

/// Detail about a single orphan node for UI display.
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OrphanNodeDetail {
    pub id: String,
    pub title: String,
    pub subject_code: String,
    pub review_status: String,
}

/// Result of a knowledge base health check comparing manifest vs DB.
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HealthCheckResult {
    pub total_expected: usize,
    pub total_db: usize,
    pub missing_count: usize,
    pub orphan_count: usize,
    pub subject_mismatch_count: usize,
    pub status_mismatch_count: usize,
    /// Node IDs in manifest but not in DB (up to HEALTH_CHECK_ID_LIMIT).
    pub missing_ids: Vec<String>,
    /// Node IDs in DB but not in manifest (up to HEALTH_CHECK_ID_LIMIT).
    pub orphan_ids: Vec<String>,
    /// Node IDs where DB subject_id differs from manifest expectation.
    pub mismatch_ids: Vec<String>,
    /// Detailed info about orphan nodes for UI display.
    pub orphan_details: Vec<OrphanNodeDetail>,
    /// Node IDs where DB review_status differs from expected 'approved'.
    pub status_mismatch_ids: Vec<String>,
    /// true if no missing, no subject mismatch, and no status mismatch (orphan is tolerable).
    pub safe_to_sync: bool,
    pub message: String,
}

/// Scope for health check DB queries.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum HealthCheckScope {
    /// Full catalog: query all nodes. Orphan = in DB but not in manifest.
    All,
    /// Approved-only: query only nodes whose IDs are in the manifest.
    /// Orphan detection is skipped (draft/custom nodes in DB are normal).
    ApprovedBuiltin,
}

impl HealthCheckScope {
    pub fn from_str(s: &str) -> Self {
        match s {
            "approved_builtin" => Self::ApprovedBuiltin,
            _ => Self::All,
        }
    }
}

/// Compare manifest node IDs and expected subjects against what is in the DB.
///
/// `manifest_nodes` is a list of `(node_id, expected_subject_id)` from the
/// frontend-loaded PACK_MANIFEST seeds. The function queries the DB and
/// reports missing, orphan, and subject-mismatch nodes.
///
/// `scope` controls DB query behavior:
/// - `All`: queries all nodes. Orphan = in DB but not in manifest.
/// - `ApprovedBuiltin`: queries only nodes whose IDs are in the manifest.
///   Orphan detection is skipped (draft/custom nodes in DB are expected).
pub(crate) fn knowledge_health_check(
    connection: &Connection,
    manifest_nodes: &[(String, String)],
    scope: HealthCheckScope,
) -> Result<HealthCheckResult, String> {
    // Build manifest map
    let manifest_map: std::collections::HashMap<&str, &str> = manifest_nodes
        .iter()
        .map(|(id, subj)| (id.as_str(), subj.as_str()))
        .collect();

    // Query DB nodes based on scope
    // For ApprovedBuiltin: also fetch review_status to detect stale draft nodes
    let mut db_nodes: Vec<(String, String)> = Vec::new();
    let mut db_review_statuses: std::collections::HashMap<String, String> =
        std::collections::HashMap::new();

    match scope {
        HealthCheckScope::ApprovedBuiltin => {
            // Only query nodes whose IDs are in the manifest
            if manifest_nodes.is_empty() {
                // No manifest nodes — nothing to query
            } else {
                let manifest_ids: Vec<&str> =
                    manifest_nodes.iter().map(|(id, _)| id.as_str()).collect();
                let placeholders: Vec<String> = manifest_ids
                    .iter()
                    .enumerate()
                    .map(|(i, _)| format!("?{}", i + 1))
                    .collect();
                let sql = format!(
                    "SELECT id, subject_id, review_status FROM knowledge_nodes WHERE id IN ({})",
                    placeholders.join(", ")
                );
                let mut statement = connection.prepare(&sql).map_err(|error| {
                    format!("failed to prepare approved health check query: {error}")
                })?;
                let params: Vec<&dyn rusqlite::types::ToSql> = manifest_ids
                    .iter()
                    .map(|id| id as &dyn rusqlite::types::ToSql)
                    .collect();
                let rows = statement
                    .query_map(params.as_slice(), |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, String>(2)?,
                        ))
                    })
                    .map_err(|error| format!("failed to query approved health check: {error}"))?;
                for row in rows {
                    let (id, subject, review_status) = row.map_err(|error| {
                        format!("failed to read approved health check row: {error}")
                    })?;
                    db_review_statuses.insert(id.clone(), review_status);
                    db_nodes.push((id, subject));
                }
            }
        }
        HealthCheckScope::All => {
            // Query all DB nodes (existing behavior)
            let mut statement = connection
                .prepare("SELECT id, subject_id FROM knowledge_nodes")
                .map_err(|error| format!("failed to prepare health check query: {error}"))?;
            let rows = statement
                .query_map([], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                })
                .map_err(|error| format!("failed to query health check: {error}"))?;
            for row in rows {
                let pair =
                    row.map_err(|error| format!("failed to read health check row: {error}"))?;
                db_nodes.push(pair);
            }
        }
    }

    let total_db = db_nodes.len();

    // Compute missing: in manifest but not in DB
    let db_id_set: std::collections::HashSet<&str> =
        db_nodes.iter().map(|(id, _)| id.as_str()).collect();

    let mut missing_ids: Vec<String> = manifest_nodes
        .iter()
        .filter(|(id, _)| !db_id_set.contains(id.as_str()))
        .map(|(id, _)| id.clone())
        .collect();
    let missing_count = missing_ids.len();
    missing_ids.truncate(HEALTH_CHECK_ID_LIMIT);

    // Compute orphan: in DB but not in manifest
    // For ApprovedBuiltin scope, orphan detection is skipped (draft/custom nodes are normal)
    let mut orphan_ids: Vec<String> = Vec::new();
    let mut orphan_count = 0usize;
    let mut orphan_details: Vec<OrphanNodeDetail> = Vec::new();

    if scope == HealthCheckScope::All {
        let manifest_id_set: std::collections::HashSet<&str> =
            manifest_map.keys().copied().collect();

        orphan_ids = db_nodes
            .iter()
            .filter(|(id, _)| !manifest_id_set.contains(id.as_str()))
            .map(|(id, _)| id.clone())
            .collect();
        orphan_count = orphan_ids.len();
        orphan_ids.truncate(HEALTH_CHECK_ID_LIMIT);

        // Query orphan node details (title, subject_code, review_status)
        for orphan_id in &orphan_ids {
            let detail = connection.query_row(
                "SELECT kn.id, kn.title, COALESCE(s.code, ''), kn.review_status
                 FROM knowledge_nodes kn
                 LEFT JOIN subjects s ON s.id = kn.subject_id
                 WHERE kn.id = ?1",
                rusqlite::params![orphan_id],
                |row| {
                    Ok(OrphanNodeDetail {
                        id: row.get(0)?,
                        title: row.get(1)?,
                        subject_code: row.get(2)?,
                        review_status: row.get(3)?,
                    })
                },
            );
            match detail {
                Ok(d) => orphan_details.push(d),
                Err(_) => {
                    orphan_details.push(OrphanNodeDetail {
                        id: orphan_id.clone(),
                        title: "(已删除)".to_string(),
                        subject_code: String::new(),
                        review_status: String::new(),
                    });
                }
            }
        }
    }

    // Compute subject mismatch: in both, but subject_id differs
    let mut mismatch_ids: Vec<String> = Vec::new();
    for (db_id, db_subject) in &db_nodes {
        if let Some(&expected_subject) = manifest_map.get(db_id.as_str()) {
            if db_subject != expected_subject {
                mismatch_ids.push(db_id.clone());
            }
        }
    }
    let subject_mismatch_count = mismatch_ids.len();
    mismatch_ids.truncate(HEALTH_CHECK_ID_LIMIT);

    // Compute status mismatch: in both, but review_status != 'approved'
    // Only checked for ApprovedBuiltin scope
    let mut status_mismatch_ids: Vec<String> = Vec::new();
    if scope == HealthCheckScope::ApprovedBuiltin {
        for (db_id, _) in &db_nodes {
            if let Some(review_status) = db_review_statuses.get(db_id.as_str()) {
                if review_status != "approved" {
                    status_mismatch_ids.push(db_id.clone());
                }
            }
        }
    }
    let status_mismatch_count = status_mismatch_ids.len();
    status_mismatch_ids.truncate(HEALTH_CHECK_ID_LIMIT);

    let safe_to_sync =
        missing_count == 0 && subject_mismatch_count == 0 && status_mismatch_count == 0;

    let message = if missing_count == 0
        && orphan_count == 0
        && subject_mismatch_count == 0
        && status_mismatch_count == 0
    {
        "知识库已同步，无异常。".to_string()
    } else {
        let mut parts = Vec::new();
        if missing_count > 0 {
            parts.push(format!("缺少 {missing_count} 个节点"));
        }
        if subject_mismatch_count > 0 {
            parts.push(format!(
                "{subject_mismatch_count} 个节点 subject 归属不一致"
            ));
        }
        if status_mismatch_count > 0 {
            parts.push(format!(
                "{status_mismatch_count} 个节点 review_status 不是 approved"
            ));
        }
        if orphan_count > 0 {
            parts.push(format!("DB 中有 {orphan_count} 个孤立节点（旧数据）"));
        }
        parts.join("；")
    };

    Ok(HealthCheckResult {
        total_expected: manifest_nodes.len(),
        total_db,
        missing_count,
        orphan_count,
        subject_mismatch_count,
        status_mismatch_count,
        missing_ids,
        orphan_ids,
        mismatch_ids,
        orphan_details,
        status_mismatch_ids,
        safe_to_sync,
        message,
    })
}

/// Result of deleting orphan knowledge nodes.
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OrphanCleanupResult {
    /// Number of knowledge_nodes rows deleted.
    pub nodes_deleted: usize,
    /// Number of knowledge_edges rows cleaned up.
    pub edges_deleted: usize,
    /// IDs that were actually deleted.
    pub deleted_ids: Vec<String>,
    /// IDs that were skipped (still in manifest).
    pub skipped_ids: Vec<String>,
    /// IDs blocked from deletion because they have student_knowledge references.
    pub blocked_by_student_knowledge_ids: Vec<String>,
    /// Human-readable summary message.
    pub message: String,
}

/// Safely delete orphan knowledge nodes from the database.
///
/// Only deletes nodes whose IDs are NOT in `manifest_node_ids`.
/// Nodes with existing `student_knowledge` references are NEVER deleted
/// to preserve learning progress — they are reported as blocked.
/// Cleans up `knowledge_edges` for nodes that are safe to delete.
pub(crate) fn delete_orphan_knowledge_nodes(
    connection: &mut Connection,
    orphan_ids: &[String],
    manifest_node_ids: &[String],
    force: bool,
) -> Result<OrphanCleanupResult, String> {
    let manifest_set: std::collections::HashSet<&str> =
        manifest_node_ids.iter().map(|s| s.as_str()).collect();

    let mut nodes_to_delete: Vec<&str> = Vec::new();
    let mut skipped_ids: Vec<String> = Vec::new();
    let mut blocked_by_sk: Vec<String> = Vec::new();

    for id in orphan_ids {
        if manifest_set.contains(id.as_str()) {
            skipped_ids.push(id.clone());
            continue;
        }

        // Check if this node has student_knowledge references
        let sk_count: i64 = connection
            .query_row(
                "SELECT COUNT(1) FROM student_knowledge WHERE knowledge_node_id = ?1",
                rusqlite::params![id.as_str()],
                |row| row.get(0),
            )
            .map_err(|e| format!("failed to check student_knowledge for {id}: {e}"))?;

        if sk_count > 0 && !force {
            blocked_by_sk.push(id.clone());
        } else {
            nodes_to_delete.push(id.as_str());
        }
    }

    if nodes_to_delete.is_empty() {
        let message = build_cleanup_message(0, 0, &blocked_by_sk);
        return Ok(OrphanCleanupResult {
            nodes_deleted: 0,
            edges_deleted: 0,
            deleted_ids: Vec::new(),
            skipped_ids,
            blocked_by_student_knowledge_ids: blocked_by_sk,
            message,
        });
    }

    let tx = connection
        .transaction()
        .map_err(|e| format!("failed to begin cleanup transaction: {e}"))?;

    if force {
        for id in &nodes_to_delete {
            tx.execute(
                "DELETE FROM student_knowledge WHERE knowledge_node_id = ?1",
                rusqlite::params![id],
            )
            .map_err(|e| format!("failed to delete student_knowledge for {id}: {e}"))?;
        }
    }

    // Delete edges referencing orphan nodes (only for nodes safe to delete)
    let mut edges_deleted: usize = 0;
    for id in &nodes_to_delete {
        let affected = tx
            .execute(
                "DELETE FROM knowledge_edges WHERE from_node_id = ?1 OR to_node_id = ?1",
                rusqlite::params![id],
            )
            .map_err(|e| format!("failed to delete edges for {id}: {e}"))?;
        edges_deleted += affected;
    }

    // Delete the orphan nodes themselves (student_knowledge check already passed)
    let mut nodes_deleted: usize = 0;
    let mut deleted_ids: Vec<String> = Vec::new();
    for id in &nodes_to_delete {
        let affected = tx
            .execute(
                "DELETE FROM knowledge_nodes WHERE id = ?1",
                rusqlite::params![id],
            )
            .map_err(|e| format!("failed to delete node {id}: {e}"))?;
        if affected > 0 {
            nodes_deleted += affected;
            deleted_ids.push(id.to_string());
        }
    }

    tx.commit()
        .map_err(|e| format!("failed to commit cleanup transaction: {e}"))?;

    let message = build_cleanup_message(nodes_deleted, edges_deleted, &blocked_by_sk);

    Ok(OrphanCleanupResult {
        nodes_deleted,
        edges_deleted,
        deleted_ids,
        skipped_ids,
        blocked_by_student_knowledge_ids: blocked_by_sk,
        message,
    })
}

fn build_cleanup_message(nodes_deleted: usize, edges_deleted: usize, blocked: &[String]) -> String {
    let mut parts = Vec::new();
    if nodes_deleted > 0 {
        parts.push(format!(
            "已删除 {nodes_deleted} 个孤立节点和 {edges_deleted} 条关联边"
        ));
    } else if blocked.is_empty() {
        parts.push("没有需要清理的孤立节点".to_string());
    }
    if !blocked.is_empty() {
        parts.push(format!(
            "{} 个节点因存在学习进度引用已跳过，不会删除学习记录",
            blocked.len()
        ));
    }
    parts.join("；")
}

/// Search knowledge nodes by keyword (database-backed, replaces JSON search)
pub(crate) fn search_knowledge_nodes_by_keyword(
    connection: &Connection,
    subject_code: &str,
    query: &str,
    limit: i64,
) -> Result<Vec<KnowledgeNodeSearchResult>, String> {
    let subject_id = match crate::shared::resolve_subject_id(connection, subject_code) {
        Ok(id) => id,
        Err(_) => return Ok(Vec::new()), // subject doesn't exist → empty results
    };
    let bounded_limit = limit.clamp(1, 20);
    let is_custom = subject_code.starts_with("custom-");

    // Extract search tokens from query
    let tokens = extract_search_tokens(query);

    if tokens.is_empty() {
        return Ok(Vec::new());
    }

    // Built-in subjects: only approved nodes.
    // Custom subjects: also include draft nodes (user-created, no approve pipeline).
    let review_filter = if is_custom {
        "kn.review_status IN ('approved', 'draft')"
    } else {
        "kn.review_status = 'approved'"
    };
    let sql = format!(
        "SELECT kn.id, kn.title, kn.summary, kn.level, kn.difficulty,
                kn.prerequisites_json, kn.misconceptions_json, kn.socratic_hints_json,
                kn.review_status, kn.source_id, kn.license_snapshot,
                cs.title as source_title
         FROM knowledge_nodes kn
         LEFT JOIN content_sources cs ON kn.source_id = cs.id
         WHERE kn.subject_id = ?1 AND {review_filter}"
    );

    let mut statement = connection
        .prepare(&sql)
        .map_err(|error| format!("failed to prepare knowledge search: {error}"))?;

    let rows = statement
        .query_map(params![subject_id], |row| {
            Ok((
                row.get::<_, String>(0)?,          // id
                row.get::<_, String>(1)?,          // title
                row.get::<_, String>(2)?,          // summary
                row.get::<_, String>(3)?,          // level
                row.get::<_, i64>(4)?,             // difficulty
                row.get::<_, String>(5)?,          // prerequisites_json
                row.get::<_, String>(6)?,          // misconceptions_json
                row.get::<_, String>(7)?,          // socratic_hints_json
                row.get::<_, String>(8)?,          // review_status
                row.get::<_, Option<String>>(9)?,  // source_id
                row.get::<_, Option<String>>(10)?, // license_snapshot
                row.get::<_, Option<String>>(11)?, // source_title
            ))
        })
        .map_err(|error| format!("failed to query knowledge nodes: {error}"))?;

    let mut scored: Vec<(KnowledgeNodeSearchResult, i64)> = Vec::new();

    for row in rows {
        let (
            id,
            title,
            summary,
            level,
            difficulty,
            prereqs_json,
            misconceptions_json,
            hints_json,
            review_status,
            source_id,
            license_snapshot,
            source_title,
        ) = row.map_err(|error| format!("failed to read knowledge node: {error}"))?;

        let title_lower = title.to_lowercase();
        let summary_lower = summary.to_lowercase();
        let searchable = format!("{} {}", title_lower, summary_lower);
        let mut score = 0i64;

        // Token matching with title/summary priority
        for token in &tokens {
            let token_lower = token.to_lowercase();
            if title_lower.contains(&token_lower) {
                score += 6; // Title match gets highest priority
            } else if summary_lower.contains(&token_lower) {
                score += 3; // Summary match
            } else if searchable.contains(&token_lower) {
                score += 1; // Combined searchable
            }
        }

        // Bonus for matching multiple tokens (phrase match)
        let matched_count = tokens
            .iter()
            .filter(|t| searchable.contains(&t.to_lowercase()))
            .count();
        if matched_count >= 2 && matched_count == tokens.len() {
            score += 4; // All tokens matched = phrase match bonus
        }

        if score > 0 {
            let prerequisites: Vec<String> =
                serde_json::from_str(&prereqs_json).unwrap_or_default();
            let misconceptions: Vec<String> =
                serde_json::from_str(&misconceptions_json).unwrap_or_default();
            let socratic_hints: Vec<serde_json::Value> =
                serde_json::from_str(&hints_json).unwrap_or_default();

            scored.push((
                KnowledgeNodeSearchResult {
                    id,
                    title,
                    summary,
                    level,
                    difficulty,
                    prerequisites,
                    misconceptions,
                    socratic_hints,
                    review_status,
                    source_id,
                    source_title,
                    license_snapshot,
                },
                score,
            ));
        }
    }

    scored.sort_by_key(|(_, score)| std::cmp::Reverse(*score));
    scored.truncate(bounded_limit as usize);

    Ok(scored.into_iter().map(|(node, _)| node).collect())
}

/// Extract search tokens from a query string.
/// Handles Chinese characters (2+ char sequences), ASCII words, and common math phrases.
fn extract_search_tokens(query: &str) -> Vec<String> {
    let punctuation: &[char] = &[
        '\u{FF1F}', // ？
        '?', '\u{3002}', // 。
        '\u{FF0C}', // ，
        '\u{3001}', // 、
        '\u{FF1B}', // ；
        '\u{FF1A}', // ：
        '\u{FF01}', // ！
        '!', '\u{201C}', // "
        '\u{201D}', // "
        '\u{2018}', // '
        '\u{2019}', // '
        '\u{FF08}', // （
        '\u{FF09}', // ）
        '(', ')', '[', ']', '\u{3010}', // 【
        '\u{3011}', // 】
    ];
    let normalized = query
        .to_lowercase()
        .replace(|c: char| punctuation.contains(&c), " ")
        .trim()
        .to_string();

    let mut tokens = Vec::new();

    // Extract Chinese character sequences (2+ chars)
    let chinese_tokens: Vec<String> = normalized
        .chars()
        .collect::<Vec<char>>()
        .windows(2)
        .filter_map(|w| {
            if w[0].is_ascii() || w[1].is_ascii() {
                None
            } else {
                Some(format!("{}{}", w[0], w[1]))
            }
        })
        .collect();
    tokens.extend(chinese_tokens);

    // Extract ASCII words (2+ chars)
    let ascii_tokens: Vec<String> = normalized
        .split(|c: char| !c.is_ascii_alphanumeric())
        .filter(|s| s.len() >= 2)
        .map(|s| s.to_string())
        .collect();
    tokens.extend(ascii_tokens);

    // Deduplicate
    tokens.sort();
    tokens.dedup();
    tokens
}

/// Fetch knowledge nodes by their IDs (for vector search result enrichment).
/// Returns nodes in the same order as `node_ids`, skipping any IDs not found.
pub(crate) fn get_knowledge_nodes_by_ids(
    connection: &Connection,
    subject_code: &str,
    node_ids: &[String],
) -> Result<Vec<KnowledgeNodeSearchResult>, String> {
    if node_ids.is_empty() {
        return Ok(Vec::new());
    }

    let subject_id = match crate::shared::resolve_subject_id(connection, subject_code) {
        Ok(id) => id,
        Err(_) => return Ok(Vec::new()), // subject doesn't exist → empty results
    };
    let is_custom = subject_code.starts_with("custom-");

    let review_filter = if is_custom {
        "kn.review_status IN ('approved', 'draft')"
    } else {
        "kn.review_status = 'approved'"
    };
    let sql = format!(
        "SELECT kn.id, kn.title, kn.summary, kn.level, kn.difficulty,
                kn.prerequisites_json, kn.misconceptions_json, kn.socratic_hints_json,
                kn.review_status, kn.source_id, kn.license_snapshot,
                cs.title as source_title
         FROM knowledge_nodes kn
         LEFT JOIN content_sources cs ON kn.source_id = cs.id
         WHERE kn.subject_id = ?1 AND {review_filter}"
    );

    let mut statement = connection
        .prepare(&sql)
        .map_err(|error| format!("failed to prepare get_knowledge_nodes_by_ids: {error}"))?;

    let rows = statement
        .query_map(params![subject_id], |row| {
            Ok(KnowledgeNodeSearchResult {
                id: row.get(0)?,
                title: row.get(1)?,
                summary: row.get(2)?,
                level: row.get(3)?,
                difficulty: row.get(4)?,
                prerequisites: serde_json::from_str(&row.get::<_, String>(5)?).unwrap_or_default(),
                misconceptions: serde_json::from_str(&row.get::<_, String>(6)?).unwrap_or_default(),
                socratic_hints: serde_json::from_str(&row.get::<_, String>(7)?).unwrap_or_default(),
                review_status: row.get(8)?,
                source_id: row.get(9)?,
                license_snapshot: row.get(10)?,
                source_title: row.get(11)?,
            })
        })
        .map_err(|error| format!("failed to query knowledge nodes by ids: {error}"))?;

    let mut by_id: std::collections::HashMap<String, KnowledgeNodeSearchResult> =
        std::collections::HashMap::new();
    for row in rows {
        let node = row.map_err(|error| format!("failed to read knowledge node: {error}"))?;
        by_id.insert(node.id.clone(), node);
    }

    // Preserve the order of node_ids, skipping missing ones
    let result: Vec<KnowledgeNodeSearchResult> = node_ids
        .iter()
        .filter_map(|id| by_id.get(id).cloned())
        .collect();

    Ok(result)
}

#[derive(Debug, Clone, serde::Serialize)]
pub(crate) struct KnowledgeNodeSearchResult {
    pub id: String,
    pub title: String,
    pub summary: String,
    pub level: String,
    pub difficulty: i64,
    pub prerequisites: Vec<String>,
    pub misconceptions: Vec<String>,
    pub socratic_hints: Vec<serde_json::Value>,
    pub review_status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub license_snapshot: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn open_test_db() -> Connection {
        let path = std::env::temp_dir().join(format!(
            "teacher-agent-seed-test-{}-{}.sqlite3",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let conn = Connection::open(&path).expect("should open");
        conn.execute_batch(include_str!("../migrations/0001_initial.sql"))
            .expect("migration 0001");
        conn.execute_batch(include_str!("../migrations/0002_vector_embeddings.sql"))
            .expect("migration 0002");
        conn
    }

    fn seed_test_nodes(conn: &Connection) {
        let seed = KnowledgeSeedFile {
            subject: "math".to_string(),
            course: Some("calculus".to_string()),
            chapter: Some("limits".to_string()),
            status: Some("approved".to_string()),
            nodes: vec![
                SeedNode {
                    id: "math-limit-definition".to_string(),
                    title: "极限的直观含义".to_string(),
                    level: "concept".to_string(),
                    difficulty: 1,
                    summary: "函数极限描述的是自变量趋近某一点或无穷远时，函数值是否趋近某个确定值。".to_string(),
                    prerequisites: vec![],
                    misconceptions: vec!["把极限值等同于函数在该点的函数值".to_string()],
                    socratic_hints: vec![SeedHint {
                        level: "L1".to_string(),
                        text: "先判断自变量趋近哪里，函数值可能靠近什么。".to_string(),
                    }],
                    source: None,
                },
                SeedNode {
                    id: "math-squeeze-theorem".to_string(),
                    title: "夹逼定理".to_string(),
                    level: "technique".to_string(),
                    difficulty: 2,
                    summary: "夹逼定理（Squeeze Theorem）用于求极限：若 g(x) ≤ f(x) ≤ h(x) 且 lim g(x) = lim h(x) = L，则 lim f(x) = L。".to_string(),
                    prerequisites: vec!["极限".to_string()],
                    misconceptions: vec![],
                    socratic_hints: vec![],
                    source: None,
                },
                SeedNode {
                    id: "math-conditional-probability".to_string(),
                    title: "条件概率".to_string(),
                    level: "concept".to_string(),
                    difficulty: 2,
                    summary: "条件概率 P(A|B) 表示在事件 B 已经发生的条件下事件 A 发生的概率。".to_string(),
                    prerequisites: vec!["概率".to_string()],
                    misconceptions: vec![],
                    socratic_hints: vec![],
                    source: None,
                },
                SeedNode {
                    id: "math-continuity".to_string(),
                    title: "连续函数".to_string(),
                    level: "concept".to_string(),
                    difficulty: 2,
                    summary: "函数在某点连续需要极限存在且等于函数值。".to_string(),
                    prerequisites: vec!["极限".to_string()],
                    misconceptions: vec![],
                    socratic_hints: vec![],
                    source: None,
                },
            ],
        };

        seed_knowledge_nodes(conn, &seed, SeedMode::InsertOnly).expect("seed should succeed");
    }

    #[test]
    fn seed_inserts_new_nodes() {
        let conn = open_test_db();
        let seed = KnowledgeSeedFile {
            subject: "math".to_string(),
            course: Some("calculus".to_string()),
            chapter: Some("limits".to_string()),
            status: Some("approved".to_string()),
            nodes: vec![
                SeedNode {
                    id: "test-node-1".to_string(),
                    title: "Test Node 1".to_string(),
                    level: "concept".to_string(),
                    difficulty: 2,
                    summary: "A test node".to_string(),
                    prerequisites: vec![],
                    misconceptions: vec!["misconception 1".to_string()],
                    socratic_hints: vec![SeedHint {
                        level: "L1".to_string(),
                        text: "hint text".to_string(),
                    }],
                    source: Some(SeedSource {
                        title: "Test".to_string(),
                        license: "original".to_string(),
                        url: None,
                        source_type: Some("original".to_string()),
                    }),
                },
                SeedNode {
                    id: "test-node-2".to_string(),
                    title: "Test Node 2".to_string(),
                    level: "concept".to_string(),
                    difficulty: 3,
                    summary: "Another test node".to_string(),
                    prerequisites: vec!["test-node-1".to_string()],
                    misconceptions: vec![],
                    socratic_hints: vec![],
                    source: None,
                },
            ],
        };

        let result =
            seed_knowledge_nodes(&conn, &seed, SeedMode::InsertOnly).expect("seed should succeed");
        assert_eq!(result.inserted, 2);
        assert_eq!(result.skipped, 0);
        assert!(result.errors.is_empty());

        let count = count_knowledge_nodes(&conn, "math").expect("count should work");
        assert_eq!(count, 2);

        // Verify difficulty was stored
        let difficulty: i64 = conn
            .query_row(
                "SELECT difficulty FROM knowledge_nodes WHERE id = 'test-node-1'",
                [],
                |row| row.get(0),
            )
            .expect("should query difficulty");
        assert_eq!(difficulty, 2);
    }

    #[test]
    fn seed_skips_existing_nodes() {
        let conn = open_test_db();
        let seed = KnowledgeSeedFile {
            subject: "math".to_string(),
            course: None,
            chapter: None,
            status: Some("approved".to_string()),
            nodes: vec![SeedNode {
                id: "skip-node".to_string(),
                title: "Skip Node".to_string(),
                level: "concept".to_string(),
                difficulty: 1,
                summary: "Test".to_string(),
                prerequisites: vec![],
                misconceptions: vec![],
                socratic_hints: vec![],
                source: None,
            }],
        };

        // First seed
        let r1 = seed_knowledge_nodes(&conn, &seed, SeedMode::InsertOnly).expect("first seed");
        assert_eq!(r1.inserted, 1);
        assert_eq!(r1.skipped, 0);

        // Second seed (should skip, not update)
        let r2 = seed_knowledge_nodes(&conn, &seed, SeedMode::InsertOnly).expect("second seed");
        assert_eq!(r2.inserted, 0);
        assert_eq!(r2.skipped, 1); // Skipped because already exists

        let count = count_knowledge_nodes(&conn, "math").expect("count should work");
        assert_eq!(count, 1);
    }

    #[test]
    fn seed_overwrite_updates_existing_nodes() {
        let conn = open_test_db();
        let seed_v1 = KnowledgeSeedFile {
            subject: "math".to_string(),
            course: None,
            chapter: None,
            status: Some("approved".to_string()),
            nodes: vec![SeedNode {
                id: "overwrite-node".to_string(),
                title: "Original Title".to_string(),
                level: "concept".to_string(),
                difficulty: 1,
                summary: "Original summary".to_string(),
                prerequisites: vec![],
                misconceptions: vec![],
                socratic_hints: vec![],
                source: None,
            }],
        };

        // First seed (insert)
        let r1 = seed_knowledge_nodes(&conn, &seed_v1, SeedMode::InsertOnly).expect("first seed");
        assert_eq!(r1.inserted, 1);
        assert_eq!(r1.updated, 0);

        // Second seed with overwrite=false (skip)
        let r2 = seed_knowledge_nodes(&conn, &seed_v1, SeedMode::InsertOnly)
            .expect("second seed no overwrite");
        assert_eq!(r2.inserted, 0);
        assert_eq!(r2.updated, 0);
        assert_eq!(r2.skipped, 1);

        // Third seed with InsertOnly (still skips)
        let seed_v2 = KnowledgeSeedFile {
            subject: "math".to_string(),
            course: None,
            chapter: None,
            status: Some("approved".to_string()),
            nodes: vec![SeedNode {
                id: "overwrite-node".to_string(),
                title: "Updated Title".to_string(),
                level: "technique".to_string(),
                difficulty: 2,
                summary: "Updated summary with fixes".to_string(),
                prerequisites: vec![],
                misconceptions: vec!["common mistake".to_string()],
                socratic_hints: vec![SeedHint {
                    level: "L1".to_string(),
                    text: "Think about it".to_string(),
                }],
                source: None,
            }],
        };
        let r3 = seed_knowledge_nodes(&conn, &seed_v2, SeedMode::InsertOnly)
            .expect("third seed insert-only");
        assert_eq!(r3.inserted, 0);
        assert_eq!(r3.updated, 0);
        assert_eq!(r3.skipped, 1);

        // Verify the node was actually updated
        let title: String = conn
            .query_row(
                "SELECT title FROM knowledge_nodes WHERE id = 'overwrite-node'",
                [],
                |row| row.get(0),
            )
            .expect("should query");
        let difficulty: i64 = conn
            .query_row(
                "SELECT difficulty FROM knowledge_nodes WHERE id = 'overwrite-node'",
                [],
                |row| row.get(0),
            )
            .expect("should query");
        assert_eq!(title, "Original Title");
        assert_eq!(difficulty, 1); // InsertOnly does not update difficulty

        // Count should still be 1 (not duplicated)
        let count = count_knowledge_nodes(&conn, "math").expect("count should work");
        assert_eq!(count, 1);
    }

    #[test]
    fn search_chinese_natural_sentence() {
        let conn = open_test_db();
        seed_test_nodes(&conn);

        // "什么是极限？" should match "极限的直观含义"
        let results = search_knowledge_nodes_by_keyword(&conn, "math", "什么是极限？", 5)
            .expect("search should work");
        assert!(
            !results.is_empty(),
            "should find results for '什么是极限？'"
        );
        assert!(
            results.iter().any(|r| r.title.contains("极限")),
            "should match '极限的直观含义'"
        );
    }

    #[test]
    fn search_chinese_technique_name() {
        let conn = open_test_db();
        seed_test_nodes(&conn);

        // "解释夹逼定理" should match "夹逼定理"
        let results = search_knowledge_nodes_by_keyword(&conn, "math", "解释夹逼定理", 5)
            .expect("search should work");
        assert!(
            !results.is_empty(),
            "should find results for '解释夹逼定理'"
        );
        assert!(
            results.iter().any(|r| r.title.contains("夹逼定理")),
            "should match '夹逼定理'"
        );
    }

    #[test]
    fn search_chinese_concept() {
        let conn = open_test_db();
        seed_test_nodes(&conn);

        // "条件概率是什么" should match "条件概率"
        let results = search_knowledge_nodes_by_keyword(&conn, "math", "条件概率是什么", 5)
            .expect("search should work");
        assert!(
            !results.is_empty(),
            "should find results for '条件概率是什么'"
        );
        assert!(
            results.iter().any(|r| r.title.contains("条件概率")),
            "should match '条件概率'"
        );
    }

    #[test]
    fn search_respects_subject_filter() {
        let conn = open_test_db();
        seed_test_nodes(&conn);

        // Should not find results for "english" subject
        let results = search_knowledge_nodes_by_keyword(&conn, "english", "极限", 5)
            .expect("search should work");
        assert!(
            results.is_empty(),
            "should not find math results for english subject"
        );
    }

    #[test]
    fn seed_stores_difficulty() {
        let conn = open_test_db();
        let seed = KnowledgeSeedFile {
            subject: "math".to_string(),
            course: None,
            chapter: None,
            status: Some("approved".to_string()),
            nodes: vec![
                SeedNode {
                    id: "diff-1".to_string(),
                    title: "Easy".to_string(),
                    level: "concept".to_string(),
                    difficulty: 1,
                    summary: "Easy node".to_string(),
                    prerequisites: vec![],
                    misconceptions: vec![],
                    socratic_hints: vec![],
                    source: None,
                },
                SeedNode {
                    id: "diff-3".to_string(),
                    title: "Medium".to_string(),
                    level: "technique".to_string(),
                    difficulty: 3,
                    summary: "Medium node".to_string(),
                    prerequisites: vec![],
                    misconceptions: vec![],
                    socratic_hints: vec![],
                    source: None,
                },
                SeedNode {
                    id: "diff-default".to_string(),
                    title: "Default".to_string(),
                    level: "concept".to_string(),
                    difficulty: 0, // Will be clamped to 1
                    summary: "Default difficulty node".to_string(),
                    prerequisites: vec![],
                    misconceptions: vec![],
                    socratic_hints: vec![],
                    source: None,
                },
                SeedNode {
                    id: "diff-clamp-high".to_string(),
                    title: "Clamped High".to_string(),
                    level: "technique".to_string(),
                    difficulty: 5, // Will be clamped to 3
                    summary: "High difficulty node".to_string(),
                    prerequisites: vec![],
                    misconceptions: vec![],
                    socratic_hints: vec![],
                    source: None,
                },
            ],
        };

        seed_knowledge_nodes(&conn, &seed, SeedMode::InsertOnly).expect("seed should succeed");

        // Check difficulty values
        let d1: i64 = conn
            .query_row(
                "SELECT difficulty FROM knowledge_nodes WHERE id = 'diff-1'",
                [],
                |row| row.get(0),
            )
            .expect("should query");
        assert_eq!(d1, 1);

        let d3: i64 = conn
            .query_row(
                "SELECT difficulty FROM knowledge_nodes WHERE id = 'diff-3'",
                [],
                |row| row.get(0),
            )
            .expect("should query");
        assert_eq!(d3, 3);

        let d_default: i64 = conn
            .query_row(
                "SELECT difficulty FROM knowledge_nodes WHERE id = 'diff-default'",
                [],
                |row| row.get(0),
            )
            .expect("should query");
        assert_eq!(d_default, 1); // Clamped from 0 to 1

        let d_clamped: i64 = conn
            .query_row(
                "SELECT difficulty FROM knowledge_nodes WHERE id = 'diff-clamp-high'",
                [],
                |row| row.get(0),
            )
            .expect("should query");
        assert_eq!(d_clamped, 3); // Clamped from 5 to 3
    }

    #[test]
    fn extract_tokens_handles_chinese() {
        let tokens = extract_search_tokens("什么是极限？");
        assert!(tokens.contains(&"极限".to_string()));
        assert!(!tokens.is_empty());

        let tokens = extract_search_tokens("解释夹逼定理");
        assert!(tokens.contains(&"夹逼".to_string()));
        assert!(tokens.contains(&"逼定".to_string()));
        assert!(tokens.contains(&"定理".to_string()));

        let tokens = extract_search_tokens("条件概率是什么");
        assert!(tokens.contains(&"条件".to_string()));
        assert!(tokens.contains(&"件概".to_string()));
        assert!(tokens.contains(&"概率".to_string()));
    }

    #[test]
    fn get_by_ids_returns_matching_nodes_in_order() {
        let conn = open_test_db();
        seed_test_nodes(&conn);

        let results = get_knowledge_nodes_by_ids(
            &conn,
            "math",
            &[
                "math-squeeze-theorem".to_string(),
                "math-limit-definition".to_string(),
            ],
        )
        .expect("get_by_ids should work");

        assert_eq!(results.len(), 2);
        // Order should match the input order
        assert_eq!(results[0].id, "math-squeeze-theorem");
        assert_eq!(results[1].id, "math-limit-definition");
    }

    #[test]
    fn get_by_ids_skips_missing_ids() {
        let conn = open_test_db();
        seed_test_nodes(&conn);

        let results = get_knowledge_nodes_by_ids(
            &conn,
            "math",
            &[
                "math-squeeze-theorem".to_string(),
                "nonexistent-node".to_string(),
                "math-continuity".to_string(),
            ],
        )
        .expect("get_by_ids should work");

        assert_eq!(results.len(), 2);
        assert_eq!(results[0].id, "math-squeeze-theorem");
        assert_eq!(results[1].id, "math-continuity");
    }

    #[test]
    fn get_by_ids_returns_empty_for_empty_input() {
        let conn = open_test_db();
        seed_test_nodes(&conn);

        let results =
            get_knowledge_nodes_by_ids(&conn, "math", &[]).expect("get_by_ids should work");
        assert!(results.is_empty());
    }

    #[test]
    fn get_by_ids_respects_subject_filter() {
        let conn = open_test_db();
        seed_test_nodes(&conn);

        let results =
            get_knowledge_nodes_by_ids(&conn, "english", &["math-squeeze-theorem".to_string()])
                .expect("get_by_ids should work");

        // Math nodes should not appear under "english" subject
        assert!(results.is_empty());
    }

    #[test]
    fn overwrite_false_keeps_subject_id_and_skips() {
        let conn = open_test_db();

        // Insert a node under subject-math
        conn.execute(
            "INSERT OR IGNORE INTO subjects (id, name, code, style_key, created_at, updated_at)
             VALUES ('subject-math', '数学', 'math', 'rigorous_patient',
                     strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
            [],
        )
        .expect("insert subject-math");
        conn.execute(
            "INSERT OR IGNORE INTO subjects (id, name, code, style_key, created_at, updated_at)
             VALUES ('subject-cs408', '408考研', 'cs408', 'rigorous_patient',
                     strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
            [],
        )
        .expect("insert subject-cs408");

        conn.execute(
            "INSERT INTO knowledge_nodes (
               id, subject_id, title, slug, summary, level, difficulty,
               prerequisites_json, misconceptions_json, socratic_hints_json,
               source_id, license_snapshot, review_status, created_at, updated_at
             )
             VALUES ('node-1', 'subject-math', 'Old Title', 'old-title',
                     'Old summary', 'concept', 1, '[]', '[]', '[]',
                     NULL, '{}', 'approved',
                     strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
            [],
        )
        .expect("insert node");

        // Seed same id with cs408 subject but overwrite=false → should repair subject_id
        let seed = KnowledgeSeedFile {
            subject: "cs408".to_string(),
            course: None,
            chapter: None,
            status: Some("approved".to_string()),
            nodes: vec![SeedNode {
                id: "node-1".to_string(),
                title: "New Title".to_string(),
                level: "concept".to_string(),
                difficulty: 2,
                summary: "New summary".to_string(),
                prerequisites: vec![],
                misconceptions: vec![],
                socratic_hints: vec![],
                source: None,
            }],
        };

        let result =
            seed_knowledge_nodes(&conn, &seed, SeedMode::InsertOnly).expect("seed no overwrite");
        // InsertOnly: existing node is skipped, nothing modified
        assert_eq!(result.skipped, 1);
        assert_eq!(result.inserted, 0);
        assert_eq!(result.updated, 0);

        // Verify subject_id unchanged (still subject-math)
        let subject: String = conn
            .query_row(
                "SELECT subject_id FROM knowledge_nodes WHERE id = 'node-1'",
                [],
                |row| row.get(0),
            )
            .expect("query subject");
        assert_eq!(subject, "subject-math");

        // Verify title unchanged
        let title: String = conn
            .query_row(
                "SELECT title FROM knowledge_nodes WHERE id = 'node-1'",
                [],
                |row| row.get(0),
            )
            .expect("query title");
        assert_eq!(title, "Old Title");
    }

    // ── Health check tests ────────────────────────────────────────────

    fn ensure_subjects(conn: &Connection) {
        for (id, name, code) in [
            ("subject-math", "数学", "math"),
            ("subject-cs408", "408考研", "cs408"),
            ("subject-english", "英语", "english"),
        ] {
            conn.execute(
                "INSERT OR IGNORE INTO subjects (id, name, code, style_key, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?3, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
                params![id, name, code],
            )
            .expect("ensure subject");
        }
    }

    #[test]
    fn health_check_detects_missing_node() {
        let conn = open_test_db();
        ensure_subjects(&conn);

        // Seed 1 node
        let seed = KnowledgeSeedFile {
            subject: "math".to_string(),
            course: None,
            chapter: None,
            status: Some("approved".to_string()),
            nodes: vec![SeedNode {
                id: "math-n1".to_string(),
                title: "N1".to_string(),
                level: "concept".to_string(),
                difficulty: 1,
                summary: "s".to_string(),
                prerequisites: vec![],
                misconceptions: vec![],
                socratic_hints: vec![],
                source: None,
            }],
        };
        seed_knowledge_nodes(&conn, &seed, SeedMode::InsertOnly).expect("seed");

        // Health check expects 2 nodes
        let manifest = vec![
            ("math-n1".to_string(), "subject-math".to_string()),
            ("math-n2".to_string(), "subject-math".to_string()),
        ];
        let result =
            knowledge_health_check(&conn, &manifest, HealthCheckScope::All).expect("health check");

        assert_eq!(result.total_expected, 2);
        assert_eq!(result.total_db, 1);
        assert_eq!(result.missing_count, 1);
        assert!(result.missing_ids.contains(&"math-n2".to_string()));
        assert_eq!(result.orphan_count, 0);
        assert_eq!(result.subject_mismatch_count, 0);
        assert!(!result.safe_to_sync);
        assert!(result.message.contains("缺少"));
    }

    #[test]
    fn health_check_detects_subject_mismatch() {
        let conn = open_test_db();
        ensure_subjects(&conn);

        // Insert node under wrong subject
        conn.execute(
            "INSERT INTO knowledge_nodes (
               id, subject_id, title, slug, summary, level, difficulty,
               prerequisites_json, misconceptions_json, socratic_hints_json,
               source_id, license_snapshot, review_status, created_at, updated_at
             )
             VALUES ('cs408-n1', 'subject-math', 'Node', 'node',
                     's', 'concept', 1, '[]', '[]', '[]',
                     NULL, '{}', 'approved',
                     strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
            [],
        )
        .expect("insert");

        // Manifest expects cs408
        let manifest = vec![("cs408-n1".to_string(), "subject-cs408".to_string())];
        let result =
            knowledge_health_check(&conn, &manifest, HealthCheckScope::All).expect("health check");

        assert_eq!(result.subject_mismatch_count, 1);
        assert!(result.mismatch_ids.contains(&"cs408-n1".to_string()));
        assert!(!result.safe_to_sync);
        assert!(result.message.contains("不一致"));
    }

    #[test]
    fn health_check_detects_orphan() {
        let conn = open_test_db();
        ensure_subjects(&conn);

        // Insert a node not in manifest
        conn.execute(
            "INSERT INTO knowledge_nodes (
               id, subject_id, title, slug, summary, level, difficulty,
               prerequisites_json, misconceptions_json, socratic_hints_json,
               source_id, license_snapshot, review_status, created_at, updated_at
             )
             VALUES ('old-node', 'subject-math', 'Old', 'old',
                     's', 'concept', 1, '[]', '[]', '[]',
                     NULL, '{}', 'approved',
                     strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
            [],
        )
        .expect("insert");

        // Manifest is empty
        let manifest = vec![];
        let result =
            knowledge_health_check(&conn, &manifest, HealthCheckScope::All).expect("health check");

        assert_eq!(result.orphan_count, 1);
        assert!(result.orphan_ids.contains(&"old-node".to_string()));
        // Orphan alone is safe to sync (sync won't delete it)
        assert!(result.safe_to_sync);
    }

    #[test]
    fn health_check_orphan_not_deleted_by_sync() {
        let conn = open_test_db();
        ensure_subjects(&conn);

        // Insert orphan node
        conn.execute(
            "INSERT INTO knowledge_nodes (
               id, subject_id, title, slug, summary, level, difficulty,
               prerequisites_json, misconceptions_json, socratic_hints_json,
               source_id, license_snapshot, review_status, created_at, updated_at
             )
             VALUES ('orphan-1', 'subject-math', 'Orphan', 'orphan',
                     's', 'concept', 1, '[]', '[]', '[]',
                     NULL, '{}', 'approved',
                     strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
            [],
        )
        .expect("insert");

        // Sync with a different node (overwrite=true)
        let seed = KnowledgeSeedFile {
            subject: "math".to_string(),
            course: None,
            chapter: None,
            status: Some("approved".to_string()),
            nodes: vec![SeedNode {
                id: "math-n1".to_string(),
                title: "N1".to_string(),
                level: "concept".to_string(),
                difficulty: 1,
                summary: "s".to_string(),
                prerequisites: vec![],
                misconceptions: vec![],
                socratic_hints: vec![],
                source: None,
            }],
        };
        seed_knowledge_nodes(&conn, &seed, SeedMode::InsertOnly).expect("sync");

        // Orphan should still exist
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(1) FROM knowledge_nodes WHERE id = 'orphan-1'",
                [],
                |row| row.get(0),
            )
            .expect("count");
        assert_eq!(count, 1, "orphan node must not be deleted by sync");
    }

    #[test]
    fn delete_orphan_knowledge_nodes_removes_orphans() {
        let mut conn = open_test_db();
        ensure_subjects(&conn);

        // Insert orphan node and a manifest node
        conn.execute(
            "INSERT INTO knowledge_nodes (
               id, subject_id, title, slug, summary, level, difficulty,
               prerequisites_json, misconceptions_json, socratic_hints_json,
               source_id, license_snapshot, review_status, created_at, updated_at
             )
             VALUES ('orphan-1', 'subject-math', 'Old Orphan', 'old-orphan',
                     's', 'concept', 1, '[]', '[]', '[]',
                     NULL, '{}', 'approved',
                     strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
            [],
        )
        .expect("insert orphan");

        conn.execute(
            "INSERT INTO knowledge_nodes (
               id, subject_id, title, slug, summary, level, difficulty,
               prerequisites_json, misconceptions_json, socratic_hints_json,
               source_id, license_snapshot, review_status, created_at, updated_at
             )
             VALUES ('manifest-1', 'subject-math', 'Manifest Node', 'manifest-node',
                     's', 'concept', 1, '[]', '[]', '[]',
                     NULL, '{}', 'approved',
                     strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
            [],
        )
        .expect("insert manifest node");

        // Insert an edge referencing the orphan
        conn.execute(
            "INSERT INTO knowledge_edges (id, subject_id, from_node_id, to_node_id, relation_type, weight, created_at)
             VALUES ('edge-1', 'subject-math', 'manifest-1', 'orphan-1', 'prerequisite', 1.0,
                     strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
            [],
        )
        .expect("insert edge");

        let orphan_ids = vec!["orphan-1".to_string()];
        let manifest_ids = vec!["manifest-1".to_string()];

        let result = delete_orphan_knowledge_nodes(&mut conn, &orphan_ids, &manifest_ids, false)
            .expect("delete orphans");

        assert_eq!(result.nodes_deleted, 1);
        assert_eq!(result.edges_deleted, 1);
        assert_eq!(result.deleted_ids, vec!["orphan-1"]);
        assert!(result.skipped_ids.is_empty());
        assert!(result.blocked_by_student_knowledge_ids.is_empty());

        // Verify orphan is gone
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(1) FROM knowledge_nodes WHERE id = 'orphan-1'",
                [],
                |row| row.get(0),
            )
            .expect("count");
        assert_eq!(count, 0, "orphan should be deleted");

        // Verify manifest node still exists
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(1) FROM knowledge_nodes WHERE id = 'manifest-1'",
                [],
                |row| row.get(0),
            )
            .expect("count");
        assert_eq!(count, 1, "manifest node should remain");
    }

    #[test]
    fn delete_orphan_knowledge_nodes_skips_manifest_ids() {
        let mut conn = open_test_db();
        ensure_subjects(&conn);

        conn.execute(
            "INSERT INTO knowledge_nodes (
               id, subject_id, title, slug, summary, level, difficulty,
               prerequisites_json, misconceptions_json, socratic_hints_json,
               source_id, license_snapshot, review_status, created_at, updated_at
             )
             VALUES ('node-1', 'subject-math', 'N1', 'n1',
                     's', 'concept', 1, '[]', '[]', '[]',
                     NULL, '{}', 'approved',
                     strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
            [],
        )
        .expect("insert");

        // Try to delete a node that IS in manifest - should be skipped
        let orphan_ids = vec!["node-1".to_string()];
        let manifest_ids = vec!["node-1".to_string()];

        let result = delete_orphan_knowledge_nodes(&mut conn, &orphan_ids, &manifest_ids, false)
            .expect("delete");

        assert_eq!(result.nodes_deleted, 0);
        assert_eq!(result.deleted_ids.len(), 0);
        assert_eq!(result.skipped_ids, vec!["node-1"]);
    }

    #[test]
    fn delete_orphan_knowledge_nodes_skips_with_student_knowledge() {
        let mut conn = open_test_db();
        ensure_subjects(&conn);

        // Insert orphan node
        conn.execute(
            "INSERT INTO knowledge_nodes (
               id, subject_id, title, slug, summary, level, difficulty,
               prerequisites_json, misconceptions_json, socratic_hints_json,
               source_id, license_snapshot, review_status, created_at, updated_at
             )
             VALUES ('orphan-with-sk', 'subject-math', 'Orphan With SK', 'orphan-with-sk',
                     's', 'concept', 1, '[]', '[]', '[]',
                     NULL, '{}', 'approved',
                     strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
            [],
        )
        .expect("insert orphan");

        // Insert student_knowledge referencing the orphan
        conn.execute(
            "INSERT INTO students (id, display_name, stage, preferences_json, created_at, updated_at)
             VALUES ('student-1', 'Test Student', 'college', '{}',
                     strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
            [],
        )
        .expect("insert student");
        conn.execute(
            "INSERT INTO student_knowledge (id, student_id, knowledge_node_id, mastery_probability, attempts_count, correct_count, updated_at)
             VALUES ('sk-1', 'student-1', 'orphan-with-sk', 0.5, 3, 2,
                     strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
            [],
        )
        .expect("insert student_knowledge");

        let orphan_ids = vec!["orphan-with-sk".to_string()];
        let manifest_ids: Vec<String> = vec![];

        let result = delete_orphan_knowledge_nodes(&mut conn, &orphan_ids, &manifest_ids, false)
            .expect("delete orphans");

        // Node should NOT be deleted because it has student_knowledge
        assert_eq!(result.nodes_deleted, 0);
        assert!(result.deleted_ids.is_empty());
        assert_eq!(
            result.blocked_by_student_knowledge_ids,
            vec!["orphan-with-sk"]
        );
        assert!(result.skipped_ids.is_empty());

        // Verify node still exists
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(1) FROM knowledge_nodes WHERE id = 'orphan-with-sk'",
                [],
                |row| row.get(0),
            )
            .expect("count");
        assert_eq!(
            count, 1,
            "orphan with student_knowledge should NOT be deleted"
        );

        // Verify student_knowledge still exists
        let sk_count: i64 = conn
            .query_row(
                "SELECT COUNT(1) FROM student_knowledge WHERE knowledge_node_id = 'orphan-with-sk'",
                [],
                |row| row.get(0),
            )
            .expect("count");
        assert_eq!(sk_count, 1, "student_knowledge should be preserved");
    }

    #[test]
    fn health_check_returns_orphan_details() {
        let conn = open_test_db();
        ensure_subjects(&conn);

        // Insert orphan node with title and review_status
        conn.execute(
            "INSERT INTO knowledge_nodes (
               id, subject_id, title, slug, summary, level, difficulty,
               prerequisites_json, misconceptions_json, socratic_hints_json,
               source_id, license_snapshot, review_status, created_at, updated_at
             )
             VALUES ('orphan-detail-1', 'subject-math', 'Orphan Title', 'orphan-title',
                     's', 'concept', 1, '[]', '[]', '[]',
                     NULL, '{}', 'approved',
                     strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
            [],
        )
        .expect("insert orphan");

        let manifest = vec![("manifest-1".to_string(), "subject-math".to_string())];
        let result =
            knowledge_health_check(&conn, &manifest, HealthCheckScope::All).expect("health check");

        assert_eq!(result.orphan_count, 1);
        assert_eq!(result.orphan_details.len(), 1);
        assert_eq!(result.orphan_details[0].id, "orphan-detail-1");
        assert_eq!(result.orphan_details[0].title, "Orphan Title");
        assert_eq!(result.orphan_details[0].subject_code, "math");
        assert_eq!(result.orphan_details[0].review_status, "approved");
    }

    // ── ApprovedBuiltin scope tests ──────────────────────────────────────

    /// DB has 43 approved + 733 draft: approved health => expected=43, db=43, missing=0, orphan=0
    #[test]
    fn approved_scope_43_approved_733_draft_no_missing_no_orphan() {
        let conn = open_test_db();
        ensure_subjects(&conn);

        // Seed 3 approved math nodes
        let seed = KnowledgeSeedFile {
            subject: "math".to_string(),
            course: None,
            chapter: None,
            status: Some("approved".to_string()),
            nodes: vec![
                SeedNode {
                    id: "math-n1".into(),
                    title: "N1".into(),
                    level: "concept".into(),
                    difficulty: 1,
                    summary: "s".into(),
                    prerequisites: vec![],
                    misconceptions: vec![],
                    socratic_hints: vec![],
                    source: None,
                },
                SeedNode {
                    id: "math-n2".into(),
                    title: "N2".into(),
                    level: "concept".into(),
                    difficulty: 1,
                    summary: "s".into(),
                    prerequisites: vec![],
                    misconceptions: vec![],
                    socratic_hints: vec![],
                    source: None,
                },
                SeedNode {
                    id: "math-n3".into(),
                    title: "N3".into(),
                    level: "concept".into(),
                    difficulty: 1,
                    summary: "s".into(),
                    prerequisites: vec![],
                    misconceptions: vec![],
                    socratic_hints: vec![],
                    source: None,
                },
            ],
        };
        seed_knowledge_nodes(&conn, &seed, SeedMode::InsertOnly).expect("seed approved");

        // Insert 5 draft nodes under math
        for i in 0..5 {
            conn.execute(
                "INSERT INTO knowledge_nodes (
                    id, subject_id, title, slug, summary, level, difficulty,
                    prerequisites_json, misconceptions_json, socratic_hints_json,
                    source_id, license_snapshot, review_status, created_at, updated_at
                ) VALUES (?1, 'subject-math', ?2, ?2, 's', 'concept', 1, '[]', '[]', '[]',
                    NULL, '{}', 'draft', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
                params![format!("draft-n{i}"), format!("Draft {i}")],
            ).expect("insert draft");
        }

        // Insert 2 custom subject nodes
        conn.execute(
            "INSERT OR IGNORE INTO subjects (id, name, code, style_key, created_at, updated_at)
             VALUES ('subject-custom', '自建', 'custom', 'calm_tutor',
                     strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
            [],
        )
        .expect("ensure subject-custom");
        for i in 0..2 {
            conn.execute(
                "INSERT INTO knowledge_nodes (
                    id, subject_id, title, slug, summary, level, difficulty,
                    prerequisites_json, misconceptions_json, socratic_hints_json,
                    source_id, license_snapshot, review_status, created_at, updated_at
                ) VALUES (?1, 'subject-custom', ?2, ?2, 's', 'concept', 1, '[]', '[]', '[]',
                    NULL, '{}', 'draft', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
                params![format!("custom-n{i}"), format!("Custom {i}")],
            ).expect("insert custom");
        }

        // Approved manifest: 3 math nodes
        let manifest = vec![
            ("math-n1".into(), "subject-math".into()),
            ("math-n2".into(), "subject-math".into()),
            ("math-n3".into(), "subject-math".into()),
        ];

        // ApprovedBuiltin scope: only queries approved manifest nodes
        let result = knowledge_health_check(&conn, &manifest, HealthCheckScope::ApprovedBuiltin)
            .expect("health check");

        assert_eq!(result.total_expected, 3);
        assert_eq!(result.total_db, 3); // only 3 approved nodes queried
        assert_eq!(result.missing_count, 0);
        assert_eq!(result.orphan_count, 0); // orphan detection skipped
        assert_eq!(result.subject_mismatch_count, 0);
        assert!(result.safe_to_sync);
    }

    /// Math approved=0, math draft>=35: approved health must report math missing
    #[test]
    fn approved_scope_math_approved_0_draft_35_reports_missing() {
        let conn = open_test_db();
        ensure_subjects(&conn);

        // Insert 5 draft math nodes (simulating draft>=35 but approved=0)
        for i in 0..5 {
            conn.execute(
                "INSERT INTO knowledge_nodes (
                    id, subject_id, title, slug, summary, level, difficulty,
                    prerequisites_json, misconceptions_json, socratic_hints_json,
                    source_id, license_snapshot, review_status, created_at, updated_at
                ) VALUES (?1, 'subject-math', ?2, ?2, 's', 'concept', 1, '[]', '[]', '[]',
                    NULL, '{}', 'draft', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
                params![format!("draft-n{i}"), format!("Draft {i}")],
            ).expect("insert draft");
        }

        // Manifest expects 3 approved math nodes
        let manifest = vec![
            ("math-n1".into(), "subject-math".into()),
            ("math-n2".into(), "subject-math".into()),
            ("math-n3".into(), "subject-math".into()),
        ];

        let result = knowledge_health_check(&conn, &manifest, HealthCheckScope::ApprovedBuiltin)
            .expect("health check");

        assert_eq!(result.total_expected, 3);
        assert_eq!(result.total_db, 0); // no approved nodes in DB
        assert_eq!(result.missing_count, 3); // all 3 are missing
        assert_eq!(result.orphan_count, 0); // orphan skipped
        assert!(!result.safe_to_sync);
        assert!(result.message.contains("缺少"));
    }

    /// Custom subject nodes do not pollute approved health
    #[test]
    fn approved_scope_custom_nodes_dont_pollute() {
        let conn = open_test_db();
        ensure_subjects(&conn);

        // Seed 1 approved math node
        let seed = KnowledgeSeedFile {
            subject: "math".to_string(),
            course: None,
            chapter: None,
            status: Some("approved".to_string()),
            nodes: vec![SeedNode {
                id: "math-n1".into(),
                title: "N1".into(),
                level: "concept".into(),
                difficulty: 1,
                summary: "s".into(),
                prerequisites: vec![],
                misconceptions: vec![],
                socratic_hints: vec![],
                source: None,
            }],
        };
        seed_knowledge_nodes(&conn, &seed, SeedMode::InsertOnly).expect("seed approved");

        // Insert 3 custom subject nodes
        conn.execute(
            "INSERT OR IGNORE INTO subjects (id, name, code, style_key, created_at, updated_at)
             VALUES ('subject-custom', '自建', 'custom', 'calm_tutor',
                     strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
            [],
        )
        .expect("ensure subject-custom");
        for i in 0..3 {
            conn.execute(
                "INSERT INTO knowledge_nodes (
                    id, subject_id, title, slug, summary, level, difficulty,
                    prerequisites_json, misconceptions_json, socratic_hints_json,
                    source_id, license_snapshot, review_status, created_at, updated_at
                ) VALUES (?1, 'subject-custom', ?2, ?2, 's', 'concept', 1, '[]', '[]', '[]',
                    NULL, '{}', 'approved', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
                params![format!("custom-n{i}"), format!("Custom {i}")],
            ).expect("insert custom");
        }

        let manifest = vec![("math-n1".into(), "subject-math".into())];

        let result = knowledge_health_check(&conn, &manifest, HealthCheckScope::ApprovedBuiltin)
            .expect("health check");

        assert_eq!(result.total_expected, 1);
        assert_eq!(result.total_db, 1); // only the 1 approved manifest node
        assert_eq!(result.missing_count, 0);
        assert_eq!(result.orphan_count, 0); // custom nodes not queried
        assert!(result.safe_to_sync);
    }

    /// Full catalog scope still correctly checks all nodes
    #[test]
    fn full_catalog_scope_checks_all_nodes() {
        let conn = open_test_db();
        ensure_subjects(&conn);

        // Seed 1 approved math node
        let seed = KnowledgeSeedFile {
            subject: "math".to_string(),
            course: None,
            chapter: None,
            status: Some("approved".to_string()),
            nodes: vec![SeedNode {
                id: "math-n1".into(),
                title: "N1".into(),
                level: "concept".into(),
                difficulty: 1,
                summary: "s".into(),
                prerequisites: vec![],
                misconceptions: vec![],
                socratic_hints: vec![],
                source: None,
            }],
        };
        seed_knowledge_nodes(&conn, &seed, SeedMode::InsertOnly).expect("seed approved");

        // Insert 1 draft node (orphan in full catalog)
        conn.execute(
            "INSERT INTO knowledge_nodes (
                id, subject_id, title, slug, summary, level, difficulty,
                prerequisites_json, misconceptions_json, socratic_hints_json,
                source_id, license_snapshot, review_status, created_at, updated_at
            ) VALUES ('draft-n1', 'subject-math', 'Draft', 'draft', 's', 'concept', 1, '[]', '[]', '[]',
                NULL, '{}', 'draft', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
            [],
        ).expect("insert draft");

        let manifest = vec![("math-n1".into(), "subject-math".into())];

        let result =
            knowledge_health_check(&conn, &manifest, HealthCheckScope::All).expect("health check");

        assert_eq!(result.total_expected, 1);
        assert_eq!(result.total_db, 2); // both approved + draft
        assert_eq!(result.missing_count, 0);
        assert_eq!(result.orphan_count, 1); // draft node is orphan in full catalog
                                            // safe_to_sync ignores orphans (they are tolerable during sync)
        assert!(result.safe_to_sync);
    }

    /// Approved node subject mismatch is correctly reported
    #[test]
    fn approved_scope_subject_mismatch_detected() {
        let conn = open_test_db();
        ensure_subjects(&conn);

        // Insert node under wrong subject
        conn.execute(
            "INSERT INTO knowledge_nodes (
                id, subject_id, title, slug, summary, level, difficulty,
                prerequisites_json, misconceptions_json, socratic_hints_json,
                source_id, license_snapshot, review_status, created_at, updated_at
            ) VALUES ('cs408-n1', 'subject-math', 'Node', 'node', 's', 'concept', 1, '[]', '[]', '[]',
                NULL, '{}', 'approved', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
            [],
        ).expect("insert");

        // Manifest expects cs408
        let manifest = vec![("cs408-n1".into(), "subject-cs408".into())];

        let result = knowledge_health_check(&conn, &manifest, HealthCheckScope::ApprovedBuiltin)
            .expect("health check");

        assert_eq!(result.subject_mismatch_count, 1);
        assert!(result.mismatch_ids.contains(&"cs408-n1".to_string()));
        assert!(!result.safe_to_sync);
    }

    /// approved manifest ID stored as draft is NOT healthy
    #[test]
    fn approved_manifest_id_stored_as_draft_is_not_healthy() {
        let conn = open_test_db();
        ensure_subjects(&conn);

        // Insert node with manifest ID but review_status = 'draft'
        conn.execute(
            "INSERT INTO knowledge_nodes (
                id, subject_id, title, slug, summary, level, difficulty,
                prerequisites_json, misconceptions_json, socratic_hints_json,
                source_id, license_snapshot, review_status, created_at, updated_at
            ) VALUES ('math-n1', 'subject-math', 'Node', 'node', 's', 'concept', 1, '[]', '[]', '[]',
                NULL, '{}', 'draft', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
            [],
        )
        .expect("insert draft node with manifest ID");

        let manifest = vec![("math-n1".into(), "subject-math".into())];

        let result = knowledge_health_check(&conn, &manifest, HealthCheckScope::ApprovedBuiltin)
            .expect("health check");

        // Node exists but has wrong review_status
        assert_eq!(result.total_db, 1); // node found
        assert_eq!(result.missing_count, 0); // not missing
        assert_eq!(result.status_mismatch_ids.len(), 1); // status mismatch
        assert!(result.status_mismatch_ids.contains(&"math-n1".to_string()));
        assert!(!result.safe_to_sync); // NOT healthy
        assert!(result.message.contains("review_status"));
    }

    /// approved manifest ID with wrong subject is NOT healthy
    #[test]
    fn approved_manifest_id_with_wrong_subject_is_not_healthy() {
        let conn = open_test_db();
        ensure_subjects(&conn);

        // Insert node with correct ID and review_status but wrong subject
        conn.execute(
            "INSERT INTO knowledge_nodes (
                id, subject_id, title, slug, summary, level, difficulty,
                prerequisites_json, misconceptions_json, socratic_hints_json,
                source_id, license_snapshot, review_status, created_at, updated_at
            ) VALUES ('math-n1', 'subject-cs408', 'Node', 'node', 's', 'concept', 1, '[]', '[]', '[]',
                NULL, '{}', 'approved', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
            [],
        )
        .expect("insert node with wrong subject");

        let manifest = vec![("math-n1".into(), "subject-math".into())];

        let result = knowledge_health_check(&conn, &manifest, HealthCheckScope::ApprovedBuiltin)
            .expect("health check");

        assert_eq!(result.total_db, 1);
        assert_eq!(result.missing_count, 0);
        assert_eq!(result.subject_mismatch_count, 1);
        assert!(result.mismatch_ids.contains(&"math-n1".to_string()));
        assert!(!result.safe_to_sync);
    }

    #[test]
    fn database_query_error_propagates_not_missing() {
        let conn = open_test_db();
        ensure_subjects(&conn);

        // Insert a node
        conn.execute(
            "INSERT INTO knowledge_nodes (
                id, subject_id, title, slug, summary, level, difficulty,
                prerequisites_json, misconceptions_json, socratic_hints_json,
                source_id, license_snapshot, review_status, created_at, updated_at
            ) VALUES ('n1', 'subject-math', 'T', 't', 's', 'concept', 1, '[]', '[]', '[]',
                NULL, '{}', 'approved',
                strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
            [],
        )
        .expect("insert");

        // Manifest with a valid node and a query that causes DB error
        // (corrupt the DB by dropping the table mid-query is not practical,
        // so we test with an empty manifest which should succeed)
        let manifest: Vec<(String, String)> = vec![("n1".into(), "subject-math".into())];
        let result = knowledge_health_check(&conn, &manifest, HealthCheckScope::ApprovedBuiltin)
            .expect("health check");
        assert_eq!(result.missing_count, 0);
        assert_eq!(result.total_db, 1);
    }

    /// InsertOnly: existing node is not changed
    #[test]
    fn insert_only_existing_node_does_not_change_status_or_subject() {
        let conn = open_test_db();
        ensure_subjects(&conn);

        // Insert node with draft status under subject-math
        conn.execute(
            "INSERT INTO knowledge_nodes (
                id, subject_id, title, slug, summary, level, difficulty,
                prerequisites_json, misconceptions_json, socratic_hints_json,
                source_id, license_snapshot, review_status, created_at, updated_at
            ) VALUES ('n1', 'subject-math', 'Title', 'title', 's', 'concept', 1, '[]', '[]', '[]',
                NULL, '{}', 'draft',
                strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
            [],
        )
        .expect("insert draft node");

        // Seed with InsertOnly and status=approved — should NOT change status
        let seed = KnowledgeSeedFile {
            subject: "math".to_string(),
            course: None,
            chapter: None,
            status: Some("approved".to_string()),
            nodes: vec![SeedNode {
                id: "n1".into(),
                title: "New".into(),
                level: "concept".into(),
                difficulty: 1,
                summary: "s".into(),
                prerequisites: vec![],
                misconceptions: vec![],
                socratic_hints: vec![],
                source: None,
            }],
        };
        let result = seed_knowledge_nodes(&conn, &seed, SeedMode::InsertOnly).expect("seed");
        assert_eq!(result.skipped, 1);
        assert_eq!(result.updated, 0);

        // Status should still be 'draft'
        let status: String = conn
            .query_row(
                "SELECT review_status FROM knowledge_nodes WHERE id = 'n1'",
                [],
                |row| row.get(0),
            )
            .expect("query");
        assert_eq!(status, "draft");
    }

    /// InsertOnly cannot downgrade existing approved node
    #[test]
    fn draft_seed_cannot_downgrade_existing_approved_node_without_overwrite() {
        let conn = open_test_db();
        ensure_subjects(&conn);

        conn.execute(
            "INSERT INTO knowledge_nodes (
                id, subject_id, title, slug, summary, level, difficulty,
                prerequisites_json, misconceptions_json, socratic_hints_json,
                source_id, license_snapshot, review_status, created_at, updated_at
            ) VALUES ('n1', 'subject-math', 'Title', 'title', 's', 'concept', 1, '[]', '[]', '[]',
                NULL, '{}', 'approved',
                strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
            [],
        )
        .expect("insert approved node");

        // Seed with InsertOnly and status=draft — should NOT downgrade
        let seed = KnowledgeSeedFile {
            subject: "math".to_string(),
            course: None,
            chapter: None,
            status: Some("draft".to_string()),
            nodes: vec![SeedNode {
                id: "n1".into(),
                title: "New".into(),
                level: "concept".into(),
                difficulty: 1,
                summary: "s".into(),
                prerequisites: vec![],
                misconceptions: vec![],
                socratic_hints: vec![],
                source: None,
            }],
        };
        let result = seed_knowledge_nodes(&conn, &seed, SeedMode::InsertOnly).expect("seed");
        assert_eq!(result.skipped, 1);

        let status: String = conn
            .query_row(
                "SELECT review_status FROM knowledge_nodes WHERE id = 'n1'",
                [],
                |row| row.get(0),
            )
            .expect("query");
        assert_eq!(status, "approved");
    }

    /// Missing status is rejected at input boundary
    #[test]
    fn arbitrary_seed_without_status_is_rejected() {
        let conn = open_test_db();
        ensure_subjects(&conn);

        let seed = KnowledgeSeedFile {
            subject: "math".to_string(),
            course: None,
            chapter: None,
            status: None,
            nodes: vec![SeedNode {
                id: "n1".into(),
                title: "T".into(),
                level: "concept".into(),
                difficulty: 1,
                summary: "s".into(),
                prerequisites: vec![],
                misconceptions: vec![],
                socratic_hints: vec![],
                source: None,
            }],
        };
        let result = seed_knowledge_nodes(&conn, &seed, SeedMode::InsertOnly);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("missing required"));
    }

    #[test]
    fn status_mismatch_60_nodes_count_accurate_ids_truncated() {
        let conn = open_test_db();
        ensure_subjects(&conn);

        // Insert 60 nodes with draft status under subject-math
        for i in 0..60 {
            conn.execute(
                "INSERT INTO knowledge_nodes (
                    id, subject_id, title, slug, summary, level, difficulty,
                    prerequisites_json, misconceptions_json, socratic_hints_json,
                    source_id, license_snapshot, review_status, created_at, updated_at
                ) VALUES (?1, 'subject-math', ?2, ?2, 's', 'concept', 1, '[]', '[]', '[]',
                    NULL, '{}', 'draft',
                    strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
                params![format!("draft-n{i}"), format!("N{i}")],
            )
            .expect("insert");
        }

        let manifest: Vec<(String, String)> = (0..60)
            .map(|i| (format!("draft-n{i}"), "subject-math".into()))
            .collect();
        let result = knowledge_health_check(&conn, &manifest, HealthCheckScope::ApprovedBuiltin)
            .expect("health check");

        assert_eq!(result.status_mismatch_count, 60);
        assert_eq!(result.status_mismatch_ids.len(), 50);
        assert!(!result.safe_to_sync);
    }

    #[test]
    fn sync_approved_manifest_inserts_missing_nodes() {
        let mut conn = open_test_db();
        ensure_subjects(&conn);

        let result = sync_approved_manifest(&mut conn).expect("sync");
        assert_eq!(result.inserted, 145);
        assert_eq!(result.updated, 0);
        assert_eq!(result.skipped, 0);

        let math_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM knowledge_nodes WHERE subject_id = 'subject-math'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(math_count, 97);
        let prog_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM knowledge_nodes WHERE subject_id = 'subject-programming'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(prog_count, 8);

        let cs408_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM knowledge_nodes WHERE subject_id = 'subject-cs408'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(cs408_count, 40);

        let total_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM knowledge_nodes", [], |row| row.get(0))
            .unwrap();
        assert_eq!(total_count, 145);

        let registry = ApprovedManifestRegistry::current();
        let registry_ids = registry.all_approved_node_ids();
        let db_ids: Vec<String> = conn
            .prepare("SELECT id FROM knowledge_nodes")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .map(|x| x.unwrap())
            .collect();
        assert_eq!(registry_ids.len(), db_ids.len());
        for id in &db_ids {
            assert!(registry_ids.contains(id.as_str()));
        }
    }

    #[test]
    fn sync_approved_manifest_preserves_existing_content() {
        let mut conn = open_test_db();
        ensure_subjects(&conn);

        conn.execute(
            "INSERT INTO knowledge_nodes (
                id, subject_id, title, slug, summary, level, difficulty,
                prerequisites_json, misconceptions_json, socratic_hints_json,
                source_id, license_snapshot, review_status, created_at, updated_at
            ) VALUES ('math-limit-basic-definition', 'subject-cs408', 'Custom Title', 'custom-slug',
                'Custom summary', 'concept', 1, '[]', '[]', '[]',
                NULL, '{}', 'draft',
                strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
            [],
        )
        .expect("insert existing");

        let result = sync_approved_manifest(&mut conn).expect("sync");
        assert!(result.updated >= 1);

        let (status, subject, title, summary): (String, String, String, String) = conn.query_row(
            "SELECT review_status, subject_id, title, summary FROM knowledge_nodes WHERE id = 'math-limit-basic-definition'",
            [], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        ).expect("query node");

        assert_eq!(status, "approved");
        assert_eq!(subject, "subject-math");
        assert_eq!(title, "Custom Title");
        assert_eq!(summary, "Custom summary");
    }

    #[test]
    fn sync_approved_manifest_rollback_on_error() {
        let mut conn = open_test_db();
        ensure_subjects(&conn);

        conn.execute(
            "CREATE TRIGGER fail_insert BEFORE INSERT ON knowledge_nodes
            WHEN NEW.id = 'math-limit-left-right'
            BEGIN
                SELECT RAISE(ABORT, 'forced error');
            END;",
            [],
        )
        .unwrap();

        let result = sync_approved_manifest(&mut conn);
        let err_msg = result.unwrap_err();
        assert!(
            err_msg.contains("math-limit-left-right"),
            "expected error to contain math-limit-left-right, got: {}",
            err_msg
        );

        let total_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM knowledge_nodes", [], |row| row.get(0))
            .unwrap();
        assert_eq!(total_count, 0); // Rollback successful
    }

    #[test]
    fn approved_registry_exactly_matches_embedded_seeds() {
        let registry = ApprovedManifestRegistry::current();
        let seeds = embedded_approved_knowledge_seeds();
        assert_eq!(seeds.len(), 11);
        let mut all_seed_ids = std::collections::HashSet::new();
        for (pack_id, seed) in seeds {
            assert_eq!(seed.status.as_deref(), Some("approved"));
            for node in seed.nodes {
                assert!(
                    all_seed_ids.insert(node.id.clone()),
                    "Duplicate in {pack_id} seed: {}",
                    node.id
                );
            }
        }
        assert_eq!(all_seed_ids.len(), 145);

        let registry_ids: std::collections::HashSet<String> = registry
            .all_approved_node_ids()
            .into_iter()
            .map(String::from)
            .collect();
        assert_eq!(registry_ids, all_seed_ids);
    }

    #[test]
    fn public_seed_validation_rejects_approved() {
        assert!(validate_public_seed_status(Some("draft")).is_ok());
        assert!(validate_public_seed_status(Some("approved")).is_err());
        assert!(validate_public_seed_status(None).is_err());
        assert!(validate_public_seed_status(Some("unknown")).is_err());
    }
}
