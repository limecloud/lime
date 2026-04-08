//! 延迟工具搜索与激活工具
//!
//! 对齐当前工具面：
//! - ToolSearch

use super::base::{PermissionCheckResult, Tool};
use super::context::{ToolContext, ToolResult};
use super::error::ToolError;
use super::registry::ToolRegistry;
use async_trait::async_trait;
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Weak};

use crate::agents::ExtensionManager;

const TOOL_SEARCH_TOOL_NAME: &str = "ToolSearch";
const TOOL_SURFACE_UPDATED_KEY: &str = "tool_surface_updated";

#[derive(Debug, Clone, Deserialize)]
struct ToolSearchInput {
    query: String,
    #[serde(default = "default_max_results", alias = "maxResults")]
    max_results: usize,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
struct ToolSearchOutput {
    matches: Vec<String>,
    query: String,
    total_deferred_tools: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct SearchableTool {
    name: String,
    description: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ParsedToolName {
    parts: Vec<String>,
    full: String,
    is_prefixed: bool,
    inner_name: Option<String>,
}

#[derive(Debug, Clone)]
struct ToolSearchState {
    all_tools: Vec<SearchableTool>,
    deferred_tools: Vec<SearchableTool>,
    visible_names: HashSet<String>,
}

pub struct ToolSearchTool {
    extension_manager: Weak<ExtensionManager>,
}

impl ToolSearchTool {
    pub fn new(extension_manager: Weak<ExtensionManager>) -> Self {
        Self { extension_manager }
    }

    fn extension_manager(&self) -> Result<Arc<ExtensionManager>, ToolError> {
        self.extension_manager
            .upgrade()
            .ok_or_else(|| ToolError::execution_failed("工具搜索管理器不可用，无法搜索延迟工具"))
    }
}

fn default_max_results() -> usize {
    5
}

fn map_extension_error(error: rmcp::model::ErrorData) -> ToolError {
    match error.code {
        rmcp::model::ErrorCode::INVALID_PARAMS => ToolError::invalid_params(error.message),
        _ => ToolError::execution_failed(error.message),
    }
}

async fn collect_tool_search_state(
    extension_manager: &ExtensionManager,
) -> Result<ToolSearchState, ToolError> {
    let all_tools = extension_manager
        .get_prefixed_tools_for_search(None)
        .await
        .map_err(|error| ToolError::execution_failed(error.to_string()))?;
    let visible_names = extension_manager
        .get_prefixed_tools(None)
        .await
        .map_err(|error| ToolError::execution_failed(error.to_string()))?
        .into_iter()
        .map(|tool| tool.name.to_string())
        .collect::<HashSet<_>>();

    let mut all_searchable = Vec::with_capacity(all_tools.len());
    let mut deferred_searchable = Vec::new();

    for tool in all_tools {
        let searchable = SearchableTool {
            name: tool.name.to_string(),
            description: tool.description.unwrap_or_default().to_string(),
        };

        if !visible_names.contains(&searchable.name) {
            deferred_searchable.push(searchable.clone());
        }

        all_searchable.push(searchable);
    }

    Ok(ToolSearchState {
        all_tools: all_searchable,
        deferred_tools: deferred_searchable,
        visible_names,
    })
}

fn parse_select_query(query: &str) -> Option<Vec<String>> {
    let prefix = "select:";
    let actual_prefix = query.get(..prefix.len())?;
    if !actual_prefix.eq_ignore_ascii_case(prefix) {
        return None;
    }

    Some(
        query
            .get(prefix.len()..)
            .unwrap_or("")
            .split(',')
            .map(str::trim)
            .filter(|name| !name.is_empty())
            .map(str::to_string)
            .collect(),
    )
}

fn resolve_selected_tools(
    requested: &[String],
    deferred_tools: &[SearchableTool],
    all_tools: &[SearchableTool],
) -> Vec<String> {
    let mut found = Vec::new();
    for requested_name in requested {
        let maybe_match = deferred_tools
            .iter()
            .find(|tool| tool.name.eq_ignore_ascii_case(requested_name))
            .or_else(|| {
                all_tools
                    .iter()
                    .find(|tool| tool.name.eq_ignore_ascii_case(requested_name))
            });

        if let Some(tool) = maybe_match {
            if !found.iter().any(|existing| existing == &tool.name) {
                found.push(tool.name.clone());
            }
        }
    }

    found
}

fn tool_search_lookup_key(value: &str) -> String {
    value
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .map(|character| character.to_ascii_lowercase())
        .collect()
}

fn parse_tool_name(name: &str) -> ParsedToolName {
    let is_mcp = name.starts_with("mcp__");
    let normalized = if is_mcp {
        name.trim_start_matches("mcp__")
    } else {
        name
    };
    let is_prefixed = normalized.contains("__");
    let segments = if is_prefixed {
        normalized.split("__").collect::<Vec<_>>()
    } else {
        vec![normalized]
    };

    let parts = segments
        .iter()
        .flat_map(|segment| split_identifier_parts(segment))
        .collect::<Vec<_>>();

    ParsedToolName {
        full: parts.join(" "),
        parts,
        is_prefixed,
        inner_name: (segments.len() > 1)
            .then(|| segments.last().unwrap_or(&"").to_ascii_lowercase()),
    }
}

fn split_identifier_parts(value: &str) -> Vec<String> {
    let characters = value.chars().collect::<Vec<_>>();
    let mut normalized = String::with_capacity(value.len() + 8);

    for (index, character) in characters.iter().enumerate() {
        let previous = index
            .checked_sub(1)
            .and_then(|position| characters.get(position))
            .copied();
        let next = characters.get(index + 1).copied();

        if character.is_ascii_uppercase() {
            let split_before = previous.is_some_and(|previous| {
                previous.is_ascii_lowercase()
                    || previous.is_ascii_digit()
                    || (previous.is_ascii_uppercase()
                        && next.is_some_and(|next| next.is_ascii_lowercase()))
            });
            if split_before && !normalized.ends_with(' ') {
                normalized.push(' ');
            }
            normalized.push(character.to_ascii_lowercase());
            continue;
        }

        if character.is_ascii_alphanumeric() {
            normalized.push(character.to_ascii_lowercase());
            continue;
        }

        if !normalized.ends_with(' ') {
            normalized.push(' ');
        }
    }

    normalized
        .split_whitespace()
        .filter(|part| !part.is_empty())
        .map(str::to_string)
        .collect()
}

fn compile_term_patterns(terms: &[&str]) -> HashMap<String, Regex> {
    let mut patterns = HashMap::new();
    for term in terms {
        patterns.entry((*term).to_string()).or_insert_with(|| {
            Regex::new(&format!(r"\b{}\b", regex::escape(term)))
                .expect("tool search term regex should compile")
        });
    }
    patterns
}

fn tool_search_exact_match(name: &str, query: &str) -> bool {
    let query_lower = query.trim().to_ascii_lowercase();
    if query_lower.is_empty() {
        return false;
    }

    if name.eq_ignore_ascii_case(&query_lower) {
        return true;
    }

    let query_key = tool_search_lookup_key(&query_lower);
    if !query_key.is_empty() && tool_search_lookup_key(name) == query_key {
        return true;
    }

    let parsed = parse_tool_name(name);
    parsed.inner_name.as_deref().is_some_and(|inner_name| {
        inner_name == query_lower || tool_search_lookup_key(inner_name) == query_key
    })
}

fn score_searchable_tool(
    tool: &SearchableTool,
    scoring_terms: &[&str],
    term_patterns: &HashMap<String, Regex>,
) -> i32 {
    let parsed = parse_tool_name(&tool.name);
    let description = tool.description.to_lowercase();
    let mut score = 0;

    for term in scoring_terms {
        let Some(pattern) = term_patterns.get(*term) else {
            continue;
        };

        let mut term_score = 0;

        if parsed.parts.iter().any(|part| part == term) {
            term_score += if parsed.is_prefixed { 12 } else { 10 };
        } else if parsed.parts.iter().any(|part| part.contains(term)) {
            term_score += if parsed.is_prefixed { 6 } else { 5 };
        }

        if term_score == 0 && parsed.full.contains(term) {
            term_score += 3;
        }

        if pattern.is_match(&description) {
            term_score += 2;
        }

        score += term_score;
    }

    score
}

fn score_query_match(
    query: &str,
    deferred_tools: &[SearchableTool],
    all_tools: &[SearchableTool],
) -> Vec<String> {
    let query_lower = query.trim().to_lowercase();
    if query_lower.is_empty() {
        return Vec::new();
    }

    if let Some(exact) = deferred_tools
        .iter()
        .find(|tool| tool_search_exact_match(&tool.name, &query_lower))
        .or_else(|| {
            all_tools
                .iter()
                .find(|tool| tool_search_exact_match(&tool.name, &query_lower))
        })
    {
        return vec![exact.name.clone()];
    }

    if query_lower.contains("__") {
        let prefix_matches = deferred_tools
            .iter()
            .filter(|tool| tool.name.to_lowercase().starts_with(&query_lower))
            .map(|tool| tool.name.clone())
            .collect::<Vec<_>>();
        if !prefix_matches.is_empty() {
            return prefix_matches;
        }
    }

    let query_terms = query_lower
        .split_whitespace()
        .filter(|term| !term.is_empty())
        .collect::<Vec<_>>();
    if query_terms.is_empty() {
        return Vec::new();
    }

    let mut required_terms = Vec::new();
    let mut optional_terms = Vec::new();
    for term in &query_terms {
        if let Some(required_term) = term.strip_prefix('+') {
            if !required_term.is_empty() {
                required_terms.push(required_term);
                continue;
            }
        }

        optional_terms.push(*term);
    }

    let scoring_terms = if required_terms.is_empty() {
        query_terms.clone()
    } else {
        required_terms
            .iter()
            .copied()
            .chain(optional_terms.iter().copied())
            .collect::<Vec<_>>()
    };
    let term_patterns = compile_term_patterns(&scoring_terms);

    let mut scored = Vec::new();
    for tool in deferred_tools {
        let parsed = parse_tool_name(&tool.name);
        let lower_description = tool.description.to_lowercase();

        let required_matches = required_terms.iter().all(|term| {
            let Some(pattern) = term_patterns.get(*term) else {
                return false;
            };
            parsed
                .parts
                .iter()
                .any(|part| part == term || part.contains(term))
                || parsed.full.contains(term)
                || pattern.is_match(&lower_description)
        });
        if !required_matches {
            continue;
        }

        let score = score_searchable_tool(tool, &scoring_terms, &term_patterns);

        if score == 0 {
            continue;
        }

        scored.push((score, tool.name.clone()));
    }

    scored.sort_by(|left, right| right.0.cmp(&left.0).then_with(|| left.1.cmp(&right.1)));
    scored.into_iter().map(|(_, name)| name).collect()
}

fn pretty_json<T: Serialize>(value: &T) -> Result<String, ToolError> {
    serde_json::to_string_pretty(value).map_err(|error| {
        ToolError::execution_failed(format!("序列化 ToolSearch 结果失败: {error}"))
    })
}

fn build_tool_search_result(
    output: &ToolSearchOutput,
    tool_surface_updated: bool,
) -> Result<ToolResult, ToolError> {
    let text = pretty_json(output)?;
    Ok(ToolResult::success(text)
        .with_metadata("matches", json!(&output.matches))
        .with_metadata("query", json!(&output.query))
        .with_metadata("total_deferred_tools", json!(output.total_deferred_tools))
        .with_metadata(TOOL_SURFACE_UPDATED_KEY, json!(tool_surface_updated)))
}

#[async_trait]
impl Tool for ToolSearchTool {
    fn name(&self) -> &str {
        TOOL_SEARCH_TOOL_NAME
    }

    fn description(&self) -> &str {
        "Searches deferred tools by keyword or select:<tool_a,tool_b> so their schemas can be loaded into the active tool surface."
    }

    fn input_schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Query to find deferred tools. Use select:<tool_name> for direct selection, or keywords to search."
                },
                "max_results": {
                    "type": "number",
                    "description": "Maximum number of results to return for keyword search (default: 5)"
                }
            },
            "required": ["query"]
        })
    }

    async fn execute(
        &self,
        params: serde_json::Value,
        _context: &ToolContext,
    ) -> Result<ToolResult, ToolError> {
        let input: ToolSearchInput = serde_json::from_value(params)
            .map_err(|error| ToolError::invalid_params(format!("参数解析失败: {error}")))?;
        let query = input.query.trim();
        if query.is_empty() {
            return Err(ToolError::invalid_params("query 不能为空"));
        }

        let max_results = input.max_results.max(1);
        let extension_manager = self.extension_manager()?;
        let state_before = collect_tool_search_state(extension_manager.as_ref()).await?;

        if let Some(requested) = parse_select_query(query) {
            if requested.is_empty() {
                return Err(ToolError::invalid_params("select: 查询至少需要一个工具名"));
            }

            let matches = resolve_selected_tools(
                &requested,
                &state_before.deferred_tools,
                &state_before.all_tools,
            );
            let mut tool_surface_updated = false;
            let mut total_deferred_tools = state_before.deferred_tools.len();

            if !matches.is_empty() {
                extension_manager
                    .load_deferred_tools(&matches)
                    .await
                    .map_err(map_extension_error)?;

                let state_after = collect_tool_search_state(extension_manager.as_ref()).await?;
                tool_surface_updated = state_after.visible_names != state_before.visible_names;
                total_deferred_tools = state_after.deferred_tools.len();
            }

            return build_tool_search_result(
                &ToolSearchOutput {
                    matches,
                    query: query.to_string(),
                    total_deferred_tools,
                },
                tool_surface_updated,
            );
        }

        let matches =
            score_query_match(query, &state_before.deferred_tools, &state_before.all_tools)
                .into_iter()
                .take(max_results)
                .collect::<Vec<_>>();

        build_tool_search_result(
            &ToolSearchOutput {
                matches,
                query: query.to_string(),
                total_deferred_tools: state_before.deferred_tools.len(),
            },
            false,
        )
    }

    async fn check_permissions(
        &self,
        _params: &serde_json::Value,
        _context: &ToolContext,
    ) -> PermissionCheckResult {
        PermissionCheckResult::allow()
    }
}

