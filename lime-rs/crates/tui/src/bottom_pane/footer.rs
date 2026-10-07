//! Footer rendering owned by the bottom-pane interaction surface.
//!
//! Canonical composer and projection state are lowered once into pure presentation props.
//! Instructional hints yield to passive agent context while idle, but never to protocol ids.

use ratatui::layout::{Position, Rect};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Clear, Paragraph};
use ratatui::Frame;

use crate::footer_hint::first_fitting_line;
use crate::line_truncation::{line_width, truncate_line_with_ellipsis_if_overflow};
use crate::locale::Locale;
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
    HistorySearch,
    ShortcutOverlay,
}

pub(crate) fn render_footer(frame: &mut Frame<'_>, area: Rect, props: &FooterProps) {
    frame.render_widget(Clear, area);
    let content = inset_footer_hint_area(area);
    if content.is_empty() {
        return;
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
        return;
    }
    if !props.input_enabled {
        return;
    }
    if props.mode == FooterMode::ShortcutOverlay {
        render_shortcut_close_hint(frame, content, props.shortcut_close_hint.as_deref());
        return;
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
        return;
    }
    if let Some(line) = props.vim_search_line.clone() {
        render_line(frame, content, line, vim_indicator);
        return;
    }
    let indicator_width = vim_indicator.as_ref().map_or(0, |indicator| {
        u16::try_from(display_width(&indicator.content).saturating_add(2)).unwrap_or(u16::MAX)
    });
    render_line(
        frame,
        content,
        single_line_footer_layout(props, content.width.saturating_sub(indicator_width)),
        vim_indicator,
    );
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

/// Follow Codex's actionable collapse order without inventing unavailable usage/status facts.
fn single_line_footer_layout(props: &FooterProps, width: u16) -> Line<'static> {
    let available = usize::from(width);
    let fits = |line: &Line<'_>| line_width(line) <= available;
    let has_draft = props.mode == FooterMode::ComposerHasDraft;
    let queue = has_draft && props.is_task_running;
    if let Some(mut line) = passive_footer_status_line(props) {
        let mode = props
            .plan_mode
            .then(|| summary_line("", Some(props.locale.plan_mode_label())));
        if mode
            .as_ref()
            .is_some_and(|mode| line_width(mode) > available)
        {
            return Line::default();
        }
        let left_width = mode.as_ref().map_or(available, |mode| {
            available.saturating_sub(line_width(mode) + 3)
        });
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
        return truncate_line_with_ellipsis_if_overflow(line, available);
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

/// Contextual status and agent identity yield to queue prompts and active input modes.
fn passive_footer_status_line(props: &FooterProps) -> Option<Line<'static>> {
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
    use super::{render_footer, FooterProps};
    use crate::app::App;
    use crate::locale::Locale;
    use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
    use ratatui::backend::TestBackend;
    use ratatui::Terminal;

    fn rendered_text_at_width(app: &App, width: u16) -> String {
        let props = app.chat_widget.footer_props(
            width,
            app.projection.active_turn_id().is_some(),
            app.thread_id.as_deref(),
            app.primary_thread_id.as_deref(),
        );
        rendered_props_at_width(&props, width)
    }

    fn rendered_props_at_width(props: &FooterProps, width: u16) -> String {
        let mut terminal = Terminal::new(TestBackend::new(width, 1)).expect("terminal");
        terminal
            .draw(|frame| render_footer(frame, frame.area(), props))
            .expect("draw footer");
        let buffer = terminal.backend().buffer();
        (0..buffer.area.width)
            .map(|x| buffer[(x, 0)].symbol())
            .collect::<String>()
    }

    fn rendered_text(app: &App) -> String {
        rendered_text_at_width(app, 64)
    }

    fn compact(text: &str) -> String {
        text.chars().filter(|c| !c.is_whitespace()).collect()
    }

    #[test]
    fn painted_footer_keeps_the_complete_hint_at_its_exact_content_width() {
        for locale in [
            Locale::ZhCn,
            Locale::ZhTw,
            Locale::EnUs,
            Locale::JaJp,
            Locale::KoKr,
        ] {
            let mut app = App::default();
            app.set_locale(locale);
            let width =
                u16::try_from(crate::width::display_width(locale.shortcuts_hint()) + 1).unwrap();
            let text = rendered_text_at_width(&app, width);
            assert_eq!(
                compact(&text),
                compact(locale.shortcuts_hint()),
                "{locale:?}: {text}"
            );
            assert!(!text.contains('…'), "complete hint clipped: {text}");
        }
    }

    #[test]
    fn painted_interaction_footer_never_clips_a_chord_at_the_content_boundary() {
        let app = App::default();
        for hint in ["ctrl+x q", "f9 · ctrl+x q"] {
            let width = u16::try_from(crate::width::display_width(hint) + 1).unwrap();
            let mut props = app.chat_widget.footer_props(width, false, None, None);
            props.interaction_hint_lines = Some(vec![hint.to_string()]);
            let text = rendered_props_at_width(&props, width);
            assert_eq!(text.trim(), hint, "{width}: {text}");
        }
    }

    #[test]
    fn passive_agent_context_only_appends_complete_action_hints() {
        let app = App::default();
        for locale in [
            Locale::ZhCn,
            Locale::ZhTw,
            Locale::EnUs,
            Locale::JaJp,
            Locale::KoKr,
        ] {
            for width in 1..80 {
                let mut props = app.chat_widget.footer_props(width, false, None, None);
                props.locale = locale;
                props.active_agent_label = Some("Explorer".into());
                props.agents_hint = Some("ctrl+x a".into());
                let text = rendered_props_at_width(&props, width);
                if let Some((_, hint)) = text.split_once('·') {
                    assert_eq!(
                        compact(hint),
                        compact(&locale.agents_key_hint("ctrl+x a")),
                        "{locale:?}/{width}: {text}"
                    );
                }
            }
        }
    }

    #[test]
    fn footer_reserves_vim_context_before_choosing_complete_action_hints() {
        for locale in [
            Locale::ZhCn,
            Locale::ZhTw,
            Locale::EnUs,
            Locale::JaJp,
            Locale::KoKr,
        ] {
            let mut app = App::default();
            app.set_locale(locale);
            app.chat_widget.bottom_pane.composer.set_vim_enabled(true);
            let expected = format!("{}  Vim: Normal", locale.shortcuts_hint());
            let width = u16::try_from(crate::width::display_width(&expected) + 1).unwrap();
            let text = rendered_text_at_width(&app, width);
            assert_eq!(compact(&text), compact(&expected), "{locale:?}: {text}");
            let narrower = rendered_text_at_width(&app, width - 1);
            assert!(narrower.contains("Vim: Normal"), "{narrower}");
            assert!(
                !narrower.contains('…'),
                "action copy clipped by Vim: {narrower}"
            );
        }
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
    fn explicit_empty_interaction_hints_clear_the_outer_footer() {
        let app = App::default();
        let mut props = app.chat_widget.footer_props(
            64,
            false,
            app.thread_id.as_deref(),
            app.primary_thread_id.as_deref(),
        );
        props.interaction_hint_lines = Some(Vec::new());

        let mut terminal = Terminal::new(TestBackend::new(64, 1)).expect("terminal");
        terminal
            .draw(|frame| render_footer(frame, frame.area(), &props))
            .expect("draw footer");
        let text = terminal
            .backend()
            .buffer()
            .content
            .iter()
            .map(|cell| cell.symbol())
            .collect::<String>();

        assert!(
            text.trim().is_empty(),
            "explicit blank footer leaked: {text:?}"
        );
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
