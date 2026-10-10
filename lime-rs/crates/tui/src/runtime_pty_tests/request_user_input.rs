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
        .write_all("\ta界🙂".as_bytes())
        .expect("type an ASCII prefix followed by immediate IME characters");
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "held ASCII and immediate IME characters retain notes input order",
        |screen| screen.contains("a界🙂") && screen.contains("Question 1/2"),
    );
    writer.write_all(b"\x1b").unwrap();
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "mixed typing cancellation retains the selected option",
        |screen| screen.contains("› 2. Safe") && !screen.contains("a界🙂"),
    );
    eprintln!("TUI_NOTES_IME_ORDER_OK ascii-prefix=preserved unicode=immediate cancel=explicit");
    let burst = format!(
        "/model\t@parser\n{}\nPTY_NOTES_BURST_TAIL",
        "界🙂".repeat(501)
    );
    let burst_label = crate::locale::Locale::EnUs.pasted_content_label(burst.chars().count());
    writer
        .write_all(format!("\t{}", burst.replace('\n', "\r")).as_bytes())
        .expect("paste raw rapid keys without bracketed-paste framing");
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "unbracketed notes paste stays atomic with Enter and Tab in the draft",
        |screen| {
            screen.contains(&burst_label)
                && !screen.contains("PTY_NOTES_BURST_TAIL")
                && !screen.contains("Add a follow-up note")
                && !screen.contains("[Skill]")
        },
    );
    let ledger = std::fs::read_to_string(ledger_path).expect("unbracketed notes ledger");
    assert!(
        !ledger
            .lines()
            .filter_map(|line| serde_json::from_str::<serde_json::Value>(line).ok())
            .any(|entry| entry["scenario"] == "user-input" && entry["kind"] == "actionRespond"),
        "raw paste Enter and Tab must not accept or resolve the question"
    );
    writer.write_all(b"\x1b").unwrap();
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "raw paste cancellation retains the selected option without accepting",
        |screen| screen.contains("› 2. Safe") && !screen.contains(&burst_label),
    );
    eprintln!(
        "TUI_NOTES_BURST_OK framing=raw enter-tab=draft idle=atomic cancel=explicit response=none"
    );
    let answer = std::env::var("LIME_TEST_TERMINAL_NOTES_ANSWER").expect("canonical notes fixture");
    let label = crate::locale::Locale::EnUs.pasted_content_label(answer.chars().count());
    writer
        .write_all(format!("\t{}", answer.replace('\n', "\r")).as_bytes())
        .expect("add a long raw Unicode note to the selected answer");
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "long notes stay compact in the actual editor without command UI",
        |screen| {
            screen.contains(&label)
                && !screen.contains("PTY_NOTE_ANSWER")
                && !screen.contains("/model")
                && !screen.contains("[Skill]")
        },
    );
    let ledger = std::fs::read_to_string(ledger_path).expect("long notes ledger");
    assert!(
        !ledger
            .lines()
            .filter_map(|line| serde_json::from_str::<serde_json::Value>(line).ok())
            .any(|entry| entry["scenario"] == "user-input" && entry["kind"] == "actionRespond"),
        "long notes remain a draft until explicit acceptance"
    );
    eprintln!("TUI_NOTES_PASTE_OK compact=atomic unicode=preserved answer=expanded commands=literal submit=explicit");
    writer.write_all(b"\r").unwrap();
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "accepted first note advances to the freeform follow-up",
        |screen| screen.contains("Add a follow-up note") && !screen.contains(&label),
    );
    let followup = std::env::var("LIME_TEST_TERMINAL_FOLLOWUP_ANSWER").expect("follow-up fixture");
    writer
        .write_all(format!("\x1b[200~{followup}\x1b[201~\x1b[D").as_bytes())
        .unwrap();
    writer.flush().unwrap();
    wait_for_screen_marker(output_rx, output, &followup, Duration::from_secs(10));
    let (row, column) = terminal_marker_position(output, &followup).unwrap();
    wait_for_cursor_position(
        output_rx,
        output,
        row,
        column + followup.len() as u16 - 1,
        Duration::from_secs(10),
    );
    writer.write_all(b"\x1b[5~").unwrap();
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "returning to the accepted question restores its atomic note and selected option",
        |screen| screen.contains(&label) && screen.contains("Safe") && !screen.contains(&followup),
    );
    let (row, column) = terminal_marker_position(output, &label).unwrap();
    wait_for_cursor_position(
        output_rx,
        output,
        row,
        column + label.len() as u16,
        Duration::from_secs(10),
    );
    writer.write_all(b"\x1b[200~ REVISED\x1b[201~\r").unwrap();
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "reaccepting the edited note preserves the follow-up draft",
        |screen| screen.contains(&followup) && !screen.contains(&label),
    );
    let (row, column) = terminal_marker_position(output, &followup).unwrap();
    wait_for_cursor_position(
        output_rx,
        output,
        row,
        column + followup.len() as u16 - 1,
        Duration::from_secs(10),
    );
    let ledger = std::fs::read_to_string(ledger_path).expect("revisited notes ledger");
    assert!(
        !ledger
            .lines()
            .filter_map(|line| serde_json::from_str::<serde_json::Value>(line).ok())
            .any(|entry| entry["scenario"] == "user-input" && entry["kind"] == "actionRespond"),
        "revisiting accepted notes must not resolve the request before the last explicit answer"
    );
    eprintln!("TUI_NOTES_REVISIT_OK accepted=rich cursor=restored revision=exact followup=preserved response=once");
    writer
        .write_all(b"\x1b[5~\x1b[200~ UNACCEPTED\x1b[201~")
        .unwrap();
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "editing an accepted note makes it unanswered",
        |screen| {
            screen.contains(&label)
                && screen.contains(" REVISED UNACCEPTED")
                && screen.contains("2 unanswered")
        },
    );
    writer.write_all(b"\x1b[6~\r").unwrap();
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "last answer opens unanswered confirmation without resolving",
        |screen| {
            screen.contains("Submit with unanswered questions?")
                && screen.contains("Submit with 1 unanswered question")
                && screen.contains("Go back")
                && !screen.contains(&followup)
        },
    );
    let ledger = std::fs::read_to_string(ledger_path).expect("unanswered confirmation ledger");
    assert!(
        !ledger
            .lines()
            .filter_map(|line| serde_json::from_str::<serde_json::Value>(line).ok())
            .any(|entry| entry["scenario"] == "user-input" && entry["kind"] == "actionRespond"),
        "unanswered confirmation must not submit a stale accepted answer"
    );
    writer.write_all(b"\x1b[B\x1b[20~").unwrap();
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "go back restores the first unanswered rich note",
        |screen| {
            screen.contains(&label)
                && screen.contains(" REVISED UNACCEPTED")
                && !screen.contains("Submit with unanswered questions?")
                && !screen.contains(&followup)
        },
    );
    let (row, column) = terminal_marker_position(output, &label).unwrap();
    wait_for_cursor_position(
        output_rx,
        output,
        row,
        column + label.len() as u16 + " REVISED UNACCEPTED".len() as u16,
        Duration::from_secs(10),
    );
    writer
        .write_all(&[127].repeat(" UNACCEPTED".len()))
        .unwrap();
    writer.write_all(b"\r").unwrap();
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "explicitly reaccepting the first note preserves the accepted follow-up",
        |screen| {
            screen.contains(&followup) && !screen.contains(&label) && !screen.contains("unanswered")
        },
    );
    let (row, column) = terminal_marker_position(output, &followup).unwrap();
    wait_for_cursor_position(
        output_rx,
        output,
        row,
        column + followup.len() as u16 - 1,
        Duration::from_secs(10),
    );
    eprintln!("TUI_NOTES_UNANSWERED_OK edited=uncommitted confirm=explicit return=first draft=rich cursor=restored response=once");
}
