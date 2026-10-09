//! Human-readable Codex output over canonical App Server notifications.

use std::collections::HashSet;
use std::io::{self, Write};

use anyhow::{Context, Result};
use app_server_protocol::protocol::v2::{
    CommandExecutionStatus, McpToolCallStatus, PatchApplyStatus, ServerNotification, ThreadItem,
    ThreadTokenUsage, Turn, TurnPlanStepStatus, TurnStatus,
};
use crossterm::style::{Attribute, Color, ContentStyle, Stylize};
use serde::Deserialize;
use serde_json::Value;

use super::locale::{Label, Locale};

#[derive(Debug, Clone, Copy, Default, Deserialize)]
pub(super) struct ReasoningPolicy {
    #[serde(default)]
    hide_agent_reasoning: bool,
    #[serde(default)]
    show_raw_agent_reasoning: bool,
}

impl ReasoningPolicy {
    pub(super) fn from_config(config: Value) -> Result<Self> {
        serde_json::from_value(config)
            .context("App Server config/read returned invalid exec reasoning settings")
    }
}

pub(super) struct EventProcessorWithHumanOutput {
    with_ansi: bool,
    policy: ReasoningPolicy,
    locale: Locale,
    started_items: HashSet<String>,
    completed_items: HashSet<String>,
    final_message_rendered: Option<String>,
    last_total_token_usage: Option<ThreadTokenUsage>,
}

impl EventProcessorWithHumanOutput {
    pub(super) fn create_with_ansi(
        with_ansi: bool,
        policy: ReasoningPolicy,
        locale: Locale,
    ) -> Self {
        Self {
            with_ansi,
            policy,
            locale,
            started_items: HashSet::new(),
            completed_items: HashSet::new(),
            final_message_rendered: None,
            last_total_token_usage: None,
        }
    }

    pub(super) fn process_server_notification(
        &mut self,
        notification: &ServerNotification,
        stderr: &mut impl Write,
    ) -> io::Result<()> {
        match notification {
            ServerNotification::ItemStarted(params) => {
                self.render_item_started(&params.item, stderr)?
            }
            ServerNotification::ItemCompleted(params) => {
                self.render_item_completed(&params.item, stderr)?
            }
            ServerNotification::ConfigWarning(params) => {
                let details = params
                    .details
                    .as_ref()
                    .map(|text| format!(" ({text})"))
                    .unwrap_or_default();
                writeln!(
                    stderr,
                    "{} {}{details}",
                    self.label(Label::Warning, Color::DarkYellow),
                    params.summary
                )?;
            }
            ServerNotification::Warning(params) => self.process_warning(&params.message, stderr)?,
            ServerNotification::GuardianWarning(params) => {
                self.process_warning(&params.message, stderr)?
            }
            ServerNotification::Error(params) => {
                self.render_error(&params.error.message, stderr)?
            }
            ServerNotification::ThreadTokenUsageUpdated(params) => {
                self.last_total_token_usage = Some(params.token_usage.clone());
            }
            ServerNotification::TurnPlanUpdated(params) => {
                if let Some(explanation) = &params.explanation {
                    writeln!(
                        stderr,
                        "{}",
                        self.styled(
                            explanation,
                            ContentStyle::new().attribute(Attribute::Italic)
                        )
                    )?;
                }
                for step in &params.plan {
                    let (marker, style) = match step.status {
                        TurnPlanStepStatus::Completed => {
                            ("✓", ContentStyle::new().with(Color::DarkGreen))
                        }
                        TurnPlanStepStatus::InProgress => {
                            ("→", ContentStyle::new().with(Color::DarkCyan))
                        }
                        TurnPlanStepStatus::Pending => {
                            ("•", ContentStyle::new().attribute(Attribute::Dim))
                        }
                    };
                    let text = if step.status == TurnPlanStepStatus::Pending {
                        self.styled(&step.step, style)
                    } else {
                        step.step.clone()
                    };
                    writeln!(stderr, "  {} {text}", self.styled(marker, style))?;
                }
            }
            ServerNotification::TurnDiffUpdated(params) if !params.diff.trim().is_empty() => {
                writeln!(stderr, "{}", params.diff)?;
            }
            ServerNotification::ModelRerouted(params) => {
                writeln!(
                    stderr,
                    "{} {} -> {}",
                    self.label(Label::ModelRerouted, Color::DarkYellow),
                    params.from_model,
                    params.to_model
                )?;
            }
            ServerNotification::HookStarted(params) => {
                writeln!(stderr, "hook: {:?}", params.run.event_name)?
            }
            ServerNotification::HookCompleted(params) => writeln!(
                stderr,
                "hook: {:?} {:?}",
                params.run.event_name, params.run.status
            )?,
            _ => {}
        }
        Ok(())
    }

