//! Background terminal list for `/ps`, with terminate affordance.

use std::cell::Cell;

use crossterm::event::{Event, KeyCode, KeyEventKind, KeyModifiers};
use ratatui::layout::Rect;
use ratatui::text::Line;
use ratatui::Frame;

use crate::bottom_pane::list_selection_view::{self, ListSelectionView};
use crate::bottom_pane::selection_row_layout::{SelectionRow, MAX_POPUP_ROWS};
use crate::keymap::{KeyChordMatcher, KeymapMatch, ListAction, ListKeymap};
use crate::locale::Locale;

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct ProcessEntry {
    pub process_id: String,
    pub command: String,
    pub cwd: String,
    pub os_pid: Option<u32>,
    pub cpu_percent: Option<f64>,
    pub rss_kb: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum ProcessListAction {
    None,
    Cancel,
    Terminate { process_id: String, command: String },
}

#[derive(Debug, Clone)]
pub(crate) struct ProcessList {
    entries: Vec<ProcessEntry>,
    message: Option<String>,
    selected: usize,
    page_rows: Cell<usize>,
    list_keymap: ListKeymap,
    chord_matcher: KeyChordMatcher,
}

impl ProcessList {
    pub(crate) fn new(entries: Vec<ProcessEntry>, message: Option<String>) -> Self {
        Self {
            entries,
            message,
            selected: 0,
            page_rows: Cell::new(MAX_POPUP_ROWS),
            list_keymap: ListKeymap::default(),
            chord_matcher: KeyChordMatcher::default(),
        }
    }

    pub(crate) fn with_keymap(mut self, keymap: ListKeymap) -> Self {
        self.list_keymap = keymap;
        self.chord_matcher.reset();
        self
    }

    pub(crate) fn handle_event(&mut self, event: Event) -> ProcessListAction {
        let Event::Key(key) = event else {
            self.chord_matcher.reset();
            return ProcessListAction::None;
        };
        if !matches!(key.kind, KeyEventKind::Press | KeyEventKind::Repeat) {
            return ProcessListAction::None;
        }
        if key.modifiers.contains(KeyModifiers::CONTROL) && key.code == KeyCode::Char('c') {
            return ProcessListAction::Cancel;
        }
        match self
            .list_keymap
            .dispatch(&mut self.chord_matcher, key, false)
        {
            KeymapMatch::Completed(action) => match action {
                ListAction::Accept => {
                    let Some(entry) = self.entries.get(self.selected) else {
                        return ProcessListAction::None;
                    };
                    ProcessListAction::Terminate {
                        process_id: entry.process_id.clone(),
                        command: entry.command.clone(),
                    }
                }
                ListAction::Cancel => ProcessListAction::Cancel,
                ListAction::MoveUp => {
                    let count = self.entries.len().max(1);
                    self.selected = self.selected.checked_sub(1).unwrap_or(count - 1);
                    ProcessListAction::None
                }
                ListAction::MoveDown => {
                    let count = self.entries.len().max(1);
                    self.selected = (self.selected + 1) % count;
                    ProcessListAction::None
                }
                _ => ProcessListAction::None,
            },
            KeymapMatch::Pending | KeymapMatch::Cancelled | KeymapMatch::PassThrough => {
                ProcessListAction::None
            }
        }
    }

    fn view(&self, locale: Locale) -> ListSelectionView<'_> {
        let entries = self
            .entries
            .iter()
            .map(|entry| {
                let mut details = vec![entry.command.clone()];
                if let Some(pid) = entry.os_pid {
                    details.push(format!("pid {pid}"));
                }
                if let Some(cpu) = entry.cpu_percent {
                    details.push(format!("{cpu:.1}% cpu"));
                }
                if let Some(rss) = entry.rss_kb {
                    details.push(format!("{rss} KB"));
                }
                SelectionRow::new(entry.command.clone(), Some(details.join(" · ")), Vec::new())
            })
            .collect();
        let empty_text = self.message.as_deref().unwrap_or_else(|| locale.ps_empty());
        ListSelectionView {
            footer: None,
            title: locale.ps_title(),
            subtitle: Line::from(locale.ps_hint()),
            query: None,
            entries,
            selected: self.selected,
            empty_text,
            keymap: &self.list_keymap,
            locale,
        }
    }
}

pub(crate) fn render(frame: &mut Frame<'_>, area: Rect, list: &ProcessList, locale: Locale) {
    list.page_rows
        .set(list_selection_view::render(frame, area, &list.view(locale)));
}

pub(crate) fn desired_height(list: &ProcessList, locale: Locale, width: u16) -> u16 {
    list_selection_view::desired_height(&list.view(locale), width)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crossterm::event::KeyEvent;

    fn list() -> ProcessList {
        ProcessList::new(
            vec![ProcessEntry {
                process_id: "proc-1".to_string(),
                command: "sleep 100".to_string(),
                cwd: "/tmp".to_string(),
                os_pid: Some(42),
                cpu_percent: None,
                rss_kb: None,
            }],
            None,
        )
    }

    #[test]
    fn enter_requests_termination() {
        let mut list = list();
        assert_eq!(
            list.handle_event(Event::Key(KeyEvent::from(KeyCode::Enter))),
            ProcessListAction::Terminate {
                process_id: "proc-1".to_string(),
                command: "sleep 100".to_string(),
            }
        );
    }

    #[test]
    fn escape_cancels() {
        let mut list = list();
        assert_eq!(
            list.handle_event(Event::Key(KeyEvent::from(KeyCode::Esc))),
            ProcessListAction::Cancel
        );
    }
}
