//! Real root/background-thread handoff keeps folded drafts, cursor and atomic editing intact.

use super::*;

const ROOT_NAME: &str = "Gate B root draft";
const CHILD_NAME: &str = "Gate B background";
const ROOT_SUFFIX: &str = " ROOT_TAIL";
const CHILD_SUFFIX: &str = " CHILD_TAIL";

fn paste_label(characters: usize) -> String {
    format!("[Pasted Content {characters} chars]")
}

fn assert_draft_cursor(
    output_rx: &mpsc::Receiver<Vec<u8>>,
    output: &mut String,
    label: &str,
    suffix: &str,
    other_suffix: &str,
) {
    wait_for_screen(
        output_rx,
        output,
        "same folded draft restored in composer",
        |screen| {
            screen.contains(&format!("› {label}{suffix}"))
                && !screen.contains(other_suffix)
                && !screen.contains("Agent command center")
        },
    );
    let (row, column) = terminal_marker_position(output, label).expect("restored paste position");
    wait_for_cursor_position(
        output_rx,
        output,
        row,
        column + (label.len() + suffix.len() - 2) as u16,
        Duration::from_secs(10),
    );
}

fn paste_draft(
    writer: &mut impl Write,
    output_rx: &mpsc::Receiver<Vec<u8>>,
    output: &mut String,
    repeats: usize,
    suffix: &str,
    other_suffix: &str,
) {
    let body = "界🙂".repeat(repeats);
    writer
        .write_all(format!("\x1b[200~{body}\x1b[201~\x05{suffix}\x1b[D\x1b[D").as_bytes())
        .expect("paste a folded Unicode draft and place cursor inside suffix");
    writer.flush().unwrap();
    assert_draft_cursor(
        output_rx,
        output,
        &paste_label(repeats * 2),
        suffix,
        other_suffix,
    );
}

fn open_center(writer: &mut impl Write, output_rx: &mpsc::Receiver<Vec<u8>>, output: &mut String) {
    writer
        .write_all(b"\x0e")
        .expect("configured Ctrl-N opens Agent Center over a live draft");
    writer.flush().unwrap();
    wait_for_screen_marker(
        output_rx,
        output,
        "Agent command center",
        Duration::from_secs(10),
    );
}

pub(super) fn prepare_root(
    writer: &mut impl Write,
    output_rx: &mpsc::Receiver<Vec<u8>>,
    output: &mut String,
    ledger_path: &Path,
) {
    paste_draft(writer, output_rx, output, 501, ROOT_SUFFIX, CHILD_SUFFIX);
    open_center(writer, output_rx, output);
    writer
        .write_all(b"\x18q")
        .expect("cancel center without altering root draft");
    writer.flush().unwrap();
    assert_draft_cursor(
        output_rx,
        output,
        &paste_label(1002),
        ROOT_SUFFIX,
        CHILD_SUFFIX,
    );
    open_center(writer, output_rx, output);
    wait_for_screen_marker(output_rx, output, "Untitled task", Duration::from_secs(10));
    writer.write_all(b"r").unwrap();
    writer.flush().unwrap();
    wait_for_screen_marker(output_rx, output, "Rename ›", Duration::from_secs(10));
    write_typed_text(writer, ROOT_NAME.as_bytes());
    writer
        .write_all(b"\x1b[20~")
        .expect("name the canonical root using configured F9");
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "root name applied, metadata input closed",
        |screen| screen.contains(ROOT_NAME) && !screen.contains("Rename ›"),
    );
    assert_turn_count(ledger_path, 0);
}

fn resume_named_thread(
    writer: &mut impl Write,
    output_rx: &mpsc::Receiver<Vec<u8>>,
    output: &mut String,
    name: &str,
) {
    open_center(writer, output_rx, output);
    wait_for_screen_marker(output_rx, output, name, Duration::from_secs(10));
    writer.write_all(b"f").unwrap();
    writer.flush().unwrap();
    wait_for_screen_marker(output_rx, output, "Search ›", Duration::from_secs(10));
    write_typed_text(writer, name.as_bytes());
    wait_for_screen_marker(
        output_rx,
        output,
        &format!("Search › {name}"),
        Duration::from_secs(10),
    );
    writer
        .write_all(b"\x1b[20~")
        .expect("resume the searched canonical thread with F9");
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "canonical thread resumed out of Agent Center",
        |screen| !screen.contains("Agent command center") && screen.contains("switched agent"),
    );
    terminal_title::wait_for_named_thread(output_rx, output, name);
}

