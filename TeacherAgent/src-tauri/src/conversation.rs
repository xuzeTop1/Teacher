use crate::models::{LocalConversation, SaveMessageInput, StoredMessage};
use crate::shared::resolve_subject_id_detailed;
use crate::{
    current_timestamp, is_custom_subject_code, normalize_subject_code,
    subject_code_from_subject_id, subject_name, subject_style_key, truncate_for_storage,
    DEFAULT_STUDENT_ID, DEFAULT_STUDENT_NAME,
};
use rusqlite::{params, Connection, OptionalExtension};

pub(crate) fn ensure_default_conversation_with_connection(
    connection: &Connection,
    subject_code: &str,
) -> Result<LocalConversation, String> {
    let normalized_subject = normalize_subject_code(subject_code)?;
    let conversation_id = format!("local-default-conversation-{normalized_subject}");

    // Look up existing subject by code to use real id/name.
    let (subject_id, resolved_name) = match resolve_subject_id_detailed(
        connection,
        &normalized_subject,
    )? {
        Some(existing_id) => {
            // Subject already exists — read its real name.
            let name: String = connection
                .query_row(
                    "SELECT name FROM subjects WHERE code = ?1",
                    params![normalized_subject],
                    |row| row.get(0),
                )
                .map_err(|error| {
                    format!("failed to read subject metadata for '{normalized_subject}': {error}")
                })?;
            (existing_id, name)
        }
        None => {
            // Subject does not exist yet.
            if is_custom_subject_code(&normalized_subject) {
                // Custom subjects must be created via create_custom_subject first.
                return Err(format!(
                        "Custom subject '{normalized_subject}' does not exist. Create it via the custom subject builder first."
                    ));
            }
            // Built-in subject: create with standard prefix.
            let new_id = format!("subject-{normalized_subject}");
            let name = subject_name(&normalized_subject).to_string();
            let style = subject_style_key(&normalized_subject).to_string();
            connection
                    .execute(
                        "INSERT OR IGNORE INTO subjects (
                           id, name, code, style_key, created_at, updated_at
                         )
                         VALUES (?1, ?2, ?3, ?4, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
                        params![new_id, name, normalized_subject, style],
                    )
                    .map_err(|error| format!("failed to ensure subject: {error}"))?;
            (new_id, name)
        }
    };

    connection
        .execute(
            "INSERT OR IGNORE INTO students (
               id, display_name, stage, preferences_json, created_at, updated_at
             )
             VALUES (?1, ?2, 'college', '{}', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
            params![DEFAULT_STUDENT_ID, DEFAULT_STUDENT_NAME],
        )
        .map_err(|error| format!("failed to ensure default student: {error}"))?;
    connection
        .execute(
            "INSERT OR IGNORE INTO conversations (
               id, student_id, subject_id, title, summary, status, created_at, updated_at
             )
             VALUES (?1, ?2, ?3, ?4, '', 'active', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
            params![
                conversation_id,
                DEFAULT_STUDENT_ID,
                subject_id,
                format!("{}默认对话", resolved_name)
            ],
        )
        .map_err(|error| format!("failed to ensure default conversation: {error}"))?;

    // Revive if soft-deleted: restore status to active and clear deleted_at
    let default_title = format!("{}默认对话", resolved_name);
    let revived = connection
        .execute(
            "UPDATE conversations
             SET deleted_at = NULL,
                 status = 'active',
                 title = CASE WHEN title = '' OR title IS NULL THEN ?1 ELSE title END,
                 updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
             WHERE id = ?2 AND deleted_at IS NOT NULL",
            params![default_title, conversation_id],
        )
        .map_err(|error| format!("failed to revive default conversation: {error}"))?;

    // 如果 revive 成功，清除旧的资料绑定（删除时可能未清理的残留）
    if revived > 0 {
        connection
            .execute(
                "DELETE FROM conversation_private_documents WHERE conversation_id = ?1",
                params![conversation_id],
            )
            .map_err(|error| format!("failed to clear stale binding on revive: {error}"))?;
    }

    load_conversation(connection, &conversation_id)?
        .ok_or_else(|| "default conversation could not be loaded".to_string())
}

