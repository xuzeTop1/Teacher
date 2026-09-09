use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

/// Embedding stored as raw f32 bytes for efficient cosine similarity computation.
/// 预留：后续 seed embedding 生成和向量检索集成时使用。
#[allow(dead_code)]
const DEFAULT_EMBEDDING_MODEL: &str = "text-embedding-3-small";
#[allow(dead_code)]
const DEFAULT_EMBEDDING_DIM: usize = 1536;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VectorSearchResult {
    pub entity_type: String,
    pub entity_id: String,
    pub score: f64,
    pub embedding_model: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct EmbeddingEntry {
    pub id: String,
    pub entity_type: String,
    pub entity_id: String,
    pub embedding: Vec<f32>,
    pub embedding_model: String,
    pub embedding_dim: usize,
}

/// Store or update an embedding vector.
pub(crate) fn upsert_embedding(
    connection: &Connection,
    entry: &EmbeddingEntry,
) -> Result<(), String> {
    let blob = f32_vec_to_blob(&entry.embedding);
    let now = current_timestamp(connection)?;

    connection
        .execute(
            "INSERT INTO vector_embeddings (
               id, entity_type, entity_id, embedding, embedding_model,
               embedding_dim, created_at, updated_at
             )
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)
             ON CONFLICT(entity_type, entity_id, embedding_model) DO UPDATE SET
               embedding = excluded.embedding,
               embedding_dim = excluded.embedding_dim,
               updated_at = excluded.updated_at",
            params![
                &entry.id,
                &entry.entity_type,
                &entry.entity_id,
                blob,
                &entry.embedding_model,
                entry.embedding_dim as i64,
                now
            ],
        )
        .map_err(|error| format!("failed to upsert embedding: {error}"))?;

    Ok(())
}

/// Search for similar entities by cosine similarity.
/// Returns results sorted by score descending, limited to `limit`.
/// When `entity_ids` is provided, only those entities are considered (SQL-level
/// filtering before truncation), preventing draft vectors from starving approved TopK.
pub(crate) fn search_similar(
    connection: &Connection,
    entity_type: &str,
    query_embedding: &[f32],
    embedding_model: &str,
    limit: i64,
    entity_ids: Option<&[String]>,
) -> Result<Vec<VectorSearchResult>, String> {
    let bounded_limit = limit.clamp(1, 50);

    let mut results: Vec<VectorSearchResult> = Vec::new();

    match entity_ids {
        // Fail-closed: an explicit empty filter set means "no entities allowed".
        // This prevents degradation to full draft/custom search if the approved
        // registry loads empty or encounters an error upstream.
        Some([]) => {
            return Ok(vec![]);
        }
        Some(ids) => {
            // Build parameterized IN clause for approved entity filtering at SQL level
            let placeholders: Vec<String> = (0..ids.len()).map(|i| format!("?{}", i + 3)).collect();
            let sql = format!(
                "SELECT id, entity_type, entity_id, embedding, embedding_model
                 FROM vector_embeddings
                 WHERE entity_type = ?1 AND embedding_model = ?2 AND entity_id IN ({})",
                placeholders.join(", ")
            );
            let mut stmt = connection
                .prepare(&sql)
                .map_err(|error| format!("failed to prepare filtered vector search: {error}"))?;

            let mut params_vec: Vec<Box<dyn rusqlite::ToSql>> = Vec::with_capacity(ids.len() + 2);
            params_vec.push(Box::new(entity_type.to_string()));
            params_vec.push(Box::new(embedding_model.to_string()));
            for id in ids {
                params_vec.push(Box::new(id.clone()));
            }
            let params_refs: Vec<&dyn rusqlite::ToSql> =
                params_vec.iter().map(|p| p.as_ref()).collect();

            let rows = stmt
                .query_map(params_refs.as_slice(), |row| {
                    Ok((
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, Vec<u8>>(3)?,
                        row.get::<_, String>(4)?,
                    ))
                })
                .map_err(|error| format!("failed to query filtered embeddings: {error}"))?;

            for row in rows {
                let (et, eid, blob, model) =
                    row.map_err(|error| format!("failed to read embedding row: {error}"))?;
                let stored = blob_to_f32_vec(&blob);
                if stored.len() != query_embedding.len() {
                    continue;
                }
                let score = cosine_similarity(query_embedding, &stored);
                if score > 0.1 {
                    results.push(VectorSearchResult {
                        entity_type: et,
                        entity_id: eid,
                        score,
                        embedding_model: model,
                    });
                }
            }
        }
        _ => {
            // No entity filter — search all entities of this type/model
            let mut statement = connection
                .prepare(
                    "SELECT id, entity_type, entity_id, embedding, embedding_model
                     FROM vector_embeddings
                     WHERE entity_type = ?1 AND embedding_model = ?2",
                )
                .map_err(|error| format!("failed to prepare vector search: {error}"))?;

            let rows = statement
                .query_map(params![entity_type, embedding_model], |row| {
                    Ok((
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, Vec<u8>>(3)?,
                        row.get::<_, String>(4)?,
                    ))
                })
                .map_err(|error| format!("failed to query embeddings: {error}"))?;

            for row in rows {
                let (et, eid, blob, model) =
                    row.map_err(|error| format!("failed to read embedding row: {error}"))?;
                let stored = blob_to_f32_vec(&blob);
                if stored.len() != query_embedding.len() {
                    continue;
                }
                let score = cosine_similarity(query_embedding, &stored);
                if score > 0.1 {
                    results.push(VectorSearchResult {
                        entity_type: et,
                        entity_id: eid,
                        score,
                        embedding_model: model,
                    });
                }
            }
        }
    }

    results.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    results.truncate(bounded_limit as usize);

    Ok(results)
}

