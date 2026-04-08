//! Codex 有状态 Provider 实现
//!
//! 该模块使用 Codex app-server 协议实现有状态的会话管理，
//! 支持上下文连贯的多轮对话。
//!
//! 与原有的 codex.rs (exec 模式) 不同，该实现：
//! - 维护长驻的 app-server 进程
//! - 使用 thread/turn 机制保持会话状态
//! - 支持会话恢复 (thread/resume)

use anyhow::Result;
use async_trait::async_trait;
use once_cell::sync::Lazy;
use serde_json::json;
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use super::base::{ConfigKey, Provider, ProviderMetadata, ProviderUsage, Usage};
use super::codex::{CODEX_DEFAULT_MODEL, CODEX_DOC_URL, CODEX_KNOWN_MODELS};
use super::codex_app_server::{AppServerEvent, CodexSessionManager};
use super::errors::ProviderError;
use super::utils::RequestLog;
use crate::config::base::{CodexCommand, CodexReasoningEffort, CodexUseAppServer};
use crate::config::search_path::SearchPaths;
use crate::config::Config;
use crate::conversation::message::{Message, MessageContent};
use crate::model::ModelConfig;
use rmcp::model::Role;
use rmcp::model::Tool;

/// 全局会话管理器
static SESSION_MANAGER: Lazy<Mutex<Option<CodexSessionManager>>> = Lazy::new(|| Mutex::new(None));

/// 获取或初始化会话管理器
fn get_session_manager(command: &Path) -> Result<(), ProviderError> {
    let mut manager = SESSION_MANAGER
        .lock()
        .map_err(|e| ProviderError::RequestFailed(format!("获取会话管理器锁失败: {}", e)))?;

    if manager.is_none() {
        *manager = Some(CodexSessionManager::new(command.to_path_buf()));
    }

    Ok(())
}

/// Codex 有状态 Provider
#[derive(Debug)]
pub struct CodexStatefulProvider {
    command: PathBuf,
    model: ModelConfig,
    name: String,
    reasoning_effort: String,
}

impl CodexStatefulProvider {
    /// 从环境创建 Provider
    pub async fn from_env(model: ModelConfig) -> Result<Self> {
        let config = Config::global();
        let command: OsString = config.get_codex_command().unwrap_or_default().into();
        let resolved_command = SearchPaths::builder().with_npm().resolve(command)?;

        let reasoning_effort = config
            .get_codex_reasoning_effort()
            .map(|r| r.to_string())
            .unwrap_or_else(|_| "high".to_string());

        Ok(Self {
            command: resolved_command,
            model,
            name: "codex-stateful".to_string(),
            reasoning_effort,
        })
    }

    /// 检查是否应该使用 app-server 模式
    pub fn should_use_app_server() -> bool {
        let config = Config::global();
        config
            .get_codex_use_app_server()
            .map(|s| s.to_lowercase() == "true")
            .unwrap_or(true)
    }

    /// 将消息转换为用户输入文本
    fn messages_to_input(&self, system: &str, messages: &[Message]) -> String {
        let mut input = String::new();

        // 添加系统提示（如果有）
        if !system.is_empty() {
            input.push_str("[System Instructions]\n");
            input.push_str(system);
            input.push_str("\n\n");
        }

        // 只取最后一条用户消息作为当前输入
        // 历史消息由 app-server 的 thread 机制维护
        if let Some(last_user_msg) = messages.iter().rev().find(|m| m.role == Role::User) {
            for content in &last_user_msg.content {
                if let MessageContent::Text(text_content) = content {
                    input.push_str(&text_content.text);
                }
            }
        }

        input
    }

    /// 生成会话 ID（基于消息内容的哈希）
    fn generate_conversation_id(&self, messages: &[Message]) -> String {
        use std::collections::hash_map::DefaultHasher;
        use std::hash::{Hash, Hasher};

        let mut hasher = DefaultHasher::new();

        // 使用第一条用户消息作为会话标识
        if let Some(first_user_msg) = messages.iter().find(|m| m.role == Role::User) {
            for content in &first_user_msg.content {
                if let MessageContent::Text(text_content) = content {
                    text_content.text.hash(&mut hasher);
                    break;
                }
            }
        }

        format!("conv_{:x}", hasher.finish())
    }

    /// 使用 app-server 执行请求
    fn execute_with_app_server(
        &self,
        system: &str,
        messages: &[Message],
    ) -> Result<(String, Usage), ProviderError> {
        // 初始化会话管理器
        get_session_manager(&self.command)?;

        let conversation_id = self.generate_conversation_id(messages);
        let input = self.messages_to_input(system, messages);

        // 获取当前工作目录
        let cwd = std::env::current_dir()
            .ok()
            .map(|p| p.to_string_lossy().to_string());

        // 获取或创建连接
        {
            let manager = SESSION_MANAGER.lock().map_err(|e| {
                ProviderError::RequestFailed(format!("获取会话管理器锁失败: {}", e))
            })?;

            if let Some(mgr) = manager.as_ref() {
                mgr.get_or_create_connection(
                    &conversation_id,
                    cwd.as_deref(),
                    Some(&self.model.model_name),
                )?;
            }
        }

        // 发送消息
        let (response_text, events) = {
            let manager = SESSION_MANAGER.lock().map_err(|e| {
                ProviderError::RequestFailed(format!("获取会话管理器锁失败: {}", e))
            })?;

            if let Some(mgr) = manager.as_ref() {
                mgr.send_message(
                    &conversation_id,
                    &input,
                    Some(&self.model.model_name),
                    Some(&self.reasoning_effort),
                )?
            } else {
                return Err(ProviderError::RequestFailed(
                    "会话管理器未初始化".to_string(),
                ));
            }
        };

        // 从事件中提取 usage 信息
        let usage = self.extract_usage_from_events(&events);

        if std::env::var("ASTER_CODEX_DEBUG").is_ok() {
            println!("=== CODEX STATEFUL DEBUG ===");
            println!("Conversation ID: {}", conversation_id);
            println!("Input: {}", input);
            println!("Response: {}", response_text);
            println!("Events count: {}", events.len());
            println!("============================");
        }

        Ok((response_text, usage))
    }

