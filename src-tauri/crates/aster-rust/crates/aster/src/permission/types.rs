//! 工具权限系统核心类型定义
//!
//! 本模块定义了工具权限系统的所有基础类型，包括：
//! - 权限范围枚举 (PermissionScope)
//! - 条件类型和运算符枚举
//! - 参数限制类型枚举
//! - 合并策略枚举
//!
//! Requirements: 1.1, 2.2

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

/// 权限条件验证器类型
pub(crate) type PermissionConditionValidator =
    Arc<dyn Fn(&PermissionContext) -> bool + Send + Sync>;

/// 参数限制验证器类型
pub(crate) type ParameterRestrictionValidator =
    Arc<dyn Fn(&serde_json::Value) -> bool + Send + Sync>;

/// 权限范围
///
/// 定义权限的作用域级别，优先级从低到高：Global < Project < Session
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
pub enum PermissionScope {
    /// 全局权限，适用于所有项目
    #[default]
    Global,
    /// 项目权限，仅适用于特定项目
    Project,
    /// 会话权限，仅在当前会话有效（内存存储）
    Session,
}

/// 条件类型
///
/// 定义权限条件的类型分类
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub enum ConditionType {
    /// 基于上下文的条件（如工作目录）
    #[default]
    Context,
    /// 基于时间的条件
    Time,
    /// 基于用户的条件
    User,
    /// 基于会话的条件
    Session,
    /// 自定义条件
    Custom,
}

/// 条件运算符
///
/// 定义条件评估时使用的比较运算符
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub enum ConditionOperator {
    /// 等于
    #[default]
    Equals,
    /// 不等于
    NotEquals,
    /// 包含
    Contains,
    /// 不包含
    NotContains,
    /// 正则匹配
    Matches,
    /// 正则不匹配
    NotMatches,
    /// 范围内
    Range,
    /// 在列表中
    In,
    /// 不在列表中
    NotIn,
    /// 自定义验证器
    Custom,
}

/// 参数限制类型
///
/// 定义对工具参数值的限制方式
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub enum RestrictionType {
    /// 白名单：只允许指定的值
    #[default]
    Whitelist,
    /// 黑名单：禁止指定的值
    Blacklist,
    /// 模式匹配：使用正则表达式验证
    Pattern,
    /// 自定义验证器
    Validator,
    /// 范围限制：数值范围
    Range,
}

/// 合并策略
///
/// 定义多个权限规则合并时的策略
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub enum MergeStrategy {
    /// 覆盖：高优先级完全替换低优先级
    #[default]
    Override,
    /// 合并：合并条件和限制
    Merge,
    /// 联合：保留两者
    Union,
}

/// 权限条件
///
/// 基于上下文的动态权限判断条件
/// Requirements: 4.1, 4.4
#[derive(Clone, Serialize, Deserialize)]
pub struct PermissionCondition {
    /// 条件类型
    pub condition_type: ConditionType,
    /// 要检查的字段名
    pub field: Option<String>,
    /// 比较运算符
    pub operator: ConditionOperator,
    /// 比较值
    pub value: serde_json::Value,
    /// 自定义验证器函数（不序列化）
    #[serde(skip)]
    pub validator: Option<PermissionConditionValidator>,
    /// 条件描述
    pub description: Option<String>,
}

impl std::fmt::Debug for PermissionCondition {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("PermissionCondition")
            .field("condition_type", &self.condition_type)
            .field("field", &self.field)
            .field("operator", &self.operator)
            .field("value", &self.value)
            .field("validator", &self.validator.as_ref().map(|_| "<fn>"))
            .field("description", &self.description)
            .finish()
    }
}

impl Default for PermissionCondition {
    fn default() -> Self {
        Self {
            condition_type: ConditionType::default(),
            field: None,
            operator: ConditionOperator::default(),
            value: serde_json::Value::Null,
            validator: None,
            description: None,
        }
    }
}

impl PartialEq for PermissionCondition {
    fn eq(&self, other: &Self) -> bool {
        self.condition_type == other.condition_type
            && self.field == other.field
            && self.operator == other.operator
            && self.value == other.value
            && self.description == other.description
    }
}