/// Delete all embeddings for a given entity.
/// 预留：后续向量索引管理和学生数据删除时使用。
#[allow(dead_code)]
pub(crate) fn delete_embeddings(
    connection: &Connection,
    entity_type: &str,
    entity_id: &str,
) -> Result<bool, String> {
    let deleted = connection
        .execute(
            "DELETE FROM vector_embeddings WHERE entity_type = ?1 AND entity_id = ?2",
            params![entity_type, entity_id],
        )
        .map_err(|error| format!("failed to delete embeddings: {error}"))?;

    Ok(deleted > 0)
}

/// Delete embeddings matching entity_type + embedding_model + a set of entity_ids.
/// Used to clean stale vectors from a previous model before regenerating,
/// scoped to approved content only — never touches user private vectors.
pub(crate) fn delete_embeddings_by_model_and_ids(
    connection: &Connection,
    entity_type: &str,
    embedding_model: &str,
    entity_ids: &[String],
) -> Result<usize, String> {
    if entity_ids.is_empty() {
        return Ok(0);
    }

    let placeholders: Vec<String> = (0..entity_ids.len())
        .map(|i| format!("?{}", i + 3))
        .collect();
    let sql = format!(
        "DELETE FROM vector_embeddings WHERE entity_type = ?1 AND embedding_model = ?2 AND entity_id IN ({})",
        placeholders.join(", ")
    );

    let mut stmt = connection
        .prepare(&sql)
        .map_err(|error| format!("failed to prepare delete: {error}"))?;

    let mut params_vec: Vec<Box<dyn rusqlite::ToSql>> = Vec::with_capacity(entity_ids.len() + 2);
    params_vec.push(Box::new(entity_type.to_string()));
    params_vec.push(Box::new(embedding_model.to_string()));
    for id in entity_ids {
        params_vec.push(Box::new(id.clone()));
    }

    let params_refs: Vec<&dyn rusqlite::ToSql> = params_vec.iter().map(|p| p.as_ref()).collect();
    let deleted = stmt
        .execute(params_refs.as_slice())
        .map_err(|error| format!("failed to delete embeddings by model: {error}"))?;

    Ok(deleted)
}

/// Count embeddings by entity type and model.
pub(crate) fn count_embeddings(
    connection: &Connection,
    entity_type: &str,
    embedding_model: &str,
) -> Result<i64, String> {
    connection
        .query_row(
            "SELECT COUNT(1) FROM vector_embeddings
             WHERE entity_type = ?1 AND embedding_model = ?2",
            params![entity_type, embedding_model],
            |row| row.get(0),
        )
        .map_err(|error| format!("failed to count embeddings: {error}"))
}

