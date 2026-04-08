//! 冷却时间追踪器
//!
//! 防止用户频繁触发自动回复。

use std::collections::HashMap;
use std::time::{Duration, Instant};

use crate::auto_reply::types::TriggerType;

/// 冷却检查结果
#[derive(Debug, Clone)]
pub enum CooldownCheckResult {
    /// 允许触发
    Allowed,
    /// 在冷却中
    InCooldown { remaining: Duration },
}

/// 冷却时间追踪器
pub struct CooldownTracker {
    /// 用户最后触发时间
    last_trigger: HashMap<String, Instant>,
    /// 默认冷却时间
    default_cooldown: Duration,
    /// 每种触发类型的冷却时间
    type_cooldowns: HashMap<TriggerType, Duration>,
}

impl CooldownTracker {
    /// 创建新的冷却追踪器
    pub fn new(default_cooldown: Duration) -> Self {
        Self {
            last_trigger: HashMap::new(),
            default_cooldown,
            type_cooldowns: HashMap::new(),
        }
    }

    /// 检查用户是否在冷却中
    pub fn check_cooldown(&self, user_id: &str, trigger_type: TriggerType) -> CooldownCheckResult {
        let cooldown = self
            .type_cooldowns
            .get(&trigger_type)
            .copied()
            .unwrap_or(self.default_cooldown);

        match self.last_trigger.get(user_id) {
            Some(last) => {
                let elapsed = last.elapsed();
                if elapsed < cooldown {
                    CooldownCheckResult::InCooldown {
                        remaining: cooldown - elapsed,
                    }
                } else {
                    CooldownCheckResult::Allowed
                }
            }
            None => CooldownCheckResult::Allowed,
        }
    }

    /// 记录触发时间
    pub fn record_trigger(&mut self, user_id: &str) {
        self.last_trigger
            .insert(user_id.to_string(), Instant::now());
    }

    /// 设置特定触发类型的冷却时间
    pub fn set_type_cooldown(&mut self, trigger_type: TriggerType, duration: Duration) {
        self.type_cooldowns.insert(trigger_type, duration);
    }

    /// 重置用户冷却
    pub fn reset_cooldown(&mut self, user_id: &str) {
        self.last_trigger.remove(user_id);
    }

    /// 清理过期记录
    pub fn cleanup_expired(&mut self) {
        let max_cooldown = self
            .type_cooldowns
            .values()
            .max()
            .copied()
            .unwrap_or(self.default_cooldown);

        self.last_trigger
            .retain(|_, instant| instant.elapsed() < max_cooldown * 2);
    }

    /// 获取默认冷却时间
    pub fn default_cooldown(&self) -> Duration {
        self.default_cooldown
    }

    /// 获取特定触发类型的冷却时间
    pub fn get_type_cooldown(&self, trigger_type: TriggerType) -> Duration {
        self.type_cooldowns
            .get(&trigger_type)
            .copied()
            .unwrap_or(self.default_cooldown)
    }

