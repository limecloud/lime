//! Agent 命令模块
//!
//! 提供 Agent 的进程与标题相关 Tauri 命令

use crate::agent::{
    build_auxiliary_session_config_with_turn_context, AsterAgentState, AsterAgentWrapper,
};
use crate::commands::aster_agent_cmd::ensure_browser_mcp_tools_registered;
use crate::commands::auxiliary_model_selection::{
    build_auxiliary_runtime_metadata, build_auxiliary_turn_context_override,
    prepare_auxiliary_provider_scope, AuxiliaryServiceModelSlot,
};
use crate::config::GlobalConfigManagerState;
use crate::database::DbConnection;
use crate::services::runtime_auxiliary_projection_service::{
    project_auxiliary_runtime_to_parent_session, AuxiliaryRuntimeProjectionInput,
    AuxiliaryRuntimeProjectionResult,
};
use crate::AppState;
use aster::conversation::message::Message;
use futures::StreamExt;
use lime_agent::merge_system_prompt_with_runtime_agents;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, State};
use uuid::Uuid;

const TITLE_FALLBACK_PROVIDER_CHAIN: [(&str, &str); 4] = [
    ("deepseek", "deepseek-chat"),
    ("openai", "gpt-4o-mini"),
    ("anthropic", "claude-3-haiku-20240307"),
    ("kiro", "anthropic.claude-3-haiku-20240307-v1:0"),
];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentGeneratedTitleResult {
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub execution_runtime: Option<lime_agent::SessionExecutionRuntime>,
    #[serde(default)]
    pub used_fallback: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fallback_reason: Option<String>,
}

/// 安全截断字符串，确保不会在多字节字符中间切割
///
/// # 参数
/// - `s`: 要截断的字符串
/// - `max_chars`: 最大字符数（按 Unicode 字符计算，非字节）
///
/// # 返回
/// 截断后的字符串，如果被截断则添加 "..." 后缀
fn truncate_string(s: &str, max_chars: usize) -> String {
    let char_count = s.chars().count();
    if char_count <= max_chars {
        s.to_string()
    } else {
        let truncated: String = s.chars().take(max_chars).collect();
        format!("{truncated}...")
    }
}

fn normalize_optional_text(value: Option<String>) -> Option<String> {
    let trimmed = value?.trim().to_string();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed)
    }
}

fn strip_code_fence(value: &str) -> String {
    value
        .trim()
        .trim_start_matches("```text")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim()
        .to_string()
}

fn normalize_generated_title(value: &str) -> Option<String> {
    let normalized_content = strip_code_fence(value);
    let first_line = normalized_content
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())?;
    let normalized = first_line
        .trim_start_matches("标题：")
        .trim_start_matches("标题:")
        .trim()
        .trim_matches('"')
        .trim_matches('\'')
        .trim_matches('《')
        .trim_matches('》')
        .trim_matches('【')
        .trim_matches('】')
        .trim_matches('「')
        .trim_matches('」')
        .trim_matches('`')
        .trim();
    if normalized.is_empty() {
        None
    } else {
        Some(truncate_string(normalized, 18))
    }
}

fn build_session_title_source_text(
    messages: &[lime_agent::SessionTitlePreviewMessage],
) -> Option<String> {
    let normalized = messages
        .iter()
        .filter_map(|message| {
            let content = message.content.trim();
            if content.is_empty() {
                None
            } else {
                Some(format!("{}：{}", message.role, content))
            }
        })
        .collect::<Vec<_>>()
        .join("\n");

    normalize_optional_text(Some(normalized)).map(|value| truncate_string(&value, 1200))
}

fn build_fallback_title(source_text: &str, title_kind: &str) -> String {
    let normalized_source = source_text
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or(source_text)
        .trim();
    if normalized_source.is_empty() {
        return if title_kind == "image_task" {
            "图片任务".to_string()
        } else {
            "新话题".to_string()
        };
    }

    truncate_string(normalized_source, 15)
}

fn build_title_generation_system_prompt(title_kind: &str) -> String {
    if title_kind == "image_task" {
        [
            "你是 Lime 的图片任务命名助手。",
            "请根据给定的图片生成需求，生成一个简洁清晰的中文标题。",
            "要求：",
            "1. 标题控制在 6 到 18 个中文字符之间。",
            "2. 优先体现主体、场景或用途，不要空泛复述“图片任务”“配图”。",
            "3. 不要加引号、句号、编号、解释或 markdown。",
            "4. 只输出标题本身。",
        ]
        .join("\n")
    } else {
        [
            "你是 Lime 的会话命名助手。",
            "请根据给定的对话摘要生成一个简洁清晰的中文标题。",
            "要求：",
            "1. 标题控制在 6 到 18 个中文字符之间。",
            "2. 优先体现任务目标或讨论主题，不要泛泛写“新话题”“继续对话”。",
            "3. 不要加引号、句号、编号、解释或 markdown。",
            "4. 只输出标题本身。",
        ]
        .join("\n")
    }
}

