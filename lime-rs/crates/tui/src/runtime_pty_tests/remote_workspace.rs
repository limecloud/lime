//! Exercise the remote workspace through a real terminal and the current daemon.

use super::*;

struct OwnedChild(Box<dyn portable_pty::Child + Send + Sync>);

impl Drop for OwnedChild {
    fn drop(&mut self) {
        if !matches!(self.0.try_wait(), Ok(Some(_))) {
            let _ = self.0.kill();
            let _ = self.0.wait();
        }
    }
}

#[test]
fn real_pty_remote_workspace_uses_server_directory_and_restores_terminal() {
    let Some(config_path) = std::env::var_os("LIME_TEST_REMOTE_WORKSPACE_CONFIG") else {
        return;
    };
    let config: serde_json::Value =
        serde_json::from_slice(&std::fs::read(config_path).unwrap()).unwrap();
    let text = |key: &str| config[key].as_str().unwrap();
    let mut command = CommandBuilder::new(text("cli"));
    if config["resume"].as_bool() == Some(true) {
        command.arg("resume");
        if let Some(thread_id) = config["threadId"].as_str() {
            command.arg(thread_id);
        }
    }
    for (flag, key) in [
        ("--remote", "remote"),
        ("--model", "model"),
        ("--provider", "provider"),
    ] {
        command.arg(flag);
        command.arg(text(key));
    }
    command.arg("--locale=en-US");
    command.arg("--dangerously-bypass-approvals-and-sandbox");
    if let Some(cwd) = config["explicitCwd"].as_str() {
        command.arg("--cd");
        command.arg(cwd);
    }
    command.cwd(text("clientCwd"));
    command.env("TERM", "xterm-256color");
    command.env("LIME_LOCALE", "en-US");
    command.env("LIME_AGENT_ROOT", text("agentRoot"));
    let pair = native_pty_system()
        .openpty(PtySize {
            rows: 30,
            cols: 140,
            pixel_width: 0,
            pixel_height: 0,
        })
        .expect("open remote workspace PTY");
    #[cfg(unix)]
    let original_termios = pair.master.get_termios().expect("original terminal mode");
    let reader = pair.master.try_clone_reader().unwrap();
    let mut writer = pair.master.take_writer().unwrap();
    let mut child = OwnedChild(pair.slave.spawn_command(command).unwrap());
    drop(pair.slave);
    let (sender, receiver) = mpsc::channel();
    let reader_thread = thread::spawn(move || output::read_output(reader, sender));
    let mut output = String::new();
    terminal_observer::resize(&output, 30, 140);
    if config["resume"].as_bool() == Some(true) && config["threadId"].is_null() {
        wait_for_screen_marker(
            &receiver,
            &mut output,
            text("resumeName"),
            Duration::from_secs(20),
        );
        writer.write_all(b"\r").unwrap();
        writer.flush().unwrap();
    }
    wait_for_screen_marker(
        &receiver,
        &mut output,
        "Ask Lime to do anything",
        Duration::from_secs(20),
    );
    write_typed_text(&mut writer, text("prompt").as_bytes());
    writer.write_all(b"\x05").unwrap();
    writer.flush().unwrap();
    wait_for_screen_marker(
        &receiver,
        &mut output,
        text("prompt"),
        Duration::from_secs(10),
    );
    writer.write_all(b"\r").unwrap();
    writer.flush().unwrap();
    wait_for_marker(
        &mut writer,
        &receiver,
        &mut output,
        text("completedText"),
        Duration::from_secs(30),
    );
    writer.write_all(&[4]).unwrap();
    writer.flush().unwrap();
    let deadline = Instant::now() + Duration::from_secs(10);
    let status = loop {
        if let Some(status) = child.0.try_wait().unwrap() {
            break status;
        }
        assert!(
            Instant::now() < deadline,
            "remote TUI did not exit: {output}"
        );
        thread::sleep(Duration::from_millis(20));
    };
    #[cfg(unix)]
    assert_eq!(
        pair.master.get_termios(),
        Some(original_termios),
        "remote TUI must restore the original terminal mode"
    );
    drop(writer);
    drop(pair.master);
    reader_thread.join().unwrap();
    while let Ok(chunk) = receiver.try_recv() {
        output.push_str(&String::from_utf8_lossy(&chunk));
    }
    std::fs::write(text("transcript"), &output).unwrap();
    assert!(status.success(), "remote TUI failed: {status:?}: {output}");
    assert!(output.contains("\u{1b}[?1049h"), "alternate screen entered");
    assert!(
        output.contains("\u{1b}[?1049l"),
        "alternate screen restored"
    );
    assert!(output.contains("\u{1b}[?1000l"), "mouse mode restored");
}
