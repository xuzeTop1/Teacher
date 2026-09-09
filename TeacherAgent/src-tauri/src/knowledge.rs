use rusqlite::{params, params_from_iter, types::Value, Connection, OptionalExtension};
use std::collections::HashSet;

use crate::models::*;
use crate::normalize_subject_code;
use crate::shared::resolve_subject_id;

const MAX_KNOWLEDGE_NODE_IDS: usize = 200;
const MAX_KNOWLEDGE_NODE_ID_LENGTH: usize = 64;

pub(crate) fn load_student_knowledge_with_connection(
    connection: &Connection,
    student_id: &str,
    subject_code: &str,
    limit: i64,
    knowledge_node_ids: Option<&[String]>,
) -> Result<Vec<StoredStudentKnowledgeMastery>, String> {
    let normalized_subject = normalize_subject_code(subject_code)?;
    let bounded_limit = limit.clamp(1, 100);
    let normalized_node_ids = normalize_knowledge_node_ids(knowledge_node_ids)?;
    if matches!(&normalized_node_ids, Some(node_ids) if node_ids.is_empty()) {
        return Ok(Vec::new());
    }
    let mut query = "SELECT sk.knowledge_node_id, kn.title, kn.summary,
                            sk.mastery_probability, sk.attempts_count, sk.correct_count,
                            sk.last_practiced_at, sk.evidence_summary, sk.updated_at
                     FROM student_knowledge sk
                     INNER JOIN knowledge_nodes kn ON kn.id = sk.knowledge_node_id
                     INNER JOIN subjects s ON s.id = kn.subject_id
                     WHERE sk.student_id = ?1 AND s.code = ?2"
        .to_string();

    if let Some(node_ids) = &normalized_node_ids {
        let placeholders = (0..node_ids.len())
            .map(|index| format!("?{}", index + 3))
            .collect::<Vec<_>>()
            .join(", ");
        query.push_str(&format!(" AND kn.id IN ({placeholders})"));
        query.push_str(&format!(
            " ORDER BY sk.mastery_probability ASC, sk.updated_at DESC, kn.title ASC LIMIT ?{}",
            node_ids.len() + 3
        ));
    } else {
        query.push_str(
            " ORDER BY sk.mastery_probability ASC, sk.updated_at DESC, kn.title ASC LIMIT ?3",
        );
    }

    let mut query_params = vec![
        Value::Text(student_id.to_string()),
        Value::Text(normalized_subject),
    ];
    if let Some(node_ids) = &normalized_node_ids {
        query_params.extend(node_ids.iter().cloned().map(Value::Text));
    }
    query_params.push(Value::Integer(bounded_limit));

    let mut statement = connection
        .prepare(&query)
        .map_err(|error| format!("failed to prepare student knowledge query: {error}"))?;
    let rows = statement
        .query_map(
            params_from_iter(query_params),
            row_to_student_knowledge_mastery,
        )
        .map_err(|error| format!("failed to query student knowledge: {error}"))?;
    let mut mastery = Vec::new();

    for row in rows {
        mastery
            .push(row.map_err(|error| format!("failed to read student knowledge row: {error}"))?);
    }

    Ok(mastery)
}

fn normalize_knowledge_node_ids(
    knowledge_node_ids: Option<&[String]>,
) -> Result<Option<Vec<String>>, String> {
    let Some(knowledge_node_ids) = knowledge_node_ids else {
        return Ok(None);
    };
    if knowledge_node_ids.is_empty() {
        return Ok(Some(Vec::new()));
    }
    if knowledge_node_ids.len() > MAX_KNOWLEDGE_NODE_IDS {
        return Err(format!(
            "knowledge_node_ids exceeds the maximum of {MAX_KNOWLEDGE_NODE_IDS}"
        ));
    }

    let mut normalized = Vec::with_capacity(knowledge_node_ids.len());
    let mut seen = HashSet::new();
    for raw_id in knowledge_node_ids {
        let id = raw_id.trim();
        if id.is_empty() {
            return Err("knowledge_node_ids cannot contain an empty id".to_string());
        }
        if id.chars().count() > MAX_KNOWLEDGE_NODE_ID_LENGTH {
            return Err(format!(
                "knowledge node id exceeds the maximum length of {MAX_KNOWLEDGE_NODE_ID_LENGTH}"
            ));
        }
        if seen.insert(id.to_string()) {
            normalized.push(id.to_string());
        }
    }
    Ok(Some(normalized))
}

