use super::{args_or_default, parse_nested_arg};
use crate::commands::capability_draft_cmd::{
    capability_draft_create, capability_draft_execute_controlled_get, capability_draft_get,
    capability_draft_list, capability_draft_list_registered_skills, capability_draft_register,
    capability_draft_submit_approval_session_inputs, capability_draft_verify,
};
use crate::services::capability_draft_service::{
    CreateCapabilityDraftRequest, ExecuteCapabilityDraftControlledGetRequest,
    GetCapabilityDraftRequest, ListCapabilityDraftsRequest, ListWorkspaceRegisteredSkillsRequest,
    RegisterCapabilityDraftRequest, SubmitCapabilityDraftApprovalSessionInputsRequest,
    VerifyCapabilityDraftRequest,
};
use serde_json::Value as JsonValue;

pub(super) async fn try_handle(
    cmd: &str,
    args: Option<&JsonValue>,
) -> Result<Option<JsonValue>, Box<dyn std::error::Error>> {
    let result = match cmd {
        "capability_draft_create" => {
            let args = args_or_default(args);
            let request: CreateCapabilityDraftRequest = parse_nested_arg(&args, "request")?;
            serde_json::to_value(
                capability_draft_create(request)
                    .map_err(|error| format!("创建 Capability Draft 失败: {error}"))?,
            )?
        }
        "capability_draft_list" => {
            let args = args_or_default(args);
            let request: ListCapabilityDraftsRequest = parse_nested_arg(&args, "request")?;
            serde_json::to_value(
                capability_draft_list(request)
                    .map_err(|error| format!("读取 Capability Draft 列表失败: {error}"))?,
            )?
        }
        "capability_draft_get" => {
            let args = args_or_default(args);
            let request: GetCapabilityDraftRequest = parse_nested_arg(&args, "request")?;
            serde_json::to_value(
                capability_draft_get(request)
                    .map_err(|error| format!("读取 Capability Draft 失败: {error}"))?,
            )?
        }
        "capability_draft_verify" => {
            let args = args_or_default(args);
            let request: VerifyCapabilityDraftRequest = parse_nested_arg(&args, "request")?;
            serde_json::to_value(
                capability_draft_verify(request)
                    .map_err(|error| format!("验证 Capability Draft 失败: {error}"))?,
            )?
        }
        "capability_draft_register" => {
            let args = args_or_default(args);
            let request: RegisterCapabilityDraftRequest = parse_nested_arg(&args, "request")?;
            serde_json::to_value(
                capability_draft_register(request)
                    .map_err(|error| format!("注册 Capability Draft 失败: {error}"))?,
            )?
        }
        "capability_draft_list_registered_skills" => {
            let args = args_or_default(args);
            let request: ListWorkspaceRegisteredSkillsRequest = parse_nested_arg(&args, "request")?;
            serde_json::to_value(
                capability_draft_list_registered_skills(request)
                    .map_err(|error| format!("读取 Workspace 已注册能力失败: {error}"))?,
            )?
        }
        "capability_draft_submit_approval_session_inputs" => {
            let args = args_or_default(args);
            let request: SubmitCapabilityDraftApprovalSessionInputsRequest =
                parse_nested_arg(&args, "request")?;
            serde_json::to_value(
                capability_draft_submit_approval_session_inputs(request)
                    .map_err(|error| format!("校验 approval session 输入失败: {error}"))?,
            )?
        }
        "capability_draft_execute_controlled_get" => {
            let args = args_or_default(args);
            let request: ExecuteCapabilityDraftControlledGetRequest =
                parse_nested_arg(&args, "request")?;
            serde_json::to_value(
                capability_draft_execute_controlled_get(request)
                    .await
                    .map_err(|error| format!("执行受控 GET 失败: {error}"))?,
            )?
        }
        _ => return Ok(None),
    };

    Ok(Some(result))
}
