//! Footer rendering owned by the bottom-pane interaction surface.
//!
//! Canonical composer and projection state are lowered once into pure presentation props.
//! Configured ambient context shares the row with complete hints; required actions take priority.

use ratatui::layout::{Position, Rect};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Clear, Paragraph};
use ratatui::Frame;

use super::effort_status_line::EffortStatusLineTransition;
use crate::footer_hint::first_fitting_line;
use crate::line_truncation::{line_width, truncate_line_with_ellipsis_if_overflow};
use crate::locale::Locale;
use crate::status::helpers::format_tokens_compact;
use crate::style::footer_hint_label_style;
use crate::width::display_width;

const FOOTER_INDENT_COLS: u16 = 1;

/// Selects the footer surface rendered below the composer.
///
/// The composer owns the transient state, while the footer owns the public presentation
/// vocabulary. Keeping the mode in the snapshot prevents the renderer from re-deriving it from
/// draft text and accidentally diverging from input handling.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) enum FooterMode {
    #[default]
    ComposerEmpty,
    ComposerHasDraft,
    EscHint,
    HistorySearch,
    ShortcutOverlay,
}

/// Returns whether a visible transition requested another animation frame.
pub(crate) fn render_footer(
    frame: &mut Frame<'_>,
    area: Rect,
    props: &FooterProps,
    transition: Option<&EffortStatusLineTransition>,
) -> bool {
    frame.render_widget(Clear, area);
    let content = inset_footer_hint_area(area);
    if content.is_empty() {
        return false;
    }
    if let Some(hints) = props.interaction_hint_lines.as_ref() {
        let lines = hints
            .iter()
            .take(usize::from(content.height))
            .map(|hint| {
                first_fitting_line(
                    [Line::from(Span::styled(
                        hint.clone(),
                        footer_hint_label_style(),
                    ))],
                    usize::from(content.width),
                )
            })
            .collect::<Vec<_>>();
        frame.render_widget(Paragraph::new(lines), content);
        return false;
    }
    if !props.input_enabled {
        return false;
    }
    if props.mode == FooterMode::ShortcutOverlay {
        render_shortcut_close_hint(frame, content, props.shortcut_close_hint.as_deref());
        return false;
    }
    if props.mode == FooterMode::EscHint {
        frame.render_widget(
            Paragraph::new(first_fitting_line(
                [
                    Line::styled(props.locale.esc_backtrack_hint(), footer_hint_label_style()),
                    Line::styled(
                        props.locale.esc_backtrack_hint_compact(),
                        footer_hint_label_style(),
                    ),
                ],
                usize::from(content.width),
            )),
            content,
        );
        return false;
    }
    let vim_indicator = props.vim_mode_indicator.clone();
    if let Some(line) = props.history_search_line.clone() {
        render_line(frame, content, line, vim_indicator.clone());
        if let Some(column) = props.history_search_cursor_column {
            let x = area
                .x
                .saturating_add(column)
                .min(area.x.saturating_add(area.width.saturating_sub(1)));
            frame.set_cursor_position(Position::new(x, area.y));
        }
        return false;
    }
    if let Some(line) = props.vim_search_line.clone() {
        render_line(frame, content, line, vim_indicator);
        return false;
    }
    let mut right = right_footer_line(props);
    let (mut left, show_right) = single_line_footer_layout(props, content, &right);
    if !show_right {
        // Vim remains useful when context yields to an actionable queue or cycle hint.
        right = props
            .vim_mode_indicator
            .clone()
            .map_or_else(Line::default, |indicator| {
                truncate_line_with_ellipsis_if_overflow(
                    Line::from(indicator),
                    usize::from(content.width.saturating_sub(1)),
                )
            });
        let (fallback_left, show_vim) = single_line_footer_layout(props, content, &right);
        left = fallback_left;
        if !show_vim {
            right = Line::default();
        }
    }
    let transition = transition.filter(|_| uses_passive_footer_status_layout(props));
    if let Some(effect) = transition {
        let width = max_left_width_for_right(content, line_width(&right))
            .unwrap_or(usize::from(content.width));
        left = effect
            .render_line(Some(&left), width as u16)
            .unwrap_or_default();
    }
    frame.render_widget(Paragraph::new(left), content);
    render_context_right(frame, content, &right);
    transition.is_some()
}

