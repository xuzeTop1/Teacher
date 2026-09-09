use crate::models::{
    CompleteLlmChatInput, CompleteLlmChatOutput, DeleteProviderApiKeyInput,
    LlmProviderCommandError, LlmStreamChunk, SaveProviderApiKeyInput, SaveProviderConfigInput,
    StoredProviderApiKeyRef, StoredProviderConfig,
};
use crate::shared::{looks_like_plain_api_key, redact_sensitive_text, truncate_for_storage};
use futures_util::StreamExt;
use reqwest::redirect::Policy;
use reqwest::Url;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::net::IpAddr;
use std::time::Duration;
use tauri::ipc::Channel;

const MAX_SSE_LINE_BYTES: usize = 1024 * 1024;
const STREAM_REQUEST_TIMEOUT_SECS: u64 = 300;

const KEYCHAIN_SERVICE: &str = "TeacherAgent";
const KEYCHAIN_REF_PREFIX: &str = "keychain:teacher-agent:provider-api-key:";
const KEYCHAIN_CREDENTIAL_VERSION: u8 = 1;

#[derive(Debug, Serialize, Deserialize)]
struct BoundProviderCredential {
    version: u8,
    endpoint_identity: String,
    api_key: String,
}

pub(crate) fn save_provider_config_with_connection(
    connection: &Connection,
    input: SaveProviderConfigInput,
) -> Result<StoredProviderConfig, String> {
    let name = strip_ansi_escapes(input.name.trim());
    let base_url = normalize_provider_base_url(&strip_ansi_escapes(input.base_url.trim()))?;
    let model = strip_ansi_escapes(input.model.trim());
    let provider_type = input.provider_type.trim();

    if name.is_empty() {
        return Err("provider name cannot be empty".to_string());
    }
    if provider_type.is_empty() {
        return Err("provider type cannot be empty".to_string());
    }
    if base_url.is_empty() {
        return Err("provider base_url cannot be empty".to_string());
    }
    if model.is_empty() {
        return Err("provider model cannot be empty".to_string());
    }
    let id = input
        .id
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "provider-default".to_string());
    validate_provider_id(&id)?;
    if let Some(api_key_ref) = input.api_key_ref.as_deref() {
        validate_provider_api_key_ref(api_key_ref)?;
        if api_key_ref != create_provider_api_key_ref(&id) {
            return Err(
                "api_key_ref must match the provider id; re-enter the API key to migrate this configuration"
                    .to_string(),
            );
        }
    }
    if input.is_local && !is_loopback_provider_url(&base_url)? {
        return Err("local providers must use localhost, 127.0.0.1, or ::1".to_string());
    }

    if input.is_default {
        connection
            .execute(
                "UPDATE provider_configs SET is_default = 0 WHERE is_default = 1",
                [],
            )
            .map_err(|error| format!("failed to clear default provider config: {error}"))?;
    }

    connection
        .execute(
            "INSERT INTO provider_configs (
               id, name, provider_type, base_url, model, api_key_ref,
               is_default, is_local, text_model, vision_model, supports_vision,
               created_at, updated_at
             )
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11,
                     strftime('%Y-%m-%dT%H:%M:%fZ','now'),
                     strftime('%Y-%m-%dT%H:%M:%fZ','now'))
             ON CONFLICT(id) DO UPDATE SET
               name = excluded.name,
               provider_type = excluded.provider_type,
               base_url = excluded.base_url,
               model = excluded.model,
               api_key_ref = excluded.api_key_ref,
               is_default = excluded.is_default,
               is_local = excluded.is_local,
               text_model = excluded.text_model,
               vision_model = excluded.vision_model,
               supports_vision = excluded.supports_vision,
               updated_at = excluded.updated_at",
            params![
                &id,
                name,
                provider_type,
                base_url,
                model,
                input.api_key_ref.as_deref(),
                bool_to_i64(input.is_default),
                bool_to_i64(input.is_local),
                input.text_model.as_deref(),
                input.vision_model.as_deref(),
                bool_to_i64(input.supports_vision)
            ],
        )
        .map_err(|error| format!("failed to save provider config: {error}"))?;

    load_provider_config(connection, &id)?
        .ok_or_else(|| "saved provider config could not be loaded".to_string())
}

pub(crate) fn load_default_provider_config_with_connection(
    connection: &Connection,
) -> Result<Option<StoredProviderConfig>, String> {
    connection
        .query_row(
            "SELECT id, name, provider_type, base_url, model, api_key_ref,
                    is_default, is_local, text_model, vision_model, supports_vision,
                    created_at, updated_at
             FROM provider_configs
             WHERE is_default = 1
             ORDER BY updated_at DESC, rowid DESC
             LIMIT 1",
            [],
            row_to_provider_config,
        )
        .optional()
        .map_err(|error| format!("failed to load default provider config: {error}"))
}

fn load_provider_config(
    connection: &Connection,
    provider_id: &str,
) -> Result<Option<StoredProviderConfig>, String> {
    connection
        .query_row(
            "SELECT id, name, provider_type, base_url, model, api_key_ref,
                    is_default, is_local, text_model, vision_model, supports_vision,
                    created_at, updated_at
             FROM provider_configs
             WHERE id = ?1",
            [provider_id],
            row_to_provider_config,
        )
        .optional()
        .map_err(|error| format!("failed to load provider config: {error}"))
}

pub(crate) fn list_provider_configs_with_connection(
    connection: &Connection,
) -> Result<Vec<StoredProviderConfig>, String> {
    let mut statement = connection
        .prepare(
            "SELECT id, name, provider_type, base_url, model, api_key_ref,
                    is_default, is_local, text_model, vision_model, supports_vision,
                    created_at, updated_at
             FROM provider_configs
             ORDER BY is_default DESC, updated_at DESC, rowid DESC",
        )
        .map_err(|error| format!("failed to prepare list provider configs: {error}"))?;

    let rows = statement
        .query_map([], row_to_provider_config)
        .map_err(|error| format!("failed to list provider configs: {error}"))?;

    let mut configs = Vec::new();
    for row in rows {
        configs.push(row.map_err(|error| format!("failed to read provider config row: {error}"))?);
    }

    Ok(configs)
}

