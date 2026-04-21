use super::context::dto::SceneAppContextOverlay;
use lime_core::config::{AutomationExecutionMode, DeliveryConfig, TaskSchedule};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SceneAppType {
    LocalInstant,
    LocalDurable,
    BrowserGrounded,
    // legacy compat only：current 不再把 SceneApp 解释成云端托管执行面。
    CloudManaged,
    Hybrid,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SceneAppPattern {
    Pipeline,
    Generator,
    Reviewer,
    Inversion,
    ToolWrapper,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SceneAppBindingFamily {
    AgentTurn,
    BrowserAssist,
    AutomationJob,
    // legacy compat only：current 执行仍收敛到本地主链，cloud_scene 只保留历史目录输入。
    CloudScene,
    NativeSkill,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SceneAppDeliveryContract {
    ArtifactBundle,
    ProjectPack,
    TableReport,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SceneAppEntryBindingKind {
    ServiceSkill,
    Scene,
    Mention,
    WorkspaceCard,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SceneAppLaunchRequirementKind {
    UserInput,
    Project,
    BrowserSession,
    // legacy compat only：current 不再把云端会话当成启动门槛。
    CloudSession,
    Automation,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SceneAppRecommendedAction {
    Launch,
    Keep,
    Optimize,
    Retire,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SceneAppMetricStatus {
    Good,
    Watch,
    Risk,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SceneAppEntryBinding {
    pub kind: SceneAppEntryBindingKind,
    pub binding_family: SceneAppBindingFamily,
    pub service_skill_id: Option<String>,
    pub skill_key: Option<String>,
    pub scene_key: Option<String>,
    pub command_prefix: Option<String>,
    pub aliases: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SceneAppLaunchRequirement {
    pub kind: SceneAppLaunchRequirementKind,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SceneAppDeliveryProfile {
    pub artifact_profile_ref: Option<String>,
    pub viewer_kind: Option<String>,
    pub required_parts: Vec<String>,
    pub primary_part: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SceneAppCompositionStepDescriptor {
    pub id: String,
    pub order: usize,
    pub binding_profile_ref: Option<String>,
    pub binding_family: Option<SceneAppBindingFamily>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SceneAppCompositionProfile {
    pub blueprint_ref: Option<String>,
    pub step_count: usize,
    pub steps: Vec<SceneAppCompositionStepDescriptor>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SceneAppScorecardProfile {
    pub profile_ref: Option<String>,
    pub metric_keys: Vec<String>,
    pub failure_signals: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SceneAppDescriptor {
    pub id: String,
    pub title: String,
    pub summary: String,
    pub category: String,
    pub sceneapp_type: SceneAppType,
    pub pattern_primary: SceneAppPattern,
    pub pattern_stack: Vec<SceneAppPattern>,
    pub capability_refs: Vec<String>,
    pub infra_profile: Vec<String>,
    pub delivery_contract: SceneAppDeliveryContract,
    pub artifact_kind: Option<String>,
    pub output_hint: String,
    pub entry_bindings: Vec<SceneAppEntryBinding>,
    pub launch_requirements: Vec<SceneAppLaunchRequirement>,
    pub linked_service_skill_id: Option<String>,
    pub linked_scene_key: Option<String>,
    pub delivery_profile: Option<SceneAppDeliveryProfile>,
    pub composition_profile: Option<SceneAppCompositionProfile>,
    pub scorecard_profile: Option<SceneAppScorecardProfile>,
    pub aliases: Vec<String>,
    pub source_package_id: String,
    pub source_package_version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SceneAppCatalog {
    pub version: String,
    pub generated_at: String,
    pub items: Vec<SceneAppDescriptor>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SceneAppRuntimeContext {
    pub browser_session_attached: bool,
    // legacy compat only：保留旧目录/旧计划输入，不参与 current readiness。
    pub cloud_session_ready: bool,
    pub automation_enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SceneAppLaunchIntent {
    pub sceneapp_id: String,
    pub entry_source: Option<String>,
    pub workspace_id: Option<String>,
    pub project_id: Option<String>,
    pub user_input: Option<String>,
    #[serde(default)]
    pub reference_memory_ids: Vec<String>,
    #[serde(default)]
    pub slots: BTreeMap<String, String>,
    pub runtime_context: Option<SceneAppRuntimeContext>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SceneAppAutomationIntent {
    pub launch_intent: SceneAppLaunchIntent,
    pub name: Option<String>,
    pub description: Option<String>,
    pub schedule: Option<TaskSchedule>,
    pub enabled: Option<bool>,
    pub execution_mode: Option<AutomationExecutionMode>,
    pub delivery: Option<DeliveryConfig>,
    pub timeout_secs: Option<u64>,
    pub max_retries: Option<u32>,
    pub run_now: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SceneAppExecutionPlanStep {
    pub id: String,
    pub title: String,
    pub binding_family: SceneAppBindingFamily,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SceneAppExecutionPlan {
    pub sceneapp_id: String,
    pub executor_kind: SceneAppBindingFamily,
    pub binding_family: SceneAppBindingFamily,
    pub step_plan: Vec<SceneAppExecutionPlanStep>,
    pub adapter_plan: SceneAppRuntimeAdapterPlan,
    pub storage_strategy: String,
    pub artifact_contract: SceneAppDeliveryContract,
    pub governance_hooks: Vec<String>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SceneAppReadiness {
    pub ready: bool,
    pub unmet_requirements: Vec<SceneAppLaunchRequirement>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SceneAppProjectPackPlan {
    pub pack_kind: SceneAppDeliveryContract,
    pub primary_part: Option<String>,
    pub required_parts: Vec<String>,
    pub viewer_kind: Option<String>,
    pub completion_strategy: String,
    pub notes: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SceneAppPlanResult {
    pub descriptor: SceneAppDescriptor,
    pub readiness: SceneAppReadiness,
    pub plan: SceneAppExecutionPlan,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context_overlay: Option<SceneAppContextOverlay>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project_pack_plan: Option<SceneAppProjectPackPlan>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SceneAppAutomationRunResult {
    pub job_count: usize,
    pub success_count: usize,
    pub failed_count: usize,
    pub timeout_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SceneAppAutomationResult {
    pub sceneapp_id: String,
    pub job_id: String,
    pub job_name: String,
    pub enabled: bool,
    pub workspace_id: String,
    pub next_run_at: Option<String>,
    pub run_now_result: Option<SceneAppAutomationRunResult>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SceneAppRunStatus {
    Queued,
    Running,
    Success,
    Error,
    Canceled,
    Timeout,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SceneAppRuntimeAction {
    SubmitAgentTurn,
    LaunchBrowserAssist,
    CreateAutomationJob,
    #[serde(alias = "launch_cloud_scene")]
    OpenServiceSceneSession,
    LaunchNativeSkill,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SceneAppRuntimeAdapterPlan {
    pub adapter_kind: SceneAppBindingFamily,
    pub runtime_action: SceneAppRuntimeAction,
    pub target_ref: String,
    pub target_label: String,
    pub linked_service_skill_id: Option<String>,
    pub linked_scene_key: Option<String>,
    pub preferred_profile_key: Option<String>,
    pub request_metadata: Value,
    pub launch_payload: Value,
    pub notes: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SceneAppBrowserRuntimeRef {
    pub profile_key: Option<String>,
    pub session_id: Option<String>,
    pub target_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SceneAppServiceSceneRuntimeRef {
    pub scene_key: Option<String>,
    pub skill_id: Option<String>,
    pub project_id: Option<String>,
    pub content_id: Option<String>,
    pub workspace_id: Option<String>,
    pub entry_source: Option<String>,
    pub user_input: Option<String>,
    #[serde(default)]
    pub slots: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SceneAppNativeSkillRuntimeRef {
    pub skill_id: Option<String>,
    pub skill_key: Option<String>,
    pub project_id: Option<String>,
    pub workspace_id: Option<String>,
    pub user_input: Option<String>,
    #[serde(default)]
    pub slots: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SceneAppDeliveryArtifactRef {
    pub relative_path: String,
    pub absolute_path: Option<String>,
    pub part_key: Option<String>,
    pub project_id: Option<String>,
    pub workspace_id: Option<String>,
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SceneAppGovernanceArtifactKind {
    EvidenceSummary,
    ReviewDecisionMarkdown,
    ReviewDecisionJson,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SceneAppGovernanceArtifactRef {
    pub kind: SceneAppGovernanceArtifactKind,
    pub label: String,
    pub relative_path: String,
    pub absolute_path: Option<String>,
    pub project_id: Option<String>,
    pub workspace_id: Option<String>,
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SceneAppRunSummary {
    pub run_id: String,
    pub sceneapp_id: String,
    pub status: SceneAppRunStatus,
    pub source: String,
    pub source_ref: Option<String>,
    pub session_id: Option<String>,
    pub browser_runtime_ref: Option<SceneAppBrowserRuntimeRef>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        alias = "cloudSceneRuntimeRef",
        alias = "cloud_scene_runtime_ref"
    )]
    pub service_scene_runtime_ref: Option<SceneAppServiceSceneRuntimeRef>,
    pub native_skill_runtime_ref: Option<SceneAppNativeSkillRuntimeRef>,
    pub started_at: String,
    pub finished_at: Option<String>,
    pub artifact_count: usize,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub delivery_artifact_refs: Vec<SceneAppDeliveryArtifactRef>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub governance_artifact_refs: Vec<SceneAppGovernanceArtifactRef>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub delivery_required_parts: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub delivery_completed_parts: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub delivery_missing_parts: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub delivery_completion_rate: Option<f64>,
    #[serde(default)]
    pub delivery_part_coverage_known: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub failure_signal: Option<String>,
    #[serde(default)]
    pub runtime_evidence_used: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub evidence_known_gaps: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub verification_failure_outcomes: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub request_telemetry_available: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub request_telemetry_matched_count: Option<usize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub artifact_validator_applicable: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub artifact_validator_issue_count: Option<usize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub artifact_validator_recovered_count: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SceneAppScorecardMetric {
    pub key: String,
    pub label: String,
    pub value: f64,
    pub status: SceneAppMetricStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SceneAppScorecard {
    pub sceneapp_id: String,
    pub updated_at: String,
    pub summary: String,
    pub metrics: Vec<SceneAppScorecardMetric>,
    pub recommended_action: SceneAppRecommendedAction,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub observed_failure_signals: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub top_failure_signal: Option<String>,
}
