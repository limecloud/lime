use super::truncate_line_word_boundary_with_ellipsis;
use super::*;
use app_server_protocol::protocol::v2::{
    ToolRequestUserInputOption, ToolRequestUserInputParams, ToolRequestUserInputQuestion,
};
use app_server_protocol::RequestId;
use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
use ratatui::backend::TestBackend;
use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::Stylize;
use ratatui::text::{Line, Span};
use ratatui::widgets::{Paragraph, Widget};
use ratatui::Terminal;

fn request(count: usize) -> RequestUserInputOverlay {
    RequestUserInputOverlay::new(
        RequestId::Integer(81),
        ToolRequestUserInputParams {
            thread_id: "thread-input".into(),
            turn_id: "turn-input".into(),
            item_id: "item-input".into(),
            is_blocking: true,
            auto_resolution_ms: None,
            questions: vec![ToolRequestUserInputQuestion {
                id: "mode".into(),
                header: "Mode".into(),
                question: "Choose the next step".into(),
                is_secret: false,
                is_other: false,
                options: (count > 0).then(|| {
                    (0..count)
                        .map(|index| ToolRequestUserInputOption {
                            label: format!("Choice {index}"),
                            description: "Review the current changes carefully".into(),
                        })
                        .collect()
                }),
            }],
        },
    )
}

#[test]
fn oversized_notes_remain_editable_and_show_localized_rejection_in_the_visible_footer() {
    let mut request = request(0);
    let actual_chars = agent_protocol::input::MAX_USER_INPUT_TEXT_CHARS + 1;
    request.composer.handle_paste(&"界".repeat(actual_chars));
    let draft = request.composer.snapshot_draft();
    assert!(request
        .handle_key_event(crossterm::event::KeyEvent::new(
            crossterm::event::KeyCode::Enter,
            crossterm::event::KeyModifiers::NONE
        ))
        .is_none());
    assert_eq!(request.composer.snapshot_draft(), draft);
    let mut app = crate::app::App::default();
    app.chat_widget
        .bottom_pane
        .queue
        .push_back(crate::bottom_pane::PendingInteraction::UserInput(request));
    for locale in [
        Locale::ZhCn,
        Locale::ZhTw,
        Locale::EnUs,
        Locale::JaJp,
        Locale::KoKr,
    ] {
        app.chat_widget.locale = locale;
        let mut terminal = Terminal::new(TestBackend::new(150, 24)).unwrap();
        terminal
            .draw(|frame| crate::view::render(frame, &app))
            .unwrap();
        let text = screen(&terminal);
        assert!(
            text.contains(&locale.user_input_too_large_message(actual_chars)),
            "locale={locale:?}: {text}"
        );
    }
    app.chat_widget
        .bottom_pane
        .handle_key_event(crossterm::event::KeyEvent::new(
            crossterm::event::KeyCode::Backspace,
            crossterm::event::KeyModifiers::NONE,
        ));
    let Some(crate::bottom_pane::PendingInteraction::UserInput(request)) =
        app.chat_widget.bottom_pane.queue.front()
    else {
        panic!("oversized notes must remain pending");
    };
    assert!(request.submission_error.is_none());
}

fn draw(
    request: &RequestUserInputOverlay,
    locale: Locale,
    width: u16,
    height: u16,
) -> Terminal<TestBackend> {
    let mut terminal = Terminal::new(TestBackend::new(width, height)).unwrap();
    terminal
        .draw(|frame| render(frame, frame.area(), request, locale))
        .unwrap();
    terminal
}

fn screen(terminal: &Terminal<TestBackend>) -> String {
    let buffer = terminal.backend().buffer();
    (0..buffer.area.height)
        .map(|y| {
            let mut x = 0;
            let mut line = String::new();
            while x < buffer.area.width {
                let symbol = buffer[(x, y)].symbol();
                line.push_str(symbol);
                x += display_width(symbol).max(1) as u16;
            }
            line
        })
        .collect::<Vec<_>>()
        .join("\n")
}

#[test]
fn wrapped_options_preserve_secondary_text_and_fill_selection() {
    let mut request = request(1);
    request.params.questions[0].options.as_mut().unwrap()[0].description =
        "Review a long description before choosing the final END_OF_DESCRIPTION".into();
    let terminal = draw(&request, Locale::EnUs, 45, 18);
    let text = screen(&terminal);
    assert!(text.contains("END_OF_DESCRIPTION"), "{text}");
    assert!(text.contains("› 1. Choice 0"), "{text}");
    assert!(!text.contains('─'));
    let buffer = terminal.backend().buffer();
    let selected = buffer
        .content
        .iter()
        .position(|cell| cell.symbol() == "›")
        .unwrap();
    let row = selected / 45;
    assert_eq!(
        buffer[(40, row as u16)].bg,
        crate::style::selection_style().bg.unwrap()
    );
}

