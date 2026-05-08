use super::{args_or_default, parse_nested_arg, require_app_handle};
use crate::dev_bridge::DevBridgeState;
use serde_json::Value as JsonValue;
use tauri::Manager;

type DynError = Box<dyn std::error::Error>;

pub(super) async fn try_handle(
    state: &DevBridgeState,
    cmd: &str,
    args: Option<&JsonValue>,
) -> Result<Option<JsonValue>, DynError> {
    let args = args_or_default(args);
    let result = match cmd {
        "knowledge_import_source" => {
            let request: lime_knowledge::KnowledgeImportSourceRequest =
                parse_nested_arg(&args, "request")?;
            serde_json::to_value(lime_knowledge::import_knowledge_source(request)?)?
        }
        "knowledge_compile_pack" => {
            let mut request: lime_knowledge::KnowledgeCompilePackRequest =
                parse_nested_arg(&args, "request")?;
            if state.app_handle.is_some() {
                let app_handle = require_app_handle(state)?;
                if let Some(plan) = lime_knowledge::plan_knowledge_builder_runtime(&request)? {
                    let db = app_handle.state::<crate::database::DbConnection>();
                    let api_key_provider_service = app_handle
                        .state::<crate::commands::api_key_provider_cmd::ApiKeyProviderServiceState>();
                    let config_manager =
                        app_handle.state::<crate::config::GlobalConfigManagerState>();
                    let aster_state = app_handle.state::<crate::agent::AsterAgentState>();
                    request.builder_execution = Some(
                        crate::commands::knowledge_cmd::execute_knowledge_builder_skill(
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
            }
            serde_json::to_value(lime_knowledge::compile_knowledge_pack(request)?)?
        }
        "knowledge_list_packs" => {
            let request: lime_knowledge::KnowledgeListPacksRequest =
                parse_nested_arg(&args, "request")?;
            serde_json::to_value(lime_knowledge::list_knowledge_packs(request)?)?
        }
        "knowledge_get_pack" => {
            let request: lime_knowledge::KnowledgeGetPackRequest =
                parse_nested_arg(&args, "request")?;
            serde_json::to_value(lime_knowledge::get_knowledge_pack(request)?)?
        }
        "knowledge_set_default_pack" => {
            let request: lime_knowledge::KnowledgeSetDefaultPackRequest =
                parse_nested_arg(&args, "request")?;
            serde_json::to_value(lime_knowledge::set_default_knowledge_pack(request)?)?
        }
        "knowledge_update_pack_status" => {
            let request: lime_knowledge::KnowledgeUpdatePackStatusRequest =
                parse_nested_arg(&args, "request")?;
            serde_json::to_value(lime_knowledge::update_knowledge_pack_status(request)?)?
        }
        "knowledge_resolve_context" => {
            let request: lime_knowledge::KnowledgeResolveContextRequest =
                parse_nested_arg(&args, "request")?;
            serde_json::to_value(lime_knowledge::resolve_knowledge_context(request)?)?
        }
        "knowledge_validate_context_run" => {
            let request: lime_knowledge::KnowledgeValidateContextRunRequest =
                parse_nested_arg(&args, "request")?;
            serde_json::to_value(lime_knowledge::validate_knowledge_context_run(request)?)?
        }
        _ => return Ok(None),
    };

    Ok(Some(result))
}
