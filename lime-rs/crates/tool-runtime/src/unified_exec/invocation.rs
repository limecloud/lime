use crate::tool_lifecycle::CommandStartEvent;
use serde::Serialize;
use serde_json::{Value, json};
use std::collections::HashMap;
use std::path::PathBuf;

#[derive(Debug, Clone)]
pub(super) struct Invocation {
    pub(super) command: String,
    pub(super) argv: Vec<String>,
    pub(super) cwd: PathBuf,
    pub(super) terminal_interactions: Vec<TerminalInteraction>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct TerminalInteraction {
    process_id: String,
    stdin: String,
}

impl Invocation {
    pub(super) fn metadata(&self) -> HashMap<String, Value> {
        HashMap::from([
            ("command".to_owned(), json!(self.command)),
            ("commandArgv".to_owned(), json!(self.argv)),
            ("cwd".to_owned(), json!(self.cwd.to_string_lossy())),
            (
                "terminalInteractions".to_owned(),
                json!(self.terminal_interactions),
            ),
            (
                "commandExecutionSource".to_owned(),
                json!("unifiedExecStartup"),
            ),
        ])
    }

    pub(super) fn record_interaction(&mut self, process_id: &str, summary: String) {
        self.terminal_interactions.push(TerminalInteraction {
            process_id: process_id.to_owned(),
            stdin: summary,
        });
        if self.terminal_interactions.len() > 20 {
            self.terminal_interactions
                .drain(..self.terminal_interactions.len() - 20);
        }
    }

    pub(super) fn start_event(
        &self,
        turn_id: &str,
        call_id: &str,
        process_id: &str,
    ) -> CommandStartEvent {
        CommandStartEvent {
            turn_id: turn_id.to_owned(),
            call_id: call_id.to_owned(),
            command: self.command.clone(),
            argv: self.argv.clone(),
            cwd: self.cwd.clone(),
            process_id: process_id.to_owned(),
        }
    }
}
