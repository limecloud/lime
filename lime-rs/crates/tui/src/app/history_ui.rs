//! Canonical transcript presentation helpers for the TUI app.
//!
//! The app owns projection-to-view composition here; history persistence and turn state remain
//! owned by App Server and `ConversationProjection`.

use crate::app::App;
use crate::history_cell::{
    computer_activity_compact_hyperlink_lines, exploration_compact_hyperlink_lines,
    FinalMessageSeparator, HistoryCell, HistoryRenderMode, SessionHeaderHistoryCell,
    TranscriptHistoryCell,
};
use crate::locale::Locale;
use crate::projection::{ActivityDetail, ActivityGroupKind, EntryKind, TranscriptEntry};
use crate::terminal_hyperlinks::{wrap_hyperlink_line, HyperlinkLine, HyperlinkParagraph};
use crate::transcript_view::{PromptHeaderSource, TranscriptContent};
use std::path::Path;

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub(crate) struct MainTranscriptContent {
    pub(crate) lines: Vec<HyperlinkLine>,
    pub(crate) prompt_header: PromptHeaderSource,
}

impl MainTranscriptContent {
    fn push_other(&mut self, key: impl Into<String>, lines: Vec<HyperlinkLine>) {
        let start = self.lines.len();
        self.lines.extend(lines);
        self.prompt_header
            .record_other(key, start..self.lines.len());
    }

    fn push_entry(&mut self, entry: &TranscriptEntry, locale: Locale, lines: Vec<HyperlinkLine>) {
        let start = self.lines.len();
        self.lines.extend(lines);
        self.prompt_header
            .record_entry(entry, locale, start..self.lines.len());
    }

    fn append(&mut self, other: Self) {
        let offset = self.lines.len();
        self.prompt_header
            .append_shifted(other.prompt_header, offset);
        self.lines.extend(other.lines);
    }
}

/// Render one canonical transcript entry with the same viewport padding used by the app.
pub(crate) fn render_transcript_entry_lines(
    entry: &TranscriptEntry,
    viewport_width: u16,
    locale: Locale,
    cwd: &Path,
) -> Vec<HyperlinkLine> {
    let content_width = viewport_width.saturating_sub(2).max(1);
    TranscriptHistoryCell::new(entry.clone(), locale, cwd.to_path_buf())
        .display_hyperlink_lines(content_width)
}

/// Render one canonical transcript entry with terminal-native wrapping for bounded list rows.
pub(crate) fn render_transcript_entry_lines_wrapped(
    entry: &TranscriptEntry,
    viewport_width: u16,
    locale: Locale,
    cwd: &Path,
) -> Vec<HyperlinkLine> {
    let content_width = viewport_width.saturating_sub(2).max(1);
    render_transcript_entry_lines(entry, viewport_width, locale, cwd)
        .into_iter()
        .flat_map(|line| wrap_hyperlink_line(&line, usize::from(content_width)))
        .collect()
}

/// Render canonical transcript entries for the main viewport or transcript pager.
pub(crate) fn render_transcript_content_lines(
    app: &App,
    viewport_width: u16,
    separate_entries: bool,
) -> Vec<HyperlinkLine> {
    render_main_transcript_content(app, viewport_width, separate_entries).lines
}

