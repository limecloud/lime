//! 统一对话命令模块
//!
//! 提供统一的对话 API，支持多种对话模式：
//! - Agent: AI Agent 模式，支持工具调用
//! - General: 通用对话模式，纯文本
//! - Creator: 内容创作模式，支持画布输出
//!
//! ## 设计原则
//! - 单一入口：所有对话场景使用同一套 API
//! - 模式化设计：通过 ChatMode 区分不同场景
//! - Aster 引擎：底层使用 Aster Agent 处理对话
//!
//! ## 参考文档
//! - `docs/prd/chat-architecture-redesign.md`

use crate::agent::aster_state::SessionConfigBuilder;
use crate::agent::{AsterAgentState, TauriAgentEvent};
use crate::commands::aster_agent_cmd::ensure_browser_mcp_tools_registered;
use crate::config::GlobalConfigManagerState;
use crate::database::dao::chat::{ChatDao, ChatMessage, ChatMode, ChatSession};
use crate::database::DbConnection;
use crate::services::memory_profile_prompt_service::{
    merge_system_prompt_with_memory_profile, merge_system_prompt_with_memory_sources,
};
use crate::services::request_tool_policy_prompt_service::{
    execute_web_search_preflight_if_needed, merge_system_prompt_with_request_tool_policy,
    resolve_request_tool_policy, RequestToolPolicy, WebSearchExecutionTracker,
};
use crate::services::web_search_prompt_service::merge_system_prompt_with_web_search;
use crate::services::web_search_runtime_service::apply_web_search_runtime_env;
use aster::agents::extension::ExtensionConfig;
use aster::conversation::message::Message;
use futures::StreamExt;
use proxycast_agent::event_converter::convert_agent_event;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};

const CODE_EXECUTION_EXTENSION_NAME: &str = "code_execution";

// ============================================================================
// 请求/响应结构
// ============================================================================

/// 创建会话请求
#[derive(Debug, Deserialize)]
pub struct CreateSessionRequest {
    /// 对话模式
    pub mode: ChatMode,
    /// 会话标题（可选）
    pub title: Option<String>,
    /// 系统提示词（可选）
    pub system_prompt: Option<String>,
    /// Provider 类型（可选）
    pub provider_type: Option<String>,
    /// 模型名称（可选）
    pub model: Option<String>,
    /// 扩展元数据（可选）
    pub metadata: Option<serde_json::Value>,
}

/// 发送消息请求
#[derive(Debug, Deserialize)]
pub struct SendMessageRequest {
    /// 会话 ID
    #[serde(alias = "sessionId")]
    pub session_id: String,
    /// 消息内容
    pub message: String,
    /// 事件名称（用于前端监听）
    #[serde(alias = "eventName")]
    pub event_name: String,
    /// 图片输入（可选，用于多模态对话）
    /// TODO: 实现图片处理逻辑，将图片转换为 Aster Message 的 ImageContent
    pub images: Option<Vec<ImageInput>>,
    /// 请求级联网搜索开关
    #[serde(default, alias = "webSearch")]
    pub web_search: Option<bool>,
}

/// 图片输入
#[derive(Debug, Deserialize)]
pub struct ImageInput {
    /// Base64 编码的图片数据
    pub data: String,
    /// 图片 MIME 类型，如 "image/png", "image/jpeg"
    pub media_type: String,
}

/// 会话信息响应
#[derive(Debug, Serialize)]
pub struct SessionResponse {
    pub id: String,
    pub mode: ChatMode,
    pub title: Option<String>,
    pub model: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub message_count: usize,
}

impl From<ChatSession> for SessionResponse {
    fn from(session: ChatSession) -> Self {
        Self {
            id: session.id,
            mode: session.mode,
            title: session.title,
            model: session.model,
            created_at: session.created_at,
            updated_at: session.updated_at,
            message_count: 0,
        }
    }
}

// ============================================================================
// 会话管理命令
// ============================================================================