#[test]
fn narrow_options_stack_without_losing_the_label() {
    let mut request = request(1);
    let option = &mut request.params.questions[0].options.as_mut().unwrap()[0];
    option.label = "Long option LABEL_END".into();
    option.description = "Description DESCRIPTION_END".into();
    let terminal = draw(&request, Locale::EnUs, 24, 18);
    let text = screen(&terminal);
    assert!(text.contains("LABEL_END"), "{text}");
    assert!(text.contains("DESCRIPTION_END"), "{text}");
}

#[test]
fn long_questions_yield_space_to_the_last_selected_option() {
    let mut request = request(12);
    request.params.questions[0].question = "Long question with many wrapped words. ".repeat(100);
    request.set_selected(11);
    for height in [1, 2, 4, 8, 18] {
        let terminal = draw(&request, Locale::EnUs, 40, height);
        let text = screen(&terminal);
        assert!(text.contains("› 12. Choice 11"), "height={height}: {text}");
    }
}

#[test]
fn long_freeform_question_never_hides_the_notes_cursor() {
    let mut request = request(0);
    request.params.questions[0].question = "Very long question. ".repeat(100);
    request.composer.replace("notes at cursor".into());
    for height in [1, 2, 4, 8] {
        let mut terminal = draw(&request, Locale::EnUs, 40, height);
        let text = screen(&terminal);
        assert!(text.contains("notes at cursor"), "height={height}: {text}");
        let cursor = terminal.get_cursor_position().unwrap();
        assert!(cursor.y < height && cursor.x < 40, "{cursor:?}");
    }
}

#[test]
fn notes_scroll_to_the_cursor_instead_of_ellipsizing_the_draft() {
    let mut request = request(0);
    request
        .composer
        .replace(format!("{}VISIBLE_TAIL", "prefix ".repeat(100)));
    let mut terminal = draw(&request, Locale::EnUs, 30, 8);
    let text = screen(&terminal);
    assert!(text.contains("VISIBLE_TAIL"), "{text}");
    let cursor = terminal.get_cursor_position().unwrap();
    assert!(cursor.y < 8 && cursor.x < 30);
    request
        .composer
        .handle_key_event(crossterm::event::KeyEvent::new(
            crossterm::event::KeyCode::Home,
            crossterm::event::KeyModifiers::CONTROL,
        ));
    let terminal = draw(&request, Locale::EnUs, 30, 8);
    assert!(screen(&terminal).contains("prefix"));
}

#[test]
fn secret_multiline_unicode_uses_the_same_masked_viewport_and_cursor() {
    let mut request = request(0);
    request.params.questions[0].is_secret = true;
    request
        .composer
        .replace("secret秘密🙂\nsecond secret".into());
    let mut terminal = draw(&request, Locale::EnUs, 30, 10);
    let text = screen(&terminal);
    assert!(
        !text.contains("secret") && !text.contains("秘密") && !text.contains('🙂'),
        "{text}"
    );
    assert!(text.contains("*************"), "{text}");
    let cursor = terminal.get_cursor_position().unwrap();
    let inner = menu_surface_inset(Rect::new(0, 0, 30, 10));
    let input = notes_input_area(sections(&request, Locale::EnUs, inner).notes_area);
    assert_eq!(
        (cursor.x, cursor.y),
        request
            .composer
            .textarea()
            .cursor_pos_with_state(input, *request.composer.textarea_state_mut())
            .unwrap()
    );
}

#[test]
fn notes_focus_keeps_options_actionable_and_shows_the_editor() {
    let mut request = request(12);
    request.set_selected(11);
    request.set_focus(super::super::Focus::Notes);
    request.composer.replace("edited note".into());
    request.params.questions[0].question = "Long question. ".repeat(100);
    let terminal = draw(&request, Locale::EnUs, 40, 8);
    let text = screen(&terminal);
    assert!(
        text.contains("› 12. Choice 11") && text.contains("edited note"),
        "{text}"
    );
}

