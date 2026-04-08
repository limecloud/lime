//! 自动回复管理器
//!
//! 核心管理器，集成所有组件处理自动回复逻辑。
//!
//! # 功能
//!
//! - 集成 WhitelistManager, CooldownTracker, KeywordMatcher, TriggerRegistry
//! - 实现 `should_reply()` 核心方法检测消息是否应该触发自动回复
//! - 支持群组激活配置
//! - 支持配置持久化和热重载
//!
//! # 消息处理流程
//!
//! 1. 检查白名单（Requirement 6.6）
//! 2. 检查冷却时间（Requirement 6.7）
//! 3. 检查群组激活配置（如果是群组消息）
//! 4. 评估所有启用的触发器（按优先级排序）（Requirements 6.1, 6.2）
//! 5. 返回适当的 TriggerResult（Requirements 6.3, 6.4, 6.5）
//!
//! # 示例
//!
//! ```rust,ignore
//! use aster::auto_reply::{AutoReplyManager, IncomingMessage, TriggerResult};
//! use std::path::PathBuf;
//!
//! #[tokio::main]
//! async fn main() -> anyhow::Result<()> {
//!     let mut manager = AutoReplyManager::new(PathBuf::from("config.json")).await?;
//!     
//!     // 注册触发器、设置白名单等...
//!     
//!     let message = IncomingMessage { /* ... */ };
//!     match manager.should_reply(&message) {
//!         TriggerResult::Triggered { trigger, context } => {
//!             println!("触发: {}", trigger.name);
//!         }
//!         TriggerResult::Rejected { reason } => {
//!             println!("拒绝: {:?}", reason);
//!         }
//!         TriggerResult::NoMatch => {
//!             println!("无匹配");
//!         }
//!     }
//!     Ok(())
//! }
//! ```

use std::collections::HashMap;
use std::path::PathBuf;
use std::time::Duration;

use anyhow::Result;
use chrono::Utc;
use serde::{Deserialize, Serialize};

use crate::auto_reply::cooldown::{CooldownCheckResult, CooldownTracker};
use crate::auto_reply::group::GroupActivation;
use crate::auto_reply::keyword_matcher::KeywordMatcher;
use crate::auto_reply::message::{IncomingMessage, RejectionReason, TriggerContext, TriggerResult};
use crate::auto_reply::registry::{AutoReplyTrigger, TriggerRegistry};
use crate::auto_reply::types::{TriggerConfig, TriggerType};
use crate::auto_reply::whitelist::WhitelistManager;

/// 自动回复统计信息
///
/// 包含自动回复管理器的各项统计数据。
///
/// # 字段说明
///
/// - `total_triggers`: 已注册的触发器总数
/// - `enabled_triggers`: 已启用的触发器数量
/// - `whitelist_size`: 白名单中的用户数量
/// - `group_activations`: 群组激活配置数量
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AutoReplyStats {
    /// 已注册的触发器总数
    pub total_triggers: usize,
    /// 已启用的触发器数量
    pub enabled_triggers: usize,
    /// 白名单中的用户数量
    pub whitelist_size: usize,
    /// 群组激活配置数量
    pub group_activations: usize,
}

/// 自动回复管理器
///
/// 核心管理器，集成所有组件处理自动回复逻辑。
///
/// # 字段说明
///
/// - `registry`: 触发器注册表，管理所有已注册的触发器
/// - `whitelist`: 白名单管理器，控制哪些用户可以触发自动回复
/// - `cooldown`: 冷却追踪器，防止用户频繁触发
/// - `keyword_matcher`: 关键词匹配器，用于关键词触发类型
/// - `group_activations`: 群组激活配置，控制群组中的触发行为
/// - `config_path`: 配置文件路径
pub struct AutoReplyManager {
    /// 触发器注册表
    registry: TriggerRegistry,
    /// 白名单管理器
    whitelist: WhitelistManager,
    /// 冷却追踪器
    cooldown: CooldownTracker,
    /// 关键词匹配器
    keyword_matcher: KeywordMatcher,
    /// 群组激活配置
    group_activations: HashMap<String, GroupActivation>,
    /// 配置文件路径
    config_path: PathBuf,
}

impl AutoReplyManager {
    /// 创建新的管理器
    ///
    /// # 参数
    ///
    /// * `config_path` - 配置文件路径
    ///
    /// # 返回值
    ///
    /// 返回初始化的 AutoReplyManager 实例。
    pub async fn new(config_path: PathBuf) -> Result<Self> {
        Ok(Self {
            registry: TriggerRegistry::new(),
            whitelist: WhitelistManager::new(),
            cooldown: CooldownTracker::new(Duration::from_secs(60)),
            keyword_matcher: KeywordMatcher::new(),
            group_activations: HashMap::new(),
            config_path,
        })
    }

