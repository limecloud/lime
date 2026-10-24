use crate::tool_definition::RuntimeToolDefinition;
use crate::tool_executor::{
    RuntimeToolExecutionError, RuntimeToolExecutionFuture, RuntimeToolExecutionRequest,
    RuntimeToolExecutionResult, RuntimeToolExecutor, RuntimeToolExecutorHandle,
    RuntimeToolPolicyErrorKind,
};
use reqwest::{redirect::Policy, Client};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime};
use url::{Host, Url};

pub const WEB_FETCH_TOOL_NAME: &str = "WebFetch";

const MAX_RESPONSE_SIZE: usize = 10 * 1024 * 1024;
const MAX_WEB_FETCH_REDIRECTS: usize = 10;
const WEB_FETCH_CACHE_TTL: Duration = Duration::from_secs(15 * 60);
const WEB_FETCH_CACHE_CAPACITY: usize = 100;

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

#[derive(Clone)]
pub struct RuntimeWebFetchExecutor {
    client: Client,
    cache: Arc<WebFetchCache>,
}

impl RuntimeWebFetchExecutor {
    pub fn new() -> Self {
        let client = Client::builder()
            .timeout(Duration::from_secs(30))
            .redirect(Policy::none())
            .user_agent("Mozilla/5.0 (compatible; ToolRuntime/1.0)")
            .build()
            .unwrap_or_else(|_| Client::new());

        Self {
            client,
            cache: Arc::new(WebFetchCache::default()),
        }
    }

    pub fn handle() -> RuntimeToolExecutorHandle {
        RuntimeToolExecutorHandle::new(Arc::new(Self::new()))
    }

    async fn execute_web_fetch(
        &self,
        request: RuntimeToolExecutionRequest<'_>,
    ) -> Result<RuntimeToolExecutionResult, RuntimeToolExecutionError> {
        if !is_web_fetch_tool_name(request.tool_name) {
            return Err(runtime_web_fetch_error(format!(
                "unsupported web fetch tool: {}",
                request.tool_name
            )));
        }
        let mode = request
            .turn_context
            .and_then(|context| context.web_search_mode)
            .unwrap_or_default();
        match mode {
            agent_protocol::WebSearchMode::Disabled => {
                return Err(runtime_web_fetch_error(
                    "web search is disabled by the current access policy",
                ))
            }
            agent_protocol::WebSearchMode::Indexed => {
                return Err(runtime_web_fetch_error(
                    "indexed web fetch is unavailable in the local backend",
                ))
            }
            _ => {}
        }
        ensure_not_cancelled(request)?;

        let started_at = Instant::now();
        let input = serde_json::from_value::<WebFetchInput>(request.params.clone())
            .map_err(|error| runtime_web_fetch_error(format!("输入参数解析失败: {error}")))?;
        let url = normalize_fetch_url(&input.url)?;

        if let Some(cached) = self.cache.get(&url) {
            return runtime_result_from_content(&url, cached, &input, started_at, true);
        }

        if mode == agent_protocol::WebSearchMode::Cached {
            return Err(runtime_web_fetch_error(
                "no cached page is available; cached mode does not permit a network request",
            ));
        }
        match self.fetch_url(&url, request).await {
            Ok(WebFetchResponse::Content {
                content,
                content_type,
                status_code,
            }) => {
                if status_code >= 400 {
                    return Err(runtime_web_fetch_error(format!(
                        "HTTP 错误: {} {}",
                        status_code,
                        http_status_text(status_code)
                    )));
                }

                let cached = CachedWebFetchContent {
                    content,
                    content_type,
                    status_code,
                    fetched_at: SystemTime::now(),
                };
                self.cache.insert(url.clone(), cached.clone());
                runtime_result_from_content(&url, cached, &input, started_at, false)
            }
            Ok(WebFetchResponse::Redirect {
                original_url,
                redirect_url,
                status_code,
            }) => runtime_result_from_redirect(
                &url,
                &input,
                original_url,
                redirect_url,
                status_code,
                started_at,
            ),
            Err(error) => Err(runtime_web_fetch_error(format!("获取失败: {error}"))),
        }
    }

