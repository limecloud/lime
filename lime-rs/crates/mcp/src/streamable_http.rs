use crate::oauth::{is_loopback_http_url, oauth_error, oauth_http_client};
use crate::types::{McpError, McpServerConfig, McpServerTransport};
use reqwest::header::{HeaderMap, HeaderName, HeaderValue, AUTHORIZATION};
use rmcp::transport::auth::{AuthClient, AuthorizationManager};
use rmcp::transport::{
    streamable_http_client::StreamableHttpClientTransportConfig, StreamableHttpClientTransport,
};
use std::collections::HashMap;

pub fn build_streamable_http_transport(
    config: &McpServerConfig,
) -> Result<StreamableHttpClientTransport<reqwest::Client>, McpError> {
    let McpServerTransport::StreamableHttp {
        url,
        bearer_token_env_var,
        http_headers,
        env_http_headers,
    } = &config.transport
    else {
        return Err(McpError::ConfigError(
            "streamable HTTP 启动收到非 HTTP 配置".to_string(),
        ));
    };

    let mut transport_config = StreamableHttpClientTransportConfig::with_uri(url.clone());
    if let Some(env_var) = bearer_token_env_var.as_deref() {
        let env_var = clean_env_var_name(env_var)?;
        let token = std::env::var(env_var).map_err(|_| {
            McpError::ConfigError(format!(
                "streamable HTTP MCP bearer token 环境变量未设置: {env_var}"
            ))
        })?;
        transport_config = transport_config.auth_header(token);
    }

    let headers = build_default_headers(
        bearer_token_env_var.as_deref(),
        http_headers.as_ref(),
        env_http_headers.as_ref(),
        |name| std::env::var(name),
    )?;
    let mut builder = reqwest::Client::builder();
    if is_loopback_http_url(url) {
        builder = builder.no_proxy();
    }
    if !headers.is_empty() {
        builder = builder.default_headers(headers);
    }
    let client = builder.build().map_err(|error| {
        McpError::ConfigError(format!(
            "streamable HTTP MCP 自定义 header client 构造失败: {error}"
        ))
    })?;

    Ok(StreamableHttpClientTransport::with_client(
        client,
        transport_config,
    ))
}

pub async fn build_oauth_streamable_http_transport(
    config: &McpServerConfig,
    auth_manager: AuthorizationManager,
) -> Result<StreamableHttpClientTransport<AuthClient<reqwest::Client>>, McpError> {
    let McpServerTransport::StreamableHttp {
        url,
        http_headers,
        env_http_headers,
        ..
    } = &config.transport
    else {
        return Err(McpError::ConfigError(
            "streamable HTTP OAuth 启动收到非 HTTP 配置".to_string(),
        ));
    };

    let _ = auth_manager.get_access_token().await.map_err(oauth_error)?;
    let client = oauth_http_client(
        Some(url.as_str()),
        None,
        http_headers.as_ref(),
        env_http_headers.as_ref(),
    )?;
    let auth_client = AuthClient::new(client, auth_manager);
    Ok(StreamableHttpClientTransport::with_client(
        auth_client,
        StreamableHttpClientTransportConfig::with_uri(url.clone()),
    ))
}

pub(crate) fn build_default_headers<F>(
    bearer_token_env_var: Option<&str>,
    http_headers: Option<&HashMap<String, String>>,
    env_http_headers: Option<&HashMap<String, String>>,
    env_lookup: F,
) -> Result<HeaderMap, McpError>
where
    F: Fn(&str) -> Result<String, std::env::VarError>,
{
    let mut headers = HeaderMap::new();
    let has_bearer_token = bearer_token_env_var.is_some();

    if let Some(http_headers) = http_headers {
        for (name, value) in http_headers {
            insert_header(&mut headers, name, value, has_bearer_token)?;
        }
    }

    if let Some(env_http_headers) = env_http_headers {
        for (name, env_var) in env_http_headers {
            let env_var = clean_env_var_name(env_var)?;
            let Ok(value) = env_lookup(env_var) else {
                tracing::warn!(
                    header_name = %name,
                    env_var = %env_var,
                    "streamable HTTP MCP 环境变量 header 未设置，已跳过"
                );
                continue;
            };
            if value.trim().is_empty() {
                tracing::warn!(
                    header_name = %name,
                    env_var = %env_var,
                    "streamable HTTP MCP 环境变量 header 为空，已跳过"
                );
                continue;
            }
            insert_header(&mut headers, name, &value, has_bearer_token)?;
        }
    }

    Ok(headers)
}

