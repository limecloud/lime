use crate::naming::extract_runtime_inner_tool_name;
use crate::types::{McpServerConfig, McpToolDefinition};
use lime_core::tool_calling::{self, ToolSurfaceMetadata};
use std::collections::{HashMap, HashSet};

const AUTO_DEFER_TOOL_COUNT_THRESHOLD: usize = 6;

pub fn extract_tool_metadata(
    tool_name: &str,
    input_schema: &serde_json::Value,
) -> ToolSurfaceMetadata {
    tool_calling::extract_tool_surface_metadata(tool_name, input_schema)
}

pub fn apply_runtime_tool_names(tools: Vec<McpToolDefinition>) -> Vec<McpToolDefinition> {
    tools
        .into_iter()
        .map(|mut tool| {
            let original_name = tool.name.clone();
            tool.name = crate::naming::build_runtime_tool_name(&tool.server_name, &original_name);
            tool
        })
        .collect()
}

pub fn apply_default_loading_policy(tools: Vec<McpToolDefinition>) -> Vec<McpToolDefinition> {
    let mut server_tool_counts: HashMap<String, usize> = HashMap::new();
    for tool in &tools {
        *server_tool_counts
            .entry(tool.server_name.clone())
            .or_insert(0) += 1;
    }

    tools
        .into_iter()
        .map(|mut tool| {
            if tool.deferred_loading.is_none() {
                let should_auto_defer = server_tool_counts
                    .get(&tool.server_name)
                    .copied()
                    .unwrap_or_default()
                    > AUTO_DEFER_TOOL_COUNT_THRESHOLD
                    && !tool.always_visible.unwrap_or(false);
                tool.deferred_loading = Some(should_auto_defer);
            }
            tool
        })
        .collect()
}

pub fn apply_server_tool_filters(
    tools: Vec<McpToolDefinition>,
    config_by_server: &HashMap<String, McpServerConfig>,
) -> Vec<McpToolDefinition> {
    tools
        .into_iter()
        .filter(|tool| {
            let Some(config) = config_by_server.get(&tool.server_name) else {
                return true;
            };
            let inner_tool_name = extract_runtime_inner_tool_name(&tool.server_name, &tool.name)
                .unwrap_or(&tool.name);
            config.tool_is_enabled(inner_tool_name)
        })
        .collect()
}

pub fn tool_visible_for_context(
    tool: &McpToolDefinition,
    caller: Option<&str>,
    include_deferred: bool,
) -> bool {
    let metadata = ToolSurfaceMetadata {
        deferred_loading: tool.deferred_loading,
        always_visible: tool.always_visible,
        allowed_callers: tool.allowed_callers.clone(),
        tags: tool.tags.clone(),
        input_examples: tool.input_examples.clone().unwrap_or_default(),
    };

    tool_calling::tool_visible_in_context(&metadata, include_deferred)
        && tool_calling::tool_matches_caller(&metadata, caller)
}

pub fn score_tool_match(tool: &McpToolDefinition, query: &str) -> i32 {
    let tags = tool.tags.as_deref().unwrap_or(&[]);
    let inner_tool_name =
        extract_runtime_inner_tool_name(&tool.server_name, &tool.name).unwrap_or(&tool.name);
    let mut score = [
        tool_calling::score_tool_match(&tool.name, &tool.description, tags, query),
        tool_calling::score_tool_match(inner_tool_name, &tool.description, tags, query),
    ]
    .into_iter()
    .max()
    .unwrap_or(0);

    if inner_tool_name.eq_ignore_ascii_case(query) {
        score += 10;
    }

    if tool.always_visible.unwrap_or(false) {
        return score + 5;
    }

    score
}

pub fn caller_is_allowed(tool: &McpToolDefinition, caller: &str) -> bool {
    let Some(allowed) = tool.allowed_callers.as_ref() else {
        return true;
    };
    let allowed_set: HashSet<String> = allowed
        .iter()
        .map(|value| value.trim().to_ascii_lowercase())
        .filter(|value| !value.is_empty())
        .collect();

    allowed_set.is_empty() || allowed_set.contains(&caller.to_ascii_lowercase())
}

#[cfg(test)]
pub(crate) const TEST_AUTO_DEFER_TOOL_COUNT_THRESHOLD: usize = AUTO_DEFER_TOOL_COUNT_THRESHOLD;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::McpServerTransport;

    fn config_with_tool_filters(
        enabled_tools: Option<Vec<&str>>,
        disabled_tools: Vec<&str>,
    ) -> McpServerConfig {
        McpServerConfig {
            transport: McpServerTransport::Stdio {
                env_vars: Vec::new(),
                command: "node".to_string(),
                args: Vec::new(),
                env: HashMap::new(),
                cwd: None,
            },
            environment_id: crate::types::DEFAULT_MCP_SERVER_ENVIRONMENT_ID.to_string(),
            enabled: true,
            startup_timeout: 30,
            tool_timeout: None,
            enabled_tools: enabled_tools.map(|tools| {
                tools
                    .into_iter()
                    .map(ToString::to_string)
                    .collect::<Vec<_>>()
            }),
            disabled_tools: disabled_tools
                .into_iter()
                .map(ToString::to_string)
                .collect::<Vec<_>>(),
            required: false,
            supports_parallel_tool_calls: false,
            scopes: None,
            oauth: None,
            oauth_resource: None,
        }
    }

    fn tool(name: &str) -> McpToolDefinition {
        McpToolDefinition {
            name: name.to_string(),
            description: name.to_string(),
            input_schema: serde_json::json!({}),
            output_schema: None,
            server_name: "docs".to_string(),
            deferred_loading: None,
            always_visible: None,
            allowed_callers: None,
            input_examples: None,
            tags: None,
        }
    }

    #[test]
    fn server_tool_filters_match_runtime_names_by_inner_tool_name() {
        let tools = vec![
            tool("mcp__docs__search"),
            tool("mcp__docs__delete"),
            tool("mcp__docs__other"),
        ];
        let config_by_server = HashMap::from([(
            "docs".to_string(),
            config_with_tool_filters(Some(vec!["search", "delete"]), vec!["delete"]),
        )]);

        let resolved = apply_server_tool_filters(tools, &config_by_server);

        assert_eq!(resolved.len(), 1);
        assert_eq!(resolved[0].name, "mcp__docs__search");
    }
}