/// Build the compact main transcript and its presentation-only canonical entry ranges.
pub(crate) fn render_main_transcript_content(
    app: &App,
    viewport_width: u16,
    separate_entries: bool,
) -> MainTranscriptContent {
    let content_width = viewport_width.saturating_sub(2).max(1);
    let header = SessionHeaderHistoryCell::new(
        app.chat_widget.model.as_deref().unwrap_or("auto"),
        app.chat_widget.reasoning_effort.clone(),
        app.chat_widget.permissions.clone(),
        app.cwd.clone(),
        env!("CARGO_PKG_VERSION"),
        app.chat_widget.locale,
    );
    let mode = app.chat_widget.history_render_mode;
    let mut content = MainTranscriptContent::default();
    content.push_other(
        "session-header",
        header.display_hyperlink_lines_for_mode(content_width, mode),
    );
    let mut body = MainTranscriptContent::default();
    let entries = app.projection.entries();
    if mode == HistoryRenderMode::Raw {
        for entry in entries {
            let mut group = MainTranscriptContent::default();
            let cell =
                TranscriptHistoryCell::new(entry.clone(), app.chat_widget.locale, app.cwd.clone());
            group.push_entry(
                entry,
                app.chat_widget.locale,
                cell.display_hyperlink_lines_for_mode(content_width, mode),
            );
            if let Some(boundary) = app.projection.completion_after(&entry.id) {
                group.push_other(
                    format!("completion:{}", entry.id),
                    FinalMessageSeparator::new(boundary.elapsed_seconds)
                        .with_locale(app.chat_widget.locale)
                        .display_hyperlink_lines_for_mode(content_width, mode),
                );
            }
            if separate_entries && !body.lines.is_empty() && !group.lines.is_empty() {
                body.push_other(
                    format!("separator:{}", entry.id),
                    vec![HyperlinkLine::default()],
                );
            }
            body.append(group);
        }
        if !body.lines.is_empty() {
            content.push_other("body-gap", vec![HyperlinkLine::default()]);
            content.append(body);
        }
        return content;
    }
    let mut index = 0;
    while index < entries.len() {
        let mut end = activity_group_end(entries, index);
        if let Some(offset) = entries[index..end]
            .iter()
            .position(|entry| app.projection.completion_after(&entry.id).is_some())
        {
            end = index + offset + 1;
        }
        let group = &entries[index..end];
        let mut rendered = MainTranscriptContent::default();
        if let Some(compact) =
            activity_group_compact_lines(group, app.chat_widget.locale, content_width)
        {
            rendered.push_other(format!("activity:{}", group[0].id), compact);
        } else {
            let mut rendered_entries = 0;
            for entry in group {
                if is_transcript_only_reasoning(entry) {
                    continue;
                }
                if separate_entries && rendered_entries > 0 {
                    rendered.push_other(
                        format!("separator:{}", entry.id),
                        vec![HyperlinkLine::default()],
                    );
                }
                rendered.push_entry(
                    entry,
                    app.chat_widget.locale,
                    render_transcript_entry_lines(
                        entry,
                        viewport_width,
                        app.chat_widget.locale,
                        &app.cwd,
                    ),
                );
                rendered_entries += 1;
            }
        }
        let last = &entries[end - 1];
        if let Some(boundary) = app.projection.completion_after(&last.id) {
            rendered.push_other(
                format!("completion:{}", last.id),
                FinalMessageSeparator::new(boundary.elapsed_seconds)
                    .with_locale(app.chat_widget.locale)
                    .display_hyperlink_lines(viewport_width.saturating_sub(2).max(1)),
            );
        }
        if separate_entries && !body.lines.is_empty() && !rendered.lines.is_empty() {
            body.push_other(
                format!("group-separator:{}", group[0].id),
                vec![HyperlinkLine::default()],
            );
        }
        body.append(rendered);
        index = end;
    }
    if !body.lines.is_empty() {
        content.push_other("body-gap", vec![HyperlinkLine::default()]);
        content.append(body);
    }
    content
}

/// Build the structured full-screen transcript presentation consumed by the pager.
///
/// Canonical entry text remains in `ConversationProjection`; this value only carries the compact
/// and expanded terminal renderings plus stable item identities for local disclosure state.
pub(crate) fn render_transcript_pager_content(app: &App, viewport_width: u16) -> TranscriptContent {
    let content_width = viewport_width.saturating_sub(2).max(1);
    let header = SessionHeaderHistoryCell::new(
        app.chat_widget.model.as_deref().unwrap_or("auto"),
        app.chat_widget.reasoning_effort.clone(),
        app.chat_widget.permissions.clone(),
        app.cwd.clone(),
        env!("CARGO_PKG_VERSION"),
        app.chat_widget.locale,
    );
    let mut content = TranscriptContent::default();
    content.push_keyed_lines(
        "session-header",
        header.display_hyperlink_lines(content_width),
    );
    if !app.projection.entries().is_empty() {
        content.push_keyed_lines("session-body-gap", vec![HyperlinkLine::default()]);
    }
    let entries = app.projection.entries();
    let mut index = 0;
    while index < entries.len() {
        content.push_keyed_lines(
            format!("group-separator:{}", entries[index].id),
            vec![HyperlinkLine::default()],
        );
        let mut end = activity_group_end(entries, index);
        if let Some(offset) = entries[index..end]
            .iter()
            .position(|entry| app.projection.completion_after(&entry.id).is_some())
        {
            end = index + offset + 1;
        }
        push_transcript_group(
            &mut content,
            &entries[index..end],
            viewport_width,
            app.chat_widget.locale,
            &app.cwd,
        );
        let last = &entries[end - 1];
        if let Some(boundary) = app.projection.completion_after(&last.id) {
            content.push_keyed_lines(
                format!("completion:{}", last.id),
                FinalMessageSeparator::new(boundary.elapsed_seconds)
                    .with_locale(app.chat_widget.locale)
                    .display_hyperlink_lines(content_width),
            );
        }
        index = end;
    }
    content
}

pub(crate) fn render_transcript_entries_content(
    entries: &[TranscriptEntry],
    viewport_width: u16,
    locale: Locale,
    cwd: &Path,
) -> TranscriptContent {
    let mut content = TranscriptContent::default();
    let mut index = 0;
    while index < entries.len() {
        if index > 0 {
            content.push_keyed_lines(
                format!("group-separator:{}", entries[index].id),
                vec![HyperlinkLine::default()],
            );
        }
        let end = activity_group_end(entries, index);
        push_transcript_group(
            &mut content,
            &entries[index..end],
            viewport_width,
            locale,
            cwd,
        );
        index = end;
    }
    content
}

