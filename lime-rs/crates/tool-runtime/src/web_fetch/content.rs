use scraper::{Html, Selector};

const DEFAULT_WEB_FETCH_MAX_CHARS: usize = 20_000;
const DEFAULT_DYNAMIC_FILTER_MAX_CHARS: usize = 12_000;
const DEFAULT_DYNAMIC_FILTER_MAX_CHUNKS: usize = 8;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebFetchInput {
    pub url: String,
    pub prompt: String,
    #[serde(default)]
    pub focus_query: Option<String>,
    #[serde(default)]
    pub dynamic_filter: bool,
    #[serde(default)]
    pub max_chars: Option<usize>,
    #[serde(default)]
    pub max_chunks: Option<usize>,
}

#[derive(Debug, Clone, Copy)]
struct WebFetchContentOptions<'a> {
    prompt: &'a str,
    focus_query: Option<&'a str>,
    dynamic_filter: bool,
    max_chars: Option<usize>,
    max_chunks: Option<usize>,
}

#[derive(Debug, Clone)]
struct CachedWebFetchContent {
    content: String,
    content_type: String,
    status_code: u16,
    fetched_at: SystemTime,
}

#[derive(Default)]
struct WebFetchCache {
    entries: Mutex<HashMap<String, CachedWebFetchContent>>,
}

impl WebFetchCache {
    fn get(&self, url: &str) -> Option<CachedWebFetchContent> {
        let mut entries = self.entries.lock().ok()?;
        let cached = entries.get(url)?;
        if cached.fetched_at.elapsed().unwrap_or(Duration::MAX) < WEB_FETCH_CACHE_TTL {
            return Some(cached.clone());
        }
        entries.remove(url);
        None
    }

    fn insert(&self, url: String, content: CachedWebFetchContent) {
        if let Ok(mut entries) = self.entries.lock() {
            if entries.len() >= WEB_FETCH_CACHE_CAPACITY {
                if let Some(oldest_key) = entries
                    .iter()
                    .min_by_key(|(_, cached)| cached.fetched_at)
                    .map(|(key, _)| key.clone())
                {
                    entries.remove(&oldest_key);
                }
            }
            entries.insert(url, content);
        }
    }
}

