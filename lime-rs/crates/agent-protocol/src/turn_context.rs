use crate::CollaborationMode;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::path::PathBuf;

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnContextOverride {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cwd: Option<PathBuf>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub effort: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub approval_policy: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub approvals_reviewer: Option<crate::ApprovalsReviewer>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sandbox_policy: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sandbox_network_access: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub web_search_mode: Option<crate::WebSearchMode>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub collaboration_mode: Option<CollaborationMode>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_visible_input_text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_schema: Option<Value>,
    #[serde(skip, default)]
    pub output_schema_source: Option<TurnOutputSchemaSource>,
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub metadata: HashMap<String, Value>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TurnOutputSchemaSource {
    Session,
    Turn,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TurnOutputSchemaStrategy {
    Native,
    FinalOutputTool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnOutputSchemaRuntime {
    pub source: TurnOutputSchemaSource,
    pub strategy: TurnOutputSchemaStrategy,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model_name: Option<String>,
}
