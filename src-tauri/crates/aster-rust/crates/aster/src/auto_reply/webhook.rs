//! Webhook 触发处理模块
//!
//! 实现 Webhook 触发器的签名验证和请求解析功能。
//!
//! # 功能
//!
//! - HMAC-SHA256 签名验证
//! - 请求体解析
//! - 可配置端点路径
//!
//! # 示例
//!
//! ```rust,ignore
//! use aster::auto_reply::webhook::{WebhookHandler, WebhookResult};
//!
//! let handler = WebhookHandler::new("my-secret".to_string(), "/webhook".to_string());
//!
//! // 验证并处理请求
//! match handler.handle_request(body, signature) {
//!     WebhookResult::Triggered { request } => {
//!         println!("Webhook triggered: {}", request.content);
//!     }
//!     WebhookResult::InvalidSignature => {
//!         println!("Invalid signature");
//!     }
//!     WebhookResult::ParseError(err) => {
//!         println!("Parse error: {}", err);
//!     }
//! }
//! ```

use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use std::collections::HashMap;

/// HMAC-SHA256 类型别名
type HmacSha256 = Hmac<Sha256>;

/// Webhook 处理器
///
/// 负责验证 Webhook 请求签名和解析请求体。
#[derive(Debug, Clone)]
pub struct WebhookHandler {
    /// 验证密钥
    secret: String,
    /// 端点路径
    path: String,
}

impl WebhookHandler {
    /// 创建新的 Webhook 处理器
    ///
    /// # 参数
    ///
    /// * `secret` - 用于签名验证的密钥
    /// * `path` - Webhook 端点路径
    ///
    /// # 示例
    ///
    /// ```rust
    /// use aster::auto_reply::webhook::WebhookHandler;
    ///
    /// let handler = WebhookHandler::new(
    ///     "my-secret".to_string(),
    ///     "/webhook/auto-reply".to_string(),
    /// );
    /// ```
    pub fn new(secret: String, path: String) -> Self {
        Self { secret, path }
    }

    /// 获取端点路径
    pub fn path(&self) -> &str {
        &self.path
    }

    /// 验证请求签名
    ///
    /// 使用 HMAC-SHA256 验证签名。签名格式支持：
    /// - 纯 hex 字符串
    /// - `sha256=<hex>` 格式（GitHub 风格）
    ///
    /// # 参数
    ///
    /// * `payload` - 请求体原始字节
    /// * `signature` - 请求头中的签名
    ///
    /// # 返回
    ///
    /// 签名验证通过返回 `true`，否则返回 `false`
    ///
    /// # Requirements
    ///
    /// - 9.1: THE Webhook_Trigger SHALL validate request signature using secret
    /// - 9.2: WHEN signature validation fails, THE Webhook_Trigger SHALL reject the request
    pub fn verify_signature(&self, payload: &[u8], signature: &str) -> bool {
        // 支持 "sha256=<hex>" 格式（GitHub 风格）
        let signature_hex = signature.strip_prefix("sha256=").unwrap_or(signature);

        // 解码签名
        let expected_signature = match hex::decode(signature_hex) {
            Ok(sig) => sig,
            Err(_) => return false,
        };

        // 创建 HMAC 实例
        let mut mac = match HmacSha256::new_from_slice(self.secret.as_bytes()) {
            Ok(mac) => mac,
            Err(_) => return false,
        };

        // 计算 HMAC
        mac.update(payload);

        // 使用常量时间比较验证签名
        mac.verify_slice(&expected_signature).is_ok()
    }

    /// 解析请求体
    ///
    /// 将 JSON 请求体解析为 `WebhookRequest` 结构体。
    ///
    /// # 参数
    ///
    /// * `body` - 请求体原始字节
    ///
    /// # 返回
    ///
    /// 解析成功返回 `Ok(WebhookRequest)`，失败返回错误信息
    ///
    /// # Requirements
    ///
    /// - 9.3: THE Webhook_Trigger SHALL extract message content from request body
    pub fn parse_request(&self, body: &[u8]) -> Result<WebhookRequest, String> {
        serde_json::from_slice(body).map_err(|e| format!("Failed to parse request body: {}", e))
    }