#[test]
fn progress_and_other_labels_cover_every_product_locale() {
    let mut request = request(1);
    request.params.questions[0].is_other = true;
    request.handle_key_event(KeyEvent::new(KeyCode::Down, KeyModifiers::NONE));
    for locale in [
        Locale::ZhCn,
        Locale::ZhTw,
        Locale::EnUs,
        Locale::JaJp,
        Locale::KoKr,
    ] {
        for width in [40, 80] {
            let terminal = draw(&request, locale, width, 24);
            let text = screen(&terminal);
            assert!(
                text.contains(&locale.request_question_progress(1, 1)),
                "{locale:?}/{width}: {text}"
            );
            let compact = |text: &str| {
                text.chars()
                    .filter(|ch| !ch.is_whitespace())
                    .collect::<String>()
            };
            let actual = compact(&text);
            for expected in [
                locale.other_option_label(),
                locale.other_option_description(),
            ] {
                assert!(
                    actual.contains(&compact(expected)),
                    "{locale:?}/{width}: {text}"
                );
            }
        }
    }
}

#[test]
fn unanswered_count_and_confirmation_cover_all_product_locales() {
    let mut request = request(2);
    let mut followup = request.params.questions[0].clone();
    followup.id = "followup".into();
    followup.options = None;
    request.params.questions.push(followup);
    request
        .answers
        .push(super::super::state::AnswerState::new(false));
    for locale in [
        Locale::ZhCn,
        Locale::ZhTw,
        Locale::EnUs,
        Locale::JaJp,
        Locale::KoKr,
    ] {
        let text = screen(&draw(&request, locale, 100, 12));
        assert!(
            text.contains(&locale.request_unanswered_count(2)),
            "{locale:?}: {text}"
        );
        request.open_unanswered_confirmation();
        let text = screen(&draw(&request, locale, 100, 12));
        for expected in [
            locale.unanswered_confirm_title(),
            locale.unanswered_confirm_submit(),
            locale.unanswered_confirm_go_back(),
            locale.unanswered_go_back_description(),
        ] {
            assert!(
                text.contains(expected),
                "{locale:?}: expected {expected:?}; {text}"
            );
        }
        assert!(
            text.contains(&locale.unanswered_submit_description(2)),
            "{locale:?}: {text}"
        );
        request.confirm_unanswered = None;
    }
}

#[test]
fn unanswered_confirmation_handles_narrow_and_empty_surfaces_without_showing_a_notes_cursor() {
    let mut request = request(2);
    request.set_focus(super::super::Focus::Notes);
    request.open_unanswered_confirmation();
    assert!(!request.editing());
    for width in [0, 1, 2, 8, 24, 40] {
        for height in [0, 1, 3, 8, 12] {
            let _ = draw(&request, Locale::JaJp, width, height);
        }
    }
}

#[test]
fn countdown_is_visible_and_red_after_the_hidden_grace() {
    let mut request = request(1);
    request.params.is_blocking = false;
    let now = request.request_started_at + std::time::Duration::from_secs(80);
    let mut terminal = Terminal::new(TestBackend::new(80, 12)).unwrap();
    terminal
        .draw(|frame| render_ui_at(frame, frame.area(), &request, Locale::EnUs, now))
        .unwrap();
    let text = screen(&terminal);
    assert!(text.contains("40s"), "{text}");
    assert!(terminal
        .backend()
        .buffer()
        .content
        .iter()
        .any(|cell| cell.fg == Color::Red && cell.symbol() == "4"));
}

#[test]
fn zero_and_tiny_surfaces_do_not_underflow() {
    let request = request(1);
    for width in 0..5 {
        for height in 0..5 {
            let _ = draw(&request, Locale::JaJp, width, height);
        }
    }
}

#[test]
fn halfwidth_sound_marks_are_truncated_at_a_grapheme_boundary() {
    let line = Line::from("abｶﾞ tail");

    assert_eq!(
        truncate_line_word_boundary_with_ellipsis(line, 4),
        Line::from(vec![Span::raw("ab"), Span::raw("…")])
    );
}

#[test]
fn halfwidth_sound_marks_are_truncated_and_rendered_at_a_grapheme_boundary() {
    let lines = [
        Line::from(vec!["ab".bold(), "ｶﾞ".cyan(), " tail".dim()]),
        Line::from(vec!["xy".bold(), "ﾊﾟ".magenta(), " tail".dim()]),
    ]
    .map(|line| truncate_line_word_boundary_with_ellipsis(line, 5));
    let area = Rect::new(0, 0, 5, 2);
    let mut buf = Buffer::empty(area);

    Paragraph::new(lines.to_vec()).render(area, &mut buf);

    assert_eq!(buf[(4, 0)].symbol(), "…");
    assert_eq!(buf[(4, 1)].symbol(), "…");
    assert_eq!(lines[0].spans[1].content, "ｶﾞ");
    assert_eq!(lines[1].spans[1].content, "ﾊﾟ");
}
