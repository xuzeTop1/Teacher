use std::process::Command;
use std::time::Duration;

#[derive(Debug, serde::Deserialize)]
struct OllamaTagsResponse {
    models: Vec<OllamaTagModel>,
}

#[derive(Debug, serde::Deserialize)]
struct OllamaTagModel {
    name: String,
    model: Option<String>,
    modified_at: Option<String>,
    size: Option<u64>,
    details: Option<OllamaModelDetails>,
}

#[derive(Debug, serde::Deserialize)]
struct OllamaModelDetails {
    family: Option<String>,
    families: Option<Vec<String>>,
    parameter_size: Option<String>,
    quantization_level: Option<String>,
}

/// Check if Ollama is running by hitting the /api/tags endpoint.
pub(crate) async fn check_ollama_status() -> OllamaStatus {
    let client = reqwest::Client::new();
    match client
        .get("http://localhost:11434/api/tags")
        .timeout(Duration::from_secs(3))
        .send()
        .await
    {
        Ok(response) => {
            if response.status().is_success() {
                OllamaStatus {
                    running: true,
                    message: "Ollama 正在运行".to_string(),
                    version: None,
                }
            } else {
                OllamaStatus {
                    running: false,
                    message: format!("Ollama 返回状态码: {}", response.status()),
                    version: None,
                }
            }
        }
        Err(e) => OllamaStatus {
            running: false,
            message: format!("无法连接 Ollama: {}", e),
            version: None,
        },
    }
}

/// List locally available Ollama models from the read-only /api/tags endpoint.
pub(crate) async fn list_ollama_models() -> Result<OllamaModelList, String> {
    let client = reqwest::Client::new();
    let response = client
        .get("http://localhost:11434/api/tags")
        .timeout(Duration::from_secs(3))
        .send()
        .await
        .map_err(|error| format!("无法连接 Ollama: {error}"))?;

    if !response.status().is_success() {
        return Err(format!("Ollama 返回状态码: {}", response.status()));
    }

    let tags: OllamaTagsResponse = response
        .json()
        .await
        .map_err(|error| format!("无法解析 Ollama 模型列表: {error}"))?;

    let models: Vec<OllamaModelInfo> = tags
        .models
        .into_iter()
        .map(|model| {
            let details = model.details;
            OllamaModelInfo {
                name: model.name,
                model: model.model,
                modified_at: model.modified_at,
                size: model.size,
                family: details.as_ref().and_then(|item| item.family.clone()),
                families: details
                    .as_ref()
                    .and_then(|item| item.families.clone())
                    .unwrap_or_default(),
                parameter_size: details
                    .as_ref()
                    .and_then(|item| item.parameter_size.clone()),
                quantization_level: details.and_then(|item| item.quantization_level),
            }
        })
        .collect();

    let embedding_recommendation = recommend_embedding_model(&models);
    Ok(OllamaModelList {
        running: true,
        message: format!("检测到 {} 个 Ollama 模型", models.len()),
        models,
        embedding_recommendation,
    })
}

fn normalize_model_name(name: &str) -> &str {
    name.split(':').next().unwrap_or(name)
}

fn recommend_embedding_model(models: &[OllamaModelInfo]) -> Option<String> {
    const RECOMMENDED_EMBEDDING_MODELS: [&str; 3] =
        ["bge-m3", "nomic-embed-text", "mxbai-embed-large"];

    for recommended in RECOMMENDED_EMBEDDING_MODELS {
        if models.iter().any(|model| {
            normalize_model_name(&model.name).eq_ignore_ascii_case(recommended)
                || model
                    .model
                    .as_deref()
                    .map(normalize_model_name)
                    .is_some_and(|name| name.eq_ignore_ascii_case(recommended))
        }) {
            return Some(recommended.to_string());
        }
    }

    None
}

/// Try to start Ollama as a background process.
/// Returns Ok(status) if the start was attempted, Err if the command couldn't be launched.
pub(crate) async fn start_ollama_engine() -> Result<OllamaStatus, String> {
    // First check if already running
    let status = check_ollama_status().await;
    if status.running {
        return Ok(status);
    }

    // Try to start ollama serve in the background
    let result = if cfg!(target_os = "windows") {
        Command::new("cmd")
            .args(["/C", "start", "/B", "ollama", "serve"])
            .spawn()
    } else {
        Command::new("ollama").arg("serve").spawn()
    };

    match result {
        Ok(_) => {
            // Wait a moment for Ollama to start
            tokio::time::sleep(Duration::from_secs(2)).await;
            Ok(check_ollama_status().await)
        }
        Err(e) => Err(format!(
            "无法启动 Ollama: {}. 请确认已安装 Ollama 并添加到 PATH。",
            e
        )),
    }
}

#[derive(Debug, serde::Serialize)]
pub(crate) struct OllamaStatus {
    pub running: bool,
    pub message: String,
    pub version: Option<String>,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OllamaModelList {
    pub running: bool,
    pub message: String,
    pub models: Vec<OllamaModelInfo>,
    pub embedding_recommendation: Option<String>,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OllamaModelInfo {
    pub name: String,
    pub model: Option<String>,
    pub modified_at: Option<String>,
    pub size: Option<u64>,
    pub family: Option<String>,
    pub families: Vec<String>,
    pub parameter_size: Option<String>,
    pub quantization_level: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn model_info(name: &str) -> OllamaModelInfo {
        OllamaModelInfo {
            name: name.to_string(),
            model: Some(name.to_string()),
            modified_at: None,
            size: None,
            family: None,
            families: vec![],
            parameter_size: None,
            quantization_level: None,
        }
    }

    #[test]
    fn recommends_bge_m3_before_other_embedding_models() {
        let models = vec![
            model_info("nomic-embed-text:latest"),
            model_info("bge-m3:latest"),
        ];

        assert_eq!(
            recommend_embedding_model(&models),
            Some("bge-m3".to_string())
        );
    }

    #[test]
    fn returns_none_when_no_known_embedding_model_is_installed() {
        let models = vec![model_info("qwen3:8b")];

        assert_eq!(recommend_embedding_model(&models), None);
    }
}