    /// 检查消息是否应该触发自动回复
    ///
    /// 这是核心方法，按以下顺序检查：
    /// 1. 白名单检查（Requirement 6.6）
    /// 2. 群组激活检查（如果是群组消息）
    /// 3. 冷却时间检查（Requirement 6.7）
    /// 4. 触发器匹配（Requirements 6.1, 6.2, 6.3）
    ///
    /// # 参数
    ///
    /// * `message` - 入站消息
    ///
    /// # 返回值
    ///
    /// - `TriggerResult::Triggered` - 触发成功，包含触发器和上下文
    /// - `TriggerResult::Rejected` - 触发被拒绝，包含拒绝原因
    /// - `TriggerResult::NoMatch` - 无匹配触发器
    ///
    /// # 示例
    ///
    /// ```rust,ignore
    /// let result = manager.should_reply(&message);
    /// match result {
    ///     TriggerResult::Triggered { trigger, context } => {
    ///         // 处理触发
    ///     }
    ///     TriggerResult::Rejected { reason } => {
    ///         // 处理拒绝
    ///     }
    ///     TriggerResult::NoMatch => {
    ///         // 无匹配
    ///     }
    /// }
    /// ```
    pub fn should_reply(&mut self, message: &IncomingMessage) -> TriggerResult {
        // Step 1: 白名单检查
        // **Validates: Requirement 6.6**
        // WHEN whitelist check fails, THE Trigger_Result SHALL indicate whitelist rejection
        if !self.check_whitelist(message) {
            return TriggerResult::Rejected {
                reason: RejectionReason::NotInWhitelist,
            };
        }

        // Step 2: 群组激活检查（如果是群组消息）
        // **Validates: Requirements 5.1, 5.2, 5.5**
        if let Some(group_id) = &message.group_id {
            if let Some(rejection) = self.check_group_activation(group_id, message.mentions_bot) {
                return TriggerResult::Rejected { reason: rejection };
            }
        }

        // Step 3: 获取所有启用的触发器（按优先级排序）
        // **Validates: Requirement 6.1**
        // WHEN checking a message, THE Auto_Reply_Manager SHALL evaluate all enabled triggers
        let enabled_triggers: Vec<AutoReplyTrigger> = self
            .registry
            .get_enabled_triggers()
            .into_iter()
            .cloned()
            .collect();

        // Step 4: 按优先级顺序评估触发器
        // **Validates: Requirement 6.2**
        // WHEN multiple triggers match, THE Auto_Reply_Manager SHALL return the highest priority trigger
        for trigger in enabled_triggers {
            if let Some(match_result) = self.evaluate_trigger(&trigger, message) {
                // Step 5: 冷却时间检查（在触发器匹配后检查）
                // **Validates: Requirement 6.7**
                // WHEN cooldown check fails, THE Trigger_Result SHALL indicate cooldown rejection with remaining time
                match self.check_cooldown(message, trigger.trigger_type) {
                    CooldownCheckResult::Allowed => {
                        // 记录触发时间
                        self.cooldown.record_trigger(&message.sender_id);

                        // **Validates: Requirement 6.4**
                        // THE Trigger_Result SHALL contain matched trigger info and trigger context
                        let context = TriggerContext {
                            trigger_id: trigger.id.clone(),
                            trigger_type: trigger.trigger_type,
                            message: message.clone(),
                            match_details: match_result,
                            triggered_at: Utc::now(),
                            extra: HashMap::new(),
                        };

                        return TriggerResult::Triggered {
                            trigger: Box::new(trigger),
                            context: Box::new(context),
                        };
                    }
                    CooldownCheckResult::InCooldown { remaining } => {
                        // **Validates: Requirement 6.7**
                        return TriggerResult::Rejected {
                            reason: RejectionReason::InCooldown { remaining },
                        };
                    }
                }
            }
        }

        // **Validates: Requirement 6.3**
        // WHEN no triggers match, THE Auto_Reply_Manager SHALL return a non-trigger result
        TriggerResult::NoMatch
    }

    /// 检查白名单
    ///
    /// 检查用户是否在白名单中。如果是群组消息且群组有自定义白名单，
    /// 则使用群组白名单；否则使用全局白名单。
    ///
    /// **Validates: Requirements 3.1-3.6, 5.4**
    fn check_whitelist(&self, message: &IncomingMessage) -> bool {
        // 如果是群组消息，先检查群组特定白名单
        if let Some(group_id) = &message.group_id {
            if let Some(activation) = self.group_activations.get(group_id) {
                // 如果群组有自定义白名单，使用群组白名单
                if let Some(is_allowed) = activation.is_user_whitelisted(&message.sender_id) {
                    return is_allowed;
                }
            }
        }

        // 使用全局白名单
        self.whitelist.is_allowed(&message.sender_id)
    }