    async fn fetch_url(
        &self,
        url: &str,
        request: RuntimeToolExecutionRequest<'_>,
    ) -> Result<WebFetchResponse, String> {
        let mut current_url = url.to_string();

        for _ in 0..=MAX_WEB_FETCH_REDIRECTS {
            ensure_not_cancelled(request).map_err(|error| error.message().to_string())?;
            let parsed_url =
                Url::parse(&current_url).map_err(|error| format!("无效的 URL: {error}"))?;
            check_web_fetch_url_safety(&parsed_url)?;

            let response = self
                .client
                .get(current_url.clone())
                .header("User-Agent", "Mozilla/5.0 (compatible; ToolRuntime/1.0)")
                .header(
                    "Accept",
                    "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                )
                .send()
                .await
                .map_err(|error| format!("请求失败: {error}"))?;

            let status_code = response.status().as_u16();
            if matches!(status_code, 301 | 302 | 307 | 308) {
                let location = response
                    .headers()
                    .get(reqwest::header::LOCATION)
                    .and_then(|value| value.to_str().ok())
                    .ok_or_else(|| "重定向响应缺少 Location 头".to_string())?;
                let redirect_url = parsed_url
                    .join(location)
                    .map_err(|error| format!("解析重定向 URL 失败: {error}"))?;

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

            if let Some(content_length) = response.content_length() {
                if content_length > MAX_RESPONSE_SIZE as u64 {
                    return Err(format!(
                        "响应体大小 ({content_length} 字节) 超过最大限制 ({MAX_RESPONSE_SIZE} 字节)"
                    ));
                }
            }

            let content_type = response
                .headers()
                .get(reqwest::header::CONTENT_TYPE)
                .and_then(|value| value.to_str().ok())
                .unwrap_or_default()
                .to_string();
            let body = response
                .text()
                .await
                .map_err(|error| format!("读取响应体失败: {error}"))?;
            if body.len() > MAX_RESPONSE_SIZE {
                return Err(format!(
                    "内容大小 ({} 字节) 超过最大限制 ({} 字节)",
                    body.len(),
                    MAX_RESPONSE_SIZE
                ));
            }

            let content = normalize_response_body(&body, &content_type);
            return Ok(WebFetchResponse::Content {
                content,
                content_type,
                status_code,
            });
        }

        Err(format!(
            "重定向次数过多（超过 {MAX_WEB_FETCH_REDIRECTS} 次）"
        ))
    }
}

impl Default for RuntimeWebFetchExecutor {
    fn default() -> Self {
        Self::new()
    }
}

impl RuntimeToolExecutor for RuntimeWebFetchExecutor {
    fn execute<'a>(
        &'a self,
        request: RuntimeToolExecutionRequest<'a>,
    ) -> RuntimeToolExecutionFuture<'a> {
        Box::pin(async move { self.execute_web_fetch(request).await })
    }
}

pub fn runtime_web_fetch_executor_handle() -> RuntimeToolExecutorHandle {
    static HANDLE: OnceLock<RuntimeToolExecutorHandle> = OnceLock::new();
    HANDLE.get_or_init(RuntimeWebFetchExecutor::handle).clone()
}

pub fn web_fetch_tool_definition() -> RuntimeToolDefinition {
    RuntimeToolDefinition::new(
        WEB_FETCH_TOOL_NAME,
        "获取指定 URL 的内容，将 HTML 转换为 Markdown，并按提示返回相关片段。",
        json!({
            "type": "object",
            "properties": {
                "url": {
                    "type": "string",
                    "format": "uri",
                    "description": "要获取内容的 URL"
                },
                "prompt": {
                    "type": "string",
                    "description": "用于筛选和处理获取内容的提示词"
                },
                "focus_query": {
                    "type": "string",
                    "description": "可选。用于动态过滤页面内容的关键词或问题"
                },
                "dynamic_filter": {
                    "type": "boolean",
                    "description": "可选。启用后仅返回与 prompt/focus_query 相关的片段"
                },
                "max_chars": {
                    "type": "integer",
                    "minimum": 500,
                    "description": "可选。输出最大字符数，默认 20000"
                },
                "max_chunks": {
                    "type": "integer",
                    "minimum": 1,
                    "description": "可选。动态过滤保留的最大内容片段数，默认 8"
                }
            },
            "required": ["url", "prompt"]
        }),
    )
}

pub fn is_web_fetch_tool_name(tool_name: &str) -> bool {
    matches!(
        tool_lookup_key(tool_name).as_str(),
        "webfetch" | "webfetchtool" | "mcpsystemwebfetch"
    )
}

