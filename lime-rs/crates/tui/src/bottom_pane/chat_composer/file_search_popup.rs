use super::super::picker_rows::render_rows_single_line;
use super::super::scroll_state::ScrollState;
use super::super::selection_row_layout::{SelectionRow, MAX_POPUP_ROWS};
use crate::fuzzy_match::fuzzy_match;
use crate::line_truncation::{line_width, truncate_line_with_ellipsis_if_overflow};
use crate::locale::Locale;
use crate::text_formatting::center_truncate_path;
use app_server_protocol::protocol::v2::FuzzyFileSearchResult;
use crossterm::event::{Event, KeyCode, KeyEventKind, KeyModifiers};
use ratatui::layout::Rect;
use ratatui::text::Line;
use ratatui::Frame;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum FileSearchPopupAction {
    Pass,
    Consumed,
    Cancel,
    Complete,
}

#[derive(Debug, Clone, Default)]
pub(crate) struct FileSearchPopup {
    query: String,
    display_query: String,
    matches: Vec<FuzzyFileSearchResult>,
    state: ScrollState,
    waiting: bool,
}

impl FileSearchPopup {
    pub(crate) fn new(query: impl Into<String>) -> Self {
        Self {
            query: query.into(),
            waiting: true,
            ..Self::default()
        }
    }

    pub(crate) fn set_query(&mut self, query: impl Into<String>) {
        let query = query.into();
        if self.query != query {
            self.query = query;
            // Keep the previous rows visible until the replacement query resolves.
            self.waiting = true;
        }
    }

    /// Show the idle state for a bare `@` token without starting a filesystem search.
    pub(crate) fn set_empty_prompt(&mut self) {
        self.query.clear();
        self.display_query.clear();
        self.matches.clear();
        self.state.reset();
        self.waiting = false;
    }

    pub(crate) fn query(&self) -> &str {
        &self.query
    }

    pub(crate) fn set_matches(&mut self, query: &str, matches: Vec<FuzzyFileSearchResult>) {
        if self.query != query {
            return;
        }
        self.display_query = query.to_string();
        self.matches = matches.into_iter().take(MAX_POPUP_ROWS).collect();
        self.state.clamp_selection(self.matches.len());
        self.waiting = false;
    }

    pub(crate) fn selected_path(&self) -> Option<&str> {
        self.state
            .selected_idx
            .and_then(|index| self.matches.get(index))
            .map(|item| item.path.as_str())
    }

    pub(crate) fn handle_event(&mut self, event: &Event) -> FileSearchPopupAction {
        let Event::Key(key) = event else {
            return FileSearchPopupAction::Pass;
        };
        if key.kind != KeyEventKind::Press {
            return FileSearchPopupAction::Pass;
        }
        match key.code {
            KeyCode::Up | KeyCode::Char('p')
                if key.code == KeyCode::Up || key.modifiers.contains(KeyModifiers::CONTROL) =>
            {
                self.state.move_up_wrap(self.matches.len());
                FileSearchPopupAction::Consumed
            }
            KeyCode::Down | KeyCode::Char('n')
                if key.code == KeyCode::Down || key.modifiers.contains(KeyModifiers::CONTROL) =>
            {
                self.state.move_down_wrap(self.matches.len());
                FileSearchPopupAction::Consumed
            }
            KeyCode::Esc => FileSearchPopupAction::Cancel,
            KeyCode::Enter | KeyCode::Tab if self.selected_path().is_some() => {
                FileSearchPopupAction::Complete
            }
            KeyCode::Enter | KeyCode::Tab => FileSearchPopupAction::Consumed,
            _ => FileSearchPopupAction::Pass,
        }
    }

    #[cfg(test)]
    fn render(&self, frame: &mut Frame<'_>, composer_area: Rect, locale: Locale) {
        self.render_with_clip_top(frame, composer_area, locale, 0);
    }

