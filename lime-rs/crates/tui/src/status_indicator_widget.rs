//! Live status row rendered above the composer while an agent turn is running.
//!
//! The widget owns presentation and width decisions for elapsed time, interrupt hints, inline
//! context, and hook activity. It consumes display-ready values from `App` and the canonical
//! projection; it does not read provider state or create a second runtime state machine.

use std::time::Duration;

use ratatui::layout::Rect;
use ratatui::style::Modifier;
use ratatui::text::{Line, Span, Text};
use ratatui::widgets::Paragraph;
use ratatui::Frame;

use crate::line_truncation::{
    line_width, truncate_line_to_width, truncate_line_with_ellipsis_if_overflow,
};
use crate::locale::Locale;
use crate::style::muted_style;
use crate::width::display_width;
use crate::wrapping::{word_wrap_lines, RtOptions};

#[path = "status_indicator_widget/summary_shimmer.rs"]
mod summary_shimmer;

pub(crate) const STATUS_DETAILS_DEFAULT_MAX_LINES: usize = 3;
const DETAILS_PREFIX: &str = "  └ ";

#[cfg(test)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum StatusDetailsCapitalization {
    CapitalizeFirst,
    Preserve,
}

/// Displays a live status row with optional wrapped details.
///
/// App owns the timer and projection state, while this type owns presentation and width/reflow
/// decisions. The same renderer is used by the regular view and TestBackend/PTY evidence.
#[derive(Debug, Clone)]
pub(crate) struct StatusIndicatorWidget {
    header: String,
    elapsed: Duration,
    interrupt_hint: String,
    details: Option<String>,
    details_max_lines: usize,
    inline_message: Option<String>,
    hook_status_message: Option<String>,
    animations_enabled: bool,
}

impl StatusIndicatorWidget {
    pub(crate) fn new(locale: Locale, elapsed: Duration) -> Self {
        Self {
            header: locale.working_label().to_string(),
            elapsed,
            interrupt_hint: locale.interrupt_hint().to_string(),
            details: None,
            details_max_lines: STATUS_DETAILS_DEFAULT_MAX_LINES,
            inline_message: None,
            hook_status_message: None,
            animations_enabled: true,
        }
    }

    pub(crate) fn set_animations_enabled(&mut self, enabled: bool) {
        self.animations_enabled = enabled;
    }

    #[cfg(test)]
    pub(crate) fn update_details(
        &mut self,
        details: Option<String>,
        capitalization: StatusDetailsCapitalization,
        max_lines: usize,
    ) {
        self.details_max_lines = max_lines.max(1);
        self.details = details
            .filter(|details| !details.trim().is_empty())
            .map(|details| {
                let trimmed = details.trim_start();
                match capitalization {
                    StatusDetailsCapitalization::CapitalizeFirst => {
                        crate::text_formatting::capitalize_first(trimmed)
                    }
                    StatusDetailsCapitalization::Preserve => trimmed.to_string(),
                }
            });
    }

    pub(crate) fn update_inline_message(&mut self, message: Option<String>) {
        self.inline_message = message
            .map(|message| message.trim().to_string())
            .filter(|message| !message.is_empty());
    }

    pub(crate) fn update_hook_status_message(&mut self, message: Option<String>) {
        self.hook_status_message = message
            .map(|message| message.trim().to_string())
            .filter(|message| !message.is_empty());
    }

    #[cfg(test)]
    pub(crate) fn set_interrupt_hint(&mut self, hint: impl Into<String>) {
        self.interrupt_hint = hint.into();
    }

    pub(crate) fn desired_height(&self, width: u16) -> u16 {
        self.lines(width).len().try_into().unwrap_or(u16::MAX)
    }

    pub(crate) fn render(&self, area: Rect, frame: &mut Frame<'_>) {
        if area.is_empty() {
            return;
        }
        frame.render_widget(Paragraph::new(Text::from(self.lines(area.width))), area);
    }

