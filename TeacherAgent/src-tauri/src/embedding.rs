use std::time::Duration;

use serde_json::Value;
use tauri::ipc::Channel;

use crate::models::EmbeddingBatchProgress;
use crate::provider::{
    build_provider_http_client, is_loopback_provider_url, load_provider_api_key_ref_from_keychain,
    normalize_provider_base_url,
};

/// Parse embedding items from the `"data"` array of an embedding API response.
///
/// Each item is expected to have `"index"` (u64) and `"embedding"` (array of f64) fields.
/// Returns a sorted Vec of (index, Vec<f32>).
fn parse_embedding_batch_items(
    data: &[Value],
    error_prefix: &str,
) -> Result<Vec<(usize, Vec<f32>)>, String> {
    let mut batch_embeddings: Vec<(usize, Vec<f32>)> = Vec::new();
    for item in data {
        let index = item["index"]
            .as_u64()
            .ok_or_else(|| format!("{error_prefix} item missing numeric index"))?
            as usize;
        let embedding_data = item["embedding"]
            .as_array()
            .ok_or_else(|| format!("{error_prefix} missing embedding field"))?;
        let floats: Vec<f32> = embedding_data
            .iter()
            .map(|v| {
                v.as_f64()
                    .map(|value| value as f32)
                    .ok_or_else(|| format!("{error_prefix} embedding contains non-numeric value"))
            })
            .collect::<Result<_, _>>()?;
        batch_embeddings.push((index, floats));
    }
    batch_embeddings.sort_by_key(|(i, _)| *i);
    for (expected, (actual, _)) in batch_embeddings.iter().enumerate() {
        if *actual != expected {
            return Err(format!(
                "{error_prefix} indices must be contiguous from zero"
            ));
        }
    }
    Ok(batch_embeddings)
}

/// Generate a single embedding vector for the given text using an OpenAI-compatible embedding API.
pub(crate) async fn generate_embedding_for_text(
    base_url: &str,
    api_key_ref: &str,
    model: &str,
    input_text: &str,
) -> Result<Vec<f32>, String> {
    let normalized_base_url = normalize_provider_base_url(base_url)?;
    let api_key = if api_key_ref == "ollama-local" {
        if !is_loopback_provider_url(&normalized_base_url)? {
            return Err("ollama-local may only use a loopback endpoint".to_string());
        }
        // Ollama doesn't validate API keys; use a placeholder so the Bearer header is present.
        "ollama".to_string()
    } else {
        load_provider_api_key_ref_from_keychain(api_key_ref, &normalized_base_url)?
            .ok_or_else(|| "no API key found for the given reference".to_string())?
    };
    let client = build_provider_http_client(Duration::from_secs(30))
        .map_err(|error| format!("failed to create embedding HTTP client: {error}"))?;
    let url = format!(
        "{}/embeddings",
        normalized_base_url
            .trim_end_matches('/')
            .trim_end_matches("/chat/completions")
    );

    let body = serde_json::json!({
        "input": input_text,
        "model": model
    });

    let response = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&body)
        .timeout(Duration::from_secs(30))
        .send()
        .await
        .map_err(|_| "embedding request failed before a valid response was received".to_string())?;

    if !response.status().is_success() {
        let status = response.status();
        return Err(format!("embedding API returned {status}"));
    }

    let json: serde_json::Value = response
        .json()
        .await
        .map_err(|error| format!("failed to parse embedding response: {error}"))?;

    let embedding_data = json["data"]
        .as_array()
        .and_then(|arr| arr.first())
        .and_then(|item| item["embedding"].as_array())
        .ok_or_else(|| "embedding response missing data[0].embedding".to_string())?;

    let floats: Result<Vec<f32>, _> = embedding_data
        .iter()
        .map(|v| {
            v.as_f64()
                .map(|f| f as f32)
                .ok_or_else(|| "non-numeric value in embedding".to_string())
        })
        .collect();

    floats
}

