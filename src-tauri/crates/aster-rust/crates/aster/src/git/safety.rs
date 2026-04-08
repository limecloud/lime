//! Git 安全检查工具
//!
//! 提供 Git 操作的安全检查功能，包括：
//! - 危险命令检测
//! - 敏感文件检查
//! - 强制推送保护
//! - 配置修改检查

use regex::Regex;
use serde::{Deserialize, Serialize};
use std::sync::LazyLock;

/// 安全检查结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SafetyCheckResult {
    /// 是否安全
    pub safe: bool,
    /// 危险原因
    pub reason: Option<String>,
    /// 警告信息
    pub warning: Option<String>,
    /// 建议操作
    pub suggestion: Option<String>,
}

impl SafetyCheckResult {
    /// 创建安全结果
    pub fn safe() -> Self {
        Self {
            safe: true,
            reason: None,
            warning: None,
            suggestion: None,
        }
    }

    /// 创建带警告的安全结果
    pub fn safe_with_warning(warning: impl Into<String>, suggestion: impl Into<String>) -> Self {
        Self {
            safe: true,
            reason: None,
            warning: Some(warning.into()),
            suggestion: Some(suggestion.into()),
        }
    }

    /// 创建不安全结果
    pub fn unsafe_result(reason: impl Into<String>, suggestion: impl Into<String>) -> Self {
        Self {
            safe: false,
            reason: Some(reason.into()),
            warning: None,
            suggestion: Some(suggestion.into()),
        }
    }
}

/// 敏感文件检查结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SensitiveFilesCheck {
    /// 是否有敏感文件
    pub has_sensitive_files: bool,
    /// 敏感文件列表
    pub sensitive_files: Vec<String>,
    /// 警告信息
    pub warnings: Vec<String>,
}

/// 危险的 Git 命令列表
static DANGEROUS_COMMANDS: &[&str] = &[
    "push --force",
    "push -f",
    "reset --hard",
    "clean -fd",
    "clean -fdx",
    "clean -f",
    "filter-branch",
    "rebase --force",
];

/// 需要谨慎使用的命令模式
static CAUTION_PATTERNS: LazyLock<Vec<Regex>> = LazyLock::new(|| {
    vec![
        Regex::new(r"git\s+push.*--force").unwrap(),
        Regex::new(r"git\s+push.*-f\b").unwrap(),
        Regex::new(r"git\s+reset\s+--hard").unwrap(),
        Regex::new(r"git\s+clean\s+-[fdx]+").unwrap(),
        Regex::new(r"git\s+commit.*--amend").unwrap(),
        Regex::new(r"git\s+rebase.*-i").unwrap(),
        Regex::new(r"git\s+config").unwrap(),
        Regex::new(r"--no-verify").unwrap(),
        Regex::new(r"--no-gpg-sign").unwrap(),
    ]
});

/// 敏感文件模式
static SENSITIVE_FILE_PATTERNS: LazyLock<Vec<Regex>> = LazyLock::new(|| {
    vec![
        Regex::new(r"\.env$").unwrap(),
        Regex::new(r"\.env\.").unwrap(),
        Regex::new(r"credentials\.json$").unwrap(),
        Regex::new(r"secrets\.json$").unwrap(),
        Regex::new(r"\.pem$").unwrap(),
        Regex::new(r"\.key$").unwrap(),
        Regex::new(r"\.cert$").unwrap(),
        Regex::new(r"id_rsa$").unwrap(),
        Regex::new(r"id_ed25519$").unwrap(),
        Regex::new(r"\.aws/credentials$").unwrap(),
        Regex::new(r"\.ssh/id_").unwrap(),
        Regex::new(r"(?i)password").unwrap(),
        Regex::new(r"(?i)secret").unwrap(),
        Regex::new(r"(?i)token").unwrap(),
        Regex::new(r"(?i)api[_-]?key").unwrap(),
    ]
});

/// Git 安全检查工具类
pub struct GitSafety;

impl GitSafety {
    /// 检查 Git 命令是否安全
    pub fn validate_git_command(command: &str) -> SafetyCheckResult {
        // 检查是否包含危险命令
        for dangerous in DANGEROUS_COMMANDS {
            if command.contains(dangerous) {
                return SafetyCheckResult::unsafe_result(
                    format!("检测到危险命令: {}", dangerous),
                    "此操作具有破坏性且不可逆。如需继续，请明确确认。",
                );
            }
        }

        // 检查是否匹配谨慎模式
        for pattern in CAUTION_PATTERNS.iter() {
            if pattern.is_match(command) {
                return SafetyCheckResult::safe_with_warning(
                    "检测到潜在危险的命令模式，请谨慎使用。",
                    "请确保您了解此操作的后果。",
                );
            }
        }

        SafetyCheckResult::safe()
    }

    /// 检查是否是危险的 Git 命令
    pub fn is_dangerous(command: &str) -> bool {
        !Self::validate_git_command(command).safe
    }

    /// 检查是否强制推送到 main/master
    pub fn check_force_push_to_main(command: &str, current_branch: &str) -> SafetyCheckResult {
        let force_push_re = Regex::new(r"push.*--force|push.*-f\b").unwrap();
        let is_force_push = force_push_re.is_match(command);
        let is_main_branch = current_branch == "main" || current_branch == "master";

        if is_force_push && is_main_branch {
            return SafetyCheckResult::unsafe_result(
                format!("强制推送到 {} 分支非常危险", current_branch),
                "永远不要强制推送到 main/master。请创建新分支并提交 PR。",
            );
        }

        if is_force_push {
            return SafetyCheckResult::safe_with_warning(
                format!("检测到强制推送到分支: {}", current_branch),
                "请确保没有其他人在此分支上工作。",
            );
        }

        SafetyCheckResult::safe()
    }

