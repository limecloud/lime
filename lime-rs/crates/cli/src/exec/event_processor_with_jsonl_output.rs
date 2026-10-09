//! Stateful Codex JSONL presentation; runtime authority remains in App Server.

mod items;

use std::collections::HashMap;
use std::io::{self, Write};

use app_server_protocol::protocol::v2::{self as v2, ServerNotification};

use super::exec_events::*;
use items::map_item as lower_item;

struct TrackedItem {
    item: ThreadItem,
    completed: bool,
}

struct RunningTodoList {
    item_id: String,
    items: Vec<TodoItem>,
}

#[derive(Default)]
pub(super) struct EventProcessorWithJsonOutput {
    next_item_id: u64,
    items: HashMap<String, TrackedItem>,
    running_todo_list: Option<RunningTodoList>,
    last_total_token_usage: Option<v2::ThreadTokenUsage>,
    last_critical_error: Option<ThreadErrorEvent>,
    turn_started: bool,
    finished: bool,
}

impl EventProcessorWithJsonOutput {
    pub(super) fn thread_started_event(thread_id: String) -> ThreadEvent {
        ThreadEvent::ThreadStarted(ThreadStartedEvent { thread_id })
    }

    pub(super) fn start_turn(&mut self, output: &mut impl Write) -> io::Result<()> {
        if !self.turn_started {
            emit(&ThreadEvent::TurnStarted(TurnStartedEvent {}), output)?;
            self.turn_started = true;
        }
        Ok(())
    }

    fn next_item_id(&mut self) -> String {
        let id = format!("item_{}", self.next_item_id);
        self.next_item_id += 1;
        id
    }

    fn map_item(&mut self, item: &v2::ThreadItem, completed: bool) -> Option<ThreadEvent> {
        if !completed
            && matches!(
                item,
                v2::ThreadItem::AgentMessage { .. }
                    | v2::ThreadItem::Reasoning { .. }
                    | v2::ThreadItem::Plan { .. }
            )
        {
            return None;
        }
        let (raw_id, details) = lower_item(item)?;
        if let Some(tracked) = self.items.get_mut(raw_id) {
            if !completed || (tracked.completed && tracked.item.details == details) {
                return None;
            }
            tracked.item.details = details;
            let updated = tracked.completed;
            tracked.completed = true;
            return Some(if updated {
                ThreadEvent::ItemUpdated(ItemUpdatedEvent {
                    item: tracked.item.clone(),
                })
            } else {
                ThreadEvent::ItemCompleted(ItemCompletedEvent {
                    item: tracked.item.clone(),
                })
            });
        }
        let item = ThreadItem {
            id: self.next_item_id(),
            details,
        };
        self.items.insert(
            raw_id.to_owned(),
            TrackedItem {
                item: item.clone(),
                completed,
            },
        );
        Some(if completed {
            ThreadEvent::ItemCompleted(ItemCompletedEvent { item })
        } else {
            ThreadEvent::ItemStarted(ItemStartedEvent { item })
        })
    }

    fn warning_event(&mut self, message: String) -> ThreadEvent {
        ThreadEvent::ItemCompleted(ItemCompletedEvent {
            item: ThreadItem {
                id: self.next_item_id(),
                details: ThreadItemDetails::Error(ErrorItem { message }),
            },
        })
    }

    pub(super) fn process_server_notification(
        &mut self,
        notification: &ServerNotification,
        output: &mut impl Write,
    ) -> io::Result<()> {
        if self.finished {
            return Ok(());
        }
        for event in self.collect_thread_events(notification) {
            emit(&event, output)?;
        }
        Ok(())
    }

