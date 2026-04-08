//! 触发器注册表
//!
//! 管理已注册的自动回复触发器。

use serde::{Deserialize, Serialize};

use crate::auto_reply::types::{TriggerConfig, TriggerType};

/// 自动回复触发器
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AutoReplyTrigger {
    /// 触发器 ID
    pub id: String,
    /// 触发器名称
    pub name: String,
    /// 是否启用
    #[serde(default = "default_true")]
    pub enabled: bool,
    /// 触发类型
    pub trigger_type: TriggerType,
    /// 触发配置
    pub config: TriggerConfig,
    /// 优先级（数字越小优先级越高）
    #[serde(default = "default_priority")]
    pub priority: u32,
    /// 响应模板（可选）
    #[serde(default)]
    pub response_template: Option<String>,
}

fn default_true() -> bool {
    true
}

fn default_priority() -> u32 {
    100
}

/// 触发器注册表
pub struct TriggerRegistry {
    /// 已注册的触发器
    triggers: Vec<AutoReplyTrigger>,
}

impl Default for TriggerRegistry {
    fn default() -> Self {
        Self::new()
    }
}

impl TriggerRegistry {
    /// 创建新的注册表
    pub fn new() -> Self {
        Self {
            triggers: Vec::new(),
        }
    }

    /// 注册触发器
    pub fn register(&mut self, trigger: AutoReplyTrigger) {
        self.triggers.push(trigger);
    }

    /// 注销触发器
    pub fn unregister(&mut self, trigger_id: &str) -> Option<AutoReplyTrigger> {
        if let Some(pos) = self.triggers.iter().position(|t| t.id == trigger_id) {
            Some(self.triggers.remove(pos))
        } else {
            None
        }
    }

    /// 获取所有启用的触发器（按优先级排序）
    pub fn get_enabled_triggers(&self) -> Vec<&AutoReplyTrigger> {
        let mut triggers: Vec<_> = self.triggers.iter().filter(|t| t.enabled).collect();
        triggers.sort_by_key(|t| t.priority);
        triggers
    }

    /// 根据 ID 获取触发器
    pub fn get_trigger(&self, trigger_id: &str) -> Option<&AutoReplyTrigger> {
        self.triggers.iter().find(|t| t.id == trigger_id)
    }

    /// 更新触发器
    pub fn update_trigger(&mut self, trigger: AutoReplyTrigger) -> bool {
        if let Some(existing) = self.triggers.iter_mut().find(|t| t.id == trigger.id) {
            *existing = trigger;
            true
        } else {
            false
        }
    }

    /// 获取所有触发器
    ///
    /// 返回所有已注册的触发器（包括禁用的）。
    pub fn get_all_triggers(&self) -> &[AutoReplyTrigger] {
        &self.triggers
    }

    /// 获取触发器数量
    pub fn len(&self) -> usize {
        self.triggers.len()
    }

