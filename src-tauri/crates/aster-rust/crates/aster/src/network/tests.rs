//! Network 模块测试

use super::*;

#[test]
fn test_proxy_config_default() {
    let config = ProxyConfig::default();
    assert!(config.http.is_none());
    assert!(config.https.is_none());
    // use_system_proxy defaults to false in Default trait
}

#[test]
fn test_parse_proxy_url_simple() {
    let parsed = parse_proxy_url("http://proxy.example.com:8080");
    assert_eq!(parsed.url, "http://proxy.example.com:8080/");
    assert!(parsed.username.is_none());
    assert!(parsed.password.is_none());
}

#[test]
fn test_parse_proxy_url_with_auth() {
    let parsed = parse_proxy_url("http://user:pass@proxy.example.com:8080");
    assert_eq!(parsed.url, "http://proxy.example.com:8080/");
    assert_eq!(parsed.username, Some("user".to_string()));
    assert_eq!(parsed.password, Some("pass".to_string()));
}

#[test]
fn test_should_bypass_proxy_exact_match() {
    let no_proxy = vec!["localhost".to_string(), "127.0.0.1".to_string()];
    assert!(should_bypass_proxy("http://localhost:8080", &no_proxy));
    assert!(should_bypass_proxy("http://127.0.0.1:8080", &no_proxy));
    assert!(!should_bypass_proxy("http://example.com", &no_proxy));
}

#[test]
fn test_should_bypass_proxy_wildcard() {
    let no_proxy = vec!["*.example.com".to_string()];
    assert!(should_bypass_proxy("http://api.example.com", &no_proxy));
    assert!(should_bypass_proxy("http://sub.api.example.com", &no_proxy));
    assert!(!should_bypass_proxy("http://example.org", &no_proxy));
}

#[test]
fn test_should_bypass_proxy_all() {
    let no_proxy = vec!["*".to_string()];
    assert!(should_bypass_proxy("http://any.domain.com", &no_proxy));
}

#[test]
fn test_timeout_config_default() {
    let config = TimeoutConfig::default();
    assert_eq!(config.connect, 30000);
    assert_eq!(config.request, 120000);
    assert_eq!(config.response, 120000);
    assert_eq!(config.idle, 60000);
}

#[test]
fn test_retry_config_default() {
    let config = RetryConfig::default();
    assert_eq!(config.max_retries, 4);
    assert_eq!(config.base_delay, 1000);
    assert_eq!(config.max_delay, 30000);
    assert!(config.exponential_backoff);
}

#[test]
fn test_calculate_retry_delay_linear() {
    let config = RetryConfig {
        exponential_backoff: false,
        jitter: 0.0,
        base_delay: 1000,
        max_delay: 30000,
        ..Default::default()
    };

    assert_eq!(calculate_retry_delay(0, &config), 1000);
    assert_eq!(calculate_retry_delay(1, &config), 1000);
    assert_eq!(calculate_retry_delay(2, &config), 1000);
}

#[test]
fn test_calculate_retry_delay_exponential() {
    let config = RetryConfig {
        exponential_backoff: true,
        jitter: 0.0,
        base_delay: 1000,
        max_delay: 30000,
        ..Default::default()
    };

    assert_eq!(calculate_retry_delay(0, &config), 1000);
    assert_eq!(calculate_retry_delay(1, &config), 2000);
    assert_eq!(calculate_retry_delay(2, &config), 4000);
    assert_eq!(calculate_retry_delay(3, &config), 8000);
}

#[test]
fn test_calculate_retry_delay_max_cap() {
    let config = RetryConfig {
        exponential_backoff: true,
        jitter: 0.0,
        base_delay: 1000,
        max_delay: 5000,
        ..Default::default()
    };

    assert_eq!(calculate_retry_delay(0, &config), 1000);
    assert_eq!(calculate_retry_delay(1, &config), 2000);
    assert_eq!(calculate_retry_delay(2, &config), 4000);
    assert_eq!(calculate_retry_delay(3, &config), 5000); // capped
    assert_eq!(calculate_retry_delay(4, &config), 5000); // capped
}

#[test]
fn test_is_retryable_error() {
    let config = RetryConfig::default();

    assert!(is_retryable_error("ECONNRESET", None, &config));
    assert!(is_retryable_error("timeout occurred", None, &config));
    assert!(is_retryable_error("rate_limit_error", None, &config));
    assert!(!is_retryable_error("invalid input", None, &config));
}

#[test]
fn test_is_retryable_status_code() {
    let config = RetryConfig::default();

    assert!(is_retryable_error("", Some(429), &config));
    assert!(is_retryable_error("", Some(503), &config));
    assert!(!is_retryable_error("", Some(400), &config));
    assert!(!is_retryable_error("", Some(404), &config));
}

#[test]
fn test_proxy_info() {
    let config = ProxyConfig {
        http: Some("http://proxy:8080".to_string()),
        no_proxy: vec!["localhost".to_string()],
        ..Default::default()
    };

    let info = get_proxy_info("http://example.com", Some(&config));
    assert!(info.enabled);
    assert!(!info.bypassed);

    let info = get_proxy_info("http://localhost:8080", Some(&config));
    assert!(!info.enabled);
    assert!(info.bypassed);
}

#[test]
fn test_build_proxy_url_with_auth() {
    let url =
        build_proxy_url_with_auth("http://proxy.example.com:8080", Some("user"), Some("pass"));
    assert!(url.contains("user"));
    assert!(url.contains("pass"));
}

#[test]
fn test_timeout_error_display() {
    let err = TimeoutError { timeout_ms: 5000 };
    assert!(err.to_string().contains("5000"));
}

#[test]
fn test_abort_error_display() {
    let err = AbortError;
    assert!(err.to_string().contains("abort"));
}

#[tokio::test]
async fn test_with_timeout_success() {
    let result = with_timeout(async { 42 }, 1000).await;
    assert_eq!(result.unwrap(), 42);
}

#[tokio::test]
async fn test_with_timeout_timeout() {
    let result = with_timeout(
        async {
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
            42
        },
        10,
    )
    .await;
    assert!(result.is_err());
}

#[tokio::test]
async fn test_cancelable_delay_success() {
    let result = cancelable_delay(10, None).await;
    assert!(result.is_ok());
}

#[tokio::test]
async fn test_cancelable_delay_cancelled() {
    let token = tokio_util::sync::CancellationToken::new();
    let token_clone = token.clone();

    tokio::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(5)).await;
        token_clone.cancel();
    });

    let result = cancelable_delay(1000, Some(&token)).await;
    assert!(result.is_err());
}
