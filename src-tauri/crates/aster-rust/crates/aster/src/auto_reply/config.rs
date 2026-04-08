//! 配置持久化
//!
//! 自动回复配置的加载和保存。
//!
//! # 功能
//!
//! - 从 JSON 文件加载配置（Requirement 10.2）
//! - 保存配置到 JSON 文件（Requirement 10.1）
//! - 文件不存在时使用默认配置（Requirement 10.3）
//! - 解析错误时记录日志并使用默认配置（Requirement 10.4）
//! - 支持配置热重载（Requirement 10.5）
//!
//! # 示例
//!
//! ```rust,ignore
//! use std::path::Path;
//! use aster::auto_reply::AutoReplyConfig;
//!
//! // 加载配置
//! let config = AutoReplyConfig::load(Path::new("auto_reply.json"))?;
//!
//! // 保存配置
//! config.save(Path::new("auto_reply.json"))?;
//!
//! // 使用默认配置
//! let default_config = AutoReplyConfig::default();
//! ```

use std::path::Path;

use serde::{Deserialize, Serialize};
use tracing::{error, info, warn};

use crate::auto_reply::group::GroupActivation;
use crate::auto_reply::registry::AutoReplyTrigger;

/// 配置加载/保存错误
#[derive(Debug, thiserror::Error)]
pub enum ConfigError {
    /// IO 错误
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    /// JSON 解析错误
    #[error("JSON parse error: {0}")]
    Json(#[from] serde_json::Error),
}

/// 配置加载结果类型
pub type ConfigResult<T> = Result<T, ConfigError>;

/// 自动回复配置
///
/// 包含自动回复系统的所有配置项。
///
/// # 字段说明
///
/// - `enabled`: 全局开关，控制是否启用自动回复
/// - `triggers`: 触发器列表，定义触发条件
/// - `whitelist`: 白名单用户列表，空列表表示允许所有用户
/// - `default_cooldown_seconds`: 默认冷却时间（秒）
/// - `group_activations`: 群组特定配置列表
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AutoReplyConfig {
    /// 是否启用自动回复
    #[serde(default = "default_true")]
    pub enabled: bool,
    /// 触发器列表
    #[serde(default)]
    pub triggers: Vec<AutoReplyTrigger>,
    /// 白名单用户
    #[serde(default)]
    pub whitelist: Vec<String>,
    /// 默认冷却时间（秒）
    #[serde(default = "default_cooldown")]
    pub default_cooldown_seconds: u64,
    /// 群组激活配置
    #[serde(default)]
    pub group_activations: Vec<GroupActivation>,
}

fn default_true() -> bool {
    true
}

fn default_cooldown() -> u64 {
    60
}

impl Default for AutoReplyConfig {
    /// 创建默认配置
    ///
    /// **Validates: Requirement 10.3**
    ///
    /// 默认配置：
    /// - 启用自动回复
    /// - 无触发器
    /// - 空白名单（允许所有用户）
    /// - 60 秒冷却时间
    /// - 无群组特定配置
    fn default() -> Self {
        Self {
            enabled: true,
            triggers: Vec::new(),
            whitelist: Vec::new(),
            default_cooldown_seconds: 60,
            group_activations: Vec::new(),
        }
    }
}

impl AutoReplyConfig {
    /// 从文件加载配置
    ///
    /// **Validates: Requirements 10.2, 10.3, 10.4**
    ///
    /// # 行为
    ///
    /// - 文件存在且有效：返回解析后的配置
    /// - 文件不存在：记录 info 日志，返回默认配置（Requirement 10.3）
    /// - 文件解析失败：记录 error 日志，返回默认配置（Requirement 10.4）
    ///
    /// # 参数
    ///
    /// * `path` - 配置文件路径
    ///
    /// # 返回值
    ///
    /// 返回加载的配置，如果加载失败则返回默认配置。
    ///
    /// # 示例
    ///
    /// ```rust,ignore
    /// use std::path::Path;
    /// use aster::auto_reply::AutoReplyConfig;
    ///
    /// let config = AutoReplyConfig::load(Path::new("auto_reply.json"));
    /// ```
    pub fn load(path: &Path) -> Self {
        match Self::load_from_file(path) {
            Ok(config) => {
                info!("Loaded auto-reply config from {:?}", path);
                config
            }
            Err(ConfigError::Io(ref e)) if e.kind() == std::io::ErrorKind::NotFound => {
                // Requirement 10.3: 文件不存在时使用默认配置
                info!(
                    "Auto-reply config file not found at {:?}, using defaults",
                    path
                );
                Self::default()
            }
            Err(e) => {
                // Requirement 10.4: 解析错误时记录日志并使用默认配置
                error!(
                    "Failed to load auto-reply config from {:?}: {}, using defaults",
                    path, e
                );
                Self::default()
            }
        }
    }