pub(super) fn exercise_round_trip(
    writer: &mut impl Write,
    output_rx: &mpsc::Receiver<Vec<u8>>,
    output: &mut String,
    ledger_path: &Path,
) {
    wait_for_screen(
        output_rx,
        output,
        "unseen background thread starts with an isolated empty draft",
        |screen| {
            screen.contains("› Ask Lime to do anything")
                && screen.contains("AGENTS_OVERVIEW_READY")
                && !screen.contains(ROOT_SUFFIX)
                && !screen.contains(&paste_label(1002))
        },
    );
    paste_draft(writer, output_rx, output, 502, CHILD_SUFFIX, ROOT_SUFFIX);
    resume_named_thread(writer, output_rx, output, ROOT_NAME);
    assert_draft_cursor(
        output_rx,
        output,
        &paste_label(1002),
        ROOT_SUFFIX,
        CHILD_SUFFIX,
    );
    resume_named_thread(writer, output_rx, output, CHILD_NAME);
    assert_draft_cursor(
        output_rx,
        output,
        &paste_label(1004),
        CHILD_SUFFIX,
        ROOT_SUFFIX,
    );
    writer
        .write_all(b"\x01\x1b[3~")
        .expect("delete the restored paste atomically at line start");
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "restored atomic paste deletes as one element",
        |screen| {
            screen.contains(&format!("› {CHILD_SUFFIX}")) && !screen.contains(&paste_label(1004))
        },
    );
    writer
        .write_all(b"\x03")
        .expect("clear child suffix without submitting");
    writer.flush().unwrap();
    wait_for_screen_marker(
        output_rx,
        output,
        "› Ask Lime to do anything",
        Duration::from_secs(10),
    );
    assert_turn_count(ledger_path, 1);
    exercise_edit_lifetime(writer, output_rx, output, ledger_path);
}

fn exercise_edit_lifetime(
    writer: &mut impl Write,
    output_rx: &mpsc::Receiver<Vec<u8>>,
    output: &mut String,
    ledger_path: &Path,
) {
    writer.write_all(b"\x1b[200~/vim\x1b[201~\r").unwrap();
    writer.flush().unwrap();
    wait_for_screen(output_rx, output, "child starts Vim in Normal", |screen| {
        screen.contains("Vim: Normal") && screen.contains("Ask Lime to do anything")
    });
    writer
        .write_all(b"i\x1b[200~PTY_CHILD_REGISTER\nPTY_CHILD_TAIL\x1b[201~\x1b")
        .unwrap();
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "child edit leaves Insert before modal keys",
        |screen| {
            screen.contains("PTY_CHILD_REGISTER")
                && screen.contains("PTY_CHILD_TAIL")
                && screen.contains("Vim: Normal")
        },
    );
    writer.write_all(b"ggYj0rZ").unwrap();
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "child has its own undo and repeat transaction",
        |screen| {
            screen.contains("PTY_CHILD_REGISTER")
                && screen.contains("ZTY_CHILD_TAIL")
                && screen.contains("Vim: Normal")
        },
    );
    resume_named_thread(writer, output_rx, output, ROOT_NAME);
    writer.write_all(b"u.").unwrap();
    writer.flush().unwrap();
    assert_draft_cursor(
        output_rx,
        output,
        &paste_label(1002),
        ROOT_SUFFIX,
        CHILD_SUFFIX,
    );
    writer.write_all(b"p").unwrap();
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "session linewise register survives thread editor replacement without foreign undo",
        |screen| {
            let lines = screen.lines().collect::<Vec<_>>();
            lines
                .iter()
                .position(|line| line.trim() == format!("› {}{ROOT_SUFFIX}", paste_label(1002)))
                .is_some_and(|index| {
                    index + 1 < lines.len() && lines[index + 1].trim() == "PTY_CHILD_REGISTER"
                })
                && !screen.contains("ZTY_CHILD_TAIL")
                && screen.contains("Vim: Normal")
        },
    );
    writer.write_all(b"u\x03").unwrap();
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "thread lifetime edits leave an empty root without submission",
        |screen| {
            screen.contains("Ask Lime to do anything")
                && !screen.contains("PTY_CHILD_REGISTER")
                && !screen.contains(ROOT_SUFFIX)
        },
    );
    writer.write_all(b"\x1b[200~/vim\x1b[201~\r").unwrap();
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "thread lifetime fixture restores nonmodal exit boundary",
        |screen| screen.contains("Ask Lime to do anything") && !screen.contains("Vim:"),
    );
    assert_turn_count(ledger_path, 1);
}

fn assert_turn_count(ledger_path: &Path, expected: usize) {
    let ledger = std::fs::read_to_string(ledger_path).unwrap_or_default();
    let starts = ledger
        .lines()
        .filter_map(|line| serde_json::from_str::<serde_json::Value>(line).ok())
        .filter(|entry| entry["scenario"] == "agents-overview" && entry["kind"] == "turnStart")
        .count();
    assert_eq!(
        starts, expected,
        "draft open/cancel/root-child handoff must not submit an extra canonical turn"
    );
}
