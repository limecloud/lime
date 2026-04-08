//! Tool Groups 工具分组模块
//!
//! 本模块实现工具分组注册表，支持：
//! - 预定义的默认分组（group:fs, group:runtime, group:memory, group:web, group:session）
//! - 自定义分组注册
//! - 分组引用展开
//!
//! # Requirements
//!
//! - 2.1: 支持预定义工具分组
//! - 2.2: 包含默认分组
//! - 2.3: 分组允许时允许所有工具
//! - 2.4: 分组拒绝时拒绝所有工具
//! - 2.5: 支持自定义分组
//! - 2.6: 支持修改分组
//! - 2.7: 展开分组引用

use std::collections::HashMap;

use super::types::{PolicyError, ToolPolicy};

/// 工具分组注册表
///
/// 管理工具分组的注册和查询
#[derive(Debug, Clone)]
pub struct ToolGroups {
    /// 分组名称 -> 工具列表
    groups: HashMap<String, Vec<String>>,
}

impl Default for ToolGroups {
    fn default() -> Self {
        let mut groups = HashMap::new();

        // group:fs - 文件系统操作
        groups.insert(
            "group:fs".to_string(),
            vec![
                "file_read".to_string(),
                "file_write".to_string(),
                "file_edit".to_string(),
                "file_delete".to_string(),
                "file_create".to_string(),
                "file_list".to_string(),
                "file_search".to_string(),
                "apply_patch".to_string(),
            ],
        );

        // group:runtime - 运行时操作
        groups.insert(
            "group:runtime".to_string(),
            vec![
                "bash".to_string(),
                "exec".to_string(),
                "process".to_string(),
                "shell".to_string(),
            ],
        );

        // group:memory - 内存操作
        groups.insert(
            "group:memory".to_string(),
            vec![
                "memory_search".to_string(),
                "memory_get".to_string(),
                "memory_store".to_string(),
                "memory_delete".to_string(),
            ],
        );

        // group:web - 网络操作
        groups.insert(
            "group:web".to_string(),
            vec![
                "web_search".to_string(),
                "web_fetch".to_string(),
                "http_request".to_string(),
            ],
        );

        // group:session - 会话操作
        groups.insert(
            "group:session".to_string(),
            vec![
                "session_list".to_string(),
                "session_history".to_string(),
                "session_status".to_string(),
                "session_create".to_string(),
            ],
        );

        Self { groups }
    }
}

impl ToolGroups {
    /// 创建新的空分组注册表
    pub fn new() -> Self {
        Self {
            groups: HashMap::new(),
        }
    }

    /// 创建带默认分组的注册表
    pub fn with_defaults() -> Self {
        Self::default()
    }

    /// 注册自定义分组
    ///
    /// # Arguments
    ///
    /// * `name` - 分组名称（建议使用 "group:" 前缀）
    /// * `tools` - 工具列表
    ///
    /// # Requirements
    ///
    /// - 2.5: 支持自定义分组
    pub fn register_group(&mut self, name: impl Into<String>, tools: Vec<String>) {
        self.groups.insert(name.into(), tools);
    }

    /// 获取分组中的工具
    ///
    /// # Arguments
    ///
    /// * `name` - 分组名称
    ///
    /// # Returns
    ///
    /// 分组存在时返回工具列表，否则返回 None
    pub fn get_group(&self, name: &str) -> Option<&Vec<String>> {
        self.groups.get(name)
    }

    /// 获取分组中的工具（返回 Result）
    ///
    /// # Arguments
    ///
    /// * `name` - 分组名称
    ///
    /// # Returns
    ///
    /// 分组存在时返回工具列表，否则返回 GroupNotFound 错误
    pub fn get_group_or_error(&self, name: &str) -> Result<&Vec<String>, PolicyError> {
        self.groups
            .get(name)
            .ok_or_else(|| PolicyError::GroupNotFound(name.to_string()))
    }

    /// 检查分组是否存在
    pub fn has_group(&self, name: &str) -> bool {
        self.groups.contains_key(name)
    }

    /// 获取所有分组名称
    pub fn group_names(&self) -> Vec<&String> {
        self.groups.keys().collect()
    }

    /// 添加工具到分组
    ///
    /// # Arguments
    ///
    /// * `group` - 分组名称
    /// * `tool` - 工具名称
    ///
    /// # Requirements
    ///
    /// - 2.6: 支持修改分组
    pub fn add_tool_to_group(&mut self, group: &str, tool: impl Into<String>) {
        if let Some(tools) = self.groups.get_mut(group) {
            tools.push(tool.into());
        }
    }

