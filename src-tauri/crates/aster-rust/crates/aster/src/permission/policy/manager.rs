//! Tool Policy 系统主管理器
//!
//! 本模块实现 ToolPolicyManager，整合所有 Policy 子系统：
//! - Profile 管理
//! - 策略合并
//! - 权限检查
//!
//! # Requirements
//!
//! - 5.1: 与现有 ToolPermissionManager 集成
//! - 5.3: 新系统规则优先
//! - 5.5: 兼容现有接口
//! - 6.1: 查询有效策略
//! - 6.2: 返回策略来源
//! - 6.3: 列出允许的工具
//! - 6.4: 列出拒绝的工具

use std::collections::HashSet;
use std::path::PathBuf;

use super::groups::ToolGroups;
use super::policy_merger::PolicyMerger;
use super::profile::ProfileManager;
use super::types::{
    MergedPolicy, PolicyDecision, PolicyError, PolicyLayer, ToolPolicy, ToolProfile,
};

/// Tool Policy 系统主管理器
#[derive(Debug, Clone)]
pub struct ToolPolicyManager {
    /// Profile 管理器
    profile_manager: ProfileManager,
    /// 策略合并器
    merger: PolicyMerger,
}

impl Default for ToolPolicyManager {
    fn default() -> Self {
        Self::new(None)
    }
}

impl ToolPolicyManager {
    /// 创建新的管理器
    pub fn new(config_dir: Option<PathBuf>) -> Self {
        let mut profile_manager = ProfileManager::new();
        if let Some(dir) = config_dir {
            profile_manager.set_config_dir(dir);
        }

        Self {
            profile_manager,
            merger: PolicyMerger::default(),
        }
    }

    /// 设置当前 Profile
    pub fn set_profile(&mut self, profile: ToolProfile) -> Result<(), PolicyError> {
        self.profile_manager.set_profile(profile.clone());

        // 获取 Profile 对应的策略并设置到合并器
        let policy = self.profile_manager.get_profile_policy(&profile)?;
        self.merger.set_policy(PolicyLayer::Profile, policy);

        Ok(())
    }

    /// 获取当前 Profile
    pub fn get_profile(&self) -> &ToolProfile {
        self.profile_manager.current_profile()
    }

    /// 设置指定层的策略
    pub fn set_layer_policy(&mut self, layer: PolicyLayer, policy: ToolPolicy) {
        self.merger.set_policy(layer, policy);
    }

    /// 清除指定层的策略
    pub fn clear_layer_policy(&mut self, layer: PolicyLayer) {
        self.merger.clear_policy(layer);
    }

    /// 检查工具是否被允许
    pub fn is_allowed(&self, tool: &str) -> PolicyDecision {
        self.merger.is_tool_allowed(tool)
    }

    /// 获取有效策略
    pub fn get_effective_policy(&self) -> MergedPolicy {
        self.merger.merge()
    }

    /// 获取所有允许的工具
    pub fn get_allowed_tools(&self) -> HashSet<String> {
        self.merger.get_allowed_tools()
    }

    /// 获取所有拒绝的工具
    pub fn get_denied_tools(&self) -> HashSet<String> {
        self.merger.get_denied_tools()
    }

    /// 获取工具的策略来源
    pub fn get_policy_source(&self, tool: &str) -> Option<PolicyLayer> {
        self.merger.get_policy_source(tool)
    }

    /// 获取工具分组注册表
    pub fn tool_groups(&self) -> &ToolGroups {
        self.merger.tool_groups()
    }

    /// 获取可变的工具分组注册表
    pub fn tool_groups_mut(&mut self) -> &mut ToolGroups {
        self.merger.tool_groups_mut()
    }

    /// 获取 Profile 管理器
    pub fn profile_manager(&self) -> &ProfileManager {
        &self.profile_manager
    }

    /// 获取可变的 Profile 管理器
    pub fn profile_manager_mut(&mut self) -> &mut ProfileManager {
        &mut self.profile_manager
    }
}

// =============================================================================
// 单元测试
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_manager_default() {
        let manager = ToolPolicyManager::default();
        assert_eq!(manager.get_profile(), &ToolProfile::Minimal);
    }

    #[test]
    fn test_set_profile() {
        let mut manager = ToolPolicyManager::default();
        manager.set_profile(ToolProfile::Coding).unwrap();
        assert_eq!(manager.get_profile(), &ToolProfile::Coding);
    }

    #[test]
    fn test_is_allowed_with_profile() {
        let mut manager = ToolPolicyManager::default();

        // Minimal profile 只允许 session_status
        manager.set_profile(ToolProfile::Minimal).unwrap();
        assert!(manager.is_allowed("session_status").allowed);
        assert!(!manager.is_allowed("bash").allowed);

        // Full profile 允许所有
        manager.set_profile(ToolProfile::Full).unwrap();
        assert!(manager.is_allowed("bash").allowed);
        assert!(manager.is_allowed("any_tool").allowed);
    }

    #[test]
    fn test_layer_policy_override() {
        let mut manager = ToolPolicyManager::default();
        manager.set_profile(ToolProfile::Full).unwrap();

        // Session 层拒绝 bash
        let session = ToolPolicy::new(PolicyLayer::Session).with_deny(vec!["bash".to_string()]);
        manager.set_layer_policy(PolicyLayer::Session, session);

        // bash 应被拒绝
        assert!(!manager.is_allowed("bash").allowed);
        // 其他工具仍被允许
        assert!(manager.is_allowed("file_read").allowed);
    }

    #[test]
    fn test_get_effective_policy() {
        let mut manager = ToolPolicyManager::default();
        manager.set_profile(ToolProfile::Coding).unwrap();

        let policy = manager.get_effective_policy();
        // Coding profile 展开后应包含 bash
        assert!(policy.allowed_tools.contains("bash"));
    }

    #[test]
    fn test_clear_layer_policy() {
        let mut manager = ToolPolicyManager::default();
        manager.set_profile(ToolProfile::Full).unwrap();

        let session = ToolPolicy::new(PolicyLayer::Session).with_deny(vec!["bash".to_string()]);
        manager.set_layer_policy(PolicyLayer::Session, session);

        assert!(!manager.is_allowed("bash").allowed);

        manager.clear_layer_policy(PolicyLayer::Session);
        assert!(manager.is_allowed("bash").allowed);
    }
}
