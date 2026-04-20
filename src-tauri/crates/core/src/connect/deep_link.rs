//! Deep Link URL 解析模块
//!
//! 负责解析 `lime://connect` 协议的 URL，提取中转商配置参数。
//!
//! ## 功能
//!
//! - 解析 Deep Link URL 并提取参数
//! - 验证必填参数（relay, key）
//! - 返回结构化的 ConnectPayload 或错误
//!
//! ## 使用示例
//!
//! ```rust
//! use lime_core::connect::deep_link::{parse_deep_link, ConnectPayload, DeepLinkError};
//!
//! let url = "lime://connect?relay=example&key=sk-xxx&name=MyKey";
//! match parse_deep_link(url) {
//!     Ok(payload) => println!("Relay: {}, Key: {}", payload.relay, payload.key),
//!     Err(e) => eprintln!("Error: {:?}", e),
//! }
//! ```

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use url::Url;

/// Deep Link 解析结果
///
/// 包含从 `lime://connect` URL 中提取的所有参数。
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct ConnectPayload {
    /// 中转商 ID（必填）
    pub relay: String,
    /// API Key（必填）
    pub key: String,
    /// Key 名称（可选）
    pub name: Option<String>,
    /// 推广码（可选）
    pub ref_code: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub enum OpenDeepLinkKind {
    Skill,
    Prompt,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct OpenDeepLinkPayload {
    pub kind: OpenDeepLinkKind,
    pub slug: String,
    pub source: Option<String>,
    pub version: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub enum LimeDeepLinkPayload {
    Connect(ConnectPayload),
    Open(OpenDeepLinkPayload),
}

/// Deep Link 解析错误
///
/// 表示解析 Deep Link URL 时可能发生的各种错误。
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub enum DeepLinkError {
    /// URL 格式无效
    InvalidUrl(String),
    /// 缺少必填的 relay 参数
    MissingRelay,
    /// 缺少必填的 key 参数
    MissingKey,
    /// 缺少必填的 kind 参数
    MissingKind,
    /// 缺少必填的 slug 参数
    MissingSlug,
    /// open 链路里的 kind 无效
    InvalidOpenKind(String),
}

impl std::fmt::Display for DeepLinkError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            DeepLinkError::InvalidUrl(msg) => write!(f, "无效的 URL: {msg}"),
            DeepLinkError::MissingRelay => write!(f, "缺少必填参数: relay"),
            DeepLinkError::MissingKey => write!(f, "缺少必填参数: key"),
            DeepLinkError::MissingKind => write!(f, "缺少必填参数: kind"),
            DeepLinkError::MissingSlug => write!(f, "缺少必填参数: slug"),
            DeepLinkError::InvalidOpenKind(kind) => {
                write!(f, "无效的 open kind: {kind}")
            }
        }
    }
}

impl std::error::Error for DeepLinkError {}

/// 解析 Deep Link URL
///
/// 解析 `lime://connect` 格式的 URL，提取 relay、key、name 和 ref 参数。
///
/// # 参数
///
/// * `url` - Deep Link URL 字符串
///
/// # 返回值
///
/// * `Ok(ConnectPayload)` - 解析成功，返回包含所有参数的结构体
/// * `Err(DeepLinkError)` - 解析失败，返回具体错误类型
///
/// # 示例
///
/// ```rust
/// use lime_core::connect::deep_link::parse_deep_link;
///
/// // 完整 URL
/// let result = parse_deep_link("lime://connect?relay=example&key=sk-xxx&name=MyKey&ref=abc");
/// assert!(result.is_ok());
///
/// // 缺少 relay 参数
/// let result = parse_deep_link("lime://connect?key=sk-xxx");
/// assert!(result.is_err());
/// ```
pub fn parse_deep_link(url: &str) -> Result<ConnectPayload, DeepLinkError> {
    match parse_lime_deep_link(url)? {
        LimeDeepLinkPayload::Connect(payload) => Ok(payload),
        LimeDeepLinkPayload::Open(_) => Err(DeepLinkError::InvalidUrl(
            "当前链接不是 connect 协议".to_string(),
        )),
    }
}

