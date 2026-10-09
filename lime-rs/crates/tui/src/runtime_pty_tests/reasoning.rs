use super::*;

#[test]
fn real_pty_shared_raw_visibility_live_transcript_and_terminal_restore() {
    if std::env::var_os("LIME_TEST_TUI_GATE_B").is_none() {
        return;
    }
    let show_raw = std::env::var("LIME_TEST_RAW_VISIBLE").unwrap() == "true";
    let cwd = required_test_path("LIME_TEST_TERMINAL_CWD");
    let mut command = CommandBuilder::new(required_test_path("LIME_TEST_CLI_BIN"));
    for arg in [
        "tui".into(),
        "--cd".into(),
        cwd.as_os_str().to_owned(),
        "--model".into(),
        "fixture-model".into(),
        "--provider".into(),
        "fixture-provider".into(),
        "--app-server".into(),
        required_test_path("LIME_TEST_APP_SERVER_BIN").into_os_string(),
        "--app-server-arg=--backend".into(),
        "--app-server-arg=external".into(),
        "--app-server-arg=--backend-command".into(),
        format!(
            "--app-server-arg={}",
            required_test_path("LIME_TEST_NODE_BIN").display()
        )
        .into(),
        "--app-server-arg=--backend-arg".into(),
        format!(
            "--app-server-arg={}",
            required_test_path("LIME_TEST_TERMINAL_BACKEND").display()
        )
        .into(),
        "--app-server-arg=--backend-arg".into(),
        format!("--app-server-arg={}", cwd.join("ledger.jsonl").display()).into(),
        "--app-server-arg=--backend-timeout-ms".into(),
        "--app-server-arg=30000".into(),
        format!("--app-server-arg=--data-dir={}", cwd.join("data").display()).into(),
        format!(
            "--app-server-arg=--app-data-dir={}",
            cwd.join("app-data").display()
        )
        .into(),
    ] {
        command.arg(arg);
    }
    command.cwd(&cwd);
    command.env("TERM", "xterm-256color");
    command.env("LIME_LOCALE", "en-US");
    command.env(
        "LIME_CONFIG_PATH",
        required_test_path("LIME_TEST_PERMISSION_CONFIG"),
    );
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
    let mut child = pair.slave.spawn_command(command).unwrap();
    drop(pair.slave);
    let master = pair.master;
    let (tx, rx) = mpsc::channel();
    let reader_thread = thread::spawn(move || output::read_output(reader, tx));
    let mut output = String::new();
    wait_for_marker(
        &rx,
        &mut output,
        "Ask Lime to do anything",
        Duration::from_secs(15),
    );
    writer
        .write_all(b"\x1b[200~raw reasoning fixture\x1b[201~\r")
        .unwrap();
    writer.flush().unwrap();
    wait_for_screen_marker(
        &rx,
        &mut output,
        if show_raw { "RAW_BODY" } else { "RAW_SUMMARY" },
        Duration::from_secs(15),
    );
    writer.write_all(&[20]).unwrap();
    writer.flush().unwrap();
    wait_for_screen(
        &rx,
        &mut output,
        "live raw reasoning transcript",
        |screen| screen.contains("/ T R A N S C R I P T") && screen.contains("RAW_SUMMARY"),
    );
    if show_raw {
        wait_for_screen_marker(&rx, &mut output, "RAW_BODY", Duration::from_secs(10));
    } else {
        assert!(!terminal_screen_text(&output).contains("RAW_BODY"));
    }
    writer.write_all(&[20]).unwrap();
    writer.flush().unwrap();
    wait_for_screen(&rx, &mut output, "close live transcript", |screen| {
        !screen.contains("/ T R A N S C R I P T") && screen.contains("Ask Lime to do anything")
    });
    std::fs::write(cwd.join("ledger.jsonl.continue"), b"continue").unwrap();
    wait_for_screen(&rx, &mut output, "raw reasoning terminal", |screen| {
        screen.contains("RAW_DONE") && !screen.contains("Working")
    });
    writer.write_all(&[20]).unwrap();
    writer.flush().unwrap();
    wait_for_screen(
        &rx,
        &mut output,
        "completed raw reasoning transcript",
        |screen| screen.contains("/ T R A N S C R I P T") && screen.contains("RAW_SUMMARY"),
    );
    if show_raw {
        wait_for_screen_marker(
            &rx,
            &mut output,
            "RAW_BODY RAW_CONTINUED",
            Duration::from_secs(10),
        );
    } else {
        assert!(!terminal_screen_text(&output).contains("RAW_BODY"));
    }
    let screen = terminal_screen_text(&output);
    assert_eq!(screen.matches("RAW_SUMMARY").count(), 1);
    assert_eq!(screen.matches("RAW_BODY").count(), usize::from(show_raw));
    writer.write_all(&[20]).unwrap();
    writer.flush().unwrap();
    wait_for_screen(&rx, &mut output, "close completed transcript", |screen| {
        !screen.contains("/ T R A N S C R I P T") && screen.contains("Ask Lime to do anything")
    });
    writer.write_all(b"\x04").unwrap();
    writer.flush().unwrap();
    let deadline = Instant::now() + Duration::from_secs(10);
    let status = loop {
        if let Some(status) = child.try_wait().unwrap() {
            break status;
        }
        if Instant::now() >= deadline {
            child.kill().unwrap();
            panic!("raw reasoning TUI failed to exit: {output}");
        }
        thread::sleep(Duration::from_millis(20));
    };
    drop(writer);
    drop(master);
    reader_thread.join().unwrap();
    while let Ok(chunk) = rx.try_recv() {
        output.push_str(&String::from_utf8_lossy(&chunk));
    }
    assert!(status.success());
    assert!(output.contains("\x1b[?1049h") && output.contains("\x1b[?1049l"));
    println!("PTY_RAW_REASONING_OK visible={show_raw} config=ok live=ok transcript=ok once=ok alternate-screen=restored exit=ok");
}

