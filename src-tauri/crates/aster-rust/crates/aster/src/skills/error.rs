//! Skill Error Types
//!
//! 定义 Skills 系统的错误类型，用于执行引擎和工作流处理。
//!
//! # 错误分类
//!
//! | 错误类型 | 触发条件 | 处理策略 |
//! |---------|---------|---------|
//! | `InvalidConfig` | Workflow 模式但无 workflow 定义 | 立即返回错误 |
//! | `ProviderError` | LLM API 调用失败 | 重试或返回错误 |
//! | `ExecutionFailed` | 步骤执行失败且重试耗尽 | 根据 continue_on_failure 决定 |
//! | `NotImplemented` | 尝试执行 Agent 模式 | 立即返回错误 |
//! | `CyclicDependency` | 工作流存在循环依赖 | 立即返回错误 |
//! | `MissingDependency` | 步骤引用不存在的依赖 | 立即返回错误 |
//!
//! # 示例
//!
//! ```rust
//! use aster::skills::error::SkillError;
//!
//! // 创建配置错误
//! let err = SkillError::InvalidConfig("缺少 workflow 定义".to_string());
//! assert!(err.to_string().contains("配置错误"));
//!
//! // 创建循环依赖错误
//! let err = SkillError::CyclicDependency("step1 -> step2 -> step1".to_string());
//! assert!(err.to_string().contains("循环依赖"));
//! ```

/// Skill 错误类型
///
/// 定义 Skills 系统执行过程中可能发生的各种错误。
/// 每种错误类型都包含一个描述性消息字符串。
///
/// # 变体说明
///
/// - `InvalidConfig`: 配置错误，如 Workflow 模式缺少 workflow 定义
/// - `ProviderError`: LLM Provider 调用失败
/// - `ExecutionFailed`: 步骤执行失败（重试耗尽后）
/// - `NotImplemented`: 功能未实现（如 Agent 模式）
/// - `CyclicDependency`: 工作流步骤存在循环依赖
/// - `MissingDependency`: 步骤引用了不存在的依赖
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SkillError {
    /// 配置错误（如缺少 workflow 定义）
    ///
    /// 当 Skill 配置不完整或无效时返回此错误。
    ///
    /// # 示例场景
    /// - Workflow 模式但未定义 workflow
    /// - 必需字段缺失
    InvalidConfig(String),

    /// Provider 调用错误
    ///
    /// 当 LLM Provider API 调用失败时返回此错误。
    ///
    /// # 示例场景
    /// - API 请求超时
    /// - 认证失败
    /// - 速率限制
    ProviderError(String),

    /// 执行失败
    ///
    /// 当步骤执行失败且重试耗尽时返回此错误。
    ///
    /// # 示例场景
    /// - LLM 返回无效响应
    /// - 步骤处理逻辑错误
    ExecutionFailed(String),

    /// 功能未实现
    ///
    /// 当尝试使用尚未实现的功能时返回此错误。
    ///
    /// # 示例场景
    /// - 尝试执行 Agent 模式
    /// - 使用预留但未实现的特性
    NotImplemented(String),

    /// 循环依赖
    ///
    /// 当工作流步骤之间存在循环依赖时返回此错误。
    ///
    /// # 示例场景
    /// - step1 依赖 step2，step2 依赖 step1
    /// - 更复杂的循环链：A -> B -> C -> A
    CyclicDependency(String),

    /// 依赖不存在
    ///
    /// 当步骤引用了不存在的依赖时返回此错误。
    ///
    /// # 示例场景
    /// - 步骤声明依赖 "step_x"，但 "step_x" 不存在
    /// - 依赖 ID 拼写错误
    MissingDependency(String),
}

impl std::fmt::Display for SkillError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidConfig(msg) => write!(f, "配置错误: {}", msg),
            Self::ProviderError(msg) => write!(f, "Provider 错误: {}", msg),
            Self::ExecutionFailed(msg) => write!(f, "执行失败: {}", msg),
            Self::NotImplemented(msg) => write!(f, "未实现: {}", msg),
            Self::CyclicDependency(msg) => write!(f, "循环依赖: {}", msg),
            Self::MissingDependency(msg) => write!(f, "依赖不存在: {}", msg),
        }
    }
}

impl std::error::Error for SkillError {}

impl SkillError {
    /// 创建配置错误
    ///
    /// # Arguments
    /// * `msg` - 错误描述消息
    ///
    /// # Returns
    /// `InvalidConfig` 变体的 `SkillError`
    pub fn invalid_config(msg: impl Into<String>) -> Self {
        Self::InvalidConfig(msg.into())
    }

    /// 创建 Provider 错误
    ///
    /// # Arguments
    /// * `msg` - 错误描述消息
    ///
    /// # Returns
    /// `ProviderError` 变体的 `SkillError`
    pub fn provider_error(msg: impl Into<String>) -> Self {
        Self::ProviderError(msg.into())
    }

