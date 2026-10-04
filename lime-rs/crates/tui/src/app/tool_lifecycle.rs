//! Tool lifecycle observations for the TUI app.
//!
//! Canonical tool state remains owned by App Server `ThreadItem` projection. This module only
//! forwards lifecycle facts that affect the TUI's agent navigation affordances.

use app_server_protocol::protocol::v2::{CollabAgentTool, ThreadItem};

use super::App;

/// Observe a canonical tool item without creating a second tool or thread store.
pub(super) fn observe_item(app: &mut App, item: &ThreadItem) {
    if let Some(activity) = crate::multi_agents::sub_agent_activity_display(item) {
        // Parent-stream activity is authoritative until the child is resumed independently.
        app.chat_widget
            .agent_navigation
            .mark_parent_owned(activity.thread_id.clone());
        app.chat_widget
            .agent_navigation
            .record_sub_agent_activity(activity);
        return;
    }

    if let ThreadItem::CollabAgentToolCall {
        tool: CollabAgentTool::SpawnAgent,
        receiver_thread_ids,
        ..
    } = item
    {
        for thread_id in receiver_thread_ids {
            app.chat_widget
                .agent_navigation
                .mark_parent_owned(thread_id.clone());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use app_server_protocol::protocol::v2::{CollabAgentToolCallStatus, SubAgentActivityKind};

    #[test]
    fn spawn_marks_receiver_thread_as_parent_owned() {
        let mut app = App::default();
        let item = ThreadItem::CollabAgentToolCall {
            id: "spawn-1".to_string(),
            metadata: None,
            tool: CollabAgentTool::SpawnAgent,
            status: CollabAgentToolCallStatus::InProgress,
            sender_thread_id: "parent-1".to_string(),
            receiver_thread_ids: vec!["child-1".to_string()],
            prompt: None,
            model: None,
            reasoning_effort: None,
            agents_states: std::collections::HashMap::new(),
        };

        observe_item(&mut app, &item);

        assert!(app.chat_widget.agent_navigation.is_parent_owned("child-1"));
    }

    #[test]
    fn sub_agent_activity_updates_navigation_liveness() {
        let mut app = App::default();
        let item = ThreadItem::SubAgentActivity {
            id: "activity-1".to_string(),
            metadata: None,
            kind: SubAgentActivityKind::Started,
            agent_thread_id: "child-1".to_string(),
            agent_path: "/root/child".to_string(),
        };

        observe_item(&mut app, &item);

        assert!(app.chat_widget.agent_navigation.is_parent_owned("child-1"));
        assert!(app
            .chat_widget
            .agent_navigation
            .get("child-1")
            .is_some_and(|entry| entry.is_running));
    }
}
