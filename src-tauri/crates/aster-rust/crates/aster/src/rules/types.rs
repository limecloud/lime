//! Rules 模块类型定义
//!

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// 项目规则
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ProjectRules {
    /// 项目指令
    #[serde(skip_serializing_if = "Option::is_none")]
    pub instructions: Option<String>,
    /// 允许的工具
    #[serde(skip_serializing_if = "Option::is_none")]
    pub allowed_tools: Option<Vec<String>>,
    /// 禁止的工具
    #[serde(skip_serializing_if = "Option::is_none")]
    pub disallowed_tools: Option<Vec<String>>,
    /// 权限模式
    #[serde(skip_serializing_if = "Option::is_none")]
    pub permission_mode: Option<String>,
    /// 模型
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    /// 系统提示词
    #[serde(skip_serializing_if = "Option::is_none")]
    pub system_prompt: Option<String>,
    /// 自定义规则
    #[serde(skip_serializing_if = "Option::is_none")]
    pub custom_rules: Option<Vec<CustomRule>>,
    /// 记忆/上下文
    #[serde(skip_serializing_if = "Option::is_none")]
    pub memory: Option<HashMap<String, String>>,
}

/// 自定义规则
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CustomRule {
    /// 规则名称
    pub name: String,
    /// 匹配模式
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pattern: Option<String>,
    /// 动作
    pub action: RuleAction,
    /// 消息
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    /// 转换内容
    #[serde(skip_serializing_if = "Option::is_none")]
    pub transform: Option<String>,
}

/// 规则动作
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum RuleAction {
    Allow,
    Deny,
    #[default]
    Warn,
    Transform,
}

/// AGENTS.md 章节
#[derive(Debug, Clone)]
pub struct AgentsMdSection {
    /// 标题
    pub title: String,
    /// 内容
    pub content: String,
    /// 标题级别
    pub level: usize,
}

/// 规则应用结果
#[derive(Debug, Clone)]
pub struct RuleApplyResult {
    /// 处理后的内容
    pub result: String,
    /// 警告信息
    pub warnings: Vec<String>,
    /// 是否被阻止
    pub blocked: bool,
}