    fn render_item_started(
        &mut self,
        item: &ThreadItem,
        stderr: &mut impl Write,
    ) -> io::Result<()> {
        let (id, text) = match item {
            ThreadItem::CommandExecution {
                id, command, cwd, ..
            } => (
                id,
                format!(
                    "{}\n{}",
                    self.styled(
                        self.locale.label(Label::Exec),
                        ContentStyle::new()
                            .with(Color::DarkMagenta)
                            .attribute(Attribute::Italic)
                    ),
                    self.locale.command(&self.bold(command), cwd)
                ),
            ),
            ThreadItem::McpToolCall {
                id, server, tool, ..
            } => (
                id,
                format!(
                    "mcp: {} {}",
                    self.styled(
                        format!("{server}/{tool}"),
                        ContentStyle::new().with(Color::DarkCyan)
                    ),
                    self.dim(self.locale.label(Label::Started))
                ),
            ),
            ThreadItem::WebSearch(item) => (
                &item.id,
                format!(
                    "{} {}",
                    self.bold(self.locale.label(Label::WebSearch)),
                    item.query.as_deref().unwrap_or_default()
                ),
            ),
            ThreadItem::FileChange { id, .. } => {
                (id, self.bold(self.locale.label(Label::ApplyPatch)))
            }
            ThreadItem::CollabAgentToolCall { id, tool, .. } => (
                id,
                format!("{} {tool:?}", self.bold(self.locale.label(Label::Collab))),
            ),
            _ => return Ok(()),
        };
        if !self.started_items.contains(id) && !self.completed_items.contains(id) {
            writeln!(stderr, "{text}")?;
            self.started_items.insert(id.clone());
        }
        Ok(())
    }

    pub(super) fn render_item_completed(
        &mut self,
        item: &ThreadItem,
        stderr: &mut impl Write,
    ) -> io::Result<()> {
        let id = match item {
            ThreadItem::AgentMessage { id, text, .. } => {
                if self.completed_items.contains(id) || text.trim().is_empty() {
                    return Ok(());
                }
                self.render_agent_message(text, stderr)?;
                id
            }
            ThreadItem::Reasoning {
                id,
                summary,
                content,
                ..
            } => {
                if self.policy.hide_agent_reasoning || self.completed_items.contains(id) {
                    return Ok(());
                }
                let entries = if self.policy.show_raw_agent_reasoning && !content.is_empty() {
                    content
                } else {
                    summary
                };
                let text = entries.join("\n");
                if text.trim().is_empty() {
                    return Ok(());
                }
                writeln!(stderr, "{}", self.dim(text))?;
                id
            }
            ThreadItem::CommandExecution {
                id,
                status,
                duration_ms,
                exit_code,
                aggregated_output,
                ..
            } => {
                if self.completed_items.contains(id) {
                    return Ok(());
                }
                self.render_item_started(item, stderr)?;
                let duration = duration_ms
                    .map(|ms| self.locale.duration(ms))
                    .unwrap_or_default();
                let (text, style) = match status {
                    CommandExecutionStatus::Completed => (
                        self.locale.label(Label::Succeeded).to_owned(),
                        ContentStyle::new().with(Color::DarkGreen),
                    ),
                    CommandExecutionStatus::Failed => (
                        format!(
                            "{} {}",
                            self.locale.label(Label::Exited),
                            exit_code.unwrap_or(1)
                        ),
                        ContentStyle::new().with(Color::DarkRed),
                    ),
                    CommandExecutionStatus::Declined => (
                        self.locale.label(Label::Declined).to_owned(),
                        ContentStyle::new().with(Color::DarkYellow),
                    ),
                    CommandExecutionStatus::InProgress => (
                        self.locale.label(Label::Running).to_owned(),
                        ContentStyle::new().attribute(Attribute::Dim),
                    ),
                };
                writeln!(
                    stderr,
                    "{}",
                    self.styled(format!(" {text}{duration}:"), style)
                )?;
                if let Some(output) = aggregated_output
                    .as_ref()
                    .filter(|text| !text.trim().is_empty())
                {
                    writeln!(stderr, "{output}")?;
                }
                id
            }
            ThreadItem::FileChange {
                id,
                status,
                changes,
                ..
            } => {
                if self.completed_items.contains(id) {
                    return Ok(());
                }
                self.render_item_started(item, stderr)?;
                let status = match status {
                    PatchApplyStatus::Completed => Label::Completed,
                    PatchApplyStatus::Failed => Label::Failed,
                    PatchApplyStatus::Declined => Label::Declined,
                    PatchApplyStatus::InProgress => Label::InProgress,
                };
                writeln!(
                    stderr,
                    "{} {}",
                    self.bold(self.locale.label(Label::Patch)),
                    self.locale.label(status)
                )?;
                for change in changes {
                    writeln!(stderr, "{}", self.dim(&change.path))?;
                }
                id
            }
            ThreadItem::McpToolCall {
                id,
                server,
                tool,
                status,
                error,
                ..
            } => {
                if self.completed_items.contains(id) {
                    return Ok(());
                }
                self.render_item_started(item, stderr)?;
                let (status, color) = match status {
                    McpToolCallStatus::Completed => (Label::Completed, Color::DarkGreen),
                    McpToolCallStatus::Failed => (Label::Failed, Color::DarkRed),
                    McpToolCallStatus::InProgress => (Label::InProgress, Color::Grey),
                };
                writeln!(
                    stderr,
                    "mcp: {} ({})",
                    self.styled(
                        format!("{server}/{tool}"),
                        ContentStyle::new().with(Color::DarkCyan)
                    ),
                    self.styled(self.locale.label(status), ContentStyle::new().with(color))
                )?;
                if let Some(error) = error {
                    writeln!(
                        stderr,
                        "{}",
                        self.styled(&error.message, ContentStyle::new().with(Color::DarkRed))
                    )?;
                }
                id
            }
            ThreadItem::WebSearch(item) => {
                if self.completed_items.contains(&item.id) {
                    return Ok(());
                }
                writeln!(
                    stderr,
                    "{} {}",
                    self.bold(self.locale.label(Label::WebSearch)),
                    item.query.as_deref().unwrap_or_default()
                )?;
                &item.id
            }
            ThreadItem::ContextCompaction { id, .. } => {
                if self.completed_items.contains(id) {
                    return Ok(());
                }
                writeln!(stderr, "{}", self.dim(self.locale.label(Label::Compacted)))?;
                id
            }
            _ => return Ok(()),
        };
        self.completed_items.insert(id.clone());
        Ok(())
    }

