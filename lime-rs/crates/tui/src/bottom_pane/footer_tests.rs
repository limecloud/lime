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

#[test]
fn context_window_line_distinguishes_unknown_zero_and_server_total_fallback() {
    use super::context_window_line;
    assert!(context_window_line(None, None, Locale::EnUs)
        .spans
        .is_empty());
    for (percent, expected) in [
        (-1, "0% context left"),
        (84, "84% context left"),
        (101, "100% context left"),
    ] {
        assert_eq!(
            context_window_line(Some(percent), Some(161000), Locale::EnUs).to_string(),
            expected
        );
    }
    for (total, expected) in [(-1, "0 used"), (0, "0 used"), (161000, "161K used")] {
        assert_eq!(
            context_window_line(None, Some(total), Locale::EnUs).to_string(),
            expected
        );
    }
}

#[test]
fn localized_context_is_complete_right_aligned_and_yields_when_it_cannot_fit() {
    let app = App::default();
    for (locale, expected) in [
        (Locale::ZhCn, "84% 上下文剩余"),
        (Locale::ZhTw, "84% 上下文剩餘"),
        (Locale::EnUs, "84% context left"),
        (Locale::JaJp, "84% コンテキスト残量"),
        (Locale::KoKr, "84% 컨텍스트 남음"),
    ] {
        for width in 1..100 {
            let mut props = app.chat_widget.footer_props(width, false, None, None);
            props.locale = locale;
            props.mode = super::FooterMode::ComposerHasDraft;
            props.context_window_percent = Some(84);
            let text = rendered_props_at_width(&props, width);
            if usize::from(width) >= crate::width::display_width(expected) + 2 {
                assert_eq!(
                    compact(&text),
                    compact(expected),
                    "{locale:?}/{width}: {text}"
                );
                assert!(text.ends_with(' '), "missing right margin: {text}");
            } else {
                assert!(
                    text.trim().is_empty(),
                    "partial context leaked: {locale:?}/{width}: {text}"
                );
            }
            assert!(!text.contains('…'), "context must be complete: {text}");
        }
    }
}

#[test]
fn queue_and_idle_plan_cycle_hints_outlive_context_on_narrow_screens() {
    let app = App::default();
    let mut props = app.chat_widget.footer_props(100, true, None, None);
    props.mode = super::FooterMode::ComposerHasDraft;
    props.context_window_percent = Some(84);
    let wide = rendered_props_at_width(&props, 100);
    assert!(wide.contains("Tab to queue message"), "{wide}");
    assert!(wide.contains("84% context left"), "{wide}");
    let shorter = rendered_props_at_width(&props, 32);
    assert!(shorter.contains("Tab to queue"), "{shorter}");
    assert!(!shorter.contains("queue message"), "{shorter}");
    assert!(shorter.contains("84% context left"), "{shorter}");
    let narrow = rendered_props_at_width(&props, 26);
    assert!(narrow.contains("Tab to queue message"), "{narrow}");
    assert!(!narrow.contains("context"), "{narrow}");

    props.mode = super::FooterMode::ComposerEmpty;
    props.is_task_running = false;
    props.plan_mode = true;
    let cycle = props.locale.plan_mode_cycle_hint();
    let width = u16::try_from(crate::width::display_width(cycle) + 2).unwrap();
    let narrow = rendered_props_at_width(&props, width);
    assert!(narrow.contains(cycle), "{narrow}");
    assert!(!narrow.contains("context"), "{narrow}");
    let tiny = rendered_props_at_width(&props, 25);
    assert!(tiny.contains("Plan mode"), "{tiny}");
    assert!(
        !tiny.contains("context"),
        "cycle was displaced by context: {tiny}"
    );
    props.active_agent_label = Some("Explorer".into());
    let wide_agent = rendered_props_at_width(&props, 100);
    assert!(wide_agent.contains(cycle), "{wide_agent}");
    let tiny_agent = rendered_props_at_width(&props, 25);
    assert!(tiny_agent.contains("Plan mode"), "{tiny_agent}");
    assert!(!tiny_agent.contains("context"), "{tiny_agent}");
}

#[test]
fn vim_context_uses_the_right_group_and_survives_statistics_collapse() {
    let mut app = App::default();
    app.chat_widget.bottom_pane.composer.set_vim_enabled(true);
    let mut props = app.chat_widget.footer_props(100, true, None, None);
    props.mode = super::FooterMode::ComposerHasDraft;
    props.context_window_percent = Some(84);
    let wide = rendered_props_at_width(&props, 100);
    assert!(
        wide.trim_end().ends_with("84% context left | Vim: Normal"),
        "{wide}"
    );
    let narrow = rendered_props_at_width(&props, 36);
    assert!(narrow.contains("Tab to queue message"), "{narrow}");
    assert!(narrow.trim_end().ends_with("Vim: Normal"), "{narrow}");
    assert!(!narrow.contains("context"), "{narrow}");
    props.context_window_percent = None;
    let unknown = rendered_props_at_width(&props, 100);
    assert!(
        !unknown.contains('|'),
        "no leading delimiter for unknown facts: {unknown}"
    );
}

#[test]
fn passive_status_moves_mode_and_vim_right_without_duplicate_context() {
    let mut app = App::default();
    app.chat_widget.bottom_pane.composer.set_vim_enabled(true);
    let mut props = app.chat_widget.footer_props(100, false, None, None);
    props.status_line_enabled = true;
    props.status_line_value = Some(ratatui::text::Line::from(
        "fixture-model · Context 84% left",
    ));
    props.plan_mode = true;
    props.context_window_percent = Some(84);
    let wide = rendered_props_at_width(&props, 100);
    assert!(wide.contains("Context 84% left"), "{wide}");
    assert!(!wide.contains("84% context left"), "{wide}");
    assert!(
        wide.trim_end().ends_with("Plan mode | Vim: Normal"),
        "{wide}"
    );
    assert!(
        !wide.contains("shift+tab"),
        "passive mode must stay compact: {wide}"
    );
    props.status_line_value = None;
    assert!(!rendered_props_at_width(&props, 100).contains("context"));
}

#[test]
fn context_does_not_leak_into_search_shortcuts_or_interaction_footers() {
    let app = App::default();
    let mut props = app.chat_widget.footer_props(100, false, None, None);
    props.context_window_percent = Some(84);
    props.interaction_hint_lines = Some(vec!["ctrl+x q".into()]);
    assert_eq!(rendered_props_at_width(&props, 100).trim(), "ctrl+x q");
    props.interaction_hint_lines = Some(vec![]);
    assert!(rendered_props_at_width(&props, 100).trim().is_empty());
    props.interaction_hint_lines = None;
    props.mode = super::FooterMode::ShortcutOverlay;
    props.shortcut_close_hint = Some("? close shortcuts".into());
    assert_eq!(
        rendered_props_at_width(&props, 100).trim(),
        "? close shortcuts"
    );
    props.mode = super::FooterMode::HistorySearch;
    props.history_search_line = Some(ratatui::text::Line::from("history query"));
    assert_eq!(rendered_props_at_width(&props, 100).trim(), "history query");
    props.history_search_line = None;
    props.vim_search_line = Some(ratatui::text::Line::from("/vim query"));
    assert_eq!(rendered_props_at_width(&props, 100).trim(), "/vim query");
    props.vim_search_line = None;
    props.input_enabled = false;
    assert!(rendered_props_at_width(&props, 100).trim().is_empty());
}