/// 创建新会话
///
/// 统一的会话创建入口，支持所有对话模式
#[tauri::command]
pub async fn chat_create_session(
    db: State<'_, DbConnection>,
    agent_state: State<'_, AsterAgentState>,
    config_manager: State<'_, GlobalConfigManagerState>,
    request: CreateSessionRequest,
) -> Result<SessionResponse, String> {
    let now = chrono::Utc::now().to_rfc3339();
    let session_id = uuid::Uuid::new_v4().to_string();

    let config = config_manager.config();
    let working_dir = std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from("."));
    let merged_system_prompt = merge_system_prompt_with_web_search(
        merge_system_prompt_with_memory_sources(
            merge_system_prompt_with_memory_profile(request.system_prompt.clone(), &config),
            &config,
            &working_dir,
            None,
        ),
        &config,
    );

    // 创建会话
    let session = ChatSession {
        id: session_id.clone(),
        mode: request.mode,
        title: request.title,
        system_prompt: merged_system_prompt,
        model: request.model.clone(),
        provider_type: request.provider_type.clone(),
        credential_uuid: None,
        metadata: request.metadata,
        created_at: now.clone(),
        updated_at: now,
    };

    // 保存到数据库（异步化）
    {
        let db = db.inner().clone();
        let session_clone = session.clone();
        tokio::task::spawn_blocking(move || {
            let conn = db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;
            ChatDao::create_session(&conn, &session_clone).map_err(|e| format!("创建会话失败: {e}"))
        })
        .await
        .map_err(|e| format!("任务执行失败: {e}"))??;
    }

    // 初始化 Aster Agent（如果是 Agent 或 Creator 模式）
    if matches!(request.mode, ChatMode::Agent | ChatMode::Creator) {
        agent_state.init_agent_with_db(&db).await?;

        // 如果指定了 Provider，配置它
        if let (Some(provider_type), Some(model)) = (&request.provider_type, &request.model) {
            agent_state
                .configure_provider_from_pool(&db, provider_type, model, &session_id)
                .await?;
        }
    }

    tracing::info!(
        "[UnifiedChat] 创建会话: id={}, mode={:?}",
        session_id,
        request.mode
    );

    Ok(SessionResponse::from(session))
}

/// 获取会话列表
///
/// 可选按模式过滤
#[tauri::command]
pub async fn chat_list_sessions(
    db: State<'_, DbConnection>,
    mode: Option<ChatMode>,
) -> Result<Vec<SessionResponse>, String> {
    let db = db.inner().clone();
    tokio::task::spawn_blocking(move || {
        let conn = db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;

        let sessions =
            ChatDao::list_sessions(&conn, mode).map_err(|e| format!("获取会话列表失败: {e}"))?;

        let mut result: Vec<SessionResponse> = Vec::new();
        for session in sessions {
            let message_count = ChatDao::get_message_count(&conn, &session.id).unwrap_or(0);
            let mut resp = SessionResponse::from(session);
            resp.message_count = message_count;
            result.push(resp);
        }

        Ok(result)
    })
    .await
    .map_err(|e| format!("任务执行失败: {e}"))?
}

/// 获取会话详情
#[tauri::command]
pub async fn chat_get_session(
    db: State<'_, DbConnection>,
    session_id: String,
) -> Result<SessionResponse, String> {
    let db = db.inner().clone();
    tokio::task::spawn_blocking(move || {
        let conn = db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;

        let session = ChatDao::get_session(&conn, &session_id)
            .map_err(|e| format!("获取会话失败: {e}"))?
            .ok_or_else(|| "会话不存在".to_string())?;

        let message_count = ChatDao::get_message_count(&conn, &session_id).unwrap_or(0);
        let mut resp = SessionResponse::from(session);
        resp.message_count = message_count;

        Ok(resp)
    })
    .await
    .map_err(|e| format!("任务执行失败: {e}"))?
}

/// 删除会话
#[tauri::command]
pub async fn chat_delete_session(
    db: State<'_, DbConnection>,
    session_id: String,
) -> Result<bool, String> {
    let db = db.inner().clone();
    tokio::task::spawn_blocking(move || {
        let conn = db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;

        let deleted = ChatDao::delete_session(&conn, &session_id)
            .map_err(|e| format!("删除会话失败: {e}"))?;

        if deleted {
            tracing::info!("[UnifiedChat] 删除会话: id={}", session_id);
        }

        Ok(deleted)
    })
    .await
    .map_err(|e| format!("任务执行失败: {e}"))?
}

/// 重命名会话
#[tauri::command]
pub async fn chat_rename_session(
    db: State<'_, DbConnection>,
    session_id: String,
    title: String,
) -> Result<(), String> {
    let db = db.inner().clone();
    tokio::task::spawn_blocking(move || {
        let conn = db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;

        ChatDao::update_title(&conn, &session_id, &title)
            .map_err(|e| format!("重命名会话失败: {e}"))?;

        tracing::info!(
            "[UnifiedChat] 重命名会话: id={}, title={}",
            session_id,
            title
        );

        Ok(())
    })
    .await
    .map_err(|e| format!("任务执行失败: {e}"))?
}

// ============================================================================
// 消息管理命令
// ============================================================================

