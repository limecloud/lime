use serde_json::{json, Value};
use tool_runtime::{
    tool_executor::RuntimeToolExecutionRequest, web_fetch::WebFetchInput,
    web_search::WebSearchInput,
};

pub(super) struct Prepared {
    pub path: &'static str,
    pub input: Value,
}

pub(super) fn prepare(request: &RuntimeToolExecutionRequest<'_>) -> Result<Prepared, String> {
    if let Some(key) = request.params.get("operation_key") {
        if !key.as_str().is_some_and(|key| {
            key.strip_prefix("tool_").is_some_and(|hash| {
                hash.len() == 64
                    && hash
                        .bytes()
                        .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
            })
        }) {
            return Err("cloud_tool_input_invalid".into());
        }
    }
    match request.tool_name {
        "WebSearch" => {
            fields(
                request.params,
                &[
                    "query",
                    "allowed_domains",
                    "blocked_domains",
                    "operation_key",
                ],
            )?;
            let input: WebSearchInput = serde_json::from_value(request.params.clone())
                .map_err(|_| "cloud_tool_input_invalid")?;
            let query = input.query.trim();
            if !(2..=500).contains(&query.chars().count()) || query.chars().any(char::is_control) {
                return Err("cloud_tool_input_invalid".into());
            }
            domains(input.allowed_domains.as_deref())?;
            domains(input.blocked_domains.as_deref())?;
            Ok(Prepared {
                path: "/web/searches",
                input: json!({"query":query,"limit":10}),
            })
        }
        "WebFetch" => {
            fields(
                request.params,
                &[
                    "url",
                    "prompt",
                    "focus_query",
                    "dynamic_filter",
                    "max_chars",
                    "max_chunks",
                    "operation_key",
                ],
            )?;
            let input: WebFetchInput = serde_json::from_value(request.params.clone())
                .map_err(|_| "cloud_tool_input_invalid")?;
            let url = reqwest::Url::parse(&input.url).map_err(|_| "cloud_tool_input_invalid")?;
            if !valid_url(&url, true)
                || url.fragment().is_some()
                || input.url.len() > 2048
                || input.url.chars().any(char::is_control)
                || input.max_chars.is_some_and(|n| !(500..=50000).contains(&n))
                || input.max_chunks.is_some_and(|n| !(1..=100).contains(&n))
                || input.prompt.len() > 16000
                || input.focus_query.as_ref().is_some_and(|q| q.len() > 16000)
            {
                return Err("cloud_tool_input_invalid".into());
            }
            // Filtering instructions stay local. Cloud only receives the URL and response bound.
            Ok(Prepared {
                path: "/web/pages",
                input: json!({"url":input.url,"maxCharacters":input.max_chars.unwrap_or(20000)}),
            })
        }
        _ => Err("cloud_tool_unavailable".into()),
    }
}

pub(super) fn project(
    request: &RuntimeToolExecutionRequest<'_>,
    mut body: Value,
) -> Result<Value, String> {
    let expected = if request.tool_name == "WebSearch" {
        "search"
    } else {
        "page"
    };
    if body["kind"] != expected
        || !body["id"]
            .as_str()
            .is_some_and(super::super::cloud::identifier)
    {
        return Err("cloud_response_invalid".into());
    }
    match body["status"].as_str() {
        Some("running" | "failed" | "outcome_unknown") => return Ok(body),
        Some("completed") => {}
        _ => return Err("cloud_response_invalid".into()),
    }
    if expected == "search" {
        let input: WebSearchInput = serde_json::from_value(request.params.clone())
            .map_err(|_| "cloud_tool_input_invalid")?;
        let allowed = domains(input.allowed_domains.as_deref())?;
        let blocked = domains(input.blocked_domains.as_deref())?;
        let items = body["search"]["items"]
            .as_array_mut()
            .ok_or("cloud_response_invalid")?;
        if items.len() > 10 {
            return Err("cloud_response_invalid".into());
        }
        for item in items.iter() {
            if !item["title"].is_string()
                || !item["summary"].is_string()
                || !item["retrievedAt"].is_string()
                || !item["url"]
                    .as_str()
                    .and_then(|u| reqwest::Url::parse(u).ok())
                    .is_some_and(|u| valid_url(&u, false))
            {
                return Err("cloud_response_invalid".into());
            }
        }
        items.retain(|item| {
            let url = reqwest::Url::parse(item["url"].as_str().unwrap()).unwrap();
            let host = url.host_str().unwrap_or_default();
            (allowed.is_empty() || allowed.iter().any(|d| matches_domain(host, d)))
                && !blocked.iter().any(|d| matches_domain(host, d))
        });
    } else {
        let input: WebFetchInput = serde_json::from_value(request.params.clone())
            .map_err(|_| "cloud_tool_input_invalid")?;
        let page = body
            .get_mut("page")
            .filter(|p| p.is_object())
            .ok_or("cloud_response_invalid")?;
        if page["url"] != input.url
            || !page["finalUrl"]
                .as_str()
                .and_then(|u| reqwest::Url::parse(u).ok())
                .is_some_and(|u| valid_url(&u, true))
        {
            return Err("cloud_response_invalid".into());
        }
        let text = page["text"].as_str().ok_or("cloud_response_invalid")?;
        if text.chars().count() > 50000 {
            return Err("cloud_response_invalid".into());
        }
        let (excerpt, filtered) = tool_runtime::web_fetch::prepare_web_page_text(text, &input);
        page["text"] = json!(excerpt);
        page["filtered"] = json!(filtered);
    }
    Ok(body)
}

fn fields(params: &Value, allowed: &[&str]) -> Result<(), String> {
    let fields = params.as_object().ok_or("cloud_tool_input_invalid")?;
    if fields.keys().any(|key| !allowed.contains(&key.as_str())) {
        return Err("cloud_tool_input_invalid".into());
    }
    Ok(())
}

fn valid_url(url: &reqwest::Url, https_only: bool) -> bool {
    (url.scheme() == "https" || !https_only && url.scheme() == "http")
        && url.host_str().is_some()
        && url.username().is_empty()
        && url.password().is_none()
}

fn domains(input: Option<&[String]>) -> Result<Vec<String>, String> {
    let Some(input) = input else {
        return Ok(Vec::new());
    };
    if input.len() > 100 {
        return Err("cloud_tool_input_invalid".into());
    }
    input
        .iter()
        .map(|value| {
            if value.is_empty()
                || value.len() > 253
                || value.contains(['/', '?', '#', ':', '@', '%'])
                || value.chars().any(char::is_whitespace)
            {
                return Err("cloud_tool_input_invalid".into());
            }
            let parsed = reqwest::Url::parse(&format!("https://{value}"))
                .map_err(|_| "cloud_tool_input_invalid")?;
            parsed
                .host_str()
                .map(|h| h.trim_end_matches('.').to_ascii_lowercase())
                .filter(|h| !h.is_empty())
                .ok_or_else(|| "cloud_tool_input_invalid".into())
        })
        .collect()
}

fn matches_domain(host: &str, domain: &str) -> bool {
    let host = host.trim_end_matches('.').to_ascii_lowercase();
    host == domain || host.ends_with(&format!(".{domain}"))
}
