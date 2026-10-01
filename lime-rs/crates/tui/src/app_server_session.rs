mod history;

pub(crate) use history::{
    thread_items_page_params, InitialHistoryPage, HISTORY_ITEM_PAGE_LIMIT, HISTORY_ITEM_SCAN_LIMIT,
};

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use anyhow::{anyhow, bail, Context, Result};
use app_server_client::{
    AppServerEvent, ClientSession, RemoteTransportConfig, RequestHandle, StdioTransportConfig,
};
use app_server_protocol::protocol::v2::{
    CollaborationModeListParams, CollaborationModeListResponse, CollaborationModeMask,
    ConfigReadParams, ConfigReadResponse, CurrentTimeReadResponse, FuzzyFileSearchParams,
    FuzzyFileSearchResponse, ListMcpServerStatusParams, ListMcpServerStatusResponse,
    McpServerElicitationRequestResponse, McpServerStatus, McpServerStatusDetail, ModelListParams,
    ModelListResponse, PermissionProfileListParams, PermissionProfileListResponse,
    PromptHistoryAppendParams, PromptHistoryAppendResponse, PromptHistoryReadParams,
    PromptHistoryReadResponse, QueuedSubmission, ServerRequest, SkillsListParams,
    SkillsListResponse, ThreadListParams, ThreadListResponse, ThreadQueueAddParams,
    ThreadQueueAddResponse, ThreadQueueDeleteParams, ThreadQueueDeleteResponse,
    ThreadQueueListParams, ThreadQueueListResponse, ThreadReadParams, ThreadReadResponse,
    ThreadResumeParams, ThreadResumeResponse, ThreadSetNameParams, ThreadSetNameResponse,
    ThreadSettingsUpdateParams, ThreadSettingsUpdateResponse, ThreadStartParams,
    ThreadStartResponse, ThreadStartSource, ThreadUnarchiveParams, ThreadUnarchiveResponse,
    TurnInterruptParams, TurnInterruptResponse, TurnStartParams, TurnStartResponse,
    TurnSteerParams, TurnSteerResponse, UserInput, METHOD_COLLABORATION_MODE_LIST,
    METHOD_CONFIG_READ, METHOD_FUZZY_FILE_SEARCH, METHOD_MCP_SERVER_STATUS_LIST,
    METHOD_PERMISSION_PROFILE_LIST, METHOD_PROMPT_HISTORY_APPEND, METHOD_PROMPT_HISTORY_READ,
    METHOD_SKILLS_LIST, METHOD_THREAD_ARCHIVE, METHOD_THREAD_QUEUE_ADD, METHOD_THREAD_QUEUE_DELETE,
    METHOD_THREAD_QUEUE_LIST, METHOD_THREAD_READ, METHOD_THREAD_RESUME,
    METHOD_THREAD_SETTINGS_UPDATE, METHOD_THREAD_START, METHOD_TURN_INTERRUPT, METHOD_TURN_START,
    METHOD_TURN_STEER,
};
use app_server_protocol::{
    ClientCapabilities, ClientInfo, InitializeParams, JsonRpcError, RequestId,
};
use serde_json::Value;

use crate::bottom_pane::AppServerResponse;

fn permission_profile_id(value: &Value) -> Option<String> {
    value
        .as_object()
        .and_then(|profile| profile.get("id"))
        .and_then(Value::as_str)
        .map(str::to_string)
        .filter(|id| !id.trim().is_empty())
}

#[derive(Clone, Debug, Default)]
pub(crate) struct ThreadSettingsPatch {
    pub(crate) model: Option<String>,
    pub(crate) model_provider: Option<String>,
    pub(crate) effort: Option<String>,
    pub(crate) permissions: Option<String>,
    pub(crate) approval_policy: Option<String>,
    pub(crate) approvals_reviewer: Option<String>,
    pub(crate) sandbox_policy: Option<String>,
}