pub fn is_preapproved_web_fetch_host(hostname: &str, pathname: &str) -> bool {
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

include!("web_fetch/content.rs");

#[cfg(test)]
mod tests {
    #[tokio::test]
    async fn web_search_access_also_restricts_page_fetch_without_network_fallback() {
        use agent_protocol::WebSearchMode;
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let executor = RuntimeWebFetchExecutor {
            client: Client::builder()
                .proxy(
                    reqwest::Proxy::all(format!("http://{}", listener.local_addr().unwrap()))
                        .unwrap(),
                )
                .timeout(Duration::from_millis(100))
                .build()
                .unwrap(),
            cache: Arc::new(WebFetchCache::default()),
        };
        let context = RuntimeToolExecutionContext::new(RuntimeToolExecutionContextInput {
            working_directory: ".".into(),
            session_id: "fetch-access".into(),
            cancel_token: None,
            workspace_sandbox: None,
        });
        let params = json!({"url":"https://example.com/page","prompt":"read page"});
        for mode in [
            WebSearchMode::Disabled,
            WebSearchMode::Cached,
            WebSearchMode::Indexed,
        ] {
            let turn = crate::tool_executor::RuntimeToolTurnContext {
                web_search_mode: Some(mode),
                ..Default::default()
            };
            let result = executor
                .execute_web_fetch(RuntimeToolExecutionRequest {
                    tool_name: "WebFetch",
                    params: &params,
                    context: &context,
                    turn_context: Some(&turn),
                })
                .await;
            let error = result.unwrap_err();
            assert!(error.message().contains(match mode {
                WebSearchMode::Disabled => "disabled",
                WebSearchMode::Cached => "does not permit",
                _ => "unavailable",
            }));
            assert!(
                matches!(listener.accept(),Err(error) if error.kind()==std::io::ErrorKind::WouldBlock)
            );
        }
    }
    use super::*;
    use crate::tool_executor::{RuntimeToolExecutionContext, RuntimeToolExecutionContextInput};
    use serde_json::json;
    use std::path::PathBuf;

    #[test]
    fn web_fetch_tool_name_matches_current_aliases() {
        assert!(is_web_fetch_tool_name("WebFetch"));
        assert!(is_web_fetch_tool_name("WebFetchTool"));
        assert!(is_web_fetch_tool_name("mcp__system__web_fetch"));
        assert!(!is_web_fetch_tool_name("WebSearch"));
    }

    #[test]
    fn web_fetch_preapproved_path_prefix_matches_exact_scope() {
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
    fn web_fetch_blocks_private_and_metadata_hosts() {
        for raw in [
            "https://localhost/docs",
            "https://127.0.0.1/docs",
            "https://169.254.169.254/latest/meta-data",
            "https://metadata.google.internal/computeMetadata/v1",
        ] {
            let url = Url::parse(raw).unwrap();
            assert!(check_web_fetch_url_safety(&url).is_err(), "{raw}");
        }
    }

    #[test]
    fn web_fetch_permitted_redirect_allows_same_host_or_www_changes() {
        let original = Url::parse("https://example.com/docs").unwrap();
        let same_host = Url::parse("https://example.com/docs/getting-started").unwrap();
        let add_www = Url::parse("https://www.example.com/docs").unwrap();
        let original_www = Url::parse("https://www.example.com/docs").unwrap();
        let remove_www = Url::parse("https://example.com/docs").unwrap();

        assert!(is_permitted_web_fetch_redirect(&original, &same_host));
        assert!(is_permitted_web_fetch_redirect(&original, &add_www));
        assert!(is_permitted_web_fetch_redirect(&original_www, &remove_www));
    }

    #[test]
    fn web_fetch_permitted_redirect_rejects_cross_host() {
        let original = Url::parse("https://example.com/docs").unwrap();
        let redirect = Url::parse("https://evil.example.net/phish").unwrap();

        assert!(!is_permitted_web_fetch_redirect(&original, &redirect));
    }

    #[tokio::test]
    async fn runtime_web_fetch_executor_rejects_non_web_fetch_tools() {
        let executor = RuntimeWebFetchExecutor::new();
        let context = RuntimeToolExecutionContext::new(RuntimeToolExecutionContextInput {
            working_directory: PathBuf::from("."),
            session_id: "session-test".to_string(),
            cancel_token: None,
            workspace_sandbox: None,
        });

        let error = executor
            .execute_web_fetch(RuntimeToolExecutionRequest {
                tool_name: "WebSearch",
                params: &json!({ "url": "https://example.com", "prompt": "summary" }),
                context: &context,
                turn_context: None,
            })
            .await
            .expect_err("non WebFetch tool should fail");

        assert!(error.message().contains("unsupported web fetch tool"));
    }
}