    /// 检查用户是否有触发记录
    pub fn has_trigger_record(&self, user_id: &str) -> bool {
        self.last_trigger.contains_key(user_id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;
    use std::thread;

    // ============================================================================
    // Property-Based Tests
    // ============================================================================
    // Feature: auto-reply-mechanism, Property 4: 冷却时间行为一致性
    // **Validates: Requirements 4.1-4.6**

    /// 生成有效的用户 ID
    fn arb_user_id() -> impl Strategy<Value = String> {
        "[a-zA-Z0-9_]{1,20}".prop_map(|s| s)
    }

    /// 生成有效的冷却时间（毫秒）
    /// 使用较短的时间以避免测试过慢
    fn arb_cooldown_ms() -> impl Strategy<Value = u64> {
        10u64..500
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

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(20))]

        /// Property 4.1: 新用户（无触发记录）总是被允许
        /// **Validates: Requirement 4.1, 4.5**
        #[test]
        fn prop_new_user_always_allowed(
            user_id in arb_user_id(),
            cooldown_ms in arb_cooldown_ms(),
            trigger_type in arb_trigger_type()
        ) {
            let tracker = CooldownTracker::new(Duration::from_millis(cooldown_ms));

            // 新用户应该总是被允许
            let result = tracker.check_cooldown(&user_id, trigger_type);
            prop_assert!(
                matches!(result, CooldownCheckResult::Allowed),
                "New user should always be allowed, got {:?}",
                result
            );
        }

        /// Property 4.2: 记录触发后，用户在冷却期内
        /// **Validates: Requirements 4.1, 4.2**
        #[test]
        fn prop_after_trigger_user_in_cooldown(
            user_id in arb_user_id(),
            cooldown_ms in 100u64..1000,  // 使用较长的冷却时间确保测试稳定
            trigger_type in arb_trigger_type()
        ) {
            let mut tracker = CooldownTracker::new(Duration::from_millis(cooldown_ms));

            // 记录触发
            tracker.record_trigger(&user_id);

            // 立即检查应该在冷却中
            let result = tracker.check_cooldown(&user_id, trigger_type);
            prop_assert!(
                matches!(result, CooldownCheckResult::InCooldown { .. }),
                "User should be in cooldown immediately after trigger, got {:?}",
                result
            );
        }

        /// Property 4.3: 剩余时间总是 <= 配置的冷却时间
        /// **Validates: Requirements 4.3, 4.6**
        #[test]
        fn prop_remaining_time_bounded_by_cooldown(
            user_id in arb_user_id(),
            cooldown_ms in 100u64..1000,
            trigger_type in arb_trigger_type()
        ) {
            let cooldown = Duration::from_millis(cooldown_ms);
            let mut tracker = CooldownTracker::new(cooldown);

            // 记录触发
            tracker.record_trigger(&user_id);

            // 检查冷却状态
            let result = tracker.check_cooldown(&user_id, trigger_type);
            if let CooldownCheckResult::InCooldown { remaining } = result {
                prop_assert!(
                    remaining <= cooldown,
                    "Remaining time {:?} should be <= cooldown {:?}",
                    remaining,
                    cooldown
                );
            }
        }

        /// Property 4.4: 不同触发类型可以有不同的冷却时间
        /// **Validates: Requirement 4.4**
        #[test]
        fn prop_different_trigger_types_different_cooldowns(
            user_id in arb_user_id(),
            default_ms in 100u64..500,
            mention_ms in 10u64..50,
            keyword_ms in 200u64..500
        ) {
            // 确保 mention 冷却时间明显短于 keyword
            prop_assume!(mention_ms < keyword_ms);

            let mut tracker = CooldownTracker::new(Duration::from_millis(default_ms));
            tracker.set_type_cooldown(TriggerType::Mention, Duration::from_millis(mention_ms));
            tracker.set_type_cooldown(TriggerType::Keyword, Duration::from_millis(keyword_ms));

            // 记录触发
            tracker.record_trigger(&user_id);

            // 等待 mention 冷却过期但 keyword 还在冷却中
            thread::sleep(Duration::from_millis(mention_ms + 10));

            // Mention 应该被允许
            let mention_result = tracker.check_cooldown(&user_id, TriggerType::Mention);
            prop_assert!(
                matches!(mention_result, CooldownCheckResult::Allowed),
                "Mention should be allowed after its cooldown expires, got {:?}",
                mention_result
            );

            // Keyword 应该还在冷却中
            let keyword_result = tracker.check_cooldown(&user_id, TriggerType::Keyword);
            prop_assert!(
                matches!(keyword_result, CooldownCheckResult::InCooldown { .. }),
                "Keyword should still be in cooldown, got {:?}",
                keyword_result
            );
        }

        /// Property 4.5: 重置冷却后允许立即重新触发
        /// **Validates: Requirement 4.5**
        #[test]
        fn prop_reset_cooldown_allows_immediate_retrigger(
            user_id in arb_user_id(),
            cooldown_ms in 100u64..1000,
            trigger_type in arb_trigger_type()
        ) {
            let mut tracker = CooldownTracker::new(Duration::from_millis(cooldown_ms));

            // 记录触发
            tracker.record_trigger(&user_id);

            // 确认在冷却中
            let result_before = tracker.check_cooldown(&user_id, trigger_type);
            prop_assert!(
                matches!(result_before, CooldownCheckResult::InCooldown { .. }),
                "Should be in cooldown before reset"
            );

            // 重置冷却
            tracker.reset_cooldown(&user_id);

            // 重置后应该被允许
            let result_after = tracker.check_cooldown(&user_id, trigger_type);
            prop_assert!(
                matches!(result_after, CooldownCheckResult::Allowed),
                "Should be allowed after reset, got {:?}",
                result_after
            );
        }

        /// Property 4.6: 多用户冷却独立
        /// **Validates: Requirement 4.1**
        #[test]
        fn prop_independent_user_cooldowns(
            user1 in arb_user_id(),
            user2 in arb_user_id(),
            cooldown_ms in 100u64..1000,
            trigger_type in arb_trigger_type()
        ) {
            // 确保两个用户不同
            prop_assume!(user1 != user2);

            let mut tracker = CooldownTracker::new(Duration::from_millis(cooldown_ms));

            // 只记录 user1 的触发
            tracker.record_trigger(&user1);

            // user1 应该在冷却中
            let result1 = tracker.check_cooldown(&user1, trigger_type);
            prop_assert!(
                matches!(result1, CooldownCheckResult::InCooldown { .. }),
                "User1 should be in cooldown"
            );

            // user2 应该被允许（没有触发记录）
            let result2 = tracker.check_cooldown(&user2, trigger_type);
            prop_assert!(
                matches!(result2, CooldownCheckResult::Allowed),
                "User2 should be allowed, got {:?}",
                result2
            );
        }

        /// Property 4.7: 冷却时间过期后允许触发
        /// **Validates: Requirements 4.2, 4.5**
        #[test]
        fn prop_cooldown_expires_allows_trigger(
            user_id in arb_user_id(),
            trigger_type in arb_trigger_type()
        ) {
            // 使用非常短的冷却时间
            let cooldown = Duration::from_millis(20);
            let mut tracker = CooldownTracker::new(cooldown);

            // 记录触发
            tracker.record_trigger(&user_id);

            // 立即检查应该在冷却中
            let result_immediate = tracker.check_cooldown(&user_id, trigger_type);
            prop_assert!(
                matches!(result_immediate, CooldownCheckResult::InCooldown { .. }),
                "Should be in cooldown immediately"
            );

            // 等待冷却过期
            thread::sleep(Duration::from_millis(30));

            // 现在应该被允许
            let result_after = tracker.check_cooldown(&user_id, trigger_type);
            prop_assert!(
                matches!(result_after, CooldownCheckResult::Allowed),
                "Should be allowed after cooldown expires, got {:?}",
                result_after
            );
        }

        /// Property 4.8: 获取的类型冷却时间与设置一致
        /// **Validates: Requirements 4.3, 4.4**
        #[test]
        fn prop_get_type_cooldown_consistent(
            default_ms in arb_cooldown_ms(),
            type_ms in arb_cooldown_ms(),
            trigger_type in arb_trigger_type()
        ) {
            let default_cooldown = Duration::from_millis(default_ms);
            let type_cooldown = Duration::from_millis(type_ms);

            let mut tracker = CooldownTracker::new(default_cooldown);

            // 未设置类型冷却时，应返回默认值
            prop_assert_eq!(
                tracker.get_type_cooldown(trigger_type),
                default_cooldown,
                "Should return default cooldown when type not set"
            );

            // 设置类型冷却后，应返回设置的值
            tracker.set_type_cooldown(trigger_type, type_cooldown);
            prop_assert_eq!(
                tracker.get_type_cooldown(trigger_type),
                type_cooldown,
                "Should return set cooldown for type"
            );
        }

        /// Property 4.9: 触发记录状态一致性
        /// **Validates: Requirement 4.1**
        #[test]
        fn prop_trigger_record_consistency(
            user_id in arb_user_id(),
            cooldown_ms in arb_cooldown_ms()
        ) {
            let mut tracker = CooldownTracker::new(Duration::from_millis(cooldown_ms));

            // 初始状态：无触发记录
            prop_assert!(
                !tracker.has_trigger_record(&user_id),
                "Should not have trigger record initially"
            );

            // 记录触发后：有触发记录
            tracker.record_trigger(&user_id);
            prop_assert!(
                tracker.has_trigger_record(&user_id),
                "Should have trigger record after recording"
            );

            // 重置后：无触发记录
            tracker.reset_cooldown(&user_id);
            prop_assert!(
                !tracker.has_trigger_record(&user_id),
                "Should not have trigger record after reset"
            );
        }
    }