/// 获取会话消息列表
#[tauri::command]
pub async fn chat_get_messages(
    db: State<'_, DbConnection>,
    session_id: String,
    limit: Option<i32>,
) -> Result<Vec<ChatMessage>, String> {
    let db = db.inner().clone();
    tokio::task::spawn_blocking(move || {
        let conn = db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;

        let messages = ChatDao::get_messages(&conn, &session_id, limit)
            .map_err(|e| format!("获取消息失败: {e}"))?;

        Ok(messages)
    })
    .await
    .map_err(|e| format!("任务执行失败: {e}"))?
}

/// 发送消息并获取流式响应
///
/// 统一的消息发送入口，根据会话模式选择处理方式
#[tauri::command]
pub async fn chat_send_message(
    app: AppHandle,
    db: State<'_, DbConnection>,
    agent_state: State<'_, AsterAgentState>,
    config_manager: State<'_, GlobalConfigManagerState>,
    request: SendMessageRequest,
) -> Result<(), String> {
    let start_time = std::time::Instant::now();

    let image_count = request.images.as_ref().map(|v| v.len()).unwrap_or(0);
    tracing::info!(
        "[UnifiedChat] 发送消息: session={}, event={}, images={}",
        request.session_id,
        request.event_name,
        image_count
    );

    // TODO: 实现图片处理逻辑，将图片转换为 Aster Message 的 ImageContent
    if let Some(images) = &request.images {
        for (i, img) in images.iter().enumerate() {
            tracing::debug!(
                "[UnifiedChat] 图片 {}: media_type={}, data_len={}",
                i,
                img.media_type,
                img.data.len()
            );
        }
        if !images.is_empty() {
            tracing::warn!(
                "[UnifiedChat] 图片输入暂未实现，忽略 {} 张图片",
                images.len()
            );
        }
    }

    // 获取会话信息（异步化数据库操作）
    let db_start = std::time::Instant::now();
    let session = {
        let db = db.inner().clone();
        let session_id = request.session_id.clone();
        tokio::task::spawn_blocking(move || {
            let conn = db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;
            ChatDao::get_session(&conn, &session_id)
                .map_err(|e| format!("获取会话失败: {e}"))?
                .ok_or_else(|| "会话不存在".to_string())
        })
        .await
        .map_err(|e| format!("任务执行失败: {e}"))??
    };
    let db_elapsed = db_start.elapsed();
    tracing::debug!("[UnifiedChat] 数据库查询耗时: {:?}", db_elapsed);

    // 根据模式处理
    let config = config_manager.config();
    apply_web_search_runtime_env(&config);
    let working_dir = std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from("."));
    let merged_system_prompt = merge_system_prompt_with_web_search(
        merge_system_prompt_with_memory_sources(
            merge_system_prompt_with_memory_profile(session.system_prompt.clone(), &config),
            &config,
            &working_dir,
            None,
        ),
        &config,
    );

    let mode_default_web_search = matches!(session.mode, ChatMode::General);
    let request_tool_policy =
        resolve_request_tool_policy(request.web_search, mode_default_web_search);
    tracing::info!(
        "[UnifiedChat][WebSearchGuard] session={}, mode={:?}, request_web_search={:?}, mode_default_web_search={}, effective_web_search={}",
        request.session_id,
        session.mode,
        request.web_search,
        mode_default_web_search,
        request_tool_policy.effective_web_search
    );

    let result = send_message_with_aster(
        &app,
        &db,
        &agent_state,
        &request.session_id,
        &request.message,
        &request.event_name,
        merged_system_prompt.as_deref(),
        config.memory.enabled,
        &request_tool_policy,
    )
    .await;

    let total_elapsed = start_time.elapsed();
    tracing::info!(
        "[UnifiedChat] 消息发送完成: session={}, 总耗时={:?}",
        request.session_id,
        total_elapsed
    );

    result
}