    /// 检查敏感文件
    pub fn check_sensitive_files(files: &[String]) -> SensitiveFilesCheck {
        let mut sensitive_files = Vec::new();
        let mut warnings = Vec::new();

        for file in files {
            for pattern in SENSITIVE_FILE_PATTERNS.iter() {
                if pattern.is_match(file) {
                    sensitive_files.push(file.clone());
                    warnings.push(format!("检测到敏感文件: {}", file));
                    break;
                }
            }
        }

        SensitiveFilesCheck {
            has_sensitive_files: !sensitive_files.is_empty(),
            sensitive_files,
            warnings,
        }
    }

    /// 检查是否跳过钩子
    pub fn check_skip_hooks(command: &str) -> SafetyCheckResult {
        if command.contains("--no-verify") {
            return SafetyCheckResult::unsafe_result(
                "尝试使用 --no-verify 跳过 Git 钩子",
                "除非用户明确要求，否则不要跳过钩子。",
            );
        }

        if command.contains("--no-gpg-sign") {
            return SafetyCheckResult::unsafe_result(
                "尝试使用 --no-gpg-sign 跳过 GPG 签名",
                "除非用户明确要求，否则不要跳过 GPG 签名。",
            );
        }

        SafetyCheckResult::safe()
    }

    /// 检查 Git 配置修改
    pub fn check_config_change(command: &str) -> SafetyCheckResult {
        let config_re = Regex::new(r"git\s+config").unwrap();
        if config_re.is_match(command) {
            return SafetyCheckResult::unsafe_result(
                "尝试修改 Git 配置",
                "除非用户明确要求，否则永远不要修改 git 配置。",
            );
        }

        SafetyCheckResult::safe()
    }

    /// 综合安全检查
    pub fn comprehensive_check(
        command: &str,
        current_branch: Option<&str>,
        files: Option<&[String]>,
    ) -> SafetyCheckResult {
        // 1. 检查配置修改
        let config_check = Self::check_config_change(command);
        if !config_check.safe {
            return config_check;
        }

        // 2. 检查跳过钩子
        let hooks_check = Self::check_skip_hooks(command);
        if !hooks_check.safe {
            return hooks_check;
        }

        // 3. 检查危险命令
        let danger_check = Self::validate_git_command(command);
        if !danger_check.safe {
            return danger_check;
        }

        // 4. 检查强制推送
        if let Some(branch) = current_branch {
            let force_push_check = Self::check_force_push_to_main(command, branch);
            if !force_push_check.safe {
                return force_push_check;
            }
        }

        // 5. 检查敏感文件 (如果是 commit 或 add 命令)
        if let Some(file_list) = files {
            if command.contains("git add") || command.contains("git commit") {
                let sensitive_check = Self::check_sensitive_files(file_list);
                if sensitive_check.has_sensitive_files {
                    return SafetyCheckResult::safe_with_warning(
                        format!(
                            "检测到敏感文件: {}",
                            sensitive_check.sensitive_files.join(", ")
                        ),
                        "不要提交可能包含密钥的文件 (.env, credentials.json 等)。",
                    );
                }
            }
        }

        // 如果有警告，返回警告
        if danger_check.warning.is_some() {
            return danger_check;
        }

        SafetyCheckResult::safe()
    }
}

/// 检查是否是危险的 Git 命令（便捷函数）
pub fn is_dangerous_command(command: &str) -> bool {
    GitSafety::is_dangerous(command)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_dangerous_commands() {
        assert!(is_dangerous_command("git push --force"));
        assert!(is_dangerous_command("git push -f origin main"));
        assert!(is_dangerous_command("git reset --hard HEAD~1"));
        assert!(is_dangerous_command("git clean -fd"));
        assert!(!is_dangerous_command("git push origin main"));
        assert!(!is_dangerous_command("git commit -m 'test'"));
    }

    #[test]
    fn test_force_push_to_main() {
        let result = GitSafety::check_force_push_to_main("git push --force", "main");
        assert!(!result.safe);

        let result = GitSafety::check_force_push_to_main("git push --force", "feature");
        assert!(result.safe);
        assert!(result.warning.is_some());

        let result = GitSafety::check_force_push_to_main("git push", "main");
        assert!(result.safe);
    }

    #[test]
    fn test_sensitive_files() {
        let files = vec![
            ".env".to_string(),
            "config.json".to_string(),
            "credentials.json".to_string(),
        ];
        let result = GitSafety::check_sensitive_files(&files);
        assert!(result.has_sensitive_files);
        assert_eq!(result.sensitive_files.len(), 2);
    }

    #[test]
    fn test_skip_hooks() {
        let result = GitSafety::check_skip_hooks("git commit --no-verify -m 'test'");
        assert!(!result.safe);

        let result = GitSafety::check_skip_hooks("git commit -m 'test'");
        assert!(result.safe);
    }

    #[test]
    fn test_config_change() {
        let result = GitSafety::check_config_change("git config user.email test@test.com");
        assert!(!result.safe);

        let result = GitSafety::check_config_change("git status");
        assert!(result.safe);
    }
}
