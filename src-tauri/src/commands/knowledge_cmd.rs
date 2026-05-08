//! Agent Knowledge 知识包命令
//!
//! 当前命令面承接 Phase 1 文件优先知识包主链，并把 Builder Skill
//! Runtime Binding 收在命令层；`lime-knowledge` crate 仍保持文件事实源纯逻辑。
//! 不在这里接入 Memory，也不把知识包当 Skill 本体。

use lime_knowledge::{
    compile_knowledge_pack, get_knowledge_pack, import_knowledge_source, list_knowledge_packs,
    plan_knowledge_builder_runtime, resolve_knowledge_context, set_default_knowledge_pack,
    update_knowledge_pack_status, validate_knowledge_context_run, KnowledgeBuilderRuntimeExecution,
    KnowledgeBuilderRuntimePlan, KnowledgeCompilePackRequest, KnowledgeCompilePackResponse,
    KnowledgeContextResolution, KnowledgeGetPackRequest, KnowledgeImportSourceRequest,
    KnowledgeImportSourceResponse, KnowledgeListPacksRequest, KnowledgeListPacksResponse,
    KnowledgePackDetail, KnowledgeResolveContextRequest, KnowledgeSetDefaultPackRequest,
    KnowledgeSetDefaultPackResponse, KnowledgeUpdatePackStatusRequest,
    KnowledgeUpdatePackStatusResponse, KnowledgeValidateContextRunRequest,
    KnowledgeValidateContextRunResponse,
};
use tauri::State;

use crate::agent::AsterAgentState;
use crate::commands::api_key_provider_cmd::ApiKeyProviderServiceState;
use crate::config::GlobalConfigManagerState;
use crate::database::DbConnection;
use crate::skills::{execute_named_skill, SkillExecutionRequest};

/// 导入知识包来源资料
#[tauri::command]
pub async fn knowledge_import_source(
    request: KnowledgeImportSourceRequest,
) -> Result<KnowledgeImportSourceResponse, String> {
    import_knowledge_source(request)
}

/// 编译知识包的 Markdown-first 运行时视图
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn knowledge_compile_pack(
    app_handle: tauri::AppHandle,
    db: State<'_, DbConnection>,
    api_key_provider_service: State<'_, ApiKeyProviderServiceState>,
    config_manager: State<'_, GlobalConfigManagerState>,
    aster_state: State<'_, AsterAgentState>,
    mut request: KnowledgeCompilePackRequest,
) -> Result<KnowledgeCompilePackResponse, String> {
    if let Some(plan) = plan_knowledge_builder_runtime(&request)? {
        request.builder_execution = Some(
            execute_knowledge_builder_skill(
                &app_handle,
                db.inner(),
                api_key_provider_service.inner(),
                config_manager.inner(),
                aster_state.inner(),
                plan,
            )
            .await,
        );
    }

    compile_knowledge_pack(request)
}

pub async fn execute_knowledge_builder_skill(
    app_handle: &tauri::AppHandle,
    db: &DbConnection,
    api_key_provider_service: &ApiKeyProviderServiceState,
    config_manager: &GlobalConfigManagerState,
    aster_state: &AsterAgentState,
    plan: KnowledgeBuilderRuntimePlan,
) -> KnowledgeBuilderRuntimeExecution {
    let result = execute_named_skill(
        app_handle,
        db,
        api_key_provider_service,
        config_manager,
        aster_state,
        SkillExecutionRequest {
            skill_name: plan.skill_name.clone(),
            user_input: plan.user_input,
            images: Vec::new(),
            request_context: Some(plan.request_context),
            provider_override: plan.provider_override.clone(),
            model_override: plan.model_override.clone(),
            execution_id: Some(plan.execution_id.clone()),
            session_id: Some(plan.session_id.clone()),
        },
    )
    .await;

    match result {
        Ok(output) if output.success => KnowledgeBuilderRuntimeExecution {
            skill_name: plan.skill_name,
            execution_id: plan.execution_id,
            session_id: Some(plan.session_id),
            status: "succeeded".to_string(),
            provider: plan.provider_override,
            model: plan.model_override,
            output: output.output,
            error: None,
        },
        Ok(output) => KnowledgeBuilderRuntimeExecution {
            skill_name: plan.skill_name,
            execution_id: plan.execution_id,
            session_id: Some(plan.session_id),
            status: "failed".to_string(),
            provider: plan.provider_override,
            model: plan.model_override,
            output: output.output,
            error: output
                .error
                .or_else(|| Some("Builder Skill 执行失败".to_string())),
        },
        Err(error) => KnowledgeBuilderRuntimeExecution {
            skill_name: plan.skill_name,
            execution_id: plan.execution_id,
            session_id: Some(plan.session_id),
            status: "failed".to_string(),
            provider: plan.provider_override,
            model: plan.model_override,
            output: None,
            error: Some(error),
        },
    }
}

/// 列出当前 workspace 的知识包 catalog
#[tauri::command]
pub async fn knowledge_list_packs(
    request: KnowledgeListPacksRequest,
) -> Result<KnowledgeListPacksResponse, String> {
    list_knowledge_packs(request)
}

/// 读取单个知识包详情
#[tauri::command]
pub async fn knowledge_get_pack(
    request: KnowledgeGetPackRequest,
) -> Result<KnowledgePackDetail, String> {
    get_knowledge_pack(request)
}

/// 设置 workspace 默认知识包
#[tauri::command]
pub async fn knowledge_set_default_pack(
    request: KnowledgeSetDefaultPackRequest,
) -> Result<KnowledgeSetDefaultPackResponse, String> {
    set_default_knowledge_pack(request)
}

/// 更新知识包审阅状态
#[tauri::command]
pub async fn knowledge_update_pack_status(
    request: KnowledgeUpdatePackStatusRequest,
) -> Result<KnowledgeUpdatePackStatusResponse, String> {
    update_knowledge_pack_status(request)
}

/// 按任务与预算解析 fenced knowledge context
#[tauri::command]
pub async fn knowledge_resolve_context(
    request: KnowledgeResolveContextRequest,
) -> Result<KnowledgeContextResolution, String> {
    resolve_knowledge_context(request)
}

/// 校验 context-resolution run record
#[tauri::command]
pub async fn knowledge_validate_context_run(
    request: KnowledgeValidateContextRunRequest,
) -> Result<KnowledgeValidateContextRunResponse, String> {
    validate_knowledge_context_run(request)
}