pub(super) fn assert_summary_body(
    output_rx: &mpsc::Receiver<Vec<u8>>,
    output: &mut String,
    reasoning_text: &str,
) {
    wait_for_screen_marker(
        output_rx,
        output,
        "PTY_SECOND_PARAGRAPH",
        Duration::from_secs(10),
    );
    let screen = terminal_screen_text(output);
    for header in [
        "PTY_EMPTY_STATUS",
        "PTY_BODY_HEADER",
        "PTY_EMPTY_TAIL",
        "PTY_RAW_REASONING_MUST_STAY_HIDDEN",
    ] {
        assert!(
            !screen.contains(header),
            "summary heading leaked into detailed body: {screen}"
        );
    }
    assert!(
        screen.contains("use <!-- -->."),
        "literal comment content disappeared: {screen}"
    );
    let rows = screen.lines().collect::<Vec<_>>();
    assert_eq!(
        screen.matches(reasoning_text).count(),
        1,
        "summary body duplicated: {screen}"
    );
    assert_eq!(
        screen.matches("PTY_SECOND_PARAGRAPH").count(),
        1,
        "summary paragraph duplicated: {screen}"
    );
    let first = rows
        .iter()
        .position(|row| row.contains(reasoning_text))
        .expect("summary body row");
    let second = rows
        .iter()
        .position(|row| row.contains("PTY_SECOND_PARAGRAPH"))
        .expect("second summary part row");
    assert!(
        second > first + 1,
        "summary part boundary lost its blank paragraph: {screen}"
    );
    assert!(
        rows[first + 1..second]
            .iter()
            .any(|row| row.trim().is_empty()),
        "summary parts have no blank row: {screen}"
    );
    eprintln!("TUI_REASONING_PARTS_OK body=ok paragraphs=ok placeholders=hidden literal-comment=preserved");
}
