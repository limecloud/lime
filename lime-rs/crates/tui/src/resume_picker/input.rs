use super::*;
use crate::keymap::{KeymapMatch, ListAction};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum ToolbarControl {
    Filter,
    Status,
    Sort,
}

impl ToolbarControl {
    fn previous(self, action: SessionPickerAction) -> Self {
        match self {
            Self::Filter => Self::Sort,
            Self::Status => Self::Filter,
            Self::Sort if action == SessionPickerAction::Resume => Self::Status,
            Self::Sort => Self::Filter,
        }
    }

    fn next(self, action: SessionPickerAction) -> Self {
        match self {
            Self::Filter if action == SessionPickerAction::Resume => Self::Status,
            Self::Filter | Self::Status => Self::Sort,
            Self::Sort => Self::Filter,
        }
    }
}

impl PickerState {
    pub(crate) fn handle_event(&mut self, event: Event) -> PickerAction {
        if !matches!(event, Event::Key(_)) {
            self.list_chord_matcher.reset();
        }
        if let Event::Resize(width, height) = event {
            let rows = layout::areas(ratatui::layout::Rect::new(0, 0, width, height))
                .list
                .height;
            self.view_rows.set((rows > 0).then_some(usize::from(rows)));
            return PickerAction::None;
        }
        if let Event::Paste(text) = event {
            if let Some(text) = normalize_pasted_search_query(&text) {
                if !self.query.is_empty() && !self.query.ends_with(char::is_whitespace) {
                    self.query.push(' ');
                }
                self.query.push_str(&text);
                self.invalidate_thread_list();
            }
            return PickerAction::Reload;
        }
        let Event::Key(key) = event else {
            return PickerAction::None;
        };
        if !matches!(key.kind, KeyEventKind::Press | KeyEventKind::Repeat) {
            return PickerAction::None;
        }
        if key.modifiers.contains(KeyModifiers::CONTROL) && key.code == KeyCode::Char('c') {
            self.list_chord_matcher.reset();
            self.pending_page_down_target = None;
            return PickerAction::Cancel;
        }
        let action = self
            .list_keymap
            .dispatch(&mut self.list_chord_matcher, key, true);
        if action != KeymapMatch::Completed(ListAction::PageDown) {
            self.pending_page_down_target = None;
        }
        match action {
            KeymapMatch::Pending | KeymapMatch::Cancelled => return PickerAction::None,
            KeymapMatch::Completed(action) => return self.handle_list_action(action),
            KeymapMatch::PassThrough => {}
        }
        if key.modifiers.contains(KeyModifiers::CONTROL)
            && key.code == KeyCode::Char('a')
            && self.status == SessionStatus::Active
            && self.archive_shortcut_available()
        {
            return PickerAction::Archive;
        }
        if key.modifiers.contains(KeyModifiers::CONTROL) {
            match key.code {
                KeyCode::Char('o') => return PickerAction::ToggleDensity,
                KeyCode::Char('e') => return PickerAction::ToggleExpanded,
                KeyCode::Char('t') => return PickerAction::OpenTranscript,
                _ => {}
            }
        }
        if key.modifiers.is_empty() && key.code == KeyCode::Char('\u{0014}') {
            return PickerAction::OpenTranscript;
        }
        if key.modifiers.is_empty() && key.code == KeyCode::Char('\u{0005}') {
            return PickerAction::ToggleExpanded;
        }
        match key.code {
            KeyCode::BackTab => {
                self.toolbar_focus = self.toolbar_focus.previous(self.action);
                PickerAction::None
            }
            KeyCode::Tab => {
                self.toolbar_focus = if key.modifiers.contains(KeyModifiers::SHIFT) {
                    self.toolbar_focus.previous(self.action)
                } else {
                    self.toolbar_focus.next(self.action)
                };
                PickerAction::None
            }
            KeyCode::Backspace => {
                self.query.pop();
                self.invalidate_thread_list();
                PickerAction::Reload
            }
            KeyCode::Char(c)
                if !key
                    .modifiers
                    .intersects(KeyModifiers::CONTROL | KeyModifiers::ALT) =>
            {
                self.query.push(c);
                self.invalidate_thread_list();
                PickerAction::Reload
            }
            _ => PickerAction::None,
        }
    }

    fn handle_list_action(&mut self, action: ListAction) -> PickerAction {
        match action {
            ListAction::MoveLeft | ListAction::MoveRight => match self.toolbar_focus {
                ToolbarControl::Filter if self.filter_cwd.is_some() => PickerAction::ToggleFilter,
                ToolbarControl::Filter => PickerAction::None,
                ToolbarControl::Status => PickerAction::ToggleStatus,
                ToolbarControl::Sort => PickerAction::ToggleSort,
            },
            ListAction::MoveUp => {
                self.selected = self.selected.saturating_sub(1);
                PickerAction::MoveUp
            }
            ListAction::PageUp => {
                self.selected = self
                    .selected
                    .saturating_sub(self.view_rows.get().unwrap_or(10).max(1));
                PickerAction::MoveUp
            }
            ListAction::MoveDown => {
                if !self.threads.is_empty() {
                    self.selected = (self.selected + 1).min(self.threads.len() - 1);
                }
                PickerAction::MoveDown
            }
            ListAction::PageDown => {
                if !self.threads.is_empty() {
                    let target = self
                        .selected
                        .saturating_add(self.view_rows.get().unwrap_or(10).max(1));
                    let max_index = self.threads.len() - 1;
                    self.pending_page_down_target = (target > max_index
                        && self.pagination.next_cursor.is_some())
                    .then_some(target);
                    if self.pending_page_down_target.is_none() {
                        self.selected = target.min(max_index);
                    }
                }
                PickerAction::MoveDown
            }
            ListAction::JumpTop => {
                self.selected = 0;
                PickerAction::MoveUp
            }
            ListAction::JumpBottom => {
                if !self.threads.is_empty() {
                    self.selected = self.threads.len() - 1;
                }
                PickerAction::MoveDown
            }
            ListAction::Accept if self.status == SessionStatus::Archived => PickerAction::Restore,
            ListAction::Accept => PickerAction::Select,
            ListAction::Cancel if self.query.is_empty() => PickerAction::Cancel,
            ListAction::Cancel => {
                self.query.clear();
                self.invalidate_thread_list();
                PickerAction::Reload
            }
        }
    }
}