impl ThreadSettingsPatch {
    pub(crate) fn new(
        model: Option<String>,
        model_provider: Option<String>,
        effort: Option<String>,
        permissions: Option<String>,
    ) -> Self {
        Self {
            model,
            model_provider,
            effort,
            permissions,
            ..Self::default()
        }
    }

    pub(crate) fn with_policy(
        mut self,
        approval_policy: Option<String>,
        approvals_reviewer: Option<String>,
        sandbox_policy: Option<String>,
    ) -> Self {
        self.approval_policy = approval_policy;
        self.approvals_reviewer = approvals_reviewer;
        self.sandbox_policy = sandbox_policy;
        self
    }
}

pub(crate) struct AppServerSession {
    session: ClientSession,
    request_handle: RequestHandle,
    thread_id: Option<String>,
    active_permission_profile: Option<String>,
    history_pagination: HashMap<String, history::ThreadHistoryPagination>,
}

impl AppServerSession {
    pub(crate) async fn read_config(&self) -> Result<ConfigReadResponse> {
        self.request_handle
            .request(METHOD_CONFIG_READ, ConfigReadParams::default())
            .await
            .context("failed to read TUI settings through App Server config/read")
    }

    pub(crate) async fn list_mcp_server_statuses(
        &self,
        detail: McpServerStatusDetail,
    ) -> Result<Vec<McpServerStatus>> {
        let mut cursor = None;
        let mut seen_cursors = HashSet::new();
        let mut data = Vec::new();
        for _ in 0..16 {
            let page: ListMcpServerStatusResponse = self
                .request_handle
                .request(
                    METHOD_MCP_SERVER_STATUS_LIST,
                    ListMcpServerStatusParams {
                        cursor,
                        limit: Some(64),
                        detail: Some(detail),
                        thread_id: self.thread_id.clone(),
                    },
                )
                .await
                .context("failed to list App Server MCP server statuses")?;
            data.extend(page.data);
            let Some(next_cursor) = page.next_cursor else {
                return Ok(data);
            };
            if !seen_cursors.insert(next_cursor.clone()) {
                bail!("MCP server status list pagination repeated cursor {next_cursor}");
            }
            cursor = Some(next_cursor);
        }
        bail!("MCP server status list pagination exceeded 16 pages")
    }

    /// Search files through the current App Server contract using a cloned request boundary.
    /// All interactive queries share one cancellation token so newer queries supersede older
    /// filesystem walks without creating another transport or runtime owner.
    pub(crate) async fn fuzzy_file_search_request(
        request_handle: RequestHandle,
        cwd: PathBuf,
        query: String,
    ) -> Result<Vec<app_server_protocol::protocol::v2::FuzzyFileSearchResult>> {
        let root = cwd
            .canonicalize()
            .unwrap_or(cwd)
            .to_string_lossy()
            .into_owned();
        let response: FuzzyFileSearchResponse = request_handle
            .request(
                METHOD_FUZZY_FILE_SEARCH,
                FuzzyFileSearchParams {
                    query,
                    roots: vec![root],
                    cancellation_token: Some("lime-tui-file-search".to_string()),
                },
            )
            .await
            .context("failed to search files through App Server")?;
        Ok(response.files)
    }

    pub(crate) async fn connect(config: StdioTransportConfig) -> Result<Self> {
        let app_server_bin = config.app_server_bin.clone();
        let session = ClientSession::start_stdio(config, initialize_params())
            .await
            .with_context(|| {
                format!(
                    "failed to initialize App Server at {}",
                    app_server_bin.display()
                )
            })?;
        Ok(Self {
            request_handle: session.request_handle(),
            session,
            thread_id: None,
            active_permission_profile: None,
            history_pagination: HashMap::new(),
        })
    }

    pub(crate) async fn connect_remote(config: RemoteTransportConfig) -> Result<Self> {
        let websocket_url = config.websocket_url.clone();
        let session = ClientSession::start_remote(config, initialize_params())
            .await
            .with_context(|| {
                format!("failed to initialize remote App Server at {websocket_url}")
            })?;
        Ok(Self {
            request_handle: session.request_handle(),
            session,
            thread_id: None,
            active_permission_profile: None,
            history_pagination: HashMap::new(),
        })
    }

