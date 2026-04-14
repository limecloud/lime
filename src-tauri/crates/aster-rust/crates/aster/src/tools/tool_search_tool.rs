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
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Weak};

use crate::agents::ExtensionManager;

const TOOL_SEARCH_TOOL_NAME: &str = "ToolSearch";
const TOOL_SURFACE_UPDATED_KEY: &str = "tool_surface_updated";
const BUILTIN_VISIBLE_NATIVE_TOOLS: &[(&str, &str)] = &[
    ("Read", "Read file contents with line-aware output."),
    ("Write", "Create or overwrite files."),
    ("Edit", "Apply targeted edits to existing files."),
    ("Glob", "Find files by path pattern."),
    ("Grep", "Search file contents by pattern."),
    ("Bash", "Run shell commands in the workspace."),
    ("WebFetch", "Fetch and read a specific URL."),
    ("WebSearch", "Search the web for current information."),
    (
        "StructuredOutput",
        "Return the final JSON answer for the current turn without re-searching tools.",
    ),
    (
        "AskUserQuestion",
        "Ask the user for clarification or missing information.",
    ),
];

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pending_mcp_servers: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    notes: Vec<String>,
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
    let mut visible_names = visible_names;

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

    append_builtin_visible_native_tools(&mut all_searchable, &mut visible_names);

    Ok(ToolSearchState {
        all_tools: all_searchable,
        deferred_tools: deferred_searchable,
        visible_names,
    })
}

