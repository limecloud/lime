//! Real PTY navigation observes the frozen rendered transcript and cancellation lifecycle.
//! Clipboard dispatch and native delivery are covered by the clipboard owner regressions.

use super::*;

pub(super) fn exercise(
    master: &dyn portable_pty::MasterPty,
    writer: &mut impl Write,
    output_rx: &mpsc::Receiver<Vec<u8>>,
    output: &mut String,
    ledger_path: &Path,
    prompt: &str,
) {
    writer.write_all(b"\x1b[200~/copy\x1b[201~\r").unwrap();
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "copy mode selects the whole canonical response",
        |screen| {
            screen.contains("Copy whole response")
                && screen.contains("PTY_COPY_QUOTE")
                && screen
                    .lines()
                    .last()
                    .is_some_and(|line| line.contains("enter copy") && line.contains("esc close"))
        },
    );
    writer.write_all(b"\x1b[A").unwrap();
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "copy mode navigates to the rendered Markdown table fence",
        |screen| {
            screen.contains("Copy code block")
                && screen.contains("PTY_COPY_TABLE")
                && !screen.contains("**PTY_COPY_TABLE**")
        },
    );
    writer.write_all(b"k").unwrap();
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "copy mode preserves quote identity",
        |screen| screen.contains("Copy blockquote") && screen.contains("PTY_COPY_QUOTE"),
    );
    writer.write_all(b"k").unwrap();
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "copy mode reveals the original code block",
        |screen| screen.contains("Copy code block") && screen.contains("PTY_COPY_CODE"),
    );
    terminal_observer::resize(output, 12, 24);
    master
        .resize(PtySize {
            rows: 12,
            cols: 24,
            pixel_width: 0,
            pixel_height: 0,
        })
        .unwrap();
    wait_for_screen(
        output_rx,
        output,
        "copy mode keeps the selected source after reflow",
        |screen| {
            screen.contains("Copy code block")
                && screen.contains("PTY_COPY_CODE")
                && screen
                    .lines()
                    .last()
                    .is_some_and(|line| line.contains("enter") && line.contains("esc"))
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
        .unwrap();
    writer.write_all(b"g").unwrap();
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "copy Home selects the literal user message",
        |screen| screen.contains("Copy user message") && screen.contains(prompt),
    );
    writer.write_all(b"G").unwrap();
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "copy End selects the frozen whole response",
        |screen| screen.contains("Copy whole response") && screen.contains("PTY_COPY_QUOTE"),
    );
    writer
        .write_all(b"\x1b[200~/model SHOULD_NOT_SUBMIT\x1b[201~")
        .unwrap();
    writer.flush().unwrap();
    writer.write_all(b"\x1b").unwrap();
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "copy cancellation returns to the untouched composer",
        |screen| {
            screen.contains("Ask Lime to do anything")
                && !screen.contains("Copy whole response")
                && !screen.contains("SHOULD_NOT_SUBMIT")
        },
    );
    exercise_status_copy(master, writer, output_rx, output, ledger_path);
    let starts = std::fs::read_to_string(ledger_path)
        .unwrap()
        .lines()
        .filter_map(|line| serde_json::from_str::<serde_json::Value>(line).ok())
        .filter(|entry| entry["scenario"] == "copy-mode" && entry["kind"] == "turnStart")
        .count();
    assert_eq!(
        starts, 1,
        "copy navigation and cancellation must not submit a canonical turn"
    );
    println!(
        "TUI_COPY_MODE_OK whole=source blocks=code,quote,table user=literal resize=frozen cancel=restored turns=once"
    );
}

fn exercise_status_copy(
    master: &dyn portable_pty::MasterPty,
    writer: &mut impl Write,
    output_rx: &mpsc::Receiver<Vec<u8>>,
    output: &mut String,
    ledger_path: &Path,
) {
    let thread_id = std::fs::read_to_string(ledger_path)
        .unwrap()
        .lines()
        .filter_map(|line| serde_json::from_str::<serde_json::Value>(line).ok())
        .find(|entry| entry["scenario"] == "copy-mode" && entry["kind"] == "turnStart")
        .and_then(|entry| entry["threadId"].as_str().map(str::to_owned))
        .expect("canonical copy-mode thread");
    writer.write_all(b"\x1b[200~/status\x1b[201~\r").unwrap();
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "status shows canonical facts before copying",
        |screen| {
            screen.contains("/ STATUS")
                && screen.contains("fixture-model")
                && screen.contains(&thread_id)
        },
    );
    writer.write_all(b"\x1b").unwrap();
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "status closes to the original composer",
        |screen| screen.contains("Ask Lime to do anything") && !screen.contains("/ STATUS"),
    );
    writer.write_all(b"\x1b[200~/copy\x1b[201~\r").unwrap();
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "status copy picker uses displayed canonical fields",
        |screen| {
            screen.contains("Copy to clipboard")
                && screen.contains("Whole status")
                && screen.contains("Directory")
                && screen.contains("Session ID")
                && screen.contains("fixture-model")
                && screen.contains(&thread_id)
        },
    );
    writer.write_all(b"\x1b[B").unwrap();
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "status copy navigation selects the model",
        |screen| screen.contains("› 2. Model") && screen.contains("fixture-model"),
    );
    terminal_observer::resize(output, 12, 24);
    master
        .resize(PtySize {
            rows: 12,
            cols: 24,
            pixel_width: 0,
            pixel_height: 0,
        })
        .unwrap();
    wait_for_screen(
        output_rx,
        output,
        "status copy selection survives narrow reflow",
        |screen| screen.contains("Copy to clipboard") && screen.contains("› 2. Model"),
    );
    terminal_observer::resize(output, 24, 100);
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
        "status copy resize restores complete field values",
        |screen| screen.contains("› 2. Model") && screen.contains(&thread_id),
    );
    writer
        .write_all(b"\x1b[200~SHOULD_NOT_SUBMIT\x1b[201~\x18q")
        .unwrap();
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "status copy cancellation restores composer without a new turn",
        |screen| {
            screen.contains("Ask Lime to do anything")
                && !screen.contains("Copy to clipboard")
                && !screen.contains("SHOULD_NOT_SUBMIT")
        },
    );
    println!(
        "TUI_STATUS_COPY_OK source=canonical-snapshot fields=model,directory,session navigation=shared resize=preserved cancel=restored turns=none"
    );
}
