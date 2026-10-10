//! Hold the real editor open so the visible screen can be observed before it returns.

use super::*;

const READY: &str = "EDITOR_KEEP_SCREEN_READY";

#[cfg(unix)]
pub(super) fn configure_external_editor(command: &mut CommandBuilder, cwd: &Path, prompt: &str) {
    use std::os::unix::fs::PermissionsExt;

    let script = cwd.join("tui-editor.sh");
    std::fs::write(
        &script,
        "#!/bin/sh\ntest -t 0 && test -t 1 && test -t 2 || exit 9\nif [ -n \"$LIME_TEST_EDITOR_BUFFER_PATH\" ]; then printf '%s' \"$1\" > \"$LIME_TEST_EDITOR_BUFFER_PATH\"; fi\nprintf '\\033]777;EDITOR_KEEP_SCREEN_READY\\007'\nIFS= read -r editor_release || exit 10\nprintf '%s' \"$LIME_TEST_EDITOR_REPLACEMENT\" > \"$1\"\nprintf '\\033[?1049lEDITOR_JOB_CONTROL_OK\\n'\n",
    )
    .expect("write editor fixture");
    let mut permissions = std::fs::metadata(&script).unwrap().permissions();
    permissions.set_mode(0o755);
    std::fs::set_permissions(&script, permissions).expect("editor fixture permissions");
    command.env(
        "VISUAL",
        shlex::try_quote(&script.to_string_lossy())
            .expect("quote editor fixture path")
            .into_owned(),
    );
    command.env("LIME_TEST_EDITOR_REPLACEMENT", prompt);
}

#[cfg(windows)]
pub(super) fn configure_external_editor(command: &mut CommandBuilder, cwd: &Path, prompt: &str) {
    let script = cwd.join("tui-editor.cmd");
    std::fs::write(
        &script,
        "@echo off\r\nfor /f \"tokens=2 delims=:\" %%c in ('chcp') do set \"editor_code_page=%%c\"\r\nchcp 65001 >nul\r\nif defined LIME_TEST_EDITOR_BUFFER_PATH <nul set /p \"=%~1\" > \"%LIME_TEST_EDITOR_BUFFER_PATH%\"\r\n<nul set /p \"=\x1b]777;EDITOR_KEEP_SCREEN_READY\x07\"\r\nset /p editor_release=\r\n<nul set /p \"=%LIME_TEST_EDITOR_REPLACEMENT%\" > \"%~1\"\r\nchcp %editor_code_page% >nul\r\n<nul set /p \"=\x1b[?1049l\"\r\necho EDITOR_JOB_CONTROL_OK\r\n",
    )
    .expect("write editor fixture");
    command.env("VISUAL", format!("\"{}\"", script.display()));
    command.env("LIME_TEST_EDITOR_REPLACEMENT", prompt);
}

pub(super) fn assert_preserved_screen_then_release(
    writer: &mut impl Write,
    output_rx: &mpsc::Receiver<Vec<u8>>,
    output: &mut String,
    draft: &str,
) {
    // This OSC is a fixture handshake, deliberately absent from the visible terminal text.
    let ready = format!("\x1b]777;{READY}\x07");
    let deadline = Instant::now() + Duration::from_secs(10);
    while !output.contains(&ready) {
        let remaining = deadline.saturating_duration_since(Instant::now());
        assert!(
            !remaining.is_zero(),
            "editor did not reach its foreground input wait"
        );
        let chunk = output_rx.recv_timeout(remaining).unwrap_or_else(|error| {
            panic!(
                "editor readiness unavailable: {error}; actual screen: {}",
                terminal_screen_text(output)
            )
        });
        output.push_str(&String::from_utf8_lossy(&chunk));
    }
    terminal_observer::with_screen(output, |screen| {
        assert!(
            screen.alternate_screen(),
            "editor must inherit the preserved alternate screen; actual screen: {}",
            screen.contents()
        );
        assert!(
            screen.contents().contains(draft),
            "editor waiting for input must retain composer {draft:?}; actual screen: {}",
            screen.contents()
        );
    });
    writer
        .write_all(b"\n")
        .expect("release the foreground editor");
    writer.flush().expect("flush editor release");
}

pub(super) fn assert_editor_exit_and_reentry(output: &str) {
    let marker = output
        .find("EDITOR_JOB_CONTROL_OK")
        .expect("editor return marker");
    terminal_observer::with_screen(&output[..marker], |screen| {
        assert!(
            !screen.alternate_screen(),
            "editor must leave the alternate screen before returning"
        );
    });
    terminal_observer::with_screen(output, |screen| {
        assert!(
            screen.alternate_screen(),
            "TUI must re-enter the alternate screen after the editor returns"
        );
    });
    eprintln!("TUI_EDITOR_KEEP_SCREEN_OK alternate=preserved composer=visible stdin=foreground editor-exit=main");
}

