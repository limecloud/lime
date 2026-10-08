use super::deprecated_agent_event_notification;
use super::thread::{project_event, ProjectedEvent};
use app_server_protocol::protocol::v2::{self, ServerNotification};
use app_server_protocol::{error_codes, AgentEvent, JsonRpcError, JsonRpcNotification};
use serde_json::Value;
use std::collections::HashSet;

mod command;
pub(crate) mod error;
mod file_change;
mod guardian;
mod guardian_warning;
mod hook;
mod mcp;
mod plan;
mod reasoning;
mod thread_status;
mod turn_diff;
mod turn_plan;
mod warning;

enum EventProjection {
    Direct(Vec<JsonRpcNotification>),
    SideChannel,
    Reject(JsonRpcError),
}

#[derive(Default)]
pub(crate) struct V2NotificationProjector {
    started_turn_ids: HashSet<String>,
    model_reroute_turn_ids: HashSet<String>,
    model_verification_turn_ids: HashSet<String>,
    started_plan_item_ids: HashSet<String>,
    completed_plan_item_ids: HashSet<String>,
    started_command_item_ids: HashSet<String>,
    completed_command_item_ids: HashSet<String>,
    started_file_change_item_ids: HashSet<String>,
    completed_file_change_item_ids: HashSet<String>,
    started_mcp_item_ids: HashSet<String>,
    completed_mcp_item_ids: HashSet<String>,
    started_hook_run_ids: HashSet<String>,
    completed_hook_run_ids: HashSet<String>,
    terminal_error_turn_ids: HashSet<String>,
    thread_status: thread_status::ThreadStatusProjector,
}

impl V2NotificationProjector {
    pub(crate) fn project(
        &mut self,
        event: AgentEvent,
    ) -> Result<Vec<JsonRpcNotification>, JsonRpcError> {
        match self.classify(&event) {
            EventProjection::Direct(notifications) => Ok(notifications),
            EventProjection::SideChannel => Ok(vec![deprecated_agent_event_notification(event)]),
            EventProjection::Reject(error) => Err(error),
        }
    }