    // ============================================================
    // 单元测试：验证 Requirements 4.1-4.6
    // ============================================================

    /// Requirement 4.1: THE Auto_Reply_Manager SHALL track last trigger time per user
    #[test]
    fn test_track_last_trigger_time_per_user() {
        let mut tracker = CooldownTracker::new(Duration::from_secs(60));

        // 初始状态：没有触发记录
        assert!(!tracker.has_trigger_record("user1"));
        assert!(!tracker.has_trigger_record("user2"));

        // 记录 user1 的触发
        tracker.record_trigger("user1");
        assert!(tracker.has_trigger_record("user1"));
        assert!(!tracker.has_trigger_record("user2"));

        // 记录 user2 的触发
        tracker.record_trigger("user2");
        assert!(tracker.has_trigger_record("user1"));
        assert!(tracker.has_trigger_record("user2"));
    }

    /// Requirement 4.2: WHEN a user triggers within cooldown period,
    /// THE Auto_Reply_Manager SHALL reject the trigger
    #[test]
    fn test_reject_trigger_within_cooldown() {
        let mut tracker = CooldownTracker::new(Duration::from_secs(60));

        // 记录触发
        tracker.record_trigger("user1");

        // 立即检查应该被拒绝（在冷却期内）
        let result = tracker.check_cooldown("user1", TriggerType::Mention);
        match result {
            CooldownCheckResult::InCooldown { remaining } => {
                // 剩余时间应该接近 60 秒
                assert!(remaining.as_secs() <= 60);
                assert!(remaining.as_secs() >= 59);
            }
            CooldownCheckResult::Allowed => {
                panic!("Should be in cooldown");
            }
        }
    }

