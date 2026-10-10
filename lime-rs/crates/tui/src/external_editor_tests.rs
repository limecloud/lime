use super::*;
use pretty_assertions::assert_eq;

#[test]
fn resolve_editor_prefers_visual_and_rejects_empty_visual_without_fallback() {
    assert_eq!(
        resolve_editor_command_from(Some("visual --wait"), Some("editor")).unwrap(),
        ["visual", "--wait"]
    );
    assert_eq!(
        resolve_editor_command_from(None, Some("editor --wait")).unwrap(),
        ["editor", "--wait"]
    );
    for visual in ["", " \t "] {
        assert_eq!(
            resolve_editor_command_from(Some(visual), Some("editor")),
            Err(EditorError::EmptyCommand)
        );
    }
    assert_eq!(
        resolve_editor_command_from(None, None),
        Err(EditorError::MissingEditor)
    );
}

#[test]
#[cfg(not(windows))]
fn editor_arguments_preserve_empty_values_and_literal_backslashes() {
    for (command, expected) in [
        ("code --wait ''", vec!["code", "--wait", ""]),
        (
            r"code 'C:\work\draft.md'",
            vec!["code", r"C:\work\draft.md"],
        ),
        (
            r#""C:\Program Files\Code\Code.exe" --wait "C:\work\draft.md""#,
            vec![
                r"C:\Program Files\Code\Code.exe",
                "--wait",
                r"C:\work\draft.md",
            ],
        ),
        (r"code workspace\ file", vec!["code", "workspace file"]),
    ] {
        assert_eq!(
            resolve_editor_command_from(Some(command), None).unwrap(),
            expected,
            "{command}"
        );
    }
}

#[test]
#[cfg(not(windows))]
fn resolve_editor_rejects_unterminated_quotes_and_escapes() {
    for command in ["vim '", "vim \"", "vim \\"] {
        assert_eq!(
            resolve_editor_command_from(Some(command), Some("valid-editor")),
            Err(EditorError::ParseFailed)
        );
    }
}

#[test]
#[cfg(windows)]
fn resolve_editor_preserves_windows_paths_and_empty_arguments() {
    let command = r#""C:\Program Files\Code\Code.exe" --wait "" "C:\work\draft.md""#;
    assert_eq!(
        resolve_editor_command_from(Some(command), None).unwrap(),
        [
            r"C:\Program Files\Code\Code.exe",
            "--wait",
            "",
            r"C:\work\draft.md"
        ]
    );
}

#[tokio::test]
#[cfg(unix)]
async fn run_editor_receives_exact_arguments_and_returns_untrimmed_content() {
    let directory = tempfile::tempdir().unwrap();
    let raw = r#"/bin/sh -c 'test "$1" = "" || exit 81; test "$2" = "C:\work\draft.md" || exit 82; test "$(cat "$3")" = "seed界🙂" || exit 83; printf "  edited界🙂\n\t" > "$3"' editor '' 'C:\work\draft.md'"#;
    let command = resolve_editor_command_from(Some(raw), None).unwrap();
    let edited = run_editor("seed界🙂", &command, directory.path())
        .await
        .unwrap();
    assert_eq!(edited, "  edited界🙂\n\t");
    assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 0);
}

#[tokio::test]
#[cfg(unix)]
async fn run_editor_returns_empty_content_to_clear_the_draft() {
    let directory = tempfile::tempdir().unwrap();
    let command =
        resolve_editor_command_from(Some(r#"/bin/sh -c 'printf "" > "$1"' editor"#), None).unwrap();
    assert_eq!(
        run_editor("seed", &command, directory.path())
            .await
            .unwrap(),
        ""
    );
    assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 0);
}

#[tokio::test]
#[cfg(unix)]
async fn run_editor_failure_and_spawn_error_do_not_leak_the_buffer() {
    let directory = tempfile::tempdir().unwrap();
    for (command, message) in [
        (
            vec!["/bin/sh".into(), "-c".into(), "exit 7".into()],
            "exited with status",
        ),
        (
            vec![directory
                .path()
                .join("missing-editor")
                .to_string_lossy()
                .into_owned()],
            "failed to start external editor",
        ),
    ] {
        let error = run_editor("seed", &command, directory.path())
            .await
            .unwrap_err();
        assert!(error.to_string().contains(message), "{error:#}");
        assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 0);
    }
}

#[tokio::test]
async fn run_editor_rejects_an_empty_command_before_creating_a_buffer() {
    let directory = tempfile::tempdir().unwrap();
    let error = run_editor("seed", &[], directory.path()).await.unwrap_err();
    assert_eq!(
        error.downcast_ref::<EditorError>(),
        Some(&EditorError::EmptyCommand)
    );
    assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 0);
}
