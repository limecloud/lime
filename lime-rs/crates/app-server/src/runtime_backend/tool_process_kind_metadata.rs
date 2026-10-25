use super::tool_process_metadata::ToolProcessMetadataInput;
use serde_json::{Map, Value};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct ToolProcessKindMetadata {
    pub(crate) tool_family: &'static str,
    pub(crate) operation_kind: &'static str,
}

impl ToolProcessKindMetadata {
    pub(crate) fn insert_fact_fields(&self, target: &mut Map<String, Value>) {
        target.insert(
            "toolFamily".to_string(),
            Value::String(self.tool_family.to_string()),
        );
        target.insert(
            "tool_family".to_string(),
            Value::String(self.tool_family.to_string()),
        );
        target.insert(
            "operationKind".to_string(),
            Value::String(self.operation_kind.to_string()),
        );
        target.insert(
            "operation_kind".to_string(),
            Value::String(self.operation_kind.to_string()),
        );
    }
}

pub(crate) fn classify_tool_process_kind(
    input: &ToolProcessMetadataInput<'_>,
) -> ToolProcessKindMetadata {
    let tool_name = input.tool_name.unwrap_or_default();
    let normalized = normalize_tool_name(tool_name);

    if is_web_search_tool_name(&normalized) {
        return kind("search", "web_search");
    }
    if is_web_fetch_tool_name(&normalized) {
        return kind("fetch", "web_fetch");
    }
    if matches!(
        normalized.as_str(),
        "toolsearch" | "repl" | "listskills" | "loadskill"
    ) {
        return kind("skill", "absorbed");
    }
    if normalized == "resolvelibraryid" {
        return kind("search", "search");
    }
    if normalized == "querydocs" {
        return kind("read", "read");
    }
    if normalized == "updateplan" {
        return kind("plan", "absorbed");
    }
    if let Some(operation_kind) = classify_mcp_operation_kind(tool_name) {
        let tool_family = match operation_kind {
            "read" => "read",
            "list" => "list",
            "search" => "search",
            "browser" => "browser",
            "mutation" => "write",
            _ => "generic",
        };
        return kind(tool_family, operation_kind);
    }
    if is_browser_tool_name(tool_name, &normalized) {
        return kind("browser", "browser");
    }
    if is_task_tool_name(&normalized) {
        return kind("task", "absorbed");
    }
    if is_subagent_tool_name(&normalized) {
        return kind("subagent", "other");
    }
    if normalized.contains("workspace") || normalized.contains("artifact") {
        return kind("read", "read");
    }
    if normalized.contains("patch")
        || normalized.contains("replace")
        || normalized.contains("edit")
        || normalized.contains("update")
    {
        return kind("edit", "mutation");
    }
    if normalized.contains("write")
        || normalized.contains("create")
        || normalized.contains("save")
        || normalized.contains("delete")
    {
        return kind("write", "mutation");
    }
    if normalized.contains("read")
        || normalized.contains("view")
        || normalized.contains("cat")
        || normalized.contains("open")
    {
        return kind("read", "read");
    }
    if normalized.contains("glob") || normalized.contains("list") || normalized.contains("dir") {
        return kind("list", "list");
    }
    if normalized.contains("bash")
        || normalized.contains("shell")
        || normalized.contains("exec")
        || normalized.contains("command")
    {
        return kind(
            "command",
            classify_command_operation_kind(input).unwrap_or("other"),
        );
    }
    if normalized.contains("search")
        || normalized.contains("grep")
        || normalized.contains("query")
        || normalized.contains("find")
    {
        return kind("search", "search");
    }
    if normalized.contains("fetch")
        || normalized.contains("http")
        || normalized.contains("url")
        || normalized.contains("web")
    {
        return kind("fetch", "web_fetch");
    }
    if normalized.contains("image") || normalized.contains("vision") {
        return kind("vision", "other");
    }

    kind("generic", "other")
}

fn kind(tool_family: &'static str, operation_kind: &'static str) -> ToolProcessKindMetadata {
    ToolProcessKindMetadata {
        tool_family,
        operation_kind,
    }
}