pub(crate) fn load_knowledge_prerequisites_with_connection(
    connection: &Connection,
    subject_code: &str,
    knowledge_node_ids: &[String],
    limit: i64,
) -> Result<Vec<StoredKnowledgePrerequisite>, String> {
    let subject_id = resolve_subject_id(connection, subject_code)?;
    let bounded_limit = limit.clamp(1, 100) as usize;
    let mut prerequisites = Vec::new();
    let mut seen = HashSet::new();

    for target_node_id in knowledge_node_ids
        .iter()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    {
        if prerequisites.len() >= bounded_limit {
            break;
        }

        let mut statement = connection
            .prepare(
                "SELECT e.from_node_id, n.title, n.summary, e.relation_type, e.weight, target.title
                 FROM knowledge_edges e
                 JOIN knowledge_nodes n ON n.id = e.from_node_id
                 JOIN knowledge_nodes target ON target.id = e.to_node_id
                 WHERE e.subject_id = ?1
                   AND e.to_node_id = ?2
                   AND e.relation_type = 'prerequisite'
                 ORDER BY e.weight DESC, n.difficulty ASC, n.title ASC",
            )
            .map_err(|error| format!("failed to prepare prerequisite edge query: {error}"))?;
        let rows = statement
            .query_map(params![&subject_id, target_node_id], |row| {
                Ok(StoredKnowledgePrerequisite {
                    target_node_id: target_node_id.to_string(),
                    target_title: row.get(5)?,
                    prerequisite_node_id: Some(row.get(0)?),
                    title: row.get(1)?,
                    summary: row.get(2)?,
                    relation_type: row.get(3)?,
                    source: "knowledge_edges".to_string(),
                    weight: Some(row.get(4)?),
                })
            })
            .map_err(|error| format!("failed to query prerequisite edges: {error}"))?;

        for row in rows {
            let prerequisite =
                row.map_err(|error| format!("failed to read prerequisite edge: {error}"))?;
            let key = format!(
                "{}:{}:{}",
                prerequisite.target_node_id, prerequisite.source, prerequisite.title
            );
            if seen.insert(key) {
                prerequisites.push(prerequisite);
            }
            if prerequisites.len() >= bounded_limit {
                break;
            }
        }

        if prerequisites.len() >= bounded_limit {
            break;
        }

        let prerequisite_labels = connection
            .query_row(
                "SELECT prerequisites_json
                 FROM knowledge_nodes
                 WHERE id = ?1 AND subject_id = ?2",
                params![target_node_id, &subject_id],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|error| format!("failed to load prerequisite labels: {error}"))?;

        if let Some(raw_labels) = prerequisite_labels {
            let target_title = connection
                .query_row(
                    "SELECT title FROM knowledge_nodes WHERE id = ?1",
                    [target_node_id],
                    |row| row.get::<_, String>(0),
                )
                .unwrap_or_else(|_| target_node_id.to_string());
            let labels = serde_json::from_str::<Vec<String>>(&raw_labels).unwrap_or_default();
            for label in labels {
                let title = label.trim();
                if title.is_empty() {
                    continue;
                }

                let key = format!("{target_node_id}:prerequisites_json:{title}");
                if seen.insert(key) {
                    prerequisites.push(StoredKnowledgePrerequisite {
                        target_node_id: target_node_id.to_string(),
                        target_title: target_title.clone(),
                        prerequisite_node_id: None,
                        title: title.to_string(),
                        summary: None,
                        relation_type: "prerequisite_text".to_string(),
                        source: "prerequisites_json".to_string(),
                        weight: None,
                    });
                }
                if prerequisites.len() >= bounded_limit {
                    break;
                }
            }
        }
    }

    Ok(prerequisites)
}