    /// 创建执行失败错误
    ///
    /// # Arguments
    /// * `msg` - 错误描述消息
    ///
    /// # Returns
    /// `ExecutionFailed` 变体的 `SkillError`
    pub fn execution_failed(msg: impl Into<String>) -> Self {
        Self::ExecutionFailed(msg.into())
    }

    /// 创建未实现错误
    ///
    /// # Arguments
    /// * `msg` - 错误描述消息
    ///
    /// # Returns
    /// `NotImplemented` 变体的 `SkillError`
    pub fn not_implemented(msg: impl Into<String>) -> Self {
        Self::NotImplemented(msg.into())
    }

    /// 创建循环依赖错误
    ///
    /// # Arguments
    /// * `msg` - 错误描述消息（通常包含循环路径）
    ///
    /// # Returns
    /// `CyclicDependency` 变体的 `SkillError`
    pub fn cyclic_dependency(msg: impl Into<String>) -> Self {
        Self::CyclicDependency(msg.into())
    }

    /// 创建依赖不存在错误
    ///
    /// # Arguments
    /// * `msg` - 错误描述消息（通常包含缺失的依赖名称）
    ///
    /// # Returns
    /// `MissingDependency` 变体的 `SkillError`
    pub fn missing_dependency(msg: impl Into<String>) -> Self {
        Self::MissingDependency(msg.into())
    }

    /// 检查是否为配置错误
    pub fn is_invalid_config(&self) -> bool {
        matches!(self, Self::InvalidConfig(_))
    }

    /// 检查是否为 Provider 错误
    pub fn is_provider_error(&self) -> bool {
        matches!(self, Self::ProviderError(_))
    }

    /// 检查是否为执行失败错误
    pub fn is_execution_failed(&self) -> bool {
        matches!(self, Self::ExecutionFailed(_))
    }

    /// 检查是否为未实现错误
    pub fn is_not_implemented(&self) -> bool {
        matches!(self, Self::NotImplemented(_))
    }

    /// 检查是否为循环依赖错误
    pub fn is_cyclic_dependency(&self) -> bool {
        matches!(self, Self::CyclicDependency(_))
    }

    /// 检查是否为依赖不存在错误
    pub fn is_missing_dependency(&self) -> bool {
        matches!(self, Self::MissingDependency(_))
    }

