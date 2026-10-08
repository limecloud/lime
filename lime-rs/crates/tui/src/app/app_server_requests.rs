//! App Server reverse-request routing for the TUI.
//!
//! Requests that need a user decision enter the BottomPane queue. Requests for a foreign thread
//! are retained only when the Agents Overview has an explicit interaction surface; unsupported
//! requests fail closed at the App Server boundary.

use super::app_server_event_targets::server_request_thread_id;
use super::App;
use crate::app_server_session::AppServerSession;
use app_server_protocol::protocol::v2::ServerRequest;

impl App {
    pub(crate) async fn handle_server_request_event(
        &mut self,
        app_server_client: &AppServerSession,
        request: ServerRequest,
    ) {
        match request {
            ServerRequest::CurrentTimeRead { id, .. } => {
                if let Err(error) = app_server_client.respond_current_time(id).await {
                    self.projection.set_status(error.to_string());
                }
            }
            request => {
                // Requests without a TUI interaction surface must fail closed instead of being
                // retained for an impossible replay.
                let unsupported_request =
                    !crate::bottom_pane::BottomPane::supports_request(&request);
                let thread_id = server_request_thread_id(&request).map(str::to_owned);
                if let Some(thread_id) = thread_id {
                    if self.thread_id.as_deref() != Some(thread_id.as_str())
                        || self.history_replacement.is_pending()
                    {
                        if !unsupported_request {
                            match self.enqueue_thread_request(&thread_id, request) {
                                Ok(()) => return,
                                Err(request) => {
                                    if let Err(error) =
                                        app_server_client.reject_server_request(request).await
                                    {
                                        self.projection.set_status(error.to_string());
                                    }
                                    return;
                                }
                            }
                        }
                        if let Err(error) = app_server_client
                            .reject_server_request(Box::new(request))
                            .await
                        {
                            self.projection.set_status(error.to_string());
                        }
                        return;
                    }
                }
                match self.chat_widget.bottom_pane.enqueue(request) {
                    Ok(()) => {
                        if !unsupported_request {
                            self.note_startup_protected_request();
                        }
                        self.dismiss_pager_overlay();
                    }
                    Err(request) => {
                        if let Err(error) = app_server_client.reject_server_request(request).await {
                            self.projection.set_status(error.to_string());
                        }
                    }
                }
            }
        }
    }
}