pub fn register_tool_search_tool(
    registry: &mut ToolRegistry,
    extension_manager: Weak<ExtensionManager>,
) {
    registry.register(Box::new(ToolSearchTool::new(extension_manager)));
}

#[cfg(test)]
mod tests {
    use super::*;

    fn searchable(name: &str, description: &str) -> SearchableTool {
        SearchableTool {
            name: name.to_string(),
            description: description.to_string(),
        }
    }

    #[test]
    fn test_parse_select_query_supports_comma_separated_names() {
        let parsed = parse_select_query("select:alpha__tool, beta__tool").unwrap();
        assert_eq!(
            parsed,
            vec!["alpha__tool".to_string(), "beta__tool".to_string()]
        );
    }

    #[test]
    fn test_resolve_selected_tools_falls_back_to_visible_tool_names() {
        let deferred = vec![searchable("alpha__tool", "alpha")];
        let all = vec![
            searchable("alpha__tool", "alpha"),
            searchable("beta__tool", "beta"),
        ];

        let matches = resolve_selected_tools(&["beta__tool".to_string()], &deferred, &all);

        assert_eq!(matches, vec!["beta__tool".to_string()]);
    }

    #[test]
    fn test_score_query_match_prefers_deferred_tool_keyword_hits() {
        let deferred = vec![
            searchable("slack__send_message", "send a Slack message"),
            searchable("slack__list_channels", "list Slack channels"),
        ];
        let all = deferred.clone();

        let matches = score_query_match("slack send", &deferred, &all);

        assert_eq!(
            matches,
            vec![
                "slack__send_message".to_string(),
                "slack__list_channels".to_string()
            ]
        );
    }