/// Generate embeddings for a batch of texts, with batching, rate-limit retry, and progress reporting.
pub(crate) async fn generate_embeddings_batch_for_texts(
    base_url: &str,
    api_key_ref: &str,
    model: &str,
    texts: &[String],
    batch_size: Option<usize>,
    delay_ms: Option<u64>,
    progress_channel: &Channel<EmbeddingBatchProgress>,
) -> Result<Vec<Vec<f32>>, String> {
    if texts.is_empty() {
        return Ok(Vec::new());
    }

    let normalized_base_url = normalize_provider_base_url(base_url)?;
    let api_key = if api_key_ref == "ollama-local" {
        if !is_loopback_provider_url(&normalized_base_url)? {
            return Err("ollama-local may only use a loopback endpoint".to_string());
        }
        "ollama".to_string()
    } else {
        load_provider_api_key_ref_from_keychain(api_key_ref, &normalized_base_url)?
            .ok_or_else(|| "no API key found for the given reference".to_string())?
    };

    let client = build_provider_http_client(Duration::from_secs(60))
        .map_err(|error| format!("failed to create embedding HTTP client: {error}"))?;
    let url = format!(
        "{}/embeddings",
        normalized_base_url
            .trim_end_matches('/')
            .trim_end_matches("/chat/completions")
    );

    let chunk_size = batch_size.unwrap_or(64).clamp(1, 2048);
    let delay = delay_ms.unwrap_or(200).clamp(0, 10_000);
    let chunks: Vec<&[String]> = texts.chunks(chunk_size).collect();
    let total_batches = chunks.len();
    let mut all_embeddings: Vec<Vec<f32>> = Vec::with_capacity(texts.len());

    for (batch_idx, chunk) in chunks.iter().enumerate() {
        let body = serde_json::json!({
            "input": chunk,
            "model": model
        });

        let response = client
            .post(&url)
            .header("Authorization", format!("Bearer {}", api_key))
            .header("Content-Type", "application/json")
            .json(&body)
            .timeout(Duration::from_secs(60))
            .send()
            .await
            .map_err(|_| {
                "embedding batch request failed before a valid response was received".to_string()
            })?;

        if !response.status().is_success() {
            let status = response.status();
            // Rate limit: retry once after delay
            if status.as_u16() == 429 {
                tokio::time::sleep(Duration::from_millis(delay.saturating_mul(5))).await;
                let retry_response = client
                    .post(&url)
                    .header("Authorization", format!("Bearer {}", api_key))
                    .header("Content-Type", "application/json")
                    .json(&body)
                    .timeout(Duration::from_secs(60))
                    .send()
                    .await
                    .map_err(|_| {
                        "embedding batch retry failed before a valid response was received"
                            .to_string()
                    })?;

                if !retry_response.status().is_success() {
                    let retry_status = retry_response.status();
                    return Err(format!("embedding API returned {retry_status} after retry"));
                }

                let retry_json: serde_json::Value =
                    retry_response.json().await.map_err(|error| {
                        format!("failed to parse retry embedding response: {error}")
                    })?;

                let retry_data = retry_json["data"]
                    .as_array()
                    .ok_or_else(|| "retry embedding response missing data array".to_string())?;

                let batch_embeddings = parse_embedding_batch_items(retry_data, "retry embedding")?;
                if batch_embeddings.len() != chunk.len() {
                    return Err(
                        "retry embedding response count does not match request batch".to_string(),
                    );
                }
                for (_, emb) in batch_embeddings {
                    all_embeddings.push(emb);
                }
            } else {
                return Err(format!("embedding API returned {status}"));
            }
        } else {
            let json: serde_json::Value = response
                .json()
                .await
                .map_err(|error| format!("failed to parse embedding response: {error}"))?;

            let data = json["data"]
                .as_array()
                .ok_or_else(|| "embedding response missing data array".to_string())?;

            let batch_embeddings = parse_embedding_batch_items(data, "embedding")?;
            if batch_embeddings.len() != chunk.len() {
                return Err("embedding response count does not match request batch".to_string());
            }
            for (_, emb) in batch_embeddings {
                all_embeddings.push(emb);
            }
        }

        // Emit progress
        let _ = progress_channel.send(EmbeddingBatchProgress {
            completed: all_embeddings.len(),
            total: texts.len(),
            batch_index: batch_idx,
            total_batches,
        });

        // Delay between batches (skip after last batch)
        if batch_idx + 1 < total_batches {
            tokio::time::sleep(Duration::from_millis(delay)).await;
        }
    }

    Ok(all_embeddings)
}