    /// 从文件加载配置（返回 Result）
    ///
    /// 内部方法，用于区分不同的错误类型。
    ///
    /// # 参数
    ///
    /// * `path` - 配置文件路径
    ///
    /// # 返回值
    ///
    /// 成功时返回配置，失败时返回错误。
    fn load_from_file(path: &Path) -> ConfigResult<Self> {
        let content = std::fs::read_to_string(path)?;
        let config: Self = serde_json::from_str(&content)?;
        Ok(config)
    }

    /// 保存配置到文件
    ///
    /// **Validates: Requirement 10.1**
    ///
    /// 将配置序列化为格式化的 JSON 并写入文件。
    /// 如果父目录不存在，会自动创建。
    ///
    /// # 参数
    ///
    /// * `path` - 配置文件路径
    ///
    /// # 返回值
    ///
    /// 成功时返回 `Ok(())`，失败时返回错误。
    ///
    /// # 示例
    ///
    /// ```rust,ignore
    /// use std::path::Path;
    /// use aster::auto_reply::AutoReplyConfig;
    ///
    /// let config = AutoReplyConfig::default();
    /// config.save(Path::new("auto_reply.json"))?;
    /// ```
    pub fn save(&self, path: &Path) -> ConfigResult<()> {
        // 确保父目录存在
        if let Some(parent) = path.parent() {
            if !parent.exists() {
                std::fs::create_dir_all(parent)?;
            }
        }

        let content = serde_json::to_string_pretty(self)?;
        std::fs::write(path, content)?;
        info!("Saved auto-reply config to {:?}", path);
        Ok(())
    }

    /// 重新加载配置
    ///
    /// **Validates: Requirement 10.5**
    ///
    /// 从文件重新加载配置，支持热重载。
    /// 如果加载失败，保持当前配置不变并返回错误。
    ///
    /// # 参数
    ///
    /// * `path` - 配置文件路径
    ///
    /// # 返回值
    ///
    /// 成功时返回新配置，失败时返回错误（当前配置不变）。
    ///
    /// # 示例
    ///
    /// ```rust,ignore
    /// use std::path::Path;
    /// use aster::auto_reply::AutoReplyConfig;
    ///
    /// let mut config = AutoReplyConfig::default();
    /// match config.reload(Path::new("auto_reply.json")) {
    ///     Ok(new_config) => {
    ///         config = new_config;
    ///         println!("Config reloaded successfully");
    ///     }
    ///     Err(e) => {
    ///         println!("Failed to reload config: {}", e);
    ///     }
    /// }
    /// ```
    pub fn reload(path: &Path) -> ConfigResult<Self> {
        let config = Self::load_from_file(path)?;
        info!("Reloaded auto-reply config from {:?}", path);
        Ok(config)
    }

    /// 验证配置有效性
    ///
    /// 检查配置中的各项设置是否有效。
    ///
    /// # 返回值
    ///
    /// 返回验证结果列表，每个元素是一个警告消息。
    /// 空列表表示配置完全有效。
    pub fn validate(&self) -> Vec<String> {
        let mut warnings = Vec::new();

        // 检查触发器 ID 是否唯一
        let mut seen_ids = std::collections::HashSet::new();
        for trigger in &self.triggers {
            if !seen_ids.insert(&trigger.id) {
                warnings.push(format!("Duplicate trigger ID: {}", trigger.id));
            }
        }

        // 检查群组配置 ID 是否唯一
        let mut seen_group_ids = std::collections::HashSet::new();
        for group in &self.group_activations {
            if !seen_group_ids.insert(&group.group_id) {
                warnings.push(format!("Duplicate group ID: {}", group.group_id));
            }
        }

        // 记录警告日志
        for warning in &warnings {
            warn!("Config validation warning: {}", warning);
        }

        warnings
    }

    /// 合并另一个配置
    ///
    /// 将另一个配置的内容合并到当前配置中。
    /// 触发器和群组配置会追加，其他字段会被覆盖。
    ///
    /// # 参数
    ///
    /// * `other` - 要合并的配置
    pub fn merge(&mut self, other: Self) {
        self.enabled = other.enabled;
        self.triggers.extend(other.triggers);
        self.whitelist.extend(other.whitelist);
        self.default_cooldown_seconds = other.default_cooldown_seconds;
        self.group_activations.extend(other.group_activations);
    }

    /// 检查是否为默认配置
    pub fn is_default(&self) -> bool {
        *self == Self::default()
    }

    /// 获取启用的触发器数量
    pub fn enabled_trigger_count(&self) -> usize {
        self.triggers.iter().filter(|t| t.enabled).count()
    }

