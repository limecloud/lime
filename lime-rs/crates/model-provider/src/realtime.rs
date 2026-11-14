//! OpenAI Realtime WebRTC 的 provider wire。
//!
//! 本模块只负责使用**已配置的 OpenAI provider key**兑换短时 client secret，
//! 并给出浏览器侧 SDP endpoint。provider key 不进入返回结构，也不写入日志；
//! Renderer 只拿到 `ek_...` 短时凭证。配置、凭证选择与 RPC 归属 App Server。

use anyhow::bail;
use anyhow::Context;
use anyhow::Result;
use serde_json::Value;
use std::fmt;
use std::time::Duration;
use url::Url;

/// OpenAI 官方 Realtime endpoint 的 host。
///
/// 实时语音只允许官方 OpenAI 路由；自定义兼容 host 没有可验证的 WebRTC
/// session 合同，必须 fail closed。
const OPENAI_REALTIME_HOST: &str = "api.openai.com";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(20);
const MAX_ERROR_DETAIL_CHARS: usize = 512;

/// 本构建显式支持、并已核对官方 Realtime 文档的模型。
///
/// 模型名不是从 chat catalog 或品牌推断的；未知模型必须 fail closed。
pub const SUPPORTED_REALTIME_MODELS: &[&str] = &[
    "gpt-realtime-2.1",
    "gpt-realtime-2.1-mini",
    "gpt-realtime-2",
    "gpt-realtime-1.5",
];

/// 官方 Realtime 会话支持的内置音色。
pub const SUPPORTED_REALTIME_VOICES: &[&str] = &[
    "alloy", "ash", "ballad", "coral", "echo", "sage", "shimmer", "verse", "marin", "cedar",
];

/// OpenAI Realtime 短时 client secret 与浏览器 SDP endpoint。
///
/// `Debug` 会隐藏 secret，避免错误日志或调试输出泄漏凭证。
pub struct MintedRealtimeClientSecret {
    pub client_secret: String,
    pub expires_at: Option<i64>,
    pub calls_url: String,
}

impl fmt::Debug for MintedRealtimeClientSecret {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("MintedRealtimeClientSecret")
            .field("client_secret", &"[REDACTED]")
            .field("expires_at", &self.expires_at)
            .field("calls_url", &self.calls_url)
            .finish()
    }
}

/// 解析并规范化 OpenAI 官方 Realtime base URL。
///
/// 只接受 `https://api.openai.com` 或 `https://api.openai.com/v1`；其他 host、
/// 非 HTTPS、带 query/fragment 或更深路径都返回 `None`。
pub fn openai_realtime_base_url(api_host: &str) -> Option<String> {
    let trimmed = api_host.trim();
    if trimmed.is_empty() {
        return None;
    }
    // Require an explicit HTTPS provider route; never upgrade or guess a scheme.
    let parsed = Url::parse(trimmed).ok()?;
    if parsed.scheme() != "https"
        || !parsed
            .host_str()
            .is_some_and(|host| host.eq_ignore_ascii_case(OPENAI_REALTIME_HOST))
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.query().is_some()
        || parsed.fragment().is_some()
    {
        return None;
    }
    let path = parsed.path().trim_end_matches('/');
    if !path.is_empty() && path != "/v1" {
        return None;
    }
    Some(format!("https://{OPENAI_REALTIME_HOST}"))
}

pub fn is_supported_realtime_model(model: &str) -> bool {
    SUPPORTED_REALTIME_MODELS.contains(&model.trim())
}

pub fn is_supported_realtime_voice(voice: &str) -> bool {
    SUPPORTED_REALTIME_VOICES.contains(&voice.trim())
}

/// 使用标准 OpenAI API key 兑换短时 Realtime client secret。
pub async fn mint_openai_realtime_client_secret(
    api_host: &str,
    api_key: &str,
    model: &str,
    voice: &str,
) -> Result<MintedRealtimeClientSecret> {
    let model = model.trim();
    let voice = voice.trim();
    if !is_supported_realtime_model(model) {
        bail!("unsupported OpenAI Realtime model");
    }
    if !is_supported_realtime_voice(voice) {
        bail!("unsupported OpenAI Realtime voice");
    }
    let base_url = openai_realtime_base_url(api_host)
        .context("OpenAI Realtime requires the official https://api.openai.com route")?;
    mint_client_secret_at_base(&base_url, api_key, model, voice).await
}