#[derive(Debug, Clone)]
enum WebFetchResponse {
    Content {
        content: String,
        content_type: String,
        status_code: u16,
    },
    Redirect {
        original_url: String,
        redirect_url: String,
        status_code: u16,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WebFetchOutput {
    bytes: usize,
    code: u16,
    code_text: String,
    result: String,
    duration_ms: u64,
    url: String,
}

fn runtime_web_fetch_error(message: impl Into<String>) -> RuntimeToolExecutionError {
    let message = message.into();
    RuntimeToolExecutionError::new(
        message.clone(),
        Some(RuntimeToolPolicyErrorKind::ExecutionFailed(message)),
    )
}

fn ensure_not_cancelled(
    request: RuntimeToolExecutionRequest<'_>,
) -> Result<(), RuntimeToolExecutionError> {
    if request
        .context
        .cancel_token()
        .is_some_and(|token| token.is_cancelled())
    {
        return Err(runtime_web_fetch_error("web fetch cancelled"));
    }
    Ok(())
}

fn normalize_fetch_url(raw_url: &str) -> Result<String, RuntimeToolExecutionError> {
    let mut parsed = Url::parse(raw_url.trim())
        .map_err(|error| runtime_web_fetch_error(format!("无效的 URL: {error}")))?;
    match parsed.scheme() {
        "http" => {
            parsed
                .set_scheme("https")
                .map_err(|_| runtime_web_fetch_error("无法将 HTTP URL 升级为 HTTPS"))?;
        }
        "https" => {}
        scheme => {
            return Err(runtime_web_fetch_error(format!(
                "WebFetch 仅支持 http/https URL，当前 scheme={scheme}"
            )));
        }
    }
    Ok(parsed.to_string())
}

fn check_web_fetch_url_safety(url: &Url) -> Result<(), String> {
    match url.host() {
        Some(Host::Domain(host)) => check_domain_safety(host),
        Some(Host::Ipv4(address)) => {
            if address.is_private()
                || address.is_loopback()
                || address.is_link_local()
                || address.is_unspecified()
            {
                return Err(format!("私有 IP 地址 {address} 被禁止访问"));
            }
            Ok(())
        }
        Some(Host::Ipv6(address)) => {
            if address.is_loopback()
                || address.is_unspecified()
                || address.is_unique_local()
                || address.is_unicast_link_local()
            {
                return Err(format!("私有 IP 地址 {address} 被禁止访问"));
            }
            Ok(())
        }
        None => Err("无效的主机名".to_string()),
    }
}

fn check_domain_safety(host: &str) -> Result<(), String> {
    let host_lower = host.trim().trim_matches(['[', ']']).to_ascii_lowercase();
    let unsafe_domains = [
        "localhost",
        "127.0.0.1",
        "0.0.0.0",
        "::1",
        "169.254.169.254",
        "metadata.google.internal",
    ];

    for unsafe_domain in unsafe_domains {
        if host_lower == unsafe_domain || host_lower.ends_with(&format!(".{unsafe_domain}")) {
            return Err(format!("域名 {host} 因安全原因被禁止访问"));
        }
    }

    if let Ok(address) = host_lower.parse::<std::net::IpAddr>() {
        match address {
            std::net::IpAddr::V4(address)
                if address.is_private()
                    || address.is_loopback()
                    || address.is_link_local()
                    || address.is_unspecified() =>
            {
                return Err(format!("私有 IP 地址 {host} 被禁止访问"));
            }
            std::net::IpAddr::V6(address)
                if address.is_loopback()
                    || address.is_unspecified()
                    || address.is_unique_local()
                    || address.is_unicast_link_local() =>
            {
                return Err(format!("私有 IP 地址 {host} 被禁止访问"));
            }
            _ => {}
        }
    }

    Ok(())
}

fn strip_www_prefix(hostname: &str) -> &str {
    hostname.strip_prefix("www.").unwrap_or(hostname)
}

fn is_permitted_web_fetch_redirect(original_url: &Url, redirect_url: &Url) -> bool {
    if redirect_url.scheme() != original_url.scheme() {
        return false;
    }
    if redirect_url.port_or_known_default() != original_url.port_or_known_default() {
        return false;
    }
    if !redirect_url.username().is_empty() || redirect_url.password().is_some() {
        return false;
    }

    strip_www_prefix(redirect_url.host_str().unwrap_or_default())
        == strip_www_prefix(original_url.host_str().unwrap_or_default())
}

fn normalize_response_body(body: &str, content_type: &str) -> String {
    if content_type.contains("text/html") {
        html_to_markdown(body)
    } else if content_type.contains("application/json") {
        serde_json::from_str::<Value>(body)
            .ok()
            .and_then(|json| serde_json::to_string_pretty(&json).ok())
            .unwrap_or_else(|| body.to_string())
    } else {
        body.to_string()
    }
}

fn runtime_result_from_content(
    url: &str,
    cached: CachedWebFetchContent,
    input: &WebFetchInput,
    started_at: Instant,
    cache_hit: bool,
) -> Result<RuntimeToolExecutionResult, RuntimeToolExecutionError> {
    let (content, filtered) = prepare_response_content(
        &cached.content,
        WebFetchContentOptions {
            prompt: &input.prompt,
            focus_query: input.focus_query.as_deref(),
            dynamic_filter: input.dynamic_filter,
            max_chars: input.max_chars,
            max_chunks: input.max_chunks,
        },
    );
    let result = if filtered {
        format!("{content}\n\n[dynamic_filter_applied]")
    } else {
        content
    };
    let duration_ms = started_at
        .elapsed()
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX);
    let output = WebFetchOutput {
        bytes: cached.content.len(),
        code: cached.status_code,
        code_text: http_status_text(cached.status_code).to_string(),
        result,
        duration_ms,
        url: url.to_string(),
    };
    runtime_result_from_output(
        output,
        HashMap::from([
            ("url".to_string(), json!(url)),
            ("code".to_string(), json!(cached.status_code)),
            ("bytes".to_string(), json!(cached.content.len())),
            ("durationMs".to_string(), json!(duration_ms)),
            ("contentType".to_string(), json!(cached.content_type)),
            ("cache_hit".to_string(), json!(cache_hit)),
        ]),
    )
}

/// Apply the same local excerpt policy to text returned by a trusted web gateway.
/// The text remains external data; this function never runs another network request.
pub fn prepare_web_page_text(text: &str, input: &WebFetchInput) -> (String, bool) {
    prepare_response_content(
        text,
        WebFetchContentOptions {
            prompt: &input.prompt,
            focus_query: input.focus_query.as_deref(),
            dynamic_filter: input.dynamic_filter,
            max_chars: input.max_chars,
            max_chunks: input.max_chunks,
        },
    )
}

fn runtime_result_from_redirect(
    url: &str,
    input: &WebFetchInput,
    original_url: String,
    redirect_url: String,
    status_code: u16,
    started_at: Instant,
) -> Result<RuntimeToolExecutionResult, RuntimeToolExecutionError> {
    let status_text = http_status_text(status_code).to_string();
    let message = format!(
        "REDIRECT DETECTED: The URL redirects to a different host.\n\nOriginal URL: {original_url}\nRedirect URL: {redirect_url}\nStatus: {status_code} {status_text}\n\nTo complete your request, call WebFetch again with:\n- url: \"{redirect_url}\"\n- prompt: \"{}\"",
        input.prompt
    );
    let duration_ms = started_at
        .elapsed()
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX);
    let output = WebFetchOutput {
        bytes: message.len(),
        code: status_code,
        code_text: status_text,
        result: message,
        duration_ms,
        url: url.to_string(),
    };
    runtime_result_from_output(
        output,
        HashMap::from([
            ("url".to_string(), json!(url)),
            ("code".to_string(), json!(status_code)),
            ("bytes".to_string(), json!(redirect_url.len())),
            ("durationMs".to_string(), json!(duration_ms)),
            (
                "redirect".to_string(),
                json!({
                    "originalUrl": original_url,
                    "redirectUrl": redirect_url,
                    "statusCode": status_code,
                }),
            ),
        ]),
    )
}

