//! Searchable, orderable multi-selection. Display geometry stays in ListSelectionView.

use super::list_selection_view::{self, ListSelectionView};
use super::selection_row_layout::SelectionRow;
use crate::footer_hint::{first_fitting_line, shortcut};
use crate::fuzzy_match::fuzzy_match;
use crate::keymap::{KeyChordMatcher, KeymapMatch, ListAction, ListKeymap};
use crate::line_truncation::truncate_line_with_ellipsis_if_overflow;
use crate::locale::Locale;
use crate::style::muted_style;
use crossterm::event::{Event, KeyCode, KeyEventKind, KeyModifiers};
use ratatui::{
    layout::Rect,
    text::{Line, Span},
    widgets::Paragraph,
    Frame,
};
use std::cell::Cell;

pub(crate) struct MultiSelectPickerView {
    pub(crate) title: &'static str,
    pub(crate) subtitle: &'static str,
    pub(crate) locale: Locale,
}

#[derive(Debug)]
pub(crate) struct MultiSelectItem {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) description: String,
    pub(crate) enabled: bool,
    pub(crate) orderable: bool,
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum MultiSelectAction {
    None,
    Confirm,
    Cancel,
}

#[derive(Debug)]
pub(crate) struct MultiSelectPicker {
    pub(crate) items: Vec<MultiSelectItem>,
    pub(crate) query: String,
    pub(crate) selected: usize,
    pub(crate) filtered_indices: Vec<usize>,
    pub(crate) keymap: ListKeymap,
    pub(crate) page_rows: Cell<usize>,
    matcher: KeyChordMatcher,
}

impl MultiSelectPicker {
    pub(crate) fn new(items: Vec<MultiSelectItem>, keymap: ListKeymap) -> Self {
        let filtered_indices = (0..items.len()).collect();
        Self {
            items,
            keymap,
            filtered_indices,
            query: String::new(),
            selected: 0,
            page_rows: Cell::new(8),
            matcher: KeyChordMatcher::default(),
        }
    }

    pub(crate) fn selected_ids(&self) -> Vec<String> {
        self.items
            .iter()
            .filter(|item| item.enabled)
            .map(|item| item.id.clone())
            .collect()
    }

