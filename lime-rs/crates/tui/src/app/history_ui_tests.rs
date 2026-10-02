use super::*;
use crate::history_cell::ComputerActivityFacts;
use crate::locale::Locale;
use crate::projection::{
    ActivityDetail, ActivityGroupKey, ActivityGroupKind, EntryKind, EntryStatus,
};
use crate::transcript_view::TranscriptDisclosure;
use app_server_protocol::protocol::v2::{
    CommandAction, CommandExecutionSource, CommandExecutionStatus, ItemCompletedNotification,
    ReasoningSummaryTextDeltaNotification, ServerNotification, ThreadItem,
};
use crossterm::event::{Event, KeyCode, KeyEvent, KeyModifiers};
use ratatui::layout::Rect;
use unicode_width::UnicodeWidthStr;

fn exploration_entry(id: &str, scope: &str, output: &str) -> TranscriptEntry {
    TranscriptEntry {
        id: id.to_string(),
        kind: EntryKind::Command,
        text: format!("rg {id}\n{output}"),
        streaming: false,
        status: Some(EntryStatus::Completed),
        summary: vec!["duration 1ms".to_string()],
        activity_group: Some(ActivityGroupKey::new(ActivityGroupKind::Exploration, scope)),
        activity_detail: Some(ActivityDetail::Exploration {
            actions: vec![CommandAction::Read {
                command: format!("cat {id}"),
                name: id.to_string(),
                path: format!("/workspace/{id}"),
            }],
            exit_code: Some(0),
        }),
    }
}

fn exploration_entry_with_actions(
    id: &str,
    scope: &str,
    actions: Vec<CommandAction>,
) -> TranscriptEntry {
    TranscriptEntry {
        id: id.to_string(),
        kind: EntryKind::Command,
        text: format!("command {id}\ncanonical output"),
        streaming: false,
        status: Some(EntryStatus::Completed),
        summary: Vec::new(),
        activity_group: Some(ActivityGroupKey::new(ActivityGroupKind::Exploration, scope)),
        activity_detail: Some(ActivityDetail::Exploration {
            actions,
            exit_code: Some(0),
        }),
    }
}

fn computer_entry(
    id: &str,
    status: EntryStatus,
    title: &str,
    screenshots: usize,
    error: Option<&str>,
) -> TranscriptEntry {
    TranscriptEntry {
        id: id.to_string(),
        kind: EntryKind::Mcp,
        text: format!("@cua_repl/js {title}"),
        streaming: status == EntryStatus::Running,
        status: Some(status),
        summary: Vec::new(),
        activity_group: Some(ActivityGroupKey::new(ActivityGroupKind::Computer, "turn-1")),
        activity_detail: Some(ActivityDetail::Computer(ComputerActivityFacts {
            title: title.to_string(),
            screenshots,
            error: error.map(str::to_string),
        })),
    }
}

fn reasoning_entry(id: &str, scope: Option<&str>, text: &str) -> TranscriptEntry {
    TranscriptEntry {
        id: id.to_string(),
        kind: EntryKind::Reasoning,
        text: text.to_string(),
        streaming: false,
        status: None,
        summary: Vec::new(),
        activity_group: None,
        activity_detail: scope.map(|scope| ActivityDetail::Reasoning {
            scope: scope.to_string(),
        }),
    }
}

fn apply_exploration_item(
    app: &mut App,
    turn_id: &str,
    id: &str,
    command: &str,
    actions: Vec<CommandAction>,
) {
    app.projection.apply(ServerNotification::ItemCompleted(
        ItemCompletedNotification {
            item: ThreadItem::CommandExecution {
                id: id.to_string(),
                metadata: None,
                plugin_id: None,
                script_path: None,
                command: command.to_string(),
                cwd: "/workspace".to_string(),
                process_id: None,
                source: CommandExecutionSource::Agent,
                status: CommandExecutionStatus::Completed,
                command_actions: actions,
                aggregated_output: Some("canonical output".to_string()),
                exit_code: Some(0),
                duration_ms: Some(1),
                terminal_interactions: Vec::new(),
            },
            thread_id: "thread-1".to_string(),
            turn_id: turn_id.to_string(),
            completed_at_ms: 1,
        },
    ));
}

