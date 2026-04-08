//! Tool Policy 系统属性测试
//!
//! 使用 proptest 进行属性测试，验证系统的正确性属性。
//! 配置为 10 次迭代以加快测试速度。

use proptest::prelude::*;

use super::groups::ToolGroups;
use super::policy_merger::PolicyMerger;
use super::profile::ProfileManager;
use super::types::{PolicyLayer, ToolPolicy, ToolProfile};

// =============================================================================
// 测试配置：减少示例数量以加快测试速度
// =============================================================================

const TEST_CASES: u32 = 10;

fn test_config() -> ProptestConfig {
    ProptestConfig::with_cases(TEST_CASES)
}

// =============================================================================
// 策略生成器
// =============================================================================

/// 生成随机 Profile
fn arb_profile() -> impl Strategy<Value = ToolProfile> {
    prop_oneof![
        Just(ToolProfile::Minimal),
        Just(ToolProfile::Coding),
        Just(ToolProfile::Messaging),
        Just(ToolProfile::Full),
        "[a-z]{3,8}".prop_map(ToolProfile::Custom),
    ]
}

/// 生成随机工具名称
fn arb_tool_name() -> impl Strategy<Value = String> {
    prop_oneof![
        Just("bash".to_string()),
        Just("file_read".to_string()),
        Just("file_write".to_string()),
        Just("exec".to_string()),
        Just("session_status".to_string()),
        Just("web_search".to_string()),
        Just("memory_get".to_string()),
        "[a-z_]{3,15}".prop_map(String::from),
    ]
}

/// 生成随机分组名称
fn arb_group_name() -> impl Strategy<Value = String> {
    prop_oneof![
        Just("group:fs".to_string()),
        Just("group:runtime".to_string()),
        Just("group:memory".to_string()),
        Just("group:web".to_string()),
        Just("group:session".to_string()),
    ]
}

/// 生成随机策略层
fn arb_policy_layer() -> impl Strategy<Value = PolicyLayer> {
    prop_oneof![
        Just(PolicyLayer::Profile),
        Just(PolicyLayer::Global),
        Just(PolicyLayer::Agent),
        Just(PolicyLayer::Session),
    ]
}

/// 生成随机工具列表
fn arb_tool_list() -> impl Strategy<Value = Vec<String>> {
    prop::collection::vec(arb_tool_name(), 1..5)
}

// =============================================================================
// Property 2: 分组展开一致性
// Feature: tool-policy-system, Property 2: 分组展开一致性
// Validates: Requirements 2.3, 2.4, 2.7
// =============================================================================

proptest! {
    #![proptest_config(test_config())]

    /// 当分组被允许时，该分组中的所有工具都应该被允许
    #[test]
    fn prop_group_allow_expands_to_all_tools(group_name in arb_group_name()) {
        let groups = ToolGroups::default();

        // 创建允许该分组的策略
        let policy = ToolPolicy::new(PolicyLayer::Profile)
            .with_allow(vec![group_name.clone()]);

        // 展开分组
        let expanded = groups.expand_groups(&policy);

        // 验证分组中的所有工具都在展开后的 allow 列表中
        if let Some(tools) = groups.get_group(&group_name) {
            for tool in tools {
                prop_assert!(
                    expanded.allow.contains(tool),
                    "Tool '{}' from group '{}' should be in expanded allow list",
                    tool, group_name
                );
            }
        }
    }

    /// 当分组被拒绝时，该分组中的所有工具都应该被拒绝
    #[test]
    fn prop_group_deny_expands_to_all_tools(group_name in arb_group_name()) {
        let groups = ToolGroups::default();

        // 创建拒绝该分组的策略
        let policy = ToolPolicy::new(PolicyLayer::Profile)
            .with_deny(vec![group_name.clone()]);

        // 展开分组
        let expanded = groups.expand_groups(&policy);

        // 验证分组中的所有工具都在展开后的 deny 列表中
        if let Some(tools) = groups.get_group(&group_name) {
            for tool in tools {
                prop_assert!(
                    expanded.deny.contains(tool),
                    "Tool '{}' from group '{}' should be in expanded deny list",
                    tool, group_name
                );
            }
        }
    }

    /// 展开后的策略不应包含分组引用
    #[test]
    fn prop_expanded_policy_has_no_group_refs(group_name in arb_group_name()) {
        let groups = ToolGroups::default();

        let policy = ToolPolicy::new(PolicyLayer::Profile)
            .with_allow(vec![group_name.clone()])
            .with_deny(vec!["group:web".to_string()]);

        let expanded = groups.expand_groups(&policy);

        // 验证展开后的列表不包含已知分组引用
        for item in &expanded.allow {
            if groups.has_group(item) {
                prop_assert!(false, "Expanded allow list should not contain group reference: {}", item);
            }
        }
        for item in &expanded.deny {
            if groups.has_group(item) {
                prop_assert!(false, "Expanded deny list should not contain group reference: {}", item);
            }
        }
    }
}

