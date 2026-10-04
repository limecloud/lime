//! MCP sign-in interaction aligned with Codex 4773a132c3.
//!
//! OAuth and credentials remain App Server-owned. This owner only tracks UI request ordering,
//! rejects stale completions, and routes results back to their originating thread.

use app_server_client::RequestHandle;
use app_server_protocol::protocol::v2::{
    McpServerOauthLoginCompletedNotification, McpServerStatusDetail, ServerNotification,
};
use app_server_protocol::{
    McpServerOauthLoginParams, McpServerOauthLoginResponse, METHOD_MCP_SERVER_OAUTH_LOGIN,
};
use tokio::sync::mpsc::UnboundedSender;

use super::{App, AppAction};

#[derive(Debug)]
pub(super) struct PendingMcpLoginStart {
    pub(super) request_id: u64,
    pub(super) name: String,
    pub(super) thread_id: String,
    pub(super) completions: Vec<McpServerOauthLoginCompletedNotification>,
}

#[derive(Debug, PartialEq, Eq)]
pub(super) struct ActiveMcpLogin {
    pub(super) login_id: Option<String>,
    pub(super) thread_id: String,
}

#[derive(Debug)]
pub(crate) struct McpLoginStarted {
    pub(crate) request_id: u64,
    pub(crate) result: Result<McpServerOauthLoginResponse, String>,
}

pub(super) fn start_mcp_login(
    request_handle: RequestHandle,
    request_id: u64,
    name: String,
    thread_id: String,
    result_tx: UnboundedSender<McpLoginStarted>,
) {
    tokio::spawn(async move {
        let result = request_handle
            .request(
                METHOD_MCP_SERVER_OAUTH_LOGIN,
                McpServerOauthLoginParams {
                    name,
                    thread_id: Some(thread_id),
                    scopes: None,
                    timeout_secs: None,
                },
            )
            .await
            .map_err(|error| error.to_string());
        let _ = result_tx.send(McpLoginStarted { request_id, result });
    });
}

impl App {
    pub(super) fn mcp_command(&mut self, argument: &str) -> AppAction {
        let parts = argument.split_whitespace().collect::<Vec<_>>();
        match parts.as_slice() {
            [] => AppAction::FetchMcpInventory {
                detail: McpServerStatusDetail::ToolsAndAuthOnly,
            },
            [verb] if verb.eq_ignore_ascii_case("verbose") => AppAction::FetchMcpInventory {
                detail: McpServerStatusDetail::Full,
            },
            [verb, name] if verb.eq_ignore_ascii_case("login") => match self.thread_id.clone() {
                Some(thread_id) => AppAction::StartMcpLogin {
                    name: name.to_string(),
                    thread_id,
                },
                None => {
                    self.projection
                        .set_status(self.chat_widget.locale.mcp_login_requires_session());
                    AppAction::None
                }
            },
            _ => {
                self.projection
                    .set_status(self.chat_widget.locale.mcp_usage());
                AppAction::None
            }
        }
    }

    pub(super) fn begin_mcp_login_start(&mut self, name: String, thread_id: String) -> Option<u64> {
        if let Some(pending) = self.pending_mcp_login_start.as_ref() {
            self.projection
                .add_info_message(self.chat_widget.locale.mcp_login_in_progress(&pending.name));
            return None;
        }
        self.mcp_login_generation = self.mcp_login_generation.wrapping_add(1);
        let request_id = self.mcp_login_generation;
        self.pending_mcp_login_start = Some(PendingMcpLoginStart {
            request_id,
            name,
            thread_id,
            completions: Vec::new(),
        });
        Some(request_id)
    }