    pub(crate) async fn start_thread(
        &mut self,
        cwd: PathBuf,
        model: Option<String>,
        model_provider: Option<String>,
    ) -> Result<ThreadStartResponse> {
        let response = self
            .start_thread_with_session_start_source(cwd, model, model_provider, None)
            .await?;
        let thread_id = response.thread.id.clone();
        self.thread_id = Some(thread_id.clone());
        self.active_permission_profile = response
            .active_permission_profile
            .as_ref()
            .and_then(permission_profile_id);
        Ok(response)
    }

    /// Start a thread without changing the interactive session target.
    pub(crate) async fn start_thread_with_session_start_source(
        &self,
        cwd: PathBuf,
        model: Option<String>,
        model_provider: Option<String>,
        session_start_source: Option<ThreadStartSource>,
    ) -> Result<ThreadStartResponse> {
        let cwd = cwd.to_string_lossy().into_owned();
        self.request_handle
            .request(
                METHOD_THREAD_START,
                ThreadStartParams {
                    cwd: Some(cwd.clone()),
                    runtime_workspace_roots: Some(vec![cwd]),
                    model,
                    model_provider,
                    session_start_source,
                    experimental_raw_events: false,
                    ..ThreadStartParams::default()
                },
            )
            .await
            .context("failed to start App Server thread")
    }

    pub(crate) async fn resume_thread(
        &mut self,
        thread_id: String,
    ) -> Result<ThreadResumeResponse> {
        let mut response: ThreadResumeResponse = self
            .request_handle
            .request(
                METHOD_THREAD_RESUME,
                ThreadResumeParams {
                    thread_id: thread_id.clone(),
                    exclude_turns: true,
                    ..ThreadResumeParams::default()
                },
            )
            .await
            .context("failed to resume App Server thread")?;
        if response.thread.history_mode
            == app_server_protocol::protocol::v2::ThreadHistoryMode::Legacy
            && response.thread.turns.is_empty()
        {
            response.thread = self
                .thread_read(thread_id, true)
                .await
                .context("failed to hydrate legacy App Server thread history")?
                .thread;
        }
        self.thread_id = Some(response.thread.id.clone());
        self.active_permission_profile = response
            .active_permission_profile
            .as_ref()
            .and_then(permission_profile_id);
        Ok(response)
    }

    pub(crate) fn active_permission_profile(&self) -> Option<&str> {
        self.active_permission_profile.as_deref()
    }

    pub(crate) async fn list_permission_profiles(
        &self,
        cwd: Option<String>,
    ) -> Result<PermissionProfileListResponse> {
        let mut cursor = None;
        let mut data = Vec::new();
        let mut seen_cursors = HashSet::new();
        for _ in 0..16 {
            let page: PermissionProfileListResponse = self
                .request_handle
                .request(
                    METHOD_PERMISSION_PROFILE_LIST,
                    PermissionProfileListParams {
                        cursor,
                        limit: Some(64),
                        cwd: cwd.clone(),
                    },
                )
                .await
                .context("failed to list App Server permission profiles")?;
            data.extend(page.data);
            let Some(next_cursor) = page.next_cursor else {
                return Ok(PermissionProfileListResponse {
                    data,
                    next_cursor: None,
                });
            };
            if !seen_cursors.insert(next_cursor.clone()) {
                bail!("permission profile list pagination repeated cursor {next_cursor}");
            }
            cursor = Some(next_cursor);
        }
        bail!("permission profile list pagination exceeded 16 pages")
    }

    #[allow(dead_code)]
    pub(crate) async fn thread_list(&self, params: ThreadListParams) -> Result<ThreadListResponse> {
        self.request_handle
            .request(
                app_server_protocol::protocol::v2::METHOD_THREAD_LIST,
                params,
            )
            .await
            .context("failed to list App Server thread page")
    }

