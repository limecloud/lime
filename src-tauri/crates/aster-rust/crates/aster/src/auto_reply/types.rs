//! 基础类型定义
//!
//! 定义触发类型枚举和各种触发配置结构体。

use serde::{Deserialize, Serialize};

/// 触发类型枚举
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TriggerType {
    /// @提及触发
    Mention,
    /// 关键词匹配触发
    Keyword,
    /// 私聊触发
    DirectMessage,
    /// 定时触发
    Schedule,
    /// Webhook 触发
    Webhook,
}

/// 关键词触发配置
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct KeywordTriggerConfig {
    /// 匹配模式列表
    pub patterns: Vec<String>,
    /// 是否大小写不敏感
    #[serde(default)]
    pub case_insensitive: bool,
    /// 是否使用正则表达式
    #[serde(default)]
    pub use_regex: bool,
}

/// 调度类型
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ScheduleType {
    /// Cron 表达式
    Cron {
        expr: String,
        timezone: Option<String>,
    },
    /// 一次性定时
    At { at_ms: i64 },
    /// 固定间隔
    Every { every_ms: u64 },
}

/// 定时触发配置
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ScheduleTriggerConfig {
    /// 调度类型
    pub schedule_type: ScheduleType,
}

/// Webhook 触发配置
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct WebhookTriggerConfig {
    /// 验证密钥
    pub secret: String,
    /// 端点路径
    #[serde(default = "default_webhook_path")]
    pub path: String,
}

fn default_webhook_path() -> String {
    "/webhook/auto-reply".to_string()
}

/// 触发器配置（联合类型）
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum TriggerConfig {
    Mention,
    Keyword(KeywordTriggerConfig),
    DirectMessage,
    Schedule(ScheduleTriggerConfig),
    Webhook(WebhookTriggerConfig),
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    // Feature: auto-reply-mechanism, Property 1: TriggerType 序列化 Round-Trip
    // **Validates: Requirements 1.1-1.6**

    /// 为 TriggerType 实现 Arbitrary trait，用于属性测试
    fn arb_trigger_type() -> impl Strategy<Value = TriggerType> {
        prop_oneof![
            Just(TriggerType::Mention),
            Just(TriggerType::Keyword),
            Just(TriggerType::DirectMessage),
            Just(TriggerType::Schedule),
            Just(TriggerType::Webhook),
        ]
    }

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(20))]

        /// Property 1: TriggerType 序列化 Round-Trip
        /// 对于任意有效的 TriggerType 枚举值，序列化为 JSON 后再反序列化应该产生等价的枚举值
        #[test]
        fn prop_trigger_type_roundtrip(trigger_type in arb_trigger_type()) {
            // 序列化为 JSON
            let json = serde_json::to_string(&trigger_type)
                .expect("TriggerType should serialize to JSON");

            // 反序列化回 TriggerType
            let parsed: TriggerType = serde_json::from_str(&json)
                .expect("JSON should deserialize back to TriggerType");

            // 验证 round-trip 一致性
            prop_assert_eq!(trigger_type, parsed);
        }

        /// Property 1 补充: 验证序列化格式为 snake_case
        /// 序列化后的 JSON 字符串应该使用 snake_case 格式
        #[test]
        fn prop_trigger_type_snake_case_format(trigger_type in arb_trigger_type()) {
            let json = serde_json::to_string(&trigger_type)
                .expect("TriggerType should serialize to JSON");

            // 验证序列化格式为 snake_case（不包含大写字母，使用下划线分隔）
            let expected_format = match trigger_type {
                TriggerType::Mention => "\"mention\"",
                TriggerType::Keyword => "\"keyword\"",
                TriggerType::DirectMessage => "\"direct_message\"",
                TriggerType::Schedule => "\"schedule\"",
                TriggerType::Webhook => "\"webhook\"",
            };

            prop_assert_eq!(json, expected_format);
        }
    }

    /// 单元测试：验证所有 TriggerType 变体的序列化格式
    #[test]
    fn test_trigger_type_serialization_format() {
        // Requirement 1.1: Mention type
        assert_eq!(
            serde_json::to_string(&TriggerType::Mention).unwrap(),
            "\"mention\""
        );

        // Requirement 1.2: Keyword type
        assert_eq!(
            serde_json::to_string(&TriggerType::Keyword).unwrap(),
            "\"keyword\""
        );

        // Requirement 1.3: DirectMessage type
        assert_eq!(
            serde_json::to_string(&TriggerType::DirectMessage).unwrap(),
            "\"direct_message\""
        );

        // Requirement 1.4: Schedule type
        assert_eq!(
            serde_json::to_string(&TriggerType::Schedule).unwrap(),
            "\"schedule\""
        );

        // Requirement 1.5: Webhook type
        assert_eq!(
            serde_json::to_string(&TriggerType::Webhook).unwrap(),
            "\"webhook\""
        );
    }

    /// 单元测试：验证所有 TriggerType 变体的反序列化
    #[test]
    fn test_trigger_type_deserialization() {
        // Requirement 1.6: snake_case format deserialization
        assert_eq!(
            serde_json::from_str::<TriggerType>("\"mention\"").unwrap(),
            TriggerType::Mention
        );
        assert_eq!(
            serde_json::from_str::<TriggerType>("\"keyword\"").unwrap(),
            TriggerType::Keyword
        );
        assert_eq!(
            serde_json::from_str::<TriggerType>("\"direct_message\"").unwrap(),
            TriggerType::DirectMessage
        );
        assert_eq!(
            serde_json::from_str::<TriggerType>("\"schedule\"").unwrap(),
            TriggerType::Schedule
        );
        assert_eq!(
            serde_json::from_str::<TriggerType>("\"webhook\"").unwrap(),
            TriggerType::Webhook
        );
    }

    /// 单元测试：验证无效格式的反序列化失败
    #[test]
    fn test_trigger_type_invalid_deserialization() {
        // 非 snake_case 格式应该失败
        assert!(serde_json::from_str::<TriggerType>("\"Mention\"").is_err());
        assert!(serde_json::from_str::<TriggerType>("\"KEYWORD\"").is_err());
        assert!(serde_json::from_str::<TriggerType>("\"directMessage\"").is_err());
        assert!(serde_json::from_str::<TriggerType>("\"DirectMessage\"").is_err());

        // 无效值应该失败
        assert!(serde_json::from_str::<TriggerType>("\"invalid\"").is_err());
        assert!(serde_json::from_str::<TriggerType>("\"\"").is_err());
    }
}
