//! Slash completion edits the existing draft instead of replacing its rich input state.

use super::super::{InputResult, SkillPopupAction};
use super::*;
use crossterm::event::{Event, KeyCode, KeyEvent, KeyModifiers};

#[test]
fn inline_completion_preserves_the_tail_at_the_actual_utf8_cursor() {
    for (text, cursor, command, expected) in [
        ("/effo high", 5, SlashCommand::Effort, "/effort high"),
        (
            "/mo fixture provider",
            3,
            SlashCommand::Model,
            "/model fixture provider",
        ),
        ("/mc status", 3, SlashCommand::Mcp, "/mcp status"),
        (
            "/exp 路径/结果.md",
            1,
            SlashCommand::Export,
            "/export 路径/结果.md",
        ),
        ("/efforttail", 7, SlashCommand::Effort, "/effort tail"),
        ("/effo界", 5, SlashCommand::Effort, "/effort 界"),
        ("/effort  \n", 3, SlashCommand::Effort, "/effort  \n"),
        ("/effo\nhigh", 5, SlashCommand::Effort, "/effort\nhigh"),
        (
            "/per :workspace",
            4,
            SlashCommand::Permissions,
            "/permissions :workspace",
        ),
    ] {
        let mut composer = ChatComposer::default();
        composer.insert(text);
        composer.draft.textarea.set_cursor(cursor);
        composer.complete_slash_command(command);
        assert_eq!(composer.text(), expected, "draft={text:?} cursor={cursor}");
        assert_eq!(composer.cursor(), expected.len());
        assert!(!composer.completion_popup_active());
    }
}

#[test]
fn unsupported_or_invalid_inline_completion_does_not_edit_the_draft() {
    for (text, cursor, command) in [
        ("/sta tail", 4, SlashCommand::Status),
        ("ordinary", 3, SlashCommand::Effort),
        ("/effo\nhigh", 8, SlashCommand::Effort),
    ] {
        let mut composer = ChatComposer::default();
        composer.insert(text);
        composer.draft.textarea.set_cursor(cursor);
        let before = composer.snapshot_draft();
        assert!(!composer
            .complete_selected_slash_command_preserving_existing_draft_tail_as_inline_args(
                command
            ));
        assert_eq!(composer.snapshot_draft(), before);
    }
}

#[test]
fn completion_preserves_atomic_images_skill_and_paste_through_vim_undo_redo() {
    for vim_enabled in [false, true] {
        let mut composer = ChatComposer::default();
        composer.set_vim_enabled(vim_enabled);
        composer.set_skills(vec![super::super::tests::test_skill("deploy")]);
        composer.insert("/effo high $dep");
        assert_eq!(
            composer.handle_skill_popup_event(&Event::Key(KeyEvent::new(
                KeyCode::Tab,
                KeyModifiers::NONE
            ))),
            SkillPopupAction::Complete
        );
        composer.attach_image("draft.png".into());
        composer.handle_paste(&"界".repeat(1200));
        composer.draft.textarea.set_cursor("/effo".len());
        composer.sync_completion_popup();
        let before = composer.snapshot_draft();
        composer.complete_slash_command(SlashCommand::Effort);
        let after = composer.snapshot_draft();
        assert_eq!(after.text, before.text.replacen("/effo", "/effort", 1));
        assert_eq!(after.cursor, after.text.len());
        assert_eq!(after.attachments, before.attachments);
        assert_eq!(after.mention_bindings, before.mention_bindings);
        assert_eq!(after.pending_pastes, before.pending_pastes);
        assert_eq!(after.text_elements.len(), 3);
        for (previous, current) in before.text_elements.iter().zip(&after.text_elements) {
            assert_eq!(current.id, previous.id);
            assert_eq!(current.text, previous.text);
            assert_eq!(current.placeholder, previous.placeholder);
            assert_eq!(
                current.range,
                previous.range.start + 2..previous.range.end + 2
            );
        }
        if vim_enabled {
            composer.handle_disconnected_key(KeyEvent::new(KeyCode::Esc, KeyModifiers::NONE));
            composer.handle_disconnected_key(KeyEvent::new(KeyCode::Char('u'), KeyModifiers::NONE));
            assert_eq!(composer.snapshot_draft(), before);
            composer
                .handle_disconnected_key(KeyEvent::new(KeyCode::Char('r'), KeyModifiers::CONTROL));
            assert_eq!(composer.snapshot_draft(), after);
        }
        let InputResult::Submitted {
            text,
            text_elements,
        } = composer.submit()
        else {
            panic!("rich completed draft must remain submittable");
        };
        assert!(text.starts_with("/effort high $deploy "));
        assert!(text.ends_with(&"界".repeat(1200)));
        assert_eq!(text_elements.len(), 2);
        assert_eq!(
            composer.take_recent_submission_mention_bindings(),
            before.mention_bindings
        );
        assert_eq!(
            composer.take_recent_submission_images_with_placeholders()[0].path,
            std::path::PathBuf::from("draft.png")
        );
    }
}
