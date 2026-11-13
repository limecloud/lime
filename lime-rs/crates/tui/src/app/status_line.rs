//! Status facts lower canonical settings and thread metadata without terminal-owned IO.

use super::{App, AppAction};
use crate::app_server_session::AppServerSession;
use crate::bottom_pane::status_line_setup::StatusLineSetupAction;
use crate::bottom_pane::status_surface_preview::StatusSurfacePreviewData;
use app_server_protocol::protocol::v2::{ConfigEdit, MergeStrategy, ServerNotification};
use crossterm::event::Event;
use serde_json::json;

#[cfg(test)]
#[path = "status_line_tests.rs"]
mod tests;

fn hostname() -> Option<String> {
    static HOSTNAME: std::sync::OnceLock<Option<String>> = std::sync::OnceLock::new();
    HOSTNAME
        .get_or_init(|| {
            std::process::Command::new("hostname")
                .output()
                .ok()
                .and_then(|output| {
                    output
                        .status
                        .success()
                        .then(|| String::from_utf8_lossy(&output.stdout).trim().to_string())
                })
                .filter(|hostname| !hostname.is_empty())
                .or_else(|| std::env::var("HOSTNAME").ok())
        })
        .clone()
}

impl App {
    pub(crate) fn status_surface_data(&self) -> StatusSurfacePreviewData {
        let widget = &self.chat_widget;
        StatusSurfacePreviewData {
            model: widget.model.clone(),
            reasoning: widget.reasoning_effort.clone(),
            current_dir: (!self.cwd.as_os_str().is_empty())
                .then(|| self.cwd.to_string_lossy().into_owned()),
            git_branch: self.thread_git_branch.clone(),
            provider: widget.model_provider.clone(),
            version: Some(env!("CARGO_PKG_VERSION").to_string()),
            hostname: crate::app::status_line::hostname(),
            status: self
                .thread_id
                .as_ref()
                .map(|_| self.live_thread_status().unwrap_or("ready").to_string()),
            permissions: widget.permissions.clone(),
            session_id: self.thread_id.clone(),
            thread_name: self
                .thread_id
                .as_ref()
                .and_then(|id| widget.thread_names.get(id))
                .cloned(),
            raw_output: self.raw_output_mode(),
            task_progress: self
                .thread_id
                .as_deref()
                .and_then(|id| self.projection.plan_progress(id)),
            token_usage: self
                .thread_id
                .as_deref()
                .and_then(|id| self.projection.token_usage(id))
                .cloned(),
        }
    }

    pub(super) fn handle_status_line_setup_event(&mut self, event: &Event) -> Option<AppAction> {
        let action = self
            .chat_widget
            .status_line_setup
            .as_mut()?
            .handle_event(event);
        let result = match action {
            StatusLineSetupAction::None => return Some(AppAction::None),
            StatusLineSetupAction::Cancel => AppAction::None,
            StatusLineSetupAction::Confirm { items, use_colors } => {
                AppAction::StatusLineSetup { items, use_colors }
            }
        };
        self.chat_widget.status_line_setup = None;
        Some(result)
    }

    pub(super) fn observe_status_thread_metadata(&mut self, notification: &ServerNotification) {
        match notification {
            ServerNotification::ThreadStarted(params) => self
                .chat_widget
                .set_status_thread_name(params.thread.id.clone(), params.thread.name.clone()),
            ServerNotification::ThreadNameUpdated(params) => self
                .chat_widget
                .set_status_thread_name(params.thread_id.clone(), params.thread_name.clone()),
            ServerNotification::ThreadDeleted(params) => {
                self.chat_widget.thread_names.remove(&params.thread_id);
            }
            _ => {}
        }
    }

    pub(super) async fn save_status_line(
        &mut self,
        session: &AppServerSession,
        items: Vec<String>,
        use_colors: bool,
    ) {
        let result = self
            .write_tui_preferences(
                session,
                vec![
                    ConfigEdit {
                        key_path: "tui.status_line".to_string(),
                        value: json!(items),
                        merge_strategy: MergeStrategy::Replace,
                    },
                    ConfigEdit {
                        key_path: "tui.status_line_use_colors".to_string(),
                        value: json!(use_colors),
                        merge_strategy: MergeStrategy::Replace,
                    },
                ],
            )
            .await;
        match result {
            Ok(version) => {
                self.chat_widget
                    .setup_status_line(items, use_colors, version);
                self.projection
                    .set_status(self.chat_widget.locale.status_line_saved());
            }
            Err(error) => {
                self.projection.set_status(
                    self.chat_widget
                        .locale
                        .status_line_save_failed(&format!("{error:#}")),
                );
            }
        }
    }
}