fn runtime_result_from_output(
    output: WebFetchOutput,
    metadata: HashMap<String, Value>,
) -> Result<RuntimeToolExecutionResult, RuntimeToolExecutionError> {
    let serialized = serde_json::to_string_pretty(&output)
        .map_err(|error| runtime_web_fetch_error(format!("序列化 WebFetch 结果失败: {error}")))?;
    Ok(RuntimeToolExecutionResult::new(
        true, serialized, None, metadata,
    ))
}

fn html_to_markdown(html: &str) -> String {
    let cleaned_html = remove_non_content_html_blocks(html);
    let cleaned_html = remove_html_noise_attributes(&cleaned_html);
    html_to_text(&cleaned_html)
}

fn prepare_response_content(
    content: &str,
    options: WebFetchContentOptions<'_>,
) -> (String, bool) {
    let default_max_chars = if options.dynamic_filter || options.focus_query.is_some() {
        DEFAULT_DYNAMIC_FILTER_MAX_CHARS
    } else {
        DEFAULT_WEB_FETCH_MAX_CHARS
    };
    let max_chars = options
        .max_chars
        .unwrap_or(default_max_chars)
        .clamp(500, DEFAULT_WEB_FETCH_MAX_CHARS);
    let query = options
        .focus_query
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(options.prompt);
    let max_chunks = options
        .max_chunks
        .unwrap_or(DEFAULT_DYNAMIC_FILTER_MAX_CHUNKS);

    if let Some(filtered) = dynamic_filter_content(content, query, max_chars, max_chunks) {
        return (filtered, true);
    }

    (truncate_chars(content, max_chars), false)
}