/// Compute cosine similarity between two vectors.
fn cosine_similarity(a: &[f32], b: &[f32]) -> f64 {
    if a.len() != b.len() || a.is_empty() {
        return 0.0;
    }

    let mut dot = 0.0f64;
    let mut norm_a = 0.0f64;
    let mut norm_b = 0.0f64;

    for i in 0..a.len() {
        let ai = a[i] as f64;
        let bi = b[i] as f64;
        dot += ai * bi;
        norm_a += ai * ai;
        norm_b += bi * bi;
    }

    let denom = norm_a.sqrt() * norm_b.sqrt();
    if denom < 1e-10 {
        0.0
    } else {
        dot / denom
    }
}

/// Convert a Vec<f32> to raw bytes for SQLite BLOB storage.
///
/// Vector blob format: each f32 is stored as 4 bytes in **little-endian** order,
/// regardless of host architecture. This ensures cross-platform compatibility
/// (x86_64, ARM, etc.) when reading blobs written on a different platform.
fn f32_vec_to_blob(v: &[f32]) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(v.len() * 4);
    for &val in v {
        bytes.extend_from_slice(&val.to_le_bytes());
    }
    bytes
}

/// Convert raw bytes back to Vec<f32>.
fn blob_to_f32_vec(blob: &[u8]) -> Vec<f32> {
    blob.chunks_exact(4)
        .map(|chunk| f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]))
        .collect()
}

