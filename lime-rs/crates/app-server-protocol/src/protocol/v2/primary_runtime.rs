use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum PrimaryRuntimeInstallPhase {
    Downloading,
    Verifying,
    Extracting,
    Validating,
    Configuring,
    Ready,
    Canceled,
    Error,
}

impl PrimaryRuntimeInstallPhase {
    pub fn is_active(self) -> bool {
        !matches!(self, Self::Ready | Self::Canceled | Self::Error)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PrimaryRuntimeInstallProgress {
    pub id: String,
    pub phase: PrimaryRuntimeInstallPhase,
    pub downloaded_bytes: u64,
    pub total_bytes: Option<u64>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(default, deny_unknown_fields, rename_all = "camelCase")]
pub struct DiagnoseDependenciesParams {
    pub probe_executables: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DiagnoseDependenciesResponse {
    pub supported: bool,
    pub enabled: bool,
    pub installed: bool,
    pub bundle_version: Option<String>,
    pub expected_version: String,
    pub problems: Vec<String>,
    pub update: Option<PrimaryRuntimeInstallProgress>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(default, deny_unknown_fields, rename_all = "camelCase")]
pub struct RunUpdateNowParams {}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct InstallDependenciesResponse {
    pub update: PrimaryRuntimeInstallProgress,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct CancelInstallParams {
    pub id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CancelInstallResponse {
    pub canceled: bool,
}
