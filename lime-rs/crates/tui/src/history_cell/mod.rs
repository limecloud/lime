//! Codex-shaped transcript cells backed by Lime's canonical projection.
//!
//! A history cell owns terminal presentation for one canonical `ThreadItem`. It never owns
//! session state, persistence, provider output, or a second transcript model.

use std::any::Any;
use std::path::PathBuf;

use ratatui::text::{Line, Text};
use ratatui::widgets::{Paragraph, Wrap};

use crate::entry;
use crate::locale::Locale;
use crate::projection::{EntryKind, TranscriptEntry};
use crate::terminal_hyperlinks::{plain_hyperlink_lines, visible_lines_ref, HyperlinkLine};

mod approvals;
mod base;
mod computer_activity;
mod exec;
mod hook;
mod mcp;
mod mcp_result;
mod messages;
mod notices;
mod patches;
mod plans;
mod reasoning;
mod request_user_input;
mod search;
mod separators;
mod session;

mod activity_preview;

pub(crate) use activity_preview::ActivityDisclosure;

pub(crate) use approvals::*;
pub(crate) use base::*;
pub(crate) use computer_activity::{
    compact_hyperlink_lines as computer_activity_compact_hyperlink_lines,
    facts as computer_activity_facts, is_computer_activity, summary as computer_activity_summary,
    ComputerActivityFacts,
};
pub(crate) use exec::*;
pub(crate) use hook::*;
pub(crate) use mcp::*;
pub(crate) use mcp_result::*;
pub(crate) use messages::*;
pub(crate) use notices::*;
pub(crate) use patches::*;
pub(crate) use plans::*;
pub(crate) use reasoning::{split_reasoning_summary_parts, ReasoningSummaryCell};
pub(crate) use request_user_input::*;
pub(crate) use search::*;
pub(crate) use separators::*;
pub(crate) use session::*;

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub(crate) enum HistoryRenderMode {
    #[default]
    Rich,
    Raw,
}

fn raw_lines_from_source(source: &str) -> Vec<Line<'static>> {
    if source.is_empty() {
        return Vec::new();
    }
    let mut lines = source.split('\n').map(str::to_owned).collect::<Vec<_>>();
    if source.ends_with('\n') {
        lines.pop();
    }
    lines.into_iter().map(Line::from).collect()
}

pub(crate) fn plain_lines(lines: impl IntoIterator<Item = Line<'static>>) -> Vec<Line<'static>> {
    lines
        .into_iter()
        .map(|line| {
            let text = line
                .spans
                .into_iter()
                .map(|span| span.content.into_owned())
                .collect::<String>();
            Line::from(text)
        })
        .collect()
}

pub(crate) trait HistoryCell: std::fmt::Debug + Send + Sync + Any {
    fn display_lines(&self, width: u16) -> Vec<Line<'static>>;

    fn raw_lines(&self) -> Vec<Line<'static>>;

    fn display_hyperlink_lines(&self, width: u16) -> Vec<HyperlinkLine> {
        plain_hyperlink_lines(self.display_lines(width))
    }

    fn display_lines_for_mode(&self, width: u16, mode: HistoryRenderMode) -> Vec<Line<'static>> {
        match mode {
            HistoryRenderMode::Rich => visible_lines_ref(&self.display_hyperlink_lines(width)),
            HistoryRenderMode::Raw => self.raw_lines(),
        }
    }

    fn display_hyperlink_lines_for_mode(
        &self,
        width: u16,
        mode: HistoryRenderMode,
    ) -> Vec<HyperlinkLine> {
        match mode {
            HistoryRenderMode::Rich => self.display_hyperlink_lines(width),
            HistoryRenderMode::Raw => plain_hyperlink_lines(self.raw_lines()),
        }
    }

    fn desired_height(&self, width: u16) -> u16 {
        self.desired_height_for_mode(width, HistoryRenderMode::Rich)
    }

    fn desired_height_for_mode(&self, width: u16, mode: HistoryRenderMode) -> u16 {
        Paragraph::new(Text::from(self.display_lines_for_mode(width, mode)))
            .wrap(Wrap { trim: false })
            .line_count(width)
            .try_into()
            .unwrap_or(0)
    }

    fn transcript_lines(&self, width: u16) -> Vec<Line<'static>> {
        self.display_lines(width)
    }

    fn transcript_hyperlink_lines(&self, width: u16) -> Vec<HyperlinkLine> {
        plain_hyperlink_lines(self.transcript_lines(width))
    }

    /// Compact activity presentation for transcript disclosure.
    fn compact_hyperlink_lines(&self, width: u16) -> Vec<HyperlinkLine> {
        self.display_hyperlink_lines(width)
    }

    /// Stable canonical identities used to retain disclosure across history prepends and replay.
    fn activity_ids(&self) -> Vec<String> {
        Vec::new()
    }

    /// Complete activity presentation for an expanded disclosure group.
    fn expanded_hyperlink_lines(&self, width: u16) -> Vec<HyperlinkLine> {
        self.transcript_hyperlink_lines(width)
    }

    fn activity_disclosure(&self, _width: u16) -> Option<ActivityDisclosure> {
        None
    }

    fn desired_transcript_height(&self, width: u16) -> u16 {
        Paragraph::new(Text::from(visible_lines_ref(
            &self.transcript_hyperlink_lines(width),
        )))
        .wrap(Wrap { trim: false })
        .line_count(width)
        .try_into()
        .unwrap_or(0)
    }

    fn has_stable_transcript_height(&self) -> bool {
        true
    }

    fn is_stream_continuation(&self) -> bool {
        false
    }

    fn transcript_animation_tick(&self) -> Option<u64> {
        None
    }
}

