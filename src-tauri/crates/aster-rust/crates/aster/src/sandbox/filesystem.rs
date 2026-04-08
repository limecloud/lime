//! 文件系统沙箱
//!
//! 提供文件系统访问控制和路径规则管理

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// 路径访问权限
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PathPermission {
    /// 只读
    ReadOnly,
    /// 读写
    ReadWrite,
    /// 禁止访问
    Denied,
}

/// 路径规则
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PathRule {
    /// 路径模式
    pub pattern: String,
    /// 权限
    pub permission: PathPermission,
    /// 是否递归应用到子目录
    pub recursive: bool,
}

impl PathRule {
    /// 创建只读规则
    pub fn read_only(pattern: impl Into<String>) -> Self {
        Self {
            pattern: pattern.into(),
            permission: PathPermission::ReadOnly,
            recursive: true,
        }
    }

    /// 创建读写规则
    pub fn read_write(pattern: impl Into<String>) -> Self {
        Self {
            pattern: pattern.into(),
            permission: PathPermission::ReadWrite,
            recursive: true,
        }
    }

    /// 创建禁止访问规则
    pub fn denied(pattern: impl Into<String>) -> Self {
        Self {
            pattern: pattern.into(),
            permission: PathPermission::Denied,
            recursive: true,
        }
    }

    /// 检查路径是否匹配规则
    pub fn matches(&self, path: &Path) -> bool {
        let pattern_path = Path::new(&self.pattern);

        if self.recursive {
            path.starts_with(pattern_path)
        } else {
            path == pattern_path
        }
    }
}

/// 文件系统策略
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct FilesystemPolicy {
    /// 路径规则列表（按优先级排序，后面的规则优先）
    pub rules: Vec<PathRule>,
    /// 默认权限
    pub default_permission: Option<PathPermission>,
}

impl FilesystemPolicy {
    /// 创建新的策略
    pub fn new() -> Self {
        Self::default()
    }

    /// 添加规则
    pub fn add_rule(&mut self, rule: PathRule) {
        self.rules.push(rule);
    }

    /// 获取路径权限
    pub fn get_permission(&self, path: &Path) -> PathPermission {
        // 从后向前遍历，后面的规则优先级更高
        for rule in self.rules.iter().rev() {
            if rule.matches(path) {
                return rule.permission;
            }
        }

        self.default_permission.unwrap_or(PathPermission::Denied)
    }

    /// 检查路径是否可读
    pub fn can_read(&self, path: &Path) -> bool {
        matches!(
            self.get_permission(path),
            PathPermission::ReadOnly | PathPermission::ReadWrite
        )
    }

    /// 检查路径是否可写
    pub fn can_write(&self, path: &Path) -> bool {
        self.get_permission(path) == PathPermission::ReadWrite
    }
}

/// 文件系统沙箱
pub struct FilesystemSandbox {
    /// 策略
    policy: FilesystemPolicy,
    /// 根目录
    root: PathBuf,
    /// 是否启用
    enabled: bool,
}

impl FilesystemSandbox {
    /// 创建新的文件系统沙箱
    pub fn new(root: PathBuf) -> Self {
        Self {
            policy: FilesystemPolicy::default(),
            root,
            enabled: true,
        }
    }

    /// 使用策略创建
    pub fn with_policy(root: PathBuf, policy: FilesystemPolicy) -> Self {
        Self {
            policy,
            root,
            enabled: true,
        }
    }

    /// 启用/禁用沙箱
    pub fn set_enabled(&mut self, enabled: bool) {
        self.enabled = enabled;
    }

    /// 检查路径是否在沙箱内
    pub fn is_within_sandbox(&self, path: &Path) -> bool {
        path.starts_with(&self.root)
    }

    /// 规范化路径（解析相对路径和符号链接）
    pub fn normalize_path(&self, path: &Path) -> anyhow::Result<PathBuf> {
        let normalized = if path.is_absolute() {
            path.to_path_buf()
        } else {
            self.root.join(path)
        };

        // 检查是否在沙箱内
        if !self.is_within_sandbox(&normalized) {
            anyhow::bail!("路径 {} 不在沙箱范围内", path.display());
        }

        Ok(normalized)
    }

    /// 检查读取权限
    pub fn check_read(&self, path: &Path) -> anyhow::Result<()> {
        if !self.enabled {
            return Ok(());
        }

        let normalized = self.normalize_path(path)?;

        if !self.policy.can_read(&normalized) {
            anyhow::bail!("没有读取权限: {}", path.display());
        }

        Ok(())
    }

    /// 检查写入权限
    pub fn check_write(&self, path: &Path) -> anyhow::Result<()> {
        if !self.enabled {
            return Ok(());
        }

        let normalized = self.normalize_path(path)?;

        if !self.policy.can_write(&normalized) {
            anyhow::bail!("没有写入权限: {}", path.display());
        }

        Ok(())
    }

    /// 获取策略
    pub fn policy(&self) -> &FilesystemPolicy {
        &self.policy
    }

    /// 获取可变策略
    pub fn policy_mut(&mut self) -> &mut FilesystemPolicy {
        &mut self.policy
    }

    /// 获取根目录
    pub fn root(&self) -> &Path {
        &self.root
    }
}
