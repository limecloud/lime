//! 群组激活配置
//!
//! 控制群组中的自动回复触发行为。
//!
//! # 功能
//!
//! - 支持 `require_mention` 选项，要求 @提及才触发（Requirement 5.1, 5.2）
//! - 支持群组特定冷却时间覆盖（Requirement 5.3）
//! - 支持群组特定白名单覆盖（Requirement 5.4）
//! - 支持 `enabled` 标志禁用特定群组的自动回复（Requirement 5.5）
//!
//! # 示例
//!
//! ```rust
//! use aster::auto_reply::GroupActivation;
//!
//! // 创建基本群组配置
//! let activation = GroupActivation::new("group-123");
//! assert!(activation.enabled);
//! assert!(!activation.require_mention);
//!
//! // 使用 builder 模式创建配置
//! let activation = GroupActivation::new("group-456")
//!     .with_require_mention(true)
//!     .with_cooldown(120)
//!     .with_whitelist(vec!["user1".to_string(), "user2".to_string()]);
//!
//! assert!(activation.require_mention);
//! assert_eq!(activation.cooldown_seconds, Some(120));
//! ```

use serde::{Deserialize, Serialize};

/// 群组激活配置
///
/// 控制特定群组中的自动回复触发行为。
///
/// # 字段说明
///
/// - `group_id`: 群组的唯一标识符
/// - `enabled`: 是否在该群组启用自动回复（Requirement 5.5）
/// - `require_mention`: 是否要求 @提及才触发（Requirement 5.1, 5.2）
/// - `cooldown_seconds`: 群组特定的冷却时间覆盖（Requirement 5.3）
/// - `whitelist`: 群组特定的白名单覆盖（Requirement 5.4）
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct GroupActivation {
    /// 群组 ID
    pub group_id: String,
    /// 是否启用自动回复
    /// **Validates: Requirement 5.5**
    #[serde(default = "default_true")]
    pub enabled: bool,
    /// 是否要求 @提及
    /// **Validates: Requirements 5.1, 5.2**
    #[serde(default)]
    pub require_mention: bool,
    /// 群组特定冷却时间（秒）
    /// **Validates: Requirement 5.3**
    #[serde(default)]
    pub cooldown_seconds: Option<u64>,
    /// 群组特定白名单
    /// **Validates: Requirement 5.4**
    #[serde(default)]
    pub whitelist: Option<Vec<String>>,
}

fn default_true() -> bool {
    true
}

impl GroupActivation {
    /// 创建新的群组激活配置
    ///
    /// 默认启用自动回复，不要求 @提及。
    ///
    /// # 参数
    ///
    /// * `group_id` - 群组 ID
    ///
    /// # 示例
    ///
    /// ```rust
    /// use aster::auto_reply::GroupActivation;
    ///
    /// let activation = GroupActivation::new("group-123");
    /// assert!(activation.enabled);
    /// assert!(!activation.require_mention);
    /// assert!(activation.cooldown_seconds.is_none());
    /// assert!(activation.whitelist.is_none());
    /// ```
    pub fn new(group_id: impl Into<String>) -> Self {
        Self {
            group_id: group_id.into(),
            enabled: true,
            require_mention: false,
            cooldown_seconds: None,
            whitelist: None,
        }
    }

    /// 创建禁用的群组配置
    ///
    /// **Validates: Requirement 5.5**
    ///
    /// # 参数
    ///
    /// * `group_id` - 群组 ID
    ///
    /// # 示例
    ///
    /// ```rust
    /// use aster::auto_reply::GroupActivation;
    ///
    /// let activation = GroupActivation::disabled("group-123");
    /// assert!(!activation.enabled);
    /// ```
    pub fn disabled(group_id: impl Into<String>) -> Self {
        Self {
            group_id: group_id.into(),
            enabled: false,
            require_mention: false,
            cooldown_seconds: None,
            whitelist: None,
        }
    }

