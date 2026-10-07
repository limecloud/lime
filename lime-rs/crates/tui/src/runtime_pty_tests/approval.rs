//! Fullscreen approval details must not decide the protected request.

use super::*;

pub(super) fn exercise_read_only_details(
    master: &dyn portable_pty::MasterPty,
    writer: &mut impl Write,
    output_rx: &mpsc::Receiver<Vec<u8>>,
    output: &mut String,
    ledger_path: &Path,
) {
    writer
        .write_all(b"\x01")
        .expect("open approval details with Ctrl-A");
    writer.flush().unwrap();
    wait_for_screen_marker(
        output_rx,
        output,
        "/ Approve command?",
        Duration::from_secs(10),
    );
    wait_for_screen_marker(
        output_rx,
        output,
        "printf tui-gate-b",
        Duration::from_secs(10),
    );
    writer
        .write_all(b"\x1b")
        .expect("close details without deciding approval");
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "approval choices restored after closing read-only details",
        |screen| {
            screen.contains("f9 confirm · ctrl+x q cancel")
                && !screen.contains("/ Approve command?")
        },
    );
    assert!(!terminal_screen_text(output).contains("/ Approve command?"));
    writer
        .write_all(b"\r")
        .expect("old Enter binding does not approve");
    writer.flush().unwrap();
    master
        .resize(PtySize {
            rows: 24,
            cols: 14,
            pixel_width: 0,
            pixel_height: 0,
        })
        .expect("shrink approval viewport");
    wait_for_screen(
        output_rx,
        output,
        "narrow approval footer keeps the configured accept key and whole cancel chord",
        |screen| {
            screen.contains("f9 · ctrl+x q") && !screen.contains("Enter") && !screen.contains("Esc")
        },
    );
    master
        .resize(PtySize {
            rows: 24,
            cols: 100,
            pixel_width: 0,
            pixel_height: 0,
        })
        .expect("restore approval viewport");
    wait_for_screen(
        output_rx,
        output,
        "approval controls expand after resize without deciding the request",
        |screen| screen.contains("f9 confirm · ctrl+x q cancel"),
    );
    let ledger = std::fs::read_to_string(ledger_path).expect("approval ledger");
    assert!(
        !ledger
            .lines()
            .filter_map(|line| serde_json::from_str::<serde_json::Value>(line).ok())
            .any(|entry| entry["scenario"] == "approval" && entry["kind"] == "actionRespond"),
        "details, unbound Enter and footer resize must not resolve the canonical request"
    );
}
