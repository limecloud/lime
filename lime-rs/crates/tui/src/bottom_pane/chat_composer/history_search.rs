//! Composer-owned history query and preview; traversal belongs to `ChatComposerHistory`.

use ratatui::style::{Color, Style};
use ratatui::text::Span;
use std::ops::Range;

use super::*;

#[path = "history_search_draft.rs"]
mod draft;

#[derive(Debug, Default)]
pub(super) struct HistorySearchSession {
    pub(super) query: String,
    original_draft: ComposerDraft,
    preview_draft: Option<ComposerDraft>,
    original_vim_history: VimHistory,
    original_vim_state: VimPersistentState,
    pub(super) status: HistorySearchStatus,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub(super) enum HistorySearchStatus {
    #[default]
    Idle,
    Match,
    NoMatch,
    Searching,
    Unavailable,
}

impl HistorySearchSession {
    fn preview_draft(&self) -> &ComposerDraft {
        self.preview_draft.as_ref().unwrap_or(&self.original_draft)
    }

    fn display_query(&self) -> String {
        self.query.replace('\n', "↵").replace('\t', "⇥")
    }
}

impl ChatComposer {
    #[cfg(test)]
    pub(crate) fn history_search_query(&self) -> Option<&str> {
        self.history_search
            .as_ref()
            .map(|search| search.query.as_str())
    }

    /// 返回当前历史搜索预览中的匹配范围；接受或无匹配时不产生渲染高亮。
    pub(crate) fn history_search_highlight_ranges(&self) -> Vec<Range<usize>> {
        let Some(search) = self.history_search.as_ref() else {
            return Vec::new();
        };
        if search.status != HistorySearchStatus::Match {
            return Vec::new();
        }
        history_search::match_ranges(self.text(), &search.query)
    }

    /// 返回 footer 历史搜索查询输入框的光标位置。
    pub(crate) fn history_search_cursor_pos(&self, area: Rect, label: &str) -> Option<(u16, u16)> {
        let search = self.history_search.as_ref()?;
        if area.is_empty() {
            return None;
        }
        let prefix_width =
            u16::try_from(Line::from(format!(" {label}")).width()).unwrap_or(u16::MAX);
        let query_width =
            u16::try_from(Line::from(search.display_query()).width()).unwrap_or(u16::MAX);
        let desired_x = area
            .x
            .saturating_add(prefix_width)
            .saturating_add(query_width);
        let max_x = area.x.saturating_add(area.width.saturating_sub(1));
        Some((desired_x.min(max_x), area.y))
    }

    pub(crate) fn history_search_footer_line(&self) -> Option<Line<'static>> {
        let search = self.history_search.as_ref()?;
        let hint = crate::style::footer_hint_label_style();
        let mut line = Line::from(vec![
            Span::styled(self.locale.history_search_label(), hint),
            Span::styled(search.display_query(), crate::style::accent_style()),
        ]);
        match search.status {
            HistorySearchStatus::Idle => {}
            HistorySearchStatus::Match => {
                let (accept, cancel) = self.locale.history_search_actions();
                line.spans.extend([
                    Span::styled("  ", hint),
                    Span::raw("enter"),
                    Span::styled(format!(" {accept} · "), hint),
                    Span::raw("esc"),
                    Span::styled(format!(" {cancel}"), hint),
                ]);
            }
            HistorySearchStatus::NoMatch => line.spans.push(Span::styled(
                format!("  {}", self.locale.history_search_no_match()),
                Style::default().fg(Color::Red),
            )),
            HistorySearchStatus::Searching => line.spans.push(Span::styled(
                format!("  {}", self.locale.history_search_pending()),
                hint,
            )),
            HistorySearchStatus::Unavailable => line.spans.push(Span::styled(
                format!("  {}", self.locale.history_search_unavailable()),
                Style::default().fg(Color::Red),
            )),
        }
        Some(line)
    }

