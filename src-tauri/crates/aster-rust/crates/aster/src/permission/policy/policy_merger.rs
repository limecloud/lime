//! 多层策略合并器模块
//!
//! 本模块实现多层策略合并，支持：
//! - 四层策略（Profile → Global → Agent → Session）
//! - 高优先级覆盖低优先级
//! - 分组引用展开
//!
//! # Requirements
//!
//! - 3.1: 支持四层策略
//! - 3.2: 高优先级策略生效
//! - 3.3: 合并策略配置
//! - 3.4: 高层 allow 覆盖低层 deny
//! - 3.5: 高层 deny 覆盖低层 allow
//! - 3.6: 策略继承配置
//! - 3.7: 查看有效合并策略

use std::collections::{HashMap, HashSet};

use super::groups::ToolGroups;
use super::types::{normalize_tool_name, MergedPolicy, PolicyDecision, PolicyLayer, ToolPolicy};

/// 多层策略合并器
///
/// 管理和合并多层策略
#[derive(Debug, Clone)]
pub struct PolicyMerger {
    /// Profile 策略
    profile_policy: Option<ToolPolicy>,
    /// 全局策略
    global_policy: Option<ToolPolicy>,
    /// Agent 策略
    agent_policy: Option<ToolPolicy>,
    /// 会话策略
    session_policy: Option<ToolPolicy>,
    /// 工具分组注册表
    tool_groups: ToolGroups,
}

impl Default for PolicyMerger {
    fn default() -> Self {
        Self::new(ToolGroups::default())
    }
}

impl PolicyMerger {
    /// 创建新的合并器
    pub fn new(tool_groups: ToolGroups) -> Self {
        Self {
            profile_policy: None,
            global_policy: None,
            agent_policy: None,
            session_policy: None,
            tool_groups,
        }
    }

    /// 设置指定层的策略
    ///
    /// # Requirements
    ///
    /// - 3.1: 支持四层策略
    pub fn set_policy(&mut self, layer: PolicyLayer, policy: ToolPolicy) {
        match layer {
            PolicyLayer::Profile => self.profile_policy = Some(policy),
            PolicyLayer::Global => self.global_policy = Some(policy),
            PolicyLayer::Agent => self.agent_policy = Some(policy),
            PolicyLayer::Session => self.session_policy = Some(policy),
        }
    }

    /// 清除指定层的策略
    pub fn clear_policy(&mut self, layer: PolicyLayer) {
        match layer {
            PolicyLayer::Profile => self.profile_policy = None,
            PolicyLayer::Global => self.global_policy = None,
            PolicyLayer::Agent => self.agent_policy = None,
            PolicyLayer::Session => self.session_policy = None,
        }
    }

    /// 获取指定层的策略
    pub fn get_policy(&self, layer: PolicyLayer) -> Option<&ToolPolicy> {
        match layer {
            PolicyLayer::Profile => self.profile_policy.as_ref(),
            PolicyLayer::Global => self.global_policy.as_ref(),
            PolicyLayer::Agent => self.agent_policy.as_ref(),
            PolicyLayer::Session => self.session_policy.as_ref(),
        }
    }

    /// 获取工具分组注册表
    pub fn tool_groups(&self) -> &ToolGroups {
        &self.tool_groups
    }

    /// 获取可变的工具分组注册表
    pub fn tool_groups_mut(&mut self) -> &mut ToolGroups {
        &mut self.tool_groups
    }

