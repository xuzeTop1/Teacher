//! 私有资料文档 repository — save / list / delete / load chunks。

use crate::{current_timestamp, DEFAULT_STUDENT_ID};
use rusqlite::{params, Connection, OptionalExtension};

/// 每个 chunk 的目标字符数
const CHUNK_TARGET_CHARS: usize = 1500;

/// 单页/单工作表输入
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PageOrSheetInput {
    pub name: String,
    pub text: String,
}

/// 保存私有文档输入
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub(crate) struct SavePrivateDocumentInput {
    pub file_name: String,
    pub file_type: String,
    pub title: Option<String>,
    pub subject_code: String,
    pub pages_or_sheets: Vec<PageOrSheetInput>,
    pub plain_text: String,
}

/// 保存后的文档摘要
#[derive(Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SavedPrivateDocument {
    pub id: String,
    pub file_name: String,
    pub file_type: String,
    pub title: String,
    pub subject_code: String,
    pub source_type: String,
    pub status: String,
    pub chunk_count: i64,
    pub created_at: String,
}

/// 单个 chunk
#[derive(Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PrivateDocumentChunk {
    pub id: String,
    pub document_id: String,
    pub chunk_index: i64,
    pub heading: Option<String>,
    pub text: String,
    pub token_estimate: Option<i64>,
}

// ── chunk 分割 ─────────────────────────────────────────────────────────────

/// 将 pagesOrSheets 按 CHUNK_TARGET_CHARS 切分为 chunk。
/// 优先按 pagesOrSheets 分割；如果 pages 为空，则 fallback 到 plain_text；
/// 如果两者都为空，返回空 Vec（调用方应拒绝保存空文档）。
fn build_chunks(pages: &[PageOrSheetInput], plain_text: &str) -> Vec<(Option<String>, String)> {
    let mut chunks: Vec<(Option<String>, String)> = Vec::new();

    for page in pages {
        let text = page.text.trim();
        if text.is_empty() {
            continue;
        }

        if text.chars().count() <= CHUNK_TARGET_CHARS {
            chunks.push((Some(page.name.clone()), text.to_string()));
        } else {
            let mut remaining = text;
            let mut part_idx = 0;
            while !remaining.is_empty() {
                let take: String = remaining.chars().take(CHUNK_TARGET_CHARS).collect();
                let heading = if part_idx == 0 {
                    Some(page.name.clone())
                } else {
                    Some(format!("{}（续{}）", page.name, part_idx))
                };
                chunks.push((heading, take.clone()));
                remaining = &remaining[take.len()..];
                part_idx += 1;
            }
        }
    }

    // pages 为空或全空页时，fallback 到 plain_text
    if chunks.is_empty() {
        let trimmed = plain_text.trim();
        if !trimmed.is_empty() {
            // 按 CHUNK_TARGET_CHARS 切分 plain_text
            let mut remaining = trimmed;
            let mut part_idx = 0;
            while !remaining.is_empty() {
                let take: String = remaining.chars().take(CHUNK_TARGET_CHARS).collect();
                let heading = if part_idx == 0 {
                    Some("全文".to_string())
                } else {
                    Some(format!("全文（续{}）", part_idx))
                };
                chunks.push((heading, take.clone()));
                remaining = &remaining[take.len()..];
                part_idx += 1;
            }
        }
        // 如果 plain_text 也为空，chunks 仍为空，调用方应拒绝保存
    }

    chunks
}

/// 粗估 token 数（中文约 1.5 char/token，英文约 4 char/token，取折中 2）
fn estimate_tokens(text: &str) -> i64 {
    let char_count = text.chars().count();
    (char_count as f64 / 2.0).ceil() as i64
}

// ── 保存 ───────────────────────────────────────────────────────────────────

pub(crate) fn save_private_document_with_connection(
    connection: &mut Connection,
    input: &SavePrivateDocumentInput,
) -> Result<SavedPrivateDocument, String> {
    let now = current_timestamp(connection)?;
    let doc_id = format!("privdoc-{}", uuid_v7());
    let student_id = DEFAULT_STUDENT_ID;
    let title = input
        .title
        .as_deref()
        .unwrap_or(&input.file_name)
        .to_string();

    let chunks = build_chunks(&input.pages_or_sheets, &input.plain_text);
    if chunks.is_empty() {
        return Err("文档内容为空，无法保存。请确认文件包含可提取的文本。".to_string());
    }
    let chunk_count = chunks.len() as i64;

    // 整个写入在单一事务内完成，任何 chunk 插入失败都会回滚文档记录，
    // 避免留下没有 chunks 的半导入文档。
    let tx = connection
        .transaction()
        .map_err(|error| format!("failed to begin transaction: {error}"))?;

    tx.execute(
        "INSERT INTO private_documents (
           id, student_id, subject_code, file_name, file_type, title,
           source_type, status, chunk_count, created_at, updated_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'private_user_import', 'draft', ?7, ?8, ?8)",
        params![
            doc_id,
            student_id,
            input.subject_code,
            input.file_name,
            input.file_type,
            title,
            chunk_count,
            now,
        ],
    )
    .map_err(|error| format!("failed to insert private_document: {error}"))?;

    for (idx, (heading, text)) in chunks.iter().enumerate() {
        let chunk_id = format!("privchk-{}-{}", doc_id, idx);
        let token_est = estimate_tokens(text);
        tx.execute(
            "INSERT INTO private_document_chunks (
               id, document_id, chunk_index, heading, text, token_estimate, created_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                chunk_id,
                doc_id,
                idx as i64,
                heading.as_deref(),
                text,
                token_est,
                now,
            ],
        )
        .map_err(|error| format!("failed to insert private_document_chunk: {error}"))?;
    }

    tx.commit()
        .map_err(|error| format!("failed to commit transaction: {error}"))?;

    Ok(SavedPrivateDocument {
        id: doc_id,
        file_name: input.file_name.clone(),
        file_type: input.file_type.clone(),
        title,
        subject_code: input.subject_code.clone(),
        source_type: "private_user_import".to_string(),
        status: "draft".to_string(),
        chunk_count,
        created_at: now,
    })
}

// ── 列表 ───────────────────────────────────────────────────────────────────

