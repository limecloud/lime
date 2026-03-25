use crate::mcp::McpToolDefinition;
use serde::{Deserialize, Serialize};

pub const TOOL_SEARCH_TOOL_NAME: &str = "tool_search";
pub const SOCIAL_IMAGE_TOOL_NAME: &str = "social_generate_cover_image";
pub const LIME_CREATE_VIDEO_TASK_TOOL_NAME: &str = "lime_create_video_generation_task";
pub const LIME_CREATE_BROADCAST_TASK_TOOL_NAME: &str = "lime_create_broadcast_generation_task";
pub const LIME_CREATE_COVER_TASK_TOOL_NAME: &str = "lime_create_cover_generation_task";
pub const LIME_CREATE_RESOURCE_SEARCH_TASK_TOOL_NAME: &str =
    "lime_create_modal_resource_search_task";
pub const LIME_CREATE_IMAGE_TASK_TOOL_NAME: &str = "lime_create_image_generation_task";
pub const LIME_CREATE_URL_PARSE_TASK_TOOL_NAME: &str = "lime_create_url_parse_task";
pub const LIME_CREATE_TYPESETTING_TASK_TOOL_NAME: &str = "lime_create_typesetting_task";
pub const LIME_SITE_LIST_TOOL_NAME: &str = "lime_site_list";
pub const LIME_SITE_SEARCH_TOOL_NAME: &str = "lime_site_search";
pub const LIME_SITE_INFO_TOOL_NAME: &str = "lime_site_info";
pub const LIME_SITE_RUN_TOOL_NAME: &str = "lime_site_run";
pub const BROWSER_RUNTIME_TOOL_PREFIX: &str = "mcp__lime-browser__";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ToolSurfaceProfile {
    Core,
    Creator,
    BrowserAssist,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ToolCapability {
    Planning,
    Delegation,
    WebSearch,
    SkillExecution,
    SessionControl,
    ContentCreation,
    BrowserRuntime,
    WorkspaceIo,
    Execution,
    Vision,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ToolLifecycle {
    Current,
    Compat,
    Deprecated,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ToolSourceKind {
    AsterBuiltin,
    LimeInjected,
    BrowserCompatibility,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ToolPermissionPlane {
    SessionAllowlist,
    ParameterRestricted,
    CallerFiltered,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct ToolCatalogEntry {
    pub name: &'static str,
    pub profiles: &'static [ToolSurfaceProfile],
    pub capabilities: &'static [ToolCapability],
    pub lifecycle: ToolLifecycle,
    pub source: ToolSourceKind,
    pub permission_plane: ToolPermissionPlane,
    pub workspace_default_allow: bool,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct WorkspaceToolSurface {
    pub creator: bool,
    pub browser_assist: bool,
}

impl WorkspaceToolSurface {
    pub const fn core() -> Self {
        Self {
            creator: false,
            browser_assist: false,
        }
    }

    pub const fn creator() -> Self {
        Self {
            creator: true,
            browser_assist: false,
        }
    }

    pub const fn browser_assist() -> Self {
        Self {
            creator: false,
            browser_assist: true,
        }
    }

    pub const fn creator_with_browser_assist() -> Self {
        Self {
            creator: true,
            browser_assist: true,
        }
    }

    pub const fn includes_profile(self, profile: ToolSurfaceProfile) -> bool {
        match profile {
            ToolSurfaceProfile::Core => true,
            ToolSurfaceProfile::Creator => self.creator,
            ToolSurfaceProfile::BrowserAssist => self.browser_assist,
        }
    }
}

const CORE_PROFILES: &[ToolSurfaceProfile] = &[ToolSurfaceProfile::Core];
const CREATOR_PROFILES: &[ToolSurfaceProfile] = &[ToolSurfaceProfile::Creator];
const BROWSER_PROFILES: &[ToolSurfaceProfile] = &[ToolSurfaceProfile::BrowserAssist];

const PLAN_CAP: &[ToolCapability] = &[ToolCapability::Planning];
const DELEGATION_CAP: &[ToolCapability] =
    &[ToolCapability::Delegation, ToolCapability::SessionControl];
const SEARCH_CAP: &[ToolCapability] = &[ToolCapability::WebSearch];
const SKILL_CAP: &[ToolCapability] = &[ToolCapability::SkillExecution];
const CONTENT_CAP: &[ToolCapability] = &[ToolCapability::ContentCreation];
const BROWSER_CAP: &[ToolCapability] = &[ToolCapability::BrowserRuntime];
const SITE_CAP: &[ToolCapability] = &[ToolCapability::BrowserRuntime, ToolCapability::WebSearch];
const WORKSPACE_IO_CAP: &[ToolCapability] = &[ToolCapability::WorkspaceIo];
const EXECUTION_CAP: &[ToolCapability] = &[ToolCapability::Execution];
const VISION_CAP: &[ToolCapability] = &[ToolCapability::Vision];

static NATIVE_TOOL_CATALOG: &[ToolCatalogEntry] = &[
    ToolCatalogEntry {
        name: "read",
        profiles: CORE_PROFILES,
        capabilities: WORKSPACE_IO_CAP,
        lifecycle: ToolLifecycle::Current,
        source: ToolSourceKind::AsterBuiltin,
        permission_plane: ToolPermissionPlane::ParameterRestricted,
        workspace_default_allow: false,
    },
    ToolCatalogEntry {
        name: "write",
        profiles: CORE_PROFILES,
        capabilities: WORKSPACE_IO_CAP,
        lifecycle: ToolLifecycle::Current,
        source: ToolSourceKind::AsterBuiltin,
        permission_plane: ToolPermissionPlane::ParameterRestricted,
        workspace_default_allow: false,
    },
    ToolCatalogEntry {
        name: "edit",
        profiles: CORE_PROFILES,
        capabilities: WORKSPACE_IO_CAP,
        lifecycle: ToolLifecycle::Current,
        source: ToolSourceKind::AsterBuiltin,
        permission_plane: ToolPermissionPlane::ParameterRestricted,
        workspace_default_allow: false,
    },
    ToolCatalogEntry {
        name: "glob",
        profiles: CORE_PROFILES,
        capabilities: WORKSPACE_IO_CAP,
        lifecycle: ToolLifecycle::Current,
        source: ToolSourceKind::AsterBuiltin,
        permission_plane: ToolPermissionPlane::ParameterRestricted,
        workspace_default_allow: false,
    },
    ToolCatalogEntry {
        name: "grep",
        profiles: CORE_PROFILES,
        capabilities: WORKSPACE_IO_CAP,
        lifecycle: ToolLifecycle::Current,
        source: ToolSourceKind::AsterBuiltin,
        permission_plane: ToolPermissionPlane::ParameterRestricted,
        workspace_default_allow: false,
    },
    ToolCatalogEntry {
        name: "bash",
        profiles: CORE_PROFILES,
        capabilities: EXECUTION_CAP,
        lifecycle: ToolLifecycle::Current,
        source: ToolSourceKind::AsterBuiltin,
        permission_plane: ToolPermissionPlane::ParameterRestricted,
        workspace_default_allow: false,
    },
    ToolCatalogEntry {
        name: "lsp",
        profiles: CORE_PROFILES,
        capabilities: WORKSPACE_IO_CAP,
        lifecycle: ToolLifecycle::Current,
        source: ToolSourceKind::AsterBuiltin,
        permission_plane: ToolPermissionPlane::ParameterRestricted,
        workspace_default_allow: false,
    },
    ToolCatalogEntry {
        name: "Skill",
        profiles: CORE_PROFILES,
        capabilities: SKILL_CAP,
        lifecycle: ToolLifecycle::Current,
        source: ToolSourceKind::AsterBuiltin,
        permission_plane: ToolPermissionPlane::SessionAllowlist,
        workspace_default_allow: true,
    },
    ToolCatalogEntry {
        name: "Task",
        profiles: CORE_PROFILES,
        capabilities: EXECUTION_CAP,
        lifecycle: ToolLifecycle::Current,
        source: ToolSourceKind::AsterBuiltin,
        permission_plane: ToolPermissionPlane::ParameterRestricted,
        workspace_default_allow: false,
    },
    ToolCatalogEntry {
        name: "TaskOutput",
        profiles: CORE_PROFILES,
        capabilities: PLAN_CAP,
        lifecycle: ToolLifecycle::Current,
        source: ToolSourceKind::AsterBuiltin,
        permission_plane: ToolPermissionPlane::SessionAllowlist,
        workspace_default_allow: true,
    },
    ToolCatalogEntry {
        name: "KillShell",
        profiles: CORE_PROFILES,
        capabilities: EXECUTION_CAP,
        lifecycle: ToolLifecycle::Current,
        source: ToolSourceKind::AsterBuiltin,
        permission_plane: ToolPermissionPlane::SessionAllowlist,
        workspace_default_allow: true,
    },
    ToolCatalogEntry {
        name: "TodoWrite",
        profiles: CORE_PROFILES,
        capabilities: PLAN_CAP,
        lifecycle: ToolLifecycle::Current,
        source: ToolSourceKind::AsterBuiltin,
        permission_plane: ToolPermissionPlane::SessionAllowlist,
        workspace_default_allow: true,
    },
    ToolCatalogEntry {
        name: "NotebookEdit",
        profiles: CORE_PROFILES,
        capabilities: WORKSPACE_IO_CAP,
        lifecycle: ToolLifecycle::Current,
        source: ToolSourceKind::AsterBuiltin,
        permission_plane: ToolPermissionPlane::ParameterRestricted,
        workspace_default_allow: false,
    },
    ToolCatalogEntry {
        name: "EnterPlanMode",
        profiles: CORE_PROFILES,
        capabilities: PLAN_CAP,
        lifecycle: ToolLifecycle::Current,
        source: ToolSourceKind::AsterBuiltin,
        permission_plane: ToolPermissionPlane::SessionAllowlist,
        workspace_default_allow: true,
    },
    ToolCatalogEntry {
        name: "ExitPlanMode",
        profiles: CORE_PROFILES,
        capabilities: PLAN_CAP,
        lifecycle: ToolLifecycle::Current,
        source: ToolSourceKind::AsterBuiltin,
        permission_plane: ToolPermissionPlane::SessionAllowlist,
        workspace_default_allow: true,
    },
    ToolCatalogEntry {
        name: "WebFetch",
        profiles: CORE_PROFILES,
        capabilities: SEARCH_CAP,
        lifecycle: ToolLifecycle::Current,
        source: ToolSourceKind::AsterBuiltin,
        permission_plane: ToolPermissionPlane::ParameterRestricted,
        workspace_default_allow: false,
    },
    ToolCatalogEntry {
        name: "WebSearch",
        profiles: CORE_PROFILES,
        capabilities: SEARCH_CAP,
        lifecycle: ToolLifecycle::Current,
        source: ToolSourceKind::AsterBuiltin,
        permission_plane: ToolPermissionPlane::SessionAllowlist,
        workspace_default_allow: true,
    },
    ToolCatalogEntry {
        name: "analyze_image",
        profiles: CORE_PROFILES,
        capabilities: VISION_CAP,
        lifecycle: ToolLifecycle::Current,
        source: ToolSourceKind::AsterBuiltin,
        permission_plane: ToolPermissionPlane::ParameterRestricted,
        workspace_default_allow: false,
    },
    ToolCatalogEntry {
        name: "ask",
        profiles: CORE_PROFILES,
        capabilities: PLAN_CAP,
        lifecycle: ToolLifecycle::Current,
        source: ToolSourceKind::AsterBuiltin,
        permission_plane: ToolPermissionPlane::SessionAllowlist,
        workspace_default_allow: true,
    },
    ToolCatalogEntry {
        name: TOOL_SEARCH_TOOL_NAME,
        profiles: CORE_PROFILES,
        capabilities: SEARCH_CAP,
        lifecycle: ToolLifecycle::Current,
        source: ToolSourceKind::LimeInjected,
        permission_plane: ToolPermissionPlane::SessionAllowlist,
        workspace_default_allow: true,
    },
    ToolCatalogEntry {
        name: "spawn_agent",
        profiles: CORE_PROFILES,
        capabilities: DELEGATION_CAP,
        lifecycle: ToolLifecycle::Current,
        source: ToolSourceKind::LimeInjected,
        permission_plane: ToolPermissionPlane::SessionAllowlist,
        workspace_default_allow: true,
    },
    ToolCatalogEntry {
        name: "send_input",
        profiles: CORE_PROFILES,
        capabilities: DELEGATION_CAP,
        lifecycle: ToolLifecycle::Current,
        source: ToolSourceKind::LimeInjected,
        permission_plane: ToolPermissionPlane::SessionAllowlist,
        workspace_default_allow: true,
    },
    ToolCatalogEntry {
        name: "wait_agent",
        profiles: CORE_PROFILES,
        capabilities: DELEGATION_CAP,
        lifecycle: ToolLifecycle::Current,
        source: ToolSourceKind::LimeInjected,
        permission_plane: ToolPermissionPlane::SessionAllowlist,
        workspace_default_allow: true,
    },
    ToolCatalogEntry {
        name: "resume_agent",
        profiles: CORE_PROFILES,
        capabilities: DELEGATION_CAP,
        lifecycle: ToolLifecycle::Current,
        source: ToolSourceKind::LimeInjected,
        permission_plane: ToolPermissionPlane::SessionAllowlist,
        workspace_default_allow: true,
    },
    ToolCatalogEntry {
        name: "close_agent",
        profiles: CORE_PROFILES,
        capabilities: DELEGATION_CAP,
        lifecycle: ToolLifecycle::Current,
        source: ToolSourceKind::LimeInjected,
        permission_plane: ToolPermissionPlane::SessionAllowlist,
        workspace_default_allow: true,
    },
    ToolCatalogEntry {
        name: "SubAgentTask",
        profiles: CORE_PROFILES,
        capabilities: DELEGATION_CAP,
        lifecycle: ToolLifecycle::Compat,
        source: ToolSourceKind::LimeInjected,
        permission_plane: ToolPermissionPlane::SessionAllowlist,
        workspace_default_allow: false,
    },
    ToolCatalogEntry {
        name: SOCIAL_IMAGE_TOOL_NAME,
        profiles: CREATOR_PROFILES,
        capabilities: CONTENT_CAP,
        lifecycle: ToolLifecycle::Current,
        source: ToolSourceKind::LimeInjected,
        permission_plane: ToolPermissionPlane::SessionAllowlist,
        workspace_default_allow: true,
    },
    ToolCatalogEntry {
        name: LIME_CREATE_VIDEO_TASK_TOOL_NAME,
        profiles: CREATOR_PROFILES,
        capabilities: CONTENT_CAP,
        lifecycle: ToolLifecycle::Current,
        source: ToolSourceKind::LimeInjected,
        permission_plane: ToolPermissionPlane::SessionAllowlist,
        workspace_default_allow: true,
    },
    ToolCatalogEntry {
        name: LIME_CREATE_BROADCAST_TASK_TOOL_NAME,
        profiles: CREATOR_PROFILES,
        capabilities: CONTENT_CAP,
        lifecycle: ToolLifecycle::Current,
        source: ToolSourceKind::LimeInjected,
        permission_plane: ToolPermissionPlane::SessionAllowlist,
        workspace_default_allow: true,
    },
    ToolCatalogEntry {
        name: LIME_CREATE_COVER_TASK_TOOL_NAME,
        profiles: CREATOR_PROFILES,
        capabilities: CONTENT_CAP,
        lifecycle: ToolLifecycle::Current,
        source: ToolSourceKind::LimeInjected,
        permission_plane: ToolPermissionPlane::SessionAllowlist,
        workspace_default_allow: true,
    },
    ToolCatalogEntry {
        name: LIME_CREATE_RESOURCE_SEARCH_TASK_TOOL_NAME,
        profiles: CREATOR_PROFILES,
        capabilities: CONTENT_CAP,
        lifecycle: ToolLifecycle::Current,
        source: ToolSourceKind::LimeInjected,
        permission_plane: ToolPermissionPlane::SessionAllowlist,
        workspace_default_allow: true,
    },
    ToolCatalogEntry {
        name: LIME_CREATE_IMAGE_TASK_TOOL_NAME,
        profiles: CREATOR_PROFILES,
        capabilities: CONTENT_CAP,
        lifecycle: ToolLifecycle::Current,
        source: ToolSourceKind::LimeInjected,
        permission_plane: ToolPermissionPlane::SessionAllowlist,
        workspace_default_allow: true,
    },
    ToolCatalogEntry {
        name: LIME_CREATE_URL_PARSE_TASK_TOOL_NAME,
        profiles: CREATOR_PROFILES,
        capabilities: CONTENT_CAP,
        lifecycle: ToolLifecycle::Current,
        source: ToolSourceKind::LimeInjected,
        permission_plane: ToolPermissionPlane::SessionAllowlist,
        workspace_default_allow: true,
    },
    ToolCatalogEntry {
        name: LIME_CREATE_TYPESETTING_TASK_TOOL_NAME,
        profiles: CREATOR_PROFILES,
        capabilities: CONTENT_CAP,
        lifecycle: ToolLifecycle::Current,
        source: ToolSourceKind::LimeInjected,
        permission_plane: ToolPermissionPlane::SessionAllowlist,
        workspace_default_allow: true,
    },
    ToolCatalogEntry {
        name: LIME_SITE_LIST_TOOL_NAME,
        profiles: BROWSER_PROFILES,
        capabilities: SITE_CAP,
        lifecycle: ToolLifecycle::Current,
        source: ToolSourceKind::LimeInjected,
        permission_plane: ToolPermissionPlane::SessionAllowlist,
        workspace_default_allow: true,
    },
    ToolCatalogEntry {
        name: LIME_SITE_SEARCH_TOOL_NAME,
        profiles: BROWSER_PROFILES,
        capabilities: SITE_CAP,
        lifecycle: ToolLifecycle::Current,
        source: ToolSourceKind::LimeInjected,
        permission_plane: ToolPermissionPlane::SessionAllowlist,
        workspace_default_allow: true,
    },
    ToolCatalogEntry {
        name: LIME_SITE_INFO_TOOL_NAME,
        profiles: BROWSER_PROFILES,
        capabilities: SITE_CAP,
        lifecycle: ToolLifecycle::Current,
        source: ToolSourceKind::LimeInjected,
        permission_plane: ToolPermissionPlane::SessionAllowlist,
        workspace_default_allow: true,
    },
    ToolCatalogEntry {
        name: LIME_SITE_RUN_TOOL_NAME,
        profiles: BROWSER_PROFILES,
        capabilities: SITE_CAP,
        lifecycle: ToolLifecycle::Current,
        source: ToolSourceKind::LimeInjected,
        permission_plane: ToolPermissionPlane::SessionAllowlist,
        workspace_default_allow: true,
    },
    ToolCatalogEntry {
        name: BROWSER_RUNTIME_TOOL_PREFIX,
        profiles: BROWSER_PROFILES,
        capabilities: BROWSER_CAP,
        lifecycle: ToolLifecycle::Current,
        source: ToolSourceKind::BrowserCompatibility,
        permission_plane: ToolPermissionPlane::CallerFiltered,
        workspace_default_allow: false,
    },
];

pub fn native_tool_catalog() -> &'static [ToolCatalogEntry] {
    NATIVE_TOOL_CATALOG
}

pub fn tool_catalog_entry(tool_name: &str) -> Option<&'static ToolCatalogEntry> {
    let normalized_name = tool_name.trim();
    native_tool_catalog()
        .iter()
        .filter(|entry| {
            if entry.name.ends_with("__") {
                normalized_name.starts_with(entry.name)
            } else {
                entry.name == normalized_name
            }
        })
        .max_by_key(|entry| entry.name.len())
}

pub fn tool_catalog_entries_for_surface(
    surface: WorkspaceToolSurface,
) -> Vec<&'static ToolCatalogEntry> {
    native_tool_catalog()
        .iter()
        .filter(|entry| {
            entry
                .profiles
                .iter()
                .any(|profile| surface.includes_profile(*profile))
        })
        .collect()
}

pub fn workspace_default_allowed_tool_names(surface: WorkspaceToolSurface) -> Vec<&'static str> {
    let mut names = tool_catalog_entries_for_surface(surface)
        .into_iter()
        .filter(|entry| entry.workspace_default_allow)
        .filter(|entry| entry.lifecycle == ToolLifecycle::Current)
        .filter(|entry| !entry.name.ends_with("__"))
        .map(|entry| entry.name)
        .collect::<Vec<_>>();
    names.sort_unstable();
    names.dedup();
    names
}

pub fn workspace_allowed_tool_names(surface: WorkspaceToolSurface) -> Vec<&'static str> {
    workspace_default_allowed_tool_names(surface)
}

pub fn creator_tool_names() -> Vec<&'static str> {
    tool_catalog_entries_for_surface(WorkspaceToolSurface::creator())
        .into_iter()
        .filter(|entry| entry.profiles.contains(&ToolSurfaceProfile::Creator))
        .filter(|entry| entry.name != BROWSER_RUNTIME_TOOL_PREFIX)
        .map(|entry| entry.name)
        .collect()
}