fn apply_reasoning_item(app: &mut App, turn_id: &str, id: &str, summary: &str) {
    app.projection.apply(ServerNotification::ItemCompleted(
        ItemCompletedNotification {
            item: ThreadItem::Reasoning {
                id: id.to_string(),
                metadata: None,
                summary: vec![summary.to_string()],
                content: Vec::new(),
            },
            thread_id: "thread-1".to_string(),
            turn_id: turn_id.to_string(),
            completed_at_ms: 1,
        },
    ));
}

fn materialized_text(content: &TranscriptContent, expanded: bool) -> String {
    let mut disclosure = TranscriptDisclosure::default();
    let initial = disclosure.materialize(content, Locale::EnUs, 80);
    if expanded {
        disclosure.update_layout(&initial, Rect::new(0, 0, 80, 30), 0);
        assert!(disclosure.handle_event(&Event::Key(KeyEvent::new(
            KeyCode::F(4),
            KeyModifiers::NONE,
        ))));
        assert!(disclosure.handle_event(&Event::Key(KeyEvent::new(
            KeyCode::Enter,
            KeyModifiers::NONE,
        ))));
    }
    disclosure
        .materialize(content, Locale::EnUs, 80)
        .lines
        .iter()
        .map(|line| line.line.to_string())
        .collect::<Vec<_>>()
        .join("\n")
}

#[test]
fn transcript_content_lines_use_canonical_entry_order() {
    let mut app = App {
        locale: Locale::EnUs,
        ..App::default()
    };
    app.projection.apply(
        app_server_protocol::protocol::v2::ServerNotification::Warning(
            app_server_protocol::protocol::v2::WarningNotification {
                thread_id: None,
                message: "warning".to_string(),
                code: None,
            },
        ),
    );
    let lines = render_transcript_content_lines(&app, 80, false);
    let header = lines
        .iter()
        .position(|line| line.line.to_string().contains("Lime"))
        .expect("session header");
    let warning = lines
        .iter()
        .position(|line| {
            line.line
                .spans
                .iter()
                .any(|span| span.content.contains("warning"))
        })
        .expect("warning");
    assert!(header < warning);
    assert_eq!(lines[warning].line.spans[0].content, "⚠ ");
    assert!(lines[warning]
        .line
        .spans
        .iter()
        .any(|span| span.content.contains("warning")));
}

#[test]
fn empty_thread_starts_with_exactly_one_session_header() {
    let app = App {
        chat_widget: crate::chatwidget::ChatWidget {
            model: Some("fixture-model".to_string()),
            ..Default::default()
        },
        locale: Locale::EnUs,
        cwd: "/workspace".into(),
        ..App::default()
    };
    let lines = render_transcript_content_lines(&app, 80, false);
    let text = lines
        .iter()
        .map(|line| line.line.to_string())
        .collect::<Vec<_>>()
        .join("\n");

    assert_eq!(text.matches(">_ Lime").count(), 1, "{text}");
    assert!(!text.contains("fixture-model"), "{text}");
    assert!(text.contains("/workspace"), "{text}");
}

#[test]
fn compact_main_hides_standalone_reasoning_but_pager_retains_it() {
    let empty = App {
        locale: Locale::EnUs,
        cwd: "/workspace".into(),
        ..App::default()
    };
    let mut app = App {
        locale: Locale::EnUs,
        cwd: "/workspace".into(),
        ..App::default()
    };
    apply_reasoning_item(
        &mut app,
        "turn-1",
        "reasoning-1",
        "Standalone reasoning detail",
    );

    let compact = render_transcript_content_lines(&app, 80, false);
    assert_eq!(
        compact,
        render_transcript_content_lines(&empty, 80, false),
        "hidden reasoning must not leave a synthetic blank row"
    );

    let pager = render_transcript_pager_content(&app, 80);
    let detailed = materialized_text(&pager, false);
    assert!(
        detailed.contains("Standalone reasoning detail"),
        "{detailed}"
    );
}