/// 内部入口：允许测试把 base URL 指向本地 mock OpenAI endpoint。
async fn mint_client_secret_at_base(
    base_url: &str,
    api_key: &str,
    model: &str,
    voice: &str,
) -> Result<MintedRealtimeClientSecret> {
    if api_key.trim().is_empty() {
        bail!("OpenAI provider API key is empty");
    }
    let base_url = base_url.trim_end_matches('/');
    let calls_url = format!("{base_url}/v1/realtime/calls");
    let client = reqwest::Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .build()
        .context("failed to build OpenAI Realtime HTTP client")?;
    let response = client
        .post(format!("{base_url}/v1/realtime/client_secrets"))
        .header(
            reqwest::header::AUTHORIZATION,
            format!("Bearer {}", api_key.trim()),
        )
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .json(&client_secret_request(model, voice))
        .send()
        .await
        .context("failed to reach the OpenAI Realtime client secret endpoint")?;
    let status = response.status();
    let body = response
        .text()
        .await
        .context("failed to read the OpenAI Realtime client secret response")?;
    if !status.is_success() {
        bail!(
            "OpenAI Realtime client secret request failed with HTTP {}: {}",
            status.as_u16(),
            sanitized_error_detail(&body, api_key)
        );
    }
    let payload: Value =
        serde_json::from_str(&body).context("OpenAI Realtime returned invalid client secret JSON")?;
    parse_client_secret_response(&payload, &calls_url)
}

fn client_secret_request(model: &str, voice: &str) -> Value {
    serde_json::json!({
        "session": {
            "type": "realtime",
            "model": model,
            "audio": {
                "output": {
                    "voice": voice,
                }
            }
        }
    })
}

fn parse_client_secret_response(
    payload: &Value,
    calls_url: &str,
) -> Result<MintedRealtimeClientSecret> {
    let client_secret = payload
        .get("value")
        .and_then(Value::as_str)
        .or_else(|| {
            payload
                .pointer("/client_secret/value")
                .and_then(Value::as_str)
        })
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .context("OpenAI Realtime response did not include an ephemeral client secret")?;
    let expires_at = payload
        .get("expires_at")
        .and_then(Value::as_i64)
        .or_else(|| payload.pointer("/client_secret/expires_at").and_then(Value::as_i64));
    Ok(MintedRealtimeClientSecret {
        client_secret: client_secret.to_string(),
        expires_at,
        calls_url: calls_url.to_string(),
    })
}