/// 使用 Aster Agent 发送消息
async fn send_message_with_aster(
    app: &AppHandle,
    db: &DbConnection,
    agent_state: &AsterAgentState,
    session_id: &str,
    message: &str,
    event_name: &str,
    system_prompt: Option<&str>,
    include_context_trace: bool,
    request_tool_policy: &RequestToolPolicy,
) -> Result<(), String> {
    let start_time = std::time::Instant::now();
    tracing::info!(
        "[UnifiedChat][WebSearchGuard] session={}, effective_web_search={}",
        session_id,
        request_tool_policy.effective_web_search
    );

    // 确保 Agent 已初始化
    let init_start = std::time::Instant::now();
    if !agent_state.is_initialized().await {
        agent_state.init_agent_with_db(db).await?;
    }
    ensure_browser_mcp_tools_registered(agent_state).await?;
    let init_elapsed = init_start.elapsed();
    tracing::debug!("[UnifiedChat] Agent 初始化检查耗时: {:?}", init_elapsed);

    // 检查 Provider 是否已配置
    let provider_check_start = std::time::Instant::now();
    if !agent_state.is_provider_configured().await {
        return Err("Provider 未配置，请先配置凭证".to_string());
    }
    let provider_check_elapsed = provider_check_start.elapsed();
    tracing::debug!(
        "[UnifiedChat] Provider 配置检查耗时: {:?}",
        provider_check_elapsed
    );

    // 创建取消令牌
    let cancel_token = agent_state.create_cancel_token(session_id).await;

    let effective_system_prompt = merge_system_prompt_with_request_tool_policy(
        system_prompt.map(|prompt| prompt.to_string()),
        request_tool_policy,
    );

    let user_message = Message::user().with_text(message);
    let mut session_config_builder = SessionConfigBuilder::new(session_id);
    if let Some(prompt) = effective_system_prompt {
        session_config_builder = session_config_builder.system_prompt(prompt);
    }
    let session_config = session_config_builder
        .include_context_trace(include_context_trace)
        .build();

    // 获取 Agent 引用
    let agent_arc = agent_state.get_agent_arc();
    let guard = agent_arc.read().await;
    let agent = guard.as_ref().ok_or("Agent 未初始化")?;

    let mut removed_extension: Option<ExtensionConfig> = None;
    if request_tool_policy.effective_web_search {
        let extension_configs = agent.get_extension_configs().await;
        if let Some(extension) = extension_configs
            .into_iter()
            .find(|extension| extension.name() == CODE_EXECUTION_EXTENSION_NAME)
        {
            match agent.remove_extension(CODE_EXECUTION_EXTENSION_NAME).await {
                Ok(_) => {
                    removed_extension = Some(extension);
                    tracing::info!(
                        "[UnifiedChat] 当前会话优先联网搜索，临时关闭 {} 扩展",
                        CODE_EXECUTION_EXTENSION_NAME
                    );
                }
                Err(error) => {
                    tracing::warn!(
                        "[UnifiedChat] 移除 {} 扩展失败: {}",
                        CODE_EXECUTION_EXTENSION_NAME,
                        error
                    );
                }
            }
        } else {
            tracing::info!(
                "[UnifiedChat][WebSearchGuard] session={}, 未检测到 {} 扩展，无需移除",
                session_id,
                CODE_EXECUTION_EXTENSION_NAME
            );
        }
    }

    // 调用 Agent
    let reply_start = std::time::Instant::now();
    let mut web_search_tracker = WebSearchExecutionTracker::default();
    let preflight = execute_web_search_preflight_if_needed(
        agent,
        session_id,
        message,
        None,
        Some(cancel_token.clone()),
        request_tool_policy,
        &mut web_search_tracker,
    )
    .await;
    match preflight {
        Ok(preflight_execution) => {
            for event in preflight_execution.events {
                if let Err(error) = app.emit(event_name, &event) {
                    tracing::error!("[UnifiedChat] 发送预调用事件失败: {}", error);
                }
            }
        }
        Err(error) => {
            let error_event = TauriAgentEvent::Error {
                message: format!(
                    "{error}\n尝试记录: {}",
                    web_search_tracker.format_attempts()
                ),
            };
            let _ = app.emit(event_name, &error_event);
            agent_state.remove_cancel_token(session_id).await;
            if let Some(extension) = removed_extension {
                if let Err(restore_error) = agent.add_extension(extension).await {
                    tracing::warn!(
                        "[UnifiedChat] 预调用失败后恢复 {} 扩展失败: {}",
                        CODE_EXECUTION_EXTENSION_NAME,
                        restore_error
                    );
                }
            }
            return Err(error);
        }
    }

    let stream_result = agent
        .reply(user_message, session_config, Some(cancel_token.clone()))
        .await;

    let mut first_chunk_time: Option<std::time::Instant> = None;
    let mut chunk_count = 0;
    let mut stream_error: Option<String> = None;

    match stream_result {
        Ok(mut stream) => {
            while let Some(event_result) = stream.next().await {
                match event_result {
                    Ok(agent_event) => {
                        // 记录首个 chunk 时间（TTFB）
                        if first_chunk_time.is_none() {
                            first_chunk_time = Some(std::time::Instant::now());
                            let ttfb = first_chunk_time.unwrap() - reply_start;
                            tracing::info!("[UnifiedChat] TTFB (首字节时间): {:?}", ttfb);
                        }
                        chunk_count += 1;

                        let tauri_events = convert_agent_event(agent_event);
                        for tauri_event in tauri_events {
                            match &tauri_event {
                                TauriAgentEvent::ToolStart {
                                    tool_name, tool_id, ..
                                } => web_search_tracker.record_tool_start(
                                    request_tool_policy,
                                    tool_id,
                                    tool_name,
                                ),
                                TauriAgentEvent::ToolEnd { tool_id, result } => {
                                    web_search_tracker.record_tool_end(
                                        request_tool_policy,
                                        tool_id,
                                        result.success,
                                        result.error.as_deref(),
                                    );
                                }
                                _ => {}
                            }
                            if let Err(e) = app.emit(event_name, &tauri_event) {
                                tracing::error!("[UnifiedChat] 发送事件失败: {}", e);
                            }
                        }
                    }
                    Err(e) => {
                        let message = format!("流错误: {e}");
                        let error_event = TauriAgentEvent::Error {
                            message: message.clone(),
                        };
                        let _ = app.emit(event_name, &error_event);
                        stream_error = Some(message);
                    }
                }
            }

            if stream_error.is_none() {
                if let Err(validation_error) =
                    web_search_tracker.validate_web_search_requirement(request_tool_policy)
                {
                    let error_event = TauriAgentEvent::Error {
                        message: validation_error.clone(),
                    };
                    let _ = app.emit(event_name, &error_event);
                    stream_error = Some(validation_error);
                }
            }

            if stream_error.is_none() {
                // 发送完成事件
                let done_event = TauriAgentEvent::FinalDone { usage: None };
                let _ = app.emit(event_name, &done_event);
            }

            let stream_elapsed = start_time.elapsed();
            tracing::info!(
                "[UnifiedChat] 流式传输完成: session={}, chunks={}, 总耗时={:?}",
                session_id,
                chunk_count,
                stream_elapsed
            );
        }
        Err(e) => {
            let message = format!("Agent 错误: {e}");
            let error_event = TauriAgentEvent::Error {
                message: message.clone(),
            };
            let _ = app.emit(event_name, &error_event);
            stream_error = Some(message);
        }
    }

    if let Some(extension) = removed_extension {
        if let Err(error) = agent.add_extension(extension).await {
            tracing::warn!(
                "[UnifiedChat] 恢复 {} 扩展失败: {}",
                CODE_EXECUTION_EXTENSION_NAME,
                error
            );
        }
    }

    // 清理取消令牌
    agent_state.remove_cancel_token(session_id).await;

    if let Some(error) = stream_error {
        return Err(error);
    }

    Ok(())
}

