//! Scope output to one canonical Turn; completed snapshots repair missed deltas.

use std::io::{self, Write};
use std::path::{Path, PathBuf};

use agent_protocol::response_item::MessagePhase;
use app_server_protocol::protocol::v2::{ServerNotification, ThreadItem, TurnStatus};

use super::event_processor_with_human_output::EventProcessorWithHumanOutput;
use super::event_processor_with_jsonl_output::EventProcessorWithJsonOutput;

#[derive(Debug, PartialEq, Eq)]
pub(super) struct ExecResult {
    pub(super) status: TurnStatus,
    pub(super) output: String,
}

struct AgentText {
    id: String,
    text: String,
    phase: Option<MessagePhase>,
    completed: bool,
}

pub(super) struct EventProcessor {
    thread_id: String,
    turn_id: String,
    messages: Vec<AgentText>,
    plan: Option<String>,
    output: OutputProcessor,
    last_message_file: Option<PathBuf>,
}

enum OutputProcessor {
    Human(EventProcessorWithHumanOutput),
    Json(EventProcessorWithJsonOutput),
}

impl EventProcessor {
    pub(super) fn new(
        thread_id: String,
        turn_id: String,
        human: EventProcessorWithHumanOutput,
    ) -> Self {
        Self {
            thread_id,
            turn_id,
            messages: Vec::new(),
            plan: None,
            output: OutputProcessor::Human(human),
            last_message_file: None,
        }
    }

    pub(super) fn new_json(thread_id: String, turn_id: String) -> Self {
        Self {
            thread_id,
            turn_id,
            messages: Vec::new(),
            plan: None,
            output: OutputProcessor::Json(EventProcessorWithJsonOutput::default()),
            last_message_file: None,
        }
    }

    pub(super) fn set_last_message_file(&mut self, file: Option<PathBuf>) {
        self.last_message_file = file;
    }

    pub(super) fn start_turn(&mut self, output: &mut impl Write) -> io::Result<()> {
        match &mut self.output {
            OutputProcessor::Json(json) => json.start_turn(output),
            OutputProcessor::Human(_) => Ok(()),
        }
    }

    pub(super) fn process(
        &mut self,
        notification: ServerNotification,
        output: &mut impl Write,
    ) -> io::Result<Option<ExecResult>> {
        if !self.accepts(&notification) {
            return Ok(None);
        }
        match &mut self.output {
            OutputProcessor::Human(human) => {
                human.process_server_notification(&notification, output)?
            }
            OutputProcessor::Json(json) => {
                json.process_server_notification(&notification, output)?
            }
        }
        match notification {
            ServerNotification::AgentMessageDelta(params) => {
                if let Some(message) = self
                    .messages
                    .iter_mut()
                    .find(|message| message.id == params.item_id)
                {
                    if !message.completed {
                        message.text.push_str(&params.delta);
                    }
                } else {
                    self.messages.push(AgentText {
                        id: params.item_id,
                        text: params.delta,
                        phase: None,
                        completed: false,
                    });
                }
            }
            ServerNotification::ItemStarted(params) => {
                self.record_item(&params.item, false);
            }
            ServerNotification::ItemCompleted(params) => {
                self.record_item(&params.item, true);
            }
            ServerNotification::TurnCompleted(params) => {
                if params.turn.status == TurnStatus::InProgress {
                    return Ok(None);
                }
                for item in &params.turn.items {
                    self.record_item(item, true);
                    match &mut self.output {
                        OutputProcessor::Human(human)
                            if params.turn.status == TurnStatus::Completed
                                || !matches!(item, ThreadItem::AgentMessage { .. }) =>
                        {
                            human.render_item_completed(item, output)?;
                        }
                        _ => {}
                    }
                }
                let final_message = if params.turn.status == TurnStatus::Completed {
                    final_answer_from_items(&params.turn.items)
                        .unwrap_or_else(|| self.final_answer())
                } else {
                    String::new()
                };
                if let Some(path) = self
                    .last_message_file
                    .as_deref()
                    .filter(|_| params.turn.status == TurnStatus::Completed)
                {
                    handle_last_message(&final_message, path)?;
                }
                if let OutputProcessor::Human(human) = &mut self.output {
                    human.print_final_output(&params.turn, &final_message, output)?;
                }
                return Ok(Some(ExecResult {
                    status: params.turn.status,
                    output: final_message,
                }));
            }
            _ => {}
        }
        Ok(None)
    }