    /// Return a cloneable request boundary for background TUI loaders.
    ///
    /// Requests are serialized by the App Server client worker, so handing a
    /// clone to a short-lived loader does not create a second transport or a
    /// parallel session. The owning session still controls lifecycle and
    /// shutdown.
    pub(crate) fn request_handle(&self) -> app_server_client::RequestHandle {
        self.request_handle.clone()
    }

    #[allow(dead_code)]
    pub(crate) async fn thread_read(
        &self,
        thread_id: impl Into<String>,
        include_turns: bool,
    ) -> Result<ThreadReadResponse> {
        self.request_handle
            .request(
                METHOD_THREAD_READ,
                ThreadReadParams {
                    thread_id: thread_id.into(),
                    include_turns,
                },
            )
            .await
            .context("failed to read App Server thread")
    }

    #[allow(dead_code)]
    pub(crate) async fn thread_archive(&self, thread_id: impl Into<String>) -> Result<()> {
        self.request_handle
            .request(
                METHOD_THREAD_ARCHIVE,
                app_server_protocol::protocol::v2::ThreadArchiveParams {
                    thread_id: thread_id.into(),
                },
            )
            .await
            .map(|_: app_server_protocol::protocol::v2::ThreadArchiveResponse| ())
            .context("failed to archive App Server thread")
    }

    pub(crate) async fn thread_set_name(
        &self,
        thread_id: impl Into<String>,
        name: String,
    ) -> Result<()> {
        self.request_handle
            .request(
                app_server_protocol::protocol::v2::METHOD_THREAD_NAME_SET,
                ThreadSetNameParams {
                    thread_id: thread_id.into(),
                    name,
                },
            )
            .await
            .map(|_: ThreadSetNameResponse| ())
            .context("failed to set App Server thread name")
    }

    #[allow(dead_code)]
    pub(crate) async fn thread_unarchive(
        &self,
        thread_id: impl Into<String>,
    ) -> Result<ThreadUnarchiveResponse> {
        self.request_handle
            .request(
                app_server_protocol::protocol::v2::METHOD_THREAD_UNARCHIVE,
                ThreadUnarchiveParams {
                    thread_id: thread_id.into(),
                },
            )
            .await
            .context("failed to restore archived App Server thread")
    }

    pub(crate) async fn list_models(&self, limit: u32) -> Result<ModelListResponse> {
        let mut cursor = None;
        let mut seen_cursors = HashSet::new();
        let mut data = Vec::new();
        for _ in 0..16 {
            let page: ModelListResponse = self
                .request_handle
                .request(
                    app_server_protocol::protocol::v2::METHOD_MODEL_LIST,
                    ModelListParams {
                        cursor,
                        limit: Some(limit),
                        include_hidden: Some(false),
                    },
                )
                .await
                .context("failed to list App Server models")?;
            data.extend(page.data);
            let Some(next_cursor) = page.next_cursor else {
                return Ok(ModelListResponse {
                    data,
                    next_cursor: None,
                });
            };
            if !seen_cursors.insert(next_cursor.clone()) {
                bail!("model list pagination repeated cursor {next_cursor}");
            }
            cursor = Some(next_cursor);
        }
        bail!("model list pagination exceeded 16 pages")
    }

    pub(crate) async fn list_skills(&self, cwds: Vec<PathBuf>) -> Result<SkillsListResponse> {
        self.list_skills_with_reload(cwds, false).await
    }

    /// Reload the server-owned skills catalog after a `skills/changed` notification.
    pub(crate) async fn reload_skills(&self, cwds: Vec<PathBuf>) -> Result<SkillsListResponse> {
        self.list_skills_with_reload(cwds, true).await
    }

    async fn list_skills_with_reload(
        &self,
        cwds: Vec<PathBuf>,
        force_reload: bool,
    ) -> Result<SkillsListResponse> {
        self.request_handle
            .request(METHOD_SKILLS_LIST, SkillsListParams { cwds, force_reload })
            .await
            .context("failed to list App Server skills")
    }

