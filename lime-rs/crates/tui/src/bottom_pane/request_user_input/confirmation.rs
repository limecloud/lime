//! Unanswered confirmation shares the configured list controls and selection renderer.

use super::*;
use crate::bottom_pane::scroll_state::ScrollState;
use crate::bottom_pane::selection_popup_common::{
    measure_rows_height_with_layout, render_rows_with_layout,
};
use crate::bottom_pane::selection_row_layout::{SelectionDescriptionLayout, SelectionRow};
use crate::locale::Locale;
use crate::style::accent_style;
use ratatui::layout::Rect;
use ratatui::widgets::Paragraph;
use ratatui::Frame;

const CONFIRMATION_LAYOUT: SelectionDescriptionLayout =
    SelectionDescriptionLayout::StackBelowWhenNarrow {
        min_description_width: 24,
    };

fn title_lines(locale: Locale, width: u16) -> Vec<Line<'static>> {
    crate::wrapping::word_wrap_line(
        &Line::from(locale.unanswered_confirm_title()),
        crate::wrapping::RtOptions::new(usize::from(width.max(1))).break_words(true),
    )
    .into_iter()
    .map(crate::bottom_pane::selection_row_layout::line_to_owned)
    .collect()
}

impl RequestUserInputOverlay {
    pub(super) fn open_unanswered_confirmation(&mut self) {
        self.list_key_chord_matcher.reset();
        self.confirm_unanswered = Some(ScrollState {
            selected_idx: Some(0),
            scroll_top: 0,
        });
    }

    fn return_to_unanswered(&mut self) {
        self.confirm_unanswered = None;
        self.list_key_chord_matcher.reset();
        if let Some(index) = self.first_unanswered_index() {
            self.jump_to_question(index);
        }
    }

    pub(super) fn handle_confirm_unanswered_key_event(
        &mut self,
        key: KeyEvent,
    ) -> Option<AppServerResponse> {
        if key.kind == KeyEventKind::Release {
            return None;
        }
        if key.kind == KeyEventKind::Press
            && key.code == KeyCode::Char('c')
            && key.modifiers == KeyModifiers::CONTROL
        {
            return Some(self.cancel());
        }
        let action = self
            .list_keymap
            .dispatch(&mut self.list_key_chord_matcher, key, false);
        match action {
            KeymapMatch::Completed(ListAction::MoveUp | ListAction::MoveDown) => {
                if let Some(state) = self.confirm_unanswered.as_mut() {
                    state.move_down_wrap(2);
                }
            }
            KeymapMatch::Completed(ListAction::JumpTop) => {
                if let Some(state) = self.confirm_unanswered.as_mut() {
                    state.selected_idx = Some(0);
                }
            }
            KeymapMatch::Completed(ListAction::JumpBottom) => {
                if let Some(state) = self.confirm_unanswered.as_mut() {
                    state.selected_idx = Some(1);
                }
            }
            KeymapMatch::Completed(ListAction::Accept) => {
                let selected = self
                    .confirm_unanswered
                    .as_ref()
                    .and_then(|state| state.selected_idx)
                    .unwrap_or(0);
                if selected == 0 {
                    self.confirm_unanswered = None;
                    return Some(self.finish());
                }
                self.return_to_unanswered();
            }
            KeymapMatch::Completed(ListAction::Cancel) => self.return_to_unanswered(),
            KeymapMatch::PassThrough
                if key.kind == KeyEventKind::Press && key.modifiers.is_empty() =>
            {
                match key.code {
                    KeyCode::Char('1' | '2') => {
                        if let Some(state) = self.confirm_unanswered.as_mut() {
                            state.selected_idx = Some(usize::from(key.code == KeyCode::Char('2')));
                        }
                    }
                    KeyCode::Backspace => self.return_to_unanswered(),
                    _ => {}
                }
            }
            _ => {}
        }
        None
    }

    pub(super) fn confirmation_footer_hints(&self, locale: Locale, width: usize) -> Vec<String> {
        let primary = primary_action_hint(
            self.list_keymap
                .primary_hint(ListAction::Accept)
                .map(|key| ShortcutHint::new(&key, locale.request_submit_hint(&key))),
            self.list_keymap
                .primary_hint(ListAction::Cancel)
                .map(|key| {
                    ShortcutHint::new(
                        &key,
                        format!("{key} {}", locale.unanswered_confirm_go_back()),
                    )
                }),
            width,
        );
        let mut hints = vec![primary];
        if let (Some(up), Some(down)) = (
            self.list_keymap.primary_hint(ListAction::MoveUp),
            self.list_keymap.primary_hint(ListAction::MoveDown),
        ) {
            hints.push(
                ShortcutHint::new(
                    &format!("{}/{}", display_key_label(&up), display_key_label(&down)),
                    locale.request_select_hint(&up, &down),
                )
                .fit(width),
            );
        }
        wrap_hint_rows(
            hints.into_iter().filter(|hint| !hint.is_empty()),
            width,
            display_width(" · "),
            |hint| display_width(hint),
        )
        .into_iter()
        .map(|row| row.join(" · "))
        .collect()
    }

    pub(super) fn confirmation_rows(&self, locale: Locale) -> Vec<SelectionRow> {
        let selected = self
            .confirm_unanswered
            .as_ref()
            .and_then(|state| state.selected_idx)
            .unwrap_or(0);
        [
            (
                locale.unanswered_confirm_submit(),
                locale.unanswered_submit_description(self.unanswered_count()),
            ),
            (
                locale.unanswered_confirm_go_back(),
                locale.unanswered_go_back_description().to_string(),
            ),
        ]
        .into_iter()
        .enumerate()
        .map(|(index, (name, description))| {
            SelectionRow::new(
                name,
                Some(description),
                vec![format!(
                    "{}{}. ",
                    if index == selected { "› " } else { "  " },
                    index + 1
                )
                .into()],
            )
        })
        .collect()
    }

    pub(super) fn render_unanswered_confirmation(
        &self,
        frame: &mut Frame<'_>,
        area: Rect,
        locale: Locale,
    ) {
        let area = super::layout::menu_surface_inset(area);
        let lines = title_lines(locale, area.width);
        let title_height = u16::try_from(lines.len())
            .unwrap_or(u16::MAX)
            .min(area.height);
        frame.render_widget(
            Paragraph::new(lines).style(accent_style()),
            Rect::new(area.x, area.y, area.width, title_height),
        );
        let rows_area = Rect::new(
            area.x,
            area.y.saturating_add(title_height).saturating_add(1),
            area.width,
            area.height.saturating_sub(title_height).saturating_sub(1),
        );
        if let Some(state) = self.confirm_unanswered.as_ref() {
            render_rows_with_layout(
                frame,
                rows_area,
                &self.confirmation_rows(locale),
                state,
                CONFIRMATION_LAYOUT,
            );
        }
    }

    pub(super) fn confirmation_desired_height(&self, locale: Locale, width: u16) -> u16 {
        let inner = super::layout::menu_surface_inset(Rect::new(0, 0, width, u16::MAX));
        let rows = self.confirmation_rows(locale);
        let state = self.confirm_unanswered.unwrap_or_default();
        u16::try_from(title_lines(locale, inner.width).len())
            .unwrap_or(u16::MAX)
            .saturating_add(measure_rows_height_with_layout(
                &rows,
                &state,
                inner.width,
                CONFIRMATION_LAYOUT,
            ))
            .saturating_add(3)
            .clamp(8, 18)
    }
}