    fn collect_thread_events(&mut self, notification: &ServerNotification) -> Vec<ThreadEvent> {
        let mut events = Vec::new();
        match notification {
            ServerNotification::ItemStarted(params) => {
                events.extend(self.map_item(&params.item, false))
            }
            ServerNotification::ItemCompleted(params) => {
                events.extend(self.map_item(&params.item, true))
            }
            ServerNotification::ConfigWarning(params) => events
                .push(self.warning_event(with_details(&params.summary, params.details.as_deref()))),
            ServerNotification::Warning(params) => {
                events.push(self.warning_event(params.message.clone()))
            }
            ServerNotification::GuardianWarning(params) => {
                events.push(self.warning_event(params.message.clone()))
            }
            ServerNotification::Error(params) => {
                let error = ThreadErrorEvent {
                    message: with_details(
                        &params.error.message,
                        params.error.additional_details.as_deref(),
                    ),
                };
                self.last_critical_error = Some(error.clone());
                events.push(ThreadEvent::Error(error));
            }
            ServerNotification::ModelRerouted(params) => events.push(self.warning_event(format!(
                "model rerouted: {} -> {} ({:?})",
                params.from_model, params.to_model, params.reason
            ))),
            ServerNotification::ThreadTokenUsageUpdated(params) => {
                self.last_total_token_usage = Some(params.token_usage.clone())
            }
            ServerNotification::TurnStarted(_) if !self.turn_started => {
                self.turn_started = true;
                events.push(ThreadEvent::TurnStarted(TurnStartedEvent {}));
            }
            ServerNotification::TurnPlanUpdated(params) => {
                let items: Vec<_> = params
                    .plan
                    .iter()
                    .map(|step| TodoItem {
                        text: step.step.clone(),
                        completed: step.status == v2::TurnPlanStepStatus::Completed,
                    })
                    .collect();
                if let Some(running) = &mut self.running_todo_list {
                    if running.items == items {
                        return events;
                    }
                    running.items = items.clone();
                    events.push(ThreadEvent::ItemUpdated(ItemUpdatedEvent {
                        item: ThreadItem {
                            id: running.item_id.clone(),
                            details: ThreadItemDetails::TodoList(TodoListItem { items }),
                        },
                    }));
                } else {
                    let item_id = self.next_item_id();
                    self.running_todo_list = Some(RunningTodoList {
                        item_id: item_id.clone(),
                        items: items.clone(),
                    });
                    events.push(ThreadEvent::ItemStarted(ItemStartedEvent {
                        item: ThreadItem {
                            id: item_id,
                            details: ThreadItemDetails::TodoList(TodoListItem { items }),
                        },
                    }));
                }
            }
            ServerNotification::TurnCompleted(params)
                if params.turn.status != v2::TurnStatus::InProgress =>
            {
                if let Some(running) = self.running_todo_list.take() {
                    events.push(ThreadEvent::ItemCompleted(ItemCompletedEvent {
                        item: ThreadItem {
                            id: running.item_id,
                            details: ThreadItemDetails::TodoList(TodoListItem {
                                items: running.items,
                            }),
                        },
                    }));
                }
                for item in &params.turn.items {
                    if params.turn.status != v2::TurnStatus::Completed
                        && matches!(
                            item,
                            v2::ThreadItem::AgentMessage { .. } | v2::ThreadItem::Plan { .. }
                        )
                    {
                        continue;
                    }
                    events.extend(self.map_item(item, true));
                }
                match params.turn.status {
                    v2::TurnStatus::Completed => {
                        events.push(ThreadEvent::TurnCompleted(TurnCompletedEvent {
                            usage: self.usage_from_last_total(),
                        }))
                    }
                    v2::TurnStatus::Failed => {
                        let error = params
                            .turn
                            .error
                            .as_ref()
                            .map(|error| ThreadErrorEvent {
                                message: with_details(
                                    &error.message,
                                    error.additional_details.as_deref(),
                                ),
                            })
                            .or_else(|| self.last_critical_error.clone())
                            .unwrap_or_else(|| ThreadErrorEvent {
                                message: "turn failed".into(),
                            });
                        events.push(ThreadEvent::TurnFailed(TurnFailedEvent { error }));
                    }
                    v2::TurnStatus::Interrupted => {}
                    v2::TurnStatus::InProgress => unreachable!(),
                }
                self.finished = true;
            }
            _ => {}
        }
        events
    }

    fn usage_from_last_total(&self) -> Usage {
        self.last_total_token_usage
            .as_ref()
            .map(|usage| Usage {
                input_tokens: usage.total.input_tokens,
                cached_input_tokens: usage.total.cached_input_tokens,
                cache_write_input_tokens: usage.total.cache_write_input_tokens,
                output_tokens: usage.total.output_tokens,
                reasoning_output_tokens: usage.total.reasoning_output_tokens,
            })
            .unwrap_or_default()
    }
}

fn with_details(message: &str, details: Option<&str>) -> String {
    match details.filter(|details| !details.is_empty()) {
        Some(details) => format!("{message} ({details})"),
        None => message.to_owned(),
    }
}

pub(super) fn emit(event: &ThreadEvent, output: &mut impl Write) -> io::Result<()> {
    serde_json::to_writer(&mut *output, event).map_err(io::Error::from)?;
    output.write_all(b"\n")?;
    output.flush()
}

#[cfg(test)]
#[path = "event_processor_with_jsonl_output_tests.rs"]
mod tests;