/// Adapter from the canonical projection to the Codex-shaped cell interface.
#[derive(Clone, Debug)]
pub(crate) struct TranscriptHistoryCell {
    entry: TranscriptEntry,
    locale: Locale,
    cwd: PathBuf,
}

impl TranscriptHistoryCell {
    pub(crate) fn new(entry: TranscriptEntry, locale: Locale, cwd: PathBuf) -> Self {
        Self { entry, locale, cwd }
    }

    pub(crate) fn entry(&self) -> &TranscriptEntry {
        &self.entry
    }
}

impl HistoryCell for TranscriptHistoryCell {
    fn display_lines(&self, width: u16) -> Vec<Line<'static>> {
        self.display_hyperlink_lines(width)
            .into_iter()
            .map(|line| line.line)
            .collect()
    }

    fn raw_lines(&self) -> Vec<Line<'static>> {
        if self.entry.kind == EntryKind::Reasoning {
            return Vec::new();
        }
        let source = if self.entry.kind == EntryKind::User {
            messages::sanitize_user_text((&self.entry.text).into()).into_owned()
        } else {
            self.entry.text.clone()
        };
        let mut lines = raw_lines_from_source(&source);
        for detail in &self.entry.summary {
            lines.extend(raw_lines_from_source(detail));
        }
        lines
    }

    fn display_hyperlink_lines(&self, width: u16) -> Vec<HyperlinkLine> {
        if self.entry.kind == EntryKind::Reasoning {
            return Vec::new();
        }
        self.transcript_hyperlink_lines(width)
    }

    fn transcript_hyperlink_lines(&self, width: u16) -> Vec<HyperlinkLine> {
        entry::hyperlink_lines_with_locale(
            &self.entry,
            self.locale,
            Some(usize::from(width)),
            &self.cwd,
        )
    }

    fn transcript_lines(&self, width: u16) -> Vec<Line<'static>> {
        visible_lines_ref(&self.transcript_hyperlink_lines(width))
    }

    fn compact_hyperlink_lines(&self, width: u16) -> Vec<HyperlinkLine> {
        if self.entry.kind == EntryKind::Reasoning {
            return Vec::new();
        }
        entry::compact_hyperlink_lines_with_locale(
            &self.entry,
            self.locale,
            Some(usize::from(width)),
            &self.cwd,
        )
    }

    fn activity_ids(&self) -> Vec<String> {
        if self.entry.id.is_empty() || !is_disclosable_activity(self.entry.kind) {
            Vec::new()
        } else {
            vec![format!("entry:{}", self.entry.id)]
        }
    }

    fn expanded_hyperlink_lines(&self, width: u16) -> Vec<HyperlinkLine> {
        self.transcript_hyperlink_lines(width)
    }

    fn activity_disclosure(&self, width: u16) -> Option<ActivityDisclosure> {
        if self.activity_ids().is_empty()
            || self.compact_hyperlink_lines(width) == self.expanded_hyperlink_lines(width)
        {
            return None;
        }

        if self.entry.kind == EntryKind::Command {
            let mut source = self.entry.text.lines();
            source.next();
            let output = crate::exec_cell::CommandOutput::from_lines(source, self.locale);
            let (_, retained) = output.line_counts();
            if retained > 0 {
                return Some(ActivityDisclosure::OutputLines(retained));
            }
        }

        Some(ActivityDisclosure::Generic)
    }

    fn is_stream_continuation(&self) -> bool {
        self.entry.streaming
    }
}