    /// Filter only transport delivery, never replay: an accepted result must survive removal of
    /// its active login ID and a later thread/resume snapshot.
    pub(super) fn accept_mcp_login_completion(
        &mut self,
        mut completion: McpServerOauthLoginCompletedNotification,
    ) -> Option<McpServerOauthLoginCompletedNotification> {
        if let Some(pending) = self.pending_mcp_login_start.as_mut() {
            if pending.name == completion.name
                && completion
                    .thread_id
                    .as_ref()
                    .is_none_or(|thread_id| thread_id == &pending.thread_id)
            {
                pending.completions.push(completion);
                return None;
            }
        }
        let active = self.active_mcp_login_ids.get(&completion.name);
        if let Some(active) = active {
            if completion.login_id != active.login_id
                || completion
                    .thread_id
                    .as_ref()
                    .is_some_and(|id| id != &active.thread_id)
            {
                return None;
            }
            // Legacy servers can omit the thread scope; only a known attempt supplies it.
            completion.thread_id = Some(active.thread_id.clone());
        } else if completion.login_id.is_some() {
            return None;
        }
        Some(completion)
    }

    pub(crate) fn finish_mcp_login_start(
        &mut self,
        event: McpLoginStarted,
        open: impl FnOnce(&str) -> Result<(), String>,
    ) {
        let Some(pending) = self
            .pending_mcp_login_start
            .take_if(|pending| pending.request_id == event.request_id)
        else {
            return;
        };
        match event.result {
            Ok(response) => {
                let already_completed = pending.completions.iter().any(|completion| {
                    completion.name == pending.name
                        && completion.login_id == response.login_id
                        && completion
                            .thread_id
                            .as_ref()
                            .is_none_or(|id| id == &pending.thread_id)
                });
                self.active_mcp_login_ids.insert(
                    pending.name.clone(),
                    ActiveMcpLogin {
                        login_id: response.login_id,
                        thread_id: pending.thread_id.clone(),
                    },
                );
                if !already_completed {
                    match open(&response.authorization_url) {
                        Ok(()) if self.thread_id.as_ref() == Some(&pending.thread_id) => {
                            self.projection.add_info_message(
                                self.chat_widget.locale.mcp_login_opened(&pending.name),
                            );
                        }
                        Err(error) => {
                            self.projection.add_error_message(format!(
                                "{}\n{}",
                                self.chat_widget
                                    .locale
                                    .mcp_login_open_failed(&pending.name, &error),
                                response.authorization_url
                            ));
                        }
                        _ => {}
                    }
                }
            }
            Err(error) => {
                self.apply_notification(ServerNotification::McpServerOauthLoginCompleted(
                    McpServerOauthLoginCompletedNotification {
                        name: pending.name,
                        thread_id: Some(pending.thread_id),
                        login_id: None,
                        success: false,
                        error: Some(error),
                    },
                ));
            }
        }
        // A failed replacement leaves the old attempt valid; a successful replacement changes
        // its ID before replay, discarding old cancellations and late results.
        for completion in pending.completions {
            if let Some(completion) = self.accept_mcp_login_completion(completion) {
                self.apply_notification(ServerNotification::McpServerOauthLoginCompleted(
                    completion,
                ));
            }
        }
    }

    pub(super) fn show_mcp_login_completion(
        &mut self,
        completion: &McpServerOauthLoginCompletedNotification,
    ) -> bool {
        if let Some(active) = self.active_mcp_login_ids.get(&completion.name) {
            if completion.login_id != active.login_id
                || completion
                    .thread_id
                    .as_ref()
                    .is_some_and(|thread_id| thread_id != &active.thread_id)
            {
                return false;
            }
        } else if completion.login_id.is_some() {
            // A typed completion without a locally-owned attempt is stale or belongs to another
            // client. Keep it out of the visible transcript.
            return false;
        }

        self.active_mcp_login_ids.remove(&completion.name);
        if completion.success {
            self.projection.set_status(
                self.chat_widget
                    .locale
                    .mcp_login_succeeded(&completion.name),
            );
        } else {
            self.projection.set_status(
                self.chat_widget
                    .locale
                    .mcp_login_failed_completion(&completion.name, completion.error.as_deref()),
            );
        }
        true
    }
}