    /// 检查注册表是否为空
    pub fn is_empty(&self) -> bool {
        self.triggers.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auto_reply::types::KeywordTriggerConfig;
    use proptest::prelude::*;

    /// 创建测试用的触发器
    fn create_test_trigger(id: &str, priority: u32, enabled: bool) -> AutoReplyTrigger {
        AutoReplyTrigger {
            id: id.to_string(),
            name: format!("Test Trigger {}", id),
            enabled,
            trigger_type: TriggerType::Keyword,
            config: TriggerConfig::Keyword(KeywordTriggerConfig {
                patterns: vec!["test".to_string()],
                case_insensitive: false,
                use_regex: false,
            }),
            priority,
            response_template: None,
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
            response_template: Some("Hello!".to_string()),
        }
    }

    // ========== TriggerRegistry 测试 ==========

    #[test]
    fn test_registry_new() {
        let registry = TriggerRegistry::new();
        assert!(registry.get_enabled_triggers().is_empty());
    }

    #[test]
    fn test_registry_default() {
        let registry = TriggerRegistry::default();
        assert!(registry.get_enabled_triggers().is_empty());
    }

    #[test]
    fn test_register_trigger() {
        let mut registry = TriggerRegistry::new();
        let trigger = create_test_trigger("t1", 10, true);

        registry.register(trigger);

        assert_eq!(registry.get_enabled_triggers().len(), 1);
        assert!(registry.get_trigger("t1").is_some());
    }

    #[test]
    fn test_register_multiple_triggers() {
        let mut registry = TriggerRegistry::new();

        registry.register(create_test_trigger("t1", 10, true));
        registry.register(create_test_trigger("t2", 20, true));
        registry.register(create_test_trigger("t3", 5, true));

        assert_eq!(registry.get_enabled_triggers().len(), 3);
    }

    #[test]
    fn test_unregister_existing_trigger() {
        let mut registry = TriggerRegistry::new();
        registry.register(create_test_trigger("t1", 10, true));
        registry.register(create_test_trigger("t2", 20, true));

        let removed = registry.unregister("t1");

        assert!(removed.is_some());
        assert_eq!(removed.unwrap().id, "t1");
        assert!(registry.get_trigger("t1").is_none());
        assert!(registry.get_trigger("t2").is_some());
    }

    #[test]
    fn test_unregister_nonexistent_trigger() {
        let mut registry = TriggerRegistry::new();
        registry.register(create_test_trigger("t1", 10, true));

        let removed = registry.unregister("nonexistent");

        assert!(removed.is_none());
        assert!(registry.get_trigger("t1").is_some());
    }

    #[test]
    fn test_get_enabled_triggers_filters_disabled() {
        let mut registry = TriggerRegistry::new();
        registry.register(create_test_trigger("t1", 10, true));
        registry.register(create_test_trigger("t2", 20, false)); // disabled
        registry.register(create_test_trigger("t3", 5, true));

        let enabled = registry.get_enabled_triggers();

        assert_eq!(enabled.len(), 2);
        assert!(enabled.iter().all(|t| t.enabled));
    }

    #[test]
    fn test_get_enabled_triggers_sorted_by_priority() {
        let mut registry = TriggerRegistry::new();
        registry.register(create_test_trigger("t1", 100, true));
        registry.register(create_test_trigger("t2", 10, true));
        registry.register(create_test_trigger("t3", 50, true));

        let enabled = registry.get_enabled_triggers();

        assert_eq!(enabled.len(), 3);
        // 优先级数字越小越优先
        assert_eq!(enabled[0].id, "t2"); // priority 10
        assert_eq!(enabled[1].id, "t3"); // priority 50
        assert_eq!(enabled[2].id, "t1"); // priority 100
    }

    #[test]
    fn test_get_trigger_existing() {
        let mut registry = TriggerRegistry::new();
        registry.register(create_test_trigger("t1", 10, true));

        let trigger = registry.get_trigger("t1");

        assert!(trigger.is_some());
        assert_eq!(trigger.unwrap().id, "t1");
    }

    #[test]
    fn test_get_trigger_nonexistent() {
        let registry = TriggerRegistry::new();

        let trigger = registry.get_trigger("nonexistent");

        assert!(trigger.is_none());
    }

    #[test]
    fn test_update_existing_trigger() {
        let mut registry = TriggerRegistry::new();
        registry.register(create_test_trigger("t1", 10, true));

        let mut updated = create_test_trigger("t1", 50, false);
        updated.name = "Updated Name".to_string();

        let result = registry.update_trigger(updated);

        assert!(result);
        let trigger = registry.get_trigger("t1").unwrap();
        assert_eq!(trigger.name, "Updated Name");
        assert_eq!(trigger.priority, 50);
        assert!(!trigger.enabled);
    }

    #[test]
    fn test_update_nonexistent_trigger() {
        let mut registry = TriggerRegistry::new();
        registry.register(create_test_trigger("t1", 10, true));

        let new_trigger = create_test_trigger("t2", 20, true);
        let result = registry.update_trigger(new_trigger);

        assert!(!result);
        assert!(registry.get_trigger("t2").is_none());
    }

    // ========== AutoReplyTrigger 测试 ==========

    #[test]
    fn test_trigger_serialization_roundtrip() {
        let trigger = create_mention_trigger("mention-1", 5);

        let json = serde_json::to_string(&trigger).expect("Should serialize");
        let parsed: AutoReplyTrigger = serde_json::from_str(&json).expect("Should deserialize");

        assert_eq!(parsed.id, trigger.id);
        assert_eq!(parsed.name, trigger.name);
        assert_eq!(parsed.enabled, trigger.enabled);
        assert_eq!(parsed.priority, trigger.priority);
        assert_eq!(parsed.response_template, trigger.response_template);
    }

    #[test]
    fn test_trigger_default_values() {
        // 测试 serde 默认值
        let json = r#"{
            "id": "test",
            "name": "Test",
            "trigger_type": "mention",
            "config": { "type": "mention" }
        }"#;

        let trigger: AutoReplyTrigger =
            serde_json::from_str(json).expect("Should deserialize with defaults");

        assert!(trigger.enabled); // default_true
        assert_eq!(trigger.priority, 100); // default_priority
        assert!(trigger.response_template.is_none()); // default None
    }

