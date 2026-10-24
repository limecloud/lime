use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalEnvironmentsListParams {
    pub workspace_root: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub host_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalEnvironmentsReadConfigParams {
    pub config_path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub host_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalEnvironmentsSaveConfigParams {
    pub config_path: String,
    pub expected_revision: Option<String>,
    pub raw: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub host_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct LocalEnvironmentScript {
    pub script: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct LocalEnvironmentLifecycle {
    pub script: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub darwin: Option<LocalEnvironmentScript>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub linux: Option<LocalEnvironmentScript>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub win32: Option<LocalEnvironmentScript>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum LocalEnvironmentPlatform {
    Darwin,
    Linux,
    Win32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum LocalEnvironmentActionIcon {
    Tool,
    Run,
    Debug,
    Test,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct LocalEnvironmentAction {
    pub name: String,
    pub icon: Option<LocalEnvironmentActionIcon>,
    pub command: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub platform: Option<LocalEnvironmentPlatform>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct LocalEnvironment {
    pub version: u32,
    pub name: String,
    pub setup: LocalEnvironmentLifecycle,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cleanup: Option<LocalEnvironmentLifecycle>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub actions: Option<Vec<LocalEnvironmentAction>>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct LocalEnvironmentError {
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum LocalEnvironmentResult {
    #[serde(rename_all = "camelCase")]
    Success {
        config_path: String,
        cwd_relative_to_git_root: String,
        environment: LocalEnvironment,
    },
    #[serde(rename_all = "camelCase")]
    Error {
        config_path: String,
        cwd_relative_to_git_root: String,
        error: LocalEnvironmentError,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct LocalEnvironmentsListResponse {
    pub environments: Vec<LocalEnvironmentResult>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct LocalEnvironmentsReadConfigResponse {
    pub config_path: String,
    pub exists: bool,
    pub revision: Option<String>,
    pub raw: Option<String>,
    pub environment: Option<LocalEnvironmentResult>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum LocalEnvironmentSaveStatus {
    Success,
    Conflict,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct LocalEnvironmentsSaveConfigResponse {
    pub config_path: String,
    #[serde(rename = "type")]
    pub status: LocalEnvironmentSaveStatus,
    pub revision: Option<String>,
}