    /// 处理 Webhook 请求
    ///
    /// 验证签名并解析请求体，返回处理结果。
    ///
    /// # 参数
    ///
    /// * `body` - 请求体原始字节
    /// * `signature` - 请求头中的签名
    ///
    /// # 返回
    ///
    /// 返回 `WebhookResult` 表示处理结果
    ///
    /// # Requirements
    ///
    /// - 9.1: THE Webhook_Trigger SHALL validate request signature using secret
    /// - 9.2: WHEN signature validation fails, THE Webhook_Trigger SHALL reject the request
    /// - 9.3: THE Webhook_Trigger SHALL extract message content from request body
    /// - 9.5: THE Webhook_Trigger SHALL return trigger result in response
    pub fn handle_request(&self, body: &[u8], signature: &str) -> WebhookResult {
        // 验证签名
        if !self.verify_signature(body, signature) {
            return WebhookResult::InvalidSignature;
        }

        // 解析请求体
        match self.parse_request(body) {
            Ok(request) => WebhookResult::Triggered { request },
            Err(err) => WebhookResult::ParseError(err),
        }
    }

    /// 计算 payload 的签名
    ///
    /// 用于生成测试签名或客户端签名。
    ///
    /// # 参数
    ///
    /// * `payload` - 要签名的数据
    ///
    /// # 返回
    ///
    /// 返回 hex 编码的签名字符串
    pub fn compute_signature(&self, payload: &[u8]) -> String {
        let mut mac = HmacSha256::new_from_slice(self.secret.as_bytes())
            .expect("HMAC can take key of any size");
        mac.update(payload);
        let result = mac.finalize();
        hex::encode(result.into_bytes())
    }
}

/// Webhook 请求体
///
/// 表示从 Webhook 请求中解析出的数据。
///
/// # Requirements
///
/// - 9.3: THE Webhook_Trigger SHALL extract message content from request body
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct WebhookRequest {
    /// 消息内容
    pub content: String,
    /// 发送者 ID（可选）
    #[serde(default)]
    pub sender_id: Option<String>,
    /// 附加数据
    #[serde(default)]
    pub metadata: HashMap<String, serde_json::Value>,
}

impl WebhookRequest {
    /// 创建新的 Webhook 请求
    pub fn new(content: String) -> Self {
        Self {
            content,
            sender_id: None,
            metadata: HashMap::new(),
        }
    }

    /// 设置发送者 ID
    pub fn with_sender_id(mut self, sender_id: String) -> Self {
        self.sender_id = Some(sender_id);
        self
    }

    /// 添加元数据
    pub fn with_metadata(mut self, key: String, value: serde_json::Value) -> Self {
        self.metadata.insert(key, value);
        self
    }
}

/// Webhook 处理结果
///
/// 表示 Webhook 请求的处理结果。
///
/// # Requirements
///
/// - 9.2: WHEN signature validation fails, THE Webhook_Trigger SHALL reject the request
/// - 9.5: THE Webhook_Trigger SHALL return trigger result in response
#[derive(Debug, Clone, PartialEq)]
pub enum WebhookResult {
    /// 成功触发
    Triggered {
        /// 解析后的请求
        request: WebhookRequest,
    },
    /// 签名验证失败
    InvalidSignature,
    /// 请求体解析失败
    ParseError(String),
}

impl WebhookResult {
    /// 检查是否触发成功
    pub fn is_triggered(&self) -> bool {
        matches!(self, WebhookResult::Triggered { .. })
    }

    /// 检查是否签名无效
    pub fn is_invalid_signature(&self) -> bool {
        matches!(self, WebhookResult::InvalidSignature)
    }

    /// 检查是否解析错误
    pub fn is_parse_error(&self) -> bool {
        matches!(self, WebhookResult::ParseError(_))
    }

