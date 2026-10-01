use super::*;

#[test]
fn snapshot_moves_one_register_and_preserves_kind_without_inferring_it_from_newlines() {
    for (kind, contents, expected) in [
        (KillBufferKind::Characterwise, "a\nb", "界a\nb🙂"),
        (KillBufferKind::Linewise, "a\nb\n", "界🙂\na\nb"),
    ] {
        let mut previous = TextArea::default();
        previous.store_kill_buffer(contents.into(), kind);
        let snapshot = previous.take_kill_buffer_snapshot();
        assert!(
            previous.kill_buffer.is_empty(),
            "previous editor must relinquish register ownership"
        );
        let mut current = TextArea::default();
        current.replace("界🙂".into());
        current.set_cursor(0);
        current.restore_kill_buffer_snapshot(snapshot);
        current.paste_after_cursor();
        assert_eq!(
            current.text(),
            expected,
            "{kind:?} must survive replacement"
        );
        assert_eq!(current.kill_buffer_kind, kind);
    }
}