    /// 设置是否启用自动回复
    ///
    /// **Validates: Requirement 5.5**
    ///
    /// # 参数
    ///
    /// * `enabled` - 是否启用
    ///
    /// # 示例
    ///
    /// ```rust
    /// use aster::auto_reply::GroupActivation;
    ///
    /// let activation = GroupActivation::new("group-123").with_enabled(false);
    /// assert!(!activation.enabled);
    /// ```
    pub fn with_enabled(mut self, enabled: bool) -> Self {
        self.enabled = enabled;
        self
    }

    /// 设置是否要求 @提及
    ///
    /// **Validates: Requirements 5.1, 5.2**
    ///
    /// # 参数
    ///
    /// * `require_mention` - 是否要求 @提及
    ///
    /// # 示例
    ///
    /// ```rust
    /// use aster::auto_reply::GroupActivation;
    ///
    /// let activation = GroupActivation::new("group-123").with_require_mention(true);
    /// assert!(activation.require_mention);
    /// ```
    pub fn with_require_mention(mut self, require_mention: bool) -> Self {
        self.require_mention = require_mention;
        self
    }

    /// 设置群组特定冷却时间
    ///
    /// **Validates: Requirement 5.3**
    ///
    /// # 参数
    ///
    /// * `seconds` - 冷却时间（秒）
    ///
    /// # 示例
    ///
    /// ```rust
    /// use aster::auto_reply::GroupActivation;
    ///
    /// let activation = GroupActivation::new("group-123").with_cooldown(120);
    /// assert_eq!(activation.cooldown_seconds, Some(120));
    /// ```
    pub fn with_cooldown(mut self, seconds: u64) -> Self {
        self.cooldown_seconds = Some(seconds);
        self
    }

    /// 设置群组特定白名单
    ///
    /// **Validates: Requirement 5.4**
    ///
    /// # 参数
    ///
    /// * `users` - 白名单用户列表
    ///
    /// # 示例
    ///
    /// ```rust
    /// use aster::auto_reply::GroupActivation;
    ///
    /// let activation = GroupActivation::new("group-123")
    ///     .with_whitelist(vec!["user1".to_string(), "user2".to_string()]);
    /// assert!(activation.whitelist.is_some());
    /// assert_eq!(activation.whitelist.as_ref().unwrap().len(), 2);
    /// ```
    pub fn with_whitelist(mut self, users: Vec<String>) -> Self {
        self.whitelist = Some(users);
        self
    }

    /// 检查消息是否应该触发自动回复
    ///
    /// 根据群组配置检查消息是否满足触发条件。
    ///
    /// **Validates: Requirements 5.1, 5.2, 5.5**
    ///
    /// # 参数
    ///
    /// * `mentions_bot` - 消息是否 @提及了机器人
    ///
    /// # 返回值
    ///
    /// 返回 `Ok(())` 如果应该触发，否则返回 `Err(GroupRejectionReason)`。
    ///
    /// # 示例
    ///
    /// ```rust
    /// use aster::auto_reply::{GroupActivation, GroupRejectionReason};
    ///
    /// // 禁用的群组
    /// let disabled = GroupActivation::disabled("group-123");
    /// assert_eq!(disabled.should_trigger(true), Err(GroupRejectionReason::GroupDisabled));
    ///
    /// // 要求 @提及的群组
    /// let require_mention = GroupActivation::new("group-456").with_require_mention(true);
    /// assert_eq!(require_mention.should_trigger(false), Err(GroupRejectionReason::RequiresMention));
    /// assert_eq!(require_mention.should_trigger(true), Ok(()));
    /// ```
    pub fn should_trigger(&self, mentions_bot: bool) -> Result<(), GroupRejectionReason> {
        // Requirement 5.5: 检查群组是否启用
        if !self.enabled {
            return Err(GroupRejectionReason::GroupDisabled);
        }

        // Requirements 5.1, 5.2: 检查是否要求 @提及
        if self.require_mention && !mentions_bot {
            return Err(GroupRejectionReason::RequiresMention);
        }

        Ok(())
    }

