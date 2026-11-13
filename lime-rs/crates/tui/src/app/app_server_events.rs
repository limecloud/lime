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
                self.chat_widget.clear_model_picker();
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
        if let ServerNotification::TurnCompleted(params) = &notification {
            if self.thread_id.as_deref() == Some(params.thread_id.as_str()) {
                self.recap.note_turn_completed(std::time::Instant::now());
            }
        }
        if self
            .handle_recap_notification(app_server_client, &notification)
            .await
        {
            return;
        }
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

    async fn handle_recap_notification(
        &mut self,
        app_server_client: &AppServerSession,
        notification: &ServerNotification,
    ) -> bool {
        let Some(recap_thread_id) = self.recap.pending_thread_id().map(str::to_string) else {
            return false;
        };
        let target =
            crate::app::app_server_event_targets::server_notification_thread_target(notification);
        if !matches!(
            target,
            crate::app::app_server_event_targets::ServerNotificationThreadTarget::Thread(thread_id)
                if thread_id == recap_thread_id
        ) {
            return false;
        }
        if let ServerNotification::AgentMessageDelta(params) = notification {
            self.recap.push_agent_delta(&params.delta);
            return true;
        }
        if let ServerNotification::TurnCompleted(params) = notification {
            let completed =
                params.turn.status == app_server_protocol::protocol::v2::TurnStatus::Completed;
            let mut succeeded = false;
            if completed {
                let pending = self.recap.clear();
                let mut response = pending
                    .as_ref()
                    .map(|pending| pending.assistant_text.clone())
                    .unwrap_or_default();
                if response.trim().is_empty() {
                    if let Ok(page) = app_server_client
                        .thread_items_page(recap_thread_id.clone(), None, 20)
                        .await
                    {
                        response = page
                            .data
                            .iter()
                            .find_map(|entry| match &entry.item {
                                app_server_protocol::protocol::v2::ThreadItem::AgentMessage {
                                    text,
                                    ..
                                } => Some(text.clone()),
                                _ => None,
                            })
                            .unwrap_or_default();
                    }
                }
                if let Some(recap) = crate::app::recap::parse_recap(&response) {
                    succeeded = true;
                    let mut message = format!(
                        "{}\n\n  ↳ Recap: {}",
                        self.chat_widget.locale.recap_heading(),
                        recap.summary
                    );
                    if let Some(next) = recap.next_action.as_deref() {
                        message.push_str(&format!(
                            "\n  ↳ {}: {next}",
                            self.chat_widget.locale.recap_next_label()
                        ));
                    }
                    self.projection.add_recap_message(message);
                }
                self.finish_recap_notification(succeeded, pending.map(|pending| pending.trigger));
            } else {
                let pending = self.recap.clear();
                self.finish_recap_notification(false, pending.map(|pending| pending.trigger));
            }
            let _ = app_server_client
                .thread_unsubscribe(recap_thread_id.clone())
                .await;
        }
        true
    }

    fn finish_recap_notification(
        &mut self,
        succeeded: bool,
        trigger: Option<crate::app::recap::RecapTrigger>,
    ) {
        if succeeded {
            self.recap.mark_recapped();
            return;
        }
        match trigger {
            Some(crate::app::recap::RecapTrigger::Automatic) => {
                self.recap.schedule_retry(std::time::Instant::now());
            }
            Some(crate::app::recap::RecapTrigger::Manual) => self
                .projection
                .set_status(self.chat_widget.locale.recap_failed()),
            None => {}
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