    #[cfg(test)]
    pub(crate) fn set_cached_history<I>(&mut self, entries: I)
    where
        I: IntoIterator<Item = String>,
    {
        self.history.set_cached_entries(entries);
        self.draft.saved_draft = None;
        self.history_search = None;
    }

    pub(super) fn begin_history_search(&mut self) -> InputResult {
        self.history.reset_navigation();
        self.draft.saved_draft = None;
        let mut original_vim_state = VimPersistentState::default();
        self.draft
            .textarea
            .swap_vim_persistent_state(&mut original_vim_state);
        self.history_search = Some(HistorySearchSession {
            query: String::new(),
            original_draft: self.snapshot_draft(),
            original_vim_history: std::mem::take(&mut self.vim_history),
            preview_draft: None,
            original_vim_state,
            status: HistorySearchStatus::Idle,
        });
        self.footer.mode = FooterMode::HistorySearch;
        InputResult::Changed
    }

    pub(super) fn handle_history_search_key(&mut self, key: KeyEvent) -> InputResult {
        if key.modifiers.contains(KeyModifiers::CONTROL) {
            return match key.code {
                KeyCode::Char('r') => {
                    self.history_search_in_direction(HistorySearchDirection::Older);
                    InputResult::Changed
                }
                KeyCode::Char('s') => {
                    self.history_search_in_direction(HistorySearchDirection::Newer);
                    InputResult::Changed
                }
                KeyCode::Char('c') => {
                    self.cancel_history_search();
                    InputResult::Changed
                }
                _ => InputResult::None,
            };
        }

        match key.code {
            KeyCode::Esc => {
                self.cancel_history_search();
                InputResult::Changed
            }
            KeyCode::Enter => {
                if self
                    .history_search
                    .as_ref()
                    .is_some_and(|search| search.status == HistorySearchStatus::Match)
                {
                    // Codex accepts the preview as an editable draft. Submission remains
                    // an explicit follow-up Enter, so reverse search never starts a turn.
                    self.reset_history_navigation();
                    self.vim_history = VimHistory::default();
                    InputResult::Changed
                } else {
                    // Keep the search session open when there is no match. The original draft
                    // is already restored by the search traversal, and the query can still be
                    // edited to find another entry.
                    InputResult::Changed
                }
            }
            KeyCode::Backspace => {
                self.update_history_search_query(|query| {
                    if let Some((start, _)) = query.grapheme_indices(true).next_back() {
                        query.truncate(start);
                    }
                });
                InputResult::Changed
            }
            KeyCode::Char(ch) => {
                self.update_history_search_query(|query| query.push(ch));
                InputResult::Changed
            }
            KeyCode::Up => {
                self.history_search_in_direction(HistorySearchDirection::Older);
                InputResult::Changed
            }
            KeyCode::Down => {
                self.history_search_in_direction(HistorySearchDirection::Newer);
                InputResult::Changed
            }
            KeyCode::Left | KeyCode::Right | KeyCode::Home | KeyCode::End => {
                self.reset_history_navigation();
                self.handle_key_event(key)
            }
            _ => InputResult::None,
        }
    }

    fn history_search_in_direction(&mut self, direction: HistorySearchDirection) {
        let Some(search) = self.history_search.as_ref() else {
            return;
        };
        if search.query.is_empty() {
            return;
        }
        let result = self
            .history
            .search(&search.query, direction, false, &self.app_event_tx);
        self.apply_history_search_result(result);
    }

    pub(super) fn update_history_search_query(&mut self, edit: impl FnOnce(&mut String)) {
        let Some(search) = self.history_search.as_mut() else {
            return;
        };
        edit(&mut search.query);
        search.status = HistorySearchStatus::Searching;
        let query = search.query.clone();
        let draft = search.preview_draft().clone();
        self.restore_draft(draft);
        if query.is_empty() {
            if let Some(search) = self.history_search.as_mut() {
                search.status = HistorySearchStatus::Idle;
            }
            self.history.reset_search();
            return;
        }
        let result = self.history.search(
            &query,
            HistorySearchDirection::Older,
            true,
            &self.app_event_tx,
        );
        self.apply_history_search_result(result);
    }

