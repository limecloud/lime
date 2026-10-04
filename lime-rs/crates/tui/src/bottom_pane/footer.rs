//! Footer rendering owned by the bottom-pane interaction surface.
//!
//! Canonical composer and projection state are lowered once into pure presentation props.
//! Instructional hints yield to passive agent context while idle, but never to protocol ids.

use ratatui::layout::{Position, Rect};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Clear, Paragraph};
use ratatui::Frame;

use crate::line_truncation::{line_width, truncate_line_with_ellipsis_if_overflow};
use crate::locale::Locale;
use crate::style::footer_hint_label_style;
use crate::width::usable_content_width_u16;

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
    HistorySearch,
    ShortcutOverlay,
}

pub(crate) fn render_footer(frame: &mut Frame<'_>, area: Rect, props: &FooterProps) {
    if let Some(hints) = props
        .interaction_hint_lines
        .as_ref()
        .filter(|hints| !hints.is_empty())
    {
        let width = usable_content_width_u16(area.width, FOOTER_INDENT_COLS).unwrap_or_default();
        let lines = hints
            .iter()
            .take(usize::from(area.height))
            .map(|hint| {
                truncate_line_with_ellipsis_if_overflow(
                    Line::from(Span::styled(format!(" {hint}"), footer_hint_label_style())),
                    width,
                )
            })
            .collect::<Vec<_>>();
        frame.render_widget(Clear, area);
        frame.render_widget(Paragraph::new(lines), area);
        return;
    }
    if !props.input_enabled {
        frame.render_widget(Clear, area);
        return;
    }
    if props.mode == FooterMode::ShortcutOverlay {
        render_shortcut_close_hint(frame, area, props.shortcut_close_hint.as_deref());
        return;
    }
    let vim_indicator = props.vim_mode_indicator.clone();
    if let Some(line) = props.history_search_line.clone() {
        render_line(frame, area, line, vim_indicator.clone());
        if let Some(column) = props.history_search_cursor_column {
            let x = area
                .x
                .saturating_add(column)
                .min(area.x.saturating_add(area.width.saturating_sub(1)));
            frame.set_cursor_position(Position::new(x, area.y));
        }
        return;
    }
    if let Some(line) = props.vim_search_line.clone() {
        render_line(frame, area, line, vim_indicator);
        return;
    }
    render_line(
        frame,
        area,
        single_line_footer_layout(props, area.width),
        vim_indicator,
    );
}

fn render_shortcut_close_hint(frame: &mut Frame<'_>, area: Rect, hint: Option<&str>) {
    let Some(hint) = hint else {
        return;
    };
    let width = usize::from(area.width.saturating_sub(1));
    let line = Line::from(Span::styled(format!(" {hint}"), footer_hint_label_style()));
    frame.render_widget(
        Paragraph::new(truncate_line_with_ellipsis_if_overflow(line, width + 1)),
        area,
    );
}

fn render_line(
    frame: &mut Frame<'_>,
    area: Rect,
    mut line: Line<'static>,
    vim_indicator: Option<Span<'static>>,
) {
    if let Some(indicator) = vim_indicator {
        if line_width(&line) > 0 {
            line.push_span("  ");
        }
        line.push_span(indicator);
    }
    line.spans
        .insert(0, Span::raw(" ".repeat(usize::from(FOOTER_INDENT_COLS))));
    let width = usable_content_width_u16(area.width, FOOTER_INDENT_COLS).unwrap_or_default();
    frame.render_widget(
        Paragraph::new(truncate_line_with_ellipsis_if_overflow(line, width)),
        area,
    );
}

