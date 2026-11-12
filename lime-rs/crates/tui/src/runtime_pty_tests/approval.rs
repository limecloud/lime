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
    wait_for_compact_marker(
        output_rx,
        output,
        "reason: Allow terminal command?",
        Duration::from_secs(10),
    );
    println!("TUI_EXEC_APPROVAL_REASON_OK label=localized");
    let details_closed_at = output.len();
    writer
        .write_all(b"\x1b")
        .expect("close details without deciding approval");
    writer.flush().unwrap();
    // Only evidence emitted after ESC proves the details page actually closed; a stale
    // screen from before the details opened would otherwise release Enter too early.
    wait_for_marker_after(
        output_rx,
        output,
        details_closed_at,
        "f9 confirm · ctrl+x q cancel",
        Duration::from_secs(30),
    );
    assert!(!terminal_screen_text(output).contains("/ Approve command?"));
    writer
        .write_all(b"\r")
        .expect("old Enter binding does not approve");
    writer.flush().unwrap();
    terminal_observer::resize(output, 24, 14);
    master
        .resize(PtySize {
            rows: 24,
            cols: 14,
            pixel_width: 0,
            pixel_height: 0,
        })
        .expect("shrink approval viewport");
    // A coalesced or lost SIGWINCH under load would otherwise park this check for the
    // whole deadline; re-issue the resize while waiting instead of failing the gate.
    // Only output emitted after the resize can prove the narrow layout.
    const NARROW_FOOTER_CHECK: &str =
        "narrow approval footer keeps the configured accept key and whole cancel chord";
    let narrow_at = output.len();
    let narrow_deadline = Instant::now() + Duration::from_secs(45);
    let mut last_narrow_resize = Instant::now();
    loop {
        let recent = output.get(narrow_at..).unwrap_or_default();
        let screen = terminal_screen_text(recent);
        if screen.contains("f9 · ctrl+x q") && !screen.contains("Enter") && !screen.contains("Esc")
        {
            break;
        }
        let remaining = narrow_deadline.saturating_duration_since(Instant::now());
        assert!(
            !remaining.is_zero(),
            "timed out: {NARROW_FOOTER_CHECK}; screen: {screen}"
        );
        if last_narrow_resize.elapsed() >= Duration::from_secs(3) {
            // Re-issuing the same size produces no SIGWINCH; toggle the width so the
            // retry is observable even when the first resize event was coalesced.
            terminal_observer::resize(output, 24, 15);
            master
                .resize(PtySize {
                    rows: 24,
                    cols: 15,
                    pixel_width: 0,
                    pixel_height: 0,
                })
                .expect("widen the approval viewport for a resize retry");
            terminal_observer::resize(output, 24, 14);
            master
                .resize(PtySize {
                    rows: 24,
                    cols: 14,
                    pixel_width: 0,
                    pixel_height: 0,
                })
                .expect("re-issue narrow approval viewport");
            last_narrow_resize = Instant::now();
        }
        match output_rx.recv_timeout(Duration::from_millis(200)) {
            Ok(chunk) => output.push_str(&String::from_utf8_lossy(&chunk)),
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                panic!("PTY unavailable: {NARROW_FOOTER_CHECK}")
            }
        }
    }
    terminal_observer::resize(output, 24, 100);
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
