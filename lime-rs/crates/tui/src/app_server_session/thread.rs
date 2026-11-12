//! Thread creation and recovery through the shared App Server lifecycle.

use super::{permission_profile_id, AppServerSession};
use anyhow::{Context, Result};
use app_server_protocol::protocol::v2::{
    ThreadResumeParams, ThreadResumeResponse, ThreadStartParams, ThreadStartResponse,
    ThreadStartSource, METHOD_THREAD_RESUME, METHOD_THREAD_START,
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

    pub(crate) async fn fork_thread(
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