pub(crate) fn delete_provider_config_with_connection(
    connection: &Connection,
    provider_id: &str,
) -> Result<bool, String> {
    let api_key_ref = connection
        .query_row(
            "SELECT api_key_ref FROM provider_configs WHERE id = ?1",
            [provider_id],
            |row| row.get::<_, Option<String>>(0),
        )
        .optional()
        .map_err(|error| format!("failed to load provider API key reference: {error}"))?
        .flatten();
    let deleted = connection
        .execute("DELETE FROM provider_configs WHERE id = ?1", [provider_id])
        .map_err(|error| format!("failed to delete provider config: {error}"))?;

    if deleted > 0 {
        if let Some(api_key_ref) = api_key_ref {
            delete_provider_api_key_ref_from_keychain(&api_key_ref)?;
        }
    }
    Ok(deleted > 0)
}

pub(crate) fn save_provider_api_key_to_keychain(
    input: SaveProviderApiKeyInput,
) -> Result<StoredProviderApiKeyRef, String> {
    let provider_id = input.provider_id.trim();
    let api_key = input.api_key.trim();
    let endpoint_identity = normalize_provider_base_url(&input.base_url)?;

    validate_provider_id(provider_id)?;
    if api_key.is_empty() {
        return Err("api_key cannot be empty".to_string());
    }

    let api_key_ref = create_provider_api_key_ref(provider_id);
    let account = account_from_api_key_ref(&api_key_ref)?;
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, &account)
        .map_err(|error| format!("failed to open keychain entry: {error}"))?;

    let credential = BoundProviderCredential {
        version: KEYCHAIN_CREDENTIAL_VERSION,
        endpoint_identity,
        api_key: api_key.to_string(),
    };
    let serialized = serde_json::to_string(&credential)
        .map_err(|error| format!("failed to encode provider credential: {error}"))?;
    entry
        .set_password(&serialized)
        .map_err(|error| format!("failed to save provider API key to keychain: {error}"))?;

    Ok(StoredProviderApiKeyRef {
        api_key_ref,
        has_api_key: true,
    })
}

pub(crate) fn delete_provider_api_key_from_keychain(
    input: DeleteProviderApiKeyInput,
) -> Result<bool, String> {
    delete_provider_api_key_ref_from_keychain(&input.api_key_ref)
}

pub(crate) fn load_provider_api_key_ref_from_keychain(
    api_key_ref: &str,
    base_url: &str,
) -> Result<Option<String>, String> {
    validate_provider_api_key_ref(api_key_ref)?;
    let expected_endpoint = normalize_provider_base_url(base_url)?;
    let account = account_from_api_key_ref(api_key_ref)?;
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, &account)
        .map_err(|error| format!("failed to open keychain entry: {error}"))?;

    match entry.get_password() {
        Ok(serialized) => Ok(Some(decode_bound_provider_credential(
            &serialized,
            &expected_endpoint,
        )?)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(format!(
            "failed to load provider API key from keychain: {error}"
        )),
    }
}

fn decode_bound_provider_credential(
    serialized: &str,
    expected_endpoint: &str,
) -> Result<String, String> {
    let credential: BoundProviderCredential = serde_json::from_str(serialized).map_err(|_| {
        "stored API key uses an obsolete unbound format; re-enter the key for this endpoint"
            .to_string()
    })?;
    if credential.version != KEYCHAIN_CREDENTIAL_VERSION
        || credential.endpoint_identity != expected_endpoint
    {
        return Err(
            "provider endpoint changed; re-enter the API key before any request can be sent"
                .to_string(),
        );
    }
    if credential.api_key.trim().is_empty() {
        return Err("stored provider credential is invalid; re-enter the API key".to_string());
    }
    Ok(credential.api_key)
}

fn delete_provider_api_key_ref_from_keychain(api_key_ref: &str) -> Result<bool, String> {
    let account = account_from_api_key_ref(api_key_ref)?;
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, &account)
        .map_err(|error| format!("failed to open keychain entry: {error}"))?;

    match entry.delete_password() {
        Ok(()) => Ok(true),
        Err(keyring::Error::NoEntry) => Ok(false),
        Err(error) => Err(format!(
            "failed to delete provider API key from keychain: {error}"
        )),
    }
}

// ── Bocha API Key keychain helpers ──────────────────────────────────

const BOCHA_KEYCHAIN_ACCOUNT: &str = "bocha-api-key";

pub(crate) fn save_bocha_api_key_to_keychain(
    api_key: &str,
) -> Result<StoredProviderApiKeyRef, String> {
    let api_key = api_key.trim();
    if api_key.is_empty() {
        return Err("api_key cannot be empty".to_string());
    }
    let api_key_ref = format!("{KEYCHAIN_REF_PREFIX}{BOCHA_KEYCHAIN_ACCOUNT}");
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, BOCHA_KEYCHAIN_ACCOUNT)
        .map_err(|error| format!("failed to open keychain entry: {error}"))?;
    entry
        .set_password(api_key)
        .map_err(|error| format!("failed to save Bocha API key to keychain: {error}"))?;
    Ok(StoredProviderApiKeyRef {
        api_key_ref,
        has_api_key: true,
    })
}

pub(crate) fn load_bocha_api_key_from_keychain() -> Result<Option<String>, String> {
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, BOCHA_KEYCHAIN_ACCOUNT)
        .map_err(|error| format!("failed to open keychain entry: {error}"))?;
    match entry.get_password() {
        Ok(api_key) => Ok(Some(api_key)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(format!(
            "failed to load Bocha API key from keychain: {error}"
        )),
    }
}

pub(crate) fn delete_bocha_api_key_from_keychain() -> Result<bool, String> {
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, BOCHA_KEYCHAIN_ACCOUNT)
        .map_err(|error| format!("failed to open keychain entry: {error}"))?;
    match entry.delete_password() {
        Ok(()) => Ok(true),
        Err(keyring::Error::NoEntry) => Ok(false),
        Err(error) => Err(format!(
            "failed to delete Bocha API key from keychain: {error}"
        )),
    }
}

