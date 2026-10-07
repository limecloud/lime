//! Thread-scoped event projection and agent activity observation.
//!
//! App Server transport delivery remains in `app_server_events.rs`; this owner applies canonical
//! Thread/Turn/Item notifications to the active projection and maintains navigation liveness.

use std::borrow::Cow;
use std::collections::VecDeque;
use std::time::Instant;

use app_server_protocol::protocol::v2::{ServerNotification, ServerRequest};

use super::app_server_event_targets::{
    server_notification_thread_target, ServerNotificationThreadTarget,
};
use super::pending_interactive_replay::PendingInteractiveReplayState;
use super::replay_filter;
use super::thread_event_buffer::THREAD_EVENT_CHANNEL_CAPACITY;
use super::App;

#[derive(Debug, Clone)]
pub(super) struct ThreadEventSnapshot {
    pub(super) events: Vec<ThreadBufferedEvent>,
}

#[derive(Debug, Clone)]
pub(super) enum ThreadBufferedEvent {
    Notification(Box<ServerNotification>),
    Request(Box<ServerRequest>),
}

#[derive(Debug)]
pub(super) struct ThreadEventStore {
    pub(super) buffer: VecDeque<ThreadBufferedEvent>,
    pub(super) capacity: usize,
    pub(super) buffered_agent_message_delta_bytes: usize,
    pub(super) pending_interactive_replay: PendingInteractiveReplayState,
}

impl ThreadEventStore {
    pub(super) fn new(capacity: usize) -> Self {
        Self {
            buffer: VecDeque::new(),
            capacity,
            buffered_agent_message_delta_bytes: 0,
            pending_interactive_replay: PendingInteractiveReplayState::default(),
        }
    }

    #[cfg_attr(not(test), allow(dead_code))]
    pub(super) fn push_notification(&mut self, notification: ServerNotification) {
        self.pending_interactive_replay
            .note_server_notification(&notification);
        if matches!(notification, ServerNotification::ServerRequestResolved(_)) {
            return;
        }
        self.push_replay_notification(Cow::Owned(notification));
    }

    pub(super) fn push_notification_ref(&mut self, notification: &ServerNotification) {
        self.pending_interactive_replay
            .note_server_notification(notification);
        if matches!(notification, ServerNotification::ServerRequestResolved(_)) {
            return;
        }
        self.push_replay_notification(Cow::Borrowed(notification));
    }

    pub(super) fn push_request(&mut self, request: ServerRequest) -> bool {
        self.pending_interactive_replay
            .note_server_request(&request);
        if self.push_buffered_event(ThreadBufferedEvent::Request(Box::new(request.clone()))) {
            true
        } else {
            self.pending_interactive_replay
                .note_evicted_server_request(&request);
            false
        }
    }

    /// A fresh `thread/resume` snapshot supersedes buffered projection events. Interactive
    /// requests survive because they still need an explicit client response.
    pub(super) fn rebase_buffer_after_session_refresh(&mut self) {
        self.buffer.retain(|event| {
            matches!(event, ThreadBufferedEvent::Request(request)
                    if self.pending_interactive_replay.should_replay_snapshot_request(request))
                || matches!(event, ThreadBufferedEvent::Notification(notification)
                    if matches!(notification.as_ref(), ServerNotification::McpServerOauthLoginCompleted(_)))
        });
        self.buffered_agent_message_delta_bytes = 0;
    }

    pub(super) fn snapshot(&self) -> ThreadEventSnapshot {
        ThreadEventSnapshot {
            events: self
                .buffer
                .iter()
                .filter(|event| match event {
                    ThreadBufferedEvent::Request(request) => self
                        .pending_interactive_replay
                        .should_replay_snapshot_request(request),
                    ThreadBufferedEvent::Notification(_) => true,
                })
                .cloned()
                .collect(),
        }
    }

    fn drain_snapshot(&mut self) -> ThreadEventSnapshot {
        self.buffered_agent_message_delta_bytes = 0;
        let mut snapshot = self.snapshot();
        replay_filter::omit_completed_agent_deltas(&mut snapshot.events);
        self.buffer.clear();
        snapshot
    }

    pub(super) fn note_outbound_response(&mut self, request_id: &app_server_protocol::RequestId) {
        self.pending_interactive_replay
            .note_outbound_response(request_id);
    }
}

#[derive(Debug)]
pub(super) struct ThreadEventChannel {
    pub(super) store: ThreadEventStore,
}

impl ThreadEventChannel {
    pub(super) fn new(capacity: usize) -> Self {
        Self {
            store: ThreadEventStore::new(capacity),
        }
    }
}

impl App {
    pub(super) fn ensure_thread_channel(&mut self, thread_id: &str) -> &mut ThreadEventChannel {
        self.thread_event_channels
            .entry(thread_id.to_string())
            .or_insert_with(|| ThreadEventChannel::new(THREAD_EVENT_CHANNEL_CAPACITY))
    }

    pub(super) fn replay_thread_snapshot(&mut self, snapshot: ThreadEventSnapshot) {
        if replay_filter::snapshot_has_pending_interactive_request(&snapshot) {
            self.dismiss_pager_overlay();
        }
        for event in snapshot.events {
            if replay_filter::event_is_notice(&event) {
                continue;
            }
            self.handle_thread_event_replay(event);
        }
    }