fn current_timestamp(connection: &Connection) -> Result<String, String> {
    connection
        .query_row("SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now')", [], |row| {
            row.get(0)
        })
        .map_err(|error| format!("failed to read current timestamp: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vector_search_result_serializes_for_frontend_contract() {
        let result = VectorSearchResult {
            entity_type: "knowledge_node".to_string(),
            entity_id: "math-limit-left-right".to_string(),
            score: 0.91,
            embedding_model: "bge-m3".to_string(),
        };

        let json = serde_json::to_value(result).expect("vector result should serialize");

        assert_eq!(json["entityType"], "knowledge_node");
        assert_eq!(json["entityId"], "math-limit-left-right");
        assert_eq!(json["embeddingModel"], "bge-m3");
        assert!(json.get("entity_id").is_none());
        assert!(json.get("embedding_model").is_none());
    }

    /// 论文实验 B（表 3）：暴力余弦检索在不同向量规模下的真实耗时。
    /// 测的是生产代码路径：upsert_embedding 落库 + search_similar 全量扫描。
    /// 运行：cargo test --release bench_brute_cosine_scaling -- --ignored --nocapture
    #[test]
    #[ignore = "性能基准，需 --ignored 显式运行"]
    fn bench_brute_cosine_scaling() {
        const DIM: usize = 1536; // text-embedding-3-small 维度
        const QUERIES: usize = 30;
        const WARMUP: usize = 3;
        const LIMIT: i64 = 5;
        let scales = [1000usize, 2000, 3000, 10000];

        // 确定性 PRNG（xorshift64*），保证论文数据可复现。
        struct Rng(u64);
        impl Rng {
            fn next_u64(&mut self) -> u64 {
                let mut x = self.0;
                x ^= x >> 12;
                x ^= x << 25;
                x ^= x >> 27;
                self.0 = x;
                x.wrapping_mul(0x2545_F491_4F6C_DD1D)
            }
            fn unit(&mut self) -> f64 {
                (self.next_u64() >> 11) as f64 / (1u64 << 53) as f64
            }
        }
        fn normalized_vector(rng: &mut Rng) -> Vec<f32> {
            // Irwin–Hall 近似高斯：12 个均匀分布求和 - 6。
            let raw: Vec<f64> = (0..DIM)
                .map(|_| (0..12).fold(0.0f64, |acc, _| acc + rng.unit()) - 6.0)
                .collect();
            let norm = raw.iter().map(|v| v * v).sum::<f64>().sqrt();
            raw.iter().map(|v| (v / norm) as f32).collect()
        }

        let connection = Connection::open_in_memory().expect("in-memory db");
        connection
            .execute_batch(include_str!("../migrations/0002_vector_embeddings.sql"))
            .expect("vector schema");

        let mut rng = Rng(0x5EED_2026_0909_0001);
        let mut inserted = 0usize;
        println!("scale,mean_ms,max_ms,p95_ms,results_per_query");
        for scale in scales {
            while inserted < scale {
                let embedding = normalized_vector(&mut rng);
                upsert_embedding(
                    &connection,
                    &EmbeddingEntry {
                        id: format!("bench-{inserted:06}"),
                        entity_type: "knowledge_chunk".to_string(),
                        entity_id: format!("chunk-{inserted:06}"),
                        embedding,
                        embedding_model: DEFAULT_EMBEDDING_MODEL.to_string(),
                        embedding_dim: DIM,
                    },
                )
                .expect("insert embedding");
                inserted += 1;
            }
            let queries: Vec<Vec<f32>> =
                (0..QUERIES).map(|_| normalized_vector(&mut rng)).collect();
            let mut timings = Vec::new();
            let mut total_results = 0usize;
            for (index, query) in queries.iter().enumerate() {
                let started = std::time::Instant::now();
                let results = search_similar(
                    &connection,
                    "knowledge_chunk",
                    query,
                    DEFAULT_EMBEDDING_MODEL,
                    LIMIT,
                    None,
                )
                .expect("search");
                let elapsed_ms = started.elapsed().as_secs_f64() * 1000.0;
                if index >= WARMUP {
                    timings.push(elapsed_ms);
                }
                total_results += results.len();
            }
            timings.sort_by(|a, b| a.partial_cmp(b).unwrap());
            let mean = timings.iter().sum::<f64>() / timings.len() as f64;
            let max = *timings.last().expect("timings");
            let p95 = timings[((timings.len() - 1) as f64 * 0.95).round() as usize];
            println!(
                "{scale},{mean:.2},{max:.2},{p95:.2},{:.1}",
                total_results as f64 / QUERIES as f64
            );
        }
    }

    #[test]
    fn cosine_similarity_identical_vectors() {
        let a = [1.0f32, 0.0, 0.0];
        let b = [1.0f32, 0.0, 0.0];
        assert!((cosine_similarity(&a, &b) - 1.0).abs() < 1e-6);
    }

    #[test]
    fn cosine_similarity_orthogonal_vectors() {
        let a = [1.0f32, 0.0, 0.0];
        let b = [0.0f32, 1.0, 0.0];
        assert!(cosine_similarity(&a, &b).abs() < 1e-6);
    }

    #[test]
    fn cosine_similarity_opposite_vectors() {
        let a = [1.0f32, 0.0, 0.0];
        let b = [-1.0f32, 0.0, 0.0];
        assert!((cosine_similarity(&a, &b) - (-1.0)).abs() < 1e-6);
    }

    #[test]
    fn blob_roundtrip_preserves_values() {
        let original = vec![0.5f32, -0.3, 1.0, 0.0, 0.123456];
        let blob = f32_vec_to_blob(&original);
        let restored = blob_to_f32_vec(&blob);
        assert_eq!(original.len(), restored.len());
        for (a, b) in original.iter().zip(restored.iter()) {
            assert!((a - b).abs() < 1e-6);
        }
    }

    #[test]
    fn upsert_and_search_embeddings() {
        let database_path = std::env::temp_dir().join(format!(
            "teacher-agent-vector-test-{}-{}.sqlite3",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let connection = Connection::open(&database_path).expect("test database should open");

        // Apply migration
        connection
            .execute_batch(include_str!("../migrations/0001_initial.sql"))
            .expect("migration 0001 should apply");
        connection
            .execute_batch(include_str!("../migrations/0002_vector_embeddings.sql"))
            .expect("migration 0002 should apply");

        let model = "test-model";

        // Insert some embeddings
        upsert_embedding(
            &connection,
            &EmbeddingEntry {
                id: "emb-1".to_string(),
                entity_type: "knowledge_node".to_string(),
                entity_id: "math-limit-definition".to_string(),
                embedding: vec![1.0, 0.0, 0.0],
                embedding_model: model.to_string(),
                embedding_dim: 3,
            },
        )
        .expect("should insert embedding 1");

        upsert_embedding(
            &connection,
            &EmbeddingEntry {
                id: "emb-2".to_string(),
                entity_type: "knowledge_node".to_string(),
                entity_id: "math-limit-infinitesimal".to_string(),
                embedding: vec![0.7, 0.7, 0.0],
                embedding_model: model.to_string(),
                embedding_dim: 3,
            },
        )
        .expect("should insert embedding 2");

        upsert_embedding(
            &connection,
            &EmbeddingEntry {
                id: "emb-3".to_string(),
                entity_type: "knowledge_node".to_string(),
                entity_id: "math-continuity".to_string(),
                embedding: vec![0.0, 0.0, 1.0],
                embedding_model: model.to_string(),
                embedding_dim: 3,
            },
        )
        .expect("should insert embedding 3");

        // Search similar to [1, 0, 0]
        let results = search_similar(
            &connection,
            "knowledge_node",
            &[1.0, 0.0, 0.0],
            model,
            5,
            None,
        )
        .expect("search should succeed");

        // math-continuity [0,0,1] is orthogonal to query [1,0,0] and gets filtered (score < 0.1)
        assert_eq!(results.len(), 2);
        assert_eq!(results[0].entity_id, "math-limit-definition");
        assert!(results[0].score > 0.99);
        assert_eq!(results[1].entity_id, "math-limit-infinitesimal");
        assert!(results[1].score > 0.5);

        // Upsert same entity with new embedding (update)
        upsert_embedding(
            &connection,
            &EmbeddingEntry {
                id: "emb-1-updated".to_string(),
                entity_type: "knowledge_node".to_string(),
                entity_id: "math-limit-definition".to_string(),
                embedding: vec![0.0, 1.0, 0.0],
                embedding_model: model.to_string(),
                embedding_dim: 3,
            },
        )
        .expect("should update embedding");

        let count =
            count_embeddings(&connection, "knowledge_node", model).expect("count should work");
        assert_eq!(count, 3); // still 3, not 4

        // Delete
        let deleted = delete_embeddings(&connection, "knowledge_node", "math-continuity")
            .expect("delete should work");
        assert!(deleted);

        let count =
            count_embeddings(&connection, "knowledge_node", model).expect("count should work");
        assert_eq!(count, 2);

        drop(connection);
        let _ = std::fs::remove_file(database_path);
    }

    /// Helper: create a test database with migrations applied.
    fn create_test_db() -> (Connection, std::path::PathBuf) {
        let database_path = std::env::temp_dir().join(format!(
            "teacher-agent-vector-test-{}-{}.sqlite3",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let connection = Connection::open(&database_path).expect("test database should open");
        connection
            .execute_batch(include_str!("../migrations/0001_initial.sql"))
            .expect("migration 0001 should apply");
        connection
            .execute_batch(include_str!("../migrations/0002_vector_embeddings.sql"))
            .expect("migration 0002 should apply");
        (connection, database_path)
    }

    #[test]
    fn search_similar_with_entity_ids_filter() {
        let (connection, path) = create_test_db();
        let model = "bge-m3";

        // Insert approved and draft embeddings
        upsert_embedding(
            &connection,
            &EmbeddingEntry {
                id: "emb-approved-1".to_string(),
                entity_type: "knowledge_node".to_string(),
                entity_id: "approved-node-1".to_string(),
                embedding: vec![0.9, 0.1, 0.0],
                embedding_model: model.to_string(),
                embedding_dim: 3,
            },
        )
        .unwrap();
        upsert_embedding(
            &connection,
            &EmbeddingEntry {
                id: "emb-draft-1".to_string(),
                entity_type: "knowledge_node".to_string(),
                entity_id: "draft-node-1".to_string(),
                embedding: vec![1.0, 0.0, 0.0], // higher similarity to query
                embedding_model: model.to_string(),
                embedding_dim: 3,
            },
        )
        .unwrap();

        // Search with entity_ids filter: only approved-node-1 allowed
        let approved_ids = vec!["approved-node-1".to_string()];
        let results = search_similar(
            &connection,
            "knowledge_node",
            &[1.0, 0.0, 0.0],
            model,
            10,
            Some(&approved_ids),
        )
        .unwrap();

        // Draft node has higher score but must be excluded by SQL filter
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].entity_id, "approved-node-1");

        drop(connection);
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn search_similar_empty_entity_ids_returns_empty() {
        let (connection, path) = create_test_db();
        let model = "bge-m3";

        upsert_embedding(
            &connection,
            &EmbeddingEntry {
                id: "emb-1".to_string(),
                entity_type: "knowledge_node".to_string(),
                entity_id: "node-1".to_string(),
                embedding: vec![1.0, 0.0, 0.0],
                embedding_model: model.to_string(),
                embedding_dim: 3,
            },
        )
        .unwrap();

        // Some([]) must return empty (fail-closed), not degrade to full search
        let empty_ids: Vec<String> = vec![];
        let results = search_similar(
            &connection,
            "knowledge_node",
            &[1.0, 0.0, 0.0],
            model,
            10,
            Some(&empty_ids),
        )
        .unwrap();
        assert_eq!(results.len(), 0);

        // None means "no filter" — should return results
        let results = search_similar(
            &connection,
            "knowledge_node",
            &[1.0, 0.0, 0.0],
            model,
            10,
            None,
        )
        .unwrap();
        assert_eq!(results.len(), 1);

        drop(connection);
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn delete_by_model_and_ids_only_deletes_specified() {
        let (connection, path) = create_test_db();
        let model = "bge-m3";

        // Insert 3 embeddings: 2 draft, 1 approved
        for (id, entity_id) in [
            ("emb-d1", "draft-1"),
            ("emb-d2", "draft-2"),
            ("emb-a1", "approved-1"),
        ] {
            upsert_embedding(
                &connection,
                &EmbeddingEntry {
                    id: id.to_string(),
                    entity_type: "knowledge_node".to_string(),
                    entity_id: entity_id.to_string(),
                    embedding: vec![0.5, 0.5, 0.0],
                    embedding_model: model.to_string(),
                    embedding_dim: 3,
                },
            )
            .unwrap();
        }

        // Delete only draft IDs
        let draft_ids = vec!["draft-1".to_string(), "draft-2".to_string()];
        let deleted =
            delete_embeddings_by_model_and_ids(&connection, "knowledge_node", model, &draft_ids)
                .unwrap();
        assert_eq!(deleted, 2);

        // Approved vector must survive
        let count = count_embeddings(&connection, "knowledge_node", model).unwrap();
        assert_eq!(count, 1);

        drop(connection);
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn delete_by_model_and_ids_preserves_custom_and_other_model() {
        let (connection, path) = create_test_db();
        let model = "bge-m3";
        let other_model = "text-embedding-3-small";

        // Insert: built-in draft (bge-m3), custom subject (bge-m3), other model vector
        upsert_embedding(
            &connection,
            &EmbeddingEntry {
                id: "emb-builtin-draft".to_string(),
                entity_type: "knowledge_node".to_string(),
                entity_id: "builtin-draft-1".to_string(),
                embedding: vec![0.5, 0.5, 0.0],
                embedding_model: model.to_string(),
                embedding_dim: 3,
            },
        )
        .unwrap();
        upsert_embedding(
            &connection,
            &EmbeddingEntry {
                id: "emb-custom".to_string(),
                entity_type: "knowledge_node".to_string(),
                entity_id: "custom-subject-node-1".to_string(),
                embedding: vec![0.3, 0.7, 0.0],
                embedding_model: model.to_string(),
                embedding_dim: 3,
            },
        )
        .unwrap();
        upsert_embedding(
            &connection,
            &EmbeddingEntry {
                id: "emb-other-model".to_string(),
                entity_type: "knowledge_node".to_string(),
                entity_id: "builtin-draft-1".to_string(),
                embedding: vec![0.5, 0.5, 0.0],
                embedding_model: other_model.to_string(),
                embedding_dim: 3,
            },
        )
        .unwrap();

        // Delete only the known built-in draft ID with bge-m3
        let draft_ids = vec!["builtin-draft-1".to_string()];
        let deleted =
            delete_embeddings_by_model_and_ids(&connection, "knowledge_node", model, &draft_ids)
                .unwrap();
        assert_eq!(deleted, 1);

        // Custom subject vector (same model, different entity_id) must survive
        // Other model vector (same entity_id, different model) must survive
        let count_bge = count_embeddings(&connection, "knowledge_node", model).unwrap();
        assert_eq!(count_bge, 1); // only custom-subject-node-1 remains

        let count_other = count_embeddings(&connection, "knowledge_node", other_model).unwrap();
        assert_eq!(count_other, 1); // other model untouched

        drop(connection);
        let _ = std::fs::remove_file(path);
    }
}