#[test]
fn flat_reasoning_without_turn_scope_is_hidden_only_from_compact_main() {
    let mut app = App {
        locale: Locale::EnUs,
        cwd: "/workspace".into(),
        ..App::default()
    };
    app.projection.prepend_items(vec![ThreadItem::Reasoning {
        id: "reasoning-flat".to_string(),
        metadata: None,
        summary: vec!["Flat reasoning detail".to_string()],
        content: Vec::new(),
    }]);
    assert_eq!(app.projection.entries()[0].activity_detail, None);

    let compact = render_transcript_content_lines(&app, 80, false)
        .iter()
        .map(|line| line.line.to_string())
        .collect::<Vec<_>>()
        .join("\n");
    assert!(!compact.contains("Flat reasoning detail"), "{compact}");

    let pager = render_transcript_pager_content(&app, 80);
    let detailed = materialized_text(&pager, false);
    assert!(detailed.contains("Flat reasoning detail"), "{detailed}");
}

#[test]
fn hidden_reasoning_keeps_its_completion_separator_in_compact_main() {
    let mut app = App {
        locale: Locale::EnUs,
        ..App::default()
    };
    apply_reasoning_item(
        &mut app,
        "turn-1",
        "reasoning-1",
        "Completed hidden reasoning",
    );
    app.projection
        .add_completion_boundary("reasoning-1", Some(61));

    let compact = render_transcript_content_lines(&app, 80, false)
        .iter()
        .map(|line| line.line.to_string())
        .collect::<Vec<_>>()
        .join("\n");
    assert!(!compact.contains("Completed hidden reasoning"), "{compact}");
    assert_eq!(compact.matches("Worked for 61s").count(), 1, "{compact}");
}

#[test]
fn raw_main_preserves_markdown_source_while_detailed_pager_retains_reasoning() {
    let mut app = App {
        locale: Locale::EnUs,
        cwd: "/workspace".into(),
        ..App::default()
    };
    app.projection.prepend_items(vec![
        ThreadItem::AgentMessage {
            id: "assistant-1".to_string(),
            metadata: None,
            text: "- first\n\n| A | B |\n| - | - |".to_string(),
            phase: None,
            memory_citation: None,
            delivery: None,
        },
        ThreadItem::Reasoning {
            id: "reasoning-1".to_string(),
            metadata: None,
            summary: vec!["retained reasoning".to_string()],
            content: Vec::new(),
        },
    ]);
    app.toggle_raw_output_mode();

    let raw = render_transcript_content_lines(&app, 80, false)
        .iter()
        .map(|line| line.line.to_string())
        .collect::<Vec<_>>()
        .join("\n");
    assert!(raw.contains("- first\n\n| A | B |\n| - | - |"), "{raw}");
    assert!(!raw.contains("retained reasoning"), "{raw}");
    assert!(!raw.contains("━"), "{raw}");

    let detailed = materialized_text(&render_transcript_pager_content(&app, 80), false);
    assert!(detailed.contains("retained reasoning"), "{detailed}");
    assert!(detailed.contains("A"), "{detailed}");
}

#[test]
fn transcript_entry_lines_share_cell_rendering_and_fit_viewport() {
    let entry = TranscriptEntry {
        id: "assistant-1".to_string(),
        kind: crate::projection::EntryKind::Assistant,
        text: "a long assistant response that must wrap".to_string(),
        streaming: false,
        status: None,
        summary: Vec::new(),
        activity_group: None,
        activity_detail: None,
    };
    let lines =
        render_transcript_entry_lines_wrapped(&entry, 24, Locale::EnUs, Path::new("/workspace"));

    assert!(!lines.is_empty());
    assert!(lines.iter().all(|line| line.width() <= 24));
    assert!(lines
        .iter()
        .flat_map(|line| line.line.spans.iter())
        .any(|span| span.content.contains("assistant")));
}