    pub(super) fn apply_history_search_result(&mut self, result: HistorySearchResult) {
        match result {
            HistorySearchResult::Found(entry) => {
                if let Some(search) = self.history_search.as_mut() {
                    search.status = HistorySearchStatus::Match;
                }
                self.apply_history_entry(entry);
            }
            HistorySearchResult::AtBoundary => {
                if let Some(search) = self.history_search.as_mut() {
                    search.status = HistorySearchStatus::Match;
                }
            }
            HistorySearchResult::Pending => {
                if let Some(search) = self.history_search.as_mut() {
                    search.status = HistorySearchStatus::Searching;
                }
            }
            HistorySearchResult::Unavailable => {
                if let Some(search) = self.history_search.as_mut() {
                    search.status = HistorySearchStatus::Unavailable;
                    let draft = search.preview_draft().clone();
                    self.restore_draft(draft);
                }
            }
            HistorySearchResult::NotFound => {
                if let Some(search) = self.history_search.as_mut() {
                    search.status = HistorySearchStatus::NoMatch;
                    let draft = search.preview_draft().clone();
                    self.restore_draft(draft);
                }
            }
        }
    }

    pub(crate) fn cancel_history_search(&mut self) -> bool {
        let Some(mut search) = self.history_search.take() else {
            return false;
        };
        self.restore_draft(search.original_draft);
        self.vim_history = search.original_vim_history;
        self.draft
            .textarea
            .swap_vim_persistent_state(&mut search.original_vim_state);
        self.history.reset_navigation();
        true
    }
}

/// 返回文本中与查询匹配的原始字节范围。
///
/// 搜索导航沿用 `to_lowercase().contains(...)` 的语义；这里对每个原始字符建立
/// lower-case 投影，并把投影命中的范围映射回原文，避免高亮直接按 lower-case
/// 字节偏移切片而破坏 UTF-8 边界。
pub(super) fn match_ranges(text: &str, query: &str) -> Vec<Range<usize>> {
    if query.is_empty() || text.is_empty() {
        return Vec::new();
    }

    let query = query.to_lowercase();
    if query.is_empty() {
        return Vec::new();
    }

    let mut folded = String::new();
    let mut source_ranges = Vec::new();
    for (start, ch) in text.char_indices() {
        let source = start..start + ch.len_utf8();
        for lower in ch.to_lowercase() {
            let folded_start = folded.len();
            folded.push(lower);
            source_ranges.push((folded_start, folded.len(), source.clone()));
        }
    }

    let mut ranges = Vec::new();
    let mut search_from = 0;
    while search_from <= folded.len() {
        let Some(relative_start) = folded[search_from..].find(&query) else {
            break;
        };
        let folded_start = search_from + relative_start;
        let folded_end = folded_start + query.len();
        let Some(first) = source_ranges
            .iter()
            .position(|(start, end, _)| *start <= folded_start && folded_start < *end)
        else {
            break;
        };
        let Some(last) = source_ranges
            .iter()
            .rposition(|(start, end, _)| *start < folded_end && folded_end <= *end)
        else {
            break;
        };
        ranges.push(source_ranges[first].2.start..source_ranges[last].2.end);
        search_from = folded_end;
    }
    ranges
}

#[cfg(test)]
mod tests {
    use super::match_ranges;

    #[test]
    fn match_ranges_map_case_insensitive_unicode_matches_to_original_bytes() {
        assert_eq!(match_ranges("Deploy DEPLOY", "dep"), vec![0..3, 7..10]);
        assert_eq!(match_ranges("Äpfel äPFEL", "äpfel"), vec![0..6, 7..13]);
        assert_eq!(match_ranges("界😀界", "😀"), vec![3..7]);
    }

    #[test]
    fn match_ranges_do_not_match_empty_or_missing_queries() {
        assert!(match_ranges("draft", "").is_empty());
        assert!(match_ranges("draft", "zzz").is_empty());
    }
}