    fn classify(&mut self, event: &AgentEvent) -> EventProjection {
        let notification = match event.event_type.as_str() {
            "thread.created" | "thread.started" => return self.project_thread_started(event),
            "turn.accepted" => return EventProjection::Direct(Vec::new()),
            "turn.started" => return self.project_turn_started(event),
            "turn.completed" => {
                return self.project_turn_completed_with_usage(event, v2::TurnStatus::Completed)
            }
            "turn.failed" => return self.project_turn_failed(event),
            "turn.canceled" => {
                return self.project_turn_completed_with_usage(event, v2::TurnStatus::Interrupted)
            }
            "runtime.error" => return self.project_error(event, None),
            "action.required" => {
                return EventProjection::Direct(
                    self.thread_status
                        .project_action_required(event)
                        .into_iter()
                        .map(Into::into)
                        .collect(),
                )
            }
            "dynamic_tool.requested" => return EventProjection::Direct(Vec::new()),
            "action.resolved" | "action.canceled" | "action.cancelled" | "action.expired" => {
                return EventProjection::Direct(
                    self.thread_status
                        .project_action_terminal(event)
                        .into_iter()
                        .map(Into::into)
                        .collect(),
                )
            }
            "provider.step" => {
                return EventProjection::Direct(Vec::new());
            }
            "thread.goal.continuation" => return EventProjection::Direct(Vec::new()),
            "thread.settings.updated" => return self.project_thread_settings_updated(event),
            "queue.promoted" => return self.project_thread_queue_changed(event),
            "provider.usage" => return self.project_token_usage(event),
            "hook.started" => return hook::project_started(&mut self.started_hook_run_ids, event),
            "hook.completed" => {
                return hook::project_completed(
                    &self.started_hook_run_ids,
                    &mut self.completed_hook_run_ids,
                    event,
                )
            }
            "guardian.review.started" => return guardian::project_started(event),
            "guardian.review.completed" => return guardian::project_completed(event),
            "guardian.warning" => return guardian_warning::project(event),
            "item.started" | "command.started" => self.project_item(event, false),
            "item.completed" | "command.exited" => self.project_item(event, true),
            "context.compaction.started" => self.project_item(event, false),
            "context.compaction.completed" => self.project_item(event, true),
            "command.output" => {
                return command::project_output_delta(
                    &self.started_command_item_ids,
                    &self.completed_command_item_ids,
                    event,
                )
            }
            "command.interaction" => {
                return command::project_terminal_interaction(
                    &self.started_command_item_ids,
                    &self.completed_command_item_ids,
                    event,
                )
            }
            "patch.started" => {
                return file_change::project_started(
                    &mut self.started_file_change_item_ids,
                    &self.completed_file_change_item_ids,
                    event,
                )
            }
            "patch.applied" | "patch.failed" | "patch.declined" => {
                return file_change::project_final(
                    &self.started_file_change_item_ids,
                    &mut self.completed_file_change_item_ids,
                    event,
                )
            }
            "plan.delta" => {
                return plan::project_delta(
                    &mut self.started_plan_item_ids,
                    &self.completed_plan_item_ids,
                    event,
                )
            }
            "plan.final" => {
                return plan::project_final(
                    &mut self.started_plan_item_ids,
                    &mut self.completed_plan_item_ids,
                    event,
                )
            }
            "turn.plan.updated" => return turn_plan::project(event),
            "turn.diff.updated" => return turn_diff::project(event),
            "tool.progress" => {
                return mcp::project_progress(
                    &self.started_mcp_item_ids,
                    &self.completed_mcp_item_ids,
                    event,
                )
            }
            "message.delta" | "message.delta_batch" | "message.batch" => {
                self.project_agent_message_delta(event)
            }
            "reasoning.summary" => self.project_reasoning_summary_text_delta(event),
            "reasoning.summary_part_added" => self.project_reasoning_summary_part_added(event),
            "reasoning.delta" => self.project_reasoning_text_delta(event),
            "reasoning.final" => self.project_reasoning_final(event),
            "model.server_reported" => return EventProjection::Direct(Vec::new()),
            "model.rerouted" => return self.project_model_rerouted(event),
            "model.verification" => return self.project_model_verification(event),
            "turn.moderation_metadata" => return self.project_turn_moderation_metadata(event),
            "provider_safety_buffering" => self.project_model_safety_buffering(event),
            "runtime.warning" => return warning::project(event),
            _ if is_allowed_raw_side_channel_type(&event.event_type) => {
                return EventProjection::SideChannel;
            }
            _ => return EventProjection::Reject(projection_error(event)),
        };
        match notification {
            Some(notification) => EventProjection::Direct(vec![notification.into()]),
            None => EventProjection::Reject(projection_error(event)),
        }
    }

    fn project_thread_started(&mut self, event: &AgentEvent) -> EventProjection {
        let ProjectedEvent::Thread(thread) = (match project_event(event) {
            Some(projected) => projected,
            None => return EventProjection::Reject(projection_error(event)),
        }) else {
            return EventProjection::Reject(projection_error(event));
        };
        self.thread_status.note_thread_started(&thread.id);
        EventProjection::Direct(vec![ServerNotification::ThreadStarted(
            v2::ThreadStartedNotification { thread },
        )
        .into()])
    }

    fn project_thread_settings_updated(&self, event: &AgentEvent) -> EventProjection {
        let Some(thread_id) = required_event_id(event.thread_id.as_deref()) else {
            return EventProjection::Reject(projection_error(event));
        };
        let Some(settings) = event.payload.get("threadSettings") else {
            return EventProjection::Reject(projection_error(event));
        };
        let Ok(thread_settings) = serde_json::from_value(settings.clone()) else {
            return EventProjection::Reject(projection_error(event));
        };
        EventProjection::Direct(vec![ServerNotification::ThreadSettingsUpdated(
            v2::ThreadSettingsUpdatedNotification {
                thread_id,
                thread_settings,
            },
        )
        .into()])
    }

