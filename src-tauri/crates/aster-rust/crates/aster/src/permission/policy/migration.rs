//! 配置迁移模块
//!
//! 本模块实现旧格式配置到新 Policy 系统的迁移：
//! - 检测旧格式配置
//! - 转换权限配置
//! - 保持向后兼容
//!
//! # Requirements
//!
//! - 5.2: 保持向后兼容
//! - 5.4: 支持配置迁移

use serde::{Deserialize, Serialize};

use super::types::{PolicyError, PolicyLayer, ToolPolicy};

/// 旧格式权限配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OldPermissionConfig {
    /// 允许的工具列表
    #[serde(default)]
    pub allowed_tools: Vec<String>,
    /// 拒绝的工具列表
    #[serde(default)]
    pub denied_tools: Vec<String>,
}

/// 配置迁移器
pub struct PolicyMigration;

impl PolicyMigration {
    /// 检测是否为旧格式配置
    ///
    /// # Arguments
    ///
    /// * `json` - JSON 配置字符串
    ///
    /// # Returns
    ///
    /// 如果是旧格式返回 true
    pub fn detect_old_format(json: &str) -> bool {
        // 旧格式使用 allowed_tools/denied_tools
        // 新格式使用 allow/deny 和 layer
        let value: Result<serde_json::Value, _> = serde_json::from_str(json);
        if let Ok(v) = value {
            let has_old_keys = v.get("allowed_tools").is_some() || v.get("denied_tools").is_some();
            let has_new_keys = v.get("layer").is_some() || v.get("allow").is_some();
            return has_old_keys && !has_new_keys;
        }
        false
    }

    /// 从旧格式迁移配置
    ///
    /// # Arguments
    ///
    /// * `json` - 旧格式 JSON 配置
    ///
    /// # Returns
    ///
    /// 迁移后的 ToolPolicy
    pub fn migrate_from_old_format(json: &str) -> Result<ToolPolicy, PolicyError> {
        let old_config: OldPermissionConfig = serde_json::from_str(json)?;
        Ok(Self::convert_permission_to_policy(&old_config))
    }

    /// 转换旧权限配置到新策略
    ///
    /// # Arguments
    ///
    /// * `old_config` - 旧格式配置
    ///
    /// # Returns
    ///
    /// 新格式 ToolPolicy
    pub fn convert_permission_to_policy(old_config: &OldPermissionConfig) -> ToolPolicy {
        ToolPolicy::new(PolicyLayer::Global)
            .with_allow(old_config.allowed_tools.clone())
            .with_deny(old_config.denied_tools.clone())
            .with_description("Migrated from old permission format")
    }

    /// 尝试自动迁移配置
    ///
    /// 如果是旧格式则迁移，否则按新格式解析
    pub fn auto_migrate(json: &str) -> Result<ToolPolicy, PolicyError> {
        if Self::detect_old_format(json) {
            Self::migrate_from_old_format(json)
        } else {
            let policy: ToolPolicy = serde_json::from_str(json)?;
            Ok(policy)
        }
    }
}

// =============================================================================
// 单元测试
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_detect_old_format() {
        let old_json = r#"{"allowed_tools": ["bash"], "denied_tools": []}"#;
        assert!(PolicyMigration::detect_old_format(old_json));

        let new_json = r#"{"layer": "Global", "allow": ["bash"], "deny": []}"#;
        assert!(!PolicyMigration::detect_old_format(new_json));
    }

    #[test]
    fn test_migrate_from_old_format() {
        let old_json = r#"{"allowed_tools": ["bash", "file_read"], "denied_tools": ["rm"]}"#;
        let policy = PolicyMigration::migrate_from_old_format(old_json).unwrap();

        assert_eq!(policy.layer, PolicyLayer::Global);
        assert!(policy.allow.contains(&"bash".to_string()));
        assert!(policy.allow.contains(&"file_read".to_string()));
        assert!(policy.deny.contains(&"rm".to_string()));
    }

    #[test]
    fn test_convert_permission_to_policy() {
        let old_config = OldPermissionConfig {
            allowed_tools: vec!["bash".to_string()],
            denied_tools: vec!["rm".to_string()],
        };

        let policy = PolicyMigration::convert_permission_to_policy(&old_config);
        assert_eq!(policy.allow, vec!["bash"]);
        assert_eq!(policy.deny, vec!["rm"]);
    }

    #[test]
    fn test_auto_migrate_old_format() {
        let old_json = r#"{"allowed_tools": ["bash"]}"#;
        let policy = PolicyMigration::auto_migrate(old_json).unwrap();
        assert!(policy.allow.contains(&"bash".to_string()));
    }

    #[test]
    fn test_auto_migrate_new_format() {
        let new_json = r#"{"layer": "Agent", "allow": ["bash"], "deny": []}"#;
        let policy = PolicyMigration::auto_migrate(new_json).unwrap();
        assert_eq!(policy.layer, PolicyLayer::Agent);
        assert!(policy.allow.contains(&"bash".to_string()));
    }
}
