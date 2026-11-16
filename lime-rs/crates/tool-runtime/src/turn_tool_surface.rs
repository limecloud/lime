use serde_json::Value;
use std::collections::HashMap;

pub const RUNTIME_METADATA_KEY: &str = "lime_runtime";
pub const RUNTIME_TOOL_SURFACE_KEY: &str = "tool_surface";
pub const TURN_TOOL_SURFACE_DIRECT_ANSWER: &str = "direct_answer";
pub const TURN_TOOL_SURFACE_LOCAL_WORKSPACE: &str = "local_workspace";
pub const TURN_TOOL_SURFACE_COMPACT_TOOLS: &str = "compact_tools";

pub const LOCAL_WORKSPACE_TOOL_NAMES: &[&str] = &[
    "exec_command",
    "write_stdin",
    "Read",
    "view_image",
    "Glob",
    "Grep",
];
pub const COMPACT_TOOL_SURFACE_TOOL_NAMES: &[&str] = &[
    "tool_search",
    "list_mcp_resources",
    "read_mcp_resource",
    "extensionmanager__search_available_extensions",
    "extensionmanager__manage_extensions",
    "Read",
    "view_image",
    "Glob",
    "Grep",
    "exec_command",
    "write_stdin",
    "apply_patch",
    "request_user_input",
    "request_user_input_async",
    "WebSearch",
    "WebFetch",
    "StructuredOutput",
];
pub const RESOURCE_GATED_TOOL_NAMES: &[&str] = &["list_mcp_resources", "read_mcp_resource"];