#[test]
fn transcript_content_retains_canonical_entry_keys_for_reading_bookmarks() {
    let entries = [
        TranscriptEntry {
            id: "user-1".to_string(),
            kind: EntryKind::User,
            text: "first prompt".to_string(),
            streaming: false,
            status: None,
            summary: Vec::new(),
            activity_group: None,
            activity_detail: None,
        },
        TranscriptEntry {
            id: "assistant-1".to_string(),
            kind: EntryKind::Assistant,
            text: "first answer".to_string(),
            streaming: false,
            status: None,
            summary: Vec::new(),
            activity_group: None,
            activity_detail: None,
        },
    ];
    let content =
        render_transcript_entries_content(&entries, 80, Locale::EnUs, Path::new("/workspace"));
    let materialized = TranscriptDisclosure::default().materialize(&content, Locale::EnUs, 80);
    let keys = materialized
        .anchor_ranges
        .iter()
        .flat_map(|range| range.keys.iter().map(String::as_str))
        .collect::<Vec<_>>();

    assert!(keys.contains(&"entry:user-1"), "{keys:?}");
    assert!(keys.contains(&"entry:assistant-1"), "{keys:?}");
}

#[test]
fn wrapped_list_file_links_keep_the_target_with_following_prose() {
    let entry = TranscriptEntry {
            id: "assistant-link-1".to_string(),
            kind: crate::projection::EntryKind::Assistant,
            text: "- [binary](/workspace/README.md:93)\n  : core is the agent runtime and the rest of this explanation wraps naturally in a narrow terminal viewport.".to_string(),
            streaming: false,
            status: None,
            summary: Vec::new(),
            activity_group: None,
            activity_detail: None,
        };
    let lines =
        render_transcript_entry_lines_wrapped(&entry, 72, Locale::EnUs, Path::new("/workspace"));
    let rendered = lines
        .iter()
        .map(|line| line.line.to_string())
        .collect::<Vec<_>>();

    assert!(rendered.iter().all(|line| line.width() <= 70));
    assert!(
        rendered
            .iter()
            .any(|line| line.contains("README.md:93): core")),
        "{rendered:?}"
    );
    assert!(!rendered
        .iter()
        .any(|line| line.trim_start().starts_with(": core")));
}

#[test]
fn transcript_content_lines_render_completion_separator_after_completed_turn() {
    let mut app = App {
        locale: Locale::EnUs,
        ..App::default()
    };
    app.projection.add_warning_message("answer");
    let entry_id = app.projection.entries()[0].id.clone();
    app.projection.add_completion_boundary(entry_id, Some(61));

    let lines = render_transcript_content_lines(&app, 80, false);
    assert!(lines
        .iter()
        .any(|line| line.line.to_string().contains("Worked for 61s")));
}

#[test]
fn rendered_transcript_row_count_tracks_wrapped_viewport_width() {
    let mut app = App {
        locale: Locale::EnUs,
        ..App::default()
    };
    app.projection.add_warning_message(
        "a deliberately long transcript message that wraps across narrow terminal rows",
    );

    let narrow = rendered_transcript_row_count(&app, 20);
    let wide = rendered_transcript_row_count(&app, 120);

    assert!(narrow > wide, "narrow={narrow} wide={wide}");
}