pub fn parse_open_deep_link(url: &str) -> Result<OpenDeepLinkPayload, DeepLinkError> {
    match parse_lime_deep_link(url)? {
        LimeDeepLinkPayload::Open(payload) => Ok(payload),
        LimeDeepLinkPayload::Connect(_) => Err(DeepLinkError::InvalidUrl(
            "当前链接不是 open 协议".to_string(),
        )),
    }
}

pub fn parse_lime_deep_link(url: &str) -> Result<LimeDeepLinkPayload, DeepLinkError> {
    let parsed = Url::parse(url).map_err(|e| DeepLinkError::InvalidUrl(e.to_string()))?;

    if parsed.scheme() != "lime" {
        return Err(DeepLinkError::InvalidUrl(format!(
            "无效的协议: {}，期望 lime",
            parsed.scheme()
        )));
    }

    match parsed.host_str() {
        Some("connect") => parse_connect_payload(parsed).map(LimeDeepLinkPayload::Connect),
        Some("open") => parse_open_payload(parsed).map(LimeDeepLinkPayload::Open),
        other => Err(DeepLinkError::InvalidUrl(format!(
            "无效的路径: {:?}，期望 connect 或 open",
            other
        ))),
    }
}

fn parse_connect_payload(parsed: Url) -> Result<ConnectPayload, DeepLinkError> {
    let params: HashMap<String, String> = parsed.query_pairs().into_owned().collect();

    let relay = params
        .get("relay")
        .filter(|s| !s.is_empty())
        .ok_or(DeepLinkError::MissingRelay)?
        .clone();

    let key = params
        .get("key")
        .filter(|s| !s.is_empty())
        .ok_or(DeepLinkError::MissingKey)?
        .clone();

    let name = params.get("name").filter(|s| !s.is_empty()).cloned();
    let ref_code = params.get("ref").filter(|s| !s.is_empty()).cloned();

    Ok(ConnectPayload {
        relay,
        key,
        name,
        ref_code,
    })
}

