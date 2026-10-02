//! App-server event stream handling for the TUI app.

use super::startup::apply_skills_list_response;
use super::App;
use crate::app_server_session::AppServerSession;
use app_server_client::AppServerEvent;
use app_server_protocol::protocol::v2::ServerNotification;

impl App {
    pub(crate) async fn handle_app_server_event(
        &mut self,
        app_server_client: &AppServerSession,
        event: AppServerEvent,
    ) {
        match event {
            AppServerEvent::Lagged { .. } => {}
            AppServerEvent::ServerNotification(notification) => {
                self.handle_server_notification_event(app_server_client, *notification)
                    .await;
            }
            AppServerEvent::ServerRequest(request) => {
                self.handle_server_request_event(app_server_client, *request)
                    .await;
            }
            AppServerEvent::Disconnected { .. } => {
                self.clear_connection_interactions();
                self.chat_widget.model_picker = None;
                self.dismiss_pager_overlay();
                self.projection.set_status("reconnecting");
            }
        }
    }

    async fn handle_server_notification_event(
        &mut self,
        app_server_client: &AppServerSession,
        notification: ServerNotification,
    ) {
        let notification = match notification {
            ServerNotification::McpServerOauthLoginCompleted(completion) => {
                let Some(completion) = self.accept_mcp_login_completion(completion) else {
                    return;
                };
                ServerNotification::McpServerOauthLoginCompleted(completion)
            }
            notification => notification,
        };
        let queue_changed = matches!(
            &notification,
            ServerNotification::ThreadQueueChanged(params)
                if self.thread_id.as_deref() == Some(params.thread_id.as_str())
        );
        let skills_changed = matches!(&notification, ServerNotification::SkillsChanged(_));
        self.apply_notification(notification);
        if queue_changed {
            self.refresh_queued_submissions(app_server_client).await;
        }
        if skills_changed {
            match app_server_client
                .reload_skills(vec![self.cwd.clone()])
                .await
            {
                Ok(response) => apply_skills_list_response(self, response),
                Err(error) => self
                    .projection
                    .set_status(format!("skills unavailable: {error}")),
            }
        }
    }

    pub(crate) async fn refresh_queued_submissions(
        &mut self,
        app_server_client: &AppServerSession,
    ) {
        match app_server_client.list_queued_submissions(100).await {
            Ok(submissions) => self.set_queued_submissions(submissions),
            Err(error) => {
                self.set_queued_submissions(Vec::new());
                self.projection
                    .set_status(format!("queue unavailable: {error}"));
            }
        }
    }
}
