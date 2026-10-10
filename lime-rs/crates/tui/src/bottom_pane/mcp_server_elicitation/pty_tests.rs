//! A transparent stdio driver invokes MCP; all responses come from the real App Server.

use super::*;
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use serde_json::json;
use std::io::{Read, Write};
use std::os::unix::fs::PermissionsExt;
use std::sync::mpsc;

struct Pty {
    child: Box<dyn portable_pty::Child + Send + Sync>,
    writer: Box<dyn Write + Send>,
    output: mpsc::Receiver<Vec<u8>>,
    parser: vt100::Parser,
    trace: Vec<u8>,
    ledger_path: std::path::PathBuf,
}

impl Pty {
    fn write(&mut self, bytes: &[u8]) {
        self.writer.write_all(bytes).unwrap();
        self.writer.flush().unwrap();
    }

    fn wait(&mut self, label: &str, predicate: impl Fn(&vt100::Screen) -> bool) {
        let deadline = Instant::now() + Duration::from_secs(15);
        while !predicate(self.parser.screen()) {
            let bytes = self
                .output
                .recv_timeout(deadline.saturating_duration_since(Instant::now()))
                .unwrap_or_else(|error| {
                    panic!(
                        "MCP PTY {label}: {error}; screen:\n{}\nrelay:\n{}",
                        self.parser.screen().contents(),
                        std::fs::read_to_string(&self.ledger_path).unwrap_or_default()
                    )
                });
            self.parser.process(&bytes);
            self.trace.extend(bytes);
            if self.trace.ends_with(b"\x1b[6n") {
                self.write(b"\x1b[1;1R");
            }
        }
    }
}

