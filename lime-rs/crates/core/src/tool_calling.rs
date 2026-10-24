//! 工具元数据、发现与输入示例。

use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::HashMap;

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct ToolSurfaceMetadata {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub deferred_loading: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub always_visible: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub allowed_callers: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tags: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub input_examples: Vec<Value>,
}

fn metadata_extension(schema: &Value) -> &Value {
    schema
        .get("x-lime")
        .or_else(|| schema.get("x_lime"))
        .unwrap_or(schema)
}

fn metadata_read_bool(schema: &Value, key: &str, camel_key: &str) -> Option<bool> {
    metadata_extension(schema)
        .get(key)
        .or_else(|| metadata_extension(schema).get(camel_key))
        .and_then(|value| value.as_bool())
}

fn metadata_read_string_vec(schema: &Value, key: &str, camel_key: &str) -> Option<Vec<String>> {
    let values = metadata_extension(schema)
        .get(key)
        .or_else(|| metadata_extension(schema).get(camel_key))
        .and_then(|value| value.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_str())
                .map(|item| item.trim().to_ascii_lowercase())
                .filter(|item| !item.is_empty())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    (!values.is_empty()).then_some(values)
}

pub fn normalize_tool_caller(caller: Option<&str>) -> Option<String> {
    caller
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_ascii_lowercase())
}

pub fn extract_tool_surface_metadata(tool_name: &str, schema: &Value) -> ToolSurfaceMetadata {
    ToolSurfaceMetadata {
        deferred_loading: metadata_read_bool(schema, "deferred_loading", "deferredLoading"),
        always_visible: metadata_read_bool(schema, "always_visible", "alwaysVisible"),
        allowed_callers: metadata_read_string_vec(schema, "allowed_callers", "allowedCallers"),
        tags: metadata_read_string_vec(schema, "tags", "tags"),
        input_examples: resolve_tool_input_examples(tool_name, schema),
    }
}

pub fn tool_visible_in_context(metadata: &ToolSurfaceMetadata, include_deferred: bool) -> bool {
    if include_deferred {
        return true;
    }

    let deferred_loading = metadata.deferred_loading.unwrap_or(false);
    let always_visible = metadata.always_visible.unwrap_or(false);
    !deferred_loading || always_visible
}

pub fn tool_matches_caller(metadata: &ToolSurfaceMetadata, caller: Option<&str>) -> bool {
    let Some(allowed_callers) = metadata.allowed_callers.as_ref() else {
        return true;
    };
    let Some(caller) = normalize_tool_caller(caller) else {
        return true;
    };

    allowed_callers.iter().any(|item| item == &caller)
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ParsedToolSearchName {
    parts: Vec<String>,
    full: String,
    is_prefixed: bool,
    inner_name: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ToolDiscoveryProfile {
    pub canonical_name: &'static str,
    pub aliases: &'static [&'static str],
    pub intent_terms: &'static [&'static str],
}

fn tool_search_lookup_key(value: &str) -> String {
    value
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .map(|character| character.to_ascii_lowercase())
        .collect()
}