    /// 获取群组配置数量
    pub fn group_count(&self) -> usize {
        self.group_activations.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auto_reply::types::{
        KeywordTriggerConfig, ScheduleTriggerConfig, ScheduleType, TriggerConfig, TriggerType,
        WebhookTriggerConfig,
    };
    use proptest::prelude::*;
    use tempfile::TempDir;

    /// 创建测试用的触发器
    fn create_test_trigger(id: &str) -> AutoReplyTrigger {
        AutoReplyTrigger {
            id: id.to_string(),
            name: format!("Test Trigger {}", id),
            enabled: true,
            trigger_type: TriggerType::Keyword,
            config: TriggerConfig::Keyword(KeywordTriggerConfig {
                patterns: vec!["test".to_string()],
                case_insensitive: false,
                use_regex: false,
            }),
            priority: 100,
            response_template: None,
        }
    }

    // ============================================================================
    // Property-Based Test Generators
    // ============================================================================
    // Feature: auto-reply-mechanism, Property 10: 配置持久化 Round-Trip
    // **Validates: Requirements 10.1, 10.2, 10.5**

    /// 生成有效的标识符字符串（用于 ID、名称等）
    fn arb_identifier() -> impl Strategy<Value = String> {
        "[a-zA-Z][a-zA-Z0-9_-]{0,19}".prop_map(|s| s)
    }

    /// 生成有效的用户 ID
    fn arb_user_id() -> impl Strategy<Value = String> {
        "[a-zA-Z0-9_-]{1,20}".prop_map(|s| s)
    }

    /// 生成关键词模式（避免无效正则表达式）
    fn arb_keyword_pattern() -> impl Strategy<Value = String> {
        "[a-zA-Z0-9_\\-\\s]{1,30}".prop_map(|s| s)
    }

    /// 生成 TriggerType
    fn arb_trigger_type() -> impl Strategy<Value = TriggerType> {
        prop_oneof![
            Just(TriggerType::Mention),
            Just(TriggerType::Keyword),
            Just(TriggerType::DirectMessage),
            Just(TriggerType::Schedule),
            Just(TriggerType::Webhook),
        ]
    }

    /// 生成 KeywordTriggerConfig
    fn arb_keyword_config() -> impl Strategy<Value = KeywordTriggerConfig> {
        (
            prop::collection::vec(arb_keyword_pattern(), 1..5),
            any::<bool>(),
            // use_regex 设为 false 以避免无效正则表达式问题
            Just(false),
        )
            .prop_map(
                |(patterns, case_insensitive, use_regex)| KeywordTriggerConfig {
                    patterns,
                    case_insensitive,
                    use_regex,
                },
            )
    }

    /// 生成 ScheduleType
    fn arb_schedule_type() -> impl Strategy<Value = ScheduleType> {
        prop_oneof![
            // Cron 表达式（使用简单有效的 cron 格式）
            (
                Just("0 * * * *".to_string()),
                proptest::option::of("[A-Za-z/_]{1,20}")
            )
                .prop_map(|(expr, timezone)| ScheduleType::Cron { expr, timezone }),
            // At 一次性定时
            (0i64..=i64::MAX).prop_map(|at_ms| ScheduleType::At { at_ms }),
            // Every 固定间隔
            (1000u64..=86400000u64).prop_map(|every_ms| ScheduleType::Every { every_ms }),
        ]
    }

    /// 生成 ScheduleTriggerConfig
    fn arb_schedule_config() -> impl Strategy<Value = ScheduleTriggerConfig> {
        arb_schedule_type().prop_map(|schedule_type| ScheduleTriggerConfig { schedule_type })
    }

    /// 生成 WebhookTriggerConfig
    fn arb_webhook_config() -> impl Strategy<Value = WebhookTriggerConfig> {
        (
            "[a-zA-Z0-9]{16,32}".prop_map(|s| s),     // secret
            "/[a-z][a-z0-9/-]{0,30}".prop_map(|s| s), // path
        )
            .prop_map(|(secret, path)| WebhookTriggerConfig { secret, path })
    }

    /// 生成 TriggerConfig（与 TriggerType 匹配）
    fn arb_trigger_config() -> impl Strategy<Value = (TriggerType, TriggerConfig)> {
        prop_oneof![
            Just((TriggerType::Mention, TriggerConfig::Mention)),
            Just((TriggerType::DirectMessage, TriggerConfig::DirectMessage)),
            arb_keyword_config().prop_map(|c| (TriggerType::Keyword, TriggerConfig::Keyword(c))),
            arb_schedule_config().prop_map(|c| (TriggerType::Schedule, TriggerConfig::Schedule(c))),
            arb_webhook_config().prop_map(|c| (TriggerType::Webhook, TriggerConfig::Webhook(c))),
        ]
    }

    /// 生成 AutoReplyTrigger
    fn arb_trigger() -> impl Strategy<Value = AutoReplyTrigger> {
        (
            arb_identifier(),                            // id
            "[a-zA-Z0-9 _-]{1,50}".prop_map(|s| s),      // name
            any::<bool>(),                               // enabled
            arb_trigger_config(),                        // (trigger_type, config)
            0u32..=1000u32,                              // priority
            proptest::option::of("[a-zA-Z0-9 ]{0,100}"), // response_template
        )
            .prop_map(
                |(id, name, enabled, (trigger_type, config), priority, response_template)| {
                    AutoReplyTrigger {
                        id,
                        name,
                        enabled,
                        trigger_type,
                        config,
                        priority,
                        response_template,
                    }
                },
            )
    }

    /// 生成具有唯一 ID 的触发器列表
    fn arb_triggers() -> impl Strategy<Value = Vec<AutoReplyTrigger>> {
        prop::collection::vec(arb_trigger(), 0..10).prop_map(|triggers| {
            let mut seen_ids = std::collections::HashSet::new();
            triggers
                .into_iter()
                .enumerate()
                .map(|(i, mut t)| {
                    while seen_ids.contains(&t.id) {
                        t.id = format!("{}_{}", t.id, i);
                    }
                    seen_ids.insert(t.id.clone());
                    t
                })
                .collect()
        })
    }

    /// 生成 GroupActivation
    fn arb_group_activation() -> impl Strategy<Value = GroupActivation> {
        (
            arb_identifier(),                                                 // group_id
            any::<bool>(),                                                    // enabled
            any::<bool>(),                                                    // require_mention
            proptest::option::of(0u64..=3600u64),                             // cooldown_seconds
            proptest::option::of(prop::collection::vec(arb_user_id(), 0..5)), // whitelist
        )
            .prop_map(
                |(group_id, enabled, require_mention, cooldown_seconds, whitelist)| {
                    GroupActivation {
                        group_id,
                        enabled,
                        require_mention,
                        cooldown_seconds,
                        whitelist,
                    }
                },
            )
    }

    /// 生成具有唯一 group_id 的群组配置列表
    fn arb_group_activations() -> impl Strategy<Value = Vec<GroupActivation>> {
        prop::collection::vec(arb_group_activation(), 0..5).prop_map(|groups| {
            let mut seen_ids = std::collections::HashSet::new();
            groups
                .into_iter()
                .enumerate()
                .map(|(i, mut g)| {
                    while seen_ids.contains(&g.group_id) {
                        g.group_id = format!("{}_{}", g.group_id, i);
                    }
                    seen_ids.insert(g.group_id.clone());
                    g
                })
                .collect()
        })
    }

    /// 生成 AutoReplyConfig
    fn arb_config() -> impl Strategy<Value = AutoReplyConfig> {
        (
            any::<bool>(),                               // enabled
            arb_triggers(),                              // triggers
            prop::collection::vec(arb_user_id(), 0..10), // whitelist
            0u64..=3600u64,                              // default_cooldown_seconds
            arb_group_activations(),                     // group_activations
        )
            .prop_map(
                |(enabled, triggers, whitelist, default_cooldown_seconds, group_activations)| {
                    AutoReplyConfig {
                        enabled,
                        triggers,
                        whitelist,
                        default_cooldown_seconds,
                        group_activations,
                    }
                },
            )
    }

    // ============================================================================
    // Property-Based Tests
    // ============================================================================

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(100))]