// =============================================================================
// Property 7: 自定义分组注册
// Feature: tool-policy-system, Property 7: 自定义分组注册
// Validates: Requirements 2.5, 2.6
// =============================================================================

proptest! {
    #![proptest_config(test_config())]

    /// 注册自定义分组后，查询该分组应返回注册时的工具列表
    #[test]
    fn prop_custom_group_registration(
        group_suffix in "[a-z]{3,8}",
        tools in arb_tool_list()
    ) {
        let mut groups = ToolGroups::new();
        let group_name = format!("group:{}", group_suffix);

        // 注册自定义分组
        groups.register_group(&group_name, tools.clone());

        // 验证分组存在
        prop_assert!(groups.has_group(&group_name));

        // 验证工具列表一致
        let retrieved = groups.get_group(&group_name).unwrap();
        prop_assert_eq!(retrieved, &tools);
    }

    /// 添加工具到分组后，该工具应在分组中
    #[test]
    fn prop_add_tool_to_group(tool_name in arb_tool_name()) {
        let mut groups = ToolGroups::default();
        let group = "group:fs";

        // 添加工具
        groups.add_tool_to_group(group, tool_name.clone());

        // 验证工具在分组中
        prop_assert!(groups.tool_in_group(&tool_name, group));
    }

    /// 从分组移除工具后，该工具不应在分组中
    #[test]
    fn prop_remove_tool_from_group(group_name in arb_group_name()) {
        let mut groups = ToolGroups::default();

        // 获取分组中的第一个工具
        if let Some(tools) = groups.get_group(&group_name).cloned() {
            if let Some(tool) = tools.first() {
                // 移除工具
                groups.remove_tool_from_group(&group_name, tool);

                // 验证工具不在分组中
                prop_assert!(!groups.tool_in_group(tool, &group_name));
            }
        }
    }
}

// =============================================================================
// Property 1: Profile 工具集正确性
// Feature: tool-policy-system, Property 1: Profile 工具集正确性
// Validates: Requirements 1.2, 1.3, 1.4, 1.5
// =============================================================================

proptest! {
    #![proptest_config(test_config())]

    /// Minimal profile 只允许 session_status
    #[test]
    fn prop_minimal_profile_only_status(_dummy in 0..1i32) {
        let policy = ProfileManager::minimal_policy();
        prop_assert!(policy.allow.contains(&"session_status".to_string()));
        prop_assert_eq!(policy.allow.len(), 1);
    }

    /// Coding profile 允许 fs 和 runtime 分组
    #[test]
    fn prop_coding_profile_allows_fs_runtime(_dummy in 0..1i32) {
        let policy = ProfileManager::coding_policy();
        prop_assert!(policy.allow.contains(&"group:fs".to_string()));
        prop_assert!(policy.allow.contains(&"group:runtime".to_string()));
    }

    /// Messaging profile 允许 session 和 memory 分组
    #[test]
    fn prop_messaging_profile_allows_session_memory(_dummy in 0..1i32) {
        let policy = ProfileManager::messaging_policy();
        prop_assert!(policy.allow.contains(&"group:session".to_string()));
        prop_assert!(policy.allow.contains(&"group:memory".to_string()));
    }

    /// Full profile 允许所有工具
    #[test]
    fn prop_full_profile_allows_all(_dummy in 0..1i32) {
        let policy = ProfileManager::full_policy();
        prop_assert!(policy.allow.contains(&"*".to_string()));
    }
}