    /// 获取错误消息
    pub fn message(&self) -> &str {
        match self {
            Self::InvalidConfig(msg) => msg,
            Self::ProviderError(msg) => msg,
            Self::ExecutionFailed(msg) => msg,
            Self::NotImplemented(msg) => msg,
            Self::CyclicDependency(msg) => msg,
            Self::MissingDependency(msg) => msg,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ==================== 错误创建测试 ====================

    #[test]
    fn test_invalid_config_creation() {
        let err = SkillError::InvalidConfig("缺少 workflow 定义".to_string());
        assert!(err.is_invalid_config());
        assert_eq!(err.message(), "缺少 workflow 定义");
    }

    #[test]
    fn test_provider_error_creation() {
        let err = SkillError::ProviderError("API 请求超时".to_string());
        assert!(err.is_provider_error());
        assert_eq!(err.message(), "API 请求超时");
    }

    #[test]
    fn test_execution_failed_creation() {
        let err = SkillError::ExecutionFailed("步骤执行失败".to_string());
        assert!(err.is_execution_failed());
        assert_eq!(err.message(), "步骤执行失败");
    }

    #[test]
    fn test_not_implemented_creation() {
        let err = SkillError::NotImplemented("Agent 模式".to_string());
        assert!(err.is_not_implemented());
        assert_eq!(err.message(), "Agent 模式");
    }

    #[test]
    fn test_cyclic_dependency_creation() {
        let err = SkillError::CyclicDependency("step1 -> step2 -> step1".to_string());
        assert!(err.is_cyclic_dependency());
        assert_eq!(err.message(), "step1 -> step2 -> step1");
    }

    #[test]
    fn test_missing_dependency_creation() {
        let err = SkillError::MissingDependency("step_x".to_string());
        assert!(err.is_missing_dependency());
        assert_eq!(err.message(), "step_x");
    }

    // ==================== 便捷构造函数测试 ====================

    #[test]
    fn test_invalid_config_helper() {
        let err = SkillError::invalid_config("测试消息");
        assert!(err.is_invalid_config());
        assert_eq!(err.message(), "测试消息");
    }

    #[test]
    fn test_provider_error_helper() {
        let err = SkillError::provider_error("测试消息");
        assert!(err.is_provider_error());
        assert_eq!(err.message(), "测试消息");
    }

    #[test]
    fn test_execution_failed_helper() {
        let err = SkillError::execution_failed("测试消息");
        assert!(err.is_execution_failed());
        assert_eq!(err.message(), "测试消息");
    }

    #[test]
    fn test_not_implemented_helper() {
        let err = SkillError::not_implemented("测试消息");
        assert!(err.is_not_implemented());
        assert_eq!(err.message(), "测试消息");
    }

    #[test]
    fn test_cyclic_dependency_helper() {
        let err = SkillError::cyclic_dependency("测试消息");
        assert!(err.is_cyclic_dependency());
        assert_eq!(err.message(), "测试消息");
    }

    #[test]
    fn test_missing_dependency_helper() {
        let err = SkillError::missing_dependency("测试消息");
        assert!(err.is_missing_dependency());
        assert_eq!(err.message(), "测试消息");
    }

    // ==================== Display trait 测试 ====================

    #[test]
    fn test_display_invalid_config() {
        let err = SkillError::InvalidConfig("缺少必需字段".to_string());
        assert_eq!(err.to_string(), "配置错误: 缺少必需字段");
    }

    #[test]
    fn test_display_provider_error() {
        let err = SkillError::ProviderError("连接超时".to_string());
        assert_eq!(err.to_string(), "Provider 错误: 连接超时");
    }

    #[test]
    fn test_display_execution_failed() {
        let err = SkillError::ExecutionFailed("重试耗尽".to_string());
        assert_eq!(err.to_string(), "执行失败: 重试耗尽");
    }

    #[test]
    fn test_display_not_implemented() {
        let err = SkillError::NotImplemented("Agent 模式".to_string());
        assert_eq!(err.to_string(), "未实现: Agent 模式");
    }

    #[test]
    fn test_display_cyclic_dependency() {
        let err = SkillError::CyclicDependency("A -> B -> A".to_string());
        assert_eq!(err.to_string(), "循环依赖: A -> B -> A");
    }

    #[test]
    fn test_display_missing_dependency() {
        let err = SkillError::MissingDependency("unknown_step".to_string());
        assert_eq!(err.to_string(), "依赖不存在: unknown_step");
    }

    // ==================== std::error::Error trait 测试 ====================

    #[test]
    fn test_error_trait_implementation() {
        let err: Box<dyn std::error::Error> =
            Box::new(SkillError::InvalidConfig("test".to_string()));

        // 验证可以作为 dyn Error 使用
        assert!(err.to_string().contains("配置错误"));
    }

    #[test]
    fn test_error_source_is_none() {
        use std::error::Error;
        let err = SkillError::InvalidConfig("test".to_string());
        // SkillError 没有 source，应返回 None
        assert!(err.source().is_none());
    }

    // ==================== Clone 和 PartialEq 测试 ====================

    #[test]
    fn test_clone() {
        let err = SkillError::InvalidConfig("test".to_string());
        let cloned = err.clone();
        assert_eq!(err, cloned);
    }

    #[test]
    fn test_partial_eq() {
        let err1 = SkillError::InvalidConfig("test".to_string());
        let err2 = SkillError::InvalidConfig("test".to_string());
        let err3 = SkillError::InvalidConfig("different".to_string());
        let err4 = SkillError::ProviderError("test".to_string());

        assert_eq!(err1, err2);
        assert_ne!(err1, err3);
        assert_ne!(err1, err4);
    }

    // ==================== Debug trait 测试 ====================

    #[test]
    fn test_debug_format() {
        let err = SkillError::InvalidConfig("test message".to_string());
        let debug_str = format!("{:?}", err);
        assert!(debug_str.contains("InvalidConfig"));
        assert!(debug_str.contains("test message"));
    }

    // ==================== is_* 方法互斥性测试 ====================

    #[test]
    fn test_is_methods_are_mutually_exclusive() {
        let errors = vec![
            SkillError::InvalidConfig("".to_string()),
            SkillError::ProviderError("".to_string()),
            SkillError::ExecutionFailed("".to_string()),
            SkillError::NotImplemented("".to_string()),
            SkillError::CyclicDependency("".to_string()),
            SkillError::MissingDependency("".to_string()),
        ];

        for err in &errors {
            let checks = [
                err.is_invalid_config(),
                err.is_provider_error(),
                err.is_execution_failed(),
                err.is_not_implemented(),
                err.is_cyclic_dependency(),
                err.is_missing_dependency(),
            ];

            // 确保只有一个 is_* 方法返回 true
            let true_count = checks.iter().filter(|&&x| x).count();
            assert_eq!(true_count, 1, "每个错误应该只匹配一个 is_* 方法");
        }
    }

    // ==================== 空消息测试 ====================

    #[test]
    fn test_empty_message() {
        let err = SkillError::InvalidConfig(String::new());
        assert_eq!(err.message(), "");
        assert_eq!(err.to_string(), "配置错误: ");
    }

    // ==================== Unicode 消息测试 ====================

    #[test]
    fn test_unicode_message() {
        let err = SkillError::InvalidConfig("配置文件格式错误 🔧".to_string());
        assert_eq!(err.message(), "配置文件格式错误 🔧");
        assert!(err.to_string().contains("🔧"));
    }

    // ==================== 长消息测试 ====================

    #[test]
    fn test_long_message() {
        let long_msg = "a".repeat(10000);
        let err = SkillError::InvalidConfig(long_msg.clone());
        assert_eq!(err.message(), long_msg);
    }
}