fn remove_non_content_html_blocks(html: &str) -> String {
    let block_re = regex::Regex::new(
        r"(?is)<(?:script|style|noscript|iframe|object|embed|svg|head|template)\b[^>]*>.*?</(?:script|style|noscript|iframe|object|embed|svg|head|template)>",
    )
    .unwrap();
    let standalone_re = regex::Regex::new(r"(?is)<(?:meta|link|base)\b[^>]*(?:/?>)").unwrap();
    let comment_re = regex::Regex::new(r"(?is)<!--.*?-->").unwrap();
    let without_blocks = block_re.replace_all(html, " ");
    let without_standalone = standalone_re.replace_all(without_blocks.as_ref(), " ");
    comment_re
        .replace_all(without_standalone.as_ref(), " ")
        .into_owned()
}

fn remove_html_noise_attributes(html: &str) -> String {
    let attr_re = regex::Regex::new(
        r#"(?is)\s(?:style|class|id|role|tabindex|aria-[\w:-]+|data-[\w:-]+|on[a-z][\w:-]*)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+)"#,
    )
    .unwrap();
    attr_re.replace_all(html, " ").into_owned()
}

fn html_to_text(html: &str) -> String {
    let document = Html::parse_document(html);
    let body_selector = Selector::parse("body").unwrap();
    let mut text_parts = document
        .select(&body_selector)
        .flat_map(|body| body.text())
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .collect::<Vec<_>>();

    if text_parts.is_empty() {
        text_parts = document
            .root_element()
            .text()
            .map(str::trim)
            .filter(|text| !text.is_empty())
            .collect::<Vec<_>>();
    }

    let re_whitespace = regex::Regex::new(r"\s+").unwrap();
    let joined = text_parts.join(" ");
    let cleaned = re_whitespace.replace_all(&joined, " ");

    cleaned
        .replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#x27;", "'")
        .trim()
        .to_string()
}

fn truncate_chars(text: &str, max_chars: usize) -> String {
    if text.chars().count() <= max_chars {
        return text.to_string();
    }
    let truncated = text.chars().take(max_chars).collect::<String>();
    format!("{}...\n\n[内容已截断]", truncated)
}

fn split_into_chunks(content: &str, max_chunk_chars: usize) -> Vec<String> {
    let mut chunks = Vec::new();

    for paragraph in content.split("\n\n") {
        let paragraph = paragraph.trim();
        if paragraph.is_empty() {
            continue;
        }
        if paragraph.chars().count() <= max_chunk_chars {
            chunks.push(paragraph.to_string());
            continue;
        }

        let mut current = String::new();
        for character in paragraph.chars() {
            current.push(character);
            if current.chars().count() >= max_chunk_chars {
                chunks.push(current.clone());
                current.clear();
            }
        }
        if !current.is_empty() {
            chunks.push(current);
        }
    }

    if chunks.is_empty() {
        chunks.push(content.to_string());
    }

    chunks
}

fn dynamic_filter_content(
    content: &str,
    query: &str,
    max_chars: usize,
    max_chunks: usize,
) -> Option<String> {
    let terms = query
        .split_whitespace()
        .map(|term| term.trim().to_lowercase())
        .filter(|term| term.len() >= 2)
        .collect::<Vec<_>>();
    if terms.is_empty() {
        return None;
    }

    let chunks = split_into_chunks(content, 1_500);
    let mut scored = chunks
        .iter()
        .enumerate()
        .filter_map(|(index, chunk)| {
            let lower = chunk.to_lowercase();
            let score = terms
                .iter()
                .map(|term| lower.matches(term).count())
                .sum::<usize>();
            (score > 0).then_some((index, score))
        })
        .collect::<Vec<_>>();
    if scored.is_empty() {
        return None;
    }

    scored.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    let mut selected_indices = scored
        .into_iter()
        .take(max_chunks.max(1))
        .map(|(index, _)| index)
        .collect::<Vec<_>>();
    selected_indices.sort_unstable();

    let selected = selected_indices
        .into_iter()
        .filter_map(|index| chunks.get(index))
        .cloned()
        .collect::<Vec<_>>()
        .join("\n\n");

    Some(truncate_chars(&selected, max_chars))
}