    #[test]
    fn test_trigger_with_keyword_config() {
        let trigger = create_test_trigger("kw-1", 10, true);

        match &trigger.config {
            TriggerConfig::Keyword(config) => {
                assert_eq!(config.patterns, vec!["test".to_string()]);
                assert!(!config.case_insensitive);
                assert!(!config.use_regex);
            }
            _ => panic!("Expected Keyword config"),
        }
    }

    #[test]
    fn test_trigger_clone() {
        let trigger = create_mention_trigger("m1", 10);
        let cloned = trigger.clone();

        assert_eq!(cloned.id, trigger.id);
        assert_eq!(cloned.name, trigger.name);
        assert_eq!(cloned.priority, trigger.priority);
    }

    // ============================================================================
    // Property-Based Tests
    // ============================================================================
    // Feature: auto-reply-mechanism, Property 6: 触发器评估优先级
    // **Validates: Requirements 6.1-6.3**

    /// 生成有效的触发器 ID
    fn arb_trigger_id() -> impl Strategy<Value = String> {
        "[a-zA-Z][a-zA-Z0-9_-]{0,19}".prop_map(|s| s)
    }

    /// 生成有效的优先级值（0-1000）
    fn arb_priority() -> impl Strategy<Value = u32> {
        0u32..=1000u32
    }

    /// 生成触发器配置
    fn arb_trigger_config() -> impl Strategy<Value = (TriggerType, TriggerConfig)> {
        prop_oneof![
            Just((TriggerType::Mention, TriggerConfig::Mention)),
            Just((TriggerType::DirectMessage, TriggerConfig::DirectMessage)),
            prop::collection::vec("[a-zA-Z0-9]{1,10}", 1..5).prop_map(|patterns| {
                (
                    TriggerType::Keyword,
                    TriggerConfig::Keyword(KeywordTriggerConfig {
                        patterns,
                        case_insensitive: false,
                        use_regex: false,
                    }),
                )
            }),
        ]
    }

    /// 生成单个触发器
    fn arb_trigger() -> impl Strategy<Value = AutoReplyTrigger> {
        (
            arb_trigger_id(),
            arb_priority(),
            any::<bool>(),
            arb_trigger_config(),
        )
            .prop_map(
                |(id, priority, enabled, (trigger_type, config))| AutoReplyTrigger {
                    id,
                    name: "Test Trigger".to_string(),
                    enabled,
                    trigger_type,
                    config,
                    priority,
                    response_template: None,
                },
            )
    }

