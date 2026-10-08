//! Typed reasoning notifications preserve content bytes independently of identity parsing.

use super::{
    payload_i64, payload_string, required_event_id, text_from_payload, V2NotificationProjector,
};
use app_server_protocol::protocol::v2::{self, ServerNotification};
use app_server_protocol::AgentEvent;

impl V2NotificationProjector {
    pub(super) fn project_reasoning_summary_text_delta(
        &self,
        event: &AgentEvent,
    ) -> Option<ServerNotification> {
        let (thread_id, turn_id, item_id) = reasoning_identity(event)?;
        let delta = event.payload.get("summary")?.as_str()?.to_string();
        let summary_index = payload_i64(&event.payload, "summaryIndex")?;
        Some(ServerNotification::ReasoningSummaryTextDelta(
            v2::ReasoningSummaryTextDeltaNotification {
                thread_id,
                turn_id,
                item_id,
                delta,
                summary_index,
            },
        ))
    }

    pub(super) fn project_reasoning_summary_part_added(
        &self,
        event: &AgentEvent,
    ) -> Option<ServerNotification> {
        let (thread_id, turn_id, item_id) = reasoning_identity(event)?;
        let summary_index = payload_i64(&event.payload, "summaryIndex")?;
        Some(ServerNotification::ReasoningSummaryPartAdded(
            v2::ReasoningSummaryPartAddedNotification {
                thread_id,
                turn_id,
                item_id,
                summary_index,
            },
        ))
    }

    pub(super) fn project_reasoning_text_delta(
        &self,
        event: &AgentEvent,
    ) -> Option<ServerNotification> {
        let (thread_id, turn_id, item_id) = reasoning_identity(event)?;
        let delta = event.payload.get("delta")?.as_str()?.to_string();
        let content_index = payload_i64(&event.payload, "contentIndex")?;
        Some(ServerNotification::ReasoningTextDelta(
            v2::ReasoningTextDeltaNotification {
                thread_id,
                turn_id,
                item_id,
                delta,
                content_index,
            },
        ))
    }

    pub(super) fn project_reasoning_final(&self, event: &AgentEvent) -> Option<ServerNotification> {
        let (thread_id, turn_id, item_id) = reasoning_identity(event)?;
        let delta = text_from_payload(&event.payload)?;
        let summary_index = payload_i64(&event.payload, "summaryIndex").unwrap_or_default();
        Some(ServerNotification::ReasoningSummaryTextDelta(
            v2::ReasoningSummaryTextDeltaNotification {
                thread_id,
                turn_id,
                item_id,
                delta,
                summary_index,
            },
        ))
    }
}

fn reasoning_identity(event: &AgentEvent) -> Option<(String, String, String)> {
    Some((
        required_event_id(event.thread_id.as_deref())?,
        required_event_id(event.turn_id.as_deref())?,
        payload_string(
            &event.payload,
            &["itemId", "item_id", "reasoningId", "reasoning_id"],
        )?,
    ))
}