    /// Discover optional collaboration modes from the App Server catalog.
    ///
    /// A server may legitimately omit this experimental method. Callers treat
    /// an error as an empty catalog and keep the ordinary model picker usable.
    pub(crate) async fn list_collaboration_modes(&self) -> Result<Vec<CollaborationModeMask>> {
        let response: CollaborationModeListResponse = self
            .request_handle
            .request(
                METHOD_COLLABORATION_MODE_LIST,
                CollaborationModeListParams {},
            )
            .await
            .context("failed to list App Server collaboration modes")?;
        Ok(response.data)
    }

    pub(crate) async fn update_collaboration_mode(
        &self,
        collaboration_mode: agent_protocol::CollaborationMode,
    ) -> Result<()> {
        let thread_id = self.thread_id()?.to_string();
        let _: ThreadSettingsUpdateResponse = self
            .request_handle
            .request(
                METHOD_THREAD_SETTINGS_UPDATE,
                ThreadSettingsUpdateParams {
                    thread_id,
                    collaboration_mode: Some(collaboration_mode),
                    ..ThreadSettingsUpdateParams::default()
                },
            )
            .await
            .context("failed to update App Server collaboration mode")?;
        Ok(())
    }

    pub(crate) async fn list_queued_submissions(
        &self,
        limit: u32,
    ) -> Result<Vec<QueuedSubmission>> {
        let thread_id = self.thread_id()?.to_string();
        let mut cursor = None;
        let mut seen_cursors = HashSet::new();
        let mut data = Vec::new();
        for _ in 0..16 {
            let page: ThreadQueueListResponse = self
                .request_handle
                .request(
                    METHOD_THREAD_QUEUE_LIST,
                    ThreadQueueListParams {
                        thread_id: thread_id.clone(),
                        cursor,
                        limit: Some(limit),
                    },
                )
                .await
                .context("failed to list queued submissions")?;
            data.extend(page.data);
            let Some(next_cursor) = page.next_cursor else {
                return Ok(data);
            };
            if !seen_cursors.insert(next_cursor.clone()) {
                bail!("thread queue pagination repeated cursor {next_cursor}");
            }
            cursor = Some(next_cursor);
        }
        bail!("thread queue pagination exceeded 16 pages")
    }

    pub(crate) async fn update_settings(
        &self,
        model: Option<String>,
        model_provider: Option<String>,
        effort: Option<String>,
        permissions: Option<String>,
    ) -> Result<()> {
        self.update_settings_with_policy(ThreadSettingsPatch::new(
            model,
            model_provider,
            effort,
            permissions,
        ))
        .await
    }

    pub(crate) async fn update_settings_with_policy(
        &self,
        settings: ThreadSettingsPatch,
    ) -> Result<()> {
        if settings.model.is_none()
            && settings.model_provider.is_none()
            && settings.effort.is_none()
            && settings.permissions.is_none()
            && settings.approval_policy.is_none()
            && settings.approvals_reviewer.is_none()
            && settings.sandbox_policy.is_none()
        {
            return Ok(());
        }
        let thread_id = self.thread_id()?.to_string();
        let _: ThreadSettingsUpdateResponse = self
            .request_handle
            .request(
                METHOD_THREAD_SETTINGS_UPDATE,
                ThreadSettingsUpdateParams {
                    thread_id,
                    model: settings.model,
                    model_provider: settings.model_provider,
                    effort: settings.effort,
                    permissions: settings.permissions,
                    approval_policy: settings.approval_policy.map(Value::String),
                    approvals_reviewer: settings.approvals_reviewer.map(Value::String),
                    sandbox_policy: settings.sandbox_policy.map(Value::String),
                    ..ThreadSettingsUpdateParams::default()
                },
            )
            .await
            .context("failed to update App Server thread settings")?;
        Ok(())
    }