pub(crate) async fn complete_llm_chat_with_provider(
    input: CompleteLlmChatInput,
) -> Result<CompleteLlmChatOutput, LlmProviderCommandError> {
    let provider_name = strip_ansi_escapes(input.provider_name.trim());
    let base_url = normalize_provider_base_url(&strip_ansi_escapes(input.base_url.trim()))
        .map_err(|error| llm_provider_error("invalid_config", &error, None, None, false))?;
    let model = strip_ansi_escapes(input.model.trim());

    if provider_name.is_empty() {
        return Err(llm_provider_error(
            "invalid_config",
            "provider_name cannot be empty",
            None,
            None,
            false,
        ));
    }
    if base_url.is_empty() {
        return Err(llm_provider_error(
            "invalid_config",
            "base_url cannot be empty",
            Some(&provider_name),
            None,
            false,
        ));
    }
    if input.is_local && !is_loopback_provider_url(&base_url).unwrap_or(false) {
        return Err(llm_provider_error(
            "invalid_config",
            "local providers must use localhost, 127.0.0.1, or ::1",
            Some(&provider_name),
            None,
            false,
        ));
    }
    if model.is_empty() {
        return Err(llm_provider_error(
            "invalid_config",
            "model cannot be empty",
            Some(&provider_name),
            None,
            false,
        ));
    }
    if input.messages.is_empty() {
        return Err(llm_provider_error(
            "invalid_request",
            "messages cannot be empty",
            Some(&provider_name),
            None,
            false,
        ));
    }

    for message in &input.messages {
        validate_llm_role(&message.role).map_err(|error| {
            llm_provider_error("invalid_request", &error, Some(&provider_name), None, false)
        })?;
        // content can be a string or an array of content parts (multimodal)
        let content_empty = match &message.content {
            serde_json::Value::String(s) => s.trim().is_empty(),
            serde_json::Value::Array(arr) => {
                arr.is_empty()
                    || arr.iter().all(|part| {
                        part.get("text")
                            .and_then(|t| t.as_str())
                            .map(|s| s.trim().is_empty())
                            .unwrap_or(true)
                    })
            }
            _ => true,
        };
        if content_empty {
            return Err(llm_provider_error(
                "invalid_request",
                "message content cannot be empty",
                Some(&provider_name),
                None,
                false,
            ));
        }
    }

    let api_key = if input.is_local {
        None
    } else {
        let api_key_ref = input.api_key_ref.as_deref().ok_or_else(|| {
            llm_provider_error(
                "auth_missing",
                "api_key_ref is required for non-local providers",
                Some(&provider_name),
                None,
                false,
            )
        })?;
        Some(
            load_provider_api_key_ref_from_keychain(api_key_ref, &base_url)
                .map_err(|error| {
                    llm_provider_error("keychain_error", &error, Some(&provider_name), None, false)
                })?
                .ok_or_else(|| {
                    llm_provider_error(
                        "auth_missing",
                        "provider API key was not found in keychain",
                        Some(&provider_name),
                        None,
                        false,
                    )
                })?,
        )
    };
    let endpoint = create_chat_completions_url(&base_url);
    let client = build_provider_http_client(Duration::from_secs(90)).map_err(|error| {
        llm_provider_error(
            "network_error",
            &format!("failed to create LLM HTTP client: {error}"),
            Some(&provider_name),
            None,
            true,
        )
    })?;
    let compatibility = provider_compatibility(&provider_name, &base_url, &model);
    let request_model = if compatibility.max_tokens_field == "max_completion_tokens" {
        strip_mimo_context_suffix(&model)
    } else {
        &model
    };
    let mut body = serde_json::json!({
        "model": request_model,
        "messages": input.messages,
        "stream": false
    });
    if let Some(temperature) = resolve_temperature(compatibility, input.temperature.unwrap_or(0.4))
    {
        body["temperature"] = serde_json::json!(temperature);
    }
    apply_thinking_policy(&mut body, compatibility);
    if compatibility.max_tokens_field == "max_completion_tokens" {
        body["top_p"] = serde_json::json!(0.95);
        body["stop"] = Value::Null;
        body["frequency_penalty"] = serde_json::json!(0);
        body["presence_penalty"] = serde_json::json!(0);
    }
    if let Some(max_tokens) = resolve_max_tokens(compatibility, input.max_tokens) {
        body[compatibility.max_tokens_field] = serde_json::json!(max_tokens);
    }
    let mut request = client.post(endpoint).json(&body);

    if let Some(api_key) = api_key {
        request = match compatibility.auth_header {
            AuthHeaderMode::Bearer => request.bearer_auth(api_key),
            AuthHeaderMode::ApiKey => request.header("api-key", api_key),
        };
    }

    log_llm_provider_event(
        "request_started",
        &provider_name,
        &model,
        &base_url,
        None,
        None,
        body["messages"].as_array().map_or(0, Vec::len),
    );

    let response = request.send().await.map_err(|error| {
        let classified = classify_reqwest_error(error, &provider_name);
        log_llm_provider_error(
            "request_failed",
            &provider_name,
            &model,
            &base_url,
            &classified,
        );
        classified
    })?;
    let status = response.status();
    let payload = response.json::<Value>().await.map_err(|error| {
        let classified = llm_provider_error(
            "invalid_response",
            &format!("failed to decode LLM response JSON: {error}"),
            Some(&provider_name),
            Some(status.as_u16()),
            false,
        );
        log_llm_provider_error(
            "request_failed",
            &provider_name,
            &model,
            &base_url,
            &classified,
        );
        classified
    })?;

    if !status.is_success() {
        let classified = classify_llm_status_error(status.as_u16(), &payload, &provider_name);
        log_llm_provider_error(
            "request_failed",
            &provider_name,
            &model,
            &base_url,
            &classified,
        );
        return Err(classified);
    }

    let content = payload
        .pointer("/choices/0/message/content")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            let truncated = payload
                .pointer("/choices/0/finish_reason")
                .and_then(Value::as_str)
                == Some("length");
            let (code_text, message_text) = if truncated {
                (
                    "truncated_empty",
                    "LLM response was truncated to empty content (finish_reason=length); increase the model request's max_tokens",
                )
            } else {
                (
                    "invalid_response",
                    "LLM response did not include assistant content",
                )
            };
            let classified = llm_provider_error(
                code_text,
                message_text,
                Some(&provider_name),
                Some(status.as_u16()),
                false,
            );
            log_llm_provider_error(
                "request_failed",
                &provider_name,
                &model,
                &base_url,
                &classified,
            );
            classified
        })?;
    let response_model = payload
        .get("model")
        .and_then(Value::as_str)
        .unwrap_or(&model)
        .to_string();

    log_llm_provider_event(
        "request_succeeded",
        &provider_name,
        &model,
        &base_url,
        Some(status.as_u16()),
        None,
        body["messages"].as_array().map_or(0, Vec::len),
    );

    Ok(CompleteLlmChatOutput {
        content: content.to_string(),
        provider_name,
        model: response_model,
    })
}