    fn view(&self, presentation: &MultiSelectPickerView, width: u16) -> ListSelectionView<'_> {
        let locale = presentation.locale;
        let accept = self.keymap.primary_hint(ListAction::Accept);
        let cancel = self.keymap.primary_hint(ListAction::Cancel);
        let mut controls = Line::default();
        for (key, label) in [
            (accept.as_deref(), locale.multi_select_save_label()),
            (cancel.as_deref(), locale.picker_back_label()),
            (Some("Space"), locale.multi_select_toggle_label()),
        ] {
            if let Some(key) = key {
                if !controls.spans.is_empty() {
                    controls.push_span(" · ");
                }
                controls.spans.extend(shortcut(key, label).spans);
            }
        }
        if self.query.is_empty() {
            let left = self.keymap.primary_searchable_hint(ListAction::MoveLeft);
            let right = self.keymap.primary_searchable_hint(ListAction::MoveRight);
            if let (Some(left), Some(right)) = (left, right) {
                controls.push_span(" · ");
                controls.spans.extend(
                    shortcut(
                        &format!("{left}/{right}"),
                        locale.multi_select_order_label(),
                    )
                    .spans,
                );
            }
        }
        let keys = [accept.as_deref(), cancel.as_deref()]
            .into_iter()
            .flatten()
            .collect::<Vec<_>>()
            .join(" · ");
        let footer = first_fitting_line(
            [controls, Line::from(keys)]
                .into_iter()
                .chain(cancel.into_iter().map(Line::from)),
            usize::from(width.saturating_sub(4)),
        );
        ListSelectionView {
            title: presentation.title,
            subtitle: Line::from(presentation.subtitle),
            query: Some(&self.query),
            selected: self.selected,
            entries: self
                .filtered_indices
                .iter()
                .map(|index| {
                    let item = &self.items[*index];
                    SelectionRow::new(
                        &item.name,
                        (!item.description.is_empty()).then(|| item.description.clone()),
                        vec![Span::raw(if item.enabled { "[x] " } else { "[ ] " })],
                    )
                })
                .collect(),
            empty_text: locale.multi_select_empty(),
            keymap: &self.keymap,
            locale,
            footer: Some(footer),
        }
    }

    pub(crate) fn desired_height(&self, presentation: &MultiSelectPickerView, width: u16) -> u16 {
        list_selection_view::desired_height(&self.view(presentation, width), width)
            .saturating_add(1)
    }

    pub(crate) fn render(
        &self,
        frame: &mut Frame<'_>,
        area: Rect,
        presentation: &MultiSelectPickerView,
        preview: Line<'static>,
    ) {
        let list_area = Rect::new(area.x, area.y, area.width, area.height.saturating_sub(1));
        self.page_rows.set(list_selection_view::render(
            frame,
            list_area,
            &self.view(presentation, area.width),
        ));
        if area.height < 2 {
            return;
        }
        let mut line = Line::from(Span::styled(
            format!("{}: ", presentation.locale.multi_select_preview_label()),
            muted_style(),
        ));
        line.spans.extend(preview.spans);
        frame.render_widget(
            Paragraph::new(truncate_line_with_ellipsis_if_overflow(
                line,
                usize::from(area.width.saturating_sub(4)),
            )),
            Rect::new(
                area.x.saturating_add(2),
                area.bottom() - 1,
                area.width.saturating_sub(4),
                1,
            ),
        );
    }

    fn apply_filter(&mut self) {
        let previous = self.filtered_indices.get(self.selected).copied();
        let mut matches = self
            .items
            .iter()
            .enumerate()
            .filter_map(|(index, item)| {
                fuzzy_match(&item.name, self.query.trim()).map(|(_, score)| (index, score))
            })
            .collect::<Vec<_>>();
        if !self.query.trim().is_empty() {
            matches.sort_by_key(|(index, score)| (*score, self.items[*index].name.clone()));
        }
        self.filtered_indices = matches.into_iter().map(|(index, _)| index).collect();
        self.selected = previous
            .and_then(|index| {
                self.filtered_indices
                    .iter()
                    .position(|candidate| *candidate == index)
            })
            .unwrap_or(0);
    }

    fn reorder(&mut self, down: bool) {
        if !self.query.is_empty() {
            return;
        }
        let Some(index) = self.filtered_indices.get(self.selected).copied() else {
            return;
        };
        let next = if down {
            index.checked_add(1)
        } else {
            index.checked_sub(1)
        };
        let Some(next) = next.filter(|next| *next < self.items.len()) else {
            return;
        };
        if self.items[index].orderable && self.items[next].orderable {
            self.items.swap(index, next);
            self.selected = next;
        }
    }

    pub(crate) fn handle_event(&mut self, event: &Event) -> MultiSelectAction {
        let Event::Key(key) = event else {
            self.matcher.reset();
            if let Event::Paste(text) = event {
                self.query
                    .extend(text.chars().filter(|ch| !ch.is_control()));
                self.apply_filter();
            }
            return MultiSelectAction::None;
        };
        if key.kind == KeyEventKind::Release {
            return MultiSelectAction::None;
        }
        if key.code == KeyCode::Char('c') && key.modifiers == KeyModifiers::CONTROL {
            return MultiSelectAction::Cancel;
        }
        let navigation = self.keymap.dispatch(&mut self.matcher, *key, true);
        let len = self.filtered_indices.len();
        match navigation {
            KeymapMatch::Pending | KeymapMatch::Cancelled => return MultiSelectAction::None,
            KeymapMatch::Completed(action) => {
                match action {
                    ListAction::Accept => return MultiSelectAction::Confirm,
                    ListAction::Cancel => return MultiSelectAction::Cancel,
                    ListAction::MoveUp if len > 0 => {
                        self.selected = (self.selected + len - 1) % len
                    }
                    ListAction::MoveDown if len > 0 => self.selected = (self.selected + 1) % len,
                    ListAction::PageUp => {
                        self.selected = self.selected.saturating_sub(self.page_rows.get())
                    }
                    ListAction::PageDown => {
                        self.selected = self
                            .selected
                            .saturating_add(self.page_rows.get())
                            .min(len.saturating_sub(1))
                    }
                    ListAction::JumpTop => self.selected = 0,
                    ListAction::JumpBottom => self.selected = len.saturating_sub(1),
                    ListAction::MoveLeft => self.reorder(false),
                    ListAction::MoveRight => self.reorder(true),
                    _ => {}
                }
                return MultiSelectAction::None;
            }
            KeymapMatch::PassThrough => {}
        }
        match key.code {
            KeyCode::Char(' ') if key.modifiers.is_empty() => {
                if let Some(index) = self.filtered_indices.get(self.selected).copied() {
                    self.items[index].enabled = !self.items[index].enabled;
                }
            }
            KeyCode::Backspace => {
                self.query.pop();
                self.apply_filter();
            }
            KeyCode::Char(ch)
                if !key
                    .modifiers
                    .intersects(KeyModifiers::CONTROL | KeyModifiers::ALT) =>
            {
                self.query.push(ch);
                self.apply_filter();
            }
            _ => {}
        }
        MultiSelectAction::None
    }
}
