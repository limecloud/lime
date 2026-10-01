//! Return-to-latest affordance for the main transcript's composer gap.
//!
//! Rendering owns the hit rectangle. Hidden controls release their pointer target, so transcript
//! presentation state cannot intercept composer input after the tail becomes visible.

use std::cell::Cell;

use crossterm::event::{MouseButton, MouseEvent, MouseEventKind};
use ratatui::layout::{Position, Rect};
use ratatui::style::Modifier;
use ratatui::text::Line;
use ratatui::widgets::Paragraph;
use ratatui::Frame;

use crate::locale::Locale;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum TranscriptFollowAction {
    Consumed,
    ReturnToLatest,
}

#[derive(Debug, Default)]
pub(crate) struct TranscriptFollowControl {
    area: Cell<Option<Rect>>,
    pointer: Cell<Option<Position>>,
    pressed: Cell<bool>,
}

impl TranscriptFollowControl {
    pub(crate) fn clear(&self) {
        self.area.set(None);
        self.pointer.set(None);
        self.pressed.set(false);
    }

    pub(crate) fn render(
        &self,
        frame: &mut Frame<'_>,
        area: Option<Rect>,
        locale: Locale,
        tail_visible: bool,
        unseen_activity: bool,
    ) {
        let area = area.filter(|area| !area.is_empty() && !tail_visible);
        let Some(area) = area else {
            self.clear();
            return;
        };
        let Some(label) = locale
            .transcript_follow_labels(unseen_activity)
            .into_iter()
            .find(|label| Line::from(*label).width() <= usize::from(area.width))
        else {
            self.clear();
            return;
        };
        let width = u16::try_from(Line::from(label).width())
            .unwrap_or(u16::MAX)
            .min(area.width);
        let target = Rect::new(
            area.x.saturating_add(area.width.saturating_sub(width) / 2),
            area.y,
            width,
            1,
        );
        let hovered = self
            .pointer
            .get()
            .is_some_and(|position| target.contains(position));
        self.area.set(Some(target));
        let mut style =
            crate::style::user_message_style().fg(crate::style::user_message_accent_color());
        if hovered {
            style = style.add_modifier(Modifier::REVERSED | Modifier::BOLD);
        }
        frame.render_widget(Paragraph::new(label).style(style), target);
    }

    pub(crate) fn handle_mouse(&self, event: MouseEvent) -> Option<TranscriptFollowAction> {
        let area = self.area.get()?;
        let position = Position::new(event.column, event.row);
        let was_hovered = self.pointer.get().is_some_and(|point| area.contains(point));
        let inside = area.contains(position);
        self.pointer.set(Some(position));
        match event.kind {
            MouseEventKind::Down(MouseButton::Left) if inside => {
                self.pressed.set(true);
                Some(TranscriptFollowAction::Consumed)
            }
            MouseEventKind::Up(MouseButton::Left) if self.pressed.replace(false) => {
                Some(if inside {
                    TranscriptFollowAction::ReturnToLatest
                } else {
                    TranscriptFollowAction::Consumed
                })
            }
            MouseEventKind::Drag(MouseButton::Left) if self.pressed.get() => {
                Some(TranscriptFollowAction::Consumed)
            }
            MouseEventKind::Moved if inside != was_hovered => {
                Some(TranscriptFollowAction::Consumed)
            }
            _ => None,
        }
    }

    #[cfg(test)]
    pub(crate) fn area(&self) -> Option<Rect> {
        self.area.get()
    }
}

#[cfg(test)]
#[path = "follow_control_tests.rs"]
mod tests;
