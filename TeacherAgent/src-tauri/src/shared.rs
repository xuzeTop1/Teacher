use rusqlite::{params, Connection, OptionalExtension};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

pub(crate) const DEFAULT_STUDENT_ID: &str = "local-default-student";
pub(crate) const DEFAULT_STUDENT_NAME: &str = "本地学生";

/// Read the current SQLite timestamp as ISO-8601 string.
pub(crate) fn current_timestamp(connection: &Connection) -> Result<String, String> {
    connection
        .query_row("SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now')", [], |row| {
            row.get(0)
        })
        .map_err(|error| format!("failed to read current timestamp: {error}"))
}

/// Current time as unix nanoseconds (for smoke check IDs etc.).
pub(crate) fn current_unix_nanos() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_else(|_| Duration::from_nanos(0))
        .as_nanos()
}

/// Truncate a string to at most `max_chars` characters.
pub(crate) fn truncate_for_storage(value: &str, max_chars: usize) -> String {
    value.chars().take(max_chars).collect()
}

/// Normalize a subject code to a known canonical form.
/// Returns an error for unknown subject codes instead of defaulting to "math".
pub(crate) fn normalize_subject_code(subject_code: &str) -> Result<String, String> {
    match subject_code {
        "math" | "english" | "law" | "accounting" | "programming" | "cs408" | "physics"
        | "politics" | "management" | "education" | "psychology" | "lawmaster" | "xingce"
        | "shenlun" => Ok(subject_code.to_string()),
        _ => {
            // Check if this is a custom subject (starts with "custom-")
            if subject_code.starts_with("custom-") {
                Ok(subject_code.to_string())
            } else {
                Err(format!(
                    "Unknown subject code '{subject_code}'. Use a built-in code or create a custom subject first."
                ))
            }
        }
    }
}

/// Human-readable subject name for a given subject code.
/// For custom subjects, returns a placeholder — the caller should look up
/// the actual name from the `subjects` table.
pub(crate) fn subject_name(subject_code: &str) -> &'static str {
    match subject_code {
        "english" => "英语",
        "law" => "法学",
        "accounting" => "会计",
        "programming" => "编程",
        "cs408" => "408考研",
        "physics" => "物理",
        "politics" => "政治",
        "management" => "管理类联考",
        "education" => "教育学311",
        "psychology" => "心理学312",
        "lawmaster" => "法律硕士",
        "xingce" => "行测",
        "shenlun" => "申论",
        _ if subject_code.starts_with("custom-") => "自建学科",
        _ => "数学",
    }
}

/// Subject style key used by the prompt builder for teaching persona.
/// Custom subjects use the default rigorous_patient style.
pub(crate) fn subject_style_key(subject_code: &str) -> &'static str {
    match subject_code {
        "english" => "light_witty_coach",
        "law" => "serious_fair_examiner",
        "accounting" => "careful_standards_based",
        "programming" => "debugging_partner",
        "cs408" => "rigorous_patient",
        "physics" => "rigorous_patient",
        "politics" => "rigorous_patient",
        "management" => "rigorous_patient",
        "education" => "rigorous_patient",
        "psychology" => "rigorous_patient",
        "lawmaster" => "serious_fair_examiner",
        "xingce" => "serious_fair_examiner",
        "shenlun" => "careful_standards_based",
        _ if subject_code.starts_with("custom-") => "rigorous_patient",
        _ => "rigorous_patient",
    }
}

/// Extract the subject code from a subject ID like "subject-math".
pub(crate) fn subject_code_from_subject_id(subject_id: &str) -> Option<String> {
    subject_id
        .strip_prefix("subject-")
        .and_then(|code| normalize_subject_code(code).ok())
}

/// Check whether a subject code refers to a custom (user-created) subject.
pub(crate) fn is_custom_subject_code(subject_code: &str) -> bool {
    subject_code.starts_with("custom-")
}

/// Resolve the real `subjects.id` from a subject code by querying the database.
/// Returns an error if the code is not a valid normalized code or the subject doesn't exist.
/// This is the single entry point for subject ID resolution — built-in and custom alike.
pub(crate) fn resolve_subject_id(
    connection: &Connection,
    subject_code: &str,
) -> Result<String, String> {
    match resolve_subject_id_detailed(connection, subject_code)? {
        Some(id) => Ok(id),
        None => Err(format!(
            "Subject '{subject_code}' does not exist in the database. Create it first."
        )),
    }
}