    /// 检查用户是否在群组白名单中
    ///
    /// **Validates: Requirement 5.4**
    ///
    /// # 参数
    ///
    /// * `user_id` - 用户 ID
    ///
    /// # 返回值
    ///
    /// - 如果没有设置群组白名单，返回 `None`（使用全局白名单）
    /// - 如果设置了群组白名单且用户在其中，返回 `Some(true)`
    /// - 如果设置了群组白名单但用户不在其中，返回 `Some(false)`
    ///
    /// # 示例
    ///
    /// ```rust
    /// use aster::auto_reply::GroupActivation;
    ///
    /// // 没有群组白名单
    /// let no_whitelist = GroupActivation::new("group-123");
    /// assert_eq!(no_whitelist.is_user_whitelisted("any_user"), None);
    ///
    /// // 有群组白名单
    /// let with_whitelist = GroupActivation::new("group-456")
    ///     .with_whitelist(vec!["user1".to_string()]);
    /// assert_eq!(with_whitelist.is_user_whitelisted("user1"), Some(true));
    /// assert_eq!(with_whitelist.is_user_whitelisted("user2"), Some(false));
    /// ```
    pub fn is_user_whitelisted(&self, user_id: &str) -> Option<bool> {
        self.whitelist
            .as_ref()
            .map(|list| list.iter().any(|u| u == user_id))
    }

    /// 获取有效的冷却时间
    ///
    /// **Validates: Requirement 5.3**
    ///
    /// # 参数
    ///
    /// * `default_cooldown` - 默认冷却时间（秒）
    ///
    /// # 返回值
    ///
    /// 返回群组特定冷却时间，如果未设置则返回默认值。
    ///
    /// # 示例
    ///
    /// ```rust
    /// use aster::auto_reply::GroupActivation;
    ///
    /// // 没有群组冷却时间
    /// let no_cooldown = GroupActivation::new("group-123");
    /// assert_eq!(no_cooldown.effective_cooldown(60), 60);
    ///
    /// // 有群组冷却时间
    /// let with_cooldown = GroupActivation::new("group-456").with_cooldown(120);
    /// assert_eq!(with_cooldown.effective_cooldown(60), 120);
    /// ```
    pub fn effective_cooldown(&self, default_cooldown: u64) -> u64 {
        self.cooldown_seconds.unwrap_or(default_cooldown)
    }

    /// 获取群组 ID
    pub fn group_id(&self) -> &str {
        &self.group_id
    }

    /// 检查群组是否启用
    ///
    /// **Validates: Requirement 5.5**
    pub fn is_enabled(&self) -> bool {
        self.enabled
    }

    /// 检查是否要求 @提及
    ///
    /// **Validates: Requirement 5.1**
    pub fn requires_mention(&self) -> bool {
        self.require_mention
    }

    /// 检查是否有群组特定冷却时间
    ///
    /// **Validates: Requirement 5.3**
    pub fn has_custom_cooldown(&self) -> bool {
        self.cooldown_seconds.is_some()
    }

    /// 检查是否有群组特定白名单
    ///
    /// **Validates: Requirement 5.4**
    pub fn has_custom_whitelist(&self) -> bool {
        self.whitelist.is_some()
    }
}

/// 群组拒绝原因
///
/// 表示群组配置检查失败的原因。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GroupRejectionReason {
    /// 群组已禁用自动回复
    /// **Validates: Requirement 5.5**
    GroupDisabled,
    /// 群组要求 @提及
    /// **Validates: Requirements 5.1, 5.2**
    RequiresMention,
}

impl std::fmt::Display for GroupRejectionReason {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            GroupRejectionReason::GroupDisabled => write!(f, "Group has auto-reply disabled"),
            GroupRejectionReason::RequiresMention => {
                write!(f, "Group requires @mention to trigger")
            }
        }
    }
}

