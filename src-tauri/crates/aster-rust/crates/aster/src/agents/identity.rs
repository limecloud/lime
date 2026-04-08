//! Agent 身份配置
//!
//! 允许应用层完全控制 Agent 的身份定义，
//! 而不是使用框架默认的 "aster by Block"。

use serde::Serialize;

/// Agent 身份配置
///
/// 应用层通过此结构定义 Agent 的身份信息。
/// 框架会将身份信息与能力描述分开渲染，确保应用层可以
/// 完全控制 Agent 的"人设"，同时保留框架提供的能力。
#[derive(Debug, Clone, Serialize)]
pub struct AgentIdentity {
    /// Agent 名称（如 "ProxyCast 助手"、"Aster"）
    pub name: String,

    /// 创建者/公司名称（可选）
    pub creator: Option<String>,

    /// Agent 描述（可选，会显示在身份介绍后）
    pub description: Option<String>,

    /// 语言偏好（如 "Chinese"、"English"）
    pub language: Option<String>,

    /// 自定义身份提示词（如果设置，会完全替代默认身份模板）
    pub custom_prompt: Option<String>,
}

impl Default for AgentIdentity {
    fn default() -> Self {
        Self {
            name: "aster".to_string(),
            creator: Some("Block".to_string()),
            description: Some(
                "aster is being developed as an open-source software project.\n\
                 aster uses LLM providers with tool calling capability."
                    .to_string(),
            ),
            language: None,
            custom_prompt: None,
        }
    }
}

impl AgentIdentity {
    /// 创建新的身份配置
    pub fn new(name: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            creator: None,
            description: None,
            language: None,
            custom_prompt: None,
        }
    }

    /// 设置创建者
    pub fn with_creator(mut self, creator: impl Into<String>) -> Self {
        self.creator = Some(creator.into());
        self
    }

    /// 设置描述
    pub fn with_description(mut self, desc: impl Into<String>) -> Self {
        self.description = Some(desc.into());
        self
    }

    /// 设置语言偏好
    pub fn with_language(mut self, lang: impl Into<String>) -> Self {
        self.language = Some(lang.into());
        self
    }

    /// 设置完全自定义的身份提示词
    pub fn with_custom_prompt(mut self, prompt: impl Into<String>) -> Self {
        self.custom_prompt = Some(prompt.into());
        self
    }
}