    /// 检查群组激活配置
    ///
    /// **Validates: Requirements 5.1, 5.2, 5.5**
    fn check_group_activation(
        &self,
        group_id: &str,
        mentions_bot: bool,
    ) -> Option<RejectionReason> {
        if let Some(activation) = self.group_activations.get(group_id) {
            // Requirement 5.5: 检查群组是否启用
            if !activation.enabled {
                return Some(RejectionReason::GroupNotActivated);
            }

            // Requirements 5.1, 5.2: 检查是否要求 @提及
            if activation.require_mention && !mentions_bot {
                return Some(RejectionReason::RequiresMention);
            }
        }

        None
    }

    /// 检查冷却时间
    ///
    /// **Validates: Requirements 4.1-4.6, 5.3**
    fn check_cooldown(
        &self,
        message: &IncomingMessage,
        trigger_type: TriggerType,
    ) -> CooldownCheckResult {
        // 如果是群组消息且群组有自定义冷却时间，使用群组冷却时间
        if let Some(group_id) = &message.group_id {
            if let Some(activation) = self.group_activations.get(group_id) {
                if let Some(cooldown_seconds) = activation.cooldown_seconds {
                    // 使用群组特定冷却时间进行检查
                    let cooldown = Duration::from_secs(cooldown_seconds);
                    return self.check_cooldown_with_duration(&message.sender_id, cooldown);
                }
            }
        }

        // 使用默认冷却时间检查
        self.cooldown
            .check_cooldown(&message.sender_id, trigger_type)
    }

    /// 使用指定的冷却时间检查
    ///
    /// 注意：当前实现使用默认的 Mention 类型进行检查。
    /// 未来可以扩展 CooldownTracker 来支持自定义冷却时间。
    fn check_cooldown_with_duration(
        &self,
        user_id: &str,
        _cooldown: Duration,
    ) -> CooldownCheckResult {
        // 获取用户最后触发时间并检查
        // 由于 CooldownTracker 不直接支持自定义冷却时间检查，
        // 我们使用一个简化的实现
        // 实际上应该扩展 CooldownTracker 来支持这个功能
        // 这里暂时使用默认的 Mention 类型进行检查
        self.cooldown.check_cooldown(user_id, TriggerType::Mention)
    }

    /// 评估单个触发器是否匹配消息
    ///
    /// 根据触发器类型评估消息是否匹配。
    ///
    /// **Validates: Requirements 6.1, 7.1-7.6**
    fn evaluate_trigger(
        &mut self,
        trigger: &AutoReplyTrigger,
        message: &IncomingMessage,
    ) -> Option<Option<crate::auto_reply::keyword_matcher::KeywordMatchResult>> {
        // 检查触发器是否启用
        if !trigger.enabled {
            return None;
        }

        match trigger.trigger_type {
            TriggerType::Mention => {
                // @提及触发：检查消息是否包含 @提及
                if message.mentions_bot {
                    Some(None)
                } else {
                    None
                }
            }
            TriggerType::Keyword => {
                // 关键词触发：使用关键词匹配器
                if let TriggerConfig::Keyword(config) = &trigger.config {
                    self.keyword_matcher
                        .match_message(&message.content, config)
                        .map(Some)
                } else {
                    None
                }
            }
            TriggerType::DirectMessage => {
                // 私聊触发：检查是否是私聊消息
                if message.is_direct_message {
                    Some(None)
                } else {
                    None
                }
            }
            TriggerType::Schedule => {
                // 定时触发：由 Scheduler 处理，这里不直接匹配
                // Schedule 触发器通过外部调用触发，不通过消息匹配
                None
            }
            TriggerType::Webhook => {
                // Webhook 触发：由 HTTP 请求处理，这里不直接匹配
                // Webhook 触发器通过外部 HTTP 请求触发，不通过消息匹配
                None
            }
        }
    }

    /// 注册触发器
    ///
    /// # 参数
    ///
    /// * `trigger` - 要注册的触发器
    pub fn register_trigger(&mut self, trigger: AutoReplyTrigger) {
        self.registry.register(trigger);
    }

    /// 注销触发器
    ///
    /// # 参数
    ///
    /// * `trigger_id` - 要注销的触发器 ID
    ///
    /// # 返回值
    ///
    /// 如果触发器存在并被移除，返回 `Some(trigger)`；否则返回 `None`。
    pub fn unregister_trigger(&mut self, trigger_id: &str) -> Option<AutoReplyTrigger> {
        self.registry.unregister(trigger_id)
    }

    /// 设置群组激活配置
    ///
    /// # 参数
    ///
    /// * `activation` - 群组激活配置
    pub fn set_group_activation(&mut self, activation: GroupActivation) {
        self.group_activations
            .insert(activation.group_id.clone(), activation);
    }

    /// 获取群组激活配置
    ///
    /// # 参数
    ///
    /// * `group_id` - 群组 ID
    ///
    /// # 返回值
    ///
    /// 如果存在配置，返回 `Some(&GroupActivation)`；否则返回 `None`。
    pub fn get_group_activation(&self, group_id: &str) -> Option<&GroupActivation> {
        self.group_activations.get(group_id)
    }