/// 列出私有文档，limit 强制 clamp 到 1..=100。
pub(crate) fn list_private_documents_with_connection(
    connection: &Connection,
    subject_code: Option<&str>,
    limit: i64,
) -> Result<Vec<SavedPrivateDocument>, String> {
    let limit = limit.clamp(1, 100);
    let base = "SELECT id, file_name, file_type, title, subject_code, source_type, status, chunk_count, created_at
         FROM private_documents WHERE 1=1";

    let mut statement = if let Some(sc) = subject_code {
        let sql = format!("{base} AND subject_code = ?1 ORDER BY created_at DESC LIMIT ?2");
        let mut stmt = connection
            .prepare(&sql)
            .map_err(|error| format!("failed to prepare list_private_documents: {error}"))?;
        let rows = stmt
            .query_map(params![sc, limit], row_to_saved_document)
            .map_err(|error| format!("failed to query private_documents: {error}"))?;
        return rows
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("failed to read private_document row: {error}"));
    } else {
        let sql = format!("{base} ORDER BY created_at DESC LIMIT ?1");
        connection
            .prepare(&sql)
            .map_err(|error| format!("failed to prepare list_private_documents: {error}"))?
    };

    let rows = statement
        .query_map(params![limit], row_to_saved_document)
        .map_err(|error| format!("failed to query private_documents: {error}"))?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("failed to read private_document row: {error}"))
}

fn row_to_saved_document(row: &rusqlite::Row) -> rusqlite::Result<SavedPrivateDocument> {
    Ok(SavedPrivateDocument {
        id: row.get(0)?,
        file_name: row.get(1)?,
        file_type: row.get(2)?,
        title: row.get(3)?,
        subject_code: row.get(4)?,
        source_type: row.get(5)?,
        status: row.get(6)?,
        chunk_count: row.get(7)?,
        created_at: row.get(8)?,
    })
}

// ── 单文档查询 ─────────────────────────────────────────────────────────────

/// 按 ID 加载单个私有文档。不存在返回 None。
pub(crate) fn get_private_document_by_id(
    connection: &Connection,
    document_id: &str,
) -> Result<Option<SavedPrivateDocument>, String> {
    connection
        .query_row(
            "SELECT id, file_name, file_type, title, subject_code, source_type, status, chunk_count, created_at
             FROM private_documents WHERE id = ?1",
            [document_id],
            row_to_saved_document,
        )
        .optional()
        .map_err(|error| format!("failed to get private document: {error}"))
}

// ── 删除（彻底删除：chunks + document，同一事务） ─────────────────────────

pub(crate) fn delete_private_document_with_connection(
    connection: &mut Connection,
    document_id: &str,
) -> Result<bool, String> {
    let tx = connection
        .transaction()
        .map_err(|error| format!("failed to begin delete transaction: {error}"))?;

    // 先清理所有会话绑定，再删 chunks，再删 document，避免孤儿记录
    clear_bindings_for_private_document(&tx, document_id)?;

    tx.execute(
        "DELETE FROM private_document_chunks WHERE document_id = ?1",
        params![document_id],
    )
    .map_err(|error| format!("failed to delete private_document_chunks: {error}"))?;

    let affected = tx
        .execute(
            "DELETE FROM private_documents WHERE id = ?1",
            params![document_id],
        )
        .map_err(|error| format!("failed to delete private_document: {error}"))?;

    tx.commit()
        .map_err(|error| format!("failed to commit delete transaction: {error}"))?;

    Ok(affected > 0)
}

// ── 会话级资料绑定 ─────────────────────────────────────────────────────────

/// 绑定一份私有资料到指定会话（0 或 1 绑定，INSERT OR REPLACE）。
///
/// 校验：conversation 未删除、document 存在、student_id 一致、subject_code 一致。
pub(crate) fn bind_private_document_to_conversation(
    connection: &Connection,
    conversation_id: &str,
    document_id: &str,
) -> Result<(), String> {
    // 校验归属：conversation.student_id == document.student_id
    //            且 conversation 的 subject.code == document.subject_code
    let valid_count: i64 = connection
        .query_row(
            "SELECT COUNT(1) FROM conversations c
               JOIN subjects s ON s.id = c.subject_id
               JOIN private_documents d ON d.id = ?2
             WHERE c.id = ?1
               AND c.deleted_at IS NULL
               AND c.student_id = d.student_id
               AND s.code = d.subject_code",
            params![conversation_id, document_id],
            |row| row.get(0),
        )
        .map_err(|error| format!("failed to validate bind ownership: {error}"))?;

    if valid_count == 0 {
        return Err(
            "conversation and document do not belong to the same student or subject".to_string(),
        );
    }

    let now = current_timestamp(connection).unwrap_or_else(|_| "unknown".to_string());
    connection
        .execute(
            "INSERT INTO conversation_private_documents
               (conversation_id, private_document_id, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?3)
             ON CONFLICT(conversation_id) DO UPDATE SET
               private_document_id = excluded.private_document_id,
               updated_at = excluded.updated_at",
            params![conversation_id, document_id, now],
        )
        .map_err(|error| format!("failed to bind private document to conversation: {error}"))?;
    Ok(())
}

/// 清空指定会话的资料绑定。返回是否实际删除了绑定。
pub(crate) fn clear_private_document_binding(
    connection: &Connection,
    conversation_id: &str,
) -> Result<bool, String> {
    let affected = connection
        .execute(
            "DELETE FROM conversation_private_documents WHERE conversation_id = ?1",
            params![conversation_id],
        )
        .map_err(|error| format!("failed to clear private document binding: {error}"))?;
    Ok(affected > 0)
}

/// 读取指定会话绑定的资料 ID。无绑定返回 None。
pub(crate) fn load_conversation_private_document_id(
    connection: &Connection,
    conversation_id: &str,
) -> Result<Option<String>, String> {
    connection
        .query_row(
            "SELECT private_document_id FROM conversation_private_documents WHERE conversation_id = ?1",
            params![conversation_id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| format!("failed to load conversation private document id: {error}"))
}

/// 清理所有指向指定资料的会话绑定（用于删除资料时同步清理）。
pub(crate) fn clear_bindings_for_private_document(
    connection: &Connection,
    document_id: &str,
) -> Result<u64, String> {
    let affected = connection
        .execute(
            "DELETE FROM conversation_private_documents WHERE private_document_id = ?1",
            params![document_id],
        )
        .map_err(|error| format!("failed to clear bindings for private document: {error}"))?;
    Ok(affected as u64)
}

// ── 搜索 chunks ────────────────────────────────────────────────────────────

/// 搜索结果条目
#[derive(Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PrivateChunkSearchResult {
    pub document_id: String,
    pub document_title: String,
    pub file_name: String,
    pub heading: Option<String>,
    pub text: String,
    pub score: i64,
    pub source_type: String,
}