pub fn browser_runtime_tool_prefix() -> &'static str {
    BROWSER_RUNTIME_TOOL_PREFIX
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct McpExtensionSurface {
    pub extension_name: String,
    pub description: String,
    pub available_tools: Vec<String>,
    pub always_expose_tools: Vec<String>,
    pub deferred_loading: bool,
    pub allowed_caller: Option<String>,
}

impl McpExtensionSurface {
    pub fn has_tools(&self) -> bool {
        !self.available_tools.is_empty()
    }
}

pub fn build_mcp_extension_surface(
    extension_name: &str,
    description: impl Into<String>,
    tools: &[McpToolDefinition],
) -> McpExtensionSurface {
    let mut available_tools = tools
        .iter()
        .map(|tool| tool.name.clone())
        .collect::<Vec<_>>();
    available_tools.sort();
    available_tools.dedup();

    let mut always_expose_tools = tools
        .iter()
        .filter(|tool| {
            tool.always_visible.unwrap_or(false) || !tool.deferred_loading.unwrap_or(false)
        })
        .map(|tool| tool.name.clone())
        .collect::<Vec<_>>();
    always_expose_tools.sort();
    always_expose_tools.dedup();

    let deferred_loading = tools
        .iter()
        .any(|tool| tool.deferred_loading.unwrap_or(false));
    let allowed_caller = collapse_extension_allowed_caller(tools);

    McpExtensionSurface {
        extension_name: extension_name.to_string(),
        description: description.into(),
        available_tools,
        always_expose_tools,
        deferred_loading,
        allowed_caller,
    }
}