    /// Requirement 4.3: THE Auto_Reply_Manager SHALL support configurable cooldown duration
    #[test]
    fn test_configurable_cooldown_duration() {
        // 测试不同的默认冷却时间
        let tracker_short = CooldownTracker::new(Duration::from_secs(10));
        let tracker_long = CooldownTracker::new(Duration::from_secs(300));

        assert_eq!(tracker_short.default_cooldown(), Duration::from_secs(10));
        assert_eq!(tracker_long.default_cooldown(), Duration::from_secs(300));
    }

    /// Requirement 4.4: THE Auto_Reply_Manager SHALL support per-trigger-type cooldown settings
    #[test]
    fn test_per_trigger_type_cooldown() {
        let mut tracker = CooldownTracker::new(Duration::from_secs(60));

        // 设置不同触发类型的冷却时间
        tracker.set_type_cooldown(TriggerType::Mention, Duration::from_secs(30));
        tracker.set_type_cooldown(TriggerType::Keyword, Duration::from_secs(120));

        // 验证不同类型使用不同的冷却时间
        assert_eq!(
            tracker.get_type_cooldown(TriggerType::Mention),
            Duration::from_secs(30)
        );
        assert_eq!(
            tracker.get_type_cooldown(TriggerType::Keyword),
            Duration::from_secs(120)
        );
        // 未设置的类型使用默认值
        assert_eq!(
            tracker.get_type_cooldown(TriggerType::DirectMessage),
            Duration::from_secs(60)
        );
    }

    /// Requirement 4.5: WHEN cooldown expires, THE Auto_Reply_Manager SHALL allow the user to trigger again
    #[test]
    fn test_allow_after_cooldown_expires() {
        // 使用非常短的冷却时间进行测试
        let mut tracker = CooldownTracker::new(Duration::from_millis(50));

        // 记录触发
        tracker.record_trigger("user1");

        // 立即检查应该被拒绝
        let result = tracker.check_cooldown("user1", TriggerType::Mention);
        assert!(matches!(result, CooldownCheckResult::InCooldown { .. }));

        // 等待冷却时间过期
        thread::sleep(Duration::from_millis(60));

        // 现在应该允许
        let result = tracker.check_cooldown("user1", TriggerType::Mention);
        assert!(matches!(result, CooldownCheckResult::Allowed));
    }

    /// Requirement 4.6: THE Auto_Reply_Manager SHALL provide remaining cooldown time in rejection response
    #[test]
    fn test_remaining_cooldown_time_in_rejection() {
        let mut tracker = CooldownTracker::new(Duration::from_secs(60));

        // 记录触发
        tracker.record_trigger("user1");

        // 检查冷却状态
        let result = tracker.check_cooldown("user1", TriggerType::Mention);
        match result {
            CooldownCheckResult::InCooldown { remaining } => {
                // 验证返回了剩余时间
                assert!(remaining > Duration::ZERO);
                assert!(remaining <= Duration::from_secs(60));
            }
            CooldownCheckResult::Allowed => {
                panic!("Should be in cooldown with remaining time");
            }
        }
    }

