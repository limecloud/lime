//! Tool 权限分级系统
//!
//! 按操作的可逆性和影响范围对工具进行风险分级，决定是否需要用户确认。

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::collections::HashSet;

/// 工具风险等级
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum ToolRiskLevel {
    /// 只读操作，无副作用
    ReadOnly,
    /// 可逆操作（如编辑文件、创建分支）
    Reversible,
    /// 破坏性操作（如删除文件、force push）
    Destructive,
}

/// 权限检查结果（统一到当前工具面的 allow/deny/ask 语义）
#[derive(Debug, Clone, PartialEq)]
pub enum PermissionBehavior {
    Allow,
    Deny { reason: String },
    Ask { message: String },
}

/// 动态权限检查 trait（工具可根据输入内容判断风险）
pub trait DynamicPermissionCheck: Send + Sync {
    fn check_permissions(&self, tool_name: &str, input: &serde_json::Value) -> PermissionBehavior;
}

/// 工具权限元数据
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolPermissionMeta {
    pub tool_name: String,
    pub risk_level: ToolRiskLevel,
    pub description: String,
    /// 是否需要用户确认
    pub requires_confirmation: bool,
}

/// 工具权限检查器
pub struct ToolPermissionChecker {
    permissions: HashMap<String, ToolPermissionMeta>,
    auto_approve_level: ToolRiskLevel,
    /// 会话内用户已允许的工具（tool_name → 允许次数）
    session_allowed: HashMap<String, usize>,
    /// 会话内用户已拒绝的工具
    session_denied: HashSet<String>,
    /// 动态权限检查器
    dynamic_checker: Option<Box<dyn DynamicPermissionCheck>>,
}

fn normalize_permission_tool_name(tool_name: &str) -> String {
    match tool_name.trim() {
        "Read" | "read" | "read_file" => "read_file".to_string(),
        "Write" | "write" | "write_file" | "create_file" => "write_file".to_string(),
        "Edit" | "edit" | "edit_file" => "edit_file".to_string(),
        "Glob" | "glob" => "glob".to_string(),
        "Grep" | "grep" => "grep".to_string(),
        "LSP" | "lsp" | "lsp_query" => "lsp_query".to_string(),
        "Bash" | "bash" | "PowerShell" | "powershell" | "shell" | "execute_command" => {
            "bash".to_string()
        }
        other => other.to_string(),
    }
}

impl ToolPermissionChecker {
    pub fn new() -> Self {
        let mut checker = Self {
            permissions: HashMap::new(),
            auto_approve_level: ToolRiskLevel::ReadOnly,
            session_allowed: HashMap::new(),
            session_denied: HashSet::new(),
            dynamic_checker: None,
        };
        for meta in Self::default_permissions() {
            checker.permissions.insert(meta.tool_name.clone(), meta);
        }
        checker
    }

    /// 注册工具的权限元数据
    pub fn register_tool(&mut self, meta: ToolPermissionMeta) {
        let normalized_name = normalize_permission_tool_name(&meta.tool_name);
        self.permissions.insert(
            normalized_name.clone(),
            ToolPermissionMeta {
                tool_name: normalized_name,
                ..meta
            },
        );
    }

    /// 检查工具是否需要用户确认
    pub fn needs_confirmation(&self, tool_name: &str) -> bool {
        let normalized_name = normalize_permission_tool_name(tool_name);
        match self.permissions.get(&normalized_name) {
            Some(meta) => meta.requires_confirmation && meta.risk_level > self.auto_approve_level,
            // 未知工具默认需要确认
            None => true,
        }
    }

    /// 获取工具的风险等级
    pub fn risk_level(&self, tool_name: &str) -> ToolRiskLevel {
        let normalized_name = normalize_permission_tool_name(tool_name);
        self.permissions
            .get(&normalized_name)
            .map(|m| m.risk_level)
            // 未知工具默认为破坏性
            .unwrap_or(ToolRiskLevel::Destructive)
    }

    /// 设置自动批准的风险等级
    pub fn set_auto_approve_level(&mut self, level: ToolRiskLevel) {
        self.auto_approve_level = level;
    }

    /// 设置动态权限检查器
    pub fn set_dynamic_checker(&mut self, checker: Box<dyn DynamicPermissionCheck>) {
        self.dynamic_checker = Some(checker);
    }

    /// 完整的权限决策链
    pub fn check_permission(
        &self,
        tool_name: &str,
        input: Option<&serde_json::Value>,
    ) -> PermissionBehavior {
        let normalized_name = normalize_permission_tool_name(tool_name);
        // 1. 会话级记忆
        if let Some(allowed) = self.has_session_decision(&normalized_name) {
            return if allowed {
                PermissionBehavior::Allow
            } else {
                PermissionBehavior::Deny {
                    reason: format!("工具 {} 在本次会话中已被拒绝", tool_name),
                }
            };
        }
        // 2. 动态检查（如 shell 安全）
        if let Some(input) = input {
            if let Some(checker) = &self.dynamic_checker {
                let result = checker.check_permissions(&normalized_name, input);
                if result != PermissionBehavior::Allow {
                    return result;
                }
            }
        }
        // 3. 静态分级
        if self.needs_confirmation(&normalized_name) {
            PermissionBehavior::Ask {
                message: format!("工具 {} 需要确认执行", tool_name),
            }
        } else {
            PermissionBehavior::Allow
        }
    }

