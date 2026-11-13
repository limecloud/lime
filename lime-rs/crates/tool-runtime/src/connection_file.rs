use crate::tool_definition::RuntimeToolDefinition;
use serde::Deserialize;
use serde_json::{json, Value};

pub const READ_CONNECTED_FILE_TOOL_NAME: &str = "ReadConnectedFile";

pub fn connected_file_tool_definition() -> RuntimeToolDefinition {
    RuntimeToolDefinition::new(READ_CONNECTED_FILE_TOOL_NAME,
        "Read a Google document through the user's connected account. Use the document URL supplied by the user. A priced read requires the quoted price_version and an explicitly accepted max_credits budget; never choose a budget for the user. The user selects and approves the file in their browser; opening the browser does not grant access. Continue the original call after approval. Never retry a denied or unknown operation under a new key unless the user requests a new task.",
        json!({"type":"object","additionalProperties":false,"properties":{
            "url":{"type":"string","description":"The Google document URL supplied by the user."},
            "max_characters":{"type":"integer","minimum":1,"maximum":50000,"default":20000},
            "operation_key":{"type":"string","pattern":"^tool_[a-f0-9]{64}$","description":"Resume the original operation with unchanged arguments; never create another file request."}
        },"required":["url"]}))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReadConnectedFileInput {
    pub url: String,
    #[serde(default = "default_limit")]
    pub max_characters: usize,
    #[serde(default)]
    pub operation_key: Option<String>,
    pub price_version: Option<String>,
    pub max_credits: Option<String>,
}

fn default_limit() -> usize {
    20000
}

impl ReadConnectedFileInput {
    pub fn parse(value: &Value) -> Result<(Self, String), String> {
        let input: Self =
            serde_json::from_value(value.clone()).map_err(|_| "connection_tool_input_invalid")?;
        if !(1..=50000).contains(&input.max_characters)
            || input.url.len() > 2048
            || input.operation_key.as_deref().is_some_and(|key| {
                !key.strip_prefix("tool_").is_some_and(|key| {
                    key.len() == 64
                        && key
                            .bytes()
                            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
                })
            })
        {
            return Err("connection_tool_input_invalid".into());
        }
        let url = reqwest::Url::parse(&input.url).map_err(|_| "connection_tool_input_invalid")?;
        let parts: Vec<_> = url.path().split('/').collect();
        if url.scheme() != "https"
            || url.host_str() != Some("docs.google.com")
            || url.port().is_some()
            || !url.username().is_empty()
            || url.password().is_some()
            || parts.len() < 4
            || parts[..3] != ["", "document", "d"]
            || !file_id(parts[3])
            || !matches!(&parts[4..], [] | [""] | ["edit"] | ["view"] | ["preview"])
        {
            return Err("connection_tool_input_invalid".into());
        }
        let id = parts[3].to_owned();
        Ok((input, id))
    }
}

fn file_id(value: &str) -> bool {
    (1..=256).contains(&value.len())
        && value
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'_' | b'-'))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn document_links_are_references_and_never_arbitrary_network_targets() {
        for url in [
            "https://docs.google.com/document/d/doc_original/edit?usp=sharing#heading=h",
            "https://docs.google.com/document/d/doc_original",
        ] {
            let (_, id) = ReadConnectedFileInput::parse(&json!({"url":url})).unwrap();
            assert_eq!(id, "doc_original");
        }
        for value in [
            json!({"url":"http://docs.google.com/document/d/doc_original/edit"}),
            json!({"url":"https://docs.google.com.attacker.test/document/d/doc_original/edit"}),
            json!({"url":"https://user:password@docs.google.com/document/d/doc_original/edit"}),
            json!({"url":"https://docs.google.com/document/d/doc_original/../../else"}),
            json!({"url":"https://docs.google.com/document/d/doc_original/export"}),
            json!({"url":"https://docs.google.com/document/d/%64oc_original/edit"}),
            json!({"url":"https://docs.google.com/document/d/doc_original/edit","max_characters":0}),
            json!({"url":"https://docs.google.com/document/d/doc_original/edit","max_characters":50001}),
            json!({"url":"https://docs.google.com/document/d/doc_original/edit","token":"secret"}),
        ] {
            assert!(ReadConnectedFileInput::parse(&value).is_err(), "{value}");
        }
    }

    #[test]
    fn gateway_registration_validates_arguments_without_claiming_cloud_access() {
        let params = json!({"url":"https://docs.google.com/document/d/doc_original/edit"});
        let result = crate::native_overlay::check_runtime_gateway_tool_permissions(
            READ_CONNECTED_FILE_TOOL_NAME,
            &params,
            std::path::Path::new("."),
            "session",
            None,
        );
        assert!(matches!(
            result,
            crate::native_overlay::RuntimeNativePermissionDecision::Allow
        ));
        let result = crate::native_overlay::check_runtime_gateway_tool_permissions(
            READ_CONNECTED_FILE_TOOL_NAME,
            &json!({"url":"http://127.0.0.1/"}),
            std::path::Path::new("."),
            "session",
            None,
        );
        assert!(!matches!(
            result,
            crate::native_overlay::RuntimeNativePermissionDecision::Allow
        ));
    }
}
