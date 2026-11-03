use rusqlite::{params, types::ValueRef, Connection};
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

/// 查询侧预计算：把**行间不变量**移出逐行循环（暴力余弦热路径优化）。
///
/// 旧实现对每一行都重复做四件事：① 逐元素把查询向量 f32→f64；② 重算查询范数
/// （行间不变量）；③ 两次 4KB 堆分配（`Vec<u8>` + `Vec<f32>`）；④ 为每行构造
/// 3 个内容完全相同的 `String`（entity_type / embedding_model 与入参相同）。
/// 本结构把 ①② 提到每次查询只算一次；③ 由零拷贝 BLOB 读取 + 复用解码缓冲消除；
/// ④ 由 SQL 只取 `entity_id, embedding` 两列消除。
///
/// **数值与旧实现逐位一致**：dot 与范数的累加顺序、公式均未改变，仅把不变的
/// 输入移出循环（`sqrt_norm_query` 与旧实现每行重算的 `norm_a.sqrt()` 相同）。
struct PreparedQuery {
    query_f64: Vec<f64>,
    sqrt_norm_query: f64,
}

impl PreparedQuery {
    fn new(query_embedding: &[f32]) -> Self {
        let query_f64: Vec<f64> = query_embedding.iter().map(|&value| value as f64).collect();
        let mut norm_query = 0.0f64;
        for &value in &query_f64 {
            norm_query += value * value;
        }
        Self {
            query_f64,
            sqrt_norm_query: norm_query.sqrt(),
        }
    }

    /// 与旧 `cosine_similarity(query, stored)` 逐位一致（见结构体文档）。
    fn score(&self, stored: &[f32]) -> f64 {
        if self.query_f64.len() != stored.len() || self.query_f64.is_empty() {
            return 0.0;
        }

        let mut dot = 0.0f64;
        let mut norm_stored = 0.0f64;

        for (index, &value) in stored.iter().enumerate() {
            let stored_value = value as f64;
            dot += self.query_f64[index] * stored_value;
            norm_stored += stored_value * stored_value;
        }

        let denom = self.sqrt_norm_query * norm_stored.sqrt();
        if denom < 1e-10 {
            0.0
        } else {
            dot / denom
        }
    }
}

/// 把 BLOB 解码进**复用缓冲**（等价于 `blob_to_f32_vec`，但不在每行分配新 `Vec`）。
fn blob_into_f32_vec(blob: &[u8], out: &mut Vec<f32>) {
    out.clear();
    out.reserve(blob.len() / 4);
    for chunk in blob.chunks_exact(4) {
        out.push(f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]));
    }
}