fn force_direct_answer_tool_surface(metadata: &mut Option<Value>) {
    let Some(Value::Object(root)) = metadata else {
        return;
    };
    let Some(Value::Object(runtime_metadata)) = root.get_mut("lime_runtime") else {
        return;
    };

    runtime_metadata.insert(
        "tool_surface".to_string(),
        Value::String("direct_answer".to_string()),
    );
}

async fn generate_title_with_agent(
    agent_state: &AsterAgentState,
    db: &DbConnection,
    config_manager: &GlobalConfigManagerState,
    session_id: &str,
    title_kind: &str,
    source_text: &str,
) -> Result<String, String> {
    let provider_scope = prepare_auxiliary_provider_scope(
        agent_state,
        db,
        config_manager,
        session_id,
        if title_kind == "image_task" {
            AuxiliaryServiceModelSlot::GenerationTopic
        } else {
            AuxiliaryServiceModelSlot::Topic
        },
        &TITLE_FALLBACK_PROVIDER_CHAIN,
    )
    .await?;

    let result = async {
        let cancel_token = agent_state.create_cancel_token(session_id).await;
        let base_runtime_prompt = merge_system_prompt_with_runtime_agents(None, None);
        let system_prompt = match base_runtime_prompt {
            Some(base_prompt) => Some(format!(
                "{base_prompt}\n\n{}",
                build_title_generation_system_prompt(title_kind)
            )),
            None => Some(build_title_generation_system_prompt(title_kind)),
        };
        let mut auxiliary_runtime_metadata = build_auxiliary_runtime_metadata(
            provider_scope.resolution(),
            if title_kind == "image_task" {
                "auxiliary_generation_topic"
            } else {
                "auxiliary_title_generation"
            },
            Some(if title_kind == "image_task" {
                "image_task"
            } else {
                "session_title"
            }),
            if title_kind == "image_task" {
                &[
                    "service_model_slot",
                    "internal_turn",
                    "auxiliary_session",
                    "vision_input",
                ]
            } else {
                &["service_model_slot", "internal_turn", "auxiliary_session"]
            },
            &["当前为内部标题生成辅助任务，只会使用一条已解析的 provider/model 路线。"],
        );
        force_direct_answer_tool_surface(&mut auxiliary_runtime_metadata);
        let session_config = build_auxiliary_session_config_with_turn_context(
            session_id,
            system_prompt,
            false,
            build_auxiliary_turn_context_override(auxiliary_runtime_metadata),
        );
        let user_message = Message::user().with_text(source_text);

        let agent_arc = agent_state.get_agent_arc();
        let guard = agent_arc.read().await;
        let agent = guard.as_ref().ok_or("Agent 未初始化")?;
        let stream_result = agent
            .reply(user_message, session_config, Some(cancel_token.clone()))
            .await;

        let mut full_content = String::new();
        match stream_result {
            Ok(mut stream) => {
                while let Some(event_result) = stream.next().await {
                    match event_result {
                        Ok(agent_event) => {
                            if let aster::agents::AgentEvent::Message(message) = agent_event {
                                for content in &message.content {
                                    if let aster::conversation::message::MessageContent::Text(
                                        text_content,
                                    ) = content
                                    {
                                        full_content.push_str(&text_content.text);
                                    }
                                }
                            }
                        }
                        Err(error) => {
                            tracing::error!("[AgentTitle] 流式标题生成失败: {}", error);
                        }
                    }
                }
            }
            Err(error) => {
                agent_state.remove_cancel_token(session_id).await;
                return Err(format!("标题生成失败: {error}"));
            }
        }

        agent_state.remove_cancel_token(session_id).await;

        normalize_generated_title(&full_content).ok_or_else(|| "标题生成返回为空".to_string())
    }
    .await;

    provider_scope.restore(agent_state, db).await;
    result
}

/// Agent 进程状态响应
#[derive(Debug, Serialize)]
pub struct AgentProcessStatus {
    pub running: bool,
    pub base_url: Option<String>,
    pub port: Option<u16>,
}

/// 启动 Agent（使用 Aster 实现）
#[tauri::command]
pub async fn agent_start_process(
    agent_state: State<'_, AsterAgentState>,
    app_state: State<'_, AppState>,
    db: State<'_, DbConnection>,
    _port: Option<u16>,
) -> Result<AgentProcessStatus, String> {
    tracing::info!("[Agent] 初始化 Aster Agent");

    let (host, port, gateway_running) = {
        let state = app_state.read().await;
        (
            state.config.server.host.clone(),
            state.config.server.port,
            state.running,
        )
    };

    agent_state.init_agent_with_db(&db).await?;
    ensure_browser_mcp_tools_registered(agent_state.inner(), &db).await?;
    let base_url = if gateway_running {
        Some(format!("http://{host}:{port}"))
    } else {
        None
    };
    let exposed_port = if gateway_running { Some(port) } else { None };

    Ok(AgentProcessStatus {
        running: true,
        base_url,
        port: exposed_port,
    })
}