    /// 从事件中提取 usage 信息
    fn extract_usage_from_events(&self, _events: &[AppServerEvent]) -> Usage {
        // TODO: 从 turn/completed 事件中提取 token 使用量
        // 目前 app-server 协议的 usage 信息可能在 turn/completed 的 params 中
        Usage::default()
    }

    /// 生成简单的会话描述
    fn generate_simple_session_description(
        &self,
        messages: &[Message],
    ) -> Result<(Message, ProviderUsage), ProviderError> {
        let description = messages
            .iter()
            .find(|m| m.role == Role::User)
            .and_then(|m| {
                m.content.iter().find_map(|c| match c {
                    MessageContent::Text(text_content) => Some(&text_content.text),
                    _ => None,
                })
            })
            .map(|text| {
                text.split_whitespace()
                    .take(4)
                    .collect::<Vec<_>>()
                    .join(" ")
            })
            .unwrap_or_else(|| "Simple task".to_string());

        let message = Message::new(
            Role::Assistant,
            chrono::Utc::now().timestamp(),
            vec![MessageContent::text(description)],
        );

        Ok((
            message,
            ProviderUsage::new(self.model.model_name.clone(), Usage::default()),
        ))
    }
}

#[async_trait]
impl Provider for CodexStatefulProvider {
    fn metadata() -> ProviderMetadata {
        ProviderMetadata::new(
            "codex-stateful",
            "OpenAI Codex CLI (Stateful)",
            "使用 app-server 协议的有状态 Codex Provider，支持会话持久化和上下文连贯。",
            CODEX_DEFAULT_MODEL,
            CODEX_KNOWN_MODELS.to_vec(),
            CODEX_DOC_URL,
            vec![
                ConfigKey::from_value_type::<CodexCommand>(true, false),
                ConfigKey::from_value_type::<CodexReasoningEffort>(false, false),
                ConfigKey::from_value_type::<CodexUseAppServer>(false, false),
            ],
        )
    }

    fn get_name(&self) -> &str {
        &self.name
    }

    fn get_model_config(&self) -> ModelConfig {
        self.model.clone()
    }

    fn supports_native_output_schema(&self) -> bool {
        true
    }

    #[tracing::instrument(
        skip(self, model_config, system, messages, _tools),
        fields(model_config, input, output, input_tokens, output_tokens, total_tokens)
    )]
    async fn complete_with_model(
        &self,
        model_config: &ModelConfig,
        system: &str,
        messages: &[Message],
        _tools: &[Tool],
    ) -> Result<(Message, ProviderUsage), ProviderError> {
        // 会话描述请求使用简单方式
        if system.contains("four words or less") || system.contains("4 words or less") {
            return self.generate_simple_session_description(messages);
        }

        // 使用 app-server 执行
        let (response_text, usage) = self.execute_with_app_server(system, messages)?;

        if response_text.is_empty() {
            return Err(ProviderError::RequestFailed(
                "Codex app-server 返回空响应".to_string(),
            ));
        }

        let message = Message::new(
            Role::Assistant,
            chrono::Utc::now().timestamp(),
            vec![MessageContent::text(response_text)],
        );

        // 记录请求日志
        let payload = json!({
            "command": self.command,
            "model": model_config.model_name,
            "reasoning_effort": self.reasoning_effort,
            "mode": "app-server",
            "messages_count": messages.len()
        });

        let mut log = RequestLog::start(model_config, &payload)
            .map_err(|e| ProviderError::RequestFailed(format!("记录请求日志失败: {}", e)))?;

        let response = json!({
            "usage": usage
        });

        log.write(&response, Some(&usage))
            .map_err(|e| ProviderError::RequestFailed(format!("写入请求日志失败: {}", e)))?;

        Ok((
            message,
            ProviderUsage::new(model_config.model_name.clone(), usage),
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_metadata() {
        let metadata = CodexStatefulProvider::metadata();
        assert_eq!(metadata.name, "codex-stateful");
        assert!(!metadata.known_models.is_empty());
    }

    #[test]
    fn test_should_use_app_server_default() {
        // 默认应该使用 app-server
        // 注意：这个测试可能受环境变量影响
        let _result = CodexStatefulProvider::should_use_app_server();
        // 测试只验证函数能正常调用，结果依赖环境变量
    }
}
