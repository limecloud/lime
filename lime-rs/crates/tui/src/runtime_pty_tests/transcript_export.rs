//! Export prompts edit surface state while retaining the canonical completed transcript.

use super::*;

pub(super) fn exercise_destination_filename_and_cancel(
    master: &dyn portable_pty::MasterPty,
    writer: &mut impl Write,
    output_rx: &mpsc::Receiver<Vec<u8>>,
    output: &mut String,
    ledger_path: &Path,
    completed_text: &str,
) {
    writer
        .write_all(b"\x1b[200~/export\x1b[201~\x05\r")
        .expect("open canonical export picker");
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "export destination uses configured controls and keeps the canonical transcript visible",
        |screen| {
            screen.contains("Export conversation")
                && screen.contains("Copy to clipboard")
                && screen.contains("Save to file")
                && screen.contains("f9 select · ctrl+x q back")
                && screen.contains(completed_text)
        },
    );
    master
        .resize(PtySize {
            rows: 24,
            cols: 14,
            pixel_width: 0,
            pixel_height: 0,
        })
        .expect("shrink export destination footer");
    wait_for_screen(
        output_rx,
        output,
        "narrow export destination displays the complete configured cancel chord",
        |screen| {
            screen
                .lines()
                .last()
                .is_some_and(|line| line.trim() == "ctrl+x q")
        },
    );
    master
        .resize(PtySize {
            rows: 24,
            cols: 100,
            pixel_width: 0,
            pixel_height: 0,
        })
        .expect("restore export destination footer");
    wait_for_screen(
        output_rx,
        output,
        "export destination expands its configured controls after resize",
        |screen| screen.contains("f9 select · ctrl+x q back") && screen.contains(completed_text),
    );
    writer
        .write_all(b"\r\x1b[B\x1b[20~")
        .expect("unbound Enter leaves destination open before Down and configured F9");
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "configured F9 opens the filename prompt on the same canonical transcript",
        |screen| {
            screen.contains("Save conversation")
                && screen.contains("codex-session-")
                && screen.contains(completed_text)
        },
    );
    writer
        .write_all(b"\x11k")
        .expect("configured editor chord clears the export filename");
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "export filename consumes the current editor chord without submitting",
        |screen| {
            screen.contains("Save conversation")
                && screen.contains("Choose a Markdown filename")
                && !screen.contains("codex-session-")
                && screen.contains(completed_text)
        },
    );
    writer
        .write_all(b"\x1b[200~PTY_EXPORT_NAME.md\x1b[201~")
        .expect("paste into the real filename editor");
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "edited export filename is visible without a new canonical turn",
        |screen| {
            screen.contains("PTY_EXPORT_NAME.md")
                && screen.contains("Save conversation")
                && screen.contains(completed_text)
        },
    );
    let multiline = (0..12)
        .map(|index| format!("PTY_EXPORT_ROW_{index:02}_界👩‍💻"))
        .collect::<Vec<_>>()
        .join("\n");
    writer
        .write_all(format!("\x11k\x1b[200~{multiline}\x1b[201~").as_bytes())
        .unwrap();
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "multiline export prompt grows and scrolls to the visible tail",
        |screen| {
            screen.contains("Save conversation")
                && screen.contains("PTY_EXPORT_ROW_11_")
                && !screen.contains("PTY_EXPORT_ROW_00_")
        },
    );
    master
        .resize(PtySize {
            rows: 24,
            cols: 24,
            pixel_width: 0,
            pixel_height: 0,
        })
        .unwrap();
    wait_for_screen(
        output_rx,
        output,
        "export prompt keeps its cursor tail after narrow resize",
        |screen| screen.contains("PTY_EXPORT_ROW_11_") && screen.contains("Save conversation"),
    );
    master
        .resize(PtySize {
            rows: 24,
            cols: 100,
            pixel_width: 0,
            pixel_height: 0,
        })
        .unwrap();
    wait_for_screen(
        output_rx,
        output,
        "export prompt reflows without dropping pasted newlines",
        |screen| {
            screen.contains("PTY_EXPORT_ROW_11_界👩‍💻") && screen.contains("PTY_EXPORT_ROW_10_界👩‍💻")
        },
    );
    writer.write_all(b"\x1b[A".repeat(12).as_slice()).unwrap();
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "export editor navigation scrolls back to the first pasted row",
        |screen| screen.contains("PTY_EXPORT_ROW_00_") && !screen.contains("PTY_EXPORT_ROW_11_"),
    );
    writer
        .write_all(b"\x1b")
        .expect("return from filename to destination");
    writer.flush().unwrap();
    wait_for_screen_marker(
        output_rx,
        output,
        "Export conversation",
        Duration::from_secs(10),
    );
    writer
        .write_all(b"\x18q")
        .expect("cancel export using the configured list chord");
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "export cancel restores the canonical transcript and main composer",
        |screen| {
            !screen.contains("Export conversation")
                && !screen.contains("Save conversation")
                && screen.contains(completed_text)
                && screen.contains("Ask Lime to do anything")
        },
    );
    writer.write_all(b"\x1b[200~/vim\x1b[201~\r").unwrap();
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "export fixture enables the current Vim editor",
        |screen| screen.contains("Vim: Normal") && screen.contains("Ask Lime to do anything"),
    );
    writer.write_all(b"\x1b[200~/export\x1b[201~\r2").unwrap();
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "export prompt inherits Vim in Insert mode",
        |screen| {
            screen.contains("Save conversation")
                && screen.contains("Vim: Insert")
                && screen.contains("esc normal mode")
        },
    );
    cursor_style::wait_for_style(
        output_rx,
        output,
        6,
        "export Vim Insert emits a steady bar cursor",
    );
    writer.write_all(b"\x1b").unwrap();
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "export Insert Escape switches to Normal without closing the prompt",
        |screen| {
            screen.contains("Save conversation")
                && screen.contains("Vim: Normal")
                && screen.contains("esc back")
        },
    );
    cursor_style::wait_for_style(
        output_rx,
        output,
        0,
        "export Vim Normal restores the user's default cursor",
    );
    writer.write_all(b"z").unwrap();
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "export pending Vim chord updates the actual Escape hint",
        |screen| {
            screen.contains("Save conversation")
                && screen.contains("Vim: Normal")
                && screen.contains("esc normal mode")
        },
    );
    writer.write_all(b"\x1b").unwrap();
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "export pending Vim chord owns Escape before prompt navigation",
        |screen| {
            screen.contains("Save conversation")
                && screen.contains("Vim: Normal")
                && screen.contains("esc back")
        },
    );
    writer.write_all(b"\x1b").unwrap();
    writer.flush().unwrap();
    wait_for_screen_marker(
        output_rx,
        output,
        "Export conversation",
        Duration::from_secs(10),
    );
    writer.write_all(b"\x18q\x1b[200~/vim\x1b[201~\r").unwrap();
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "export Vim cancellation restores the composer mode and canonical transcript",
        |screen| {
            !screen.contains("Vim:")
                && !screen.contains("Save conversation")
                && !screen.contains("Export conversation")
                && screen.contains(completed_text)
                && screen.contains("Ask Lime to do anything")
        },
    );
    let starts = std::fs::read_to_string(ledger_path)
        .expect("canonical export ledger")
        .lines()
        .filter_map(|line| serde_json::from_str::<serde_json::Value>(line).ok())
        .filter(|entry| entry["scenario"] == "complete" && entry["kind"] == "turnStart")
        .count();
    assert_eq!(
        starts, 1,
        "export selection, editing and cancellation must not start a canonical turn"
    );
}