        /// Property 10: 配置持久化 Round-Trip - JSON 序列化
        ///
        /// **Validates: Requirements 10.1, 10.2, 10.5**
        ///
        /// For any AutoReplyConfig 实例，序列化为 JSON 后再反序列化应产生等价的配置。
        /// 这验证了：
        /// - Requirement 10.1: 配置可以正确保存（序列化）
        /// - Requirement 10.2: 配置可以正确加载（反序列化）
        /// - Requirement 10.5: 热重载产生相同结果（reload 使用相同的序列化/反序列化逻辑）
        #[test]
        fn prop_config_json_roundtrip(config in arb_config()) {
            // Feature: auto-reply-mechanism, Property 10: 配置持久化 Round-Trip
            // **Validates: Requirements 10.1, 10.2, 10.5**

            // 序列化为 JSON
            let json = serde_json::to_string(&config)
                .expect("AutoReplyConfig should serialize to JSON");

            // 反序列化回 AutoReplyConfig
            let parsed: AutoReplyConfig = serde_json::from_str(&json)
                .expect("JSON should deserialize back to AutoReplyConfig");

            // 验证 round-trip 一致性
            prop_assert_eq!(
                config.enabled, parsed.enabled,
                "enabled field should match after round-trip"
            );
            prop_assert_eq!(
                config.triggers.len(), parsed.triggers.len(),
                "triggers count should match after round-trip"
            );
            prop_assert_eq!(
                &config.whitelist, &parsed.whitelist,
                "whitelist should match after round-trip"
            );
            prop_assert_eq!(
                config.default_cooldown_seconds, parsed.default_cooldown_seconds,
                "default_cooldown_seconds should match after round-trip"
            );
            prop_assert_eq!(
                config.group_activations.len(), parsed.group_activations.len(),
                "group_activations count should match after round-trip"
            );

            // 验证完整相等性
            prop_assert_eq!(&config, &parsed, "Config should be equal after JSON round-trip");
        }