    pub(super) fn print_final_output(
        &mut self,
        turn: &Turn,
        final_message: &str,
        stderr: &mut impl Write,
    ) -> io::Result<()> {
        match turn.status {
            TurnStatus::Completed
                if !final_message.is_empty()
                    && self.final_message_rendered.as_deref() != Some(final_message) =>
            {
                self.render_agent_message(final_message, stderr)?
            }
            TurnStatus::Failed => {
                if let Some(error) = &turn.error {
                    self.render_error(&error.message, stderr)?;
                }
            }
            TurnStatus::Interrupted => writeln!(
                stderr,
                "{}",
                self.dim(self.locale.label(Label::Interrupted))
            )?,
            _ => {}
        }
        if let Some(usage) = &self.last_total_token_usage {
            writeln!(
                stderr,
                "{}\n{}",
                self.dim(self.locale.label(Label::TokensUsed)),
                format_with_separators(blended_total(usage))
            )?;
        }
        Ok(())
    }

    fn render_agent_message(&mut self, text: &str, stderr: &mut impl Write) -> io::Result<()> {
        writeln!(
            stderr,
            "{}\n{text}",
            self.styled(
                "lime",
                ContentStyle::new()
                    .with(Color::DarkMagenta)
                    .attribute(Attribute::Italic)
            )
        )?;
        self.final_message_rendered = Some(text.to_owned());
        Ok(())
    }

    fn process_warning(&self, message: &str, stderr: &mut impl Write) -> io::Result<()> {
        writeln!(
            stderr,
            "{} {message}",
            self.label(Label::Warning, Color::DarkYellow)
        )
    }

    fn render_error(&self, message: &str, stderr: &mut impl Write) -> io::Result<()> {
        writeln!(
            stderr,
            "{} {message}",
            self.label(Label::Error, Color::DarkRed)
        )
    }

    fn label(&self, label: Label, color: Color) -> String {
        self.styled(
            self.locale.label(label),
            ContentStyle::new().with(color).attribute(Attribute::Bold),
        )
    }
    fn dim(&self, text: impl AsRef<str>) -> String {
        self.styled(text, ContentStyle::new().attribute(Attribute::Dim))
    }
    fn bold(&self, text: impl AsRef<str>) -> String {
        self.styled(text, ContentStyle::new().attribute(Attribute::Bold))
    }
    fn styled(&self, text: impl AsRef<str>, style: ContentStyle) -> String {
        if self.with_ansi {
            style.apply(text.as_ref()).to_string()
        } else {
            text.as_ref().to_owned()
        }
    }
}

fn blended_total(usage: &ThreadTokenUsage) -> i64 {
    usage
        .total
        .input_tokens
        .max(0)
        .saturating_sub(usage.total.cached_input_tokens.max(0))
        .max(0)
        .saturating_add(usage.total.output_tokens.max(0))
}

fn format_with_separators(value: i64) -> String {
    let digits = value.to_string();
    let mut result = String::with_capacity(digits.len() + digits.len() / 3);
    for (index, digit) in digits.chars().enumerate() {
        if index > 0 && (digits.len() - index).is_multiple_of(3) {
            result.push(',');
        }
        result.push(digit);
    }
    result
}

pub(super) fn should_print_final_message_to_stdout(
    final_message: &str,
    stdout_is_terminal: bool,
    stderr_is_terminal: bool,
) -> bool {
    !(final_message.is_empty() || stdout_is_terminal && stderr_is_terminal)
}

#[cfg(test)]
#[path = "event_processor_with_human_output_tests.rs"]
mod tests;