#[test]
fn grouped_activity_retains_disclosure_when_live_members_commit() {
    let mut live = exploration_entry("read-1", "turn-1", "first detail");
    live.streaming = true;
    live.status = Some(EntryStatus::Running);
    live.activity_detail = Some(ActivityDetail::Exploration {
        actions: vec![CommandAction::Read {
            command: "cat read-1".to_string(),
            name: "read-1".to_string(),
            path: "/workspace/read-1".to_string(),
        }],
        exit_code: None,
    });
    let mut disclosure = TranscriptDisclosure::default();
    let initial = render_transcript_entries_content(
        std::slice::from_ref(&live),
        80,
        Locale::EnUs,
        Path::new("/workspace"),
    );
    let materialized = disclosure.materialize(&initial, Locale::EnUs, 80);
    disclosure.update_layout(&materialized, Rect::new(0, 0, 80, 20), 0);
    assert!(disclosure.handle_event(&Event::Key(KeyEvent::new(
        KeyCode::F(4),
        KeyModifiers::NONE,
    ))));
    assert!(disclosure.handle_event(&Event::Key(KeyEvent::new(
        KeyCode::Enter,
        KeyModifiers::NONE,
    ))));

    let committed = render_transcript_entries_content(
        &[
            exploration_entry("read-1", "turn-1", "first detail"),
            exploration_entry("read-2", "turn-1", "second detail"),
        ],
        80,
        Locale::EnUs,
        Path::new("/workspace"),
    );
    let materialized = disclosure.materialize(&committed, Locale::EnUs, 80);
    let text = materialized
        .lines
        .iter()
        .map(|line| line.line.to_string())
        .collect::<Vec<_>>()
        .join("\n");

    assert_eq!(text.matches("Show less").count(), 1, "{text}");
    assert!(text.contains("first detail"), "{text}");
    assert!(text.contains("second detail"), "{text}");
}

#[test]
fn activity_group_never_crosses_canonical_turn_scope() {
    let content = render_transcript_entries_content(
        &[
            exploration_entry("read-1", "turn-1", "first detail"),
            exploration_entry("read-2", "turn-2", "second detail"),
        ],
        80,
        Locale::EnUs,
        Path::new("/workspace"),
    );
    let materialized = TranscriptDisclosure::default().materialize(&content, Locale::EnUs, 80);
    let text = materialized
        .lines
        .iter()
        .map(|line| line.line.to_string())
        .collect::<Vec<_>>()
        .join("\n");

    assert_eq!(text.matches("Show details").count(), 2, "{text}");
}

#[test]
fn exploration_absorbs_same_turn_reasoning_without_changing_compact_state() {
    let mut running_reasoning =
        reasoning_entry("reasoning-1", Some("turn-1"), "Inspecting the first read");
    running_reasoning.streaming = true;
    running_reasoning.status = Some(EntryStatus::Running);
    let entries = [
        exploration_entry("read-1", "turn-1", "first detail"),
        running_reasoning,
        exploration_entry("read-2", "turn-1", "second detail"),
    ];
    let content =
        render_transcript_entries_content(&entries, 80, Locale::EnUs, Path::new("/workspace"));
    let compact = materialized_text(&content, false);

    assert_eq!(compact.matches("Show details").count(), 1, "{compact}");
    assert!(compact.contains("• Explored"), "{compact}");
    assert!(!compact.contains("Inspecting the first read"), "{compact}");
    assert!(!compact.contains("Exploring"), "{compact}");
}

#[test]
fn computer_activity_keeps_reasoning_in_expanded_order_only() {
    let entries = [
        computer_entry("computer-1", EntryStatus::Completed, "Open page", 0, None),
        reasoning_entry("reasoning-1", Some("turn-1"), "Inspecting action 1"),
        reasoning_entry("reasoning-2", Some("turn-1"), "Checking action 1"),
        computer_entry(
            "computer-2",
            EntryStatus::Completed,
            "Capture result",
            1,
            None,
        ),
        reasoning_entry("reasoning-3", Some("turn-1"), "Checking action 2"),
    ];
    let content =
        render_transcript_entries_content(&entries, 80, Locale::EnUs, Path::new("/workspace"));
    let compact = materialized_text(&content, false);

    assert!(compact.contains("Used computer · 2 actions"), "{compact}");
    assert_eq!(compact.matches("Show details").count(), 1, "{compact}");
    assert!(!compact.contains("Inspecting action 1"), "{compact}");
    assert!(!compact.contains("Checking action 2"), "{compact}");

    let expanded = materialized_text(&content, true);
    let first_call = expanded.find("Open page").expect("first computer call");
    let inspecting = expanded
        .find("• Inspecting action 1")
        .expect("first reasoning");
    let checking = expanded
        .find("• Checking action 1")
        .expect("second reasoning");
    let second_call = expanded
        .find("Capture result")
        .expect("second computer call");
    let trailing = expanded
        .find("• Checking action 2")
        .expect("trailing reasoning");
    assert!(
        first_call < inspecting
            && inspecting < checking
            && checking < second_call
            && second_call < trailing,
        "{expanded}"
    );
    assert!(
        expanded.contains("\n\n• Inspecting action 1\n\n• Checking action 1\n@ "),
        "{expanded}"
    );
}