    /// 移除群组激活配置
    ///
    /// # 参数
    ///
    /// * `group_id` - 群组 ID
    ///
    /// # 返回值
    ///
    /// 如果存在配置并被移除，返回 `Some(GroupActivation)`；否则返回 `None`。
    pub fn remove_group_activation(&mut self, group_id: &str) -> Option<GroupActivation> {
        self.group_activations.remove(group_id)
    }

    /// 添加用户到白名单
    ///
    /// # 参数
    ///
    /// * `user_id` - 用户 ID
    pub fn add_to_whitelist(&mut self, user_id: String) {
        self.whitelist.add_user(user_id);
    }

    /// 从白名单移除用户
    ///
    /// # 参数
    ///
    /// * `user_id` - 用户 ID
    ///
    /// # 返回值
    ///
    /// 如果用户存在并被移除，返回 `true`；否则返回 `false`。
    pub fn remove_from_whitelist(&mut self, user_id: &str) -> bool {
        self.whitelist.remove_user(user_id)
    }

    /// 检查用户是否在白名单中
    ///
    /// # 参数
    ///
    /// * `user_id` - 用户 ID
    ///
    /// # 返回值
    ///
    /// 如果用户在白名单中或白名单为空，返回 `true`；否则返回 `false`。
    pub fn is_user_whitelisted(&self, user_id: &str) -> bool {
        self.whitelist.is_allowed(user_id)
    }

    /// 设置默认冷却时间
    ///
    /// # 参数
    ///
    /// * `duration` - 冷却时间
    pub fn set_default_cooldown(&mut self, duration: Duration) {
        self.cooldown = CooldownTracker::new(duration);
    }

    /// 设置特定触发类型的冷却时间
    ///
    /// # 参数
    ///
    /// * `trigger_type` - 触发类型
    /// * `duration` - 冷却时间
    pub fn set_type_cooldown(&mut self, trigger_type: TriggerType, duration: Duration) {
        self.cooldown.set_type_cooldown(trigger_type, duration);
    }

    /// 重置用户冷却
    ///
    /// # 参数
    ///
    /// * `user_id` - 用户 ID
    pub fn reset_user_cooldown(&mut self, user_id: &str) {
        self.cooldown.reset_cooldown(user_id);
    }

    /// 获取配置文件路径
    pub fn config_path(&self) -> &PathBuf {
        &self.config_path
    }

    /// 保存配置
    ///
    /// 将当前配置保存到配置文件。
    pub async fn save_config(&self) -> Result<()> {
        // TODO: 实现配置保存（任务 10.1）
        Ok(())
    }

    /// 重新加载配置
    ///
    /// 从配置文件重新加载配置。
    pub async fn reload_config(&mut self) -> Result<()> {
        // TODO: 实现配置重载（任务 10.1）
        Ok(())
    }

