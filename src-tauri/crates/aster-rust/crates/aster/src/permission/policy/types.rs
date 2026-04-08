//! Tool Policy 系统核心类型定义
//!
//! 本模块定义了 Tool Policy 系统的所有基础类型，包括：
//! - ToolProfile: 工具配置文件预设枚举
//! - PolicyLayer: 策略层级枚举
//! - ToolPolicy: 单层策略定义
//! - PolicyDecision: 策略决策结果
//! - MergedPolicy: 合并后的策略
//! - PolicyError: 错误类型
//!
//! # Requirements
//!
//! - 1.1: Profile 预设配置
//! - 3.1: 多层策略合并

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

pub(crate) fn normalize_tool_name(tool: &str) -> String {
    tool.to_ascii_lowercase()
}

// =============================================================================
// ToolProfile 枚举
// =============================================================================

/// 工具配置文件预设
///
/// 定义五种内置的权限配置预设：
/// - Minimal: 最小权限，仅状态查询
/// - Coding: 编码模式，文件操作 + 执行
/// - Messaging: 消息模式，会话管理
/// - Full: 完整权限，允许所有工具
/// - Custom: 自定义配置
///
/// # Requirements
///
/// - 1.1: 支持五种内置 profiles
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize, Default)]
pub enum ToolProfile {
    /// 最小权限：仅状态查询
    #[default]
    Minimal,
    /// 编码模式：文件操作 + 执行
    Coding,
    /// 消息模式：会话管理
    Messaging,
    /// 完整权限：允许所有工具
    Full,
    /// 自定义配置
    Custom(String),
}

impl ToolProfile {
    /// 从字符串解析 Profile
    ///
    /// # Arguments
    ///
    /// * `s` - Profile 名称字符串
    ///
    /// # Returns
    ///
    /// 解析成功返回对应的 ToolProfile，失败返回 PolicyError
    pub fn parse(s: &str) -> Result<Self, PolicyError> {
        match s.to_lowercase().as_str() {
            "minimal" => Ok(Self::Minimal),
            "coding" => Ok(Self::Coding),
            "messaging" => Ok(Self::Messaging),
            "full" => Ok(Self::Full),
            _ => {
                if let Some(stripped) = s.strip_prefix("custom:") {
                    Ok(Self::Custom(stripped.to_string()))
                } else {
                    Ok(Self::Custom(s.to_string()))
                }
            }
        }
    }

    /// 获取 Profile 名称
    pub fn name(&self) -> &str {
        match self {
            Self::Minimal => "minimal",
            Self::Coding => "coding",
            Self::Messaging => "messaging",
            Self::Full => "full",
            Self::Custom(name) => name,
        }
    }
}

// =============================================================================
// PolicyLayer 枚举
// =============================================================================

/// 策略层级
///
/// 定义权限的作用域级别，优先级从低到高：
/// Profile < Global < Agent < Session
///
/// # Requirements
///
/// - 3.1: 支持四层策略
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, Default,
)]
pub enum PolicyLayer {
    /// Profile 预设策略（最低优先级）
    #[default]
    Profile = 0,
    /// 全局策略
    Global = 1,
    /// Agent 级别策略
    Agent = 2,
    /// 会话级别策略（最高优先级）
    Session = 3,
}

impl PolicyLayer {
    /// 获取所有层级（按优先级从低到高排序）
    pub fn all_layers() -> Vec<Self> {
        vec![Self::Profile, Self::Global, Self::Agent, Self::Session]
    }

    /// 获取层级名称
    pub fn name(&self) -> &str {
        match self {
            Self::Profile => "profile",
            Self::Global => "global",
            Self::Agent => "agent",
            Self::Session => "session",
        }
    }
}

// =============================================================================
// ToolPolicy 结构体
// =============================================================================

/// 单层策略定义
///
/// 定义某一层级的工具权限规则
///
/// # Requirements
///
/// - 3.1: 策略层级定义
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct ToolPolicy {
    /// 策略层级
    pub layer: PolicyLayer,
    /// 允许的工具/分组列表
    #[serde(default)]
    pub allow: Vec<String>,
    /// 拒绝的工具/分组列表
    #[serde(default)]
    pub deny: Vec<String>,
    /// 策略描述
    #[serde(default)]
    pub description: Option<String>,
}

impl ToolPolicy {
    /// 创建新的策略
    pub fn new(layer: PolicyLayer) -> Self {
        Self {
            layer,
            ..Default::default()
        }
    }

    /// 添加允许的工具
    pub fn with_allow(mut self, tools: Vec<String>) -> Self {
        self.allow = tools;
        self
    }

    /// 添加拒绝的工具
    pub fn with_deny(mut self, tools: Vec<String>) -> Self {
        self.deny = tools;
        self
    }

    /// 设置描述
    pub fn with_description(mut self, description: impl Into<String>) -> Self {
        self.description = Some(description.into());
        self
    }

