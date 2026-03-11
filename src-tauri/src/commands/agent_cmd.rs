//! Agent 命令模块
//!
//! 提供 Agent 的 Tauri 命令（兼容旧 API）
//! 内部使用 Aster Agent 实现

use crate::agent::{AgentMessage, AgentSession, AsterAgentState};
use crate::commands::aster_agent_cmd::ensure_browser_mcp_tools_registered;
use crate::config::GlobalConfigManagerState;
use crate::database::dao::agent::AgentDao;
use crate::database::DbConnection;
use crate::services::memory_profile_prompt_service::{
    merge_system_prompt_with_memory_profile, merge_system_prompt_with_memory_sources,
};
use crate::services::web_search_prompt_service::merge_system_prompt_with_web_search;
use crate::services::web_search_runtime_service::apply_web_search_runtime_env;
use crate::services::workspace_health_service::ensure_workspace_ready_with_auto_relocate;
use crate::workspace::WorkspaceManager;
use crate::AppState;
use serde::{Deserialize, Serialize};
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

fn resolve_workspace_id_by_working_dir(
    conn: &rusqlite::Connection,
    working_dir: Option<&str>,
) -> Option<String> {
    let resolved_working_dir = working_dir?.trim();
    if resolved_working_dir.is_empty() {
        return None;
    }

    conn.query_row(
        "SELECT id FROM workspaces WHERE root_path = ? LIMIT 1",
        rusqlite::params![resolved_working_dir],
        |row| row.get::<_, String>(0),
    )
    .ok()
}

fn normalize_execution_strategy(value: Option<String>) -> String {
    match value.as_deref() {
        Some("code_orchestrated") => "code_orchestrated".to_string(),
        Some("auto") => "auto".to_string(),
        _ => "react".to_string(),
    }
}

/// Agent 进程状态响应
#[derive(Debug, Serialize)]
pub struct AgentProcessStatus {
    pub running: bool,
    pub base_url: Option<String>,
    pub port: Option<u16>,
}