fn parse_open_payload(parsed: Url) -> Result<OpenDeepLinkPayload, DeepLinkError> {
    let params: HashMap<String, String> = parsed.query_pairs().into_owned().collect();

    let kind = match params
        .get("kind")
        .filter(|value| !value.is_empty())
        .map(|value| value.trim().to_ascii_lowercase())
        .ok_or(DeepLinkError::MissingKind)?
        .as_str()
    {
        "skill" => OpenDeepLinkKind::Skill,
        "prompt" => OpenDeepLinkKind::Prompt,
        other => return Err(DeepLinkError::InvalidOpenKind(other.to_string())),
    };

    let slug = params
        .get("slug")
        .filter(|value| !value.is_empty())
        .ok_or(DeepLinkError::MissingSlug)?
        .trim()
        .to_string();

    let source = params
        .get("source")
        .filter(|value| !value.is_empty())
        .cloned();
    let version = params.get("v").filter(|value| !value.is_empty()).cloned();

    Ok(OpenDeepLinkPayload {
        kind,
        slug,
        source,
        version,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_valid_url_with_all_params() {
        let url = "lime://connect?relay=example&key=sk-xxx&name=MyKey&ref=abc123";
        let result = parse_deep_link(url).unwrap();

        assert_eq!(result.relay, "example");
        assert_eq!(result.key, "sk-xxx");
        assert_eq!(result.name, Some("MyKey".to_string()));
        assert_eq!(result.ref_code, Some("abc123".to_string()));
    }

    #[test]
    fn test_parse_valid_url_with_required_params_only() {
        let url = "lime://connect?relay=test-relay&key=sk-12345";
        let result = parse_deep_link(url).unwrap();

        assert_eq!(result.relay, "test-relay");
        assert_eq!(result.key, "sk-12345");
        assert_eq!(result.name, None);
        assert_eq!(result.ref_code, None);
    }

    #[test]
    fn test_parse_missing_relay() {
        let url = "lime://connect?key=sk-xxx";
        let result = parse_deep_link(url);

        assert!(matches!(result, Err(DeepLinkError::MissingRelay)));
    }

    #[test]
    fn test_parse_missing_key() {
        let url = "lime://connect?relay=example";
        let result = parse_deep_link(url);

        assert!(matches!(result, Err(DeepLinkError::MissingKey)));
    }

    #[test]
    fn test_parse_empty_relay() {
        let url = "lime://connect?relay=&key=sk-xxx";
        let result = parse_deep_link(url);

        assert!(matches!(result, Err(DeepLinkError::MissingRelay)));
    }

    #[test]
    fn test_parse_empty_key() {
        let url = "lime://connect?relay=example&key=";
        let result = parse_deep_link(url);

        assert!(matches!(result, Err(DeepLinkError::MissingKey)));
    }

    #[test]
    fn test_parse_invalid_protocol() {
        let url = "http://connect?relay=example&key=sk-xxx";
        let result = parse_deep_link(url);

        assert!(matches!(result, Err(DeepLinkError::InvalidUrl(_))));
    }

    #[test]
    fn test_parse_invalid_path() {
        let url = "lime://other?relay=example&key=sk-xxx";
        let result = parse_deep_link(url);

        assert!(matches!(result, Err(DeepLinkError::InvalidUrl(_))));
    }

    #[test]
    fn test_parse_malformed_url() {
        let url = "not a valid url";
        let result = parse_deep_link(url);

        assert!(matches!(result, Err(DeepLinkError::InvalidUrl(_))));
    }

    #[test]
    fn test_parse_url_encoded_params() {
        let url = "lime://connect?relay=test%20relay&key=sk-xxx&name=My%20Key";
        let result = parse_deep_link(url).unwrap();

        assert_eq!(result.relay, "test relay");
        assert_eq!(result.key, "sk-xxx");
        assert_eq!(result.name, Some("My Key".to_string()));
    }

    #[test]
    fn test_parse_open_skill_url() {
        let url = "lime://open?kind=skill&slug=daily-trend-briefing&source=website&v=1";
        let result = parse_open_deep_link(url).unwrap();

        assert_eq!(result.kind, OpenDeepLinkKind::Skill);
        assert_eq!(result.slug, "daily-trend-briefing");
        assert_eq!(result.source, Some("website".to_string()));
        assert_eq!(result.version, Some("1".to_string()));
    }

    #[test]
    fn test_parse_open_prompt_url() {
        let url = "lime://open?kind=prompt&slug=gemini-longform-master";
        let result = parse_open_deep_link(url).unwrap();

        assert_eq!(result.kind, OpenDeepLinkKind::Prompt);
        assert_eq!(result.slug, "gemini-longform-master");
        assert_eq!(result.source, None);
    }

    #[test]
    fn test_parse_open_missing_kind() {
        let result = parse_open_deep_link("lime://open?slug=test");
        assert!(matches!(result, Err(DeepLinkError::MissingKind)));
    }

    #[test]
    fn test_parse_open_missing_slug() {
        let result = parse_open_deep_link("lime://open?kind=skill");
        assert!(matches!(result, Err(DeepLinkError::MissingSlug)));
    }

    #[test]
    fn test_parse_open_invalid_kind() {
        let result = parse_open_deep_link("lime://open?kind=other&slug=test");
        assert!(matches!(result, Err(DeepLinkError::InvalidOpenKind(_))));
    }
}

#[cfg(test)]
mod property_tests {
    use super::*;
    use proptest::prelude::*;

    /// 生成有效的 relay ID（字母数字和连字符）
    fn arb_relay_id() -> impl Strategy<Value = String> {
        "[a-z][a-z0-9-]{0,30}[a-z0-9]".prop_filter("非空", |s| !s.is_empty())
    }

    /// 生成有效的 API Key
    fn arb_api_key() -> impl Strategy<Value = String> {
        "sk-[a-zA-Z0-9]{8,64}".prop_filter("非空", |s| !s.is_empty())
    }

    /// 生成可选的 Key 名称
    fn arb_key_name() -> impl Strategy<Value = Option<String>> {
        prop_oneof![Just(None), "[a-zA-Z0-9 _-]{1,50}".prop_map(Some),]
    }

    /// 生成可选的推广码
    fn arb_ref_code() -> impl Strategy<Value = Option<String>> {
        prop_oneof![Just(None), "[a-zA-Z0-9]{4,20}".prop_map(Some),]
    }

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(100))]

        /// Feature: lime-connect, Property 1: Deep Link URL Parsing Completeness
        /// Validates: Requirements 1.1
        ///
        /// *For any* valid Deep Link URL containing relay and key parameters,
        /// parsing the URL SHALL extract all parameters correctly and return
        /// a ConnectPayload with matching values.
        #[test]
        fn prop_deep_link_parsing_completeness(
            relay in arb_relay_id(),
            key in arb_api_key(),
            name in arb_key_name(),
            ref_code in arb_ref_code(),
        ) {
            // 构建 URL
            let mut url = format!("lime://connect?relay={relay}&key={key}");
            if let Some(ref n) = name {
                url.push_str(&format!("&name={}", urlencoding::encode(n)));
            }
            if let Some(ref r) = ref_code {
                url.push_str(&format!("&ref={r}"));
            }

            // 解析 URL
            let result = parse_deep_link(&url);

            // 验证解析成功
            prop_assert!(result.is_ok(), "解析失败: {:?}", result);

            let payload = result.unwrap();

            // 验证所有参数正确提取
            prop_assert_eq!(&payload.relay, &relay, "relay 不匹配");
            prop_assert_eq!(&payload.key, &key, "key 不匹配");
            prop_assert_eq!(&payload.name, &name, "name 不匹配");
            prop_assert_eq!(&payload.ref_code, &ref_code, "ref_code 不匹配");
        }

        /// Feature: lime-connect, Property 2: Deep Link Invalid Parameter Handling
        /// Validates: Requirements 1.2, 1.3, 7.1
        ///
        /// *For any* Deep Link URL that is malformed, missing the relay parameter,
        /// or missing the key parameter, the parser SHALL return an appropriate error
        /// and not produce a valid ConnectPayload.
        #[test]
        fn prop_deep_link_invalid_parameter_handling(
            relay in arb_relay_id(),
            key in arb_api_key(),
            error_type in 0..4u8,
        ) {
            let url = match error_type {
                // 缺少 relay 参数
                0 => format!("lime://connect?key={key}"),
                // 缺少 key 参数
                1 => format!("lime://connect?relay={relay}"),
                // 空 relay 参数
                2 => format!("lime://connect?relay=&key={key}"),
                // 空 key 参数
                _ => format!("lime://connect?relay={relay}&key="),
            };

            let result = parse_deep_link(&url);

            // 验证解析失败
            prop_assert!(result.is_err(), "应该返回错误，但解析成功了: {:?}", result);

            // 验证错误类型正确
            match error_type {
                0 | 2 => prop_assert!(
                    matches!(result, Err(DeepLinkError::MissingRelay)),
                    "期望 MissingRelay 错误，实际: {:?}", result
                ),
                1 | 3 => prop_assert!(
                    matches!(result, Err(DeepLinkError::MissingKey)),
                    "期望 MissingKey 错误，实际: {:?}", result
                ),
                _ => unreachable!(),
            }
        }

        /// 测试无效协议
        #[test]
        fn prop_invalid_protocol(
            protocol in "(http|https|ftp|file)",
            relay in arb_relay_id(),
            key in arb_api_key(),
        ) {
            let url = format!("{protocol}://connect?relay={relay}&key={key}");
            let result = parse_deep_link(&url);

            prop_assert!(
                matches!(result, Err(DeepLinkError::InvalidUrl(_))),
                "期望 InvalidUrl 错误，实际: {:?}", result
            );
        }

        /// 测试无效路径
        #[test]
        fn prop_invalid_path(
            path in "(other|invalid|test|api)",
            relay in arb_relay_id(),
            key in arb_api_key(),
        ) {
            let url = format!("lime://{path}?relay={relay}&key={key}");
            let result = parse_deep_link(&url);

            prop_assert!(
                matches!(result, Err(DeepLinkError::InvalidUrl(_))),
                "期望 InvalidUrl 错误，实际: {:?}", result
            );
        }
    }
}
