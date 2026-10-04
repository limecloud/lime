//! Shared composer geometry for rendering, measurement and cursor placement.
//!
//! Keeping the attachment rows and prompt gutter in one owner prevents the screen splitter and
//! renderer from disagreeing on narrow terminals.  The layout is presentation-only; draft and
//! attachment state remain owned by `ChatComposer`.

use ratatui::layout::Rect;

use super::ChatComposer;

pub(crate) const PROMPT_GUTTER_COLS: u16 = 2;
pub(crate) const COMPOSER_TOP_ROWS: u16 = 1;
pub(crate) const COMPOSER_BOTTOM_ROWS: u16 = 1;
pub(crate) const COMPOSER_RIGHT_COLS: u16 = 1;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct ComposerLayout {
    pub(crate) inner: Rect,
    pub(crate) attachments: Rect,
    pub(crate) textarea: Rect,
}

impl ComposerLayout {
    pub(crate) fn for_area(area: Rect, attachment_rows: usize) -> Self {
        let inner = Rect {
            y: area.y.saturating_add(COMPOSER_TOP_ROWS),
            height: area
                .height
                .saturating_sub(COMPOSER_TOP_ROWS + COMPOSER_BOTTOM_ROWS),
            ..area
        };
        if inner.is_empty() {
            return Self {
                inner,
                ..Self::default()
            };
        }

        // On clipped screens preserve one editable row and the attachment/text separator.
        let attachment_height = u16::try_from(attachment_rows)
            .unwrap_or(u16::MAX)
            .min(inner.height.saturating_sub(2));
        let separator = u16::from(attachment_height > 0);
        let text_x = inner.x.saturating_add(PROMPT_GUTTER_COLS.min(inner.width));
        let text_width = inner
            .width
            .saturating_sub(PROMPT_GUTTER_COLS + COMPOSER_RIGHT_COLS);
        let attachments = Rect::new(text_x, inner.y, text_width, attachment_height);
        let textarea = Rect::new(
            text_x,
            inner.y.saturating_add(attachment_height + separator),
            text_width,
            inner.height.saturating_sub(attachment_height + separator),
        );
        Self {
            inner,
            attachments,
            textarea,
        }
    }
}

impl ChatComposer {
    pub(crate) fn layout(&self, area: Rect) -> ComposerLayout {
        ComposerLayout::for_area(area, self.remote_images().len())
    }

    /// Measure the complete composer using the same attachment rows and prompt gutter used by
    /// `ChatComposer::render`.
    pub(crate) fn desired_height_for_width(&self, width: u16) -> u16 {
        self.desired_height(width.saturating_sub(PROMPT_GUTTER_COLS + COMPOSER_RIGHT_COLS))
            .saturating_add(u16::try_from(self.remote_images().len()).unwrap_or(u16::MAX))
            .saturating_add(u16::from(!self.remote_images().is_empty()))
            .saturating_add(COMPOSER_TOP_ROWS + COMPOSER_BOTTOM_ROWS)
    }

    pub(crate) fn cursor_pos(&self, area: Rect) -> Option<(u16, u16)> {
        if !self.input_enabled() || self.has_selected_remote_image() {
            return None;
        }
        let layout = self.layout(area);
        let state = *self.draft.textarea_state.borrow();
        self.textarea()
            .cursor_pos_with_state(layout.textarea, state)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ratatui::layout::Rect;

    #[test]
    fn layout_reserves_attachment_rows_before_textarea() {
        let layout = ComposerLayout::for_area(Rect::new(3, 4, 20, 8), 2);

        assert_eq!(layout.inner, Rect::new(3, 5, 20, 6));
        assert_eq!(layout.attachments, Rect::new(5, 5, 17, 2));
        assert_eq!(layout.textarea, Rect::new(5, 8, 17, 3));
    }

    #[test]
    fn layout_clamps_attachment_rows_and_prompt_gutter_on_narrow_area() {
        let layout = ComposerLayout::for_area(Rect::new(0, 0, 1, 1), usize::MAX);

        assert!(layout.inner.is_empty());
        assert!(layout.attachments.is_empty());
        assert!(layout.textarea.is_empty());
    }

    #[test]
    fn layout_keeps_textarea_width_zero_when_only_prompt_gutter_fits() {
        let layout = ComposerLayout::for_area(Rect::new(0, 0, 2, 4), 0);

        assert_eq!(layout.textarea.width, 0);
        assert_eq!(layout.textarea.height, 2);
    }

    #[test]
    fn clipped_attachments_never_starve_the_editable_baseline() {
        for height in 3..8 {
            let area = Rect::new(4, 5, 20, height);
            let layout = ComposerLayout::for_area(area, usize::MAX);
            assert!(layout.textarea.height >= 1, "{height}: {layout:?}");
            assert!(layout.textarea.bottom() < area.bottom());
            assert_eq!(layout.attachments.x, layout.textarea.x);
        }
    }

    #[test]
    fn measurement_and_wrapping_use_the_same_right_margin_and_vertical_padding() {
        let mut composer = ChatComposer::default();
        composer.insert("12345678");
        assert_eq!(composer.desired_height_for_width(7), 5);
        let layout = composer.layout(Rect::new(0, 0, 7, 5));
        assert_eq!(layout.textarea, Rect::new(2, 1, 4, 3));
    }
}
