//! Esc browsing and prompt reopening cross a real PTY and the shared canonical revert boundary.

use super::*;

pub(super) fn exercise_previous_prompt(
    writer: &mut Box<dyn Write + Send>,
    rx: &mpsc::Receiver<Vec<u8>>,
    output: &mut String,
    prompt: &str,
    completed_text: &str,
) {
    eprintln!("TUI_BACKTRACK phase=prime");
    writer.write_all(b"\x1b[1;3F").unwrap();
    writer.flush().unwrap();
    wait_for_screen(
        rx,
        output,
        "main transcript follows latest before backtracking",
        |screen| screen.contains("Ask Lime to do anything") && screen.contains(completed_text),
    );
    writer.write_all(b"\x1b").unwrap();
    writer.flush().unwrap();
    wait_for_screen_marker(
        rx,
        output,
        "esc again to edit previous message",
        Duration::from_secs(10),
    );
    writer.write_all(b"\x1b").unwrap();
    writer.flush().unwrap();
    wait_for_screen(
        rx,
        output,
        "canonical prompt browsing and rewind controls",
        |screen| {
            screen.contains("Browsing transcript")
                && screen.contains("rewind")
                && screen.contains(prompt)
        },
    );
    writer.write_all(b"\x1b[D\x1b[C").unwrap();
    writer.flush().unwrap();
    writer.write_all(&[20]).unwrap();
    writer.flush().unwrap();
    wait_for_screen(
        rx,
        output,
        "configured details key keeps prompt browsing active",
        |screen| screen.contains("Browsing transcript") && screen.contains(prompt),
    );
    writer.write_all(b"\x1b").unwrap();
    writer.flush().unwrap();
    wait_for_screen(
        rx,
        output,
        "cancel preserves canonical output and original empty composer",
        |screen| {
            !screen.contains("Browsing transcript")
                && screen.contains("Ask Lime to do anything")
                && screen.contains(completed_text)
        },
    );
    writer.write_all(b"\x1b").unwrap();
    writer.flush().unwrap();
    wait_for_screen_marker(
        rx,
        output,
        "esc again to edit previous message",
        Duration::from_secs(10),
    );
    writer.write_all(b"\x1b").unwrap();
    writer.flush().unwrap();
    wait_for_screen_marker(rx, output, "Browsing transcript", Duration::from_secs(10));
    writer.write_all(b"\r").unwrap();
    writer.flush().unwrap();
    wait_for_screen(
        rx,
        output,
        "revert replaces history and restores the selected typed prompt",
        |screen| {
            !screen.contains("Browsing transcript")
                && !screen.contains(completed_text)
                && screen.contains(prompt)
                && !screen.contains("Loading previous messages")
        },
    );
    // Read-only UI verification must not accidentally send the reopened prompt as another Turn.
    writer.write_all(&[3]).unwrap();
    writer.flush().unwrap();
    wait_for_screen_marker(
        rx,
        output,
        "Ask Lime to do anything",
        Duration::from_secs(10),
    );
    eprintln!("TUI_BACKTRACK phase=restored");
}

pub(super) fn assert_cold_canonical_history(app_server_bin: &Path, cwd: &Path, ledger_path: &Path) {
    use crate::app_server_session::{thread_turns_page_with_handle, AppServerSession};
    use app_server_client::StdioTransportConfig;
    let ledger = std::fs::read_to_string(ledger_path).unwrap();
    let entries = ledger
        .lines()
        .map(|line| serde_json::from_str::<serde_json::Value>(line).unwrap())
        .collect::<Vec<_>>();
    let starts = entries
        .iter()
        .filter(|entry| entry["kind"] == "turnStart")
        .collect::<Vec<_>>();
    assert_eq!(
        starts.len(),
        1,
        "browsing/revert must not create a new canonical Turn"
    );
    let thread_id = starts[0]["threadId"].as_str().unwrap().to_string();
    let original_turn = starts[0]["turnId"].as_str().unwrap().to_string();
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap()
        .block_on(async {
            let mut session = AppServerSession::connect(StdioTransportConfig {
                app_server_bin: app_server_bin.to_path_buf(),
                args: vec![
                    "--stdio".into(),
                    "--backend".into(),
                    "unavailable".into(),
                    "--data-dir".into(),
                    cwd.join("data").into_os_string(),
                    "--app-data-dir".into(),
                    cwd.join("app-data").into_os_string(),
                ],
            })
            .await
            .unwrap();
            let read = session.thread_read(&thread_id, false).await.unwrap();
            assert_eq!(read.thread.id, thread_id);
            let page = thread_turns_page_with_handle(session.request_handle(), &thread_id, None)
                .await
                .unwrap();
            assert!(
                page.data.is_empty(),
                "removed turn {original_turn} survived cold canonical history: {page:?}"
            );
            let resumed = session.resume_thread(thread_id.clone()).await.unwrap();
            assert_eq!(resumed.thread.id, thread_id);
            assert!(resumed.thread.turns.is_empty());
            session.shutdown().await.unwrap();
        });
    eprintln!("TUI_BACKTRACK_OK thread={thread_id} removed-turn={original_turn} cold-resume=ok new-turns=0");
}