pub(crate) async fn complete_llm_chat_stream_with_provider(
    input: CompleteLlmChatInput,
    channel: Channel<LlmStreamChunk>,
) -> Result<(), LlmProviderCommandError> {
    let provider_name = strip_ansi_escapes(input.provider_name.trim());
    let base_url = normalize_provider_base_url(&strip_ansi_escapes(input.base_url.trim()))
        .map_err(|error| llm_provider_error("invalid_config", &error, None, None, false))?;
    let model = strip_ansi_escapes(input.model.trim());

    if provider_name.is_empty() {
        return Err(llm_provider_error(
            "invalid_config",
            "provider_name cannot be empty",
            None,
            None,
            false,
        ));
    }
    if base_url.is_empty() {
        return Err(llm_provider_error(
            "invalid_config",
            "base_url cannot be empty",
            Some(&provider_name),
            None,
            false,
        ));
    }
    if input.is_local && !is_loopback_provider_url(&base_url).unwrap_or(false) {
        return Err(llm_provider_error(
            "invalid_config",
            "local providers must use localhost, 127.0.0.1, or ::1",
            Some(&provider_name),
            None,
            false,
        ));
    }
    if model.is_empty() {
        return Err(llm_provider_error(
            "invalid_config",
            "model cannot be empty",
            Some(&provider_name),
            None,
            false,
        ));
    }
    if input.messages.is_empty() {
        return Err(llm_provider_error(
            "invalid_request",
            "messages cannot be empty",
            Some(&provider_name),
            None,
            false,
        ));
    }

    for message in &input.messages {
        validate_llm_role(&message.role).map_err(|error| {
            llm_provider_error("invalid_request", &error, Some(&provider_name), None, false)
        })?;
        // content can be a string or an array of content parts (multimodal)
        let content_empty = match &message.content {
            serde_json::Value::String(s) => s.trim().is_empty(),
            serde_json::Value::Array(arr) => {
                arr.is_empty()
                    || arr.iter().all(|part| {
                        part.get("text")
                            .and_then(|t| t.as_str())
                            .map(|s| s.trim().is_empty())
                            .unwrap_or(true)
                    })
            }
            _ => true,
        };
        if content_empty {
            return Err(llm_provider_error(
                "invalid_request",
                "message content cannot be empty",
                Some(&provider_name),
                None,
                false,
            ));
        }
    }

    let api_key = if input.is_local {
        None
    } else {
        let api_key_ref = input.api_key_ref.as_deref().ok_or_else(|| {
            llm_provider_error(
                "auth_missing",
                "api_key_ref is required for non-local providers",
                Some(&provider_name),
                None,
                false,
            )
        })?;
        Some(
            load_provider_api_key_ref_from_keychain(api_key_ref, &base_url)
                .map_err(|error| {
                    llm_provider_error("keychain_error", &error, Some(&provider_name), None, false)
                })?
                .ok_or_else(|| {
                    llm_provider_error(
                        "auth_missing",
                        "provider API key was not found in keychain",
                        Some(&provider_name),
                        None,
                        false,
                    )
                })?,
        )
    };

    let endpoint = create_chat_completions_url(&base_url);
    // Thinking-capable providers can legitimately spend more than two minutes
    // before completing a long answer; the bounded SSE buffer below prevents a
    // slow/malicious peer from turning that allowance into unbounded memory.
    let client = build_provider_http_client(Duration::from_secs(STREAM_REQUEST_TIMEOUT_SECS))
        .map_err(|error| {
            llm_provider_error(
                "network_error",
                &format!("failed to create LLM HTTP client: {error}"),
                Some(&provider_name),
                None,
                true,
            )
        })?;

    let compatibility = provider_compatibility(&provider_name, &base_url, &model);
    let request_model = if compatibility.max_tokens_field == "max_completion_tokens" {
        strip_mimo_context_suffix(&model)
    } else {
        &model
    };

    let mut body = serde_json::json!({
        "model": request_model,
        "messages": input.messages,
        "stream": true
    });
    if let Some(temperature) = resolve_temperature(compatibility, input.temperature.unwrap_or(0.4))
    {
        body["temperature"] = serde_json::json!(temperature);
    }
    apply_thinking_policy(&mut body, compatibility);
    if compatibility.max_tokens_field == "max_completion_tokens" {
        body["top_p"] = serde_json::json!(0.95);
        body["stop"] = Value::Null;
        body["frequency_penalty"] = serde_json::json!(0);
        body["presence_penalty"] = serde_json::json!(0);
    }
    if let Some(max_tokens) = resolve_max_tokens(compatibility, input.max_tokens) {
        body[compatibility.max_tokens_field] = serde_json::json!(max_tokens);
    }

    let mut request = client.post(&endpoint).json(&body);
    if let Some(api_key) = api_key {
        request = match compatibility.auth_header {
            AuthHeaderMode::Bearer => request.bearer_auth(api_key),
            AuthHeaderMode::ApiKey => request.header("api-key", api_key),
        };
    }

    log_llm_provider_event(
        "stream_request_started",
        &provider_name,
        &model,
        &base_url,
        None,
        None,
        body["messages"].as_array().map_or(0, Vec::len),
    );

    let response = request.send().await.map_err(|error| {
        let classified = classify_reqwest_error(error, &provider_name);
        log_llm_provider_error(
            "stream_request_failed",
            &provider_name,
            &model,
            &base_url,
            &classified,
        );
        classified
    })?;

    let status = response.status();
    if !status.is_success() {
        let error_body = response.text().await.unwrap_or_default();
        let payload: Value = serde_json::from_str(&error_body).unwrap_or_default();
        let classified = classify_llm_status_error(status.as_u16(), &payload, &provider_name);
        log_llm_provider_error(
            "stream_request_failed",
            &provider_name,
            &model,
            &base_url,
            &classified,
        );
        return Err(classified);
    }

    log_llm_provider_event(
        "stream_connected",
        &provider_name,
        &model,
        &base_url,
        Some(status.as_u16()),
        None,
        body["messages"].as_array().map_or(0, Vec::len),
    );

    let mut stream = response.bytes_stream();
    let mut buffer = String::new();

    while let Some(chunk_result) = stream.next().await {
        let chunk = chunk_result.map_err(|error| {
            llm_provider_error(
                "network_error",
                &format!("stream read error: {error}"),
                Some(&provider_name),
                None,
                true,
            )
        })?;

        buffer.push_str(&String::from_utf8_lossy(&chunk));
        if buffer.len() > MAX_SSE_LINE_BYTES {
            return Err(llm_provider_error(
                "invalid_response",
                "stream response line exceeded the 1 MiB safety limit",
                Some(&provider_name),
                None,
                false,
            ));
        }

        while let Some(newline_pos) = buffer.find('\n') {
            let line = buffer[..newline_pos].trim().to_string();
            buffer = buffer[newline_pos + 1..].to_string();

            if line.is_empty() || line == "data: [DONE]" {
                continue;
            }

            if let Some(json_str) = line.strip_prefix("data: ") {
                if let Ok(json) = serde_json::from_str::<Value>(json_str) {
                    let content = json
                        .pointer("/choices/0/delta/content")
                        .and_then(Value::as_str)
                        .unwrap_or("");
                    let finished = json
                        .pointer("/choices/0/finish_reason")
                        .and_then(Value::as_str)
                        == Some("stop");

                    if !content.is_empty() {
                        let _ = channel.send(LlmStreamChunk {
                            content: content.to_string(),
                            done: false,
                        });
                    }

                    if finished {
                        let _ = channel.send(LlmStreamChunk {
                            content: String::new(),
                            done: true,
                        });
                        return Ok(());
                    }
                }
            }
        }
    }

    // Process any remaining buffer
    let trimmed = buffer.trim();
    if let Some(json_str) = trimmed.strip_prefix("data: ") {
        if let Ok(json) = serde_json::from_str::<Value>(json_str) {
            let content = json
                .pointer("/choices/0/delta/content")
                .and_then(Value::as_str)
                .unwrap_or("");
            if !content.is_empty() {
                let _ = channel.send(LlmStreamChunk {
                    content: content.to_string(),
                    done: false,
                });
            }
        }
    }

    let _ = channel.send(LlmStreamChunk {
        content: String::new(),
        done: true,
    });

    log_llm_provider_event(
        "stream_completed",
        &provider_name,
        &model,
        &base_url,
        Some(status.as_u16()),
        None,
        body["messages"].as_array().map_or(0, Vec::len),
    );

    Ok(())
}