fn classify_command_operation_kind(input: &ToolProcessMetadataInput<'_>) -> Option<&'static str> {
    let command = input
        .arguments
        .and_then(Value::as_object)
        .and_then(|object| {
            ["command", "cmd", "script"]
                .iter()
                .find_map(|key| object.get(*key)?.as_str())
        })
        .unwrap_or_default()
        .trim()
        .to_lowercase();
    if command.is_empty() {
        return None;
    }

    if contains_command(&command, &["rg", "grep", "findstr", "ag", "ack"])
        || command.contains("select-string")
    {
        return Some("search");
    }
    if contains_command(&command, &["ls", "tree", "dir", "fd", "find"]) {
        return Some("list");
    }
    if contains_command(
        &command,
        &["cat", "head", "tail", "sed", "awk", "more", "less", "wc"],
    ) {
        return Some("read");
    }
    if contains_command(
        &command,
        &[
            "rm", "mv", "cp", "touch", "mkdir", "rmdir", "chmod", "chown", "sudo", "git", "npm",
            "pnpm", "yarn", "cargo",
        ],
    ) {
        return Some("mutation");
    }
    None
}

fn contains_command(command: &str, names: &[&str]) -> bool {
    command
        .split(|character: char| !(character.is_ascii_alphanumeric() || character == '-'))
        .filter(|token| !token.is_empty())
        .any(|token| names.contains(&token))
}

fn classify_mcp_operation_kind(tool_name: &str) -> Option<&'static str> {
    let normalized = tool_name.trim();
    if !normalized.to_ascii_lowercase().starts_with("mcp__") {
        return None;
    }
    let segments = normalized.split("__").collect::<Vec<_>>();
    if segments.len() < 3 {
        return None;
    }
    let server_name = segments.get(1).copied().unwrap_or_default().to_lowercase();
    let inner = segments[2..].join("__");
    let inner = normalize_mcp_inner_tool_name(&inner);
    if server_name.contains("browser")
        || server_name.contains("playwright")
        || server_name.contains("chrome")
    {
        return Some("browser");
    }
    if has_mcp_action(&inner, &MCP_MUTATION_ACTIONS) {
        return Some("mutation");
    }
    if has_mcp_action(&inner, &MCP_SEARCH_ACTIONS) {
        return Some("search");
    }
    if has_mcp_action(&inner, &MCP_LIST_ACTIONS) {
        return Some("list");
    }
    if has_mcp_action(&inner, &MCP_READ_ACTIONS) {
        return Some("read");
    }
    if has_mcp_action(&inner, &MCP_BROWSER_ACTIONS) {
        return Some("browser");
    }
    None
}

const MCP_MUTATION_ACTIONS: [&str; 18] = [
    "create", "update", "delete", "remove", "add", "set", "send", "write", "edit", "patch", "run",
    "execute", "submit", "publish", "approve", "reject", "reply", "comment",
];
const MCP_BROWSER_ACTIONS: [&str; 18] = [
    "navigate",
    "goto",
    "click",
    "hover",
    "fill",
    "type",
    "select",
    "press",
    "snapshot",
    "screenshot",
    "drag",
    "upload",
    "wait",
    "tab",
    "tabs",
    "page",
    "browser",
    "evaluate",
];
const MCP_SEARCH_ACTIONS: [&str; 4] = ["search", "find", "lookup", "query"];
const MCP_LIST_ACTIONS: [&str; 1] = ["list"];
const MCP_READ_ACTIONS: [&str; 5] = ["get", "read", "fetch", "open", "download"];

fn has_mcp_action(normalized_inner: &str, actions: &[&str]) -> bool {
    let parts = normalized_inner.split('_').filter(|part| !part.is_empty());
    parts.into_iter().any(|part| actions.contains(&part))
}

fn normalize_mcp_inner_tool_name(value: &str) -> String {
    let mut output = String::new();
    let mut previous_was_lower_or_digit = false;
    for character in value.chars() {
        if character.is_ascii_uppercase() && previous_was_lower_or_digit {
            output.push('_');
        }
        if character == '-' {
            output.push('_');
        } else {
            output.extend(character.to_lowercase());
        }
        previous_was_lower_or_digit = character.is_ascii_lowercase() || character.is_ascii_digit();
    }
    output
}