pub const DIRECT_ANSWER_TURN_GUIDANCE: &str = "【当前回合执行约束】本回合应优先直接回答。除非信息明显不足或用户明确要求，否则不要调用工具，也不要把简单回复扩展成多阶段流程。";
pub const LOCAL_WORKSPACE_TURN_GUIDANCE: &str = "【当前回合执行约束】本回合只允许使用本地工作区工具。先用最少的侦查动作定位关键文件，优先小范围目录/文件列表与精确搜索；通常先控制在 3 到 6 次工具调用内拿到关键证据，只有前一步明确暴露新线索时再继续深入。若需要连续侦查，请把相互独立的读取/搜索收敛成一批，并在同一条回复里一起发起 2 到 4 个彼此独立的只读工具调用，让运行时并行执行；先完成这一批，再直接输出 1 到 2 句用户可见的结论正文，说明已经确认了什么、还缺什么、为什么还要继续，不要额外输出“阶段结论”标题，再决定是否继续下一批。如果用户消息里已经点名绝对路径、仓库根或具体文件，就把这些显式路径当作本回合唯一优先入口；第一批只围绕这些路径展开，不要先扫描当前默认工作区或无关目录。读取文件时聚焦与问题直接相关的入口、注册表、配置和代码片段，避免重复枚举大目录、避免一次性展开超长目录或整文件全文，也不要把大段原文直接抄回最终回答，改用结论加文件路径。";

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum RuntimeTurnToolSurfaceMode {
    DirectAnswer,
    LocalWorkspace,
    CompactTools,
    Other(String),
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct RuntimeTurnToolScope {
    pub allowed_tools: Vec<String>,
    pub disallowed_tools: Vec<String>,
}

impl RuntimeTurnToolSurfaceMode {
    pub fn from_raw(value: &str) -> Option<Self> {
        let value = value.trim();
        if value.is_empty() {
            return None;
        }

        match value {
            TURN_TOOL_SURFACE_DIRECT_ANSWER => Some(Self::DirectAnswer),
            TURN_TOOL_SURFACE_LOCAL_WORKSPACE => Some(Self::LocalWorkspace),
            TURN_TOOL_SURFACE_COMPACT_TOOLS => Some(Self::CompactTools),
            _ => Some(Self::Other(value.to_string())),
        }
    }

    pub fn as_str(&self) -> &str {
        match self {
            Self::DirectAnswer => TURN_TOOL_SURFACE_DIRECT_ANSWER,
            Self::LocalWorkspace => TURN_TOOL_SURFACE_LOCAL_WORKSPACE,
            Self::CompactTools => TURN_TOOL_SURFACE_COMPACT_TOOLS,
            Self::Other(value) => value,
        }
    }

    pub fn is_direct_answer(&self) -> bool {
        matches!(self, Self::DirectAnswer)
    }
}

impl RuntimeTurnToolScope {
    pub fn new(allowed_tools: Vec<String>, disallowed_tools: Vec<String>) -> Self {
        Self {
            allowed_tools,
            disallowed_tools,
        }
    }
}

pub fn runtime_turn_tool_surface_mode_from_metadata(
    metadata: &HashMap<String, Value>,
) -> Option<RuntimeTurnToolSurfaceMode> {
    runtime_turn_tool_surface_mode_from_runtime_metadata(metadata.get(RUNTIME_METADATA_KEY))
}

pub fn runtime_turn_tool_surface_mode_from_runtime_metadata(
    runtime_metadata: Option<&Value>,
) -> Option<RuntimeTurnToolSurfaceMode> {
    runtime_metadata
        .and_then(|value| value.get(RUNTIME_TOOL_SURFACE_KEY))
        .and_then(Value::as_str)
        .and_then(RuntimeTurnToolSurfaceMode::from_raw)
}

pub fn runtime_turn_tool_surface_is_direct_answer(
    mode: Option<&RuntimeTurnToolSurfaceMode>,
) -> bool {
    mode.is_some_and(RuntimeTurnToolSurfaceMode::is_direct_answer)
}

pub fn runtime_turn_tool_surface_is_local_workspace_tool(tool_name: &str) -> bool {
    LOCAL_WORKSPACE_TOOL_NAMES
        .iter()
        .any(|candidate| candidate.eq_ignore_ascii_case(tool_name))
}

pub fn runtime_turn_tool_surface_is_compact_tool(tool_name: &str) -> bool {
    COMPACT_TOOL_SURFACE_TOOL_NAMES
        .iter()
        .any(|candidate| candidate.eq_ignore_ascii_case(tool_name))
}

pub fn runtime_turn_tool_scope_from_metadata(
    metadata: &HashMap<String, Value>,
) -> RuntimeTurnToolScope {
    let scope = metadata
        .get("tool_scope")
        .or_else(|| metadata.get("toolScope"))
        .and_then(Value::as_object)
        .or_else(|| metadata.get("subagent").and_then(Value::as_object));

    let allowed_tools = normalize_turn_metadata_tool_list(scope.and_then(|value| {
        value
            .get("allowed_tools")
            .or_else(|| value.get("allowedTools"))
    }));
    let disallowed_tools = normalize_turn_metadata_tool_list(scope.and_then(|value| {
        value
            .get("disallowed_tools")
            .or_else(|| value.get("disallowedTools"))
    }));

    RuntimeTurnToolScope::new(allowed_tools, disallowed_tools)
}

pub fn runtime_turn_tool_surface_allows_tool_name(
    tool_name: &str,
    mode: Option<&RuntimeTurnToolSurfaceMode>,
    allowed_tools: &[String],
    canonical_name: &dyn Fn(&str) -> Option<String>,
) -> bool {
    match mode {
        Some(RuntimeTurnToolSurfaceMode::DirectAnswer) => false,
        Some(RuntimeTurnToolSurfaceMode::LocalWorkspace) => {
            runtime_turn_tool_surface_is_local_workspace_tool(tool_name)
        }
        Some(RuntimeTurnToolSurfaceMode::CompactTools) => {
            runtime_turn_tool_surface_is_compact_tool(tool_name)
                || matches_runtime_turn_tool_scope(tool_name, allowed_tools, canonical_name)
        }
        Some(RuntimeTurnToolSurfaceMode::Other(_)) | None => true,
    }
}

pub fn runtime_turn_tool_scope_allows_tool_name(
    tool_name: &str,
    scope: &RuntimeTurnToolScope,
    canonical_name: &dyn Fn(&str) -> Option<String>,
) -> bool {
    if !scope.allowed_tools.is_empty()
        && !matches_runtime_turn_tool_scope(tool_name, &scope.allowed_tools, canonical_name)
    {
        return false;
    }

    !matches_runtime_turn_tool_scope(tool_name, &scope.disallowed_tools, canonical_name)
}

pub fn runtime_turn_tool_surface_should_strip_extension_prompt_context(
    mode: Option<&RuntimeTurnToolSurfaceMode>,
) -> bool {
    matches!(
        mode,
        Some(RuntimeTurnToolSurfaceMode::DirectAnswer | RuntimeTurnToolSurfaceMode::LocalWorkspace)
    )
}

pub fn runtime_turn_tool_surface_should_load_workspace_hints(
    mode: Option<&RuntimeTurnToolSurfaceMode>,
) -> bool {
    !matches!(mode, Some(RuntimeTurnToolSurfaceMode::DirectAnswer))
}

pub fn runtime_turn_tool_surface_prompt_guidance(
    mode: Option<&RuntimeTurnToolSurfaceMode>,
) -> Option<&'static str> {
    match mode {
        Some(RuntimeTurnToolSurfaceMode::DirectAnswer) => Some(DIRECT_ANSWER_TURN_GUIDANCE),
        Some(RuntimeTurnToolSurfaceMode::LocalWorkspace) => Some(LOCAL_WORKSPACE_TURN_GUIDANCE),
        _ => None,
    }
}

