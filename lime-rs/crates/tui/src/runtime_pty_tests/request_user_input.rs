//! Notes focus and selection are exercised through the real protected surface.

use super::*;

pub(super) fn exercise_notes_and_selection(
    writer: &mut impl Write,
    output_rx: &mpsc::Receiver<Vec<u8>>,
    output: &mut String,
    ledger_path: &Path,
) {
    writer
        .write_all(b"\x1b[B\t")
        .expect("select Safe and focus notes");
    writer.flush().unwrap();
    writer
        .write_all(b"\x1b[200~PTY_NOTES_KEYMAP\x1b[201~\x1b[23~\x1b[200~PTY_NOTES_SECOND\x1b[201~")
        .unwrap();
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "configured notes newline is a real focused editor action",
        |screen| {
            screen
                .lines()
                .any(|line| line.contains("PTY_NOTES_KEYMAP") && !line.contains("PTY_NOTES_SECOND"))
                && screen.lines().any(|line| {
                    line.contains("PTY_NOTES_SECOND") && !line.contains("PTY_NOTES_KEYMAP")
                })
        },
    );
    writer.write_all(b"\x11\r\x1b").unwrap();
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "notes chord cancellation does not submit or lose selected option",
        |screen| {
            screen.contains("› 2. Safe")
                && !screen.contains("PTY_NOTES_KEYMAP")
                && !screen.contains("PTY_NOTES_SECOND")
        },
    );
    writer.write_all(b"\t").unwrap();
    writer.flush().unwrap();
    let paste = format!("\x1b[200~{}PTY_NOTES_TAIL\x1b[201~", "prefix ".repeat(80));
    writer
        .write_all(paste.as_bytes())
        .expect("paste a long notes draft");
    writer.flush().unwrap();
    wait_for_screen_marker(output_rx, output, "PTY_NOTES_TAIL", Duration::from_secs(10));
    writer
        .write_all(b"\x1b")
        .expect("return to options without answering");
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "notes cleared and selected option retained",
        |screen| screen.contains("› 2. Safe") && !screen.contains("PTY_NOTES_TAIL"),
    );
    let ledger = std::fs::read_to_string(ledger_path).expect("user input ledger");
    assert!(
        !ledger
            .lines()
            .filter_map(|line| serde_json::from_str::<serde_json::Value>(line).ok())
            .any(|entry| entry["scenario"] == "user-input" && entry["kind"] == "actionRespond"),
        "notes focus/return must not resolve the canonical question"
    );
    writer
        .write_all(b"\t\x1b[200~PTY_NOTE_ANSWER\x1b[201~")
        .expect("add notes to selected answer");
    writer.flush().unwrap();
    wait_for_screen_marker(
        output_rx,
        output,
        "PTY_NOTE_ANSWER",
        Duration::from_secs(10),
    );
}