    /// 检查工具是否在允许列表中
    pub fn is_in_allow_list(&self, tool: &str) -> bool {
        self.allow
            .iter()
            .any(|candidate| candidate == "*" || candidate.eq_ignore_ascii_case(tool))
    }

    /// 检查工具是否在拒绝列表中
    pub fn is_in_deny_list(&self, tool: &str) -> bool {
        self.deny
            .iter()
            .any(|candidate| candidate == "*" || candidate.eq_ignore_ascii_case(tool))
    }
}

// =============================================================================
// PolicyDecision 结构体
// =============================================================================

/// 策略决策结果
///
/// 包含权限检查的详细结果信息
///
/// # Requirements
///
/// - 6.1: 查询有效策略
/// - 6.2: 返回策略来源
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PolicyDecision {
    /// 是否允许
    pub allowed: bool,
    /// 决策来源层
    pub source_layer: PolicyLayer,
    /// 决策原因
    pub reason: String,
}

impl PolicyDecision {
    /// 创建允许的决策
    pub fn allow(source_layer: PolicyLayer, reason: impl Into<String>) -> Self {
        Self {
            allowed: true,
            source_layer,
            reason: reason.into(),
        }
    }

    /// 创建拒绝的决策
    pub fn deny(source_layer: PolicyLayer, reason: impl Into<String>) -> Self {
        Self {
            allowed: false,
            source_layer,
            reason: reason.into(),
        }
    }
}

// =============================================================================
// MergedPolicy 结构体
// =============================================================================

/// 合并后的策略
///
/// 包含所有层级合并后的最终权限状态
///
/// # Requirements
///
/// - 3.2: 合并多层策略
/// - 6.3: 列出允许/拒绝的工具
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct MergedPolicy {
    /// 允许的工具集合
    pub allowed_tools: HashSet<String>,
    /// 拒绝的工具集合
    pub denied_tools: HashSet<String>,
    /// 每个工具的策略来源
    pub tool_sources: HashMap<String, PolicyLayer>,
    /// 是否允许所有工具（full profile）
    pub allow_all: bool,
}

impl MergedPolicy {
    /// 创建新的合并策略
    pub fn new() -> Self {
        Self::default()
    }

    /// 检查工具是否被允许
    pub fn is_allowed(&self, tool: &str) -> bool {
        let normalized_tool = normalize_tool_name(tool);
        if self.denied_tools.contains(&normalized_tool) {
            return false;
        }
        if self.allow_all {
            return true;
        }
        self.allowed_tools.contains(&normalized_tool)
    }

    /// 获取工具的策略来源
    pub fn get_source(&self, tool: &str) -> Option<PolicyLayer> {
        self.tool_sources.get(&normalize_tool_name(tool)).copied()
    }
}

// =============================================================================
// PolicyError 错误类型
// =============================================================================

/// Tool Policy 系统错误类型
///
/// # Requirements
///
/// - 4.4: 无效配置错误处理
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PolicyError {
    /// Profile 不存在
    ProfileNotFound(String),
    /// 无效的 Profile 配置
    InvalidConfig(String),
    /// 分组不存在
    GroupNotFound(String),
    /// 配置文件读取失败
    ConfigReadError(String),
    /// JSON 解析失败
    JsonParseError(String),
    /// 策略层级无效
    InvalidLayer(String),
    /// IO 错误
    IoError(String),
}

impl std::fmt::Display for PolicyError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::ProfileNotFound(name) => write!(f, "Profile not found: {}", name),
            Self::InvalidConfig(msg) => write!(f, "Invalid profile configuration: {}", msg),
            Self::GroupNotFound(name) => write!(f, "Tool group not found: {}", name),
            Self::ConfigReadError(msg) => write!(f, "Failed to read config file: {}", msg),
            Self::JsonParseError(msg) => write!(f, "Failed to parse JSON: {}", msg),
            Self::InvalidLayer(msg) => write!(f, "Invalid policy layer: {}", msg),
            Self::IoError(msg) => write!(f, "IO error: {}", msg),
        }
    }
}

impl std::error::Error for PolicyError {}

impl From<std::io::Error> for PolicyError {
    fn from(err: std::io::Error) -> Self {
        Self::IoError(err.to_string())
    }
}

impl From<serde_json::Error> for PolicyError {
    fn from(err: serde_json::Error) -> Self {
        Self::JsonParseError(err.to_string())
    }
}