    /// 合并所有层的策略
    ///
    /// 按优先级从低到高合并：Profile → Global → Agent → Session
    ///
    /// # Requirements
    ///
    /// - 3.2: 高优先级策略生效
    /// - 3.7: 查看有效合并策略
    pub fn merge(&self) -> MergedPolicy {
        let mut result = MergedPolicy::new();
        let mut tool_sources: HashMap<String, PolicyLayer> = HashMap::new();

        // 按优先级从低到高处理各层
        let layers = [
            (PolicyLayer::Profile, &self.profile_policy),
            (PolicyLayer::Global, &self.global_policy),
            (PolicyLayer::Agent, &self.agent_policy),
            (PolicyLayer::Session, &self.session_policy),
        ];

        for (layer, policy_opt) in layers {
            if let Some(policy) = policy_opt {
                // 展开分组引用
                let expanded = self.tool_groups.expand_groups(policy);

                // 处理 allow 列表
                for tool in &expanded.allow {
                    if tool == "*" {
                        result.allow_all = true;
                        tool_sources.insert("*".to_string(), layer);
                    } else {
                        let normalized_tool = normalize_tool_name(tool);
                        result.allowed_tools.insert(normalized_tool.clone());
                        result.denied_tools.remove(&normalized_tool);
                        tool_sources.insert(normalized_tool, layer);
                    }
                }

                // 处理 deny 列表（deny 优先级高于同层 allow）
                for tool in &expanded.deny {
                    if tool == "*" {
                        result.allow_all = false;
                        result.allowed_tools.clear();
                    }
                    let normalized_tool = normalize_tool_name(tool);
                    result.denied_tools.insert(normalized_tool.clone());
                    result.allowed_tools.remove(&normalized_tool);
                    tool_sources.insert(normalized_tool, layer);
                }
            }
        }

        result.tool_sources = tool_sources;
        result
    }

    /// 检查工具是否被允许
    ///
    /// # Requirements
    ///
    /// - 3.4: 高层 allow 覆盖低层 deny
    /// - 3.5: 高层 deny 覆盖低层 allow
    pub fn is_tool_allowed(&self, tool: &str) -> PolicyDecision {
        let merged = self.merge();
        let normalized_tool = normalize_tool_name(tool);

        if merged.denied_tools.contains(&normalized_tool) {
            let source = merged.get_source(tool).unwrap_or(PolicyLayer::Profile);
            return PolicyDecision::deny(source, format!("Tool '{}' is explicitly denied", tool));
        }

        if merged.allow_all {
            let source = merged.get_source("*").unwrap_or(PolicyLayer::Profile);
            return PolicyDecision::allow(source, "All tools are allowed");
        }

        if merged.allowed_tools.contains(&normalized_tool) {
            let source = merged.get_source(tool).unwrap_or(PolicyLayer::Profile);
            return PolicyDecision::allow(source, format!("Tool '{}' is explicitly allowed", tool));
        }

        // 默认拒绝
        PolicyDecision::deny(
            PolicyLayer::Profile,
            format!("Tool '{}' is not in allow list", tool),
        )
    }

    /// 获取工具的有效策略来源
    pub fn get_policy_source(&self, tool: &str) -> Option<PolicyLayer> {
        self.merge().get_source(tool)
    }

    /// 获取所有允许的工具
    pub fn get_allowed_tools(&self) -> HashSet<String> {
        self.merge().allowed_tools
    }

    /// 获取所有拒绝的工具
    pub fn get_denied_tools(&self) -> HashSet<String> {
        self.merge().denied_tools
    }
}

