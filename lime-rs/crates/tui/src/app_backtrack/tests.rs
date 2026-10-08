use super::*;
use crate::bottom_pane::FooterMode;
use crate::locale::Locale;
use crate::tui::TuiEvent;
use app_server_protocol::protocol::v2::{
    Thread, ThreadItem, ThreadTurnsListResponse, Turn, TurnItemsView, TurnStatus,
};
use ratatui::backend::TestBackend;
use ratatui::Terminal;

fn prompt(text: &str) -> Vec<UserInput> {
    vec![UserInput::Text {
        text: text.to_string(),
        text_elements: vec![],
    }]
}

fn turn(id: &str, inputs: Vec<UserInput>) -> Turn {
    Turn {
        id: id.to_string(),
        status: TurnStatus::Completed,
        items_view: TurnItemsView::Full,
        items: vec![ThreadItem::UserMessage {
            id: format!("{id}-user"),
            metadata: None,
            client_id: None,
            content: inputs,
        }],
        error: None,
        started_at: Some(1),
        completed_at: Some(2),
        duration_ms: Some(1000),
    }
}

fn thread(id: &str, turns: Vec<Turn>) -> Thread {
    serde_json::from_value(
        serde_json::json!({"id": id, "sessionId": format!("session-{id}"),
        "preview": "", "ephemeral": false, "modelProvider": "fixture", "createdAt": 1,
        "updatedAt": 1, "status": {"type": "idle"}, "cwd": "/workspace", "cliVersion": "test",
        "source": "cli", "historyMode": "paginated", "turns": turns }),
    )
    .unwrap()
}

fn app(locale: Locale) -> App {
    let mut app = App::default();
    app.set_locale(locale);
    app.hydrate_thread(thread(
        "thread",
        vec![
            turn("old", prompt("OLDER_PROMPT")),
            turn("new", prompt("LATEST_PROMPT")),
        ],
    ));
    app.set_thread_id("thread".to_string());
    app
}

fn key(app: &mut App, code: KeyCode) -> AppAction {
    app.handle_tui_event(TuiEvent::Key(KeyEvent::new(code, KeyModifiers::NONE)), true)
}

fn page(app: &mut App, turns: Vec<Turn>, next: Option<&str>) {
    app.backtrack.loading = true;
    app.backtrack.load_needed = false;
    let mut context = turns.clone();
    context.reverse();
    app.handle_backtrack_event(BacktrackEvent::HistoryLoaded {
        thread_id: "thread".into(),
        generation: app.backtrack.generation,
        cursor: app.backtrack.cursor.clone(),
        result: Ok(BacktrackPage {
            page: ThreadTurnsListResponse {
                data: turns,
                next_cursor: next.map(str::to_string),
                backwards_cursor: None,
            },
            context,
        }),
    });
}

fn screen(app: &App, width: u16) -> String {
    let mut terminal = Terminal::new(TestBackend::new(width, 24)).unwrap();
    terminal
        .draw(|frame| crate::view::render(frame, app))
        .unwrap();
    let buffer = terminal.backend().buffer();
    (0..24)
        .map(|y| {
            let mut line = String::new();
            let mut x = 0;
            while x < width {
                let symbol = buffer[(x, y)].symbol();
                line.push_str(symbol);
                x += crate::width::display_width(symbol).max(1) as u16;
            }
            line
        })
        .collect::<Vec<_>>()
        .join("\n")
}

#[test]
fn esc_hint_browsing_navigation_cancel_and_render_use_one_canonical_projection() {
    for locale in [
        Locale::ZhCn,
        Locale::ZhTw,
        Locale::EnUs,
        Locale::JaJp,
        Locale::KoKr,
    ] {
        let mut app = app(locale);
        assert_eq!(key(&mut app, KeyCode::Esc), AppAction::None);
        assert_eq!(
            app.chat_widget.bottom_pane.footer_mode(),
            FooterMode::EscHint
        );
        assert!(
            screen(&app, 100).contains(locale.esc_backtrack_hint()),
            "{locale:?}: {}",
            screen(&app, 100)
        );
        assert!(!screen(&app, 16).contains("context"));
        key(&mut app, KeyCode::Esc);
        assert!(screen(&app, 100).contains(locale.backtrack_loading()));
        page(
            &mut app,
            vec![
                turn("new", prompt("LATEST_PROMPT")),
                turn("old", prompt("OLDER_PROMPT")),
            ],
            None,
        );
        assert!(screen(&app, 100).contains(locale.backtrack_label()));
        assert_eq!(
            app.backtrack.choices[app.backtrack.nth_user_message].turn_id,
            "new"
        );
        key(&mut app, KeyCode::Left);
        key(&mut app, KeyCode::Left);
        assert_eq!(
            app.backtrack.choices[app.backtrack.nth_user_message].turn_id,
            "old"
        );
        key(&mut app, KeyCode::Right);
        key(&mut app, KeyCode::Right);
        assert_eq!(
            app.backtrack.choices[app.backtrack.nth_user_message].turn_id,
            "new"
        );
        key(&mut app, KeyCode::Esc);
        assert!(app.chat_widget.pager_overlay.is_none());
        assert_eq!(app.chat_widget.bottom_pane.composer_text(), "");
        assert!(app
            .projection
            .entries()
            .iter()
            .any(|entry| entry.text == "OLDER_PROMPT"));
    }
}