fn append_builtin_visible_native_tools(
    all_tools: &mut Vec<SearchableTool>,
    visible_names: &mut HashSet<String>,
) {
    for (name, description) in BUILTIN_VISIBLE_NATIVE_TOOLS {
        visible_names.insert((*name).to_string());
        if all_tools
            .iter()
            .any(|tool| tool.name.eq_ignore_ascii_case(name))
        {
            continue;
        }
        all_tools.push(SearchableTool {
            name: (*name).to_string(),
            description: (*description).to_string(),
        });
    }
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
            .filter_map(|tool| {
                select_match_rank(&tool.name, requested_name).map(|rank| (rank, &tool.name))
            })
            .max_by(|left, right| left.0.cmp(&right.0).then_with(|| right.1.cmp(left.1)))
            .map(|(_, name)| name)
            .or_else(|| {
                all_tools
                    .iter()
                    .filter_map(|tool| {
                        select_match_rank(&tool.name, requested_name).map(|rank| (rank, &tool.name))
                    })
                    .max_by(|left, right| left.0.cmp(&right.0).then_with(|| right.1.cmp(left.1)))
                    .map(|(_, name)| name)
            });

        if let Some(tool) = maybe_match {
            if !found.iter().any(|existing| existing == tool) {
                found.push(tool.clone());
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

fn native_tool_search_aliases(name: &str) -> &'static [&'static str] {
    match tool_search_lookup_key(name).as_str() {
        "read" | "readtool" => &[
            "read_file",
            "read file",
            "open file",
            "workspace file",
            "project file",
        ],
        "write" | "writetool" => &[
            "write_file",
            "write file",
            "create_file",
            "create file",
            "save file",
            "workspace file",
            "project file",
        ],
        "edit" | "edittool" => &[
            "edit_file",
            "edit file",
            "modify file",
            "patch file",
            "workspace file",
            "project file",
        ],
        "glob" | "globtool" => &[
            "find_files",
            "find files",
            "file_search",
            "list files",
            "path search",
        ],
        "grep" | "greptool" => &[
            "search_files",
            "search files",
            "search in files",
            "content search",
            "text search",
        ],
        "bash" | "bashtool" => &[
            "system",
            "shell",
            "terminal",
            "run command",
            "command execution",
        ],
        "taskcreate" | "taskcreatetool" => &["create task", "new task", "task board", "task list"],
        "taskget" | "taskgettool" => &["get task", "task details", "read task"],
        "tasklist" | "tasklisttool" => &["list tasks", "task list", "todo list"],
        "taskupdate" | "taskupdatetool" => {
            &["update task", "complete task", "mark task", "task status"]
        }
        "taskoutput" | "taskoutputtool" => &[
            "agent output",
            "bash output",
            "task output",
            "task logs",
            "read task output",
        ],
        "taskstop" | "taskstoptool" => {
            &["kill shell", "stop task", "cancel task", "terminate task"]
        }
        "teamcreate" | "teamcreatetool" => &["create team", "create swarm", "swarm team"],
        "teamdelete" | "teamdeletetool" => &["delete team", "cleanup team", "disband swarm"],
        "listpeers" | "listpeerstool" => &[
            "list peers",
            "peer discovery",
            "swarm peers",
            "message peers",
        ],
        "webfetch" | "webfetchtool" => &["fetch url", "fetch page", "read url", "web reader"],
        "websearch" | "websearchtool" => &["search web", "internet search", "web search"],
        "structuredoutput" | "syntheticoutputtool" => &[
            "structured output",
            "final output",
            "final output tool",
            "final response",
        ],
        "askuserquestion" | "askuserquestiontool" => {
            &["request_user_input", "ask user", "user input"]
        }
        "toolsearch" | "toolsearchtool" => &["tool lookup", "search tools", "find tool"],
        _ => &[],
    }
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
    let name_key = tool_search_lookup_key(name);
    if !query_key.is_empty() && name_key == query_key {
        return true;
    }

    if query_key
        .strip_suffix("tool")
        .is_some_and(|stripped| !stripped.is_empty() && stripped == name_key)
    {
        return true;
    }

    let parsed = parse_tool_name(name);
    if parsed.inner_name.as_deref().is_some_and(|inner_name| {
        inner_name == query_lower || tool_search_lookup_key(inner_name) == query_key
    }) {
        return true;
    }

    let query_parts = split_identifier_parts(&query_lower);
    if parsed.inner_name.as_deref().is_some_and(|inner_name| {
        let inner_parts = split_identifier_parts(inner_name);
        inner_parts.len() >= 2
            && (suffix_identifier_match(&inner_parts, &query_parts)
                || suffix_identifier_match(&query_parts, &inner_parts))
    }) {
        return true;
    }

    native_tool_search_aliases(name).iter().any(|alias| {
        alias.eq_ignore_ascii_case(&query_lower)
            || (!query_key.is_empty() && tool_search_lookup_key(alias) == query_key)
    })
}

fn suffix_identifier_match(parts: &[String], suffix: &[String]) -> bool {
    !suffix.is_empty()
        && suffix.len() <= parts.len()
        && parts[(parts.len() - suffix.len())..]
            .iter()
            .zip(suffix.iter())
            .all(|(left, right)| left == right)
}

fn select_match_rank(name: &str, query: &str) -> Option<i32> {
    let query_lower = query.trim().to_ascii_lowercase();
    if query_lower.is_empty() {
        return None;
    }

    if name.eq_ignore_ascii_case(&query_lower) {
        return Some(500);
    }

    let query_key = tool_search_lookup_key(&query_lower);
    let name_key = tool_search_lookup_key(name);
    if !query_key.is_empty() && name_key == query_key {
        return Some(450);
    }

    if query_key
        .strip_suffix("tool")
        .is_some_and(|stripped| !stripped.is_empty() && stripped == name_key)
    {
        return Some(430);
    }

    let parsed = parse_tool_name(name);
    if let Some(inner_name) = parsed.inner_name.as_deref() {
        if inner_name == query_lower {
            return Some(420);
        }
        if !query_key.is_empty() && tool_search_lookup_key(inner_name) == query_key {
            return Some(400);
        }

        let query_parts = split_identifier_parts(&query_lower);
        let inner_parts = split_identifier_parts(inner_name);
        let looks_like_identifier =
            query_lower.contains('_') || query_lower.contains('-') || query_lower.contains(' ');
        if looks_like_identifier
            && inner_parts.len() >= 2
            && query_parts.len() >= 2
            && (suffix_identifier_match(&inner_parts, &query_parts)
                || suffix_identifier_match(&query_parts, &inner_parts))
        {
            return Some(360);
        }
    }

    if native_tool_search_aliases(name).iter().any(|alias| {
        alias.eq_ignore_ascii_case(&query_lower)
            || (!query_key.is_empty() && tool_search_lookup_key(alias) == query_key)
    }) {
        return Some(350);
    }

    None
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

    let raw_query_terms = query_lower
        .split_whitespace()
        .filter(|term| !term.is_empty())
        .collect::<Vec<_>>();
    if raw_query_terms.is_empty() {
        return Vec::new();
    }

    let mut required_terms = Vec::new();
    let mut optional_terms = Vec::new();
    for term in &raw_query_terms {
        let (required, normalized_term) = if let Some(required_term) = term.strip_prefix('+') {
            (true, required_term)
        } else {
            (false, *term)
        };
        if normalized_term.is_empty() {
            continue;
        }

        let split_terms = split_identifier_parts(normalized_term);
        let target = if required {
            &mut required_terms
        } else {
            &mut optional_terms
        };
        if split_terms.is_empty() {
            target.push(normalized_term.to_string());
        } else {
            target.extend(split_terms);
        }
    }

    if required_terms.is_empty() && optional_terms.is_empty() {
        return Vec::new();
    }

    let scoring_terms = if required_terms.is_empty() {
        optional_terms.clone()
    } else {
        required_terms
            .iter()
            .cloned()
            .chain(optional_terms.iter().cloned())
            .collect::<Vec<_>>()
    };
    let scoring_term_refs = scoring_terms.iter().map(String::as_str).collect::<Vec<_>>();
    let term_patterns = compile_term_patterns(&scoring_term_refs);

    let mut scored = Vec::new();
    for tool in deferred_tools {
        let parsed = parse_tool_name(&tool.name);
        let lower_description = tool.description.to_lowercase();

        let required_matches = required_terms.iter().all(|term| {
            let Some(pattern) = term_patterns.get(term.as_str()) else {
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

        let score = score_searchable_tool(tool, &scoring_term_refs, &term_patterns);

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

fn build_tool_search_notes(query: &str, matches: &[String]) -> Vec<String> {
    if !matches.is_empty() {
        return Vec::new();
    }

    let trimmed = query.trim();
    if trimmed.is_empty() {
        return Vec::new();
    }

    let mut notes = Vec::new();
    if parse_select_query(trimmed).is_some() {
        notes.push(
            "未命中任何工具。不要继续用同义词反复重试；优先直接调用当前已可见的原生工具，如 Read / Write / Edit / Glob / Grep / Bash / WebFetch / WebSearch / StructuredOutput。".to_string(),
        );
    } else {
        notes.push(
            "未命中任何 deferred 工具。若你需要文件、命令、网页或最终答复能力，请直接调用当前已可见的 Read / Write / Edit / Glob / Grep / Bash / WebFetch / WebSearch / StructuredOutput，而不是继续用 ToolSearch 改写同义词。".to_string(),
        );
    }
    notes
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
        .with_metadata("pending_mcp_servers", json!(&output.pending_mcp_servers))
        .with_metadata("notes", json!(&output.notes))
        .with_metadata(TOOL_SURFACE_UPDATED_KEY, json!(tool_surface_updated)))
}

async fn pending_mcp_servers_for_empty_result(
    extension_manager: &ExtensionManager,
    matches: &[String],
) -> Option<Vec<String>> {
    if !matches.is_empty() {
        return None;
    }

    let pending = extension_manager.list_pending_extensions().await;
    if pending.is_empty() {
        None
    } else {
        Some(pending)
    }
}

#[async_trait]
impl Tool for ToolSearchTool {
    fn name(&self) -> &str {
        TOOL_SEARCH_TOOL_NAME
    }

    fn description(&self) -> &str {
        "Fetches full schema definitions for deferred extension/MCP tools so they can be called. Use select:<tool_name> for direct selection, or keywords like \"browser click\" / \"+playwright click\". Do not use ToolSearch for already-visible native tools such as Read, Write, Edit, Glob, Grep, or StructuredOutput."
    }

    fn input_schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Query to find deferred extension/MCP tools. Use select:<tool_name>[,<tool_name>] for direct selection, or keywords like browser click / +playwright click. Do not use this for already-visible native tools such as Read/Write/Edit/Glob/Grep/StructuredOutput."
                },
                "max_results": {
                    "type": "number",
                    "description": "Maximum number of results to return for keyword search (default: 5)"
                }
            },
            "required": ["query"],
            "additionalProperties": false
        })
    }

    async fn execute(
        &self,
        params: Value,
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

            let deferred_match_names = matches
                .iter()
                .filter(|name| {
                    state_before
                        .deferred_tools
                        .iter()
                        .any(|tool| tool.name.eq_ignore_ascii_case(name))
                })
                .cloned()
                .collect::<Vec<_>>();

            if !deferred_match_names.is_empty() {
                extension_manager
                    .load_deferred_tools(&deferred_match_names)
                    .await
                    .map_err(map_extension_error)?;

                let state_after = collect_tool_search_state(extension_manager.as_ref()).await?;
                tool_surface_updated = state_after.visible_names != state_before.visible_names;
                total_deferred_tools = state_after.deferred_tools.len();
            }

            let pending_mcp_servers =
                pending_mcp_servers_for_empty_result(extension_manager.as_ref(), &matches).await;
            return build_tool_search_result(
                &ToolSearchOutput {
                    pending_mcp_servers,
                    notes: build_tool_search_notes(query, &matches),
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
        let pending_mcp_servers =
            pending_mcp_servers_for_empty_result(extension_manager.as_ref(), &matches).await;

        build_tool_search_result(
            &ToolSearchOutput {
                pending_mcp_servers,
                notes: build_tool_search_notes(query, &matches),
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
    fn test_resolve_selected_tools_matches_inner_prefixed_tool_name() {
        let deferred = vec![searchable(
            "mcp__lime-browser__browser_file_upload",
            "upload a file through the browser",
        )];
        let all = deferred.clone();

        let matches = resolve_selected_tools(&["browser_file_upload".to_string()], &deferred, &all);

        assert_eq!(
            matches,
            vec!["mcp__lime-browser__browser_file_upload".to_string()]
        );
    }

    #[test]
    fn test_resolve_selected_tools_matches_native_alias_for_visible_tool() {
        let deferred = Vec::new();
        let all = vec![searchable("Read", "read a file")];

        let matches = resolve_selected_tools(&["read_file".to_string()], &deferred, &all);

        assert_eq!(matches, vec!["Read".to_string()]);
    }

    #[test]
    fn test_resolve_selected_tools_matches_system_alias_for_bash() {
        let deferred = Vec::new();
        let all = vec![searchable("Bash", "run shell commands")];

        let matches = resolve_selected_tools(&["system".to_string()], &deferred, &all);

        assert_eq!(matches, vec!["Bash".to_string()]);
    }

    #[test]
    fn test_resolve_selected_tools_matches_reference_alias_for_list_peers() {
        let deferred = Vec::new();
        let all = vec![searchable("ListPeers", "list available peers")];

        let matches = resolve_selected_tools(&["ListPeersTool".to_string()], &deferred, &all);

        assert_eq!(matches, vec!["ListPeers".to_string()]);
    }

    #[test]
    fn test_resolve_selected_tools_matches_reference_alias_for_task_stop() {
        let deferred = Vec::new();
        let all = vec![searchable("TaskStop", "stop a background task")];

        let matches = resolve_selected_tools(&["kill shell".to_string()], &deferred, &all);

        assert_eq!(matches, vec!["TaskStop".to_string()]);
    }

    #[test]
    fn test_resolve_selected_tools_normalizes_server_prefix_variants() {
        let deferred = vec![searchable(
            "mcp__lime-browser__browser_file_upload",
            "upload a file through the browser",
        )];
        let all = deferred.clone();

        let matches = resolve_selected_tools(
            &["mcp__lime_browser__browser_file_upload".to_string()],
            &deferred,
            &all,
        );

        assert_eq!(
            matches,
            vec!["mcp__lime-browser__browser_file_upload".to_string()]
        );
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
    fn test_score_query_match_splits_identifier_queries() {
        let deferred = vec![searchable(
            "mcp__lime-browser__workspace_read_file",
            "read a file from the browser workspace",
        )];
        let all = deferred.clone();

        let matches = score_query_match("read_file", &deferred, &all);

        assert_eq!(
            matches,
            vec!["mcp__lime-browser__workspace_read_file".to_string()]
        );
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
        assert!(tool_search_exact_match("Read", "read_file"));
        assert!(tool_search_exact_match("Bash", "system"));
    }

    #[test]
    fn test_tool_search_exact_match_does_not_match_generic_tool_suffix() {
        assert!(!tool_search_exact_match("alpha__tool", "beta__tool"));
    }

    #[test]
    fn test_select_match_rank_supports_server_prefixed_identifier_variant() {
        assert_eq!(
            select_match_rank(
                "mcp__playwright__browser_file_upload",
                "playwright_browser_file_upload"
            ),
            Some(360)
        );
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
            pending_mcp_servers: None,
            notes: Vec::new(),
        };

        let result = build_tool_search_result(&output, true).unwrap();

        assert_eq!(
            result.metadata.get(TOOL_SURFACE_UPDATED_KEY),
            Some(&json!(true))
        );
    }

    #[test]
    fn test_build_tool_search_result_preserves_pending_mcp_servers() {
        let output = ToolSearchOutput {
            matches: Vec::new(),
            query: "browser".to_string(),
            total_deferred_tools: 2,
            pending_mcp_servers: Some(vec!["playwright".to_string(), "slack".to_string()]),
            notes: vec!["未命中任何 deferred 工具".to_string()],
        };

        let result = build_tool_search_result(&output, false).unwrap();

        assert_eq!(
            result.metadata.get("pending_mcp_servers"),
            Some(&json!(["playwright", "slack"]))
        );
        assert!(result
            .output
            .as_deref()
            .unwrap_or_default()
            .contains("\"pending_mcp_servers\""));
    }

    #[test]
    fn test_tool_search_input_schema_is_strict_object() {
        let tool = ToolSearchTool::new(Weak::new());
        let schema = tool.input_schema();

        assert_eq!(schema["type"], "object");
        assert_eq!(schema["additionalProperties"], json!(false));
        assert_eq!(schema["required"], json!(["query"]));
    }

    #[test]
    fn test_build_tool_search_notes_warns_against_retry_loops() {
        let notes = build_tool_search_notes("select:unknown_tool", &[]);

        assert_eq!(notes.len(), 1);
        assert!(notes[0].contains("不要继续用同义词反复重试"));
    }

    #[test]
    fn test_append_builtin_visible_native_tools_adds_core_native_tools_once() {
        let mut all_tools = vec![searchable("Read", "existing read tool")];
        let mut visible_names = HashSet::new();

        append_builtin_visible_native_tools(&mut all_tools, &mut visible_names);

        assert!(visible_names.contains("Read"));
        assert!(visible_names.contains("Write"));
        assert!(visible_names.contains("StructuredOutput"));
        assert_eq!(
            all_tools
                .iter()
                .filter(|tool| tool.name.eq_ignore_ascii_case("Read"))
                .count(),
            1
        );
        assert!(all_tools
            .iter()
            .any(|tool| tool.name.eq_ignore_ascii_case("Write")));
        assert!(all_tools
            .iter()
            .any(|tool| tool.name.eq_ignore_ascii_case("StructuredOutput")));
    }

    #[test]
    fn test_score_query_match_can_resolve_structured_output_alias() {
        let matches = score_query_match(
            "final output tool",
            &[],
            &[searchable(
                "StructuredOutput",
                "return the final JSON answer",
            )],
        );

        assert_eq!(matches, vec!["StructuredOutput".to_string()]);
    }

    #[test]
    fn test_score_query_match_can_resolve_task_output_alias() {
        let matches = score_query_match(
            "agent output",
            &[],
            &[searchable(
                "TaskOutput",
                "read output from a background task",
            )],
        );

        assert_eq!(matches, vec!["TaskOutput".to_string()]);
    }

    #[test]
    fn test_score_query_match_can_resolve_list_peers_alias() {
        let matches = score_query_match(
            "message peers",
            &[],
            &[searchable(
                "ListPeers",
                "list peers available for messaging",
            )],
        );

        assert_eq!(matches, vec!["ListPeers".to_string()]);
    }
}