pub(crate) fn list_conversations_with_connection(
    connection: &Connection,
    subject_code: &str,
    limit: i64,
    status: Option<&str>,
) -> Result<Vec<LocalConversation>, String> {
    let normalized_subject = normalize_subject_code(subject_code)?;
    let bounded_limit = limit.clamp(1, 100);
    let status_filter = status.unwrap_or("active");

    let sql = "SELECT c.student_id, c.subject_id, c.id, COALESCE(s.code, ''),
                      c.title, c.status, c.created_at, c.updated_at
               FROM conversations c
               LEFT JOIN subjects s ON s.id = c.subject_id
               WHERE c.student_id = ?1
                 AND c.deleted_at IS NULL
                 AND c.status = ?2
                 AND (s.code = ?3 OR c.subject_id = ?4)
               ORDER BY c.updated_at DESC, c.created_at DESC, c.rowid DESC
               LIMIT ?5";

    let mut statement = connection
        .prepare(sql)
        .map_err(|error| format!("failed to prepare conversation list query: {error}"))?;
    // Subject doesn't exist → empty id; query will match no rows via s.code.
    let subject_id = resolve_subject_id_detailed(connection, subject_code)?.unwrap_or_default();
    let rows = statement
        .query_map(
            params![
                DEFAULT_STUDENT_ID,
                status_filter,
                normalized_subject,
                subject_id,
                bounded_limit
            ],
            row_to_local_conversation,
        )
        .map_err(|error| format!("failed to query conversations: {error}"))?;
    let mut conversations = Vec::new();

    for row in rows {
        conversations
            .push(row.map_err(|error| format!("failed to read conversation row: {error}"))?);
    }

    Ok(conversations)
}

pub(crate) fn archive_conversation_with_connection(
    connection: &Connection,
    conversation_id: &str,
) -> Result<LocalConversation, String> {
    let affected = connection
        .execute(
            "UPDATE conversations SET status = 'archived',
                     updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
             WHERE id = ?1 AND deleted_at IS NULL AND status = 'active'",
            params![conversation_id],
        )
        .map_err(|error| format!("failed to archive conversation: {error}"))?;

    if affected == 0 {
        return Err("conversation not found or already archived".to_string());
    }

    load_conversation(connection, conversation_id)?
        .ok_or_else(|| "archived conversation could not be loaded".to_string())
}

pub(crate) fn unarchive_conversation_with_connection(
    connection: &Connection,
    conversation_id: &str,
) -> Result<LocalConversation, String> {
    let affected = connection
        .execute(
            "UPDATE conversations SET status = 'active',
                     updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
             WHERE id = ?1 AND deleted_at IS NULL AND status = 'archived'",
            params![conversation_id],
        )
        .map_err(|error| format!("failed to unarchive conversation: {error}"))?;

    if affected == 0 {
        return Err("conversation not found or not archived".to_string());
    }

    load_conversation(connection, conversation_id)?
        .ok_or_else(|| "unarchived conversation could not be loaded".to_string())
}

pub(crate) fn soft_delete_conversation_with_connection(
    connection: &Connection,
    conversation_id: &str,
) -> Result<(), String> {
    let affected = connection
        .execute(
            "UPDATE conversations SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
                     updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
             WHERE id = ?1 AND deleted_at IS NULL",
            params![conversation_id],
        )
        .map_err(|error| format!("failed to delete conversation: {error}"))?;

    if affected == 0 {
        return Err("conversation not found or already deleted".to_string());
    }

    // 清理该会话的资料绑定，避免 revive 时带回旧绑定
    connection
        .execute(
            "DELETE FROM conversation_private_documents WHERE conversation_id = ?1",
            params![conversation_id],
        )
        .map_err(|error| format!("failed to clear document binding on delete: {error}"))?;

    Ok(())
}

