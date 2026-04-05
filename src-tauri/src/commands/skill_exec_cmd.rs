//! Skill 执行 Tauri 命令模块
//!
//! 本模块提供 Skill 执行相关的 Tauri 命令，包括：
//! - `execute_skill`: 执行指定的 Skill
//! - `list_executable_skills`: 列出所有可执行的 Skills
//! - `get_skill_detail`: 获取 Skill 详情
//!
//! ## 依赖
//! - `AsterAgentState`: Aster Agent 状态管理，提供底层 Agent 执行能力
//! - `skills/runtime`: skill 执行前置准备、provider fallback 与 run metadata 边界
//! - `ExecutionTracker`: 统一执行记录写入
//!
//! ## Requirements
//! - 3.1: execute_skill 命令接受 skill_name 和 user_input 参数
//! - 4.1: list_executable_skills 返回所有可执行的 skills
//! - 5.1: get_skill_detail 接受 skill_name 参数

use tauri::State;

use crate::agent::AsterAgentState;
use crate::commands::api_key_provider_cmd::ApiKeyProviderServiceState;
use crate::config::GlobalConfigManagerState;
use crate::database::DbConnection;
use crate::skills::{
    execute_named_skill, get_skill_detail_info, list_executable_skill_catalog, ExecutableSkillInfo,
    SkillDetailInfo, SkillExecutionImageInput, SkillExecutionRequest, SkillExecutionResult,
};

// ============================================================================
// 公开类型定义
// ============================================================================

/// 执行 Skill
///
/// 加载并执行指定的 Skill，使用 Aster Agent 系统提供完整的工具集支持。
///
/// # Arguments
/// * `app_handle` - Tauri AppHandle，用于发送事件
/// * `db` - 数据库连接
/// * `aster_state` - Aster Agent 状态
/// * `skill_name` - Skill 名称
/// * `user_input` - 用户输入
/// * `provider_override` - 可选的 Provider 覆盖
/// * `session_id` - 可选的会话 ID（用于复用当前聊天上下文）
///
/// # Returns
/// * `Ok(SkillExecutionResult)` - 执行结果
/// * `Err(String)` - 错误信息
///
/// # Requirements
/// - 3.1: 接受 skill_name 和 user_input 参数
/// - 3.2: 从 registry 加载 skill
/// - 3.3: 使用 Aster Agent 执行（支持工具调用）
/// - 3.5: 返回 SkillExecutionResult
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn execute_skill(
    app_handle: tauri::AppHandle,
    db: State<'_, DbConnection>,
    api_key_provider_service: State<'_, ApiKeyProviderServiceState>,
    config_manager: State<'_, GlobalConfigManagerState>,
    aster_state: State<'_, AsterAgentState>,
    skill_name: String,
    user_input: String,
    images: Option<Vec<SkillExecutionImageInput>>,
    request_context: Option<serde_json::Value>,
    provider_override: Option<String>,
    model_override: Option<String>,
    execution_id: Option<String>,
    session_id: Option<String>,
) -> Result<SkillExecutionResult, String> {
    execute_named_skill(
        &app_handle,
        db.inner(),
        api_key_provider_service.inner(),
        config_manager.inner(),
        aster_state.inner(),
        SkillExecutionRequest {
            skill_name,
            user_input,
            images: images.unwrap_or_default(),
            request_context,
            provider_override,
            model_override,
            execution_id,
            session_id,
        },
    )
    .await
}

/// 列出可执行的 Skills
///
/// 返回所有可以执行的 Skills 列表，过滤掉无效 Skill 包和
/// disable_model_invocation=true 的 Skills。
///
/// # Returns
/// * `Ok(Vec<ExecutableSkillInfo>)` - 可执行的 Skills 列表
/// * `Err(String)` - 错误信息
///
/// # Requirements
/// - 4.1: 返回所有可执行的 skills
/// - 4.2: 包含 name, description, execution_mode
/// - 4.3: 指示是否有 workflow 定义
/// - 4.4: 过滤 disable_model_invocation=true 的 skills
/// - 4.5: 过滤未通过标准校验的 skills
#[tauri::command]
pub async fn list_executable_skills() -> Result<Vec<ExecutableSkillInfo>, String> {
    list_executable_skill_catalog()
}

/// 获取 Skill 详情
///
/// 根据 skill_name 返回完整的 Skill 详情信息。
///
/// # Arguments
/// * `skill_name` - Skill 名称
///
/// # Returns
/// * `Ok(SkillDetailInfo)` - Skill 详情
/// * `Err(String)` - 错误信息（如 skill 不存在）
///
/// # Requirements
/// - 5.1: 接受 skill_name 参数
/// - 5.2: 返回完整的 SkillDefinition
/// - 5.3: 包含 workflow steps 信息（如果有）
/// - 5.4: skill 不存在时返回错误
#[tauri::command]
pub async fn get_skill_detail(skill_name: String) -> Result<SkillDetailInfo, String> {
    get_skill_detail_info(&skill_name)
}
