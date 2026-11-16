use crate::skill_gate::SkillToolSessionSkillSource;
use crate::skill_runtime_contract::{
    SkillRuntimeContractMetadata, SkillRuntimeContractPreflightError,
};
use serde_json::{Value, json};
use std::collections::HashMap;

#[derive(Debug, Clone, PartialEq)]
pub struct SkillPreflightFailureProjection {
    pub message: String,
    pub metadata: HashMap<String, Value>,
}

pub fn skill_preflight_failure_projection(
    error: SkillRuntimeContractPreflightError,
) -> SkillPreflightFailureProjection {
    let code = error.code();
    let result_payload = error.result_payload();
    let metadata = error.metadata;
    let metadata_value = metadata.metadata_value();
    let runtime_contract = metadata.runtime_contract.clone();
    let skill_name = error.skill_name;
    let message = error.message;

    SkillPreflightFailureProjection {
        message,
        metadata: HashMap::from([
            ("tool_family".to_string(), json!("skill")),
            ("skill_name".to_string(), json!(skill_name)),
            ("runtime_preflight".to_string(), json!(true)),
            ("preflight_check".to_string(), json!(code)),
            (
                "last_error".to_string(),
                json!({
                    "code": code,
                    "message": result_payload
                        .pointer("/error/message")
                        .and_then(Value::as_str),
                    "stage": "runtime_preflight",
                    "retryable": false,
                }),
            ),
            ("normalized_status".to_string(), json!("failed")),
            ("result".to_string(), result_payload),
            (
                "modality_contract_key".to_string(),
                json!(metadata.contract_key.as_str()),
            ),
            ("modality".to_string(), json!(metadata.modality.as_str())),
            (
                "required_capabilities".to_string(),
                json!(&metadata.required_capabilities),
            ),
            (
                "routing_slot".to_string(),
                json!(metadata.routing_slot.as_str()),
            ),
            ("runtime_contract".to_string(), runtime_contract),
            ("modality_runtime_contract".to_string(), metadata_value),
        ]),
    }
}

pub fn skill_runtime_contract_metadata_map(
    metadata: &SkillRuntimeContractMetadata,
) -> HashMap<String, Value> {
    let mut projected = HashMap::from([
        (
            "modality_contract_key".to_string(),
            json!(metadata.contract_key),
        ),
        ("modality".to_string(), json!(metadata.modality)),
        (
            "required_capabilities".to_string(),
            json!(metadata.required_capabilities),
        ),
        ("routing_slot".to_string(), json!(metadata.routing_slot)),
        (
            "runtime_contract".to_string(),
            metadata.runtime_contract.clone(),
        ),
        (
            "modality_runtime_contract".to_string(),
            metadata.metadata_value(),
        ),
    ]);
    if let Some(entry_source) = metadata.entry_source.as_ref() {
        projected.insert("entry_source".to_string(), json!(entry_source));
    }
    projected
}

