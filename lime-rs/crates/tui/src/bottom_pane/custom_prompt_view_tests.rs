use super::*;
use crate::locale::Locale;
use ratatui::backend::TestBackend;
use ratatui::layout::Rect;
use ratatui::Terminal;
use serde_json::json;
use std::time::Duration;

fn key(code: KeyCode) -> KeyEvent {
    KeyEvent::new(code, KeyModifiers::NONE)
}

fn labels(locale: Locale) -> PromptLabels<'static> {
    PromptLabels {
        title: locale.export_prompt_title(),
        placeholder: locale.export_file_description(),
        submit: locale.export_file_label(),
    }
}

fn draw(view: &CustomPromptView, locale: Locale, area: Rect) -> (String, Option<(u16, u16)>) {
    let mut terminal = Terminal::new(TestBackend::new(area.right(), area.bottom())).unwrap();
    terminal
        .draw(|frame| view.render_picker(frame, area, &labels(locale), locale))
        .unwrap();
    let buffer = terminal.backend().buffer();
    let text = (area.y..area.bottom())
        .map(|y| {
            let mut row = String::new();
            let mut x = area.x;
            while x < area.right() {
                let symbol = buffer[(x, y)].symbol();
                row.push_str(symbol);
                x += crate::width::display_width(symbol).max(1) as u16;
            }
            row
        })
        .collect::<Vec<_>>()
        .join("\n");
    (text, view.picker_cursor_pos(area, &labels(locale)))
}

#[test]
fn fast_unbracketed_enter_and_tab_stay_in_the_input_until_the_burst_expires() {
    let mut view = CustomPromptView::new(String::new());
    let now = Instant::now();
    for (index, ch) in "file".chars().enumerate() {
        assert_eq!(
            view.handle_key_event_at(
                key(KeyCode::Char(ch)),
                now + Duration::from_millis(index as u64)
            ),
            PromptAction::None
        );
    }
    view.handle_key_event_at(key(KeyCode::Tab), now + Duration::from_millis(4));
    assert_eq!(
        view.handle_key_event_at(key(KeyCode::Enter), now + Duration::from_millis(5)),
        PromptAction::None
    );
    assert_eq!(view.text(), "file\n");
    assert_eq!(
        view.handle_key_event_at(key(KeyCode::Enter), now + Duration::from_millis(6)),
        PromptAction::None
    );
    assert_eq!(view.text(), "file\n\n");
    assert_eq!(
        view.handle_key_event_at(key(KeyCode::Enter), now + Duration::from_secs(1)),
        PromptAction::Submit
    );
}

#[test]
fn explicit_paste_and_editor_navigation_clear_burst_submission_protection() {
    for explicit in [false, true] {
        let mut view = CustomPromptView::new(String::new());
        let now = Instant::now();
        view.handle_key_event_at(key(KeyCode::Char('a')), now);
        if explicit {
            view.handle_paste("b\r\nc");
            assert_eq!(view.text(), "ab\r\nc");
        } else {
            view.handle_key_event_at(key(KeyCode::Left), now);
        }
        assert_eq!(
            view.handle_key_event_at(key(KeyCode::Enter), now),
            PromptAction::Submit
        );
    }
}

#[test]
fn modifier_enter_uses_the_configured_editor_and_release_does_not_submit() {
    let config = serde_json::from_value(json!({"editor":{"insert_newline":"alt-enter"}})).unwrap();
    let mut view = CustomPromptView::new("before".into());
    view.set_keymap_bindings(&RuntimeKeymap::from_config(&config).unwrap());
    assert_eq!(
        view.handle_key_event(KeyEvent::new(KeyCode::Enter, KeyModifiers::SHIFT)),
        PromptAction::None
    );
    assert_eq!(view.text(), "before");
    assert_eq!(
        view.handle_key_event(KeyEvent::new(KeyCode::Enter, KeyModifiers::ALT)),
        PromptAction::None
    );
    assert_eq!(view.text(), "before\n");
    let mut release = key(KeyCode::Enter);
    release.kind = KeyEventKind::Release;
    assert_eq!(view.handle_key_event(release), PromptAction::None);
}