fn is_web_search_tool_name(normalized: &str) -> bool {
    normalized == "websearch"
        || normalized == "searchquery"
        || normalized == "websearchtool"
        || (normalized.contains("web") && normalized.contains("search"))
}

fn is_web_fetch_tool_name(normalized: &str) -> bool {
    normalized == "webfetch"
        || normalized == "webfetchtool"
        || (normalized.contains("web") && normalized.contains("fetch"))
}

fn is_browser_tool_name(tool_name: &str, normalized: &str) -> bool {
    classify_mcp_operation_kind(tool_name) == Some("browser")
        || [
            "browser",
            "page",
            "runtime",
            "dom",
            "cdp",
            "playwright",
            "navigate",
            "screenshot",
            "snapshot",
            "click",
            "hover",
            "upload",
            "waitfor",
            "tabs",
            "presskey",
            "selectoption",
            "drag",
            "evaluate",
            "goto",
        ]
        .iter()
        .any(|marker| normalized.contains(marker))
}

fn is_task_tool_name(normalized: &str) -> bool {
    normalized.starts_with("task")
        || normalized.contains("cron")
        || normalized == "limerunserviceskill"
}

fn is_subagent_tool_name(normalized: &str) -> bool {
    normalized == "agent"
        || normalized == "sendmessage"
        || normalized == "waitagent"
        || normalized == "resumeagent"
        || normalized == "closeagent"
        || normalized == "teamcreate"
        || normalized == "teamdelete"
        || normalized == "listpeers"
}

fn normalize_tool_name(tool_name: &str) -> String {
    tool_name
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::runtime_backend::tool_process_metadata::{
        build_tool_process_metadata, ToolProcessStatus,
    };
    use serde_json::json;

    fn input<'a>(tool_name: &'a str, arguments: Option<&'a Value>) -> ToolProcessMetadataInput<'a> {
        ToolProcessMetadataInput {
            tool_id: "tool-1",
            tool_name: Some(tool_name),
            status: ToolProcessStatus::Started,
            arguments,
            result: None,
        }
    }

    #[test]
    fn classifies_web_search_as_search_family_with_web_search_operation() {
        let arguments = json!({ "query": "Lime Soul" });
        let kind = classify_tool_process_kind(&input("web_search", Some(&arguments)));

        assert_eq!(kind.tool_family, "search");
        assert_eq!(kind.operation_kind, "web_search");
    }

    #[test]
    fn classifies_command_by_command_text() {
        let search_args = json!({ "command": "rg \"Soul\" src" });
        let mutation_args = json!({ "command": "rm -rf dist" });

        assert_eq!(
            classify_tool_process_kind(&input("exec_command", Some(&search_args))),
            kind("command", "search")
        );
        assert_eq!(
            classify_tool_process_kind(&input("exec_command", Some(&mutation_args))),
            kind("command", "mutation")
        );
    }

    #[test]
    fn classifies_dynamic_mcp_browser_and_read_tools() {
        assert_eq!(
            classify_tool_process_kind(&input("mcp__chrome__click", None)),
            kind("browser", "browser")
        );
        assert_eq!(
            classify_tool_process_kind(&input("mcp__docs__get_page", None)),
            kind("read", "read")
        );
    }

    #[test]
    fn build_metadata_includes_kind_facts() {
        let arguments = json!({ "query": "Lime Soul" });
        let metadata = build_tool_process_metadata(input("web_search", Some(&arguments)));

        assert_eq!(metadata["tool_process_facts"]["toolFamily"], "search");
        assert_eq!(metadata["tool_process_facts"]["tool_family"], "search");
        assert_eq!(
            metadata["tool_process_facts"]["operationKind"],
            "web_search"
        );
        assert_eq!(
            metadata["tool_process_facts"]["operation_kind"],
            "web_search"
        );
    }
}
