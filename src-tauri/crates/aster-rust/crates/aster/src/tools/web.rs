//! Web 工具 - WebFetch 和 WebSearch
//!
//! 对齐当前工具面的 Web 工具能力
//!
//! ## 搜索引擎支持（按优先级）
//!
//! 1. Tavily Search API - 环境变量 `TAVILY_API_KEY`
//! 2. Multi Search Engine v2.0.1 - 环境变量 `MULTI_SEARCH_ENGINE_CONFIG_JSON`
//! 3. Bing Search API - 环境变量 `BING_SEARCH_API_KEY`
//! 4. Google Custom Search API - 环境变量 `GOOGLE_SEARCH_API_KEY` + `GOOGLE_SEARCH_ENGINE_ID`
//! 5. DuckDuckGo Instant Answer API - 免费，无需配置（默认回退）

use super::base::{PermissionCheckResult, Tool};
use super::context::{ToolContext, ToolResult};
use super::error::ToolError;
use async_trait::async_trait;
use lru::LruCache;
use reqwest::{redirect::Policy, Client};
use scraper::{Html, Selector};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::num::NonZeroUsize;
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime};
use url::Url;
use urlencoding::encode;

/// 响应体大小限制 (10MB)
const MAX_RESPONSE_SIZE: usize = 10 * 1024 * 1024;
const DEFAULT_WEB_FETCH_MAX_CHARS: usize = 100_000;
const DEFAULT_DYNAMIC_FILTER_MAX_CHARS: usize = 20_000;
const DEFAULT_DYNAMIC_FILTER_MAX_CHUNKS: usize = 8;
const MAX_WEB_FETCH_REDIRECTS: usize = 10;

/// WebFetch 缓存 TTL (15分钟)
const WEB_FETCH_CACHE_TTL: Duration = Duration::from_secs(15 * 60);

/// WebSearch 缓存 TTL (1小时)
const WEB_SEARCH_CACHE_TTL: Duration = Duration::from_secs(60 * 60);

const WEB_FETCH_PREAPPROVED_HOSTS: &[&str] = &[
    "platform.claude.com",
    "code.claude.com",
    "modelcontextprotocol.io",
    "github.com/anthropics",
    "agentskills.io",
    "docs.python.org",
    "en.cppreference.com",
    "docs.oracle.com",
    "learn.microsoft.com",
    "developer.mozilla.org",
    "go.dev",
    "pkg.go.dev",
    "www.php.net",
    "docs.swift.org",
    "kotlinlang.org",
    "ruby-doc.org",
    "doc.rust-lang.org",
    "www.typescriptlang.org",
    "react.dev",
    "angular.io",
    "vuejs.org",
    "nextjs.org",
    "expressjs.com",
    "nodejs.org",
    "bun.sh",
    "jquery.com",
    "getbootstrap.com",
    "tailwindcss.com",
    "d3js.org",
    "threejs.org",
    "redux.js.org",
    "webpack.js.org",
    "jestjs.io",
    "reactrouter.com",
    "docs.djangoproject.com",
    "flask.palletsprojects.com",
    "fastapi.tiangolo.com",
    "pandas.pydata.org",
    "numpy.org",
    "www.tensorflow.org",
    "pytorch.org",
    "scikit-learn.org",
    "matplotlib.org",
    "requests.readthedocs.io",
    "jupyter.org",
    "laravel.com",
    "symfony.com",
    "wordpress.org",
    "docs.spring.io",
    "hibernate.org",
    "tomcat.apache.org",
    "gradle.org",
    "maven.apache.org",
    "asp.net",
    "dotnet.microsoft.com",
    "nuget.org",
    "blazor.net",
    "reactnative.dev",
    "docs.flutter.dev",
    "developer.apple.com",
    "developer.android.com",
    "keras.io",
    "spark.apache.org",
    "huggingface.co",
    "www.kaggle.com",
    "www.mongodb.com",
    "redis.io",
    "www.postgresql.org",
    "dev.mysql.com",
    "www.sqlite.org",
    "graphql.org",
    "prisma.io",
    "docs.aws.amazon.com",
    "cloud.google.com",
    "kubernetes.io",
    "www.docker.com",
    "www.terraform.io",
    "www.ansible.com",
    "vercel.com/docs",
    "docs.netlify.com",
    "devcenter.heroku.com",
    "cypress.io",
    "selenium.dev",
    "docs.unity.com",
    "docs.unrealengine.com",
    "git-scm.com",
    "nginx.org",
    "httpd.apache.org",
];

/// 缓存内容结构
#[derive(Debug, Clone)]
struct CachedContent {
    content: String,
    content_type: String,
    status_code: u16,
    fetched_at: SystemTime,
}

