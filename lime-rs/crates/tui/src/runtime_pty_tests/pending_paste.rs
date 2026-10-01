//! Real bracketed paste, atomic cursor/delete behavior and expanded canonical submission.

use super::*;

pub(super) fn prepare_submission(
    writer: &mut impl Write,
    output_rx: &mpsc::Receiver<Vec<u8>>,
    output: &mut String,
    ledger_path: &Path,
    prompt: &str,
) {
    let padded_prompt = format!("\u{3000}\n{prompt}\t \n");
    let label = format!("[Pasted Content {} chars]", padded_prompt.chars().count());
    let paste = format!("\x1b[200~{padded_prompt}\x1b[201~\x05");
    writer
        .write_all(paste.as_bytes())
        .expect("paste long Unicode draft");
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "long paste is folded in the composer",
        |screen| screen.contains(&label) && !screen.contains("PTY_LARGE_PASTE_BODY"),
    );
    let (row, column) =
        terminal_marker_position(output, &label).expect("atomic placeholder position");
    writer.write_all(b"\x1b[D").unwrap();
    writer.flush().unwrap();
    wait_for_cursor_position(output_rx, output, row, column, Duration::from_secs(10));
    writer.write_all(b"\x1b[C").unwrap();
    writer.flush().unwrap();
    wait_for_cursor_position(
        output_rx,
        output,
        row,
        column + label.len() as u16,
        Duration::from_secs(10),
    );
    writer
        .write_all(&[127])
        .expect("delete the entire atomic paste");
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "atomic backspace leaves the composer empty",
        |screen| screen.contains("› Ask Lime to do anything") && !screen.contains(&label),
    );
    let ledger = std::fs::read_to_string(ledger_path).unwrap_or_default();
    assert!(
        !ledger
            .lines()
            .filter_map(|line| serde_json::from_str::<serde_json::Value>(line).ok())
            .any(|entry| entry["kind"] == "turnStart" && entry["scenario"] == "large-paste"),
        "fold/move/delete must not start a canonical turn"
    );

    let actual_chars = agent_protocol::input::MAX_USER_INPUT_TEXT_CHARS + 1;
    let rejected_label = format!("[Pasted Content {actual_chars} chars]");
    let rejected = format!("\x1b[200~{}\x1b[201~", "界".repeat(actual_chars));
    writer
        .write_all(rejected.as_bytes())
        .expect("paste oversized Unicode draft");
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "oversized paste remains folded before validation",
        |screen| screen.contains(&rejected_label),
    );
    writer
        .write_all(b"\r")
        .expect("reject oversized expanded draft");
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "length rejection is visible and retains the original folded draft",
        |screen| {
            screen.contains(&rejected_label)
                && screen.contains("Message exceeds the maximum length")
        },
    );
    let ledger = std::fs::read_to_string(ledger_path).unwrap_or_default();
    assert!(
        !ledger
            .lines()
            .filter_map(|line| serde_json::from_str::<serde_json::Value>(line).ok())
            .any(|entry| entry["kind"] == "turnStart" && entry["scenario"] == "large-paste"),
        "rejected draft must never reach canonical turn/start"
    );
    writer
        .write_all(b"\x05\x7f")
        .expect("edit away rejected atomic payload");
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "rejected paste can be atomically deleted for a corrected retry",
        |screen| screen.contains("› Ask Lime to do anything") && !screen.contains(&rejected_label),
    );

    writer
        .write_all(paste.as_bytes())
        .expect("restore the long draft for canonical submission");
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "restored long paste is folded before submit",
        |screen| screen.contains(&label),
    );
    writer
        .write_all(b"\x03")
        .expect("cancel folded paste into structured local history");
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "Ctrl-C clears folded draft without losing its payload",
        |screen| screen.contains("› Ask Lime to do anything") && !screen.contains(&label),
    );
    writer
        .write_all(b"\x1b[A\x05")
        .expect("recall folded paste through real history navigation");
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "structured history restores folded payload before canonical submit",
        |screen| screen.contains(&label) && !screen.contains("PTY_LARGE_PASTE_BODY"),
    );
}