/// 在私有资料 chunks 中做关键词搜索。
/// 转义 SQLite LIKE 元字符（%、_、\），防止注入式宽匹配。
fn escape_like_pattern(value: &str) -> String {
    let mut escaped = String::with_capacity(value.len() + 8);
    for ch in value.chars() {
        match ch {
            '%' | '_' => {
                escaped.push('\\');
                escaped.push(ch);
            }
            '\\' => {
                escaped.push('\\');
                escaped.push('\\');
            }
            _ => escaped.push(ch),
        }
    }
    escaped
}

/// 从自然语言 query 中提取搜索关键词。
///
/// - 连续中文字符 ≥2 字 → 一个 token
/// - 连续 ASCII 字母/数字 ≥2 字 → 一个 token（转小写）
/// - 去重后返回；若无有效 token 则返回空 Vec
fn extract_search_tokens(query: &str) -> Vec<String> {
    let lower = query.to_lowercase();
    let mut tokens: Vec<String> = Vec::new();

    // 逐字符扫描，提取连续 CJK 汉字（≥2）和 ASCII 字母/数字（≥2）
    let chars: Vec<char> = lower.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        let ch = chars[i];
        if ch as u32 >= 0x4e00 && ch as u32 <= 0x9fff {
            // CJK 统一汉字
            let start = i;
            while i < chars.len() && chars[i] as u32 >= 0x4e00 && chars[i] as u32 <= 0x9fff {
                i += 1;
            }
            if i - start >= 2 {
                let token: String = chars[start..i].iter().collect();
                tokens.push(token);
            }
        } else if ch.is_ascii_alphanumeric() {
            let start = i;
            while i < chars.len() && chars[i].is_ascii_alphanumeric() {
                i += 1;
            }
            if i - start >= 2 {
                let token: String = chars[start..i].iter().collect();
                tokens.push(token);
            }
        } else {
            i += 1;
        }
    }

    tokens.sort();
    tokens.dedup();
    tokens
}

/// 只搜索未删除的文档（通过 JOIN private_documents 过滤）。
/// 按 subject_code 过滤，使用 tokenized OR LIKE 匹配 + 长度加权评分。
///
/// - query 为空时直接返回空结果。
/// - query 超过 200 字符时截断到 200。
/// - limit 强制 clamp 到 1..=10。
/// - LIKE 元字符（%、_）会被转义，防止宽匹配注入。
/// - query 被拆分为中文/英文 token，任一 token 命中即返回。
pub(crate) fn search_private_chunks_with_connection(
    connection: &Connection,
    query: &str,
    subject_code: &str,
    limit: i64,
) -> Result<Vec<PrivateChunkSearchResult>, String> {
    let limit = limit.clamp(1, 10);
    let trimmed = query.trim();
    if trimmed.is_empty() {
        return Ok(Vec::new());
    }
    // 截断超长 query，避免 SQLite LIKE 模式过大
    let truncated: String = trimmed.chars().take(200).collect();
    let normalized_query = truncated.to_lowercase();

    // 提取有意义的搜索 token；若无有效 token 则退回整句（转义后）
    let tokens = extract_search_tokens(&normalized_query);
    let effective_tokens: Vec<String> = if tokens.is_empty() {
        let escaped = escape_like_pattern(&normalized_query);
        if escaped.is_empty() {
            return Ok(Vec::new());
        }
        vec![escaped]
    } else {
        tokens.iter().map(|t| escape_like_pattern(t)).collect()
    };

    // 构建动态 OR WHERE 子句：每个 token 对应 3 个 LIKE 条件
    let mut or_clauses = String::new();
    let mut param_index: usize = 2; // ?1 = subject_code, ?2.. = tokens
    for (i, _token) in effective_tokens.iter().enumerate() {
        if i > 0 {
            or_clauses.push_str(" OR ");
        }
        or_clauses.push_str(&format!(
            "LOWER(c.text) LIKE '%' || ?{idx} || '%' ESCAPE '\\'",
            idx = param_index
        ));
        or_clauses.push_str(&format!(
            " OR LOWER(c.heading) LIKE '%' || ?{idx} || '%' ESCAPE '\\'",
            idx = param_index
        ));
        or_clauses.push_str(&format!(
            " OR LOWER(d.title) LIKE '%' || ?{idx} || '%' ESCAPE '\\'",
            idx = param_index
        ));
        param_index += 1;
    }

    // 构建 ORDER BY 中的 heading 匹配条件（任一 token 命中 heading 即优先）
    let mut heading_order_clauses = String::new();
    for (offset, _token) in effective_tokens.iter().enumerate() {
        if offset > 0 {
            heading_order_clauses.push_str(" OR ");
        }
        heading_order_clauses.push_str(&format!(
            "LOWER(c.heading) LIKE '%' || ?{idx} || '%' ESCAPE '\\'",
            idx = 2 + offset
        ));
    }

    let sql = format!(
        "SELECT
           c.id, c.document_id, c.heading, c.text,
           d.title, d.file_name
         FROM private_document_chunks c
         JOIN private_documents d ON d.id = c.document_id
         WHERE d.subject_code = ?1
           AND ({or_clauses})
         ORDER BY
           CASE WHEN ({heading_order_clauses}) THEN 0 ELSE 1 END,
           LENGTH(c.text) ASC
         LIMIT ?{limit_idx}",
        or_clauses = or_clauses,
        heading_order_clauses = heading_order_clauses,
        limit_idx = param_index,
    );

    let mut statement = connection
        .prepare(&sql)
        .map_err(|error| format!("failed to prepare search_private_chunks: {error}"))?;

    // 构建参数列表：subject_code + tokens + limit
    let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
    param_values.push(Box::new(subject_code.to_string()));
    for token in &effective_tokens {
        param_values.push(Box::new(token.clone()));
    }
    param_values.push(Box::new(limit));

    let param_refs: Vec<&dyn rusqlite::types::ToSql> =
        param_values.iter().map(|p| p.as_ref()).collect();

    let tokens_for_scoring = effective_tokens.clone();
    let rows = statement
        .query_map(param_refs.as_slice(), |row| {
            let text: String = row.get(3)?;
            let heading: Option<String> = row.get(2)?;
            let title: String = row.get(4)?;
            let file_name: String = row.get(5)?;

            // 评分：每个 token 独立匹配，标题命中 +10，heading 命中 +5，文本命中按出现次数 +1
            let lower_text = text.to_lowercase();
            let lower_heading = heading.as_deref().unwrap_or("").to_lowercase();
            let lower_title = title.to_lowercase();
            let mut score: i64 = 0;
            let mut heading_hit = false;
            for token in &tokens_for_scoring {
                let token_lower = token.to_lowercase();
                let count = lower_text.matches(&token_lower).count() as i64;
                score += count;
                if !heading_hit && lower_heading.contains(&token_lower) {
                    score += 5;
                    heading_hit = true;
                }
                if lower_title.contains(&token_lower) {
                    score += 10;
                }
            }

            Ok(PrivateChunkSearchResult {
                document_id: row.get(1)?,
                document_title: title,
                file_name,
                heading,
                text,
                score,
                source_type: "private_document".to_string(),
            })
        })
        .map_err(|error| format!("failed to query search_private_chunks: {error}"))?;

    let mut results: Vec<PrivateChunkSearchResult> = rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("failed to read search_private_chunks row: {error}"))?;

    // 按 score 降序排列
    results.sort_by_key(|item| std::cmp::Reverse(item.score));

    Ok(results)
}