pub fn workspace_skill_source_metadata_map(
    source: &SkillToolSessionSkillSource,
) -> HashMap<String, Value> {
    HashMap::from([
        ("tool_family".to_string(), json!("skill")),
        ("skill_name".to_string(), json!(source.skill_name.as_str())),
        (
            "workspace_skill_source".to_string(),
            json!({
                "workspaceRoot": source.workspace_root.as_str(),
                "source": source.source.as_str(),
                "approval": source.approval.as_str(),
                "authorizationScope": "session",
                "directory": source.directory.as_str(),
                "registeredSkillDirectory": source.registered_skill_directory.as_str(),
                "skillName": source.skill_name.as_str(),
                "sourceDraftId": source.source_draft_id.as_str(),
                "sourceVerificationReportId": source.source_verification_report_id.as_str(),
                "permissionSummary": &source.permission_summary,
            }),
        ),
        (
            "workspace_skill_runtime_enable".to_string(),
            json!({
                "source": source.source.as_str(),
                "approval": source.approval.as_str(),
                "authorization_scope": "session",
                "workspace_root": source.workspace_root.as_str(),
                "directory": source.directory.as_str(),
                "skill": source.skill_name.as_str(),
                "registered_skill_directory": source.registered_skill_directory.as_str(),
                "source_draft_id": source.source_draft_id.as_str(),
                "source_verification_report_id": source.source_verification_report_id.as_str(),
                "permission_summary": &source.permission_summary,
            }),
        ),
    ])
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::skill_runtime_contract::{
        PDF_EXTRACT_CONTRACT_KEY, WEB_RESEARCH_CONTRACT_KEY, build_skill_runtime_contract_metadata,
    };

    #[test]
    fn runtime_contract_metadata_projects_item_metadata() {
        let metadata = build_skill_runtime_contract_metadata(&json!({
            "skill": "site_search"
        }))
        .expect("metadata should build")
        .expect("site_search should have runtime metadata");

        let projected = skill_runtime_contract_metadata_map(&metadata);

        assert_eq!(
            projected.get("modality_contract_key"),
            Some(&json!(WEB_RESEARCH_CONTRACT_KEY))
        );
        assert_eq!(
            projected.get("entry_source"),
            Some(&json!("at_site_search_command"))
        );
        assert_eq!(
            projected
                .get("modality_runtime_contract")
                .and_then(|value| value.pointer("/runtimeContract/executor_adapter/adapter_key")),
            Some(&json!("skill:research"))
        );
    }

    #[test]
    fn preflight_failure_projects_retry_metadata_without_agent() {
        let error = build_skill_runtime_contract_metadata(&json!({
            "skill": "pdf_read",
            "args": json!({
                "pdf_read_request": {
                    "runtime_contract": {
                        "contract_key": PDF_EXTRACT_CONTRACT_KEY,
                        "modality": "document",
                        "required_capabilities": [
                            "text_generation",
                            "local_file_read",
                            "long_context"
                        ],
                        "routing_slot": "base_model",
                        "execution_profile": {
                            "profile_key": "pdf_extract_profile"
                        },
                        "executor_adapter": {
                            "adapter_key": "skill:research"
                        },
                        "executor_binding": {
                            "executor_kind": "skill",
                            "binding_key": "pdf_read"
                        }
                    }
                }
            }).to_string()
        }))
        .expect_err("wrong adapter should return runtime preflight error");

        let projection = skill_preflight_failure_projection(error);

        assert!(projection.message.contains("executor_adapter"));
        assert_eq!(
            projection.metadata.get("preflight_check"),
            Some(&json!("pdf_extract_executor_adapter_mismatch"))
        );
        assert_eq!(
            projection
                .metadata
                .get("last_error")
                .and_then(|value| value.get("retryable")),
            Some(&json!(false))
        );
        assert_eq!(
            projection.metadata.get("normalized_status"),
            Some(&json!("failed"))
        );
    }

    #[test]
    fn workspace_skill_source_projects_runtime_enable_metadata() {
        let source = SkillToolSessionSkillSource {
            workspace_root: "/tmp/workspace".to_string(),
            source: "manual_session_enable".to_string(),
            approval: "manual".to_string(),
            directory: "capability-report".to_string(),
            registered_skill_directory: "/tmp/workspace/.agents/skills/capability-report"
                .to_string(),
            skill_name: "project:capability-report".to_string(),
            source_draft_id: "capdraft-1".to_string(),
            source_verification_report_id: "capver-1".to_string(),
            permission_summary: vec!["Level 0 read only discovery".to_string()],
        };

        let projected = workspace_skill_source_metadata_map(&source);

        assert_eq!(projected.get("tool_family"), Some(&json!("skill")));
        assert_eq!(
            projected
                .get("workspace_skill_source")
                .and_then(|value| value.get("sourceDraftId")),
            Some(&json!("capdraft-1"))
        );
        assert_eq!(
            projected
                .get("workspace_skill_runtime_enable")
                .and_then(|value| value.get("source_verification_report_id")),
            Some(&json!("capver-1"))
        );
    }
}
