//! Composer owns its filled input surface; App only allocates the bottom-pane rectangle.

use super::{layout, ChatComposer};
use ratatui::layout::{Position, Rect};
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, FrameExt as _, Paragraph};
use ratatui::Frame;

impl ChatComposer {
    pub(crate) fn render(&self, frame: &mut Frame<'_>, area: Rect, locale: crate::locale::Locale) {
        let style = crate::style::user_message_style();
        frame.render_widget(Block::default().style(style), area);
        let image_lines = self.remote_image_lines();
        let layout = self.layout(area);
        if layout.inner.width == 0 || layout.inner.height == 0 {
            return;
        }

        if !layout.attachments.is_empty() {
            frame.render_widget(Paragraph::new(image_lines).style(style), layout.attachments);
        }

        let text_area = layout.textarea;
        if text_area.is_empty() {
            return;
        }
        {
            let mut state = self.textarea_state_mut();
            self.textarea().remember_rendered_area(text_area);
            let highlights = self
                .history_search_highlight_ranges()
                .into_iter()
                .map(|range| {
                    (
                        range,
                        Style::default()
                            .add_modifier(Modifier::REVERSED)
                            .add_modifier(Modifier::BOLD),
                    )
                })
                .collect::<Vec<_>>();
            let prompt_width = layout::PROMPT_GUTTER_COLS.min(layout.inner.width);
            let prompt_style = if self.input_enabled() {
                Style::default().add_modifier(Modifier::BOLD)
            } else {
                crate::style::muted_style()
            };
            let prompt = Line::from(Span::styled("› ", prompt_style));
            frame.render_widget(
                Paragraph::new(prompt),
                Rect::new(layout.inner.x, text_area.y, prompt_width, 1),
            );
            if self.input_enabled() && highlights.is_empty() {
                if self.textarea().is_empty() {
                    // Keep attachment rows visible above the input baseline. The prompt occupies its
                    // own gutter, while the placeholder is rendered inside the text area so both
                    // share the same input baseline.
                    let placeholder = Line::from(Span::styled(
                        locale.composer_placeholder(),
                        crate::style::muted_style(),
                    ));
                    frame.render_widget(Paragraph::new(placeholder), text_area);
                } else {
                    frame.render_stateful_widget_ref(self.textarea(), text_area, &mut *state);
                }
            } else if self.input_enabled() {
                self.textarea().render_ref_styled_with_highlights(
                    text_area,
                    frame.buffer_mut(),
                    &mut state,
                    Style::default(),
                    &highlights,
                );
            }
        }
        if let Some((x, y)) = self.cursor_pos(area) {
            frame.set_cursor_position(Position::new(x, y));
        }

        if !self.input_enabled() {
            let placeholder = self
                .draft
                .input_disabled_placeholder
                .as_deref()
                .unwrap_or("Input disabled.");
            frame.render_widget(
                Paragraph::new(Line::from(Span::styled(
                    placeholder,
                    crate::style::muted_style(),
                ))),
                text_area,
            );
        }
    }
}

#[cfg(test)]
#[path = "render_tests.rs"]
mod tests;