// =============================================================================
// Property 6: Profile 切换即时生效
// Feature: tool-policy-system, Property 6: Profile 切换即时生效
// Validates: Requirements 1.7
// =============================================================================

proptest! {
    #![proptest_config(test_config())]

    /// Profile 切换后立即生效
    #[test]
    fn prop_profile_switch_immediate(profile in arb_profile()) {
        let mut manager = ProfileManager::new();

        // 切换 Profile
        manager.set_profile(profile.clone());

        // 验证切换立即生效
        prop_assert_eq!(manager.current_profile(), &profile);
    }
}

// =============================================================================
// Property 3: 多层策略优先级
// Feature: tool-policy-system, Property 3: 多层策略优先级
// Validates: Requirements 3.1, 3.2, 3.4, 3.5
// =============================================================================

proptest! {
    #![proptest_config(test_config())]

    /// 高优先级层的 allow 覆盖低优先级层的 deny
    #[test]
    fn prop_higher_layer_allow_overrides_lower_deny(tool in arb_tool_name()) {
        let mut merger = PolicyMerger::default();

        // Global 层拒绝工具
        let global = ToolPolicy::new(PolicyLayer::Global)
            .with_deny(vec![tool.clone()]);
        merger.set_policy(PolicyLayer::Global, global);

        // Session 层允许工具
        let session = ToolPolicy::new(PolicyLayer::Session)
            .with_allow(vec![tool.clone()]);
        merger.set_policy(PolicyLayer::Session, session);

        // 验证工具被允许（Session 优先级更高）
        let decision = merger.is_tool_allowed(&tool);
        prop_assert!(decision.allowed, "Tool should be allowed by higher priority Session layer");
    }

    /// 高优先级层的 deny 覆盖低优先级层的 allow
    #[test]
    fn prop_higher_layer_deny_overrides_lower_allow(tool in arb_tool_name()) {
        let mut merger = PolicyMerger::default();

        // Profile 层允许工具
        let profile = ToolPolicy::new(PolicyLayer::Profile)
            .with_allow(vec![tool.clone()]);
        merger.set_policy(PolicyLayer::Profile, profile);

        // Agent 层拒绝工具
        let agent = ToolPolicy::new(PolicyLayer::Agent)
            .with_deny(vec![tool.clone()]);
        merger.set_policy(PolicyLayer::Agent, agent);

        // 验证工具被拒绝（Agent 优先级更高）
        let decision = merger.is_tool_allowed(&tool);
        prop_assert!(!decision.allowed, "Tool should be denied by higher priority Agent layer");
    }

    /// 策略层优先级顺序正确
    #[test]
    fn prop_layer_priority_order(_dummy in 0..1i32) {
        prop_assert!(PolicyLayer::Profile < PolicyLayer::Global);
        prop_assert!(PolicyLayer::Global < PolicyLayer::Agent);
        prop_assert!(PolicyLayer::Agent < PolicyLayer::Session);
    }
}

// =============================================================================
// Property 4: 配置 Round-Trip
// Feature: tool-policy-system, Property 4: 配置 Round-Trip
// Validates: Requirements 4.1, 4.2, 4.3
// =============================================================================

proptest! {
    #![proptest_config(test_config())]

    /// ToolPolicy 序列化后反序列化应等价
    #[test]
    fn prop_tool_policy_roundtrip(
        layer in arb_policy_layer(),
        allow in arb_tool_list(),
        deny in arb_tool_list()
    ) {
        let policy = ToolPolicy::new(layer)
            .with_allow(allow)
            .with_deny(deny)
            .with_description("Test policy");

        let json = serde_json::to_string(&policy).unwrap();
        let deserialized: ToolPolicy = serde_json::from_str(&json).unwrap();

        prop_assert_eq!(policy, deserialized);
    }

    /// ToolProfile 序列化后反序列化应等价
    #[test]
    fn prop_tool_profile_roundtrip(profile in arb_profile()) {
        let json = serde_json::to_string(&profile).unwrap();
        let deserialized: ToolProfile = serde_json::from_str(&json).unwrap();

        prop_assert_eq!(profile, deserialized);
    }

    /// PolicyLayer 序列化后反序列化应等价
    #[test]
    fn prop_policy_layer_roundtrip(layer in arb_policy_layer()) {
        let json = serde_json::to_string(&layer).unwrap();
        let deserialized: PolicyLayer = serde_json::from_str(&json).unwrap();

        prop_assert_eq!(layer, deserialized);
    }
}

