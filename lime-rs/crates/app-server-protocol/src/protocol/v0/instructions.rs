use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct InstructionsReadResponse {
    pub path: String,
    pub contents: String,
    pub revision: String,
    pub has_override: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InstructionsWriteParams {
    pub contents: String,
    pub expected_revision: String,
}