static TOOL_DISCOVERY_PROFILES: &[ToolDiscoveryProfile] = &[
    ToolDiscoveryProfile {
        canonical_name: "Read",
        aliases: &[
            "ReadTool",
            "FileReadTool",
            "read_file",
            "read file",
            "open file",
            "developer__read",
            "mcp__system__read_file",
        ],
        intent_terms: &[
            "workspace file",
            "project file",
            "view file",
            "查看文件",
            "读取文件",
        ],
    },
    ToolDiscoveryProfile {
        canonical_name: "Glob",
        aliases: &["GlobTool", "find_files", "find files", "mcp__system__glob"],
        intent_terms: &[
            "file_search",
            "list files",
            "path search",
            "查找文件",
            "列文件",
        ],
    },
    ToolDiscoveryProfile {
        canonical_name: "Grep",
        aliases: &[
            "GrepTool",
            "search_files",
            "search files",
            "mcp__system__grep",
        ],
        intent_terms: &[
            "search in files",
            "content search",
            "text search",
            "查找文本",
            "搜索代码",
            "全文搜索",
        ],
    },
    ToolDiscoveryProfile {
        canonical_name: "Bash",
        aliases: &[
            "BashTool",
            "Shell",
            "system",
            "shell",
            "developer__shell",
            "mcp__system__shell",
            "shell_command",
            "exec_command",
            "local_shell_call",
        ],
        intent_terms: &[
            "system",
            "terminal",
            "run command",
            "command execution",
            "执行命令",
            "终端",
            "shell",
        ],
    },
    ToolDiscoveryProfile {
        canonical_name: "WebSearch",
        aliases: &["WebSearchTool", "web_search", "mcp__system__web_search"],
        intent_terms: &[
            "search web",
            "internet search",
            "web search",
            "current information",
            "current events",
            "recent data",
            "latest information",
            "latest news",
            "breaking news",
            "global news",
            "world news",
            "international news",
            "news headlines",
            "today news",
            "roundup",
            "联网搜索",
            "网络搜索",
            "网页搜索",
            "搜索网页",
            "最新信息",
            "实时信息",
            "新闻",
            "要闻",
            "头条",
            "热点",
            "国际新闻",
            "今日新闻",
        ],
    },
    ToolDiscoveryProfile {
        canonical_name: "WebFetch",
        aliases: &["WebFetchTool", "web_fetch", "mcp__system__web_fetch"],
        intent_terms: &[
            "fetch url",
            "fetch page",
            "read url",
            "open url",
            "read webpage",
            "web reader",
            "web content",
            "article url",
            "网页抓取",
            "网页读取",
            "读取网页",
            "抓取网页",
            "链接内容",
        ],
    },
    ToolDiscoveryProfile {
        canonical_name: "request_user_input",
        aliases: &["RequestUserInputTool"],
        intent_terms: &["ask user", "user input", "clarify", "询问用户", "补充信息"],
    },
    ToolDiscoveryProfile {
        canonical_name: "ToolSearch",
        aliases: &["ToolSearchTool", "tool_search", "mcp__system__tool_search"],
        intent_terms: &[
            "tool lookup",
            "search tools",
            "find tool",
            "工具搜索",
            "工具发现",
        ],
    },
    ToolDiscoveryProfile {
        canonical_name: "StructuredOutput",
        aliases: &["SyntheticOutputTool", "FinalOutputTool"],
        intent_terms: &[
            "structured output",
            "final output",
            "final response",
            "结构化输出",
            "最终答案",
        ],
    },
    ToolDiscoveryProfile {
        canonical_name: "Skill",
        aliases: &["SkillTool"],
        intent_terms: &["run skill", "service skill", "执行技能", "技能"],
    },
    ToolDiscoveryProfile {
        canonical_name: "ListMcpResourcesTool",
        aliases: &["ListMcpResources"],
        intent_terms: &["list mcp resources", "mcp resources", "列出 mcp 资源"],
    },
    ToolDiscoveryProfile {
        canonical_name: "ReadMcpResourceTool",
        aliases: &["ReadMcpResource"],
        intent_terms: &["read mcp resource", "mcp resource", "读取 mcp 资源"],
    },
    ToolDiscoveryProfile {
        canonical_name: "ViewImage",
        aliases: &["ViewImageTool", "view_image"],
        intent_terms: &[
            "view image",
            "inspect image",
            "看图",
            "查看图片",
            "分析图片",
        ],
    },
    ToolDiscoveryProfile {
        canonical_name: "PowerShell",
        aliases: &["PowerShellTool"],
        intent_terms: &["powershell", "windows shell", "windows 命令"],
    },
];

pub fn tool_discovery_profiles() -> &'static [ToolDiscoveryProfile] {
    TOOL_DISCOVERY_PROFILES
}

pub fn tool_discovery_profile(name: &str) -> Option<&'static ToolDiscoveryProfile> {
    let key = tool_search_lookup_key(name);
    if key.is_empty() {
        return None;
    }

    TOOL_DISCOVERY_PROFILES.iter().find(|profile| {
        tool_search_lookup_key(profile.canonical_name) == key
            || profile
                .aliases
                .iter()
                .any(|alias| tool_search_lookup_key(alias) == key)
    })
}

pub fn canonical_tool_discovery_name(name: &str) -> Option<&'static str> {
    tool_discovery_profile(name).map(|profile| profile.canonical_name)
}

pub fn tool_discovery_aliases(name: &str) -> &'static [&'static str] {
    tool_discovery_profile(name)
        .map(|profile| profile.aliases)
        .unwrap_or(&[])
}