impl Drop for Pty {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn real_pty_mcp_form_uses_stdio_rich_drafts_and_restores_terminal() {
    if std::env::var_os("LIME_TEST_MCP_ELICITATION_FIXTURE").is_none() {
        return;
    }
    let cwd = tempfile::tempdir().unwrap();
    let session = super::stdio_tests::connect(cwd.path()).await;
    let provider = super::stdio_tests::configure_form(&session, cwd.path()).await;
    session.shutdown().await.unwrap();
    let relay_path = cwd.path().join("app-server-relay.mjs");
    let relay_url = url::Url::from_file_path(std::env::var("LIME_TEST_MCP_RELAY").unwrap())
        .unwrap()
        .to_string();
    std::fs::write(
        &relay_path,
        format!(
            "#!{}\nimport {};\n",
            std::env::var("LIME_TEST_NODE_BIN").unwrap(),
            serde_json::to_string(&relay_url).unwrap()
        ),
    )
    .unwrap();
    std::fs::set_permissions(&relay_path, std::fs::Permissions::from_mode(0o700)).unwrap();
    let ledger_path = cwd.path().join("relay.jsonl");
    let mut command = CommandBuilder::new(std::env::var_os("LIME_TEST_CLI_BIN").unwrap());
    command.args([
        "tui",
        "--app-server",
        relay_path.to_str().unwrap(),
        "--model",
        "form-model",
        "--provider",
        &provider,
    ]);
    for argument in [
        "--data-dir".to_string(),
        cwd.path().join("data").to_string_lossy().into_owned(),
        "--app-data-dir".into(),
        cwd.path().join("app-data").to_string_lossy().into_owned(),
    ] {
        command.arg(format!("--app-server-arg={argument}"));
    }
    command.cwd(cwd.path());
    command.env("TERM", "xterm-256color");
    command.env("LIME_LOCALE", "en-US");
    command.env("LIME_CONFIG_PATH", cwd.path().join("config.yaml"));
    command.env("LIME_TEST_MCP_RELAY_LEDGER", &ledger_path);
    let pair = native_pty_system()
        .openpty(PtySize {
            rows: 24,
            cols: 100,
            pixel_width: 0,
            pixel_height: 0,
        })
        .unwrap();
    let mut reader = pair.master.try_clone_reader().unwrap();
    let writer = pair.master.take_writer().unwrap();
    let child = pair.slave.spawn_command(command).unwrap();
    drop(pair.slave);
    let (tx, output) = mpsc::channel();
    let reader = std::thread::spawn(move || {
        let mut bytes = [0; 8192];
        while let Ok(count) = reader.read(&mut bytes) {
            if count == 0 || tx.send(bytes[..count].to_vec()).is_err() {
                break;
            }
        }
    });
    let mut pty = Pty {
        child,
        writer,
        output,
        parser: vt100::Parser::new(24, 100, 0),
        trace: Vec::new(),
        ledger_path: ledger_path.clone(),
    };
    pty.wait("first field", |screen| {
        screen.contents().contains("first *")
    });
    let first = format!("/model\t@parser\n{}\nMCP_PTY_TAIL", "界🙂".repeat(501));
    let placeholder = Locale::EnUs.pasted_content_label(first.chars().count());
    pty.write(first.replace('\n', "\r").as_bytes());
    pty.wait("raw atomic draft", |screen| {
        screen.contents().contains(&placeholder)
            && !screen.contents().contains("MCP_PTY_TAIL")
            && screen.contents().contains("first *")
    });
    pty.write(b"\x01\t");
    pty.wait("second field", |screen| {
        screen.contents().contains("second *")
    });
    pty.write(b"\x1b[200~second\x1b[201~\x1b[D\x1b[5~");
    pty.wait("restored first cursor", |screen| {
        screen.contents().contains(&placeholder) && screen.cursor_position().1 == 4
    });
    pty.write(b"\r");
    pty.wait("restored second draft", |screen| {
        screen.contents().contains("second *") && screen.contents().contains("second")
    });
    pty.write(b"\r");
    pty.wait("resolved form", |screen| {
        !screen.contents().contains("Complete the terminal form")
            && screen.contents().contains("Ask Lime to do anything")
    });
    pty.write(b"\x04");
    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        if let Some(status) = pty.child.try_wait().unwrap() {
            assert!(status.success());
            break;
        }
        assert!(Instant::now() < deadline, "MCP TUI did not exit");
        if let Ok(bytes) = pty.output.recv_timeout(Duration::from_millis(20)) {
            pty.trace.extend(bytes);
        }
    }
    reader.join().unwrap();
    for bytes in pty.output.try_iter() {
        pty.trace.extend(bytes);
    }
    assert!(pty.trace.windows(8).any(|bytes| bytes == b"\x1b[?1049h"));
    assert!(pty.trace.windows(8).any(|bytes| bytes == b"\x1b[?1049l"));
    let ledger = std::fs::read_to_string(ledger_path)
        .unwrap()
        .lines()
        .map(|line| serde_json::from_str::<Value>(line).unwrap())
        .collect::<Vec<_>>();
    let request = ledger
        .iter()
        .find(|entry| entry["message"]["method"] == "mcpServer/elicitation/request")
        .unwrap();
    let id = &request["message"]["id"];
    let responses = ledger
        .iter()
        .filter(|entry| entry["direction"] == "client" && &entry["message"]["id"] == id)
        .collect::<Vec<_>>();
    assert_eq!(responses.len(), 1);
    let expected = json!({"action": "accept", "content": {"first": first, "second": "second"}});
    assert_eq!(responses[0]["message"]["result"], expected);
    assert!(!ledger
        .iter()
        .any(|entry| entry["message"]["method"] == "turn/start"));
    let tool = ledger
        .iter()
        .find(|entry| {
            entry["direction"] == "server" && entry["message"]["id"] == "mcp-pty-tool-call"
        })
        .unwrap();
    assert_eq!(tool["message"]["result"]["structuredContent"], expected);
    let thread_id = request["message"]["params"]["threadId"].as_str().unwrap();
    let session = super::stdio_tests::connect(cwd.path()).await;
    let read = session
        .request_handle()
        .request_value(
            "thread/read",
            json!({"threadId": thread_id, "includeTurns": true}),
        )
        .await
        .unwrap();
    assert_eq!(read["thread"]["id"], thread_id);
    assert_eq!(read["thread"]["turns"], json!([]));
    session.shutdown().await.unwrap();
    eprintln!("PTY_MCP_FORM_OK thread={thread_id} transport=real-stdio raw=atomic drafts=restored response=complete exactly-once=true turns=none terminal=restored");
}