fn clean_env_var_name(env_var: &str) -> Result<&str, McpError> {
    let env_var = env_var.trim();
    if env_var.is_empty() {
        return Err(McpError::ConfigError(
            "streamable HTTP MCP 环境变量名不能为空".to_string(),
        ));
    }
    Ok(env_var)
}

fn insert_header(
    headers: &mut HeaderMap,
    name: &str,
    value: &str,
    has_bearer_token: bool,
) -> Result<(), McpError> {
    let header_name = HeaderName::from_bytes(name.as_bytes()).map_err(|error| {
        McpError::ConfigError(format!(
            "streamable HTTP MCP header 名称无效 '{name}': {error}"
        ))
    })?;
    if has_bearer_token && header_name == AUTHORIZATION {
        return Err(McpError::ConfigError(
            "streamable HTTP MCP 不能同时配置 bearer_token_env_var 和 authorization header"
                .to_string(),
        ));
    }
    if headers.contains_key(&header_name) {
        return Err(McpError::ConfigError(format!(
            "streamable HTTP MCP header 重复配置: {name}"
        )));
    }

    let header_value = HeaderValue::from_str(value).map_err(|error| {
        McpError::ConfigError(format!(
            "streamable HTTP MCP header 值无效 '{name}': {error}"
        ))
    })?;
    headers.insert(header_name, header_value);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn resolve_env(name: &str) -> Result<String, std::env::VarError> {
        match name {
            "MCP_TRACE" => Ok("trace-1".to_string()),
            "MCP_AUTH" => Ok("Bearer env-token".to_string()),
            "EMPTY_TRACE" => Ok("   ".to_string()),
            _ => Err(std::env::VarError::NotPresent),
        }
    }

    #[test]
    fn accepts_literal_and_env_headers() {
        let literal = HashMap::from([("X-Foo".to_string(), "bar".to_string())]);
        let env = HashMap::from([("X-Trace".to_string(), "MCP_TRACE".to_string())]);

        let headers = build_default_headers(None, Some(&literal), Some(&env), resolve_env)
            .expect("headers should resolve");

        assert_eq!(headers.get("x-foo").unwrap(), "bar");
        assert_eq!(headers.get("x-trace").unwrap(), "trace-1");
    }

    #[test]
    fn missing_env_header_is_skipped_like_host() {
        let env = HashMap::from([("X-Trace".to_string(), "MISSING_TRACE".to_string())]);

        let headers = build_default_headers(None, None, Some(&env), resolve_env)
            .expect("missing optional env header should be skipped");

        assert!(headers.is_empty());
    }

    #[test]
    fn empty_env_header_is_skipped_like_host() {
        let env = HashMap::from([("X-Trace".to_string(), "EMPTY_TRACE".to_string())]);

        let headers = build_default_headers(None, None, Some(&env), resolve_env)
            .expect("empty optional env header should be skipped");

        assert!(headers.is_empty());
    }

    #[test]
    fn invalid_header_name_fails_closed() {
        let literal = HashMap::from([("bad header".to_string(), "bar".to_string())]);

        let error = build_default_headers(None, Some(&literal), None, resolve_env).unwrap_err();

        assert!(error.to_string().contains("header 名称无效"));
    }

    #[test]
    fn invalid_header_value_fails_closed() {
        let literal = HashMap::from([("X-Foo".to_string(), "bad\r\nvalue".to_string())]);

        let error = build_default_headers(None, Some(&literal), None, resolve_env).unwrap_err();

        assert!(error.to_string().contains("header 值无效"));
    }

    #[test]
    fn duplicate_headers_fail_closed() {
        let literal = HashMap::from([("X-Foo".to_string(), "bar".to_string())]);
        let env = HashMap::from([("x-foo".to_string(), "MCP_TRACE".to_string())]);

        let error =
            build_default_headers(None, Some(&literal), Some(&env), resolve_env).unwrap_err();

        assert!(error.to_string().contains("header 重复配置"));
    }

    #[test]
    fn bearer_env_var_conflicts_with_authorization_header() {
        let env = HashMap::from([("Authorization".to_string(), "MCP_AUTH".to_string())]);

        let error =
            build_default_headers(Some("MCP_TOKEN"), None, Some(&env), resolve_env).unwrap_err();

        assert!(error.to_string().contains("bearer_token_env_var"));
    }
}