/// Measurement and painting share one content rectangle; indentation is never part of the hint.
pub(crate) fn inset_footer_hint_area(mut area: Rect) -> Rect {
    let indent = FOOTER_INDENT_COLS.min(area.width);
    area.x = area.x.saturating_add(indent);
    area.width = area.width.saturating_sub(indent);
    area
}

fn render_shortcut_close_hint(frame: &mut Frame<'_>, area: Rect, hint: Option<&str>) {
    let Some(hint) = hint else {
        return;
    };
    let line = first_fitting_line(
        [Line::from(Span::styled(
            hint.to_string(),
            footer_hint_label_style(),
        ))],
        usize::from(area.width),
    );
    frame.render_widget(Paragraph::new(line), area);
}

fn render_line(
    frame: &mut Frame<'_>,
    area: Rect,
    mut line: Line<'static>,
    vim_indicator: Option<Span<'static>>,
) {
    let width = usize::from(area.width);
    if let Some(indicator) = vim_indicator {
        let indicator_width = display_width(&indicator.content);
        if indicator_width >= width {
            line = truncate_line_with_ellipsis_if_overflow(Line::from(indicator), width);
        } else {
            line = truncate_line_with_ellipsis_if_overflow(
                line,
                width.saturating_sub(indicator_width.saturating_add(2)),
            );
            if line_width(&line) > 0 {
                line.push_span("  ");
            }
            line.push_span(indicator);
        }
    } else {
        line = truncate_line_with_ellipsis_if_overflow(line, width);
    }
    frame.render_widget(Paragraph::new(line), area);
}

#[derive(Clone, Debug)]
pub(crate) struct FooterProps {
    pub(crate) status_line_value: Option<Line<'static>>,
    pub(crate) status_line_enabled: bool,
    pub(crate) context_window_percent: Option<i64>,
    pub(crate) context_window_used_tokens: Option<i64>,
    pub(crate) locale: Locale,
    pub(crate) mode: FooterMode,
    pub(crate) input_enabled: bool,
    /// `Some(empty)` explicitly blanks the outer footer for overlays that render their own
    /// controls inside the input surface. `None` keeps the normal composer footer policy.
    pub(crate) interaction_hint_lines: Option<Vec<String>>,
    pub(crate) shortcut_close_hint: Option<String>,
    pub(crate) history_search_line: Option<Line<'static>>,
    pub(crate) history_search_cursor_column: Option<u16>,
    pub(crate) vim_search_line: Option<Line<'static>>,
    pub(crate) vim_mode_indicator: Option<Span<'static>>,
    pub(crate) is_task_running: bool,
    pub(crate) plan_mode: bool,
    pub(crate) active_agent_label: Option<String>,
    pub(crate) agents_hint: Option<String>,
    pub(crate) shortcuts_available: bool,
}

fn uses_passive_footer_status_layout(props: &FooterProps) -> bool {
    props.status_line_enabled
        && matches!(
            props.mode,
            FooterMode::ComposerEmpty | FooterMode::ComposerHasDraft
        )
        && !(props.mode == FooterMode::ComposerHasDraft && props.is_task_running)
}

fn context_window_line(
    percent: Option<i64>,
    used_tokens: Option<i64>,
    locale: Locale,
) -> Line<'static> {
    let text = percent
        .map(|percent| locale.context_window_remaining(percent))
        .or_else(|| {
            used_tokens.map(|tokens| {
                locale.token_usage_value(
                    super::status_line_setup::StatusLineItem::UsedTokens,
                    &format_tokens_compact(tokens),
                )
            })
        });
    text.map_or_else(Line::default, |text| {
        Line::from(Span::styled(text, footer_hint_label_style()))
    })
}

