//! Cadenced, whole-grapheme shimmer for the live status header.
//!
//! The effect is deliberately conservative: it only animates when the terminal exposes true
//! color plus foreground/background probes. Other terminals retain the stable dim rendering used
//! by the rest of the TUI, so the status row never becomes noisy or unreadable.

use std::time::Duration;

use ratatui::style::{Modifier, Style};
use ratatui::text::Span;
use unicode_segmentation::UnicodeSegmentation;
use unicode_width::UnicodeWidthStr;

use crate::style::blend;
use crate::terminal_palette::{
    default_bg, default_fg, effective_stdout_color_level, rgb_color, StdoutColorLevel,
};

const START_DELAY: Duration = Duration::from_millis(600);
const SWEEP_SECONDS: f64 = 1.0;
const INTERVAL_SECONDS: f64 = 4.0;

pub(crate) fn summary_shimmer(text: &str, elapsed: Duration) -> Vec<Span<'static>> {
    if text.is_empty() {
        return Vec::new();
    }

    let Some(foreground) = default_fg() else {
        return static_spans(text);
    };
    let Some(background) = default_bg() else {
        return static_spans(text);
    };
    if effective_stdout_color_level() != StdoutColorLevel::TrueColor {
        return static_spans(text);
    }

    let width = text.width() as f64;
    let half_width = (width * 0.1).max(3.0);
    let sweep = elapsed.saturating_sub(START_DELAY).as_secs_f64() % INTERVAL_SECONDS;
    let sweep = sweep.min(SWEEP_SECONDS);
    let position = sweep / SWEEP_SECONDS * (width + 2.0 * half_width) - half_width;

    let mut column = 0.0;
    text.graphemes(true)
        .map(|grapheme| {
            let glyph_width = grapheme.width() as f64;
            let center = column + glyph_width / 2.0;
            column += glyph_width;
            let distance = ((center - position).abs() / half_width).min(1.0);
            let intensity = 0.5 * (1.0 + (std::f64::consts::PI * distance).cos());
            let alpha = (0.5 + 0.5 * intensity) as f32;
            Span::styled(
                grapheme.to_owned(),
                Style::default()
                    .fg(rgb_color(blend(foreground, background, alpha)))
                    .add_modifier(Modifier::BOLD),
            )
        })
        .collect()
}

pub(super) fn static_spans(text: &str) -> Vec<Span<'static>> {
    vec![Span::styled(
        text.to_owned(),
        Style::default().dim().add_modifier(Modifier::BOLD),
    )]
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::terminal_palette::with_test_default_colors;
    use crate::terminal_probe::DefaultColors;

    #[test]
    fn empty_header_has_no_spans() {
        assert!(summary_shimmer("", Duration::from_secs(1)).is_empty());
    }

    #[test]
    fn true_color_shimmer_preserves_grapheme_boundaries() {
        with_test_default_colors(
            DefaultColors {
                fg: (240, 240, 240),
                bg: (10, 10, 10),
            },
            || {
                let spans = summary_shimmer("工a🙂", Duration::from_secs(1));
                assert_eq!(
                    spans
                        .iter()
                        .map(|span| span.content.as_ref())
                        .collect::<String>(),
                    "工a🙂"
                );
                assert_eq!(spans.len(), 3);
            },
        );
    }

    #[test]
    fn before_start_delay_keeps_header_stable() {
        with_test_default_colors(
            DefaultColors {
                fg: (240, 240, 240),
                bg: (10, 10, 10),
            },
            || {
                let spans = summary_shimmer("Working", Duration::ZERO);
                assert!(spans.first().and_then(|span| span.style.fg).is_some());
            },
        );
    }
}
