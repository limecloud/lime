//! Pager drawing and canonical transcript geometry.

use super::*;

impl PagerOverlay {
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
            Some(self.disclosure.materialize_with_presentation(
                transcript,
                locale,
                content.width,
                transcript_shortcut.as_deref(),
                self.browsing.as_ref().map(|state| state.detailed),
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
        let browsing_range = self.browsing.as_ref().and_then(|state| {
            materialized
                .as_ref()?
                .anchor_ranges
                .iter()
                .find(|range| {
                    state
                        .item_id
                        .as_ref()
                        .is_some_and(|id| range.keys.contains(id))
                })
                .map(|range| range.lines.clone())
        });
        if let (Some(state), Some(range)) = (self.browsing.as_ref(), browsing_range.as_ref()) {
            if state.reveal.replace(false) {
                let starts = wrapped_line_starts(lines, content.width);
                if let Some(row) = starts.get(range.start) {
                    self.pinned_to_bottom.set(false);
                    self.scroll.set((*row).min(max_scroll));
                }
            }
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
        if let Some(range) = browsing_range {
            let starts = wrapped_line_starts(lines, content.width);
            let first = starts.get(range.start).copied().unwrap_or(0);
            let last = starts.get(range.end).copied().unwrap_or(total_height);
            for row in first..last {
                if row >= scroll && row < scroll.saturating_add(page_height) {
                    for column in content.x..content.right() {
                        frame.buffer_mut()[(column, content.y + (row - scroll) as u16)]
                            .set_bg(Color::DarkGray);
                    }
                }
            }
        }
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
            } else if let Some(state) = self
                .browsing
                .as_ref()
                .filter(|_| !self.has_active_interaction())
            {
                state
                    .footers
                    .iter()
                    .find(|text| crate::width::display_width(text) <= usize::from(footer.width))
                    .cloned()
                    .unwrap_or_default()
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