        /// Property 10: 配置持久化 Round-Trip - 文件保存和加载
        ///
        /// **Validates: Requirements 10.1, 10.2**
        ///
        /// For any AutoReplyConfig 实例，保存到 JSON 文件后再加载应产生等价的配置。
        #[test]
        fn prop_config_save_load_roundtrip(config in arb_config()) {
            // Feature: auto-reply-mechanism, Property 10: 配置持久化 Round-Trip
            // **Validates: Requirements 10.1, 10.2, 10.5**

            // 创建临时目录
            let temp_dir = TempDir::new().expect("Should create temp dir");
            let config_path = temp_dir.path().join("auto_reply.json");

            // 保存配置 (Requirement 10.1)
            config.save(&config_path).expect("Should save config");

            // 加载配置 (Requirement 10.2)
            let loaded = AutoReplyConfig::load(&config_path);

            // 验证 round-trip 一致性
            prop_assert_eq!(
                config.enabled, loaded.enabled,
                "enabled field should match after file round-trip"
            );
            prop_assert_eq!(
                config.triggers.len(), loaded.triggers.len(),
                "triggers count should match after file round-trip"
            );
            prop_assert_eq!(
                &config.whitelist, &loaded.whitelist,
                "whitelist should match after file round-trip"
            );
            prop_assert_eq!(
                config.default_cooldown_seconds, loaded.default_cooldown_seconds,
                "default_cooldown_seconds should match after file round-trip"
            );
            prop_assert_eq!(
                config.group_activations.len(), loaded.group_activations.len(),
                "group_activations count should match after file round-trip"
            );

            // 验证完整相等性
            prop_assert_eq!(&config, &loaded, "Config should be equal after file round-trip");
        }

        /// Property 10: 配置持久化 Round-Trip - reload 产生相同结果
        ///
        /// **Validates: Requirement 10.5**
        ///
        /// For any AutoReplyConfig 实例，reload 应产生与 load 相同的结果。
        #[test]
        fn prop_config_reload_equals_load(config in arb_config()) {
            // Feature: auto-reply-mechanism, Property 10: 配置持久化 Round-Trip
            // **Validates: Requirements 10.1, 10.2, 10.5**

            // 创建临时目录
            let temp_dir = TempDir::new().expect("Should create temp dir");
            let config_path = temp_dir.path().join("auto_reply.json");

            // 保存配置
            config.save(&config_path).expect("Should save config");

            // 使用 load 加载
            let loaded = AutoReplyConfig::load(&config_path);

            // 使用 reload 加载 (Requirement 10.5)
            let reloaded = AutoReplyConfig::reload(&config_path)
                .expect("Should reload config");

            // 验证 load 和 reload 产生相同结果
            prop_assert_eq!(
                &loaded, &reloaded,
                "reload should produce same result as load"
            );
        }

        /// Property 10 补充: 触发器 round-trip 保持所有字段
        ///
        /// **Validates: Requirements 10.1, 10.2**
        ///
        /// For any AutoReplyTrigger，序列化后再反序列化应保持所有字段。
        #[test]
        fn prop_trigger_roundtrip(trigger in arb_trigger()) {
            // Feature: auto-reply-mechanism, Property 10: 配置持久化 Round-Trip
            // **Validates: Requirements 10.1, 10.2, 10.5**

            let json = serde_json::to_string(&trigger)
                .expect("AutoReplyTrigger should serialize to JSON");
            let parsed: AutoReplyTrigger = serde_json::from_str(&json)
                .expect("JSON should deserialize back to AutoReplyTrigger");

            prop_assert_eq!(&trigger.id, &parsed.id, "id should match");
            prop_assert_eq!(&trigger.name, &parsed.name, "name should match");
            prop_assert_eq!(trigger.enabled, parsed.enabled, "enabled should match");
            prop_assert_eq!(trigger.trigger_type, parsed.trigger_type, "trigger_type should match");
            prop_assert_eq!(trigger.priority, parsed.priority, "priority should match");
            prop_assert_eq!(&trigger.response_template, &parsed.response_template, "response_template should match");
            prop_assert_eq!(&trigger, &parsed, "Trigger should be equal after round-trip");
        }