pub fn tool_discovery_search_hints(name: &str) -> Vec<&'static str> {
    let Some(profile) = tool_discovery_profile(name) else {
        return Vec::new();
    };
    std::iter::once(profile.canonical_name)
        .chain(profile.aliases.iter().copied())
        .chain(profile.intent_terms.iter().copied())
        .collect()
}

fn tool_discovery_exact_names(name: &str) -> Vec<&'static str> {
    let Some(profile) = tool_discovery_profile(name) else {
        return Vec::new();
    };
    std::iter::once(profile.canonical_name)
        .chain(profile.aliases.iter().copied())
        .collect()
}

fn lower_tool_discovery_hints(name: &str) -> Vec<String> {
    tool_discovery_search_hints(name)
        .into_iter()
        .map(|hint| hint.to_ascii_lowercase())
        .collect()
}

fn split_tool_search_identifier(value: &str) -> Vec<String> {
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

fn parse_tool_search_name(name: &str) -> ParsedToolSearchName {
    let trimmed = name.trim();
    let without_mcp_prefix = trimmed.strip_prefix("mcp__").unwrap_or(trimmed);
    let is_prefixed = without_mcp_prefix.contains("__");
    let segments = if is_prefixed {
        without_mcp_prefix.split("__").collect::<Vec<_>>()
    } else {
        vec![without_mcp_prefix]
    };
    let parts = segments
        .iter()
        .flat_map(|segment| split_tool_search_identifier(segment))
        .collect::<Vec<_>>();

    ParsedToolSearchName {
        full: parts.join(" "),
        parts,
        is_prefixed,
        inner_name: (segments.len() > 1)
            .then(|| segments.last().unwrap_or(&"").to_ascii_lowercase()),
    }
}

fn compile_tool_search_term_patterns(terms: &[&str]) -> HashMap<String, Regex> {
    let mut patterns = HashMap::new();
    for term in terms {
        patterns.entry((*term).to_string()).or_insert_with(|| {
            Regex::new(&format!(r"\b{}\b", regex::escape(term)))
                .expect("tool search term regex should compile")
        });
    }
    patterns
}

fn tool_search_term_matches_text(text: &str, term: &str, pattern: &Regex) -> bool {
    if term
        .chars()
        .all(|character| character.is_ascii_alphanumeric())
    {
        pattern.is_match(text)
    } else {
        text.contains(term)
    }
}

fn suffix_identifier_match(parts: &[String], suffix: &[String]) -> bool {
    !suffix.is_empty()
        && suffix.len() <= parts.len()
        && parts[(parts.len() - suffix.len())..]
            .iter()
            .zip(suffix.iter())
            .all(|(left, right)| left == right)
}

fn split_tool_search_query_terms(value: &str) -> impl Iterator<Item = &str> {
    value
        .split(|character: char| {
            character.is_whitespace() || matches!(character, ',' | ';' | '|' | '/' | '\\')
        })
        .map(str::trim)
        .filter(|term| !term.is_empty())
}

fn exact_query_term_rank(name: &str, query: &str) -> Option<i32> {
    split_tool_search_query_terms(query)
        .enumerate()
        .find_map(|(index, term)| {
            tool_search_exact_match(name, term).then(|| 190 - index.min(90) as i32)
        })
}

pub fn tool_search_exact_match(name: &str, query: &str) -> bool {
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

    let parsed = parse_tool_search_name(name);
    if parsed.inner_name.as_deref().is_some_and(|inner_name| {
        inner_name == query_lower || tool_search_lookup_key(inner_name) == query_key
    }) {
        return true;
    }

    let query_parts = split_tool_search_identifier(&query_lower);
    if parsed.inner_name.as_deref().is_some_and(|inner_name| {
        let inner_parts = split_tool_search_identifier(inner_name);
        inner_parts.len() >= 2
            && (suffix_identifier_match(&inner_parts, &query_parts)
                || suffix_identifier_match(&query_parts, &inner_parts))
    }) {
        return true;
    }

    tool_discovery_exact_names(name).iter().any(|alias| {
        alias.eq_ignore_ascii_case(&query_lower)
            || (!query_key.is_empty() && tool_search_lookup_key(alias) == query_key)
    })
}

pub fn score_tool_match(name: &str, description: &str, tags: &[String], query: &str) -> i32 {
    let raw_query = query.trim();
    let query = raw_query.to_ascii_lowercase();
    if query.is_empty() {
        return 1;
    }

    if tool_search_exact_match(name, &query) {
        return 200;
    }
    if let Some(rank) = exact_query_term_rank(name, raw_query) {
        return rank;
    }

    let name_lc = name.to_ascii_lowercase();
    if query.contains("__") && name_lc.starts_with(&query) {
        return 160;
    }

    let raw_query_terms = query
        .split_whitespace()
        .filter(|term| !term.is_empty())
        .collect::<Vec<_>>();
    if raw_query_terms.is_empty() {
        return 0;
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

        let split_terms = split_tool_search_identifier(normalized_term);
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
        return 0;
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
    let term_patterns = compile_tool_search_term_patterns(&scoring_term_refs);
    let parsed = parse_tool_search_name(name);
    let description_lc = description.to_ascii_lowercase();
    let search_hints = lower_tool_discovery_hints(name);
    let search_hint_parts = search_hints
        .iter()
        .map(|hint| split_tool_search_identifier(hint))
        .collect::<Vec<_>>();
    let normalized_tags = tags
        .iter()
        .map(|tag| tag.to_ascii_lowercase())
        .collect::<Vec<_>>();

    let required_matches = required_terms.iter().all(|term| {
        let term = term.as_str();
        let Some(pattern) = term_patterns.get(term) else {
            return false;
        };
        parsed
            .parts
            .iter()
            .any(|part| part == term || part.contains(term))
            || parsed.full.contains(term)
            || search_hint_parts
                .iter()
                .flatten()
                .any(|part| part == term || part.contains(term))
            || search_hints
                .iter()
                .any(|hint| tool_search_term_matches_text(hint, term, pattern))
            || normalized_tags
                .iter()
                .any(|tag| tag == term || tool_search_term_matches_text(tag, term, pattern))
            || tool_search_term_matches_text(&description_lc, term, pattern)
    });
    if !required_matches {
        return 0;
    }

    let mut score = 0;
    for term in scoring_terms {
        let term = term.as_str();
        let Some(pattern) = term_patterns.get(term) else {
            continue;
        };

        let mut term_score = 0;

        if parsed.parts.iter().any(|part| part == term) {
            term_score += if parsed.is_prefixed { 12 } else { 10 };
        } else if parsed.parts.iter().any(|part| part.contains(term)) {
            term_score += if parsed.is_prefixed { 6 } else { 5 };
        }

        if search_hint_parts
            .iter()
            .any(|parts| parts.iter().any(|part| part == term))
        {
            term_score += 9;
        } else if search_hint_parts
            .iter()
            .any(|parts| parts.iter().any(|part| part.contains(term)))
        {
            term_score += 4;
        }
        if search_hints
            .iter()
            .any(|hint| tool_search_term_matches_text(hint, term, pattern))
        {
            term_score += 3;
        }

        if term_score == 0 && parsed.full.contains(term) {
            term_score += 3;
        }

        if normalized_tags.iter().any(|tag| tag == term) {
            term_score += 4;
        } else if normalized_tags.iter().any(|tag| tag.contains(term)) {
            term_score += 2;
        }

        if tool_search_term_matches_text(&description_lc, term, pattern) {
            term_score += 2;
        }

        score += term_score;
    }

    score
}

fn schema_read_examples(schema: &Value) -> Vec<Value> {
    let extension = schema
        .get("x-lime")
        .or_else(|| schema.get("x_lime"))
        .unwrap_or(schema);

    extension
        .get("input_examples")
        .or_else(|| extension.get("inputExamples"))
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter(|v| !v.is_null()).cloned().collect())
        .unwrap_or_default()
}

fn pick_example_value(field_name: &str, schema: &Value, depth: usize) -> Value {
    if let Some(enum_values) = schema.get("enum").and_then(|v| v.as_array()) {
        if let Some(first) = enum_values.first() {
            return first.clone();
        }
    }

    if let Some(one_of) = schema
        .get("oneOf")
        .or_else(|| schema.get("anyOf"))
        .and_then(|v| v.as_array())
        .and_then(|arr| arr.first())
    {
        return pick_example_value(field_name, one_of, depth + 1);
    }

    let field_name_lc = field_name.to_ascii_lowercase();
    let field_type = schema
        .get("type")
        .and_then(|v| v.as_str())
        .unwrap_or("string");

    match field_type {
        "boolean" => Value::Bool(true),
        "integer" => {
            if field_name_lc.contains("count")
                || field_name_lc.contains("limit")
                || field_name_lc.contains("top")
            {
                Value::Number(3.into())
            } else {
                Value::Number(1.into())
            }
        }
        "number" => Value::Number(serde_json::Number::from_f64(0.5).unwrap_or_else(|| 0.into())),
        "array" => {
            if depth >= 2 {
                return Value::Array(Vec::new());
            }
            let item_schema = schema.get("items").unwrap_or(&Value::Null);
            Value::Array(vec![pick_example_value(field_name, item_schema, depth + 1)])
        }
        "object" => {
            if depth >= 2 {
                return Value::Object(Map::new());
            }
            synthesize_example_from_schema(schema, depth + 1)
                .unwrap_or_else(|| Value::Object(Map::new()))
        }
        _ => {
            if field_name_lc.contains("url") || field_name_lc.contains("link") {
                Value::String("https://example.com".to_string())
            } else if field_name_lc.contains("query") || field_name_lc.contains("keyword") {
                Value::String("latest ai agent tool calling updates".to_string())
            } else if field_name_lc.contains("prompt")
                || field_name_lc.contains("instruction")
                || field_name_lc.contains("question")
            {
                Value::String("请提炼三条关键信息并给出结论".to_string())
            } else if field_name_lc.contains("id") {
                Value::String("example-id".to_string())
            } else if field_name_lc.contains("path") {
                Value::String("/tmp/example".to_string())
            } else {
                Value::String("example".to_string())
            }
        }
    }
}

fn synthesize_example_from_schema(schema: &Value, depth: usize) -> Option<Value> {
    let properties = schema.get("properties").and_then(|v| v.as_object())?;
    if properties.is_empty() {
        return None;
    }

    let required = schema
        .get("required")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str())
                .map(|v| v.to_string())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    let mut keys = required.clone();
    let mut optional_keys = properties.keys().cloned().collect::<Vec<_>>();
    optional_keys.sort();
    for key in optional_keys {
        if !keys.contains(&key) {
            keys.push(key);
        }
    }

    let max_fields = if depth == 0 { 6 } else { 4 };
    let mut out = Map::new();
    for key in keys.into_iter().take(max_fields) {
        if let Some(field_schema) = properties.get(&key) {
            out.insert(key.clone(), pick_example_value(&key, field_schema, depth));
        }
    }

    Some(Value::Object(out))
}