// ── 加载 chunks ────────────────────────────────────────────────────────────

pub(crate) fn load_private_document_chunks_with_connection(
    connection: &Connection,
    document_id: &str,
) -> Result<Vec<PrivateDocumentChunk>, String> {
    let mut statement = connection
        .prepare(
            "SELECT id, document_id, chunk_index, heading, text, token_estimate
             FROM private_document_chunks
             WHERE document_id = ?1
             ORDER BY chunk_index",
        )
        .map_err(|error| format!("failed to prepare load_chunks: {error}"))?;

    let rows = statement
        .query_map(params![document_id], |row| {
            Ok(PrivateDocumentChunk {
                id: row.get(0)?,
                document_id: row.get(1)?,
                chunk_index: row.get(2)?,
                heading: row.get(3)?,
                text: row.get(4)?,
                token_estimate: row.get(5)?,
            })
        })
        .map_err(|error| format!("failed to query chunks: {error}"))?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("failed to read chunk row: {error}"))
}

// ── UUID v7 风格 ID 生成（简化版，使用时间戳+随机） ─────────────────────────

fn uuid_v7() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let rand: u32 = rand_u32();
    format!("{ts:012x}-{rand:08x}")
}

fn rand_u32() -> u32 {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut hasher = DefaultHasher::new();
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos()
        .hash(&mut hasher);
    hasher.finish() as u32
}