impl std::error::Error for GroupRejectionReason {}

/// 群组激活配置管理器
///
/// 管理多个群组的激活配置。
#[derive(Debug, Clone, Default)]
pub struct GroupActivationManager {
    /// 群组配置映射
    activations: std::collections::HashMap<String, GroupActivation>,
}

impl GroupActivationManager {
    /// 创建新的群组激活管理器
    pub fn new() -> Self {
        Self {
            activations: std::collections::HashMap::new(),
        }
    }

    /// 从配置列表创建管理器
    pub fn from_activations(activations: Vec<GroupActivation>) -> Self {
        let mut manager = Self::new();
        for activation in activations {
            manager.set(activation);
        }
        manager
    }

    /// 设置群组配置
    pub fn set(&mut self, activation: GroupActivation) {
        self.activations
            .insert(activation.group_id.clone(), activation);
    }

    /// 获取群组配置
    pub fn get(&self, group_id: &str) -> Option<&GroupActivation> {
        self.activations.get(group_id)
    }

    /// 移除群组配置
    pub fn remove(&mut self, group_id: &str) -> Option<GroupActivation> {
        self.activations.remove(group_id)
    }

    /// 获取所有群组配置
    pub fn list(&self) -> Vec<&GroupActivation> {
        self.activations.values().collect()
    }

    /// 获取群组数量
    pub fn len(&self) -> usize {
        self.activations.len()
    }

    /// 检查是否为空
    pub fn is_empty(&self) -> bool {
        self.activations.is_empty()
    }

    /// 检查群组消息是否应该触发
    ///
    /// 如果群组没有配置，默认允许触发。
    pub fn should_trigger(
        &self,
        group_id: &str,
        mentions_bot: bool,
    ) -> Result<(), GroupRejectionReason> {
        match self.get(group_id) {
            Some(activation) => activation.should_trigger(mentions_bot),
            None => Ok(()), // 未配置的群组默认允许
        }
    }

    /// 获取群组的有效冷却时间
    ///
    /// 如果群组没有配置或没有自定义冷却时间，返回默认值。
    pub fn effective_cooldown(&self, group_id: &str, default_cooldown: u64) -> u64 {
        self.get(group_id)
            .map(|a| a.effective_cooldown(default_cooldown))
            .unwrap_or(default_cooldown)
    }