    /// 生成具有唯一 ID 的触发器列表
    fn arb_triggers_with_unique_ids() -> impl Strategy<Value = Vec<AutoReplyTrigger>> {
        prop::collection::vec(arb_trigger(), 0..20).prop_map(|triggers| {
            // 确保 ID 唯一
            let mut seen_ids = std::collections::HashSet::new();
            triggers
                .into_iter()
                .enumerate()
                .map(|(i, mut t)| {
                    // 如果 ID 重复，添加索引后缀
                    while seen_ids.contains(&t.id) {
                        t.id = format!("{}_{}", t.id, i);
                    }
                    seen_ids.insert(t.id.clone());
                    t
                })
                .collect()
        })
    }

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(100))]

        /// Property 6.1: get_enabled_triggers 返回所有启用的触发器
        /// **Validates: Requirement 6.1**
        ///
        /// WHEN checking a message, THE Auto_Reply_Manager SHALL evaluate all enabled triggers
        #[test]
        fn prop_get_enabled_triggers_returns_all_enabled(
            triggers in arb_triggers_with_unique_ids()
        ) {
            // Feature: auto-reply-mechanism, Property 6: 触发器评估优先级
            // Validates: Requirements 6.1-6.3

            let mut registry = TriggerRegistry::new();
            for trigger in &triggers {
                registry.register(trigger.clone());
            }

            let enabled = registry.get_enabled_triggers();
            let expected_enabled_count = triggers.iter().filter(|t| t.enabled).count();

            // 验证返回的触发器数量与启用的触发器数量一致
            prop_assert_eq!(
                enabled.len(),
                expected_enabled_count,
                "Expected {} enabled triggers, got {}",
                expected_enabled_count,
                enabled.len()
            );

            // 验证所有返回的触发器都是启用的
            for trigger in &enabled {
                prop_assert!(
                    trigger.enabled,
                    "Trigger {} should be enabled",
                    trigger.id
                );
            }
        }

        /// Property 6.2: get_enabled_triggers 按优先级排序（priority 值最小的排在前面）
        /// **Validates: Requirement 6.2**
        ///
        /// WHEN multiple triggers match, THE Auto_Reply_Manager SHALL return the highest priority trigger
        #[test]
        fn prop_get_enabled_triggers_sorted_by_priority(
            triggers in arb_triggers_with_unique_ids()
        ) {
            // Feature: auto-reply-mechanism, Property 6: 触发器评估优先级
            // Validates: Requirements 6.1-6.3

            let mut registry = TriggerRegistry::new();
            for trigger in &triggers {
                registry.register(trigger.clone());
            }

            let enabled = registry.get_enabled_triggers();

            // 验证触发器按优先级升序排列（priority 值越小优先级越高）
            for i in 1..enabled.len() {
                prop_assert!(
                    enabled[i - 1].priority <= enabled[i].priority,
                    "Triggers should be sorted by priority: {} (priority {}) should come before {} (priority {})",
                    enabled[i - 1].id,
                    enabled[i - 1].priority,
                    enabled[i].id,
                    enabled[i].priority
                );
            }
        }

        /// Property 6.3: 空注册表返回空列表
        /// **Validates: Requirement 6.3**
        ///
        /// WHEN no triggers match, THE Auto_Reply_Manager SHALL return a non-trigger result
        #[test]
        fn prop_empty_registry_returns_empty_list(_seed in any::<u64>()) {
            // Feature: auto-reply-mechanism, Property 6: 触发器评估优先级
            // Validates: Requirements 6.1-6.3

            let registry = TriggerRegistry::new();
            let enabled = registry.get_enabled_triggers();

            prop_assert!(
                enabled.is_empty(),
                "Empty registry should return empty list, got {} triggers",
                enabled.len()
            );
        }

        /// Property 6.4: 所有触发器禁用时返回空列表
        /// **Validates: Requirement 6.3**
        #[test]
        fn prop_all_disabled_returns_empty_list(
            triggers in prop::collection::vec(arb_trigger(), 1..10)
        ) {
            // Feature: auto-reply-mechanism, Property 6: 触发器评估优先级
            // Validates: Requirements 6.1-6.3

            let mut registry = TriggerRegistry::new();

            // 注册所有触发器，但全部禁用
            for (i, mut trigger) in triggers.into_iter().enumerate() {
                trigger.id = format!("trigger_{}", i); // 确保 ID 唯一
                trigger.enabled = false;
                registry.register(trigger);
            }

            let enabled = registry.get_enabled_triggers();

            prop_assert!(
                enabled.is_empty(),
                "All disabled triggers should return empty list, got {} triggers",
                enabled.len()
            );
        }

        /// Property 6.5: 第一个返回的触发器具有最高优先级（最小 priority 值）
        /// **Validates: Requirement 6.2**
        #[test]
        fn prop_first_trigger_has_highest_priority(
            triggers in arb_triggers_with_unique_ids()
                .prop_filter("Need at least one enabled trigger", |ts| ts.iter().any(|t| t.enabled))
        ) {
            // Feature: auto-reply-mechanism, Property 6: 触发器评估优先级
            // Validates: Requirements 6.1-6.3

            let mut registry = TriggerRegistry::new();
            for trigger in &triggers {
                registry.register(trigger.clone());
            }

            let enabled = registry.get_enabled_triggers();

            // 找到所有启用触发器中的最小优先级
            let min_priority = triggers
                .iter()
                .filter(|t| t.enabled)
                .map(|t| t.priority)
                .min()
                .unwrap();

            // 验证第一个触发器的优先级是最小的
            prop_assert_eq!(
                enabled[0].priority,
                min_priority,
                "First trigger should have minimum priority {}, got {}",
                min_priority,
                enabled[0].priority
            );
        }

        /// Property 6.6: 注册顺序不影响优先级排序
        /// **Validates: Requirement 6.2**
        #[test]
        fn prop_registration_order_does_not_affect_priority_sort(
            triggers in arb_triggers_with_unique_ids()
                .prop_filter("Need at least 2 enabled triggers", |ts| ts.iter().filter(|t| t.enabled).count() >= 2)
        ) {
            // Feature: auto-reply-mechanism, Property 6: 触发器评估优先级
            // Validates: Requirements 6.1-6.3

            // 正序注册
            let mut registry1 = TriggerRegistry::new();
            for trigger in &triggers {
                registry1.register(trigger.clone());
            }

            // 逆序注册
            let mut registry2 = TriggerRegistry::new();
            for trigger in triggers.iter().rev() {
                registry2.register(trigger.clone());
            }

            let enabled1 = registry1.get_enabled_triggers();
            let enabled2 = registry2.get_enabled_triggers();

            // 验证两种注册顺序产生相同的优先级排序
            prop_assert_eq!(
                enabled1.len(),
                enabled2.len(),
                "Both registries should have same number of enabled triggers"
            );

            // 验证优先级顺序一致
            for (t1, t2) in enabled1.iter().zip(enabled2.iter()) {
                prop_assert_eq!(
                    t1.priority,
                    t2.priority,
                    "Priority order should be consistent regardless of registration order"
                );
            }
        }

        /// Property 6.7: 相同优先级的触发器都被返回
        /// **Validates: Requirements 6.1, 6.2**
        #[test]
        fn prop_same_priority_triggers_all_returned(
            base_priority in arb_priority(),
            count in 2usize..5
        ) {
            // Feature: auto-reply-mechanism, Property 6: 触发器评估优先级
            // Validates: Requirements 6.1-6.3

            let mut registry = TriggerRegistry::new();

            // 创建多个相同优先级的触发器
            for i in 0..count {
                let trigger = AutoReplyTrigger {
                    id: format!("trigger_{}", i),
                    name: format!("Trigger {}", i),
                    enabled: true,
                    trigger_type: TriggerType::Mention,
                    config: TriggerConfig::Mention,
                    priority: base_priority,
                    response_template: None,
                };
                registry.register(trigger);
            }

            let enabled = registry.get_enabled_triggers();

            // 验证所有触发器都被返回
            prop_assert_eq!(
                enabled.len(),
                count,
                "All {} triggers with same priority should be returned, got {}",
                count,
                enabled.len()
            );

            // 验证所有触发器优先级相同
            for trigger in &enabled {
                prop_assert_eq!(
                    trigger.priority,
                    base_priority,
                    "All triggers should have priority {}, got {}",
                    base_priority,
                    trigger.priority
                );
            }
        }

        /// Property 6.8: 禁用的触发器不影响启用触发器的优先级排序
        /// **Validates: Requirements 6.1, 6.2**
        #[test]
        fn prop_disabled_triggers_do_not_affect_enabled_order(
            enabled_priorities in prop::collection::vec(arb_priority(), 1..5),
            disabled_priorities in prop::collection::vec(arb_priority(), 1..5)
        ) {
            // Feature: auto-reply-mechanism, Property 6: 触发器评估优先级
            // Validates: Requirements 6.1-6.3

            let mut registry = TriggerRegistry::new();

            // 注册启用的触发器
            for (i, priority) in enabled_priorities.iter().enumerate() {
                let trigger = AutoReplyTrigger {
                    id: format!("enabled_{}", i),
                    name: format!("Enabled Trigger {}", i),
                    enabled: true,
                    trigger_type: TriggerType::Mention,
                    config: TriggerConfig::Mention,
                    priority: *priority,
                    response_template: None,
                };
                registry.register(trigger);
            }

            // 注册禁用的触发器（可能有更高优先级）
            for (i, priority) in disabled_priorities.iter().enumerate() {
                let trigger = AutoReplyTrigger {
                    id: format!("disabled_{}", i),
                    name: format!("Disabled Trigger {}", i),
                    enabled: false,
                    trigger_type: TriggerType::Mention,
                    config: TriggerConfig::Mention,
                    priority: *priority,
                    response_template: None,
                };
                registry.register(trigger);
            }

            let enabled = registry.get_enabled_triggers();

            // 验证只返回启用的触发器
            prop_assert_eq!(
                enabled.len(),
                enabled_priorities.len(),
                "Should only return enabled triggers"
            );

            // 验证禁用的触发器不在结果中
            for trigger in &enabled {
                prop_assert!(
                    !trigger.id.starts_with("disabled_"),
                    "Disabled trigger {} should not be in result",
                    trigger.id
                );
            }

            // 验证启用的触发器按优先级排序
            for i in 1..enabled.len() {
                prop_assert!(
                    enabled[i - 1].priority <= enabled[i].priority,
                    "Enabled triggers should be sorted by priority"
                );
            }
        }
    }
}
