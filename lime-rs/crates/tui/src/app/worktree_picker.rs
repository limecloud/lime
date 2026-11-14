//! Pick a managed worktree and continue in it (resume its thread or start a new one).

use std::cell::Cell;

use crossterm::event::{Event, KeyCode, KeyEventKind, KeyModifiers};
use ratatui::layout::Rect;
use ratatui::text::Line;
use ratatui::Frame;

use crate::bottom_pane::custom_prompt_view::{CustomPromptView, PromptAction, PromptLabels};
use crate::bottom_pane::list_selection_view::{self, ListSelectionView};
use crate::bottom_pane::selection_row_layout::{SelectionRow, MAX_POPUP_ROWS};
use crate::keymap::{KeyChordMatcher, KeymapMatch, ListAction, ListKeymap};
use crate::locale::Locale;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct WorktreeEntry {
    pub(crate) path: String,
    pub(crate) repository_root: String,
    pub(crate) branch: Option<String>,
    /// Existing thread to continue, preferring an active or pinned thread.
    pub(crate) thread_id: Option<String>,
    pub(crate) thread_summary: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum WorktreePickerAction {
    None,
    Cancel,
    Enter {
        path: String,
        thread_id: Option<String>,
    },
    Create {
        root_path: String,
        name: String,
    },
    DeleteRequest {
        worktree_path: String,
    },
    Refresh,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum WorktreePickerMode {
    List,
    CreateName,
}

#[derive(Debug)]
pub(crate) struct WorktreePicker {
    entries: Vec<WorktreeEntry>,
    root_path: String,
    selected: usize,
    page_rows: Cell<usize>,
    list_keymap: ListKeymap,
    chord_matcher: KeyChordMatcher,
    mode: WorktreePickerMode,
    name_input: CustomPromptView,
}

impl WorktreePicker {
    pub(crate) fn new(root_path: String, entries: Vec<WorktreeEntry>) -> Self {
        Self {
            entries,
            root_path,
            selected: 0,
            page_rows: Cell::new(MAX_POPUP_ROWS),
            list_keymap: ListKeymap::default(),
            chord_matcher: KeyChordMatcher::default(),
            mode: WorktreePickerMode::List,
            name_input: CustomPromptView::new(String::new()),
        }
    }

    pub(crate) fn root_path(&self) -> &str {
        &self.root_path
    }

    pub(crate) fn cursor_style(&self) -> crossterm::cursor::SetCursorStyle {
        if self.mode == WorktreePickerMode::CreateName {
            self.name_input.cursor_style()
        } else {
            crossterm::cursor::SetCursorStyle::DefaultUserShape
        }
    }

    pub(crate) fn with_keymap(mut self, keymap: ListKeymap) -> Self {
        self.list_keymap = keymap;
        self.chord_matcher.reset();
        self
    }

    pub(crate) fn handle_event(&mut self, event: Event) -> WorktreePickerAction {
        if self.mode == WorktreePickerMode::CreateName {
            return self.handle_name_event(event);
        }
        let Event::Key(key) = event else {
            self.chord_matcher.reset();
            return WorktreePickerAction::None;
        };
        if !matches!(key.kind, KeyEventKind::Press | KeyEventKind::Repeat) {
            return WorktreePickerAction::None;
        }
        if key.modifiers.contains(KeyModifiers::CONTROL) && key.code == KeyCode::Char('c') {
            return WorktreePickerAction::Cancel;
        }
        if key.modifiers.is_empty() {
            match key.code {
                KeyCode::Char('n') => {
                    self.mode = WorktreePickerMode::CreateName;
                    self.name_input = CustomPromptView::new(String::new());
                    return WorktreePickerAction::None;
                }
                KeyCode::Char('d') => {
                    if let Some(entry) = self.entries.get(self.selected) {
                        return WorktreePickerAction::DeleteRequest {
                            worktree_path: entry.path.clone(),
                        };
                    }
                    return WorktreePickerAction::None;
                }
                KeyCode::Char('r') => return WorktreePickerAction::Refresh,
                _ => {}
            }
        }
        match self
            .list_keymap
            .dispatch(&mut self.chord_matcher, key, false)
        {
            KeymapMatch::Completed(action) => match action {
                ListAction::Accept => self
                    .entries
                    .get(self.selected)
                    .map(|entry| WorktreePickerAction::Enter {
                        path: entry.path.clone(),
                        thread_id: entry.thread_id.clone(),
                    })
                    .unwrap_or(WorktreePickerAction::None),
                ListAction::Cancel => WorktreePickerAction::Cancel,
                ListAction::MoveUp => {
                    let count = self.entries.len().max(1);
                    self.selected = self.selected.checked_sub(1).unwrap_or(count - 1);
                    WorktreePickerAction::None
                }
                ListAction::MoveDown => {
                    let count = self.entries.len().max(1);
                    self.selected = (self.selected + 1) % count;
                    WorktreePickerAction::None
                }
                ListAction::PageUp => {
                    self.selected = self.selected.saturating_sub(self.page_rows.get().max(1));
                    WorktreePickerAction::None
                }
                ListAction::PageDown => {
                    self.selected = (self.selected + self.page_rows.get().max(1))
                        .min(self.entries.len().saturating_sub(1));
                    WorktreePickerAction::None
                }
                ListAction::JumpTop => {
                    self.selected = 0;
                    WorktreePickerAction::None
                }
                ListAction::JumpBottom => {
                    self.selected = self.entries.len().saturating_sub(1);
                    WorktreePickerAction::None
                }
                ListAction::MoveLeft | ListAction::MoveRight => WorktreePickerAction::None,
            },
            KeymapMatch::Pending | KeymapMatch::Cancelled | KeymapMatch::PassThrough => {
                WorktreePickerAction::None
            }
        }
    }

    fn handle_name_event(&mut self, event: Event) -> WorktreePickerAction {
        let Event::Key(key) = event else {
            return WorktreePickerAction::None;
        };
        if matches!(key.kind, KeyEventKind::Press | KeyEventKind::Repeat) {
            if key.code == KeyCode::Esc && key.modifiers.is_empty() {
                self.mode = WorktreePickerMode::List;
                return WorktreePickerAction::None;
            }
            if key.code == KeyCode::Enter && key.modifiers.is_empty() {
                let name = self.name_input.text().trim().to_string();
                self.mode = WorktreePickerMode::List;
                return if name.is_empty() {
                    WorktreePickerAction::None
                } else {
                    WorktreePickerAction::Create {
                        root_path: self.root_path.clone(),
                        name,
                    }
                };
            }
        }
        match self.name_input.handle_key_event(key) {
            PromptAction::Submit => WorktreePickerAction::None,
            PromptAction::Cancel => {
                self.mode = WorktreePickerMode::List;
                WorktreePickerAction::None
            }
            PromptAction::None => WorktreePickerAction::None,
        }
    }

    fn view(&self, locale: Locale) -> ListSelectionView<'_> {
        let entries = self
            .entries
            .iter()
            .map(|entry| {
                let branch = entry.branch.as_deref().unwrap_or("-");
                let mut details = vec![branch.to_string(), entry.path.clone()];
                if let Some(summary) = entry.thread_summary.as_ref() {
                    details.push(summary.clone());
                }
                SelectionRow::new(entry.path.clone(), Some(details.join(" · ")), Vec::new())
            })
            .collect::<Vec<_>>();
        ListSelectionView {
            footer: None,
            title: locale.worktree_title(),
            subtitle: Line::from(locale.worktree_subtitle(&self.root_path)),
            query: None,
            entries,
            selected: self.selected,
            empty_text: locale.worktree_empty(),
            keymap: &self.list_keymap,
            locale,
        }
    }
}

pub(crate) fn render(frame: &mut Frame<'_>, area: Rect, picker: &WorktreePicker, locale: Locale) {
    picker.page_rows.set(list_selection_view::render(
        frame,
        area,
        &picker.view(locale),
    ));
}

pub(crate) fn desired_height(picker: &WorktreePicker, locale: Locale, width: u16) -> u16 {
    list_selection_view::desired_height(&picker.view(locale), width)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crossterm::event::KeyEvent;

    fn picker() -> WorktreePicker {
        WorktreePicker::new(
            "/repo".to_string(),
            vec![WorktreeEntry {
                path: "/repo/.lime/worktrees/one".to_string(),
                repository_root: "/repo".to_string(),
                branch: Some("feature".to_string()),
                thread_id: Some("thread-1".to_string()),
                thread_summary: Some("Active task".to_string()),
            }],
        )
    }

    #[test]
    fn enter_continues_the_worktree_thread() {
        let mut picker = picker();
        assert_eq!(
            picker.handle_event(Event::Key(KeyEvent::from(KeyCode::Enter))),
            WorktreePickerAction::Enter {
                path: "/repo/.lime/worktrees/one".to_string(),
                thread_id: Some("thread-1".to_string())
            }
        );
    }

    #[test]
    fn n_creates_a_named_worktree_from_the_root() {
        let mut picker = picker();
        assert_eq!(
            picker.handle_event(Event::Key(KeyEvent::from(KeyCode::Char('n')))),
            WorktreePickerAction::None
        );
        for ch in "feature-x".chars() {
            picker.handle_event(Event::Key(KeyEvent::from(KeyCode::Char(ch))));
        }
        assert_eq!(
            picker.handle_event(Event::Key(KeyEvent::from(KeyCode::Enter))),
            WorktreePickerAction::Create {
                root_path: "/repo".to_string(),
                name: "feature-x".to_string()
            }
        );
    }

    #[test]
    fn d_deletes_and_r_refreshes() {
        let mut picker = picker();
        assert_eq!(
            picker.handle_event(Event::Key(KeyEvent::from(KeyCode::Char('d')))),
            WorktreePickerAction::DeleteRequest {
                worktree_path: "/repo/.lime/worktrees/one".to_string()
            }
        );
        assert_eq!(
            picker.handle_event(Event::Key(KeyEvent::from(KeyCode::Char('r')))),
            WorktreePickerAction::Refresh
        );
    }

    #[test]
    fn escape_cancels() {
        let mut picker = picker();
        assert_eq!(
            picker.handle_event(Event::Key(KeyEvent::from(KeyCode::Esc))),
            WorktreePickerAction::Cancel
        );
    }

    #[test]
    fn escape_from_the_name_prompt_returns_to_the_list() {
        let mut picker = picker();
        picker.handle_event(Event::Key(KeyEvent::from(KeyCode::Char('n'))));
        assert_eq!(
            picker.handle_event(Event::Key(KeyEvent::from(KeyCode::Esc))),
            WorktreePickerAction::None
        );
        assert_eq!(
            picker.handle_event(Event::Key(KeyEvent::from(KeyCode::Enter))),
            WorktreePickerAction::Enter {
                path: "/repo/.lime/worktrees/one".to_string(),
                thread_id: Some("thread-1".to_string())
            }
        );
    }
}