#[derive(Clone, Debug)]
pub(crate) struct FooterProps {
    pub(crate) locale: Locale,
    pub(crate) mode: FooterMode,
    pub(crate) input_enabled: bool,
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

/// Follow Codex's actionable collapse order without inventing unavailable usage/status facts.
fn single_line_footer_layout(props: &FooterProps, width: u16) -> Line<'static> {
    let available = usize::from(width.saturating_sub(FOOTER_INDENT_COLS));
    let fits = |line: &Line<'_>| line_width(line) <= available;
    let has_draft = props.mode == FooterMode::ComposerHasDraft;
    let queue = has_draft && props.is_task_running;
    if !queue {
        if let Some(label) = &props.active_agent_label {
            let mut line = Line::from(Span::styled(label.clone(), footer_hint_label_style()));
            if !has_draft {
                if let Some(key) = &props.agents_hint {
                    line.push_span(Span::styled(
                        format!(" · {}", props.locale.agents_key_hint(key)),
                        footer_hint_label_style(),
                    ));
                }
            }
            return line;
        }
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
    if fits(&full) {
        return full;
    }
    if queue {
        let short = summary_line(
            props.locale.queue_short_hint(),
            props.plan_mode.then(|| props.locale.plan_mode_label()),
        );
        if fits(&short) {
            return short;
        }
    } else if props.plan_mode {
        // Prefer mode cycling over the shortcuts entry; only then reduce to the mode label.
        for text in [
            props.locale.plan_mode_cycle_hint(),
            props.locale.plan_mode_label(),
        ] {
            let line = summary_line("", Some(text));
            if fits(&line) {
                return line;
            }
        }
    } else if !has_draft {
        if let Some(key) = &props.agents_hint {
            let compact = summary_line(&props.locale.agents_key_hint(key), None);
            if fits(&compact) {
                return compact;
            }
        }
    }
    if props.plan_mode {
        let mode = summary_line("", Some(props.locale.plan_mode_label()));
        if fits(&mode) {
            return mode;
        }
    }
    Line::default()
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
        // Match Codex's mode emphasis rather than treating Plan as passive right-side context.
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
mod tests {
    use super::render_footer;
    use crate::app::App;
    use crate::locale::Locale;
    use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
    use ratatui::backend::TestBackend;
    use ratatui::Terminal;

    fn rendered_text_at_width(app: &App, width: u16) -> String {
        let mut terminal = Terminal::new(TestBackend::new(width, 1)).expect("terminal");
        terminal
            .draw(|frame| {
                let props = app.chat_widget.footer_props(
                    width,
                    app.projection.active_turn_id().is_some(),
                    app.thread_id.as_deref(),
                    app.primary_thread_id.as_deref(),
                );
                render_footer(frame, frame.area(), &props)
            })
            .expect("draw footer");
        let buffer = terminal.backend().buffer();
        (0..buffer.area.width)
            .map(|x| buffer[(x, 0)].symbol())
            .collect::<String>()
    }

    fn rendered_text(app: &App) -> String {
        rendered_text_at_width(app, 64)
    }

    #[test]
    fn idle_draft_suppresses_instructional_footer() {
        let mut app = App::default();
        app.chat_widget.bottom_pane.composer.insert("draft");

        assert!(rendered_text(&app).trim().is_empty());
    }

    #[test]
    fn disabled_composer_clears_passive_footer() {
        let mut app = App::default();
        app.chat_widget
            .bottom_pane
            .set_composer_input_enabled(false, Some("Waiting".to_string()));

        assert!(rendered_text(&app).trim().is_empty());

        app.chat_widget
            .bottom_pane
            .set_composer_input_enabled(true, None);
        assert!(!rendered_text(&app).trim().is_empty());
    }

    #[test]
    fn idle_footer_keeps_localized_shortcut_entry_point_across_supported_widths() {
        for locale in [
            Locale::ZhCn,
            Locale::ZhTw,
            Locale::EnUs,
            Locale::JaJp,
            Locale::KoKr,
        ] {
            let mut app = App::default();
            app.set_locale(locale);
            for width in [40, 80, 120] {
                let text = rendered_text_at_width(&app, width);
                let compact = text
                    .chars()
                    .filter(|character| !character.is_whitespace())
                    .collect::<String>();
                let expected = locale
                    .shortcuts_hint()
                    .chars()
                    .filter(|character| !character.is_whitespace())
                    .collect::<String>();
                assert!(
                    compact.contains(&expected),
                    "{locale:?} at {width}: {text:?}"
                );
                assert_eq!(
                    text.lines().count(),
                    1,
                    "footer must remain a single row for {locale:?} at {width}: {text:?}"
                );
            }
        }
    }

    #[test]
    fn passive_agent_label_replaces_shortcuts_in_empty_and_idle_draft_modes() {
        let mut app = App::default();
        app.set_thread_id("main".to_string());
        app.chat_widget.agent_navigation.upsert(
            "agent-1",
            Some("Robie".into()),
            Some("explorer".into()),
            false,
        );
        app.set_thread_id("agent-1".to_string());
        for draft in ["", "draft"] {
            app.chat_widget
                .bottom_pane
                .composer
                .replace(draft.to_string());
            let text = rendered_text_at_width(&app, 40);
            assert!(text.contains("Robie [explorer]"), "{text}");
            assert!(!text.contains("? for shortcuts"), "{text}");
        }
    }

    #[test]
    fn active_draft_prefers_queue_hint_and_hides_context_when_narrow() {
        let mut app = App::default();
        app.set_thread_id("main".to_string());
        app.chat_widget.agent_navigation.upsert(
            "agent-1",
            Some("Robie".to_string()),
            Some("explorer".to_string()),
            false,
        );
        app.set_thread_id("agent-1".to_string());
        app.start_turn("turn-1".to_string());
        app.chat_widget.bottom_pane.composer.insert("draft");

        let text = rendered_text_at_width(&app, 30);
        assert!(text.contains("Tab to queue message"), "{text}");
        assert!(!text.contains("Robie [explorer]"), "{text}");
    }

    #[test]
    fn queue_hint_shortens_before_it_disappears() {
        let mut app = App::default();
        app.start_turn("internal-turn-id".into());
        app.chat_widget.bottom_pane.composer.insert("draft");
        let short = rendered_text_at_width(&app, 14);
        assert!(short.contains("Tab to queue"), "{short}");
        assert!(rendered_text_at_width(&app, 5).trim().is_empty());
    }

    #[test]
    fn running_empty_composer_shows_shortcuts_not_protocol_identity() {
        let mut app = App::default();
        app.start_turn("internal-turn-id".into());
        let text = rendered_text(&app);
        assert!(text.contains("? for shortcuts"), "{text}");
        assert!(!text.contains("internal-turn-id"), "{text}");
    }

    #[test]
    fn queue_hint_is_localized_and_attachments_count_as_draft() {
        for locale in [
            Locale::ZhCn,
            Locale::ZhTw,
            Locale::EnUs,
            Locale::JaJp,
            Locale::KoKr,
        ] {
            let mut app = App::default();
            app.set_locale(locale);
            app.start_turn("internal-turn-id".into());
            app.chat_widget
                .bottom_pane
                .composer
                .attach_image(std::path::PathBuf::from("/tmp/image.png"));
            let text = rendered_text_at_width(&app, 100);
            let compact = |text: &str| {
                text.chars()
                    .filter(|c| !c.is_whitespace())
                    .collect::<String>()
            };
            assert!(
                compact(&text).contains(&compact(locale.queue_message_hint())),
                "{text}"
            );
        }
    }

    #[test]
    fn renders_localized_history_search_query() {
        let mut app = App::default();
        app.set_locale(Locale::ZhCn);
        app.chat_widget
            .bottom_pane
            .composer
            .set_cached_history(["git status".to_string()]);
        app.chat_widget.bottom_pane.composer.insert("git");
        app.chat_widget
            .bottom_pane
            .composer
            .handle_key_event(KeyEvent::new(KeyCode::Char('r'), KeyModifiers::CONTROL));
        app.chat_widget
            .bottom_pane
            .composer
            .handle_key_event(KeyEvent::new(KeyCode::Char('g'), KeyModifiers::NONE));

        let text = rendered_text(&app);
        let compact = text
            .chars()
            .filter(|character| !character.is_whitespace())
            .collect::<String>();
        assert!(compact.contains("反向搜索：g"), "{text}");
    }

    #[test]
    fn renders_active_agent_context() {
        let mut app = App::default();
        app.set_thread_id("main".to_string());
        app.chat_widget.agent_navigation.upsert(
            "agent-1",
            Some("Robie".to_string()),
            Some("explorer".to_string()),
            false,
        );
        app.set_thread_id("agent-1".to_string());

        let text = rendered_text(&app);
        assert!(text.contains("Robie [explorer]"), "{text}");
    }

    #[test]
    fn plan_mode_footer_explains_shift_tab_when_idle_and_fits() {
        let mut app = App::default();
        app.chat_widget.collaboration_mode = Some(agent_protocol::CollaborationMode {
            mode: agent_protocol::ModeKind::Plan,
            settings: agent_protocol::CollaborationModeSettings {
                model: "fixture-model".to_string(),
                reasoning_effort: Some("high".to_string()),
                developer_instructions: None,
            },
        });

        let wide = rendered_text_at_width(&app, 100);
        assert!(wide.contains("Plan mode (shift+tab to cycle)"), "{wide}");

        let narrow = rendered_text_at_width(&app, 44);
        assert!(
            narrow.contains("Plan mode (shift+tab to cycle)"),
            "{narrow}"
        );
        assert!(!narrow.contains("? for shortcuts"), "{narrow}");
        let tiny = rendered_text_at_width(&app, 16);
        assert!(tiny.contains("Plan mode"), "{tiny}");
        assert!(!tiny.contains("shift+tab"), "{tiny}");

        app.start_turn("turn-1".to_string());
        let running = rendered_text_at_width(&app, 100);
        assert!(running.contains("Plan mode"), "{running}");
        assert!(!running.contains("shift+tab"), "{running}");
        app.chat_widget.bottom_pane.composer.insert("draft");
        let queue = rendered_text_at_width(&app, 100);
        assert!(
            queue.contains("Tab to queue message · Plan mode"),
            "{queue}"
        );
        let short = rendered_text_at_width(&app, 26);
        assert!(short.contains("Tab to queue · Plan mode"), "{short}");
        assert!(rendered_text_at_width(&app, 16).contains("Plan mode"));
    }

    #[test]
    fn plan_mode_footer_hides_hint_while_composer_popup_is_active() {
        let mut app = App::default();
        app.chat_widget.collaboration_mode = Some(agent_protocol::CollaborationMode {
            mode: agent_protocol::ModeKind::Plan,
            settings: agent_protocol::CollaborationModeSettings {
                model: "fixture-model".to_string(),
                reasoning_effort: None,
                developer_instructions: None,
            },
        });
        app.chat_widget.bottom_pane.composer.insert("/model");
        app.chat_widget.bottom_pane.composer.sync_completion_popup();

        let text = rendered_text_at_width(&app, 100);
        assert!(!text.contains("Plan mode"), "{text}");
    }

    #[test]
    fn renders_vim_mode_indicator_and_truncates_it_in_a_narrow_terminal() {
        let mut app = App::default();
        app.chat_widget.bottom_pane.composer.set_vim_enabled(true);

        assert!(rendered_text(&app).contains("Vim: Normal"));

        let narrow = rendered_text_at_width(&app, 10);
        assert_eq!(narrow.chars().count(), 10, "{narrow}");
        assert!(narrow.contains('…'), "{narrow}");
    }

    #[test]
    fn renders_vim_search_query_before_submission() {
        let mut app = App::default();
        app.chat_widget.bottom_pane.composer.set_vim_enabled(true);
        app.chat_widget.bottom_pane.composer.insert("alpha beta");
        app.chat_widget
            .bottom_pane
            .composer
            .handle_key_event(KeyEvent::new(KeyCode::Char('/'), KeyModifiers::NONE));
        app.chat_widget
            .bottom_pane
            .composer
            .handle_key_event(KeyEvent::new(KeyCode::Char('b'), KeyModifiers::NONE));

        let text = rendered_text(&app);
        assert!(text.contains("/b"), "{text}");
    }
}
