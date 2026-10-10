//! Root selection exercises the real modal, not synthetic child-agent liveness.

use super::*;

pub(super) fn exercise_open_cancel_and_current_root(
    master: &dyn portable_pty::MasterPty,
    writer: &mut impl Write,
    output_rx: &mpsc::Receiver<Vec<u8>>,
    output: &mut String,
    ledger_path: &Path,
    completed_text: &str,
) {
    let ledger = std::fs::read_to_string(ledger_path).expect("canonical completed turn ledger");
    let thread_id = ledger
        .lines()
        .filter_map(|line| serde_json::from_str::<serde_json::Value>(line).ok())
        .find(|entry| entry["scenario"] == "complete" && entry["kind"] == "turnStart")
        .and_then(|entry| entry["threadId"].as_str().map(ToOwned::to_owned))
        .expect("canonical root thread id");
    for cancel in [true, false] {
        writer
            .write_all(b"\x1b[200~/subagents\x1b[201~\x05\r")
            .expect("open canonical subagents");
        writer.flush().unwrap();
        wait_for_screen(
            output_rx,
            output,
            "bottom subagents current root and configured controls",
            |screen| {
                screen.contains("Subagents")
                    && screen.contains("› 1. • Main [default] (current)")
                    && screen.contains(&thread_id)
                    && screen.contains("f9 select · ctrl+x q back")
            },
        );
        if cancel {
            terminal_observer::resize(output, 24, 16);
            master
                .resize(PtySize {
                    rows: 24,
                    cols: 16,
                    pixel_width: 0,
                    pixel_height: 0,
                })
                .expect("shrink subagents footer viewport");
            wait_for_screen(
                output_rx,
                output,
                "narrow subagents footer selects a whole cancel chord instead of merging actions",
                |screen| {
                    screen.contains("Subagents")
                        && screen
                            .lines()
                            .last()
                            .is_some_and(|line| line.trim() == "ctrl+x q")
                },
            );
            terminal_observer::resize(output, 24, 100);
            master
                .resize(PtySize {
                    rows: 24,
                    cols: 100,
                    pixel_width: 0,
                    pixel_height: 0,
                })
                .expect("restore subagents footer viewport");
            wait_for_screen(
                output_rx,
                output,
                "subagents footer expands after resize without changing the canonical root",
                |screen| {
                    screen.contains("f9 select · ctrl+x q back") && screen.contains(&thread_id)
                },
            );
        }
        writer
            .write_all(b"\x04\x15")
            .expect("configured subagents page keys");
        writer.flush().unwrap();
        if cancel {
            writer
                .write_all(b"\x18q")
                .expect("configured subagents chord cancel");
        } else {
            writer
                .write_all(b"\x1b[20~")
                .expect("configured F9 selects canonical current root");
        }
        writer.flush().unwrap();
        wait_for_screen(
            output_rx,
            output,
            "canonical transcript restored after subagents",
            |screen| !screen.contains("Subagents") && screen.contains(completed_text),
        );
    }
    let ledger = std::fs::read_to_string(ledger_path).expect("subagents turn ledger");
    let starts = ledger
        .lines()
        .filter_map(|line| serde_json::from_str::<serde_json::Value>(line).ok())
        .filter(|entry| entry["scenario"] == "complete" && entry["kind"] == "turnStart")
        .count();
    assert_eq!(
        starts, 1,
        "subagents open/cancel/current root must not submit a canonical turn"
    );
}
