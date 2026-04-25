//! 人设相关的 Tauri 命令
//!
//! 提供人设（Persona）管理的前端 API，包括：
//! - 创建、获取、列表、更新、删除人设
//! - 设置项目默认人设
//! - 获取人设模板列表
//! - AI 一键生成人设
//!
//! ## 相关需求
//! - Requirements 6.1: 人设列表显示
//! - Requirements 6.2: 创建人设按钮
//! - Requirements 6.3: 人设创建表单
//! - Requirements 6.4: 设置默认人设
//! - Requirements 6.5: 人设模板
//! - Requirements 6.6: 人设删除确认
//! - Requirements 6.7: AI 一键生成人设

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};

use crate::agent::build_auxiliary_session_config_with_turn_context;
use crate::agent::AsterAgentWrapper;
use crate::commands::aster_agent_cmd::ensure_browser_mcp_tools_registered;
use crate::commands::auxiliary_model_selection::{
    build_auxiliary_runtime_metadata, build_auxiliary_turn_context_override,
    prepare_auxiliary_provider_scope, AuxiliaryServiceModelSlot,
};
use crate::database::DbConnection;
use crate::models::project_model::{CreatePersonaRequest, Persona, PersonaTemplate, PersonaUpdate};
use crate::services::memory_profile_prompt_service::{build_memory_prompt, MemoryPromptContext};
use crate::services::runtime_auxiliary_projection_service::{
    project_auxiliary_runtime_to_parent_session, AuxiliaryRuntimeProjectionInput,
    AuxiliaryRuntimeProjectionResult,
};
use lime_agent::merge_system_prompt_with_runtime_agents;
use lime_services::persona_service::PersonaService;

// ============================================================================
// Tauri 命令
// ============================================================================

/// 创建人设
///
/// 在指定项目中创建新的人设配置。
///
/// # 参数
/// - `db`: 数据库连接状态
/// - `req`: 创建人设请求，包含项目 ID、名称、风格等信息
///
/// # 返回
/// - 成功返回创建的人设
/// - 失败返回错误信息
///
/// # 示例（前端调用）
/// ```typescript
/// const persona = await invoke('create_persona', {
///   req: {
///     project_id: 'project-1',
///     name: '专业写手',
///     style: '专业严谨',
///     tone: '正式',
///   }
/// });
/// ```
#[tauri::command]
pub async fn create_persona(
    db: State<'_, DbConnection>,
    req: CreatePersonaRequest,
) -> Result<Persona, String> {
    let conn = db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;
    PersonaService::create_persona(&conn, req).map_err(|e| e.to_string())
}

/// 获取项目的人设列表
///
/// 获取指定项目下的所有人设配置。
///
/// # 参数
/// - `db`: 数据库连接状态
/// - `project_id`: 项目 ID
///
/// # 返回
/// - 成功返回人设列表
/// - 失败返回错误信息
///
/// # 示例（前端调用）
/// ```typescript
/// const personas = await invoke('list_personas', {
///   projectId: 'project-1'
/// });
/// ```
#[tauri::command]
pub async fn list_personas(
    db: State<'_, DbConnection>,
    project_id: String,
) -> Result<Vec<Persona>, String> {
    let conn = db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;
    PersonaService::list_personas(&conn, &project_id).map_err(|e| e.to_string())
}

/// 获取单个人设
///
/// 根据 ID 获取人设详情。
///
/// # 参数
/// - `db`: 数据库连接状态
/// - `id`: 人设 ID
///
/// # 返回
/// - 成功返回 Option<Persona>，不存在时返回 None
/// - 失败返回错误信息
///
/// # 示例（前端调用）
/// ```typescript
/// const persona = await invoke('get_persona', {
///   id: 'persona-1'
/// });
/// ```
#[tauri::command]
pub async fn get_persona(
    db: State<'_, DbConnection>,
    id: String,
) -> Result<Option<Persona>, String> {
    let conn = db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;
    PersonaService::get_persona(&conn, &id).map_err(|e| e.to_string())
}