    // ============================================================
    // 额外单元测试：边界情况和辅助方法
    // ============================================================

    /// 测试新用户（无触发记录）应该被允许
    #[test]
    fn test_new_user_allowed() {
        let tracker = CooldownTracker::new(Duration::from_secs(60));

        // 新用户应该被允许
        let result = tracker.check_cooldown("new_user", TriggerType::Mention);
        assert!(matches!(result, CooldownCheckResult::Allowed));
    }

    /// 测试重置冷却功能
    #[test]
    fn test_reset_cooldown() {
        let mut tracker = CooldownTracker::new(Duration::from_secs(60));

        // 记录触发
        tracker.record_trigger("user1");
        assert!(tracker.has_trigger_record("user1"));

        // 重置冷却
        tracker.reset_cooldown("user1");
        assert!(!tracker.has_trigger_record("user1"));

        // 重置后应该被允许
        let result = tracker.check_cooldown("user1", TriggerType::Mention);
        assert!(matches!(result, CooldownCheckResult::Allowed));
    }

    /// 测试清理过期记录
    #[test]
    fn test_cleanup_expired() {
        let mut tracker = CooldownTracker::new(Duration::from_millis(10));

        // 记录多个用户的触发
        tracker.record_trigger("user1");
        tracker.record_trigger("user2");

        // 等待记录过期
        thread::sleep(Duration::from_millis(30));

        // 清理过期记录
        tracker.cleanup_expired();

        // 过期记录应该被清理
        assert!(!tracker.has_trigger_record("user1"));
        assert!(!tracker.has_trigger_record("user2"));
    }

    /// 测试多用户独立冷却
    #[test]
    fn test_independent_user_cooldowns() {
        let mut tracker = CooldownTracker::new(Duration::from_secs(60));

        // user1 触发
        tracker.record_trigger("user1");

        // user1 在冷却中
        let result1 = tracker.check_cooldown("user1", TriggerType::Mention);
        assert!(matches!(result1, CooldownCheckResult::InCooldown { .. }));

        // user2 没有触发过，应该被允许
        let result2 = tracker.check_cooldown("user2", TriggerType::Mention);
        assert!(matches!(result2, CooldownCheckResult::Allowed));
    }

    /// 测试不同触发类型使用不同冷却时间
    #[test]
    fn test_different_cooldown_per_type() {
        let mut tracker = CooldownTracker::new(Duration::from_millis(100));
        tracker.set_type_cooldown(TriggerType::Mention, Duration::from_millis(20));
        tracker.set_type_cooldown(TriggerType::Keyword, Duration::from_millis(200));

        // 记录触发
        tracker.record_trigger("user1");

        // 等待 Mention 冷却过期但 Keyword 还在冷却中
        thread::sleep(Duration::from_millis(30));

        // Mention 应该被允许（冷却时间 20ms 已过）
        let result_mention = tracker.check_cooldown("user1", TriggerType::Mention);
        assert!(matches!(result_mention, CooldownCheckResult::Allowed));

        // Keyword 应该还在冷却中（冷却时间 200ms）
        let result_keyword = tracker.check_cooldown("user1", TriggerType::Keyword);
        assert!(matches!(
            result_keyword,
            CooldownCheckResult::InCooldown { .. }
        ));
    }

    /// 测试 CooldownCheckResult 的 Debug 实现
    #[test]
    fn test_cooldown_check_result_debug() {
        let allowed = CooldownCheckResult::Allowed;
        let in_cooldown = CooldownCheckResult::InCooldown {
            remaining: Duration::from_secs(30),
        };

        // 验证 Debug 实现不会 panic
        let _ = format!("{:?}", allowed);
        let _ = format!("{:?}", in_cooldown);
    }

    /// 测试 CooldownCheckResult 的 Clone 实现
    #[test]
    fn test_cooldown_check_result_clone() {
        let original = CooldownCheckResult::InCooldown {
            remaining: Duration::from_secs(30),
        };
        let cloned = original.clone();

        match cloned {
            CooldownCheckResult::InCooldown { remaining } => {
                assert_eq!(remaining, Duration::from_secs(30));
            }
            _ => panic!("Clone should preserve variant"),
        }
    }
}