/// 搜索结果结构
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResult {
    pub title: String,
    pub url: String,
    pub snippet: Option<String>,
    pub publish_date: Option<String>,
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
            SearchProviderKind::Tavily => "tavily",
            SearchProviderKind::MultiSearchEngine => "multi_search_engine",
            SearchProviderKind::BingSearchApi => "bing_search_api",
            SearchProviderKind::GoogleCustomSearch => "google_custom_search",
            SearchProviderKind::DuckduckgoInstant => "duckduckgo_instant",
        }
    }

    fn from_env_value(raw: &str) -> Option<Self> {
        match raw.trim().to_ascii_lowercase().as_str() {
            "tavily" => Some(SearchProviderKind::Tavily),
            "multi_search_engine" => Some(SearchProviderKind::MultiSearchEngine),
            "bing_search_api" => Some(SearchProviderKind::BingSearchApi),
            "google_custom_search" => Some(SearchProviderKind::GoogleCustomSearch),
            "duckduckgo_instant" => Some(SearchProviderKind::DuckduckgoInstant),
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
    fn push_unique(resolved: &mut Vec<SearchProviderKind>, provider: SearchProviderKind) {
        if !resolved.contains(&provider) {
            resolved.push(provider);
        }
    }

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
        let mut resolved: Vec<SearchProviderKind> = Vec::new();

        if let Some(raw_priority) = env
            .get("WEB_SEARCH_PROVIDER_PRIORITY")
            .map(|v| v.trim())
            .filter(|v| !v.is_empty())
        {
            for raw in raw_priority.split(',') {
                if let Some(provider) = SearchProviderKind::from_env_value(raw) {
                    Self::push_unique(&mut resolved, provider);
                } else {
                    tracing::warn!("忽略未知 WEB_SEARCH_PROVIDER_PRIORITY 值: {}", raw.trim());
                }
            }
        }

        if resolved.is_empty() {
            if let Some(provider) = env
                .get("WEB_SEARCH_PROVIDER")
                .and_then(|v| SearchProviderKind::from_env_value(v))
            {
                Self::push_unique(&mut resolved, provider);
            } else if let Some(raw) = env.get("WEB_SEARCH_PROVIDER") {
                tracing::warn!("忽略未知 WEB_SEARCH_PROVIDER 值: {}", raw);
            }
        }

        for provider in DEFAULT_SEARCH_PROVIDER_PRIORITY {
            Self::push_unique(&mut resolved, provider);
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

    fn as_json(&self) -> serde_json::Value {
        serde_json::json!({
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
    metadata: serde_json::Value,
}

#[derive(Debug, Clone)]
struct SearchExecution {
    selected_provider: SearchProviderKind,
    configured_priority: Vec<SearchProviderKind>,
    attempts: Vec<SearchAttempt>,
    provider_metadata: serde_json::Value,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
struct MultiSearchEngineEntry {
    name: String,
    url_template: String,
    #[serde(default = "default_enabled")]
    enabled: bool,
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
    .collect()
}

#[async_trait]
trait SearchProviderStrategy: Send + Sync {
    fn kind(&self) -> SearchProviderKind;

    async fn search(
        &self,
        tool: &WebSearchTool,
        query: &str,
    ) -> Result<SearchProviderOutput, String>;
}

struct TavilySearchStrategy;
struct MultiSearchEngineStrategy;
struct BingSearchStrategy;
struct GoogleSearchStrategy;
struct DuckduckgoSearchStrategy;

#[async_trait]
impl SearchProviderStrategy for TavilySearchStrategy {
    fn kind(&self) -> SearchProviderKind {
        SearchProviderKind::Tavily
    }

    async fn search(
        &self,
        tool: &WebSearchTool,
        query: &str,
    ) -> Result<SearchProviderOutput, String> {
        let api_key = std::env::var("TAVILY_API_KEY")
            .map_err(|_| "缺少环境变量 TAVILY_API_KEY".to_string())?;
        let results = tool.search_with_tavily(query, &api_key).await?;
        Ok(SearchProviderOutput {
            results,
            metadata: serde_json::json!({ "provider": self.kind().as_env_value() }),
        })
    }
}

#[async_trait]
impl SearchProviderStrategy for MultiSearchEngineStrategy {
    fn kind(&self) -> SearchProviderKind {
        SearchProviderKind::MultiSearchEngine
    }

    async fn search(
        &self,
        tool: &WebSearchTool,
        query: &str,
    ) -> Result<SearchProviderOutput, String> {
        tool.search_with_multi_search_engine(query).await
    }
}

#[async_trait]
impl SearchProviderStrategy for BingSearchStrategy {
    fn kind(&self) -> SearchProviderKind {
        SearchProviderKind::BingSearchApi
    }

    async fn search(
        &self,
        tool: &WebSearchTool,
        query: &str,
    ) -> Result<SearchProviderOutput, String> {
        let api_key = std::env::var("BING_SEARCH_API_KEY")
            .map_err(|_| "缺少环境变量 BING_SEARCH_API_KEY".to_string())?;
        let results = tool.search_with_bing(query, &api_key).await?;
        Ok(SearchProviderOutput {
            results,
            metadata: serde_json::json!({ "provider": self.kind().as_env_value() }),
        })
    }
}

#[async_trait]
impl SearchProviderStrategy for GoogleSearchStrategy {
    fn kind(&self) -> SearchProviderKind {
        SearchProviderKind::GoogleCustomSearch
    }

    async fn search(
        &self,
        tool: &WebSearchTool,
        query: &str,
    ) -> Result<SearchProviderOutput, String> {
        let api_key = std::env::var("GOOGLE_SEARCH_API_KEY")
            .map_err(|_| "缺少环境变量 GOOGLE_SEARCH_API_KEY".to_string())?;
        let engine_id = std::env::var("GOOGLE_SEARCH_ENGINE_ID")
            .map_err(|_| "缺少环境变量 GOOGLE_SEARCH_ENGINE_ID".to_string())?;
        let results = tool.search_with_google(query, &api_key, &engine_id).await?;
        Ok(SearchProviderOutput {
            results,
            metadata: serde_json::json!({ "provider": self.kind().as_env_value() }),
        })
    }
}

#[async_trait]
impl SearchProviderStrategy for DuckduckgoSearchStrategy {
    fn kind(&self) -> SearchProviderKind {
        SearchProviderKind::DuckduckgoInstant
    }

    async fn search(
        &self,
        tool: &WebSearchTool,
        query: &str,
    ) -> Result<SearchProviderOutput, String> {
        let results = tool.search_with_duckduckgo(query).await?;
        Ok(SearchProviderOutput {
            results,
            metadata: serde_json::json!({ "provider": self.kind().as_env_value() }),
        })
    }
}

struct SearchOrchestrator {
    runtime_config: SearchRuntimeConfig,
    strategies: HashMap<SearchProviderKind, Arc<dyn SearchProviderStrategy>>,
}

impl SearchOrchestrator {
    fn from_env() -> Self {
        let mut strategies: HashMap<SearchProviderKind, Arc<dyn SearchProviderStrategy>> =
            HashMap::new();
        strategies.insert(SearchProviderKind::Tavily, Arc::new(TavilySearchStrategy));
        strategies.insert(
            SearchProviderKind::MultiSearchEngine,
            Arc::new(MultiSearchEngineStrategy),
        );
        strategies.insert(
            SearchProviderKind::BingSearchApi,
            Arc::new(BingSearchStrategy),
        );
        strategies.insert(
            SearchProviderKind::GoogleCustomSearch,
            Arc::new(GoogleSearchStrategy),
        );
        strategies.insert(
            SearchProviderKind::DuckduckgoInstant,
            Arc::new(DuckduckgoSearchStrategy),
        );

        Self {
            runtime_config: SearchRuntimeConfig::from_env(),
            strategies,
        }
    }

    async fn search(&self, tool: &WebSearchTool, query: &str) -> Result<SearchExecution, String> {
        let mut attempts: Vec<SearchAttempt> = Vec::new();
        let mut fallback_empty: Option<(SearchProviderKind, serde_json::Value)> = None;

        for provider in &self.runtime_config.priority {
            let Some(strategy) = self.strategies.get(provider) else {
                attempts.push(SearchAttempt::error(
                    *provider,
                    "provider strategy not registered".to_string(),
                ));
                continue;
            };

            match strategy.search(tool, query).await {
                Ok(output) if !output.results.is_empty() => {
                    attempts.push(SearchAttempt::success(*provider, output.results.len()));
                    return Ok(SearchExecution {
                        selected_provider: *provider,
                        configured_priority: self.runtime_config.priority.clone(),
                        attempts,
                        provider_metadata: output.metadata,
                        results: output.results,
                    });
                }
                Ok(output) => {
                    attempts.push(SearchAttempt::empty(*provider));
                    if fallback_empty.is_none() {
                        fallback_empty = Some((*provider, output.metadata));
                    }
                }
                Err(error) => {
                    attempts.push(SearchAttempt::error(*provider, error));
                }
            }
        }

        if let Some((selected_provider, provider_metadata)) = fallback_empty {
            return Ok(SearchExecution {
                selected_provider,
                configured_priority: self.runtime_config.priority.clone(),
                attempts,
                provider_metadata,
                results: vec![],
            });
        }

        let errors: Vec<String> = attempts
            .iter()
            .filter_map(|attempt| {
                attempt
                    .error
                    .as_ref()
                    .map(|error| format!("{}: {}", attempt.provider.as_env_value(), error))
            })
            .collect();
        if errors.is_empty() {
            Err("所有搜索提供商均未返回结果".to_string())
        } else {
            Err(format!("所有搜索提供商均失败: {}", errors.join(" | ")))
        }
    }
}

/// 缓存的搜索结果
#[derive(Debug, Clone)]
struct CachedSearchResults {
    query: String,
    results: Vec<SearchResult>,
    fetched_at: SystemTime,
    allowed_domains: Option<Vec<String>>,
    blocked_domains: Option<Vec<String>>,
}

/// WebFetchTool 输入参数
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebFetchInput {
    /// 要获取的 URL
    pub url: String,
    /// 处理内容的提示词
    pub prompt: String,
    /// 聚焦查询，用于动态过滤无关内容
    #[serde(default)]
    pub focus_query: Option<String>,
    /// 是否启用动态过滤
    #[serde(default)]
    pub dynamic_filter: bool,
    /// 返回内容最大字符数
    #[serde(default)]
    pub max_chars: Option<usize>,
    /// 动态过滤保留的最大片段数
    #[serde(default)]
    pub max_chunks: Option<usize>,
}

/// WebSearchTool 输入参数
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebSearchInput {
    /// 搜索查询
    pub query: String,
    /// 允许的域名列表
    pub allowed_domains: Option<Vec<String>>,
    /// 阻止的域名列表
    pub blocked_domains: Option<Vec<String>>,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
struct WebSearchHit {
    title: String,
    url: String,
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

fn is_preapproved_web_fetch_host(hostname: &str, pathname: &str) -> bool {
    for entry in WEB_FETCH_PREAPPROVED_HOSTS {
        if let Some((host, path_prefix)) = entry.split_once('/') {
            if hostname == host
                && (pathname == format!("/{path_prefix}")
                    || pathname.starts_with(&format!("/{path_prefix}/")))
            {
                return true;
            }
        } else if hostname == *entry {
            return true;
        }
    }

    false
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

/// Web 工具的共享缓存
pub struct WebCache {
    fetch_cache: Arc<Mutex<LruCache<String, CachedContent>>>,
    search_cache: Arc<Mutex<LruCache<String, CachedSearchResults>>>,
}

impl Default for WebCache {
    fn default() -> Self {
        Self::new()
    }
}

impl WebCache {
    /// 创建新的 Web 缓存
    pub fn new() -> Self {
        Self {
            fetch_cache: Arc::new(Mutex::new(LruCache::new(NonZeroUsize::new(100).unwrap()))),
            search_cache: Arc::new(Mutex::new(LruCache::new(NonZeroUsize::new(500).unwrap()))),
        }
    }

    /// 获取缓存的内容
    fn get_cached_content(&self, url: &str) -> Option<CachedContent> {
        let mut cache = self.fetch_cache.lock().unwrap();
        if let Some(cached) = cache.get(url) {
            // 检查是否过期
            if cached.fetched_at.elapsed().unwrap_or(Duration::MAX) < WEB_FETCH_CACHE_TTL {
                return Some(cached.clone());
            } else {
                // 过期，移除
                cache.pop(url);
            }
        }
        None
    }

    /// 缓存内容
    fn cache_content(&self, url: String, content: CachedContent) {
        let mut cache = self.fetch_cache.lock().unwrap();
        cache.put(url, content);
    }

    /// 生成搜索缓存键
    fn generate_search_cache_key(
        query: &str,
        allowed_domains: &Option<Vec<String>>,
        blocked_domains: &Option<Vec<String>>,
    ) -> String {
        let normalized_query = query.trim().to_lowercase();
        let allowed = allowed_domains
            .as_ref()
            .map(|domains| {
                let mut sorted = domains.clone();
                sorted.sort();
                sorted.join(",")
            })
            .unwrap_or_default();
        let blocked = blocked_domains
            .as_ref()
            .map(|domains| {
                let mut sorted = domains.clone();
                sorted.sort();
                sorted.join(",")
            })
            .unwrap_or_default();

        format!("{}|{}|{}", normalized_query, allowed, blocked)
    }

    /// 获取缓存的搜索结果
    fn get_cached_search(&self, cache_key: &str) -> Option<CachedSearchResults> {
        let mut cache = self.search_cache.lock().unwrap();
        if let Some(cached) = cache.get(cache_key) {
            // 检查是否过期
            if cached.fetched_at.elapsed().unwrap_or(Duration::MAX) < WEB_SEARCH_CACHE_TTL {
                return Some(cached.clone());
            } else {
                // 过期，移除
                cache.pop(cache_key);
            }
        }
        None
    }

    /// 缓存搜索结果
    fn cache_search(&self, cache_key: String, results: CachedSearchResults) {
        let mut cache = self.search_cache.lock().unwrap();
        cache.put(cache_key, results);
    }
}

/// WebFetchTool - Web 内容获取工具
///
/// 对齐当前工具面的 WebFetch 能力
pub struct WebFetchTool {
    client: Client,
    cache: Arc<WebCache>,
}

impl Default for WebFetchTool {
    fn default() -> Self {
        Self::new()
    }
}

impl WebFetchTool {
    /// 创建新的 WebFetchTool
    pub fn new() -> Self {
        let client = Client::builder()
            .timeout(Duration::from_secs(30))
            .redirect(Policy::none())
            .user_agent("Mozilla/5.0 (compatible; AsterAgent/1.0)")
            .build()
            .unwrap_or_else(|_| Client::new());

        Self {
            client,
            cache: Arc::new(WebCache::new()),
        }
    }

    /// 使用共享缓存创建 WebFetchTool
    pub fn with_cache(cache: Arc<WebCache>) -> Self {
        let client = Client::builder()
            .timeout(Duration::from_secs(30))
            .redirect(Policy::none())
            .user_agent("Mozilla/5.0 (compatible; AsterAgent/1.0)")
            .build()
            .unwrap_or_else(|_| Client::new());

        Self { client, cache }
    }

    /// 检查域名安全性
    fn check_domain_safety(&self, url: &Url) -> Result<(), String> {
        let host = url.host_str().ok_or("无效的主机名")?;
        let host_lower = host.to_lowercase();

        // 不安全域名黑名单
        let unsafe_domains = [
            "localhost",
            "127.0.0.1",
            "0.0.0.0",
            "::1",
            "169.254.169.254",          // AWS 元数据服务
            "metadata.google.internal", // GCP 元数据服务
        ];

        for unsafe_domain in &unsafe_domains {
            if host_lower == *unsafe_domain || host_lower.ends_with(&format!(".{}", unsafe_domain))
            {
                return Err(format!("域名 {} 因安全原因被禁止访问", host));
            }
        }

        // 检查私有 IP 地址
        if self.is_private_ip(&host_lower) {
            return Err(format!("私有 IP 地址 {} 被禁止访问", host));
        }

        Ok(())
    }

    /// 检查是否为私有 IP 地址
    fn is_private_ip(&self, host: &str) -> bool {
        // 简单的 IPv4 私有地址检查
        if let Ok(addr) = host.parse::<std::net::Ipv4Addr>() {
            return addr.is_private() || addr.is_loopback() || addr.is_link_local();
        }
        false
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

    /// HTML 转 Markdown
    fn html_to_markdown(&self, html: &str) -> String {
        let _document = Html::parse_document(html);

        // 移除 script 和 style 标签
        let mut cleaned_html = html.to_string();

        // 简单的标签清理
        cleaned_html = cleaned_html
            .replace("<script", "<removed-script")
            .replace("</script>", "</removed-script>")
            .replace("<style", "<removed-style")
            .replace("</style>", "</removed-style>");

        // 基本的 HTML 到文本转换
        self.html_to_text(&cleaned_html)
    }

    /// HTML 转纯文本（简化版）
    fn html_to_text(&self, html: &str) -> String {
        // 使用正则表达式移除 HTML 标签
        let re = regex::Regex::new(r"<[^>]+>").unwrap();
        let text = re.replace_all(html, " ");

        // 清理空白字符
        let re_whitespace = regex::Regex::new(r"\s+").unwrap();
        let cleaned = re_whitespace.replace_all(&text, " ");

        // HTML 实体解码
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

    fn truncate_chars(&self, text: &str, max_chars: usize) -> String {
        if text.chars().count() <= max_chars {
            return text.to_string();
        }
        let truncated = text.chars().take(max_chars).collect::<String>();
        format!("{}...\n\n[内容已截断]", truncated)
    }

    fn split_into_chunks(&self, content: &str, max_chunk_chars: usize) -> Vec<String> {
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

            // 超长段落按字符窗口切分，避免单块过大失去过滤效果。
            let mut current = String::new();
            for ch in paragraph.chars() {
                current.push(ch);
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
        &self,
        content: &str,
        query: &str,
        max_chars: usize,
        max_chunks: usize,
    ) -> Option<String> {
        let terms: Vec<String> = query
            .split_whitespace()
            .map(|t| t.trim().to_lowercase())
            .filter(|t| t.len() >= 2)
            .collect();

        if terms.is_empty() {
            return None;
        }

        let chunks = self.split_into_chunks(content, 1_500);
        let mut scored: Vec<(usize, usize)> = chunks
            .iter()
            .enumerate()
            .filter_map(|(idx, chunk)| {
                let lower = chunk.to_lowercase();
                let score = terms
                    .iter()
                    .map(|term| lower.matches(term).count())
                    .sum::<usize>();
                (score > 0).then_some((idx, score))
            })
            .collect();

        if scored.is_empty() {
            return None;
        }

        scored.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
        let mut selected_indices: Vec<usize> = scored
            .into_iter()
            .take(max_chunks.max(1))
            .map(|(idx, _)| idx)
            .collect();
        selected_indices.sort_unstable();

        let selected = selected_indices
            .into_iter()
            .filter_map(|idx| chunks.get(idx))
            .cloned()
            .collect::<Vec<String>>()
            .join("\n\n");

        Some(self.truncate_chars(&selected, max_chars))
    }

    fn prepare_response_content(&self, content: &str, input: &WebFetchInput) -> (String, bool) {
        let default_max_chars = if input.dynamic_filter || input.focus_query.is_some() {
            DEFAULT_DYNAMIC_FILTER_MAX_CHARS
        } else {
            DEFAULT_WEB_FETCH_MAX_CHARS
        };
        let max_chars = input.max_chars.unwrap_or(default_max_chars);
        let max_chars = max_chars.clamp(500, DEFAULT_WEB_FETCH_MAX_CHARS);

        let query = input
            .focus_query
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or(&input.prompt);

        if input.dynamic_filter || input.focus_query.is_some() {
            let max_chunks = input
                .max_chunks
                .unwrap_or(DEFAULT_DYNAMIC_FILTER_MAX_CHUNKS);
            if let Some(filtered) =
                self.dynamic_filter_content(content, query, max_chars, max_chunks)
            {
                return (filtered, true);
            }
        }

        (self.truncate_chars(content, max_chars), false)
    }

    /// 实际的 URL 抓取逻辑
    async fn fetch_url(&self, url: &str) -> Result<WebFetchResponse, String> {
        let mut current_url = url.to_string();

        for _ in 0..=MAX_WEB_FETCH_REDIRECTS {
            let parsed_url = Url::parse(&current_url).map_err(|e| format!("无效的 URL: {}", e))?;

            // 域名安全检查
            self.check_domain_safety(&parsed_url)?;

            let response = self
                .client
                .get(current_url.clone())
                .header("User-Agent", "Mozilla/5.0 (compatible; AsterAgent/1.0)")
                .header(
                    "Accept",
                    "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                )
                .send()
                .await
                .map_err(|e| format!("请求失败: {}", e))?;

            let status_code = response.status().as_u16();

            if matches!(status_code, 301 | 302 | 307 | 308) {
                let location = response
                    .headers()
                    .get(reqwest::header::LOCATION)
                    .and_then(|value| value.to_str().ok())
                    .ok_or_else(|| "重定向响应缺少 Location 头".to_string())?;
                let redirect_url = parsed_url
                    .join(location)
                    .map_err(|e| format!("解析重定向 URL 失败: {}", e))?;

                if is_permitted_web_fetch_redirect(&parsed_url, &redirect_url) {
                    current_url = redirect_url.to_string();
                    continue;
                }

                return Ok(WebFetchResponse::Redirect {
                    original_url: current_url,
                    redirect_url: redirect_url.to_string(),
                    status_code,
                });
            }

            let content_type = response
                .headers()
                .get("content-type")
                .and_then(|ct| ct.to_str().ok())
                .unwrap_or("")
                .to_string();

            // 检查响应体大小
            if let Some(content_length) = response.content_length() {
                if content_length > MAX_RESPONSE_SIZE as u64 {
                    return Err(format!(
                        "响应体大小 ({} 字节) 超过最大限制 ({} 字节)",
                        content_length, MAX_RESPONSE_SIZE
                    ));
                }
            }

            let body = response
                .text()
                .await
                .map_err(|e| format!("读取响应体失败: {}", e))?;

            // 检查处理后内容的大小
            if body.len() > MAX_RESPONSE_SIZE {
                return Err(format!(
                    "内容大小 ({} 字节) 超过最大限制 ({} 字节)",
                    body.len(),
                    MAX_RESPONSE_SIZE
                ));
            }

            let processed_content = if content_type.contains("text/html") {
                self.html_to_markdown(&body)
            } else if content_type.contains("application/json") {
                match serde_json::from_str::<serde_json::Value>(&body) {
                    Ok(json) => serde_json::to_string_pretty(&json).unwrap_or(body),
                    Err(_) => body,
                }
            } else {
                body
            };

            return Ok(WebFetchResponse::Content {
                content: processed_content,
                content_type,
                status_code,
            });
        }

        Err(format!(
            "重定向次数过多（超过 {} 次）",
            MAX_WEB_FETCH_REDIRECTS
        ))
    }
}

#[async_trait]
impl Tool for WebFetchTool {
    fn name(&self) -> &str {
        "WebFetch"
    }

    fn description(&self) -> &str {
        "获取指定 URL 的内容并使用 AI 模型处理。\n\
         输入 URL 和提示词，获取 URL 内容，将 HTML 转换为 Markdown，\n\
         然后使用小型快速模型处理内容并返回模型对内容的响应。\n\
         当需要检索和分析 Web 内容时使用此工具。"
    }

    fn input_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "url": {
                    "type": "string",
                    "format": "uri",
                    "description": "要获取内容的 URL"
                },
                "prompt": {
                    "type": "string",
                    "description": "用于处理获取内容的提示词"
                },
                "focus_query": {
                    "type": "string",
                    "description": "可选。用于动态过滤页面内容的关键词/问题"
                },
                "dynamic_filter": {
                    "type": "boolean",
                    "description": "可选。启用后仅返回与 prompt/focus_query 相关的片段"
                },
                "max_chars": {
                    "type": "integer",
                    "minimum": 500,
                    "description": "可选。输出最大字符数（默认普通模式 100000，动态过滤模式 20000）"
                },
                "max_chunks": {
                    "type": "integer",
                    "minimum": 1,
                    "description": "可选。动态过滤保留的最大内容片段数，默认 8"
                }
            },
            "required": ["url", "prompt"]
        })
    }

    async fn check_permissions(
        &self,
        params: &serde_json::Value,
        _context: &ToolContext,
    ) -> PermissionCheckResult {
        let parsed_url = serde_json::from_value::<WebFetchInput>(params.clone())
            .ok()
            .and_then(|input| Url::parse(&input.url).ok());

        if let Some(url) = parsed_url.as_ref() {
            if let Some(hostname) = url.host_str() {
                if is_preapproved_web_fetch_host(hostname, url.path()) {
                    return PermissionCheckResult::allow();
                }
            }
        }

        match parsed_url.and_then(|url| url.host_str().map(|host| host.to_string())) {
            Some(hostname) => PermissionCheckResult::ask(format!(
                "WebFetch 将访问远程站点 {hostname}，请确认后继续。"
            )),
            None => PermissionCheckResult::ask("WebFetch 将访问远程 URL，请确认后继续。"),
        }
    }

    async fn execute(
        &self,
        params: serde_json::Value,
        _context: &ToolContext,
    ) -> Result<ToolResult, ToolError> {
        let started_at = std::time::Instant::now();
        let input: WebFetchInput = serde_json::from_value(params)
            .map_err(|e| ToolError::execution_failed(format!("输入参数解析失败: {}", e)))?;

        let mut url = input.url.clone();

        // URL 验证和规范化
        let parsed_url = Url::parse(&url)
            .map_err(|e| ToolError::invalid_params(format!("无效的 URL: {}", e)))?;

        // HTTP 到 HTTPS 自动升级
        if parsed_url.scheme() == "http" {
            let mut new_url = parsed_url;
            new_url.set_scheme("https").map_err(|_| {
                ToolError::execution_failed("无法将 HTTP URL 升级为 HTTPS".to_string())
            })?;
            url = new_url.to_string();
        }

        // 检查缓存
        if let Some(cached) = self.cache.get_cached_content(&url) {
            let (content, filtered) = self.prepare_response_content(&cached.content, &input);
            let mut result = content;
            if filtered {
                result = format!("{result}\n\n[dynamic_filter_applied]");
            }
            let output = WebFetchOutput {
                bytes: cached.content.len(),
                code: cached.status_code,
                code_text: Self::http_status_text(cached.status_code).to_string(),
                result,
                duration_ms: started_at
                    .elapsed()
                    .as_millis()
                    .try_into()
                    .unwrap_or(u64::MAX),
                url: url.clone(),
            };

            return Ok(
                ToolResult::success(serde_json::to_string_pretty(&output).map_err(|error| {
                    ToolError::execution_failed(format!("序列化 WebFetch 缓存结果失败: {error}"))
                })?)
                .with_metadata("url", serde_json::json!(url))
                .with_metadata("code", serde_json::json!(cached.status_code))
                .with_metadata("bytes", serde_json::json!(output.bytes))
                .with_metadata("durationMs", serde_json::json!(output.duration_ms)),
            );
        }

        // 获取内容
        match self.fetch_url(&url).await {
            Ok(WebFetchResponse::Content {
                content,
                content_type,
                status_code,
            }) => {
                if status_code >= 400 {
                    return Err(ToolError::execution_failed(format!(
                        "HTTP 错误: {} {}",
                        status_code,
                        match status_code {
                            404 => "Not Found",
                            403 => "Forbidden",
                            500 => "Internal Server Error",
                            _ => "Unknown Error",
                        }
                    )));
                }

                let (display_content, filtered) = self.prepare_response_content(&content, &input);
                let mut result = display_content;
                if filtered {
                    result = format!("{result}\n\n[dynamic_filter_applied]");
                }

                // 缓存结果
                self.cache.cache_content(
                    url.clone(),
                    CachedContent {
                        content: content.clone(),
                        content_type,
                        status_code,
                        fetched_at: SystemTime::now(),
                    },
                );

                let output = WebFetchOutput {
                    bytes: content.len(),
                    code: status_code,
                    code_text: Self::http_status_text(status_code).to_string(),
                    result,
                    duration_ms: started_at
                        .elapsed()
                        .as_millis()
                        .try_into()
                        .unwrap_or(u64::MAX),
                    url: url.clone(),
                };

                Ok(
                    ToolResult::success(serde_json::to_string_pretty(&output).map_err(
                        |error| {
                            ToolError::execution_failed(format!(
                                "序列化 WebFetch 结果失败: {error}"
                            ))
                        },
                    )?)
                    .with_metadata("url", serde_json::json!(url))
                    .with_metadata("code", serde_json::json!(status_code))
                    .with_metadata("bytes", serde_json::json!(output.bytes))
                    .with_metadata("durationMs", serde_json::json!(output.duration_ms)),
                )
            }
            Ok(WebFetchResponse::Redirect {
                original_url,
                redirect_url,
                status_code,
            }) => {
                let status_text = Self::http_status_text(status_code).to_string();
                let message = format!(
                    "REDIRECT DETECTED: The URL redirects to a different host.\n\nOriginal URL: {}\nRedirect URL: {}\nStatus: {} {}\n\nTo complete your request, call WebFetch again with:\n- url: \"{}\"\n- prompt: \"{}\"",
                    original_url,
                    redirect_url,
                    status_code,
                    status_text,
                    redirect_url,
                    input.prompt
                );
                let output = WebFetchOutput {
                    bytes: message.len(),
                    code: status_code,
                    code_text: status_text,
                    result: message,
                    duration_ms: started_at
                        .elapsed()
                        .as_millis()
                        .try_into()
                        .unwrap_or(u64::MAX),
                    url: url.clone(),
                };

                Ok(
                    ToolResult::success(serde_json::to_string_pretty(&output).map_err(
                        |error| {
                            ToolError::execution_failed(format!(
                                "序列化 WebFetch 重定向结果失败: {error}"
                            ))
                        },
                    )?)
                    .with_metadata("url", serde_json::json!(url))
                    .with_metadata("code", serde_json::json!(status_code))
                    .with_metadata("bytes", serde_json::json!(output.bytes))
                    .with_metadata("durationMs", serde_json::json!(output.duration_ms))
                    .with_metadata(
                        "redirect",
                        serde_json::json!({
                            "originalUrl": original_url,
                            "redirectUrl": redirect_url,
                            "statusCode": status_code,
                        }),
                    ),
                )
            }
            Err(e) => Err(ToolError::execution_failed(format!("获取失败: {}", e))),
        }
    }
}

/// WebSearchTool - Web 搜索工具
///
/// 对齐当前工具面的 WebSearch 能力
pub struct WebSearchTool {
    client: Client,
    cache: Arc<WebCache>,
}

impl Default for WebSearchTool {
    fn default() -> Self {
        Self::new()
    }
}

impl WebSearchTool {
    /// 创建新的 WebSearchTool
    pub fn new() -> Self {
        let client = Client::builder()
            .timeout(Duration::from_secs(15))
            .user_agent("Mozilla/5.0 (compatible; AsterAgent/1.0)")
            .build()
            .unwrap_or_else(|_| Client::new());

        Self {
            client,
            cache: Arc::new(WebCache::new()),
        }
    }

    /// 使用共享缓存创建 WebSearchTool
    pub fn with_cache(cache: Arc<WebCache>) -> Self {
        let client = Client::builder()
            .timeout(Duration::from_secs(15))
            .user_agent("Mozilla/5.0 (compatible; AsterAgent/1.0)")
            .build()
            .unwrap_or_else(|_| Client::new());

        Self { client, cache }
    }

    /// 从 URL 提取域名
    fn extract_domain(&self, url: &str) -> String {
        match Url::parse(url) {
            Ok(parsed) => {
                // 移除 www. 前缀
                parsed.host_str().unwrap_or("").replace("www.", "")
            }
            Err(_) => String::new(),
        }
    }

    /// 应用域名过滤
    fn apply_domain_filters(
        &self,
        results: Vec<SearchResult>,
        allowed_domains: &Option<Vec<String>>,
        blocked_domains: &Option<Vec<String>>,
    ) -> Vec<SearchResult> {
        let mut filtered = results;

        // 应用白名单
        if let Some(allowed) = allowed_domains {
            if !allowed.is_empty() {
                let normalized_allowed: Vec<String> =
                    allowed.iter().map(|d| d.to_lowercase()).collect();
                filtered.retain(|result| {
                    let domain = self.extract_domain(&result.url).to_lowercase();
                    normalized_allowed.contains(&domain)
                });
            }
        }

        // 应用黑名单
        if let Some(blocked) = blocked_domains {
            if !blocked.is_empty() {
                let normalized_blocked: Vec<String> =
                    blocked.iter().map(|d| d.to_lowercase()).collect();
                filtered.retain(|result| {
                    let domain = self.extract_domain(&result.url).to_lowercase();
                    !normalized_blocked.contains(&domain)
                });
            }
        }

        filtered
    }

    fn normalize_domain_list(domains: Option<Vec<String>>) -> Option<Vec<String>> {
        let normalized: Vec<String> = domains
            .unwrap_or_default()
            .into_iter()
            .map(|domain| domain.trim().to_ascii_lowercase())
            .filter(|domain| !domain.is_empty())
            .collect();

        if normalized.is_empty() {
            None
        } else {
            Some(normalized)
        }
    }

    fn sanitize_domain_filters(
        &self,
        query: &str,
        allowed_domains: Option<Vec<String>>,
        blocked_domains: Option<Vec<String>>,
    ) -> (Option<Vec<String>>, Option<Vec<String>>) {
        let allowed = Self::normalize_domain_list(allowed_domains);
        let mut blocked = Self::normalize_domain_list(blocked_domains);

        // LLM 在函数调用时可能同时输出两个过滤器字段。
        // 为了避免整次 WebSearch 失败，这里采用“白名单优先”策略进行容错。
        if allowed.is_some() && blocked.is_some() {
            tracing::warn!(
                query = %query,
                "WebSearch 同时收到 allowed_domains 与 blocked_domains，按 allowed_domains 优先，忽略 blocked_domains"
            );
            blocked = None;
        }

        (allowed, blocked)
    }

    /// 格式化搜索结果为 Markdown
    fn format_search_results(&self, results: &[SearchResult], query: &str) -> String {
        let mut output = format!("搜索查询: \"{}\"\n\n", query);

        if results.is_empty() {
            output.push_str("未找到结果。\n");
            return output;
        }

        // 结果列表
        for (index, result) in results.iter().enumerate() {
            output.push_str(&format!(
                "{}. [{}]({})\n",
                index + 1,
                result.title,
                result.url
            ));
            if let Some(snippet) = &result.snippet {
                output.push_str(&format!("   {}\n", snippet));
            }
            if let Some(publish_date) = &result.publish_date {
                output.push_str(&format!("   发布时间: {}\n", publish_date));
            }
            output.push('\n');
        }

        // 来源部分
        output.push_str("\n来源:\n");
        for result in results {
            output.push_str(&format!("- [{}]({})\n", result.title, result.url));
        }

        output
    }

    /// 执行搜索（策略编排）
    async fn perform_search(&self, query: &str) -> Result<SearchExecution, String> {
        let orchestrator = SearchOrchestrator::from_env();
        orchestrator.search(self, query).await
    }

    fn load_multi_search_engine_config(&self) -> Result<MultiSearchEngineConfig, String> {
        let mut config = if let Ok(raw) = std::env::var("MULTI_SEARCH_ENGINE_CONFIG_JSON") {
            let trimmed = raw.trim();
            if trimmed.is_empty() {
                MultiSearchEngineConfig {
                    engines: default_multi_search_engines(),
                    priority: vec![],
                    max_results_per_engine: default_mse_max_results_per_engine(),
                    max_total_results: default_mse_max_total_results(),
                    timeout_ms: default_mse_timeout_ms(),
                }
            } else {
                serde_json::from_str::<MultiSearchEngineConfig>(trimmed)
                    .map_err(|e| format!("解析 MULTI_SEARCH_ENGINE_CONFIG_JSON 失败: {}", e))?
            }
        } else {
            MultiSearchEngineConfig {
                engines: default_multi_search_engines(),
                priority: vec![],
                max_results_per_engine: default_mse_max_results_per_engine(),
                max_total_results: default_mse_max_total_results(),
                timeout_ms: default_mse_timeout_ms(),
            }
        };

        if config.engines.is_empty() {
            config.engines = default_multi_search_engines();
        }
        config.max_results_per_engine = config.max_results_per_engine.clamp(1, 20);
        config.max_total_results = config.max_total_results.clamp(1, 100);
        config.timeout_ms = config.timeout_ms.clamp(500, 15000);

        Ok(config)
    }

    fn build_multi_search_engine_order(
        &self,
        config: &MultiSearchEngineConfig,
    ) -> Vec<MultiSearchEngineEntry> {
        let mut engine_map: HashMap<String, MultiSearchEngineEntry> = HashMap::new();
        for engine in default_multi_search_engines() {
            engine_map.insert(engine.name.to_ascii_lowercase(), engine);
        }
        for engine in &config.engines {
            engine_map.insert(engine.name.to_ascii_lowercase(), engine.clone());
        }

        let mut ordered_names: Vec<String> = Vec::new();
        if !config.priority.is_empty() {
            for name in &config.priority {
                let normalized = name.trim().to_ascii_lowercase();
                if !normalized.is_empty() && !ordered_names.contains(&normalized) {
                    ordered_names.push(normalized);
                }
            }
        }
        for engine in &config.engines {
            let normalized = engine.name.to_ascii_lowercase();
            if !ordered_names.contains(&normalized) {
                ordered_names.push(normalized);
            }
        }

        ordered_names
            .into_iter()
            .filter_map(|name| engine_map.get(&name).cloned())
            .filter(|engine| engine.enabled && engine.url_template.contains("{query}"))
            .collect()
    }

    fn normalize_search_result_url(&self, href: &str, engine_host: Option<&str>) -> Option<String> {
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
                format!("/{}", href)
            };
            Url::parse(&format!("https://{}{}", host, normalized_path)).ok()?
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

    fn extract_results_from_search_html(
        &self,
        html: &str,
        max_results: usize,
        engine_host: Option<&str>,
    ) -> Vec<SearchResult> {
        let Ok(selector) = Selector::parse("a[href]") else {
            return vec![];
        };
        let document = Html::parse_document(html);
        let mut results = Vec::new();
        let mut seen = HashSet::new();

        for element in document.select(&selector) {
            if results.len() >= max_results {
                break;
            }

            let href = element.value().attr("href").unwrap_or_default();
            let Some(url) = self.normalize_search_result_url(href, engine_host) else {
                continue;
            };
            if !seen.insert(url.to_ascii_lowercase()) {
                continue;
            }

            let title_raw = element.text().collect::<Vec<_>>().join(" ");
            let title = title_raw.split_whitespace().collect::<Vec<_>>().join(" ");
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

    fn deduplicate_results(
        &self,
        results: Vec<SearchResult>,
        max_total: usize,
    ) -> Vec<SearchResult> {
        let mut dedup = Vec::new();
        let mut seen = HashSet::new();
        for result in results {
            if dedup.len() >= max_total {
                break;
            }
            let key = result.url.trim().to_ascii_lowercase();
            if key.is_empty() || !seen.insert(key) {
                continue;
            }
            dedup.push(result);
        }
        dedup
    }

    async fn search_with_multi_search_engine(
        &self,
        query: &str,
    ) -> Result<SearchProviderOutput, String> {
        let config = self.load_multi_search_engine_config()?;
        let engines = self.build_multi_search_engine_order(&config);
        if engines.is_empty() {
            return Err("Multi Search Engine 未配置有效引擎".to_string());
        }

        let timeout = Duration::from_millis(config.timeout_ms);
        let encoded_query = encode(query);
        let mut aggregated_results = Vec::new();
        let mut successful_engines = Vec::new();
        let mut failed_engines = Vec::new();
        let mut raw_result_count = 0usize;

        for engine in engines {
            if aggregated_results.len() >= config.max_total_results {
                break;
            }

            let request_url = engine
                .url_template
                .replace("{query}", encoded_query.as_ref());
            let request_host = Url::parse(&request_url)
                .ok()
                .and_then(|url| url.host_str().map(|host| host.to_string()));

            let send_result =
                tokio::time::timeout(timeout, self.client.get(&request_url).send()).await;
            let response = match send_result {
                Ok(Ok(response)) => response,
                Ok(Err(error)) => {
                    failed_engines.push(format!("{}: {}", engine.name, error));
                    continue;
                }
                Err(_) => {
                    failed_engines
                        .push(format!("{}: timeout {}ms", engine.name, config.timeout_ms));
                    continue;
                }
            };

            if !response.status().is_success() {
                failed_engines.push(format!("{}: HTTP {}", engine.name, response.status()));
                continue;
            }

            let body = match response.text().await {
                Ok(text) => text,
                Err(error) => {
                    failed_engines.push(format!("{}: {}", engine.name, error));
                    continue;
                }
            };

            let mut engine_results = self.extract_results_from_search_html(
                &body,
                config.max_results_per_engine,
                request_host.as_deref(),
            );
            raw_result_count += engine_results.len();
            if !engine_results.is_empty() {
                successful_engines.push(engine.name.clone());
                aggregated_results.append(&mut engine_results);
            } else {
                failed_engines.push(format!("{}: no_results", engine.name));
            }
        }

        let deduped_results =
            self.deduplicate_results(aggregated_results, config.max_total_results);
        let metadata = serde_json::json!({
            "provider": SearchProviderKind::MultiSearchEngine.as_env_value(),
            "dedup_before": raw_result_count,
            "dedup_after": deduped_results.len(),
            "successful_engines": successful_engines,
            "failed_engines": failed_engines,
            "timeout_ms": config.timeout_ms,
            "max_results_per_engine": config.max_results_per_engine,
            "max_total_results": config.max_total_results,
        });

        Ok(SearchProviderOutput {
            results: deduped_results,
            metadata,
        })
    }

    /// Tavily Search API 搜索
    async fn search_with_tavily(
        &self,
        query: &str,
        api_key: &str,
    ) -> Result<Vec<SearchResult>, String> {
        let body = serde_json::json!({
            "api_key": api_key,
            "query": query,
            "max_results": 10,
            "include_answer": false,
        });

        let response = self
            .client
            .post("https://api.tavily.com/search")
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("Tavily Search API 请求失败: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let text = response.text().await.unwrap_or_default();
            return Err(format!("Tavily API 返回错误 {}: {}", status, text));
        }

        let data: serde_json::Value = response
            .json()
            .await
            .map_err(|e| format!("解析 Tavily 响应失败: {}", e))?;

        let empty_vec = vec![];
        let items = data
            .get("results")
            .and_then(|r| r.as_array())
            .unwrap_or(&empty_vec);

        let results = items
            .iter()
            .filter_map(|item| {
                let title = item.get("title")?.as_str()?.to_string();
                let url = item.get("url")?.as_str()?.to_string();
                let snippet = item
                    .get("content")
                    .and_then(|s| s.as_str())
                    .map(|s| s.to_string());
                let publish_date = item
                    .get("published_date")
                    .and_then(|d| d.as_str())
                    .map(|d| d.to_string());

                Some(SearchResult {
                    title,
                    url,
                    snippet,
                    publish_date,
                })
            })
            .collect();

        Ok(results)
    }

    /// DuckDuckGo Instant Answer API 搜索
    async fn search_with_duckduckgo(&self, query: &str) -> Result<Vec<SearchResult>, String> {
        let response = self
            .client
            .get("https://api.duckduckgo.com/")
            .query(&[
                ("q", query),
                ("format", "json"),
                ("no_html", "1"),
                ("skip_disambig", "1"),
            ])
            .send()
            .await
            .map_err(|e| format!("DuckDuckGo 请求失败: {}", e))?;

        let data: serde_json::Value = response
            .json()
            .await
            .map_err(|e| format!("解析 DuckDuckGo 响应失败: {}", e))?;

        let mut results = Vec::new();

        // 提取相关主题
        if let Some(related_topics) = data.get("RelatedTopics").and_then(|rt| rt.as_array()) {
            for topic in related_topics.iter().take(10) {
                // 处理嵌套主题
                if let Some(topics) = topic.get("Topics").and_then(|t| t.as_array()) {
                    for sub_topic in topics.iter().take(3) {
                        if let (Some(text), Some(url)) = (
                            sub_topic.get("Text").and_then(|t| t.as_str()),
                            sub_topic.get("FirstURL").and_then(|u| u.as_str()),
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
                } else if let (Some(text), Some(url)) = (
                    topic.get("Text").and_then(|t| t.as_str()),
                    topic.get("FirstURL").and_then(|u| u.as_str()),
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
        }

        // 添加抽象答案（如果有）
        if let (Some(abstract_text), Some(abstract_url)) = (
            data.get("Abstract").and_then(|a| a.as_str()),
            data.get("AbstractURL").and_then(|u| u.as_str()),
        ) {
            if !abstract_text.is_empty() && !abstract_url.is_empty() {
                let title = data
                    .get("Heading")
                    .and_then(|h| h.as_str())
                    .unwrap_or("DuckDuckGo Instant Answer");
                results.insert(
                    0,
                    SearchResult {
                        title: title.to_string(),
                        url: abstract_url.to_string(),
                        snippet: Some(abstract_text.to_string()),
                        publish_date: None,
                    },
                );
            }
        }

        Ok(results)
    }

    /// Bing Search API 搜索
    async fn search_with_bing(
        &self,
        query: &str,
        api_key: &str,
    ) -> Result<Vec<SearchResult>, String> {
        let response = self
            .client
            .get("https://api.bing.microsoft.com/v7.0/search")
            .query(&[("q", query), ("count", "10")])
            .header("Ocp-Apim-Subscription-Key", api_key)
            .send()
            .await
            .map_err(|e| format!("Bing Search API 请求失败: {}", e))?;

        let data: serde_json::Value = response
            .json()
            .await
            .map_err(|e| format!("解析 Bing 响应失败: {}", e))?;

        let empty_vec = vec![];
        let web_pages = data
            .get("webPages")
            .and_then(|wp| wp.get("value"))
            .and_then(|v| v.as_array())
            .unwrap_or(&empty_vec);

        let results = web_pages
            .iter()
            .filter_map(|page| {
                let title = page.get("name")?.as_str()?.to_string();
                let url = page.get("url")?.as_str()?.to_string();
                let snippet = page
                    .get("snippet")
                    .and_then(|s| s.as_str())
                    .map(|s| s.to_string());
                let publish_date = page
                    .get("dateLastCrawled")
                    .and_then(|d| d.as_str())
                    .map(|d| d.to_string());

                Some(SearchResult {
                    title,
                    url,
                    snippet,
                    publish_date,
                })
            })
            .collect();

        Ok(results)
    }

    /// Google Custom Search API 搜索
    async fn search_with_google(
        &self,
        query: &str,
        api_key: &str,
        cx: &str,
    ) -> Result<Vec<SearchResult>, String> {
        let response = self
            .client
            .get("https://www.googleapis.com/customsearch/v1")
            .query(&[("key", api_key), ("cx", cx), ("q", query), ("num", "10")])
            .send()
            .await
            .map_err(|e| format!("Google Search API 请求失败: {}", e))?;

        let data: serde_json::Value = response
            .json()
            .await
            .map_err(|e| format!("解析 Google 响应失败: {}", e))?;

        let empty_vec = vec![];
        let items = data
            .get("items")
            .and_then(|i| i.as_array())
            .unwrap_or(&empty_vec);

        let results = items
            .iter()
            .filter_map(|item| {
                let title = item.get("title")?.as_str()?.to_string();
                let url = item.get("link")?.as_str()?.to_string();
                let snippet = item
                    .get("snippet")
                    .and_then(|s| s.as_str())
                    .map(|s| s.to_string());

                Some(SearchResult {
                    title,
                    url,
                    snippet,
                    publish_date: None,
                })
            })
            .collect();

        Ok(results)
    }
}

#[async_trait]
impl Tool for WebSearchTool {
    fn name(&self) -> &str {
        "WebSearch"
    }

    fn description(&self) -> &str {
        "允许当前代理搜索网络并使用结果来提供响应。\n\
         提供超出本地知识截止日期的最新信息。\n\
         返回格式化为搜索结果块的搜索结果信息，包括 Markdown 超链接。\n\
         用于访问本地知识截止日期之外的信息。\n\
         搜索在单个 API 调用中自动执行。"
    }

    fn input_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "minLength": 2,
                    "description": "要使用的搜索查询"
                },
                "allowed_domains": {
                    "type": "array",
                    "items": { "type": "string" },
                    "description": "仅包含来自这些域名的结果"
                },
                "blocked_domains": {
                    "type": "array",
                    "items": { "type": "string" },
                    "description": "永远不包含来自这些域名的结果"
                }
            },
            "required": ["query"]
        })
    }

    async fn check_permissions(
        &self,
        _params: &serde_json::Value,
        _context: &ToolContext,
    ) -> PermissionCheckResult {
        PermissionCheckResult::ask("WebSearch 将联网搜索最新信息，请确认后继续。")
    }

    async fn execute(
        &self,
        params: serde_json::Value,
        _context: &ToolContext,
    ) -> Result<ToolResult, ToolError> {
        let started_at = std::time::Instant::now();
        let input: WebSearchInput = serde_json::from_value(params)
            .map_err(|e| ToolError::execution_failed(format!("输入参数解析失败: {}", e)))?;

        let query = &input.query;
        if query.trim().len() < 2 {
            return Err(ToolError::invalid_params("query 至少需要 2 个非空白字符"));
        }
        if input
            .allowed_domains
            .as_ref()
            .is_some_and(|domains| !domains.is_empty())
            && input
                .blocked_domains
                .as_ref()
                .is_some_and(|domains| !domains.is_empty())
        {
            return Err(ToolError::invalid_params(
                "不能同时传 allowed_domains 和 blocked_domains",
            ));
        }
        let (allowed_domains, blocked_domains) =
            self.sanitize_domain_filters(query, input.allowed_domains, input.blocked_domains);

        // 生成缓存键
        let cache_key =
            WebCache::generate_search_cache_key(query, &allowed_domains, &blocked_domains);

        // 检查缓存
        if let Some(cached) = self.cache.get_cached_search(&cache_key) {
            let cache_age = cached
                .fetched_at
                .elapsed()
                .unwrap_or(Duration::ZERO)
                .as_secs()
                / 60; // 分钟

            let output = format!(
                "{}\n\n_[缓存结果，来自 {} 分钟前]_",
                self.format_search_results(&cached.results, query),
                cache_age
            );

            let structured = WebSearchOutput {
                query: query.clone(),
                results: vec![
                    WebSearchOutputEntry::Result(WebSearchResultBlock {
                        tool_use_id: "cached_web_search".to_string(),
                        content: cached
                            .results
                            .iter()
                            .map(|item| WebSearchHit {
                                title: item.title.clone(),
                                url: item.url.clone(),
                            })
                            .collect(),
                    }),
                    WebSearchOutputEntry::Text(output),
                ],
                duration_seconds: started_at.elapsed().as_secs_f64(),
            };

            return Ok(
                ToolResult::success(serde_json::to_string_pretty(&structured).map_err(
                    |error| {
                        ToolError::execution_failed(format!(
                            "序列化 WebSearch 缓存结果失败: {error}"
                        ))
                    },
                )?)
                .with_metadata(
                    "durationSeconds",
                    serde_json::json!(structured.duration_seconds),
                )
                .with_metadata(
                    "web_search",
                    serde_json::json!({
                        "cache_hit": true,
                        "cache_query": cached.query,
                        "allowed_domains": cached.allowed_domains,
                        "blocked_domains": cached.blocked_domains,
                    }),
                ),
            );
        }

        // 执行搜索
        match self.perform_search(query).await {
            Ok(search_execution) => {
                let raw_results = search_execution.results.clone();
                // 应用域名过滤
                let filtered_results = self.apply_domain_filters(
                    raw_results.clone(),
                    &allowed_domains,
                    &blocked_domains,
                );

                // 缓存结果（即使为空也缓存，避免重复请求）
                self.cache.cache_search(
                    cache_key,
                    CachedSearchResults {
                        query: query.clone(),
                        results: filtered_results.clone(),
                        fetched_at: SystemTime::now(),
                        allowed_domains: allowed_domains.clone(),
                        blocked_domains: blocked_domains.clone(),
                    },
                );

                let web_search_metadata = serde_json::json!({
                    "cache_hit": false,
                    "selected_provider": search_execution.selected_provider.as_env_value(),
                    "configured_priority": search_execution
                        .configured_priority
                        .iter()
                        .map(|provider| provider.as_env_value())
                        .collect::<Vec<_>>(),
                    "attempts": search_execution
                        .attempts
                        .iter()
                        .map(SearchAttempt::as_json)
                        .collect::<Vec<_>>(),
                    "provider_metadata": search_execution.provider_metadata,
                });

                // 如果有真实结果，格式化并返回
                if !filtered_results.is_empty() {
                    let structured = WebSearchOutput {
                        query: query.clone(),
                        results: vec![
                            WebSearchOutputEntry::Result(WebSearchResultBlock {
                                tool_use_id: "web_search".to_string(),
                                content: filtered_results
                                    .iter()
                                    .map(|item| WebSearchHit {
                                        title: item.title.clone(),
                                        url: item.url.clone(),
                                    })
                                    .collect(),
                            }),
                            WebSearchOutputEntry::Text(
                                self.format_search_results(&filtered_results, query),
                            ),
                        ],
                        duration_seconds: started_at.elapsed().as_secs_f64(),
                    };
                    Ok(
                        ToolResult::success(serde_json::to_string_pretty(&structured).map_err(
                            |error| {
                                ToolError::execution_failed(format!(
                                    "序列化 WebSearch 结果失败: {error}"
                                ))
                            },
                        )?)
                        .with_metadata(
                            "durationSeconds",
                            serde_json::json!(structured.duration_seconds),
                        )
                        .with_metadata("web_search", web_search_metadata),
                    )
                } else if !raw_results.is_empty() {
                    // 如果搜索返回了结果但被过滤器全部过滤掉了
                    let allowed_str = allowed_domains
                        .as_ref()
                        .map(|d: &Vec<String>| d.join(", "))
                        .unwrap_or_else(|| "全部".to_string());
                    let blocked_str = blocked_domains
                        .as_ref()
                        .map(|d: &Vec<String>| d.join(", "))
                        .unwrap_or_else(|| "无".to_string());

                    let structured = WebSearchOutput {
                        query: query.clone(),
                        results: vec![WebSearchOutputEntry::Text(format!(
                            "应用域名过滤器后未找到结果。允许的域名: {}；阻止的域名: {}。",
                            allowed_str, blocked_str
                        ))],
                        duration_seconds: started_at.elapsed().as_secs_f64(),
                    };
                    Ok(
                        ToolResult::success(serde_json::to_string_pretty(&structured).map_err(
                            |error| {
                                ToolError::execution_failed(format!(
                                    "序列化 WebSearch 过滤结果失败: {error}"
                                ))
                            },
                        )?)
                        .with_metadata(
                            "durationSeconds",
                            serde_json::json!(structured.duration_seconds),
                        )
                        .with_metadata("web_search", web_search_metadata),
                    )
                } else {
                    // 如果搜索 API 没有返回结果
                    let configured_chain = search_execution
                        .configured_priority
                        .iter()
                        .map(|provider| provider.as_env_value())
                        .collect::<Vec<_>>()
                        .join(" -> ");
                    let structured = WebSearchOutput {
                        query: query.clone(),
                        results: vec![WebSearchOutputEntry::Text(format!(
                            "未找到结果。当前搜索提供商链路: {}",
                            configured_chain
                        ))],
                        duration_seconds: started_at.elapsed().as_secs_f64(),
                    };
                    Ok(
                        ToolResult::success(serde_json::to_string_pretty(&structured).map_err(
                            |error| {
                                ToolError::execution_failed(format!(
                                    "序列化 WebSearch 空结果失败: {error}"
                                ))
                            },
                        )?)
                        .with_metadata(
                            "durationSeconds",
                            serde_json::json!(structured.duration_seconds),
                        )
                        .with_metadata("web_search", web_search_metadata),
                    )
                }
            }
            Err(e) => Err(ToolError::execution_failed(format!("搜索失败: {}", e))),
        }
    }
}

/// 缓存统计信息
pub fn get_web_cache_stats(cache: &WebCache) -> serde_json::Value {
    serde_json::json!({
        "fetch": {
            "size": cache.fetch_cache.lock().unwrap().len(),
            "capacity": cache.fetch_cache.lock().unwrap().cap(),
        },
        "search": {
            "size": cache.search_cache.lock().unwrap().len(),
            "capacity": cache.search_cache.lock().unwrap().cap(),
        }
    })
}

/// 清除所有 Web 缓存
pub fn clear_web_caches(cache: &WebCache) {
    cache.fetch_cache.lock().unwrap().clear();
    cache.search_cache.lock().unwrap().clear();
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tools::base::PermissionBehavior;
    use std::collections::HashMap;

    #[tokio::test]
    async fn test_web_fetch_tool_creation() {
        let tool = WebFetchTool::new();
        assert_eq!(tool.name(), "WebFetch");
        assert!(!tool.description().is_empty());
    }

    #[tokio::test]
    async fn test_web_search_tool_creation() {
        let tool = WebSearchTool::new();
        assert_eq!(tool.name(), "WebSearch");
        assert!(!tool.description().is_empty());
    }

    #[test]
    fn test_web_cache_creation() {
        let cache = WebCache::new();
        assert!(cache.fetch_cache.lock().unwrap().is_empty());
        assert!(cache.search_cache.lock().unwrap().is_empty());
    }

    #[test]
    fn test_search_cache_key_generation() {
        let key1 = WebCache::generate_search_cache_key(
            "test query",
            &Some(vec!["example.com".to_string()]),
            &None,
        );
        let key2 = WebCache::generate_search_cache_key(
            "test query",
            &Some(vec!["example.com".to_string()]),
            &None,
        );
        let key3 = WebCache::generate_search_cache_key(
            "different query",
            &Some(vec!["example.com".to_string()]),
            &None,
        );

        assert_eq!(key1, key2);
        assert_ne!(key1, key3);
    }

    #[test]
    fn test_domain_extraction() {
        let tool = WebSearchTool::new();

        assert_eq!(
            tool.extract_domain("https://www.example.com/path"),
            "example.com"
        );
        assert_eq!(tool.extract_domain("https://example.com"), "example.com");
        assert_eq!(
            tool.extract_domain("http://subdomain.example.com"),
            "subdomain.example.com"
        );
        assert_eq!(tool.extract_domain("invalid-url"), "");
    }

    #[test]
    fn test_domain_filtering() {
        let tool = WebSearchTool::new();
        let results = vec![
            SearchResult {
                title: "Example 1".to_string(),
                url: "https://example.com/1".to_string(),
                snippet: None,
                publish_date: None,
            },
            SearchResult {
                title: "Test 1".to_string(),
                url: "https://test.com/1".to_string(),
                snippet: None,
                publish_date: None,
            },
        ];

        // 测试白名单过滤
        let allowed = Some(vec!["example.com".to_string()]);
        let filtered = tool.apply_domain_filters(results.clone(), &allowed, &None);
        assert_eq!(filtered.len(), 1);
        assert_eq!(filtered[0].title, "Example 1");

        // 测试黑名单过滤
        let blocked = Some(vec!["test.com".to_string()]);
        let filtered = tool.apply_domain_filters(results, &None, &blocked);
        assert_eq!(filtered.len(), 1);
        assert_eq!(filtered[0].title, "Example 1");
    }

    #[test]
    fn test_sanitize_domain_filters_prefers_allowed_when_both_present() {
        let tool = WebSearchTool::new();

        let (allowed, blocked) = tool.sanitize_domain_filters(
            "latest ai news",
            Some(vec!["Example.com".to_string()]),
            Some(vec!["spam.com".to_string()]),
        );

        assert_eq!(allowed, Some(vec!["example.com".to_string()]));
        assert!(blocked.is_none());
    }

    #[test]
    fn test_sanitize_domain_filters_drop_empty_items() {
        let tool = WebSearchTool::new();

        let (allowed, blocked) = tool.sanitize_domain_filters(
            "latest ai news",
            Some(vec![" ".to_string(), "".to_string()]),
            Some(vec!["  ".to_string()]),
        );

        assert!(allowed.is_none());
        assert!(blocked.is_none());
    }

    #[test]
    fn test_dynamic_filter_content_prefers_relevant_chunks() {
        let tool = WebFetchTool::new();
        let content = "Football match report and scores.\n\nRust ownership and borrow checker explanation.\n\nTravel tips and hotel recommendations.";
        let input = WebFetchInput {
            url: "https://example.com".to_string(),
            prompt: "总结 Rust 所有权".to_string(),
            focus_query: Some("Rust ownership borrow checker".to_string()),
            dynamic_filter: true,
            max_chars: Some(3000),
            max_chunks: Some(2),
        };

        let (filtered, used_dynamic_filter) = tool.prepare_response_content(content, &input);
        assert!(used_dynamic_filter);
        assert!(filtered.contains("Rust ownership"));
        assert!(!filtered.contains("Football match report"));
    }

    #[test]
    fn test_dynamic_filter_disabled_keeps_original_mode() {
        let tool = WebFetchTool::new();
        let content = "Paragraph A.\n\nParagraph B with random text.";
        let input = WebFetchInput {
            url: "https://example.com".to_string(),
            prompt: "简单总结".to_string(),
            focus_query: None,
            dynamic_filter: false,
            max_chars: Some(3000),
            max_chunks: None,
        };

        let (result, used_dynamic_filter) = tool.prepare_response_content(content, &input);
        assert!(!used_dynamic_filter);
        assert!(result.contains("Paragraph A."));
        assert!(result.contains("Paragraph B with random text."));
    }

    #[tokio::test]
    async fn test_web_fetch_permissions_require_confirmation() {
        let tool = WebFetchTool::new();
        let result = tool
            .check_permissions(
                &serde_json::json!({
                    "url": "https://example.com/docs",
                    "prompt": "总结内容"
                }),
                &ToolContext::default(),
            )
            .await;

        assert_eq!(result.behavior, PermissionBehavior::Ask);
        assert_eq!(
            result.message,
            Some("WebFetch 将访问远程站点 example.com，请确认后继续。".to_string())
        );
    }

    #[tokio::test]
    async fn test_web_fetch_permissions_allow_preapproved_host() {
        let tool = WebFetchTool::new();
        let result = tool
            .check_permissions(
                &serde_json::json!({
                    "url": "https://react.dev/reference/react/useEffect",
                    "prompt": "总结内容"
                }),
                &ToolContext::default(),
            )
            .await;

        assert_eq!(result.behavior, PermissionBehavior::Allow);
        assert!(result.message.is_none());
    }

    #[test]
    fn test_web_fetch_preapproved_path_prefix_matches_exact_scope() {
        assert!(is_preapproved_web_fetch_host(
            "github.com",
            "/anthropics/claude-code"
        ));
        assert!(!is_preapproved_web_fetch_host(
            "github.com",
            "/anthropics-evil/claude-code"
        ));
    }

    #[test]
    fn test_web_fetch_permitted_redirect_allows_same_host_or_www_changes() {
        let original = Url::parse("https://example.com/docs").unwrap();
        let same_host = Url::parse("https://example.com/docs/getting-started").unwrap();
        let add_www = Url::parse("https://www.example.com/docs").unwrap();
        let remove_www = Url::parse("https://example.com/docs").unwrap();
        let original_www = Url::parse("https://www.example.com/docs").unwrap();

        assert!(is_permitted_web_fetch_redirect(&original, &same_host));
        assert!(is_permitted_web_fetch_redirect(&original, &add_www));
        assert!(is_permitted_web_fetch_redirect(&original_www, &remove_www));
    }

    #[test]
    fn test_web_fetch_permitted_redirect_rejects_cross_host() {
        let original = Url::parse("https://example.com/docs").unwrap();
        let redirect = Url::parse("https://evil.example.net/phish").unwrap();

        assert!(!is_permitted_web_fetch_redirect(&original, &redirect));
    }

    #[tokio::test]
    async fn test_web_search_permissions_require_confirmation() {
        let tool = WebSearchTool::new();
        let result = tool
            .check_permissions(
                &serde_json::json!({
                    "query": "latest ai news"
                }),
                &ToolContext::default(),
            )
            .await;

        assert_eq!(result.behavior, PermissionBehavior::Ask);
        assert_eq!(
            result.message,
            Some("WebSearch 将联网搜索最新信息，请确认后继续。".to_string())
        );
    }

    #[tokio::test]
    async fn test_web_search_rejects_short_query() {
        let tool = WebSearchTool::new();
        let error = tool
            .execute(
                serde_json::json!({
                    "query": " "
                }),
                &ToolContext::default(),
            )
            .await
            .expect_err("short query should be rejected");

        assert!(error.to_string().contains("query 至少需要 2 个非空白字符"));
    }

    #[test]
    fn test_search_runtime_config_priority_resolution() {
        let mut env = HashMap::new();
        env.insert(
            "WEB_SEARCH_PROVIDER_PRIORITY".to_string(),
            "multi_search_engine, tavily,unknown,bing_search_api".to_string(),
        );
        let resolved = SearchRuntimeConfig::from_env_map(&env);

        assert_eq!(
            resolved.priority.first().copied(),
            Some(SearchProviderKind::MultiSearchEngine)
        );
        assert!(resolved.priority.contains(&SearchProviderKind::Tavily));
        assert!(resolved
            .priority
            .contains(&SearchProviderKind::BingSearchApi));
        assert!(resolved
            .priority
            .contains(&SearchProviderKind::GoogleCustomSearch));
        assert!(resolved
            .priority
            .contains(&SearchProviderKind::DuckduckgoInstant));
    }

    #[test]
    fn test_deduplicate_results_should_keep_unique_urls() {
        let tool = WebSearchTool::new();
        let input = vec![
            SearchResult {
                title: "A".to_string(),
                url: "https://example.com/a".to_string(),
                snippet: None,
                publish_date: None,
            },
            SearchResult {
                title: "A duplicate".to_string(),
                url: "https://example.com/a".to_string(),
                snippet: None,
                publish_date: None,
            },
            SearchResult {
                title: "B".to_string(),
                url: "https://example.com/b".to_string(),
                snippet: None,
                publish_date: None,
            },
        ];

        let deduped = tool.deduplicate_results(input, 10);
        assert_eq!(deduped.len(), 2);
        assert_eq!(deduped[0].url, "https://example.com/a");
        assert_eq!(deduped[1].url, "https://example.com/b");
    }

    #[test]
    fn test_build_multi_search_engine_order_prefers_priority() {
        let tool = WebSearchTool::new();
        let config = MultiSearchEngineConfig {
            engines: vec![
                MultiSearchEngineEntry {
                    name: "custom".to_string(),
                    url_template: "https://custom.example/search?q={query}".to_string(),
                    enabled: true,
                },
                MultiSearchEngineEntry {
                    name: "bing".to_string(),
                    url_template: "https://www.bing.com/search?q={query}".to_string(),
                    enabled: true,
                },
            ],
            priority: vec!["custom".to_string(), "duckduckgo".to_string()],
            max_results_per_engine: 3,
            max_total_results: 10,
            timeout_ms: 3000,
        };

        let ordered = tool.build_multi_search_engine_order(&config);
        assert!(!ordered.is_empty());
        assert_eq!(ordered[0].name, "custom");
    }

    #[test]
    fn test_normalize_search_result_url_handles_redirect_param() {
        let tool = WebSearchTool::new();
        let normalized = tool.normalize_search_result_url(
            "https://www.google.com/url?q=https://example.com/news",
            Some("www.google.com"),
        );
        assert_eq!(normalized.as_deref(), Some("https://example.com/news"));
    }
}