/// Search for similar entities by cosine similarity.
/// Returns results sorted by score descending, limited to `limit`.
/// When `entity_ids` is provided, only those entities are considered (SQL-level
/// filtering before truncation), preventing draft vectors from starving approved TopK.
///
/// 热路径优化（见 [`PreparedQuery`]）：查询侧不变量一次预计算、BLOB 零拷贝读取、
/// 解码缓冲跨行复用、SQL 只取必要列。排序仍为稳定排序，并列分数的先后次序与
/// 旧实现一致，检索结果逐位不变。
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

    // 行间不变量一次算好（见 PreparedQuery 文档）。
    let prepared = PreparedQuery::new(query_embedding);
    // 复用的解码缓冲：每次查询分配一次，N 行重复使用。
    let mut stored_buf: Vec<f32> = Vec::with_capacity(query_embedding.len());

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
                "SELECT entity_id, embedding
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
                    let entity_id: String = row.get(0)?;
                    let computed: Option<f64> = {
                        let blob = match row.get_ref(1)? {
                            ValueRef::Blob(bytes) => bytes,
                            _ => &[],
                        };
                        blob_into_f32_vec(blob, &mut stored_buf);
                        if stored_buf.len() != query_embedding.len() {
                            None
                        } else {
                            let score = prepared.score(&stored_buf);
                            if score > 0.1 {
                                Some(score)
                            } else {
                                None
                            }
                        }
                    };
                    Ok((entity_id, computed))
                })
                .map_err(|error| format!("failed to query filtered embeddings: {error}"))?;

            for row in rows {
                let (entity_id, score) =
                    row.map_err(|error| format!("failed to read embedding row: {error}"))?;
                if let Some(score) = score {
                    results.push(VectorSearchResult {
                        entity_type: entity_type.to_string(),
                        entity_id,
                        score,
                        embedding_model: embedding_model.to_string(),
                    });
                }
            }
        }
        _ => {
            // No entity filter — search all entities of this type/model
            let mut statement = connection
                .prepare(
                    "SELECT entity_id, embedding
                     FROM vector_embeddings
                     WHERE entity_type = ?1 AND embedding_model = ?2",
                )
                .map_err(|error| format!("failed to prepare vector search: {error}"))?;

            let rows = statement
                .query_map(params![entity_type, embedding_model], |row| {
                    let entity_id: String = row.get(0)?;
                    let computed: Option<f64> = {
                        let blob = match row.get_ref(1)? {
                            ValueRef::Blob(bytes) => bytes,
                            _ => &[],
                        };
                        blob_into_f32_vec(blob, &mut stored_buf);
                        if stored_buf.len() != query_embedding.len() {
                            None
                        } else {
                            let score = prepared.score(&stored_buf);
                            if score > 0.1 {
                                Some(score)
                            } else {
                                None
                            }
                        }
                    };
                    Ok((entity_id, computed))
                })
                .map_err(|error| format!("failed to query embeddings: {error}"))?;

            for row in rows {
                let (entity_id, score) =
                    row.map_err(|error| format!("failed to read embedding row: {error}"))?;
                if let Some(score) = score {
                    results.push(VectorSearchResult {
                        entity_type: entity_type.to_string(),
                        entity_id,
                        score,
                        embedding_model: embedding_model.to_string(),
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
///
/// 参考实现：热路径（[`PreparedQuery::score`]）的逐位等价基线，测试用于守护
/// 「优化不改结果」这一约束；生产检索路径不再逐行调用本函数。
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
    let mut out = Vec::new();
    blob_into_f32_vec(blob, &mut out);
    out
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
        const DIM: usize = 1024; // 与生产嵌入模型 bge-m3 一致（1024 维）
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

    /// 热路径成本分解：把「暴力余弦检索」拆成 SQLite 取行 / BLOB 解码 / 数学 /
    /// 旧实现完整路径 / 新实现完整路径，各自独立计时。
    ///
    /// 目的：回答"优化该投在哪里"。实测（in-memory，2000×1024 维）若数学只占
    /// 小头、解码与行遍历占大头，则说明纯计算优化（SIMD/预归一化）收益有限，
    /// 带宽类优化（SQ8 量化、内存驻留缓存）才是正解——这正是架构章节需要的
    /// 取舍证据。
    /// 运行：cargo test --release bench_hot_path_breakdown -- --ignored --nocapture
    #[test]
    #[ignore = "性能分解，需 --ignored 显式运行"]
    fn bench_hot_path_breakdown() {
        const DIM: usize = 1024;
        const SCALE: usize = 2000;
        const QUERIES: usize = 30;
        const WARMUP: usize = 3;
        const LIMIT: i64 = 5;

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
        for index in 0..SCALE {
            upsert_embedding(
                &connection,
                &EmbeddingEntry {
                    id: format!("bench-{index:06}"),
                    entity_type: "knowledge_chunk".to_string(),
                    entity_id: format!("chunk-{index:06}"),
                    embedding: normalized_vector(&mut rng),
                    embedding_model: DEFAULT_EMBEDDING_MODEL.to_string(),
                    embedding_dim: DIM,
                },
            )
            .expect("insert embedding");
        }
        let queries: Vec<Vec<f32>> = (0..QUERIES).map(|_| normalized_vector(&mut rng)).collect();

        fn mean_ms(mut timings: Vec<f64>) -> f64 {
            timings.sort_by(|a, b| a.partial_cmp(b).unwrap());
            timings.truncate((timings.len() as f64 * 0.95) as usize); // 去掉尾部 5% 离群
            if timings.is_empty() {
                return 0.0;
            }
            timings.iter().sum::<f64>() / timings.len() as f64
        }

        // ① 仅 SQLite 行遍历 + 取列（不解码、不数学）
        // ② 仅 BLOB 解码（f32::from_le_bytes，复用缓冲）
        // ③ 仅数学（预解码好的向量上做参考实现 cosine_similarity）
        // ④ 旧实现完整路径（逐行两次 4KB 分配 + 参考实现打分）
        // ⑤ 新实现完整路径（search_similar）
        let decoded: Vec<Vec<f32>> = {
            let mut out = Vec::with_capacity(SCALE);
            let mut statement = connection
                .prepare("SELECT embedding FROM vector_embeddings")
                .expect("prepare");
            let rows = statement
                .query_map([], |row| row.get::<_, Vec<u8>>(0))
                .expect("q");
            for row in rows {
                out.push(blob_to_f32_vec(&row.expect("blob")));
            }
            out
        };

        let mut phase_rows = Vec::new();
        let mut phase_decode = Vec::new();
        let mut phase_math = Vec::new();
        let mut phase_legacy = Vec::new();
        let mut phase_new = Vec::new();

        for _round in 0..(QUERIES + WARMUP) {
            let round_index = _round;
            let query = &queries[round_index % QUERIES];

            // ① 行遍历 + 取列
            let started = std::time::Instant::now();
            {
                let mut statement = connection
                    .prepare("SELECT entity_id, embedding FROM vector_embeddings")
                    .expect("prepare");
                let rows = statement
                    .query_map([], |row| {
                        let _id: String = row.get(0)?;
                        let blob: Vec<u8> = row.get(1)?;
                        Ok(blob.len())
                    })
                    .expect("q");
                let mut total = 0usize;
                for row in rows {
                    total += row.expect("row");
                }
                std::hint::black_box(total);
            }
            if round_index >= WARMUP {
                phase_rows.push(started.elapsed().as_secs_f64() * 1000.0);
            }

            // ② 仅解码（同量 BLOB）
            let started = std::time::Instant::now();
            {
                let mut statement = connection
                    .prepare("SELECT embedding FROM vector_embeddings")
                    .expect("prepare");
                let rows = statement
                    .query_map([], |row| row.get::<_, Vec<u8>>(0))
                    .expect("q");
                let mut buffer: Vec<f32> = Vec::with_capacity(DIM);
                let mut checksum = 0.0f32;
                for row in rows {
                    let blob = row.expect("blob");
                    blob_into_f32_vec(&blob, &mut buffer);
                    checksum += buffer[0];
                }
                std::hint::black_box(checksum);
            }
            if round_index >= WARMUP {
                phase_decode.push(started.elapsed().as_secs_f64() * 1000.0);
            }

            // ③ 仅数学（预解码向量 × 旧版 cosine_similarity）
            let started = std::time::Instant::now();
            {
                let mut matched = 0usize;
                for stored in &decoded {
                    let score = cosine_similarity(query, stored);
                    if score > 0.1 {
                        matched += 1;
                    }
                }
                std::hint::black_box(matched);
            }
            if round_index >= WARMUP {
                phase_math.push(started.elapsed().as_secs_f64() * 1000.0);
            }

            // ④ 旧实现完整路径（逐行分配 + 参考实现打分）
            let started = std::time::Instant::now();
            {
                let mut statement = connection
                    .prepare(
                        "SELECT entity_id, embedding FROM vector_embeddings
                         WHERE entity_type = ?1 AND embedding_model = ?2",
                    )
                    .expect("prepare");
                let rows = statement
                    .query_map(params![entity_type_bench(), model_bench()], |row| {
                        Ok((row.get::<_, String>(0)?, row.get::<_, Vec<u8>>(1)?))
                    })
                    .expect("q");
                let mut matched = 0usize;
                for row in rows {
                    let (entity_id, blob) = row.expect("row");
                    let stored = blob_to_f32_vec(&blob);
                    if stored.len() != query.len() {
                        continue;
                    }
                    let score = cosine_similarity(query, &stored);
                    if score > 0.1 {
                        matched += 1;
                        std::hint::black_box(&entity_id);
                    }
                }
                std::hint::black_box(matched);
            }
            if round_index >= WARMUP {
                phase_legacy.push(started.elapsed().as_secs_f64() * 1000.0);
            }

            // ⑤ 新实现完整路径
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
            if round_index >= WARMUP {
                phase_new.push(started.elapsed().as_secs_f64() * 1000.0);
            }
            std::hint::black_box(results.len());
        }

        println!("phase,mean_ms");
        println!("rows_only,{:.2}", mean_ms(phase_rows));
        println!("decode_only,{:.2}", mean_ms(phase_decode));
        println!("math_only,{:.2}", mean_ms(phase_math));
        println!("legacy_full,{:.2}", mean_ms(phase_legacy));
        println!("new_full(search_similar),{:.2}", mean_ms(phase_new));
    }

    fn entity_type_bench() -> &'static str {
        "knowledge_chunk"
    }

    fn model_bench() -> &'static str {
        DEFAULT_EMBEDDING_MODEL
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

    /// 热路径优化的核心守卫：`PreparedQuery::score` 必须与参考实现
    /// `cosine_similarity` **逐位一致**（累加顺序与公式未变，仅外提行间不变量）。
    #[test]
    fn prepared_query_scores_are_bit_identical_to_reference() {
        // 确定性 PRNG（与 bench 相同的 xorshift64* 家族），保证可复现。
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
        let mut rng = Rng(0x5EED_2026_0915_0001);
        for case in 0..48u32 {
            // 覆盖 1..=1103 维：包含非 4 倍数长度、奇数长度与生产规模（1024）。
            let dim = 1 + ((case * 137) % 1103) as usize;
            let query: Vec<f32> = (0..dim).map(|_| (rng.unit() as f32 - 0.5) * 4.0).collect();
            let stored: Vec<f32> = (0..dim).map(|_| (rng.unit() as f32 - 0.5) * 4.0).collect();

            let prepared = PreparedQuery::new(&query);
            let fast = prepared.score(&stored);
            let reference = cosine_similarity(&query, &stored);
            assert_eq!(
                fast, reference,
                "case {case} (dim {dim}): 预计算打分与参考实现不一致"
            );
        }

        // 退化输入：全零向量（denom < 1e-10 分支）与空查询。
        let zero = PreparedQuery::new(&[0.0f32, 0.0, 0.0]);
        assert_eq!(zero.score(&[0.0f32, 0.0, 0.0]), 0.0);
        let empty: Vec<f32> = Vec::new();
        assert_eq!(PreparedQuery::new(&empty).score(&[]), 0.0);
    }

    /// BLOB 解码的复用缓冲版本必须与一次性版本等价，且跨行复用不串值。
    #[test]
    fn blob_into_f32_vec_matches_blob_to_f32_vec_across_reuse() {
        let first = vec![0.5f32, -0.3, 1.0, 0.0, 0.123456];
        let second = vec![1.5f32; 1024];
        let mut buffer: Vec<f32> = Vec::new();

        blob_into_f32_vec(&f32_vec_to_blob(&first), &mut buffer);
        assert_eq!(buffer, blob_to_f32_vec(&f32_vec_to_blob(&first)));

        blob_into_f32_vec(&f32_vec_to_blob(&second), &mut buffer);
        assert_eq!(buffer, blob_to_f32_vec(&f32_vec_to_blob(&second)));
        assert_eq!(buffer.len(), 1024, "复用缓冲必须随新行长度收缩");
    }

    #[test]
    fn search_similar_with_empty_or_mismatched_query_returns_no_results() {
        let connection = Connection::open_in_memory().expect("in-memory db");
        connection
            .execute_batch(include_str!("../migrations/0002_vector_embeddings.sql"))
            .expect("vector schema");
        upsert_embedding(
            &connection,
            &EmbeddingEntry {
                id: "emb-node-1".to_string(),
                entity_type: "knowledge_node".to_string(),
                entity_id: "node-1".to_string(),
                embedding: vec![1.0, 0.0, 0.0],
                embedding_model: "bge-m3".to_string(),
                embedding_dim: 3,
            },
        )
        .expect("upsert embedding");

        // 空查询：旧行为是逐行 cosine 返回 0.0（不满足 > 0.1），结果为空。
        let results =
            search_similar(&connection, "knowledge_node", &[], "bge-m3", 5, None).expect("search");
        assert!(results.is_empty(), "空查询必须返回空结果");

        // 维度不匹配的行必须被跳过。
        let results = search_similar(
            &connection,
            "knowledge_node",
            &[1.0, 0.0],
            "bge-m3",
            5,
            None,
        )
        .expect("search");
        assert!(results.is_empty(), "维度不匹配的行必须被跳过");
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