#[test]
fn prime_resets_on_paste_and_escape_preserves_existing_draft_vim_and_shortcuts() {
    let mut app = app(Locale::EnUs);
    key(&mut app, KeyCode::Esc);
    app.handle_tui_event(TuiEvent::Paste("new draft".to_string()), true);
    assert!(!app.backtrack.primed);
    key(&mut app, KeyCode::Esc);
    assert_eq!(app.chat_widget.bottom_pane.composer_text(), "new draft");
    assert!(!app.backtrack.primed);
    app.chat_widget.bottom_pane.set_composer_text(String::new());
    key(&mut app, KeyCode::Char('?'));
    key(&mut app, KeyCode::Esc);
    assert!(!app.backtrack.primed);
    app.chat_widget.bottom_pane.toggle_vim_enabled();
    key(&mut app, KeyCode::Esc);
    assert!(!app.backtrack.primed);
}

#[test]
fn empty_thread_escape_does_not_advertise_a_nonexistent_prompt() {
    let mut app = app(Locale::EnUs);
    app.hydrate_thread(thread("thread", vec![]));
    key(&mut app, KeyCode::Esc);
    assert!(!app.backtrack.primed);
    assert_ne!(
        app.chat_widget.bottom_pane.footer_mode(),
        FooterMode::EscHint
    );
}

#[test]
fn failure_cancel_thread_handoff_and_repeated_cursor_reject_stale_completions() {
    let mut app = app(Locale::EnUs);
    key(&mut app, KeyCode::Esc);
    key(&mut app, KeyCode::Esc);
    app.backtrack.loading = true;
    let generation = app.backtrack.generation;
    key(&mut app, KeyCode::Esc);
    app.handle_backtrack_event(BacktrackEvent::HistoryLoaded {
        thread_id: "thread".into(),
        generation,
        cursor: None,
        result: Err("old failure".to_string()),
    });
    assert!(!app.projection.status().contains("old failure"));
    key(&mut app, KeyCode::Esc);
    key(&mut app, KeyCode::Esc);
    page(
        &mut app,
        vec![turn("new", prompt("LATEST_PROMPT"))],
        Some("cursor"),
    );
    key(&mut app, KeyCode::Left);
    page(
        &mut app,
        vec![turn("old", prompt("OLDER_PROMPT"))],
        Some("cursor"),
    );
    assert!(app.backtrack.failed);
    assert_eq!(app.backtrack.choices.len(), 1);
    let generation = app.backtrack.generation;
    app.hydrate_thread(thread("target", vec![]));
    app.set_thread_id("target".to_string());
    app.handle_backtrack_event(BacktrackEvent::HistoryLoaded {
        thread_id: "thread".into(),
        generation,
        cursor: Some("cursor".into()),
        result: Err("stale thread failure".into()),
    });
    assert!(!app.projection.status().contains("stale thread failure"));
}

#[test]
fn browsing_from_existing_pager_cancels_to_the_original_bookmark_and_search_has_priority() {
    let mut app = app(Locale::EnUs);
    app.chat_widget.open_transcript_pager();
    key(&mut app, KeyCode::Home);
    screen(&app, 60);
    let origin = app.chat_widget.pager_overlay.as_ref().unwrap().bookmark();
    key(&mut app, KeyCode::Esc);
    page(&mut app, vec![turn("new", prompt("LATEST_PROMPT"))], None);
    key(&mut app, KeyCode::Char('/'));
    key(&mut app, KeyCode::Esc);
    assert!(app.backtrack.overlay_preview_active);
    key(&mut app, KeyCode::Esc);
    assert!(!app.backtrack.overlay_preview_active);
    screen(&app, 60);
    assert_eq!(
        app.chat_widget.pager_overlay.as_ref().unwrap().bookmark(),
        origin
    );
}