#[test]
fn vim_search_and_configured_operator_completion_own_enter_before_submit() {
    let config =
        serde_json::from_value(json!({"vim_operator":{"motion_word_forward":"f9"}})).unwrap();
    let mut view = CustomPromptView::new("alpha beta".into());
    view.set_keymap_bindings(&RuntimeKeymap::from_config(&config).unwrap());
    view.enable_vim_in_insert_mode();
    view.handle_key_event(key(KeyCode::Esc));
    view.textarea.set_cursor(0);
    view.handle_key_event(key(KeyCode::Char('d')));
    assert_eq!(
        view.handle_key_event(key(KeyCode::Enter)),
        PromptAction::None
    );
    assert_eq!(view.text(), "alpha beta");
    view.handle_key_event(key(KeyCode::Char('d')));
    view.handle_key_event(key(KeyCode::F(9)));
    assert_eq!(view.text(), "beta");
    view.handle_key_event(key(KeyCode::Char('/')));
    view.handle_key_event(key(KeyCode::Char('b')));
    assert_eq!(
        view.handle_key_event(key(KeyCode::Enter)),
        PromptAction::None
    );
    assert_eq!(view.text(), "beta");
    assert_eq!(
        view.handle_key_event(key(KeyCode::Enter)),
        PromptAction::Submit
    );
}

#[test]
fn protected_ctrl_c_cancels_even_when_an_editor_chord_is_pending() {
    let config =
        serde_json::from_value(json!({"editor":{"kill_whole_line":"ctrl-q enter"}})).unwrap();
    let mut view = CustomPromptView::new("filename.md".into());
    view.set_keymap_bindings(&RuntimeKeymap::from_config(&config).unwrap());
    view.handle_key_event(KeyEvent::new(KeyCode::Char('q'), KeyModifiers::CONTROL));
    assert_eq!(
        view.handle_key_event(KeyEvent::new(KeyCode::Char('c'), KeyModifiers::CONTROL)),
        PromptAction::Cancel
    );
    assert_eq!(view.text(), "filename.md");
}

#[test]
fn long_multiline_input_scrolls_with_the_cursor_and_reflows_after_resize() {
    let text = (0..14)
        .map(|index| format!("ROW_{index:02}_界👩‍💻"))
        .collect::<Vec<_>>()
        .join("\n");
    let mut view = CustomPromptView::new(text.clone());
    for locale in [
        Locale::ZhCn,
        Locale::ZhTw,
        Locale::EnUs,
        Locale::JaJp,
        Locale::KoKr,
    ] {
        let width = 40;
        let area = Rect::new(
            3,
            2,
            width,
            view.picker_desired_height(width, &labels(locale)),
        );
        let (screen, cursor) = draw(&view, locale, area);
        assert!(
            screen.contains("ROW_13_") && !screen.contains("ROW_00_"),
            "{locale:?}: {screen}"
        );
        assert!(area.contains(ratatui::layout::Position::from(cursor.unwrap())));
        for _ in 0..14 {
            view.handle_key_event(key(KeyCode::Up));
        }
        let (screen, cursor) = draw(&view, locale, area);
        assert!(screen.contains("ROW_00_"), "{locale:?}: {screen}");
        assert!(area.contains(ratatui::layout::Position::from(cursor.unwrap())));
        view.textarea.set_cursor(text.len());
        let (narrow, cursor) = draw(&view, locale, Rect::new(3, 2, 12, 8));
        assert!(cursor.is_some(), "{locale:?}: {narrow}");
        let (wide, _) = draw(&view, locale, area);
        assert!(wide.contains("ROW_13_"), "{locale:?}: {wide}");
        assert_eq!(view.text(), text);
    }
}

#[test]
fn wrapped_headers_and_mode_hints_follow_all_five_locales() {
    for locale in [
        Locale::ZhCn,
        Locale::ZhTw,
        Locale::EnUs,
        Locale::JaJp,
        Locale::KoKr,
    ] {
        let mut view = CustomPromptView::new("file.md".into());
        view.enable_vim_in_insert_mode();
        let area = Rect::new(0, 0, 100, view.picker_desired_height(100, &labels(locale)));
        let (insert, _) = draw(&view, locale, area);
        assert!(
            insert.contains(locale.prompt_normal_mode_label()) && insert.contains("Vim: Insert"),
            "{locale:?}: {insert}"
        );
        view.handle_key_event(key(KeyCode::Esc));
        let (normal, _) = draw(&view, locale, area);
        assert!(
            normal.contains(locale.picker_back_label()) && normal.contains("Vim: Normal"),
            "{locale:?}: {normal}"
        );
        assert!(
            view.picker_desired_height(10, &labels(locale))
                > view.picker_desired_height(100, &labels(locale))
        );
        for width in [1, 2, 4, 5, 10, 14, 24, 40, 100] {
            for height in [1, 2, 3, 4, 8, 16] {
                let area = Rect::new(0, 0, width, height);
                let (_, cursor) = draw(&view, locale, area);
                if let Some(cursor) = cursor {
                    assert!(area.contains(ratatui::layout::Position::from(cursor)));
                }
            }
        }
    }
}
