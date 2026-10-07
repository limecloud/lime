use super::*;
use app_server_protocol::protocol::v2::{
    CommandExecutionApprovalDecision, CommandExecutionRequestApprovalParams, ServerRequest,
};
use app_server_protocol::RequestId;
use crossterm::event::{Event, KeyCode, KeyEvent, KeyModifiers};
use ratatui::backend::TestBackend;
use ratatui::Terminal;

fn pane() -> BottomPane {
    let mut pane = BottomPane::default();
    pane.enqueue(ServerRequest::ItemCommandExecutionRequestApproval {
        id: RequestId::Integer(99),
        params: CommandExecutionRequestApprovalParams {
            thread_id: "thread-approval".into(),
            turn_id: "turn-approval".into(),
            item_id: "item-approval".into(),
            started_at_ms: 1,
            approval_id: None,
            network_approval_context: None,
            command: Some(format!(
                "{}END_OF_FULL_COMMAND",
                "printf very-long-command; ".repeat(80)
            )),
            cwd: Some("/workspace".into()),
            reason: Some("長い理由 ".repeat(80)),
            available_decisions: None,
        },
    })
    .unwrap();
    pane
}

fn text(terminal: &Terminal<TestBackend>) -> String {
    let buffer = terminal.backend().buffer();
    (0..buffer.area.height)
        .map(|y| {
            (0..buffer.area.width)
                .map(|x| buffer[(x, y)].symbol())
                .collect::<String>()
        })
        .collect::<Vec<_>>()
        .join("\n")
}

#[test]
fn long_approval_header_yields_to_selected_action_on_short_borderless_surfaces() {
    for locale in [
        Locale::ZhCn,
        Locale::ZhTw,
        Locale::EnUs,
        Locale::JaJp,
        Locale::KoKr,
    ] {
        let mut pane = pane();
        pane.handle_event(Event::Key(KeyEvent::new(KeyCode::Up, KeyModifiers::NONE)));
        for width in [28, 40, 80, 120] {
            for height in [1, 3, 5, 8, 18] {
                let mut terminal = Terminal::new(TestBackend::new(width, height)).unwrap();
                terminal
                    .draw(|frame| render(frame, frame.area(), &pane, locale))
                    .unwrap();
                let text = text(&terminal);
                assert!(text.contains("› 4."), "{locale:?} {width}x{height}: {text}");
                assert!(!text.contains('─'), "old boxed surface: {text}");
                if height >= 8 {
                    assert!(text.contains("ctrl+a"), "{text}");
                }
            }
        }
        assert_eq!(desired_height(&pane, locale, 40), 18);
    }
}

#[test]
fn fullscreen_details_keeps_complete_command_and_original_decision_identity() {
    let mut pane = pane();
    pane.handle_event(Event::Key(KeyEvent::new(KeyCode::Up, KeyModifiers::NONE)));
    for modifiers in [
        KeyModifiers::CONTROL,
        KeyModifiers::CONTROL | KeyModifiers::SHIFT,
    ] {
        let (_, lines) = pane
            .approval_details_for_key(KeyEvent::new(KeyCode::Char('a'), modifiers), Locale::EnUs)
            .unwrap();
        assert!(lines
            .iter()
            .any(|line| line.to_string().ends_with("END_OF_FULL_COMMAND")));
    }
    assert!(pane
        .approval_details_for_key(
            KeyEvent::new(KeyCode::Char('a'), KeyModifiers::NONE),
            Locale::EnUs
        )
        .is_none());
    match pane
        .handle_interaction_event(Event::Key(KeyEvent::new(
            KeyCode::Enter,
            KeyModifiers::NONE,
        )))
        .unwrap()
    {
        super::super::AppServerResponse::Command { id, response } => {
            assert_eq!(id, RequestId::Integer(99));
            assert_eq!(response.decision, CommandExecutionApprovalDecision::Cancel);
        }
        response => panic!("unexpected approval response: {response:?}"),
    }
}

#[test]
fn responsive_approval_footer_keeps_submit_and_cancel_keys_together() {
    for locale in [
        Locale::ZhCn,
        Locale::ZhTw,
        Locale::EnUs,
        Locale::JaJp,
        Locale::KoKr,
    ] {
        for width in 1..80 {
            let pane = pane();
            let PendingInteraction::Approval(approval) = pane.current().expect("approval") else {
                unreachable!();
            };
            let hint = footer_hint(approval, locale, width);
            assert!(crate::width::display_width(&hint) <= width);
            if width >= 12 {
                assert!(
                    hint.contains("Enter") && hint.contains("Esc"),
                    "{locale:?}/{width}: {hint}"
                );
            } else if width >= 5 {
                assert!(hint.contains("Esc"));
            }
        }
    }
}