    fn project_thread_queue_changed(&self, event: &AgentEvent) -> EventProjection {
        let Some(thread_id) = required_event_id(event.thread_id.as_deref()) else {
            return EventProjection::Reject(projection_error(event));
        };
        EventProjection::Direct(vec![ServerNotification::ThreadQueueChanged(
            v2::ThreadQueueChangedNotification { thread_id },
        )
        .into()])
    }

    fn project_turn_started(&mut self, event: &AgentEvent) -> EventProjection {
        let Some((thread_id, turn_id, turn)) = project_turn(event, v2::TurnStatus::InProgress)
        else {
            return EventProjection::Reject(projection_error(event));
        };
        if !self.started_turn_ids.insert(turn_id) {
            return EventProjection::Direct(Vec::new());
        }
        let mut notifications = Vec::with_capacity(2);
        if let Some(status) = self.thread_status.project_turn_started(&thread_id) {
            notifications.push(status.into());
        }
        notifications.push(
            ServerNotification::TurnStarted(v2::TurnStartedNotification { thread_id, turn }).into(),
        );
        EventProjection::Direct(notifications)
    }

    fn project_turn_completed(
        &self,
        event: &AgentEvent,
        expected_status: v2::TurnStatus,
    ) -> Option<ServerNotification> {
        let (thread_id, _, turn) = project_turn(event, expected_status)?;
        Some(ServerNotification::TurnCompleted(
            v2::TurnCompletedNotification { thread_id, turn },
        ))
    }

    fn project_turn_completed_with_usage(
        &mut self,
        event: &AgentEvent,
        expected_status: v2::TurnStatus,
    ) -> EventProjection {
        let Some(turn_notification) = self.project_turn_completed(event, expected_status) else {
            return EventProjection::Reject(projection_error(event));
        };
        let ServerNotification::TurnCompleted(v2::TurnCompletedNotification {
            ref thread_id, ..
        }) = turn_notification
        else {
            unreachable!("turn completion projector returned a non-turn notification")
        };
        let mut notifications = Vec::with_capacity(3);
        if let Some(status) = self.thread_status.project_turn_terminal(thread_id) {
            notifications.push(status.into());
        }
        if let Some(usage_notification) = self.project_token_usage_notification(event) {
            notifications.push(usage_notification.into());
        }
        notifications.push(turn_notification.into());
        EventProjection::Direct(notifications)
    }

    fn project_error(
        &mut self,
        event: &AgentEvent,
        forced_will_retry: Option<bool>,
    ) -> EventProjection {
        let Some(projected) = error::project(event, forced_will_retry) else {
            return EventProjection::Reject(projection_error(event));
        };
        if !projected.will_retry
            && !self
                .terminal_error_turn_ids
                .insert(projected.turn_id.clone())
        {
            return EventProjection::Direct(Vec::new());
        }
        EventProjection::Direct(vec![projected.notification.into()])
    }

    fn project_turn_failed(&mut self, event: &AgentEvent) -> EventProjection {
        let Some(turn_id) = required_event_id(event.turn_id.as_deref()) else {
            return EventProjection::Reject(projection_error(event));
        };
        let completion = self.project_turn_completed_with_usage(event, v2::TurnStatus::Failed);
        let EventProjection::Direct(mut notifications) = completion else {
            return completion;
        };
        if self.terminal_error_turn_ids.remove(&turn_id) {
            return EventProjection::Direct(notifications);
        }
        let Some(projected) = error::project(event, Some(false)) else {
            return EventProjection::Reject(projection_error(event));
        };
        notifications.insert(0, projected.notification.into());
        EventProjection::Direct(notifications)
    }