/// Resolve the real `subjects.id` from a subject code, distinguishing between
/// "not found" and real database errors.
/// - `Ok(Some(id))`: subject found in the database.
/// - `Ok(None)`: no subject with this code exists.
/// - `Err(msg)`: a real database error occurred (schema corruption, lock, etc.).
pub(crate) fn resolve_subject_id_detailed(
    connection: &Connection,
    subject_code: &str,
) -> Result<Option<String>, String> {
    let normalized = normalize_subject_code(subject_code)?;
    connection
        .query_row(
            "SELECT id FROM subjects WHERE code = ?1",
            params![normalized],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| format!("database error resolving subject '{subject_code}': {error}"))
}

/// Validate that a raw JSON string is an object or array.
pub(crate) fn validate_json_object_or_array(raw: &str, field_name: &str) -> Result<(), String> {
    let value: serde_json::Value =
        serde_json::from_str(raw).map_err(|error| format!("invalid {field_name}: {error}"))?;

    if value.is_object() || value.is_array() {
        Ok(())
    } else {
        Err(format!("{field_name} must be a JSON object or array"))
    }
}

/// Create a URL-friendly slug from a string.
pub(crate) fn create_slug(value: &str) -> String {
    value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || character == '-' || character == '_' {
                character.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .to_string()
}

/// Redact tokens that look like API keys or bearer tokens.
pub(crate) fn redact_sensitive_text(value: &str) -> String {
    let mut tokens = value.split_whitespace().peekable();
    let mut redacted = Vec::new();

    while let Some(token) = tokens.next() {
        let candidate = trim_secret_delimiters(token);
        let lowercase = candidate.to_ascii_lowercase();
        let is_authorization_header = matches!(
            lowercase.as_str(),
            "authorization" | "proxy-authorization" | "x-api-key" | "api-key" | "apikey"
        );

        if is_authorization_header {
            redacted.push("[redacted]".to_string());
            if tokens.peek().is_some_and(|next| {
                matches!(
                    trim_secret_delimiters(next).to_ascii_lowercase().as_str(),
                    "bearer" | "basic" | "token"
                )
            }) {
                tokens.next();
            }
            tokens.next();
        } else if lowercase == "bearer" {
            redacted.push("[redacted]".to_string());
            tokens.next();
        } else if looks_like_plain_api_key(candidate)
            || lowercase.starts_with("bearer=")
            || lowercase.starts_with("bearer:")
            || lowercase.contains("api_key=")
            || lowercase.contains("api-key=")
            || lowercase.contains("apikey=")
        {
            redacted.push("[redacted]".to_string());
        } else {
            redacted.push(token.to_string());
        }
    }

    redacted.join(" ")
}

pub(crate) fn looks_like_plain_api_key(value: &str) -> bool {
    let trimmed = trim_secret_delimiters(value.trim());
    let lowercase = trimmed.to_ascii_lowercase();
    let known_prefix = [
        "sk-",
        "sk_",
        "rk_live_",
        "pk_live_",
        "gsk_",
        "hf_",
        "github_pat_",
        "ghp_",
        "gho_",
        "ghu_",
        "ghs_",
        "ghr_",
        "xoxb-",
        "xoxp-",
        "xoxa-",
        "xoxr-",
        "xoxs-",
        "ya29.",
    ]
    .iter()
    .any(|prefix| lowercase.starts_with(prefix));
    let google_api_key = trimmed.starts_with("AIza");
    let aws_access_key =
        (trimmed.starts_with("AKIA") || trimmed.starts_with("ASIA")) && trimmed.len() >= 16;
    let jwt =
        trimmed.starts_with("eyJ") && trimmed.len() >= 20 && trimmed.matches('.').count() == 2;

    known_prefix
        || google_api_key
        || aws_access_key
        || jwt
        || trimmed.len() > 80
        || trimmed.contains(' ')
}

fn trim_secret_delimiters(value: &str) -> &str {
    value.trim_matches(|character: char| {
        matches!(
            character,
            '"' | '\'' | '`' | '(' | ')' | '[' | ']' | '{' | '}' | '<' | '>' | ',' | ';' | ':'
        )
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn truncate_for_storage_basic() {
        assert_eq!(truncate_for_storage("hello", 3), "hel");
        assert_eq!(truncate_for_storage("hi", 10), "hi");
        assert_eq!(truncate_for_storage("", 5), "");
    }

    #[test]
    fn truncate_for_storage_unicode() {
        assert_eq!(truncate_for_storage("你好世界", 2), "你好");
    }

    #[test]
    fn recognizes_common_provider_and_platform_secret_shapes() {
        for secret in [
            "sk-ant-api03-example",
            "\"gsk_example\"",
            "AIzaExampleKey",
            "hf_example",
            "github_pat_example",
            "ghp_example",
            "xoxb-example",
            "sk_live_example",
            "AKIA1234567890EXAMPLE",
            "eyJheader.payload.signature",
        ] {
            assert!(
                looks_like_plain_api_key(secret),
                "{secret} must be redacted"
            );
        }
        assert!(!looks_like_plain_api_key("mimo-v2.5-pro"));
        assert!(!looks_like_plain_api_key("ordinary-error-message"));
    }

    #[test]
    fn redacts_bearer_headers_and_inline_api_keys_without_leaving_the_value() {
        assert_eq!(
            redact_sensitive_text("Authorization: Bearer gsk_example request failed"),
            "[redacted] request failed"
        );
        assert_eq!(
            redact_sensitive_text("x-api-key: AIzaExampleKey"),
            "[redacted]"
        );
        assert_eq!(
            redact_sensitive_text("Authorization: Basic dXNlcjpwYXNz request failed"),
            "[redacted] request failed"
        );
        assert_eq!(
            redact_sensitive_text("provider error api_key=sk-live-secret"),
            "provider error [redacted]"
        );
    }

    #[test]
    fn normalize_subject_code_known() {
        assert_eq!(normalize_subject_code("math").unwrap(), "math");
        assert_eq!(normalize_subject_code("english").unwrap(), "english");
        assert_eq!(normalize_subject_code("cs408").unwrap(), "cs408");
        assert_eq!(normalize_subject_code("xingce").unwrap(), "xingce");
        assert_eq!(normalize_subject_code("shenlun").unwrap(), "shenlun");
    }

    #[test]
    fn normalize_subject_code_unknown_returns_error() {
        assert!(normalize_subject_code("unknown").is_err());
        assert!(normalize_subject_code("").is_err());
    }

    #[test]
    fn normalize_subject_code_custom_accepted() {
        assert_eq!(
            normalize_subject_code("custom-abc123").unwrap(),
            "custom-abc123"
        );
    }

    #[test]
    fn subject_name_known() {
        assert_eq!(subject_name("math"), "数学");
        assert_eq!(subject_name("english"), "英语");
        assert_eq!(subject_name("psychology"), "心理学312");
        assert_eq!(subject_name("xingce"), "行测");
        assert_eq!(subject_name("shenlun"), "申论");
    }

    #[test]
    fn subject_code_from_subject_id_valid() {
        assert_eq!(
            subject_code_from_subject_id("subject-math"),
            Some("math".to_string())
        );
        assert_eq!(
            subject_code_from_subject_id("subject-cs408"),
            Some("cs408".to_string())
        );
        assert_eq!(
            subject_code_from_subject_id("subject-xingce"),
            Some("xingce".to_string())
        );
        assert_eq!(
            subject_code_from_subject_id("subject-shenlun"),
            Some("shenlun".to_string())
        );
    }

    #[test]
    fn subject_code_from_subject_id_invalid() {
        assert_eq!(subject_code_from_subject_id("math"), None);
        // Empty code after prefix is not a valid subject → None
        assert_eq!(subject_code_from_subject_id("subject-"), None);
    }

    #[test]
    fn validate_json_object_or_array_accepts_object() {
        assert!(validate_json_object_or_array(r#"{"a":1}"#, "test").is_ok());
    }

    #[test]
    fn validate_json_object_or_array_accepts_array() {
        assert!(validate_json_object_or_array("[1,2,3]", "test").is_ok());
    }

    #[test]
    fn validate_json_object_or_array_rejects_string() {
        assert!(validate_json_object_or_array(r#""hello""#, "test").is_err());
    }

    #[test]
    fn create_slug_basic() {
        assert_eq!(create_slug("Hello World"), "hello-world");
        assert_eq!(create_slug("  trim  "), "trim");
    }

    #[test]
    fn create_slug_chinese() {
        // Chinese characters are not alphanumeric, so they become dashes and get trimmed
        assert_eq!(create_slug("学习数学"), "");
    }
}