fn right_footer_line(props: &FooterProps) -> Line<'static> {
    let mut line = if uses_passive_footer_status_layout(props) {
        summary_line("", props.plan_mode.then(|| props.locale.plan_mode_label()))
    } else {
        context_window_line(
            props.context_window_percent,
            props.context_window_used_tokens,
            props.locale,
        )
    };
    if let Some(indicator) = props.vim_mode_indicator.clone() {
        if line_width(&line) > 0 {
            line.push_span(Span::styled(" | ", footer_hint_label_style()));
        }
        line.push_span(indicator);
    }
    line
}

/// `area` already includes the shared left indent; leave one column on the right and between sides.
fn max_left_width_for_right(area: Rect, right_width: usize) -> Option<usize> {
    if right_width == 0 {
        return Some(usize::from(area.width));
    }
    usize::from(area.width)
        .checked_sub(right_width + 1)
        .map(|left| left.saturating_sub(1))
}

fn render_context_right(frame: &mut Frame<'_>, area: Rect, line: &Line<'static>) {
    let width = line_width(line);
    if width == 0 || max_left_width_for_right(area, width).is_none() {
        return;
    }
    let width = u16::try_from(width).unwrap_or(u16::MAX);
    frame.render_widget(
        Paragraph::new(line.clone()),
        Rect::new(
            area.x.saturating_add(area.width).saturating_sub(width + 1),
            area.y,
            width,
            1,
        ),
    );
}

/// Follow Codex's actionable collapse order without inventing unavailable usage/status facts.
fn single_line_footer_layout(
    props: &FooterProps,
    area: Rect,
    right: &Line<'_>,
) -> (Line<'static>, bool) {
    let available = usize::from(area.width);
    let left_with_right = max_left_width_for_right(area, line_width(right));
    let has_draft = props.mode == FooterMode::ComposerHasDraft;
    let queue = has_draft && props.is_task_running;
    if let Some(mut line) = passive_footer_status_line(props) {
        let mode = (props.plan_mode && !uses_passive_footer_status_layout(props)).then(|| {
            summary_line(
                "",
                Some(if props.is_task_running {
                    props.locale.plan_mode_label()
                } else {
                    props.locale.plan_mode_cycle_hint()
                }),
            )
        });
        if mode
            .as_ref()
            .is_some_and(|mode| line_width(mode) > available)
        {
            let mode = summary_line("", Some(props.locale.plan_mode_label()));
            return (
                if line_width(&mode) <= available {
                    mode
                } else {
                    Line::default()
                },
                false,
            );
        }
        let show_right = left_with_right
            .is_some_and(|left| mode.as_ref().is_none_or(|mode| line_width(mode) <= left));
        let limit = if show_right {
            left_with_right.unwrap_or(available)
        } else {
            available
        };
        let left_width = mode
            .as_ref()
            .map_or(limit, |mode| limit.saturating_sub(line_width(mode) + 3));
        line = truncate_line_with_ellipsis_if_overflow(line, left_width);
        if !has_draft && line_width(&line) > 0 {
            if let Some(key) = &props.agents_hint {
                let mut with_hint = line.clone();
                with_hint.push_span(Span::styled(
                    format!(" · {}", props.locale.agents_key_hint(key)),
                    footer_hint_label_style(),
                ));
                if line_width(&with_hint) <= left_width {
                    line = with_hint;
                }
            }
        }
        if let Some(mode) = mode {
            if !line.spans.is_empty() {
                line.push_span(" · ");
            }
            line.spans.extend(mode.spans);
        }
        return (
            truncate_line_with_ellipsis_if_overflow(line, limit),
            show_right,
        );
    }
    let hint = if queue {
        props.locale.queue_message_hint().to_string()
    } else if !has_draft {
        match (&props.agents_hint, props.shortcuts_available) {
            (Some(key), true) => format!(
                "{} · {}",
                props.locale.agents_key_hint(key),
                props.locale.shortcuts_hint()
            ),
            (Some(key), false) => props.locale.agents_key_hint(key),
            (None, true) => props.locale.shortcuts_hint().to_string(),
            (None, false) => String::new(),
        }
    } else {
        String::new()
    };
    let full = summary_line(
        &hint,
        props.plan_mode.then(|| {
            if props.is_task_running {
                props.locale.plan_mode_label()
            } else {
                props.locale.plan_mode_cycle_hint()
            }
        }),
    );
    let mut candidates = vec![(full, true)];
    if queue {
        let short = summary_line(
            props.locale.queue_short_hint(),
            props.plan_mode.then(|| props.locale.plan_mode_label()),
        );
        candidates.push((short, true));
    } else if props.plan_mode {
        // Prefer mode cycling over the shortcuts entry; only then reduce to the mode label.
        for text in [
            props.locale.plan_mode_cycle_hint(),
            props.locale.plan_mode_label(),
        ] {
            let line = summary_line("", Some(text));
            // The idle cycle hint must outlive the context indicator.
            candidates.push((
                line,
                props.is_task_running || text == props.locale.plan_mode_cycle_hint(),
            ));
        }
    } else if !has_draft {
        if let Some(key) = &props.agents_hint {
            let compact = summary_line(&props.locale.agents_key_hint(key), None);
            candidates.push((compact, true));
        }
    }
    if props.plan_mode && queue {
        let mode = summary_line("", Some(props.locale.plan_mode_label()));
        candidates.push((mode, props.is_task_running));
    }
    if let Some(limit) = left_with_right {
        for (line, permits_context) in &candidates {
            if *permits_context && line_width(line) <= limit {
                return (line.clone(), true);
            }
        }
    }
    if !queue && !props.plan_mode && left_with_right.is_some() {
        return (Line::default(), true);
    }
    for (line, _) in candidates {
        if line_width(&line) <= available {
            return (line, false);
        }
    }
    (
        Line::default(),
        !queue && !props.plan_mode && left_with_right.is_some(),
    )
}