    fn project_item(&mut self, event: &AgentEvent, completed: bool) -> Option<ServerNotification> {
        let thread_id = required_event_id(event.thread_id.as_deref())?;
        let turn_id = required_event_id(event.turn_id.as_deref())?;
        let item = match project_event(event)? {
            ProjectedEvent::Item(item) => item,
            _ => return None,
        };
        if let v2::ThreadItem::Plan { id, .. } = &item {
            if completed {
                self.completed_plan_item_ids.insert(id.clone());
            } else {
                self.started_plan_item_ids.insert(id.clone());
            }
        }
        if let v2::ThreadItem::CommandExecution { id, .. } = &item {
            if completed {
                self.completed_command_item_ids.insert(id.clone());
            } else {
                self.started_command_item_ids.insert(id.clone());
            }
        }
        if let v2::ThreadItem::McpToolCall { id, .. } = &item {
            if completed {
                self.completed_mcp_item_ids.insert(id.clone());
            } else {
                self.started_mcp_item_ids.insert(id.clone());
            }
        }
        let timestamp_ms = timestamp_millis(&event.timestamp)?;
        if completed {
            return Some(ServerNotification::ItemCompleted(
                v2::ItemCompletedNotification {
                    item,
                    thread_id,
                    turn_id,
                    completed_at_ms: timestamp_ms,
                },
            ));
        }
        Some(ServerNotification::ItemStarted(
            v2::ItemStartedNotification {
                item,
                thread_id,
                turn_id,
                started_at_ms: timestamp_ms,
            },
        ))
    }

    fn project_token_usage(&self, event: &AgentEvent) -> EventProjection {
        EventProjection::Direct(
            self.project_token_usage_notification(event)
                .into_iter()
                .map(Into::into)
                .collect(),
        )
    }

    fn project_token_usage_notification(&self, event: &AgentEvent) -> Option<ServerNotification> {
        let thread_id = required_event_id(event.thread_id.as_deref())?;
        let turn_id = required_event_id(event.turn_id.as_deref())?;
        let usage = event.payload.get("usage")?;
        let total = usage
            .get("total_token_usage")
            .and_then(project_token_usage_breakdown)?;
        let last = usage
            .get("last_token_usage")
            .and_then(project_token_usage_breakdown)?;
        let model_context_window = usage.get("model_context_window").and_then(Value::as_i64);

        Some(ServerNotification::ThreadTokenUsageUpdated(
            v2::ThreadTokenUsageUpdatedNotification {
                thread_id,
                turn_id,
                token_usage: v2::ThreadTokenUsage {
                    total,
                    last,
                    model_context_window,
                },
            },
        ))
    }

    fn project_model_safety_buffering(&self, event: &AgentEvent) -> Option<ServerNotification> {
        let thread_id = required_event_id(event.thread_id.as_deref())?;
        let turn_id = required_event_id(event.turn_id.as_deref())?;
        let model = payload_string(&event.payload, &["model"])?;
        let use_cases = payload_string_array(&event.payload, "useCases")?;
        let reasons = payload_string_array(&event.payload, "reasons")?;
        let show_buffering_ui = event.payload.get("showBufferingUi")?.as_bool()?;
        let faster_model = match event.payload.get("retryModel") {
            None | Some(Value::Null) => None,
            Some(value) => Some(
                value
                    .as_str()
                    .map(str::trim)
                    .filter(|value| !value.is_empty())?
                    .to_string(),
            ),
        };

        Some(ServerNotification::ModelSafetyBufferingUpdated(
            v2::ModelSafetyBufferingUpdatedNotification {
                thread_id,
                turn_id,
                model,
                use_cases,
                reasons,
                show_buffering_ui,
                faster_model,
            },
        ))
    }

