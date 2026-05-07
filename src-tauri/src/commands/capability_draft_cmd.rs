//! Capability Draft 命令薄适配层。
//!
//! 业务规则集中在 `capability_draft_service`，这里不注册、不执行未验证草案。

use crate::services::capability_draft_service::{
    create_capability_draft, execute_capability_draft_controlled_get, get_capability_draft,
    list_capability_drafts, list_workspace_registered_skills, register_capability_draft,
    submit_capability_draft_approval_session_inputs, verify_capability_draft,
    CapabilityDraftRecord, CreateCapabilityDraftRequest,
    ExecuteCapabilityDraftControlledGetRequest, ExecuteCapabilityDraftControlledGetResult,
    GetCapabilityDraftRequest, ListCapabilityDraftsRequest, ListWorkspaceRegisteredSkillsRequest,
    RegisterCapabilityDraftRequest, RegisterCapabilityDraftResult,
    SubmitCapabilityDraftApprovalSessionInputsRequest,
    SubmitCapabilityDraftApprovalSessionInputsResult, VerifyCapabilityDraftRequest,
    VerifyCapabilityDraftResult, WorkspaceRegisteredSkillRecord,
};

#[tauri::command]
pub fn capability_draft_create(
    request: CreateCapabilityDraftRequest,
) -> Result<CapabilityDraftRecord, String> {
    create_capability_draft(request)
}

#[tauri::command]
pub fn capability_draft_list(
    request: ListCapabilityDraftsRequest,
) -> Result<Vec<CapabilityDraftRecord>, String> {
    list_capability_drafts(request)
}

#[tauri::command]
pub fn capability_draft_get(
    request: GetCapabilityDraftRequest,
) -> Result<Option<CapabilityDraftRecord>, String> {
    get_capability_draft(request)
}

#[tauri::command]
pub fn capability_draft_verify(
    request: VerifyCapabilityDraftRequest,
) -> Result<VerifyCapabilityDraftResult, String> {
    verify_capability_draft(request)
}

#[tauri::command]
pub fn capability_draft_register(
    request: RegisterCapabilityDraftRequest,
) -> Result<RegisterCapabilityDraftResult, String> {
    register_capability_draft(request)
}

#[tauri::command]
pub fn capability_draft_list_registered_skills(
    request: ListWorkspaceRegisteredSkillsRequest,
) -> Result<Vec<WorkspaceRegisteredSkillRecord>, String> {
    list_workspace_registered_skills(request)
}

#[tauri::command]
pub fn capability_draft_submit_approval_session_inputs(
    request: SubmitCapabilityDraftApprovalSessionInputsRequest,
) -> Result<SubmitCapabilityDraftApprovalSessionInputsResult, String> {
    submit_capability_draft_approval_session_inputs(request)
}

#[tauri::command]
pub async fn capability_draft_execute_controlled_get(
    request: ExecuteCapabilityDraftControlledGetRequest,
) -> Result<ExecuteCapabilityDraftControlledGetResult, String> {
    execute_capability_draft_controlled_get(request).await
}