#[test]
fn reasoning_absorption_fails_closed_without_matching_turn_scope() {
    let entries = [
        exploration_entry("read-1", "turn-1", "first detail"),
        reasoning_entry("reasoning-other", Some("turn-2"), "Other turn reasoning"),
        exploration_entry("read-2", "turn-1", "second detail"),
        reasoning_entry("reasoning-flat", None, "Flat reasoning"),
        exploration_entry("read-3", "turn-1", "third detail"),
    ];
    let content =
        render_transcript_entries_content(&entries, 80, Locale::EnUs, Path::new("/workspace"));
    let compact = materialized_text(&content, false);

    assert_eq!(compact.matches("Show details").count(), 3, "{compact}");
    assert!(compact.contains("Other turn reasoning"), "{compact}");
    assert!(compact.contains("Flat reasoning"), "{compact}");
}

#[test]
fn visible_activity_kind_ends_reasoning_absorption() {
    let entries = [
        exploration_entry("read-1", "turn-1", "first detail"),
        reasoning_entry("reasoning-1", Some("turn-1"), "Inspecting read"),
        computer_entry("computer-1", EntryStatus::Completed, "Open page", 0, None),
    ];
    let content =
        render_transcript_entries_content(&entries, 80, Locale::EnUs, Path::new("/workspace"));
    let compact = materialized_text(&content, false);

    assert_eq!(compact.matches("Show details").count(), 2, "{compact}");
    assert!(compact.contains("• Explored"), "{compact}");
    assert!(compact.contains("• Used computer · 1 action"), "{compact}");
    assert!(!compact.contains("Inspecting read"), "{compact}");
}

#[test]
fn grouped_exploration_uses_codex_compact_shape() {
    let content = render_transcript_entries_content(
        &[
            exploration_entry_with_actions(
                "list-1",
                "turn-1",
                vec![CommandAction::ListFiles {
                    command: "find src".to_string(),
                    path: Some("src".to_string()),
                }],
            ),
            exploration_entry_with_actions(
                "read-1",
                "turn-1",
                vec![
                    CommandAction::Read {
                        command: "cat a.rs".to_string(),
                        name: "a.rs".to_string(),
                        path: "/workspace/a.rs".to_string(),
                    },
                    CommandAction::Read {
                        command: "cat b.rs".to_string(),
                        name: "b.rs".to_string(),
                        path: "/workspace/b.rs".to_string(),
                    },
                ],
            ),
        ],
        80,
        Locale::EnUs,
        Path::new("/workspace"),
    );
    let materialized = TranscriptDisclosure::default().materialize(&content, Locale::EnUs, 80);
    let rendered = materialized
        .lines
        .iter()
        .map(|line| line.line.to_string())
        .collect::<Vec<_>>();

    assert_eq!(
        &rendered[..3],
        ["• Explored", "  └ List src", "    Read a.rs, b.rs"]
    );
    assert_eq!(
        rendered
            .iter()
            .filter(|line| line.contains("Show details"))
            .count(),
        1
    );
}