fn activity_group_end(entries: &[TranscriptEntry], start: usize) -> usize {
    let Some(group) = entries
        .get(start)
        .and_then(|entry| entry.activity_group.as_ref())
    else {
        return (start + 1).min(entries.len());
    };
    let mut end = start + 1;
    while let Some(entry) = entries.get(end) {
        let same_activity = entry.activity_group.as_ref() == Some(group);
        let same_turn_reasoning = activity_reasoning_scope(entry) == Some(group.scope.as_str());
        if !same_activity && !same_turn_reasoning {
            break;
        }
        end += 1;
    }
    end
}

fn push_transcript_group(
    content: &mut TranscriptContent,
    entries: &[TranscriptEntry],
    viewport_width: u16,
    locale: Locale,
    cwd: &Path,
) {
    if let [entry] = entries {
        if entry.activity_group.is_none() {
            push_transcript_entry(content, entry, viewport_width, locale, cwd);
            return;
        }
    }

    let width = viewport_width.saturating_sub(2).max(1);
    let grouped_compact = activity_group_compact_lines(entries, locale, width);
    let mut ids = Vec::new();
    let mut fallback_compact = Vec::new();
    let mut fallback_expanded = Vec::new();
    let mut grouped_expanded = Vec::new();
    for (index, entry) in entries.iter().enumerate() {
        let cell = TranscriptHistoryCell::new(entry.clone(), locale, cwd.to_path_buf());
        if index > 0 {
            fallback_compact.push(HyperlinkLine::default());
            fallback_expanded.push(HyperlinkLine::default());
        }
        ids.extend(cell.activity_ids());
        fallback_compact.extend(cell.compact_hyperlink_lines(width));
        let expanded = cell.expanded_hyperlink_lines(width);
        fallback_expanded.extend(expanded.iter().cloned());
        if activity_reasoning_scope(entry).is_some() {
            if !entry.text.trim().is_empty() && !expanded.is_empty() {
                if !grouped_expanded.is_empty() {
                    grouped_expanded.push(HyperlinkLine::default());
                }
                grouped_expanded.extend(expanded);
            }
        } else {
            grouped_expanded.extend(expanded);
        }
    }
    let (compact, expanded) = grouped_compact
        .map(|compact| (compact, grouped_expanded))
        .unwrap_or((fallback_compact, fallback_expanded));
    content.push_activity(ids, compact, expanded);
}

fn activity_group_compact_lines(
    entries: &[TranscriptEntry],
    locale: Locale,
    width: u16,
) -> Option<Vec<HyperlinkLine>> {
    let group = entries.first()?.activity_group.as_ref()?;
    let kind = group.kind;
    let facts_match = entries.iter().all(|entry| {
        if let Some(scope) = activity_reasoning_scope(entry) {
            return scope == group.scope;
        }
        entry.activity_group.as_ref() == Some(group)
            && match kind {
                ActivityGroupKind::Exploration => matches!(
                    entry.activity_detail.as_ref(),
                    Some(ActivityDetail::Exploration { .. })
                ),
                ActivityGroupKind::Computer => matches!(
                    entry.activity_detail.as_ref(),
                    Some(ActivityDetail::Computer(_))
                ),
            }
    });
    if !facts_match {
        return None;
    }
    Some(match kind {
        ActivityGroupKind::Exploration => {
            exploration_compact_hyperlink_lines(entries, locale, width)
        }
        ActivityGroupKind::Computer => {
            computer_activity_compact_hyperlink_lines(entries, locale, width)
        }
    })
}

fn activity_reasoning_scope(entry: &TranscriptEntry) -> Option<&str> {
    let ActivityDetail::Reasoning { scope, .. } = entry.activity_detail.as_ref()? else {
        return None;
    };
    Some(scope)
}

fn is_transcript_only_reasoning(entry: &TranscriptEntry) -> bool {
    entry.kind == EntryKind::Reasoning
}

fn push_transcript_entry(
    content: &mut TranscriptContent,
    entry: &TranscriptEntry,
    viewport_width: u16,
    locale: Locale,
    cwd: &Path,
) {
    let width = viewport_width.saturating_sub(2).max(1);
    let cell = TranscriptHistoryCell::new(entry.clone(), locale, cwd.to_path_buf());
    let expanded = cell.expanded_hyperlink_lines(width);
    if let Some(disclosure) = cell.activity_disclosure(width) {
        content.push_activity_with_disclosure(
            cell.activity_ids(),
            cell.compact_hyperlink_lines(width),
            expanded,
            Some(disclosure),
        );
    } else {
        content.push_keyed_lines(format!("entry:{}", entry.id), expanded);
    }
}

/// Count the wrapped rows occupied by the canonical main transcript at the current width.
pub(crate) fn rendered_transcript_row_count(app: &App, viewport_width: u16) -> usize {
    let lines = render_transcript_content_lines(app, viewport_width, false);
    HyperlinkParagraph::new(&lines).line_count(viewport_width.max(1))
}

#[cfg(test)]
#[path = "history_ui_tests.rs"]
mod tests;
