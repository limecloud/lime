//! Shared-picker layout; measurement, rendering and cursor use the same input rectangle.

use crossterm::event::{KeyCode, KeyEvent};
use ratatui::layout::{Position, Rect};
use ratatui::style::Stylize;
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Clear, FrameExt as _, Paragraph, Wrap};
use ratatui::Frame;

use super::{CustomPromptView, PromptLabels};
use crate::footer_hint::{first_fitting_line, shortcut};
use crate::locale::Locale;
use crate::render::renderable::Renderable;
use crate::style::{accent_style, key_hint_style, muted_style, user_message_style};
use crate::width::display_width;

struct PromptAreas {
    panel: Rect,
    header: Rect,
    input: Rect,
    footer: Rect,
}

fn picker_header<'a>(labels: &PromptLabels<'a>) -> Paragraph<'a> {
    Paragraph::new(Line::from(labels.title).bold()).wrap(Wrap { trim: false })
}

impl CustomPromptView {
    pub(crate) fn picker_desired_height(&self, width: u16, labels: &PromptLabels<'_>) -> u16 {
        let content_width = width.saturating_sub(4);
        picker_header(labels)
            .desired_height(content_width)
            .saturating_add(self.textarea.desired_height(content_width).clamp(1, 8))
            .saturating_add(4)
    }

    fn picker_areas(&self, area: Rect, labels: &PromptLabels<'_>) -> PromptAreas {
        let height = self
            .picker_desired_height(area.width, labels)
            .min(area.height);
        let area = Rect {
            y: area.bottom().saturating_sub(height),
            height,
            ..area
        };
        let panel = Rect {
            height: area.height.saturating_sub(1),
            ..area
        };
        let width = area.width.saturating_sub(4);
        let top_gap = u16::from(panel.height >= 4);
        let header_height = picker_header(labels)
            .desired_height(width)
            .min(panel.height.saturating_sub(top_gap + 1));
        let remaining = panel.height.saturating_sub(top_gap + header_height);
        let gap = u16::from(remaining >= 3);
        let header = Rect {
            x: area.x.saturating_add(2),
            y: area.y.saturating_add(top_gap),
            width,
            height: header_height,
        };
        PromptAreas {
            panel,
            header,
            input: Rect {
                y: header.bottom().saturating_add(gap),
                height: remaining.saturating_sub(gap * 2),
                ..header
            },
            footer: Rect {
                y: panel.bottom(),
                height: u16::from(area.height > 0),
                ..header
            },
        }
    }

    pub(crate) fn render_picker(
        &self,
        frame: &mut Frame<'_>,
        area: Rect,
        labels: &PromptLabels<'_>,
        locale: Locale,
    ) {
        if area.is_empty() {
            return;
        }
        let areas = self.picker_areas(area, labels);
        frame.render_widget(Clear, area);
        frame.render_widget(Block::default().style(user_message_style()), areas.panel);
        frame.render_widget(picker_header(labels), areas.header);
        if !areas.input.is_empty() {
            let mut state = self.textarea_state.get();
            frame.render_stateful_widget_ref(&self.textarea, areas.input, &mut state);
            self.textarea_state.set(state);
            if self.text().is_empty() {
                frame.render_widget(
                    Paragraph::new(labels.placeholder).style(muted_style()),
                    areas.input,
                );
            }
            frame.render_widget(
                Paragraph::new(Line::styled("›", accent_style())),
                Rect {
                    x: area.x,
                    width: 1,
                    height: 1,
                    ..areas.input
                },
            );
            if let Some((x, y)) = self.picker_cursor_pos(area, labels) {
                frame.set_cursor_position(Position::new(x, y));
            }
        }
        let back = if self
            .textarea
            .should_handle_vim_insert_escape(KeyEvent::from(KeyCode::Esc))
        {
            locale.prompt_normal_mode_label()
        } else {
            locale.picker_back_label()
        };
        let accept = !self.text().trim().is_empty();
        let mut full = if accept {
            shortcut("enter", labels.submit).spans
        } else {
            Vec::new()
        };
        if !full.is_empty() {
            full.push(Span::raw(" · "));
        }
        full.extend(shortcut("esc", back).spans);
        let hint = first_fitting_line(
            [
                Line::from(full),
                Line::styled(if accept { "enter · esc" } else { "esc" }, key_hint_style()),
                shortcut("esc", back),
                Line::styled("esc", key_hint_style()),
            ],
            usize::from(areas.footer.width),
        );
        let hint_width = display_width(&hint.to_string());
        frame.render_widget(Paragraph::new(hint), areas.footer);
        if let Some(mode) = self.textarea.vim_mode_indicator_span() {
            let mode_width = display_width(&mode.content) as u16;
            if hint_width.saturating_add(2 + usize::from(mode_width))
                <= usize::from(areas.footer.width)
            {
                frame.render_widget(
                    Paragraph::new(Line::from(mode)),
                    Rect {
                        x: areas.footer.right() - mode_width,
                        width: mode_width,
                        ..areas.footer
                    },
                );
            }
        }
    }

    pub(crate) fn picker_cursor_pos(
        &self,
        area: Rect,
        labels: &PromptLabels<'_>,
    ) -> Option<(u16, u16)> {
        self.textarea.cursor_pos_with_state(
            self.picker_areas(area, labels).input,
            self.textarea_state.get(),
        )
    }
}