    pub(crate) fn render_with_clip_top(
        &self,
        frame: &mut Frame<'_>,
        composer_area: Rect,
        locale: Locale,
        clip_top: u16,
    ) {
        if composer_area.width == 0 {
            return;
        }
        let available_above = composer_area.y.saturating_sub(clip_top);
        let height = u16::try_from(self.matches.len().clamp(1, MAX_POPUP_ROWS))
            .unwrap_or(u16::MAX)
            .saturating_add(2)
            .min(available_above);
        if height == 0 {
            return;
        }
        let area = Rect::new(
            composer_area.x,
            composer_area.y.saturating_sub(height),
            composer_area.width,
            height,
        );
        let rows = self
            .matches
            .iter()
            .enumerate()
            .map(|(index, item)| {
                let path = display_path(&item.path, area.width.saturating_sub(2));
                let indices = if path == item.path {
                    item.indices
                        .as_ref()
                        .map(|indices| indices.iter().map(|index| *index as usize).collect())
                } else {
                    fuzzy_match(&path, &self.display_query).map(|(indices, _)| indices)
                };
                let mut row = SelectionRow::new(
                    path,
                    None,
                    vec![if Some(index) == self.state.selected_idx {
                        "› "
                    } else {
                        "  "
                    }
                    .into()],
                );
                row.match_indices = indices;
                row
            })
            .collect::<Vec<_>>();
        let empty = if self.waiting {
            locale.file_search_loading()
        } else {
            locale.file_search_no_matches()
        };
        render_rows_single_line(frame, area, &rows, &self.state, &format!("  {empty}"));
    }
}

fn display_path(path: &str, width: u16) -> String {
    let width = usize::from(width.max(1));
    if line_width(&Line::from(path)) <= width {
        return path.to_string();
    }
    let split = path.rfind(['/', '\\']);
    let filename = split.map_or(path, |index| &path[index + 1..]);
    let filename_width = line_width(&Line::from(filename));
    if filename_width + 2 <= width {
        let parent_width = width.saturating_sub(filename_width + 1);
        let index = split.unwrap_or(0);
        let separator = path.get(index..index + 1).unwrap_or("");
        let parent = truncate_line_with_ellipsis_if_overflow(
            Line::from(path[..index].to_string()),
            parent_width,
        );
        return format!("{parent}{separator}{filename}");
    }
    center_truncate_path(filename, width)
}

#[cfg(test)]
mod tests {
    use super::*;
    use app_server_protocol::protocol::v2::{FuzzyFileSearchMatchType, FuzzyFileSearchResult};
    use crossterm::event::{KeyEvent, KeyModifiers};
    use ratatui::backend::TestBackend;
    use ratatui::layout::Rect;
    use ratatui::Terminal;

    fn result(path: &str) -> FuzzyFileSearchResult {
        FuzzyFileSearchResult {
            root: "/tmp".to_string(),
            path: path.to_string(),
            match_type: FuzzyFileSearchMatchType::File,
            file_name: path.to_string(),
            score: 1,
            indices: None,
        }
    }

    #[test]
    fn stale_results_are_ignored_and_selection_wraps() {
        let mut popup = FileSearchPopup::new("src");
        popup.set_matches("old", vec![result("old.rs")]);
        assert!(popup.selected_path().is_none());
        popup.set_matches("src", vec![result("src/lib.rs"), result("src/main.rs")]);
        popup.handle_event(&Event::Key(KeyEvent::new(KeyCode::Up, KeyModifiers::NONE)));
        assert_eq!(popup.selected_path(), Some("src/main.rs"));
    }

    #[test]
    fn ctrl_p_and_ctrl_n_cycle_selection_like_codex() {
        let mut popup = FileSearchPopup::new("src");
        popup.set_matches("src", vec![result("src/lib.rs"), result("src/main.rs")]);

        popup.handle_event(&Event::Key(KeyEvent::new(
            KeyCode::Char('n'),
            KeyModifiers::CONTROL,
        )));
        assert_eq!(popup.selected_path(), Some("src/main.rs"));

        popup.handle_event(&Event::Key(KeyEvent::new(
            KeyCode::Char('p'),
            KeyModifiers::CONTROL,
        )));
        assert_eq!(popup.selected_path(), Some("src/lib.rs"));
    }

    #[test]
    fn query_changes_keep_previous_rows_visible_while_waiting() {
        let mut popup = FileSearchPopup::new("src");
        popup.set_matches("src", vec![result("src/lib.rs")]);
        popup.set_query("main");

        assert!(popup.waiting);
        assert_eq!(popup.selected_path(), Some("src/lib.rs"));
        popup.set_matches("main", Vec::new());
        assert!(popup.selected_path().is_none());
    }

    #[test]
    fn selected_file_uses_codex_marker_without_narrow_overflow() {
        let mut popup = FileSearchPopup::new("src");
        popup.set_matches("src", vec![result("src/main.rs")]);
        for width in [40, 80, 120] {
            let mut terminal = Terminal::new(TestBackend::new(width, 8)).expect("terminal");
            terminal
                .draw(|frame| popup.render(frame, Rect::new(0, 6, width, 2), Locale::EnUs))
                .expect("draw");
            let buffer = terminal.backend().buffer();
            let text = (0..buffer.area.height)
                .map(|y| {
                    (0..buffer.area.width)
                        .map(|x| buffer[(x, y)].symbol())
                        .collect::<String>()
                })
                .collect::<Vec<_>>();
            assert!(text.iter().any(|line| line.contains("› src/main.rs")));
            assert!(text
                .iter()
                .all(|line| line.chars().count() <= width as usize));
        }
    }