    /// 检查用户是否在群组白名单中
    ///
    /// 如果群组没有配置或没有自定义白名单，返回 None。
    pub fn is_user_whitelisted(&self, group_id: &str, user_id: &str) -> Option<bool> {
        self.get(group_id)
            .and_then(|a| a.is_user_whitelisted(user_id))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ============================================================================
    // Unit Tests for GroupActivation
    // ============================================================================

    /// 测试创建新的群组配置
    #[test]
    fn test_new_group_activation() {
        let activation = GroupActivation::new("group-123");

        assert_eq!(activation.group_id, "group-123");
        assert!(activation.enabled);
        assert!(!activation.require_mention);
        assert!(activation.cooldown_seconds.is_none());
        assert!(activation.whitelist.is_none());
    }

    /// 测试创建禁用的群组配置
    /// **Validates: Requirement 5.5**
    #[test]
    fn test_disabled_group_activation() {
        let activation = GroupActivation::disabled("group-123");

        assert_eq!(activation.group_id, "group-123");
        assert!(!activation.enabled);
    }

    /// 测试 builder 模式
    #[test]
    fn test_builder_pattern() {
        let activation = GroupActivation::new("group-123")
            .with_enabled(true)
            .with_require_mention(true)
            .with_cooldown(120)
            .with_whitelist(vec!["user1".to_string(), "user2".to_string()]);

        assert!(activation.enabled);
        assert!(activation.require_mention);
        assert_eq!(activation.cooldown_seconds, Some(120));
        assert_eq!(activation.whitelist.as_ref().unwrap().len(), 2);
    }

    /// 测试 should_trigger - 禁用的群组
    /// **Validates: Requirement 5.5**
    #[test]
    fn test_should_trigger_disabled_group() {
        let activation = GroupActivation::disabled("group-123");

        // 禁用的群组应该拒绝所有触发
        assert_eq!(
            activation.should_trigger(true),
            Err(GroupRejectionReason::GroupDisabled)
        );
        assert_eq!(
            activation.should_trigger(false),
            Err(GroupRejectionReason::GroupDisabled)
        );
    }

    /// 测试 should_trigger - 要求 @提及
    /// **Validates: Requirements 5.1, 5.2**
    #[test]
    fn test_should_trigger_require_mention() {
        let activation = GroupActivation::new("group-123").with_require_mention(true);

        // 没有 @提及应该被拒绝
        assert_eq!(
            activation.should_trigger(false),
            Err(GroupRejectionReason::RequiresMention)
        );

        // 有 @提及应该允许
        assert_eq!(activation.should_trigger(true), Ok(()));
    }

    /// 测试 should_trigger - 不要求 @提及
    #[test]
    fn test_should_trigger_no_require_mention() {
        let activation = GroupActivation::new("group-123");

        // 不要求 @提及时，两种情况都应该允许
        assert_eq!(activation.should_trigger(false), Ok(()));
        assert_eq!(activation.should_trigger(true), Ok(()));
    }

    /// 测试 is_user_whitelisted - 没有白名单
    /// **Validates: Requirement 5.4**
    #[test]
    fn test_is_user_whitelisted_no_whitelist() {
        let activation = GroupActivation::new("group-123");

        // 没有白名单时返回 None
        assert_eq!(activation.is_user_whitelisted("any_user"), None);
    }

    /// 测试 is_user_whitelisted - 有白名单
    /// **Validates: Requirement 5.4**
    #[test]
    fn test_is_user_whitelisted_with_whitelist() {
        let activation = GroupActivation::new("group-123")
            .with_whitelist(vec!["user1".to_string(), "user2".to_string()]);

        // 白名单中的用户
        assert_eq!(activation.is_user_whitelisted("user1"), Some(true));
        assert_eq!(activation.is_user_whitelisted("user2"), Some(true));

        // 不在白名单中的用户
        assert_eq!(activation.is_user_whitelisted("user3"), Some(false));
    }

    /// 测试 effective_cooldown
    /// **Validates: Requirement 5.3**
    #[test]
    fn test_effective_cooldown() {
        // 没有自定义冷却时间
        let no_cooldown = GroupActivation::new("group-123");
        assert_eq!(no_cooldown.effective_cooldown(60), 60);

        // 有自定义冷却时间
        let with_cooldown = GroupActivation::new("group-456").with_cooldown(120);
        assert_eq!(with_cooldown.effective_cooldown(60), 120);
    }

    /// 测试辅助方法
    #[test]
    fn test_helper_methods() {
        let activation = GroupActivation::new("group-123")
            .with_require_mention(true)
            .with_cooldown(120)
            .with_whitelist(vec!["user1".to_string()]);

        assert_eq!(activation.group_id(), "group-123");
        assert!(activation.is_enabled());
        assert!(activation.requires_mention());
        assert!(activation.has_custom_cooldown());
        assert!(activation.has_custom_whitelist());
    }

    /// 测试序列化和反序列化
    #[test]
    fn test_serialization_roundtrip() {
        let activation = GroupActivation::new("group-123")
            .with_require_mention(true)
            .with_cooldown(120)
            .with_whitelist(vec!["user1".to_string()]);

        let json = serde_json::to_string(&activation).unwrap();
        let parsed: GroupActivation = serde_json::from_str(&json).unwrap();

        assert_eq!(activation, parsed);
    }

    /// 测试默认值反序列化
    #[test]
    fn test_deserialization_defaults() {
        let json = r#"{"group_id": "group-123"}"#;
        let activation: GroupActivation = serde_json::from_str(json).unwrap();

        assert_eq!(activation.group_id, "group-123");
        assert!(activation.enabled); // 默认 true
        assert!(!activation.require_mention); // 默认 false
        assert!(activation.cooldown_seconds.is_none());
        assert!(activation.whitelist.is_none());
    }

    // ============================================================================
    // Unit Tests for GroupRejectionReason
    // ============================================================================

    #[test]
    fn test_rejection_reason_display() {
        assert_eq!(
            GroupRejectionReason::GroupDisabled.to_string(),
            "Group has auto-reply disabled"
        );
        assert_eq!(
            GroupRejectionReason::RequiresMention.to_string(),
            "Group requires @mention to trigger"
        );
    }

    // ============================================================================
    // Unit Tests for GroupActivationManager
    // ============================================================================

    #[test]
    fn test_manager_new() {
        let manager = GroupActivationManager::new();
        assert!(manager.is_empty());
        assert_eq!(manager.len(), 0);
    }

    #[test]
    fn test_manager_from_activations() {
        let activations = vec![
            GroupActivation::new("group-1"),
            GroupActivation::new("group-2"),
        ];
        let manager = GroupActivationManager::from_activations(activations);

        assert_eq!(manager.len(), 2);
        assert!(manager.get("group-1").is_some());
        assert!(manager.get("group-2").is_some());
    }

    #[test]
    fn test_manager_set_and_get() {
        let mut manager = GroupActivationManager::new();

        manager.set(GroupActivation::new("group-123").with_require_mention(true));

        let activation = manager.get("group-123").unwrap();
        assert!(activation.require_mention);
    }

    #[test]
    fn test_manager_remove() {
        let mut manager = GroupActivationManager::new();
        manager.set(GroupActivation::new("group-123"));

        let removed = manager.remove("group-123");
        assert!(removed.is_some());
        assert!(manager.get("group-123").is_none());
    }

    #[test]
    fn test_manager_should_trigger() {
        let mut manager = GroupActivationManager::new();
        manager.set(GroupActivation::disabled("disabled-group"));
        manager.set(GroupActivation::new("mention-group").with_require_mention(true));

        // 禁用的群组
        assert_eq!(
            manager.should_trigger("disabled-group", true),
            Err(GroupRejectionReason::GroupDisabled)
        );

        // 要求 @提及的群组
        assert_eq!(
            manager.should_trigger("mention-group", false),
            Err(GroupRejectionReason::RequiresMention)
        );
        assert_eq!(manager.should_trigger("mention-group", true), Ok(()));

        // 未配置的群组默认允许
        assert_eq!(manager.should_trigger("unknown-group", false), Ok(()));
    }

    #[test]
    fn test_manager_effective_cooldown() {
        let mut manager = GroupActivationManager::new();
        manager.set(GroupActivation::new("group-123").with_cooldown(120));

        // 有自定义冷却时间的群组
        assert_eq!(manager.effective_cooldown("group-123", 60), 120);

        // 未配置的群组使用默认值
        assert_eq!(manager.effective_cooldown("unknown-group", 60), 60);
    }

    #[test]
    fn test_manager_is_user_whitelisted() {
        let mut manager = GroupActivationManager::new();
        manager.set(GroupActivation::new("group-123").with_whitelist(vec!["user1".to_string()]));

        // 有白名单的群组
        assert_eq!(
            manager.is_user_whitelisted("group-123", "user1"),
            Some(true)
        );
        assert_eq!(
            manager.is_user_whitelisted("group-123", "user2"),
            Some(false)
        );

        // 未配置的群组
        assert_eq!(
            manager.is_user_whitelisted("unknown-group", "any_user"),
            None
        );
    }
}