/// 停止生成
#[tauri::command]
pub async fn chat_stop_generation(
    agent_state: State<'_, AsterAgentState>,
    session_id: String,
) -> Result<bool, String> {
    tracing::info!("[UnifiedChat] 停止生成: session={}", session_id);
    Ok(agent_state.cancel_session(&session_id).await)
}

/// 配置会话的 Provider
#[tauri::command]
pub async fn chat_configure_provider(
    db: State<'_, DbConnection>,
    agent_state: State<'_, AsterAgentState>,
    session_id: String,
    provider_type: String,
    model: String,
) -> Result<(), String> {
    tracing::info!(
        "[UnifiedChat] 配置 Provider: session={}, provider={}, model={}",
        session_id,
        provider_type,
        model
    );

    // 确保 Agent 已初始化
    agent_state.init_agent_with_db(&db).await?;

    // 配置 Provider
    agent_state
        .configure_provider_from_pool(&db, &provider_type, &model, &session_id)
        .await?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::request_tool_policy_prompt_service::resolve_request_tool_policy;

    #[test]
    fn test_send_message_request_deserialize_web_search_camel_case() {
        let payload = serde_json::json!({
            "sessionId": "session-1",
            "message": "hello",
            "eventName": "event-1",
            "webSearch": true
        });
        let request: SendMessageRequest =
            serde_json::from_value(payload).expect("deserialize request");
        assert_eq!(request.web_search, Some(true));
        assert_eq!(request.session_id, "session-1");
        assert_eq!(request.event_name, "event-1");
    }

    #[test]
    fn test_send_message_request_deserialize_web_search_snake_case() {
        let payload = serde_json::json!({
            "session_id": "session-1",
            "message": "hello",
            "event_name": "event-1",
            "web_search": false
        });
        let request: SendMessageRequest =
            serde_json::from_value(payload).expect("deserialize request");
        assert_eq!(request.web_search, Some(false));
    }

    #[test]
    fn test_unified_effective_web_search_uses_request_override() {
        let mode_default = true;
        let policy = resolve_request_tool_policy(Some(false), mode_default);
        assert!(!policy.effective_web_search);
    }
}