    fn project_model_verification(&mut self, event: &AgentEvent) -> EventProjection {
        let Some(thread_id) = required_event_id(event.thread_id.as_deref()) else {
            return EventProjection::Reject(projection_error(event));
        };
        let Some(turn_id) = required_event_id(event.turn_id.as_deref()) else {
            return EventProjection::Reject(projection_error(event));
        };
        let Some(values) = event.payload.get("verifications").and_then(Value::as_array) else {
            return EventProjection::Reject(projection_error(event));
        };
        let verifications = values
            .iter()
            .map(|value| match value.as_str() {
                Some("trusted_access_for_cyber") => {
                    Some(v2::ModelVerification::TrustedAccessForCyber)
                }
                _ => None,
            })
            .collect::<Option<Vec<_>>>();
        let Some(verifications) = verifications.filter(|values| !values.is_empty()) else {
            return EventProjection::Reject(projection_error(event));
        };
        if !self.model_verification_turn_ids.insert(turn_id.clone()) {
            return EventProjection::Direct(Vec::new());
        }
        EventProjection::Direct(vec![ServerNotification::ModelVerification(
            v2::ModelVerificationNotification {
                thread_id,
                turn_id,
                verifications,
            },
        )
        .into()])
    }

    fn project_turn_moderation_metadata(&self, event: &AgentEvent) -> EventProjection {
        let Some(thread_id) = required_event_id(event.thread_id.as_deref()) else {
            return EventProjection::Reject(projection_error(event));
        };
        let Some(turn_id) = required_event_id(event.turn_id.as_deref()) else {
            return EventProjection::Reject(projection_error(event));
        };
        let Some(metadata) = event.payload.get("metadata").cloned() else {
            return EventProjection::Reject(projection_error(event));
        };
        EventProjection::Direct(vec![ServerNotification::TurnModerationMetadata(
            v2::TurnModerationMetadataNotification {
                thread_id,
                turn_id,
                metadata,
            },
        )
        .into()])
    }

    fn project_model_rerouted(&mut self, event: &AgentEvent) -> EventProjection {
        let Some(thread_id) = required_event_id(event.thread_id.as_deref()) else {
            return EventProjection::Reject(projection_error(event));
        };
        let Some(turn_id) = required_event_id(event.turn_id.as_deref()) else {
            return EventProjection::Reject(projection_error(event));
        };
        let Some(from_model) = payload_string(&event.payload, &["from_model"]) else {
            return EventProjection::Reject(projection_error(event));
        };
        let Some(to_model) = payload_string(&event.payload, &["to_model"]) else {
            return EventProjection::Reject(projection_error(event));
        };
        let Some(reason) = event.payload.get("reason").and_then(Value::as_str) else {
            return EventProjection::Reject(projection_error(event));
        };
        let reason = match reason {
            "high_risk_cyber_activity" => v2::ModelRerouteReason::HighRiskCyberActivity,
            _ => return EventProjection::Reject(projection_error(event)),
        };
        if !self.model_reroute_turn_ids.insert(turn_id.clone()) {
            return EventProjection::Direct(Vec::new());
        }
        EventProjection::Direct(vec![ServerNotification::ModelRerouted(
            v2::ModelReroutedNotification {
                thread_id,
                turn_id,
                from_model,
                to_model,
                reason,
            },
        )
        .into()])
    }

    fn project_agent_message_delta(&self, event: &AgentEvent) -> Option<ServerNotification> {
        let thread_id = required_event_id(event.thread_id.as_deref())?;
        let turn_id = required_event_id(event.turn_id.as_deref())?;
        let projected_item_id = match project_event(event) {
            Some(ProjectedEvent::Item(v2::ThreadItem::AgentMessage { id, .. })) => Some(id),
            Some(ProjectedEvent::Item(_)) => return None,
            _ => None,
        };
        let payload_item_id = payload_string(
            &event.payload,
            &["itemId", "item_id", "messageId", "message_id", "id"],
        );
        if let (Some(projected), Some(payload)) =
            (projected_item_id.as_ref(), payload_item_id.as_ref())
        {
            let canonical_payload = agent_protocol::ItemId::new(payload.clone());
            if projected != canonical_payload.as_str() {
                return None;
            }
        }
        let item_id = projected_item_id.or(payload_item_id)?;
        let delta = text_from_payload(&event.payload)?;
        Some(ServerNotification::AgentMessageDelta(
            v2::AgentMessageDeltaNotification {
                thread_id,
                turn_id,
                item_id,
                delta,
            },
        ))
    }
}