#[test]
fn grouped_computer_activity_prioritizes_failure_and_screenshot() {
    let entries = [
        computer_entry("computer-1", EntryStatus::Completed, "Open page", 0, None),
        computer_entry(
            "computer-2",
            EntryStatus::Failed,
            "Submit form",
            0,
            Some("timed out"),
        ),
        computer_entry(
            "computer-3",
            EntryStatus::Completed,
            "Capture result",
            1,
            None,
        ),
        computer_entry("computer-4", EntryStatus::Completed, "Close tab", 0, None),
    ];
    let content =
        render_transcript_entries_content(&entries, 80, Locale::EnUs, Path::new("/workspace"));
    let materialized = TranscriptDisclosure::default().materialize(&content, Locale::EnUs, 80);
    let rendered = materialized
        .lines
        .iter()
        .map(|line| line.line.to_string())
        .collect::<Vec<_>>();

    assert_eq!(
        &rendered[..3],
        [
            "• Used computer · 4 actions · 1 failed",
            "  ├ Failed: Submit form — timed out",
            "  └ Captured screenshot · Capture result",
        ]
    );
    assert_eq!(
        rendered
            .iter()
            .filter(|line| line.contains("Show details"))
            .count(),
        1
    );
}

#[test]
fn computer_activity_localizes_the_missing_title_fallback() {
    let entries = [computer_entry(
        "computer-1",
        EntryStatus::Completed,
        "Computer action",
        0,
        None,
    )];
    let content =
        render_transcript_entries_content(&entries, 80, Locale::ZhCn, Path::new("/workspace"));
    let rendered = TranscriptDisclosure::default()
        .materialize(&content, Locale::ZhCn, 80)
        .lines
        .iter()
        .map(|line| line.line.to_string())
        .collect::<Vec<_>>()
        .join("\n");

    assert!(rendered.contains("电脑操作"), "{rendered}");
    assert!(!rendered.contains("Computer action"), "{rendered}");
}

#[test]
fn main_transcript_uses_grouped_compact_activity_and_turn_boundaries() {
    let mut app = App {
        locale: Locale::EnUs,
        ..App::default()
    };
    apply_exploration_item(
        &mut app,
        "turn-1",
        "list-1",
        "find src",
        vec![CommandAction::ListFiles {
            command: "find src".to_string(),
            path: Some("src".to_string()),
        }],
    );
    apply_exploration_item(
        &mut app,
        "turn-1",
        "read-1",
        "cat a.rs",
        vec![CommandAction::Read {
            command: "cat a.rs".to_string(),
            name: "a.rs".to_string(),
            path: "/workspace/a.rs".to_string(),
        }],
    );
    apply_exploration_item(
        &mut app,
        "turn-2",
        "read-2",
        "cat b.rs",
        vec![CommandAction::Read {
            command: "cat b.rs".to_string(),
            name: "b.rs".to_string(),
            path: "/workspace/b.rs".to_string(),
        }],
    );

    let rendered = render_transcript_content_lines(&app, 80, false)
        .iter()
        .map(|line| line.line.to_string())
        .collect::<Vec<_>>()
        .join("\n");

    assert_eq!(rendered.matches("• Explored").count(), 2, "{rendered}");
    assert!(rendered.contains("List src"), "{rendered}");
    assert!(rendered.contains("Read a.rs"), "{rendered}");
    assert!(rendered.contains("Read b.rs"), "{rendered}");
    assert!(!rendered.contains("canonical output"), "{rendered}");
}

#[test]
fn canonical_main_transcript_absorbs_reasoning_and_keeps_trailing_completion() {
    let mut app = App {
        locale: Locale::EnUs,
        ..App::default()
    };
    apply_exploration_item(
        &mut app,
        "turn-1",
        "read-1",
        "cat a.rs",
        vec![CommandAction::Read {
            command: "cat a.rs".to_string(),
            name: "a.rs".to_string(),
            path: "/workspace/a.rs".to_string(),
        }],
    );
    apply_reasoning_item(&mut app, "turn-1", "reasoning-1", "Inspecting a.rs");
    apply_exploration_item(
        &mut app,
        "turn-1",
        "read-2",
        "cat b.rs",
        vec![CommandAction::Read {
            command: "cat b.rs".to_string(),
            name: "b.rs".to_string(),
            path: "/workspace/b.rs".to_string(),
        }],
    );
    apply_reasoning_item(&mut app, "turn-1", "reasoning-2", "Checking b.rs");
    app.projection
        .add_completion_boundary("reasoning-2", Some(61));

    let rendered = render_transcript_content_lines(&app, 80, false)
        .iter()
        .map(|line| line.line.to_string())
        .collect::<Vec<_>>()
        .join("\n");

    assert_eq!(rendered.matches("• Explored").count(), 1, "{rendered}");
    assert!(rendered.contains("Read a.rs, b.rs"), "{rendered}");
    assert!(!rendered.contains("Inspecting a.rs"), "{rendered}");
    assert!(!rendered.contains("Checking b.rs"), "{rendered}");
    assert_eq!(rendered.matches("Worked for 61s").count(), 1, "{rendered}");
}

