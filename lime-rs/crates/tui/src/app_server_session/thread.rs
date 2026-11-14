//! Thread creation and recovery through the shared App Server lifecycle.

use super::{permission_profile_id, AppServerSession};
use anyhow::{Context, Result};
use app_server_protocol::protocol::v2::{
    ThreadResumeParams, ThreadResumeResponse, ThreadSettingsUpdateParams,
    ThreadSettingsUpdateResponse, ThreadStartParams, ThreadStartResponse, ThreadStartSource,
    METHOD_THREAD_RESUME, METHOD_THREAD_SETTINGS_UPDATE, METHOD_THREAD_START,
};
use std::path::PathBuf;

impl AppServerSession {
    pub(crate) async fn start_thread(
        &mut self,
        cwd: Option<PathBuf>,
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
        cwd: Option<PathBuf>,
        model: Option<String>,
        model_provider: Option<String>,
        session_start_source: Option<ThreadStartSource>,
    ) -> Result<ThreadStartResponse> {
        let cwd = cwd.map(|cwd| cwd.to_string_lossy().into_owned());
        self.request_handle
            .request(
                METHOD_THREAD_START,
                ThreadStartParams {
                    cwd: cwd.clone(),
                    runtime_workspace_roots: cwd.map(|cwd| vec![cwd]),
                    model,
                    model_provider,
                    session_start_source,
                    history_mode: Some(
                        app_server_protocol::protocol::v2::ThreadHistoryMode::Paginated,
                    ),
                    experimental_raw_events: false,
                    ..ThreadStartParams::default()
                },
            )
            .await
            .context("failed to start App Server thread")
    }

    pub(crate) async fn request_thread_fork(
        &mut self,
        thread_id: String,
    ) -> Result<app_server_protocol::protocol::v2::ThreadForkResponse> {
        let response: app_server_protocol::protocol::v2::ThreadForkResponse = self
            .request_handle
            .request(
                app_server_protocol::protocol::v2::METHOD_THREAD_FORK,
                app_server_protocol::protocol::v2::ThreadForkParams {
                    thread_id,
                    ..Default::default()
                },
            )
            .await
            .context("failed to fork App Server thread")?;
        self.thread_id = Some(response.thread.id.clone());
        Ok(response)
    }

    pub(crate) async fn approve_guardian_denied_action(
        &self,
        thread_id: String,
        event: serde_json::Value,
    ) -> Result<()> {
        let _: app_server_protocol::protocol::v2::ThreadApproveGuardianDeniedActionResponse = self
            .request_handle
            .request(
                app_server_protocol::protocol::v2::METHOD_THREAD_APPROVE_GUARDIAN_DENIED_ACTION,
                app_server_protocol::protocol::v2::ThreadApproveGuardianDeniedActionParams {
                    thread_id,
                    event,
                },
            )
            .await
            .context("failed to approve the Guardian denied action")?;
        Ok(())
    }

    pub(crate) async fn thread_loaded_list(&self) -> Result<Vec<String>> {
        let response: app_server_protocol::protocol::v2::ThreadLoadedListResponse = self
            .request_handle
            .request(
                app_server_protocol::protocol::v2::METHOD_THREAD_LOADED_LIST,
                app_server_protocol::protocol::v2::ThreadLoadedListParams {
                    cursor: None,
                    limit: None,
                },
            )
            .await
            .context("failed to list loaded App Server threads")?;
        Ok(response.data)
    }

    pub(crate) async fn thread_read_metadata(
        &self,
        thread_id: String,
    ) -> Result<app_server_protocol::protocol::v2::Thread> {
        let response: app_server_protocol::protocol::v2::ThreadReadResponse = self
            .request_handle
            .request(
                app_server_protocol::protocol::v2::METHOD_THREAD_READ,
                app_server_protocol::protocol::v2::ThreadReadParams {
                    thread_id,
                    include_turns: false,
                },
            )
            .await
            .context("failed to read App Server thread metadata")?;
        Ok(response.thread)
    }

    pub(crate) async fn thread_unsubscribe(&self, thread_id: String) -> Result<()> {
        let _: app_server_protocol::protocol::v2::ThreadUnsubscribeResponse = self
            .request_handle
            .request(
                app_server_protocol::protocol::v2::METHOD_THREAD_UNSUBSCRIBE,
                app_server_protocol::protocol::v2::ThreadUnsubscribeParams { thread_id },
            )
            .await
            .context("failed to unsubscribe App Server thread")?;
        Ok(())
    }

    pub(crate) async fn start_recap_request(
        &self,
        model: Option<String>,
        model_provider: Option<String>,
        cwd: String,
        history: String,
    ) -> Result<String> {
        use app_server_protocol::protocol::v2::{
            ThreadSource, ThreadStartParams, ThreadStartResponse, TurnStartParams,
            TurnStartResponse, METHOD_THREAD_START, METHOD_TURN_START,
        };
        let started: ThreadStartResponse = self
            .request_handle
            .request(
                METHOD_THREAD_START,
                ThreadStartParams {
                    model,
                    model_provider,
                    cwd: Some(cwd),
                    ephemeral: Some(true),
                    thread_source: Some(ThreadSource::Feature("system".to_string())),
                    ..ThreadStartParams::default()
                },
            )
            .await
            .context("failed to start the recap thread")?;
        let thread_id = started.thread.id.clone();
        let input = vec![app_server_protocol::protocol::v2::UserInput::Text {
            text: crate::app::recap::recap_prompt(&history),
            text_elements: Vec::new(),
        }];
        let _: TurnStartResponse = self
            .request_handle
            .request(
                METHOD_TURN_START,
                TurnStartParams {
                    thread_id: thread_id.clone(),
                    input,
                    output_schema: Some(crate::app::recap::recap_output_schema()),
                    ..TurnStartParams::default()
                },
            )
            .await
            .context("failed to start the recap turn")?;
        Ok(thread_id)
    }

    pub(crate) async fn update_thread_cwd(
        &self,
        thread_id: String,
        cwd: String,
    ) -> Result<ThreadSettingsUpdateResponse> {
        self.request_handle
            .request(
                METHOD_THREAD_SETTINGS_UPDATE,
                ThreadSettingsUpdateParams {
                    thread_id,
                    cwd: Some(cwd),
                    ..ThreadSettingsUpdateParams::default()
                },
            )
            .await
            .context("failed to change the App Server working directory")
    }

    pub(crate) async fn resume_thread(
        &mut self,
        thread_id: String,
    ) -> Result<ThreadResumeResponse> {
        let response: ThreadResumeResponse = self
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
        self.thread_id = Some(response.thread.id.clone());
        self.active_permission_profile = response
            .active_permission_profile
            .as_ref()
            .and_then(permission_profile_id);
        Ok(response)
    }
}
