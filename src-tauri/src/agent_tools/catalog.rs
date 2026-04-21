use crate::mcp::McpToolDefinition;
use serde::{Deserialize, Serialize};

pub const TOOL_SEARCH_TOOL_NAME: &str = "ToolSearch";
pub const LIST_MCP_RESOURCES_TOOL_NAME: &str = "ListMcpResourcesTool";
pub const READ_MCP_RESOURCE_TOOL_NAME: &str = "ReadMcpResourceTool";
pub const SOCIAL_IMAGE_TOOL_NAME: &str = "social_generate_cover_image";
pub const LIME_CREATE_VIDEO_TASK_TOOL_NAME: &str = "lime_create_video_generation_task";
pub const LIME_CREATE_TRANSCRIPTION_TASK_TOOL_NAME: &str = "lime_create_transcription_task";
pub const LIME_CREATE_BROADCAST_TASK_TOOL_NAME: &str = "lime_create_broadcast_generation_task";
pub const LIME_CREATE_COVER_TASK_TOOL_NAME: &str = "lime_create_cover_generation_task";
pub const LIME_CREATE_RESOURCE_SEARCH_TASK_TOOL_NAME: &str =
    "lime_create_modal_resource_search_task";
pub const LIME_SEARCH_WEB_IMAGES_TOOL_NAME: &str = "lime_search_web_images";
pub const LIME_CREATE_IMAGE_TASK_TOOL_NAME: &str = "lime_create_image_generation_task";
pub const LIME_CREATE_URL_PARSE_TASK_TOOL_NAME: &str = "lime_create_url_parse_task";
pub const LIME_CREATE_TYPESETTING_TASK_TOOL_NAME: &str = "lime_create_typesetting_task";
pub const LIME_RUN_SERVICE_SKILL_TOOL_NAME: &str = "lime_run_service_skill";
pub const LIME_SITE_LIST_TOOL_NAME: &str = "lime_site_list";
pub const LIME_SITE_RECOMMEND_TOOL_NAME: &str = "lime_site_recommend";
pub const LIME_SITE_SEARCH_TOOL_NAME: &str = "lime_site_search";
pub const LIME_SITE_INFO_TOOL_NAME: &str = "lime_site_info";
pub const LIME_SITE_RUN_TOOL_NAME: &str = "lime_site_run";
pub const BROWSER_RUNTIME_TOOL_PREFIX: &str = "mcp__lime-browser__";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ToolSurfaceProfile {
    Core,
    #[serde(rename = "workbench")]
    Workbench,
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
    pub workbench: bool,
    pub browser_assist: bool,
}

impl WorkspaceToolSurface {
    pub const fn core() -> Self {
        Self {
            workbench: false,
            browser_assist: false,
        }
    }

    pub const fn workbench() -> Self {
        Self {
            workbench: true,
            browser_assist: false,
        }
    }

    pub const fn browser_assist() -> Self {
        Self {
            workbench: false,
            browser_assist: true,
        }
    }

    pub const fn workbench_with_browser_assist() -> Self {
        Self {
            workbench: true,
            browser_assist: true,
        }
    }

    pub const fn includes_profile(self, profile: ToolSurfaceProfile) -> bool {
        match profile {
            ToolSurfaceProfile::Core => true,
            ToolSurfaceProfile::Workbench => self.workbench,
            ToolSurfaceProfile::BrowserAssist => self.browser_assist,
        }
    }
}

const CORE_PROFILES: &[ToolSurfaceProfile] = &[ToolSurfaceProfile::Core];
const WORKBENCH_PROFILES: &[ToolSurfaceProfile] = &[ToolSurfaceProfile::Workbench];
const BROWSER_PROFILES: &[ToolSurfaceProfile] = &[ToolSurfaceProfile::BrowserAssist];

const PLAN_CAP: &[ToolCapability] = &[ToolCapability::Planning];
const DELEGATION_CAP: &[ToolCapability] =
    &[ToolCapability::Delegation, ToolCapability::SessionControl];
