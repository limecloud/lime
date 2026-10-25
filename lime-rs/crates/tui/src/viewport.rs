//! Lime-native viewport state for the inline TUI surface.
//!
//! The full Codex terminal owns scrollback and buffer diffing in
//! `custom_terminal::Terminal`. Lime currently keeps ratatui's terminal as its renderer, so this
//! module owns the same viewport geometry and cursor anchoring contract without introducing a
//! second renderer. The runtime can use it to keep the composer area stable as the terminal is
//! resized or an alternate screen is entered.

use ratatui::layout::{Position, Rect, Size};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct ViewportState {
    viewport_area: Rect,
    last_known_screen_size: Size,
    last_known_cursor_pos: Position,
    alt_saved_viewport: Option<Rect>,
    alt_screen_active: bool,
    viewport_invalidated: bool,
    visible_history_rows: u16,
}

impl ViewportState {
    pub(crate) fn new(screen_size: Size, cursor_position: Position) -> Self {
        Self {
            viewport_area: Rect::new(0, cursor_position.y, screen_size.width, 0),
            last_known_screen_size: screen_size,
            last_known_cursor_pos: cursor_position,
            alt_saved_viewport: None,
            alt_screen_active: false,
            viewport_invalidated: false,
            visible_history_rows: 0,
        }
    }

    pub(crate) const fn area(&self) -> Rect {
        self.viewport_area
    }

    #[allow(dead_code)]
    pub(crate) const fn is_alt_screen_active(&self) -> bool {
        self.alt_screen_active
    }

    #[allow(dead_code)]
    pub(crate) fn set_viewport_area(&mut self, area: Rect) {
        self.viewport_area = area;
    }

    #[allow(dead_code)]
    pub(crate) fn resize(&mut self, screen_size: Size) {
        let height = self.viewport_area.height.min(screen_size.height);
        let bottom_aligned = self.viewport_area.bottom() == self.last_known_screen_size.height;
        let mut area = self.viewport_area;
        area.width = screen_size.width;
        area.height = height;
        if area.bottom() > screen_size.height
            || (bottom_aligned && screen_size.height > self.last_known_screen_size.height)
        {
            area.y = screen_size.height.saturating_sub(height);
        }
        self.last_known_screen_size = screen_size;
        self.viewport_area = area;
    }

    pub(crate) fn update_inline(&mut self, screen_size: Size, content_height: u16) -> Rect {
        let height = content_height.min(screen_size.height);
        let was_bottom_aligned = self.viewport_area.bottom() == self.last_known_screen_size.height;
        let mut area = self.viewport_area;
        area.width = screen_size.width;
        area.height = height;
        if area.bottom() > screen_size.height
            || (screen_size.height > self.last_known_screen_size.height && was_bottom_aligned)
        {
            area.y = screen_size.height.saturating_sub(height);
        }
        self.last_known_screen_size = screen_size;
        self.viewport_area = area;
        area
    }

    #[allow(dead_code)]
    pub(crate) fn update_cursor_anchor(&mut self, cursor_position: Position) {
        self.last_known_cursor_pos = cursor_position;
    }

    #[allow(dead_code)]
    pub(crate) fn cursor_anchor(&self) -> Position {
        self.last_known_cursor_pos
    }

    #[allow(dead_code)]
    pub(crate) const fn is_viewport_invalidated(&self) -> bool {
        self.viewport_invalidated
    }

    #[allow(dead_code)]
    pub(crate) fn invalidate_viewport(&mut self) {
        self.viewport_invalidated = true;
    }

    pub(crate) fn note_history_rows_inserted(&mut self, rows: u16) {
        self.visible_history_rows = self
            .visible_history_rows
            .saturating_add(rows)
            .min(self.viewport_area.top());
    }

    #[allow(dead_code)]
    pub(crate) const fn visible_history_rows(&self) -> u16 {
        self.visible_history_rows
    }