    pub(crate) async fn read_prompt_history(
        &self,
        limit: u32,
    ) -> Result<PromptHistoryReadResponse> {
        self.request_handle
            .request(
                METHOD_PROMPT_HISTORY_READ,
                PromptHistoryReadParams {
                    limit: Some(limit),
                    ..PromptHistoryReadParams::default()
                },
            )
            .await
            .context("failed to read prompt history")
    }

    pub(crate) async fn append_prompt_history(
        &self,
        text: String,
    ) -> Result<PromptHistoryAppendResponse> {
        let thread_id = self.thread_id()?.to_string();
        self.request_handle
            .request(
                METHOD_PROMPT_HISTORY_APPEND,
                PromptHistoryAppendParams { thread_id, text },
            )
            .await
            .context("failed to append prompt history")
    }

    pub(crate) fn thread_id(&self) -> Result<&str> {
        self.thread_id
            .as_deref()
            .ok_or_else(|| anyhow!("App Server thread has not been started"))
    }

    pub(crate) async fn start_turn(&self, prompt: String) -> Result<String> {
        self.start_turn_input(vec![UserInput::Text {
            text: prompt,
            text_elements: Vec::new(),
        }])
        .await
    }

    pub(crate) async fn start_turn_input(&self, input: Vec<UserInput>) -> Result<String> {
        let thread_id = self.thread_id()?.to_string();
        let response: TurnStartResponse = self
            .request_handle
            .request(
                METHOD_TURN_START,
                TurnStartParams {
                    thread_id,
                    input,
                    ..TurnStartParams::default()
                },
            )
            .await
            .context("failed to start turn")?;
        Ok(response.turn.id)
    }

    pub(crate) async fn turn_start(
        &self,
        thread_id: impl Into<String>,
        input: Vec<UserInput>,
    ) -> Result<String> {
        let response: TurnStartResponse = self
            .request_handle
            .request(
                METHOD_TURN_START,
                TurnStartParams {
                    thread_id: thread_id.into(),
                    input,
                    ..TurnStartParams::default()
                },
            )
            .await
            .context("failed to start background turn")?;
        Ok(response.turn.id)
    }

    pub(crate) async fn interrupt(&self, turn_id: &str) -> Result<()> {
        let thread_id = self.thread_id()?.to_string();
        let _: TurnInterruptResponse = self
            .request_handle
            .request(
                METHOD_TURN_INTERRUPT,
                TurnInterruptParams {
                    thread_id,
                    turn_id: turn_id.to_string(),
                },
            )
            .await
            .context("failed to interrupt turn")?;
        Ok(())
    }

    pub(crate) async fn turn_interrupt(
        &self,
        thread_id: impl Into<String>,
        turn_id: impl Into<String>,
    ) -> Result<()> {
        let _: TurnInterruptResponse = self
            .request_handle
            .request(
                METHOD_TURN_INTERRUPT,
                TurnInterruptParams {
                    thread_id: thread_id.into(),
                    turn_id: turn_id.into(),
                },
            )
            .await
            .context("failed to interrupt background turn")?;
        Ok(())
    }

    pub(crate) async fn steer_turn_input(
        &self,
        turn_id: &str,
        input: Vec<UserInput>,
    ) -> Result<String> {
        let thread_id = self.thread_id()?.to_string();
        let response: TurnSteerResponse = self
            .request_handle
            .request(
                METHOD_TURN_STEER,
                TurnSteerParams {
                    thread_id,
                    input,
                    expected_turn_id: turn_id.to_string(),
                    ..TurnSteerParams::default()
                },
            )
            .await
            .context("failed to steer turn")?;
        Ok(response.turn_id)
    }

    pub(crate) async fn queue_input(&self, input: Vec<UserInput>) -> Result<QueuedSubmission> {
        let thread_id = self.thread_id()?.to_string();
        let response: ThreadQueueAddResponse = self
            .request_handle
            .request(
                METHOD_THREAD_QUEUE_ADD,
                ThreadQueueAddParams {
                    thread_id,
                    input,
                    client_user_message_id: client_message_id(),
                },
            )
            .await
            .context("failed to queue prompt")?;
        Ok(response.queued_submission)
    }