    /// 从分组中移除工具
    ///
    /// # Arguments
    ///
    /// * `group` - 分组名称
    /// * `tool` - 工具名称
    ///
    /// # Requirements
    ///
    /// - 2.6: 支持修改分组
    pub fn remove_tool_from_group(&mut self, group: &str, tool: &str) {
        if let Some(tools) = self.groups.get_mut(group) {
            tools.retain(|t| t != tool);
        }
    }

    /// 检查工具是否属于某分组
    ///
    /// # Arguments
    ///
    /// * `tool` - 工具名称
    /// * `group` - 分组名称
    ///
    /// # Returns
    ///
    /// 工具属于分组返回 true，否则返回 false
    pub fn tool_in_group(&self, tool: &str, group: &str) -> bool {
        self.groups
            .get(group)
            .map(|tools| tools.iter().any(|t| t == tool))
            .unwrap_or(false)
    }

    /// 查找工具所属的所有分组
    ///
    /// # Arguments
    ///
    /// * `tool` - 工具名称
    ///
    /// # Returns
    ///
    /// 包含该工具的所有分组名称
    pub fn find_groups_for_tool(&self, tool: &str) -> Vec<&String> {
        self.groups
            .iter()
            .filter(|(_, tools)| tools.iter().any(|t| t == tool))
            .map(|(name, _)| name)
            .collect()
    }

    /// 展开分组引用为具体工具
    ///
    /// 将策略中的分组引用（如 "group:fs"）展开为具体的工具列表
    ///
    /// # Arguments
    ///
    /// * `policy` - 原始策略
    ///
    /// # Returns
    ///
    /// 展开后的策略
    ///
    /// # Requirements
    ///
    /// - 2.7: 展开分组引用
    pub fn expand_groups(&self, policy: &ToolPolicy) -> ToolPolicy {
        let mut expanded = policy.clone();

        // 展开 allow 列表
        let mut expanded_allow = Vec::new();
        for item in &policy.allow {
            if item.starts_with("group:") {
                if let Some(tools) = self.groups.get(item) {
                    expanded_allow.extend(tools.clone());
                } else {
                    // 保留未知分组引用
                    expanded_allow.push(item.clone());
                }
            } else {
                expanded_allow.push(item.clone());
            }
        }
        expanded.allow = expanded_allow;

        // 展开 deny 列表
        let mut expanded_deny = Vec::new();
        for item in &policy.deny {
            if item.starts_with("group:") {
                if let Some(tools) = self.groups.get(item) {
                    expanded_deny.extend(tools.clone());
                } else {
                    // 保留未知分组引用
                    expanded_deny.push(item.clone());
                }
            } else {
                expanded_deny.push(item.clone());
            }
        }
        expanded.deny = expanded_deny;

        expanded
    }

    /// 检查字符串是否为分组引用
    pub fn is_group_reference(s: &str) -> bool {
        s.starts_with("group:")
    }
}