        /// Property 10 补充: GroupActivation round-trip 保持所有字段
        ///
        /// **Validates: Requirements 10.1, 10.2**
        ///
        /// For any GroupActivation，序列化后再反序列化应保持所有字段。
        #[test]
        fn prop_group_activation_roundtrip(group in arb_group_activation()) {
            // Feature: auto-reply-mechanism, Property 10: 配置持久化 Round-Trip
            // **Validates: Requirements 10.1, 10.2, 10.5**

            let json = serde_json::to_string(&group)
                .expect("GroupActivation should serialize to JSON");
            let parsed: GroupActivation = serde_json::from_str(&json)
                .expect("JSON should deserialize back to GroupActivation");

            prop_assert_eq!(&group.group_id, &parsed.group_id, "group_id should match");
            prop_assert_eq!(group.enabled, parsed.enabled, "enabled should match");
            prop_assert_eq!(group.require_mention, parsed.require_mention, "require_mention should match");
            prop_assert_eq!(group.cooldown_seconds, parsed.cooldown_seconds, "cooldown_seconds should match");
            prop_assert_eq!(&group.whitelist, &parsed.whitelist, "whitelist should match");
            prop_assert_eq!(&group, &parsed, "GroupActivation should be equal after round-trip");
        }

        /// Property 10 补充: 多次保存加载保持一致性
        ///
        /// **Validates: Requirements 10.1, 10.2, 10.5**
        ///
        /// For any AutoReplyConfig，多次保存和加载应产生相同结果。
        #[test]
        fn prop_config_multiple_roundtrips(config in arb_config()) {
            // Feature: auto-reply-mechanism, Property 10: 配置持久化 Round-Trip
            // **Validates: Requirements 10.1, 10.2, 10.5**

            let temp_dir = TempDir::new().expect("Should create temp dir");
            let config_path = temp_dir.path().join("auto_reply.json");

            // 第一次 round-trip
            config.save(&config_path).expect("Should save config");
            let loaded1 = AutoReplyConfig::load(&config_path);

            // 第二次 round-trip
            loaded1.save(&config_path).expect("Should save config again");
            let loaded2 = AutoReplyConfig::load(&config_path);

            // 验证多次 round-trip 后仍然一致
            prop_assert_eq!(
                &config, &loaded1,
                "First round-trip should preserve config"
            );
            prop_assert_eq!(
                &loaded1, &loaded2,
                "Second round-trip should preserve config"
            );
            prop_assert_eq!(
                &config, &loaded2,
                "Config should be stable after multiple round-trips"
            );
        }