    /// 记录用户的允许决策
    pub fn record_allow(&mut self, tool_name: &str) {
        let normalized_name = normalize_permission_tool_name(tool_name);
        let count = self
            .session_allowed
            .entry(normalized_name.clone())
            .or_insert(0);
        *count += 1;
        self.session_denied.remove(&normalized_name);
    }

    /// 记录用户的拒绝决策
    pub fn record_deny(&mut self, tool_name: &str) {
        let normalized_name = normalize_permission_tool_name(tool_name);
        self.session_denied.insert(normalized_name.clone());
        self.session_allowed.remove(&normalized_name);
    }

    /// 检查是否有会话级记忆
    pub fn has_session_decision(&self, tool_name: &str) -> Option<bool> {
        let normalized_name = normalize_permission_tool_name(tool_name);
        if self.session_allowed.contains_key(&normalized_name) {
            Some(true)
        } else if self.session_denied.contains(&normalized_name) {
            Some(false)
        } else {
            None
        }
    }

    /// 清除会话记忆
    pub fn clear_session_memory(&mut self) {
        self.session_allowed.clear();
        self.session_denied.clear();
    }

    /// 返回默认的工具权限映射
    pub fn default_permissions() -> Vec<ToolPermissionMeta> {
        let read_only = &[
            ("read_file", "读取文件内容"),
            ("grep", "搜索文件内容"),
            ("glob", "按模式查找文件"),
            ("list_directory", "列出目录内容"),
            ("lsp_query", "LSP 查询"),
        ];
        let reversible = &[
            ("write_file", "写入文件"),
            ("edit_file", "编辑文件"),
            ("create_file", "创建文件"),
            ("git_commit", "Git 提交"),
            ("git_branch", "Git 分支操作"),
        ];
        let destructive = &[
            ("bash", "执行 Shell 命令"),
            ("git_push", "Git 推送"),
            ("git_force_push", "Git 强制推送"),
            ("delete_file", "删除文件"),
        ];

        let mut perms = Vec::new();
        for &(name, desc) in read_only {
            perms.push(ToolPermissionMeta {
                tool_name: name.to_string(),
                risk_level: ToolRiskLevel::ReadOnly,
                description: desc.to_string(),
                requires_confirmation: false,
            });
        }
        for &(name, desc) in reversible {
            perms.push(ToolPermissionMeta {
                tool_name: name.to_string(),
                risk_level: ToolRiskLevel::Reversible,
                description: desc.to_string(),
                requires_confirmation: true,
            });
        }
        for &(name, desc) in destructive {
            perms.push(ToolPermissionMeta {
                tool_name: name.to_string(),
                risk_level: ToolRiskLevel::Destructive,
                description: desc.to_string(),
                requires_confirmation: true,
            });
        }
        perms
    }
}

impl Default for ToolPermissionChecker {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TestDynamicChecker;

    impl DynamicPermissionCheck for TestDynamicChecker {
        fn check_permissions(
            &self,
            tool_name: &str,
            _input: &serde_json::Value,
        ) -> PermissionBehavior {
            if tool_name == "bash" {
                PermissionBehavior::Deny {
                    reason: "dynamic deny".to_string(),
                }
            } else {
                PermissionBehavior::Allow
            }
        }
    }

    #[test]
    fn test_default_permissions_loaded() {
        let checker = ToolPermissionChecker::new();
        assert_eq!(checker.risk_level("Read"), ToolRiskLevel::ReadOnly);
        assert_eq!(checker.risk_level("Edit"), ToolRiskLevel::Reversible);
        assert_eq!(checker.risk_level("Bash"), ToolRiskLevel::Destructive);
        assert_eq!(checker.risk_level("read_file"), ToolRiskLevel::ReadOnly);
        assert_eq!(checker.risk_level("edit_file"), ToolRiskLevel::Reversible);
        assert_eq!(
            checker.risk_level("git_force_push"),
            ToolRiskLevel::Destructive
        );
    }

    #[test]
    fn test_unknown_tool_defaults_destructive() {
        let checker = ToolPermissionChecker::new();
        assert_eq!(
            checker.risk_level("unknown_tool"),
            ToolRiskLevel::Destructive
        );
        assert!(checker.needs_confirmation("unknown_tool"));
    }

    #[test]
    fn test_read_only_no_confirmation() {
        let checker = ToolPermissionChecker::new();
        assert!(!checker.needs_confirmation("read_file"));
        assert!(!checker.needs_confirmation("grep"));
    }