    #[test]
    fn test_score_query_match_supports_required_terms() {
        let deferred = vec![
            searchable("slack__send_message", "send a Slack message"),
            searchable("github__send_issue", "send a GitHub issue"),
        ];
        let all = deferred.clone();

        let matches = score_query_match("+slack send", &deferred, &all);

        assert_eq!(matches, vec!["slack__send_message".to_string()]);
    }

    #[test]
    fn test_score_query_match_splits_camel_case_names() {
        let deferred = vec![
            searchable("BrowserNavigate", "navigate browser tabs"),
            searchable("BrowserClick", "click browser element"),
        ];
        let all = deferred.clone();

        let matches = score_query_match("browser click", &deferred, &all);

        assert_eq!(matches, vec!["BrowserClick".to_string()]);
    }

    #[test]
    fn test_score_query_match_supports_prefixed_tool_prefix_queries() {
        let deferred = vec![
            searchable("mcp__playwright__browser_click", "click browser element"),
            searchable("mcp__playwright__browser_navigate", "navigate browser page"),
        ];
        let all = deferred.clone();

        let matches = score_query_match("mcp__playwright", &deferred, &all);

        assert_eq!(
            matches,
            vec![
                "mcp__playwright__browser_click".to_string(),
                "mcp__playwright__browser_navigate".to_string()
            ]
        );
    }

    #[test]
    fn test_tool_search_exact_match_supports_inner_prefixed_name() {
        assert!(tool_search_exact_match(
            "mcp__playwright__browser_click",
            "browser_click"
        ));
        assert!(tool_search_exact_match("BrowserClick", "browser_click"));
    }

    #[test]
    fn test_score_query_match_prefers_exact_inner_prefixed_tool_name() {
        let deferred = vec![
            searchable("mcp__playwright__browser_click", "click browser element"),
            searchable("mcp__playwright__browser_navigate", "navigate browser page"),
        ];
        let all = deferred.clone();

        let matches = score_query_match("browser_click", &deferred, &all);

        assert_eq!(matches, vec!["mcp__playwright__browser_click".to_string()]);
    }

    #[test]
    fn test_build_tool_search_result_sets_refresh_marker() {
        let output = ToolSearchOutput {
            matches: vec!["alpha__tool".to_string()],
            query: "select:alpha__tool".to_string(),
            total_deferred_tools: 3,
        };

        let result = build_tool_search_result(&output, true).unwrap();

        assert_eq!(
            result.metadata.get(TOOL_SURFACE_UPDATED_KEY),
            Some(&json!(true))
        );
    }
}