    fn matches(&self, thread_id: &str, turn_id: &str) -> bool {
        self.thread_id == thread_id && self.turn_id == turn_id
    }

    fn accepts(&self, notification: &ServerNotification) -> bool {
        match notification {
            ServerNotification::AgentMessageDelta(params) => {
                self.matches(&params.thread_id, &params.turn_id)
            }
            ServerNotification::ItemStarted(params) => {
                self.matches(&params.thread_id, &params.turn_id)
            }
            ServerNotification::ItemCompleted(params) => {
                self.matches(&params.thread_id, &params.turn_id)
            }
            ServerNotification::TurnCompleted(params) => {
                self.matches(&params.thread_id, &params.turn.id)
            }
            ServerNotification::TurnStarted(params) => {
                self.matches(&params.thread_id, &params.turn.id)
            }
            ServerNotification::Error(params) => self.matches(&params.thread_id, &params.turn_id),
            ServerNotification::TurnPlanUpdated(params) => {
                self.matches(&params.thread_id, &params.turn_id)
            }
            ServerNotification::TurnDiffUpdated(params) => {
                self.matches(&params.thread_id, &params.turn_id)
            }
            ServerNotification::ThreadTokenUsageUpdated(params) => {
                self.matches(&params.thread_id, &params.turn_id)
            }
            ServerNotification::ModelRerouted(params) => {
                self.matches(&params.thread_id, &params.turn_id)
            }
            ServerNotification::HookStarted(params) => {
                self.thread_id == params.thread_id
                    && params.turn_id.as_ref().is_none_or(|id| id == &self.turn_id)
            }
            ServerNotification::HookCompleted(params) => {
                self.thread_id == params.thread_id
                    && params.turn_id.as_ref().is_none_or(|id| id == &self.turn_id)
            }
            ServerNotification::Warning(params) => params
                .thread_id
                .as_ref()
                .is_none_or(|id| id == &self.thread_id),
            ServerNotification::GuardianWarning(params) => params.thread_id == self.thread_id,
            ServerNotification::ConfigWarning(_) => true,
            _ => false,
        }
    }

    fn record_item(&mut self, item: &ThreadItem, completed: bool) {
        match item {
            ThreadItem::AgentMessage {
                id, text, phase, ..
            } => {
                if let Some(message) = self.messages.iter_mut().find(|message| &message.id == id) {
                    if message.completed && !completed {
                        return;
                    }
                    if completed || !text.is_empty() {
                        message.text = text.clone();
                    }
                    message.phase = phase.clone();
                    message.completed = completed;
                } else {
                    self.messages.push(AgentText {
                        id: id.clone(),
                        text: text.clone(),
                        phase: phase.clone(),
                        completed,
                    });
                }
            }
            ThreadItem::Plan { text, .. } if completed => self.plan = Some(text.clone()),
            _ => {}
        }
    }

    fn final_answer(&self) -> String {
        self.messages
            .iter()
            .rev()
            .find(|message| {
                message.phase != Some(MessagePhase::Commentary) && !message.text.is_empty()
            })
            .map(|message| message.text.clone())
            .or_else(|| self.plan.clone())
            .unwrap_or_default()
    }
}

fn handle_last_message(contents: &str, output_file: &Path) -> io::Result<()> {
    std::fs::write(output_file, contents).map_err(|error| {
        io::Error::new(
            error.kind(),
            format!(
                "failed to write last message file {}: {error}",
                output_file.display()
            ),
        )
    })
}

fn final_answer_from_items(items: &[ThreadItem]) -> Option<String> {
    items
        .iter()
        .rev()
        .find_map(|item| match item {
            ThreadItem::AgentMessage { text, phase, .. }
                if phase != &Some(MessagePhase::Commentary) && !text.is_empty() =>
            {
                Some(text.clone())
            }
            _ => None,
        })
        .or_else(|| {
            items.iter().rev().find_map(|item| match item {
                ThreadItem::Plan { text, .. } => Some(text.clone()),
                _ => None,
            })
        })
}

#[cfg(test)]
#[path = "event_processor_tests.rs"]
mod tests;