// =============================================================================
// 单元测试
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_policy_merger_default() {
        let merger = PolicyMerger::default();
        assert!(merger.profile_policy.is_none());
        assert!(merger.global_policy.is_none());
        assert!(merger.agent_policy.is_none());
        assert!(merger.session_policy.is_none());
    }

    #[test]
    fn test_set_and_get_policy() {
        let mut merger = PolicyMerger::default();
        let policy = ToolPolicy::new(PolicyLayer::Global).with_allow(vec!["bash".to_string()]);

        merger.set_policy(PolicyLayer::Global, policy.clone());

        let retrieved = merger.get_policy(PolicyLayer::Global).unwrap();
        assert_eq!(retrieved.allow, policy.allow);
    }

    #[test]
    fn test_clear_policy() {
        let mut merger = PolicyMerger::default();
        let policy = ToolPolicy::new(PolicyLayer::Global);

        merger.set_policy(PolicyLayer::Global, policy);
        assert!(merger.get_policy(PolicyLayer::Global).is_some());

        merger.clear_policy(PolicyLayer::Global);
        assert!(merger.get_policy(PolicyLayer::Global).is_none());
    }

    #[test]
    fn test_merge_single_layer() {
        let mut merger = PolicyMerger::default();
        let policy = ToolPolicy::new(PolicyLayer::Profile)
            .with_allow(vec!["bash".to_string(), "file_read".to_string()]);

        merger.set_policy(PolicyLayer::Profile, policy);
        let merged = merger.merge();

        assert!(merged.allowed_tools.contains("bash"));
        assert!(merged.allowed_tools.contains("file_read"));
    }

    #[test]
    fn test_merge_multi_layer_override() {
        let mut merger = PolicyMerger::default();

        // Profile 层允许 bash
        let profile = ToolPolicy::new(PolicyLayer::Profile).with_allow(vec!["bash".to_string()]);
        merger.set_policy(PolicyLayer::Profile, profile);

        // Global 层拒绝 bash
        let global = ToolPolicy::new(PolicyLayer::Global).with_deny(vec!["bash".to_string()]);
        merger.set_policy(PolicyLayer::Global, global);

        let merged = merger.merge();

        // Global 层优先级更高，bash 应被拒绝
        assert!(merged.denied_tools.contains("bash"));
        assert!(!merged.allowed_tools.contains("bash"));
    }

    #[test]
    fn test_higher_layer_allow_overrides_lower_deny() {
        let mut merger = PolicyMerger::default();

        // Global 层拒绝 bash
        let global = ToolPolicy::new(PolicyLayer::Global).with_deny(vec!["bash".to_string()]);
        merger.set_policy(PolicyLayer::Global, global);

        // Session 层允许 bash
        let session = ToolPolicy::new(PolicyLayer::Session).with_allow(vec!["bash".to_string()]);
        merger.set_policy(PolicyLayer::Session, session);

        let merged = merger.merge();

        // Session 层优先级更高，bash 应被允许
        assert!(merged.allowed_tools.contains("bash"));
        assert!(!merged.denied_tools.contains("bash"));
    }

    #[test]
    fn test_is_tool_allowed() {
        let mut merger = PolicyMerger::default();
        let policy = ToolPolicy::new(PolicyLayer::Profile)
            .with_allow(vec!["bash".to_string()])
            .with_deny(vec!["rm".to_string()]);

        merger.set_policy(PolicyLayer::Profile, policy);

        let bash_decision = merger.is_tool_allowed("bash");
        assert!(bash_decision.allowed);

        let rm_decision = merger.is_tool_allowed("rm");
        assert!(!rm_decision.allowed);

        let unknown_decision = merger.is_tool_allowed("unknown");
        assert!(!unknown_decision.allowed);
    }

    #[test]
    fn test_allow_all() {
        let mut merger = PolicyMerger::default();
        let policy = ToolPolicy::new(PolicyLayer::Profile).with_allow(vec!["*".to_string()]);

        merger.set_policy(PolicyLayer::Profile, policy);

        let decision = merger.is_tool_allowed("any_tool");
        assert!(decision.allowed);
    }

    #[test]
    fn test_group_expansion_in_merge() {
        let mut merger = PolicyMerger::default();
        let policy =
            ToolPolicy::new(PolicyLayer::Profile).with_allow(vec!["group:runtime".to_string()]);

        merger.set_policy(PolicyLayer::Profile, policy);
        let merged = merger.merge();

        // group:runtime 应展开为具体工具
        assert!(merged.allowed_tools.contains("bash"));
        assert!(merged.allowed_tools.contains("exec"));
    }

    #[test]
    fn test_get_policy_source() {
        let mut merger = PolicyMerger::default();

        let profile = ToolPolicy::new(PolicyLayer::Profile).with_allow(vec!["bash".to_string()]);
        merger.set_policy(PolicyLayer::Profile, profile);

        let global = ToolPolicy::new(PolicyLayer::Global).with_allow(vec!["file_read".to_string()]);
        merger.set_policy(PolicyLayer::Global, global);

        assert_eq!(merger.get_policy_source("bash"), Some(PolicyLayer::Profile));
        assert_eq!(
            merger.get_policy_source("file_read"),
            Some(PolicyLayer::Global)
        );
    }
}