/// 参数限制
///
/// 对工具参数值进行约束的规则
/// Requirements: 3.1, 3.2, 3.3, 3.4, 3.5
#[derive(Clone, Default, Serialize, Deserialize)]
pub struct ParameterRestriction {
    /// 参数名称
    pub parameter: String,
    /// 限制类型
    pub restriction_type: RestrictionType,
    /// 允许/禁止的值列表（用于 Whitelist/Blacklist）
    pub values: Option<Vec<serde_json::Value>>,
    /// 正则表达式模式（用于 Pattern）
    pub pattern: Option<String>,
    /// 自定义验证器函数（不序列化）
    #[serde(skip)]
    pub validator: Option<ParameterRestrictionValidator>,
    /// 最小值（用于 Range）
    pub min: Option<f64>,
    /// 最大值（用于 Range）
    pub max: Option<f64>,
    /// 是否必需
    pub required: bool,
    /// 限制描述
    pub description: Option<String>,
}

impl std::fmt::Debug for ParameterRestriction {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ParameterRestriction")
            .field("parameter", &self.parameter)
            .field("restriction_type", &self.restriction_type)
            .field("values", &self.values)
            .field("pattern", &self.pattern)
            .field("validator", &self.validator.as_ref().map(|_| "<fn>"))
            .field("min", &self.min)
            .field("max", &self.max)
            .field("required", &self.required)
            .field("description", &self.description)
            .finish()
    }
}

impl PartialEq for ParameterRestriction {
    fn eq(&self, other: &Self) -> bool {
        self.parameter == other.parameter
            && self.restriction_type == other.restriction_type
            && self.values == other.values
            && self.pattern == other.pattern
            && self.min == other.min
            && self.max == other.max
            && self.required == other.required
            && self.description == other.description
    }
}

/// 工具权限定义
///
/// 定义单个工具的权限规则
/// Requirements: 2.2, 2.4, 2.5
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolPermission {
    /// 工具名称（支持通配符，如 "file_*"）
    pub tool: String,
    /// 是否允许执行
    pub allowed: bool,
    /// 优先级（数值越大优先级越高）
    pub priority: i32,
    /// 权限条件列表
    pub conditions: Vec<PermissionCondition>,
    /// 参数限制列表
    pub parameter_restrictions: Vec<ParameterRestriction>,
    /// 权限范围
    pub scope: PermissionScope,
    /// 权限原因说明
    pub reason: Option<String>,
    /// 过期时间戳（Unix 时间戳，None 表示永不过期）
    pub expires_at: Option<i64>,
    /// 扩展元数据
    pub metadata: HashMap<String, serde_json::Value>,
}

impl Default for ToolPermission {
    fn default() -> Self {
        Self {
            tool: String::new(),
            allowed: true,
            priority: 0,
            conditions: Vec::new(),
            parameter_restrictions: Vec::new(),
            scope: PermissionScope::default(),
            reason: None,
            expires_at: None,
            metadata: HashMap::new(),
        }
    }
}

impl PartialEq for ToolPermission {
    fn eq(&self, other: &Self) -> bool {
        self.tool == other.tool
            && self.allowed == other.allowed
            && self.priority == other.priority
            && self.conditions == other.conditions
            && self.parameter_restrictions == other.parameter_restrictions
            && self.scope == other.scope
            && self.reason == other.reason
            && self.expires_at == other.expires_at
            && self.metadata == other.metadata
    }
}

/// 权限上下文
///
/// 包含工具执行时的环境信息
/// Requirements: 4.1
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PermissionContext {
    /// 当前工作目录
    pub working_directory: PathBuf,
    /// 会话 ID
    pub session_id: String,
    /// 时间戳（Unix 时间戳）
    pub timestamp: i64,
    /// 用户标识
    pub user: Option<String>,
    /// 环境变量
    pub environment: HashMap<String, String>,
    /// 扩展元数据
    pub metadata: HashMap<String, serde_json::Value>,
}

impl Default for PermissionContext {
    fn default() -> Self {
        Self {
            working_directory: PathBuf::new(),
            session_id: String::new(),
            timestamp: 0,
            user: None,
            environment: HashMap::new(),
            metadata: HashMap::new(),
        }
    }
}

/// 权限检查结果
///
/// 包含权限检查的详细结果信息
/// Requirements: 5.1
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PermissionResult {
    /// 是否允许执行
    pub allowed: bool,
    /// 原因说明
    pub reason: Option<String>,
    /// 是否有参数限制
    pub restricted: bool,
    /// 解决建议列表
    pub suggestions: Vec<String>,
    /// 匹配的权限规则
    pub matched_rule: Option<ToolPermission>,
    /// 违规详情列表
    pub violations: Vec<String>,
}