fn normalize_turn_metadata_tool_list(value: Option<&Value>) -> Vec<String> {
    let Some(items) = value.and_then(Value::as_array) else {
        return Vec::new();
    };

    let mut normalized = Vec::new();
    for item in items {
        let Some(name) = item
            .as_str()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        else {
            continue;
        };
        if normalized
            .iter()
            .any(|existing: &String| existing.eq_ignore_ascii_case(name))
        {
            continue;
        }
        normalized.push(name.to_string());
    }
    normalized
}

fn matches_runtime_turn_tool_scope(
    tool_name: &str,
    scope: &[String],
    canonical_name: &dyn Fn(&str) -> Option<String>,
) -> bool {
    scope.iter().any(|candidate| {
        if candidate.eq_ignore_ascii_case(tool_name) {
            return true;
        }

        let Some(scope_canonical) = canonical_name(candidate) else {
            return false;
        };
        canonical_name(tool_name)
            .is_some_and(|tool_canonical| tool_canonical.eq_ignore_ascii_case(&scope_canonical))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn no_canonical_name(_: &str) -> Option<String> {
        None
    }

    fn native_canonical_name(name: &str) -> Option<String> {
        match name {
            "search_query" | "WebSearchTool" | "WebSearch" => Some("WebSearch".to_string()),
            "WebFetchTool" | "WebFetch" => Some("WebFetch".to_string()),
            "Read" => Some("Read".to_string()),
            _ => None,
        }
    }

    #[test]
    fn turn_tool_surface_mode_reads_runtime_metadata() {
        let metadata = HashMap::from([(
            RUNTIME_METADATA_KEY.to_string(),
            json!({ RUNTIME_TOOL_SURFACE_KEY: TURN_TOOL_SURFACE_DIRECT_ANSWER }),
        )]);

        let mode = runtime_turn_tool_surface_mode_from_metadata(&metadata);

        assert_eq!(mode, Some(RuntimeTurnToolSurfaceMode::DirectAnswer));
        assert!(runtime_turn_tool_surface_is_direct_answer(mode.as_ref()));
    }

    #[test]
    fn turn_tool_scope_normalizes_arrays_and_dedupes_names() {
        let metadata = HashMap::from([(
            "toolScope".to_string(),
            json!({
                "allowedTools": [" Read ", "read", "", 1, "Grep"],
                "disallowedTools": ["WebFetch", "webfetch"],
            }),
        )]);

        let scope = runtime_turn_tool_scope_from_metadata(&metadata);

        assert_eq!(
            scope,
            RuntimeTurnToolScope::new(
                vec!["Read".to_string(), "Grep".to_string()],
                vec!["WebFetch".to_string()]
            )
        );
    }

    #[test]
    fn turn_tool_scope_matches_canonical_aliases() {
        let scope = RuntimeTurnToolScope::new(vec!["search_query".to_string()], Vec::new());

        assert!(runtime_turn_tool_scope_allows_tool_name(
            "WebSearch",
            &scope,
            &native_canonical_name
        ));
        assert!(!runtime_turn_tool_scope_allows_tool_name(
            "WebFetch",
            &scope,
            &native_canonical_name
        ));
    }

    #[test]
    fn turn_tool_surface_filters_direct_local_and_compact_modes() {
        let allowed_tools = vec!["NotebookEdit".to_string()];

        assert!(!runtime_turn_tool_surface_allows_tool_name(
            "Read",
            Some(&RuntimeTurnToolSurfaceMode::DirectAnswer),
            &allowed_tools,
            &no_canonical_name,
        ));
        assert!(runtime_turn_tool_surface_allows_tool_name(
            "Read",
            Some(&RuntimeTurnToolSurfaceMode::LocalWorkspace),
            &allowed_tools,
            &no_canonical_name,
        ));
        assert!(!runtime_turn_tool_surface_allows_tool_name(
            "WebSearch",
            Some(&RuntimeTurnToolSurfaceMode::LocalWorkspace),
            &allowed_tools,
            &no_canonical_name,
        ));
        assert!(runtime_turn_tool_surface_allows_tool_name(
            "WebSearch",
            Some(&RuntimeTurnToolSurfaceMode::CompactTools),
            &allowed_tools,
            &no_canonical_name,
        ));
        assert!(runtime_turn_tool_surface_allows_tool_name(
            "NotebookEdit",
            Some(&RuntimeTurnToolSurfaceMode::CompactTools),
            &allowed_tools,
            &no_canonical_name,
        ));
    }

    #[test]
    fn turn_tool_surface_prompt_policy_matches_modes() {
        assert!(
            runtime_turn_tool_surface_should_strip_extension_prompt_context(Some(
                &RuntimeTurnToolSurfaceMode::DirectAnswer
            ))
        );
        assert!(
            runtime_turn_tool_surface_should_strip_extension_prompt_context(Some(
                &RuntimeTurnToolSurfaceMode::LocalWorkspace
            ))
        );
        assert!(!runtime_turn_tool_surface_should_load_workspace_hints(
            Some(&RuntimeTurnToolSurfaceMode::DirectAnswer)
        ));
        assert!(
            runtime_turn_tool_surface_prompt_guidance(Some(
                &RuntimeTurnToolSurfaceMode::DirectAnswer
            ))
            .is_some()
        );
        assert!(
            runtime_turn_tool_surface_prompt_guidance(Some(
                &RuntimeTurnToolSurfaceMode::CompactTools
            ))
            .is_none()
        );
    }

    #[test]
    fn compact_surface_exposes_codex_unified_exec_pair() {
        assert!(runtime_turn_tool_surface_is_compact_tool("tool_search"));
        assert!(runtime_turn_tool_surface_is_compact_tool("exec_command"));
        assert!(runtime_turn_tool_surface_is_compact_tool("write_stdin"));
        assert!(!runtime_turn_tool_surface_is_compact_tool("Bash"));
        assert!(!runtime_turn_tool_surface_is_compact_tool("PowerShell"));
    }
}
