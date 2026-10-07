//! Destination and filename prompts for canonical transcript exports.

use std::cell::Cell;
use std::path::PathBuf;

use crossterm::event::{Event, KeyCode, KeyEventKind, KeyModifiers};
use ratatui::layout::Rect;
use ratatui::text::{Line, Span};
use ratatui::Frame;

use super::ChatWidget;
use crate::bottom_pane::custom_prompt_view::{CustomPromptView, PromptAction, PromptLabels};
use crate::bottom_pane::list_selection_view::{self, ListSelectionView};
use crate::bottom_pane::selection_row_layout::SelectionRow;
use crate::keymap::{KeyChordMatcher, KeymapMatch, ListAction, RuntimeKeymap};
use crate::locale::Locale;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ExportPickerAction {
    None,
    Cancel,
    Copy,
    Save,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ExportPickerMode {
    Destination,
    Filename,
}

/// Surface state only; Markdown projection and file writes remain App-owned.
#[derive(Debug)]
pub(crate) struct ExportPicker {
    mode: ExportPickerMode,
    selected: usize,
    page_rows: Cell<usize>,
    keymap: RuntimeKeymap,
    chord_matcher: KeyChordMatcher,
    filename: CustomPromptView,
}

impl ChatWidget {
    pub(crate) fn show_transcript_export_popup(&mut self, thread_id: Option<&str>) {
        let mut picker = ExportPicker::new(thread_id, &self.runtime_keymap);
        if self.bottom_pane.vim_mode_indicator_span().is_some() {
            picker.filename.enable_vim_in_insert_mode();
        }
        self.export_picker = Some(picker);
    }
}

impl ExportPicker {
    pub(crate) fn new(thread_id: Option<&str>, keymap: &RuntimeKeymap) -> Self {
        let filename = thread_id
            .map(|thread_id| format!("codex-session-{thread_id}.md"))
            .unwrap_or_else(|| "codex-session.md".to_string());
        let mut prompt = CustomPromptView::new(filename);
        prompt.set_keymap_bindings(keymap);
        Self {
            mode: ExportPickerMode::Destination,
            selected: 0,
            page_rows: Cell::new(2),
            keymap: keymap.clone(),
            chord_matcher: KeyChordMatcher::default(),
            filename: prompt,
        }
    }

    pub(crate) fn is_filename_prompt(&self) -> bool {
        self.mode == ExportPickerMode::Filename
    }

    pub(crate) fn cursor_style(&self) -> crossterm::cursor::SetCursorStyle {
        if self.is_filename_prompt() {
            self.filename.cursor_style()
        } else {
            crossterm::cursor::SetCursorStyle::DefaultUserShape
        }
    }

    #[cfg(test)]
    pub(crate) fn filename(&self) -> &crate::bottom_pane::TextArea {
        self.filename.textarea()
    }

    pub(crate) fn handle_event(&mut self, event: &Event) -> ExportPickerAction {
        if !matches!(event, Event::Key(_)) {
            self.chord_matcher.reset();
            self.filename.set_keymap_bindings(&self.keymap);
        }
        match self.mode {
            ExportPickerMode::Destination => self.handle_destination_event(event),
            ExportPickerMode::Filename => self.handle_filename_event(event),
        }
    }

    fn accept(&mut self) -> ExportPickerAction {
        if self.selected == 0 {
            ExportPickerAction::Copy
        } else {
            self.mode = ExportPickerMode::Filename;
            self.chord_matcher.reset();
            ExportPickerAction::None
        }
    }

    fn handle_destination_event(&mut self, event: &Event) -> ExportPickerAction {
        let Event::Key(key) = event else {
            return ExportPickerAction::None;
        };
        if !matches!(key.kind, KeyEventKind::Press | KeyEventKind::Repeat) {
            return ExportPickerAction::None;
        }
        if key.modifiers.contains(KeyModifiers::CONTROL) && key.code == KeyCode::Char('c') {
            self.chord_matcher.reset();
            return ExportPickerAction::Cancel;
        }
        match self
            .keymap
            .list()
            .dispatch(&mut self.chord_matcher, *key, false)
        {
            KeymapMatch::Completed(ListAction::Accept) => return self.accept(),
            KeymapMatch::Completed(ListAction::Cancel) => return ExportPickerAction::Cancel,
            KeymapMatch::Completed(action) => {
                let page = self.page_rows.get().max(1);
                self.selected = match action {
                    ListAction::MoveUp | ListAction::MoveDown => 1 - self.selected,
                    ListAction::PageUp => self.selected.saturating_sub(page),
                    ListAction::PageDown => self.selected.saturating_add(page).min(1),
                    ListAction::JumpTop => 0,
                    ListAction::JumpBottom => 1,
                    _ => self.selected,
                };
            }
            KeymapMatch::Pending | KeymapMatch::Cancelled => {}
            KeymapMatch::PassThrough => {
                if !key
                    .modifiers
                    .intersects(KeyModifiers::CONTROL | KeyModifiers::ALT)
                {
                    if let KeyCode::Char('1' | '2') = key.code {
                        self.selected = usize::from(key.code == KeyCode::Char('2'));
                        return self.accept();
                    }
                }
            }
        }
        ExportPickerAction::None
    }

    fn handle_filename_event(&mut self, event: &Event) -> ExportPickerAction {
        match event {
            Event::Key(key) => match self.filename.handle_key_event(*key) {
                PromptAction::Cancel => {
                    if key.modifiers.contains(KeyModifiers::CONTROL) {
                        ExportPickerAction::Cancel
                    } else {
                        self.mode = ExportPickerMode::Destination;
                        ExportPickerAction::None
                    }
                }
                PromptAction::Submit => ExportPickerAction::Save,
                PromptAction::None => ExportPickerAction::None,
            },
            Event::Paste(text) => {
                self.filename.handle_paste(text);
                ExportPickerAction::None
            }
            _ => ExportPickerAction::None,
        }
    }

    pub(crate) fn selected_path(&self) -> Option<PathBuf> {
        let filename = self.filename.text().trim();
        (!filename.is_empty()).then(|| PathBuf::from(filename))
    }

    fn view(&self, locale: Locale) -> ListSelectionView<'_> {
        ListSelectionView {
            footer: None,
            title: locale.export_title(),
            subtitle: Line::from(locale.export_subtitle()),
            query: None,
            entries: [
                (locale.export_copy_label(), locale.export_copy_description()),
                (locale.export_file_label(), locale.export_file_description()),
            ]
            .into_iter()
            .enumerate()
            .map(|(index, (label, description))| {
                SelectionRow::new(
                    label,
                    Some(description.to_string()),
                    vec![Span::raw(format!("{}. ", index + 1))],
                )
            })
            .collect(),
            selected: self.selected,
            empty_text: "",
            keymap: self.keymap.list(),
            locale,
        }
    }
}

pub(crate) fn desired_height(picker: &ExportPicker, locale: Locale, width: u16) -> u16 {
    if picker.is_filename_prompt() {
        picker
            .filename
            .picker_desired_height(width, &prompt_labels(locale))
    } else {
        list_selection_view::desired_height(&picker.view(locale), width)
    }
}

pub(crate) fn render_picker(
    frame: &mut Frame<'_>,
    area: Rect,
    picker: &ExportPicker,
    locale: Locale,
) {
    if !picker.is_filename_prompt() {
        picker.page_rows.set(list_selection_view::render(
            frame,
            area,
            &picker.view(locale),
        ));
        return;
    }
    picker
        .filename
        .render_picker(frame, area, &prompt_labels(locale), locale);
}

fn prompt_labels(locale: Locale) -> PromptLabels<'static> {
    PromptLabels {
        title: locale.export_prompt_title(),
        placeholder: locale.export_file_description(),
        submit: locale.export_file_label(),
    }
}
