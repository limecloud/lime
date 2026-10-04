use std::cell::{Cell, RefCell};
use std::collections::HashSet;

use crossterm::event::{Event, KeyEventKind, MouseButton, MouseEventKind};
use ratatui::layout::Rect;
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::Line;
use ratatui::widgets::{Clear, Paragraph};
use ratatui::Frame;

use crate::clipboard_copy::CopyStatus;
use crate::keymap::{KeyChordMatcher, KeymapMatch, PagerKeymapAction, TranscriptKeymap};
use crate::line_truncation::truncate_line_with_ellipsis_if_overflow;
use crate::locale::Locale;
use crate::status::{StatusFacts, StatusSnapshot};
use crate::terminal_hyperlinks::{wrapped_line_starts, HyperlinkLine, HyperlinkParagraph};
use crate::transcript_view::{
    search_status, SearchAction, TranscriptBookmark, TranscriptContent, TranscriptDisclosure,
    TranscriptFrame, TranscriptSearch, TranscriptSelection, TranscriptSelectionAction,
};

#[cfg(test)]
mod disclosure_tests;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum PagerAction {
    Consumed,
    ScheduleFrame,
    ContinueTranscriptSelection,
    LoadOlderHistory,
    CopyTranscriptSelection { text: String, follow: bool },
    OpenLink(String),
    Close,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum HistoryLoadState {
    Idle,
    Loading,
    Failed,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct TranscriptCopyFeedback {
    result: Result<CopyStatus, ()>,
    characters: usize,
}

#[derive(Debug)]
pub(crate) struct PagerOverlay {
    title: String,
    static_lines: Option<Vec<HyperlinkLine>>,
    status_snapshot: Option<StatusSnapshot>,
    scroll: Cell<usize>,
    page_height: Cell<usize>,
    max_scroll: Cell<usize>,
    pinned_to_bottom: Cell<bool>,
    older_history_available: Cell<bool>,
    history_load_state: Cell<HistoryLoadState>,
    /// Previous structured transcript frame used to retain canonical source identity while the
    /// projection prepends history, replaces a group, or rewraps at another terminal width.
    previous_transcript_frame: RefCell<Option<TranscriptFrame>>,
    pending_transcript_bookmark: RefCell<Option<TranscriptBookmark>>,
    search: TranscriptSearch,
    transcript_copy_feedback: Option<TranscriptCopyFeedback>,
    disclosure: TranscriptDisclosure,
    transcript_selection: TranscriptSelection,
    keymap: TranscriptKeymap,
    key_chord_matcher: KeyChordMatcher,
}

impl PagerOverlay {
    pub(crate) fn status(locale: Locale, facts: StatusFacts<'_>) -> Self {
        let status_snapshot = StatusSnapshot::from_facts(facts);
        let lines = status_snapshot.raw_lines(locale);
        let mut overlay = Self::new(locale.status_title().to_string(), lines);
        overlay.status_snapshot = Some(status_snapshot);
        overlay
    }

    pub(crate) fn new(title: String, lines: Vec<Line<'static>>) -> Self {
        Self {
            title,
            static_lines: Some(lines.into_iter().map(HyperlinkLine::new).collect()),
            status_snapshot: None,
            scroll: Cell::new(0),
            page_height: Cell::new(1),
            max_scroll: Cell::new(0),
            pinned_to_bottom: Cell::new(false),
            older_history_available: Cell::new(false),
            history_load_state: Cell::new(HistoryLoadState::Idle),
            previous_transcript_frame: RefCell::new(None),
            pending_transcript_bookmark: RefCell::new(None),
            search: TranscriptSearch::default(),
            transcript_copy_feedback: None,
            disclosure: TranscriptDisclosure::default(),
            transcript_selection: TranscriptSelection::default(),
            keymap: TranscriptKeymap::default(),
            key_chord_matcher: KeyChordMatcher::default(),
        }
    }

    pub(crate) fn transcript(locale: Locale) -> Self {
        Self {
            title: locale.transcript_title().to_string(),
            static_lines: None,
            status_snapshot: None,
            scroll: Cell::new(usize::MAX),
            page_height: Cell::new(1),
            max_scroll: Cell::new(0),
            pinned_to_bottom: Cell::new(true),
            older_history_available: Cell::new(false),
            history_load_state: Cell::new(HistoryLoadState::Idle),
            previous_transcript_frame: RefCell::new(None),
            pending_transcript_bookmark: RefCell::new(None),
            search: TranscriptSearch::default(),
            transcript_copy_feedback: None,
            disclosure: TranscriptDisclosure::default(),
            transcript_selection: TranscriptSelection::default(),
            keymap: TranscriptKeymap::default(),
            key_chord_matcher: KeyChordMatcher::default(),
        }
    }

    pub(crate) fn with_keymap(mut self, keymap: TranscriptKeymap) -> Self {
        self.keymap = keymap;
        self.key_chord_matcher.reset();
        self
    }

    pub(crate) fn is_transcript(&self) -> bool {
        self.static_lines.is_none()
    }

    pub(crate) fn set_older_history_available(&self, available: bool) {
        self.older_history_available.set(available);
        if !available {
            self.history_load_state.set(HistoryLoadState::Idle);
        }
    }

    /// Mark an asynchronous older-history request before handing it to the host event loop.
    ///
    /// The footer remains authoritative while the App Server request is in flight, and the
    /// transcript anchor stays stable until the completion event is accepted.
    pub(crate) fn begin_older_history_load(&self) {
        if self.is_transcript() {
            self.history_load_state.set(HistoryLoadState::Loading);
            self.search.begin_history_load();
        }
    }

    pub(crate) fn complete_older_history_load(&self) {
        self.history_load_state.set(HistoryLoadState::Idle);
        self.search.complete_history_load();
    }

    pub(crate) fn fail_older_history_load(&self) {
        if self.is_transcript() {
            self.history_load_state.set(HistoryLoadState::Failed);
            self.search.fail_history_load();
        }
    }

    pub(crate) fn search_needs_frame(&self) -> bool {
        self.search.needs_frame()
    }

    pub(crate) fn take_search_history_request(&self) -> bool {
        self.search
            .take_history_request(self.older_history_available.get())
    }

    /// Keep the transcript at the actual beginning after Home loads all older pages.
    pub(crate) fn reset_transcript_anchor_at_top(&self) {
        if !self.is_transcript() {
            return;
        }
        self.pinned_to_bottom.set(false);
        self.scroll.set(0);
        *self.previous_transcript_frame.borrow_mut() = None;
        *self.pending_transcript_bookmark.borrow_mut() = None;
    }

    pub(crate) fn bookmark(&self) -> TranscriptBookmark {
        let following = self.pinned_to_bottom.get();
        self.previous_transcript_frame
            .borrow()
            .as_ref()
            .map(|frame| TranscriptBookmark::capture(frame, following, self.scroll.get()))
            .unwrap_or_else(|| TranscriptBookmark::fallback(following, self.scroll.get()))
    }

    pub(crate) fn restore_bookmark(&self, bookmark: TranscriptBookmark) {
        self.pinned_to_bottom.set(bookmark.following());
        self.scroll.set(bookmark.fallback_scroll());
        *self.pending_transcript_bookmark.borrow_mut() = Some(bookmark);
    }

    pub(crate) fn clear_transcript_selection(&self) {
        self.transcript_selection.clear();
    }

    /// Drop short-lived interaction while retaining the detailed reading position and disclosure.
    pub(crate) fn suspend_transcript_interaction(&mut self) {
        if !self.is_transcript() {
            return;
        }
        self.close_search();
        self.transcript_selection.clear();
        self.disclosure.clear_focus();
        self.transcript_copy_feedback = None;
        self.history_load_state.set(HistoryLoadState::Idle);
    }

    pub(crate) fn end_transcript_drag(&self) {
        self.transcript_selection.end_drag();
    }

    /// Move an active vertical edge drag by exactly one wrapped row.
    pub(crate) fn tick_transcript_selection(&self) -> bool {
        let Some(rows) = self.transcript_selection.edge_scroll_direction() else {
            return false;
        };
        let previous = self.scroll.get();
        self.scroll_transcript_rows(rows);
        previous != self.scroll.get()
    }

    fn can_tick_transcript_selection(&self) -> bool {
        match self.transcript_selection.edge_scroll_direction() {
            Some(rows) if rows < 0 => self.scroll.get() > 0,
            Some(rows) if rows > 0 => self.scroll.get() < self.max_scroll.get(),
            _ => false,
        }
    }

    pub(crate) fn confirm_transcript_copy(&mut self, follow: bool) {
        self.clear_transcript_selection();
        if follow && self.is_transcript() {
            self.close_search();
            self.pinned_to_bottom.set(true);
            self.scroll.set(self.max_scroll.get());
        }
    }

    /// Apply clipboard acknowledgement without treating a terminal request as delivery.
    pub(crate) fn apply_transcript_copy_result(
        &mut self,
        follow: bool,
        characters: usize,
        result: &Result<CopyStatus, String>,
    ) {
        self.transcript_copy_feedback = Some(TranscriptCopyFeedback {
            result: result.as_ref().copied().map_err(|_| ()),
            characters,
        });
        if matches!(result, Ok(CopyStatus::Confirmed)) {
            self.confirm_transcript_copy(follow);
        }
    }

    pub(crate) fn has_transcript_selection(&self) -> bool {
        self.transcript_selection.snapshot_lines().is_some()
    }

    #[cfg(test)]
    pub(crate) fn transcript_scroll_position(&self) -> usize {
        self.scroll.get()
    }

    #[cfg(test)]
    pub(crate) fn transcript_search_is_active(&self) -> bool {
        self.search.is_active()
    }

    fn close_search(&mut self) {
        let _ = self.search.close();
    }

    pub(crate) fn handle_event(&mut self, event: &Event) -> PagerAction {
        if !matches!(event, Event::Key(_)) {
            self.key_chord_matcher.reset();
        }
        self.transcript_copy_feedback = None;
        if self.is_transcript() {
            if !self.search.is_active() && self.disclosure.handle_event(event) {
                self.transcript_selection.clear();
                self.pinned_to_bottom.set(false);
                return PagerAction::Consumed;
            }
            if let Some(action) = self.transcript_selection.handle_event(event) {
                self.disclosure.clear_focus();
                return match action {
                    TranscriptSelectionAction::Consumed
                        if matches!(
                            event,
                            Event::Mouse(mouse)
                                if mouse.kind == MouseEventKind::Drag(MouseButton::Left)
                        ) && self.can_tick_transcript_selection() =>
                    {
                        PagerAction::ContinueTranscriptSelection
                    }
                    TranscriptSelectionAction::Consumed => PagerAction::Consumed,
                    TranscriptSelectionAction::Copy { text, follow } => {
                        PagerAction::CopyTranscriptSelection { text, follow }
                    }
                    TranscriptSelectionAction::OpenLink(destination) => {
                        PagerAction::OpenLink(destination)
                    }
                    TranscriptSelectionAction::Scroll { rows } => {
                        self.scroll_transcript_rows(rows);
                        PagerAction::Consumed
                    }
                    TranscriptSelectionAction::RevealRow(row) => {
                        self.reveal_transcript_row(row);
                        PagerAction::Consumed
                    }
                };
            }
        }
        if self.search.is_active() {
            self.pinned_to_bottom.set(false);
            return match self
                .search
                .handle_event(event, self.older_history_available.get())
            {
                SearchAction::Consumed | SearchAction::Closed { .. } => PagerAction::Consumed,
                SearchAction::ScheduleFrame => PagerAction::ScheduleFrame,
                SearchAction::LoadOlderHistory => PagerAction::LoadOlderHistory,
            };
        }

        let Event::Key(key) = event else {
            return PagerAction::Consumed;
        };
        if key.kind != KeyEventKind::Press {
            return PagerAction::Consumed;
        }

        let action = match self
            .keymap
            .dispatch_pager(&mut self.key_chord_matcher, *key)
        {
            KeymapMatch::Completed(action) => action,
            KeymapMatch::Pending | KeymapMatch::Cancelled | KeymapMatch::PassThrough => {
                return PagerAction::Consumed;
            }
        };
        if action == PagerKeymapAction::Find {
            if self.is_transcript() {
                self.search
                    .begin(self.scroll.get(), /*restore_on_close*/ false);
                return PagerAction::ScheduleFrame;
            }
            return PagerAction::Consumed;
        }
        if action == PagerKeymapAction::Close
            || self.is_transcript() && action == PagerKeymapAction::CloseTranscript
        {
            return PagerAction::Close;
        }

        let load_older = self.is_transcript()
            && self.older_history_available.get()
            && matches!(
                action,
                PagerKeymapAction::ScrollUp
                    | PagerKeymapAction::PageUp
                    | PagerKeymapAction::HalfPageUp
                    | PagerKeymapAction::JumpTop
            );
        let page_height = self.page_height.get().max(1);
        match action {
            PagerKeymapAction::ScrollUp => {
                self.pinned_to_bottom.set(false);
                self.scroll.set(self.scroll.get().saturating_sub(1));
            }
            PagerKeymapAction::ScrollDown => {
                self.scroll.set(self.scroll.get().saturating_add(1));
            }
            PagerKeymapAction::PageUp => {
                self.pinned_to_bottom.set(false);
                self.scroll
                    .set(self.scroll.get().saturating_sub(page_height));
            }
            PagerKeymapAction::PageDown => {
                self.scroll
                    .set(self.scroll.get().saturating_add(page_height));
            }
            PagerKeymapAction::HalfPageUp => {
                self.pinned_to_bottom.set(false);
                self.scroll
                    .set(self.scroll.get().saturating_sub((page_height / 2).max(1)));
            }
            PagerKeymapAction::HalfPageDown => {
                self.scroll
                    .set(self.scroll.get().saturating_add((page_height / 2).max(1)));
            }
            PagerKeymapAction::JumpTop => {
                self.pinned_to_bottom.set(false);
                self.scroll.set(0);
            }
            PagerKeymapAction::JumpBottom => {
                self.pinned_to_bottom.set(true);
                self.scroll.set(self.max_scroll.get());
            }
            PagerKeymapAction::Close
            | PagerKeymapAction::CloseTranscript
            | PagerKeymapAction::Find => return PagerAction::Consumed,
        }
        self.scroll
            .set(self.scroll.get().min(self.max_scroll.get()));
        if matches!(
            action,
            PagerKeymapAction::ScrollDown
                | PagerKeymapAction::PageDown
                | PagerKeymapAction::HalfPageDown
        ) {
            self.pinned_to_bottom
                .set(self.scroll.get() == self.max_scroll.get());
        }
        if load_older && self.scroll.get() == 0 {
            PagerAction::LoadOlderHistory
        } else {
            PagerAction::Consumed
        }
    }

    fn scroll_transcript_rows(&self, rows: isize) {
        let next = self
            .scroll
            .get()
            .saturating_add_signed(rows)
            .min(self.max_scroll.get());
        self.scroll.set(next);
        if rows < 0 {
            self.pinned_to_bottom.set(false);
        } else if rows > 0 {
            self.pinned_to_bottom.set(next == self.max_scroll.get());
        }
    }

    fn reveal_transcript_row(&self, row: usize) {
        let page_height = self.page_height.get().max(1);
        let current = self.scroll.get();
        let next = if row < current {
            row
        } else if row >= current.saturating_add(page_height) {
            row.saturating_add(1).saturating_sub(page_height)
        } else {
            current
        };
        self.pinned_to_bottom.set(false);
        self.scroll.set(next.min(self.max_scroll.get()));
    }

    pub(crate) fn render(
        &self,
        frame: &mut Frame<'_>,
        area: Rect,
        locale: Locale,
        transcript_lines: &[HyperlinkLine],
    ) {
        self.render_inner(frame, area, locale, None, transcript_lines);
    }

    pub(crate) fn render_transcript(
        &self,
        frame: &mut Frame<'_>,
        area: Rect,
        locale: Locale,
        transcript: &TranscriptContent,
    ) {
        self.render_inner(frame, area, locale, Some(transcript), &[]);
    }

    fn render_inner(
        &self,
        frame: &mut Frame<'_>,
        area: Rect,
        locale: Locale,
        transcript: Option<&TranscriptContent>,
        transcript_lines: &[HyperlinkLine],
    ) {
        frame.render_widget(Clear, area);
        if area.width == 0 || area.height == 0 {
            return;
        }

        let header = Rect::new(area.x, area.y, area.width, 1);
        let footer_height = u16::from(area.height >= 2);
        let separator_height = u16::from(area.height >= 3);
        let content_y = area.y.saturating_add(1);
        let content_height = area
            .height
            .saturating_sub(1 + footer_height + separator_height);
        let content = Rect::new(area.x, content_y, area.width, content_height);
        let separator = Rect::new(area.x, content.bottom(), area.width, separator_height);
        let footer = Rect::new(area.x, separator.bottom(), area.width, footer_height);

        frame.render_widget(
            Paragraph::new(truncate_line_with_ellipsis_if_overflow(
                Line::styled(
                    format!("/ {} ", self.title),
                    Style::default().add_modifier(Modifier::BOLD),
                ),
                usize::from(header.width),
            )),
            header,
        );

        let fallback_content;
        let transcript_shortcut = self.keymap.open_transcript_hint();
        let materialized = if self.is_transcript() {
            let transcript = match transcript {
                Some(transcript) => transcript,
                None => {
                    fallback_content = TranscriptContent::from_lines(transcript_lines.to_vec());
                    &fallback_content
                }
            };
            Some(self.disclosure.materialize_with_shortcut(
                transcript,
                locale,
                content.width,
                transcript_shortcut.as_deref(),
            ))
        } else {
            None
        };
        let selection_snapshot = self.transcript_selection.snapshot_lines();
        let selection_excluded = self.transcript_selection.snapshot_excluded_lines();
        let status_lines;
        let lines = if let Some(snapshot) = self.status_snapshot.as_ref() {
            status_lines = snapshot
                .lines(locale, content.width)
                .into_iter()
                .map(HyperlinkLine::new)
                .collect::<Vec<_>>();
            status_lines.as_slice()
        } else if let Some(lines) = self.static_lines.as_deref() {
            lines
        } else if let Some(snapshot) = selection_snapshot.as_ref() {
            snapshot.as_slice()
        } else {
            materialized
                .as_ref()
                .map_or(transcript_lines, |rendered| rendered.lines.as_slice())
        };
        let empty_excluded = HashSet::new();
        let excluded_lines = selection_excluded.as_deref().unwrap_or_else(|| {
            materialized
                .as_ref()
                .map_or(&empty_excluded, |rendered| &rendered.excluded_lines)
        });
        self.search.prepare(
            lines,
            content.width,
            excluded_lines,
            selection_snapshot.is_some(),
        );
        let highlighted_lines = if self.search.is_active() {
            self.search.highlighted_lines(lines)
        } else {
            Vec::new()
        };
        let lines_to_render = if self.search.is_active() && selection_snapshot.is_none() {
            &highlighted_lines[..]
        } else {
            lines
        };
        let paragraph = HyperlinkParagraph::new(lines_to_render);
        let total_height = paragraph.line_count(content.width);
        let page_height = usize::from(content.height);
        let max_scroll = total_height.saturating_sub(page_height);
        let transcript_frame = (self.is_transcript() && selection_snapshot.is_none()).then(|| {
            TranscriptFrame::new(
                lines.to_vec(),
                materialized
                    .as_ref()
                    .map(|rendered| rendered.anchor_ranges.clone())
                    .unwrap_or_default(),
                content.width,
            )
        });
        if let Some(frame) = transcript_frame.as_ref() {
            self.remap_transcript_anchor(frame, max_scroll);
        }
        let mut scroll = if self.pinned_to_bottom.get() {
            max_scroll
        } else {
            self.scroll.get().min(max_scroll)
        };
        if let Some(selected) = self.search.selected_match() {
            let page_height = page_height.max(1);
            if selected.row_start < scroll
                || selected.row_start >= scroll.saturating_add(page_height)
            {
                scroll = selected.row_start.min(max_scroll);
            }
        }
        if self.is_transcript() && selection_snapshot.is_none() {
            if let Some(materialized) = materialized.as_ref() {
                self.disclosure.update_layout(materialized, content, scroll);
                if let Some(anchored) = self.disclosure.apply_pending_anchor(max_scroll) {
                    scroll = anchored;
                    self.disclosure.update_layout(materialized, content, scroll);
                }
            }
        }
        self.scroll.set(scroll);
        self.page_height.set(page_height.max(1));
        self.max_scroll.set(max_scroll);
        frame.render_widget(
            paragraph.scroll(u16::try_from(scroll).unwrap_or(u16::MAX)),
            content,
        );
        if self.is_transcript() {
            self.transcript_selection.update_layout_with_exclusions(
                content,
                scroll,
                lines,
                excluded_lines,
            );
            self.transcript_selection
                .render_highlight(frame.buffer_mut());
        }

        let visible_rows = total_height
            .saturating_sub(scroll)
            .min(usize::from(content.height));
        for row in visible_rows..usize::from(content.height) {
            frame.render_widget(
                Paragraph::new("~").style(Style::default().fg(Color::DarkGray)),
                Rect::new(
                    content.x,
                    content
                        .y
                        .saturating_add(u16::try_from(row).unwrap_or(u16::MAX)),
                    content.width,
                    1,
                ),
            );
        }

        if separator.height > 0 {
            let percent = scroll
                .saturating_mul(100)
                .checked_div(max_scroll)
                .unwrap_or(100);
            let percentage = format!(" {percent}% ");
            let line = format!(
                "{}{}",
                "─".repeat(usize::from(area.width).saturating_sub(percentage.len())),
                percentage
            );
            frame.render_widget(
                Paragraph::new(truncate_line_with_ellipsis_if_overflow(
                    Line::styled(line, Style::default().fg(Color::DarkGray)),
                    usize::from(separator.width),
                )),
                separator,
            );
        }
        if footer.height > 0 {
            let footer_text = if let Some(feedback) = self.transcript_copy_feedback {
                match feedback.result {
                    Ok(CopyStatus::Confirmed) => {
                        locale.transcript_copy_confirmed(feedback.characters)
                    }
                    Ok(CopyStatus::Unconfirmed) => locale.transcript_copy_unconfirmed().to_string(),
                    Err(()) => locale.transcript_copy_failed().to_string(),
                }
            } else if self.search.is_active() {
                let status = search_status(&self.search, locale);
                format!(
                    "{}{}▏  {}",
                    locale.transcript_search_label(),
                    self.search.query(),
                    status
                )
            } else if self.is_transcript()
                && self.history_load_state.get() == HistoryLoadState::Loading
            {
                locale.transcript_pager_loading().to_string()
            } else if self.is_transcript()
                && self.history_load_state.get() == HistoryLoadState::Failed
            {
                locale.transcript_pager_retry_footer().to_string()
            } else if self.is_transcript() && self.disclosure.is_focused() {
                locale.transcript_activity_focus_footer().to_string()
            } else if self.is_transcript() && self.disclosure.has_controls() {
                locale.transcript_pager_activity_footer(&self.keymap.pager_close_hint())
            } else if self.is_transcript() {
                match self.history_load_state.get() {
                    HistoryLoadState::Loading => locale.transcript_pager_loading().to_string(),
                    HistoryLoadState::Failed => locale.transcript_pager_retry_footer().to_string(),
                    HistoryLoadState::Idle => locale.transcript_pager_footer(
                        &self.keymap.pager_page_down_hint(),
                        &self.keymap.pager_find_hint(),
                        &self.keymap.pager_close_hint(),
                    ),
                }
            } else {
                locale.pager_footer().to_string()
            };
            frame.render_widget(
                Paragraph::new(truncate_line_with_ellipsis_if_overflow(
                    Line::styled(footer_text, Style::default().fg(Color::DarkGray)),
                    usize::from(footer.width),
                )),
                footer,
            );
        }
        if let Some(frame) = transcript_frame {
            *self.previous_transcript_frame.borrow_mut() = Some(frame);
        }
    }

    /// Preserve the same logical transcript row across prepended history and width reflow.
    ///
    /// `scroll` is measured in wrapped terminal rows, while the projection is a sequence of
    /// logical `HyperlinkLine`s. We first identify the old logical line and intra-line offset,
    /// then map that line through a pure prefix/suffix or unchanged-index relationship. If the
    /// user is pinned to the bottom, normal tail-following remains authoritative.
    fn remap_transcript_anchor(&self, frame: &TranscriptFrame, max_scroll: usize) {
        if let Some(bookmark) = self.pending_transcript_bookmark.borrow_mut().take() {
            self.pinned_to_bottom.set(bookmark.following());
            if let Some(scroll) = bookmark.resolve(frame, max_scroll) {
                self.scroll.set(scroll);
                return;
            }
            self.scroll.set(bookmark.fallback_scroll().min(max_scroll));
        }
        if self.pinned_to_bottom.get() {
            return;
        }
        let Some(previous) = self.previous_transcript_frame.borrow().as_ref().cloned() else {
            return;
        };
        let stable = TranscriptBookmark::capture(&previous, false, self.scroll.get());
        if let Some(scroll) = stable.resolve(frame, max_scroll) {
            self.scroll.set(scroll);
            return;
        }
        let lines = frame.lines();
        let previous_lines = previous.lines();
        if previous_lines.is_empty() || lines.is_empty() {
            return;
        }
        let old_width = previous.width();
        let width = frame.width();
        if old_width == 0 || width == 0 {
            return;
        }

        let old_starts = wrapped_line_starts(previous_lines, old_width);
        let old_scroll = self.scroll.get();
        let old_line = old_starts
            .iter()
            .enumerate()
            .rev()
            .find(|(_, start)| **start <= old_scroll)
            .map(|(index, start)| (index, old_scroll.saturating_sub(*start)))
            .unwrap_or((0, old_scroll));

        let common_prefix = previous_lines
            .iter()
            .zip(lines)
            .take_while(|(old, new)| old == new)
            .count();
        let common_suffix = previous_lines
            .iter()
            .rev()
            .zip(lines.iter().rev())
            .take_while(|(old, new)| old == new)
            .count()
            .min(previous_lines.len().saturating_sub(common_prefix));
        let mapped_line = if lines.len() == previous_lines.len()
            && (common_prefix > 0 || common_suffix > 0 || previous_lines.len() == 1)
        {
            // Streaming updates replace the active canonical line in place. The visible text (and
            // therefore `HyperlinkLine` equality) changes, but its logical transcript identity is
            // stable, so keep the same line index while recomputing its wrapped height below.
            old_line.0
        } else if lines.len() >= previous_lines.len()
            && lines[lines.len() - previous_lines.len()..] == previous_lines[..]
        {
            old_line.0 + lines.len() - previous_lines.len()
        } else if lines.len() >= previous_lines.len()
            && lines[..previous_lines.len()] == previous_lines[..]
        {
            old_line.0
        } else {
            return;
        };

        let new_starts = wrapped_line_starts(lines, width);
        let Some(new_start) = new_starts.get(mapped_line).copied() else {
            return;
        };
        let new_height = new_starts
            .get(mapped_line + 1)
            .copied()
            .unwrap_or_else(|| HyperlinkParagraph::new(&lines[mapped_line..]).line_count(width));
        self.scroll
            .set(new_start.saturating_add(old_line.1.min(new_height.saturating_sub(1))));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::status::StatusFacts;
    use crate::terminal_hyperlinks::TerminalHyperlink;
    use crate::transcript_view::find_literal_ranges;
    use crossterm::event::{
        KeyCode, KeyEvent, KeyModifiers, MouseButton, MouseEvent, MouseEventKind,
    };
    use ratatui::backend::TestBackend;
    use ratatui::text::Span;
    use ratatui::Terminal;

    fn key(code: KeyCode) -> Event {
        Event::Key(KeyEvent::new(code, KeyModifiers::NONE))
    }

    fn mouse(kind: MouseEventKind, column: u16, row: u16) -> Event {
        Event::Mouse(MouseEvent {
            kind,
            column,
            row,
            modifiers: KeyModifiers::NONE,
        })
    }

    fn buffer_text(terminal: &Terminal<TestBackend>) -> String {
        let buffer = terminal.backend().buffer();
        (0..buffer.area.height)
            .map(|y| {
                (0..buffer.area.width)
                    .map(|x| buffer[(x, y)].symbol())
                    .collect::<String>()
            })
            .collect::<Vec<_>>()
            .join("\n")
    }

    #[test]
    fn static_overlay_wraps_scrolls_jumps_and_closes() {
        let mut overlay = PagerOverlay::new(
            "STATUS".to_string(),
            (0..8)
                .map(|index| {
                    Line::raw(format!(
                        "line {index}: a very long status value that wraps in a narrow terminal"
                    ))
                })
                .collect(),
        );
        let mut terminal = Terminal::new(TestBackend::new(24, 5)).expect("terminal");
        terminal
            .draw(|frame| overlay.render(frame, frame.area(), Locale::EnUs, &[]))
            .expect("draw");
        assert!(overlay.max_scroll.get() > 0);
        assert!(buffer_text(&terminal).contains("line 0: a very long"));

        assert_eq!(
            overlay.handle_event(&key(KeyCode::Down)),
            PagerAction::Consumed
        );
        assert_eq!(overlay.scroll.get(), 1);
        assert_eq!(
            overlay.handle_event(&key(KeyCode::PageDown)),
            PagerAction::Consumed
        );
        assert_eq!(overlay.scroll.get(), 3);
        assert_eq!(
            overlay.handle_event(&key(KeyCode::Up)),
            PagerAction::Consumed
        );
        assert_eq!(overlay.scroll.get(), 2);

        assert_eq!(
            overlay.handle_event(&key(KeyCode::End)),
            PagerAction::Consumed
        );
        assert_eq!(overlay.scroll.get(), overlay.max_scroll.get());
        assert_eq!(
            overlay.handle_event(&key(KeyCode::PageUp)),
            PagerAction::Consumed
        );
        assert!(overlay.scroll.get() < overlay.max_scroll.get());
        assert_eq!(
            overlay.handle_event(&key(KeyCode::Home)),
            PagerAction::Consumed
        );
        assert_eq!(overlay.scroll.get(), 0);
        assert_eq!(overlay.handle_event(&key(KeyCode::Esc)), PagerAction::Close);
    }

    #[test]
    fn resize_recomputes_scroll_bounds_and_tiny_areas_do_not_panic() {
        let overlay = PagerOverlay::new(
            "STATUS".to_string(),
            vec![Line::raw(
                "a long value that needs several rows in a narrow viewport",
            )],
        );
        let mut narrow = Terminal::new(TestBackend::new(10, 5)).expect("terminal");
        narrow
            .draw(|frame| overlay.render(frame, frame.area(), Locale::EnUs, &[]))
            .expect("narrow draw");
        assert!(overlay.max_scroll.get() > 0);
        overlay.scroll.set(overlay.max_scroll.get());

        let mut wide = Terminal::new(TestBackend::new(80, 12)).expect("terminal");
        wide.draw(|frame| overlay.render(frame, frame.area(), Locale::EnUs, &[]))
            .expect("wide draw");
        assert_eq!(overlay.max_scroll.get(), 0);
        assert_eq!(overlay.scroll.get(), 0);
        assert_eq!(overlay.page_height.get(), 9);

        let mut tiny = Terminal::new(TestBackend::new(1, 1)).expect("terminal");
        tiny.draw(|frame| {
            overlay.render(frame, Rect::new(0, 0, 0, 0), Locale::EnUs, &[]);
            overlay.render(frame, frame.area(), Locale::EnUs, &[]);
        })
        .expect("tiny draw");
    }

    #[test]
    fn status_overlay_uses_current_values_without_a_second_session_model() {
        let overlay = PagerOverlay::status(
            Locale::EnUs,
            StatusFacts {
                thread_id: Some("thread-1"),
                model: Some("gpt-5"),
                provider: Some("openai"),
                effort: Some("high"),
                permissions: Some(":workspace"),
                cwd: "/workspace",
                status: "running",
            },
        );
        let text = overlay
            .static_lines
            .as_ref()
            .expect("status lines")
            .iter()
            .flat_map(|line| &line.line.spans)
            .map(|span| span.content.as_ref())
            .collect::<String>();

        for value in [
            "thread-1",
            "gpt-5",
            "openai",
            "high",
            ":workspace",
            "/workspace",
            "running",
        ] {
            assert!(text.contains(value), "missing {value}: {text}");
        }
    }

    #[test]
    fn status_overlay_localizes_an_empty_projection_status_as_ready() {
        for locale in [
            Locale::ZhCn,
            Locale::ZhTw,
            Locale::EnUs,
            Locale::JaJp,
            Locale::KoKr,
        ] {
            let overlay = PagerOverlay::status(
                locale,
                StatusFacts {
                    thread_id: None,
                    model: None,
                    provider: None,
                    effort: None,
                    permissions: None,
                    cwd: "/workspace",
                    status: "",
                },
            );
            let text = overlay
                .static_lines
                .as_ref()
                .expect("status lines")
                .iter()
                .flat_map(|line| &line.line.spans)
                .map(|span| span.content.as_ref())
                .collect::<String>();

            assert!(text.contains(locale.ready_label()), "{locale:?}: {text}");
        }
    }

    #[test]
    fn transcript_overlay_starts_at_tail_follows_updates_and_closes_with_ctrl_t() {
        let mut overlay = PagerOverlay::transcript(Locale::EnUs);
        let initial = (0..8)
            .map(|index| HyperlinkLine::from(format!("line {index}")))
            .collect::<Vec<_>>();
        let mut terminal = Terminal::new(TestBackend::new(24, 6)).expect("terminal");
        terminal
            .draw(|frame| overlay.render(frame, frame.area(), Locale::EnUs, &initial))
            .expect("initial draw");
        assert_eq!(overlay.scroll.get(), overlay.max_scroll.get());
        assert!(buffer_text(&terminal).contains("line 7"));

        let updated = (0..10)
            .map(|index| HyperlinkLine::from(format!("line {index}")))
            .collect::<Vec<_>>();
        terminal
            .draw(|frame| overlay.render(frame, frame.area(), Locale::EnUs, &updated))
            .expect("updated draw");
        assert_eq!(overlay.scroll.get(), overlay.max_scroll.get());
        assert!(buffer_text(&terminal).contains("line 9"));

        assert_eq!(
            overlay.handle_event(&Event::Key(KeyEvent::new(
                KeyCode::Char('t'),
                KeyModifiers::CONTROL,
            ))),
            PagerAction::Close
        );
    }

    #[test]
    fn transcript_selection_owns_copy_without_destroying_active_search() {
        let mut overlay = PagerOverlay::transcript(Locale::EnUs);
        let lines = vec![HyperlinkLine::from("alpha beta")];
        let mut terminal = Terminal::new(TestBackend::new(40, 8)).expect("terminal");
        terminal
            .draw(|frame| overlay.render(frame, frame.area(), Locale::EnUs, &lines))
            .expect("draw");
        overlay.handle_event(&key(KeyCode::Char('/')));
        overlay.handle_event(&key(KeyCode::Char('a')));

        for event in [
            mouse(MouseEventKind::Down(MouseButton::Left), 0, 1),
            mouse(MouseEventKind::Drag(MouseButton::Left), 5, 1),
            mouse(MouseEventKind::Up(MouseButton::Left), 5, 1),
        ] {
            assert_eq!(overlay.handle_event(&event), PagerAction::Consumed);
        }

        assert!(overlay.search.is_active());
        assert_eq!(overlay.search.query(), "a");
        assert_eq!(
            overlay.handle_event(&Event::Key(KeyEvent::new(
                KeyCode::Char('c'),
                KeyModifiers::CONTROL | KeyModifiers::SHIFT,
            ))),
            PagerAction::CopyTranscriptSelection {
                text: "alpha".to_string(),
                follow: false,
            }
        );
        assert!(overlay.search.is_active());
        assert_eq!(overlay.search.query(), "a");

        assert_eq!(
            overlay.handle_event(&key(KeyCode::Esc)),
            PagerAction::Consumed
        );
        assert!(
            overlay.search.is_active(),
            "first Escape clears only selection"
        );
        assert_eq!(
            overlay.handle_event(&key(KeyCode::Esc)),
            PagerAction::Consumed
        );
        assert!(!overlay.search.is_active(), "second Escape closes search");
    }

    #[test]
    fn transcript_wheel_and_keyboard_selection_keep_scroll_in_pager_owner() {
        let mut overlay = PagerOverlay::transcript(Locale::EnUs);
        let lines = (0..20)
            .map(|index| HyperlinkLine::from(format!("line {index}")))
            .collect::<Vec<_>>();
        let mut terminal = Terminal::new(TestBackend::new(20, 8)).expect("terminal");
        terminal
            .draw(|frame| overlay.render(frame, frame.area(), Locale::EnUs, &lines))
            .expect("draw");
        let tail = overlay.max_scroll.get();

        assert_eq!(
            overlay.handle_event(&mouse(MouseEventKind::ScrollUp, 0, 1)),
            PagerAction::Consumed
        );
        assert_eq!(overlay.scroll.get(), tail.saturating_sub(3));
        assert!(!overlay.pinned_to_bottom.get());
        terminal
            .draw(|frame| overlay.render(frame, frame.area(), Locale::EnUs, &lines))
            .expect("wheel redraw");

        assert_eq!(
            overlay.handle_event(&Event::Key(KeyEvent::new(
                KeyCode::Char(' '),
                KeyModifiers::CONTROL,
            ))),
            PagerAction::Consumed
        );
        let before = overlay.scroll.get();
        for _ in 0..overlay.page_height.get() {
            assert_eq!(
                overlay.handle_event(&key(KeyCode::Down)),
                PagerAction::Consumed
            );
        }
        assert_eq!(overlay.scroll.get(), before.saturating_add(1));
    }

    #[test]
    fn transcript_edge_drag_scrolls_one_row_per_tick_and_extends_after_render() {
        let mut overlay = PagerOverlay::transcript(Locale::EnUs);
        let lines = (0..20)
            .map(|index| HyperlinkLine::from(format!("line {index}")))
            .collect::<Vec<_>>();
        let mut terminal = Terminal::new(TestBackend::new(20, 8)).expect("terminal");
        terminal
            .draw(|frame| overlay.render(frame, frame.area(), Locale::EnUs, &lines))
            .expect("tail draw");
        assert_eq!(
            overlay.handle_event(&key(KeyCode::Home)),
            PagerAction::Consumed
        );
        terminal
            .draw(|frame| overlay.render(frame, frame.area(), Locale::EnUs, &lines))
            .expect("top draw");

        assert_eq!(
            overlay.handle_event(&mouse(MouseEventKind::Down(MouseButton::Left), 0, 2)),
            PagerAction::Consumed
        );
        assert_eq!(
            overlay.handle_event(&mouse(MouseEventKind::Drag(MouseButton::Left), 6, 5)),
            PagerAction::ContinueTranscriptSelection
        );
        assert_eq!(
            overlay
                .transcript_selection
                .selected_text_for_test()
                .as_deref(),
            Some("line 1\nline 2\nline 3\nline 4")
        );

        assert!(overlay.tick_transcript_selection());
        assert_eq!(overlay.scroll.get(), 1);
        terminal
            .draw(|frame| overlay.render(frame, frame.area(), Locale::EnUs, &lines))
            .expect("edge tick draw");
        assert_eq!(
            overlay
                .transcript_selection
                .selected_text_for_test()
                .as_deref(),
            Some("line 1\nline 2\nline 3\nline 4\nline 5")
        );

        while overlay.tick_transcript_selection() {
            terminal
                .draw(|frame| overlay.render(frame, frame.area(), Locale::EnUs, &lines))
                .expect("continued edge tick draw");
        }
        assert_eq!(overlay.scroll.get(), overlay.max_scroll.get());
        assert!(!overlay.tick_transcript_selection());
    }

    #[test]
    fn horizontal_edge_drag_and_focus_loss_do_not_continue_scrolling() {
        let mut overlay = PagerOverlay::transcript(Locale::EnUs);
        let lines = (0..20)
            .map(|index| HyperlinkLine::from(format!("line {index}")))
            .collect::<Vec<_>>();
        let mut terminal = Terminal::new(TestBackend::new(20, 8)).expect("terminal");
        terminal
            .draw(|frame| overlay.render(frame, frame.area(), Locale::EnUs, &lines))
            .expect("tail draw");
        overlay.handle_event(&key(KeyCode::Home));
        terminal
            .draw(|frame| overlay.render(frame, frame.area(), Locale::EnUs, &lines))
            .expect("top draw");
        overlay.handle_event(&key(KeyCode::Down));
        overlay.handle_event(&key(KeyCode::Down));
        terminal
            .draw(|frame| overlay.render(frame, frame.area(), Locale::EnUs, &lines))
            .expect("reading-position draw");

        overlay.handle_event(&mouse(MouseEventKind::Down(MouseButton::Left), 0, 1));
        assert_eq!(
            overlay.handle_event(&mouse(MouseEventKind::Drag(MouseButton::Left), 4, 1)),
            PagerAction::Consumed
        );
        assert!(!overlay.tick_transcript_selection());

        overlay.handle_event(&mouse(MouseEventKind::Drag(MouseButton::Left), 4, 3));
        overlay.handle_event(&mouse(MouseEventKind::Drag(MouseButton::Left), 4, 1));
        assert!(overlay.tick_transcript_selection());
        let selected = overlay.transcript_selection.selected_text_for_test();
        assert_eq!(
            overlay.handle_event(&Event::FocusLost),
            PagerAction::Consumed
        );
        assert!(!overlay.tick_transcript_selection());
        assert_eq!(
            overlay.transcript_selection.selected_text_for_test(),
            selected
        );
    }

    #[test]
    fn transcript_link_action_requires_stationary_release() {
        let mut overlay = PagerOverlay::transcript(Locale::EnUs);
        let mut link = HyperlinkLine::from("docs");
        link.hyperlinks.push(TerminalHyperlink::web(
            0..4,
            "https://example.com/docs".to_string(),
        ));
        let mut terminal = Terminal::new(TestBackend::new(20, 6)).expect("terminal");
        terminal
            .draw(|frame| overlay.render(frame, frame.area(), Locale::EnUs, &[link]))
            .expect("draw");

        assert_eq!(
            overlay.handle_event(&mouse(MouseEventKind::Down(MouseButton::Left), 1, 1)),
            PagerAction::Consumed
        );
        assert_eq!(
            overlay.handle_event(&mouse(MouseEventKind::Up(MouseButton::Left), 1, 1)),
            PagerAction::OpenLink("https://example.com/docs".to_string())
        );
    }

    #[test]
    fn transcript_enter_copy_confirmation_resumes_tail_following() {
        let mut overlay = PagerOverlay::transcript(Locale::EnUs);
        let lines = (0..20)
            .map(|index| HyperlinkLine::from(format!("line {index}")))
            .collect::<Vec<_>>();
        let mut terminal = Terminal::new(TestBackend::new(20, 6)).expect("terminal");
        terminal
            .draw(|frame| overlay.render(frame, frame.area(), Locale::EnUs, &lines))
            .expect("tail draw");
        overlay.handle_event(&key(KeyCode::Home));
        terminal
            .draw(|frame| overlay.render(frame, frame.area(), Locale::EnUs, &lines))
            .expect("top draw");
        assert!(!overlay.pinned_to_bottom.get());
        overlay.handle_event(&key(KeyCode::Char('/')));
        overlay.handle_event(&key(KeyCode::Char('l')));
        assert!(overlay.search.is_active());

        for event in [
            mouse(MouseEventKind::Down(MouseButton::Left), 0, 1),
            mouse(MouseEventKind::Drag(MouseButton::Left), 4, 1),
            mouse(MouseEventKind::Up(MouseButton::Left), 4, 1),
        ] {
            overlay.handle_event(&event);
        }
        assert_eq!(
            overlay.handle_event(&key(KeyCode::Enter)),
            PagerAction::CopyTranscriptSelection {
                text: "line".to_string(),
                follow: true,
            }
        );

        overlay.apply_transcript_copy_result(
            true,
            4,
            &Ok(crate::clipboard_copy::CopyStatus::Unconfirmed),
        );
        assert!(!overlay.pinned_to_bottom.get());
        assert!(overlay.has_transcript_selection());
        assert!(overlay.search.is_active());
        terminal
            .draw(|frame| overlay.render(frame, frame.area(), Locale::EnUs, &lines))
            .expect("unconfirmed draw");
        assert!(buffer_text(&terminal).contains("Copy sent to term"));

        overlay.apply_transcript_copy_result(
            true,
            4,
            &Ok(crate::clipboard_copy::CopyStatus::Confirmed),
        );
        assert!(overlay.pinned_to_bottom.get());
        assert_eq!(overlay.scroll.get(), overlay.max_scroll.get());
        assert!(!overlay.has_transcript_selection());
        assert!(!overlay.search.is_active());
        terminal
            .draw(|frame| overlay.render(frame, frame.area(), Locale::EnUs, &lines))
            .expect("confirmed draw");
        assert!(buffer_text(&terminal).contains("Copied 4 chars"));
    }

    #[test]
    fn transcript_overlay_requests_older_history_when_scrolled_to_the_top() {
        let mut overlay = PagerOverlay::transcript(Locale::EnUs);
        overlay.set_older_history_available(true);
        let lines = (0..12)
            .map(|index| HyperlinkLine::from(format!("line {index}")))
            .collect::<Vec<_>>();
        let mut terminal = Terminal::new(TestBackend::new(24, 6)).expect("terminal");
        terminal
            .draw(|frame| overlay.render(frame, frame.area(), Locale::EnUs, &lines))
            .expect("initial draw");

        assert_eq!(
            overlay.handle_event(&key(KeyCode::Home)),
            PagerAction::LoadOlderHistory
        );
        assert_eq!(overlay.scroll.get(), 0);
        assert!(!overlay.pinned_to_bottom.get());
        assert_eq!(
            overlay.handle_event(&key(KeyCode::PageUp)),
            PagerAction::LoadOlderHistory
        );
    }

    #[test]
    fn static_overlay_never_requests_older_history() {
        let mut overlay = PagerOverlay::new("STATUS".to_string(), vec![Line::raw("line")]);
        assert_eq!(
            overlay.handle_event(&key(KeyCode::Home)),
            PagerAction::Consumed
        );
    }

    #[test]
    fn transcript_overlay_without_older_history_consumes_top_navigation() {
        let mut overlay = PagerOverlay::transcript(Locale::EnUs);
        assert_eq!(
            overlay.handle_event(&key(KeyCode::Home)),
            PagerAction::Consumed
        );
    }

    #[test]
    fn transcript_history_failure_keeps_anchor_and_exposes_home_retry() {
        let mut overlay = PagerOverlay::transcript(Locale::EnUs);
        overlay.set_older_history_available(true);
        let lines = (0..16)
            .map(|index| HyperlinkLine::from(format!("line {index}")))
            .collect::<Vec<_>>();
        let mut terminal = Terminal::new(TestBackend::new(48, 8)).expect("terminal");
        terminal
            .draw(|frame| overlay.render(frame, frame.area(), Locale::EnUs, &lines))
            .expect("initial draw");
        overlay.handle_event(&key(KeyCode::PageUp));
        let anchor = overlay.scroll.get();
        assert!(anchor > 0);

        overlay.begin_older_history_load();
        terminal
            .draw(|frame| overlay.render(frame, frame.area(), Locale::EnUs, &lines))
            .expect("loading draw");
        assert!(buffer_text(&terminal).contains("Loading older history"));

        overlay.fail_older_history_load();
        terminal
            .draw(|frame| overlay.render(frame, frame.area(), Locale::EnUs, &lines))
            .expect("failed draw");
        assert_eq!(overlay.scroll.get(), anchor);
        assert!(buffer_text(&terminal).contains("History load failed"));
        assert!(buffer_text(&terminal).contains("Home retry"));
        assert_eq!(
            overlay.handle_event(&key(KeyCode::Home)),
            PagerAction::LoadOlderHistory
        );

        overlay.begin_older_history_load();
        overlay.complete_older_history_load();
        assert_eq!(overlay.history_load_state.get(), HistoryLoadState::Idle);
    }

    #[test]
    fn transcript_overlay_reset_anchor_keeps_newly_loaded_beginning_visible() {
        let overlay = PagerOverlay::transcript(Locale::EnUs);
        let old_lines = vec![HyperlinkLine::from("oldest loaded")];
        let mut terminal = Terminal::new(TestBackend::new(24, 6)).expect("terminal");
        terminal
            .draw(|frame| overlay.render(frame, frame.area(), Locale::EnUs, &old_lines))
            .expect("initial draw");

        overlay.reset_transcript_anchor_at_top();
        let lines = vec![
            HyperlinkLine::from("actual oldest"),
            HyperlinkLine::from("oldest loaded"),
        ];
        terminal
            .draw(|frame| overlay.render(frame, frame.area(), Locale::EnUs, &lines))
            .expect("expanded draw");

        assert_eq!(overlay.scroll.get(), 0);
    }

    #[test]
    fn transcript_overlay_preserves_manual_scroll_when_projection_grows() {
        let mut overlay = PagerOverlay::transcript(Locale::EnUs);
        let initial = (0..10)
            .map(|index| HyperlinkLine::from(format!("line {index}")))
            .collect::<Vec<_>>();
        let mut terminal = Terminal::new(TestBackend::new(24, 6)).expect("terminal");
        terminal
            .draw(|frame| overlay.render(frame, frame.area(), Locale::EnUs, &initial))
            .expect("initial draw");
        overlay.handle_event(&key(KeyCode::Up));
        let manual_scroll = overlay.scroll.get();

        let updated = (0..12)
            .map(|index| HyperlinkLine::from(format!("line {index}")))
            .collect::<Vec<_>>();
        terminal
            .draw(|frame| overlay.render(frame, frame.area(), Locale::EnUs, &updated))
            .expect("updated draw");

        assert_eq!(overlay.scroll.get(), manual_scroll);
        assert!(!overlay.pinned_to_bottom.get());
    }

    #[test]
    fn transcript_overlay_preserves_manual_anchor_when_history_is_prepended() {
        let mut overlay = PagerOverlay::transcript(Locale::EnUs);
        let initial = (0..20)
            .map(|index| HyperlinkLine::from(format!("line {index}")))
            .collect::<Vec<_>>();
        let mut terminal = Terminal::new(TestBackend::new(24, 6)).expect("terminal");
        terminal
            .draw(|frame| overlay.render(frame, frame.area(), Locale::EnUs, &initial))
            .expect("initial draw");
        overlay.handle_event(&key(KeyCode::PageUp));
        let previous_scroll = overlay.scroll.get();
        assert!(!overlay.pinned_to_bottom.get());

        let mut updated = (0..3)
            .map(|index| HyperlinkLine::from(format!("older {index}")))
            .collect::<Vec<_>>();
        updated.extend(initial);
        terminal
            .draw(|frame| overlay.render(frame, frame.area(), Locale::EnUs, &updated))
            .expect("prepended draw");

        assert_eq!(overlay.scroll.get(), previous_scroll + 3);
        assert!(!overlay.pinned_to_bottom.get());
    }

    #[test]
    fn transcript_overlay_remaps_manual_anchor_when_width_reflows() {
        let overlay = PagerOverlay::transcript(Locale::EnUs);
        let mut lines = vec![
            HyperlinkLine::from("a long first transcript line that wraps after resize"),
            HyperlinkLine::from("anchor line"),
        ];
        lines.extend((0..8).map(|index| HyperlinkLine::from(format!("tail {index}"))));
        let mut wide = Terminal::new(TestBackend::new(48, 6)).expect("wide terminal");
        wide.draw(|frame| overlay.render(frame, frame.area(), Locale::EnUs, &lines))
            .expect("wide draw");
        overlay.scroll.set(wrapped_line_starts(&lines, 48)[1]);
        overlay.pinned_to_bottom.set(false);

        let mut narrow = Terminal::new(TestBackend::new(16, 6)).expect("narrow terminal");
        narrow
            .draw(|frame| overlay.render(frame, frame.area(), Locale::EnUs, &lines))
            .expect("narrow draw");

        let expected = wrapped_line_starts(&lines, 16)[1];
        assert!(expected > 1);
        assert_eq!(overlay.scroll.get(), expected);
        assert!(!overlay.pinned_to_bottom.get());
    }

    #[test]
    fn transcript_overlay_remaps_manual_anchor_when_streaming_line_grows_in_place() {
        let overlay = PagerOverlay::transcript(Locale::EnUs);
        let initial = vec![
            HyperlinkLine::from("stable header"),
            HyperlinkLine::from("anchor line"),
            HyperlinkLine::from("tail line"),
        ];
        let mut terminal = Terminal::new(TestBackend::new(18, 4)).expect("terminal");
        terminal
            .draw(|frame| overlay.render(frame, frame.area(), Locale::EnUs, &initial))
            .expect("initial draw");
        overlay.pinned_to_bottom.set(false);
        overlay.scroll.set(wrapped_line_starts(&initial, 18)[1]);

        let updated = vec![
            HyperlinkLine::from("stable header that grew while streaming"),
            HyperlinkLine::from("anchor line"),
            HyperlinkLine::from("tail line"),
        ];
        terminal
            .draw(|frame| overlay.render(frame, frame.area(), Locale::EnUs, &updated))
            .expect("streaming redraw");

        assert_eq!(
            overlay.scroll.get(),
            wrapped_line_starts(&updated, 18)[1],
            "the same logical anchor should remain visible after an in-place stream update"
        );
        assert!(!overlay.pinned_to_bottom.get());
    }

    #[test]
    fn transcript_bookmark_restores_stable_source_after_replacement_and_reflow() {
        let overlay = PagerOverlay::transcript(Locale::EnUs);
        let mut initial = TranscriptContent::default();
        initial.push_keyed_lines(
            "entry:older",
            vec![
                HyperlinkLine::from("older one"),
                HyperlinkLine::from("older two"),
                HyperlinkLine::from("older three"),
            ],
        );
        initial.push_keyed_lines(
            "entry:target",
            vec![
                HyperlinkLine::from("target first"),
                HyperlinkLine::from("target second"),
                HyperlinkLine::from("target third"),
            ],
        );
        initial.push_keyed_lines(
            "entry:tail",
            (0..6)
                .map(|index| HyperlinkLine::from(format!("tail {index}")))
                .collect(),
        );
        let mut wide = Terminal::new(TestBackend::new(24, 6)).expect("wide terminal");
        wide.draw(|frame| overlay.render_transcript(frame, frame.area(), Locale::EnUs, &initial))
            .expect("initial draw");
        overlay.pinned_to_bottom.set(false);
        overlay.scroll.set(3);
        let bookmark = overlay.bookmark();

        let mut updated = TranscriptContent::default();
        updated.push_keyed_lines(
            "entry:page",
            vec![
                HyperlinkLine::from("page one"),
                HyperlinkLine::from("page two"),
            ],
        );
        updated.push_keyed_lines(
            "entry:older",
            vec![
                HyperlinkLine::from("replacement older one"),
                HyperlinkLine::from("replacement older two"),
                HyperlinkLine::from("replacement older three"),
                HyperlinkLine::from("replacement older four"),
            ],
        );
        updated.push_keyed_lines(
            "entry:target",
            vec![
                HyperlinkLine::from("replacement target first"),
                HyperlinkLine::from("replacement target second"),
            ],
        );
        updated.push_keyed_lines(
            "entry:tail",
            (0..6)
                .map(|index| HyperlinkLine::from(format!("new tail {index}")))
                .collect(),
        );
        let materialized = overlay.disclosure.materialize(&updated, Locale::EnUs, 12);
        let expected = wrapped_line_starts(&materialized.lines, 12)[6];
        overlay.restore_bookmark(bookmark);

        let mut narrow = Terminal::new(TestBackend::new(12, 6)).expect("narrow terminal");
        narrow
            .draw(|frame| overlay.render_transcript(frame, frame.area(), Locale::EnUs, &updated))
            .expect("restored draw");

        assert_eq!(overlay.scroll.get(), expected);
        assert!(!overlay.pinned_to_bottom.get());
        let screen = buffer_text(&narrow);
        assert!(screen.contains("replacement"), "{screen}");
        assert!(screen.contains("target first"), "{screen}");
    }

    #[test]
    fn transcript_search_edits_highlights_and_navigates_matches() {
        let mut overlay = PagerOverlay::transcript(Locale::EnUs);
        let lines = vec![
            HyperlinkLine::from("Needle in the older entry"),
            HyperlinkLine::from("unrelated line"),
            HyperlinkLine::from("new NEEDLE in the latest entry"),
        ];
        let mut terminal = Terminal::new(TestBackend::new(100, 8)).expect("terminal");
        terminal
            .draw(|frame| overlay.render(frame, frame.area(), Locale::EnUs, &lines))
            .expect("initial draw");

        assert_eq!(
            overlay.handle_event(&key(KeyCode::Char('/'))),
            PagerAction::ScheduleFrame
        );
        for character in "needle".chars() {
            overlay.handle_event(&key(KeyCode::Char(character)));
        }
        terminal
            .draw(|frame| overlay.render(frame, frame.area(), Locale::EnUs, &lines))
            .expect("search draw");

        assert!(overlay.search.is_active());
        assert_eq!(overlay.search.query(), "needle");
        assert_eq!(overlay.search.match_count(), 2);
        // Find starts at the newest hit, matching Codex's backward history scan.
        assert_eq!(overlay.search.cursor(), 1);
        assert!(buffer_text(&terminal).contains("Find: needle"));
        let buffer = terminal.backend().buffer();
        assert!(buffer
            .content()
            .iter()
            .any(|cell| cell.style().add_modifier.contains(Modifier::REVERSED)));

        overlay.handle_event(&key(KeyCode::Enter));
        terminal
            .draw(|frame| overlay.render(frame, frame.area(), Locale::EnUs, &lines))
            .expect("next match draw");
        assert_eq!(overlay.search.cursor(), 1);
        assert!(overlay.search.selected_match().is_some_and(|search_match| {
            search_match.row_start >= overlay.scroll.get()
                && search_match.row_start
                    < overlay
                        .scroll
                        .get()
                        .saturating_add(overlay.page_height.get())
        }));

        overlay.handle_event(&Event::Key(KeyEvent::new(
            KeyCode::Enter,
            KeyModifiers::SHIFT,
        )));
        assert_eq!(overlay.search.cursor(), 0);
        overlay.handle_event(&Event::Key(KeyEvent::new(
            KeyCode::Enter,
            KeyModifiers::SHIFT,
        )));
        assert_eq!(overlay.search.cursor(), 0);
        terminal
            .draw(|frame| overlay.render(frame, frame.area(), Locale::EnUs, &lines))
            .expect("boundary draw");
        assert!(buffer_text(&terminal).contains("No more matches"));
        overlay.handle_event(&key(KeyCode::Esc));
        assert!(!overlay.search.is_active());
        assert!(overlay.search.query().is_empty());
    }

    #[test]
    fn transcript_pager_f3_and_slash_find_while_ctrl_f_pages_down() {
        let mut overlay = PagerOverlay::transcript(Locale::EnUs);
        let lines = (0..40)
            .map(|index| HyperlinkLine::from(format!("line {index:02}")))
            .collect::<Vec<_>>();
        let mut terminal = Terminal::new(TestBackend::new(80, 8)).expect("terminal");
        terminal
            .draw(|frame| overlay.render(frame, frame.area(), Locale::EnUs, &lines))
            .expect("initial draw");
        overlay.pinned_to_bottom.set(false);
        overlay.scroll.set(0);

        assert_eq!(
            overlay.handle_event(&Event::Key(KeyEvent::new(
                KeyCode::Char('f'),
                KeyModifiers::CONTROL,
            ))),
            PagerAction::Consumed
        );
        assert_eq!(overlay.scroll.get(), overlay.page_height.get());
        assert!(!overlay.search.is_active());

        assert_eq!(
            overlay.handle_event(&key(KeyCode::F(3))),
            PagerAction::ScheduleFrame
        );
        assert!(overlay.search.is_active());
        overlay.handle_event(&key(KeyCode::Esc));
        assert!(!overlay.search.is_active());

        assert_eq!(
            overlay.handle_event(&key(KeyCode::Char('/'))),
            PagerAction::ScheduleFrame
        );
        assert!(overlay.search.is_active());
    }

    #[test]
    fn transcript_pager_footer_uses_the_dispatched_keymap_hints() {
        let overlay = PagerOverlay::transcript(Locale::EnUs);
        let lines = vec![HyperlinkLine::from("line")];
        let mut terminal = Terminal::new(TestBackend::new(180, 6)).expect("terminal");
        terminal
            .draw(|frame| overlay.render(frame, frame.area(), Locale::EnUs, &lines))
            .expect("draw");

        let text = buffer_text(&terminal);
        assert!(text.contains("pgdn·space·ctrl+f"), "{text}");
        assert!(text.contains("f3·/ find"), "{text}");
        assert!(text.contains("ctrl+t·esc·q close"), "{text}");
    }

    #[test]
    fn transcript_pager_chord_does_not_cross_paste_boundary() {
        let mut config = lime_core::config::TuiKeymap::default();
        config.pager.find = Some(lime_core::config::KeybindingsSpec::One(
            lime_core::config::KeybindingSpec("ctrl-x f".to_string()),
        ));
        let keymap = crate::keymap::RuntimeKeymap::from_config(&config)
            .expect("custom pager chord must be valid");
        let mut overlay =
            PagerOverlay::transcript(Locale::EnUs).with_keymap(keymap.transcript().clone());

        assert_eq!(
            overlay.handle_event(&Event::Key(KeyEvent::new(
                KeyCode::Char('x'),
                KeyModifiers::CONTROL,
            ))),
            PagerAction::Consumed
        );
        assert_eq!(
            overlay.handle_event(&Event::Paste("paste".to_string())),
            PagerAction::Consumed
        );
        assert_eq!(
            overlay.handle_event(&Event::Key(KeyEvent::new(
                KeyCode::Char('f'),
                KeyModifiers::NONE,
            ))),
            PagerAction::Consumed
        );
        assert!(!overlay.search.is_active());
    }

    #[test]
    fn transcript_search_highlights_only_matching_graphemes_and_keeps_hyperlinks() {
        let mut overlay = PagerOverlay::transcript(Locale::EnUs);
        let mut line = HyperlinkLine::default();
        line.push_span(
            Span::raw("prefix needle suffix"),
            Some("https://example.com"),
        );
        let lines = vec![line];
        let mut terminal = Terminal::new(TestBackend::new(64, 6)).expect("terminal");
        terminal
            .draw(|frame| overlay.render(frame, frame.area(), Locale::EnUs, &lines))
            .expect("initial draw");
        overlay.handle_event(&key(KeyCode::Char('/')));
        for character in "needle".chars() {
            overlay.handle_event(&key(KeyCode::Char(character)));
        }
        terminal
            .draw(|frame| overlay.render(frame, frame.area(), Locale::EnUs, &lines))
            .expect("search draw");

        let buffer = terminal.backend().buffer();
        for column in 0..7 {
            assert!(!buffer[(column, 1)]
                .style()
                .add_modifier
                .contains(Modifier::REVERSED));
        }
        for column in 7..13 {
            assert!(buffer[(column, 1)]
                .style()
                .add_modifier
                .contains(Modifier::REVERSED));
        }
        for column in 13..20 {
            assert!(!buffer[(column, 1)]
                .style()
                .add_modifier
                .contains(Modifier::REVERSED));
        }
        assert_eq!(lines[0].hyperlinks.len(), 1);
        assert_eq!(lines[0].hyperlinks[0].columns, 0..20);
    }

    #[test]
    fn transcript_search_matches_unicode_case_folding_without_losing_source_ranges() {
        assert_eq!(find_literal_ranges("界 CAFÉ [x].* İ", "café"), vec![4..9]);
        assert_eq!(
            find_literal_ranges("界 CAFÉ [x].* İ", "[x].*"),
            vec![10..15]
        );
        assert_eq!(
            find_literal_ranges("界 CAFÉ [x].* İ", "i\u{307}"),
            vec![16..18]
        );
        assert!(find_literal_ranges("界 CAFÉ [x].* İ", "missing").is_empty());
    }

    #[test]
    fn transcript_search_editing_removes_complete_graphemes_and_paste_does_not_split_them() {
        let mut overlay = PagerOverlay::transcript(Locale::EnUs);
        overlay.handle_event(&key(KeyCode::Char('/')));
        overlay.handle_event(&Event::Key(KeyEvent::new(
            KeyCode::Char('N'),
            KeyModifiers::SHIFT,
        )));
        assert_eq!(overlay.search.query(), "N");
        overlay.handle_event(&key(KeyCode::Backspace));
        assert_eq!(
            overlay.handle_event(&Event::Paste("e\u{301}👩‍💻".to_string())),
            PagerAction::ScheduleFrame
        );
        assert_eq!(overlay.search.query(), "e\u{301}👩‍💻");
        overlay.handle_event(&key(KeyCode::Backspace));
        assert_eq!(overlay.search.query(), "e\u{301}");
        overlay.handle_event(&key(KeyCode::Backspace));
        assert!(overlay.search.query().is_empty());
    }

    #[test]
    fn transcript_search_footer_and_highlight_stay_renderable_on_narrow_localized_terminals() {
        let lines = vec![HyperlinkLine::from(
            "a long transcript line containing the searchable needle",
        )];
        for locale in [
            Locale::ZhCn,
            Locale::ZhTw,
            Locale::EnUs,
            Locale::JaJp,
            Locale::KoKr,
        ] {
            for width in [1, 2, 8, 24] {
                let mut overlay = PagerOverlay::transcript(locale);
                overlay.handle_event(&key(KeyCode::Char('/')));
                for character in "needle with a long query".chars() {
                    overlay.handle_event(&key(KeyCode::Char(character)));
                }
                let mut terminal = Terminal::new(TestBackend::new(width, 5)).expect("terminal");
                terminal
                    .draw(|frame| overlay.render(frame, frame.area(), locale, &lines))
                    .expect("narrow search draw");
                assert_eq!(terminal.backend().buffer().area.width, width);
            }
        }
    }

    #[test]
    fn transcript_search_requests_older_history_and_retries_after_a_failed_page() {
        let mut overlay = PagerOverlay::transcript(Locale::EnUs);
        overlay.set_older_history_available(true);
        let current_page = vec![HyperlinkLine::from("newer entry without the query")];
        let mut terminal = Terminal::new(TestBackend::new(80, 8)).expect("terminal");
        terminal
            .draw(|frame| overlay.render(frame, frame.area(), Locale::EnUs, &current_page))
            .expect("initial draw");
        overlay.handle_event(&key(KeyCode::Char('/')));
        for character in "needle".chars() {
            overlay.handle_event(&key(KeyCode::Char(character)));
        }
        terminal
            .draw(|frame| overlay.render(frame, frame.area(), Locale::EnUs, &current_page))
            .expect("search draw");

        assert_eq!(
            overlay.handle_event(&key(KeyCode::Enter)),
            PagerAction::LoadOlderHistory
        );
        overlay.begin_older_history_load();
        terminal
            .draw(|frame| overlay.render(frame, frame.area(), Locale::EnUs, &current_page))
            .expect("loading draw");
        assert!(buffer_text(&terminal).contains("Loading older history"));
        assert_eq!(
            overlay.handle_event(&key(KeyCode::Enter)),
            PagerAction::Consumed
        );

        overlay.fail_older_history_load();
        terminal
            .draw(|frame| overlay.render(frame, frame.area(), Locale::EnUs, &current_page))
            .expect("failed draw");
        assert!(buffer_text(&terminal).contains("History load failed"));
        assert_eq!(
            overlay.handle_event(&key(KeyCode::Home)),
            PagerAction::LoadOlderHistory
        );
        overlay.fail_older_history_load();
        assert_eq!(
            overlay.handle_event(&key(KeyCode::Enter)),
            PagerAction::LoadOlderHistory
        );

        overlay.complete_older_history_load();
        overlay.set_older_history_available(false);
        let all_history = vec![
            HyperlinkLine::from("old needle entry"),
            HyperlinkLine::from("newer entry without the query"),
        ];
        terminal
            .draw(|frame| overlay.render(frame, frame.area(), Locale::EnUs, &all_history))
            .expect("history loaded draw");
        assert_eq!(overlay.search.match_count(), 1);
        assert!(buffer_text(&terminal).contains("Match 1/1"));
    }
}
