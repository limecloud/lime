//! Capability Draft 文件事实源服务。
//!
//! P1A / P1B 只负责创建、读取、列出和静态验证草案；不注册 Skill，也不进入执行面。

use chrono::Utc;
use lime_core::models::{
    parse_skill_manifest_from_content, SkillResourceSummary, SkillStandardCompliance,
};
use lime_services::skill_service::SkillService;
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::process::{Command, Output, Stdio};
use std::thread;
use std::time::{Duration, Instant};
use url::Url;
use uuid::Uuid;

const DRAFTS_RELATIVE_DIR: &str = ".lime/capability-drafts";
const MANIFEST_FILE_NAME: &str = "manifest.json";
const VERIFICATION_DIR_NAME: &str = "verification";
const LATEST_VERIFICATION_FILE_NAME: &str = "latest.json";
const REGISTRATION_DIR_NAME: &str = "registration";
const LATEST_REGISTRATION_FILE_NAME: &str = "latest.json";
const REGISTERED_SKILLS_ROOT_DIR_NAME: &str = ".agents";
const REGISTERED_SKILLS_DIR_NAME: &str = "skills";
const SKILL_REGISTRATION_METADATA_DIR_NAME: &str = ".lime";
const SKILL_REGISTRATION_METADATA_FILE_NAME: &str = "registration.json";
const MAX_GENERATED_FILES: usize = 32;
const MAX_FILE_BYTES: usize = 256 * 1024;
const MAX_TOTAL_BYTES: usize = 1024 * 1024;
const MAX_TEXT_FIELD_CHARS: usize = 4096;
const MIN_SKILL_MD_CHARS: usize = 40;
const FIXTURE_DRY_RUN_TIMEOUT_MS: u64 = 3_000;
const MAX_DRY_RUN_MESSAGE_CHARS: usize = 512;
const CONTROLLED_GET_TIMEOUT_SECS: u64 = 10;
const CONTROLLED_GET_RESPONSE_PREVIEW_BYTES: usize = 4096;
const CONTROLLED_GET_EVIDENCE_DIR_NAME: &str = "controlled-get-evidence";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CapabilityDraftStatus {
    Unverified,
    FailedSelfCheck,
    VerificationFailed,
    VerifiedPendingRegistration,
    Registered,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CapabilityDraftVerificationRunStatus {
    Passed,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CapabilityDraftVerificationCheckStatus {
    Passed,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityDraftVerificationEvidence {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityDraftVerificationCheck {
    pub id: String,
    pub label: String,
    pub status: CapabilityDraftVerificationCheckStatus,
    pub message: String,
    pub suggestions: Vec<String>,
    pub can_agent_repair: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub evidence: Vec<CapabilityDraftVerificationEvidence>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityDraftVerificationSummary {
    pub report_id: String,
    pub status: CapabilityDraftVerificationRunStatus,
    pub summary: String,
    pub checked_at: String,
    pub failed_check_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityDraftVerificationReport {
    #[serde(flatten)]
    pub summary: CapabilityDraftVerificationSummary,
    pub draft_id: String,
    pub checks: Vec<CapabilityDraftVerificationCheck>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityDraftRegistrationVerificationGate {
    pub check_id: String,
    pub label: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub evidence: Vec<CapabilityDraftVerificationEvidence>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CapabilityDraftApprovalRequestStatus {
    Pending,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CapabilityDraftApprovalConsumptionStatus {
    AwaitingSessionApproval,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityDraftRegistrationApprovalConsumptionGate {
    pub status: CapabilityDraftApprovalConsumptionStatus,
    pub required_inputs: Vec<String>,
    pub runtime_execution_enabled: bool,
    pub credential_storage_enabled: bool,
    pub blocked_reason: String,
    pub next_action: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CapabilityDraftCredentialResolverStatus {
    AwaitingSessionCredential,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityDraftRegistrationCredentialResolver {
    pub status: CapabilityDraftCredentialResolverStatus,
    pub reference_id: String,
    pub scope: String,
    pub source: String,
    pub secret_material_status: String,
    pub token_persisted: bool,
    pub runtime_injection_enabled: bool,
    pub blocked_reason: String,
    pub next_action: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityDraftApprovalConsumptionInputField {
    pub key: String,
    pub label: String,
    pub kind: String,
    pub required: bool,
    pub source: String,
    pub secret: bool,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityDraftApprovalConsumptionInputSchema {
    pub schema_id: String,
    pub version: u32,
    pub fields: Vec<CapabilityDraftApprovalConsumptionInputField>,
    pub ui_submission_enabled: bool,
    pub runtime_execution_enabled: bool,
    pub blocked_reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CapabilityDraftApprovalConsumptionSessionIntakeStatus {
    AwaitingSessionInputs,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityDraftApprovalConsumptionSessionIntake {
    pub status: CapabilityDraftApprovalConsumptionSessionIntakeStatus,
    pub schema_id: String,
    pub scope: String,
    pub required_field_keys: Vec<String>,
    pub missing_field_keys: Vec<String>,
    pub collected_field_keys: Vec<String>,
    pub credential_reference_id: String,
    pub endpoint_input_persisted: bool,
    pub secret_material_status: String,
    pub token_persisted: bool,
    pub ui_submission_enabled: bool,
    pub runtime_execution_enabled: bool,
    pub blocked_reason: String,
    pub next_action: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CapabilityDraftApprovalSessionSubmissionStatus {
    SubmissionContractDeclared,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityDraftApprovalSessionSubmissionValidationRule {
    pub field_key: String,
    pub kind: String,
    pub required: bool,
    pub source: String,
    pub secret_allowed: bool,
    pub rule: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityDraftApprovalSessionSubmissionContract {
    pub status: CapabilityDraftApprovalSessionSubmissionStatus,
    pub scope: String,
    pub mode: String,
    pub accepted_field_keys: Vec<String>,
    pub validation_rules: Vec<CapabilityDraftApprovalSessionSubmissionValidationRule>,
    pub value_retention: String,
    pub endpoint_input_persisted: bool,
    pub secret_material_accepted: bool,
    pub token_persisted: bool,
    pub evidence_capture_required: bool,
    pub submission_handler_enabled: bool,
    pub ui_submission_enabled: bool,
    pub runtime_execution_enabled: bool,
    pub blocked_reason: String,
    pub next_action: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CapabilityDraftApprovalSessionSubmissionValidationStatus {
    ValidatedPendingRuntimeGate,
    Rejected,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityDraftApprovalSessionSubmissionFieldResult {
    pub field_key: String,
    pub accepted: bool,
    pub code: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CapabilityDraftReadonlyHttpControlledGetPreflightStatus {
    ReadyForControlledGetPreflight,
    BlockedBySessionInput,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityDraftReadonlyHttpControlledGetPreflight {
    pub status: CapabilityDraftReadonlyHttpControlledGetPreflightStatus,
    pub gate_id: String,
    pub approval_id: String,
    pub method: String,
    pub method_allowed: bool,
    pub endpoint_source: String,
    pub endpoint_validated: bool,
    pub endpoint_value_returned: bool,
    pub credential_reference_id: String,
    pub credential_resolution_required: bool,
    pub credential_resolved: bool,
    pub evidence_schema: Vec<String>,
    pub policy_path: String,
    pub request_execution_enabled: bool,
    pub runtime_execution_enabled: bool,
    pub blocked_reason: String,
    pub next_action: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CapabilityDraftReadonlyHttpDryPreflightPlanStatus {
    PlannedWithoutExecution,
    BlockedBySessionInput,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityDraftReadonlyHttpDryPreflightPlan {
    pub status: CapabilityDraftReadonlyHttpDryPreflightPlanStatus,
    pub plan_id: String,
    pub gate_id: String,
    pub approval_id: String,
    pub method: String,
    pub method_allowed: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub request_url_hash: Option<String>,
    pub request_url_hash_algorithm: String,
    pub endpoint_value_returned: bool,
    pub endpoint_input_persisted: bool,
    pub credential_reference_id: String,
    pub credential_resolution_stage: String,
    pub credential_resolved: bool,
    pub evidence_schema: Vec<String>,
    pub planned_evidence_keys: Vec<String>,
    pub policy_path: String,
    pub network_request_sent: bool,
    pub response_captured: bool,
    pub request_execution_enabled: bool,
    pub runtime_execution_enabled: bool,
    pub value_retention: String,
    pub blocked_reason: String,
    pub next_action: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityDraftRegistrationApprovalRequest {
    pub approval_id: String,
    pub status: CapabilityDraftApprovalRequestStatus,
    pub source_check_id: String,
    pub skill_directory: String,
    pub endpoint_source: String,
    pub method: String,
    pub credential_reference_id: String,
    pub evidence_schema: Vec<String>,
    pub policy_path: String,
    pub created_at: String,
    pub consumption_gate: CapabilityDraftRegistrationApprovalConsumptionGate,
    pub credential_resolver: CapabilityDraftRegistrationCredentialResolver,
    pub consumption_input_schema: CapabilityDraftApprovalConsumptionInputSchema,
    pub session_input_intake: CapabilityDraftApprovalConsumptionSessionIntake,
    pub session_input_submission_contract: CapabilityDraftApprovalSessionSubmissionContract,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityDraftRegistrationSummary {
    pub registration_id: String,
    pub registered_at: String,
    pub skill_directory: String,
    pub registered_skill_directory: String,
    pub source_draft_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_verification_report_id: Option<String>,
    pub generated_file_count: usize,
    pub permission_summary: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub verification_gates: Vec<CapabilityDraftRegistrationVerificationGate>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub approval_requests: Vec<CapabilityDraftRegistrationApprovalRequest>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityDraftFileInput {
    #[serde(alias = "relative_path")]
    pub relative_path: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityDraftFileSummary {
    #[serde(alias = "relative_path")]
    pub relative_path: String,
    pub byte_length: usize,
    pub sha256: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityDraftManifest {
    pub draft_id: String,
    pub name: String,
    pub description: String,
    pub user_goal: String,
    pub source_kind: String,
    pub source_refs: Vec<String>,
    pub permission_summary: Vec<String>,
    pub generated_files: Vec<CapabilityDraftFileSummary>,
    pub verification_status: CapabilityDraftStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_verification: Option<CapabilityDraftVerificationSummary>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_registration: Option<CapabilityDraftRegistrationSummary>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityDraftRecord {
    #[serde(flatten)]
    pub manifest: CapabilityDraftManifest,
    pub draft_root: String,
    pub manifest_path: String,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CreateCapabilityDraftRequest {
    #[serde(alias = "workspace_root")]
    pub workspace_root: String,
    pub name: String,
    pub description: String,
    #[serde(alias = "user_goal")]
    pub user_goal: String,
    #[serde(default = "default_source_kind", alias = "source_kind")]
    pub source_kind: String,
    #[serde(default, alias = "source_refs")]
    pub source_refs: Vec<String>,
    #[serde(default, alias = "permission_summary")]
    pub permission_summary: Vec<String>,
    #[serde(default, alias = "generated_files")]
    pub generated_files: Vec<CapabilityDraftFileInput>,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ListCapabilityDraftsRequest {
    #[serde(alias = "workspace_root")]
    pub workspace_root: String,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GetCapabilityDraftRequest {
    #[serde(alias = "workspace_root")]
    pub workspace_root: String,
    #[serde(alias = "draft_id")]
    pub draft_id: String,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct VerifyCapabilityDraftRequest {
    #[serde(alias = "workspace_root")]
    pub workspace_root: String,
    #[serde(alias = "draft_id")]
    pub draft_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct VerifyCapabilityDraftResult {
    pub draft: CapabilityDraftRecord,
    pub report: CapabilityDraftVerificationReport,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RegisterCapabilityDraftRequest {
    #[serde(alias = "workspace_root")]
    pub workspace_root: String,
    #[serde(alias = "draft_id")]
    pub draft_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RegisterCapabilityDraftResult {
    pub draft: CapabilityDraftRecord,
    pub registration: CapabilityDraftRegistrationSummary,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ListWorkspaceRegisteredSkillsRequest {
    #[serde(alias = "workspace_root")]
    pub workspace_root: String,
}

#[derive(Debug, Clone, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SubmitCapabilityDraftApprovalSessionInputsRequest {
    #[serde(alias = "workspace_root")]
    pub workspace_root: String,
    #[serde(alias = "approval_id")]
    pub approval_id: String,
    #[serde(default, alias = "session_id")]
    pub session_id: Option<String>,
    #[serde(default)]
    pub inputs: HashMap<String, JsonValue>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SubmitCapabilityDraftApprovalSessionInputsResult {
    pub approval_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    pub status: CapabilityDraftApprovalSessionSubmissionValidationStatus,
    pub scope: String,
    pub accepted_field_keys: Vec<String>,
    pub missing_field_keys: Vec<String>,
    pub rejected_field_keys: Vec<String>,
    pub field_results: Vec<CapabilityDraftApprovalSessionSubmissionFieldResult>,
    pub endpoint_input_persisted: bool,
    pub secret_material_accepted: bool,
    pub token_persisted: bool,
    pub credential_resolved: bool,
    pub value_retention: String,
    pub evidence_capture_required: bool,
    pub runtime_execution_enabled: bool,
    pub next_gate: String,
    pub controlled_get_preflight: CapabilityDraftReadonlyHttpControlledGetPreflight,
    pub dry_preflight_plan: CapabilityDraftReadonlyHttpDryPreflightPlan,
    pub blocked_reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CapabilityDraftControlledGetExecutionStatus {
    Executed,
    Blocked,
    RequestFailed,
}

#[derive(Debug, Clone, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExecuteCapabilityDraftControlledGetRequest {
    #[serde(alias = "workspace_root")]
    pub workspace_root: String,
    #[serde(alias = "approval_id")]
    pub approval_id: String,
    #[serde(default, alias = "session_id")]
    pub session_id: Option<String>,
    #[serde(default)]
    pub inputs: HashMap<String, JsonValue>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ExecuteCapabilityDraftControlledGetResult {
    pub approval_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    pub status: CapabilityDraftControlledGetExecutionStatus,
    pub scope: String,
    pub gate_id: String,
    pub method: String,
    pub method_allowed: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub request_url_hash: Option<String>,
    pub request_url_hash_algorithm: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub response_status: Option<u16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub response_sha256: Option<String>,
    pub response_bytes: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub response_preview: Option<String>,
    pub response_preview_truncated: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub executed_at: Option<String>,
    pub network_request_sent: bool,
    pub response_captured: bool,
    pub endpoint_value_returned: bool,
    pub endpoint_input_persisted: bool,
    pub credential_reference_id: String,
    pub credential_resolved: bool,
    pub token_persisted: bool,
    pub request_execution_enabled: bool,
    pub runtime_execution_enabled: bool,
    pub value_retention: String,
    pub session_input_status: CapabilityDraftApprovalSessionSubmissionValidationStatus,
    pub field_results: Vec<CapabilityDraftApprovalSessionSubmissionFieldResult>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub evidence: Vec<CapabilityDraftVerificationEvidence>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub evidence_artifact: Option<CapabilityDraftControlledGetEvidenceArtifact>,
    pub blocked_reason: String,
    pub next_action: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityDraftControlledGetEvidenceArtifact {
    pub artifact_id: String,
    pub relative_path: String,
    pub absolute_path: String,
    pub content_sha256: String,
    pub persisted: bool,
    pub contains_endpoint_value: bool,
    pub contains_token_value: bool,
    pub contains_response_preview: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceRegisteredSkillRecord {
    pub key: String,
    pub name: String,
    pub description: String,
    pub directory: String,
    pub registered_skill_directory: String,
    pub registration: CapabilityDraftRegistrationSummary,
    pub permission_summary: Vec<String>,
    pub metadata: HashMap<String, String>,
    pub allowed_tools: Vec<String>,
    pub resource_summary: SkillResourceSummary,
    pub standard_compliance: SkillStandardCompliance,
    pub launch_enabled: bool,
    pub runtime_gate: String,
}

struct PreparedDraftFile {
    relative_path: String,
    output_path: PathBuf,
    content: String,
    summary: CapabilityDraftFileSummary,
}

struct FixtureDryRunExecutionResult {
    message: String,
    evidence: Vec<CapabilityDraftVerificationEvidence>,
}

struct TimedCommandOutput {
    output: Output,
    duration_ms: u128,
}

fn default_source_kind() -> String {
    "manual".to_string()
}

fn now_iso8601() -> String {
    Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

fn normalize_required_text(value: &str, field: &str) -> Result<String, String> {
    let normalized = value.replace('\r', "").trim().to_string();
    if normalized.is_empty() {
        return Err(format!("{field} 不能为空"));
    }
    if normalized.chars().count() > MAX_TEXT_FIELD_CHARS {
        return Err(format!("{field} 过长，最多 {MAX_TEXT_FIELD_CHARS} 个字符"));
    }
    Ok(normalized)
}

fn normalize_string_list(values: &[String], field: &str) -> Result<Vec<String>, String> {
    let mut normalized = Vec::new();
    let mut seen = HashSet::new();
    for value in values {
        let item = value.replace('\r', "").trim().to_string();
        if item.is_empty() {
            continue;
        }
        if item.chars().count() > MAX_TEXT_FIELD_CHARS {
            return Err(format!("{field} 中存在过长条目"));
        }
        if seen.insert(item.clone()) {
            normalized.push(item);
        }
    }
    Ok(normalized)
}

fn resolve_workspace_root(workspace_root: &str) -> Result<PathBuf, String> {
    let raw = workspace_root.trim();
    if raw.is_empty() {
        return Err("workspaceRoot 不能为空".to_string());
    }

    let path = PathBuf::from(raw);
    if !path.is_absolute() {
        return Err("workspaceRoot 必须是绝对路径".to_string());
    }
    if !path.exists() {
        return Err(format!("工作区根目录不存在: {raw}"));
    }
    if !path.is_dir() {
        return Err(format!("workspaceRoot 不是目录: {raw}"));
    }

    fs::canonicalize(&path).map_err(|error| format!("解析工作区根目录失败: {error}"))
}

fn drafts_root_for_workspace(workspace_root: &Path) -> PathBuf {
    workspace_root.join(DRAFTS_RELATIVE_DIR)
}

fn validate_draft_id(draft_id: &str) -> Result<String, String> {
    let normalized = draft_id.trim();
    if normalized.is_empty() {
        return Err("draftId 不能为空".to_string());
    }
    if normalized.len() > 96 {
        return Err("draftId 过长".to_string());
    }
    if normalized == "." || normalized == ".." {
        return Err("draftId 不合法".to_string());
    }
    if !normalized
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_')
    {
        return Err("draftId 只能包含字母、数字、短横线和下划线".to_string());
    }
    Ok(normalized.to_string())
}

fn validate_relative_path(relative_path: &str) -> Result<PathBuf, String> {
    let raw = relative_path.trim();
    if raw.is_empty() {
        return Err("生成文件 relativePath 不能为空".to_string());
    }
    if raw.contains('\\') || raw.contains(':') || raw.chars().any(char::is_control) {
        return Err(format!("生成文件路径不允许包含平台相关或控制字符: {raw}"));
    }

    let path = Path::new(raw);
    if path.is_absolute() {
        return Err(format!("生成文件路径必须是相对路径: {raw}"));
    }

    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Normal(segment) => normalized.push(segment),
            Component::CurDir
            | Component::ParentDir
            | Component::RootDir
            | Component::Prefix(_) => {
                return Err(format!("生成文件路径不能包含 .、.. 或根路径: {raw}"));
            }
        }
    }

    let normalized_text = normalized.to_string_lossy().replace('\\', "/");
    if normalized_text.is_empty() || normalized_text == MANIFEST_FILE_NAME {
        return Err("manifest.json 由 Capability Draft 服务维护，不能作为生成文件写入".to_string());
    }

    Ok(normalized)
}

fn sha256_hex(content: &str) -> String {
    let digest = Sha256::digest(content.as_bytes());
    format!("{digest:x}")
}

fn prepare_generated_files(
    draft_root: &Path,
    files: &[CapabilityDraftFileInput],
) -> Result<Vec<PreparedDraftFile>, String> {
    if files.is_empty() {
        return Err("至少需要 1 个生成文件，P1A 不创建空草案".to_string());
    }
    if files.len() > MAX_GENERATED_FILES {
        return Err(format!("生成文件过多，最多 {MAX_GENERATED_FILES} 个"));
    }

    let mut total_bytes = 0usize;
    let mut seen = HashSet::new();
    let mut prepared = Vec::with_capacity(files.len());

    for file in files {
        let relative_path = validate_relative_path(&file.relative_path)?;
        let relative_text = relative_path.to_string_lossy().replace('\\', "/");
        if !seen.insert(relative_text.clone()) {
            return Err(format!("生成文件路径重复: {relative_text}"));
        }

        let byte_length = file.content.as_bytes().len();
        if byte_length > MAX_FILE_BYTES {
            return Err(format!(
                "生成文件 {relative_text} 过大，最多 {MAX_FILE_BYTES} 字节"
            ));
        }
        total_bytes = total_bytes.saturating_add(byte_length);
        if total_bytes > MAX_TOTAL_BYTES {
            return Err(format!("生成文件总大小过大，最多 {MAX_TOTAL_BYTES} 字节"));
        }

        let output_path = draft_root.join(&relative_path);
        if !output_path.starts_with(draft_root) {
            return Err(format!("生成文件路径逃逸 draft root: {relative_text}"));
        }

        prepared.push(PreparedDraftFile {
            relative_path: relative_text.clone(),
            output_path,
            content: file.content.clone(),
            summary: CapabilityDraftFileSummary {
                relative_path: relative_text,
                byte_length,
                sha256: sha256_hex(&file.content),
            },
        });
    }

    Ok(prepared)
}

fn write_manifest(path: &Path, manifest: &CapabilityDraftManifest) -> Result<(), String> {
    let content = serde_json::to_string_pretty(manifest)
        .map_err(|error| format!("序列化 capability draft manifest 失败: {error}"))?;
    let temp_path = path.with_extension("json.tmp");
    fs::write(&temp_path, content)
        .map_err(|error| format!("写入 capability draft manifest 临时文件失败: {error}"))?;
    fs::rename(&temp_path, path)
        .map_err(|error| format!("替换 capability draft manifest 失败: {error}"))
}

fn read_manifest(path: &Path) -> Result<CapabilityDraftManifest, String> {
    let content = fs::read_to_string(path)
        .map_err(|error| format!("读取 capability draft manifest 失败: {error}"))?;
    serde_json::from_str(&content)
        .map_err(|error| format!("解析 capability draft manifest 失败: {error}"))
}

fn verification_report_path(draft_root: &Path) -> PathBuf {
    draft_root
        .join(VERIFICATION_DIR_NAME)
        .join(LATEST_VERIFICATION_FILE_NAME)
}

fn registration_report_path(draft_root: &Path) -> PathBuf {
    draft_root
        .join(REGISTRATION_DIR_NAME)
        .join(LATEST_REGISTRATION_FILE_NAME)
}

fn write_verification_report(
    path: &Path,
    report: &CapabilityDraftVerificationReport,
) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("创建 capability draft verification 目录失败: {error}"))?;
    }
    let content = serde_json::to_string_pretty(report)
        .map_err(|error| format!("序列化 capability draft verification report 失败: {error}"))?;
    let temp_path = path.with_extension("json.tmp");
    fs::write(&temp_path, content)
        .map_err(|error| format!("写入 capability draft verification 临时文件失败: {error}"))?;
    fs::rename(&temp_path, path)
        .map_err(|error| format!("替换 capability draft verification report 失败: {error}"))
}

fn read_verification_report(path: &Path) -> Result<CapabilityDraftVerificationReport, String> {
    let content = fs::read_to_string(path)
        .map_err(|error| format!("读取 capability draft verification report 失败: {error}"))?;
    serde_json::from_str(&content)
        .map_err(|error| format!("解析 capability draft verification report 失败: {error}"))
}

fn write_registration_summary(
    path: &Path,
    summary: &CapabilityDraftRegistrationSummary,
) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("创建 capability draft registration 目录失败: {error}"))?;
    }
    let content = serde_json::to_string_pretty(summary)
        .map_err(|error| format!("序列化 capability draft registration summary 失败: {error}"))?;
    let temp_path = path.with_extension("json.tmp");
    fs::write(&temp_path, content)
        .map_err(|error| format!("写入 capability draft registration 临时文件失败: {error}"))?;
    fs::rename(&temp_path, path)
        .map_err(|error| format!("替换 capability draft registration summary 失败: {error}"))
}

fn read_registration_summary(path: &Path) -> Result<CapabilityDraftRegistrationSummary, String> {
    let content = fs::read_to_string(path)
        .map_err(|error| format!("读取 capability draft registration summary 失败: {error}"))?;
    serde_json::from_str(&content)
        .map_err(|error| format!("解析 capability draft registration summary 失败: {error}"))
}

fn to_record(draft_root: &Path, manifest: CapabilityDraftManifest) -> CapabilityDraftRecord {
    CapabilityDraftRecord {
        manifest,
        draft_root: draft_root.to_string_lossy().to_string(),
        manifest_path: draft_root
            .join(MANIFEST_FILE_NAME)
            .to_string_lossy()
            .to_string(),
    }
}

fn workspace_registered_skills_root(workspace_root: &Path) -> PathBuf {
    workspace_root
        .join(REGISTERED_SKILLS_ROOT_DIR_NAME)
        .join(REGISTERED_SKILLS_DIR_NAME)
}

fn skill_directory_for_draft(draft_id: &str) -> Result<String, String> {
    let normalized = validate_draft_id(draft_id)?;
    let suffix = normalized.strip_prefix("capdraft-").unwrap_or(&normalized);
    let short = suffix
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric())
        .take(12)
        .collect::<String>();
    if short.is_empty() {
        return Err("无法从 draftId 派生 Skill 目录名".to_string());
    }
    Ok(format!("capability-{short}"))
}

fn validate_agent_skill_standard(skill_dir: &Path) -> Result<(), String> {
    let inspection = SkillService::inspect_skill_dir(skill_dir)
        .map_err(|error| format!("Agent Skills 标准检查失败: {error}"))?;
    if inspection.standard_compliance.validation_errors.is_empty() {
        return Ok(());
    }
    Err(format!(
        "Agent Skills 标准检查未通过: {}",
        inspection.standard_compliance.validation_errors.join("；")
    ))
}

fn copy_registered_skill_files(
    draft_root: &Path,
    target_dir: &Path,
    manifest: &CapabilityDraftManifest,
) -> Result<(), String> {
    if let Some(parent) = target_dir.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("创建注册 Skill 根目录失败 {}: {error}", parent.display()))?;
    }
    fs::create_dir(target_dir).map_err(|error| {
        if error.kind() == std::io::ErrorKind::AlreadyExists {
            format!("Workspace Skill 目录已存在: {}", target_dir.display())
        } else {
            format!("创建注册 Skill 目录失败 {}: {error}", target_dir.display())
        }
    })?;

    for file in &manifest.generated_files {
        let relative_path = validate_relative_path(&file.relative_path)?;
        let source_path = draft_root.join(&relative_path);
        let target_path = target_dir.join(&relative_path);
        if !source_path.starts_with(draft_root) || !target_path.starts_with(target_dir) {
            return Err(format!("注册文件路径逃逸: {}", file.relative_path));
        }

        let metadata = fs::symlink_metadata(&source_path)
            .map_err(|error| format!("读取注册源文件失败 {}: {error}", file.relative_path))?;
        if metadata.file_type().is_symlink() {
            return Err(format!(
                "注册源文件不允许是 symlink: {}",
                file.relative_path
            ));
        }
        if !metadata.is_file() {
            return Err(format!("注册源路径不是文件: {}", file.relative_path));
        }

        if let Some(parent) = target_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("创建注册目标父目录失败 {}: {error}", parent.display()))?;
        }
        fs::copy(&source_path, &target_path).map_err(|error| {
            format!(
                "复制注册文件失败 {} -> {}: {error}",
                source_path.display(),
                target_path.display()
            )
        })?;
    }

    Ok(())
}

fn verification_check(
    id: &str,
    label: &str,
    passed: bool,
    message: impl Into<String>,
    suggestions: Vec<String>,
) -> CapabilityDraftVerificationCheck {
    verification_check_with_evidence(id, label, passed, message, suggestions, Vec::new())
}

fn verification_check_with_evidence(
    id: &str,
    label: &str,
    passed: bool,
    message: impl Into<String>,
    suggestions: Vec<String>,
    evidence: Vec<CapabilityDraftVerificationEvidence>,
) -> CapabilityDraftVerificationCheck {
    CapabilityDraftVerificationCheck {
        id: id.to_string(),
        label: label.to_string(),
        status: if passed {
            CapabilityDraftVerificationCheckStatus::Passed
        } else {
            CapabilityDraftVerificationCheckStatus::Failed
        },
        message: message.into(),
        suggestions,
        can_agent_repair: !passed,
        evidence,
    }
}

fn relative_path_matches(relative_path: &str, candidates: &[&str]) -> bool {
    candidates.iter().any(|candidate| {
        relative_path == *candidate || relative_path.ends_with(&format!("/{candidate}"))
    })
}

fn find_generated_file<'a>(
    manifest: &'a CapabilityDraftManifest,
    candidates: &[&str],
) -> Option<&'a CapabilityDraftFileSummary> {
    manifest
        .generated_files
        .iter()
        .find(|file| relative_path_matches(&file.relative_path, candidates))
}

fn read_generated_file_text(
    draft_root: &Path,
    file: &CapabilityDraftFileSummary,
) -> Result<String, String> {
    let relative_path = validate_relative_path(&file.relative_path)?;
    let path = draft_root.join(relative_path);
    if !path.starts_with(draft_root) {
        return Err(format!(
            "生成文件路径逃逸 draft root: {}",
            file.relative_path
        ));
    }
    fs::read_to_string(&path).map_err(|error| format!("读取 {} 失败: {error}", file.relative_path))
}

fn validate_manifest_file_integrity(
    draft_root: &Path,
    manifest: &CapabilityDraftManifest,
) -> Result<(), Vec<String>> {
    let mut issues = Vec::new();
    let mut seen = HashSet::new();

    for file in &manifest.generated_files {
        let relative_path = match validate_relative_path(&file.relative_path) {
            Ok(path) => path,
            Err(error) => {
                issues.push(error);
                continue;
            }
        };
        if !seen.insert(file.relative_path.clone()) {
            issues.push(format!("文件清单重复: {}", file.relative_path));
        }
        let path = draft_root.join(relative_path);
        if !path.starts_with(draft_root) {
            issues.push(format!("文件清单路径逃逸: {}", file.relative_path));
            continue;
        }
        let content = match fs::read_to_string(&path) {
            Ok(content) => content,
            Err(error) => {
                issues.push(format!("读取 {} 失败: {error}", file.relative_path));
                continue;
            }
        };
        let byte_length = content.as_bytes().len();
        if byte_length != file.byte_length {
            issues.push(format!(
                "{} 字节数不一致，manifest={} actual={}",
                file.relative_path, file.byte_length, byte_length
            ));
        }
        let sha256 = sha256_hex(&content);
        if sha256 != file.sha256 {
            issues.push(format!("{} sha256 不一致", file.relative_path));
        }
    }

    if issues.is_empty() {
        Ok(())
    } else {
        Err(issues)
    }
}

fn permission_text(manifest: &CapabilityDraftManifest) -> String {
    manifest
        .permission_summary
        .iter()
        .map(|item| item.to_lowercase())
        .collect::<Vec<_>>()
        .join("\n")
}

fn permission_declares_local_cli(permission_text: &str) -> bool {
    [
        "cli",
        "local command",
        "local cli",
        "本地命令",
        "本地 cli",
        "命令",
    ]
    .iter()
    .any(|needle| permission_text.contains(needle))
}

fn permission_declares_readonly_http(permission_text: &str) -> bool {
    [
        "http",
        "api",
        "network",
        "联网",
        "网络",
        "公开 api",
        "只读 api",
        "只读 http",
        "read-only api",
        "read only api",
        "read-only http",
        "read only http",
    ]
    .iter()
    .any(|needle| permission_text.contains(needle))
}

fn file_mentions_readonly_http(content: &str) -> bool {
    let lower = content.to_lowercase();
    [
        "fetch(",
        "axios.get",
        "method: \"get\"",
        "method: 'get'",
        "http://",
        "https://",
    ]
    .iter()
    .any(|token| lower.contains(token))
}

fn manifest_mentions_readonly_http(
    draft_root: &Path,
    manifest: &CapabilityDraftManifest,
) -> Result<bool, Vec<String>> {
    let mut issues = Vec::new();
    let mut found = manifest.source_kind.eq_ignore_ascii_case("api")
        || manifest
            .source_refs
            .iter()
            .any(|source| file_mentions_readonly_http(source));

    for file in &manifest.generated_files {
        match read_generated_file_text(draft_root, file) {
            Ok(content) => {
                if file_mentions_readonly_http(&content) {
                    found = true;
                }
            }
            Err(error) => issues.push(error),
        }
    }

    if issues.is_empty() {
        Ok(found)
    } else {
        Err(issues)
    }
}

fn generated_file_contains_any(
    draft_root: &Path,
    manifest: &CapabilityDraftManifest,
    path_needles: &[&str],
    content_needles: &[&str],
) -> Result<bool, Vec<String>> {
    let mut issues = Vec::new();
    let mut found = false;

    for file in &manifest.generated_files {
        let relative_path = file.relative_path.to_lowercase();
        let should_scan_content = path_needles
            .iter()
            .any(|needle| relative_path.contains(needle));

        if should_scan_content {
            match read_generated_file_text(draft_root, file) {
                Ok(content) => {
                    let lower = content.to_lowercase();
                    if content_needles.iter().any(|needle| lower.contains(needle)) {
                        found = true;
                    }
                }
                Err(error) => issues.push(error),
            }
        }
    }

    if issues.is_empty() {
        Ok(found)
    } else {
        Err(issues)
    }
}

fn generated_file_has_secret_header_or_token(
    draft_root: &Path,
    manifest: &CapabilityDraftManifest,
) -> Result<bool, Vec<String>> {
    generated_file_contains_any(
        draft_root,
        manifest,
        &[
            "script", "src", "adapter", "contract", "example", "test", "policy", "policies",
        ],
        &[
            "authorization",
            "bearer ",
            "x-api-key",
            "api_key",
            "apikey",
            "access_token",
            "client_secret",
            "secret_key",
        ],
    )
}

fn generated_file_has_readonly_http_session_authorization(
    draft_root: &Path,
    manifest: &CapabilityDraftManifest,
) -> Result<bool, Vec<String>> {
    let mut issues = Vec::new();
    let mut found = false;

    for file in &manifest.generated_files {
        let relative_path = file.relative_path.to_lowercase();
        let is_policy_file = (relative_path.starts_with("policy/")
            || relative_path.starts_with("policies/")
            || relative_path.starts_with("runtime/")
            || relative_path.starts_with("config/"))
            && (relative_path.contains("authorization")
                || relative_path.contains("auth")
                || relative_path.contains("policy")
                || relative_path.contains("permission")
                || relative_path.contains("session"));

        if !is_policy_file {
            continue;
        }

        match read_generated_file_text(draft_root, file) {
            Ok(content) => {
                let lower = content.to_lowercase();
                let declares_session =
                    lower.contains("session") || lower.contains("manual") || lower.contains("user");
                let declares_readonly = lower.contains("read-only")
                    || lower.contains("readonly")
                    || lower.contains("read only")
                    || lower.contains("只读");
                let declares_http_get =
                    lower.contains("get") || lower.contains("http") || lower.contains("api");
                let declares_evidence = lower.contains("evidence")
                    || lower.contains("audit")
                    || lower.contains("审计")
                    || lower.contains("证据");

                if declares_session && declares_readonly && declares_http_get && declares_evidence {
                    found = true;
                }
            }
            Err(error) => issues.push(error),
        }
    }

    if issues.is_empty() {
        Ok(found)
    } else {
        Err(issues)
    }
}

fn generated_file_has_readonly_http_credential_reference(
    draft_root: &Path,
    manifest: &CapabilityDraftManifest,
) -> Result<bool, Vec<String>> {
    let mut issues = Vec::new();
    let mut found = false;

    for file in &manifest.generated_files {
        let relative_path = file.relative_path.to_lowercase();
        let is_policy_file = (relative_path.starts_with("policy/")
            || relative_path.starts_with("policies/")
            || relative_path.starts_with("runtime/")
            || relative_path.starts_with("config/"))
            && (relative_path.contains("credential")
                || relative_path.contains("policy")
                || relative_path.contains("session"));

        if !is_policy_file {
            continue;
        }

        match read_generated_file_text(draft_root, file) {
            Ok(content) => {
                let lower = content.to_lowercase();
                let declares_reference = lower.contains("credential_reference")
                    || lower.contains("credential reference")
                    || lower.contains("credentialref")
                    || lower.contains("凭证引用");
                let declares_session_source = lower.contains("user_session_config")
                    || lower.contains("session_config")
                    || lower.contains("session credential")
                    || lower.contains("session credential reference")
                    || lower.contains("用户会话");

                if declares_reference && declares_session_source {
                    found = true;
                }
            }
            Err(error) => issues.push(error),
        }
    }

    if issues.is_empty() {
        Ok(found)
    } else {
        Err(issues)
    }
}

fn generated_file_has_readonly_http_execution_preflight(
    draft_root: &Path,
    manifest: &CapabilityDraftManifest,
) -> Result<bool, Vec<String>> {
    let mut issues = Vec::new();
    let mut found = false;

    for file in &manifest.generated_files {
        let relative_path = file.relative_path.to_lowercase();
        let is_policy_file = (relative_path.starts_with("policy/")
            || relative_path.starts_with("policies/")
            || relative_path.starts_with("runtime/")
            || relative_path.starts_with("config/"))
            && (relative_path.contains("preflight")
                || relative_path.contains("policy")
                || relative_path.contains("session"));

        if !is_policy_file {
            continue;
        }

        match read_generated_file_text(draft_root, file) {
            Ok(content) => {
                let lower = content.to_lowercase();
                let declares_preflight = lower.contains("execution_preflight")
                    || lower.contains("preflight")
                    || lower.contains("execution plan")
                    || lower.contains("approval_request")
                    || lower.contains("执行前检查");
                let declares_endpoint = lower.contains("endpoint")
                    || lower.contains("request_url")
                    || lower.contains("url");
                let declares_get = lower.contains("get") || lower.contains("allowed_methods");
                let declares_credential_reference = lower.contains("credential_reference")
                    || lower.contains("credential reference")
                    || lower.contains("凭证引用");
                let declares_evidence_schema = lower.contains("evidence_schema")
                    || lower.contains("request_url_hash")
                    || lower.contains("response_sha256")
                    || lower.contains("证据 schema");

                if declares_preflight
                    && declares_endpoint
                    && declares_get
                    && declares_credential_reference
                    && declares_evidence_schema
                {
                    found = true;
                }
            }
            Err(error) => issues.push(error),
        }
    }

    if issues.is_empty() {
        Ok(found)
    } else {
        Err(issues)
    }
}

fn generated_file_has_fixture_dry_run_entry(
    draft_root: &Path,
    manifest: &CapabilityDraftManifest,
) -> Result<bool, Vec<String>> {
    let mut issues = Vec::new();
    let mut found = false;

    for file in &manifest.generated_files {
        let relative_path = file.relative_path.to_lowercase();
        if relative_path.starts_with("scripts/")
            && (relative_path.contains("dry-run") || relative_path.contains("dryrun"))
        {
            found = true;
        }
        if relative_path.starts_with("tests/")
            && (relative_path.contains("dry-run")
                || relative_path.contains("dryrun")
                || relative_path.contains(".test."))
        {
            found = true;
        }
        if relative_path == "package.json" {
            match read_generated_file_text(draft_root, file) {
                Ok(content) => {
                    let lower = content.to_lowercase();
                    if lower.contains("dry-run") || lower.contains("dryrun") {
                        found = true;
                    }
                }
                Err(error) => issues.push(error),
            }
        }
    }

    if issues.is_empty() {
        Ok(found)
    } else {
        Err(issues)
    }
}

fn generated_file_fixture_dry_run_entry_has_network_access(
    draft_root: &Path,
    manifest: &CapabilityDraftManifest,
) -> Result<bool, Vec<String>> {
    let mut issues = Vec::new();
    let mut found = false;

    for file in &manifest.generated_files {
        let relative_path = file.relative_path.to_lowercase();
        let is_dry_run_file = (relative_path.starts_with("scripts/")
            && (relative_path.contains("dry-run") || relative_path.contains("dryrun")))
            || (relative_path.starts_with("tests/")
                && (relative_path.contains("dry-run")
                    || relative_path.contains("dryrun")
                    || relative_path.contains(".test.")));

        if is_dry_run_file || relative_path == "package.json" {
            match read_generated_file_text(draft_root, file) {
                Ok(content) => {
                    let lower = content.to_lowercase();
                    let package_declares_dry_run = relative_path == "package.json"
                        && (lower.contains("dry-run") || lower.contains("dryrun"));
                    if (is_dry_run_file || package_declares_dry_run)
                        && file_mentions_readonly_http(&lower)
                    {
                        found = true;
                    }
                }
                Err(error) => issues.push(error),
            }
        }
    }

    if issues.is_empty() {
        Ok(found)
    } else {
        Err(issues)
    }
}

fn generated_file_fixture_dry_run_references_expected_output(
    draft_root: &Path,
    manifest: &CapabilityDraftManifest,
) -> Result<bool, Vec<String>> {
    let mut issues = Vec::new();
    let mut found = false;

    for file in &manifest.generated_files {
        let relative_path = file.relative_path.to_lowercase();
        let is_dry_run_file = (relative_path.starts_with("scripts/")
            && (relative_path.contains("dry-run") || relative_path.contains("dryrun")))
            || (relative_path.starts_with("tests/")
                && (relative_path.contains("dry-run")
                    || relative_path.contains("dryrun")
                    || relative_path.contains(".test.")));

        if is_dry_run_file || relative_path == "package.json" {
            match read_generated_file_text(draft_root, file) {
                Ok(content) => {
                    let lower = content.to_lowercase();
                    let package_declares_dry_run = relative_path == "package.json"
                        && (lower.contains("dry-run") || lower.contains("dryrun"));
                    if (is_dry_run_file || package_declares_dry_run)
                        && (lower.contains("expected-output")
                            || lower.contains("expected_output")
                            || lower.contains("expectedoutput")
                            || lower.contains("tests/expected")
                            || lower.contains("expected output")
                            || lower.contains("const expected")
                            || lower.contains("let expected")
                            || lower.contains("var expected"))
                    {
                        found = true;
                    }
                }
                Err(error) => issues.push(error),
            }
        }
    }

    if issues.is_empty() {
        Ok(found)
    } else {
        Err(issues)
    }
}

fn find_fixture_dry_run_script_file<'a>(
    manifest: &'a CapabilityDraftManifest,
) -> Option<&'a CapabilityDraftFileSummary> {
    manifest.generated_files.iter().find(|file| {
        let relative_path = file.relative_path.to_lowercase();
        relative_path.starts_with("scripts/")
            && (relative_path.contains("dry-run") || relative_path.contains("dryrun"))
            && (relative_path.ends_with(".mjs") || relative_path.ends_with(".js"))
    })
}

fn find_expected_output_file<'a>(
    manifest: &'a CapabilityDraftManifest,
) -> Option<&'a CapabilityDraftFileSummary> {
    manifest.generated_files.iter().find(|file| {
        let relative_path = file.relative_path.to_lowercase();
        relative_path.starts_with("tests/")
            && (relative_path.contains("expected") || relative_path.contains("output"))
    })
}

fn clip_dry_run_message(message: &str) -> String {
    let normalized = message.replace('\r', "").trim().to_string();
    if normalized.chars().count() <= MAX_DRY_RUN_MESSAGE_CHARS {
        return normalized;
    }
    let clipped = normalized
        .chars()
        .take(MAX_DRY_RUN_MESSAGE_CHARS)
        .collect::<String>();
    format!("{clipped}...")
}

fn verification_evidence(
    key: impl Into<String>,
    value: impl Into<String>,
) -> CapabilityDraftVerificationEvidence {
    CapabilityDraftVerificationEvidence {
        key: key.into(),
        value: value.into(),
    }
}

fn readonly_http_execution_preflight_evidence() -> Vec<CapabilityDraftVerificationEvidence> {
    vec![
        verification_evidence("preflightMode", "approval_request"),
        verification_evidence("endpointSource", "runtime_input"),
        verification_evidence("method", "GET"),
        verification_evidence("credentialReferenceId", "readonly_api_session"),
        verification_evidence(
            "evidenceSchema",
            "request_url_hash,request_method,response_status,response_sha256,executed_at",
        ),
        verification_evidence("policyPath", "policy/readonly-http-session.json"),
    ]
}

fn collect_registration_verification_gates(
    report: &CapabilityDraftVerificationReport,
) -> Vec<CapabilityDraftRegistrationVerificationGate> {
    report
        .checks
        .iter()
        .filter(|check| {
            check.status == CapabilityDraftVerificationCheckStatus::Passed
                && check.id == "readonly_http_execution_preflight"
                && !check.evidence.is_empty()
        })
        .map(|check| CapabilityDraftRegistrationVerificationGate {
            check_id: check.id.clone(),
            label: check.label.clone(),
            evidence: check.evidence.clone(),
        })
        .collect()
}

fn registration_gate_evidence_value(
    gate: &CapabilityDraftRegistrationVerificationGate,
    key: &str,
) -> Option<String> {
    gate.evidence
        .iter()
        .find(|evidence| evidence.key == key)
        .map(|evidence| evidence.value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn split_evidence_schema(value: &str) -> Vec<String> {
    value
        .split(',')
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(ToString::to_string)
        .collect()
}

fn readonly_http_approval_consumption_gate(
    endpoint_source: &str,
    credential_reference_id: &str,
) -> CapabilityDraftRegistrationApprovalConsumptionGate {
    let mut required_inputs = vec!["session_user_approval".to_string()];
    if endpoint_source == "runtime_input" {
        required_inputs.push("runtime_endpoint_input".to_string());
    }
    required_inputs.push(format!("credential_reference:{credential_reference_id}"));
    required_inputs.push("evidence_capture".to_string());

    CapabilityDraftRegistrationApprovalConsumptionGate {
        status: CapabilityDraftApprovalConsumptionStatus::AwaitingSessionApproval,
        required_inputs,
        runtime_execution_enabled: false,
        credential_storage_enabled: false,
        blocked_reason: "等待当前 session 显式授权；本阶段不执行真实 HTTP，也不保存凭证。"
            .to_string(),
        next_action: "先消费 approval request artifact 并解析 session-scoped 输入，之后才能进入受控 GET 执行门禁。"
            .to_string(),
    }
}

fn readonly_http_credential_resolver_projection(
    credential_reference_id: &str,
) -> CapabilityDraftRegistrationCredentialResolver {
    CapabilityDraftRegistrationCredentialResolver {
        status: CapabilityDraftCredentialResolverStatus::AwaitingSessionCredential,
        reference_id: credential_reference_id.to_string(),
        scope: "session".to_string(),
        source: "user_session_config".to_string(),
        secret_material_status: "not_requested".to_string(),
        token_persisted: false,
        runtime_injection_enabled: false,
        blocked_reason: "等待当前 session 提供或确认凭证引用；本阶段不读取、不保存 token。"
            .to_string(),
        next_action:
            "后续只能在 session scope 内解析该 reference，并把解析结果直接交给受控 GET 门禁。"
                .to_string(),
    }
}

fn readonly_http_approval_consumption_input_schema(
    endpoint_source: &str,
    credential_reference_id: &str,
) -> CapabilityDraftApprovalConsumptionInputSchema {
    let mut fields = vec![CapabilityDraftApprovalConsumptionInputField {
        key: "session_user_approval".to_string(),
        label: "Session 授权确认".to_string(),
        kind: "boolean_confirmation".to_string(),
        required: true,
        source: "user_confirmation".to_string(),
        secret: false,
        description: "用户必须在当前 session 明确确认本次只读 API 授权。".to_string(),
    }];

    if endpoint_source == "runtime_input" {
        fields.push(CapabilityDraftApprovalConsumptionInputField {
            key: "runtime_endpoint_input".to_string(),
            label: "运行时 Endpoint".to_string(),
            kind: "url".to_string(),
            required: true,
            source: "runtime_input".to_string(),
            secret: false,
            description: "当前阶段只收集 endpoint 输入合同，不保存明文 URL 到注册包。".to_string(),
        });
    }

    fields.push(CapabilityDraftApprovalConsumptionInputField {
        key: "credential_reference_confirmation".to_string(),
        label: "凭证引用确认".to_string(),
        kind: "credential_reference".to_string(),
        required: true,
        source: "user_session_config".to_string(),
        secret: false,
        description: format!(
            "确认后续只解析 session 凭证引用 {credential_reference_id}，不收集 token 明文。"
        ),
    });
    fields.push(CapabilityDraftApprovalConsumptionInputField {
        key: "evidence_capture_consent".to_string(),
        label: "Evidence 捕获确认".to_string(),
        kind: "boolean_confirmation".to_string(),
        required: true,
        source: "user_confirmation".to_string(),
        secret: false,
        description: "用户确认后续受控 GET 需要写入 request / response evidence。".to_string(),
    });

    CapabilityDraftApprovalConsumptionInputSchema {
        schema_id: "readonly_http_session_approval_v1".to_string(),
        version: 1,
        fields,
        ui_submission_enabled: false,
        runtime_execution_enabled: false,
        blocked_reason: "当前只定义 session 授权输入合同，尚未开放提交、凭证解析或真实 HTTP 执行。"
            .to_string(),
    }
}

fn readonly_http_approval_session_input_intake(
    input_schema: &CapabilityDraftApprovalConsumptionInputSchema,
    credential_reference_id: &str,
) -> CapabilityDraftApprovalConsumptionSessionIntake {
    let required_field_keys: Vec<String> = input_schema
        .fields
        .iter()
        .filter(|field| field.required)
        .map(|field| field.key.clone())
        .collect();

    CapabilityDraftApprovalConsumptionSessionIntake {
        status: CapabilityDraftApprovalConsumptionSessionIntakeStatus::AwaitingSessionInputs,
        schema_id: input_schema.schema_id.clone(),
        scope: "session".to_string(),
        missing_field_keys: required_field_keys.clone(),
        required_field_keys,
        collected_field_keys: Vec::new(),
        credential_reference_id: credential_reference_id.to_string(),
        endpoint_input_persisted: false,
        secret_material_status: "not_collected".to_string(),
        token_persisted: false,
        ui_submission_enabled: false,
        runtime_execution_enabled: false,
        blocked_reason:
            "已声明当前 session 输入槽位，但尚未接入提交处理、凭证解析或真实 HTTP 执行。"
                .to_string(),
        next_action: "后续只允许在当前 session 收集一次性授权输入，再进入受控 GET 执行门禁。"
            .to_string(),
    }
}

fn readonly_http_session_submission_validation_rule(
    field: &CapabilityDraftApprovalConsumptionInputField,
) -> String {
    match field.key.as_str() {
        "session_user_approval" | "evidence_capture_consent" => {
            "必须为显式 true，用于当前 session 单次授权。".to_string()
        }
        "runtime_endpoint_input" => {
            "必须是 http/https URL；只允许作为当前 session 临时输入，不写入注册包。".to_string()
        }
        "credential_reference_confirmation" => {
            "必须匹配 approval request 的 credentialReferenceId；不接收 token 明文。".to_string()
        }
        _ => "必须满足对应 input schema 的字段类型与来源约束。".to_string(),
    }
}

fn readonly_http_approval_session_submission_contract(
    input_schema: &CapabilityDraftApprovalConsumptionInputSchema,
) -> CapabilityDraftApprovalSessionSubmissionContract {
    let accepted_field_keys: Vec<String> = input_schema
        .fields
        .iter()
        .filter(|field| field.required)
        .map(|field| field.key.clone())
        .collect();
    let validation_rules = input_schema
        .fields
        .iter()
        .filter(|field| field.required)
        .map(
            |field| CapabilityDraftApprovalSessionSubmissionValidationRule {
                field_key: field.key.clone(),
                kind: field.kind.clone(),
                required: field.required,
                source: field.source.clone(),
                secret_allowed: field.secret,
                rule: readonly_http_session_submission_validation_rule(field),
            },
        )
        .collect();

    CapabilityDraftApprovalSessionSubmissionContract {
        status: CapabilityDraftApprovalSessionSubmissionStatus::SubmissionContractDeclared,
        scope: "session".to_string(),
        mode: "one_time_session_submission".to_string(),
        accepted_field_keys,
        validation_rules,
        value_retention: "none".to_string(),
        endpoint_input_persisted: false,
        secret_material_accepted: false,
        token_persisted: false,
        evidence_capture_required: true,
        submission_handler_enabled: true,
        ui_submission_enabled: false,
        runtime_execution_enabled: false,
        blocked_reason:
            "已开放 session-scoped 输入校验 handler；本阶段仍不解析凭证、不执行真实 HTTP。"
                .to_string(),
        next_action: "后续可先提交一次性 session 输入做校验；校验通过后仍只进入受控 GET 执行门禁。"
            .to_string(),
    }
}

fn collect_registration_approval_requests(
    registration_id: &str,
    registered_at: &str,
    skill_directory: &str,
    verification_gates: &[CapabilityDraftRegistrationVerificationGate],
) -> Vec<CapabilityDraftRegistrationApprovalRequest> {
    verification_gates
        .iter()
        .filter(|gate| gate.check_id == "readonly_http_execution_preflight")
        .filter_map(|gate| {
            let endpoint_source = registration_gate_evidence_value(gate, "endpointSource")?;
            let method = registration_gate_evidence_value(gate, "method")?;
            let credential_reference_id =
                registration_gate_evidence_value(gate, "credentialReferenceId")?;
            let evidence_schema = registration_gate_evidence_value(gate, "evidenceSchema")
                .map(|value| split_evidence_schema(&value))
                .unwrap_or_default();
            let policy_path = registration_gate_evidence_value(gate, "policyPath")?;

            if method != "GET" || evidence_schema.is_empty() {
                return None;
            }

            let consumption_gate =
                readonly_http_approval_consumption_gate(&endpoint_source, &credential_reference_id);
            let credential_resolver =
                readonly_http_credential_resolver_projection(&credential_reference_id);
            let consumption_input_schema = readonly_http_approval_consumption_input_schema(
                &endpoint_source,
                &credential_reference_id,
            );
            let session_input_intake = readonly_http_approval_session_input_intake(
                &consumption_input_schema,
                &credential_reference_id,
            );
            let session_input_submission_contract =
                readonly_http_approval_session_submission_contract(&consumption_input_schema);

            Some(CapabilityDraftRegistrationApprovalRequest {
                approval_id: format!("{registration_id}:readonly-http-session"),
                status: CapabilityDraftApprovalRequestStatus::Pending,
                source_check_id: gate.check_id.clone(),
                skill_directory: skill_directory.to_string(),
                endpoint_source,
                method,
                credential_reference_id,
                evidence_schema,
                policy_path,
                created_at: registered_at.to_string(),
                consumption_gate,
                credential_resolver,
                consumption_input_schema,
                session_input_intake,
                session_input_submission_contract,
            })
        })
        .collect()
}

fn dry_run_entry_contains_unsafe_execution_tokens(content: &str) -> bool {
    let lower = content.to_lowercase();
    [
        "child_process",
        "exec(",
        "execsync",
        "spawn(",
        "spawnsync",
        "writefile(",
        "writefilesync",
        "appendfile(",
        "appendfilesync",
        "unlink(",
        "unlinksync",
        "rm(",
        "rmsync",
        "rmdir(",
        "rmdirsync",
        "process.env",
        "node:http",
        "node:https",
        "require('http')",
        "require(\"http\")",
        "require('https')",
        "require(\"https\")",
        "from 'http'",
        "from \"http\"",
        "from 'https'",
        "from \"https\"",
    ]
    .iter()
    .any(|needle| lower.contains(needle))
}

fn run_command_with_timeout(
    command: &mut Command,
    timeout: Duration,
) -> Result<TimedCommandOutput, String> {
    let mut child = command
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("启动 fixture dry-run 失败: {error}"))?;
    let started_at = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_status)) => {
                let duration_ms = started_at.elapsed().as_millis();
                let output = child
                    .wait_with_output()
                    .map_err(|error| format!("读取 fixture dry-run 输出失败: {error}"))?;
                return Ok(TimedCommandOutput {
                    output,
                    duration_ms,
                });
            }
            Ok(None) => {
                if started_at.elapsed() >= timeout {
                    let _ = child.kill();
                    let output = child
                        .wait_with_output()
                        .map_err(|error| format!("停止超时 fixture dry-run 失败: {error}"))?;
                    let stderr = String::from_utf8_lossy(&output.stderr);
                    return Err(format!(
                        "fixture dry-run 超过 {}ms 未完成{}",
                        timeout.as_millis(),
                        if stderr.trim().is_empty() {
                            String::new()
                        } else {
                            format!("；stderr={}", clip_dry_run_message(&stderr))
                        }
                    ));
                }
                thread::sleep(Duration::from_millis(25));
            }
            Err(error) => return Err(format!("等待 fixture dry-run 失败: {error}")),
        }
    }
}

fn parse_json_from_stdout(stdout: &str) -> Result<serde_json::Value, String> {
    if let Ok(value) = serde_json::from_str::<serde_json::Value>(stdout.trim()) {
        return Ok(value);
    }
    let last_line = stdout
        .lines()
        .rev()
        .find(|line| !line.trim().is_empty())
        .ok_or_else(|| "fixture dry-run 没有 stdout 输出".to_string())?;
    serde_json::from_str::<serde_json::Value>(last_line.trim()).map_err(|error| {
        format!(
            "fixture dry-run stdout 不是可解析 JSON: {error}；stdout={}",
            clip_dry_run_message(stdout)
        )
    })
}

fn compare_dry_run_output(
    actual_stdout: &str,
    expected_content: &str,
    expected_relative_path: &str,
) -> Result<(String, String), String> {
    if expected_relative_path.to_lowercase().ends_with(".json") {
        let expected =
            serde_json::from_str::<serde_json::Value>(expected_content).map_err(|error| {
                format!("expected output JSON 无法解析: {expected_relative_path}: {error}")
            })?;
        let actual = parse_json_from_stdout(actual_stdout)?;
        if actual == expected {
            let actual_canonical = serde_json::to_string(&actual)
                .map_err(|error| format!("序列化 actual JSON 失败: {error}"))?;
            let expected_canonical = serde_json::to_string(&expected)
                .map_err(|error| format!("序列化 expected JSON 失败: {error}"))?;
            return Ok((actual_canonical, expected_canonical));
        }
        return Err(format!(
            "fixture dry-run actual 与 expected output 不一致；actual={} expected={}",
            clip_dry_run_message(&actual.to_string()),
            clip_dry_run_message(&expected.to_string())
        ));
    }

    let actual = actual_stdout.trim();
    let expected = expected_content.trim();
    if actual == expected {
        Ok((actual.to_string(), expected.to_string()))
    } else {
        Err(format!(
            "fixture dry-run actual 与 expected output 不一致；actual={} expected={}",
            clip_dry_run_message(actual),
            clip_dry_run_message(expected)
        ))
    }
}

fn execute_readonly_http_fixture_dry_run(
    draft_root: &Path,
    manifest: &CapabilityDraftManifest,
) -> Result<FixtureDryRunExecutionResult, String> {
    let script = find_fixture_dry_run_script_file(manifest).ok_or_else(|| {
        "缺少可执行的 scripts/dry-run.mjs 或 scripts/dry-run.js；当前 execution gate 不执行 package.json 或测试框架入口。"
            .to_string()
    })?;
    let expected_file = find_expected_output_file(manifest).ok_or_else(|| {
        "缺少 tests/expected-output.json 或等价 expected output 文件。".to_string()
    })?;
    let script_content = read_generated_file_text(draft_root, script)?;
    if dry_run_entry_contains_unsafe_execution_tokens(&script_content) {
        return Err(
            "fixture dry-run 入口包含 child_process、文件写入、环境变量读取或底层网络模块等不安全 token，已拒绝执行。"
                .to_string(),
        );
    }

    let script_path = draft_root.join(validate_relative_path(&script.relative_path)?);
    if !script_path.starts_with(draft_root) || !script_path.is_file() {
        return Err(format!(
            "fixture dry-run 脚本路径无效: {}",
            script.relative_path
        ));
    }
    let expected_content = read_generated_file_text(draft_root, expected_file)?;
    let mut command = Command::new("node");
    command
        .arg(&script.relative_path)
        .current_dir(draft_root)
        .env_clear()
        .env("NO_COLOR", "1");
    if let Ok(path) = std::env::var("PATH") {
        command.env("PATH", path);
    }
    #[cfg(windows)]
    {
        for key in ["PATHEXT", "SystemRoot", "WINDIR"] {
            if let Ok(value) = std::env::var(key) {
                command.env(key, value);
            }
        }
    }
    let timed_output = run_command_with_timeout(
        &mut command,
        Duration::from_millis(FIXTURE_DRY_RUN_TIMEOUT_MS),
    )?;
    let output = timed_output.output;
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    if !output.status.success() {
        return Err(format!(
            "fixture dry-run 退出码非 0: {}{}",
            output.status,
            if stderr.trim().is_empty() {
                String::new()
            } else {
                format!("；stderr={}", clip_dry_run_message(&stderr))
            }
        ));
    }
    let (actual_canonical, expected_canonical) =
        compare_dry_run_output(&stdout, &expected_content, &expected_file.relative_path)?;
    Ok(FixtureDryRunExecutionResult {
        message: format!(
            "fixture dry-run 已离线执行，{} 输出与 {} 一致。",
            script.relative_path, expected_file.relative_path
        ),
        evidence: vec![
            verification_evidence("scriptPath", script.relative_path.clone()),
            verification_evidence("expectedOutputPath", expected_file.relative_path.clone()),
            verification_evidence("durationMs", timed_output.duration_ms.to_string()),
            verification_evidence("exitStatus", output.status.to_string()),
            verification_evidence("actualSha256", sha256_hex(&actual_canonical)),
            verification_evidence("expectedSha256", sha256_hex(&expected_canonical)),
            verification_evidence("stdoutPreview", clip_dry_run_message(&stdout)),
        ],
    })
}

fn scan_static_risks(
    draft_root: &Path,
    manifest: &CapabilityDraftManifest,
) -> Result<(), Vec<String>> {
    let permissions = permission_text(manifest);
    let local_cli_declared = permission_declares_local_cli(&permissions);
    let readonly_http_declared = permission_declares_readonly_http(&permissions);
    let mut issues = Vec::new();

    for file in &manifest.generated_files {
        let content = match read_generated_file_text(draft_root, file) {
            Ok(content) => content,
            Err(error) => {
                issues.push(error);
                continue;
            }
        };
        let lower = content.to_lowercase();
        let path = &file.relative_path;

        for token in [
            "rm -rf",
            "fs.rm(",
            "fs.rmsync(",
            "unlink(",
            "remove_file",
            "deleteobject",
        ] {
            if lower.contains(token) {
                issues.push(format!("{path} 命中删除类危险 token: {token}"));
            }
        }

        for token in [
            "npm install",
            "pnpm add",
            "yarn add",
            "pip install",
            "cargo add",
        ] {
            if lower.contains(token) {
                issues.push(format!("{path} 命中依赖安装 token: {token}"));
            }
        }

        for token in [
            "child_process.exec",
            "execsync(",
            "shell: true",
            "curl -x post",
            "curl -x put",
            "curl -x patch",
            "curl -x delete",
            "method: \"post\"",
            "method: 'post'",
            "method: \"put\"",
            "method: 'put'",
            "method: \"patch\"",
            "method: 'patch'",
            "method: \"delete\"",
            "method: 'delete'",
            "axios.post",
            "axios.put",
            "axios.patch",
            "axios.delete",
        ] {
            if lower.contains(token) {
                issues.push(format!("{path} 命中外部写 / shell 字符串 token: {token}"));
            }
        }

        for token in [
            "payment",
            "charge",
            "place_order",
            "create_order",
            "create_listing",
            "publish_listing",
            "update_price",
        ] {
            if lower.contains(token) {
                issues.push(format!("{path} 命中高风险业务动作 token: {token}"));
            }
        }

        let declares_cli_token = [
            "child_process.spawn",
            "spawn(",
            "execfile(",
            "std::process::command",
            "command::new",
        ]
        .iter()
        .any(|token| lower.contains(token));

        if declares_cli_token && !local_cli_declared {
            issues.push(format!(
                "{path} 出现本地 CLI 执行，但 permissionSummary 未声明本地命令权限"
            ));
        }

        let declares_readonly_http_token = file_mentions_readonly_http(&lower);

        if declares_readonly_http_token && !readonly_http_declared {
            issues.push(format!(
                "{path} 出现只读 HTTP / API 访问，但 permissionSummary 未声明网络只读权限"
            ));
        }
    }

    if issues.is_empty() {
        Ok(())
    } else {
        Err(issues)
    }
}

fn run_capability_draft_static_checks(
    draft_root: &Path,
    manifest: &CapabilityDraftManifest,
) -> Vec<CapabilityDraftVerificationCheck> {
    let mut checks = Vec::new();
    let skill_file = find_generated_file(manifest, &["SKILL.md"]);

    match validate_manifest_file_integrity(draft_root, manifest) {
        Ok(()) if skill_file.is_some() => checks.push(verification_check(
            "package_structure",
            "包结构",
            true,
            "manifest 文件清单与磁盘一致，且包含 SKILL.md。",
            Vec::new(),
        )),
        Ok(()) => checks.push(verification_check(
            "package_structure",
            "包结构",
            false,
            "文件清单缺少 SKILL.md。",
            vec!["补齐 SKILL.md，并确保它进入 generatedFiles 清单。".to_string()],
        )),
        Err(issues) => checks.push(verification_check(
            "package_structure",
            "包结构",
            false,
            issues.join("；"),
            vec![
                "重新生成或修复 manifest 文件清单，确保路径、字节数和 sha256 与磁盘一致。"
                    .to_string(),
            ],
        )),
    }

    let skill_quality = skill_file
        .and_then(|file| read_generated_file_text(draft_root, file).ok())
        .map(|content| {
            let trimmed = content.trim();
            trimmed.chars().count() >= MIN_SKILL_MD_CHARS
                && (trimmed.contains("##")
                    || trimmed.contains("步骤")
                    || trimmed.contains("输入")
                    || trimmed.contains("输出")
                    || trimmed.to_lowercase().contains("when"))
        })
        .unwrap_or(false);
    checks.push(verification_check(
        "skill_readme_quality",
        "Skill 说明质量",
        skill_quality,
        if skill_quality {
            "SKILL.md 包含基本说明，可供后续人工复核。"
        } else {
            "SKILL.md 过短或缺少输入、输出、步骤、触发条件等可读说明。"
        },
        vec!["补齐触发条件、输入、执行步骤、输出、失败回退和权限边界。".to_string()],
    ));

    let has_input_contract = find_generated_file(
        manifest,
        &[
            "contract/input.schema.json",
            "contracts/input.schema.json",
            "input.schema.json",
            "input.schema.yaml",
            "input.schema.yml",
        ],
    )
    .is_some();
    checks.push(verification_check(
        "input_contract",
        "输入 contract",
        has_input_contract,
        if has_input_contract {
            "已找到输入 contract。"
        } else {
            "缺少输入 contract。"
        },
        vec!["新增 contract/input.schema.json，描述必填输入、类型和约束。".to_string()],
    ));

    let has_output_contract = find_generated_file(
        manifest,
        &[
            "contract/output.schema.json",
            "contracts/output.schema.json",
            "output.schema.json",
            "output.schema.yaml",
            "output.schema.yml",
        ],
    )
    .is_some();
    checks.push(verification_check(
        "output_contract",
        "输出 contract",
        has_output_contract,
        if has_output_contract {
            "已找到输出 contract。"
        } else {
            "缺少输出 contract。"
        },
        vec!["新增 contract/output.schema.json，描述产物、错误和输出字段。".to_string()],
    ));

    let has_permission_summary = !manifest.permission_summary.is_empty();
    checks.push(verification_check(
        "permission_declaration",
        "权限声明",
        has_permission_summary,
        if has_permission_summary {
            "已声明权限摘要。"
        } else {
            "缺少权限摘要，无法判断草案是否只读、是否写文件或是否调用本地命令。"
        },
        vec![
            "补充 permissionSummary，明确只读发现、草案内写入、本地 CLI、网络和外部写边界。"
                .to_string(),
        ],
    ));

    match scan_static_risks(draft_root, manifest) {
        Ok(()) => checks.push(verification_check(
            "static_risk_scan",
            "静态风险扫描",
            true,
            "未发现删除、依赖安装、HTTP 写操作、任意 shell 字符串或高风险业务动作 token。",
            Vec::new(),
        )),
        Err(issues) => checks.push(verification_check(
            "static_risk_scan",
            "静态风险扫描",
            false,
            issues.join("；"),
            vec![
                "移除高风险动作，或拆成后续需要人工确认 / policy gate 的能力。".to_string(),
                "如果只是只读 CLI，请使用结构化参数并在 permissionSummary 中声明本地命令边界。"
                    .to_string(),
            ],
        )),
    }

    let has_fixture = manifest.generated_files.iter().any(|file| {
        file.relative_path.starts_with("tests/") || file.relative_path.starts_with("examples/")
    });
    checks.push(verification_check(
        "fixture_presence",
        "fixture / example",
        has_fixture,
        if has_fixture {
            "已找到 tests/ 或 examples/，可作为后续 dry-run 输入。"
        } else {
            "缺少 tests/ 或 examples/，后续无法做可重复 dry-run。"
        },
        vec!["新增 examples/input.sample.json 或 tests/fixture.test.*。".to_string()],
    ));

    let has_http_fixture = manifest.generated_files.iter().any(|file| {
        let relative_path = file.relative_path.to_lowercase();
        relative_path.starts_with("tests/")
            && (relative_path.contains("fixture") || relative_path.contains("input"))
    });
    let has_http_expected_output = manifest.generated_files.iter().any(|file| {
        let relative_path = file.relative_path.to_lowercase();
        relative_path.starts_with("tests/")
            && (relative_path.contains("expected") || relative_path.contains("output"))
    });
    let has_http_fixture_input_binding = generated_file_contains_any(
        draft_root,
        manifest,
        &["input.schema", "input.sample"],
        &["fixture_path", "fixturepath", "fixture path", "fixture"],
    );
    let has_http_secret_header_or_token =
        generated_file_has_secret_header_or_token(draft_root, manifest);
    let has_http_session_authorization =
        generated_file_has_readonly_http_session_authorization(draft_root, manifest);
    let has_http_credential_reference =
        generated_file_has_readonly_http_credential_reference(draft_root, manifest);
    let has_http_execution_preflight =
        generated_file_has_readonly_http_execution_preflight(draft_root, manifest);
    let has_http_fixture_dry_run_entry =
        generated_file_has_fixture_dry_run_entry(draft_root, manifest);
    let has_http_fixture_dry_run_network_access =
        generated_file_fixture_dry_run_entry_has_network_access(draft_root, manifest);
    let has_http_fixture_dry_run_expected_output_binding =
        generated_file_fixture_dry_run_references_expected_output(draft_root, manifest);
    let http_fixture_input_binding_passed =
        matches!(has_http_fixture_input_binding.as_ref(), Ok(true));
    let http_secret_check_passed = matches!(has_http_secret_header_or_token.as_ref(), Ok(false));
    let http_session_authorization_passed =
        matches!(has_http_session_authorization.as_ref(), Ok(true));
    let http_credential_reference_passed =
        matches!(has_http_credential_reference.as_ref(), Ok(true));
    let http_execution_preflight_passed = matches!(has_http_execution_preflight.as_ref(), Ok(true));
    let http_fixture_dry_run_entry_passed =
        matches!(has_http_fixture_dry_run_entry.as_ref(), Ok(true));
    let http_fixture_dry_run_offline_passed =
        matches!(has_http_fixture_dry_run_network_access.as_ref(), Ok(false));
    let http_fixture_dry_run_expected_output_binding_passed = matches!(
        has_http_fixture_dry_run_expected_output_binding.as_ref(),
        Ok(true)
    );
    match manifest_mentions_readonly_http(draft_root, manifest) {
        Ok(true) => {
            match has_http_fixture_dry_run_entry {
                Ok(has_dry_run_entry) => checks.push(verification_check(
                    "readonly_http_fixture_dry_run",
                    "只读 HTTP fixture dry-run 入口",
                    has_dry_run_entry,
                    if has_dry_run_entry {
                        "已找到 fixture dry-run 入口；P6 可以在不真实联网的前提下复核 adapter 输出。"
                    } else {
                        "只读 HTTP / API 草案缺少 fixture dry-run 入口；即使有 fixture，也没有可重复执行的本地校验路径。"
                    },
                    vec![
                        "新增 scripts/dry-run.mjs、tests/fixture-dry-run.test.*，或 package.json dry-run 脚本，并确保只读取 fixture。"
                            .to_string(),
                    ],
                )),
                Err(issues) => checks.push(verification_check(
                    "readonly_http_fixture_dry_run",
                    "只读 HTTP fixture dry-run 入口",
                    false,
                    issues.join("；"),
                    vec!["修复生成文件读取问题后再判断 HTTP fixture dry-run 入口。".to_string()],
                )),
            }
            match has_http_fixture_dry_run_expected_output_binding {
                Ok(has_binding) => checks.push(verification_check(
                    "readonly_http_fixture_dry_run_expected_output",
                    "只读 HTTP fixture dry-run 结果绑定",
                    has_binding,
                    if has_binding {
                        "fixture dry-run 入口已引用 expected output，可判定本地 fixture 输出是否正确。"
                    } else {
                        "fixture dry-run 入口未引用 expected output；即使能运行，也无法判定 dry-run 结果是否正确。"
                    },
                    vec![
                        "在 scripts/dry-run.* 或 fixture test 中读取 tests/expected-output.json，并对比实际输出。"
                            .to_string(),
                    ],
                )),
                Err(issues) => checks.push(verification_check(
                    "readonly_http_fixture_dry_run_expected_output",
                    "只读 HTTP fixture dry-run 结果绑定",
                    false,
                    issues.join("；"),
                    vec!["修复生成文件读取问题后再判断 HTTP fixture dry-run 结果绑定。".to_string()],
                )),
            }
            match has_http_fixture_dry_run_network_access {
                Ok(has_network_access) => checks.push(verification_check(
                    "readonly_http_fixture_dry_run_offline",
                    "只读 HTTP fixture dry-run 离线边界",
                    !has_network_access,
                    if has_network_access {
                        "fixture dry-run 入口包含 fetch、axios.get、http:// 或 https:// 等真实联网痕迹；P6 dry-run 必须只读本地 fixture。"
                    } else {
                        "fixture dry-run 入口未发现真实联网痕迹，只依赖本地 fixture。"
                    },
                    vec![
                        "移除 dry-run 入口中的 fetch / axios.get / http URL，改为读取 fixture_path 指向的本地 fixture。"
                            .to_string(),
                    ],
                )),
                Err(issues) => checks.push(verification_check(
                    "readonly_http_fixture_dry_run_offline",
                    "只读 HTTP fixture dry-run 离线边界",
                    false,
                    issues.join("；"),
                    vec!["修复生成文件读取问题后再判断 HTTP fixture dry-run 离线边界。".to_string()],
                )),
            }
            match has_http_secret_header_or_token {
                Ok(has_secret) => checks.push(verification_check(
                    "readonly_http_no_credentials",
                    "只读 HTTP 无凭证草案",
                    !has_secret,
                    if has_secret {
                        "只读 HTTP / API 草案包含 Authorization、Bearer、API key 或 access token 等凭证字段；P6 不保存外部 API token。"
                    } else {
                        "未在可执行脚本、contract、example 或 tests 中发现外部 API 凭证字段。"
                    },
                    vec![
                        "移除 Authorization / Bearer / x-api-key / access_token 等字段；如后续需要登录态或 token，必须先进入用户配置、session 授权和 evidence 记录设计。"
                            .to_string(),
                    ],
                )),
                Err(issues) => checks.push(verification_check(
                    "readonly_http_no_credentials",
                    "只读 HTTP 无凭证草案",
                    false,
                    issues.join("；"),
                    vec!["修复生成文件读取问题后再判断 HTTP 凭证字段。".to_string()],
                )),
            }
            match has_http_session_authorization {
                Ok(has_authorization) => checks.push(verification_check(
                    "readonly_http_session_authorization",
                    "只读 HTTP session 授权策略",
                    has_authorization,
                    if has_authorization {
                        "已找到 session-required / read-only GET / evidence-audited policy；真实 API 执行仍需后续显式授权。"
                    } else {
                        "只读 HTTP / API 草案缺少 session authorization policy；真实 API 执行前必须先声明用户授权、只读 GET 与 evidence 记录边界。"
                    },
                    vec![
                        "新增 policy/readonly-http-session.json 或等价 policy 文件，声明 session_required、allowed_methods=[GET]、no_generated_credentials 与 evidence 字段。"
                            .to_string(),
                    ],
                )),
                Err(issues) => checks.push(verification_check(
                    "readonly_http_session_authorization",
                    "只读 HTTP session 授权策略",
                    false,
                    issues.join("；"),
                    vec!["修复生成文件读取问题后再判断 HTTP session 授权策略。".to_string()],
                )),
            }
            match has_http_credential_reference {
                Ok(has_reference) => checks.push(verification_check(
                    "readonly_http_credential_reference",
                    "只读 HTTP 凭证引用策略",
                    has_reference,
                    if has_reference {
                        "已找到受控 credential_reference，真实 API 执行只能从用户 session 配置解析凭证引用。"
                    } else {
                        "只读 HTTP / API 草案缺少 credential_reference；后续真实 API 执行需要引用用户 session 配置，而不能把 token 写入生成文件。"
                    },
                    vec![
                        "在 policy/readonly-http-session.json 中新增 credential_reference，声明 scope=session、source=user_session_config、required=false/true 和 reference_id。"
                            .to_string(),
                    ],
                )),
                Err(issues) => checks.push(verification_check(
                    "readonly_http_credential_reference",
                    "只读 HTTP 凭证引用策略",
                    false,
                    issues.join("；"),
                    vec!["修复生成文件读取问题后再判断 HTTP credential_reference。".to_string()],
                )),
            }
            match has_http_execution_preflight {
                Ok(has_preflight) => checks.push(verification_check_with_evidence(
                    "readonly_http_execution_preflight",
                    "只读 HTTP 执行 preflight",
                    has_preflight,
                    if has_preflight {
                        "已找到 execution_preflight，真实 API 执行前可先生成 approval request 与 evidence schema。"
                    } else {
                        "只读 HTTP / API 草案缺少 execution_preflight；后续真实 API 执行前必须能说明 endpoint、GET、credential reference 和 evidence schema。"
                    },
                    vec![
                        "在 policy/readonly-http-session.json 中新增 execution_preflight，声明 endpoint_source、method=GET、credential_reference_id 与 evidence_schema。"
                            .to_string(),
                    ],
                    if has_preflight {
                        readonly_http_execution_preflight_evidence()
                    } else {
                        Vec::new()
                    },
                )),
                Err(issues) => checks.push(verification_check(
                    "readonly_http_execution_preflight",
                    "只读 HTTP 执行 preflight",
                    false,
                    issues.join("；"),
                    vec!["修复生成文件读取问题后再判断 HTTP execution_preflight。".to_string()],
                )),
            }
            match has_http_fixture_input_binding {
                Ok(has_binding) => checks.push(verification_check(
                    "readonly_http_fixture_input",
                    "只读 HTTP fixture 输入",
                    has_binding,
                    if has_binding {
                        "输入 contract / 示例已暴露 fixture 字段，可把后续 dry-run 绑定到本地 fixture。"
                    } else {
                        "只读 HTTP / API 草案缺少 fixture 输入字段；后续调用只能走真实 endpoint，无法保持 P6 dry-run 边界。"
                    },
                    vec![
                        "在 contract/input.schema.json 或 examples/input.sample.json 中新增 fixture_path / fixture 字段。"
                            .to_string(),
                    ],
                )),
                Err(issues) => checks.push(verification_check(
                    "readonly_http_fixture_input",
                    "只读 HTTP fixture 输入",
                    false,
                    issues.join("；"),
                    vec!["修复生成文件读取问题后再判断 fixture 输入要求。".to_string()],
                )),
            }
            checks.push(verification_check(
                "readonly_http_fixture",
                "只读 HTTP fixture",
                has_http_fixture,
                if has_http_fixture {
                    "已找到 tests/ fixture；P6 只允许 fixture dry-run，不直接真实联网。"
                } else {
                    "只读 HTTP / API 草案缺少 tests/ fixture，无法证明后续 dry-run 可重复。"
                },
                vec![
                    "新增 tests/fixture.json 或等价 fixture 文件，真实联网前必须先走 fixture dry-run。"
                        .to_string(),
                ],
            ));
            checks.push(verification_check(
                "readonly_http_expected_output",
                "只读 HTTP expected output",
                has_http_expected_output,
                if has_http_expected_output {
                    "已找到 tests/ expected output，可用于后续 fixture dry-run 结果比对。"
                } else {
                    "只读 HTTP / API 草案缺少 tests/ expected output，后续 dry-run 无法判定结果是否正确。"
                },
                vec![
                    "新增 tests/expected-output.json 或等价期望输出文件，描述 fixture dry-run 的可比对结果。"
                        .to_string(),
                ],
            ));
            let can_execute_fixture_dry_run = has_http_fixture
                && has_http_expected_output
                && http_fixture_input_binding_passed
                && http_fixture_dry_run_entry_passed
                && http_fixture_dry_run_expected_output_binding_passed
                && http_fixture_dry_run_offline_passed
                && http_secret_check_passed
                && http_session_authorization_passed
                && http_credential_reference_passed
                && http_execution_preflight_passed;
            if can_execute_fixture_dry_run {
                match execute_readonly_http_fixture_dry_run(draft_root, manifest) {
                    Ok(result) => checks.push(verification_check_with_evidence(
                        "readonly_http_fixture_dry_run_execute",
                        "只读 HTTP fixture dry-run 执行",
                        true,
                        result.message,
                        Vec::new(),
                        result.evidence,
                    )),
                    Err(error) => checks.push(verification_check(
                        "readonly_http_fixture_dry_run_execute",
                        "只读 HTTP fixture dry-run 执行",
                        false,
                        error,
                        vec![
                            "修复 scripts/dry-run.mjs，使它只读取本地 fixture，输出可解析 JSON，并与 tests/expected-output.json 一致。"
                                .to_string(),
                        ],
                    )),
                }
            } else {
                checks.push(verification_check(
                    "readonly_http_fixture_dry_run_execute",
                    "只读 HTTP fixture dry-run 执行",
                    false,
                    "fixture dry-run 执行前置 gate 未全部通过，已拒绝执行生成脚本。",
                        vec![
                        "先修复 fixture input、tests fixture、expected output、dry-run 入口、expected-output binding、offline、no-credentials、session authorization、credential reference 和 execution preflight gate。"
                            .to_string(),
                    ],
                ));
            }
        }
        Ok(false) => {
            checks.push(verification_check(
                "readonly_http_fixture_dry_run_offline",
                "只读 HTTP fixture dry-run 离线边界",
                true,
                "草案未声明 HTTP / API 访问，不要求 P6 HTTP fixture dry-run 离线边界。",
                Vec::new(),
            ));
            checks.push(verification_check(
                "readonly_http_fixture_dry_run",
                "只读 HTTP fixture dry-run 入口",
                true,
                "草案未声明 HTTP / API 访问，不要求 P6 HTTP fixture dry-run 入口。",
                Vec::new(),
            ));
            checks.push(verification_check(
                "readonly_http_fixture_dry_run_expected_output",
                "只读 HTTP fixture dry-run 结果绑定",
                true,
                "草案未声明 HTTP / API 访问，不要求 P6 HTTP fixture dry-run 结果绑定。",
                Vec::new(),
            ));
            checks.push(verification_check(
                "readonly_http_fixture_dry_run_execute",
                "只读 HTTP fixture dry-run 执行",
                true,
                "草案未声明 HTTP / API 访问，不要求 P6 HTTP fixture dry-run 执行。",
                Vec::new(),
            ));
            checks.push(verification_check(
                "readonly_http_no_credentials",
                "只读 HTTP 无凭证草案",
                true,
                "草案未声明 HTTP / API 访问，不要求 P6 HTTP 凭证检查。",
                Vec::new(),
            ));
            checks.push(verification_check(
                "readonly_http_session_authorization",
                "只读 HTTP session 授权策略",
                true,
                "草案未声明 HTTP / API 访问，不要求 P7 HTTP session 授权策略。",
                Vec::new(),
            ));
            checks.push(verification_check(
                "readonly_http_credential_reference",
                "只读 HTTP 凭证引用策略",
                true,
                "草案未声明 HTTP / API 访问，不要求 P7 HTTP 凭证引用策略。",
                Vec::new(),
            ));
            checks.push(verification_check(
                "readonly_http_execution_preflight",
                "只读 HTTP 执行 preflight",
                true,
                "草案未声明 HTTP / API 访问，不要求 P7 HTTP execution preflight。",
                Vec::new(),
            ));
            checks.push(verification_check(
                "readonly_http_fixture_input",
                "只读 HTTP fixture 输入",
                true,
                "草案未声明 HTTP / API 访问，不要求 P6 HTTP fixture 输入字段。",
                Vec::new(),
            ));
            checks.push(verification_check(
                "readonly_http_fixture",
                "只读 HTTP fixture",
                true,
                "草案未声明 HTTP / API 访问，不要求 P6 HTTP fixture。",
                Vec::new(),
            ));
            checks.push(verification_check(
                "readonly_http_expected_output",
                "只读 HTTP expected output",
                true,
                "草案未声明 HTTP / API 访问，不要求 P6 HTTP expected output。",
                Vec::new(),
            ));
        }
        Err(issues) => {
            checks.push(verification_check(
                "readonly_http_fixture_dry_run_offline",
                "只读 HTTP fixture dry-run 离线边界",
                false,
                "无法读取生成文件，因此无法判断 HTTP fixture dry-run 离线边界。",
                vec!["修复生成文件读取问题后再判断 HTTP fixture dry-run 离线边界。".to_string()],
            ));
            checks.push(verification_check(
                "readonly_http_fixture_dry_run",
                "只读 HTTP fixture dry-run 入口",
                false,
                "无法读取生成文件，因此无法判断 HTTP fixture dry-run 入口。",
                vec!["修复生成文件读取问题后再判断 HTTP fixture dry-run 入口。".to_string()],
            ));
            checks.push(verification_check(
                "readonly_http_fixture_dry_run_expected_output",
                "只读 HTTP fixture dry-run 结果绑定",
                false,
                "无法读取生成文件，因此无法判断 HTTP fixture dry-run 结果绑定。",
                vec!["修复生成文件读取问题后再判断 HTTP fixture dry-run 结果绑定。".to_string()],
            ));
            checks.push(verification_check(
                "readonly_http_fixture_dry_run_execute",
                "只读 HTTP fixture dry-run 执行",
                false,
                "无法读取生成文件，因此无法执行 HTTP fixture dry-run。",
                vec!["修复生成文件读取问题后再执行 HTTP fixture dry-run。".to_string()],
            ));
            checks.push(verification_check(
                "readonly_http_no_credentials",
                "只读 HTTP 无凭证草案",
                false,
                "无法读取生成文件，因此无法判断 HTTP 凭证字段。",
                vec!["修复生成文件读取问题后再判断 HTTP 凭证字段。".to_string()],
            ));
            checks.push(verification_check(
                "readonly_http_session_authorization",
                "只读 HTTP session 授权策略",
                false,
                "无法读取生成文件，因此无法判断 HTTP session 授权策略。",
                vec!["修复生成文件读取问题后再判断 HTTP session 授权策略。".to_string()],
            ));
            checks.push(verification_check(
                "readonly_http_credential_reference",
                "只读 HTTP 凭证引用策略",
                false,
                "无法读取生成文件，因此无法判断 HTTP 凭证引用策略。",
                vec!["修复生成文件读取问题后再判断 HTTP credential_reference。".to_string()],
            ));
            checks.push(verification_check(
                "readonly_http_execution_preflight",
                "只读 HTTP 执行 preflight",
                false,
                "无法读取生成文件，因此无法判断 HTTP execution preflight。",
                vec!["修复生成文件读取问题后再判断 HTTP execution_preflight。".to_string()],
            ));
            checks.push(verification_check(
                "readonly_http_fixture_input",
                "只读 HTTP fixture 输入",
                false,
                "无法读取生成文件，因此无法判断 fixture 输入要求。",
                vec!["修复生成文件读取问题后再判断 HTTP fixture 输入要求。".to_string()],
            ));
            checks.push(verification_check(
                "readonly_http_fixture",
                "只读 HTTP fixture",
                false,
                issues.join("；"),
                vec!["修复生成文件读取问题后再判断 HTTP fixture 要求。".to_string()],
            ));
            checks.push(verification_check(
                "readonly_http_expected_output",
                "只读 HTTP expected output",
                false,
                "无法读取生成文件，因此无法判断 expected output 要求。",
                vec!["修复生成文件读取问题后再判断 HTTP expected output 要求。".to_string()],
            ));
        }
    }

    checks
}

pub fn create_capability_draft(
    request: CreateCapabilityDraftRequest,
) -> Result<CapabilityDraftRecord, String> {
    let workspace_root = resolve_workspace_root(&request.workspace_root)?;
    let drafts_root = drafts_root_for_workspace(&workspace_root);
    let draft_id = format!("capdraft-{}", Uuid::new_v4().simple());
    let draft_root = drafts_root.join(&draft_id);
    if draft_root.exists() {
        return Err(format!("Capability Draft 已存在: {draft_id}"));
    }

    let name = normalize_required_text(&request.name, "name")?;
    let description = normalize_required_text(&request.description, "description")?;
    let user_goal = normalize_required_text(&request.user_goal, "userGoal")?;
    let source_kind = normalize_required_text(&request.source_kind, "sourceKind")?;
    let source_refs = normalize_string_list(&request.source_refs, "sourceRefs")?;
    let permission_summary =
        normalize_string_list(&request.permission_summary, "permissionSummary")?;
    let prepared_files = prepare_generated_files(&draft_root, &request.generated_files)?;

    fs::create_dir_all(&draft_root)
        .map_err(|error| format!("创建 capability draft 目录失败: {error}"))?;

    for file in &prepared_files {
        if let Some(parent) = file.output_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("创建生成文件父目录失败: {error}"))?;
        }
        fs::write(&file.output_path, &file.content)
            .map_err(|error| format!("写入生成文件 {} 失败: {error}", file.relative_path))?;
    }

    let now = now_iso8601();
    let manifest = CapabilityDraftManifest {
        draft_id,
        name,
        description,
        user_goal,
        source_kind,
        source_refs,
        permission_summary,
        generated_files: prepared_files
            .into_iter()
            .map(|file| file.summary)
            .collect(),
        verification_status: CapabilityDraftStatus::Unverified,
        last_verification: None,
        last_registration: None,
        created_at: now.clone(),
        updated_at: now,
    };

    let manifest_path = draft_root.join(MANIFEST_FILE_NAME);
    write_manifest(&manifest_path, &manifest)?;

    Ok(to_record(&draft_root, manifest))
}

pub fn list_capability_drafts(
    request: ListCapabilityDraftsRequest,
) -> Result<Vec<CapabilityDraftRecord>, String> {
    let workspace_root = resolve_workspace_root(&request.workspace_root)?;
    let drafts_root = drafts_root_for_workspace(&workspace_root);
    if !drafts_root.exists() {
        return Ok(Vec::new());
    }

    let mut records = Vec::new();
    let entries = fs::read_dir(&drafts_root)
        .map_err(|error| format!("读取 capability drafts 目录失败: {error}"))?;
    for entry in entries {
        let entry = entry.map_err(|error| format!("读取 capability draft 目录项失败: {error}"))?;
        let draft_root = entry.path();
        if !draft_root.is_dir() {
            continue;
        }
        let manifest_path = draft_root.join(MANIFEST_FILE_NAME);
        if !manifest_path.is_file() {
            continue;
        }
        let manifest = read_manifest(&manifest_path)?;
        records.push(to_record(&draft_root, manifest));
    }

    records.sort_by(|left, right| {
        right
            .manifest
            .updated_at
            .cmp(&left.manifest.updated_at)
            .then_with(|| left.manifest.draft_id.cmp(&right.manifest.draft_id))
    });

    Ok(records)
}

pub fn get_capability_draft(
    request: GetCapabilityDraftRequest,
) -> Result<Option<CapabilityDraftRecord>, String> {
    let workspace_root = resolve_workspace_root(&request.workspace_root)?;
    let draft_id = validate_draft_id(&request.draft_id)?;
    let draft_root = drafts_root_for_workspace(&workspace_root).join(&draft_id);
    let manifest_path = draft_root.join(MANIFEST_FILE_NAME);
    if !manifest_path.is_file() {
        return Ok(None);
    }

    let manifest = read_manifest(&manifest_path)?;
    Ok(Some(to_record(&draft_root, manifest)))
}

pub fn verify_capability_draft(
    request: VerifyCapabilityDraftRequest,
) -> Result<VerifyCapabilityDraftResult, String> {
    let workspace_root = resolve_workspace_root(&request.workspace_root)?;
    let draft_id = validate_draft_id(&request.draft_id)?;
    let draft_root = drafts_root_for_workspace(&workspace_root).join(&draft_id);
    let manifest_path = draft_root.join(MANIFEST_FILE_NAME);
    if !manifest_path.is_file() {
        return Err(format!("Capability Draft 不存在: {draft_id}"));
    }

    let mut manifest = read_manifest(&manifest_path)?;
    if manifest.draft_id != draft_id {
        return Err(format!(
            "Capability Draft ID 不一致: path={draft_id} manifest={}",
            manifest.draft_id
        ));
    }

    let checks = run_capability_draft_static_checks(&draft_root, &manifest);
    let failed_check_count = checks
        .iter()
        .filter(|check| check.status == CapabilityDraftVerificationCheckStatus::Failed)
        .count();
    let checked_at = now_iso8601();
    let run_status = if failed_check_count == 0 {
        CapabilityDraftVerificationRunStatus::Passed
    } else {
        CapabilityDraftVerificationRunStatus::Failed
    };
    let summary_text = if failed_check_count == 0 {
        "最小 verification gate 通过，等待后续注册阶段。".to_string()
    } else {
        format!("最小 verification gate 未通过，{failed_check_count} 项检查失败。")
    };
    let summary = CapabilityDraftVerificationSummary {
        report_id: format!("capver-{}", Uuid::new_v4().simple()),
        status: run_status,
        summary: summary_text,
        checked_at,
        failed_check_count,
    };
    let report = CapabilityDraftVerificationReport {
        summary: summary.clone(),
        draft_id: draft_id.clone(),
        checks,
    };

    write_verification_report(&verification_report_path(&draft_root), &report)?;

    manifest.verification_status = if failed_check_count == 0 {
        CapabilityDraftStatus::VerifiedPendingRegistration
    } else {
        CapabilityDraftStatus::VerificationFailed
    };
    manifest.last_verification = Some(summary);
    manifest.updated_at = now_iso8601();
    write_manifest(&manifest_path, &manifest)?;

    Ok(VerifyCapabilityDraftResult {
        draft: to_record(&draft_root, manifest),
        report,
    })
}

pub fn register_capability_draft(
    request: RegisterCapabilityDraftRequest,
) -> Result<RegisterCapabilityDraftResult, String> {
    let workspace_root = resolve_workspace_root(&request.workspace_root)?;
    let draft_id = validate_draft_id(&request.draft_id)?;
    let draft_root = drafts_root_for_workspace(&workspace_root).join(&draft_id);
    let manifest_path = draft_root.join(MANIFEST_FILE_NAME);
    if !manifest_path.is_file() {
        return Err(format!("Capability Draft 不存在: {draft_id}"));
    }

    let mut manifest = read_manifest(&manifest_path)?;
    if manifest.draft_id != draft_id {
        return Err(format!(
            "Capability Draft ID 不一致: path={draft_id} manifest={}",
            manifest.draft_id
        ));
    }
    if manifest.verification_status != CapabilityDraftStatus::VerifiedPendingRegistration {
        return Err(format!(
            "Capability Draft 当前状态为 {:?}，只有 verified_pending_registration 可以注册",
            manifest.verification_status
        ));
    }

    validate_manifest_file_integrity(&draft_root, &manifest)
        .map_err(|issues| format!("注册前文件完整性检查失败: {}", issues.join("；")))?;
    validate_agent_skill_standard(&draft_root)?;
    let verification_report = read_verification_report(&verification_report_path(&draft_root))?;
    let expected_verification_report_id = manifest
        .last_verification
        .as_ref()
        .map(|verification| verification.report_id.as_str());
    if Some(verification_report.summary.report_id.as_str()) != expected_verification_report_id {
        return Err("注册前 verification report 与 manifest provenance 不一致".to_string());
    }
    if verification_report.summary.status != CapabilityDraftVerificationRunStatus::Passed {
        return Err("注册前 verification report 不是 passed 状态".to_string());
    }
    let verification_gates = collect_registration_verification_gates(&verification_report);

    let skill_directory = skill_directory_for_draft(&draft_id)?;
    let skills_root = workspace_registered_skills_root(&workspace_root);
    let target_dir = skills_root.join(&skill_directory);
    if target_dir.exists() {
        return Err(format!("Workspace Skill 目录已存在: {skill_directory}"));
    }

    let registration_id = format!("capreg-{}", Uuid::new_v4().simple());
    let registered_at = now_iso8601();
    let approval_requests = collect_registration_approval_requests(
        &registration_id,
        &registered_at,
        &skill_directory,
        &verification_gates,
    );

    let summary = CapabilityDraftRegistrationSummary {
        registration_id,
        registered_at,
        skill_directory: skill_directory.clone(),
        registered_skill_directory: target_dir.to_string_lossy().to_string(),
        source_draft_id: draft_id.clone(),
        source_verification_report_id: manifest
            .last_verification
            .as_ref()
            .map(|verification| verification.report_id.clone()),
        generated_file_count: manifest.generated_files.len(),
        permission_summary: manifest.permission_summary.clone(),
        verification_gates,
        approval_requests,
    };

    if let Err(error) = copy_registered_skill_files(&draft_root, &target_dir, &manifest) {
        let _ = fs::remove_dir_all(&target_dir);
        return Err(error);
    }

    let target_registration_path = target_dir
        .join(SKILL_REGISTRATION_METADATA_DIR_NAME)
        .join(SKILL_REGISTRATION_METADATA_FILE_NAME);
    if let Err(error) = write_registration_summary(&target_registration_path, &summary) {
        let _ = fs::remove_dir_all(&target_dir);
        return Err(error);
    }
    if let Err(error) = validate_agent_skill_standard(&target_dir) {
        let _ = fs::remove_dir_all(&target_dir);
        return Err(error);
    }
    if let Err(error) = write_registration_summary(&registration_report_path(&draft_root), &summary)
    {
        let _ = fs::remove_dir_all(&target_dir);
        return Err(error);
    }

    manifest.verification_status = CapabilityDraftStatus::Registered;
    manifest.last_registration = Some(summary.clone());
    manifest.updated_at = now_iso8601();
    if let Err(error) = write_manifest(&manifest_path, &manifest) {
        let _ = fs::remove_dir_all(&target_dir);
        let _ = fs::remove_file(registration_report_path(&draft_root));
        return Err(error);
    }

    Ok(RegisterCapabilityDraftResult {
        draft: to_record(&draft_root, manifest),
        registration: summary,
    })
}

fn build_workspace_registered_skill_record(
    skill_dir: &Path,
    directory: String,
    registration: CapabilityDraftRegistrationSummary,
) -> Result<WorkspaceRegisteredSkillRecord, String> {
    let inspection = SkillService::inspect_skill_dir(skill_dir)
        .map_err(|error| format!("检查 Workspace 注册 Skill 失败: {error}"))?;
    let parsed_manifest = parse_skill_manifest_from_content(&inspection.content).ok();
    let name = parsed_manifest
        .as_ref()
        .and_then(|manifest| manifest.metadata.name.clone())
        .unwrap_or_else(|| directory.clone());
    let description = parsed_manifest
        .as_ref()
        .and_then(|manifest| manifest.metadata.description.clone())
        .unwrap_or_default();

    Ok(WorkspaceRegisteredSkillRecord {
        key: format!("workspace:{directory}"),
        name,
        description,
        directory,
        registered_skill_directory: skill_dir.to_string_lossy().to_string(),
        permission_summary: registration.permission_summary.clone(),
        metadata: inspection.metadata,
        allowed_tools: inspection.allowed_tools,
        resource_summary: inspection.resource_summary,
        standard_compliance: inspection.standard_compliance,
        registration,
        launch_enabled: false,
        runtime_gate: "已注册为 Workspace 本地 Skill 包；进入运行前还需要 P3C runtime binding 与 tool_runtime 授权。"
            .to_string(),
    })
}

pub fn list_workspace_registered_skills(
    request: ListWorkspaceRegisteredSkillsRequest,
) -> Result<Vec<WorkspaceRegisteredSkillRecord>, String> {
    let workspace_root = resolve_workspace_root(&request.workspace_root)?;
    let skills_root = workspace_registered_skills_root(&workspace_root);
    if !skills_root.exists() {
        return Ok(Vec::new());
    }

    let root_metadata = fs::symlink_metadata(&skills_root)
        .map_err(|error| format!("读取 Workspace Skill 根目录失败: {error}"))?;
    if root_metadata.file_type().is_symlink() {
        return Err(format!(
            "Workspace Skill 根目录不允许是 symlink: {}",
            skills_root.display()
        ));
    }
    if !root_metadata.is_dir() {
        return Err(format!(
            "Workspace Skill 根目录不是目录: {}",
            skills_root.display()
        ));
    }

    let canonical_skills_root = fs::canonicalize(&skills_root)
        .map_err(|error| format!("解析 Workspace Skill 根目录失败: {error}"))?;
    let mut entries = fs::read_dir(&skills_root)
        .map_err(|error| format!("读取 Workspace Skill 目录失败: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("读取 Workspace Skill 目录项失败: {error}"))?;
    entries.sort_by_key(|entry| entry.file_name().to_string_lossy().to_string());

    let mut records = Vec::new();
    for entry in entries {
        let entry_path = entry.path();
        let metadata = fs::symlink_metadata(&entry_path)
            .map_err(|error| format!("读取 Workspace Skill 目录项失败: {error}"))?;
        if metadata.file_type().is_symlink() {
            return Err(format!(
                "Workspace 注册 Skill 不允许是 symlink: {}",
                entry_path.display()
            ));
        }
        if !metadata.is_dir() {
            continue;
        }

        let skill_md = entry_path.join("SKILL.md");
        let registration_path = entry_path
            .join(SKILL_REGISTRATION_METADATA_DIR_NAME)
            .join(SKILL_REGISTRATION_METADATA_FILE_NAME);
        let skill_md_metadata = match fs::symlink_metadata(&skill_md) {
            Ok(metadata) => metadata,
            Err(_) => continue,
        };
        let registration_metadata = match fs::symlink_metadata(&registration_path) {
            Ok(metadata) => metadata,
            Err(_) => continue,
        };
        if skill_md_metadata.file_type().is_symlink()
            || registration_metadata.file_type().is_symlink()
        {
            return Err(format!(
                "Workspace 注册 Skill 元数据不允许是 symlink: {}",
                entry_path.display()
            ));
        }
        if !skill_md_metadata.is_file() || !registration_metadata.is_file() {
            continue;
        }

        let canonical_skill_dir = fs::canonicalize(&entry_path)
            .map_err(|error| format!("解析 Workspace 注册 Skill 目录失败: {error}"))?;
        if !canonical_skill_dir.starts_with(&canonical_skills_root) {
            return Err(format!(
                "Workspace 注册 Skill 路径逃逸: {}",
                entry_path.display()
            ));
        }
        let canonical_skill_md = fs::canonicalize(&skill_md)
            .map_err(|error| format!("解析 Workspace 注册 Skill 说明失败: {error}"))?;
        let canonical_registration = fs::canonicalize(&registration_path)
            .map_err(|error| format!("解析 Workspace 注册 Skill provenance 失败: {error}"))?;
        if !canonical_skill_md.starts_with(&canonical_skill_dir)
            || !canonical_registration.starts_with(&canonical_skill_dir)
        {
            return Err(format!(
                "Workspace 注册 Skill 文件路径逃逸: {}",
                entry_path.display()
            ));
        }

        let directory = entry
            .file_name()
            .to_str()
            .ok_or_else(|| "Workspace 注册 Skill 目录名不是 UTF-8".to_string())?
            .to_string();
        let registration = read_registration_summary(&registration_path)?;
        records.push(build_workspace_registered_skill_record(
            &canonical_skill_dir,
            directory,
            registration,
        )?);
    }

    records.sort_by(|left, right| {
        right
            .registration
            .registered_at
            .cmp(&left.registration.registered_at)
            .then_with(|| left.directory.cmp(&right.directory))
    });

    Ok(records)
}

fn json_input_string(value: &JsonValue) -> Option<&str> {
    match value {
        JsonValue::String(text) => {
            let normalized = text.trim();
            if normalized.is_empty() {
                None
            } else {
                Some(normalized)
            }
        }
        _ => None,
    }
}

fn is_http_or_https_url_without_inline_secret(value: &str) -> bool {
    Url::parse(value)
        .ok()
        .filter(|url| matches!(url.scheme(), "http" | "https"))
        .filter(|url| url.username().is_empty() && url.password().is_none())
        .is_some()
}

fn validate_submission_field_value(
    approval_request: &CapabilityDraftRegistrationApprovalRequest,
    rule: &CapabilityDraftApprovalSessionSubmissionValidationRule,
    value: &JsonValue,
) -> CapabilityDraftApprovalSessionSubmissionFieldResult {
    let reject = |code: &str, message: &str| CapabilityDraftApprovalSessionSubmissionFieldResult {
        field_key: rule.field_key.clone(),
        accepted: false,
        code: code.to_string(),
        message: message.to_string(),
    };
    let accept = |message: &str| CapabilityDraftApprovalSessionSubmissionFieldResult {
        field_key: rule.field_key.clone(),
        accepted: true,
        code: "accepted".to_string(),
        message: message.to_string(),
    };

    if rule.secret_allowed {
        return reject(
            "secret_field_not_allowed",
            "session approval 输入不允许接收 secret 明文。",
        );
    }

    match rule.kind.as_str() {
        "boolean_confirmation" => match value {
            JsonValue::Bool(true) => accept("已收到当前 session 的显式 true 确认。"),
            _ => reject("confirmation_required", "必须传入布尔 true。"),
        },
        "url" => {
            let Some(endpoint) = json_input_string(value) else {
                return reject("url_required", "必须传入 URL 字符串。");
            };
            if endpoint.chars().count() > MAX_TEXT_FIELD_CHARS {
                return reject("value_too_long", "URL 过长，已拒绝。");
            }
            if is_http_or_https_url_without_inline_secret(endpoint) {
                accept("已通过 http/https URL 校验；值不会写入注册包。")
            } else {
                reject(
                    "invalid_url",
                    "必须是 http/https URL，且不能在 URL 中内嵌凭证。",
                )
            }
        }
        "credential_reference" => {
            let Some(reference_id) = json_input_string(value) else {
                return reject(
                    "credential_reference_required",
                    "必须传入凭证引用 ID，而不是 token 明文。",
                );
            };
            if reference_id == approval_request.credential_reference_id {
                accept("已确认凭证引用；未接收 token 明文。")
            } else {
                reject(
                    "credential_reference_mismatch",
                    "凭证引用必须匹配 approval request 的 credentialReferenceId。",
                )
            }
        }
        _ => reject("unsupported_field_kind", "当前字段类型尚未开放提交校验。"),
    }
}

fn readonly_http_controlled_get_preflight_projection(
    approval_request: &CapabilityDraftRegistrationApprovalRequest,
    validated: bool,
) -> CapabilityDraftReadonlyHttpControlledGetPreflight {
    CapabilityDraftReadonlyHttpControlledGetPreflight {
        status: if validated {
            CapabilityDraftReadonlyHttpControlledGetPreflightStatus::ReadyForControlledGetPreflight
        } else {
            CapabilityDraftReadonlyHttpControlledGetPreflightStatus::BlockedBySessionInput
        },
        gate_id: "readonly_http_controlled_get_preflight".to_string(),
        approval_id: approval_request.approval_id.clone(),
        method: approval_request.method.clone(),
        method_allowed: approval_request.method == "GET",
        endpoint_source: approval_request.endpoint_source.clone(),
        endpoint_validated: validated,
        endpoint_value_returned: false,
        credential_reference_id: approval_request.credential_reference_id.clone(),
        credential_resolution_required: !approval_request.credential_reference_id.is_empty(),
        credential_resolved: false,
        evidence_schema: approval_request.evidence_schema.clone(),
        policy_path: approval_request.policy_path.clone(),
        request_execution_enabled: false,
        runtime_execution_enabled: false,
        blocked_reason: if validated {
            "session 输入已通过校验并到达受控 GET preflight；本阶段仍不解析凭证、不发真实 HTTP。"
        } else {
            "session 输入未通过校验，受控 GET preflight 保持阻断。"
        }
        .to_string(),
        next_action: if validated {
            "后续只能在单独的受控 GET 门禁中解析 session 凭证引用、执行请求并写入 evidence。"
        } else {
            "先补齐并重新校验 session 输入，不能跳过 preflight 进入 runtime。"
        }
        .to_string(),
    }
}

fn readonly_http_dry_preflight_plan(
    approval_request: &CapabilityDraftRegistrationApprovalRequest,
    validated: bool,
    endpoint_input: Option<&str>,
) -> CapabilityDraftReadonlyHttpDryPreflightPlan {
    let request_url_hash = if validated {
        endpoint_input.map(sha256_hex)
    } else {
        None
    };
    let planned_evidence_keys = approval_request.evidence_schema.clone();

    CapabilityDraftReadonlyHttpDryPreflightPlan {
        status: if validated {
            CapabilityDraftReadonlyHttpDryPreflightPlanStatus::PlannedWithoutExecution
        } else {
            CapabilityDraftReadonlyHttpDryPreflightPlanStatus::BlockedBySessionInput
        },
        plan_id: format!("{}:dry-preflight", approval_request.approval_id),
        gate_id: "readonly_http_controlled_get_preflight".to_string(),
        approval_id: approval_request.approval_id.clone(),
        method: approval_request.method.clone(),
        method_allowed: approval_request.method == "GET",
        request_url_hash,
        request_url_hash_algorithm: "sha256".to_string(),
        endpoint_value_returned: false,
        endpoint_input_persisted: false,
        credential_reference_id: approval_request.credential_reference_id.clone(),
        credential_resolution_stage: "not_started".to_string(),
        credential_resolved: false,
        evidence_schema: approval_request.evidence_schema.clone(),
        planned_evidence_keys,
        policy_path: approval_request.policy_path.clone(),
        network_request_sent: false,
        response_captured: false,
        request_execution_enabled: false,
        runtime_execution_enabled: false,
        value_retention: "hash_only".to_string(),
        blocked_reason: if validated {
            "已生成 dry preflight evidence plan；仅保留 URL hash，不执行请求、不解析凭证。"
        } else {
            "session 输入未通过校验，不能生成可执行 evidence plan。"
        }
        .to_string(),
        next_action: if validated {
            "下一刀才能在受控 GET 门禁中解析 session credential 并执行真实请求。"
        } else {
            "先重新提交合法 session 输入，再生成 dry preflight plan。"
        }
        .to_string(),
    }
}

fn resolve_registered_approval_request(
    workspace_root: &Path,
    approval_id: &str,
) -> Result<CapabilityDraftRegistrationApprovalRequest, String> {
    let registered_skills =
        list_workspace_registered_skills(ListWorkspaceRegisteredSkillsRequest {
            workspace_root: workspace_root.to_string_lossy().to_string(),
        })?;
    registered_skills
        .iter()
        .flat_map(|skill| skill.registration.approval_requests.iter())
        .find(|approval_request| approval_request.approval_id == approval_id)
        .cloned()
        .ok_or_else(|| format!("未找到 approval request: {approval_id}"))
}

fn build_approval_session_submission_result(
    approval_id: String,
    session_id: Option<String>,
    inputs: &HashMap<String, JsonValue>,
    approval_request: &CapabilityDraftRegistrationApprovalRequest,
) -> Result<SubmitCapabilityDraftApprovalSessionInputsResult, String> {
    let contract = &approval_request.session_input_submission_contract;
    if !contract.submission_handler_enabled {
        return Err(format!(
            "approval request 尚未开放 session 输入提交 handler: {approval_id}"
        ));
    }
    if contract.runtime_execution_enabled {
        return Err("session 输入提交 handler 不允许直接打开 runtime 执行".to_string());
    }
    if contract.scope != "session" {
        return Err("approval request 只能在 session scope 内提交输入".to_string());
    }

    let accepted_key_set: HashSet<&str> = contract
        .accepted_field_keys
        .iter()
        .map(String::as_str)
        .collect();
    let mut field_results = Vec::new();
    let mut accepted_field_keys = Vec::new();
    let mut missing_field_keys = Vec::new();
    let mut rejected_field_keys = Vec::new();

    for rule in &contract.validation_rules {
        if rule.required && !inputs.contains_key(&rule.field_key) {
            missing_field_keys.push(rule.field_key.clone());
            field_results.push(CapabilityDraftApprovalSessionSubmissionFieldResult {
                field_key: rule.field_key.clone(),
                accepted: false,
                code: "missing_required_field".to_string(),
                message: "缺少必填 session 输入。".to_string(),
            });
            continue;
        }

        let Some(value) = inputs.get(&rule.field_key) else {
            continue;
        };
        let result = validate_submission_field_value(&approval_request, rule, value);
        if result.accepted {
            accepted_field_keys.push(rule.field_key.clone());
        } else {
            rejected_field_keys.push(rule.field_key.clone());
        }
        field_results.push(result);
    }

    let mut unexpected_field_keys: Vec<String> = inputs
        .keys()
        .filter(|key| !accepted_key_set.contains(key.as_str()))
        .cloned()
        .collect();
    unexpected_field_keys.sort();
    for field_key in unexpected_field_keys {
        rejected_field_keys.push(field_key.clone());
        field_results.push(CapabilityDraftApprovalSessionSubmissionFieldResult {
            field_key,
            accepted: false,
            code: "unexpected_field".to_string(),
            message: "字段不在一次性 session 输入合同中，已拒绝接收。".to_string(),
        });
    }

    let status = if missing_field_keys.is_empty() && rejected_field_keys.is_empty() {
        CapabilityDraftApprovalSessionSubmissionValidationStatus::ValidatedPendingRuntimeGate
    } else {
        CapabilityDraftApprovalSessionSubmissionValidationStatus::Rejected
    };
    let validated = matches!(
        status,
        CapabilityDraftApprovalSessionSubmissionValidationStatus::ValidatedPendingRuntimeGate
    );
    let blocked_reason = match status {
        CapabilityDraftApprovalSessionSubmissionValidationStatus::ValidatedPendingRuntimeGate => {
            "session 输入已通过校验；值未持久化，后续仍需单独进入受控 GET 执行门禁。"
        }
        CapabilityDraftApprovalSessionSubmissionValidationStatus::Rejected => {
            "session 输入未通过校验；不会解析凭证、不会执行真实 HTTP。"
        }
    };
    let endpoint_input = inputs
        .get("runtime_endpoint_input")
        .and_then(json_input_string);

    Ok(SubmitCapabilityDraftApprovalSessionInputsResult {
        approval_id,
        session_id,
        status,
        scope: "session".to_string(),
        accepted_field_keys,
        missing_field_keys,
        rejected_field_keys,
        field_results,
        endpoint_input_persisted: false,
        secret_material_accepted: false,
        token_persisted: false,
        credential_resolved: false,
        value_retention: "none".to_string(),
        evidence_capture_required: contract.evidence_capture_required,
        runtime_execution_enabled: false,
        next_gate: "readonly_http_controlled_get_preflight".to_string(),
        controlled_get_preflight: readonly_http_controlled_get_preflight_projection(
            &approval_request,
            validated,
        ),
        dry_preflight_plan: readonly_http_dry_preflight_plan(
            &approval_request,
            validated,
            endpoint_input,
        ),
        blocked_reason: blocked_reason.to_string(),
    })
}

pub fn submit_capability_draft_approval_session_inputs(
    request: SubmitCapabilityDraftApprovalSessionInputsRequest,
) -> Result<SubmitCapabilityDraftApprovalSessionInputsResult, String> {
    let workspace_root = resolve_workspace_root(&request.workspace_root)?;
    let approval_id = normalize_required_text(&request.approval_id, "approvalId")?;
    let session_id = request
        .session_id
        .as_deref()
        .map(|value| normalize_required_text(value, "sessionId"))
        .transpose()?;
    let approval_request = resolve_registered_approval_request(&workspace_root, &approval_id)?;
    build_approval_session_submission_result(
        approval_id,
        session_id,
        &request.inputs,
        &approval_request,
    )
}

fn sha256_bytes_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    format!("{digest:x}")
}

async fn collect_controlled_get_response_evidence(
    mut response: reqwest::Response,
) -> Result<(u64, String, String, bool), String> {
    let mut body_sha = Sha256::new();
    let mut response_bytes = 0u64;
    let mut preview_bytes = Vec::new();
    let mut preview_truncated = false;

    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|error| format!("读取受控 GET 响应失败: {error}"))?
    {
        response_bytes += chunk.len() as u64;
        body_sha.update(&chunk);
        if preview_bytes.len() < CONTROLLED_GET_RESPONSE_PREVIEW_BYTES {
            let remaining = CONTROLLED_GET_RESPONSE_PREVIEW_BYTES - preview_bytes.len();
            let take = remaining.min(chunk.len());
            preview_bytes.extend_from_slice(&chunk[..take]);
            if take < chunk.len() {
                preview_truncated = true;
            }
        } else if !chunk.is_empty() {
            preview_truncated = true;
        }
    }

    let response_sha256 = format!("{:x}", body_sha.finalize());
    let response_preview = String::from_utf8_lossy(&preview_bytes).to_string();
    Ok((
        response_bytes,
        response_sha256,
        response_preview,
        preview_truncated,
    ))
}

fn controlled_get_blocked_result(
    validation: SubmitCapabilityDraftApprovalSessionInputsResult,
    approval_request: &CapabilityDraftRegistrationApprovalRequest,
    blocked_reason: impl Into<String>,
    next_action: impl Into<String>,
) -> ExecuteCapabilityDraftControlledGetResult {
    ExecuteCapabilityDraftControlledGetResult {
        approval_id: validation.approval_id,
        session_id: validation.session_id,
        status: CapabilityDraftControlledGetExecutionStatus::Blocked,
        scope: "session".to_string(),
        gate_id: "readonly_http_controlled_get_execution".to_string(),
        method: approval_request.method.clone(),
        method_allowed: approval_request.method == "GET",
        request_url_hash: None,
        request_url_hash_algorithm: "sha256".to_string(),
        response_status: None,
        response_sha256: None,
        response_bytes: 0,
        response_preview: None,
        response_preview_truncated: false,
        executed_at: None,
        network_request_sent: false,
        response_captured: false,
        endpoint_value_returned: false,
        endpoint_input_persisted: false,
        credential_reference_id: approval_request.credential_reference_id.clone(),
        credential_resolved: false,
        token_persisted: false,
        request_execution_enabled: false,
        runtime_execution_enabled: false,
        value_retention: "none".to_string(),
        session_input_status: validation.status,
        field_results: validation.field_results,
        evidence: Vec::new(),
        evidence_artifact: None,
        blocked_reason: blocked_reason.into(),
        next_action: next_action.into(),
    }
}

fn controlled_get_request_failed_result(
    workspace_root: &Path,
    validation: SubmitCapabilityDraftApprovalSessionInputsResult,
    approval_request: &CapabilityDraftRegistrationApprovalRequest,
    request_url_hash: String,
    executed_at: String,
    error_kind: &str,
) -> Result<ExecuteCapabilityDraftControlledGetResult, String> {
    let evidence = vec![
        verification_evidence("request_url_hash", request_url_hash.clone()),
        verification_evidence("request_method", "GET"),
        verification_evidence("executed_at", executed_at.clone()),
        verification_evidence("network_error_kind", error_kind.to_string()),
    ];

    let mut result = ExecuteCapabilityDraftControlledGetResult {
        approval_id: validation.approval_id,
        session_id: validation.session_id,
        status: CapabilityDraftControlledGetExecutionStatus::RequestFailed,
        scope: "session".to_string(),
        gate_id: "readonly_http_controlled_get_execution".to_string(),
        method: approval_request.method.clone(),
        method_allowed: true,
        request_url_hash: Some(request_url_hash),
        request_url_hash_algorithm: "sha256".to_string(),
        response_status: None,
        response_sha256: None,
        response_bytes: 0,
        response_preview: None,
        response_preview_truncated: false,
        executed_at: Some(executed_at),
        network_request_sent: true,
        response_captured: false,
        endpoint_value_returned: false,
        endpoint_input_persisted: false,
        credential_reference_id: approval_request.credential_reference_id.clone(),
        credential_resolved: false,
        token_persisted: false,
        request_execution_enabled: true,
        runtime_execution_enabled: false,
        value_retention: "response_not_captured".to_string(),
        session_input_status: validation.status,
        field_results: validation.field_results,
        evidence,
        evidence_artifact: None,
        blocked_reason: "受控 GET 请求已尝试发送，但未捕获到可审计响应。".to_string(),
        next_action: "请检查 endpoint 可达性后重新在当前 session 触发受控 GET。".to_string(),
    };
    let evidence_artifact = write_controlled_get_evidence_artifact(
        workspace_root,
        &result.approval_id,
        result.session_id.as_deref(),
        &result.status,
        &result,
    )?;
    result.evidence_artifact = Some(evidence_artifact);
    Ok(result)
}

fn reqwest_error_kind(error: &reqwest::Error) -> &'static str {
    if error.is_timeout() {
        "timeout"
    } else if error.is_connect() {
        "connect"
    } else if error.is_request() {
        "request"
    } else if error.is_decode() {
        "decode"
    } else {
        "transport"
    }
}

fn should_bypass_proxy_for_controlled_get(endpoint: &Url) -> bool {
    endpoint.host_str().is_some_and(|host| {
        host.eq_ignore_ascii_case("localhost") || {
            host.parse::<std::net::IpAddr>()
                .is_ok_and(|address| address.is_loopback())
        }
    })
}

fn sanitize_evidence_artifact_segment(value: &str) -> String {
    let segment = value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() {
                character.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .to_string();
    if segment.is_empty() {
        "unknown".to_string()
    } else {
        segment.chars().take(48).collect()
    }
}

fn write_controlled_get_evidence_artifact(
    workspace_root: &Path,
    approval_id: &str,
    session_id: Option<&str>,
    status: &CapabilityDraftControlledGetExecutionStatus,
    result: &ExecuteCapabilityDraftControlledGetResult,
) -> Result<CapabilityDraftControlledGetEvidenceArtifact, String> {
    let executed_at = result.executed_at.as_deref().unwrap_or("not-executed");
    let artifact_hash = sha256_hex(&format!(
        "{}:{}:{}",
        approval_id,
        executed_at,
        result.request_url_hash.as_deref().unwrap_or("")
    ))
    .chars()
    .take(16)
    .collect::<String>();
    let artifact_id = format!(
        "controlled-get-{}-{}",
        sanitize_evidence_artifact_segment(executed_at),
        artifact_hash
    );
    let evidence_dir = workspace_root
        .join(DRAFTS_RELATIVE_DIR)
        .join(CONTROLLED_GET_EVIDENCE_DIR_NAME);
    fs::create_dir_all(&evidence_dir).map_err(|error| {
        format!(
            "创建受控 GET evidence artifact 目录失败 {}: {error}",
            evidence_dir.display()
        )
    })?;
    let file_name = format!("{artifact_id}.json");
    let absolute_path = evidence_dir.join(&file_name);
    let relative_path =
        format!("{DRAFTS_RELATIVE_DIR}/{CONTROLLED_GET_EVIDENCE_DIR_NAME}/{file_name}");
    let payload = serde_json::json!({
        "artifactId": artifact_id,
        "artifactKind": "capability_draft_controlled_get_evidence",
        "schemaVersion": 1,
        "approvalId": approval_id,
        "sessionId": session_id,
        "status": status,
        "scope": result.scope,
        "gateId": result.gate_id,
        "method": result.method,
        "methodAllowed": result.method_allowed,
        "requestUrlHash": result.request_url_hash,
        "requestUrlHashAlgorithm": result.request_url_hash_algorithm,
        "responseStatus": result.response_status,
        "responseSha256": result.response_sha256,
        "responseBytes": result.response_bytes,
        "responsePreviewTruncated": result.response_preview_truncated,
        "executedAt": result.executed_at,
        "networkRequestSent": result.network_request_sent,
        "responseCaptured": result.response_captured,
        "endpointValueReturned": false,
        "endpointInputPersisted": false,
        "credentialReferenceId": result.credential_reference_id,
        "credentialResolved": false,
        "tokenPersisted": false,
        "runtimeExecutionEnabled": false,
        "valueRetention": "hash_and_metadata_only",
        "containsEndpointValue": false,
        "containsTokenValue": false,
        "containsResponsePreview": false,
        "evidence": result.evidence,
    });
    let content = serde_json::to_string_pretty(&payload)
        .map_err(|error| format!("序列化受控 GET evidence artifact 失败: {error}"))?;
    fs::write(&absolute_path, content.as_bytes()).map_err(|error| {
        format!(
            "写入受控 GET evidence artifact 失败 {}: {error}",
            absolute_path.display()
        )
    })?;

    Ok(CapabilityDraftControlledGetEvidenceArtifact {
        artifact_id,
        relative_path,
        absolute_path: absolute_path.to_string_lossy().to_string(),
        content_sha256: sha256_hex(&content),
        persisted: true,
        contains_endpoint_value: false,
        contains_token_value: false,
        contains_response_preview: false,
    })
}

pub async fn execute_capability_draft_controlled_get(
    request: ExecuteCapabilityDraftControlledGetRequest,
) -> Result<ExecuteCapabilityDraftControlledGetResult, String> {
    let workspace_root = resolve_workspace_root(&request.workspace_root)?;
    let approval_id = normalize_required_text(&request.approval_id, "approvalId")?;
    let session_id = request
        .session_id
        .as_deref()
        .map(|value| normalize_required_text(value, "sessionId"))
        .transpose()?;
    let approval_request = resolve_registered_approval_request(&workspace_root, &approval_id)?;
    let validation = build_approval_session_submission_result(
        approval_id,
        session_id,
        &request.inputs,
        &approval_request,
    )?;
    let validated = matches!(
        validation.status,
        CapabilityDraftApprovalSessionSubmissionValidationStatus::ValidatedPendingRuntimeGate
    );

    if !validated {
        return Ok(controlled_get_blocked_result(
            validation,
            &approval_request,
            "session 输入未通过校验；受控 GET 不会发送请求。",
            "先补齐 session 授权、endpoint、凭证引用确认和 evidence 捕获确认。",
        ));
    }
    if approval_request.method != "GET" {
        return Ok(controlled_get_blocked_result(
            validation,
            &approval_request,
            "approval request 不是 GET 方法；受控执行门禁已阻断。",
            "只读 HTTP API 首期只允许 GET。",
        ));
    }

    let Some(endpoint) = request
        .inputs
        .get("runtime_endpoint_input")
        .and_then(json_input_string)
    else {
        return Ok(controlled_get_blocked_result(
            validation,
            &approval_request,
            "缺少 runtime endpoint 输入；受控 GET 不会发送请求。",
            "重新提交 runtime_endpoint_input 后再触发受控 GET。",
        ));
    };
    if !is_http_or_https_url_without_inline_secret(endpoint) {
        return Ok(controlled_get_blocked_result(
            validation,
            &approval_request,
            "runtime endpoint 必须是 http/https URL，且不能内嵌凭证。",
            "移除 URL 中的凭证并重新触发受控 GET。",
        ));
    }

    let request_url_hash = sha256_hex(endpoint);
    let parsed_endpoint =
        Url::parse(endpoint).map_err(|error| format!("解析 runtime endpoint 失败: {error}"))?;
    let mut client_builder = reqwest::Client::builder()
        .timeout(Duration::from_secs(CONTROLLED_GET_TIMEOUT_SECS))
        .redirect(reqwest::redirect::Policy::limited(5));
    if should_bypass_proxy_for_controlled_get(&parsed_endpoint) {
        client_builder = client_builder.no_proxy();
    }
    let client = client_builder
        .build()
        .map_err(|error| format!("创建受控 GET HTTP client 失败: {error}"))?;
    let executed_at = now_iso8601();
    let response = match client
        .get(parsed_endpoint)
        .header(reqwest::header::USER_AGENT, "Lime-Controlled-GET/1")
        .send()
        .await
    {
        Ok(response) => response,
        Err(error) => {
            return controlled_get_request_failed_result(
                &workspace_root,
                validation,
                &approval_request,
                request_url_hash,
                executed_at,
                reqwest_error_kind(&error),
            );
        }
    };

    let response_status = response.status().as_u16();
    let (response_bytes, response_sha256, response_preview, response_preview_truncated) =
        collect_controlled_get_response_evidence(response).await?;
    let preview_hash = sha256_bytes_hex(response_preview.as_bytes());
    let evidence = vec![
        verification_evidence("request_url_hash", request_url_hash.clone()),
        verification_evidence("request_method", "GET"),
        verification_evidence("response_status", response_status.to_string()),
        verification_evidence("response_sha256", response_sha256.clone()),
        verification_evidence("response_bytes", response_bytes.to_string()),
        verification_evidence("response_preview_sha256", preview_hash),
        verification_evidence("executed_at", executed_at.clone()),
    ];

    let mut result = ExecuteCapabilityDraftControlledGetResult {
        approval_id: validation.approval_id,
        session_id: validation.session_id,
        status: CapabilityDraftControlledGetExecutionStatus::Executed,
        scope: "session".to_string(),
        gate_id: "readonly_http_controlled_get_execution".to_string(),
        method: approval_request.method,
        method_allowed: true,
        request_url_hash: Some(request_url_hash),
        request_url_hash_algorithm: "sha256".to_string(),
        response_status: Some(response_status),
        response_sha256: Some(response_sha256),
        response_bytes,
        response_preview: Some(response_preview),
        response_preview_truncated,
        executed_at: Some(executed_at),
        network_request_sent: true,
        response_captured: true,
        endpoint_value_returned: false,
        endpoint_input_persisted: false,
        credential_reference_id: approval_request.credential_reference_id,
        credential_resolved: false,
        token_persisted: false,
        request_execution_enabled: true,
        runtime_execution_enabled: false,
        value_retention: "ephemeral_response_preview".to_string(),
        session_input_status: validation.status,
        field_results: validation.field_results,
        evidence,
        evidence_artifact: None,
        blocked_reason:
            "受控 GET 已执行并返回当前命令结果；endpoint / token 均未持久化，未进入 runtime。"
                .to_string(),
        next_action: "后续才能把该 evidence 接回 runtime artifact / evidence pack 主链。"
            .to_string(),
    };
    let evidence_artifact = write_controlled_get_evidence_artifact(
        &workspace_root,
        &result.approval_id,
        result.session_id.as_deref(),
        &result.status,
        &result,
    )?;
    result.evidence_artifact = Some(evidence_artifact);
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn sample_request(root: &Path) -> CreateCapabilityDraftRequest {
        CreateCapabilityDraftRequest {
            workspace_root: root.to_string_lossy().to_string(),
            name: "竞品监控草案".to_string(),
            description: "每天汇总竞品价格和上新变化。".to_string(),
            user_goal: "持续监控竞品爆款并产出待复核清单。".to_string(),
            source_kind: "manual".to_string(),
            source_refs: vec!["docs/research/skill-forge".to_string()],
            permission_summary: vec!["Level 0 只读发现".to_string()],
            generated_files: vec![CapabilityDraftFileInput {
                relative_path: "SKILL.md".to_string(),
                content: "# 竞品监控草案\n\n未验证，只能复核。".to_string(),
            }],
        }
    }

    fn verifiable_request(root: &Path) -> CreateCapabilityDraftRequest {
        CreateCapabilityDraftRequest {
            workspace_root: root.to_string_lossy().to_string(),
            name: "只读 CLI 报告草案".to_string(),
            description: "把只读 CLI 输出整理成 Markdown 报告。".to_string(),
            user_goal: "每天读取本地 CLI 输出并保存趋势摘要。".to_string(),
            source_kind: "cli".to_string(),
            source_refs: vec!["trendctl --help".to_string()],
            permission_summary: vec![
                "Level 0 只读发现".to_string(),
                "允许执行本地 CLI，但只读取输出，不做外部写操作".to_string(),
            ],
            generated_files: vec![
                CapabilityDraftFileInput {
                    relative_path: "SKILL.md".to_string(),
                    content: [
                        "# 只读 CLI 报告草案",
                        "",
                        "## 何时使用",
                        "当用户需要把本地只读 CLI 输出整理为 Markdown 报告时使用。",
                        "",
                        "## 输入",
                        "- topic: 报告主题",
                        "",
                        "## 输出",
                        "- markdown_report: 生成的 Markdown 摘要",
                    ]
                    .join("\n"),
                },
                CapabilityDraftFileInput {
                    relative_path: "contract/input.schema.json".to_string(),
                    content: r#"{"type":"object","required":["topic"],"properties":{"topic":{"type":"string"}}}"#
                        .to_string(),
                },
                CapabilityDraftFileInput {
                    relative_path: "contract/output.schema.json".to_string(),
                    content: r#"{"type":"object","required":["markdown_report"],"properties":{"markdown_report":{"type":"string"}}}"#
                        .to_string(),
                },
                CapabilityDraftFileInput {
                    relative_path: "examples/input.sample.json".to_string(),
                    content: r#"{"topic":"AI Agent"}"#.to_string(),
                },
            ],
        }
    }

    fn standard_verifiable_request(root: &Path) -> CreateCapabilityDraftRequest {
        let mut request = verifiable_request(root);
        request.generated_files[0].content = [
            "---",
            "name: 只读 CLI 报告",
            "description: 把本地只读 CLI 输出整理成 Markdown 报告。",
            "---",
            "",
            "# 只读 CLI 报告",
            "",
            "## 何时使用",
            "当用户需要把本地只读 CLI 输出整理为 Markdown 报告时使用。",
            "",
            "## 输入",
            "- topic: 报告主题",
            "",
            "## 执行步骤",
            "1. 读取用户提供的只读 CLI 输出或 fixture。",
            "2. 提炼趋势、异常和后续建议。",
            "",
            "## 输出",
            "- markdown_report: 生成的 Markdown 摘要",
        ]
        .join("\n");
        request
    }

    fn readonly_http_api_request(root: &Path) -> CreateCapabilityDraftRequest {
        CreateCapabilityDraftRequest {
            workspace_root: root.to_string_lossy().to_string(),
            name: "只读 HTTP API 报告草案".to_string(),
            description: "把公开只读 HTTP API 响应整理成 Markdown 报告。".to_string(),
            user_goal: "每天读取公开只读 API，生成趋势摘要。".to_string(),
            source_kind: "api".to_string(),
            source_refs: vec!["GET https://api.example.test/metrics".to_string()],
            permission_summary: vec![
                "Level 0 只读发现".to_string(),
                "允许只读 HTTP API GET 请求，不做外部写操作".to_string(),
            ],
            generated_files: vec![
                CapabilityDraftFileInput {
                    relative_path: "SKILL.md".to_string(),
                    content: [
                        "---",
                        "name: 只读 HTTP API 报告",
                        "description: 把公开只读 HTTP API 响应整理成 Markdown 报告。",
                        "---",
                        "",
                        "# 只读 HTTP API 报告",
                        "",
                        "## 何时使用",
                        "当用户需要读取公开只读 API 并生成趋势报告时使用。",
                        "",
                        "## 输入",
                        "- endpoint: 只读 API 地址。",
                        "",
                        "## 执行步骤",
                        "1. 仅使用 GET 请求读取公开 API 响应。",
                        "2. 不发送 POST / PUT / PATCH / DELETE。",
                        "3. 基于响应生成 Markdown 趋势摘要。",
                        "",
                        "## 输出",
                        "- markdown_report: 生成的 Markdown 摘要。",
                    ]
                    .join("\n"),
                },
                CapabilityDraftFileInput {
                    relative_path: "contract/input.schema.json".to_string(),
                    content: r#"{"type":"object","required":["endpoint"],"properties":{"endpoint":{"type":"string","format":"uri"},"fixture_path":{"type":"string"}}}"#
                        .to_string(),
                },
                CapabilityDraftFileInput {
                    relative_path: "contract/output.schema.json".to_string(),
                    content: r#"{"type":"object","required":["markdown_report"],"properties":{"markdown_report":{"type":"string"}}}"#
                        .to_string(),
                },
                CapabilityDraftFileInput {
                    relative_path: "examples/input.sample.json".to_string(),
                    content:
                        r#"{"endpoint":"https://api.example.test/metrics","fixture_path":"tests/fixture.json"}"#
                            .to_string(),
                },
                CapabilityDraftFileInput {
                    relative_path: "tests/fixture.json".to_string(),
                    content: r#"{"metrics":[{"label":"workflow","value":42}]}"#.to_string(),
                },
                CapabilityDraftFileInput {
                    relative_path: "tests/expected-output.json".to_string(),
                    content: r##"{"markdown_report":"# 趋势摘要\n\n- workflow: 42"}"##
                        .to_string(),
                },
                CapabilityDraftFileInput {
                    relative_path: "policy/readonly-http-session.json".to_string(),
                    content: r#"{"mode":"session_required","access":"read-only","allowed_methods":["GET"],"credential_policy":"no_generated_credentials","credential_source":"user_session_config","credential_reference":{"scope":"session","source":"user_session_config","required":false,"reference_id":"readonly_api_session"},"execution_preflight":{"mode":"approval_request","endpoint_source":"runtime_input","method":"GET","credential_reference_id":"readonly_api_session","evidence_schema":["request_url_hash","request_method","response_status","response_sha256","executed_at"]},"evidence":["request_url_hash","response_status","response_sha256","fixture_fallback"]}"#
                        .to_string(),
                },
                CapabilityDraftFileInput {
                    relative_path: "scripts/dry-run.mjs".to_string(),
                    content: [
                        "import fs from 'node:fs';",
                        "const input = JSON.parse(fs.readFileSync('examples/input.sample.json', 'utf8'));",
                        "const fixture = JSON.parse(fs.readFileSync(input.fixture_path, 'utf8'));",
                        "const expected = JSON.parse(fs.readFileSync('tests/expected-output.json', 'utf8'));",
                        "const actual = { markdown_report: `# 趋势摘要\\n\\n- ${fixture.metrics[0].label}: ${fixture.metrics[0].value}` };",
                        "if (actual.markdown_report !== expected.markdown_report) throw new Error('dry-run output mismatch');",
                        "console.log(JSON.stringify(actual));",
                    ]
                    .join("\n"),
                },
                CapabilityDraftFileInput {
                    relative_path: "scripts/README.md".to_string(),
                    content: [
                        "# 只读 HTTP API wrapper",
                        "",
                        "P6 第一刀只允许 GET / fixture dry-run。",
                        "真实网络访问仍需显式用户配置和 session 授权。",
                    ]
                    .join("\n"),
                },
            ],
        }
    }

    #[test]
    fn create_get_and_list_capability_draft() {
        let temp = TempDir::new().unwrap();
        let created = create_capability_draft(sample_request(temp.path())).unwrap();

        assert_eq!(created.manifest.name, "竞品监控草案");
        assert_eq!(
            created.manifest.verification_status,
            CapabilityDraftStatus::Unverified
        );
        assert_eq!(created.manifest.generated_files.len(), 1);
        assert!(created
            .draft_root
            .contains(".lime/capability-drafts/capdraft-"));

        let skill_path = Path::new(&created.draft_root).join("SKILL.md");
        assert_eq!(
            fs::read_to_string(skill_path).unwrap(),
            "# 竞品监控草案\n\n未验证，只能复核。"
        );

        let loaded = get_capability_draft(GetCapabilityDraftRequest {
            workspace_root: temp.path().to_string_lossy().to_string(),
            draft_id: created.manifest.draft_id.clone(),
        })
        .unwrap()
        .unwrap();
        assert_eq!(loaded.manifest.draft_id, created.manifest.draft_id);

        let drafts = list_capability_drafts(ListCapabilityDraftsRequest {
            workspace_root: temp.path().to_string_lossy().to_string(),
        })
        .unwrap();
        assert_eq!(drafts.len(), 1);
        assert_eq!(drafts[0].manifest.draft_id, created.manifest.draft_id);
    }

    #[test]
    fn rejects_path_escape_and_platform_specific_paths() {
        let temp = TempDir::new().unwrap();
        for relative_path in [
            "../SKILL.md",
            "/tmp/SKILL.md",
            "scripts\\tool.ts",
            "C:foo.ts",
            "./SKILL.md",
        ] {
            let mut request = sample_request(temp.path());
            request.generated_files[0].relative_path = relative_path.to_string();
            let error = create_capability_draft(request).unwrap_err();
            assert!(
                error.contains("生成文件路径") || error.contains("manifest.json"),
                "unexpected error for {relative_path}: {error}"
            );
        }
    }

    #[test]
    fn rejects_empty_generated_file_set() {
        let temp = TempDir::new().unwrap();
        let mut request = sample_request(temp.path());
        request.generated_files = Vec::new();

        let error = create_capability_draft(request).unwrap_err();
        assert!(error.contains("至少需要 1 个生成文件"));
    }

    #[test]
    fn verify_capability_draft_marks_complete_draft_pending_registration() {
        let temp = TempDir::new().unwrap();
        let created = create_capability_draft(verifiable_request(temp.path())).unwrap();

        let result = verify_capability_draft(VerifyCapabilityDraftRequest {
            workspace_root: temp.path().to_string_lossy().to_string(),
            draft_id: created.manifest.draft_id.clone(),
        })
        .unwrap();

        assert_eq!(
            result.draft.manifest.verification_status,
            CapabilityDraftStatus::VerifiedPendingRegistration
        );
        assert_eq!(
            result.report.summary.status,
            CapabilityDraftVerificationRunStatus::Passed
        );
        assert_eq!(result.report.summary.failed_check_count, 0);
        assert!(result
            .report
            .checks
            .iter()
            .all(|check| check.status == CapabilityDraftVerificationCheckStatus::Passed));
        assert!(Path::new(&result.draft.draft_root)
            .join("verification/latest.json")
            .is_file());
    }

    #[test]
    fn verify_capability_draft_fails_without_contracts() {
        let temp = TempDir::new().unwrap();
        let created = create_capability_draft(sample_request(temp.path())).unwrap();

        let result = verify_capability_draft(VerifyCapabilityDraftRequest {
            workspace_root: temp.path().to_string_lossy().to_string(),
            draft_id: created.manifest.draft_id.clone(),
        })
        .unwrap();

        assert_eq!(
            result.draft.manifest.verification_status,
            CapabilityDraftStatus::VerificationFailed
        );
        assert_eq!(
            result.report.summary.status,
            CapabilityDraftVerificationRunStatus::Failed
        );
        assert!(result.report.summary.failed_check_count >= 1);
        assert!(result
            .report
            .checks
            .iter()
            .any(|check| check.id == "input_contract"
                && check.status == CapabilityDraftVerificationCheckStatus::Failed));
        assert!(result
            .draft
            .manifest
            .last_verification
            .as_ref()
            .is_some_and(|summary| summary.failed_check_count >= 1));
    }

    #[test]
    fn verify_capability_draft_rejects_dangerous_tokens() {
        let temp = TempDir::new().unwrap();
        let mut request = verifiable_request(temp.path());
        request.generated_files.push(CapabilityDraftFileInput {
            relative_path: "scripts/publish.ts".to_string(),
            content: "await fetch(url, { method: \"POST\", body });".to_string(),
        });
        let created = create_capability_draft(request).unwrap();

        let result = verify_capability_draft(VerifyCapabilityDraftRequest {
            workspace_root: temp.path().to_string_lossy().to_string(),
            draft_id: created.manifest.draft_id.clone(),
        })
        .unwrap();

        assert_eq!(
            result.draft.manifest.verification_status,
            CapabilityDraftStatus::VerificationFailed
        );
        let risk_check = result
            .report
            .checks
            .iter()
            .find(|check| check.id == "static_risk_scan")
            .unwrap();
        assert_eq!(
            risk_check.status,
            CapabilityDraftVerificationCheckStatus::Failed
        );
        assert!(risk_check.message.contains("method: \"post\""));
    }

    #[test]
    fn verify_capability_draft_accepts_readonly_http_api_with_permission() {
        let temp = TempDir::new().unwrap();
        let created = create_capability_draft(readonly_http_api_request(temp.path())).unwrap();

        let result = verify_capability_draft(VerifyCapabilityDraftRequest {
            workspace_root: temp.path().to_string_lossy().to_string(),
            draft_id: created.manifest.draft_id.clone(),
        })
        .unwrap();

        assert_eq!(
            result.draft.manifest.verification_status,
            CapabilityDraftStatus::VerifiedPendingRegistration
        );
        assert!(result
            .report
            .checks
            .iter()
            .all(|check| check.status == CapabilityDraftVerificationCheckStatus::Passed));
        assert!(result.report.checks.iter().any(|check| {
            check.id == "readonly_http_fixture_dry_run_execute"
                && check.message.contains("已离线执行")
        }));
        let execution_check = result
            .report
            .checks
            .iter()
            .find(|check| check.id == "readonly_http_fixture_dry_run_execute")
            .unwrap();
        for key in [
            "scriptPath",
            "expectedOutputPath",
            "durationMs",
            "actualSha256",
            "expectedSha256",
            "stdoutPreview",
        ] {
            assert!(
                execution_check
                    .evidence
                    .iter()
                    .any(|evidence| evidence.key == key && !evidence.value.is_empty()),
                "missing evidence key: {key}"
            );
        }
        let preflight_check = result
            .report
            .checks
            .iter()
            .find(|check| check.id == "readonly_http_execution_preflight")
            .unwrap();
        assert_eq!(
            preflight_check.status,
            CapabilityDraftVerificationCheckStatus::Passed
        );
        for (key, value) in [
            ("preflightMode", "approval_request"),
            ("endpointSource", "runtime_input"),
            ("method", "GET"),
            ("credentialReferenceId", "readonly_api_session"),
            (
                "evidenceSchema",
                "request_url_hash,request_method,response_status,response_sha256,executed_at",
            ),
            ("policyPath", "policy/readonly-http-session.json"),
        ] {
            assert!(
                preflight_check
                    .evidence
                    .iter()
                    .any(|evidence| evidence.key == key && evidence.value == value),
                "missing preflight evidence: {key}={value}"
            );
        }
    }

    #[test]
    fn verify_capability_draft_requires_permission_for_readonly_http_api() {
        let temp = TempDir::new().unwrap();
        let mut request = readonly_http_api_request(temp.path());
        request.permission_summary = vec!["Level 0 只读发现".to_string()];
        let created = create_capability_draft(request).unwrap();

        let result = verify_capability_draft(VerifyCapabilityDraftRequest {
            workspace_root: temp.path().to_string_lossy().to_string(),
            draft_id: created.manifest.draft_id.clone(),
        })
        .unwrap();

        assert_eq!(
            result.draft.manifest.verification_status,
            CapabilityDraftStatus::VerificationFailed
        );
        let risk_check = result
            .report
            .checks
            .iter()
            .find(|check| check.id == "static_risk_scan")
            .unwrap();
        assert_eq!(
            risk_check.status,
            CapabilityDraftVerificationCheckStatus::Failed
        );
        assert!(risk_check.message.contains("网络只读权限"));
    }

    #[test]
    fn verify_capability_draft_requires_fixture_for_readonly_http_api() {
        let temp = TempDir::new().unwrap();
        let mut request = readonly_http_api_request(temp.path());
        request
            .generated_files
            .retain(|file| !file.relative_path.starts_with("tests/"));
        let created = create_capability_draft(request).unwrap();

        let result = verify_capability_draft(VerifyCapabilityDraftRequest {
            workspace_root: temp.path().to_string_lossy().to_string(),
            draft_id: created.manifest.draft_id.clone(),
        })
        .unwrap();

        assert_eq!(
            result.draft.manifest.verification_status,
            CapabilityDraftStatus::VerificationFailed
        );
        let fixture_check = result
            .report
            .checks
            .iter()
            .find(|check| check.id == "readonly_http_fixture")
            .unwrap();
        assert_eq!(
            fixture_check.status,
            CapabilityDraftVerificationCheckStatus::Failed
        );
        assert!(fixture_check.message.contains("fixture"));
    }

    #[test]
    fn verify_capability_draft_requires_expected_output_for_readonly_http_api() {
        let temp = TempDir::new().unwrap();
        let mut request = readonly_http_api_request(temp.path());
        request
            .generated_files
            .retain(|file| !file.relative_path.contains("expected"));
        let created = create_capability_draft(request).unwrap();

        let result = verify_capability_draft(VerifyCapabilityDraftRequest {
            workspace_root: temp.path().to_string_lossy().to_string(),
            draft_id: created.manifest.draft_id.clone(),
        })
        .unwrap();

        assert_eq!(
            result.draft.manifest.verification_status,
            CapabilityDraftStatus::VerificationFailed
        );
        let expected_check = result
            .report
            .checks
            .iter()
            .find(|check| check.id == "readonly_http_expected_output")
            .unwrap();
        assert_eq!(
            expected_check.status,
            CapabilityDraftVerificationCheckStatus::Failed
        );
        assert!(expected_check.message.contains("expected output"));
    }

    #[test]
    fn verify_capability_draft_requires_fixture_input_for_readonly_http_api() {
        let temp = TempDir::new().unwrap();
        let mut request = readonly_http_api_request(temp.path());
        for file in &mut request.generated_files {
            if file.relative_path == "contract/input.schema.json" {
                file.content = r#"{"type":"object","required":["endpoint"],"properties":{"endpoint":{"type":"string","format":"uri"}}}"#.to_string();
            }
            if file.relative_path == "examples/input.sample.json" {
                file.content = r#"{"endpoint":"https://api.example.test/metrics"}"#.to_string();
            }
        }
        let created = create_capability_draft(request).unwrap();

        let result = verify_capability_draft(VerifyCapabilityDraftRequest {
            workspace_root: temp.path().to_string_lossy().to_string(),
            draft_id: created.manifest.draft_id.clone(),
        })
        .unwrap();

        assert_eq!(
            result.draft.manifest.verification_status,
            CapabilityDraftStatus::VerificationFailed
        );
        let fixture_input_check = result
            .report
            .checks
            .iter()
            .find(|check| check.id == "readonly_http_fixture_input")
            .unwrap();
        assert_eq!(
            fixture_input_check.status,
            CapabilityDraftVerificationCheckStatus::Failed
        );
        assert!(fixture_input_check.message.contains("fixture"));
    }

    #[test]
    fn verify_capability_draft_rejects_credentials_for_readonly_http_api() {
        let temp = TempDir::new().unwrap();
        let mut request = readonly_http_api_request(temp.path());
        request.generated_files.push(CapabilityDraftFileInput {
            relative_path: "scripts/client.ts".to_string(),
            content:
                r#"await fetch(endpoint, { method: "GET", headers: { Authorization: `Bearer ${token}` } });"#
                    .to_string(),
        });
        let created = create_capability_draft(request).unwrap();

        let result = verify_capability_draft(VerifyCapabilityDraftRequest {
            workspace_root: temp.path().to_string_lossy().to_string(),
            draft_id: created.manifest.draft_id.clone(),
        })
        .unwrap();

        assert_eq!(
            result.draft.manifest.verification_status,
            CapabilityDraftStatus::VerificationFailed
        );
        let credential_check = result
            .report
            .checks
            .iter()
            .find(|check| check.id == "readonly_http_no_credentials")
            .unwrap();
        assert_eq!(
            credential_check.status,
            CapabilityDraftVerificationCheckStatus::Failed
        );
        assert!(credential_check.message.contains("凭证"));
    }

    #[test]
    fn verify_capability_draft_requires_session_authorization_for_readonly_http_api() {
        let temp = TempDir::new().unwrap();
        let mut request = readonly_http_api_request(temp.path());
        request
            .generated_files
            .retain(|file| !file.relative_path.starts_with("policy/"));
        let created = create_capability_draft(request).unwrap();

        let result = verify_capability_draft(VerifyCapabilityDraftRequest {
            workspace_root: temp.path().to_string_lossy().to_string(),
            draft_id: created.manifest.draft_id.clone(),
        })
        .unwrap();

        assert_eq!(
            result.draft.manifest.verification_status,
            CapabilityDraftStatus::VerificationFailed
        );
        let authorization_check = result
            .report
            .checks
            .iter()
            .find(|check| check.id == "readonly_http_session_authorization")
            .unwrap();
        assert_eq!(
            authorization_check.status,
            CapabilityDraftVerificationCheckStatus::Failed
        );
        assert!(authorization_check.message.contains("authorization"));
    }

    #[test]
    fn verify_capability_draft_requires_credential_reference_for_readonly_http_api() {
        let temp = TempDir::new().unwrap();
        let mut request = readonly_http_api_request(temp.path());
        for file in &mut request.generated_files {
            if file.relative_path == "policy/readonly-http-session.json" {
                file.content = r#"{"mode":"session_required","access":"read-only","allowed_methods":["GET"],"credential_policy":"no_generated_credentials","credential_source":"user_session_config","evidence":["request_url_hash","response_status","response_sha256"]}"#
                    .to_string();
            }
        }
        let created = create_capability_draft(request).unwrap();

        let result = verify_capability_draft(VerifyCapabilityDraftRequest {
            workspace_root: temp.path().to_string_lossy().to_string(),
            draft_id: created.manifest.draft_id.clone(),
        })
        .unwrap();

        assert_eq!(
            result.draft.manifest.verification_status,
            CapabilityDraftStatus::VerificationFailed
        );
        let credential_reference_check = result
            .report
            .checks
            .iter()
            .find(|check| check.id == "readonly_http_credential_reference")
            .unwrap();
        assert_eq!(
            credential_reference_check.status,
            CapabilityDraftVerificationCheckStatus::Failed
        );
        assert!(credential_reference_check
            .message
            .contains("credential_reference"));
    }

    #[test]
    fn verify_capability_draft_requires_execution_preflight_for_readonly_http_api() {
        let temp = TempDir::new().unwrap();
        let mut request = readonly_http_api_request(temp.path());
        for file in &mut request.generated_files {
            if file.relative_path == "policy/readonly-http-session.json" {
                file.content = r#"{"mode":"session_required","access":"read-only","allowed_methods":["GET"],"credential_policy":"no_generated_credentials","credential_source":"user_session_config","credential_reference":{"scope":"session","source":"user_session_config","required":false,"reference_id":"readonly_api_session"},"evidence":["request_url_hash","response_status","response_sha256"]}"#
                    .to_string();
            }
        }
        let created = create_capability_draft(request).unwrap();

        let result = verify_capability_draft(VerifyCapabilityDraftRequest {
            workspace_root: temp.path().to_string_lossy().to_string(),
            draft_id: created.manifest.draft_id.clone(),
        })
        .unwrap();

        assert_eq!(
            result.draft.manifest.verification_status,
            CapabilityDraftStatus::VerificationFailed
        );
        let preflight_check = result
            .report
            .checks
            .iter()
            .find(|check| check.id == "readonly_http_execution_preflight")
            .unwrap();
        assert_eq!(
            preflight_check.status,
            CapabilityDraftVerificationCheckStatus::Failed
        );
        assert!(preflight_check.message.contains("execution_preflight"));
    }

    #[test]
    fn verify_capability_draft_requires_fixture_dry_run_for_readonly_http_api() {
        let temp = TempDir::new().unwrap();
        let mut request = readonly_http_api_request(temp.path());
        request.generated_files.retain(|file| {
            !file.relative_path.contains("dry-run") && !file.relative_path.contains("dryrun")
        });
        let created = create_capability_draft(request).unwrap();

        let result = verify_capability_draft(VerifyCapabilityDraftRequest {
            workspace_root: temp.path().to_string_lossy().to_string(),
            draft_id: created.manifest.draft_id.clone(),
        })
        .unwrap();

        assert_eq!(
            result.draft.manifest.verification_status,
            CapabilityDraftStatus::VerificationFailed
        );
        let dry_run_check = result
            .report
            .checks
            .iter()
            .find(|check| check.id == "readonly_http_fixture_dry_run")
            .unwrap();
        assert_eq!(
            dry_run_check.status,
            CapabilityDraftVerificationCheckStatus::Failed
        );
        assert!(dry_run_check.message.contains("dry-run"));
    }

    #[test]
    fn verify_capability_draft_requires_readonly_http_dry_run_output_binding() {
        let temp = TempDir::new().unwrap();
        let mut request = readonly_http_api_request(temp.path());
        for file in &mut request.generated_files {
            if file.relative_path == "scripts/dry-run.mjs" {
                file.content = [
                    "import fs from 'node:fs';",
                    "const input = JSON.parse(fs.readFileSync('examples/input.sample.json', 'utf8'));",
                    "const fixture = JSON.parse(fs.readFileSync(input.fixture_path, 'utf8'));",
                    "console.log(JSON.stringify({ markdown_report: `# 趋势摘要\\n\\n- ${fixture.metrics[0].label}: ${fixture.metrics[0].value}` }));",
                ]
                .join("\n");
            }
        }
        let created = create_capability_draft(request).unwrap();

        let result = verify_capability_draft(VerifyCapabilityDraftRequest {
            workspace_root: temp.path().to_string_lossy().to_string(),
            draft_id: created.manifest.draft_id.clone(),
        })
        .unwrap();

        assert_eq!(
            result.draft.manifest.verification_status,
            CapabilityDraftStatus::VerificationFailed
        );
        let binding_check = result
            .report
            .checks
            .iter()
            .find(|check| check.id == "readonly_http_fixture_dry_run_expected_output")
            .unwrap();
        assert_eq!(
            binding_check.status,
            CapabilityDraftVerificationCheckStatus::Failed
        );
        assert!(binding_check.message.contains("expected output"));
    }

    #[test]
    fn verify_capability_draft_rejects_mismatched_readonly_http_fixture_dry_run() {
        let temp = TempDir::new().unwrap();
        let mut request = readonly_http_api_request(temp.path());
        for file in &mut request.generated_files {
            if file.relative_path == "tests/expected-output.json" {
                file.content =
                    r##"{"markdown_report":"# 趋势摘要\n\n- expected: 999"}"##.to_string();
            }
        }
        let created = create_capability_draft(request).unwrap();

        let result = verify_capability_draft(VerifyCapabilityDraftRequest {
            workspace_root: temp.path().to_string_lossy().to_string(),
            draft_id: created.manifest.draft_id.clone(),
        })
        .unwrap();

        assert_eq!(
            result.draft.manifest.verification_status,
            CapabilityDraftStatus::VerificationFailed
        );
        let execution_check = result
            .report
            .checks
            .iter()
            .find(|check| check.id == "readonly_http_fixture_dry_run_execute")
            .unwrap();
        assert_eq!(
            execution_check.status,
            CapabilityDraftVerificationCheckStatus::Failed
        );
        assert!(execution_check.message.contains("dry-run"));
    }

    #[test]
    fn verify_capability_draft_rejects_networked_fixture_dry_run_for_readonly_http_api() {
        let temp = TempDir::new().unwrap();
        let mut request = readonly_http_api_request(temp.path());
        for file in &mut request.generated_files {
            if file.relative_path == "scripts/dry-run.mjs" {
                file.content =
                    r#"await fetch("https://api.example.test/metrics", { method: "GET" });"#
                        .to_string();
            }
        }
        let created = create_capability_draft(request).unwrap();

        let result = verify_capability_draft(VerifyCapabilityDraftRequest {
            workspace_root: temp.path().to_string_lossy().to_string(),
            draft_id: created.manifest.draft_id.clone(),
        })
        .unwrap();

        assert_eq!(
            result.draft.manifest.verification_status,
            CapabilityDraftStatus::VerificationFailed
        );
        let offline_check = result
            .report
            .checks
            .iter()
            .find(|check| check.id == "readonly_http_fixture_dry_run_offline")
            .unwrap();
        assert_eq!(
            offline_check.status,
            CapabilityDraftVerificationCheckStatus::Failed
        );
        assert!(offline_check.message.contains("真实联网"));
    }

    #[test]
    fn register_capability_draft_rejects_unverified_draft() {
        let temp = TempDir::new().unwrap();
        let created = create_capability_draft(standard_verifiable_request(temp.path())).unwrap();

        let error = register_capability_draft(RegisterCapabilityDraftRequest {
            workspace_root: temp.path().to_string_lossy().to_string(),
            draft_id: created.manifest.draft_id.clone(),
        })
        .unwrap_err();

        assert!(error.contains("verified_pending_registration"));
    }

    #[test]
    fn register_capability_draft_rejects_verification_failed_draft() {
        let temp = TempDir::new().unwrap();
        let created = create_capability_draft(sample_request(temp.path())).unwrap();
        let verified = verify_capability_draft(VerifyCapabilityDraftRequest {
            workspace_root: temp.path().to_string_lossy().to_string(),
            draft_id: created.manifest.draft_id.clone(),
        })
        .unwrap();
        assert_eq!(
            verified.draft.manifest.verification_status,
            CapabilityDraftStatus::VerificationFailed
        );

        let error = register_capability_draft(RegisterCapabilityDraftRequest {
            workspace_root: temp.path().to_string_lossy().to_string(),
            draft_id: created.manifest.draft_id.clone(),
        })
        .unwrap_err();

        assert!(error.contains("verified_pending_registration"));
    }

    #[test]
    fn register_capability_draft_rejects_non_standard_skill() {
        let temp = TempDir::new().unwrap();
        let created = create_capability_draft(verifiable_request(temp.path())).unwrap();
        let verified = verify_capability_draft(VerifyCapabilityDraftRequest {
            workspace_root: temp.path().to_string_lossy().to_string(),
            draft_id: created.manifest.draft_id.clone(),
        })
        .unwrap();
        assert_eq!(
            verified.draft.manifest.verification_status,
            CapabilityDraftStatus::VerifiedPendingRegistration
        );

        let error = register_capability_draft(RegisterCapabilityDraftRequest {
            workspace_root: temp.path().to_string_lossy().to_string(),
            draft_id: created.manifest.draft_id.clone(),
        })
        .unwrap_err();

        assert!(error.contains("Agent Skills 标准检查未通过"));
    }

    #[test]
    fn register_capability_draft_copies_verified_standard_skill() {
        let temp = TempDir::new().unwrap();
        let created = create_capability_draft(standard_verifiable_request(temp.path())).unwrap();
        verify_capability_draft(VerifyCapabilityDraftRequest {
            workspace_root: temp.path().to_string_lossy().to_string(),
            draft_id: created.manifest.draft_id.clone(),
        })
        .unwrap();

        let result = register_capability_draft(RegisterCapabilityDraftRequest {
            workspace_root: temp.path().to_string_lossy().to_string(),
            draft_id: created.manifest.draft_id.clone(),
        })
        .unwrap();

        assert_eq!(
            result.draft.manifest.verification_status,
            CapabilityDraftStatus::Registered
        );
        assert_eq!(
            result
                .draft
                .manifest
                .last_registration
                .as_ref()
                .map(|summary| summary.source_draft_id.as_str()),
            Some(created.manifest.draft_id.as_str())
        );
        assert!(Path::new(&result.registration.registered_skill_directory)
            .join("SKILL.md")
            .is_file());
        assert!(Path::new(&result.registration.registered_skill_directory)
            .join(SKILL_REGISTRATION_METADATA_DIR_NAME)
            .join(SKILL_REGISTRATION_METADATA_FILE_NAME)
            .is_file());
        assert!(Path::new(&result.draft.draft_root)
            .join("registration/latest.json")
            .is_file());
        assert_eq!(result.registration.generated_file_count, 4);
        assert!(result.registration.source_verification_report_id.is_some());
    }

    #[test]
    fn register_capability_draft_persists_readonly_http_preflight_provenance() {
        let temp = TempDir::new().unwrap();
        let created = create_capability_draft(readonly_http_api_request(temp.path())).unwrap();
        verify_capability_draft(VerifyCapabilityDraftRequest {
            workspace_root: temp.path().to_string_lossy().to_string(),
            draft_id: created.manifest.draft_id.clone(),
        })
        .unwrap();

        let result = register_capability_draft(RegisterCapabilityDraftRequest {
            workspace_root: temp.path().to_string_lossy().to_string(),
            draft_id: created.manifest.draft_id.clone(),
        })
        .unwrap();

        let preflight_gate = result
            .registration
            .verification_gates
            .iter()
            .find(|gate| gate.check_id == "readonly_http_execution_preflight")
            .unwrap();
        assert_eq!(preflight_gate.label, "只读 HTTP 执行 preflight");
        for (key, value) in [
            ("preflightMode", "approval_request"),
            ("endpointSource", "runtime_input"),
            ("method", "GET"),
            ("credentialReferenceId", "readonly_api_session"),
            (
                "evidenceSchema",
                "request_url_hash,request_method,response_status,response_sha256,executed_at",
            ),
            ("policyPath", "policy/readonly-http-session.json"),
        ] {
            assert!(
                preflight_gate
                    .evidence
                    .iter()
                    .any(|evidence| evidence.key == key && evidence.value == value),
                "missing registered provenance evidence: {key}={value}"
            );
        }
        let approval_request = result.registration.approval_requests.first().unwrap();
        assert_eq!(
            approval_request.approval_id,
            format!(
                "{}:readonly-http-session",
                result.registration.registration_id
            )
        );
        assert_eq!(
            approval_request.status,
            CapabilityDraftApprovalRequestStatus::Pending
        );
        assert_eq!(
            approval_request.source_check_id,
            "readonly_http_execution_preflight"
        );
        assert_eq!(
            approval_request.skill_directory,
            result.registration.skill_directory
        );
        assert_eq!(approval_request.endpoint_source, "runtime_input");
        assert_eq!(approval_request.method, "GET");
        assert_eq!(
            approval_request.credential_reference_id,
            "readonly_api_session"
        );
        assert_eq!(
            approval_request.evidence_schema,
            vec![
                "request_url_hash",
                "request_method",
                "response_status",
                "response_sha256",
                "executed_at",
            ]
        );
        assert_eq!(
            approval_request.policy_path,
            "policy/readonly-http-session.json"
        );
        assert_eq!(
            approval_request.created_at,
            result.registration.registered_at
        );
        assert_eq!(
            approval_request.consumption_gate.status,
            CapabilityDraftApprovalConsumptionStatus::AwaitingSessionApproval
        );
        assert_eq!(
            approval_request.consumption_gate.required_inputs,
            vec![
                "session_user_approval",
                "runtime_endpoint_input",
                "credential_reference:readonly_api_session",
                "evidence_capture",
            ]
        );
        assert!(!approval_request.consumption_gate.runtime_execution_enabled);
        assert!(!approval_request.consumption_gate.credential_storage_enabled);
        assert_eq!(
            approval_request.credential_resolver.status,
            CapabilityDraftCredentialResolverStatus::AwaitingSessionCredential
        );
        assert_eq!(
            approval_request.credential_resolver.reference_id,
            "readonly_api_session"
        );
        assert_eq!(approval_request.credential_resolver.scope, "session");
        assert_eq!(
            approval_request.credential_resolver.source,
            "user_session_config"
        );
        assert_eq!(
            approval_request.credential_resolver.secret_material_status,
            "not_requested"
        );
        assert!(!approval_request.credential_resolver.token_persisted);
        assert!(
            !approval_request
                .credential_resolver
                .runtime_injection_enabled
        );
        assert_eq!(
            approval_request.consumption_input_schema.schema_id,
            "readonly_http_session_approval_v1"
        );
        assert_eq!(approval_request.consumption_input_schema.version, 1);
        assert!(
            !approval_request
                .consumption_input_schema
                .ui_submission_enabled
        );
        assert!(
            !approval_request
                .consumption_input_schema
                .runtime_execution_enabled
        );
        assert!(approval_request
            .consumption_input_schema
            .fields
            .iter()
            .any(|field| field.key == "runtime_endpoint_input"
                && field.kind == "url"
                && field.required
                && !field.secret));
        assert!(approval_request
            .consumption_input_schema
            .fields
            .iter()
            .any(|field| field.key == "credential_reference_confirmation"
                && field.kind == "credential_reference"
                && field.source == "user_session_config"
                && !field.secret));
        assert_eq!(
            approval_request.session_input_intake.status,
            CapabilityDraftApprovalConsumptionSessionIntakeStatus::AwaitingSessionInputs
        );
        assert_eq!(
            approval_request.session_input_intake.schema_id,
            "readonly_http_session_approval_v1"
        );
        assert_eq!(approval_request.session_input_intake.scope, "session");
        assert_eq!(
            approval_request.session_input_intake.required_field_keys,
            vec![
                "session_user_approval",
                "runtime_endpoint_input",
                "credential_reference_confirmation",
                "evidence_capture_consent",
            ]
        );
        assert_eq!(
            approval_request.session_input_intake.missing_field_keys,
            approval_request.session_input_intake.required_field_keys
        );
        assert!(approval_request
            .session_input_intake
            .collected_field_keys
            .is_empty());
        assert_eq!(
            approval_request
                .session_input_intake
                .credential_reference_id,
            "readonly_api_session"
        );
        assert!(
            !approval_request
                .session_input_intake
                .endpoint_input_persisted
        );
        assert_eq!(
            approval_request.session_input_intake.secret_material_status,
            "not_collected"
        );
        assert!(!approval_request.session_input_intake.token_persisted);
        assert!(!approval_request.session_input_intake.ui_submission_enabled);
        assert!(
            !approval_request
                .session_input_intake
                .runtime_execution_enabled
        );
        assert_eq!(
            approval_request.session_input_submission_contract.status,
            CapabilityDraftApprovalSessionSubmissionStatus::SubmissionContractDeclared
        );
        assert_eq!(
            approval_request.session_input_submission_contract.scope,
            "session"
        );
        assert_eq!(
            approval_request.session_input_submission_contract.mode,
            "one_time_session_submission"
        );
        assert_eq!(
            approval_request
                .session_input_submission_contract
                .accepted_field_keys,
            approval_request.session_input_intake.required_field_keys
        );
        assert!(approval_request
            .session_input_submission_contract
            .validation_rules
            .iter()
            .any(|rule| rule.field_key == "runtime_endpoint_input"
                && rule.kind == "url"
                && rule.required
                && !rule.secret_allowed
                && rule.rule.contains("http/https URL")));
        assert!(approval_request
            .session_input_submission_contract
            .validation_rules
            .iter()
            .any(|rule| rule.field_key == "credential_reference_confirmation"
                && rule.kind == "credential_reference"
                && rule.source == "user_session_config"
                && !rule.secret_allowed
                && rule.rule.contains("不接收 token 明文")));
        assert_eq!(
            approval_request
                .session_input_submission_contract
                .value_retention,
            "none"
        );
        assert!(
            !approval_request
                .session_input_submission_contract
                .endpoint_input_persisted
        );
        assert!(
            !approval_request
                .session_input_submission_contract
                .secret_material_accepted
        );
        assert!(
            !approval_request
                .session_input_submission_contract
                .token_persisted
        );
        assert!(
            approval_request
                .session_input_submission_contract
                .evidence_capture_required
        );
        assert!(
            approval_request
                .session_input_submission_contract
                .submission_handler_enabled
        );
        assert!(
            !approval_request
                .session_input_submission_contract
                .ui_submission_enabled
        );
        assert!(
            !approval_request
                .session_input_submission_contract
                .runtime_execution_enabled
        );

        let records = list_workspace_registered_skills(ListWorkspaceRegisteredSkillsRequest {
            workspace_root: temp.path().to_string_lossy().to_string(),
        })
        .unwrap();
        let record = records
            .iter()
            .find(|record| record.registration.source_draft_id == created.manifest.draft_id)
            .unwrap();
        assert!(record.registration.verification_gates.iter().any(|gate| {
            gate.check_id == "readonly_http_execution_preflight"
                && gate
                    .evidence
                    .iter()
                    .any(|evidence| evidence.key == "credentialReferenceId")
        }));
        assert_eq!(record.registration.approval_requests.len(), 1);
        assert_eq!(
            record.registration.approval_requests[0].credential_reference_id,
            "readonly_api_session"
        );
    }

    #[test]
    fn submit_capability_draft_approval_session_inputs_validates_without_runtime_execution() {
        let temp = TempDir::new().unwrap();
        let created = create_capability_draft(readonly_http_api_request(temp.path())).unwrap();
        verify_capability_draft(VerifyCapabilityDraftRequest {
            workspace_root: temp.path().to_string_lossy().to_string(),
            draft_id: created.manifest.draft_id.clone(),
        })
        .unwrap();
        let registered = register_capability_draft(RegisterCapabilityDraftRequest {
            workspace_root: temp.path().to_string_lossy().to_string(),
            draft_id: created.manifest.draft_id.clone(),
        })
        .unwrap();
        let approval_id = registered
            .registration
            .approval_requests
            .first()
            .unwrap()
            .approval_id
            .clone();

        let result = submit_capability_draft_approval_session_inputs(
            SubmitCapabilityDraftApprovalSessionInputsRequest {
                workspace_root: temp.path().to_string_lossy().to_string(),
                approval_id: approval_id.clone(),
                session_id: Some("session-readonly-http".to_string()),
                inputs: HashMap::from([
                    ("session_user_approval".to_string(), JsonValue::Bool(true)),
                    (
                        "runtime_endpoint_input".to_string(),
                        JsonValue::String("https://api.example.test/metrics".to_string()),
                    ),
                    (
                        "credential_reference_confirmation".to_string(),
                        JsonValue::String("readonly_api_session".to_string()),
                    ),
                    (
                        "evidence_capture_consent".to_string(),
                        JsonValue::Bool(true),
                    ),
                ]),
            },
        )
        .unwrap();

        assert_eq!(result.approval_id, approval_id);
        assert_eq!(
            result.status,
            CapabilityDraftApprovalSessionSubmissionValidationStatus::ValidatedPendingRuntimeGate
        );
        assert_eq!(
            result.accepted_field_keys,
            vec![
                "session_user_approval",
                "runtime_endpoint_input",
                "credential_reference_confirmation",
                "evidence_capture_consent",
            ]
        );
        assert!(result.missing_field_keys.is_empty());
        assert!(result.rejected_field_keys.is_empty());
        assert!(!result.endpoint_input_persisted);
        assert!(!result.secret_material_accepted);
        assert!(!result.token_persisted);
        assert!(!result.credential_resolved);
        assert!(!result.runtime_execution_enabled);
        assert_eq!(result.value_retention, "none");
        assert_eq!(result.next_gate, "readonly_http_controlled_get_preflight");
        assert_eq!(
            result.controlled_get_preflight.status,
            CapabilityDraftReadonlyHttpControlledGetPreflightStatus::ReadyForControlledGetPreflight
        );
        assert_eq!(
            result.controlled_get_preflight.gate_id,
            "readonly_http_controlled_get_preflight"
        );
        assert_eq!(result.controlled_get_preflight.method, "GET");
        assert!(result.controlled_get_preflight.method_allowed);
        assert!(result.controlled_get_preflight.endpoint_validated);
        assert!(!result.controlled_get_preflight.endpoint_value_returned);
        assert_eq!(
            result.controlled_get_preflight.credential_reference_id,
            "readonly_api_session"
        );
        assert!(
            result
                .controlled_get_preflight
                .credential_resolution_required
        );
        assert!(!result.controlled_get_preflight.credential_resolved);
        assert!(!result.controlled_get_preflight.request_execution_enabled);
        assert!(!result.controlled_get_preflight.runtime_execution_enabled);
        assert_eq!(
            result.controlled_get_preflight.evidence_schema,
            vec![
                "request_url_hash",
                "request_method",
                "response_status",
                "response_sha256",
                "executed_at",
            ]
        );
        assert_eq!(
            result.dry_preflight_plan.status,
            CapabilityDraftReadonlyHttpDryPreflightPlanStatus::PlannedWithoutExecution
        );
        assert_eq!(
            result.dry_preflight_plan.gate_id,
            "readonly_http_controlled_get_preflight"
        );
        assert_eq!(result.dry_preflight_plan.method, "GET");
        assert!(result.dry_preflight_plan.method_allowed);
        assert_eq!(
            result
                .dry_preflight_plan
                .request_url_hash
                .as_ref()
                .map(|hash| hash.len()),
            Some(64)
        );
        assert_eq!(
            result.dry_preflight_plan.request_url_hash_algorithm,
            "sha256"
        );
        assert!(!result.dry_preflight_plan.endpoint_value_returned);
        assert!(!result.dry_preflight_plan.endpoint_input_persisted);
        assert_eq!(
            result.dry_preflight_plan.credential_resolution_stage,
            "not_started"
        );
        assert!(!result.dry_preflight_plan.credential_resolved);
        assert!(!result.dry_preflight_plan.network_request_sent);
        assert!(!result.dry_preflight_plan.response_captured);
        assert!(!result.dry_preflight_plan.request_execution_enabled);
        assert!(!result.dry_preflight_plan.runtime_execution_enabled);
        assert_eq!(result.dry_preflight_plan.value_retention, "hash_only");
        assert_eq!(
            result.dry_preflight_plan.planned_evidence_keys,
            result.controlled_get_preflight.evidence_schema
        );
    }

    #[test]
    fn submit_capability_draft_approval_session_inputs_rejects_secret_and_bad_url() {
        let temp = TempDir::new().unwrap();
        let created = create_capability_draft(readonly_http_api_request(temp.path())).unwrap();
        verify_capability_draft(VerifyCapabilityDraftRequest {
            workspace_root: temp.path().to_string_lossy().to_string(),
            draft_id: created.manifest.draft_id.clone(),
        })
        .unwrap();
        let registered = register_capability_draft(RegisterCapabilityDraftRequest {
            workspace_root: temp.path().to_string_lossy().to_string(),
            draft_id: created.manifest.draft_id.clone(),
        })
        .unwrap();
        let approval_id = registered
            .registration
            .approval_requests
            .first()
            .unwrap()
            .approval_id
            .clone();

        let result = submit_capability_draft_approval_session_inputs(
            SubmitCapabilityDraftApprovalSessionInputsRequest {
                workspace_root: temp.path().to_string_lossy().to_string(),
                approval_id,
                session_id: None,
                inputs: HashMap::from([
                    ("session_user_approval".to_string(), JsonValue::Bool(true)),
                    (
                        "runtime_endpoint_input".to_string(),
                        JsonValue::String("https://user:secret@example.test/metrics".to_string()),
                    ),
                    (
                        "credential_reference_confirmation".to_string(),
                        JsonValue::String("sk-live-secret".to_string()),
                    ),
                    (
                        "api_token".to_string(),
                        JsonValue::String("sk-live-secret".to_string()),
                    ),
                ]),
            },
        )
        .unwrap();

        assert_eq!(
            result.status,
            CapabilityDraftApprovalSessionSubmissionValidationStatus::Rejected
        );
        assert_eq!(result.missing_field_keys, vec!["evidence_capture_consent"]);
        assert!(result
            .rejected_field_keys
            .contains(&"runtime_endpoint_input".to_string()));
        assert!(result
            .rejected_field_keys
            .contains(&"credential_reference_confirmation".to_string()));
        assert!(result
            .rejected_field_keys
            .contains(&"api_token".to_string()));
        assert!(result.field_results.iter().any(|field| field.field_key
            == "credential_reference_confirmation"
            && field.code == "credential_reference_mismatch"));
        assert!(!result.secret_material_accepted);
        assert!(!result.token_persisted);
        assert!(!result.runtime_execution_enabled);
        assert_eq!(
            result.controlled_get_preflight.status,
            CapabilityDraftReadonlyHttpControlledGetPreflightStatus::BlockedBySessionInput
        );
        assert!(!result.controlled_get_preflight.endpoint_validated);
        assert!(!result.controlled_get_preflight.endpoint_value_returned);
        assert!(!result.controlled_get_preflight.request_execution_enabled);
        assert_eq!(
            result.dry_preflight_plan.status,
            CapabilityDraftReadonlyHttpDryPreflightPlanStatus::BlockedBySessionInput
        );
        assert!(result.dry_preflight_plan.request_url_hash.is_none());
        assert!(!result.dry_preflight_plan.endpoint_value_returned);
        assert!(!result.dry_preflight_plan.network_request_sent);
        assert!(!result.dry_preflight_plan.request_execution_enabled);
    }

    fn spawn_controlled_get_fixture_response(body: &str) -> String {
        use std::io::{Read, Write};
        use std::net::TcpListener;

        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let response_body = body.to_string();
        thread::spawn(move || {
            if let Ok((mut stream, _)) = listener.accept() {
                let mut buffer = [0_u8; 1024];
                let _ = stream.read(&mut buffer);
                let response = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    response_body.as_bytes().len(),
                    response_body
                );
                let _ = stream.write_all(response.as_bytes());
            }
        });
        format!("http://{address}/metrics")
    }

    #[tokio::test]
    async fn execute_capability_draft_controlled_get_returns_evidence_without_persisting_inputs() {
        let temp = TempDir::new().unwrap();
        let created = create_capability_draft(readonly_http_api_request(temp.path())).unwrap();
        verify_capability_draft(VerifyCapabilityDraftRequest {
            workspace_root: temp.path().to_string_lossy().to_string(),
            draft_id: created.manifest.draft_id.clone(),
        })
        .unwrap();
        let registered = register_capability_draft(RegisterCapabilityDraftRequest {
            workspace_root: temp.path().to_string_lossy().to_string(),
            draft_id: created.manifest.draft_id.clone(),
        })
        .unwrap();
        let approval_id = registered
            .registration
            .approval_requests
            .first()
            .unwrap()
            .approval_id
            .clone();
        let endpoint = spawn_controlled_get_fixture_response(r#"{"ok":true,"count":3}"#);
        let endpoint_prefix = endpoint.clone();

        let result =
            execute_capability_draft_controlled_get(ExecuteCapabilityDraftControlledGetRequest {
                workspace_root: temp.path().to_string_lossy().to_string(),
                approval_id,
                session_id: Some("session-readonly-http".to_string()),
                inputs: HashMap::from([
                    ("session_user_approval".to_string(), JsonValue::Bool(true)),
                    (
                        "runtime_endpoint_input".to_string(),
                        JsonValue::String(endpoint),
                    ),
                    (
                        "credential_reference_confirmation".to_string(),
                        JsonValue::String("readonly_api_session".to_string()),
                    ),
                    (
                        "evidence_capture_consent".to_string(),
                        JsonValue::Bool(true),
                    ),
                ]),
            })
            .await
            .unwrap();

        assert_eq!(
            result.status,
            CapabilityDraftControlledGetExecutionStatus::Executed
        );
        assert_eq!(result.method, "GET");
        assert!(result.method_allowed);
        assert_eq!(
            result.request_url_hash.as_ref().map(|hash| hash.len()),
            Some(64)
        );
        assert_eq!(result.response_status, Some(200));
        assert_eq!(
            result.response_sha256.as_ref().map(|hash| hash.len()),
            Some(64)
        );
        assert!(result.response_preview.unwrap().contains("\"ok\":true"));
        assert!(result.network_request_sent);
        assert!(result.response_captured);
        assert!(!result.endpoint_value_returned);
        assert!(!result.endpoint_input_persisted);
        assert!(!result.credential_resolved);
        assert!(!result.token_persisted);
        assert!(result.request_execution_enabled);
        assert!(!result.runtime_execution_enabled);
        assert_eq!(
            result.session_input_status,
            CapabilityDraftApprovalSessionSubmissionValidationStatus::ValidatedPendingRuntimeGate
        );
        assert!(result
            .evidence
            .iter()
            .any(|item| { item.key == "response_status" && item.value == "200" }));
        let evidence_artifact = result.evidence_artifact.as_ref().unwrap();
        assert!(evidence_artifact.persisted);
        assert!(!evidence_artifact.contains_endpoint_value);
        assert!(!evidence_artifact.contains_token_value);
        assert!(!evidence_artifact.contains_response_preview);
        let artifact_content = fs::read_to_string(&evidence_artifact.absolute_path).unwrap();
        assert!(artifact_content.contains("capability_draft_controlled_get_evidence"));
        assert!(artifact_content.contains("\"responseStatus\": 200"));
        assert!(!artifact_content.contains(&endpoint_prefix));
        assert!(!artifact_content.contains("\"ok\":true"));
    }

    #[tokio::test]
    async fn execute_capability_draft_controlled_get_blocks_invalid_session_inputs() {
        let temp = TempDir::new().unwrap();
        let created = create_capability_draft(readonly_http_api_request(temp.path())).unwrap();
        verify_capability_draft(VerifyCapabilityDraftRequest {
            workspace_root: temp.path().to_string_lossy().to_string(),
            draft_id: created.manifest.draft_id.clone(),
        })
        .unwrap();
        let registered = register_capability_draft(RegisterCapabilityDraftRequest {
            workspace_root: temp.path().to_string_lossy().to_string(),
            draft_id: created.manifest.draft_id.clone(),
        })
        .unwrap();
        let approval_id = registered
            .registration
            .approval_requests
            .first()
            .unwrap()
            .approval_id
            .clone();

        let result =
            execute_capability_draft_controlled_get(ExecuteCapabilityDraftControlledGetRequest {
                workspace_root: temp.path().to_string_lossy().to_string(),
                approval_id,
                session_id: None,
                inputs: HashMap::from([
                    ("session_user_approval".to_string(), JsonValue::Bool(true)),
                    (
                        "runtime_endpoint_input".to_string(),
                        JsonValue::String("file:///tmp/secret".to_string()),
                    ),
                    (
                        "credential_reference_confirmation".to_string(),
                        JsonValue::String("readonly_api_session".to_string()),
                    ),
                    (
                        "evidence_capture_consent".to_string(),
                        JsonValue::Bool(true),
                    ),
                ]),
            })
            .await
            .unwrap();

        assert_eq!(
            result.status,
            CapabilityDraftControlledGetExecutionStatus::Blocked
        );
        assert_eq!(
            result.session_input_status,
            CapabilityDraftApprovalSessionSubmissionValidationStatus::Rejected
        );
        assert!(!result.network_request_sent);
        assert!(!result.response_captured);
        assert!(!result.request_execution_enabled);
        assert!(!result.runtime_execution_enabled);
        assert!(result.request_url_hash.is_none());
        assert!(result.evidence_artifact.is_none());
        assert!(result.field_results.iter().any(|field| field.field_key
            == "runtime_endpoint_input"
            && field.code == "invalid_url"));
    }

    #[test]
    fn register_capability_draft_rejects_existing_skill_directory() {
        let temp = TempDir::new().unwrap();
        let created = create_capability_draft(standard_verifiable_request(temp.path())).unwrap();
        verify_capability_draft(VerifyCapabilityDraftRequest {
            workspace_root: temp.path().to_string_lossy().to_string(),
            draft_id: created.manifest.draft_id.clone(),
        })
        .unwrap();
        let skill_directory = skill_directory_for_draft(&created.manifest.draft_id).unwrap();
        fs::create_dir_all(
            temp.path()
                .join(REGISTERED_SKILLS_ROOT_DIR_NAME)
                .join(REGISTERED_SKILLS_DIR_NAME)
                .join(&skill_directory),
        )
        .unwrap();

        let error = register_capability_draft(RegisterCapabilityDraftRequest {
            workspace_root: temp.path().to_string_lossy().to_string(),
            draft_id: created.manifest.draft_id.clone(),
        })
        .unwrap_err();

        assert!(error.contains("Workspace Skill 目录已存在"));
    }

    #[test]
    fn list_workspace_registered_skills_returns_empty_without_skills_root() {
        let temp = TempDir::new().unwrap();

        let records = list_workspace_registered_skills(ListWorkspaceRegisteredSkillsRequest {
            workspace_root: temp.path().to_string_lossy().to_string(),
        })
        .unwrap();

        assert!(records.is_empty());
    }

    #[test]
    fn list_workspace_registered_skills_rejects_relative_workspace_root() {
        let error = list_workspace_registered_skills(ListWorkspaceRegisteredSkillsRequest {
            workspace_root: "relative/workspace".to_string(),
        })
        .unwrap_err();

        assert!(error.contains("workspaceRoot 必须是绝对路径"));
    }

    #[test]
    fn list_workspace_registered_skills_ignores_standard_skill_without_registration() {
        let temp = TempDir::new().unwrap();
        let skill_dir = temp
            .path()
            .join(REGISTERED_SKILLS_ROOT_DIR_NAME)
            .join(REGISTERED_SKILLS_DIR_NAME)
            .join("manual-standard-skill");
        fs::create_dir_all(&skill_dir).unwrap();
        fs::write(
            skill_dir.join("SKILL.md"),
            [
                "---",
                "name: 手工标准 Skill",
                "description: 没有 P3A provenance。",
                "---",
                "",
                "# 手工标准 Skill",
            ]
            .join("\n"),
        )
        .unwrap();

        let records = list_workspace_registered_skills(ListWorkspaceRegisteredSkillsRequest {
            workspace_root: temp.path().to_string_lossy().to_string(),
        })
        .unwrap();

        assert!(records.is_empty());
    }

    #[test]
    fn list_workspace_registered_skills_discovers_p3a_registered_skill() {
        let temp = TempDir::new().unwrap();
        let created = create_capability_draft(standard_verifiable_request(temp.path())).unwrap();
        verify_capability_draft(VerifyCapabilityDraftRequest {
            workspace_root: temp.path().to_string_lossy().to_string(),
            draft_id: created.manifest.draft_id.clone(),
        })
        .unwrap();
        let registered = register_capability_draft(RegisterCapabilityDraftRequest {
            workspace_root: temp.path().to_string_lossy().to_string(),
            draft_id: created.manifest.draft_id.clone(),
        })
        .unwrap();

        let records = list_workspace_registered_skills(ListWorkspaceRegisteredSkillsRequest {
            workspace_root: temp.path().to_string_lossy().to_string(),
        })
        .unwrap();

        assert_eq!(records.len(), 1);
        let record = &records[0];
        assert_eq!(record.key, format!("workspace:{}", record.directory));
        assert_eq!(record.name, "只读 CLI 报告");
        assert_eq!(
            record.registration.source_draft_id,
            created.manifest.draft_id
        );
        assert_eq!(
            record.registration.skill_directory,
            registered.registration.skill_directory
        );
        assert!(!record.launch_enabled);
        assert!(record.runtime_gate.contains("tool_runtime 授权"));
        assert!(record.standard_compliance.is_standard);
        assert_eq!(
            record.permission_summary,
            registered.registration.permission_summary
        );
    }

    #[cfg(unix)]
    #[test]
    fn list_workspace_registered_skills_rejects_symlink_skill_directory() {
        use std::os::unix::fs::symlink;

        let temp = TempDir::new().unwrap();
        let skills_root = temp
            .path()
            .join(REGISTERED_SKILLS_ROOT_DIR_NAME)
            .join(REGISTERED_SKILLS_DIR_NAME);
        let outside = temp.path().join("outside-skill");
        fs::create_dir_all(&outside).unwrap();
        fs::write(
            outside.join("SKILL.md"),
            "---\nname: Outside\ndescription: escape\n---\n",
        )
        .unwrap();
        fs::create_dir_all(&skills_root).unwrap();
        symlink(&outside, skills_root.join("escape-skill")).unwrap();

        let error = list_workspace_registered_skills(ListWorkspaceRegisteredSkillsRequest {
            workspace_root: temp.path().to_string_lossy().to_string(),
        })
        .unwrap_err();

        assert!(error.contains("不允许是 symlink"));
    }
}