/// 创建会话响应
#[derive(Debug, Serialize)]
pub struct CreateSessionResponse {
    pub session_id: String,
    pub credential_name: String,
    pub credential_uuid: String,
    pub provider_type: String,
    pub model: Option<String>,
    pub execution_strategy: String,
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
    ensure_browser_mcp_tools_registered(agent_state.inner()).await?;
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

/// Skill 信息
#[derive(Debug, Deserialize)]
pub struct SkillInfo {
    pub name: String,
    pub description: Option<String>,
    pub path: Option<String>,
}

/// 创建 Agent 会话
#[tauri::command]
pub async fn agent_create_session(
    agent_state: State<'_, AsterAgentState>,
    db: State<'_, DbConnection>,
    config_manager: State<'_, GlobalConfigManagerState>,
    provider_type: String,
    model: Option<String>,
    system_prompt: Option<String>,
    skills: Option<Vec<SkillInfo>>,
    workspace_id: String,
    execution_strategy: Option<String>,
) -> Result<CreateSessionResponse, String> {
    tracing::info!(
        "[Agent] 创建会话: provider_type={}, model={:?}, skills_count={:?}",
        provider_type,
        model,
        skills.as_ref().map(|s| s.len())
    );

    let workspace_id = workspace_id.trim().to_string();
    if workspace_id.is_empty() {
        return Err("workspace_id 必填，请先选择项目工作区".to_string());
    }

    let workspace_manager = WorkspaceManager::new(db.inner().clone());
    let workspace = workspace_manager
        .get(&workspace_id)
        .map_err(|e| format!("读取 workspace 失败: {e}"))?
        .ok_or_else(|| format!("Workspace 不存在: {workspace_id}"))?;
    let ensured = ensure_workspace_ready_with_auto_relocate(&workspace_manager, &workspace)?;
    if ensured.repaired {
        tracing::warn!(
            "[Agent] Workspace 路径异常已自动修复: {}{}",
            ensured.root_path.to_string_lossy(),
            if ensured.relocated {
                "（已迁移）"
            } else {
                ""
            }
        );
    }
    let workspace_root = ensured.root_path.to_string_lossy().to_string();

    // 初始化 Agent（使用带数据库的版本）
    agent_state.init_agent_with_db(&db).await?;
    ensure_browser_mcp_tools_registered(agent_state.inner()).await?;

    // 生成会话 ID
    let session_id = uuid::Uuid::new_v4().to_string();
    let normalized_execution_strategy = normalize_execution_strategy(execution_strategy);

    // 从凭证池配置 Provider
    let model_name = model
        .clone()
        .unwrap_or_else(|| "claude-sonnet-4-20250514".to_string());
    let aster_config = agent_state
        .configure_provider_from_pool(&db, &provider_type, &model_name, &session_id)
        .await?;

    // 构建包含 Skills 的 System Prompt，并附加记忆画像偏好
    let base_system_prompt = build_system_prompt_with_skills(system_prompt, skills.as_ref());
    let config = config_manager.config();
    apply_web_search_runtime_env(&config);
    let prompt_with_memory = merge_system_prompt_with_memory_sources(
        merge_system_prompt_with_memory_profile(base_system_prompt, &config),
        &config,
        std::path::Path::new(&workspace_root),
        None,
    );
    let final_system_prompt = merge_system_prompt_with_web_search(prompt_with_memory, &config);

    // 保存会话到数据库
    let now = chrono::Utc::now().to_rfc3339();
    let session = AgentSession {
        id: session_id.clone(),
        model: model_name.clone(),
        messages: Vec::new(),
        system_prompt: final_system_prompt,
        title: None, // 初始会话没有标题，后续会自动生成
        working_dir: Some(workspace_root),
        execution_strategy: Some(normalized_execution_strategy.clone()),
        created_at: now.clone(),
        updated_at: now,
    };

    {
        let conn = db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;
        if let Err(e) = AgentDao::create_session(&conn, &session) {
            tracing::warn!("[Agent] 保存会话到数据库失败: {}", e);
        }
    }

    Ok(CreateSessionResponse {
        session_id,
        credential_name: "ProxyCast".to_string(),
        credential_uuid: aster_config.credential_uuid,
        provider_type,
        model: Some(model_name),
        execution_strategy: normalized_execution_strategy,
    })
}

/// 构建包含 Skills 的 System Prompt
fn build_system_prompt_with_skills(
    base_prompt: Option<String>,
    skills: Option<&Vec<SkillInfo>>,
) -> Option<String> {
    let skills_xml = match skills {
        Some(skills) if !skills.is_empty() => {
            let mut xml = String::from("<available_skills>\n");
            for skill in skills {
                xml.push_str("  <skill>\n");
                xml.push_str(&format!("    <name>{}</name>\n", skill.name));
                if let Some(desc) = &skill.description {
                    xml.push_str(&format!("    <description>{desc}</description>\n"));
                }
                if let Some(path) = &skill.path {
                    xml.push_str(&format!("    <location>{path}</location>\n"));
                }
                xml.push_str("  </skill>\n");
            }
            xml.push_str("</available_skills>\n\n");
            xml.push_str("当用户的请求匹配某个 Skill 的描述时，请使用该 Skill 来完成任务。\n");
            xml.push_str("如果需要使用 Skill，请先读取对应的 SKILL.md 文件获取详细指令。\n");
            Some(xml)
        }
        _ => None,
    };

    match (base_prompt, skills_xml) {
        (Some(base), Some(skills)) => Some(format!("{base}\n\n{skills}")),
        (Some(base), None) => Some(base),
        (None, Some(skills)) => Some(skills),
        (None, None) => None,
    }
}

/// 图片输入参数
#[allow(dead_code)]
#[derive(Debug, Deserialize)]
pub struct ImageInputParam {
    pub data: String,
    pub media_type: String,
}

/// 发送消息到 Agent
///
/// 注意：此命令已废弃，请使用 aster_agent_chat_stream
#[tauri::command]
pub async fn agent_send_message(
    _agent_state: State<'_, AsterAgentState>,
    _session_id: Option<String>,
    _message: String,
    _images: Option<Vec<ImageInputParam>>,
    _model: Option<String>,
    _web_search: Option<bool>,
    _thinking: Option<bool>,
) -> Result<String, String> {
    Err("此命令已废弃，请使用 aster_agent_chat_stream 进行流式对话".to_string())
}

/// 会话信息
#[derive(Debug, Serialize, Deserialize)]
pub struct SessionInfo {
    pub session_id: String,
    pub provider_type: String,
    pub model: Option<String>,
    pub title: Option<String>,
    pub created_at: String,
    pub last_activity: String,
    pub messages_count: usize,
    pub workspace_id: Option<String>,
    pub working_dir: Option<String>,
    pub execution_strategy: Option<String>,
}

/// 获取会话列表
#[tauri::command]
pub async fn agent_list_sessions(db: State<'_, DbConnection>) -> Result<Vec<SessionInfo>, String> {
    let conn = db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;

    let sessions = AgentDao::list_sessions(&conn).map_err(|e| format!("获取会话列表失败: {e}"))?;

    let result: Vec<SessionInfo> = sessions
        .into_iter()
        .map(|s| {
            let messages_count = AgentDao::get_message_count(&conn, &s.id).unwrap_or(0);
            let working_dir = s.working_dir.clone();
            let workspace_id = resolve_workspace_id_by_working_dir(&conn, working_dir.as_deref());

            SessionInfo {
                session_id: s.id,
                provider_type: "aster".to_string(),
                model: Some(s.model),
                title: s.title,
                created_at: s.created_at.clone(),
                last_activity: s.updated_at,
                messages_count,
                workspace_id,
                working_dir,
                execution_strategy: s.execution_strategy,
            }
        })
        .collect();

    Ok(result)
}

/// 获取会话详情
#[tauri::command]
pub async fn agent_get_session(
    db: State<'_, DbConnection>,
    session_id: String,
) -> Result<SessionInfo, String> {
    let conn = db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;

    let session = AgentDao::get_session(&conn, &session_id)
        .map_err(|e| format!("获取会话失败: {e}"))?
        .ok_or_else(|| "会话不存在".to_string())?;

    let messages_count = AgentDao::get_message_count(&conn, &session_id).unwrap_or(0);
    let working_dir = session.working_dir.clone();
    let workspace_id = resolve_workspace_id_by_working_dir(&conn, working_dir.as_deref());

    Ok(SessionInfo {
        session_id: session.id,
        provider_type: "aster".to_string(),
        model: Some(session.model),
        title: session.title,
        created_at: session.created_at.clone(),
        last_activity: session.updated_at,
        messages_count,
        workspace_id,
        working_dir,
        execution_strategy: session.execution_strategy,
    })
}

/// 删除会话
#[tauri::command]
pub async fn agent_delete_session(
    db: State<'_, DbConnection>,
    session_id: String,
) -> Result<(), String> {
    let conn = db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;
    AgentDao::delete_session(&conn, &session_id).map_err(|e| format!("删除会话失败: {e}"))?;
    Ok(())
}

/// 获取会话消息列表
#[tauri::command]
pub async fn agent_get_session_messages(
    db: State<'_, DbConnection>,
    session_id: String,
) -> Result<Vec<AgentMessage>, String> {
    let conn = db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;
    let messages =
        AgentDao::get_messages(&conn, &session_id).map_err(|e| format!("获取消息失败: {e}"))?;
    Ok(messages)
}

/// 重命名会话（更新标题）
#[tauri::command]
pub async fn agent_rename_session(
    db: State<'_, DbConnection>,
    session_id: String,
    title: String,
) -> Result<(), String> {
    let conn = db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;
    AgentDao::update_title(&conn, &session_id, &title)
        .map_err(|e| format!("更新会话标题失败: {e}"))?;
    Ok(())
}

/// 生成智能标题
///
/// 根据对话内容生成一个简洁的标题
#[tauri::command]
pub async fn agent_generate_title(
    db: State<'_, DbConnection>,
    session_id: String,
) -> Result<String, String> {
    let conn = db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;

    // 获取会话的前几条消息（用于生成标题）
    let messages =
        AgentDao::get_messages(&conn, &session_id).map_err(|e| format!("获取消息失败: {e}"))?;

    // 过滤出 user 和 assistant 消息
    let chat_messages: Vec<_> = messages
        .iter()
        .filter(|msg| msg.role == "user" || msg.role == "assistant")
        .take(4) // 取前 2 轮对话
        .collect();

    if chat_messages.len() < 2 {
        return Ok("新话题".to_string());
    }

    // 构建对话内容用于 AI 生成标题
    let mut conversation = String::new();
    for msg in &chat_messages {
        let role = if msg.role == "user" {
            "用户"
        } else {
            "助手"
        };
        let content = msg.content.as_text();
        // 使用字符边界安全截断，避免在多字节字符中间切割
        let truncated_content = truncate_string(&content, 100);
        conversation.push_str(&format!("{role}：{truncated_content}\n"));
    }

    // 使用 AI 生成标题（通过 aster_agent_chat_stream 生成）
    // 这里简化处理：使用第一条用户消息的前 15 个字作为默认标题
    if let Some(first_user_msg) = chat_messages.iter().find(|msg| msg.role == "user") {
        let content = first_user_msg.content.as_text();
        // 使用字符边界安全截断
        let title = truncate_string(&content, 15);
        Ok(title)
    } else {
        Ok("新话题".to_string())
    }
}