// =============================================================================
// Property 5: 策略查询一致性
// Feature: tool-policy-system, Property 5: 策略查询一致性
// Validates: Requirements 6.1, 6.3, 6.4
// =============================================================================

proptest! {
    #![proptest_config(test_config())]

    /// is_tool_allowed 与 merge().is_allowed() 结果一致
    #[test]
    fn prop_query_consistency(tool in arb_tool_name()) {
        let mut merger = PolicyMerger::default();

        // 设置一些策略
        let profile = ToolPolicy::new(PolicyLayer::Profile)
            .with_allow(vec!["bash".to_string(), "file_read".to_string()]);
        merger.set_policy(PolicyLayer::Profile, profile);

        let merged = merger.merge();
        let decision = merger.is_tool_allowed(&tool);

        // 验证两种查询方式结果一致
        prop_assert_eq!(
            merged.is_allowed(&tool),
            decision.allowed,
            "is_tool_allowed and merge().is_allowed() should return same result"
        );
    }
}

// =============================================================================
// Property 8: 无效配置错误处理
// Feature: tool-policy-system, Property 8: 无效配置错误处理
// Validates: Requirements 4.4
// =============================================================================

proptest! {
    #![proptest_config(test_config())]

    /// 无效 JSON 应返回错误而不是 panic
    #[test]
    fn prop_invalid_json_returns_error(invalid_json in "[a-z]{5,20}") {
        let result = ProfileManager::import_profile(&invalid_json);
        prop_assert!(result.is_err());
    }

    /// 缺少必需字段的 JSON 应返回错误
    #[test]
    fn prop_missing_fields_returns_error(_dummy in 0..1i32) {
        let incomplete_json = r#"{"version": "1.0.0"}"#;
        let result = ProfileManager::import_profile(incomplete_json);
        prop_assert!(result.is_err());
    }
}

// =============================================================================
// Property 9: 向后兼容性
// Feature: tool-policy-system, Property 9: 向后兼容性
// Validates: Requirements 5.2, 5.4
// =============================================================================

use super::migration::PolicyMigration;

proptest! {
    #![proptest_config(test_config())]

    /// 旧格式配置迁移后应保持相同的权限行为
    #[test]
    fn prop_migration_preserves_permissions(
        allowed in arb_tool_list(),
        denied in arb_tool_list()
    ) {
        let old_json = serde_json::json!({
            "allowed_tools": allowed,
            "denied_tools": denied
        }).to_string();

        let policy = PolicyMigration::migrate_from_old_format(&old_json).unwrap();

        // 验证允许列表一致
        for tool in &allowed {
            prop_assert!(
                policy.allow.contains(tool),
                "Migrated policy should preserve allowed tool: {}", tool
            );
        }

        // 验证拒绝列表一致
        for tool in &denied {
            prop_assert!(
                policy.deny.contains(tool),
                "Migrated policy should preserve denied tool: {}", tool
            );
        }
    }

    /// auto_migrate 应正确识别格式并处理
    #[test]
    fn prop_auto_migrate_handles_both_formats(tool in arb_tool_name()) {
        // 旧格式
        let old_json = serde_json::json!({
            "allowed_tools": [tool.clone()]
        }).to_string();
        let old_result = PolicyMigration::auto_migrate(&old_json);
        prop_assert!(old_result.is_ok());
        prop_assert!(old_result.unwrap().allow.contains(&tool));

        // 新格式
        let new_json = serde_json::json!({
            "layer": "Global",
            "allow": [tool.clone()],
            "deny": []
        }).to_string();
        let new_result = PolicyMigration::auto_migrate(&new_json);
        prop_assert!(new_result.is_ok());
        prop_assert!(new_result.unwrap().allow.contains(&tool));
    }
}