/// 更新人设
///
/// 更新指定人设的配置信息。
///
/// # 参数
/// - `db`: 数据库连接状态
/// - `id`: 人设 ID
/// - `update`: 更新内容，只包含需要更新的字段
///
/// # 返回
/// - 成功返回更新后的人设
/// - 失败返回错误信息
///
/// # 示例（前端调用）
/// ```typescript
/// const persona = await invoke('update_persona', {
///   id: 'persona-1',
///   update: {
///     name: '新名称',
///     style: '新风格',
///   }
/// });
/// ```
#[tauri::command]
pub async fn update_persona(
    db: State<'_, DbConnection>,
    id: String,
    update: PersonaUpdate,
) -> Result<Persona, String> {
    let conn = db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;
    PersonaService::update_persona(&conn, &id, update).map_err(|e| e.to_string())
}

/// 删除人设
///
/// 删除指定的人设配置。
///
/// # 参数
/// - `db`: 数据库连接状态
/// - `id`: 人设 ID
///
/// # 返回
/// - 成功返回 ()
/// - 失败返回错误信息
///
/// # 示例（前端调用）
/// ```typescript
/// await invoke('delete_persona', {
///   id: 'persona-1'
/// });
/// ```
#[tauri::command]
pub async fn delete_persona(db: State<'_, DbConnection>, id: String) -> Result<(), String> {
    let conn = db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;
    PersonaService::delete_persona(&conn, &id).map_err(|e| e.to_string())
}

/// 设置项目默认人设
///
/// 将指定人设设为项目的默认人设。
/// 同一项目只能有一个默认人设，设置新默认会自动取消原有默认。
///
/// # 参数
/// - `db`: 数据库连接状态
/// - `projectId`: 项目 ID
/// - `personaId`: 要设为默认的人设 ID
///
/// # 返回
/// - 成功返回 ()
/// - 失败返回错误信息
#[tauri::command]
#[allow(non_snake_case)]
pub async fn set_default_persona(
    db: State<'_, DbConnection>,
    projectId: String,
    personaId: String,
) -> Result<(), String> {
    let conn = db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;
    PersonaService::set_default_persona(&conn, &projectId, &personaId).map_err(|e| e.to_string())
}

/// 获取人设模板列表
///
/// 获取预定义的人设模板，用于快速创建人设。
/// 模板包含常见的写作风格配置，如专业写手、生活博主等。
///
/// # 返回
/// - 人设模板列表
///
/// # 示例（前端调用）
/// ```typescript
/// const templates = await invoke('list_persona_templates');
/// ```
#[tauri::command]
pub async fn list_persona_templates() -> Result<Vec<PersonaTemplate>, String> {
    Ok(PersonaService::list_persona_templates())
}

/// 获取项目的默认人设
///
/// 获取指定项目的默认人设配置。
///
/// # 参数
/// - `db`: 数据库连接状态
/// - `project_id`: 项目 ID
///
/// # 返回
/// - 成功返回 Option<Persona>，没有默认人设时返回 None
/// - 失败返回错误信息
///
/// # 示例（前端调用）
/// ```typescript
/// const defaultPersona = await invoke('get_default_persona', {
///   projectId: 'project-1'
/// });
/// ```
#[tauri::command]
pub async fn get_default_persona(
    db: State<'_, DbConnection>,
    project_id: String,
) -> Result<Option<Persona>, String> {
    let conn = db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;
    PersonaService::get_default_persona(&conn, &project_id).map_err(|e| e.to_string())
}

// ============================================================================
// AI 生成人设
// ============================================================================