// ── 测试 ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;
    use std::fs;

    fn setup_db() -> (Connection, std::path::PathBuf) {
        let db_path = std::env::temp_dir().join(format!(
            "teacher-agent-private-doc-test-{}-{}.sqlite3",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let conn = Connection::open(&db_path).unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        conn.execute_batch(include_str!("../migrations/0001_initial.sql"))
            .unwrap();
        conn.execute_batch(include_str!("../migrations/0003_private_documents.sql"))
            .unwrap();
        conn.execute_batch(include_str!(
            "../migrations/0004_conversation_private_documents.sql"
        ))
        .unwrap();
        (conn, db_path)
    }

    fn cleanup(path: &std::path::Path) {
        let _ = fs::remove_file(path);
    }

    #[test]
    fn save_and_list_private_document() {
        let (mut conn, path) = setup_db();
        let input = SavePrivateDocumentInput {
            file_name: "test.pdf".to_string(),
            file_type: "pdf".to_string(),
            title: Some("测试文档".to_string()),
            subject_code: "math".to_string(),
            pages_or_sheets: vec![
                PageOrSheetInput {
                    name: "Page 1".to_string(),
                    text: "这是第一页的内容，包含一些中文文本用于测试。".to_string(),
                },
                PageOrSheetInput {
                    name: "Page 2".to_string(),
                    text: "这是第二页的内容。".to_string(),
                },
            ],
            plain_text: "这是第一页的内容。\n\n这是第二页的内容。".to_string(),
        };

        let saved = save_private_document_with_connection(&mut conn, &input).unwrap();
        assert!(!saved.id.is_empty());
        assert_eq!(saved.file_name, "test.pdf");
        assert_eq!(saved.file_type, "pdf");
        assert_eq!(saved.title, "测试文档");
        assert_eq!(saved.subject_code, "math");
        assert_eq!(saved.status, "draft");
        assert_eq!(saved.source_type, "private_user_import");
        assert!(saved.chunk_count >= 1);

        let docs = list_private_documents_with_connection(&conn, Some("math"), 10).unwrap();
        assert_eq!(docs.len(), 1);
        assert_eq!(docs[0].id, saved.id);

        drop(conn);
        cleanup(&path);
    }

    #[test]
    fn chunks_are_generated_correctly() {
        let (mut conn, path) = setup_db();
        let long_text = "测试文本。".repeat(400); // ~1600 字符 > CHUNK_TARGET_CHARS
        let input = SavePrivateDocumentInput {
            file_name: "long.pdf".to_string(),
            file_type: "pdf".to_string(),
            title: None,
            subject_code: "math".to_string(),
            pages_or_sheets: vec![PageOrSheetInput {
                name: "Page 1".to_string(),
                text: long_text.clone(),
            }],
            plain_text: long_text,
        };

        let saved = save_private_document_with_connection(&mut conn, &input).unwrap();
        assert!(saved.chunk_count >= 2, "应切分为多个 chunk");

        let chunks = load_private_document_chunks_with_connection(&conn, &saved.id).unwrap();
        assert_eq!(chunks.len() as i64, saved.chunk_count);
        assert!(chunks[0].text.chars().count() <= CHUNK_TARGET_CHARS + 100);

        drop(conn);
        cleanup(&path);
    }

    #[test]
    fn delete_hides_from_list() {
        let (mut conn, path) = setup_db();
        let input = SavePrivateDocumentInput {
            file_name: "to_delete.pdf".to_string(),
            file_type: "pdf".to_string(),
            title: None,
            subject_code: "math".to_string(),
            pages_or_sheets: vec![PageOrSheetInput {
                name: "P1".to_string(),
                text: "content".to_string(),
            }],
            plain_text: "content".to_string(),
        };

        let saved = save_private_document_with_connection(&mut conn, &input).unwrap();
        assert_eq!(
            list_private_documents_with_connection(&conn, Some("math"), 10)
                .unwrap()
                .len(),
            1
        );

        let deleted = delete_private_document_with_connection(&mut conn, &saved.id).unwrap();
        assert!(deleted);
        assert_eq!(
            list_private_documents_with_connection(&conn, Some("math"), 10)
                .unwrap()
                .len(),
            0
        );

        drop(conn);
        cleanup(&path);
    }

    #[test]
    fn does_not_store_file_path() {
        let (mut conn, path) = setup_db();
        let input = SavePrivateDocumentInput {
            file_name: "report.pdf".to_string(),
            file_type: "pdf".to_string(),
            title: Some("Report".to_string()),
            subject_code: "math".to_string(),
            pages_or_sheets: vec![],
            plain_text: "text".to_string(),
        };

        let saved = save_private_document_with_connection(&mut conn, &input).unwrap();
        // 查询 raw row 确认没有 path 字段
        let raw: String = conn
            .query_row(
                "SELECT sql FROM sqlite_master WHERE name = 'private_documents'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(
            !raw.to_lowercase().contains("path"),
            "表定义不应包含 path 字段"
        );
        // file_name 只存文件名，不含路径
        assert!(!saved.file_name.contains('\\'));
        assert!(!saved.file_name.contains('/'));

        drop(conn);
        cleanup(&path);
    }

    #[test]
    fn empty_pages_fallback_to_plain_text() {
        let (mut conn, path) = setup_db();
        let input = SavePrivateDocumentInput {
            file_name: "no_pages.pdf".to_string(),
            file_type: "pdf".to_string(),
            title: Some("No Pages".to_string()),
            subject_code: "math".to_string(),
            pages_or_sheets: vec![],
            plain_text: "这是从 plainText fallback 生成的内容，应该被正常切分为 chunk。"
                .repeat(100),
        };

        let saved = save_private_document_with_connection(&mut conn, &input).unwrap();
        assert!(
            saved.chunk_count >= 1,
            "pages 为空但 plainText 有内容时应生成 chunk"
        );

        let chunks = load_private_document_chunks_with_connection(&conn, &saved.id).unwrap();
        assert!(!chunks.is_empty());
        assert!(
            chunks[0].text.contains("plainText fallback"),
            "chunk 应包含 plainText 内容"
        );
        assert_eq!(
            chunks[0].heading.as_deref(),
            Some("全文"),
            "fallback chunk heading 应为 '全文'"
        );

        drop(conn);
        cleanup(&path);
    }

    #[test]
    fn empty_document_is_rejected() {
        let (mut conn, path) = setup_db();
        let input = SavePrivateDocumentInput {
            file_name: "empty.pdf".to_string(),
            file_type: "pdf".to_string(),
            title: None,
            subject_code: "math".to_string(),
            pages_or_sheets: vec![],
            plain_text: "".to_string(),
        };

        let result = save_private_document_with_connection(&mut conn, &input);
        assert!(result.is_err(), "pages 和 plainText 都为空时应拒绝保存");
        assert!(result.unwrap_err().contains("空"), "错误信息应说明文档为空");

        drop(conn);
        cleanup(&path);
    }

    #[test]
    fn deleted_document_chunks_not_loadable() {
        let (mut conn, path) = setup_db();
        let input = SavePrivateDocumentInput {
            file_name: "deleteme.pdf".to_string(),
            file_type: "pdf".to_string(),
            title: None,
            subject_code: "math".to_string(),
            pages_or_sheets: vec![PageOrSheetInput {
                name: "P1".to_string(),
                text: "secret content".to_string(),
            }],
            plain_text: "secret content".to_string(),
        };

        let saved = save_private_document_with_connection(&mut conn, &input).unwrap();
        // 删除前可以加载
        let chunks = load_private_document_chunks_with_connection(&conn, &saved.id).unwrap();
        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0].text, "secret content");

        // 彻底删除
        delete_private_document_with_connection(&mut conn, &saved.id).unwrap();

        // 删除后 load chunks 应返回空（chunks 已物理删除）
        let chunks_after = load_private_document_chunks_with_connection(&conn, &saved.id).unwrap();
        assert!(
            chunks_after.is_empty(),
            "彻底删除后 load chunks 应返回空，chunks 已物理删除"
        );

        // 文档记录也已物理删除
        let doc_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM private_documents WHERE id = ?1",
                params![saved.id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(doc_count, 0, "彻底删除后文档记录也应不存在");

        drop(conn);
        cleanup(&path);
    }

    #[test]
    fn empty_document_does_not_leave_residue() {
        // 验证空文档预校验失败时不会留下残留记录
        let (mut conn, path) = setup_db();

        // 先保存一个正常文档确认 baseline
        let normal = SavePrivateDocumentInput {
            file_name: "ok.pdf".to_string(),
            file_type: "pdf".to_string(),
            title: None,
            subject_code: "math".to_string(),
            pages_or_sheets: vec![PageOrSheetInput {
                name: "P1".to_string(),
                text: "ok".to_string(),
            }],
            plain_text: "ok".to_string(),
        };
        save_private_document_with_connection(&mut conn, &normal).unwrap();

        // 保存空文档应失败且不留下记录
        let empty = SavePrivateDocumentInput {
            file_name: "empty.pdf".to_string(),
            file_type: "pdf".to_string(),
            title: None,
            subject_code: "math".to_string(),
            pages_or_sheets: vec![],
            plain_text: "".to_string(),
        };
        let result = save_private_document_with_connection(&mut conn, &empty);
        assert!(result.is_err());

        // 确认只有 1 条记录（之前那个正常的），空文档没有残留
        let docs = list_private_documents_with_connection(&conn, Some("math"), 10).unwrap();
        assert_eq!(docs.len(), 1, "预校验失败后不应有残留的文档记录");
        assert_eq!(docs[0].file_name, "ok.pdf");

        drop(conn);
        cleanup(&path);
    }

    #[test]
    fn transaction_rollback_on_chunk_failure() {
        // 真正的事务回滚测试：document 插入成功后，chunk INSERT 因 NOT NULL 约束失败。
        // Transaction 未 commit 时离开作用域，应自动回滚 document。
        let (mut conn, path) = setup_db();

        let doc_id = "privdoc-test-rollback";
        let now = "2026-01-01T00:00:00.000Z";

        // 事务外先插入一个基线 document，确认失败事务不会影响已有数据。
        conn.execute(
            "INSERT INTO private_documents (
               id, student_id, subject_code, file_name, file_type, title,
               source_type, status, chunk_count, created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'private_user_import', 'draft', 1, ?7, ?7)",
            params![
                doc_id,
                DEFAULT_STUDENT_ID,
                "math",
                "first.pdf",
                "pdf",
                "First",
                now,
            ],
        )
        .unwrap();

        {
            let tx = conn.transaction().unwrap();
            tx.execute(
                "INSERT INTO private_documents (
                   id, student_id, subject_code, file_name, file_type, title,
                   source_type, status, chunk_count, created_at, updated_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'private_user_import', 'draft', 1, ?7, ?7)",
                params![
                    "privdoc-test-rollback-2",
                    DEFAULT_STUDENT_ID,
                    "math",
                    "second.pdf",
                    "pdf",
                    "Second",
                    now,
                ],
            )
            .unwrap();

            let chunk_result = tx.execute(
                "INSERT INTO private_document_chunks (
                   id, document_id, chunk_index, heading, text, token_estimate, created_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    "privchunk-test-rollback-1",
                    "privdoc-test-rollback-2",
                    0,
                    "P1",
                    Option::<String>::None,
                    1,
                    now,
                ],
            );
            assert!(
                chunk_result.is_err(),
                "chunk text 为 NULL 时应触发 NOT NULL 约束失败"
            );
        }

        // 验证第二个 document 没有被持久化（事务未 commit，离开作用域后回滚）
        let doc_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM private_documents WHERE id = ?1",
                params!["privdoc-test-rollback-2"],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(doc_count, 0, "事务回滚后 document 记录不应存在");

        // 第一个 document 仍然存在
        let first_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM private_documents WHERE id = ?1",
                params![doc_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(first_count, 1, "事务外的 document 应仍然存在");

        drop(conn);
        cleanup(&path);
    }

    #[test]
    fn search_private_chunks_finds_matching_text() {
        let (mut conn, path) = setup_db();

        // 保存一个包含特定关键词的文档
        let input = SavePrivateDocumentInput {
            file_name: "calculus.pdf".to_string(),
            file_type: "pdf".to_string(),
            title: Some("微积分笔记".to_string()),
            subject_code: "math".to_string(),
            pages_or_sheets: vec![
                PageOrSheetInput {
                    name: "Page 1".to_string(),
                    text: "极限的定义：当 x 趋近于 a 时，f(x) 的极限为 L。".to_string(),
                },
                PageOrSheetInput {
                    name: "Page 2".to_string(),
                    text: "导数的定义：f'(x) = lim(h->0) [f(x+h)-f(x)]/h".to_string(),
                },
            ],
            plain_text: "极限和导数".to_string(),
        };
        save_private_document_with_connection(&mut conn, &input).unwrap();

        // 搜索 "极限"
        let results = search_private_chunks_with_connection(&conn, "极限", "math", 5).unwrap();
        assert!(!results.is_empty(), "应找到包含'极限'的 chunk");
        assert!(results[0].text.contains("极限"));
        assert_eq!(results[0].source_type, "private_document");
        assert!(!results[0].file_name.contains('\\'));

        // 搜索不存在的关键词
        let no_results =
            search_private_chunks_with_connection(&conn, "量子力学", "math", 5).unwrap();
        assert!(no_results.is_empty(), "不应找到'量子力学'相关内容");

        // 搜索其他学科应返回空
        let wrong_subject =
            search_private_chunks_with_connection(&conn, "极限", "english", 5).unwrap();
        assert!(
            wrong_subject.is_empty(),
            "学科隔离：math 文档不应出现在 english 搜索中"
        );

        drop(conn);
        cleanup(&path);
    }

    #[test]
    fn search_excludes_deleted_documents() {
        let (mut conn, path) = setup_db();

        let input = SavePrivateDocumentInput {
            file_name: "temp.pdf".to_string(),
            file_type: "pdf".to_string(),
            title: Some("临时文档".to_string()),
            subject_code: "math".to_string(),
            pages_or_sheets: vec![PageOrSheetInput {
                name: "P1".to_string(),
                text: "这是一个临时文档，包含特殊关键词：超导体。".to_string(),
            }],
            plain_text: "超导体".to_string(),
        };
        let saved = save_private_document_with_connection(&mut conn, &input).unwrap();

        // 删除前可以搜到
        let before = search_private_chunks_with_connection(&conn, "超导体", "math", 5).unwrap();
        assert_eq!(before.len(), 1);

        // 删除文档
        delete_private_document_with_connection(&mut conn, &saved.id).unwrap();

        // 删除后搜不到
        let after = search_private_chunks_with_connection(&conn, "超导体", "math", 5).unwrap();
        assert!(after.is_empty(), "已删除文档的 chunks 不应被搜索到");

        drop(conn);
        cleanup(&path);
    }

    #[test]
    fn subject_code_isolation() {
        let (mut conn, path) = setup_db();

        let math_input = SavePrivateDocumentInput {
            file_name: "math.pdf".to_string(),
            file_type: "pdf".to_string(),
            title: None,
            subject_code: "math".to_string(),
            pages_or_sheets: vec![PageOrSheetInput {
                name: "P1".to_string(),
                text: "math".to_string(),
            }],
            plain_text: "math".to_string(),
        };
        let eng_input = SavePrivateDocumentInput {
            file_name: "english.pdf".to_string(),
            file_type: "pdf".to_string(),
            title: None,
            subject_code: "english".to_string(),
            pages_or_sheets: vec![PageOrSheetInput {
                name: "P1".to_string(),
                text: "english".to_string(),
            }],
            plain_text: "english".to_string(),
        };

        save_private_document_with_connection(&mut conn, &math_input).unwrap();
        save_private_document_with_connection(&mut conn, &eng_input).unwrap();

        let math_docs = list_private_documents_with_connection(&conn, Some("math"), 10).unwrap();
        let eng_docs = list_private_documents_with_connection(&conn, Some("english"), 10).unwrap();
        let all_docs = list_private_documents_with_connection(&conn, None, 10).unwrap();

        assert_eq!(math_docs.len(), 1);
        assert_eq!(math_docs[0].subject_code, "math");
        assert_eq!(eng_docs.len(), 1);
        assert_eq!(eng_docs[0].subject_code, "english");
        assert_eq!(all_docs.len(), 2);

        drop(conn);
        cleanup(&path);
    }

    // ── 边界保护测试 ──────────────────────────────────────────────────────────

    #[test]
    fn list_negative_limit_clamped_to_one() {
        let (mut conn, path) = setup_db();
        let input = SavePrivateDocumentInput {
            file_name: "test.pdf".to_string(),
            file_type: "pdf".to_string(),
            title: None,
            subject_code: "math".to_string(),
            pages_or_sheets: vec![PageOrSheetInput {
                name: "P1".to_string(),
                text: "content".to_string(),
            }],
            plain_text: "content".to_string(),
        };
        save_private_document_with_connection(&mut conn, &input).unwrap();

        // 负数 limit 应被 clamp 到 1，不会返回无限结果
        let docs = list_private_documents_with_connection(&conn, Some("math"), -5).unwrap();
        assert!(docs.len() <= 1, "负数 limit 应被 clamp 到 1");

        drop(conn);
        cleanup(&path);
    }

    #[test]
    fn list_huge_limit_clamped_to_100() {
        let (conn, path) = setup_db();

        // 即使传入巨大 limit，也不会导致异常
        let docs = list_private_documents_with_connection(&conn, Some("math"), 99999).unwrap();
        assert!(docs.len() <= 100, "巨大 limit 应被 clamp 到 100");

        drop(conn);
        cleanup(&path);
    }

    #[test]
    fn search_negative_limit_clamped_to_one() {
        let (mut conn, path) = setup_db();
        let input = SavePrivateDocumentInput {
            file_name: "test.pdf".to_string(),
            file_type: "pdf".to_string(),
            title: Some("测试".to_string()),
            subject_code: "math".to_string(),
            pages_or_sheets: vec![PageOrSheetInput {
                name: "P1".to_string(),
                text: "极限定义".to_string(),
            }],
            plain_text: "极限定义".to_string(),
        };
        save_private_document_with_connection(&mut conn, &input).unwrap();

        // 负数 limit 应被 clamp 到 1
        let results = search_private_chunks_with_connection(&conn, "极限", "math", -1).unwrap();
        assert!(results.len() <= 1, "负数 limit 应被 clamp 到 1");

        drop(conn);
        cleanup(&path);
    }

    #[test]
    fn search_huge_limit_clamped_to_10() {
        let (mut conn, path) = setup_db();
        let input = SavePrivateDocumentInput {
            file_name: "test.pdf".to_string(),
            file_type: "pdf".to_string(),
            title: Some("测试".to_string()),
            subject_code: "math".to_string(),
            pages_or_sheets: vec![PageOrSheetInput {
                name: "P1".to_string(),
                text: "极限定义".to_string(),
            }],
            plain_text: "极限定义".to_string(),
        };
        save_private_document_with_connection(&mut conn, &input).unwrap();

        // 巨大 limit 应被 clamp 到 10
        let results = search_private_chunks_with_connection(&conn, "极限", "math", 500).unwrap();
        assert!(results.len() <= 10, "巨大 limit 应被 clamp 到 10");

        drop(conn);
        cleanup(&path);
    }

    #[test]
    fn search_empty_query_returns_empty() {
        let (mut conn, path) = setup_db();
        let input = SavePrivateDocumentInput {
            file_name: "test.pdf".to_string(),
            file_type: "pdf".to_string(),
            title: Some("测试".to_string()),
            subject_code: "math".to_string(),
            pages_or_sheets: vec![PageOrSheetInput {
                name: "P1".to_string(),
                text: "极限定义".to_string(),
            }],
            plain_text: "极限定义".to_string(),
        };
        save_private_document_with_connection(&mut conn, &input).unwrap();

        // 空 query 应返回空
        assert!(search_private_chunks_with_connection(&conn, "", "math", 5)
            .unwrap()
            .is_empty());
        assert!(
            search_private_chunks_with_connection(&conn, "   ", "math", 5)
                .unwrap()
                .is_empty()
        );

        drop(conn);
        cleanup(&path);
    }

    #[test]
    fn search_overlong_query_truncated() {
        let (mut conn, path) = setup_db();
        let input = SavePrivateDocumentInput {
            file_name: "test.pdf".to_string(),
            file_type: "pdf".to_string(),
            title: Some("测试".to_string()),
            subject_code: "math".to_string(),
            pages_or_sheets: vec![PageOrSheetInput {
                name: "P1".to_string(),
                text: "极限定义".to_string(),
            }],
            plain_text: "极限定义".to_string(),
        };
        save_private_document_with_connection(&mut conn, &input).unwrap();

        // 超长 query 不应导致异常，应被截断
        let long_query = "a".repeat(500);
        let results = search_private_chunks_with_connection(&conn, &long_query, "math", 5).unwrap();
        // 不匹配任何内容，但不应 panic 或报错
        assert!(results.is_empty());

        drop(conn);
        cleanup(&path);
    }

    // ── 会话级资料绑定测试 ────────────────────────────────────────────────

    /// 创建一个测试会话（需要 students 和 subjects 前置数据）。
    fn ensure_test_conversation(conn: &Connection, conversation_id: &str) {
        conn.execute(
            "INSERT OR IGNORE INTO students (id, display_name, stage, preferences_json, created_at, updated_at)
             VALUES (?1, 'Test', 'college', '{}', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
            [DEFAULT_STUDENT_ID],
        ).unwrap();
        conn.execute(
            "INSERT OR IGNORE INTO subjects (id, name, code, style_key, created_at, updated_at)
             VALUES ('subject-math', '数学', 'math', 'rigorous_patient', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
            [],
        ).unwrap();
        conn.execute(
            "INSERT OR IGNORE INTO conversations (id, student_id, subject_id, title, status, created_at, updated_at)
             VALUES (?1, ?2, 'subject-math', '测试会话', 'active', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
            params![conversation_id, DEFAULT_STUDENT_ID],
        ).unwrap();
    }

    /// 创建一个测试私有文档，返回 id。
    fn create_test_document(conn: &mut Connection, name: &str) -> String {
        let input = SavePrivateDocumentInput {
            file_name: format!("{name}.pdf"),
            file_type: "pdf".to_string(),
            title: Some(name.to_string()),
            subject_code: "math".to_string(),
            pages_or_sheets: vec![PageOrSheetInput {
                name: "P1".to_string(),
                text: "test content".to_string(),
            }],
            plain_text: "test content".to_string(),
        };
        save_private_document_with_connection(conn, &input)
            .unwrap()
            .id
    }

    #[test]
    fn bind_and_load_conversation_private_document() {
        let (mut conn, path) = setup_db();
        ensure_test_conversation(&conn, "conv-1");
        let doc_id = create_test_document(&mut conn, "doc-A");

        // 初始无绑定
        assert!(load_conversation_private_document_id(&conn, "conv-1")
            .unwrap()
            .is_none());

        // 绑定
        bind_private_document_to_conversation(&conn, "conv-1", &doc_id).unwrap();
        let loaded = load_conversation_private_document_id(&conn, "conv-1").unwrap();
        assert_eq!(loaded.as_deref(), Some(doc_id.as_str()));

        drop(conn);
        cleanup(&path);
    }

    #[test]
    fn bind_replaces_existing() {
        let (mut conn, path) = setup_db();
        ensure_test_conversation(&conn, "conv-1");
        let doc_a = create_test_document(&mut conn, "doc-A");
        let doc_b = create_test_document(&mut conn, "doc-B");

        bind_private_document_to_conversation(&conn, "conv-1", &doc_a).unwrap();
        assert_eq!(
            load_conversation_private_document_id(&conn, "conv-1")
                .unwrap()
                .as_deref(),
            Some(doc_a.as_str())
        );

        // 覆盖绑定
        bind_private_document_to_conversation(&conn, "conv-1", &doc_b).unwrap();
        assert_eq!(
            load_conversation_private_document_id(&conn, "conv-1")
                .unwrap()
                .as_deref(),
            Some(doc_b.as_str())
        );

        drop(conn);
        cleanup(&path);
    }

    #[test]
    fn clear_private_document_binding_works() {
        let (mut conn, path) = setup_db();
        ensure_test_conversation(&conn, "conv-1");
        let doc_id = create_test_document(&mut conn, "doc-A");

        bind_private_document_to_conversation(&conn, "conv-1", &doc_id).unwrap();
        assert!(load_conversation_private_document_id(&conn, "conv-1")
            .unwrap()
            .is_some());

        let cleared = clear_private_document_binding(&conn, "conv-1").unwrap();
        assert!(cleared);
        assert!(load_conversation_private_document_id(&conn, "conv-1")
            .unwrap()
            .is_none());

        // 再次清除应返回 false
        let cleared_again = clear_private_document_binding(&conn, "conv-1").unwrap();
        assert!(!cleared_again);

        drop(conn);
        cleanup(&path);
    }

    #[test]
    fn delete_document_clears_all_bindings() {
        let (mut conn, path) = setup_db();
        ensure_test_conversation(&conn, "conv-1");
        ensure_test_conversation(&conn, "conv-2");
        let doc_id = create_test_document(&mut conn, "shared-doc");

        // 两个会话绑定同一资料
        bind_private_document_to_conversation(&conn, "conv-1", &doc_id).unwrap();
        bind_private_document_to_conversation(&conn, "conv-2", &doc_id).unwrap();

        // 删除资料时应同步清理所有绑定
        let deleted = delete_private_document_with_connection(&mut conn, &doc_id).unwrap();
        assert!(deleted);

        assert!(load_conversation_private_document_id(&conn, "conv-1")
            .unwrap()
            .is_none());
        assert!(load_conversation_private_document_id(&conn, "conv-2")
            .unwrap()
            .is_none());

        drop(conn);
        cleanup(&path);
    }

    #[test]
    fn bind_rejects_cross_subject_document() {
        let (mut conn, path) = setup_db();
        // 创建数学会话和政治资料——应被拒绝
        ensure_test_conversation(&conn, "conv-math");
        conn.execute(
            "INSERT OR IGNORE INTO subjects (id, name, code, style_key, created_at, updated_at)
             VALUES ('subject-politics', '政治', 'politics', 'structured_exam_coach', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
            [],
        ).unwrap();
        conn.execute(
            "INSERT OR IGNORE INTO conversations (id, student_id, subject_id, title, status, created_at, updated_at)
             VALUES ('conv-politics', ?1, 'subject-politics', '政治会话', 'active', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
            [DEFAULT_STUDENT_ID],
        ).unwrap();

        let input = SavePrivateDocumentInput {
            file_name: "politics.pdf".to_string(),
            file_type: "pdf".to_string(),
            title: Some("政治资料".to_string()),
            subject_code: "politics".to_string(),
            pages_or_sheets: vec![PageOrSheetInput {
                name: "P1".to_string(),
                text: "content".to_string(),
            }],
            plain_text: "content".to_string(),
        };
        let doc_id = save_private_document_with_connection(&mut conn, &input)
            .unwrap()
            .id;

        // 数学会话绑定政治资料——应失败
        let result = bind_private_document_to_conversation(&conn, "conv-math", &doc_id);
        assert!(result.is_err(), "cross-subject bind should be rejected");

        // 政治会话绑定政治资料——应成功
        bind_private_document_to_conversation(&conn, "conv-politics", &doc_id).unwrap();
        assert_eq!(
            load_conversation_private_document_id(&conn, "conv-politics")
                .unwrap()
                .as_deref(),
            Some(doc_id.as_str())
        );

        drop(conn);
        cleanup(&path);
    }

    #[test]
    fn bind_rejects_deleted_conversation() {
        let (mut conn, path) = setup_db();
        ensure_test_conversation(&conn, "conv-1");
        let doc_id = create_test_document(&mut conn, "doc-A");

        // 软删除会话
        conn.execute(
            "UPDATE conversations SET deleted_at = '2026-01-02T00:00:00Z' WHERE id = 'conv-1'",
            [],
        )
        .unwrap();

        let result = bind_private_document_to_conversation(&conn, "conv-1", &doc_id);
        assert!(
            result.is_err(),
            "bind to deleted conversation should be rejected"
        );

        drop(conn);
        cleanup(&path);
    }
}