fn row_to_provider_config(row: &rusqlite::Row<'_>) -> rusqlite::Result<StoredProviderConfig> {
    let is_default: i64 = row.get(6)?;
    let is_local: i64 = row.get(7)?;
    let supports_vision: i64 = row.get(10)?;

    Ok(StoredProviderConfig {
        id: row.get(0)?,
        name: row.get(1)?,
        provider_type: row.get(2)?,
        base_url: row.get(3)?,
        model: row.get(4)?,
        api_key_ref: row.get(5)?,
        is_default: is_default != 0,
        is_local: is_local != 0,
        text_model: row.get(8)?,
        vision_model: row.get(9)?,
        supports_vision: supports_vision != 0,
        created_at: row.get(11)?,
        updated_at: row.get(12)?,
    })
}

pub(crate) fn create_provider_api_key_ref(provider_id: &str) -> String {
    format!("{KEYCHAIN_REF_PREFIX}{}", create_slug(provider_id))
}

pub(crate) fn account_from_api_key_ref(api_key_ref: &str) -> Result<String, String> {
    validate_provider_api_key_ref(api_key_ref)?;
    let account = api_key_ref.strip_prefix(KEYCHAIN_REF_PREFIX).unwrap_or("");
    Ok(account.to_string())
}

pub(crate) fn validate_provider_api_key_ref(api_key_ref: &str) -> Result<(), String> {
    if api_key_ref != api_key_ref.trim() || !api_key_ref.starts_with(KEYCHAIN_REF_PREFIX) {
        return Err(
            "api_key_ref must use keychain:teacher-agent:provider-api-key:<provider-id>"
                .to_string(),
        );
    }
    let account = api_key_ref.strip_prefix(KEYCHAIN_REF_PREFIX).unwrap_or("");
    validate_provider_id(account)
        .map_err(|_| "api_key_ref must contain only a valid TeacherAgent provider id".to_string())
}

fn validate_provider_id(provider_id: &str) -> Result<(), String> {
    if provider_id.is_empty()
        || provider_id.len() > 128
        || !provider_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
    {
        return Err(
            "provider_id must be 1-128 ASCII letters, digits, hyphens, or underscores".to_string(),
        );
    }
    Ok(())
}

pub(crate) fn normalize_provider_base_url(value: &str) -> Result<String, String> {
    if value.is_empty() || value.len() > 2048 {
        return Err("provider base_url must be 1-2048 characters".to_string());
    }
    let authority = value
        .split_once("://")
        .map(|(_, authority)| authority)
        .ok_or_else(|| "provider base_url must include a valid scheme and host".to_string())?;
    if authority.is_empty() || authority.starts_with('/') {
        return Err("provider base_url must include a valid scheme and host".to_string());
    }
    let mut url = Url::parse(value)
        .map_err(|_| "provider base_url must include a valid scheme and host".to_string())?;
    if !url.username().is_empty() || url.password().is_some() {
        return Err(
            "provider base_url must not contain username, password, or API keys".to_string(),
        );
    }
    if url.query().is_some() || url.fragment().is_some() {
        return Err("provider base_url must not contain query parameters or fragments".to_string());
    }
    let host = url
        .host_str()
        .ok_or_else(|| "provider base_url must include a valid host".to_string())?;
    let host_for_ip = host.trim_matches(['[', ']']);
    let is_loopback = host.eq_ignore_ascii_case("localhost")
        || host_for_ip
            .parse::<IpAddr>()
            .map(|address| address.is_loopback())
            .unwrap_or(false);
    match url.scheme() {
        "https" => {}
        "http" if is_loopback => {}
        "http" => return Err("remote providers must use HTTPS".to_string()),
        _ => return Err("provider base_url scheme must be HTTPS or loopback HTTP".to_string()),
    }
    let normalized_path = url.path().trim_end_matches('/').to_string();
    url.set_path(if normalized_path.is_empty() {
        "/"
    } else {
        &normalized_path
    });
    Ok(url.to_string().trim_end_matches('/').to_string())
}

pub(crate) fn is_loopback_provider_url(value: &str) -> Result<bool, String> {
    let normalized = normalize_provider_base_url(value)?;
    let url = Url::parse(&normalized).map_err(|_| "invalid provider base_url".to_string())?;
    let host = url
        .host_str()
        .ok_or_else(|| "provider base_url must include a valid host".to_string())?;
    let host_for_ip = host.trim_matches(['[', ']']);
    Ok(host.eq_ignore_ascii_case("localhost")
        || host_for_ip
            .parse::<IpAddr>()
            .map(|address| address.is_loopback())
            .unwrap_or(false))
}