impl Default for PermissionResult {
    fn default() -> Self {
        Self {
            allowed: true,
            reason: None,
            restricted: false,
            suggestions: Vec::new(),
            matched_rule: None,
            violations: Vec::new(),
        }
    }
}

impl PermissionResult {
    /// 创建允许的结果
    pub fn allow() -> Self {
        Self {
            allowed: true,
            ..Default::default()
        }
    }

    /// 创建拒绝的结果
    pub fn deny(reason: impl Into<String>) -> Self {
        Self {
            allowed: false,
            reason: Some(reason.into()),
            ..Default::default()
        }
    }

    /// 创建带违规信息的拒绝结果
    pub fn deny_with_violations(reason: impl Into<String>, violations: Vec<String>) -> Self {
        Self {
            allowed: false,
            reason: Some(reason.into()),
            violations,
            ..Default::default()
        }
    }
}

/// 工具权限更新
///
/// 用于部分更新权限字段的结构体
/// Requirements: 1.1
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ToolPermissionUpdate {
    /// 更新是否允许执行
    pub allowed: Option<bool>,
    /// 更新优先级
    pub priority: Option<i32>,
    /// 更新权限条件列表
    pub conditions: Option<Vec<PermissionCondition>>,
    /// 更新参数限制列表
    pub parameter_restrictions: Option<Vec<ParameterRestriction>>,
    /// 更新权限原因说明
    pub reason: Option<Option<String>>,
    /// 更新过期时间戳
    pub expires_at: Option<Option<i64>>,
    /// 更新扩展元数据
    pub metadata: Option<HashMap<String, serde_json::Value>>,
}

impl ToolPermissionUpdate {
    /// Create a new empty update
    pub fn new() -> Self {
        Self::default()
    }

    /// Set the allowed field
    pub fn with_allowed(mut self, allowed: bool) -> Self {
        self.allowed = Some(allowed);
        self
    }

    /// Set the priority field
    pub fn with_priority(mut self, priority: i32) -> Self {
        self.priority = Some(priority);
        self
    }

    /// Set the conditions field
    pub fn with_conditions(mut self, conditions: Vec<PermissionCondition>) -> Self {
        self.conditions = Some(conditions);
        self
    }

    /// Set the parameter_restrictions field
    pub fn with_parameter_restrictions(mut self, restrictions: Vec<ParameterRestriction>) -> Self {
        self.parameter_restrictions = Some(restrictions);
        self
    }

    /// Set the reason field
    pub fn with_reason(mut self, reason: Option<String>) -> Self {
        self.reason = Some(reason);
        self
    }

    /// Set the expires_at field
    pub fn with_expires_at(mut self, expires_at: Option<i64>) -> Self {
        self.expires_at = Some(expires_at);
        self
    }

    /// Set the metadata field
    pub fn with_metadata(mut self, metadata: HashMap<String, serde_json::Value>) -> Self {
        self.metadata = Some(metadata);
        self
    }
}

/// 权限统计信息
///
/// 提供权限配置的统计摘要
/// Requirements: 9.1
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct PermissionStats {
    /// 总权限数量
    pub total_permissions: usize,
    /// 允许的工具数量
    pub allowed_tools: usize,
    /// 拒绝的工具数量
    pub denied_tools: usize,
    /// 带条件的工具数量
    pub conditional_tools: usize,
    /// 带参数限制的权限数量
    pub restricted_parameters: usize,
}

impl PermissionStats {
    /// Create a new empty stats
    pub fn new() -> Self {
        Self::default()
    }
}

/// 权限查询过滤器
///
/// 用于查询和过滤权限的条件
/// Requirements: 9.2, 9.3
#[derive(Debug, Clone, Default)]
pub struct PermissionFilter {
    /// 按允许状态过滤
    pub allowed: Option<bool>,
    /// 按权限范围过滤
    pub scope: Option<PermissionScope>,
    /// 按是否有条件过滤
    pub has_conditions: Option<bool>,
    /// 按是否有参数限制过滤
    pub has_restrictions: Option<bool>,
    /// 按工具名模式过滤（支持通配符）
    pub tool_pattern: Option<String>,
}

impl PermissionFilter {
    /// Create a new empty filter
    pub fn new() -> Self {
        Self::default()
    }

    /// Set the allowed filter
    pub fn with_allowed(mut self, allowed: bool) -> Self {
        self.allowed = Some(allowed);
        self
    }