    /// 获取触发的请求（如果成功）
    pub fn into_request(self) -> Option<WebhookRequest> {
        match self {
            WebhookResult::Triggered { request } => Some(request),
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    /// 创建测试用的 WebhookHandler
    fn create_test_handler() -> WebhookHandler {
        WebhookHandler::new("test-secret".to_string(), "/webhook/test".to_string())
    }

    /// 创建有效的测试请求体
    fn create_test_body() -> Vec<u8> {
        r#"{"content":"Hello, World!","sender_id":"user-123"}"#
            .as_bytes()
            .to_vec()
    }

    // ==================== 签名验证测试 ====================

    /// 测试：有效签名应该通过验证
    /// Validates: Requirement 9.1
    #[test]
    fn test_verify_signature_valid() {
        let handler = create_test_handler();
        let body = create_test_body();

        // 计算正确的签名
        let signature = handler.compute_signature(&body);

        assert!(handler.verify_signature(&body, &signature));
    }

    /// 测试：带 sha256= 前缀的签名应该通过验证
    /// Validates: Requirement 9.1
    #[test]
    fn test_verify_signature_with_prefix() {
        let handler = create_test_handler();
        let body = create_test_body();

        let signature = handler.compute_signature(&body);
        let prefixed_signature = format!("sha256={}", signature);

        assert!(handler.verify_signature(&body, &prefixed_signature));
    }

    /// 测试：无效签名应该被拒绝
    /// Validates: Requirement 9.2
    #[test]
    fn test_verify_signature_invalid() {
        let handler = create_test_handler();
        let body = create_test_body();

        // 使用错误的签名
        let invalid_signature = "0000000000000000000000000000000000000000000000000000000000000000";

        assert!(!handler.verify_signature(&body, invalid_signature));
    }

    /// 测试：非 hex 格式的签名应该被拒绝
    /// Validates: Requirement 9.2
    #[test]
    fn test_verify_signature_invalid_hex() {
        let handler = create_test_handler();
        let body = create_test_body();

        // 非 hex 格式
        assert!(!handler.verify_signature(&body, "not-a-hex-string"));
        assert!(!handler.verify_signature(&body, "zzzz"));
    }

    /// 测试：空签名应该被拒绝
    /// Validates: Requirement 9.2
    #[test]
    fn test_verify_signature_empty() {
        let handler = create_test_handler();
        let body = create_test_body();

        assert!(!handler.verify_signature(&body, ""));
    }

    /// 测试：修改后的 payload 签名应该失败
    /// Validates: Requirement 9.1, 9.2
    #[test]
    fn test_verify_signature_tampered_payload() {
        let handler = create_test_handler();
        let body = create_test_body();

        // 计算原始 body 的签名
        let signature = handler.compute_signature(&body);

        // 修改 body
        let tampered_body = r#"{"content":"Tampered!","sender_id":"user-123"}"#.as_bytes();

        // 使用原始签名验证修改后的 body 应该失败
        assert!(!handler.verify_signature(tampered_body, &signature));
    }

    // ==================== 请求解析测试 ====================

    /// 测试：解析有效的请求体
    /// Validates: Requirement 9.3
    #[test]
    fn test_parse_request_valid() {
        let handler = create_test_handler();
        let body = create_test_body();

        let result = handler.parse_request(&body);
        assert!(result.is_ok());

        let request = result.unwrap();
        assert_eq!(request.content, "Hello, World!");
        assert_eq!(request.sender_id, Some("user-123".to_string()));
    }

    /// 测试：解析只有 content 的请求体
    /// Validates: Requirement 9.3
    #[test]
    fn test_parse_request_minimal() {
        let handler = create_test_handler();
        let body = r#"{"content":"Minimal message"}"#.as_bytes();

        let result = handler.parse_request(body);
        assert!(result.is_ok());

        let request = result.unwrap();
        assert_eq!(request.content, "Minimal message");
        assert_eq!(request.sender_id, None);
        assert!(request.metadata.is_empty());
    }

    /// 测试：解析带 metadata 的请求体
    /// Validates: Requirement 9.3
    #[test]
    fn test_parse_request_with_metadata() {
        let handler = create_test_handler();
        let body = r#"{
            "content": "Message with metadata",
            "sender_id": "user-456",
            "metadata": {
                "source": "github",
                "priority": 1
            }
        }"#
        .as_bytes();

        let result = handler.parse_request(body);
        assert!(result.is_ok());

        let request = result.unwrap();
        assert_eq!(request.content, "Message with metadata");
        assert_eq!(request.sender_id, Some("user-456".to_string()));
        assert_eq!(
            request.metadata.get("source"),
            Some(&serde_json::json!("github"))
        );
        assert_eq!(
            request.metadata.get("priority"),
            Some(&serde_json::json!(1))
        );
    }

    /// 测试：解析无效 JSON 应该失败
    #[test]
    fn test_parse_request_invalid_json() {
        let handler = create_test_handler();
        let body = b"not valid json";

        let result = handler.parse_request(body);
        assert!(result.is_err());
    }

    /// 测试：解析缺少 content 字段应该失败
    #[test]
    fn test_parse_request_missing_content() {
        let handler = create_test_handler();
        let body = r#"{"sender_id":"user-123"}"#.as_bytes();

        let result = handler.parse_request(body);
        assert!(result.is_err());
    }

    // ==================== handle_request 集成测试 ====================

    /// 测试：有效请求应该成功触发
    /// Validates: Requirements 9.1, 9.3, 9.5
    #[test]
    fn test_handle_request_success() {
        let handler = create_test_handler();
        let body = create_test_body();
        let signature = handler.compute_signature(&body);

        let result = handler.handle_request(&body, &signature);

        assert!(result.is_triggered());
        let request = result.into_request().unwrap();
        assert_eq!(request.content, "Hello, World!");
    }

    /// 测试：无效签名应该返回 InvalidSignature
    /// Validates: Requirements 9.2, 9.5
    #[test]
    fn test_handle_request_invalid_signature() {
        let handler = create_test_handler();
        let body = create_test_body();
        let invalid_signature = "invalid";

        let result = handler.handle_request(&body, invalid_signature);

        assert!(result.is_invalid_signature());
        assert_eq!(result, WebhookResult::InvalidSignature);
    }

    /// 测试：有效签名但无效 JSON 应该返回 ParseError
    /// Validates: Requirements 9.1, 9.5
    #[test]
    fn test_handle_request_parse_error() {
        let handler = create_test_handler();
        let body = b"not valid json";
        let signature = handler.compute_signature(body);

        let result = handler.handle_request(body, &signature);

        assert!(result.is_parse_error());
    }

    // ==================== WebhookRequest 测试 ====================

    /// 测试：WebhookRequest builder 模式
    #[test]
    fn test_webhook_request_builder() {
        let request = WebhookRequest::new("Test content".to_string())
            .with_sender_id("sender-1".to_string())
            .with_metadata("key".to_string(), serde_json::json!("value"));

        assert_eq!(request.content, "Test content");
        assert_eq!(request.sender_id, Some("sender-1".to_string()));
        assert_eq!(
            request.metadata.get("key"),
            Some(&serde_json::json!("value"))
        );
    }

    /// 测试：WebhookRequest 序列化/反序列化
    #[test]
    fn test_webhook_request_serde() {
        let request = WebhookRequest::new("Test".to_string()).with_sender_id("user".to_string());

        let json = serde_json::to_string(&request).unwrap();
        let parsed: WebhookRequest = serde_json::from_str(&json).unwrap();

        assert_eq!(request, parsed);
    }

    // ==================== 端点路径测试 ====================

    /// 测试：可配置端点路径
    /// Validates: Requirement 9.4
    #[test]
    fn test_configurable_path() {
        let handler1 = WebhookHandler::new("secret".to_string(), "/api/webhook".to_string());
        let handler2 = WebhookHandler::new("secret".to_string(), "/custom/path".to_string());

        assert_eq!(handler1.path(), "/api/webhook");
        assert_eq!(handler2.path(), "/custom/path");
    }

    // ==================== 不同密钥测试 ====================

    /// 测试：不同密钥产生不同签名
    #[test]
    fn test_different_secrets_different_signatures() {
        let handler1 = WebhookHandler::new("secret1".to_string(), "/webhook".to_string());
        let handler2 = WebhookHandler::new("secret2".to_string(), "/webhook".to_string());
        let body = create_test_body();

        let sig1 = handler1.compute_signature(&body);
        let sig2 = handler2.compute_signature(&body);

        assert_ne!(sig1, sig2);

        // handler1 的签名不能通过 handler2 的验证
        assert!(!handler2.verify_signature(&body, &sig1));
    }

    // =========================================================================
    // Property-Based Tests - Property 9: Webhook 签名验证
    // =========================================================================

    /// 生成随机 secret 字符串
    fn arb_secret() -> impl Strategy<Value = String> {
        // 生成 8-64 字符的 ASCII 字符串作为 secret
        prop::string::string_regex("[a-zA-Z0-9_-]{8,64}")
            .unwrap()
            .prop_filter("Secret must not be empty", |s| !s.is_empty())
    }

    /// 生成随机 payload 字节
    fn arb_payload() -> impl Strategy<Value = Vec<u8>> {
        // 生成 1-1024 字节的随机数据
        prop::collection::vec(any::<u8>(), 1..1024)
    }

    /// 生成随机 WebhookRequest 内容
    fn arb_content() -> impl Strategy<Value = String> {
        // 生成 1-256 字符的 ASCII 字符串作为消息内容
        prop::string::string_regex("[a-zA-Z0-9 .,!?]{1,256}")
            .unwrap()
            .prop_filter("Content must not be empty", |s| !s.is_empty())
    }

    /// 生成随机 sender_id
    fn arb_sender_id() -> impl Strategy<Value = Option<String>> {
        prop::option::of(prop::string::string_regex("[a-zA-Z0-9_-]{1,32}").unwrap())
    }

    /// 生成随机 WebhookRequest
    fn arb_webhook_request() -> impl Strategy<Value = WebhookRequest> {
        (arb_content(), arb_sender_id()).prop_map(|(content, sender_id)| {
            let mut request = WebhookRequest::new(content);
            if let Some(id) = sender_id {
                request = request.with_sender_id(id);
            }
            request
        })
    }

    /// 生成随机端点路径
    fn arb_path() -> impl Strategy<Value = String> {
        prop::string::string_regex("/[a-z0-9/_-]{1,64}")
            .unwrap()
            .prop_filter("Path must start with /", |s| s.starts_with('/'))
    }

    /// 生成篡改后的 payload（确保与原始不同）
    fn arb_tampered_payload(original: &[u8]) -> impl Strategy<Value = Vec<u8>> {
        let original_len = original.len();
        let original_clone = original.to_vec();

        prop::strategy::Union::new_weighted(vec![
            // 策略 1: 修改一个字节
            (3, {
                let orig = original_clone.clone();
                any::<prop::sample::Index>()
                    .prop_flat_map(move |idx| {
                        let orig = orig.clone();
                        let pos = idx.index(orig.len().max(1));
                        any::<u8>().prop_map(move |new_byte| {
                            let mut result = orig.clone();
                            if !result.is_empty() {
                                // 确保修改后的字节与原始不同
                                result[pos] = if result[pos] == new_byte {
                                    new_byte.wrapping_add(1)
                                } else {
                                    new_byte
                                };
                            }
                            result
                        })
                    })
                    .boxed()
            }),
            // 策略 2: 添加字节
            (2, {
                let orig = original_clone.clone();
                prop::collection::vec(any::<u8>(), 1..10)
                    .prop_map(move |extra| {
                        let mut result = orig.clone();
                        result.extend(extra);
                        result
                    })
                    .boxed()
            }),
            // 策略 3: 删除字节（如果长度 > 1）
            (1, {
                let orig = original_clone.clone();
                if original_len > 1 {
                    any::<prop::sample::Index>()
                        .prop_map(move |idx| {
                            let mut result = orig.clone();
                            let pos = idx.index(result.len());
                            result.remove(pos);
                            result
                        })
                        .boxed()
                } else {
                    // 如果只有一个字节，添加一个字节
                    any::<u8>()
                        .prop_map(move |extra| {
                            let mut result = orig.clone();
                            result.push(extra);
                            result
                        })
                        .boxed()
                }
            }),
        ])
    }

    /// 生成无效的签名（非 hex 或错误的 hex）
    fn arb_invalid_signature() -> impl Strategy<Value = String> {
        prop::strategy::Union::new_weighted(vec![
            // 策略 1: 非 hex 字符串
            (
                3,
                prop::string::string_regex("[g-z]{32,64}").unwrap().boxed(),
            ),
            // 策略 2: 空字符串
            (1, Just("".to_string()).boxed()),
            // 策略 3: 太短的 hex
            (
                2,
                prop::string::string_regex("[0-9a-f]{1,10}")
                    .unwrap()
                    .boxed(),
            ),
            // 策略 4: 包含非 hex 字符
            (
                2,
                prop::string::string_regex("[0-9a-f]{20}[xyz]{5}[0-9a-f]{20}")
                    .unwrap()
                    .boxed(),
            ),
        ])
    }

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(100))]

        /// Property 9.1: 有效签名始终通过验证
        /// **Validates: Requirement 9.1**
        ///
        /// THE Webhook_Trigger SHALL validate request signature using secret
        /// 对于任意 secret 和 payload，使用正确的签名应该始终通过验证
        #[test]
        fn prop_valid_signature_always_passes(
            secret in arb_secret(),
            payload in arb_payload(),
            path in arb_path()
        ) {
            // Feature: auto-reply-mechanism, Property 9: Webhook 签名验证
            // **Validates: Requirements 9.1, 9.2**

            let handler = WebhookHandler::new(secret, path);

            // 计算正确的签名
            let signature = handler.compute_signature(&payload);

            // 验证签名应该通过
            prop_assert!(
                handler.verify_signature(&payload, &signature),
                "Valid signature should always pass verification"
            );
        }

        /// Property 9.2: 有效签名带 sha256= 前缀也通过验证
        /// **Validates: Requirement 9.1**
        ///
        /// 支持 GitHub 风格的签名格式
        #[test]
        fn prop_valid_signature_with_prefix_passes(
            secret in arb_secret(),
            payload in arb_payload(),
            path in arb_path()
        ) {
            // Feature: auto-reply-mechanism, Property 9: Webhook 签名验证
            // **Validates: Requirements 9.1, 9.2**

            let handler = WebhookHandler::new(secret, path);

            // 计算正确的签名并添加前缀
            let signature = handler.compute_signature(&payload);
            let prefixed_signature = format!("sha256={}", signature);

            // 验证带前缀的签名应该通过
            prop_assert!(
                handler.verify_signature(&payload, &prefixed_signature),
                "Valid signature with sha256= prefix should pass verification"
            );
        }

        /// Property 9.3: 无效/篡改的签名始终被拒绝
        /// **Validates: Requirement 9.2**
        ///
        /// WHEN signature validation fails, THE Webhook_Trigger SHALL reject the request
        #[test]
        fn prop_invalid_signature_always_fails(
            secret in arb_secret(),
            payload in arb_payload(),
            path in arb_path(),
            invalid_sig in arb_invalid_signature()
        ) {
            // Feature: auto-reply-mechanism, Property 9: Webhook 签名验证
            // **Validates: Requirements 9.1, 9.2**

            let handler = WebhookHandler::new(secret, path);

            // 无效签名应该被拒绝
            prop_assert!(
                !handler.verify_signature(&payload, &invalid_sig),
                "Invalid signature '{}' should be rejected",
                invalid_sig
            );
        }

        /// Property 9.4: 篡改后的 payload 使用原始签名会失败
        /// **Validates: Requirements 9.1, 9.2**
        ///
        /// 确保签名与 payload 绑定，任何修改都会导致验证失败
        #[test]
        fn prop_tampered_payload_fails_verification(
            secret in arb_secret(),
            payload in arb_payload().prop_filter("Need non-empty payload", |p| !p.is_empty()),
            path in arb_path()
        ) {
            // Feature: auto-reply-mechanism, Property 9: Webhook 签名验证
            // **Validates: Requirements 9.1, 9.2**

            let handler = WebhookHandler::new(secret, path);

            // 计算原始 payload 的签名
            let signature = handler.compute_signature(&payload);

            // 生成篡改后的 payload
            let tampered = arb_tampered_payload(&payload);

            // 使用 proptest runner 测试篡改后的 payload
            proptest!(|(tampered_payload in tampered)| {
                // 只有当篡改后的 payload 与原始不同时才测试
                if tampered_payload != payload {
                    prop_assert!(
                        !handler.verify_signature(&tampered_payload, &signature),
                        "Tampered payload should fail verification with original signature"
                    );
                }
            });
        }

        /// Property 9.5: 不同 secret 产生不同签名
        /// **Validates: Requirement 9.1**
        ///
        /// 确保不同的 secret 会产生不同的签名，防止跨账户攻击
        #[test]
        fn prop_different_secrets_produce_different_signatures(
            secret1 in arb_secret(),
            secret2 in arb_secret().prop_filter("Secrets must be different", |s| !s.is_empty()),
            payload in arb_payload(),
            path in arb_path()
        ) {
            // Feature: auto-reply-mechanism, Property 9: Webhook 签名验证
            // **Validates: Requirements 9.1, 9.2**

            // 只有当两个 secret 不同时才测试
            prop_assume!(secret1 != secret2);

            let handler1 = WebhookHandler::new(secret1, path.clone());
            let handler2 = WebhookHandler::new(secret2, path);

            let sig1 = handler1.compute_signature(&payload);
            let sig2 = handler2.compute_signature(&payload);

            // 不同 secret 应该产生不同签名
            prop_assert_ne!(
                &sig1, &sig2,
                "Different secrets should produce different signatures"
            );

            // handler1 的签名不能通过 handler2 的验证
            prop_assert!(
                !handler2.verify_signature(&payload, &sig1),
                "Signature from secret1 should not pass verification with secret2"
            );

            // handler2 的签名不能通过 handler1 的验证
            prop_assert!(
                !handler1.verify_signature(&payload, &sig2),
                "Signature from secret2 should not pass verification with secret1"
            );
        }

        /// Property 9.6: 相同 payload + 相同 secret = 相同签名（确定性）
        /// **Validates: Requirement 9.1**
        ///
        /// 签名算法应该是确定性的，相同输入产生相同输出
        #[test]
        fn prop_same_payload_same_secret_same_signature(
            secret in arb_secret(),
            payload in arb_payload(),
            path in arb_path()
        ) {
            // Feature: auto-reply-mechanism, Property 9: Webhook 签名验证
            // **Validates: Requirements 9.1, 9.2**

            let handler = WebhookHandler::new(secret, path);

            // 多次计算签名
            let sig1 = handler.compute_signature(&payload);
            let sig2 = handler.compute_signature(&payload);
            let sig3 = handler.compute_signature(&payload);

            // 所有签名应该相同
            prop_assert_eq!(
                &sig1, &sig2,
                "Same payload and secret should produce same signature (1 vs 2)"
            );
            prop_assert_eq!(
                &sig2, &sig3,
                "Same payload and secret should produce same signature (2 vs 3)"
            );
        }

        /// Property 9.7: handle_request 正确处理有效请求
        /// **Validates: Requirements 9.1, 9.3, 9.5**
        ///
        /// 完整的请求处理流程：签名验证 + 请求解析
        #[test]
        fn prop_handle_request_with_valid_signature_succeeds(
            secret in arb_secret(),
            request in arb_webhook_request(),
            path in arb_path()
        ) {
            // Feature: auto-reply-mechanism, Property 9: Webhook 签名验证
            // **Validates: Requirements 9.1, 9.2, 9.3, 9.5**

            let handler = WebhookHandler::new(secret, path);

            // 序列化请求为 JSON
            let body = serde_json::to_vec(&request).unwrap();

            // 计算正确的签名
            let signature = handler.compute_signature(&body);

            // 处理请求
            let result = handler.handle_request(&body, &signature);

            // 应该成功触发
            prop_assert!(
                result.is_triggered(),
                "Valid request with valid signature should trigger"
            );

            // 解析后的请求应该与原始请求一致
            if let WebhookResult::Triggered { request: parsed } = result {
                prop_assert_eq!(
                    parsed.content, request.content,
                    "Parsed content should match original"
                );
                prop_assert_eq!(
                    parsed.sender_id, request.sender_id,
                    "Parsed sender_id should match original"
                );
            }
        }

        /// Property 9.8: handle_request 拒绝无效签名
        /// **Validates: Requirements 9.2, 9.5**
        ///
        /// 无效签名应该导致请求被拒绝
        #[test]
        fn prop_handle_request_with_invalid_signature_fails(
            secret in arb_secret(),
            request in arb_webhook_request(),
            path in arb_path(),
            invalid_sig in arb_invalid_signature()
        ) {
            // Feature: auto-reply-mechanism, Property 9: Webhook 签名验证
            // **Validates: Requirements 9.1, 9.2, 9.5**

            let handler = WebhookHandler::new(secret, path);

            // 序列化请求为 JSON
            let body = serde_json::to_vec(&request).unwrap();

            // 使用无效签名处理请求
            let result = handler.handle_request(&body, &invalid_sig);

            // 应该返回 InvalidSignature
            prop_assert!(
                result.is_invalid_signature(),
                "Request with invalid signature should return InvalidSignature"
            );
        }

        /// Property 9.9: 签名长度固定为 64 字符（SHA256 hex）
        /// **Validates: Requirement 9.1**
        ///
        /// HMAC-SHA256 产生 32 字节 = 64 hex 字符的签名
        #[test]
        fn prop_signature_length_is_fixed(
            secret in arb_secret(),
            payload in arb_payload(),
            path in arb_path()
        ) {
            // Feature: auto-reply-mechanism, Property 9: Webhook 签名验证
            // **Validates: Requirements 9.1, 9.2**

            let handler = WebhookHandler::new(secret, path);
            let signature = handler.compute_signature(&payload);

            // SHA256 产生 32 字节 = 64 hex 字符
            prop_assert_eq!(
                signature.len(), 64,
                "Signature should be 64 hex characters (SHA256), got {} characters",
                signature.len()
            );

            // 验证是有效的 hex 字符串
            prop_assert!(
                signature.chars().all(|c| c.is_ascii_hexdigit()),
                "Signature should only contain hex characters"
            );
        }

        /// Property 9.10: 空 payload 也能正确签名和验证
        /// **Validates: Requirement 9.1**
        ///
        /// 边界情况：空 payload 应该能正常处理
        #[test]
        fn prop_empty_payload_signature_works(
            secret in arb_secret(),
            path in arb_path()
        ) {
            // Feature: auto-reply-mechanism, Property 9: Webhook 签名验证
            // **Validates: Requirements 9.1, 9.2**

            let handler = WebhookHandler::new(secret, path);
            let empty_payload: &[u8] = &[];

            // 计算空 payload 的签名
            let signature = handler.compute_signature(empty_payload);

            // 签名应该是有效的 64 字符 hex
            prop_assert_eq!(signature.len(), 64);

            // 验证应该通过
            prop_assert!(
                handler.verify_signature(empty_payload, &signature),
                "Empty payload signature should verify correctly"
            );
        }
    }
}
