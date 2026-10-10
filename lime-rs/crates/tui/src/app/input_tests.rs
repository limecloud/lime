use super::*;
use crate::external_editor::EditorError;
use crate::locale::Locale;
use crate::projection::EntryKind;

#[test]
fn external_editor_success_trims_only_the_tail_and_allows_clearing_owned_input() {
    for (edited, expected) in [
        ("  edited界🙂\n\t", "  edited界🙂"),
        ("", ""),
        (" \n\t", ""),
    ] {
        let mut app = App::default();
        app.chat_widget.bottom_pane.insert_str("old draft");
        app.chat_widget.bottom_pane.attach_image("owned.png".into());
        app.chat_widget
            .set_external_editor_state(ExternalEditorState::Active);
        app.finish_external_editor(Ok(edited.into()));
        assert_eq!(
            app.chat_widget.external_editor_state(),
            ExternalEditorState::Closed
        );
        assert_eq!(app.chat_widget.bottom_pane.composer_text(), expected);
        assert!(app
            .chat_widget
            .bottom_pane
            .composer_local_images()
            .is_empty());
        assert!(app.projection.entries().is_empty());
    }
}

#[test]
fn external_editor_failure_preserves_the_rich_draft_and_adds_a_visible_localized_error() {
    for state in [ExternalEditorState::Requested, ExternalEditorState::Active] {
        let mut app = App::default();
        app.chat_widget.set_locale(Locale::ZhCn);
        app.chat_widget.bottom_pane.insert_str("kept界🙂");
        app.chat_widget.bottom_pane.attach_image("owned.png".into());
        let draft = app.chat_widget.bottom_pane.composer_draft();
        app.chat_widget.set_external_editor_state(state);
        app.finish_external_editor(Err(EditorError::EmptyCommand.into()));
        assert_eq!(
            app.chat_widget.external_editor_state(),
            ExternalEditorState::Closed
        );
        assert_eq!(app.chat_widget.bottom_pane.composer_draft(), draft);
        let entries = app.projection.entries();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].kind, EntryKind::Error);
        assert_eq!(entries[0].text, "打开编辑器失败: 编辑器命令为空");
    }
}