#[test]
fn confirmation_restores_all_typed_inputs_and_failure_keeps_original_history() {
    let inputs = vec![
        UserInput::Image {
            detail: Some(agent_protocol::ImageDetail::High),
            url: "https://example.test/a.png".into(),
        },
        UserInput::LocalImage {
            detail: Some(agent_protocol::ImageDetail::Original),
            path: "/tmp/b.png".into(),
        },
        UserInput::Text {
            text: "$review work".into(),
            text_elements: vec![agent_protocol::TextElement::new(0..7, None)],
        },
        UserInput::Skill {
            name: "review".into(),
            path: "skill://review".into(),
        },
        UserInput::Mention {
            name: "app".into(),
            path: "app://calendar".into(),
        },
    ];
    let mut app = app(Locale::EnUs);
    key(&mut app, KeyCode::Esc);
    key(&mut app, KeyCode::Esc);
    page(&mut app, vec![turn("new", inputs)], None);
    key(&mut app, KeyCode::Enter);
    let selection = app.backtrack.pending_revert.clone().unwrap();
    assert_eq!(selection.turn_id, "new");
    key(&mut app, KeyCode::Char('x'));
    assert_eq!(app.chat_widget.bottom_pane.composer_text(), "");
    app.handle_backtrack_event(BacktrackEvent::Reverted {
        thread_id: "thread".into(),
        generation: app.backtrack.generation,
        result: Err("request denied".into()),
    });
    assert!(app
        .chat_widget
        .bottom_pane
        .composer_text()
        .contains("$review work"));
    assert!(app.chat_widget.bottom_pane.composer_text().contains("@app"));
    assert_eq!(
        app.chat_widget.bottom_pane.composer_local_images()[0].detail,
        Some(agent_protocol::ImageDetail::Original)
    );
    assert_eq!(
        app.chat_widget.bottom_pane.composer_remote_images()[0].detail,
        Some(agent_protocol::ImageDetail::High)
    );
    assert!(app
        .projection
        .entries()
        .iter()
        .any(|entry| entry.text == "OLDER_PROMPT"));
    assert!(app.projection.status().contains("request denied"));
    key(&mut app, KeyCode::Enter);
    let bindings = app
        .chat_widget
        .bottom_pane
        .take_recent_submission_mention_bindings();
    assert_eq!(bindings.len(), 2);
    assert!(bindings
        .iter()
        .any(|binding| binding.sigil == '@' && binding.path == "app://calendar"));
}

#[test]
fn successful_metadata_only_revert_removes_obsolete_history_and_preserves_prompt_for_refresh() {
    let mut app = app(Locale::EnUs);
    key(&mut app, KeyCode::Esc);
    key(&mut app, KeyCode::Esc);
    page(&mut app, vec![turn("new", prompt("LATEST_PROMPT"))], None);
    key(&mut app, KeyCode::Enter);
    app.handle_backtrack_event(BacktrackEvent::Reverted {
        thread_id: "thread".into(),
        generation: app.backtrack.generation,
        result: Ok(Box::new(ThreadRevertResponse {
            thread: thread("thread", vec![]),
            turns_backwards_cursor: None,
            items_backwards_cursor: None,
        })),
    });
    assert_eq!(app.chat_widget.bottom_pane.composer_text(), "LATEST_PROMPT");
    assert!(app.projection.entries().is_empty());
    assert!(app.history_replacement.is_pending());
    assert!(!app.can_accept_direct_input());
    key(&mut app, KeyCode::Char('x'));
    assert_eq!(
        app.chat_widget.bottom_pane.composer_text(),
        "LATEST_PROMPTx"
    );
}