pub(crate) fn create_conversation_with_connection(
    connection: &Connection,
    subject_code: &str,
    title: Option<String>,
) -> Result<LocalConversation, String> {
    let default_conversation =
        ensure_default_conversation_with_connection(connection, subject_code)?;
    let normalized_subject = default_conversation.subject_code;
    let subject_id = default_conversation.subject_id;
    let conversation_id = create_conversation_id(connection, &normalized_subject)?;
    let title = normalize_conversation_title(title.as_deref(), subject_name(&normalized_subject));

    connection
        .execute(
            "INSERT INTO conversations (
               id, student_id, subject_id, title, summary, status, created_at, updated_at
             )
             VALUES (?1, ?2, ?3, ?4, '', 'active',
                     strftime('%Y-%m-%dT%H:%M:%fZ','now'),
                     strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
            params![conversation_id, DEFAULT_STUDENT_ID, subject_id, title],
        )
        .map_err(|error| format!("failed to create conversation: {error}"))?;

    load_conversation(connection, &conversation_id)?
        .ok_or_else(|| "created conversation could not be loaded".to_string())
}

pub(crate) fn update_conversation_title_with_connection(
    connection: &Connection,
    conversation_id: &str,
    title: &str,
) -> Result<LocalConversation, String> {
    let trimmed_title = title.trim();

    if trimmed_title.is_empty() {
        return Err("conversation title cannot be empty".to_string());
    }

    let normalized_title = truncate_for_storage(trimmed_title, 80);
    let affected = connection
        .execute(
            "UPDATE conversations
             SET title = ?1,
                 updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
             WHERE id = ?2 AND deleted_at IS NULL",
            params![normalized_title, conversation_id],
        )
        .map_err(|error| format!("failed to update conversation title: {error}"))?;

    if affected == 0 {
        return Err("conversation not found".to_string());
    }

    load_conversation(connection, conversation_id)?
        .ok_or_else(|| "updated conversation could not be loaded".to_string())
}

pub(crate) fn save_message_with_connection(
    connection: &Connection,
    input: SaveMessageInput,
) -> Result<StoredMessage, String> {
    let content_format = input
        .content_format
        .unwrap_or_else(|| "markdown".to_string());
    let created_at = input
        .created_at
        .unwrap_or_else(|| current_timestamp(connection).unwrap_or_else(|_| "unknown".to_string()));

    connection
        .execute(
            "INSERT INTO messages (
               id, conversation_id, role, content, content_format, knowledge_refs_json,
               tool_refs_json, guardrail_json, created_at, attachments_json
             )
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
             ON CONFLICT(id) DO UPDATE SET
               content = excluded.content,
               content_format = excluded.content_format,
               knowledge_refs_json = excluded.knowledge_refs_json,
               tool_refs_json = excluded.tool_refs_json,
               guardrail_json = excluded.guardrail_json,
               attachments_json = excluded.attachments_json",
            params![
                &input.id,
                &input.conversation_id,
                &input.role,
                &input.content,
                &content_format,
                input.knowledge_refs_json.as_deref().unwrap_or("[]"),
                input.tool_refs_json.as_deref().unwrap_or("[]"),
                input.guardrail_json.as_deref().unwrap_or("{}"),
                &created_at,
                input.attachments_json.as_deref().unwrap_or("[]")
            ],
        )
        .map_err(|error| format!("failed to save message: {error}"))?;
    connection
        .execute(
            "UPDATE conversations
             SET updated_at = ?1
             WHERE id = ?2 AND deleted_at IS NULL",
            params![&created_at, &input.conversation_id],
        )
        .map_err(|error| format!("failed to update conversation timestamp: {error}"))?;

    load_message(connection, &input.id)?
        .ok_or_else(|| "saved message could not be loaded".to_string())
}

pub(crate) fn list_messages_with_connection(
    connection: &Connection,
    conversation_id: &str,
    limit: i64,
) -> Result<Vec<StoredMessage>, String> {
    let bounded_limit = limit.clamp(1, 500);
    let mut statement = connection
        .prepare(
            "SELECT id, conversation_id, role, content, content_format,
                    knowledge_refs_json, tool_refs_json, guardrail_json, created_at, attachments_json
             FROM messages
             WHERE conversation_id = ?1
             ORDER BY created_at ASC, rowid ASC
             LIMIT ?2",
        )
        .map_err(|error| format!("failed to prepare message list query: {error}"))?;
    let rows = statement
        .query_map(
            params![conversation_id, bounded_limit],
            row_to_stored_message,
        )
        .map_err(|error| format!("failed to query messages: {error}"))?;
    let mut messages = Vec::new();

    for row in rows {
        messages.push(row.map_err(|error| format!("failed to read message row: {error}"))?);
    }

    Ok(messages)
}