fn sanitized_error_detail(body: &str, api_key: &str) -> String {
    let trimmed = body.trim();
    let redacted = trimmed.replace(api_key, "[REDACTED]");
    let bounded: String = redacted.chars().take(MAX_ERROR_DETAIL_CHARS).collect();
    let single_line = bounded.split_whitespace().collect::<Vec<_>>().join(" ");
    if single_line.is_empty() {
        "no response body".to_string()
    } else {
        single_line
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::AsyncReadExt;
    use tokio::io::AsyncWriteExt;
    use tokio::net::TcpListener;
    use tokio::task::JoinHandle;
    use tokio::time::timeout;

    async fn spawn_json_server(
        status_line: &'static str,
        body: &'static str,
    ) -> (String, JoinHandle<String>) {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind mock OpenAI server");
        let address = listener.local_addr().expect("mock server address");
        let handle = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.expect("accept request");
            let mut request = Vec::new();
            loop {
                let mut chunk = [0u8; 1024];
                let read = timeout(Duration::from_millis(100), socket.read(&mut chunk)).await;
                match read {
                    Ok(Ok(0)) => break,
                    Ok(Ok(read)) => request.extend_from_slice(&chunk[..read]),
                    _ => break,
                }
            }
            let response = format!(
                "{status_line}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
            socket
                .write_all(response.as_bytes())
                .await
                .expect("write mock response");
            String::from_utf8(request).expect("utf-8 request")
        });
        (format!("http://{address}"), handle)
    }

    #[test]
    fn only_the_official_https_openai_route_is_accepted() {
        assert_eq!(
            openai_realtime_base_url("https://api.openai.com"),
            Some("https://api.openai.com".to_string())
        );
        assert_eq!(
            openai_realtime_base_url("https://api.openai.com/v1/"),
            Some("https://api.openai.com".to_string())
        );
        assert_eq!(openai_realtime_base_url("api.openai.com"), None);
        for rejected in [
            "http://api.openai.com",
            "https://api.openai.com.evil.example",
            "https://gateway.example.com/v1",
            "https://api.openai.com/v1/realtime",
            "https://user:pass@api.openai.com",
            "https://api.openai.com?debug=1",
        ] {
            assert_eq!(
                openai_realtime_base_url(rejected),
                None,
                "must reject {rejected}"
            );
        }
    }

    #[test]
    fn model_and_voice_options_are_explicit_and_bounded() {
        assert!(is_supported_realtime_model("gpt-realtime-2.1"));
        assert!(!is_supported_realtime_model("gpt-4o-mini"));
        assert!(is_supported_realtime_voice("marin"));
        assert!(!is_supported_realtime_voice("unknown-voice"));
        assert_eq!(SUPPORTED_REALTIME_MODELS.len(), 4);
        assert_eq!(SUPPORTED_REALTIME_VOICES.len(), 10);
    }

    #[tokio::test]
    async fn mint_posts_session_config_with_provider_key_and_returns_ephemeral_secret() {
        let (base_url, server) = spawn_json_server(
            "HTTP/1.1 200 OK",
            r#"{"value":"ek_test_ephemeral","expires_at":1893456000,"session":{"id":"sess_1"}}"#,
        )
        .await;

        let minted = mint_client_secret_at_base(&base_url, "sk-standard-key", "gpt-realtime-2.1", "marin")
            .await
            .expect("mint client secret");

        assert_eq!(minted.client_secret, "ek_test_ephemeral");
        assert_eq!(minted.expires_at, Some(1_893_456_000));
        assert_eq!(minted.calls_url, format!("{base_url}/v1/realtime/calls"));
        let request = server.await.expect("join mock server");
        assert!(request.starts_with("POST /v1/realtime/client_secrets HTTP/1.1"));
        assert!(request.to_ascii_lowercase().contains("authorization: bearer sk-standard-key"));
        assert!(request.contains("\"type\":\"realtime\""));
        assert!(request.contains("\"model\":\"gpt-realtime-2.1\""));
        assert!(request.contains("\"voice\":\"marin\""));
    }

    #[tokio::test]
    async fn provider_error_is_bounded_and_never_echoes_the_standard_key() {
        let (base_url, server) = spawn_json_server(
            "HTTP/1.1 401 Unauthorized",
            r#"{"error":{"message":"Incorrect API key provided: sk-standard-key"}}"#,
        )
        .await;

        let error = mint_client_secret_at_base(&base_url, "sk-standard-key", "gpt-realtime-2.1", "marin")
            .await
            .expect_err("provider error must fail closed");
        let message = error.to_string();
        assert!(message.contains("HTTP 401"));
        assert!(!message.contains("sk-standard-key"));
        assert!(message.contains("[REDACTED]"));
        server.await.expect("join mock server");
    }

    #[tokio::test]
    async fn missing_ephemeral_secret_fails_closed() {
        let (base_url, server) =
            spawn_json_server("HTTP/1.1 200 OK", r#"{"session":{"id":"sess_1"}}"#).await;
        let error = mint_client_secret_at_base(
            &base_url,
            "sk-standard-key",
            "gpt-realtime-2.1",
            "marin",
        )
        .await
        .expect_err("missing secret must fail");
        assert!(error.to_string().contains("did not include"));
        server.await.expect("join mock server");
    }

    #[test]
    fn minted_secret_debug_is_redacted() {
        let minted = MintedRealtimeClientSecret {
            client_secret: "ek_super_secret_value".to_string(),
            expires_at: Some(1),
            calls_url: "https://api.openai.com/v1/realtime/calls".to_string(),
        };
        let debug = format!("{minted:?}");
        assert!(!debug.contains("ek_super_secret_value"));
        assert!(debug.contains("[REDACTED]"));
    }
}