// =============================================================================
// 单元测试
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_tool_profile_default() {
        assert_eq!(ToolProfile::default(), ToolProfile::Minimal);
    }

    #[test]
    fn test_tool_profile_parse() {
        assert_eq!(ToolProfile::parse("minimal").unwrap(), ToolProfile::Minimal);
        assert_eq!(ToolProfile::parse("CODING").unwrap(), ToolProfile::Coding);
        assert_eq!(
            ToolProfile::parse("Messaging").unwrap(),
            ToolProfile::Messaging
        );
        assert_eq!(ToolProfile::parse("full").unwrap(), ToolProfile::Full);
        assert_eq!(
            ToolProfile::parse("custom:my-profile").unwrap(),
            ToolProfile::Custom("my-profile".to_string())
        );
        assert_eq!(
            ToolProfile::parse("unknown").unwrap(),
            ToolProfile::Custom("unknown".to_string())
        );
    }

    #[test]
    fn test_tool_profile_name() {
        assert_eq!(ToolProfile::Minimal.name(), "minimal");
        assert_eq!(ToolProfile::Coding.name(), "coding");
        assert_eq!(ToolProfile::Messaging.name(), "messaging");
        assert_eq!(ToolProfile::Full.name(), "full");
        assert_eq!(ToolProfile::Custom("test".to_string()).name(), "test");
    }

    #[test]
    fn test_policy_layer_ordering() {
        assert!(PolicyLayer::Profile < PolicyLayer::Global);
        assert!(PolicyLayer::Global < PolicyLayer::Agent);
        assert!(PolicyLayer::Agent < PolicyLayer::Session);
    }

    #[test]
    fn test_policy_layer_all_layers() {
        let layers = PolicyLayer::all_layers();
        assert_eq!(layers.len(), 4);
        assert_eq!(layers[0], PolicyLayer::Profile);
        assert_eq!(layers[3], PolicyLayer::Session);
    }

    #[test]
    fn test_tool_policy_default() {
        let policy = ToolPolicy::default();
        assert_eq!(policy.layer, PolicyLayer::Profile);
        assert!(policy.allow.is_empty());
        assert!(policy.deny.is_empty());
        assert!(policy.description.is_none());
    }

    #[test]
    fn test_tool_policy_builder() {
        let policy = ToolPolicy::new(PolicyLayer::Agent)
            .with_allow(vec!["bash".to_string(), "file_read".to_string()])
            .with_deny(vec!["rm".to_string()])
            .with_description("Test policy");

        assert_eq!(policy.layer, PolicyLayer::Agent);
        assert_eq!(policy.allow, vec!["bash", "file_read"]);
        assert_eq!(policy.deny, vec!["rm"]);
        assert_eq!(policy.description, Some("Test policy".to_string()));
    }

    #[test]
    fn test_tool_policy_is_in_allow_list() {
        let policy = ToolPolicy::new(PolicyLayer::Global)
            .with_allow(vec!["bash".to_string(), "*".to_string()]);

        assert!(policy.is_in_allow_list("bash"));
        assert!(policy.is_in_allow_list("any_tool")); // * matches all
    }

    #[test]
    fn test_policy_decision_allow() {
        let decision = PolicyDecision::allow(PolicyLayer::Agent, "Tool is allowed");
        assert!(decision.allowed);
        assert_eq!(decision.source_layer, PolicyLayer::Agent);
        assert_eq!(decision.reason, "Tool is allowed");
    }

    #[test]
    fn test_policy_decision_deny() {
        let decision = PolicyDecision::deny(PolicyLayer::Session, "Tool is denied");
        assert!(!decision.allowed);
        assert_eq!(decision.source_layer, PolicyLayer::Session);
        assert_eq!(decision.reason, "Tool is denied");
    }

    #[test]
    fn test_merged_policy_is_allowed() {
        let mut policy = MergedPolicy::new();
        policy.allowed_tools.insert("bash".to_string());
        policy.denied_tools.insert("rm".to_string());

        assert!(policy.is_allowed("bash"));
        assert!(!policy.is_allowed("rm"));
        assert!(!policy.is_allowed("unknown"));
    }

    #[test]
    fn test_merged_policy_allow_all() {
        let mut policy = MergedPolicy::new();
        policy.allow_all = true;
        policy.denied_tools.insert("rm".to_string());

        assert!(policy.is_allowed("bash"));
        assert!(policy.is_allowed("any_tool"));
        assert!(!policy.is_allowed("rm")); // deny takes precedence
    }

    #[test]
    fn test_policy_error_display() {
        let err = PolicyError::ProfileNotFound("test".to_string());
        assert_eq!(err.to_string(), "Profile not found: test");

        let err = PolicyError::InvalidConfig("bad config".to_string());
        assert_eq!(err.to_string(), "Invalid profile configuration: bad config");
    }

    #[test]
    fn test_tool_policy_serialization() {
        let policy = ToolPolicy::new(PolicyLayer::Agent)
            .with_allow(vec!["bash".to_string()])
            .with_description("Test");

        let json = serde_json::to_string(&policy).unwrap();
        let deserialized: ToolPolicy = serde_json::from_str(&json).unwrap();

        assert_eq!(policy, deserialized);
    }
}