fn load_conversation(
    connection: &Connection,
    conversation_id: &str,
) -> Result<Option<LocalConversation>, String> {
    connection
        .query_row(
            "SELECT c.student_id, c.subject_id, c.id, COALESCE(s.code, ''),
                    c.title, c.status, c.created_at, c.updated_at
             FROM conversations c
             LEFT JOIN subjects s ON s.id = c.subject_id
             WHERE c.id = ?1 AND c.deleted_at IS NULL",
            [conversation_id],
            row_to_local_conversation,
        )
        .optional()
        .map_err(|error| format!("failed to load conversation: {error}"))
}

fn load_message(
    connection: &Connection,
    message_id: &str,
) -> Result<Option<StoredMessage>, String> {
    connection
        .query_row(
            "SELECT id, conversation_id, role, content, content_format,
                    knowledge_refs_json, tool_refs_json, guardrail_json, created_at, attachments_json
             FROM messages
             WHERE id = ?1",
            [message_id],
            row_to_stored_message,
        )
        .optional()
        .map_err(|error| format!("failed to load message: {error}"))
}

fn row_to_stored_message(row: &rusqlite::Row<'_>) -> rusqlite::Result<StoredMessage> {
    Ok(StoredMessage {
        id: row.get(0)?,
        conversation_id: row.get(1)?,
        role: row.get(2)?,
        content: row.get(3)?,
        content_format: row.get(4)?,
        knowledge_refs_json: row.get(5)?,
        tool_refs_json: row.get(6)?,
        guardrail_json: row.get(7)?,
        created_at: row.get(8)?,
        attachments_json: row.get(9).unwrap_or_else(|_| "[]".to_string()),
    })
}

fn row_to_local_conversation(row: &rusqlite::Row<'_>) -> rusqlite::Result<LocalConversation> {
    let subject_id: String = row.get(1)?;
    let explicit_subject_code: String = row.get(3)?;
    let subject_code = if explicit_subject_code.is_empty() {
        subject_code_from_subject_id(&subject_id).ok_or_else(|| {
            rusqlite::Error::InvalidParameterName(format!(
                "conversation {0} has invalid subject_id '{subject_id}' — cannot extract subject code",
                row.get::<_, String>(2).unwrap_or_default()
            ))
        })?
    } else {
        normalize_subject_code(&explicit_subject_code).map_err(|error| {
            rusqlite::Error::InvalidParameterName(format!(
                "conversation {0} has invalid subject_code '{explicit_subject_code}': {error}",
                row.get::<_, String>(2).unwrap_or_default()
            ))
        })?
    };

    Ok(LocalConversation {
        student_id: row.get(0)?,
        subject_id,
        conversation_id: row.get(2)?,
        subject_code,
        title: row.get(4)?,
        status: row.get(5)?,
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
    })
}

pub(crate) fn validate_message_role(role: &str) -> Result<(), String> {
    match role {
        "student" | "tutor" | "system" | "tool" => Ok(()),
        _ => Err(format!("invalid message role: {role}")),
    }
}

fn normalize_conversation_title(title: Option<&str>, subject_name: &str) -> String {
    let trimmed = title.unwrap_or("").trim();

    if trimmed.is_empty() {
        format!("{subject_name}新对话")
    } else {
        truncate_for_storage(trimmed, 80)
    }
}

fn create_conversation_id(connection: &Connection, subject_code: &str) -> Result<String, String> {
    let random_suffix: String = connection
        .query_row("SELECT lower(hex(randomblob(8)))", [], |row| row.get(0))
        .map_err(|error| format!("failed to create conversation id: {error}"))?;

    Ok(format!("conversation-{subject_code}-{random_suffix}"))
}