#[test]
fn streamed_reasoning_keeps_scope_when_canonical_item_replaces_it() {
    let mut app = App {
        locale: Locale::EnUs,
        ..App::default()
    };
    apply_exploration_item(
        &mut app,
        "turn-1",
        "read-1",
        "cat a.rs",
        vec![CommandAction::Read {
            command: "cat a.rs".to_string(),
            name: "a.rs".to_string(),
            path: "/workspace/a.rs".to_string(),
        }],
    );
    app.projection
        .apply(ServerNotification::ReasoningSummaryTextDelta(
            ReasoningSummaryTextDeltaNotification {
                thread_id: "thread-1".to_string(),
                turn_id: "turn-1".to_string(),
                item_id: "reasoning-1".to_string(),
                delta: "Inspecting a.rs".to_string(),
                summary_index: 0,
            },
        ));
    assert_eq!(
        app.projection.entries()[1].activity_detail,
        Some(ActivityDetail::Reasoning {
            scope: "turn-1".to_string(),
        })
    );

    apply_reasoning_item(&mut app, "turn-1", "reasoning-1", "Inspecting a.rs");
    apply_exploration_item(
        &mut app,
        "turn-1",
        "read-2",
        "cat b.rs",
        vec![CommandAction::Read {
            command: "cat b.rs".to_string(),
            name: "b.rs".to_string(),
            path: "/workspace/b.rs".to_string(),
        }],
    );

    assert_eq!(app.projection.entries()[1].id, "reasoning-1");
    assert!(!app.projection.entries()[1].streaming);
    assert_eq!(
        app.projection.entries()[1].activity_detail,
        Some(ActivityDetail::Reasoning {
            scope: "turn-1".to_string(),
        })
    );
    let rendered = render_transcript_content_lines(&app, 80, false)
        .iter()
        .map(|line| line.line.to_string())
        .collect::<Vec<_>>()
        .join("\n");
    assert_eq!(rendered.matches("• Explored").count(), 1, "{rendered}");
    assert!(!rendered.contains("Inspecting a.rs"), "{rendered}");
}

#[test]
fn grouped_compact_activity_never_overflows_narrow_viewport() {
    let entries = [
        exploration_entry_with_actions(
            "search-1",
            "turn-1",
            vec![CommandAction::Search {
                command: "rg very-long-query-name very-long-directory-name".to_string(),
                query: Some("very-long-query-name".to_string()),
                path: Some("very-long-directory-name".to_string()),
            }],
        ),
        exploration_entry_with_actions(
            "read-1",
            "turn-1",
            vec![CommandAction::Read {
                command: "cat very-long-file-name.rs".to_string(),
                name: "very-long-file-name.rs".to_string(),
                path: "/workspace/very-long-file-name.rs".to_string(),
            }],
        ),
    ];
    let content =
        render_transcript_entries_content(&entries, 24, Locale::EnUs, Path::new("/workspace"));
    let materialized = TranscriptDisclosure::default().materialize(&content, Locale::EnUs, 24);

    assert!(
        materialized.lines.iter().all(|line| line.width() <= 24),
        "{:?}",
        materialized
            .lines
            .iter()
            .map(|line| line.line.to_string())
            .collect::<Vec<_>>()
    );
}