/// AI 生成的人设结果
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneratedPersona {
    /// 人设名称
    pub name: String,
    /// 人设描述
    pub description: String,
    /// 写作风格
    pub style: String,
    /// 语气
    pub tone: String,
    /// 目标受众
    pub target_audience: String,
    /// 禁用词列表
    pub forbidden_words: Vec<String>,
    /// 偏好词列表
    pub preferred_words: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneratedPersonaCommandResult {
    pub persona: GeneratedPersona,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub execution_runtime: Option<lime_agent::SessionExecutionRuntime>,
}

/// AI 一键生成人设
///
/// 根据用户提供的简单描述，调用 AI 生成完整的人设配置。
/// 自动从凭证池选择可用凭证进行调用。
///
/// # 参数
/// - `prompt`: 用户描述，例如"一个幽默风趣的科技博主"
///
/// # 返回
/// - 成功返回生成的人设配置
/// - 失败返回错误信息
#[tauri::command]
pub async fn generate_persona(
    app: AppHandle,
    agent_state: State<'_, crate::agent::AsterAgentState>,
    db: State<'_, DbConnection>,
    config_manager: State<'_, crate::config::GlobalConfigManagerState>,
    session_id: Option<String>,
    prompt: String,
) -> Result<GeneratedPersonaCommandResult, String> {
    use aster::conversation::message::Message;
    use futures::StreamExt;
    const PERSONA_FALLBACK_PROVIDER_CHAIN: [(&str, &str); 4] = [
        ("deepseek", "deepseek-chat"),
        ("openai", "gpt-4o-mini"),
        ("anthropic", "claude-3-haiku-20240307"),
        ("kiro", "anthropic.claude-3-haiku-20240307-v1:0"),
    ];

    tracing::info!("[Persona] AI 生成人设: prompt={}", prompt);

    // 确保 Agent 已初始化
    if !agent_state.is_initialized().await {
        agent_state.init_agent_with_db(&db).await?;
    }
    ensure_browser_mcp_tools_registered(agent_state.inner(), &db).await?;

    // 创建临时会话 ID
    let auxiliary_session_id = format!("persona-gen-{}", uuid::Uuid::new_v4());
    let provider_scope = prepare_auxiliary_provider_scope(
        &agent_state,
        &db,
        &config_manager,
        &auxiliary_session_id,
        AuxiliaryServiceModelSlot::AgentMeta,
        &PERSONA_FALLBACK_PROVIDER_CHAIN,
    )
    .await?;

    let system_prompt = r#"你是一个专业的内容创作人设设计师。根据用户的描述，生成一个完整的创作人设配置。

请严格按照以下 JSON 格式返回（不要包含任何其他文字，不要使用 markdown 代码块）：
{"name":"人设名称","description":"人设描述（50字以内）","style":"写作风格","tone":"语气","targetAudience":"目标受众","forbiddenWords":["禁用词1","禁用词2"],"preferredWords":["偏好词1","偏好词2"]}

注意：
1. 名称要有特色，能体现人设特点
2. 禁用词是创作时应避免的词汇
3. 偏好词是创作时优先使用的词汇
4. 直接返回 JSON，不要任何额外文字"#;

    let user_prompt = format!("{system_prompt}\n\n请为以下描述生成人设配置：{prompt}");

    let result = async {
        let cancel_token = agent_state.create_cancel_token(&auxiliary_session_id).await;

        let user_message = Message::user().with_text(&user_prompt);
        let base_runtime_prompt = merge_system_prompt_with_runtime_agents(None, None);
        let merged_prompt = if let Some(memory_prompt) =
            build_memory_prompt(&config_manager.config(), MemoryPromptContext::default())
        {
            match base_runtime_prompt {
                Some(base) => Some(format!("{base}\n\n{memory_prompt}")),
                None => Some(memory_prompt),
            }
        } else {
            base_runtime_prompt
        };
        let auxiliary_runtime_metadata = build_auxiliary_runtime_metadata(
            provider_scope.resolution(),
            "auxiliary_agent_meta",
            Some("generate_persona"),
            &["service_model_slot", "internal_turn", "auxiliary_session"],
            &[
                "当前为一次性 agent_meta 辅助任务，不参与 submit-turn current 主链。",
                "运行时只会使用一条已解析的 provider/model 路线。",
            ],
        );
        let session_config = build_auxiliary_session_config_with_turn_context(
            &auxiliary_session_id,
            merged_prompt,
            true,
            build_auxiliary_turn_context_override(auxiliary_runtime_metadata),
        );

        // 获取 Agent 引用
        let agent_arc = agent_state.get_agent_arc();
        let guard = agent_arc.read().await;
        let agent = guard.as_ref().ok_or("Agent 未初始化")?;

        // 调用 Agent
        let stream_result = agent
            .reply(user_message, session_config, Some(cancel_token.clone()))
            .await;

        let mut full_content = String::new();

        match stream_result {
            Ok(mut stream) => {
                while let Some(event_result) = stream.next().await {
                    match event_result {
                        Ok(agent_event) => {
                            // 提取文本内容
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
                        Err(e) => {
                            tracing::error!("[Persona] 流错误: {}", e);
                        }
                    }
                }
            }
            Err(e) => {
                agent_state.remove_cancel_token(&auxiliary_session_id).await;
                return Err(format!("AI 调用失败: {e}"));
            }
        }

        // 清理取消令牌
        agent_state.remove_cancel_token(&auxiliary_session_id).await;

        if full_content.is_empty() {
            return Err("AI 返回空内容".to_string());
        }

        tracing::debug!("[Persona] AI 返回内容: {}", full_content);

        // 解析 AI 返回的 JSON
        let persona: GeneratedPersona = parse_persona_json(&full_content)?;

        tracing::info!("[Persona] AI 生成人设成功: name={}", persona.name);

        Ok(persona)
    }
    .await;

    let execution_runtime =
        AsterAgentWrapper::get_runtime_session_execution_runtime(&db, &auxiliary_session_id).await;
    provider_scope.restore(&agent_state, &db).await;
    let result = result.map(|persona| GeneratedPersonaCommandResult {
        persona,
        session_id: Some(auxiliary_session_id),
        execution_runtime,
    })?;

    if let (Some(parent_session_id), Some(auxiliary_session_id)) = (
        session_id
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty()),
        result.session_id.as_deref(),
    ) {
        if let Err(error) = project_auxiliary_runtime_to_parent_session(
            &app,
            &db,
            AuxiliaryRuntimeProjectionInput {
                parent_session_id: parent_session_id.to_string(),
                auxiliary_session_id: auxiliary_session_id.to_string(),
                execution_runtime: result.execution_runtime.clone(),
                result: AuxiliaryRuntimeProjectionResult::PersonaGeneration {
                    persona: serde_json::to_value(&result.persona)
                        .unwrap_or(serde_json::Value::Null),
                },
            },
        )
        .await
        {
            tracing::warn!(
                "[Persona] 投影父会话辅助运行时失败，已降级继续: parent_session_id={}, auxiliary_session_id={}, error={}",
                parent_session_id,
                auxiliary_session_id,
                error
            );
        }
    }

    Ok(result)
}

/// 解析 AI 返回的人设 JSON
fn parse_persona_json(content: &str) -> Result<GeneratedPersona, String> {
    // 尝试提取 JSON 部分（AI 可能返回额外文字）
    let json_str = extract_json(content);

    serde_json::from_str(&json_str).map_err(|e| {
        tracing::error!("[Persona] JSON 解析失败: {}, content: {}", e, content);
        format!("解析人设配置失败: {e}")
    })
}

/// 从文本中提取 JSON
fn extract_json(content: &str) -> String {
    // 查找 JSON 对象的开始和结束
    if let Some(start) = content.find('{') {
        if let Some(end) = content.rfind('}') {
            if end > start {
                return content[start..=end].to_string();
            }
        }
    }
    content.to_string()
}
