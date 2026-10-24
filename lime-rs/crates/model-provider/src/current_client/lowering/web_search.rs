use agent_protocol::WebSearchMode;
use runtime_core::CanonicalToolDefinition;
use serde_json::{json, Value};

pub(super) fn visible(tool: &CanonicalToolDefinition, mode: Option<WebSearchMode>) -> bool {
    matches!(
        mode,
        Some(WebSearchMode::Cached | WebSearchMode::Indexed | WebSearchMode::Live)
    ) || !matches!(tool, CanonicalToolDefinition::Function { name, .. } if super::is_web_search_tool_name(name))
}

pub(super) fn hosted_definition(mode: WebSearchMode) -> Value {
    match mode {
        WebSearchMode::Disabled => unreachable!("disabled search is filtered before lowering"),
        WebSearchMode::Cached => json!({"type":"web_search", "external_web_access":false}),
        WebSearchMode::Indexed => {
            json!({"type":"web_search", "external_web_access":true, "indexed_web_access":true})
        }
        WebSearchMode::Live => json!({"type":"web_search", "external_web_access":true}),
    }
}