        /// Property 10 补充: pretty JSON 格式不影响加载
        ///
        /// **Validates: Requirements 10.1, 10.2**
        ///
        /// 无论使用 compact 还是 pretty JSON 格式，加载结果应相同。
        #[test]
        fn prop_config_json_format_independent(config in arb_config()) {
            // Feature: auto-reply-mechanism, Property 10: 配置持久化 Round-Trip
            // **Validates: Requirements 10.1, 10.2, 10.5**

            // Compact JSON
            let compact_json = serde_json::to_string(&config)
                .expect("Should serialize to compact JSON");
            let from_compact: AutoReplyConfig = serde_json::from_str(&compact_json)
                .expect("Should deserialize from compact JSON");

            // Pretty JSON
            let pretty_json = serde_json::to_string_pretty(&config)
                .expect("Should serialize to pretty JSON");
            let from_pretty: AutoReplyConfig = serde_json::from_str(&pretty_json)
                .expect("Should deserialize from pretty JSON");

            // 两种格式应产生相同结果
            prop_assert_eq!(
                &from_compact, &from_pretty,
                "Compact and pretty JSON should produce same result"
            );
            prop_assert_eq!(
                &config, &from_compact,
                "Config should be preserved regardless of JSON format"
            );
        }
    }

    // ============================================================================
    // Default 测试
    // ============================================================================

    /// 测试默认配置
    /// **Validates: Requirement 10.3**
    #[test]
    fn test_default_config() {
        let config = AutoReplyConfig::default();

        assert!(config.enabled);
        assert!(config.triggers.is_empty());
        assert!(config.whitelist.is_empty());
        assert_eq!(config.default_cooldown_seconds, 60);
        assert!(config.group_activations.is_empty());
    }

    // ============================================================================
    // Load 测试
    // ============================================================================

    /// 测试加载不存在的文件
    /// **Validates: Requirement 10.3**
    #[test]
    fn test_load_nonexistent_file() {
        let config = AutoReplyConfig::load(Path::new("/nonexistent/path/config.json"));

        // 应该返回默认配置
        assert!(config.enabled);
        assert!(config.triggers.is_empty());
        assert_eq!(config.default_cooldown_seconds, 60);
    }

    /// 测试加载有效的配置文件
    /// **Validates: Requirement 10.2**
    #[test]
    fn test_load_valid_config() {
        let temp_dir = TempDir::new().unwrap();
        let config_path = temp_dir.path().join("config.json");

        // 创建测试配置
        let original = AutoReplyConfig {
            enabled: false,
            triggers: vec![create_test_trigger("t1")],
            whitelist: vec!["user1".to_string()],
            default_cooldown_seconds: 120,
            group_activations: vec![GroupActivation::new("group1")],
        };

        // 保存配置
        original.save(&config_path).unwrap();

        // 加载配置
        let loaded = AutoReplyConfig::load(&config_path);

        assert!(!loaded.enabled);
        assert_eq!(loaded.triggers.len(), 1);
        assert_eq!(loaded.whitelist, vec!["user1".to_string()]);
        assert_eq!(loaded.default_cooldown_seconds, 120);
        assert_eq!(loaded.group_activations.len(), 1);
    }

    /// 测试加载无效的 JSON 文件
    /// **Validates: Requirement 10.4**
    #[test]
    fn test_load_invalid_json() {
        let temp_dir = TempDir::new().unwrap();
        let config_path = temp_dir.path().join("config.json");

        // 写入无效的 JSON
        std::fs::write(&config_path, "{ invalid json }").unwrap();

        // 应该返回默认配置
        let config = AutoReplyConfig::load(&config_path);
        assert!(config.enabled);
        assert!(config.triggers.is_empty());
    }

    // ============================================================================
    // Save 测试
    // ============================================================================

    /// 测试保存配置
    /// **Validates: Requirement 10.1**
    #[test]
    fn test_save_config() {
        let temp_dir = TempDir::new().unwrap();
        let config_path = temp_dir.path().join("config.json");

        let config = AutoReplyConfig {
            enabled: true,
            triggers: vec![create_test_trigger("t1")],
            whitelist: vec!["user1".to_string()],
            default_cooldown_seconds: 90,
            group_activations: vec![],
        };

        // 保存应该成功
        let result = config.save(&config_path);
        assert!(result.is_ok());

        // 文件应该存在
        assert!(config_path.exists());

        // 内容应该是有效的 JSON
        let content = std::fs::read_to_string(&config_path).unwrap();
        let parsed: AutoReplyConfig = serde_json::from_str(&content).unwrap();
        assert_eq!(parsed.default_cooldown_seconds, 90);
    }

    /// 测试保存到嵌套目录
    #[test]
    fn test_save_creates_parent_dirs() {
        let temp_dir = TempDir::new().unwrap();
        let config_path = temp_dir.path().join("nested/dir/config.json");

        let config = AutoReplyConfig::default();
        let result = config.save(&config_path);

        assert!(result.is_ok());
        assert!(config_path.exists());
    }

    // ============================================================================
    // Reload 测试
    // ============================================================================

    /// 测试重新加载配置
    /// **Validates: Requirement 10.5**
    #[test]
    fn test_reload_config() {
        let temp_dir = TempDir::new().unwrap();
        let config_path = temp_dir.path().join("config.json");

        // 保存初始配置
        let initial = AutoReplyConfig {
            enabled: true,
            default_cooldown_seconds: 60,
            ..Default::default()
        };
        initial.save(&config_path).unwrap();

        // 修改文件
        let modified = AutoReplyConfig {
            enabled: false,
            default_cooldown_seconds: 120,
            ..Default::default()
        };
        modified.save(&config_path).unwrap();

        // 重新加载
        let reloaded = AutoReplyConfig::reload(&config_path).unwrap();

        assert!(!reloaded.enabled);
        assert_eq!(reloaded.default_cooldown_seconds, 120);
    }

    /// 测试重新加载不存在的文件
    #[test]
    fn test_reload_nonexistent_file() {
        let result = AutoReplyConfig::reload(Path::new("/nonexistent/config.json"));
        assert!(result.is_err());
    }

    // ============================================================================
    // Validate 测试
    // ============================================================================

    /// 测试验证有效配置
    #[test]
    fn test_validate_valid_config() {
        let config = AutoReplyConfig {
            triggers: vec![create_test_trigger("t1"), create_test_trigger("t2")],
            group_activations: vec![GroupActivation::new("g1"), GroupActivation::new("g2")],
            ..Default::default()
        };

        let warnings = config.validate();
        assert!(warnings.is_empty());
    }

    /// 测试验证重复触发器 ID
    #[test]
    fn test_validate_duplicate_trigger_ids() {
        let config = AutoReplyConfig {
            triggers: vec![
                create_test_trigger("t1"),
                create_test_trigger("t1"), // 重复
            ],
            ..Default::default()
        };

        let warnings = config.validate();
        assert_eq!(warnings.len(), 1);
        assert!(warnings[0].contains("Duplicate trigger ID"));
    }

    /// 测试验证重复群组 ID
    #[test]
    fn test_validate_duplicate_group_ids() {
        let config = AutoReplyConfig {
            group_activations: vec![
                GroupActivation::new("g1"),
                GroupActivation::new("g1"), // 重复
            ],
            ..Default::default()
        };

        let warnings = config.validate();
        assert_eq!(warnings.len(), 1);
        assert!(warnings[0].contains("Duplicate group ID"));
    }

    // ============================================================================
    // 辅助方法测试
    // ============================================================================

    /// 测试 is_default
    #[test]
    fn test_is_default() {
        let default_config = AutoReplyConfig::default();
        assert!(default_config.is_default());

        let modified_config = AutoReplyConfig {
            enabled: false,
            ..Default::default()
        };
        assert!(!modified_config.is_default());
    }

    /// 测试 enabled_trigger_count
    #[test]
    fn test_enabled_trigger_count() {
        let mut t1 = create_test_trigger("t1");
        t1.enabled = true;
        let mut t2 = create_test_trigger("t2");
        t2.enabled = false;
        let mut t3 = create_test_trigger("t3");
        t3.enabled = true;

        let config = AutoReplyConfig {
            triggers: vec![t1, t2, t3],
            ..Default::default()
        };

        assert_eq!(config.enabled_trigger_count(), 2);
    }

    /// 测试 group_count
    #[test]
    fn test_group_count() {
        let config = AutoReplyConfig {
            group_activations: vec![GroupActivation::new("g1"), GroupActivation::new("g2")],
            ..Default::default()
        };

        assert_eq!(config.group_count(), 2);
    }

    /// 测试 merge
    #[test]
    fn test_merge() {
        let mut config1 = AutoReplyConfig {
            enabled: true,
            triggers: vec![create_test_trigger("t1")],
            whitelist: vec!["user1".to_string()],
            default_cooldown_seconds: 60,
            group_activations: vec![GroupActivation::new("g1")],
        };

        let config2 = AutoReplyConfig {
            enabled: false,
            triggers: vec![create_test_trigger("t2")],
            whitelist: vec!["user2".to_string()],
            default_cooldown_seconds: 120,
            group_activations: vec![GroupActivation::new("g2")],
        };

        config1.merge(config2);

        assert!(!config1.enabled);
        assert_eq!(config1.triggers.len(), 2);
        assert_eq!(config1.whitelist.len(), 2);
        assert_eq!(config1.default_cooldown_seconds, 120);
        assert_eq!(config1.group_activations.len(), 2);
    }

    // ============================================================================
    // 序列化 Round-Trip 测试
    // ============================================================================

    /// 测试序列化和反序列化 round-trip
    #[test]
    fn test_serialization_roundtrip() {
        let config = AutoReplyConfig {
            enabled: false,
            triggers: vec![create_test_trigger("t1")],
            whitelist: vec!["user1".to_string(), "user2".to_string()],
            default_cooldown_seconds: 90,
            group_activations: vec![GroupActivation::new("g1").with_require_mention(true)],
        };

        let json = serde_json::to_string(&config).unwrap();
        let parsed: AutoReplyConfig = serde_json::from_str(&json).unwrap();

        assert_eq!(config.enabled, parsed.enabled);
        assert_eq!(config.triggers.len(), parsed.triggers.len());
        assert_eq!(config.whitelist, parsed.whitelist);
        assert_eq!(
            config.default_cooldown_seconds,
            parsed.default_cooldown_seconds
        );
        assert_eq!(
            config.group_activations.len(),
            parsed.group_activations.len()
        );
    }

    /// 测试默认值反序列化
    #[test]
    fn test_deserialization_defaults() {
        let json = "{}";
        let config: AutoReplyConfig = serde_json::from_str(json).unwrap();

        assert!(config.enabled); // default_true
        assert!(config.triggers.is_empty());
        assert!(config.whitelist.is_empty());
        assert_eq!(config.default_cooldown_seconds, 60); // default_cooldown
        assert!(config.group_activations.is_empty());
    }
}