#[test]
fn revert_notification_before_response_keeps_the_selected_prompt_and_pending_mutation() {
    let mut app = app(Locale::EnUs);
    key(&mut app, KeyCode::Esc);
    key(&mut app, KeyCode::Esc);
    page(&mut app, vec![turn("new", prompt("LATEST_PROMPT"))], None);
    key(&mut app, KeyCode::Enter);
    let generation = app.backtrack.generation;
    app.apply_notification(
        app_server_protocol::protocol::v2::ServerNotification::ThreadReverted(
            app_server_protocol::protocol::v2::ThreadRevertedNotification {
                thread_id: "thread".into(),
            },
        ),
    );
    assert!(app.backtrack_revert_pending());
    assert!(app.history_replacement.is_pending());
    app.handle_backtrack_event(BacktrackEvent::Reverted {
        thread_id: "thread".into(),
        generation,
        result: Ok(Box::new(ThreadRevertResponse {
            thread: thread("thread", vec![]),
            turns_backwards_cursor: None,
            items_backwards_cursor: None,
        })),
    });
    assert_eq!(app.chat_widget.bottom_pane.composer_text(), "LATEST_PROMPT");
    assert!(!app.backtrack_revert_pending());
    assert!(app.history_replacement.is_pending());
}

#[test]
fn browsing_rejects_steers_partial_running_invalid_and_cross_page_review_prompts() {
    let mut app = app(Locale::EnUs);
    key(&mut app, KeyCode::Esc);
    key(&mut app, KeyCode::Esc);
    let mut steered = turn("steered", prompt("FIRST"));
    steered
        .items
        .push(turn("steer", prompt("STEER")).items.remove(0));
    let mut running = turn("running", prompt("RUNNING"));
    running.status = TurnStatus::InProgress;
    let mut partial = turn("partial", prompt("PARTIAL"));
    partial.items_view = TurnItemsView::NotLoaded;
    let invalid = turn(
        "invalid",
        vec![UserInput::Text {
            text: "界".into(),
            text_elements: vec![agent_protocol::TextElement::new(1..3, None)],
        }],
    );
    let review = Turn {
        items: vec![
            ThreadItem::EnteredReviewMode {
                id: "enter".into(),
                metadata: None,
                review: "review".into(),
            },
            ThreadItem::ExitedReviewMode {
                id: "exit".into(),
                metadata: None,
                review: "review".into(),
            },
        ],
        ..turn("review", vec![])
    };
    let mut nested = turn("nested", prompt("HIDDEN"));
    nested
        .items
        .push(turn("duplicate", prompt("HIDDEN")).items.remove(0));
    nested.status = TurnStatus::Interrupted;
    nested.completed_at = None;
    let data = vec![nested, invalid, partial, running, steered];
    let mut context = data.iter().rev().cloned().collect::<Vec<_>>();
    // Adjacent older metadata is not a selectable page but establishes nested review state.
    context.insert(context.len() - 1, review);
    app.apply_backtrack_page(
        "thread",
        BacktrackPage {
            page: ThreadTurnsListResponse {
                data,
                next_cursor: None,
                backwards_cursor: None,
            },
            context,
        },
    );
    assert_eq!(app.backtrack.choices.len(), 1);
    assert_eq!(app.backtrack.choices[0].turn_id, "steered");
    assert_eq!(app.backtrack.choices[0].item_id, "steered-user");
    app.backtrack.load_needed = false;
    app.sync_backtrack_presentation();
    for width in [16, 24, 40, 80] {
        let visible = screen(&app, width);
        assert!(
            visible.contains("esc") && visible.contains('↵'),
            "{width}: {visible}"
        );
    }
}

#[test]
fn new_turn_or_thread_close_invalidates_pending_preview_and_late_reads() {
    for closed in [false, true] {
        let mut app = app(Locale::EnUs);
        key(&mut app, KeyCode::Esc);
        key(&mut app, KeyCode::Esc);
        app.backtrack.loading = true;
        let generation = app.backtrack.generation;
        let notification = if closed {
            app_server_protocol::protocol::v2::ServerNotification::ThreadClosed(
                app_server_protocol::protocol::v2::ThreadClosedNotification {
                    thread_id: "thread".into(),
                },
            )
        } else {
            app_server_protocol::protocol::v2::ServerNotification::TurnStarted(
                app_server_protocol::protocol::v2::TurnStartedNotification {
                    thread_id: "thread".into(),
                    turn: Turn {
                        status: TurnStatus::InProgress,
                        ..turn("live", prompt("LIVE"))
                    },
                },
            )
        };
        app.apply_notification(notification);
        assert!(!app.backtrack.overlay_preview_active);
        assert!(app.chat_widget.pager_overlay.is_none());
        app.handle_backtrack_event(BacktrackEvent::HistoryLoaded {
            thread_id: "thread".into(),
            generation,
            cursor: None,
            result: Err("obsolete".into()),
        });
        assert!(!app.projection.status().contains("obsolete"));
    }
}