    pub(crate) async fn delete_queued_submission(
        &self,
        queued_submission_id: String,
    ) -> Result<bool> {
        let thread_id = self.thread_id()?.to_string();
        let response: ThreadQueueDeleteResponse = self
            .request_handle
            .request(
                METHOD_THREAD_QUEUE_DELETE,
                ThreadQueueDeleteParams {
                    thread_id,
                    queued_submission_id,
                },
            )
            .await
            .context("failed to delete queued submission")?;
        Ok(response.deleted)
    }

    pub(crate) async fn next_event(&mut self) -> Option<AppServerEvent> {
        self.session.next_event().await
    }

    pub(crate) async fn respond(&self, response: AppServerResponse) -> Result<()> {
        match response {
            AppServerResponse::Command { id, response } => {
                self.request_handle.respond(id, response).await
            }
            AppServerResponse::FileChange { id, response } => {
                self.request_handle.respond(id, response).await
            }
            AppServerResponse::Permissions { id, response } => {
                self.request_handle.respond(id, response).await
            }
            AppServerResponse::UserInput { id, response } => {
                self.request_handle.respond(id, response).await
            }
            AppServerResponse::McpElicitation { id, response } => {
                self.request_handle
                    .respond::<McpServerElicitationRequestResponse>(id, response)
                    .await
            }
        }
        .context("failed to respond to App Server request")
    }

    pub(crate) async fn respond_current_time(&self, id: RequestId) -> Result<()> {
        let seconds = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|error| anyhow!("system clock is before Unix epoch: {error}"))?
            .as_secs();
        let current_time_at = i64::try_from(seconds)
            .map_err(|_| anyhow!("system clock is outside the supported range"))?;
        self.request_handle
            .respond(id, CurrentTimeReadResponse { current_time_at })
            .await
            .context("failed to respond to currentTime/read")
    }

    pub(crate) async fn reject_server_request(&self, request: Box<ServerRequest>) -> Result<()> {
        let method = request.method();
        self.request_handle
            .reject(
                request.id().clone(),
                JsonRpcError::new(
                    app_server_protocol::error_codes::METHOD_NOT_FOUND,
                    format!("TUI client does not support server request {method} yet"),
                ),
            )
            .await
            .context("failed to reject unsupported server request")
    }

    pub(crate) async fn shutdown(self) -> Result<()> {
        self.session
            .shutdown()
            .await
            .context("failed to stop App Server")
    }
}

fn client_message_id() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    format!("lime-tui-{nanos}")
}

fn initialize_params() -> InitializeParams {
    InitializeParams {
        client_info: ClientInfo {
            name: "lime-tui".to_string(),
            title: Some("Lime TUI".to_string()),
            version: Some(env!("CARGO_PKG_VERSION").to_string()),
        },
        capabilities: ClientCapabilities {
            event_methods: Vec::new(),
            experimental_api: true,
            opt_out_notification_methods: None,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tui_client_uses_stable_identity_and_v2_capabilities() {
        let params = initialize_params();

        assert_eq!(params.client_info.name, "lime-tui");
        assert_eq!(params.client_info.title.as_deref(), Some("Lime TUI"));
        assert!(params.capabilities.experimental_api);
        assert!(params.capabilities.event_methods.is_empty());
    }

    #[test]
    fn active_permission_profile_requires_a_non_empty_id() {
        assert_eq!(
            permission_profile_id(&serde_json::json!({"id": ":workspace"})),
            Some(":workspace".to_string())
        );
        assert_eq!(
            permission_profile_id(&serde_json::json!({"id": "  "})),
            None
        );
        assert_eq!(permission_profile_id(&serde_json::json!({})), None);
        assert_eq!(permission_profile_id(&serde_json::json!(null)), None);
    }
}
