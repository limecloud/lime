//! Real image-path paste, atomic editing, external editor and cold canonical Thread/Turn/Item.

use super::*;
use crate::app_server_session::AppServerSession;
use agent_protocol::TextElement;
use app_server_client::StdioTransportConfig;
use app_server_protocol::protocol::v2::{ThreadItem, TurnStatus, UserInput};
use base64::Engine;

pub(super) const EDITOR_TEXT: &str = "PTY_IMAGE_EDIT [Image #2] literal [Image #2]";

pub(super) fn prepare_submission(
    writer: &mut impl Write,
    output_rx: &mpsc::Receiver<Vec<u8>>,
    output: &mut String,
    ledger_path: &Path,
    cwd: &Path,
    prompt: &str,
) {
    let one = cwd.join("image one.png");
    let two = cwd.join("image two.png");
    for (path, color) in [(&one, [255, 0, 0, 255]), (&two, [0, 255, 0, 255])] {
        image::RgbaImage::from_pixel(1, 1, image::Rgba(color))
            .save(path)
            .unwrap();
        paste_path(writer, path);
    }
    wait_for_screen_marker(
        output_rx,
        output,
        "› [Image #1] [Image #2] ",
        Duration::from_secs(10),
    );
    writer.write_all(b"\x1b[D").unwrap();
    writer.flush().unwrap();
    let (row, column) = terminal_marker_position(output, "[Image #2]").unwrap();
    wait_for_cursor_position(output_rx, output, row, column + 10, Duration::from_secs(10));
    writer.write_all(&[127]).unwrap();
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "atomic image delete keeps first attachment",
        |screen| screen.contains("› [Image #1]  ") && !screen.contains("[Image #2]"),
    );
    paste_path(writer, &two);
    wait_for_screen_marker(output_rx, output, "[Image #2]", Duration::from_secs(10));
    writer
        .write_all(b"\x07")
        .expect("open real external editor over image draft");
    writer.flush().unwrap();
    external_editor::assert_preserved_screen_then_release(writer, output_rx, output, "[Image #2]");
    wait_for_screen(
        output_rx,
        output,
        "external edit keeps second image, renumbers only owned occurrence",
        |screen| screen.contains(&format!("› {prompt}")),
    );
    let (row, column) = terminal_marker_position(output, prompt).unwrap();
    external_editor::assert_editor_exit_and_reentry(output);
    wait_for_cursor_position(
        output_rx,
        output,
        row,
        column + prompt.len() as u16,
        Duration::from_secs(10),
    );
    writer.write_all(b"\x1b[D").unwrap();
    writer.flush().unwrap();
    wait_for_cursor_position(
        output_rx,
        output,
        row,
        column + prompt.len() as u16 - 1,
        Duration::from_secs(10),
    );
    writer.write_all(b"\x1b[C").unwrap();
    writer.flush().unwrap();
    wait_for_cursor_position(
        output_rx,
        output,
        row,
        column + prompt.len() as u16,
        Duration::from_secs(10),
    );
    writer
        .write_all(b"\x03")
        .expect("cancel structured image draft with Ctrl-C");
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "image draft cancelled without starting or interrupting a turn",
        |screen| screen.contains("› Ask Lime to do anything") && !screen.contains(prompt),
    );
    writer
        .write_all(b"\x1b[A\x05")
        .expect("recall complete image entry through real Up history");
    writer.flush().unwrap();
    wait_for_screen_marker(
        output_rx,
        output,
        &format!("› {prompt}"),
        Duration::from_secs(10),
    );
    let ledger = std::fs::read_to_string(ledger_path).unwrap_or_default();
    assert!(
        !ledger
            .lines()
            .filter_map(|line| serde_json::from_str::<serde_json::Value>(line).ok())
            .any(|entry| entry["kind"] == "turnStart" && entry["scenario"] == "images"),
        "image paste/delete/external edit/history must not start a canonical turn"
    );
    assert!(
        output.contains("EDITOR_JOB_CONTROL_OK"),
        "image editor must inherit the real PTY"
    );
}

fn paste_path(writer: &mut impl Write, path: &Path) {
    let url = url::Url::from_file_path(path).unwrap();
    writer
        .write_all(format!("\x1b[200~{url}\x1b[201~\x05").as_bytes())
        .unwrap();
    writer.flush().unwrap();
}

pub(super) fn assert_canonical_input(app_server: &Path, cwd: &Path, ledger: &Path, prompt: &str) {
    let entries = std::fs::read_to_string(ledger)
        .unwrap()
        .lines()
        .map(|line| serde_json::from_str::<serde_json::Value>(line).unwrap())
        .collect::<Vec<_>>();
    let starts = entries
        .iter()
        .filter(|entry| entry["kind"] == "turnStart" && entry["scenario"] == "images")
        .collect::<Vec<_>>();
    assert_eq!(
        starts.len(),
        1,
        "one real image submit must create exactly one canonical turn"
    );
    let start = starts[0];
    let thread_id = start["threadId"].as_str().unwrap();
    let turn_id = start["turnId"].as_str().unwrap();
    let image = &start["inputParts"][0]["Image"];
    assert_eq!(start["inputParts"].as_array().unwrap().len(), 2);
    assert_eq!(image["media_type"], "image/png");
    assert_eq!(
        image["provider_data"],
        format!(
            "data:image/png;base64,{}",
            base64::engine::general_purpose::STANDARD
                .encode(std::fs::read(cwd.join("image two.png")).unwrap())
        ),
        "only the retained second image's actual bytes reach runtime lowering"
    );
    let image_uri = image["uri"].as_str().expect("canonical sidecar image URI");
    assert!(image_uri.starts_with("sidecar://media/"));
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
            .expect("cold image evidence must initialize real stdio App Server");
            let mut thread = session
                .thread_read(thread_id, false)
                .await
                .expect("read canonical image thread")
                .thread;
            assert_eq!(thread.id, thread_id);
            thread.turns = crate::app_server_session::thread_turns_page_with_handle(
                session.request_handle(),
                thread_id,
                None,
            )
            .await
            .unwrap()
            .data
            .into_iter()
            .rev()
            .collect();
            let turn = thread
                .turns
                .iter()
                .find(|turn| turn.id == turn_id)
                .expect("same backend turn identity");
            assert_eq!(turn.status, TurnStatus::Completed);
            let messages = turn
                .items
                .iter()
                .filter_map(|item| match item {
                    ThreadItem::UserMessage { id, content, .. } => Some((id, content)),
                    _ => None,
                })
                .collect::<Vec<_>>();
            assert_eq!(messages.len(), 1, "exactly one canonical user item");
            assert!(!messages[0].0.is_empty());
            assert_eq!(
                messages[0].1,
                &vec![
                    UserInput::Image {
                        detail: None,
                        url: image_uri.into()
                    },
                    UserInput::Text {
                        text: prompt.into(),
                        text_elements: vec![TextElement::new(15..25, Some("[Image #1]".into()))]
                    },
                ]
            );
            session.shutdown().await.unwrap();
        });
}