    #[test]
    fn long_paths_retain_distinguishing_filenames_and_original_insert_identity() {
        for parent in [
            "src/shared/long_directory_name",
            "長いディレクトリ名/e\u{301}tudes",
            "src\\very_long_directory",
        ] {
            let paths = [
                format!("{parent}/parser_alpha.rs"),
                format!("{parent}/parser_beta.rs"),
            ];
            let mut popup = FileSearchPopup::new("parser");
            popup.set_matches(
                "parser",
                paths
                    .iter()
                    .map(|path| {
                        let mut item = result(path);
                        item.indices = fuzzy_match(path, "parser")
                            .map(|(indices, _)| indices.into_iter().map(|i| i as u32).collect());
                        item
                    })
                    .collect(),
            );
            for path in &paths {
                for width in [28, 40, 80] {
                    let mut terminal = Terminal::new(TestBackend::new(width, 8)).unwrap();
                    terminal
                        .draw(|frame| popup.render(frame, Rect::new(0, 6, width, 2), Locale::EnUs))
                        .unwrap();
                    let buffer = terminal.backend().buffer();
                    let text = (0..8)
                        .map(|y| {
                            (0..width)
                                .map(|x| buffer[(x, y)].symbol())
                                .collect::<String>()
                        })
                        .collect::<Vec<_>>()
                        .join("\n");
                    assert!(
                        text.contains("parser_alpha.rs") && text.contains("parser_beta.rs"),
                        "{width}: {text}"
                    );
                    assert_eq!(popup.selected_path(), Some(path.as_str()));
                    let unselected_y = if popup.state.selected_idx == Some(0) {
                        4
                    } else {
                        3
                    };
                    let parser_x = (0..width - 6)
                        .find(|x| {
                            (*x..*x + 6)
                                .map(|col| buffer[(col, unselected_y)].symbol())
                                .eq(["p", "a", "r", "s", "e", "r"])
                        })
                        .expect("visible unselected filename");
                    assert!(buffer[(parser_x, unselected_y)]
                        .modifier
                        .contains(ratatui::style::Modifier::BOLD));
                }
                popup.handle_event(&Event::Key(KeyEvent::new(
                    KeyCode::Down,
                    KeyModifiers::NONE,
                )));
            }
        }
    }

    #[test]
    fn displayed_query_keeps_previous_highlights_until_latest_results_arrive() {
        let mut popup = FileSearchPopup::new("parser");
        popup.set_matches("parser", vec![result("long_directory/parser.rs")]);
        popup.set_query("other");
        popup.set_matches("parser", vec![result("stale.rs")]);
        assert_eq!(popup.display_query, "parser");
        assert_eq!(popup.query(), "other");
        assert_eq!(popup.selected_path(), Some("long_directory/parser.rs"));
        popup.set_matches("other", vec![result("other.rs")]);
        assert_eq!(popup.display_query, "other");
        popup.set_empty_prompt();
        assert_eq!(popup.display_query, "");
        assert_eq!(popup.state, ScrollState::default());
    }

    #[test]
    fn clipped_file_list_keeps_selected_item_visible_and_bounds_unicode_paths() {
        let mut popup = FileSearchPopup::new("file");
        popup.set_matches(
            "file",
            (0..10)
                .map(|i| result(&format!("長い目录/👩‍💻/file_{i:02}.rs")))
                .collect(),
        );
        assert_eq!(popup.matches.len(), MAX_POPUP_ROWS);
        popup.handle_event(&Event::Key(KeyEvent::new(KeyCode::Up, KeyModifiers::NONE)));
        let mut terminal = Terminal::new(TestBackend::new(28, 3)).unwrap();
        terminal
            .draw(|frame| popup.render(frame, Rect::new(0, 2, 28, 1), Locale::EnUs))
            .unwrap();
        let text = terminal
            .backend()
            .buffer()
            .content
            .iter()
            .map(|cell| cell.symbol())
            .collect::<String>();
        assert!(text.contains("file_07.rs"), "{text}");
        for width in 1..40 {
            let display = display_path("長い目录/👩‍💻/e\u{301}xtremely_long_file_name.rs", width);
            assert!(
                crate::width::display_width(&display) <= usize::from(width),
                "{width}: {display}"
            );
        }
    }
}