pub(super) fn project_events(
    projector: &mut V2NotificationProjector,
    events: Vec<AgentEvent>,
) -> Result<Vec<JsonRpcNotification>, JsonRpcError> {
    let mut notifications = Vec::new();
    for event in events {
        notifications.extend(projector.project(event)?);
    }
    Ok(notifications)
}

fn project_turn(
    event: &AgentEvent,
    expected_status: v2::TurnStatus,
) -> Option<(String, String, v2::Turn)> {
    let thread_id = required_event_id(event.thread_id.as_deref())?;
    let turn_id = required_event_id(event.turn_id.as_deref())?;
    let turn = match project_event(event)? {
        ProjectedEvent::Turn(turn) => turn,
        _ => return None,
    };
    (turn.id == turn_id && turn.status == expected_status).then_some((thread_id, turn_id, turn))
}

fn required_event_id(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn payload_string(payload: &Value, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|key| {
        payload
            .get(key)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
    })
}

fn payload_i64(payload: &Value, key: &str) -> Option<i64> {
    payload.get(key).and_then(Value::as_i64)
}

fn payload_string_array(payload: &Value, key: &str) -> Option<Vec<String>> {
    payload
        .get(key)?
        .as_array()?
        .iter()
        .map(|value| value.as_str().map(str::to_string))
        .collect()
}

fn is_allowed_raw_side_channel_type(event_type: &str) -> bool {
    matches!(
        event_type,
        "message.created"
            | "provider.request.started"
            | "provider.first_event.received"
            | "provider.first_text_delta.received"
            | "provider.failed"
            | "provider.canceled"
            | "image_task.created"
            | "image_task.create_failed"
            | "image_task.parameters.required"
            | "image_task_parameters_required"
            | "image_task.presentation.generated"
            | "runtime.status"
    )
}

fn text_from_payload(payload: &Value) -> Option<String> {
    if let Some(text) = payload.as_str().filter(|text| !text.is_empty()) {
        return Some(text.to_string());
    }
    if let Some(text) = [
        "text",
        "delta",
        "content",
        "message",
        "outputText",
        "output_text",
    ]
    .into_iter()
    .find_map(|key| {
        payload
            .get(key)
            .and_then(Value::as_str)
            .filter(|text| !text.is_empty())
            .map(str::to_string)
    }) {
        return Some(text);
    }
    for key in ["deltas", "messages", "items", "parts", "content"] {
        let Some(values) = payload.get(key).and_then(Value::as_array) else {
            continue;
        };
        let text = values
            .iter()
            .filter_map(text_from_payload)
            .collect::<String>();
        if !text.is_empty() {
            return Some(text);
        }
    }
    None
}

fn project_token_usage_breakdown(value: &Value) -> Option<v2::TokenUsageBreakdown> {
    Some(v2::TokenUsageBreakdown {
        total_tokens: value.get("total_tokens")?.as_i64()?,
        input_tokens: value.get("input_tokens")?.as_i64()?,
        cached_input_tokens: value.get("cached_input_tokens")?.as_i64()?,
        cache_write_input_tokens: value
            .get("cache_write_input_tokens")
            .and_then(Value::as_i64)
            .unwrap_or_default(),
        output_tokens: value.get("output_tokens")?.as_i64()?,
        reasoning_output_tokens: value.get("reasoning_output_tokens")?.as_i64()?,
    })
}

fn timestamp_millis(value: &str) -> Option<i64> {
    chrono::DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|value| value.timestamp_millis())
}

fn projection_error(event: &AgentEvent) -> JsonRpcError {
    JsonRpcError::new(
        error_codes::RUNTIME_ERROR,
        format!(
            "recognized lifecycle event {} ({}) has no valid v2 projection",
            event.event_id, event.event_type
        ),
    )
}

#[cfg(test)]
#[path = "v2_notifications/tests.rs"]
mod tests;