pub(crate) fn build_provider_http_client(
    timeout: Duration,
) -> Result<reqwest::Client, reqwest::Error> {
    reqwest::Client::builder()
        .timeout(timeout)
        .redirect(Policy::none())
        .build()
}

fn validate_llm_role(role: &str) -> Result<(), String> {
    match role {
        "system" | "user" | "assistant" | "tool" => Ok(()),
        _ => Err(format!("unsupported LLM message role: {role}")),
    }
}

pub(crate) fn create_chat_completions_url(base_url: &str) -> String {
    let normalized = base_url.trim_end_matches('/');

    if normalized.ends_with("/chat/completions") {
        normalized.to_string()
    } else {
        format!("{normalized}/chat/completions")
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum AuthHeaderMode {
    Bearer,
    ApiKey,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum TemperaturePolicy {
    PassThrough,
    MinimumOne,
    Omit,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct ProviderCompatibility {
    auth_header: AuthHeaderMode,
    max_tokens_field: &'static str,
    temperature_policy: TemperaturePolicy,
    enable_thinking: bool,
    minimum_max_tokens: Option<u32>,
}

fn provider_compatibility(
    provider_name: &str,
    base_url: &str,
    model: &str,
) -> ProviderCompatibility {
    if is_mimo_provider(provider_name, base_url, model) {
        return ProviderCompatibility {
            auth_header: AuthHeaderMode::ApiKey,
            max_tokens_field: "max_completion_tokens",
            temperature_policy: TemperaturePolicy::MinimumOne,
            enable_thinking: false,
            minimum_max_tokens: None,
        };
    }

    let is_kimi_fixed_sampling = is_kimi_fixed_sampling_model(provider_name, base_url, model);
    ProviderCompatibility {
        auth_header: AuthHeaderMode::Bearer,
        max_tokens_field: "max_tokens",
        temperature_policy: if is_kimi_fixed_sampling {
            TemperaturePolicy::Omit
        } else {
            TemperaturePolicy::PassThrough
        },
        // K2.5/K2.6 默认开启思考。TeacherAgent 保留该能力，并确保推理与最终正文
        // 共享的输出预算不低于官方默认的 32K，避免低额度截断后 content 为空。
        enable_thinking: is_kimi_fixed_sampling,
        minimum_max_tokens: is_kimi_fixed_sampling.then_some(32_768),
    }
}

fn is_mimo_provider(provider_name: &str, base_url: &str, model: &str) -> bool {
    let identity = format!(
        "{} {} {}",
        provider_name.to_ascii_lowercase(),
        base_url.to_ascii_lowercase(),
        model.to_ascii_lowercase()
    );

    identity.contains("xiaomimimo.com") || identity.contains("mimo")
}

fn is_kimi_fixed_sampling_model(provider_name: &str, base_url: &str, model: &str) -> bool {
    let provider_identity = format!(
        "{} {}",
        provider_name.to_ascii_lowercase(),
        base_url.to_ascii_lowercase()
    );
    let normalized_model = model.to_ascii_lowercase();
    let is_kimi = provider_identity.contains("api.moonshot.cn")
        || provider_identity.contains("moonshot")
        || provider_identity.contains("kimi")
        || normalized_model.starts_with("kimi-");

    is_kimi
        && (normalized_model.starts_with("kimi-k2.5") || normalized_model.starts_with("kimi-k2.6"))
}

fn resolve_temperature(compatibility: ProviderCompatibility, temperature: f64) -> Option<f64> {
    match compatibility.temperature_policy {
        TemperaturePolicy::PassThrough => Some(temperature),
        // MiMo 对低 temperature 可能响应慢或返回错误，确保最低为 1.0
        TemperaturePolicy::MinimumOne => Some(temperature.max(1.0)),
        // Kimi K2.5/K2.6 的采样值由服务端根据 thinking 模式固定；
        // 官方建议不要显式发送该字段，否则非允许值会返回 HTTP 400。
        TemperaturePolicy::Omit => None,
    }
}

fn resolve_max_tokens(
    compatibility: ProviderCompatibility,
    max_tokens: Option<u32>,
) -> Option<u32> {
    match (max_tokens, compatibility.minimum_max_tokens) {
        (Some(requested), Some(minimum)) => Some(requested.max(minimum)),
        (None, Some(minimum)) => Some(minimum),
        (requested, None) => requested,
    }
}

fn apply_thinking_policy(body: &mut Value, compatibility: ProviderCompatibility) {
    if compatibility.enable_thinking {
        body["thinking"] = serde_json::json!({ "type": "enabled" });
    }
}

fn llm_provider_error(
    code: &str,
    message: &str,
    provider_name: Option<&str>,
    status: Option<u16>,
    retryable: bool,
) -> LlmProviderCommandError {
    LlmProviderCommandError {
        code: code.to_string(),
        message: redact_sensitive_text(message),
        provider_name: provider_name.map(str::to_string),
        status,
        retryable,
    }
}

fn classify_reqwest_error(error: reqwest::Error, provider_name: &str) -> LlmProviderCommandError {
    let (code, retryable) = if error.is_timeout() {
        ("timeout", true)
    } else if error.is_connect() || error.is_request() {
        ("network_error", true)
    } else {
        ("network_error", false)
    };

    let message = if error.is_timeout() {
        "LLM request timed out"
    } else if error.is_connect() {
        "LLM endpoint connection failed"
    } else {
        "LLM request failed before a valid response was received"
    };
    llm_provider_error(
        code,
        message,
        Some(provider_name),
        error.status().map(|status| status.as_u16()),
        retryable,
    )
}

fn classify_llm_status_error(
    status: u16,
    payload: &Value,
    provider_name: &str,
) -> LlmProviderCommandError {
    let code = match status {
        401 | 403 => "auth_failed",
        404 => "model_or_endpoint_not_found",
        408 | 429 => "rate_limited",
        400..=499 => "provider_rejected_request",
        500..=599 => "provider_unavailable",
        _ => "http_status",
    };
    let retryable = matches!(status, 408 | 429 | 500..=599);
    let _ = payload;

    llm_provider_error(
        code,
        &format!("LLM provider returned HTTP status {status}"),
        Some(provider_name),
        Some(status),
        retryable,
    )
}

fn log_llm_provider_error(
    event: &str,
    provider_name: &str,
    model: &str,
    base_url: &str,
    error: &LlmProviderCommandError,
) {
    log_llm_provider_event(
        event,
        provider_name,
        model,
        base_url,
        error.status,
        Some(&error.code),
        0,
    );
}

fn log_llm_provider_event(
    event: &str,
    provider_name: &str,
    model: &str,
    base_url: &str,
    status: Option<u16>,
    code: Option<&str>,
    message_count: usize,
) {
    eprintln!(
        "[TeacherAgent][llm] event={} provider={} model={} endpoint={} status={} code={} messages={}",
        event,
        redact_log_value(provider_name),
        redact_log_value(model),
        redact_base_url_for_log(base_url),
        status
            .map(|value| value.to_string())
            .unwrap_or_else(|| "-".to_string()),
        code.unwrap_or("-"),
        message_count
    );
}

fn redact_base_url_for_log(base_url: &str) -> String {
    let without_query = base_url
        .split('?')
        .next()
        .unwrap_or("")
        .split('#')
        .next()
        .unwrap_or("")
        .trim();

    if let Some(rest) = without_query.strip_prefix("https://") {
        return format!("https://{}", rest.split('/').next().unwrap_or(""));
    }
    if let Some(rest) = without_query.strip_prefix("http://") {
        return format!("http://{}", rest.split('/').next().unwrap_or(""));
    }

    "<custom-endpoint>".to_string()
}

fn redact_log_value(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return "-".to_string();
    }
    if looks_like_plain_api_key(trimmed) {
        return "[redacted]".to_string();
    }

    truncate_for_storage(trimmed, 80)
}

fn bool_to_i64(value: bool) -> i64 {
    if value {
        1
    } else {
        0
    }
}

fn strip_ansi_escapes(value: &str) -> String {
    let mut result = String::with_capacity(value.len());
    let mut chars = value.chars();

    while let Some(c) = chars.next() {
        if c == '\x1b' {
            // Skip ANSI escape sequence: ESC[ ... final_letter
            if chars.next() == Some('[') {
                for escape_char in chars.by_ref() {
                    if escape_char.is_ascii_alphabetic() {
                        break;
                    }
                }
            }
        } else {
            result.push(c);
        }
    }

    result
}

fn strip_mimo_context_suffix(model: &str) -> &str {
    // MiMo API 不接受 [1m] 上下文后缀，需要剥离
    model.trim_end_matches("[1m]")
}

fn create_slug(value: &str) -> String {
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::LlmChatMessage;

    #[test]
    fn detects_mimo_provider_compatibility() {
        let compatibility = provider_compatibility(
            "MiMo",
            "https://token-plan-cn.xiaomimimo.com/v1",
            "mimo-v2.5-pro",
        );

        assert_eq!(compatibility.auth_header, AuthHeaderMode::ApiKey);
        assert_eq!(compatibility.max_tokens_field, "max_completion_tokens");
        assert_eq!(
            compatibility.temperature_policy,
            TemperaturePolicy::MinimumOne
        );
        assert!(!compatibility.enable_thinking);
        assert_eq!(compatibility.minimum_max_tokens, None);
    }

    #[test]
    fn keeps_default_openai_compatible_request_shape() {
        let compatibility =
            provider_compatibility("Custom Provider", "https://provider.example/v1", "gpt-like");

        assert_eq!(compatibility.auth_header, AuthHeaderMode::Bearer);
        assert_eq!(compatibility.max_tokens_field, "max_tokens");
        assert_eq!(
            compatibility.temperature_policy,
            TemperaturePolicy::PassThrough
        );
        assert!(!compatibility.enable_thinking);
        assert_eq!(compatibility.minimum_max_tokens, None);
    }

    #[test]
    fn normalizes_mimo_zero_temperature() {
        let compatibility = provider_compatibility(
            "MiMo",
            "https://token-plan-cn.xiaomimimo.com/v1",
            "mimo-v2.5-pro",
        );

        assert_eq!(resolve_temperature(compatibility, 0.0), Some(1.0));
        assert_eq!(resolve_temperature(compatibility, 0.4), Some(1.0));
        assert_eq!(resolve_temperature(compatibility, 1.0), Some(1.0));
    }

    #[test]
    fn omits_temperature_for_kimi_fixed_sampling_models() {
        for model in ["kimi-k2.5", "kimi-k2.6", "kimi-k2.6-preview"] {
            let compatibility = provider_compatibility("Kimi", "https://api.moonshot.cn/v1", model);
            assert_eq!(compatibility.auth_header, AuthHeaderMode::Bearer);
            assert_eq!(compatibility.max_tokens_field, "max_tokens");
            assert_eq!(compatibility.temperature_policy, TemperaturePolicy::Omit);
            assert!(compatibility.enable_thinking);
            assert_eq!(compatibility.minimum_max_tokens, Some(32_768));
            assert_eq!(resolve_temperature(compatibility, 0.4), None);
            assert_eq!(resolve_max_tokens(compatibility, Some(64)), Some(32_768));
            assert_eq!(
                resolve_max_tokens(compatibility, Some(65_536)),
                Some(65_536)
            );
        }
    }

    #[test]
    fn preserves_thinking_for_kimi_reasoning_compatibility() {
        let compatibility =
            provider_compatibility("Kimi", "https://api.moonshot.cn/v1", "kimi-k2.6");
        let mut body = serde_json::json!({
            "model": "kimi-k2.6",
            "messages": [],
            "stream": false
        });

        apply_thinking_policy(&mut body, compatibility);

        assert_eq!(
            body.pointer("/thinking/type").and_then(Value::as_str),
            Some("enabled")
        );
        assert!(body.get("temperature").is_none());
    }

    #[test]
    fn keeps_temperature_for_non_fixed_kimi_models() {
        let compatibility = provider_compatibility("Kimi", "https://api.moonshot.cn/v1", "kimi-k3");
        assert_eq!(
            compatibility.temperature_policy,
            TemperaturePolicy::PassThrough
        );
        assert!(!compatibility.enable_thinking);
        assert_eq!(compatibility.minimum_max_tokens, None);
        assert_eq!(resolve_temperature(compatibility, 0.4), Some(0.4));
    }

    #[test]
    fn strips_ansi_escapes_from_values() {
        assert_eq!(strip_ansi_escapes("mimo-v2.5-pro"), "mimo-v2.5-pro");
        assert_eq!(strip_ansi_escapes("mimo-v2.5-pro\x1b[1m"), "mimo-v2.5-pro");
        assert_eq!(strip_ansi_escapes("\x1b[32mhello\x1b[0m"), "hello");
        assert_eq!(strip_ansi_escapes("normal text"), "normal text");
        assert_eq!(strip_ansi_escapes(""), "");
    }

    #[test]
    fn strips_mimo_context_suffix() {
        assert_eq!(
            strip_mimo_context_suffix("mimo-v2.5-pro[1m]"),
            "mimo-v2.5-pro"
        );
        assert_eq!(strip_mimo_context_suffix("mimo-v2.5-pro"), "mimo-v2.5-pro");
        assert_eq!(strip_mimo_context_suffix("gpt-4"), "gpt-4");
    }

    #[test]
    fn validates_and_normalizes_provider_urls() {
        assert_eq!(
            normalize_provider_base_url("https://API.Example.com/v1/").unwrap(),
            "https://api.example.com/v1"
        );
        assert_eq!(
            normalize_provider_base_url("http://127.0.0.1:11434/v1/").unwrap(),
            "http://127.0.0.1:11434/v1"
        );
        assert_eq!(
            normalize_provider_base_url("http://[::1]:11434/v1").unwrap(),
            "http://[::1]:11434/v1"
        );
        for invalid in [
            "api.example.com/v1",
            "http://api.example.com/v1",
            "https://user:password@api.example.com/v1",
            "ftp://api.example.com/v1",
            "https:///missing-host",
            "https://api.example.com/v1?api_key=secret",
            "https://api.example.com/v1#fragment",
            "http://192.168.1.20:11434/v1",
        ] {
            assert!(
                normalize_provider_base_url(invalid).is_err(),
                "{invalid} must be rejected"
            );
        }
    }

    #[test]
    fn endpoint_bound_key_rejects_endpoint_change_and_legacy_plaintext() {
        let bound = BoundProviderCredential {
            version: KEYCHAIN_CREDENTIAL_VERSION,
            endpoint_identity: "https://api.example.com/v1".to_string(),
            api_key: "anthropic-or-groq-random-key".to_string(),
        };
        let serialized = serde_json::to_string(&bound).unwrap();
        assert_eq!(
            decode_bound_provider_credential(&serialized, "https://api.example.com/v1").unwrap(),
            "anthropic-or-groq-random-key"
        );
        assert!(
            decode_bound_provider_credential(&serialized, "https://attacker.example/v1")
                .unwrap_err()
                .contains("endpoint changed")
        );
        assert!(decode_bound_provider_credential(
            "sk-ant-legacy-plaintext",
            "https://api.example.com/v1"
        )
        .unwrap_err()
        .contains("obsolete unbound"));
    }

    #[test]
    fn api_key_reference_format_is_strict_for_all_key_shapes() {
        assert!(validate_provider_api_key_ref(
            "keychain:teacher-agent:provider-api-key:provider-123"
        )
        .is_ok());
        for invalid in [
            "",
            "sk-ant-api-key",
            "cohere-random-long-key",
            "gsk_groq_key",
            "a-random-string-that-is-not-a-keychain-reference",
            "keychain:teacher-agent:provider-api-key:",
            "keychain:teacher-agent:provider-api-key:provider:extra",
            " keychain:teacher-agent:provider-api-key:provider-123",
        ] {
            assert!(
                validate_provider_api_key_ref(invalid).is_err(),
                "{invalid} must be rejected"
            );
        }
    }

    #[tokio::test]
    async fn provider_http_client_does_not_follow_redirects() {
        use std::io::{Read, Write};
        use std::net::TcpListener;

        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0u8; 1024];
            let _ = stream.read(&mut request);
            stream
                .write_all(
                    b"HTTP/1.1 302 Found\r\nLocation: https://attacker.example/\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                )
                .unwrap();
        });

        let client = build_provider_http_client(Duration::from_secs(5)).unwrap();
        let response = client
            .get(format!("http://{address}/redirect"))
            .send()
            .await
            .unwrap();
        assert_eq!(response.status().as_u16(), 302);
        server.join().unwrap();
    }

    #[tokio::test]
    async fn empty_content_with_finish_reason_length_is_reported_as_truncated() {
        use std::io::{Read, Write};
        use std::net::TcpListener;

        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0u8; 2048];
            let _ = stream.read(&mut request);
            stream
                .write_all(
                    b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n{\"choices\":[{\"finish_reason\":\"length\",\"message\":{\"content\":\"\"}}]}",
                )
                .unwrap();
        });

        let result = complete_llm_chat_with_provider(CompleteLlmChatInput {
            provider_name: "Local".to_string(),
            base_url: format!("http://{address}/v1"),
            model: "local-model".to_string(),
            api_key_ref: None,
            is_local: true,
            messages: vec![LlmChatMessage {
                role: "user".to_string(),
                content: serde_json::Value::String("Health check.".to_string()),
            }],
            temperature: Some(0.0),
            max_tokens: Some(8),
        })
        .await;

        server.join().unwrap();
        let error = result.expect_err("empty truncated content should be an error");
        assert_eq!(error.code, "truncated_empty");
        assert!(error.message.contains("finish_reason=length"));
    }

    #[tokio::test]
    async fn empty_content_without_length_is_reported_as_invalid_response() {
        use std::io::{Read, Write};
        use std::net::TcpListener;

        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0u8; 2048];
            let _ = stream.read(&mut request);
            stream
                .write_all(
                    b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n{\"choices\":[{\"finish_reason\":\"stop\",\"message\":{\"content\":\"\"}}]}",
                )
                .unwrap();
        });

        let result = complete_llm_chat_with_provider(CompleteLlmChatInput {
            provider_name: "Local".to_string(),
            base_url: format!("http://{address}/v1"),
            model: "local-model".to_string(),
            api_key_ref: None,
            is_local: true,
            messages: vec![LlmChatMessage {
                role: "user".to_string(),
                content: serde_json::Value::String("Health check.".to_string()),
            }],
            temperature: Some(0.0),
            max_tokens: Some(8),
        })
        .await;

        server.join().unwrap();
        let error = result.expect_err("empty content without length should be an error");
        assert_eq!(error.code, "invalid_response");
        assert!(error.message.contains("did not include assistant content"));
    }
}
