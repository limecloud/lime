//! Selected skill identity survives real keyboard editing, recall and canonical cold read.

use super::*;
use crate::app_server_session::AppServerSession;
use agent_protocol::TextElement;
use app_server_client::StdioTransportConfig;
use app_server_protocol::protocol::v2::{ThreadItem, TurnStatus, UserInput};

pub(super) fn prepare_submission(
    writer: &mut impl Write,
    output_rx: &mpsc::Receiver<Vec<u8>>,
    output: &mut String,
    ledger: &Path,
    prompt: &str,
) {
    write_typed_text(writer, b"PTY_SKILL $gate-skill-");
    writer.write_all(b"\x05").unwrap();
    writer.flush().unwrap();
    wait_for_screen_marker(
        output_rx,
        output,
        "› gate-skill-00",
        Duration::from_secs(10),
    );
    writer.write_all(b"\x1b[A").unwrap();
    writer.flush().unwrap();
    wait_for_screen_marker(
        output_rx,
        output,
        "› gate-skill-09",
        Duration::from_secs(10),
    );
    writer.write_all(b"\t").unwrap();
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "selected skill becomes an atomic draft token",
        |screen| screen.contains(&format!("› {prompt}")) && !screen.contains("[Skill]"),
    );
    let (row, column) = terminal_marker_position(output, "$gate-skill-09").unwrap();
    writer.write_all(b"\x7f\x1b[D").unwrap();
    writer.flush().unwrap();
    wait_for_cursor_position(output_rx, output, row, column, Duration::from_secs(10));
    writer.write_all(b"\x1b[C").unwrap();
    writer.flush().unwrap();
    wait_for_cursor_position(output_rx, output, row, column + 14, Duration::from_secs(10));
    writer.write_all(b"\x7f").unwrap();
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "atomic delete removes only the selected skill",
        |screen| screen.contains("› PTY_SKILL") && !screen.contains("$gate-skill-09"),
    );
    writer.write_all(b"\x05\x15").unwrap();
    writer.flush().unwrap();
    wait_for_screen_marker(
        output_rx,
        output,
        "Ask Lime to do anything",
        Duration::from_secs(10),
    );
    write_typed_text(writer, b"PTY_SKILL $gate-skill-09");
    writer.write_all(b"\x05").unwrap();
    writer.flush().unwrap();
    wait_for_screen_marker(
        output_rx,
        output,
        "› gate-skill-09",
        Duration::from_secs(10),
    );
    writer.write_all(b"\t").unwrap();
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "selected skill restored before cancellation",
        |screen| screen.contains(&format!("› {prompt}")) && !screen.contains("[Skill]"),
    );
    writer.write_all(b"\x7f\x03").unwrap();
    writer.flush().unwrap();
    wait_for_screen_marker(
        output_rx,
        output,
        "Ask Lime to do anything",
        Duration::from_secs(10),
    );
    writer.write_all(b"\x1b[A\x05").unwrap();
    writer.flush().unwrap();
    wait_for_screen_marker(
        output_rx,
        output,
        &format!("› {prompt}"),
        Duration::from_secs(10),
    );
    assert!(
        !std::fs::read_to_string(ledger)
            .unwrap_or_default()
            .lines()
            .filter_map(|line| serde_json::from_str::<serde_json::Value>(line).ok())
            .any(|entry| entry["kind"] == "turnStart" && entry["scenario"] == "skills"),
        "skill select/delete/recall must not submit a canonical turn"
    );
}

pub(super) fn assert_canonical_input(app_server: &Path, cwd: &Path, ledger: &Path, prompt: &str) {
    let entries = std::fs::read_to_string(ledger)
        .unwrap()
        .lines()
        .map(|line| serde_json::from_str::<serde_json::Value>(line).unwrap())
        .collect::<Vec<_>>();
    let starts = entries
        .iter()
        .filter(|entry| entry["kind"] == "turnStart" && entry["scenario"] == "skills")
        .collect::<Vec<_>>();
    assert_eq!(starts.len(), 1, "exactly one skill turn");
    let start = starts[0];
    let thread_id = start["threadId"].as_str().unwrap();
    let turn_id = start["turnId"].as_str().unwrap();
    let path = cwd
        .join(".agents/skills/gate-skill-09/SKILL.md")
        .canonicalize()
        .unwrap()
        .to_string_lossy()
        .into_owned();
    let input = vec![
        UserInput::Text {
            text: prompt.into(),
            text_elements: vec![TextElement::new(10..24, Some("$gate-skill-09".into()))],
        },
        UserInput::Skill {
            name: "gate-skill-09".into(),
            path: path.clone(),
        },
    ];
    assert_eq!(
        start["inputParts"],
        serde_json::json!([
            {"Text": {"text": prompt, "text_elements": [{"byteRange": {"start": 10, "end": 24}, "placeholder": "$gate-skill-09"}]}},
            {"Skill": {"name": "gate-skill-09", "path": path}}
        ]),
        "selected skill path and TextElement reach real runtime"
    );
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap()
        .block_on(async {
            let session = AppServerSession::connect(StdioTransportConfig {
                app_server_bin: app_server.into(),
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
            let thread = session.thread_read(thread_id, true).await.unwrap().thread;
            assert_eq!(thread.id, thread_id);
            let turn = thread.turns.iter().find(|turn| turn.id == turn_id).unwrap();
            assert_eq!(turn.status, TurnStatus::Completed);
            let messages = turn
                .items
                .iter()
                .filter_map(|item| match item {
                    ThreadItem::UserMessage { id, content, .. } => Some((id, content)),
                    _ => None,
                })
                .collect::<Vec<_>>();
            assert_eq!(messages.len(), 1);
            assert!(!messages[0].0.is_empty());
            assert_eq!(
                messages[0].1, &input,
                "same canonical user item retains selected skill path"
            );
            let history = session.read_prompt_history(10).await.unwrap();
            let encoded = format!("PTY_SKILL [$gate-skill-09]({path})");
            assert!(
                history.data.iter().any(|entry| entry.thread_id == thread_id && entry.text == encoded),
                "cold prompt history preserves the selected path link; expected={encoded:?}; actual={:?}", history.data
            );
            let decoded = crate::mention_codec::decode_history_mentions(&encoded);
            assert_eq!(decoded.text, prompt);
            assert_eq!(decoded.mentions[0].path, path);
            session.shutdown().await.unwrap();
        });
}
