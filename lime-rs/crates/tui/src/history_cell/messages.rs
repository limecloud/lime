//! User, assistant, reasoning, and streaming message cells.

use super::*;
use std::borrow::Cow;

/// Remove terminal control sequences from persisted text before exporting it.
pub(crate) fn sanitize_user_text(text: Cow<'_, str>) -> Cow<'_, str> {
    let mut output = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    let mut changed = false;
    while let Some(ch) = chars.next() {
        if ch == '\x1b' {
            changed = true;
            if chars.peek() == Some(&'[') {
                chars.next();
                for sequence in chars.by_ref() {
                    if ('@'..='~').contains(&sequence) {
                        break;
                    }
                }
            }
            continue;
        }
        if ch.is_control() && !matches!(ch, '\n' | '\t') {
            changed = true;
            continue;
        }
        output.push(ch);
    }
    if changed {
        Cow::Owned(output)
    } else {
        text
    }
}

fn message_entry(kind: EntryKind, text: String, streaming: bool) -> TranscriptEntry {
    TranscriptEntry {
        id: String::new(),
        kind,
        text,
        streaming,
        status: None,
        summary: Vec::new(),
        activity_group: None,
        activity_detail: None,
    }
}

#[derive(Debug, Clone)]
pub(crate) struct UserHistoryCell {
    pub(crate) message: String,
    pub(crate) text_elements: Vec<agent_protocol::TextElement>,
    pub(crate) local_image_paths: Vec<std::path::PathBuf>,
    pub(crate) remote_image_urls: Vec<String>,
}

impl UserHistoryCell {
    pub(crate) fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            text_elements: Vec::new(),
            local_image_paths: Vec::new(),
            remote_image_urls: Vec::new(),
        }
    }
}

impl HistoryCell for UserHistoryCell {
    fn display_lines(&self, width: u16) -> Vec<Line<'static>> {
        self.display_hyperlink_lines(width)
            .into_iter()
            .map(|line| line.line)
            .collect()
    }

    fn display_hyperlink_lines(&self, width: u16) -> Vec<HyperlinkLine> {
        TranscriptHistoryCell::new(
            message_entry(EntryKind::User, self.message.clone(), false),
            Locale::default(),
            std::path::PathBuf::new(),
        )
        .display_hyperlink_lines(width)
    }

    fn raw_lines(&self) -> Vec<Line<'static>> {
        self.display_lines(u16::MAX)
    }
}

#[derive(Debug, Clone)]
pub(crate) struct AgentMessageCell {
    pub(crate) message: String,
    pub(crate) streaming: bool,
}

impl AgentMessageCell {
    pub(crate) fn new(message: impl Into<String>, streaming: bool) -> Self {
        Self {
            message: message.into(),
            streaming,
        }
    }
}

impl HistoryCell for AgentMessageCell {
    fn display_lines(&self, width: u16) -> Vec<Line<'static>> {
        self.display_hyperlink_lines(width)
            .into_iter()
            .map(|line| line.line)
            .collect()
    }

    fn display_hyperlink_lines(&self, width: u16) -> Vec<HyperlinkLine> {
        TranscriptHistoryCell::new(
            message_entry(EntryKind::Assistant, self.message.clone(), self.streaming),
            Locale::default(),
            std::path::PathBuf::new(),
        )
        .display_hyperlink_lines(width)
    }

    fn raw_lines(&self) -> Vec<Line<'static>> {
        self.display_lines(u16::MAX)
    }

    fn is_stream_continuation(&self) -> bool {
        self.streaming
    }
}

pub(crate) type StreamingAgentTailCell = AgentMessageCell;