const SEARCH_CAP: &[ToolCapability] = &[ToolCapability::WebSearch];
const SKILL_CAP: &[ToolCapability] = &[ToolCapability::SkillExecution];
const CONTENT_CAP: &[ToolCapability] = &[ToolCapability::ContentCreation];
const BROWSER_CAP: &[ToolCapability] = &[ToolCapability::BrowserRuntime];
const SITE_CAP: &[ToolCapability] = &[ToolCapability::BrowserRuntime, ToolCapability::WebSearch];
const SESSION_CAP: &[ToolCapability] = &[ToolCapability::SessionControl];
const WORKSPACE_IO_CAP: &[ToolCapability] = &[ToolCapability::WorkspaceIo];
const EXECUTION_CAP: &[ToolCapability] = &[ToolCapability::Execution];

static NATIVE_TOOL_CATALOG: &[ToolCatalogEntry] = &[
    ToolCatalogEntry {
        name: "Read",
        profiles: CORE_PROFILES,
        capabilities: WORKSPACE_IO_CAP,
        lifecycle: ToolLifecycle::Current,
        source: ToolSourceKind::AsterBuiltin,
        permission_plane: ToolPermissionPlane::ParameterRestricted,
        workspace_default_allow: false,
    },
    ToolCatalogEntry {
        name: "Write",
        profiles: CORE_PROFILES,
        capabilities: WORKSPACE_IO_CAP,
        lifecycle: ToolLifecycle::Current,
        source: ToolSourceKind::AsterBuiltin,
        permission_plane: ToolPermissionPlane::ParameterRestricted,
        workspace_default_allow: false,
    },
    ToolCatalogEntry {
        name: "Edit",
        profiles: CORE_PROFILES,
        capabilities: WORKSPACE_IO_CAP,
        lifecycle: ToolLifecycle::Current,
        source: ToolSourceKind::AsterBuiltin,
        permission_plane: ToolPermissionPlane::ParameterRestricted,
        workspace_default_allow: false,
    },
    ToolCatalogEntry {
        name: "Glob",
        profiles: CORE_PROFILES,
        capabilities: WORKSPACE_IO_CAP,
        lifecycle: ToolLifecycle::Current,
        source: ToolSourceKind::AsterBuiltin,
        permission_plane: ToolPermissionPlane::ParameterRestricted,
        workspace_default_allow: false,
    },
    ToolCatalogEntry {
        name: "Grep",
        profiles: CORE_PROFILES,
        capabilities: WORKSPACE_IO_CAP,
        lifecycle: ToolLifecycle::Current,
        source: ToolSourceKind::AsterBuiltin,
        permission_plane: ToolPermissionPlane::ParameterRestricted,
        workspace_default_allow: false,
    },
    ToolCatalogEntry {
        name: "Bash",
        profiles: CORE_PROFILES,
        capabilities: EXECUTION_CAP,
        lifecycle: ToolLifecycle::Current,
        source: ToolSourceKind::AsterBuiltin,
        permission_plane: ToolPermissionPlane::ParameterRestricted,
        workspace_default_allow: false,
    },
    ToolCatalogEntry {
        name: "LSP",
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
        name: "Workflow",
        profiles: CORE_PROFILES,
        capabilities: EXECUTION_CAP,
        lifecycle: ToolLifecycle::Current,
        source: ToolSourceKind::AsterBuiltin,
        permission_plane: ToolPermissionPlane::SessionAllowlist,
        workspace_default_allow: true,
    },
    ToolCatalogEntry {
        name: "TaskCreate",
        profiles: CORE_PROFILES,
        capabilities: PLAN_CAP,
        lifecycle: ToolLifecycle::Current,
        source: ToolSourceKind::AsterBuiltin,
        permission_plane: ToolPermissionPlane::SessionAllowlist,
        workspace_default_allow: true,
    },
    ToolCatalogEntry {
        name: "TaskList",
        profiles: CORE_PROFILES,
        capabilities: PLAN_CAP,
        lifecycle: ToolLifecycle::Current,
        source: ToolSourceKind::AsterBuiltin,
        permission_plane: ToolPermissionPlane::SessionAllowlist,
        workspace_default_allow: true,
    },
    ToolCatalogEntry {
        name: "TaskGet",
        profiles: CORE_PROFILES,
        capabilities: PLAN_CAP,
        lifecycle: ToolLifecycle::Current,
        source: ToolSourceKind::AsterBuiltin,
        permission_plane: ToolPermissionPlane::SessionAllowlist,
        workspace_default_allow: true,
    },
    ToolCatalogEntry {
        name: "TaskUpdate",
        profiles: CORE_PROFILES,
        capabilities: PLAN_CAP,
        lifecycle: ToolLifecycle::Current,
        source: ToolSourceKind::AsterBuiltin,
        permission_plane: ToolPermissionPlane::SessionAllowlist,
        workspace_default_allow: true,
    },
    ToolCatalogEntry {
        name: "TaskOutput",
        profiles: CORE_PROFILES,
        capabilities: EXECUTION_CAP,
        lifecycle: ToolLifecycle::Current,
        source: ToolSourceKind::AsterBuiltin,
        permission_plane: ToolPermissionPlane::SessionAllowlist,
        workspace_default_allow: true,
    },
    ToolCatalogEntry {
        name: "TaskStop",
        profiles: CORE_PROFILES,
        capabilities: EXECUTION_CAP,
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
        name: "EnterWorktree",
        profiles: CORE_PROFILES,
        capabilities: WORKSPACE_IO_CAP,
        lifecycle: ToolLifecycle::Current,
        source: ToolSourceKind::AsterBuiltin,
        permission_plane: ToolPermissionPlane::SessionAllowlist,
        workspace_default_allow: true,
    },
    ToolCatalogEntry {
        name: "ExitWorktree",
        profiles: CORE_PROFILES,
        capabilities: WORKSPACE_IO_CAP,
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
        name: "AskUserQuestion",
        profiles: CORE_PROFILES,
        capabilities: PLAN_CAP,
        lifecycle: ToolLifecycle::Current,
        source: ToolSourceKind::AsterBuiltin,
        permission_plane: ToolPermissionPlane::SessionAllowlist,
        workspace_default_allow: true,
    },
    ToolCatalogEntry {
        name: "SendUserMessage",
        profiles: CORE_PROFILES,
        capabilities: SESSION_CAP,
        lifecycle: ToolLifecycle::Current,
        source: ToolSourceKind::AsterBuiltin,
        permission_plane: ToolPermissionPlane::SessionAllowlist,
        workspace_default_allow: true,
    },
    ToolCatalogEntry {
        name: "StructuredOutput",
        profiles: CORE_PROFILES,
        capabilities: SESSION_CAP,
        lifecycle: ToolLifecycle::Current,
        source: ToolSourceKind::AsterBuiltin,
        permission_plane: ToolPermissionPlane::SessionAllowlist,
        workspace_default_allow: false,
    },
    ToolCatalogEntry {
        name: "Config",
        profiles: CORE_PROFILES,
        capabilities: SESSION_CAP,
        lifecycle: ToolLifecycle::Current,
        source: ToolSourceKind::AsterBuiltin,
        permission_plane: ToolPermissionPlane::SessionAllowlist,
        workspace_default_allow: true,
    },
    ToolCatalogEntry {
        name: "Sleep",
        profiles: CORE_PROFILES,
        capabilities: EXECUTION_CAP,
        lifecycle: ToolLifecycle::Current,
        source: ToolSourceKind::AsterBuiltin,
        permission_plane: ToolPermissionPlane::SessionAllowlist,
        workspace_default_allow: true,
    },
    ToolCatalogEntry {
        name: "PowerShell",
        profiles: CORE_PROFILES,
        capabilities: EXECUTION_CAP,
        lifecycle: ToolLifecycle::Current,
        source: ToolSourceKind::AsterBuiltin,
        permission_plane: ToolPermissionPlane::ParameterRestricted,
        workspace_default_allow: false,
    },
    ToolCatalogEntry {
        name: "RemoteTrigger",
        profiles: CORE_PROFILES,
        capabilities: EXECUTION_CAP,
        lifecycle: ToolLifecycle::Current,
        source: ToolSourceKind::AsterBuiltin,
        permission_plane: ToolPermissionPlane::SessionAllowlist,
        workspace_default_allow: true,
    },
    ToolCatalogEntry {
        name: "CronCreate",
        profiles: CORE_PROFILES,
        capabilities: PLAN_CAP,
        lifecycle: ToolLifecycle::Current,
        source: ToolSourceKind::AsterBuiltin,
        permission_plane: ToolPermissionPlane::SessionAllowlist,
        workspace_default_allow: true,
    },
    ToolCatalogEntry {
        name: "CronList",
        profiles: CORE_PROFILES,
        capabilities: PLAN_CAP,
        lifecycle: ToolLifecycle::Current,
        source: ToolSourceKind::AsterBuiltin,
        permission_plane: ToolPermissionPlane::SessionAllowlist,
        workspace_default_allow: true,
    },
    ToolCatalogEntry {
        name: "CronDelete",
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
        name: LIST_MCP_RESOURCES_TOOL_NAME,
        profiles: CORE_PROFILES,
        capabilities: SEARCH_CAP,
        lifecycle: ToolLifecycle::Current,
        source: ToolSourceKind::LimeInjected,
        permission_plane: ToolPermissionPlane::SessionAllowlist,
        workspace_default_allow: true,
    },
    ToolCatalogEntry {
        name: READ_MCP_RESOURCE_TOOL_NAME,
        profiles: CORE_PROFILES,
        capabilities: SEARCH_CAP,
        lifecycle: ToolLifecycle::Current,
        source: ToolSourceKind::LimeInjected,
        permission_plane: ToolPermissionPlane::SessionAllowlist,
        workspace_default_allow: true,
    },
    ToolCatalogEntry {
        name: "Agent",
        profiles: CORE_PROFILES,
        capabilities: DELEGATION_CAP,
        lifecycle: ToolLifecycle::Current,
        source: ToolSourceKind::LimeInjected,
        permission_plane: ToolPermissionPlane::SessionAllowlist,
        workspace_default_allow: true,
    },
    ToolCatalogEntry {
        name: "SendMessage",
        profiles: CORE_PROFILES,
        capabilities: DELEGATION_CAP,
        lifecycle: ToolLifecycle::Current,
        source: ToolSourceKind::AsterBuiltin,
        permission_plane: ToolPermissionPlane::SessionAllowlist,
        workspace_default_allow: true,
    },
    ToolCatalogEntry {
        name: "TeamCreate",
        profiles: CORE_PROFILES,
        capabilities: DELEGATION_CAP,
        lifecycle: ToolLifecycle::Current,
        source: ToolSourceKind::AsterBuiltin,
        permission_plane: ToolPermissionPlane::SessionAllowlist,
        workspace_default_allow: true,
    },
    ToolCatalogEntry {
        name: "TeamDelete",
        profiles: CORE_PROFILES,
        capabilities: DELEGATION_CAP,
        lifecycle: ToolLifecycle::Current,
        source: ToolSourceKind::AsterBuiltin,
        permission_plane: ToolPermissionPlane::SessionAllowlist,
        workspace_default_allow: true,
    },
    ToolCatalogEntry {
        name: "ListPeers",
        profiles: CORE_PROFILES,
        capabilities: DELEGATION_CAP,
        lifecycle: ToolLifecycle::Current,
        source: ToolSourceKind::AsterBuiltin,
        permission_plane: ToolPermissionPlane::SessionAllowlist,
        workspace_default_allow: true,
    },
    ToolCatalogEntry {
        name: SOCIAL_IMAGE_TOOL_NAME,
        profiles: WORKBENCH_PROFILES,
        capabilities: CONTENT_CAP,
        lifecycle: ToolLifecycle::Current,
        source: ToolSourceKind::LimeInjected,
        permission_plane: ToolPermissionPlane::SessionAllowlist,
        workspace_default_allow: true,
    },
    ToolCatalogEntry {
        name: LIME_CREATE_VIDEO_TASK_TOOL_NAME,
        profiles: WORKBENCH_PROFILES,
        capabilities: CONTENT_CAP,
        lifecycle: ToolLifecycle::Current,
        source: ToolSourceKind::LimeInjected,
        permission_plane: ToolPermissionPlane::SessionAllowlist,
        workspace_default_allow: true,
    },
    ToolCatalogEntry {
        name: LIME_CREATE_TRANSCRIPTION_TASK_TOOL_NAME,
        profiles: WORKBENCH_PROFILES,
        capabilities: CONTENT_CAP,
        lifecycle: ToolLifecycle::Current,
        source: ToolSourceKind::LimeInjected,
        permission_plane: ToolPermissionPlane::SessionAllowlist,
        workspace_default_allow: true,
    },
    ToolCatalogEntry {
        name: LIME_CREATE_BROADCAST_TASK_TOOL_NAME,
        profiles: WORKBENCH_PROFILES,
        capabilities: CONTENT_CAP,
        lifecycle: ToolLifecycle::Current,
        source: ToolSourceKind::LimeInjected,
        permission_plane: ToolPermissionPlane::SessionAllowlist,
        workspace_default_allow: true,
    },
    ToolCatalogEntry {
        name: LIME_CREATE_COVER_TASK_TOOL_NAME,
        profiles: WORKBENCH_PROFILES,
        capabilities: CONTENT_CAP,
        lifecycle: ToolLifecycle::Current,
        source: ToolSourceKind::LimeInjected,
        permission_plane: ToolPermissionPlane::SessionAllowlist,
        workspace_default_allow: true,
    },
    ToolCatalogEntry {
        name: LIME_CREATE_RESOURCE_SEARCH_TASK_TOOL_NAME,
        profiles: WORKBENCH_PROFILES,
        capabilities: CONTENT_CAP,
        lifecycle: ToolLifecycle::Current,
        source: ToolSourceKind::LimeInjected,
        permission_plane: ToolPermissionPlane::SessionAllowlist,
        workspace_default_allow: true,
    },
    ToolCatalogEntry {
        name: LIME_SEARCH_WEB_IMAGES_TOOL_NAME,
        profiles: WORKBENCH_PROFILES,
        capabilities: SEARCH_CAP,
        lifecycle: ToolLifecycle::Current,
        source: ToolSourceKind::LimeInjected,
        permission_plane: ToolPermissionPlane::SessionAllowlist,
        workspace_default_allow: true,
    },
    ToolCatalogEntry {
        name: LIME_CREATE_IMAGE_TASK_TOOL_NAME,
        profiles: WORKBENCH_PROFILES,
        capabilities: CONTENT_CAP,
        lifecycle: ToolLifecycle::Current,
        source: ToolSourceKind::LimeInjected,
        permission_plane: ToolPermissionPlane::SessionAllowlist,
        workspace_default_allow: true,
    },
    ToolCatalogEntry {
        name: LIME_CREATE_URL_PARSE_TASK_TOOL_NAME,
        profiles: WORKBENCH_PROFILES,
        capabilities: CONTENT_CAP,
        lifecycle: ToolLifecycle::Current,
        source: ToolSourceKind::LimeInjected,
        permission_plane: ToolPermissionPlane::SessionAllowlist,
        workspace_default_allow: true,
    },
    ToolCatalogEntry {
        name: LIME_CREATE_TYPESETTING_TASK_TOOL_NAME,
        profiles: WORKBENCH_PROFILES,
        capabilities: CONTENT_CAP,
        lifecycle: ToolLifecycle::Current,
        source: ToolSourceKind::LimeInjected,
        permission_plane: ToolPermissionPlane::SessionAllowlist,
        workspace_default_allow: true,
    },
    ToolCatalogEntry {
        name: LIME_RUN_SERVICE_SKILL_TOOL_NAME,
        profiles: WORKBENCH_PROFILES,
        capabilities: EXECUTION_CAP,
        lifecycle: ToolLifecycle::Compat,
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
        name: LIME_SITE_RECOMMEND_TOOL_NAME,
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

fn normalize_tool_catalog_alias(tool_name: &str) -> &str {
    match tool_catalog_reference_lookup_key(tool_name).as_str() {
        "ask" | "requestuserinput" | "askuserquestiontool" => "AskUserQuestion",
        "brief" | "brieftool" | "sendusermessagetool" => "SendUserMessage",
        "spawnagent" | "subagenttask" | "agenttool" => "Agent",
        "sendinput" | "sendmessagetool" => "SendMessage",
        "bashtool" => "Bash",
        "configtool" => "Config",
        "enterplanmodetool" => "EnterPlanMode",
        "exitplanmodetool" => "ExitPlanMode",
        "enterworktreetool" => "EnterWorktree",
        "exitworktreetool" => "ExitWorktree",
        "filereadtool" | "readfiletool" => "Read",
        "filewritetool" | "writefiletool" | "createfiletool" => "Write",
        "fileedittool" => "Edit",
        "globtool" => "Glob",
        "greptool" => "Grep",
        "lsptool" => "LSP",
        "listmcpresourcestool" => "ListMcpResourcesTool",
        "readmcpresourcetool" => "ReadMcpResourceTool",
        "notebookedittool" => "NotebookEdit",
        "powershelltool" => "PowerShell",
        "remotetriggertool" => "RemoteTrigger",
        "schedulecrontool" | "croncreatetool" => "CronCreate",
        "cronlisttool" => "CronList",
        "crondeletetool" => "CronDelete",
        "skilltool" => "Skill",
        "sleeptool" => "Sleep",
        "syntheticoutputtool" => "StructuredOutput",
        "taskcreatetool" => "TaskCreate",
        "taskgettool" => "TaskGet",
        "tasklisttool" => "TaskList",
        "taskoutputtool" | "agentoutputtool" | "bashoutputtool" => "TaskOutput",
        "taskstoptool" | "killshell" => "TaskStop",
        "taskupdatetool" => "TaskUpdate",
        "teamcreatetool" => "TeamCreate",
        "teamdeletetool" => "TeamDelete",
        "listpeerstool" => "ListPeers",
        "toolsearchtool" => "ToolSearch",
        "webfetchtool" => "WebFetch",
        "websearchtool" => "WebSearch",
        _ => tool_name.trim(),
    }
}

fn tool_catalog_reference_lookup_key(tool_name: &str) -> String {
    tool_name
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .map(|character| character.to_ascii_lowercase())
        .collect()
}

fn tool_catalog_lookup_key(tool_name: &str) -> String {
    normalize_tool_catalog_alias(tool_name)
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .map(|character| character.to_ascii_lowercase())
        .collect()
}

pub fn tool_catalog_names_match(left: &str, right: &str) -> bool {
    let left_key = tool_catalog_lookup_key(left);
    let right_key = tool_catalog_lookup_key(right);
    !left_key.is_empty() && left_key == right_key
}

pub fn tool_catalog_entry(tool_name: &str) -> Option<&'static ToolCatalogEntry> {
    let requested_name = tool_name.trim();
    let canonical_name = normalize_tool_catalog_alias(requested_name);
    if let Some(entry) = native_tool_catalog()
        .iter()
        .find(|entry| entry.name == canonical_name)
    {
        return Some(entry);
    }
    let normalized_key = tool_catalog_lookup_key(canonical_name);
    native_tool_catalog()
        .iter()
        .filter(|entry| {
            if entry.name.ends_with("__") {
                requested_name.starts_with(entry.name)
                    || (!normalized_key.is_empty()
                        && normalized_key.starts_with(&tool_catalog_lookup_key(entry.name)))
            } else {
                tool_catalog_names_match(entry.name, canonical_name)
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

pub fn workbench_tool_names() -> Vec<&'static str> {
    tool_catalog_entries_for_surface(WorkspaceToolSurface::workbench())
        .into_iter()
        .filter(|entry| entry.profiles.contains(&ToolSurfaceProfile::Workbench))
        .filter(|entry| entry.name != BROWSER_RUNTIME_TOOL_PREFIX)
        .map(|entry| entry.name)
        .collect()
}

pub fn browser_runtime_tool_prefix() -> &'static str {
    BROWSER_RUNTIME_TOOL_PREFIX
}

pub fn mcp_extension_runtime_name(server_name: &str) -> String {
    format!("mcp__{server_name}")
}

fn mcp_extension_inner_tool_name<'a>(extension_name: &str, tool_name: &'a str) -> &'a str {
    tool_name
        .strip_prefix(extension_name)
        .and_then(|rest| rest.strip_prefix("__"))
        .unwrap_or(tool_name)
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
        .map(|tool| mcp_extension_inner_tool_name(extension_name, &tool.name).to_string())
        .collect::<Vec<_>>();
    available_tools.sort();
    available_tools.dedup();

    let mut always_expose_tools = tools
        .iter()
        .filter(|tool| {
            tool.always_visible.unwrap_or(false) || !tool.deferred_loading.unwrap_or(false)
        })
        .map(|tool| mcp_extension_inner_tool_name(extension_name, &tool.name).to_string())
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
        assert!(names.contains(&"Agent"));
        assert!(names.contains(&"SendUserMessage"));
        assert!(names.contains(&"TeamCreate"));
        assert!(names.contains(&"TeamDelete"));
        assert!(names.contains(&"Workflow"));
        assert!(names.contains(&"WebSearch"));
        assert!(!names.contains(&"Read"));
        assert!(!names.contains(&"Bash"));
        assert!(!names.contains(&SOCIAL_IMAGE_TOOL_NAME));
    }

    #[test]
    fn test_tool_catalog_entry_normalizes_legacy_aliases_to_current_surface() {
        assert_eq!(
            tool_catalog_entry("spawn_agent")
                .expect("legacy spawn_agent should normalize")
                .name,
            "Agent"
        );
        assert_eq!(
            tool_catalog_entry("brief")
                .expect("legacy brief should normalize")
                .name,
            "SendUserMessage"
        );
        assert_eq!(
            tool_catalog_entry("send_input")
                .expect("legacy send_input should normalize")
                .name,
            "SendMessage"
        );
        assert_eq!(
            tool_catalog_entry("ask")
                .expect("legacy ask should normalize")
                .name,
            "AskUserQuestion"
        );
        assert_eq!(
            tool_catalog_entry("remote_trigger")
                .expect("snake_case current name should normalize")
                .name,
            "RemoteTrigger"
        );
    }

    #[test]
    fn test_tool_catalog_entry_normalizes_reference_js_tool_names_to_current_surface() {
        let cases = [
            ("AgentTool", "Agent"),
            ("AskUserQuestionTool", "AskUserQuestion"),
            ("BashTool", "Bash"),
            ("BriefTool", "SendUserMessage"),
            ("ConfigTool", "Config"),
            ("EnterPlanModeTool", "EnterPlanMode"),
            ("EnterWorktreeTool", "EnterWorktree"),
            ("ExitPlanModeTool", "ExitPlanMode"),
            ("ExitWorktreeTool", "ExitWorktree"),
            ("FileEditTool", "Edit"),
            ("FileReadTool", "Read"),
            ("FileWriteTool", "Write"),
            ("GlobTool", "Glob"),
            ("GrepTool", "Grep"),
            ("LSPTool", "LSP"),
            ("ListMcpResourcesTool", "ListMcpResourcesTool"),
            ("NotebookEditTool", "NotebookEdit"),
            ("PowerShellTool", "PowerShell"),
            ("ReadMcpResourceTool", "ReadMcpResourceTool"),
            ("RemoteTriggerTool", "RemoteTrigger"),
            ("ScheduleCronTool", "CronCreate"),
            ("SendMessageTool", "SendMessage"),
            ("SkillTool", "Skill"),
            ("SleepTool", "Sleep"),
            ("SyntheticOutputTool", "StructuredOutput"),
            ("TaskCreateTool", "TaskCreate"),
            ("TaskGetTool", "TaskGet"),
            ("TaskListTool", "TaskList"),
            ("TaskOutputTool", "TaskOutput"),
            ("AgentOutputTool", "TaskOutput"),
            ("BashOutputTool", "TaskOutput"),
            ("TaskStopTool", "TaskStop"),
            ("KillShell", "TaskStop"),
            ("TaskUpdateTool", "TaskUpdate"),
            ("TeamCreateTool", "TeamCreate"),
            ("TeamDeleteTool", "TeamDelete"),
            ("ListPeersTool", "ListPeers"),
            ("ToolSearchTool", "ToolSearch"),
            ("WebFetchTool", "WebFetch"),
            ("WebSearchTool", "WebSearch"),
        ];

        for (input, expected) in cases {
            assert_eq!(
                tool_catalog_entry(input)
                    .unwrap_or_else(|| panic!("reference tool '{input}' should normalize"))
                    .name,
                expected
            );
        }
    }

    #[test]
    fn test_tool_catalog_entry_leaves_intentional_reference_exceptions_unmapped() {
        for name in ["MCPTool", "McpAuthTool", "REPLTool"] {
            assert!(
                tool_catalog_entry(name).is_none(),
                "reference exception '{name}' should stay outside current catalog"
            );
        }
    }

    #[test]
    fn test_workspace_default_allowed_tool_names_includes_workbench_surface() {
        let names = workspace_default_allowed_tool_names(WorkspaceToolSurface::workbench());
        assert!(names.contains(&SOCIAL_IMAGE_TOOL_NAME));
        assert!(names.contains(&LIME_CREATE_VIDEO_TASK_TOOL_NAME));
        assert!(names.contains(&LIME_CREATE_TRANSCRIPTION_TASK_TOOL_NAME));
    }

    #[test]
    fn test_tool_catalog_entries_for_surface_counts_and_lifecycle_boundaries() {
        let core = tool_catalog_entries_for_surface(WorkspaceToolSurface::core());
        let workbench_increment = native_tool_catalog()
            .iter()
            .filter(|entry| entry.profiles.contains(&ToolSurfaceProfile::Workbench))
            .count();
        let browser_increment = native_tool_catalog()
            .iter()
            .filter(|entry| entry.profiles.contains(&ToolSurfaceProfile::BrowserAssist))
            .count();
        assert_eq!(core.len(), 40);
        assert_eq!(
            core.iter()
                .filter(|entry| entry.lifecycle == ToolLifecycle::Current)
                .count(),
            40
        );
        assert_eq!(
            core.iter()
                .filter(|entry| entry.lifecycle == ToolLifecycle::Compat)
                .count(),
            0
        );
        assert!(core
            .iter()
            .all(|entry| !entry.profiles.contains(&ToolSurfaceProfile::Workbench)));
        assert!(core
            .iter()
            .all(|entry| !entry.profiles.contains(&ToolSurfaceProfile::BrowserAssist)));

        let workbench = tool_catalog_entries_for_surface(WorkspaceToolSurface::workbench());
        assert_eq!(workbench.len(), core.len() + workbench_increment);
        assert!(workbench
            .iter()
            .any(|entry| entry.name == SOCIAL_IMAGE_TOOL_NAME));
        assert!(!workbench
            .iter()
            .any(|entry| entry.name == BROWSER_RUNTIME_TOOL_PREFIX));

        let browser = tool_catalog_entries_for_surface(WorkspaceToolSurface::browser_assist());
        assert_eq!(browser.len(), core.len() + browser_increment);
        assert!(browser
            .iter()
            .any(|entry| entry.name == BROWSER_RUNTIME_TOOL_PREFIX));

        let combined =
            tool_catalog_entries_for_surface(WorkspaceToolSurface::workbench_with_browser_assist());
        assert_eq!(
            combined.len(),
            core.len() + workbench_increment + browser_increment
        );
    }

    #[test]
    fn test_workbench_tool_names_only_returns_workbench_increment() {
        let names = workbench_tool_names().into_iter().collect::<BTreeSet<_>>();
        assert_eq!(names.len(), 11);
        assert!(names.contains(SOCIAL_IMAGE_TOOL_NAME));
        assert!(names.contains(LIME_CREATE_VIDEO_TASK_TOOL_NAME));
        assert!(names.contains(LIME_CREATE_TRANSCRIPTION_TASK_TOOL_NAME));
        assert!(names.contains(LIME_RUN_SERVICE_SKILL_TOOL_NAME));
        assert!(names.contains(LIME_SEARCH_WEB_IMAGES_TOOL_NAME));
        assert!(!names.contains(TOOL_SEARCH_TOOL_NAME));
        assert!(!names.contains(BROWSER_RUNTIME_TOOL_PREFIX));
    }

    #[test]
    fn test_workspace_default_allowed_tool_names_workbench_with_browser_assist_excludes_prefix_tool(
    ) {
        let names = workspace_default_allowed_tool_names(
            WorkspaceToolSurface::workbench_with_browser_assist(),
        );
        assert_eq!(names.len(), 45);
        assert!(names.contains(&SOCIAL_IMAGE_TOOL_NAME));
        assert!(names.contains(&TOOL_SEARCH_TOOL_NAME));
        assert!(names.contains(&LIST_MCP_RESOURCES_TOOL_NAME));
        assert!(names.contains(&READ_MCP_RESOURCE_TOOL_NAME));
        assert!(names.contains(&"SendUserMessage"));
        assert!(names.contains(&"TeamCreate"));
        assert!(names.contains(&"TeamDelete"));
        assert!(names.contains(&LIME_CREATE_TRANSCRIPTION_TASK_TOOL_NAME));
        assert!(names.contains(&LIME_RUN_SERVICE_SKILL_TOOL_NAME));
        assert!(names.contains(&LIME_SEARCH_WEB_IMAGES_TOOL_NAME));
        assert!(names.contains(&LIME_SITE_RECOMMEND_TOOL_NAME));
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

    #[test]
    fn test_build_mcp_extension_surface_strips_runtime_prefix_from_prefixed_tools() {
        let tools = vec![
            sample_tool(
                "mcp__docs__search_docs",
                Some(true),
                Some(false),
                Some(vec!["assistant"]),
            ),
            sample_tool(
                "mcp__docs__read_docs",
                Some(false),
                Some(true),
                Some(vec!["assistant"]),
            ),
        ];

        let surface = build_mcp_extension_surface("mcp__docs", "docs tools", &tools);
        assert_eq!(
            surface.available_tools,
            vec!["read_docs".to_string(), "search_docs".to_string()]
        );
        assert_eq!(surface.always_expose_tools, vec!["read_docs".to_string()]);
    }
}