fn row_to_student_knowledge_mastery(
    row: &rusqlite::Row<'_>,
) -> rusqlite::Result<StoredStudentKnowledgeMastery> {
    Ok(StoredStudentKnowledgeMastery {
        knowledge_node_id: row.get(0)?,
        title: row.get(1)?,
        summary: row.get(2)?,
        mastery_probability: row.get(3)?,
        attempts_count: row.get(4)?,
        correct_count: row.get(5)?,
        last_practiced_at: row.get(6)?,
        evidence_summary: row.get(7)?,
        updated_at: row.get(8)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn test_connection() -> Connection {
        let connection = Connection::open_in_memory().expect("test database should open");
        crate::apply_migrations(&connection).expect("test migrations should apply");
        connection
            .execute(
                "INSERT INTO students (id, display_name, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?3)",
                params!["student-1", "Test student", "2026-08-11T00:00:00Z"],
            )
            .expect("student should insert");
        connection
            .execute(
                "INSERT INTO subjects (id, name, code, style_key, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
                params![
                    "subject-cs408",
                    "408考研",
                    "cs408",
                    "rigorous_patient",
                    "2026-08-11T00:00:00Z"
                ],
            )
            .expect("subject should insert");

        for (id, title, mastery) in [
            ("cs408-cn-ip", "计算机网络", 0.9_f64),
            ("cs408-os-process", "操作系统", 0.2_f64),
        ] {
            connection
                .execute(
                    "INSERT INTO knowledge_nodes
                     (id, subject_id, title, slug, summary, level, created_at, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
                    params![
                        id,
                        "subject-cs408",
                        title,
                        id,
                        title,
                        "leaf",
                        "2026-08-11T00:00:00Z"
                    ],
                )
                .expect("knowledge node should insert");
            connection
                .execute(
                    "INSERT INTO student_knowledge
                     (id, student_id, knowledge_node_id, mastery_probability, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5)",
                    params![
                        format!("{id}-mastery"),
                        "student-1",
                        id,
                        mastery,
                        "2026-08-11T00:00:00Z"
                    ],
                )
                .expect("student mastery should insert");
        }

        connection
    }

    #[test]
    fn load_student_knowledge_filters_by_node_whitelist_and_preserves_legacy_behavior() {
        let connection = test_connection();

        let filtered = load_student_knowledge_with_connection(
            &connection,
            "student-1",
            "cs408",
            10,
            Some(&[
                "cs408-cn-ip".to_string(),
                "cs408-cn-ip".to_string(),
                "cs408-os-process".to_string(),
            ]),
        )
        .expect("filtered mastery should load");
        assert_eq!(filtered.len(), 2);
        assert_eq!(filtered[0].knowledge_node_id, "cs408-os-process");
        assert_eq!(filtered[1].knowledge_node_id, "cs408-cn-ip");

        let networks_only = load_student_knowledge_with_connection(
            &connection,
            "student-1",
            "cs408",
            10,
            Some(&["cs408-cn-ip".to_string()]),
        )
        .expect("whitelisted mastery should load");
        assert_eq!(
            networks_only
                .iter()
                .map(|item| item.knowledge_node_id.as_str())
                .collect::<Vec<_>>(),
            vec!["cs408-cn-ip"]
        );

        let legacy =
            load_student_knowledge_with_connection(&connection, "student-1", "cs408", 10, None)
                .expect("legacy mastery should load");
        assert_eq!(legacy.len(), 2);

        let explicit_empty = load_student_knowledge_with_connection(
            &connection,
            "student-1",
            "cs408",
            10,
            Some(&[]),
        )
        .expect("explicit empty whitelist should load no mastery");
        assert!(explicit_empty.is_empty());

        let limited = load_student_knowledge_with_connection(
            &connection,
            "student-1",
            "cs408",
            1,
            Some(&["cs408-cn-ip".to_string(), "cs408-os-process".to_string()]),
        )
        .expect("limited mastery should load");
        assert_eq!(limited.len(), 1);
        assert_eq!(limited[0].knowledge_node_id, "cs408-os-process");
    }

    #[test]
    fn load_student_knowledge_rejects_invalid_whitelist_boundaries() {
        let connection = test_connection();
        let too_many = (0..=200)
            .map(|index| format!("node-{index}"))
            .collect::<Vec<_>>();
        let too_long = vec!["x".repeat(65)];

        let too_many_error = load_student_knowledge_with_connection(
            &connection,
            "student-1",
            "cs408",
            10,
            Some(&too_many),
        )
        .err()
        .expect("over-limit whitelist should fail");
        assert!(too_many_error.contains("maximum of 200"));

        let too_long_error = load_student_knowledge_with_connection(
            &connection,
            "student-1",
            "cs408",
            10,
            Some(&too_long),
        )
        .err()
        .expect("over-length id should fail");
        assert!(too_long_error.contains("maximum length of 64"));

        let empty_id_error = load_student_knowledge_with_connection(
            &connection,
            "student-1",
            "cs408",
            10,
            Some(&["  ".to_string()]),
        )
        .err()
        .expect("empty id should fail");
        assert!(empty_id_error.contains("empty id"));
    }
}
