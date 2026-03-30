//! Agent 命令模块
//!
//! 提供 Agent 的进程与标题相关 Tauri 命令

use crate::agent::{AsterAgentState, AsterAgentWrapper};
use crate::commands::aster_agent_cmd::ensure_browser_mcp_tools_registered;
use crate::database::DbConnection;
use crate::AppState;
use serde::Serialize;
use tauri::State;

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
    db: State<'_, DbConnection>,
    session_id: String,
) -> Result<String, String> {
    // 获取会话的前几条消息（用于生成标题）
    let messages = AsterAgentWrapper::list_title_preview_messages_sync(&db, &session_id, 4)?;

    // 过滤出 user 和 assistant 消息
    let chat_messages: Vec<_> = messages.iter().collect();

    if chat_messages.len() < 2 {
        return Ok("新话题".to_string());
    }

    // 这里简化处理：使用第一条用户消息的前 15 个字作为默认标题
    if let Some(first_user_msg) = chat_messages.iter().find(|msg| msg.role == "user") {
        let content = &first_user_msg.content;
        // 使用字符边界安全截断
        let title = truncate_string(content, 15);
        Ok(title)
    } else {
        Ok("新话题".to_string())
    }
}
