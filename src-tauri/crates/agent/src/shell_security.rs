//! Shell 命令安全检查
//!
//! 对 bash/shell 工具的命令进行安全分析，检测危险操作。

use crate::tool_permissions::{DynamicPermissionCheck, PermissionBehavior, ToolRiskLevel};

/// 危险 shell 操作符
const DANGEROUS_OPERATORS: &[&str] = &["&&", "||", ";", "|", ">", ">>", "$(", "`"];

/// 危险命令模式
const DANGEROUS_COMMANDS: &[&str] = &[
    "rm -rf /",
    "rm -rf ~",
    "rm -rf .",
    "mkfs",
    "dd if=",
    ":(){:|:&};:",
    "chmod -R 777 /",
    "wget|sh",
    "curl|sh",
    "curl|bash",
    "wget|bash",
    "> /dev/sda",
    "mv / ",
];

/// 只读命令白名单
const READONLY_COMMANDS: &[&str] = &[
    "ls",
    "cat",
    "head",
    "tail",
    "grep",
    "find",
    "wc",
    "git status",
    "git log",
    "git diff",
    "git branch",
    "pwd",
    "echo",
    "which",
    "type",
    "file",
    "stat",
    "tree",
    "du",
    "df",
    "env",
    "printenv",
    "uname",
    "date",
    "whoami",
    "hostname",
    "id",
];

/// Shell 安全检查结果
#[derive(Debug, Clone)]
pub struct ShellSecurityResult {
    pub safe: bool,
    pub risk_level: ToolRiskLevel,
    pub detected_operators: Vec<String>,
    pub is_readonly: bool,
    pub reason: Option<String>,
}

/// Shell 安全检查器
pub struct ShellSecurityChecker;

impl ShellSecurityChecker {
    /// 检查命令安全性
    pub fn check(command: &str) -> ShellSecurityResult {
        let trimmed = command.trim();

        // 检测危险命令
        for dangerous in DANGEROUS_COMMANDS {
            if trimmed.contains(dangerous) {
                return ShellSecurityResult {
                    safe: false,
                    risk_level: ToolRiskLevel::Destructive,
                    detected_operators: vec![],
                    is_readonly: false,
                    reason: Some(format!("检测到危险命令模式: {}", dangerous)),
                };
            }
        }

        let is_readonly = Self::is_readonly(trimmed);
        let detected_operators = Self::detect_dangerous_operators(trimmed);

        let risk_level = if is_readonly {
            ToolRiskLevel::ReadOnly
        } else if detected_operators.is_empty() {
            ToolRiskLevel::Reversible
        } else {
            ToolRiskLevel::Destructive
        };

        ShellSecurityResult {
            safe: risk_level != ToolRiskLevel::Destructive,
            risk_level,
            detected_operators,
            is_readonly,
            reason: None,
        }
    }

    /// 是否为只读命令
    pub fn is_readonly(command: &str) -> bool {
        let trimmed = command.trim();
        // 取第一个命令（管道前）
        let first_cmd = trimmed.split('|').next().unwrap_or(trimmed).trim();
        // 取命令名（第一个 token）
        let cmd_name = first_cmd.split_whitespace().next().unwrap_or("");

        READONLY_COMMANDS.iter().any(|ro| {
            if ro.contains(' ') {
                // 多词命令（如 "git status"），前缀匹配
                first_cmd.starts_with(ro)
            } else {
                cmd_name == *ro
            }
        })
    }

    /// 检测危险操作符
    pub fn detect_dangerous_operators(command: &str) -> Vec<String> {
        DANGEROUS_OPERATORS
            .iter()
            .filter(|op| command.contains(**op))
            .map(|op| op.to_string())
            .collect()
    }
}

/// 为 bash 工具实现动态权限检查
impl DynamicPermissionCheck for ShellSecurityChecker {
    fn check_permissions(&self, tool_name: &str, input: &serde_json::Value) -> PermissionBehavior {
        // 只检查 bash/shell 类工具
        if tool_name != "bash"
            && tool_name != "Bash"
            && tool_name != "PowerShell"
            && tool_name != "powershell"
            && tool_name != "shell"
            && tool_name != "execute_command"
        {
            return PermissionBehavior::Allow;
        }

        let command = input.get("command").and_then(|v| v.as_str()).unwrap_or("");

        if command.is_empty() {
            return PermissionBehavior::Allow;
        }

        let result = Self::check(command);

        if !result.safe {
            let reason = result.reason.unwrap_or_else(|| {
                format!("检测到危险操作符: {}", result.detected_operators.join(", "))
            });
            return PermissionBehavior::Deny { reason };
        }

        if result.is_readonly {
            PermissionBehavior::Allow
        } else {
            PermissionBehavior::Ask {
                message: format!("Shell 命令需要确认: {}", command),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_readonly_commands() {
        assert!(ShellSecurityChecker::is_readonly("ls -la"));
        assert!(ShellSecurityChecker::is_readonly("git status"));
        assert!(ShellSecurityChecker::is_readonly("cat file.txt"));
        assert!(ShellSecurityChecker::is_readonly("grep pattern file"));
        assert!(ShellSecurityChecker::is_readonly("pwd"));
    }

    #[test]
    fn test_non_readonly_commands() {
        assert!(!ShellSecurityChecker::is_readonly("rm file.txt"));
        assert!(!ShellSecurityChecker::is_readonly("cargo build"));
        assert!(!ShellSecurityChecker::is_readonly("npm install"));
    }

    #[test]
    fn test_dangerous_commands() {
        let result = ShellSecurityChecker::check("rm -rf /");
        assert!(!result.safe);
        assert_eq!(result.risk_level, ToolRiskLevel::Destructive);

        let result = ShellSecurityChecker::check("mkfs.ext4 /dev/sda1");
        assert!(!result.safe);
    }

    #[test]
    fn test_safe_commands() {
        let result = ShellSecurityChecker::check("ls -la");
        assert!(result.safe);
        assert!(result.is_readonly);
        assert_eq!(result.risk_level, ToolRiskLevel::ReadOnly);
    }

    #[test]
    fn test_detect_operators() {
        let ops = ShellSecurityChecker::detect_dangerous_operators("echo hello && rm file");
        assert!(ops.contains(&"&&".to_string()));
    }

    #[test]
    fn test_dynamic_permission_check_readonly() {
        let checker = ShellSecurityChecker;
        let input = serde_json::json!({"command": "ls -la"});
        assert_eq!(
            checker.check_permissions("Bash", &input),
            PermissionBehavior::Allow
        );
    }

    #[test]
    fn test_dynamic_permission_check_dangerous() {
        let checker = ShellSecurityChecker;
        let input = serde_json::json!({"command": "rm -rf /"});
        match checker.check_permissions("Bash", &input) {
            PermissionBehavior::Deny { .. } => {}
            other => panic!("Expected Deny, got {:?}", other),
        }
    }

    #[test]
    fn test_dynamic_permission_check_non_bash() {
        let checker = ShellSecurityChecker;
        let input = serde_json::json!({"command": "rm -rf /"});
        assert_eq!(
            checker.check_permissions("read_file", &input),
            PermissionBehavior::Allow
        );
    }

    #[test]
    fn test_reversible_command() {
        let result = ShellSecurityChecker::check("cargo build");
        assert!(result.safe);
        assert!(!result.is_readonly);
        assert_eq!(result.risk_level, ToolRiskLevel::Reversible);
    }
}