fn http_status_text(status_code: u16) -> &'static str {
    match status_code {
        200 => "OK",
        201 => "Created",
        202 => "Accepted",
        204 => "No Content",
        301 => "Moved Permanently",
        302 => "Found",
        307 => "Temporary Redirect",
        308 => "Permanent Redirect",
        400 => "Bad Request",
        401 => "Unauthorized",
        403 => "Forbidden",
        404 => "Not Found",
        429 => "Too Many Requests",
        500 => "Internal Server Error",
        502 => "Bad Gateway",
        503 => "Service Unavailable",
        504 => "Gateway Timeout",
        _ => "Unknown",
    }
}

fn tool_lookup_key(tool_name: &str) -> String {
    tool_name
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .map(|character| character.to_ascii_lowercase())
        .collect()
}

#[cfg(test)]
mod content_tests {
    use super::{html_to_markdown, prepare_response_content, WebFetchContentOptions};

    #[test]
    fn dynamic_filter_content_prefers_relevant_chunks() {
        let content = "Football match report and scores.\n\nRust ownership and borrow checker explanation.\n\nTravel tips and hotel recommendations.";
        let (filtered, used_dynamic_filter) = prepare_response_content(
            content,
            WebFetchContentOptions {
                prompt: "总结 Rust 所有权",
                focus_query: Some("Rust ownership borrow checker"),
                dynamic_filter: true,
                max_chars: Some(3000),
                max_chunks: Some(2),
            },
        );

        assert!(used_dynamic_filter);
        assert!(filtered.contains("Rust ownership"));
        assert!(!filtered.contains("Football match report"));
    }

    #[test]
    fn default_mode_prefers_relevant_chunks() {
        let content = "Football match report and scores.\n\nRust ownership and borrow checker explanation.\n\nTravel tips and hotel recommendations.";
        let (result, used_dynamic_filter) = prepare_response_content(
            content,
            WebFetchContentOptions {
                prompt: "总结 Rust 所有权",
                focus_query: None,
                dynamic_filter: false,
                max_chars: Some(3000),
                max_chunks: None,
            },
        );

        assert!(used_dynamic_filter);
        assert!(result.contains("Rust ownership"));
        assert!(!result.contains("Football match report"));
    }

    #[test]
    fn html_text_removes_scripts_and_styles() {
        let html = r#"
            <html>
              <head>
                <style>.Modal-modalBackground{background:#000}</style>
                <script>alert('x')</script>
                <meta name="description" content="noise">
              </head>
              <body>Hello <b>world</b></body>
            </html>
        "#;

        let text = html_to_markdown(html);
        assert_eq!(text, "Hello world");
        assert!(!text.contains("Modal-modalBackground"));
        assert!(!text.contains("alert"));
    }

    #[test]
    fn html_text_removes_inline_style_attribute_noise() {
        let html = r#"
            <html>
              <body>
                <main>
                  <h1 class="wp-block-heading"
                      style="mask-image:url('data:image/svg+xml;utf8,<svg></svg>');mask-mode:alpha;-webkit-mask-position:center">
                    Promoting Advanced Artificial Intelligence Innovation and Security
                  </h1>
                  <p data-wp-interactive="core/image" aria-label="Share Icon">Confirmed policy detail.</p>
                </main>
              </body>
            </html>
        "#;

        let text = html_to_markdown(html);
        assert!(text.contains("Promoting Advanced Artificial Intelligence Innovation and Security"));
        assert!(text.contains("Confirmed policy detail."));
        assert!(!text.contains("mask-image"));
        assert!(!text.contains("wp-block"));
        assert!(!text.contains("data:image"));
        assert!(!text.contains("aria-label"));
    }
}
