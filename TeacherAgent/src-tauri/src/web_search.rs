use serde::{Deserialize, Serialize};

use crate::shared::{redact_sensitive_text, truncate_for_storage};

const BOCHA_SEARCH_URL: &str = "https://api.bocha.cn/v1/web-search";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WebSearchResult {
    pub(crate) title: String,
    pub(crate) url: String,
    pub(crate) site_name: String,
    pub(crate) summary: String,
    pub(crate) published_time: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WebSearchResponse {
    pub(crate) query: String,
    pub(crate) results: Vec<WebSearchResult>,
    pub(crate) total: usize,
}

#[derive(Debug, Deserialize)]
struct BochaResponse {
    data: Option<BochaData>,
}

#[derive(Debug, Deserialize)]
struct BochaData {
    #[serde(rename = "webPages")]
    web_pages: Option<BochaWebPages>,
}

#[derive(Debug, Deserialize)]
struct BochaWebPages {
    value: Option<Vec<BochaWebPage>>,
}

#[derive(Debug, Deserialize)]
struct BochaWebPage {
    name: Option<String>,
    url: Option<String>,
    #[serde(rename = "displayUrl")]
    display_url: Option<String>,
    snippet: Option<String>,
    #[serde(rename = "dateLastCrawled")]
    date_last_crawled: Option<String>,
}

/// Perform a web search using the Bocha API.
///
/// # Arguments
/// * `api_key` - The Bocha API key
/// * `query` - The search query
/// * `count` - Number of results to return (max 20)
/// * `freshness` - Freshness filter ("noLimit", "day", "week", "month")
///
/// # Returns
/// A `WebSearchResponse` containing the search results
pub(crate) async fn bocha_web_search(
    api_key: &str,
    query: &str,
    count: u32,
    freshness: Option<&str>,
) -> Result<WebSearchResponse, String> {
    let client = reqwest::Client::new();
    let count = count.min(20);

    let body = serde_json::json!({
        "query": query,
        "summary": true,
        "freshness": freshness.unwrap_or("noLimit"),
        "count": count
    });

    let response = client
        .post(BOCHA_SEARCH_URL)
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&body)
        .timeout(std::time::Duration::from_secs(30))
        .send()
        .await
        .map_err(|error| format!("Bocha search request failed: {error}"))?;

    if !response.status().is_success() {
        let status = response.status();
        let body_text = truncate_for_storage(&response.text().await.unwrap_or_default(), 200);
        return Err(format!(
            "Bocha API returned {status}: {}",
            redact_sensitive_text(&body_text)
        ));
    }

    let bocha_response: BochaResponse = response
        .json()
        .await
        .map_err(|error| format!("failed to parse Bocha response: {error}"))?;

    let results = bocha_response
        .data
        .and_then(|d| d.web_pages)
        .and_then(|wp| wp.value)
        .unwrap_or_default()
        .into_iter()
        .map(|page| WebSearchResult {
            title: page.name.unwrap_or_default(),
            url: page.url.unwrap_or_default(),
            site_name: page.display_url.unwrap_or_default(),
            summary: page.snippet.unwrap_or_default(),
            published_time: page.date_last_crawled,
        })
        .collect::<Vec<_>>();

    let total = results.len();

    Ok(WebSearchResponse {
        query: query.to_string(),
        results,
        total,
    })
}