    #[cfg(test)]
    pub(crate) fn status_line(&self, width: u16) -> Line<'static> {
        self.lines(width)
            .into_iter()
            .next()
            .unwrap_or_else(|| Line::from(Vec::<Span<'static>>::new()))
    }

    fn lines(&self, width: u16) -> Vec<Line<'static>> {
        if width == 0 {
            return Vec::new();
        }

        let elapsed = fmt_elapsed_compact(self.elapsed.as_secs());
        let header_style = muted_style().add_modifier(Modifier::BOLD);
        let mut spans = vec![Span::styled("• ", header_style)];
        spans.extend(if self.animations_enabled {
            summary_shimmer::summary_shimmer(&self.header, self.elapsed)
        } else {
            summary_shimmer::static_spans(&self.header)
        });
        spans.push(Span::styled(
            format!(" ({elapsed} • {})", self.interrupt_hint),
            header_style,
        ));
        if let Some(message) = &self.inline_message {
            spans.extend([
                Span::styled(" · ", muted_style()),
                Span::styled(message.clone(), muted_style()),
            ]);
        }

        let mut header = Line::from(spans);
        let mut overflow = None;
        if let Some(message) = &self.hook_status_message {
            let suffix_width = display_width(" · ") + display_width(message);
            if line_width(&header) + suffix_width <= usize::from(width) {
                header.spans.extend([
                    Span::styled(" · ", muted_style()),
                    Span::styled(message.clone(), muted_style()),
                ]);
            } else {
                overflow = Some(truncate_line_with_ellipsis_if_overflow(
                    Line::from(vec![
                        Span::styled(DETAILS_PREFIX, muted_style()),
                        Span::styled(message.clone(), muted_style()),
                    ]),
                    usize::from(width),
                ));
            }
        }

        let mut lines = vec![truncate_line_with_ellipsis_if_overflow(
            header,
            usize::from(width),
        )];
        lines.extend(overflow);
        lines.extend(self.wrapped_details_lines(width));
        lines
    }

    fn wrapped_details_lines(&self, width: u16) -> Vec<Line<'static>> {
        let Some(details) = self.details.as_deref() else {
            return Vec::new();
        };
        if width == 0 {
            return Vec::new();
        }

        let prefix_width = display_width(DETAILS_PREFIX);
        let dim = muted_style();
        let options = RtOptions::new(usize::from(width))
            .initial_indent(Line::from(Span::styled(DETAILS_PREFIX, dim)))
            .subsequent_indent(Line::from(Span::styled(" ".repeat(prefix_width), dim)))
            .break_words(true);
        let mut lines = word_wrap_lines(
            details.lines().map(|line| vec![Span::styled(line, dim)]),
            options,
        );

        if lines.len() > self.details_max_lines {
            lines.truncate(self.details_max_lines);
            let content_width = usize::from(width).saturating_sub(prefix_width).max(1);
            let max_base_width = content_width.saturating_sub(1);
            if let Some(last) = lines.last_mut() {
                let content = last
                    .spans
                    .iter()
                    .map(|span| span.content.as_ref())
                    .collect::<String>();
                let truncated = truncate_line_to_width(Line::from(content), max_base_width);
                let text = truncated
                    .spans
                    .iter()
                    .map(|span| span.content.as_ref())
                    .collect::<String>();
                *last = Line::from(vec![
                    Span::styled(" ".repeat(prefix_width), dim),
                    Span::styled(format!("{text}…"), dim),
                ]);
            }
        }
        lines
    }
}

pub(crate) fn render_with_messages(
    frame: &mut Frame<'_>,
    area: Rect,
    locale: Locale,
    elapsed: Duration,
    inline_message: Option<&str>,
    hook_status_message: Option<&str>,
    animations_enabled: bool,
) {
    let mut widget = StatusIndicatorWidget::new(locale, elapsed);
    widget.set_animations_enabled(animations_enabled);
    widget.update_inline_message(inline_message.map(ToOwned::to_owned));
    widget.update_hook_status_message(hook_status_message.map(ToOwned::to_owned));
    widget.render(area, frame);
}

pub(crate) fn desired_height_with_messages(
    width: u16,
    locale: Locale,
    elapsed: Duration,
    inline_message: Option<&str>,
    hook_status_message: Option<&str>,
) -> u16 {
    let mut widget = StatusIndicatorWidget::new(locale, elapsed);
    widget.update_inline_message(inline_message.map(ToOwned::to_owned));
    widget.update_hook_status_message(hook_status_message.map(ToOwned::to_owned));
    widget.desired_height(width)
}

