//! Terminal display-width helpers adapted from Codex TUI.

use unicode_width::UnicodeWidthStr;

pub(crate) fn display_width(text: &str) -> usize {
    UnicodeWidthStr::width(text)
        + text
            .chars()
            .filter(|ch| matches!(ch, '\u{FF9E}' | '\u{FF9F}'))
            .count()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::line_truncation::line_width;
    use ratatui::text::Line;

    #[test]
    fn display_width_matches_ratatui_halfwidth_sound_marks_without_overflow() {
        assert_eq!(display_width("ｶﾞﾊﾟ"), 4);
        assert_eq!(display_width("ｶﾞﾞ"), 3);
        assert_eq!(display_width("界ﾞ"), 3);
        let text = "a".repeat(65_536);
        assert_eq!(display_width(&text), 65_536);
        assert_eq!(line_width(&Line::from(text)), 65_536);
    }
}