struct EditorChild(Box<dyn portable_pty::Child + Send + Sync>);

impl Drop for EditorChild {
    fn drop(&mut self) {
        if !matches!(self.0.try_wait(), Ok(Some(_))) {
            let _ = self.0.kill();
            let _ = self.0.wait();
        }
    }
}

#[test]
fn real_pty_external_editor_uses_resumed_thread_cwd() {
    if std::env::var_os("LIME_TEST_TUI_GATE_B").is_none() {
        return;
    }
    use crate::app_server_session::{thread_turns_page_with_handle, AppServerSession};
    use app_server_client::StdioTransportConfig;
    use app_server_protocol::protocol::v2::{ThreadItem, TurnStatus, UserInput};

    const SEED: &str = "resumed draft 界🙂";
    const EDITED: &str = "canonical editor 界🙂";
    let cli_bin = required_test_path("LIME_TEST_CLI_BIN");
    let app_server_bin = required_test_path("LIME_TEST_APP_SERVER_BIN");
    let backend_path = required_test_path("LIME_TEST_TERMINAL_BACKEND");
    let node_bin = required_test_path("LIME_TEST_NODE_BIN");
    let completed_text = std::env::var("LIME_TEST_TERMINAL_COMPLETED_TEXT").unwrap();
    let directory = tempfile::tempdir_in(required_test_path("LIME_TEST_TERMINAL_CWD")).unwrap();
    let root = directory.path();
    let launch_cwd = root.join("launch");
    let resumed_cwd = root.join("resumed thread 界");
    std::fs::create_dir(&launch_cwd).unwrap();
    std::fs::create_dir(&resumed_cwd).unwrap();
    let resumed_cwd = std::fs::canonicalize(resumed_cwd).unwrap();
    let storage = StdioTransportConfig {
        app_server_bin: app_server_bin.clone(),
        args: vec![
            "--stdio".into(),
            "--backend".into(),
            "unavailable".into(),
            "--data-dir".into(),
            root.join("data").into_os_string(),
            "--app-data-dir".into(),
            root.join("app-data").into_os_string(),
        ],
    };
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    let thread_id = runtime.block_on(async {
        let mut session = AppServerSession::connect(storage.clone()).await.unwrap();
        let response = session
            .start_thread(
                resumed_cwd.clone(),
                Some("fixture-model".into()),
                Some("fixture-provider".into()),
            )
            .await
            .unwrap();
        assert_eq!(std::fs::canonicalize(response.cwd).unwrap(), resumed_cwd);
        let id = response.thread.id;
        session.shutdown().await.unwrap();
        id
    });
    let ledger_path = root.join("editor-ledger.jsonl");
    let buffer_probe = root.join("editor-buffer-path");
    let mut command = CommandBuilder::new(cli_bin);
    command.args([
        OsString::from("resume"),
        thread_id.clone().into(),
        "--cd".into(),
        launch_cwd.clone().into_os_string(),
        "--app-server".into(),
        app_server_bin.into_os_string(),
    ]);
    for (option, value) in [
        ("--backend", OsString::from("external")),
        ("--backend-command", node_bin.into_os_string()),
        ("--backend-arg", backend_path.into_os_string()),
        ("--backend-arg", ledger_path.clone().into_os_string()),
        ("--data-dir", root.join("data").into_os_string()),
        ("--app-data-dir", root.join("app-data").into_os_string()),
    ] {
        command.arg(format!("--app-server-arg={option}"));
        let mut argument = OsString::from("--app-server-arg=");
        argument.push(value);
        command.arg(argument);
    }
    command.cwd(&launch_cwd);
    command.env("TERM", "xterm-256color");
    command.env("LIME_LOCALE", "en-US");
    command.env("LIME_TEST_EDITOR_BUFFER_PATH", &buffer_probe);
    configure_external_editor(&mut command, root, EDITED);
    let pair = native_pty_system()
        .openpty(PtySize {
            rows: 24,
            cols: 100,
            pixel_width: 0,
            pixel_height: 0,
        })
        .unwrap();
    let reader = pair.master.try_clone_reader().unwrap();
    let mut writer = pair.master.take_writer().unwrap();
    let mut child = EditorChild(pair.slave.spawn_command(command).unwrap());
    drop(pair.slave);
    let (output_tx, output_rx) = mpsc::channel();
    let reader_thread = thread::spawn(move || output::read_output(reader, output_tx));
    let mut output = String::new();
    wait_for_screen_marker(
        &output_rx,
        &mut output,
        "Ask Lime to do anything",
        Duration::from_secs(10),
    );
    writer
        .write_all(format!("\x1b[200~{SEED}\x1b[201~\x05").as_bytes())
        .unwrap();
    writer.flush().unwrap();
    wait_for_screen_marker(&output_rx, &mut output, SEED, Duration::from_secs(10));
    writer.write_all(&[7]).unwrap();
    writer.flush().unwrap();
    assert_preserved_screen_then_release(&mut writer, &output_rx, &mut output, SEED);
    let buffer =
        PathBuf::from(std::fs::read_to_string(&buffer_probe).expect("editor buffer path probe"));
    wait_for_screen_marker(&output_rx, &mut output, EDITED, Duration::from_secs(10));
    assert_editor_exit_and_reentry(&output);
    assert_eq!(
        std::fs::canonicalize(buffer.parent().unwrap()).unwrap(),
        resumed_cwd,
        "editor buffer must follow the resumed canonical thread cwd, not launch cwd {}",
        launch_cwd.display()
    );
    assert!(
        !buffer.exists(),
        "editor buffer must be removed after readback"
    );
    let (row, column) = terminal_marker_position(&output, EDITED).unwrap();
    let column = column + crate::width::display_width(EDITED) as u16;
    wait_for_cursor_position(
        &output_rx,
        &mut output,
        row,
        column,
        Duration::from_secs(10),
    );
    for (key, expected) in [
        (b"\x1b[D".as_slice(), column - 2),
        (b"\x1b[C".as_slice(), column),
    ] {
        writer.write_all(key).unwrap();
        writer.flush().unwrap();
        wait_for_cursor_position(
            &output_rx,
            &mut output,
            row,
            expected,
            Duration::from_secs(10),
        );
    }
    writer.write_all(b"\r").unwrap();
    writer.flush().unwrap();
    wait_for_screen_marker(
        &output_rx,
        &mut output,
        &completed_text,
        Duration::from_secs(10),
    );
    writer.write_all(&[3, 3]).unwrap();
    writer.flush().unwrap();
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        if let Some(status) = child.0.try_wait().unwrap() {
            assert!(status.success(), "resumed editor TUI failed: {status:?}");
            break;
        }
        assert!(Instant::now() < deadline, "resumed editor TUI did not exit");
        if let Ok(chunk) = output_rx.recv_timeout(Duration::from_millis(50)) {
            output.push_str(&String::from_utf8_lossy(&chunk));
        }
    }
    drop(writer);
    drop(pair.master);
    reader_thread.join().unwrap();
    while let Ok(chunk) = output_rx.try_recv() {
        output.push_str(&String::from_utf8_lossy(&chunk));
    }
    terminal_observer::with_screen(&output, |screen| assert!(!screen.alternate_screen()));
    cursor_style::assert_default_restored(&output);
    terminal_title::assert_cleared_on_exit(&output);
    assert!(
        output.contains("\x1b[?1000l"),
        "mouse capture must be restored"
    );
    runtime.block_on(async {
        let session = AppServerSession::connect(storage).await.unwrap();
        let read = session.thread_read(&thread_id, false).await.unwrap();
        assert_eq!(read.thread.id, thread_id);
        assert_eq!(std::fs::canonicalize(read.thread.cwd).unwrap(), resumed_cwd);
        let turns = thread_turns_page_with_handle(session.request_handle(), &thread_id, None)
            .await
            .unwrap()
            .data;
        assert_eq!(
            turns.len(),
            1,
            "editor must submit exactly one resumed canonical Turn"
        );
        assert_eq!(turns[0].status, TurnStatus::Completed);
        let users = turns[0]
            .items
            .iter()
            .filter_map(|item| match item {
                ThreadItem::UserMessage { content, .. } => Some(content),
                _ => None,
            })
            .collect::<Vec<_>>();
        assert_eq!(
            users,
            [&vec![UserInput::Text {
                text: EDITED.into(),
                text_elements: vec![]
            }]]
        );
        session.shutdown().await.unwrap();
    });
    eprintln!("TUI_EDITOR_CWD_OK thread={thread_id} resume=canonical launch=different buffer=canonical draft=unicode first-arrow=preserved cold-read=exact terminal=restored");
}