// =============================================================================
// 单元测试
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::permission::policy::types::PolicyLayer;
    use proptest::prelude::*;

    #[test]
    fn test_default_groups() {
        let groups = ToolGroups::default();

        // 验证默认分组存在
        assert!(groups.has_group("group:fs"));
        assert!(groups.has_group("group:runtime"));
        assert!(groups.has_group("group:memory"));
        assert!(groups.has_group("group:web"));
        assert!(groups.has_group("group:session"));
    }

    #[test]
    fn test_default_group_contents() {
        let groups = ToolGroups::default();

        // 验证 group:fs 内容
        let fs_tools = groups.get_group("group:fs").unwrap();
        assert!(fs_tools.contains(&"file_read".to_string()));
        assert!(fs_tools.contains(&"file_write".to_string()));
        assert!(fs_tools.contains(&"apply_patch".to_string()));

        // 验证 group:runtime 内容
        let runtime_tools = groups.get_group("group:runtime").unwrap();
        assert!(runtime_tools.contains(&"bash".to_string()));
        assert!(runtime_tools.contains(&"exec".to_string()));
    }

    #[test]
    fn test_register_custom_group() {
        let mut groups = ToolGroups::new();
        groups.register_group(
            "group:custom",
            vec!["tool1".to_string(), "tool2".to_string()],
        );

        assert!(groups.has_group("group:custom"));
        let tools = groups.get_group("group:custom").unwrap();
        assert_eq!(tools.len(), 2);
        assert!(tools.contains(&"tool1".to_string()));
    }

    #[test]
    fn test_tool_in_group() {
        let groups = ToolGroups::default();

        assert!(groups.tool_in_group("bash", "group:runtime"));
        assert!(groups.tool_in_group("file_read", "group:fs"));
        assert!(!groups.tool_in_group("bash", "group:fs"));
        assert!(!groups.tool_in_group("unknown", "group:runtime"));
    }

    #[test]
    fn test_add_tool_to_group() {
        let mut groups = ToolGroups::default();
        groups.add_tool_to_group("group:runtime", "new_tool");

        let tools = groups.get_group("group:runtime").unwrap();
        assert!(tools.contains(&"new_tool".to_string()));
    }

    #[test]
    fn test_remove_tool_from_group() {
        let mut groups = ToolGroups::default();
        groups.remove_tool_from_group("group:runtime", "bash");

        let tools = groups.get_group("group:runtime").unwrap();
        assert!(!tools.contains(&"bash".to_string()));
    }

    #[test]
    fn test_find_groups_for_tool() {
        let groups = ToolGroups::default();

        let bash_groups = groups.find_groups_for_tool("bash");
        assert_eq!(bash_groups.len(), 1);
        assert!(bash_groups.contains(&&"group:runtime".to_string()));

        let unknown_groups = groups.find_groups_for_tool("unknown_tool");
        assert!(unknown_groups.is_empty());
    }

    #[test]
    fn test_expand_groups() {
        let groups = ToolGroups::default();

        let policy = ToolPolicy::new(PolicyLayer::Global)
            .with_allow(vec!["group:runtime".to_string(), "custom_tool".to_string()])
            .with_deny(vec!["group:web".to_string()]);

        let expanded = groups.expand_groups(&policy);

        // 验证 allow 列表展开
        assert!(expanded.allow.contains(&"bash".to_string()));
        assert!(expanded.allow.contains(&"exec".to_string()));
        assert!(expanded.allow.contains(&"custom_tool".to_string()));
        assert!(!expanded.allow.contains(&"group:runtime".to_string()));

        // 验证 deny 列表展开
        assert!(expanded.deny.contains(&"web_search".to_string()));
        assert!(expanded.deny.contains(&"web_fetch".to_string()));
    }

    #[test]
    fn test_expand_unknown_group() {
        let groups = ToolGroups::default();

        let policy =
            ToolPolicy::new(PolicyLayer::Global).with_allow(vec!["group:unknown".to_string()]);

        let expanded = groups.expand_groups(&policy);

        // 未知分组应保留原样
        assert!(expanded.allow.contains(&"group:unknown".to_string()));
    }

    #[test]
    fn test_is_group_reference() {
        assert!(ToolGroups::is_group_reference("group:fs"));
        assert!(ToolGroups::is_group_reference("group:custom"));
        assert!(!ToolGroups::is_group_reference("bash"));
        assert!(!ToolGroups::is_group_reference("file_read"));
    }

    #[test]
    fn test_get_group_or_error() {
        let groups = ToolGroups::default();

        assert!(groups.get_group_or_error("group:fs").is_ok());
        assert!(matches!(
            groups.get_group_or_error("group:unknown"),
            Err(PolicyError::GroupNotFound(_))
        ));
    }

    #[test]
    fn test_group_names() {
        let groups = ToolGroups::default();
        let names = groups.group_names();

        assert_eq!(names.len(), 5);
        assert!(names.contains(&&"group:fs".to_string()));
        assert!(names.contains(&&"group:runtime".to_string()));
    }

    // =========================================================================
    // Property-Based Tests
    // =========================================================================

    /// 生成随机分组名称
    ///
    /// 包含预定义分组和随机自定义分组
    fn prop_group_name() -> impl Strategy<Value = String> {
        prop_oneof![
            Just("group:fs".to_string()),
            Just("group:runtime".to_string()),
            Just("group:memory".to_string()),
            Just("group:web".to_string()),
            Just("group:session".to_string()),
            "[a-z]{3,10}".prop_map(|s| format!("group:{}", s)),
        ]
    }

    /// 生成随机工具名称
    fn prop_tool_name() -> impl Strategy<Value = String> {
        "[a-z_]{3,15}".prop_map(String::from)
    }

    /// 生成随机工具列表（1-10 个工具）
    fn prop_tool_list() -> impl Strategy<Value = Vec<String>> {
        prop::collection::vec(prop_tool_name(), 1..=10)
    }

    /// 生成随机策略层级
    fn prop_policy_layer() -> impl Strategy<Value = PolicyLayer> {
        prop_oneof![
            Just(PolicyLayer::Profile),
            Just(PolicyLayer::Global),
            Just(PolicyLayer::Agent),
            Just(PolicyLayer::Session),
        ]
    }

    // =========================================================================
    // Property 2: 分组展开一致性
    // =========================================================================
    //
    // **Validates: Requirements 2.3, 2.4, 2.7**
    //
    // *For any* 工具分组和该分组中的任意工具，当分组被允许时，该分组中的所有工具
    // 都应该被允许；当分组被拒绝时，该分组中的所有工具都应该被拒绝。
    //
    // 测试策略：
    // 1. 创建一个包含随机工具的自定义分组
    // 2. 创建一个允许该分组的策略
    // 3. 展开策略后，验证分组中的所有工具都在允许列表中
    // 4. 创建一个拒绝该分组的策略
    // 5. 展开策略后，验证分组中的所有工具都在拒绝列表中
    // 6. 验证展开的一致性（相同输入产生相同输出）

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(100))]

        /// Feature: tool-policy-system, Property 2: 分组展开一致性
        ///
        /// **Validates: Requirements 2.3, 2.4, 2.7**
        ///
        /// 测试分组允许时，所有工具都被允许
        #[test]
        fn prop_group_allow_expands_to_all_tools(
            group_suffix in "[a-z]{3,10}",
            tools in prop_tool_list(),
            layer in prop_policy_layer()
        ) {
            let group_name = format!("group:{}", group_suffix);

            // 创建分组注册表并注册自定义分组
            let mut groups = ToolGroups::new();
            groups.register_group(&group_name, tools.clone());

            // 创建允许该分组的策略
            let policy = ToolPolicy::new(layer)
                .with_allow(vec![group_name.clone()]);

            // 展开分组
            let expanded = groups.expand_groups(&policy);

            // 验证：分组中的所有工具都应该在展开后的允许列表中
            // Requirements 2.3: 分组允许时允许所有工具
            for tool in &tools {
                prop_assert!(
                    expanded.allow.contains(tool),
                    "Tool '{}' from group '{}' should be in allow list after expansion",
                    tool, group_name
                );
            }

            // 验证：原始分组引用不应该在展开后的列表中
            // Requirements 2.7: 展开分组引用
            prop_assert!(
                !expanded.allow.contains(&group_name),
                "Group reference '{}' should be expanded, not kept in allow list",
                group_name
            );

            // 验证：展开后的允许列表长度应该等于工具数量
            prop_assert_eq!(
                expanded.allow.len(),
                tools.len(),
                "Expanded allow list should contain exactly the tools from the group"
            );
        }

        /// Feature: tool-policy-system, Property 2: 分组展开一致性
        ///
        /// **Validates: Requirements 2.3, 2.4, 2.7**
        ///
        /// 测试分组拒绝时，所有工具都被拒绝
        #[test]
        fn prop_group_deny_expands_to_all_tools(
            group_suffix in "[a-z]{3,10}",
            tools in prop_tool_list(),
            layer in prop_policy_layer()
        ) {
            let group_name = format!("group:{}", group_suffix);

            // 创建分组注册表并注册自定义分组
            let mut groups = ToolGroups::new();
            groups.register_group(&group_name, tools.clone());

            // 创建拒绝该分组的策略
            let policy = ToolPolicy::new(layer)
                .with_deny(vec![group_name.clone()]);

            // 展开分组
            let expanded = groups.expand_groups(&policy);

            // 验证：分组中的所有工具都应该在展开后的拒绝列表中
            // Requirements 2.4: 分组拒绝时拒绝所有工具
            for tool in &tools {
                prop_assert!(
                    expanded.deny.contains(tool),
                    "Tool '{}' from group '{}' should be in deny list after expansion",
                    tool, group_name
                );
            }

            // 验证：原始分组引用不应该在展开后的列表中
            // Requirements 2.7: 展开分组引用
            prop_assert!(
                !expanded.deny.contains(&group_name),
                "Group reference '{}' should be expanded, not kept in deny list",
                group_name
            );

            // 验证：展开后的拒绝列表长度应该等于工具数量
            prop_assert_eq!(
                expanded.deny.len(),
                tools.len(),
                "Expanded deny list should contain exactly the tools from the group"
            );
        }

        /// Feature: tool-policy-system, Property 2: 分组展开一致性
        ///
        /// **Validates: Requirements 2.3, 2.4, 2.7**
        ///
        /// 测试展开的一致性：相同输入总是产生相同输出
        #[test]
        fn prop_group_expansion_is_deterministic(
            group_suffix in "[a-z]{3,10}",
            tools in prop_tool_list(),
            layer in prop_policy_layer()
        ) {
            let group_name = format!("group:{}", group_suffix);

            // 创建分组注册表并注册自定义分组
            let mut groups = ToolGroups::new();
            groups.register_group(&group_name, tools.clone());

            // 创建包含分组的策略
            let policy = ToolPolicy::new(layer)
                .with_allow(vec![group_name.clone()])
                .with_deny(vec![format!("group:other_{}", group_suffix)]);

            // 多次展开，验证结果一致
            let expanded1 = groups.expand_groups(&policy);
            let expanded2 = groups.expand_groups(&policy);
            let expanded3 = groups.expand_groups(&policy);

            // 验证：多次展开的结果应该完全相同
            prop_assert_eq!(
                &expanded1.allow, &expanded2.allow,
                "First and second expansion should produce identical allow lists"
            );
            prop_assert_eq!(
                &expanded2.allow, &expanded3.allow,
                "Second and third expansion should produce identical allow lists"
            );
            prop_assert_eq!(
                &expanded1.deny, &expanded2.deny,
                "First and second expansion should produce identical deny lists"
            );
            prop_assert_eq!(
                &expanded2.deny, &expanded3.deny,
                "Second and third expansion should produce identical deny lists"
            );
        }

        /// Feature: tool-policy-system, Property 2: 分组展开一致性
        ///
        /// **Validates: Requirements 2.3, 2.4, 2.7**
        ///
        /// 测试默认分组的展开一致性
        #[test]
        fn prop_default_group_expansion_consistency(
            group_name in prop_oneof![
                Just("group:fs".to_string()),
                Just("group:runtime".to_string()),
                Just("group:memory".to_string()),
                Just("group:web".to_string()),
                Just("group:session".to_string()),
            ],
            layer in prop_policy_layer()
        ) {
            let groups = ToolGroups::default();

            // 获取分组中的工具
            let tools = groups.get_group(&group_name).unwrap().clone();

            // 创建允许该分组的策略
            let allow_policy = ToolPolicy::new(layer)
                .with_allow(vec![group_name.clone()]);

            // 创建拒绝该分组的策略
            let deny_policy = ToolPolicy::new(layer)
                .with_deny(vec![group_name.clone()]);

            // 展开策略
            let expanded_allow = groups.expand_groups(&allow_policy);
            let expanded_deny = groups.expand_groups(&deny_policy);

            // 验证：允许策略展开后包含所有工具
            for tool in &tools {
                prop_assert!(
                    expanded_allow.allow.contains(tool),
                    "Default group '{}' tool '{}' should be in allow list",
                    group_name, tool
                );
            }

            // 验证：拒绝策略展开后包含所有工具
            for tool in &tools {
                prop_assert!(
                    expanded_deny.deny.contains(tool),
                    "Default group '{}' tool '{}' should be in deny list",
                    group_name, tool
                );
            }

            // 验证：分组引用被正确展开
            prop_assert!(
                !expanded_allow.allow.contains(&group_name),
                "Group reference should be expanded in allow list"
            );
            prop_assert!(
                !expanded_deny.deny.contains(&group_name),
                "Group reference should be expanded in deny list"
            );
        }

        /// Feature: tool-policy-system, Property 2: 分组展开一致性
        ///
        /// **Validates: Requirements 2.3, 2.4, 2.7**
        ///
        /// 测试混合策略（同时包含分组和单独工具）的展开
        #[test]
        fn prop_mixed_policy_expansion(
            group_suffix in "[a-z]{3,10}",
            group_tools in prop_tool_list(),
            individual_tools in prop::collection::vec(prop_tool_name(), 0..=5),
            layer in prop_policy_layer()
        ) {
            let group_name = format!("group:{}", group_suffix);

            // 创建分组注册表
            let mut groups = ToolGroups::new();
            groups.register_group(&group_name, group_tools.clone());

            // 创建混合策略：包含分组引用和单独工具
            let mut allow_list = vec![group_name.clone()];
            allow_list.extend(individual_tools.clone());

            let policy = ToolPolicy::new(layer)
                .with_allow(allow_list);

            // 展开策略
            let expanded = groups.expand_groups(&policy);

            // 验证：分组中的所有工具都在展开后的列表中
            for tool in &group_tools {
                prop_assert!(
                    expanded.allow.contains(tool),
                    "Group tool '{}' should be in expanded allow list",
                    tool
                );
            }

            // 验证：单独的工具也在展开后的列表中
            for tool in &individual_tools {
                prop_assert!(
                    expanded.allow.contains(tool),
                    "Individual tool '{}' should be preserved in expanded allow list",
                    tool
                );
            }

            // 验证：分组引用被展开
            prop_assert!(
                !expanded.allow.contains(&group_name),
                "Group reference should be expanded"
            );
        }
    }
}
