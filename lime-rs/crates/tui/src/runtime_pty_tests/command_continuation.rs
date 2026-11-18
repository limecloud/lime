use super::*;

#[test]
fn real_pty_projects_session_command_exit_after_model_turn() {
    if std::env::var_os("LIME_TEST_COMMAND_TUI_GATE_B").is_none() {
        return;
    }
    let cwd = required_test_path("LIME_TEST_TERMINAL_CWD");
    let mut command = CommandBuilder::new(required_test_path("LIME_TEST_CLI_BIN"));
    for argument in [
        OsString::from("resume"),
        std::env::var_os("LIME_TEST_COMMAND_THREAD_ID").expect("prepared canonical Thread"),
        OsString::from("--cd"),
        cwd.as_os_str().to_owned(),
        OsString::from("--app-server"),
        required_test_path("LIME_TEST_APP_SERVER_BIN").into_os_string(),
        OsString::from("--app-server-arg=--backend"),
        OsString::from("--app-server-arg=runtime"),
        OsString::from("--app-server-arg=--data-dir"),
        OsString::from(format!(
            "--app-server-arg={}",
            required_test_path("LIME_TEST_COMMAND_DATA_DIR").display()
        )),
        OsString::from("--app-server-arg=--app-data-dir"),
        OsString::from(format!(
            "--app-server-arg={}",
            required_test_path("LIME_TEST_COMMAND_APP_DATA_DIR").display()
        )),
        OsString::from("--dangerously-bypass-approvals-and-sandbox"),
    ] {
        command.arg(argument);
    }
    command.cwd(&cwd);
    command.env("TERM", "xterm-256color");
    command.env("LIME_LOCALE", "en-US");
    let pair = native_pty_system()
        .openpty(PtySize {
            rows: 24,
            cols: 100,
            pixel_width: 0,
            pixel_height: 0,
        })
        .unwrap();
    #[cfg(unix)]
    let initial_termios = pair.master.get_termios().expect("initial native PTY mode");
    let reader = pair.master.try_clone_reader().unwrap();
    let mut writer = pair.master.take_writer().unwrap();
    let mut child = pair.slave.spawn_command(command).unwrap();
    drop(pair.slave);
    let master = pair.master;
    let (sender, receiver) = mpsc::channel();
    let reader_thread = thread::spawn(move || output::read_output(reader, sender));
    let mut trace = String::new();
    wait_for_screen(&receiver, &mut trace, "resumed composer", |screen| {
        screen.contains('›')
    });
    writer
        .write_all(b"\x1b[200~Run the local command invocation fixture.\x1b[201~\r")
        .unwrap();
    writer.flush().unwrap();
    wait_for_screen(
        &receiver,
        &mut trace,
        "model Turn complete while actual Command runs",
        |screen| screen.contains("BACKGROUND_STARTED") && !screen.contains("esc to interrupt"),
    );
    assert!(!terminal_screen_text(&trace).contains("BACKGROUND_AUTONOMOUS_DONE"));
    writer
        .write_all(b"\x1b[200~draft while background runs\x1b[201~")
        .unwrap();
    writer.flush().unwrap();
    wait_for_screen(&receiver, &mut trace, "composer remains usable", |screen| {
        screen.contains("draft while background runs")
    });
    std::fs::write(cwd.join("work dir/.background-release"), "release\n").unwrap();
    // The transcript follows the canonical projection while the actual process exits;
    // its expanded view exposes output even when compact command groups hide it.
    writer.write_all(b"\x14").unwrap();
    writer.flush().unwrap();
    wait_for_screen(
        &receiver,
        &mut trace,
        "command output disclosure",
        |screen| screen.contains("F4 inspect activity"),
    );
    writer.write_all(b"\x1bOS\r").unwrap();
    writer.flush().unwrap();
    wait_for_screen(
        &receiver,
        &mut trace,
        "autonomous process output after model completion",
        |screen| screen.contains("BACKGROUND_AUTONOMOUS_DONE"),
    );
    wait_for_screen(
        &receiver,
        &mut trace,
        "canonical Command terminal",
        |screen| screen.contains("BACKGROUND_AUTONOMOUS_DONE") && screen.contains("[completed]"),
    );
    writer.write_all(b"\x14").unwrap();
    writer.flush().unwrap();
    wait_for_screen(
        &receiver,
        &mut trace,
        "draft preserved after Command exit",
        |screen| screen.contains("draft while background runs"),
    );
    writer.write_all(b"\x01\x0b\x04").unwrap();
    writer.flush().unwrap();
    let deadline = Instant::now() + Duration::from_secs(5);
    let status = loop {
        if let Some(status) = child.try_wait().unwrap() {
            break status;
        }
        if Instant::now() >= deadline {
            child.kill().unwrap();
            panic!("TUI failed to exit; trace={trace}");
        }
        thread::sleep(Duration::from_millis(20));
    };
    #[cfg(unix)]
    assert_eq!(
        master.get_termios().expect("restored native PTY mode"),
        initial_termios,
        "native terminal mode was not restored"
    );
    drop(writer);
    drop(master);
    reader_thread.join().unwrap();
    for bytes in receiver.try_iter() {
        trace.push_str(&String::from_utf8_lossy(&bytes));
    }
    std::fs::write(cwd.join("tui-command.trace"), &trace).unwrap();
    assert!(status.success(), "{status:?}; trace={trace}");
    assert!(
        trace.contains("\x1b[?1049h") && trace.contains("\x1b[?1049l"),
        "alternate screen lifecycle missing"
    );
    cursor_style::assert_default_restored(&trace);
    terminal_title::assert_cleared_on_exit(&trace);
    eprintln!(
        "COMMAND_AUTONOMOUS_TUI_GATE_B_OK keyboard=actual alternate=restored termios=restored output=visible backend=runtime"
    );
}