    #[test]
    fn test_destructive_needs_confirmation() {
        let checker = ToolPermissionChecker::new();
        assert!(checker.needs_confirmation("delete_file"));
        assert!(checker.needs_confirmation("git_force_push"));
    }

    #[test]
    fn test_auto_approve_level_reversible() {
        let mut checker = ToolPermissionChecker::new();
        checker.set_auto_approve_level(ToolRiskLevel::Reversible);
        // Reversible 工具不再需要确认
        assert!(!checker.needs_confirmation("edit_file"));
        assert!(!checker.needs_confirmation("write_file"));
        // Destructive 仍需确认
        assert!(checker.needs_confirmation("delete_file"));
    }

    #[test]
    fn test_auto_approve_level_destructive() {
        let mut checker = ToolPermissionChecker::new();
        checker.set_auto_approve_level(ToolRiskLevel::Destructive);
        assert!(!checker.needs_confirmation("delete_file"));
        assert!(!checker.needs_confirmation("git_force_push"));
    }

    #[test]
    fn test_register_custom_tool() {
        let mut checker = ToolPermissionChecker::new();
        checker.register_tool(ToolPermissionMeta {
            tool_name: "my_tool".to_string(),
            risk_level: ToolRiskLevel::Reversible,
            description: "自定义工具".to_string(),
            requires_confirmation: false,
        });
        assert_eq!(checker.risk_level("my_tool"), ToolRiskLevel::Reversible);
        assert!(!checker.needs_confirmation("my_tool"));
    }

    #[test]
    fn test_register_overrides_default() {
        let mut checker = ToolPermissionChecker::new();
        // 将 bash 从 Destructive 降级为 Reversible
        checker.register_tool(ToolPermissionMeta {
            tool_name: "bash".to_string(),
            risk_level: ToolRiskLevel::Reversible,
            description: "受限 Shell".to_string(),
            requires_confirmation: false,
        });
        assert_eq!(checker.risk_level("bash"), ToolRiskLevel::Reversible);
    }

    #[test]
    fn test_risk_level_ordering() {
        assert!(ToolRiskLevel::ReadOnly < ToolRiskLevel::Reversible);
        assert!(ToolRiskLevel::Reversible < ToolRiskLevel::Destructive);
    }

    #[test]
    fn test_default_permissions_count() {
        let perms = ToolPermissionChecker::default_permissions();
        assert_eq!(perms.len(), 14); // 5 read + 5 reversible + 4 destructive
    }

    #[test]
    fn test_session_allow_memory() {
        let mut checker = ToolPermissionChecker::new();
        assert_eq!(checker.has_session_decision("bash"), None);
        checker.record_allow("bash");
        assert_eq!(checker.has_session_decision("bash"), Some(true));
    }

    #[test]
    fn test_session_deny_memory() {
        let mut checker = ToolPermissionChecker::new();
        checker.record_deny("bash");
        assert_eq!(checker.has_session_decision("bash"), Some(false));
    }

    #[test]
    fn test_session_deny_overrides_allow() {
        let mut checker = ToolPermissionChecker::new();
        checker.record_allow("bash");
        checker.record_deny("bash");
        assert_eq!(checker.has_session_decision("bash"), Some(false));
    }

    #[test]
    fn test_clear_session_memory() {
        let mut checker = ToolPermissionChecker::new();
        checker.record_allow("bash");
        checker.record_deny("read_file");
        checker.clear_session_memory();
        assert_eq!(checker.has_session_decision("bash"), None);
        assert_eq!(checker.has_session_decision("read_file"), None);
    }

    #[test]
    fn test_check_permission_allow() {
        let checker = ToolPermissionChecker::new();
        // read_file 是 ReadOnly，auto_approve_level 也是 ReadOnly
        assert_eq!(
            checker.check_permission("read_file", None),
            PermissionBehavior::Allow
        );
    }

    #[test]
    fn test_check_permission_ask() {
        let checker = ToolPermissionChecker::new();
        // bash 是 Destructive，需要确认
        match checker.check_permission("bash", None) {
            PermissionBehavior::Ask { .. } => {}
            other => panic!("Expected Ask, got {:?}", other),
        }
    }

    #[test]
    fn test_check_permission_session_override() {
        let mut checker = ToolPermissionChecker::new();
        checker.record_allow("bash");
        assert_eq!(
            checker.check_permission("bash", None),
            PermissionBehavior::Allow
        );
    }

    #[test]
    fn test_set_dynamic_checker_overrides_static_decision() {
        let mut checker = ToolPermissionChecker::new();
        checker.set_dynamic_checker(Box::new(TestDynamicChecker));

        let result = checker.check_permission("bash", Some(&serde_json::json!({})));
        assert_eq!(
            result,
            PermissionBehavior::Deny {
                reason: "dynamic deny".to_string(),
            }
        );
    }
}