/// 解析工具 schema 内配置的 input_examples。
pub fn configured_tool_input_examples(schema: &Value) -> Vec<Value> {
    schema_read_examples(schema)
}

/// 获取工具可用的 input_examples（优先配置，内置工具缺省时按 schema 生成）。
pub fn resolve_tool_input_examples(tool_name: &str, schema: &Value) -> Vec<Value> {
    let configured = schema_read_examples(schema);
    if !configured.is_empty() {
        return configured;
    }

    let normalized = tool_name.trim().to_ascii_lowercase();
    let built_in = matches!(
        normalized.as_str(),
        "websearch" | "webfetch" | "tool_search"
    );
    if !built_in {
        return Vec::new();
    }

    synthesize_example_from_schema(schema, 0)
        .map(|v| vec![v])
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn test_resolve_tool_input_examples_prefers_configured_examples() {
        let schema = serde_json::json!({
            "type": "object",
            "x-lime": {
                "input_examples": [{"query": "rust async"}]
            }
        });
        let examples = resolve_tool_input_examples("WebSearch", &schema);
        assert_eq!(examples, vec![serde_json::json!({"query":"rust async"})]);
    }

    #[test]
    fn test_resolve_tool_input_examples_generates_builtin_examples_from_schema() {
        let schema = serde_json::json!({
            "type": "object",
            "properties": {
                "query": {"type":"string"},
                "limit": {"type":"integer"}
            },
            "required": ["query"]
        });
        let examples = resolve_tool_input_examples("WebSearch", &schema);
        assert_eq!(examples.len(), 1);
        let example = examples[0].as_object().cloned().unwrap_or_default();
        assert!(example.contains_key("query"));
    }

    #[test]
    fn test_resolve_tool_input_examples_ignores_non_builtin_without_config() {
        let schema = serde_json::json!({
            "type": "object",
            "properties": {
                "query": {"type":"string"}
            }
        });
        let examples = resolve_tool_input_examples("docs_search", &schema);
        assert!(examples.is_empty());
    }

    #[test]
    fn test_extract_tool_surface_metadata_reads_extension_fields() {
        let schema = serde_json::json!({
            "x-lime": {
                "deferred_loading": true,
                "always_visible": false,
                "allowed_callers": ["assistant", "code_execution"],
                "input_examples": [{"query":"rust"}],
                "tags": ["docs", "search"]
            }
        });

        let metadata = extract_tool_surface_metadata("docs_search", &schema);
        assert_eq!(metadata.deferred_loading, Some(true));
        assert_eq!(metadata.always_visible, Some(false));
        assert_eq!(
            metadata.allowed_callers,
            Some(vec!["assistant".to_string(), "code_execution".to_string()])
        );
        assert_eq!(
            metadata.tags,
            Some(vec!["docs".to_string(), "search".to_string()])
        );
        assert_eq!(
            metadata.input_examples,
            vec![serde_json::json!({"query":"rust"})]
        );
    }

    #[test]
    fn test_tool_visibility_and_caller_match_follow_metadata() {
        let metadata = ToolSurfaceMetadata {
            deferred_loading: Some(true),
            always_visible: Some(false),
            allowed_callers: Some(vec!["assistant".to_string()]),
            tags: None,
            input_examples: Vec::new(),
        };

        assert!(!tool_visible_in_context(&metadata, false));
        assert!(tool_visible_in_context(&metadata, true));
        assert!(tool_matches_caller(&metadata, Some("assistant")));
        assert!(!tool_matches_caller(&metadata, Some("code_execution")));
    }

    #[test]
    fn test_score_tool_match_prefers_exact_name() {
        let exact = score_tool_match(
            "tool_search",
            "Search tool surfaces",
            &["search".to_string()],
            "tool_search",
        );
        let partial = score_tool_match(
            "tool_lookup",
            "Search tool surfaces",
            &["search".to_string()],
            "tool_search",
        );
        assert!(exact > partial);
    }

    #[test]
    fn test_score_tool_match_supports_native_aliases() {
        let exact = score_tool_match("Read", "Read file contents", &[], "read_file");
        let partial = score_tool_match("WebSearch", "Search the web", &[], "read_file");
        assert!(exact > partial);
    }

    #[test]
    fn test_score_tool_match_resolves_space_separated_native_tool_names() {
        let web_search = score_tool_match(
            "WebSearch",
            "Search the web for current information",
            &[],
            "WebSearch WebFetch",
        );
        let web_fetch = score_tool_match(
            "WebFetch",
            "Fetch and read a specific URL",
            &[],
            "WebSearch WebFetch",
        );
        let read = score_tool_match("Read", "Read file contents", &[], "WebSearch WebFetch");

        assert!(web_search > 0);
        assert!(web_fetch > 0);
        assert!(web_search > web_fetch);
        assert_eq!(read, 0);
    }

    #[test]
    fn test_score_tool_match_resolves_news_intent_to_web_search() {
        let web_search = score_tool_match(
            "WebSearch",
            "允许当前代理搜索网络并使用结果来提供响应。",
            &[],
            "May 30 2026 world news headlines",
        );
        let web_fetch = score_tool_match(
            "WebFetch",
            "获取指定 URL 的内容并使用 AI 模型处理。",
            &[],
            "May 30 2026 world news headlines",
        );

        assert!(web_search > 0);
        assert_eq!(web_fetch, 0);
    }

    #[test]
    fn test_score_tool_match_resolves_chinese_news_intent_to_web_search() {
        let web_search = score_tool_match(
            "WebSearch",
            "允许当前代理搜索网络并使用结果来提供响应。",
            &[],
            "今日全球要闻 5月30日 国际",
        );

        assert!(web_search > 0);
    }

    #[test]
    fn test_score_tool_match_resolves_basic_tool_discovery_profiles() {
        let cases = [
            ("Read", "Read file contents", "read_file"),
            ("Bash", "Run shell commands", "run command"),
            ("Bash", "Run shell commands", "shell"),
            ("ToolSearch", "Search available tools", "find tool"),
            (
                "StructuredOutput",
                "Return the final JSON answer",
                "structured final output",
            ),
            ("request_user_input", "Ask the user for input", "ask user"),
        ];

        for (name, description, query) in cases {
            let score = score_tool_match(name, description, &[], query);
            assert!(
                score > 0,
                "{name} should match query {query:?}, got {score}"
            );
        }
    }

    #[test]
    fn test_score_tool_match_supports_required_terms() {
        let matched = score_tool_match(
            "mcp__slack__send_message",
            "Send a Slack message",
            &["slack".to_string()],
            "+slack send",
        );
        let filtered = score_tool_match(
            "mcp__github__send_issue",
            "Send a GitHub issue",
            &["github".to_string()],
            "+slack send",
        );
        assert!(matched > 0);
        assert_eq!(filtered, 0);
    }

    #[test]
    fn test_tool_search_exact_match_supports_native_alias() {
        assert!(tool_search_exact_match("Read", "read_file"));
        assert!(tool_search_exact_match("WebSearch", "WebSearchTool"));
        assert!(tool_search_exact_match(
            "mcp__playwright__browser_click",
            "browser_click"
        ));
        assert!(tool_search_exact_match("Bash", "system"));
    }

    #[test]
    fn test_file_mutation_discovery_profiles_stay_deleted() {
        for deleted_name in [
            "Write",
            "WriteTool",
            "FileWriteTool",
            "write_file",
            "create_file",
            "mcp__system__write_file",
            "Edit",
            "EditTool",
            "FileEditTool",
            "edit_file",
            "developer__text_editor",
            "mcp__system__edit_file",
        ] {
            assert!(
                canonical_tool_discovery_name(deleted_name).is_none(),
                "Agent Write/Edit alias must not be discoverable: {deleted_name}"
            );
            assert!(
                !tool_search_exact_match("apply_patch", deleted_name),
                "Agent Write/Edit alias must not collapse into apply_patch: {deleted_name}"
            );
        }
    }

    #[test]
    fn test_agent_task_discovery_profiles_stay_deleted() {
        for deleted_name in [
            "TaskCreate",
            "TaskCreateTool",
            "TaskList",
            "TaskListTool",
            "TaskGet",
            "TaskGetTool",
            "TaskUpdate",
            "TaskUpdateTool",
            "TaskOutput",
            "TaskOutputTool",
            "AgentOutputTool",
            "BashOutputTool",
            "TaskStop",
            "TaskStopTool",
            "KillShell",
        ] {
            assert!(
                canonical_tool_discovery_name(deleted_name).is_none(),
                "Agent Task* alias must not be discoverable: {deleted_name}"
            );
        }
    }

    #[test]
    fn test_retired_team_tool_discovery_profiles_stay_deleted() {
        for deleted_name in [
            "Agent",
            "AgentTool",
            "SendMessage",
            "SendMessageTool",
            "TeamCreate",
            "TeamCreateTool",
            "TeamDelete",
            "TeamDeleteTool",
            "ListPeers",
            "ListPeersTool",
        ] {
            assert!(
                canonical_tool_discovery_name(deleted_name).is_none(),
                "retired Team tool must not remain discoverable: {deleted_name}"
            );
        }
    }

    #[test]
    fn test_tool_search_exact_match_does_not_match_generic_tool_suffix() {
        assert!(!tool_search_exact_match("alpha__tool", "beta__tool"));
    }

    #[test]
    fn test_score_tool_match_splits_identifier_queries() {
        let exact = score_tool_match(
            "mcp__playwright__browser_click",
            "Click inside browser",
            &["browser".to_string()],
            "browser_click",
        );
        let partial = score_tool_match(
            "mcp__playwright__browser_hover",
            "Hover inside browser",
            &["browser".to_string()],
            "browser_click",
        );
        assert!(exact > partial);
    }

    #[test]
    fn test_score_tool_match_boosts_workspace_file_queries_for_file_tools() {
        let file_tool = score_tool_match(
            "Read",
            "Enhanced multimodal file reader with intelligent analysis capabilities.",
            &[],
            "workspace project file",
        );
        let unrelated = score_tool_match(
            "WebSearch",
            "Search the public web for information.",
            &[],
            "workspace project file",
        );
        assert!(file_tool > unrelated);
    }
}