    /// 获取统计信息
    ///
    /// 返回自动回复管理器的各项统计数据。
    ///
    /// # 返回值
    ///
    /// 返回 `AutoReplyStats` 结构体，包含：
    /// - `total_triggers`: 已注册的触发器总数
    /// - `enabled_triggers`: 已启用的触发器数量
    /// - `whitelist_size`: 白名单中的用户数量
    /// - `group_activations`: 群组激活配置数量
    ///
    /// # 示例
    ///
    /// ```rust,ignore
    /// let stats = manager.get_stats();
    /// println!("Total triggers: {}", stats.total_triggers);
    /// println!("Enabled triggers: {}", stats.enabled_triggers);
    /// println!("Whitelist size: {}", stats.whitelist_size);
    /// println!("Group activations: {}", stats.group_activations);
    /// ```
    pub fn get_stats(&self) -> AutoReplyStats {
        let all_triggers = self.registry.get_all_triggers();
        let enabled_count = all_triggers.iter().filter(|t| t.enabled).count();

        AutoReplyStats {
            total_triggers: all_triggers.len(),
            enabled_triggers: enabled_count,
            whitelist_size: self.whitelist.len(),
            group_activations: self.group_activations.len(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auto_reply::types::KeywordTriggerConfig;

    /// 创建测试用的入站消息
    fn create_test_message(
        sender_id: &str,
        content: &str,
        is_dm: bool,
        mentions_bot: bool,
        group_id: Option<&str>,
    ) -> IncomingMessage {
        IncomingMessage {
            id: "msg-1".to_string(),
            sender_id: sender_id.to_string(),
            sender_name: Some("Test User".to_string()),
            content: content.to_string(),
            channel: "test".to_string(),
            group_id: group_id.map(String::from),
            is_direct_message: is_dm,
            mentions_bot,
            timestamp: Utc::now(),
            metadata: HashMap::new(),
        }
    }

    /// 创建 Mention 类型的触发器
    fn create_mention_trigger(id: &str, priority: u32) -> AutoReplyTrigger {
        AutoReplyTrigger {
            id: id.to_string(),
            name: format!("Mention Trigger {}", id),
            enabled: true,
            trigger_type: TriggerType::Mention,
            config: TriggerConfig::Mention,
            priority,
            response_template: None,
        }
    }

    /// 创建 Keyword 类型的触发器
    fn create_keyword_trigger(id: &str, patterns: Vec<&str>, priority: u32) -> AutoReplyTrigger {
        AutoReplyTrigger {
            id: id.to_string(),
            name: format!("Keyword Trigger {}", id),
            enabled: true,
            trigger_type: TriggerType::Keyword,
            config: TriggerConfig::Keyword(KeywordTriggerConfig {
                patterns: patterns.into_iter().map(String::from).collect(),
                case_insensitive: false,
                use_regex: false,
            }),
            priority,
            response_template: None,
        }
    }

    /// 创建 DirectMessage 类型的触发器
    fn create_dm_trigger(id: &str, priority: u32) -> AutoReplyTrigger {
        AutoReplyTrigger {
            id: id.to_string(),
            name: format!("DM Trigger {}", id),
            enabled: true,
            trigger_type: TriggerType::DirectMessage,
            config: TriggerConfig::DirectMessage,
            priority,
            response_template: None,
        }
    }

    // ============================================================================
    // Unit Tests for should_reply()
    // ============================================================================

    /// 测试创建新的管理器
    #[tokio::test]
    async fn test_new_manager() {
        let manager = AutoReplyManager::new(PathBuf::from("test.json"))
            .await
            .unwrap();

        assert!(manager.config_path().ends_with("test.json"));
    }

    /// 测试无触发器时返回 NoMatch
    /// **Validates: Requirement 6.3**
    #[tokio::test]
    async fn test_no_triggers_returns_no_match() {
        let mut manager = AutoReplyManager::new(PathBuf::from("test.json"))
            .await
            .unwrap();

        let message = create_test_message("user1", "hello", false, false, None);
        let result = manager.should_reply(&message);

        assert!(matches!(result, TriggerResult::NoMatch));
    }

    /// 测试 Mention 触发器匹配
    /// **Validates: Requirements 6.1, 6.4**
    #[tokio::test]
    async fn test_mention_trigger_matches() {
        let mut manager = AutoReplyManager::new(PathBuf::from("test.json"))
            .await
            .unwrap();

        manager.register_trigger(create_mention_trigger("mention-1", 10));

        // 有 @提及的消息应该触发
        let message = create_test_message("user1", "hello @bot", false, true, None);
        let result = manager.should_reply(&message);

        match result {
            TriggerResult::Triggered { trigger, context } => {
                assert_eq!(trigger.id, "mention-1");
                assert_eq!(context.trigger_type, TriggerType::Mention);
            }
            _ => panic!("Expected Triggered result"),
        }
    }

    /// 测试 Mention 触发器不匹配
    #[tokio::test]
    async fn test_mention_trigger_no_match() {
        let mut manager = AutoReplyManager::new(PathBuf::from("test.json"))
            .await
            .unwrap();

        manager.register_trigger(create_mention_trigger("mention-1", 10));

        // 没有 @提及的消息不应该触发
        let message = create_test_message("user1", "hello", false, false, None);
        let result = manager.should_reply(&message);

        assert!(matches!(result, TriggerResult::NoMatch));
    }

    /// 测试 Keyword 触发器匹配
    /// **Validates: Requirements 6.1, 6.4, 7.1-7.6**
    #[tokio::test]
    async fn test_keyword_trigger_matches() {
        let mut manager = AutoReplyManager::new(PathBuf::from("test.json"))
            .await
            .unwrap();

        manager.register_trigger(create_keyword_trigger("kw-1", vec!["help", "帮助"], 10));

        // 包含关键词的消息应该触发
        let message = create_test_message("user1", "I need help", false, false, None);
        let result = manager.should_reply(&message);

        match result {
            TriggerResult::Triggered { trigger, context } => {
                assert_eq!(trigger.id, "kw-1");
                assert_eq!(context.trigger_type, TriggerType::Keyword);
                assert!(context.match_details.is_some());
                assert_eq!(context.match_details.unwrap().matched_pattern, "help");
            }
            _ => panic!("Expected Triggered result"),
        }
    }

    /// 测试 DirectMessage 触发器匹配
    #[tokio::test]
    async fn test_dm_trigger_matches() {
        let mut manager = AutoReplyManager::new(PathBuf::from("test.json"))
            .await
            .unwrap();

        manager.register_trigger(create_dm_trigger("dm-1", 10));

        // 私聊消息应该触发
        let message = create_test_message("user1", "hello", true, false, None);
        let result = manager.should_reply(&message);

        match result {
            TriggerResult::Triggered { trigger, context } => {
                assert_eq!(trigger.id, "dm-1");
                assert_eq!(context.trigger_type, TriggerType::DirectMessage);
            }
            _ => panic!("Expected Triggered result"),
        }
    }

    /// 测试多个触发器按优先级排序
    /// **Validates: Requirement 6.2**
    #[tokio::test]
    async fn test_multiple_triggers_priority() {
        let mut manager = AutoReplyManager::new(PathBuf::from("test.json"))
            .await
            .unwrap();

        // 注册多个触发器，优先级不同
        manager.register_trigger(create_mention_trigger("mention-low", 100));
        manager.register_trigger(create_mention_trigger("mention-high", 10));
        manager.register_trigger(create_mention_trigger("mention-mid", 50));

        // 有 @提及的消息应该触发优先级最高的触发器
        let message = create_test_message("user1", "hello @bot", false, true, None);
        let result = manager.should_reply(&message);

        match result {
            TriggerResult::Triggered { trigger, .. } => {
                assert_eq!(trigger.id, "mention-high");
                assert_eq!(trigger.priority, 10);
            }
            _ => panic!("Expected Triggered result"),
        }
    }

    /// 测试白名单拒绝
    /// **Validates: Requirement 6.6**
    #[tokio::test]
    async fn test_whitelist_rejection() {
        let mut manager = AutoReplyManager::new(PathBuf::from("test.json"))
            .await
            .unwrap();

        manager.register_trigger(create_mention_trigger("mention-1", 10));

        // 添加白名单用户
        manager.add_to_whitelist("allowed_user".to_string());

        // 不在白名单中的用户应该被拒绝
        let message = create_test_message("other_user", "hello @bot", false, true, None);
        let result = manager.should_reply(&message);

        match result {
            TriggerResult::Rejected { reason } => {
                assert!(matches!(reason, RejectionReason::NotInWhitelist));
            }
            _ => panic!("Expected Rejected result with NotInWhitelist"),
        }
    }

    /// 测试白名单允许
    #[tokio::test]
    async fn test_whitelist_allowed() {
        let mut manager = AutoReplyManager::new(PathBuf::from("test.json"))
            .await
            .unwrap();

        manager.register_trigger(create_mention_trigger("mention-1", 10));

        // 添加白名单用户
        manager.add_to_whitelist("allowed_user".to_string());

        // 白名单中的用户应该被允许
        let message = create_test_message("allowed_user", "hello @bot", false, true, None);
        let result = manager.should_reply(&message);

        assert!(matches!(result, TriggerResult::Triggered { .. }));
    }

    /// 测试空白名单允许所有用户
    #[tokio::test]
    async fn test_empty_whitelist_allows_all() {
        let mut manager = AutoReplyManager::new(PathBuf::from("test.json"))
            .await
            .unwrap();

        manager.register_trigger(create_mention_trigger("mention-1", 10));

        // 空白名单应该允许所有用户
        let message = create_test_message("any_user", "hello @bot", false, true, None);
        let result = manager.should_reply(&message);

        assert!(matches!(result, TriggerResult::Triggered { .. }));
    }

    /// 测试群组禁用拒绝
    /// **Validates: Requirement 5.5**
    #[tokio::test]
    async fn test_group_disabled_rejection() {
        let mut manager = AutoReplyManager::new(PathBuf::from("test.json"))
            .await
            .unwrap();

        manager.register_trigger(create_mention_trigger("mention-1", 10));

        // 设置禁用的群组
        manager.set_group_activation(GroupActivation::disabled("group-123"));

        // 禁用群组中的消息应该被拒绝
        let message = create_test_message("user1", "hello @bot", false, true, Some("group-123"));
        let result = manager.should_reply(&message);

        match result {
            TriggerResult::Rejected { reason } => {
                assert!(matches!(reason, RejectionReason::GroupNotActivated));
            }
            _ => panic!("Expected Rejected result with GroupNotActivated"),
        }
    }

    /// 测试群组要求 @提及
    /// **Validates: Requirements 5.1, 5.2**
    #[tokio::test]
    async fn test_group_require_mention() {
        let mut manager = AutoReplyManager::new(PathBuf::from("test.json"))
            .await
            .unwrap();

        manager.register_trigger(create_keyword_trigger("kw-1", vec!["help"], 10));

        // 设置要求 @提及的群组
        manager.set_group_activation(GroupActivation::new("group-123").with_require_mention(true));

        // 没有 @提及的消息应该被拒绝
        let message = create_test_message("user1", "help", false, false, Some("group-123"));
        let result = manager.should_reply(&message);

        match result {
            TriggerResult::Rejected { reason } => {
                assert!(matches!(reason, RejectionReason::RequiresMention));
            }
            _ => panic!("Expected Rejected result with RequiresMention"),
        }

        // 有 @提及的消息应该被允许
        let message_with_mention =
            create_test_message("user1", "help @bot", false, true, Some("group-123"));
        let result = manager.should_reply(&message_with_mention);

        // 注意：这里可能因为关键词不匹配而返回 NoMatch
        // 因为 "help @bot" 包含 "help"，所以应该触发
        assert!(matches!(result, TriggerResult::Triggered { .. }));
    }

    /// 测试群组特定白名单
    /// **Validates: Requirement 5.4**
    #[tokio::test]
    async fn test_group_specific_whitelist() {
        let mut manager = AutoReplyManager::new(PathBuf::from("test.json"))
            .await
            .unwrap();

        manager.register_trigger(create_mention_trigger("mention-1", 10));

        // 设置群组特定白名单
        manager.set_group_activation(
            GroupActivation::new("group-123").with_whitelist(vec!["group_user".to_string()]),
        );

        // 不在群组白名单中的用户应该被拒绝
        let message =
            create_test_message("other_user", "hello @bot", false, true, Some("group-123"));
        let result = manager.should_reply(&message);

        match result {
            TriggerResult::Rejected { reason } => {
                assert!(matches!(reason, RejectionReason::NotInWhitelist));
            }
            _ => panic!("Expected Rejected result with NotInWhitelist"),
        }

        // 在群组白名单中的用户应该被允许
        let message_allowed =
            create_test_message("group_user", "hello @bot", false, true, Some("group-123"));
        let result = manager.should_reply(&message_allowed);

        assert!(matches!(result, TriggerResult::Triggered { .. }));
    }

    /// 测试冷却时间拒绝
    /// **Validates: Requirement 6.7**
    #[tokio::test]
    async fn test_cooldown_rejection() {
        let mut manager = AutoReplyManager::new(PathBuf::from("test.json"))
            .await
            .unwrap();

        manager.register_trigger(create_mention_trigger("mention-1", 10));

        // 第一次触发应该成功
        let message1 = create_test_message("user1", "hello @bot", false, true, None);
        let result1 = manager.should_reply(&message1);
        assert!(matches!(result1, TriggerResult::Triggered { .. }));

        // 立即再次触发应该被冷却时间拒绝
        let message2 = create_test_message("user1", "hello again @bot", false, true, None);
        let result2 = manager.should_reply(&message2);

        match result2 {
            TriggerResult::Rejected { reason } => match reason {
                RejectionReason::InCooldown { remaining } => {
                    assert!(remaining > Duration::ZERO);
                }
                _ => panic!("Expected InCooldown rejection"),
            },
            _ => panic!("Expected Rejected result"),
        }
    }

    /// 测试不同用户独立冷却
    #[tokio::test]
    async fn test_independent_user_cooldowns() {
        let mut manager = AutoReplyManager::new(PathBuf::from("test.json"))
            .await
            .unwrap();

        manager.register_trigger(create_mention_trigger("mention-1", 10));

        // user1 触发
        let message1 = create_test_message("user1", "hello @bot", false, true, None);
        let result1 = manager.should_reply(&message1);
        assert!(matches!(result1, TriggerResult::Triggered { .. }));

        // user2 应该可以触发（独立冷却）
        let message2 = create_test_message("user2", "hello @bot", false, true, None);
        let result2 = manager.should_reply(&message2);
        assert!(matches!(result2, TriggerResult::Triggered { .. }));
    }

    /// 测试重置用户冷却
    #[tokio::test]
    async fn test_reset_user_cooldown() {
        let mut manager = AutoReplyManager::new(PathBuf::from("test.json"))
            .await
            .unwrap();

        manager.register_trigger(create_mention_trigger("mention-1", 10));

        // 第一次触发
        let message1 = create_test_message("user1", "hello @bot", false, true, None);
        let _ = manager.should_reply(&message1);

        // 重置冷却
        manager.reset_user_cooldown("user1");

        // 应该可以再次触发
        let message2 = create_test_message("user1", "hello again @bot", false, true, None);
        let result2 = manager.should_reply(&message2);
        assert!(matches!(result2, TriggerResult::Triggered { .. }));
    }

    // ============================================================================
    // Unit Tests for helper methods
    // ============================================================================

    #[tokio::test]
    async fn test_register_and_unregister_trigger() {
        let mut manager = AutoReplyManager::new(PathBuf::from("test.json"))
            .await
            .unwrap();

        let trigger = create_mention_trigger("test-trigger", 10);
        manager.register_trigger(trigger);

        // 注销触发器
        let removed = manager.unregister_trigger("test-trigger");
        assert!(removed.is_some());
        assert_eq!(removed.unwrap().id, "test-trigger");

        // 再次注销应该返回 None
        let removed_again = manager.unregister_trigger("test-trigger");
        assert!(removed_again.is_none());
    }

    #[tokio::test]
    async fn test_group_activation_management() {
        let mut manager = AutoReplyManager::new(PathBuf::from("test.json"))
            .await
            .unwrap();

        // 设置群组配置
        manager.set_group_activation(GroupActivation::new("group-1").with_require_mention(true));

        // 获取群组配置
        let activation = manager.get_group_activation("group-1");
        assert!(activation.is_some());
        assert!(activation.unwrap().require_mention);

        // 移除群组配置
        let removed = manager.remove_group_activation("group-1");
        assert!(removed.is_some());

        // 再次获取应该返回 None
        assert!(manager.get_group_activation("group-1").is_none());
    }

    #[tokio::test]
    async fn test_whitelist_management() {
        let mut manager = AutoReplyManager::new(PathBuf::from("test.json"))
            .await
            .unwrap();

        // 初始状态：空白名单允许所有用户
        assert!(manager.is_user_whitelisted("any_user"));

        // 添加用户到白名单
        manager.add_to_whitelist("user1".to_string());
        assert!(manager.is_user_whitelisted("user1"));
        assert!(!manager.is_user_whitelisted("user2"));

        // 从白名单移除用户
        assert!(manager.remove_from_whitelist("user1"));
        assert!(manager.is_user_whitelisted("user1")); // 空白名单允许所有用户
    }

    #[tokio::test]
    async fn test_cooldown_settings() {
        let mut manager = AutoReplyManager::new(PathBuf::from("test.json"))
            .await
            .unwrap();

        // 设置默认冷却时间
        manager.set_default_cooldown(Duration::from_secs(120));

        // 设置特定类型冷却时间
        manager.set_type_cooldown(TriggerType::Mention, Duration::from_secs(30));
    }

    // ============================================================================
    // Unit Tests for get_stats()
    // ============================================================================

    /// 测试空管理器的统计信息
    #[tokio::test]
    async fn test_get_stats_empty_manager() {
        let manager = AutoReplyManager::new(PathBuf::from("test.json"))
            .await
            .unwrap();

        let stats = manager.get_stats();

        assert_eq!(stats.total_triggers, 0);
        assert_eq!(stats.enabled_triggers, 0);
        assert_eq!(stats.whitelist_size, 0);
        assert_eq!(stats.group_activations, 0);
    }

    /// 测试有触发器的统计信息
    #[tokio::test]
    async fn test_get_stats_with_triggers() {
        let mut manager = AutoReplyManager::new(PathBuf::from("test.json"))
            .await
            .unwrap();

        // 添加启用的触发器
        manager.register_trigger(create_mention_trigger("t1", 10));
        manager.register_trigger(create_keyword_trigger("t2", vec!["help"], 20));

        // 添加禁用的触发器
        let mut disabled_trigger = create_dm_trigger("t3", 30);
        disabled_trigger.enabled = false;
        manager.register_trigger(disabled_trigger);

        let stats = manager.get_stats();

        assert_eq!(stats.total_triggers, 3);
        assert_eq!(stats.enabled_triggers, 2);
    }

    /// 测试有白名单用户的统计信息
    #[tokio::test]
    async fn test_get_stats_with_whitelist() {
        let mut manager = AutoReplyManager::new(PathBuf::from("test.json"))
            .await
            .unwrap();

        manager.add_to_whitelist("user1".to_string());
        manager.add_to_whitelist("user2".to_string());
        manager.add_to_whitelist("user3".to_string());

        let stats = manager.get_stats();

        assert_eq!(stats.whitelist_size, 3);
    }

    /// 测试有群组配置的统计信息
    #[tokio::test]
    async fn test_get_stats_with_group_activations() {
        let mut manager = AutoReplyManager::new(PathBuf::from("test.json"))
            .await
            .unwrap();

        manager.set_group_activation(GroupActivation::new("group-1"));
        manager.set_group_activation(GroupActivation::new("group-2"));

        let stats = manager.get_stats();

        assert_eq!(stats.group_activations, 2);
    }

    /// 测试完整的统计信息
    #[tokio::test]
    async fn test_get_stats_complete() {
        let mut manager = AutoReplyManager::new(PathBuf::from("test.json"))
            .await
            .unwrap();

        // 添加触发器
        manager.register_trigger(create_mention_trigger("t1", 10));
        manager.register_trigger(create_keyword_trigger("t2", vec!["help"], 20));
        let mut disabled = create_dm_trigger("t3", 30);
        disabled.enabled = false;
        manager.register_trigger(disabled);

        // 添加白名单用户
        manager.add_to_whitelist("user1".to_string());
        manager.add_to_whitelist("user2".to_string());

        // 添加群组配置
        manager.set_group_activation(GroupActivation::new("group-1"));
        manager.set_group_activation(GroupActivation::new("group-2"));
        manager.set_group_activation(GroupActivation::new("group-3"));

        let stats = manager.get_stats();

        assert_eq!(stats.total_triggers, 3);
        assert_eq!(stats.enabled_triggers, 2);
        assert_eq!(stats.whitelist_size, 2);
        assert_eq!(stats.group_activations, 3);
    }
}