/// Contextual status and agent identity yield to queue prompts and active input modes.
pub(super) fn passive_footer_status_line(props: &FooterProps) -> Option<Line<'static>> {
    if !matches!(
        props.mode,
        FooterMode::ComposerEmpty | FooterMode::ComposerHasDraft
    ) || props.mode == FooterMode::ComposerHasDraft && props.is_task_running
    {
        return None;
    }
    let mut line = props
        .status_line_enabled
        .then(|| props.status_line_value.clone().unwrap_or_default());
    if let Some(label) = &props.active_agent_label {
        let line = line.get_or_insert_with(Line::default);
        if !line.spans.is_empty() {
            line.push_span(" · ");
        }
        line.push_span(Span::styled(label.clone(), footer_hint_label_style()));
    }
    line
}

fn summary_line(hint: &str, mode: Option<&'static str>) -> Line<'static> {
    let mut line = Line::default();
    if !hint.is_empty() {
        line.push_span(Span::styled(hint.to_string(), footer_hint_label_style()));
    }
    if let Some(mode) = mode {
        if !hint.is_empty() {
            line.push_span(Span::styled(" · ", footer_hint_label_style()));
        }
        // Keep the Plan label emphasized and the cycle suffix secondary.
        let (label, suffix) = mode
            .split_once(" (")
            .or_else(|| mode.split_once('（'))
            .unwrap_or((mode, ""));
        line.push_span(Span::styled(
            label.to_string(),
            ratatui::style::Style::default().magenta(),
        ));
        if !suffix.is_empty() {
            let suffix = &mode[label.len()..];
            line.push_span(Span::styled(suffix.to_string(), footer_hint_label_style()));
        }
    }
    line
}

#[cfg(test)]
#[path = "footer_tests.rs"]
mod tests;