    #[allow(dead_code)]
    pub(crate) fn clear_for_viewport_change(&self, new_area: Rect) -> Position {
        if self.viewport_area.is_empty() {
            new_area.as_position()
        } else {
            self.viewport_area.as_position()
        }
    }

    pub(crate) fn enter_alternate_screen(&mut self, screen_size: Size) -> Rect {
        if !self.alt_screen_active {
            self.alt_saved_viewport = Some(self.viewport_area);
            self.alt_screen_active = true;
        }
        self.viewport_area = Rect::new(0, 0, screen_size.width, screen_size.height);
        self.last_known_screen_size = screen_size;
        self.viewport_area
    }

    pub(crate) fn leave_alternate_screen(&mut self) -> Rect {
        self.alt_screen_active = false;
        if let Some(area) = self.alt_saved_viewport.take() {
            self.viewport_area = area;
        }
        self.viewport_area
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn inline_viewport_stays_bottom_aligned_when_terminal_grows() {
        let mut state = ViewportState::new(Size::new(80, 24), Position::new(0, 20));
        state.update_inline(Size::new(80, 24), 4);
        let area = state.update_inline(Size::new(80, 30), 4);
        assert_eq!(area, Rect::new(0, 26, 80, 4));
    }

    #[test]
    fn inline_viewport_shrinks_into_terminal_bounds() {
        let mut state = ViewportState::new(Size::new(80, 24), Position::new(0, 20));
        state.update_inline(Size::new(80, 24), 8);
        let area = state.update_inline(Size::new(80, 6), 8);
        assert_eq!(area, Rect::new(0, 0, 80, 6));
    }

    #[test]
    fn alternate_screen_round_trip_restores_inline_viewport() {
        let mut state = ViewportState::new(Size::new(80, 24), Position::new(0, 20));
        state.update_inline(Size::new(80, 24), 4);
        assert_eq!(
            state.enter_alternate_screen(Size::new(100, 40)),
            Rect::new(0, 0, 100, 40)
        );
        assert!(state.is_alt_screen_active());
        assert_eq!(state.leave_alternate_screen(), Rect::new(0, 20, 80, 4));
        assert!(!state.is_alt_screen_active());
    }

    #[test]
    fn repeated_alternate_entry_preserves_original_inline_area() {
        let mut state = ViewportState::new(Size::new(80, 24), Position::new(0, 20));
        state.update_inline(Size::new(80, 24), 4);
        state.enter_alternate_screen(Size::new(100, 40));
        state.enter_alternate_screen(Size::new(120, 50));
        assert_eq!(state.leave_alternate_screen(), Rect::new(0, 20, 80, 4));
    }

    #[test]
    fn resize_keeps_non_bottom_aligned_viewport_position() {
        let mut state = ViewportState::new(Size::new(80, 24), Position::new(0, 5));
        state.set_viewport_area(Rect::new(0, 5, 80, 4));
        state.resize(Size::new(100, 30));
        assert_eq!(state.area(), Rect::new(0, 5, 100, 4));
    }

    #[test]
    fn leaving_alternate_without_saved_area_is_a_noop() {
        let mut state = ViewportState::new(Size::new(80, 24), Position::new(0, 20));
        let original = state.area();
        assert_eq!(state.leave_alternate_screen(), original);
        assert!(!state.is_alt_screen_active());
    }

    #[test]
    fn first_viewport_change_clears_from_new_area_when_old_area_is_empty() {
        let state = ViewportState::new(Size::new(80, 24), Position::new(0, 3));
        assert_eq!(
            state.clear_for_viewport_change(Rect::new(0, 4, 80, 6)),
            Position::new(0, 4)
        );
    }

    #[test]
    fn invalidate_viewport_sets_repaint_marker() {
        let mut state = ViewportState::new(Size::new(80, 24), Position::new(0, 3));
        assert!(!state.is_viewport_invalidated());
        state.invalidate_viewport();
        assert!(state.is_viewport_invalidated());
    }
}
