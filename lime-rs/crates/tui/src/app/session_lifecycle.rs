//! Session and subagent selection lifecycle for the TUI app.

use super::*;
use crate::app_server_session::AppServerSession;

impl App {
    /// Resume a canonical App Server thread and refresh the local projection/settings snapshot.
    ///
    /// Thread identity, queued input and agent-overview replay all move together so callers do
    /// not accidentally switch only the transport target or only the rendered conversation.
    #[allow(clippy::too_many_arguments)]
    pub(crate) async fn resume_target_session(
        &mut self,
        session: &mut AppServerSession,
        thread_id: String,
        model: &mut Option<String>,
        model_provider: &mut Option<String>,
        effort: &mut Option<String>,
        permissions: &mut Option<String>,
        options: &crate::runtime::TuiOptions,
    ) -> anyhow::Result<()> {
        if self.thread_id.as_deref() == Some(thread_id.as_str()) {
            return Ok(());
        }
        let response = session.resume_thread(thread_id).await?;
        let resumed_thread_id = response.thread.id.clone();
        let paginated_history = response.thread.history_mode
            == app_server_protocol::protocol::v2::ThreadHistoryMode::Paginated;
        let initial_cursor = response.items_backwards_cursor.clone();
        let initial_page = if paginated_history {
            session
                .hydrate_initial_thread_history(resumed_thread_id.clone(), initial_cursor)
                .await
        } else {
            Ok(crate::app_server_session::InitialHistoryPage {
                items: Vec::new(),
                turns: None,
            })
        };
        let snapshot = self.take_thread_event_snapshot(&resumed_thread_id, true);
        self.capture_current_thread_input();
        self.hydrate_thread(response.thread);
        self.set_thread_id(resumed_thread_id.clone());
        match initial_page {
            Ok(page) => {
                self.prepend_initial_history_page(page);
                self.scrollback_has_older_history = session.has_older_history(&resumed_thread_id);
            }
            Err(error) => self
                .projection
                .set_status(format!("history unavailable: {error}")),
        }
        self.restore_thread_input(&resumed_thread_id);
        self.replay_thread_snapshot(snapshot);
        *model = Some(response.model);
        *model_provider = Some(response.model_provider);
        *effort = response.reasoning_effort;
        if options.permissions.is_none() {
            *permissions = session.active_permission_profile().map(str::to_string);
        }
        let resumed_cwd = PathBuf::from(response.cwd);
        super::working_directory::sync_server_cwd(self, resumed_cwd);
        self.set_settings(
            model.clone(),
            model_provider.clone(),
            effort.clone(),
            permissions.clone(),
        );
        self.refresh_queued_submissions(session).await;
        Ok(())
    }

    pub(super) fn open_agent_picker(&mut self) {
        let picker =
            AgentPicker::from_navigation(&self.agent_navigation, self.primary_thread_id.as_deref())
                .with_current(self.thread_id.as_deref())
                .with_keymap(self.runtime_keymap.list().clone());
        if picker.is_empty() {
            self.projection.set_status(self.locale.agent_picker_empty());
        } else {
            self.agent_picker = Some(picker);
        }
    }
}

#[cfg(test)]
#[path = "session_lifecycle_tests.rs"]
mod tests;