    pub(super) fn handle_thread_event_replay(&mut self, event: ThreadBufferedEvent) {
        match event {
            ThreadBufferedEvent::Notification(notification) => {
                self.apply_notification(*notification)
            }
            ThreadBufferedEvent::Request(request) => {
                if let Err(request) = self.chat_widget.bottom_pane.enqueue(*request) {
                    debug_assert!(
                        false,
                        "buffered request became unsupported: {}",
                        request.method()
                    );
                } else {
                    self.dismiss_pager_overlay();
                }
            }
        }
    }

    pub(super) fn enqueue_thread_request(
        &mut self,
        thread_id: &str,
        request: ServerRequest,
    ) -> Result<(), Box<ServerRequest>> {
        let channel = self.ensure_thread_channel(thread_id);
        if channel.store.push_request(request.clone()) {
            Ok(())
        } else {
            Err(Box::new(request))
        }
    }

    pub(super) fn take_thread_event_snapshot(
        &mut self,
        thread_id: &str,
        session_refreshed: bool,
    ) -> ThreadEventSnapshot {
        let channel = self.ensure_thread_channel(thread_id);
        if session_refreshed {
            channel.store.rebase_buffer_after_session_refresh();
        }
        channel.store.drain_snapshot()
    }

    pub(crate) fn apply_notification(&mut self, notification: ServerNotification) {
        if let ServerNotification::McpServerStatusUpdated(params) = &notification {
            self.chat_widget.mcp_startup_warnings.observe(params);
        }
        self.track_agents_overview_notification(&notification);
        self.observe_notification(&notification);
        let target = server_notification_thread_target(&notification);
        if let ServerNotificationThreadTarget::Thread(thread_id) = &target {
            self.observe_thread_input_notification(thread_id, &notification);
        }
        if matches!(
            target,
            ServerNotificationThreadTarget::Thread(ref thread_id)
                if self.thread_id.as_deref() != Some(thread_id.as_str())
        ) || matches!(target, ServerNotificationThreadTarget::InvalidThreadId(_))
        {
            if let ServerNotificationThreadTarget::Thread(thread_id) = target {
                self.ensure_thread_channel(&thread_id)
                    .store
                    .push_notification_ref(&notification);
            }
            return;
        }
        if let ServerNotification::McpServerOauthLoginCompleted(params) = &notification {
            if !self.show_mcp_login_completion(params) {
                return;
            }
        }
        let previous_turn_id = self.projection.active_turn_id().map(str::to_owned);
        self.observe_status_thread_metadata(&notification);
        self.projection.apply(notification);
        let active_turn_id = self.projection.active_turn_id();
        self.chat_widget.turn_lifecycle.sync_projection_turn(
            previous_turn_id.as_deref(),
            active_turn_id,
            Instant::now(),
        );
    }

    pub(super) fn note_outbound_response(
        &mut self,
        response: &crate::bottom_pane::AppServerResponse,
    ) {
        let request_id = match response {
            crate::bottom_pane::AppServerResponse::Command { id, .. }
            | crate::bottom_pane::AppServerResponse::FileChange { id, .. }
            | crate::bottom_pane::AppServerResponse::Permissions { id, .. }
            | crate::bottom_pane::AppServerResponse::UserInput { id, .. }
            | crate::bottom_pane::AppServerResponse::McpElicitation { id, .. } => id,
        };
        for channel in self.thread_event_channels.values_mut() {
            channel.store.note_outbound_response(request_id);
        }
    }

    fn observe_notification(&mut self, notification: &ServerNotification) {
        match notification {
            ServerNotification::ThreadStarted(params) => {
                self.chat_widget.agent_navigation.upsert(
                    params.thread.id.clone(),
                    params.thread.agent_nickname.clone(),
                    params.thread.agent_role.clone(),
                    false,
                );
                if params.thread.parent_thread_id.is_some() {
                    self.chat_widget
                        .agent_navigation
                        .mark_parent_owned(params.thread.id.clone());
                }
            }
            ServerNotification::ThreadClosed(params) => {
                self.chat_widget
                    .agent_navigation
                    .mark_closed(&params.thread_id);
            }
            ServerNotification::ThreadStatusChanged(params) => match &params.status {
                app_server_protocol::protocol::v2::ThreadStatus::Active { .. } => self
                    .chat_widget
                    .agent_navigation
                    .mark_running(&params.thread_id),
                app_server_protocol::protocol::v2::ThreadStatus::Idle
                | app_server_protocol::protocol::v2::ThreadStatus::SystemError => self
                    .chat_widget
                    .agent_navigation
                    .mark_stopped(&params.thread_id),
                app_server_protocol::protocol::v2::ThreadStatus::NotLoaded => {}
            },
            ServerNotification::ItemStarted(params) => {
                super::tool_lifecycle::observe_item(self, &params.item);
            }
            ServerNotification::ItemCompleted(params) => {
                super::tool_lifecycle::observe_item(self, &params.item);
            }
            _ => {}
        }
    }
}
