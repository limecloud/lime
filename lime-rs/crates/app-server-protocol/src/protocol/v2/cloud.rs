use super::Account;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Authenticated client APIs at the current account's issuer. No caller credentials or URL.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CloudRequestParams {
    pub path: String,
    pub method: CloudRequestMethod,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub body: Option<Value>,
    pub language: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub operation_key: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub task_id: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "UPPERCASE")]
pub enum CloudRequestMethod {
    Get,
    Post,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CloudRequestResponse {
    pub account: Account,
    pub status: u16,
    pub body: Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub operation: Option<CloudOperationReference>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CloudOperationReference {
    pub key: String,
    pub task_id: String,
    pub recovery_path: String,
    pub status: String,
}
