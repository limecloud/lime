#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebSearchInput {
    pub query: String,
    pub allowed_domains: Option<Vec<String>>,
    pub blocked_domains: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SearchResult {
    pub title: String,
    pub url: String,
    pub snippet: Option<String>,
    pub publish_date: Option<String>,
}

#[derive(Debug, Clone)]
struct CachedSearchResults {
    query: String,
    results: Vec<SearchResult>,
    fetched_at: SystemTime,
    allowed_domains: Option<Vec<String>>,
    blocked_domains: Option<Vec<String>>,
}

#[derive(Default)]
struct WebSearchCache {
    entries: Mutex<HashMap<String, CachedSearchResults>>,
}

impl WebSearchCache {
    fn get(&self, cache_key: &str) -> Option<CachedSearchResults> {
        let mut entries = self.entries.lock().ok()?;
        let cached = entries.get(cache_key)?;
        if cached.fetched_at.elapsed().unwrap_or(Duration::MAX) < WEB_SEARCH_CACHE_TTL {
            return Some(cached.clone());
        }
        entries.remove(cache_key);
        None
    }

    fn insert(&self, cache_key: String, results: CachedSearchResults) {
        if let Ok(mut entries) = self.entries.lock() {
            entries.insert(cache_key, results);
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
enum SearchProviderKind {
    Tavily,
    MultiSearchEngine,
    BingSearchApi,
    GoogleCustomSearch,
    DuckduckgoInstant,
}

impl SearchProviderKind {
    fn as_env_value(self) -> &'static str {
        match self {
            Self::Tavily => "tavily",
            Self::MultiSearchEngine => "multi_search_engine",
            Self::BingSearchApi => "bing_search_api",
            Self::GoogleCustomSearch => "google_custom_search",
            Self::DuckduckgoInstant => "duckduckgo_instant",
        }
    }

    fn from_env_value(raw: &str) -> Option<Self> {
        match raw.trim().to_ascii_lowercase().as_str() {
            "tavily" => Some(Self::Tavily),
            "multi_search_engine" => Some(Self::MultiSearchEngine),
            "bing_search_api" => Some(Self::BingSearchApi),
            "google_custom_search" => Some(Self::GoogleCustomSearch),
            "duckduckgo_instant" => Some(Self::DuckduckgoInstant),
            _ => None,
        }
    }
}

const DEFAULT_SEARCH_PROVIDER_PRIORITY: [SearchProviderKind; 5] = [
    SearchProviderKind::Tavily,
    SearchProviderKind::MultiSearchEngine,
    SearchProviderKind::BingSearchApi,
    SearchProviderKind::GoogleCustomSearch,
    SearchProviderKind::DuckduckgoInstant,
];

#[derive(Debug, Clone)]
struct SearchRuntimeConfig {
    priority: Vec<SearchProviderKind>,
}

impl SearchRuntimeConfig {
    fn from_env() -> Self {
        let mut env = HashMap::new();
        for key in ["WEB_SEARCH_PROVIDER", "WEB_SEARCH_PROVIDER_PRIORITY"] {
            if let Ok(value) = std::env::var(key) {
                env.insert(key.to_string(), value);
            }
        }
        Self::from_env_map(&env)
    }

    fn from_env_map(env: &HashMap<String, String>) -> Self {
        let mut resolved = Vec::new();

        if let Some(raw_priority) = env
            .get("WEB_SEARCH_PROVIDER_PRIORITY")
            .map(|value| value.trim())
            .filter(|value| !value.is_empty())
        {
            for raw in raw_priority.split(',') {
                if let Some(provider) = SearchProviderKind::from_env_value(raw) {
                    push_unique_provider(&mut resolved, provider);
                }
            }
        }

        if resolved.is_empty() {
            if let Some(provider) = env
                .get("WEB_SEARCH_PROVIDER")
                .and_then(|value| SearchProviderKind::from_env_value(value))
            {
                push_unique_provider(&mut resolved, provider);
            }
        }

        for provider in DEFAULT_SEARCH_PROVIDER_PRIORITY {
            push_unique_provider(&mut resolved, provider);
        }

        Self { priority: resolved }
    }
}

#[derive(Debug, Clone)]
struct SearchAttempt {
    provider: SearchProviderKind,
    status: &'static str,
    result_count: usize,
    error: Option<String>,
}

impl SearchAttempt {
    fn success(provider: SearchProviderKind, result_count: usize) -> Self {
        Self {
            provider,
            status: "success",
            result_count,
            error: None,
        }
    }

    fn empty(provider: SearchProviderKind) -> Self {
        Self {
            provider,
            status: "empty",
            result_count: 0,
            error: None,
        }
    }

    fn error(provider: SearchProviderKind, error: String) -> Self {
        Self {
            provider,
            status: "error",
            result_count: 0,
            error: Some(error),
        }
    }

    fn as_json(&self) -> Value {
        json!({
            "provider": self.provider.as_env_value(),
            "status": self.status,
            "result_count": self.result_count,
            "error": self.error,
        })
    }
}

#[derive(Debug, Clone)]
struct SearchProviderOutput {
    results: Vec<SearchResult>,
    metadata: Value,
}

#[derive(Debug, Clone)]
struct SearchExecution {
    selected_provider: SearchProviderKind,
    configured_priority: Vec<SearchProviderKind>,
    attempts: Vec<SearchAttempt>,
    provider_metadata: Value,
    results: Vec<SearchResult>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct MultiSearchEngineConfig {
    #[serde(default = "default_multi_search_engines")]
    engines: Vec<MultiSearchEngineEntry>,
    #[serde(default)]
    priority: Vec<String>,
    #[serde(default = "default_mse_max_results_per_engine")]
    max_results_per_engine: usize,
    #[serde(default = "default_mse_max_total_results")]
    max_total_results: usize,
    #[serde(default = "default_mse_timeout_ms")]
    timeout_ms: u64,
}

impl MultiSearchEngineConfig {
    fn from_env() -> Result<Self, String> {
        let mut config = if let Ok(raw) = std::env::var("MULTI_SEARCH_ENGINE_CONFIG_JSON") {
            let trimmed = raw.trim();
            if trimmed.is_empty() {
                Self::default()
            } else {
                serde_json::from_str::<Self>(trimmed).map_err(|error| {
                    format!("解析 MULTI_SEARCH_ENGINE_CONFIG_JSON 失败: {error}")
                })?
            }
        } else {
            Self::default()
        };

        if config.engines.is_empty() {
            config.engines = default_multi_search_engines();
        }
        config.max_results_per_engine = config.max_results_per_engine.clamp(1, 20);
        config.max_total_results = config.max_total_results.clamp(1, 100);
        config.timeout_ms = config.timeout_ms.clamp(500, 15_000);
        Ok(config)
    }

    fn engine_order(&self) -> Vec<MultiSearchEngineEntry> {
        let mut engine_map = HashMap::new();
        for engine in default_multi_search_engines()
            .into_iter()
            .chain(self.engines.clone())
        {
            engine_map.insert(engine.name.to_ascii_lowercase(), engine);
        }

        let mut ordered_names = Vec::new();
        for name in self
            .priority
            .iter()
            .chain(self.engines.iter().map(|engine| &engine.name))
        {
            let normalized = name.trim().to_ascii_lowercase();
            if !normalized.is_empty() && !ordered_names.contains(&normalized) {
                ordered_names.push(normalized);
            }
        }

        ordered_names
            .into_iter()
            .filter_map(|name| engine_map.get(&name).cloned())
            .filter(|engine| engine.enabled && engine.url_template.contains("{query}"))
            .collect()
    }
}

impl Default for MultiSearchEngineConfig {
    fn default() -> Self {
        Self {
            engines: default_multi_search_engines(),
            priority: Vec::new(),
            max_results_per_engine: default_mse_max_results_per_engine(),
            max_total_results: default_mse_max_total_results(),
            timeout_ms: default_mse_timeout_ms(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct MultiSearchEngineEntry {
    name: String,
    url_template: String,
    #[serde(default = "default_enabled")]
    enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct WebSearchHit {
    title: String,
    url: String,
}

impl WebSearchHit {
    fn from_result(result: &SearchResult) -> Self {
        Self {
            title: result.title.clone(),
            url: result.url.clone(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct WebSearchResultBlock {
    tool_use_id: String,
    content: Vec<WebSearchHit>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
enum WebSearchOutputEntry {
    Result(WebSearchResultBlock),
    Text(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WebSearchOutput {
    query: String,
    results: Vec<WebSearchOutputEntry>,
    duration_seconds: f64,
}

fn runtime_web_search_error(message: impl Into<String>) -> RuntimeToolExecutionError {
    let message = message.into();
    RuntimeToolExecutionError::new(
        message.clone(),
        Some(RuntimeToolPolicyErrorKind::ExecutionFailed(message)),
    )
}

fn runtime_result_from_output(
    output: WebSearchOutput,
    web_search_metadata: Value,
) -> Result<RuntimeToolExecutionResult, RuntimeToolExecutionError> {
    let duration_seconds = output.duration_seconds;
    let output = serde_json::to_string_pretty(&output)
        .map_err(|error| runtime_web_search_error(format!("序列化 WebSearch 结果失败: {error}")))?;
    Ok(RuntimeToolExecutionResult::new(
        true,
        output,
        None,
        HashMap::from([
            ("durationSeconds".to_string(), json!(duration_seconds)),
            ("web_search".to_string(), web_search_metadata),
        ]),
    ))
}

fn runtime_result_from_cached_search(
    query: &str,
    cached: CachedSearchResults,
    started_at: Instant,
) -> Result<RuntimeToolExecutionResult, RuntimeToolExecutionError> {
    let cache_age = cached
        .fetched_at
        .elapsed()
        .unwrap_or(Duration::ZERO)
        .as_secs()
        / 60;
    let formatted = format!(
        "{}\n\n_[缓存结果，来自 {cache_age} 分钟前]_",
        format_search_results(&cached.results, query)
    );
    let output = WebSearchOutput {
        query: query.to_string(),
        results: vec![
            WebSearchOutputEntry::Result(WebSearchResultBlock {
                tool_use_id: "cached_web_search".to_string(),
                content: cached
                    .results
                    .iter()
                    .map(WebSearchHit::from_result)
                    .collect(),
            }),
            WebSearchOutputEntry::Text(formatted),
        ],
        duration_seconds: started_at.elapsed().as_secs_f64(),
    };
    runtime_result_from_output(
        output,
        json!({
            "cache_hit": true,
            "cache_query": cached.query,
            "allowed_domains": cached.allowed_domains,
            "blocked_domains": cached.blocked_domains,
        }),
    )
}

fn push_unique_provider(providers: &mut Vec<SearchProviderKind>, provider: SearchProviderKind) {
    if !providers.contains(&provider) {
        providers.push(provider);
    }
}

fn default_enabled() -> bool {
    true
}

fn default_mse_max_results_per_engine() -> usize {
    5
}

fn default_mse_max_total_results() -> usize {
    20
}

fn default_mse_timeout_ms() -> u64 {
    4000
}

fn default_multi_search_engines() -> Vec<MultiSearchEngineEntry> {
    vec![
        ("google", "https://www.google.com/search?q={query}"),
        ("bing", "https://www.bing.com/search?q={query}"),
        ("duckduckgo", "https://duckduckgo.com/?q={query}"),
        ("yahoo", "https://search.yahoo.com/search?p={query}"),
        ("baidu", "https://www.baidu.com/s?wd={query}"),
        ("yandex", "https://yandex.com/search/?text={query}"),
        ("ecosia", "https://www.ecosia.org/search?q={query}"),
        ("brave", "https://search.brave.com/search?q={query}"),
        (
            "startpage",
            "https://www.startpage.com/do/search?query={query}",
        ),
        ("qwant", "https://www.qwant.com/?q={query}&t=web"),
        ("sogou", "https://www.sogou.com/web?query={query}"),
        ("so360", "https://www.so.com/s?q={query}"),
        ("aol", "https://search.aol.com/aol/search?q={query}"),
        ("ask", "https://www.ask.com/web?q={query}"),
        (
            "naver",
            "https://search.naver.com/search.naver?query={query}",
        ),
        ("seznam", "https://search.seznam.cz/?q={query}"),
        ("dogpile", "https://www.dogpile.com/serp?q={query}"),
    ]
    .into_iter()
    .map(|(name, url_template)| MultiSearchEngineEntry {
        name: name.to_string(),
        url_template: url_template.to_string(),
        enabled: true,
    })
    // You.com 搜索 API 需要用户显式开启（opt-in）。
    .chain(std::iter::once(MultiSearchEngineEntry {
        name: "youcom".to_string(),
        url_template: YOUCOM_KEYLESS_SEARCH_URL_TEMPLATE.to_string(),
        enabled: false,
    }))
    .collect()
}

const YOUCOM_KEYLESS_SEARCH_URL_TEMPLATE: &str =
    "https://api.you.com/v1/agents/search?query={query}";

fn sanitize_domain_filters(
    query: &str,
    allowed_domains: Option<Vec<String>>,
    blocked_domains: Option<Vec<String>>,
) -> (Option<Vec<String>>, Option<Vec<String>>) {
    let allowed = normalize_domain_list(allowed_domains);
    let mut blocked = normalize_domain_list(blocked_domains);
    if allowed.is_some() && blocked.is_some() {
        let _ = query;
        blocked = None;
    }
    (allowed, blocked)
}

fn normalize_domain_list(domains: Option<Vec<String>>) -> Option<Vec<String>> {
    let mut normalized = domains
        .unwrap_or_default()
        .into_iter()
        .map(|domain| {
            domain
                .trim()
                .trim_start_matches("www.")
                .to_ascii_lowercase()
        })
        .filter(|domain| !domain.is_empty())
        .collect::<Vec<_>>();
    normalized.sort();
    normalized.dedup();
    (!normalized.is_empty()).then_some(normalized)
}

fn apply_domain_filters(
    results: Vec<SearchResult>,
    allowed_domains: &Option<Vec<String>>,
    blocked_domains: &Option<Vec<String>>,
) -> Vec<SearchResult> {
    results
        .into_iter()
        .filter(|result| {
            let domain = extract_domain(&result.url);
            if let Some(allowed) = allowed_domains {
                return allowed
                    .iter()
                    .any(|allowed| domain_matches(&domain, allowed));
            }
            if let Some(blocked) = blocked_domains {
                return !blocked
                    .iter()
                    .any(|blocked| domain_matches(&domain, blocked));
            }
            true
        })
        .collect()
}

fn domain_matches(domain: &str, filter: &str) -> bool {
    domain == filter || domain.ends_with(&format!(".{filter}"))
}

fn extract_domain(url: &str) -> String {
    Url::parse(url)
        .ok()
        .and_then(|parsed| parsed.host_str().map(str::to_string))
        .unwrap_or_default()
        .trim_start_matches("www.")
        .to_ascii_lowercase()
}

fn generate_search_cache_key(
    query: &str,
    allowed_domains: &Option<Vec<String>>,
    blocked_domains: &Option<Vec<String>>,
) -> String {
    let allowed = allowed_domains
        .as_ref()
        .map(|domains| domains.join(","))
        .unwrap_or_default();
    let blocked = blocked_domains
        .as_ref()
        .map(|domains| domains.join(","))
        .unwrap_or_default();
    format!("{}|{allowed}|{blocked}", query.trim().to_ascii_lowercase())
}

fn format_search_results(results: &[SearchResult], query: &str) -> String {
    let mut output = format!("搜索查询: \"{query}\"\n\n");
    if results.is_empty() {
        output.push_str("未找到结果。\n");
        return output;
    }

    for (index, result) in results.iter().enumerate() {
        output.push_str(&format!(
            "{}. [{}]({})\n",
            index + 1,
            result.title,
            result.url
        ));
        if let Some(snippet) = &result.snippet {
            output.push_str(&format!("   {snippet}\n"));
        }
        if let Some(publish_date) = &result.publish_date {
            output.push_str(&format!("   发布时间: {publish_date}\n"));
        }
        output.push('\n');
    }

    output.push_str("\n来源:\n");
    for result in results {
        output.push_str(&format!("- [{}]({})\n", result.title, result.url));
    }
    output
}

fn extract_results_from_search_html(
    html: &str,
    max_results: usize,
    engine_host: Option<&str>,
) -> Vec<SearchResult> {
    let Ok(selector) = Selector::parse("a[href]") else {
        return Vec::new();
    };
    let document = Html::parse_document(html);
    let mut results = Vec::new();
    let mut seen = HashSet::new();

    for element in document.select(&selector) {
        if results.len() >= max_results {
            break;
        }
        let href = element.value().attr("href").unwrap_or_default();
        let Some(url) = normalize_search_result_url(href, engine_host) else {
            continue;
        };
        if !seen.insert(url.to_ascii_lowercase()) {
            continue;
        }
        let title = element
            .text()
            .collect::<Vec<_>>()
            .join(" ")
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ");
        if title.chars().count() < 4 {
            continue;
        }
        results.push(SearchResult {
            title,
            url,
            snippet: None,
            publish_date: None,
        });
    }

    results
}

fn normalize_search_result_url(href: &str, engine_host: Option<&str>) -> Option<String> {
    let href = href.trim();
    if href.is_empty()
        || href.starts_with('#')
        || href.starts_with("javascript:")
        || href.starts_with("mailto:")
    {
        return None;
    }

    let mut parsed = if href.starts_with("http://") || href.starts_with("https://") {
        Url::parse(href).ok()?
    } else {
        let host = engine_host?;
        let normalized_path = if href.starts_with('/') {
            href.to_string()
        } else {
            format!("/{href}")
        };
        Url::parse(&format!("https://{host}{normalized_path}")).ok()?
    };

    if let Some(target) = parsed
        .query_pairs()
        .find(|(key, _)| key == "q" || key == "uddg")
        .map(|(_, value)| value.to_string())
        .filter(|value| value.starts_with("http://") || value.starts_with("https://"))
    {
        if let Ok(target_url) = Url::parse(&target) {
            parsed = target_url;
        }
    }

    if !matches!(parsed.scheme(), "http" | "https") {
        return None;
    }

    let host = parsed.host_str()?.to_ascii_lowercase();
    let excluded_hosts = [
        "google.",
        "bing.com",
        "duckduckgo.com",
        "search.yahoo.com",
        "baidu.com",
        "yandex.com",
        "ecosia.org",
        "search.brave.com",
        "startpage.com",
        "qwant.com",
        "sogou.com",
        "so.com",
        "aol.com",
        "ask.com",
        "naver.com",
        "seznam.cz",
        "dogpile.com",
    ];
    if excluded_hosts
        .iter()
        .any(|excluded| host.contains(excluded))
    {
        return None;
    }

    Some(parsed.to_string())
}

fn deduplicate_results(results: Vec<SearchResult>, max_total: usize) -> Vec<SearchResult> {
    let mut deduped = Vec::new();
    let mut seen = HashSet::new();
    for result in results {
        if deduped.len() >= max_total {
            break;
        }
        let key = result.url.trim().to_ascii_lowercase();
        if !key.is_empty() && seen.insert(key) {
            deduped.push(result);
        }
    }
    deduped
}

fn push_duckduckgo_topic_result(results: &mut Vec<SearchResult>, topic: &Value) {
    if let (Some(text), Some(url)) = (
        topic.get("Text").and_then(Value::as_str),
        topic.get("FirstURL").and_then(Value::as_str),
    ) {
        let title = text.split(" - ").next().unwrap_or(text);
        results.push(SearchResult {
            title: title.to_string(),
            url: url.to_string(),
            snippet: Some(text.to_string()),
            publish_date: None,
        });
    }
}

fn tool_lookup_key(tool_name: &str) -> String {
    tool_name
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .map(|character| character.to_ascii_lowercase())
        .collect()
}