fn collapse_extension_allowed_caller(tools: &[McpToolDefinition]) -> Option<String> {
    let mut collapsed: Option<String> = None;

    for tool in tools {
        let allowed = tool.allowed_callers.as_ref()?;
        if allowed.len() != 1 {
            return None;
        }
        let caller = allowed[0].trim();
        if caller.is_empty() {
            return None;
        }
        match collapsed.as_deref() {
            Some(existing) if existing != caller => return None,
            Some(_) => {}
            None => collapsed = Some(caller.to_string()),
        }
    }

    collapsed
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeSet;

    fn sample_tool(
        name: &str,
        deferred_loading: Option<bool>,
        always_visible: Option<bool>,
        allowed_callers: Option<Vec<&str>>,
    ) -> McpToolDefinition {
        McpToolDefinition {
            name: name.to_string(),
            description: format!("desc for {name}"),
            input_schema: serde_json::json!({ "type": "object" }),
            server_name: "docs".to_string(),
            deferred_loading,
            always_visible,
            allowed_callers: allowed_callers.map(|items| {
                items
                    .into_iter()
                    .map(|item| item.to_string())
                    .collect::<Vec<_>>()
            }),
            input_examples: None,
            tags: None,
        }
    }

    #[test]
    fn test_tool_catalog_entry_matches_browser_prefix() {
        let entry = tool_catalog_entry("mcp__lime-browser__navigate")
            .expect("browser tool should match prefix catalog entry");
        assert_eq!(entry.name, BROWSER_RUNTIME_TOOL_PREFIX);
        assert_eq!(entry.source, ToolSourceKind::BrowserCompatibility);
    }

    #[test]
    fn test_workspace_default_allowed_tool_names_excludes_parameter_restricted_tools() {
        let names = workspace_default_allowed_tool_names(WorkspaceToolSurface::core());
        assert!(names.contains(&"spawn_agent"));
        assert!(names.contains(&"WebSearch"));
        assert!(!names.contains(&"SubAgentTask"));
        assert!(!names.contains(&"read"));
        assert!(!names.contains(&"bash"));
        assert!(!names.contains(&SOCIAL_IMAGE_TOOL_NAME));
    }

    #[test]
    fn test_workspace_default_allowed_tool_names_includes_creator_surface() {
        let names = workspace_default_allowed_tool_names(WorkspaceToolSurface::creator());
        assert!(names.contains(&SOCIAL_IMAGE_TOOL_NAME));
        assert!(names.contains(&LIME_CREATE_VIDEO_TASK_TOOL_NAME));
    }

    #[test]
    fn test_tool_catalog_entries_for_surface_counts_and_lifecycle_boundaries() {
        let core = tool_catalog_entries_for_surface(WorkspaceToolSurface::core());
        assert_eq!(core.len(), 26);
        assert_eq!(
            core.iter()
                .filter(|entry| entry.lifecycle == ToolLifecycle::Current)
                .count(),
            25
        );
        assert_eq!(
            core.iter()
                .filter(|entry| entry.lifecycle == ToolLifecycle::Compat)
                .count(),
            1
        );
        assert!(core
            .iter()
            .all(|entry| !entry.profiles.contains(&ToolSurfaceProfile::Creator)));
        assert!(core
            .iter()
            .all(|entry| !entry.profiles.contains(&ToolSurfaceProfile::BrowserAssist)));

        let creator = tool_catalog_entries_for_surface(WorkspaceToolSurface::creator());
        assert_eq!(creator.len(), 34);
        assert!(creator
            .iter()
            .any(|entry| entry.name == SOCIAL_IMAGE_TOOL_NAME));
        assert!(!creator
            .iter()
            .any(|entry| entry.name == BROWSER_RUNTIME_TOOL_PREFIX));

        let browser = tool_catalog_entries_for_surface(WorkspaceToolSurface::browser_assist());
        assert_eq!(browser.len(), 31);
        assert!(browser
            .iter()
            .any(|entry| entry.name == BROWSER_RUNTIME_TOOL_PREFIX));

        let combined =
            tool_catalog_entries_for_surface(WorkspaceToolSurface::creator_with_browser_assist());
        assert_eq!(combined.len(), 39);
    }

    #[test]
    fn test_creator_tool_names_only_returns_creator_increment() {
        let names = creator_tool_names().into_iter().collect::<BTreeSet<_>>();
        assert_eq!(names.len(), 8);
        assert!(names.contains(SOCIAL_IMAGE_TOOL_NAME));
        assert!(names.contains(LIME_CREATE_VIDEO_TASK_TOOL_NAME));
        assert!(!names.contains("tool_search"));
        assert!(!names.contains(BROWSER_RUNTIME_TOOL_PREFIX));
    }

    #[test]
    fn test_workspace_default_allowed_tool_names_creator_with_browser_assist_excludes_prefix_tool()
    {
        let names = workspace_default_allowed_tool_names(
            WorkspaceToolSurface::creator_with_browser_assist(),
        );
        assert_eq!(names.len(), 26);
        assert!(names.contains(&SOCIAL_IMAGE_TOOL_NAME));
        assert!(names.contains(&"tool_search"));
        assert!(names.contains(&LIME_SITE_RUN_TOOL_NAME));
        assert!(!names
            .iter()
            .any(|name| name.starts_with(BROWSER_RUNTIME_TOOL_PREFIX)));
    }

    #[test]
    fn test_build_mcp_extension_surface_collapses_single_caller() {
        let tools = vec![
            sample_tool(
                "search_docs",
                Some(true),
                Some(false),
                Some(vec!["assistant"]),
            ),
            sample_tool(
                "read_docs",
                Some(false),
                Some(true),
                Some(vec!["assistant"]),
            ),
        ];

        let surface = build_mcp_extension_surface("docs", "docs tools", &tools);
        assert!(surface.deferred_loading);
        assert_eq!(surface.allowed_caller.as_deref(), Some("assistant"));
        assert_eq!(surface.always_expose_tools, vec!["read_docs".to_string()]);
    }

    #[test]
    fn test_build_mcp_extension_surface_drops_mixed_callers() {
        let tools = vec![
            sample_tool(
                "search_docs",
                Some(true),
                Some(false),
                Some(vec!["assistant"]),
            ),
            sample_tool(
                "admin_docs",
                Some(true),
                Some(false),
                Some(vec!["code_execution"]),
            ),
        ];

        let surface = build_mcp_extension_surface("docs", "docs tools", &tools);
        assert_eq!(surface.allowed_caller, None);
    }

    #[test]
    fn test_build_mcp_extension_surface_dedups_available_and_exposed_tools() {
        let tools = vec![
            sample_tool(
                "search_docs",
                Some(true),
                Some(true),
                Some(vec!["assistant"]),
            ),
            sample_tool(
                "read_docs",
                Some(false),
                Some(false),
                Some(vec!["assistant"]),
            ),
            sample_tool(
                "search_docs",
                Some(true),
                Some(true),
                Some(vec!["assistant"]),
            ),
        ];

        let surface = build_mcp_extension_surface("docs", "docs tools", &tools);
        assert!(surface.deferred_loading);
        assert_eq!(surface.allowed_caller.as_deref(), Some("assistant"));
        assert_eq!(
            surface.available_tools,
            vec!["read_docs".to_string(), "search_docs".to_string()]
        );
        assert_eq!(
            surface.always_expose_tools,
            vec!["read_docs".to_string(), "search_docs".to_string()]
        );
    }

    #[test]
    fn test_build_mcp_extension_surface_rejects_blank_allowed_caller() {
        let tools = vec![
            sample_tool(
                "search_docs",
                Some(true),
                Some(false),
                Some(vec!["assistant"]),
            ),
            sample_tool("read_docs", Some(false), Some(true), Some(vec!["   "])),
        ];

        let surface = build_mcp_extension_surface("docs", "docs tools", &tools);
        assert_eq!(surface.allowed_caller, None);
    }
}