/// 停止 Agent
#[tauri::command]
pub async fn agent_stop_process(_agent_state: State<'_, AsterAgentState>) -> Result<(), String> {
    tracing::info!("[Agent] 停止 Aster Agent（无操作，Agent 保持活跃）");
    // Aster Agent 不需要显式停止
    Ok(())
}

/// 获取 Agent 状态
#[tauri::command]
pub async fn agent_get_process_status(
    agent_state: State<'_, AsterAgentState>,
    app_state: State<'_, AppState>,
) -> Result<AgentProcessStatus, String> {
    let initialized = agent_state.is_initialized().await;

    if initialized {
        let state = app_state.read().await;
        let gateway_running = state.running;
        let base_url = if gateway_running {
            Some(format!(
                "http://{}:{}",
                state.config.server.host, state.config.server.port
            ))
        } else {
            None
        };
        Ok(AgentProcessStatus {
            running: true,
            base_url,
            port: if gateway_running {
                Some(state.config.server.port)
            } else {
                None
            },
        })
    } else {
        Ok(AgentProcessStatus {
            running: false,
            base_url: None,
            port: None,
        })
    }
}
/// 生成智能标题
///
/// 根据对话内容生成一个简洁的标题
#[tauri::command]
pub async fn agent_generate_title(
    app: AppHandle,
    agent_state: State<'_, AsterAgentState>,
    db: State<'_, DbConnection>,
    config_manager: State<'_, GlobalConfigManagerState>,
    session_id: Option<String>,
    preview_text: Option<String>,
    title_kind: Option<String>,
) -> Result<AgentGeneratedTitleResult, String> {
    let resolved_title_kind =
        normalize_optional_text(title_kind).unwrap_or_else(|| "session".to_string());
    let resolved_preview_text = normalize_optional_text(preview_text);
    let resolved_session_id = normalize_optional_text(session_id);
    let source_text = if let Some(preview_text) = resolved_preview_text {
        preview_text
    } else if let Some(session_id) = resolved_session_id.as_deref() {
        let messages = AsterAgentWrapper::list_title_preview_messages_sync(&db, session_id, 6)?;
        build_session_title_source_text(&messages)
            .ok_or_else(|| "当前会话还没有足够的内容用于生成标题".to_string())?
    } else {
        return Err("缺少生成标题所需的内容".to_string());
    };

    agent_state.init_agent_with_db(&db).await?;
    ensure_browser_mcp_tools_registered(agent_state.inner(), &db).await?;
    let auxiliary_session_id = format!("title-gen-{}", Uuid::new_v4());

    let title_result = generate_title_with_agent(
        &agent_state,
        &db,
        &config_manager,
        &auxiliary_session_id,
        &resolved_title_kind,
        &source_text,
    )
    .await;
    let execution_runtime =
        AsterAgentWrapper::get_runtime_session_execution_runtime(&db, &auxiliary_session_id).await;

    let result = match title_result {
        Ok(title) => AgentGeneratedTitleResult {
            title,
            session_id: Some(auxiliary_session_id),
            execution_runtime,
            used_fallback: false,
            fallback_reason: None,
        },
        Err(error) => {
            tracing::warn!(
                "[AgentTitle] 智能标题生成失败，已回退摘要标题: kind={}, error={}",
                resolved_title_kind,
                error
            );
            AgentGeneratedTitleResult {
                title: build_fallback_title(&source_text, &resolved_title_kind),
                session_id: Some(auxiliary_session_id),
                execution_runtime,
                used_fallback: true,
                fallback_reason: Some(error),
            }
        }
    };

    if let (Some(parent_session_id), Some(auxiliary_session_id)) =
        (resolved_session_id.as_deref(), result.session_id.as_deref())
    {
        if let Err(error) = project_auxiliary_runtime_to_parent_session(
            &app,
            &db,
            AuxiliaryRuntimeProjectionInput {
                parent_session_id: parent_session_id.to_string(),
                auxiliary_session_id: auxiliary_session_id.to_string(),
                execution_runtime: result.execution_runtime.clone(),
                result: AuxiliaryRuntimeProjectionResult::TitleGeneration {
                    title: result.title.clone(),
                    used_fallback: result.used_fallback,
                    fallback_reason: result.fallback_reason.clone(),
                },
            },
        )
        .await
        {
            tracing::warn!(
                "[AgentTitle] 投影父会话辅助运行时失败，已降级继续: parent_session_id={}, auxiliary_session_id={}, error={}",
                parent_session_id,
                auxiliary_session_id,
                error
            );
        }
    }

    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn force_direct_answer_tool_surface_marks_auxiliary_runtime() {
        let mut metadata = Some(json!({
            "lime_runtime": {
                "task_profile": {
                    "kind": "title_generation"
                }
            }
        }));

        force_direct_answer_tool_surface(&mut metadata);

        assert_eq!(
            metadata
                .as_ref()
                .and_then(|value| value.get("lime_runtime"))
                .and_then(|value| value.get("tool_surface"))
                .and_then(Value::as_str),
            Some("direct_answer")
        );
    }
}