fn is_disclosable_activity(kind: EntryKind) -> bool {
    matches!(
        kind,
        EntryKind::Command
            | EntryKind::Patch
            | EntryKind::Mcp
            | EntryKind::Plan
            | EntryKind::MultiAgent
            | EntryKind::Tool
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::projection::EntryStatus;

    fn entry(kind: EntryKind, text: &str) -> TranscriptEntry {
        TranscriptEntry {
            id: "entry-1".to_string(),
            kind,
            text: text.to_string(),
            streaming: false,
            status: Some(EntryStatus::Completed),
            summary: Vec::new(),
            activity_group: None,
            activity_detail: None,
        }
    }

    #[test]
    fn canonical_projection_adapter_preserves_item_identity_and_text() {
        let cell = TranscriptHistoryCell::new(
            entry(EntryKind::Assistant, "hello"),
            Locale::EnUs,
            PathBuf::from("/workspace"),
        );

        assert_eq!(cell.entry().id, "entry-1");
        assert_eq!(cell.display_lines(80)[0].spans[1].content, "hello");
        assert_eq!(cell.raw_lines(), vec![Line::from("hello")]);
    }

    #[test]
    fn raw_projection_preserves_source_and_hides_transcript_only_reasoning() {
        let assistant = TranscriptHistoryCell::new(
            entry(EntryKind::Assistant, "- first\n\n| A | B |\n| - | - |"),
            Locale::EnUs,
            PathBuf::from("/workspace"),
        );
        assert_eq!(
            assistant
                .raw_lines()
                .into_iter()
                .map(|line| line.to_string())
                .collect::<Vec<_>>(),
            ["- first", "", "| A | B |", "| - | - |"]
        );

        let reasoning = TranscriptHistoryCell::new(
            entry(EntryKind::Reasoning, "private summary"),
            Locale::EnUs,
            PathBuf::from("/workspace"),
        );
        assert!(reasoning.raw_lines().is_empty());
    }

    #[test]
    fn streaming_projection_marks_cell_as_stream_continuation() {
        let mut item = entry(EntryKind::Assistant, "partial");
        item.streaming = true;
        let cell = TranscriptHistoryCell::new(item, Locale::EnUs, PathBuf::from("/workspace"));
        assert!(cell.is_stream_continuation());
    }

    #[test]
    fn activity_cell_exposes_stable_identity_and_compact_details() {
        let mut item = entry(EntryKind::Command, "cargo test\ncompiled\npassed");
        item.id = "command-1".to_string();
        item.summary = vec!["duration: 12 ms".to_string()];
        let cell = TranscriptHistoryCell::new(item, Locale::EnUs, PathBuf::from("/workspace"));

        assert_eq!(cell.activity_ids(), vec!["entry:command-1"]);
        assert!(cell.activity_disclosure(80).is_some());
        assert_eq!(cell.compact_hyperlink_lines(80).len(), 1);
        assert!(cell.expanded_hyperlink_lines(80).len() > 1);
    }

    #[test]
    fn command_disclosure_counts_retained_output_lines_only() {
        let output = (0..101)
            .map(|index| format!("line-{index}"))
            .collect::<Vec<_>>()
            .join("\n");
        let cell = TranscriptHistoryCell::new(
            entry(EntryKind::Command, &format!("cargo test\n{output}")),
            Locale::EnUs,
            PathBuf::from("/workspace"),
        );

        assert_eq!(
            cell.activity_disclosure(80),
            Some(ActivityDisclosure::OutputLines(100))
        );
    }

    #[test]
    fn command_without_output_keeps_generic_details() {
        let mut item = entry(EntryKind::Command, "cargo test");
        item.summary = vec!["duration: 12ms".to_string()];
        let cell = TranscriptHistoryCell::new(item, Locale::EnUs, PathBuf::from("/workspace"));

        assert_eq!(
            cell.activity_disclosure(80),
            Some(ActivityDisclosure::Generic)
        );
    }

    #[test]
    fn user_history_cell_wraps_and_prefixes_each_line_snapshot() {
        let cell = TranscriptHistoryCell::new(
            entry(EntryKind::User, "first line\nsecond line"),
            Locale::EnUs,
            PathBuf::from("/workspace"),
        );
        let lines = cell.display_lines(80);
        assert_eq!(lines[0].spans[0].content, "› ");
        assert_eq!(lines[1].spans[0].content, "  ");
        assert!(lines.iter().any(|line| {
            line.spans
                .iter()
                .any(|span| span.content.as_ref() == "second line")
        }));
    }
}