    /// Set the scope filter
    pub fn with_scope(mut self, scope: PermissionScope) -> Self {
        self.scope = Some(scope);
        self
    }

    /// Set the has_conditions filter
    pub fn with_has_conditions(mut self, has_conditions: bool) -> Self {
        self.has_conditions = Some(has_conditions);
        self
    }

    /// Set the has_restrictions filter
    pub fn with_has_restrictions(mut self, has_restrictions: bool) -> Self {
        self.has_restrictions = Some(has_restrictions);
        self
    }

    /// Set the tool_pattern filter
    pub fn with_tool_pattern(mut self, pattern: impl Into<String>) -> Self {
        self.tool_pattern = Some(pattern.into());
        self
    }
}

/// 权限继承配置
///
/// 配置权限在不同范围之间的继承行为
/// Requirements: 6.1, 6.2, 6.3
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PermissionInheritance {
    /// 是否继承全局权限
    pub inherit_global: bool,
    /// 是否继承项目权限
    pub inherit_project: bool,
    /// 是否允许覆盖全局权限
    pub override_global: bool,
    /// 合并策略
    pub merge_strategy: MergeStrategy,
}

impl Default for PermissionInheritance {
    fn default() -> Self {
        Self {
            inherit_global: true,
            inherit_project: true,
            override_global: true,
            merge_strategy: MergeStrategy::Override,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_permission_scope_default() {
        assert_eq!(PermissionScope::default(), PermissionScope::Global);
    }

    #[test]
    fn test_condition_type_default() {
        assert_eq!(ConditionType::default(), ConditionType::Context);
    }

    #[test]
    fn test_condition_operator_default() {
        assert_eq!(ConditionOperator::default(), ConditionOperator::Equals);
    }

    #[test]
    fn test_restriction_type_default() {
        assert_eq!(RestrictionType::default(), RestrictionType::Whitelist);
    }

    #[test]
    fn test_merge_strategy_default() {
        assert_eq!(MergeStrategy::default(), MergeStrategy::Override);
    }

    #[test]
    fn test_permission_result_allow() {
        let result = PermissionResult::allow();
        assert!(result.allowed);
        assert!(result.reason.is_none());
    }

    #[test]
    fn test_permission_result_deny() {
        let result = PermissionResult::deny("test reason");
        assert!(!result.allowed);
        assert_eq!(result.reason, Some("test reason".to_string()));
    }

    #[test]
    fn test_permission_result_deny_with_violations() {
        let violations = vec!["violation1".to_string(), "violation2".to_string()];
        let result = PermissionResult::deny_with_violations("test reason", violations.clone());
        assert!(!result.allowed);
        assert_eq!(result.reason, Some("test reason".to_string()));
        assert_eq!(result.violations, violations);
    }

    #[test]
    fn test_tool_permission_serialization() {
        let permission = ToolPermission {
            tool: "bash_*".to_string(),
            allowed: true,
            priority: 10,
            scope: PermissionScope::Project,
            ..Default::default()
        };

        let json = serde_json::to_string(&permission).unwrap();
        let deserialized: ToolPermission = serde_json::from_str(&json).unwrap();

        assert_eq!(permission.tool, deserialized.tool);
        assert_eq!(permission.allowed, deserialized.allowed);
        assert_eq!(permission.priority, deserialized.priority);
        assert_eq!(permission.scope, deserialized.scope);
    }

    #[test]
    fn test_permission_inheritance_default() {
        let inheritance = PermissionInheritance::default();
        assert!(inheritance.inherit_global);
        assert!(inheritance.inherit_project);
        assert!(inheritance.override_global);
        assert_eq!(inheritance.merge_strategy, MergeStrategy::Override);
    }

    #[test]
    fn test_tool_permission_update_default() {
        let update = ToolPermissionUpdate::default();
        assert!(update.allowed.is_none());
        assert!(update.priority.is_none());
        assert!(update.conditions.is_none());
        assert!(update.parameter_restrictions.is_none());
        assert!(update.reason.is_none());
        assert!(update.expires_at.is_none());
        assert!(update.metadata.is_none());
    }

    #[test]
    fn test_tool_permission_update_builder() {
        let update = ToolPermissionUpdate::new()
            .with_allowed(false)
            .with_priority(100)
            .with_reason(Some("Updated reason".to_string()));

        assert_eq!(update.allowed, Some(false));
        assert_eq!(update.priority, Some(100));
        assert_eq!(update.reason, Some(Some("Updated reason".to_string())));
    }
}