pub fn fmt_elapsed_compact(elapsed_secs: u64) -> String {
    if elapsed_secs < 60 {
        return format!("{elapsed_secs}s");
    }
    if elapsed_secs < 3_600 {
        return format!("{}m {:02}s", elapsed_secs / 60, elapsed_secs % 60);
    }
    format!(
        "{}h {:02}m {:02}s",
        elapsed_secs / 3_600,
        (elapsed_secs % 3_600) / 60,
        elapsed_secs % 60
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::line_truncation::line_width;

    #[test]
    fn elapsed_time_matches_codex_compact_format() {
        assert_eq!(fmt_elapsed_compact(0), "0s");
        assert_eq!(fmt_elapsed_compact(59), "59s");
        assert_eq!(fmt_elapsed_compact(60), "1m 00s");
        assert_eq!(fmt_elapsed_compact(3_599), "59m 59s");
        assert_eq!(fmt_elapsed_compact(3_600), "1h 00m 00s");
        assert_eq!(fmt_elapsed_compact(7_389), "2h 03m 09s");
    }

    #[test]
    fn hook_status_moves_to_a_second_line_when_the_header_does_not_fit() {
        let mut widget = StatusIndicatorWidget::new(Locale::EnUs, Duration::ZERO);
        widget.update_hook_status_message(Some("checking 日本語 policy".to_string()));
        assert_eq!(widget.desired_height(80), 1);
        assert_eq!(widget.desired_height(24), 2);
    }

    #[test]
    fn details_are_wrapped_and_bounded_by_max_lines() {
        let mut widget = StatusIndicatorWidget::new(Locale::EnUs, Duration::ZERO);
        widget.update_details(
            Some("cargo test -p tui and then cargo test -p cli".to_string()),
            StatusDetailsCapitalization::Preserve,
            1,
        );
        assert_eq!(widget.desired_height(24), 2);
        let lines = widget.wrapped_details_lines(24);
        assert_eq!(lines.len(), 1);
        assert!(line_width(lines.first().expect("details line")) <= 24);
        assert!(lines
            .first()
            .expect("details line")
            .to_string()
            .ends_with('…'));
    }

    #[test]
    fn renders_without_spinner_when_animations_disabled() {
        let mut widget = StatusIndicatorWidget::new(Locale::EnUs, Duration::ZERO);
        widget.set_animations_enabled(false);
        let line = widget.status_line(80).to_string();
        assert!(line.starts_with("• Working (0s • esc to interrupt)"));
    }

    #[test]
    fn disabled_motion_keeps_the_live_header_static_with_a_real_color_palette() {
        crate::terminal_palette::with_test_default_colors(
            crate::terminal_probe::DefaultColors {
                fg: (240, 240, 240),
                bg: (10, 10, 10),
            },
            || {
                let mut widget = StatusIndicatorWidget::new(Locale::EnUs, Duration::from_secs(1));
                let animated = widget.status_line(80);
                widget.set_animations_enabled(false);
                let static_line = widget.status_line(80);
                assert_eq!(animated.to_string(), static_line.to_string());
                assert_eq!(static_line.spans[1].content, "Working");
                assert!(static_line.spans[1]
                    .style
                    .add_modifier
                    .contains(Modifier::DIM));
                assert_ne!(animated.spans[1].style, static_line.spans[1].style);
            },
        );
    }

    #[test]
    fn renders_remapped_interrupt_hint() {
        let mut widget = StatusIndicatorWidget::new(Locale::EnUs, Duration::ZERO);
        widget.set_interrupt_hint("F12 to interrupt");
        assert!(widget
            .status_line(80)
            .to_string()
            .contains("F12 to interrupt"));
    }

    #[test]
    fn hook_status_reflows_without_displacing_controls_or_details() {
        let mut widget = StatusIndicatorWidget::new(Locale::EnUs, Duration::ZERO);
        widget.update_hook_status_message(Some("checking 日本語 ｶﾞﾊﾟ policy".to_string()));
        widget.update_details(
            Some("existing details".to_string()),
            StatusDetailsCapitalization::Preserve,
            STATUS_DETAILS_DEFAULT_MAX_LINES,
        );

        let expected = "• Working (0s • esc to interrupt) · checking 日本語 ｶﾞﾊﾟ policy";
        let fit_width = display_width(expected) as u16;
        assert_eq!(widget.desired_height(fit_width), 2);
        assert_eq!(widget.desired_height(fit_width.saturating_sub(1)), 3);

        widget.update_inline_message(Some(
            "1 background terminal running · /ps to view · /stop to close".to_string(),
        ));
        assert!(widget.desired_height(fit_width) >= 2);
    }

    #[test]
    fn details_overflow_adds_ellipsis() {
        let mut widget = StatusIndicatorWidget::new(Locale::EnUs, Duration::ZERO);
        widget.update_details(
            Some("abcd abcd abcd abcd".to_string()),
            StatusDetailsCapitalization::CapitalizeFirst,
            STATUS_DETAILS_DEFAULT_MAX_LINES,
        );
        let lines = widget.wrapped_details_lines(6);
        assert_eq!(lines.len(), STATUS_DETAILS_DEFAULT_MAX_LINES);
        assert!(lines
            .last()
            .expect("last details line")
            .to_string()
            .ends_with('…'));
    }

    #[test]
    fn details_args_can_disable_capitalization_and_limit_lines() {
        let mut widget = StatusIndicatorWidget::new(Locale::EnUs, Duration::ZERO);
        widget.update_details(
            Some("cargo test -p tui and then cargo test -p cli".to_string()),
            StatusDetailsCapitalization::Preserve,
            1,
        );
        assert_eq!(
            widget.details.as_deref(),
            Some("cargo test -p tui and then cargo test -p cli")
        );
        let lines = widget.wrapped_details_lines(24);
        assert_eq!(lines.len(), 1);
        assert!(lines
            .last()
            .expect("details line")
            .to_string()
            .ends_with('…'));
    }

    #[test]
    fn localized_status_keeps_interrupt_hint_and_width_bound() {
        for (locale, working, interrupt) in [
            (Locale::ZhCn, "处理中", "Esc 中断"),
            (Locale::ZhTw, "處理中", "Esc 中斷"),
            (Locale::EnUs, "Working", "esc to interrupt"),
            (Locale::JaJp, "処理中", "Esc で中断"),
            (Locale::KoKr, "작업 중", "Esc로 중단"),
        ] {
            let widget = StatusIndicatorWidget::new(locale, Duration::from_secs(63));
            let line = widget.status_line(80).to_string();
            assert!(line.contains(working), "{locale:?}: {line}");
            assert!(line.contains(interrupt), "{locale:?}: {line}");
            assert!(line_width(&widget.status_line(18)) <= 18);
        }
    }

    #[test]
    fn active_status_height_and_width_are_bounded_for_supported_locales() {
        for locale in [
            Locale::ZhCn,
            Locale::ZhTw,
            Locale::EnUs,
            Locale::JaJp,
            Locale::KoKr,
        ] {
            for width in [40, 80, 120] {
                let mut widget = StatusIndicatorWidget::new(locale, Duration::from_secs(12));
                widget.update_inline_message(Some("queue editing".to_string()));
                widget.update_hook_status_message(Some("checking 日本語 policy".to_string()));
                let lines = widget.lines(width);
                assert!(
                    !lines.is_empty(),
                    "missing status for {locale:?} at {width}"
                );
                assert!(
                    lines
                        .iter()
                        .all(|line| line_width(line) <= usize::from(width)),
                    "status overflow for {locale:?} at {width}: {lines:?}"
                );
                assert_eq!(widget.desired_height(width), lines.len() as u16);
            }
        }
    }

    #[test]
    fn hook_and_details_reflow_to_distinct_rows_without_dropping_the_header() {
        let mut widget = StatusIndicatorWidget::new(Locale::EnUs, Duration::from_secs(12));
        widget.update_hook_status_message(Some("checking policy".to_string()));
        widget.update_details(
            Some("a long running command with useful details".to_string()),
            StatusDetailsCapitalization::Preserve,
            STATUS_DETAILS_DEFAULT_MAX_LINES,
        );

        let lines = widget.lines(40);
        assert!(
            lines.len() >= 3,
            "expected header, hook and details: {lines:?}"
        );
        assert!(lines[0].to_string().contains("Working"));
        assert!(lines
            .iter()
            .skip(1)
            .any(|line| line.to_string().contains("checking")));
        assert!(lines.iter().skip(1).all(|line| line_width(line) <= 40));
    }
}
