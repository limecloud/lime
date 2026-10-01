//! Actual multiline input geometry and editing, before any canonical turn is submitted.

use super::*;

pub(super) fn seed_persistent_history(data_dir: &Path) {
    std::fs::create_dir_all(data_dir).unwrap();
    let rows = (0..360).map(|offset| {
        if offset > 2 && offset % 7 == 0 { return "malformed".to_string(); }
        let text = match offset {
            0 => "PTY_PERSISTENT_OLDER".into(),
            1 | 2 => "PTY_PERSISTENT_LATEST".into(),
            _ => format!("unrelated persistent entry {offset}"),
        };
        serde_json::json!({"session_id": "00000000-0000-0000-0000-000000000001", "ts": 1, "text": text}).to_string()
    }).collect::<Vec<_>>().join("\n") + "\n";
    std::fs::write(data_dir.join("prompt_history.jsonl"), rows).unwrap();
}

pub(super) fn exercise_multiline_surface(
    writer: &mut impl Write,
    output_rx: &mpsc::Receiver<Vec<u8>>,
    output: &mut String,
    ledger_path: &Path,
    data_dir: &Path,
) {
    wait_for_screen(
        output_rx,
        output,
        "composer placeholder has top and bottom padding",
        |screen| {
            let lines = screen.lines().collect::<Vec<_>>();
            lines
                .iter()
                .position(|line| line.contains("› Ask Lime to do anything"))
                .is_some_and(|index| {
                    index > 0
                        && index + 1 < lines.len()
                        && lines[index - 1].trim().is_empty()
                        && lines[index + 1].trim().is_empty()
                })
        },
    );
    writer
        .write_all("\x1b[200~PTY_INPUT_HEADER\n界🙂\nPTY_INPUT_END\x1b[201~\x05".as_bytes())
        .expect("paste a multiline Unicode composer draft");
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "multiline composer preserves gutter and blank bottom row",
        |screen| {
            let lines = screen.lines().collect::<Vec<_>>();
            lines
                .iter()
                .position(|line| line.contains("› PTY_INPUT_HEADER"))
                .is_some_and(|index| {
                    index > 0
                        && index + 3 < lines.len()
                        && lines[index - 1].trim().is_empty()
                        && lines[index + 1].starts_with("  界🙂")
                        && lines[index + 2].starts_with("  PTY_INPUT_END")
                        && lines[index + 3].trim().is_empty()
                })
        },
    );
    writer
        .write_all(b"\x03")
        .expect("clear draft with Ctrl-C without submitting");
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "multiline clear restores the composer placeholder",
        |screen| {
            screen.contains("› Ask Lime to do anything") && !screen.contains("PTY_INPUT_HEADER")
        },
    );
    exercise_slow_history_search(writer, output_rx, output, data_dir);
    exercise_history_search(writer, output_rx, output);
    exercise_persistent_history_search(writer, output_rx, output);
    exercise_editor_keymap(writer, output_rx, output);
    exercise_vim_command_state(writer, output_rx, output);
    super::vim_keymap::exercise_modal_keymap(writer, output_rx, output);
    let ledger = std::fs::read_to_string(ledger_path).unwrap_or_default();
    assert!(
        !ledger
            .lines()
            .filter_map(|line| serde_json::from_str::<serde_json::Value>(line).ok())
            .any(|entry| entry["kind"] == "turnStart"),
        "multiline paste/clear/history search must not start a canonical turn"
    );
}

fn exercise_editor_keymap(
    writer: &mut impl Write,
    output_rx: &mpsc::Receiver<Vec<u8>>,
    output: &mut String,
) {
    writer
        .write_all(b"\x1b[200~PTY_EDITOR_HEAD PTY_EDITOR_TAIL\x1b[201~\x1b[21~")
        .unwrap();
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "configured F10 word movement preserves real input geometry",
        |screen| screen.contains("\u{203a} PTY_EDITOR_HEAD PTY_EDITOR_TAIL"),
    );
    // delete_forward=[] must make Delete inert. The following unique paste is an observation
    // barrier, so the assertion cannot accidentally inspect a screen before Delete was read.
    writer
        .write_all(b"\x1b[3~\x1b[200~PTY_EDITOR_UNBIND_\x1b[201~\x1b[23~")
        .unwrap();
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "configured newline and explicit delete unbind preserve draft",
        |screen| {
            screen.contains("\u{203a} PTY_EDITOR_HEAD PTY_EDITOR_UNBIND_")
                && screen
                    .lines()
                    .any(|line| line.starts_with("  PTY_EDITOR_TAIL"))
        },
    );
    writer.write_all(b"\x11k").unwrap();
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "configured editor chord kills only the resolved logical line",
        |screen| {
            screen.contains("\u{203a} PTY_EDITOR_HEAD PTY_EDITOR_UNBIND_")
                && !screen.contains("PTY_EDITOR_TAIL")
        },
    );
    // Enter cancels an unmatched editor chord rather than submitting a turn.
    writer
        .write_all(b"\x11\r\x1b[200~PTY_EDITOR_CANCEL\x1b[201~")
        .unwrap();
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "pending editor chord cancellation does not submit or leak its completion",
        |screen| {
            screen.contains("PTY_EDITOR_CANCEL")
                && screen.contains("PTY_EDITOR_HEAD PTY_EDITOR_UNBIND_")
        },
    );
    writer.write_all(b"\x03").unwrap();
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "configured editor flow leaves no canonical turn or residual draft",
        |screen| {
            screen.contains("Ask Lime to do anything") && !screen.contains("PTY_EDITOR_CANCEL")
        },
    );
}

fn exercise_vim_command_state(
    writer: &mut impl Write,
    output_rx: &mpsc::Receiver<Vec<u8>>,
    output: &mut String,
) {
    writer.write_all(b"\x1b[200~/vim\x1b[201~\r").unwrap();
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "Vim enabled through the real local command",
        |screen| screen.contains("Vim: Normal") && screen.contains("Ask Lime to do anything"),
    );
    let unicode = "界".repeat(17);
    let repeated_unicode = "界".repeat(34);
    writer.write_all(format!("i{unicode}").as_bytes()).unwrap();
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "Unicode key burst is classified once as visible paste",
        |screen| screen.contains(&format!("\u{203a} {unicode}")) && screen.contains("Vim: Insert"),
    );
    writer.write_all(b"\x1b").unwrap();
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "Unicode burst finishes the recorded insert transaction",
        |screen| screen.contains(&format!("\u{203a} {unicode}")) && screen.contains("Vim: Normal"),
    );
    writer.write_all(b".").unwrap();
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "dot repeats reclassified Unicode text without its withdrawn prefix",
        |screen| {
            screen.contains(&format!("\u{203a} {repeated_unicode}"))
                && !screen.contains(&"界".repeat(35))
        },
    );
    writer.write_all(b"u").unwrap();
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "Unicode repeat remains one undo transaction",
        |screen| {
            screen.contains(&format!("\u{203a} {unicode}")) && !screen.contains(&repeated_unicode)
        },
    );
    writer.write_all(b"u").unwrap();
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "original Unicode insertion remains one undo transaction",
        |screen| screen.contains("Ask Lime to do anything") && !screen.contains(&unicode),
    );
    writer
        .write_all(b"i\x1b[200~one two three\x1b[201~\x1b")
        .unwrap();
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "Vim insert session becomes one complete change",
        |screen| screen.contains("\u{203a} one two three") && screen.contains("Vim: Normal"),
    );
    writer.write_all(b"0cw\x1b[200~X\x1b[201~\x1b").unwrap();
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "change-word preserves the separating space",
        |screen| screen.contains("\u{203a} X two three") && screen.contains("Vim: Normal"),
    );
    writer.write_all(b"w.").unwrap();
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "semantic dot replays the complete change",
        |screen| screen.contains("\u{203a} X X three") && screen.contains("Vim: Normal"),
    );
    writer
        .write_all(b"i\x12\x1b[200~PTY_PERSISTENT\x1b[201~")
        .unwrap();
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "history preview suspends the original Vim transaction",
        |screen| {
            screen.contains("\u{203a} PTY_PERSISTENT_LATEST")
                && screen.contains("reverse-i-search: PTY_PERSISTENT")
        },
    );
    writer.write_all(b"\x1b").unwrap();
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "search cancellation restores the original Vim draft",
        |screen| {
            screen.contains("\u{203a} X X three")
                && screen.contains("Vim: Insert")
                && !screen.contains("reverse-i-search:")
        },
    );
    writer.write_all(b"\x1b").unwrap();
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "unmodified insert session keeps the previous complete change",
        |screen| screen.contains("\u{203a} X X three") && screen.contains("Vim: Normal"),
    );
    writer.write_all(b"0ww.").unwrap();
    writer.flush().unwrap();
    wait_for_screen_marker(output_rx, output, "\u{203a} X X X", Duration::from_secs(10));
    writer.write_all(b"u").unwrap();
    writer.flush().unwrap();
    wait_for_screen_marker(
        output_rx,
        output,
        "\u{203a} X X three",
        Duration::from_secs(10),
    );
    writer.write_all(b"\x12").unwrap();
    writer.flush().unwrap();
    wait_for_screen_marker(output_rx, output, "\u{203a} X X X", Duration::from_secs(10));
    writer.write_all(b"\x03\x1b[200~/vim\x1b[201~\r").unwrap();
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "local Vim command leaves no turn or residual draft",
        |screen| {
            screen.contains("Ask Lime to do anything")
                && !screen.contains("Vim:")
                && !screen.contains("X X X")
        },
    );
}

fn exercise_slow_history_search(
    writer: &mut impl Write,
    output_rx: &mpsc::Receiver<Vec<u8>>,
    output: &mut String,
    data_dir: &Path,
) {
    // Hold the same cross-platform lock that the real App Server reader awaits, not a mock timer.
    let file = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(data_dir.join("prompt_history.jsonl"))
        .unwrap();
    fs2::FileExt::lock_exclusive(&file).unwrap();
    writer
        .write_all(b"\x12\x1b[200~PTY_PERSISTENT\x1b[201~")
        .unwrap();
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "slow persistent read shows pending query",
        |screen| {
            screen.contains("reverse-i-search: PTY_PERSISTENT") && screen.contains("searching")
        },
    );
    writer.write_all(b"\x1b[200~_CHANGED\x1b[201~").unwrap();
    writer.flush().unwrap();
    wait_for_screen_marker(
        output_rx,
        output,
        "PTY_PERSISTENT_CHANGED",
        Duration::from_secs(10),
    );
    writer.write_all(b"\x1b").unwrap();
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "cancel remains responsive while persistent IO is blocked",
        |screen| screen.contains("Ask Lime to do anything") && !screen.contains("reverse-i-search"),
    );
    writer
        .write_all(b"\x1b[200~PTY_INPUT_UNBLOCKED\x1b[201~")
        .unwrap();
    writer.flush().unwrap();
    wait_for_screen_marker(
        output_rx,
        output,
        "› PTY_INPUT_UNBLOCKED",
        Duration::from_secs(10),
    );
    drop(file);
    writer.write_all(b"\x03").unwrap();
    writer.flush().unwrap();
    wait_for_screen_marker(
        output_rx,
        output,
        "Ask Lime to do anything",
        Duration::from_secs(10),
    );
}

fn exercise_persistent_history_search(
    writer: &mut impl Write,
    output_rx: &mpsc::Receiver<Vec<u8>>,
    output: &mut String,
) {
    writer
        .write_all(b"\x12\x1b[200~PTY_PERSISTENT\x1b[201~")
        .unwrap();
    writer.flush().unwrap();
    wait_for_screen_marker(
        output_rx,
        output,
        "› PTY_PERSISTENT_LATEST",
        Duration::from_secs(10),
    );
    writer.write_all(b"\x1b[A").unwrap();
    writer.flush().unwrap();
    wait_for_screen_marker(
        output_rx,
        output,
        "› PTY_PERSISTENT_OLDER",
        Duration::from_secs(10),
    );
    writer.write_all(b"\x1b[B").unwrap();
    writer.flush().unwrap();
    wait_for_screen_marker(
        output_rx,
        output,
        "› PTY_PERSISTENT_LATEST",
        Duration::from_secs(10),
    );
    writer.write_all(b"\x1b[B").unwrap();
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "persistent cached Newer boundary preserves the preview",
        |screen| {
            screen.contains("› PTY_PERSISTENT_LATEST")
                && screen.contains("accept")
                && !screen.contains("no match")
        },
    );
    writer.write_all(b"\r").unwrap();
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "persistent history Enter only accepts the editable draft",
        |screen| screen.contains("› PTY_PERSISTENT_LATEST") && !screen.contains("reverse-i-search"),
    );
    writer.write_all(b"\x03").unwrap();
    writer.flush().unwrap();
    wait_for_screen_marker(
        output_rx,
        output,
        "Ask Lime to do anything",
        Duration::from_secs(10),
    );
}

fn exercise_history_search(
    writer: &mut impl Write,
    output_rx: &mpsc::Receiver<Vec<u8>>,
    output: &mut String,
) {
    for text in ["PTY_HISTORY_ALPHA", "PTY_HISTORY_BETA", "PTY_HISTORY_ALPHA"] {
        writer
            .write_all(format!("\x1b[200~{text}\x1b[201~\x05").as_bytes())
            .unwrap();
        writer.flush().unwrap();
        wait_for_screen_marker(output_rx, output, text, Duration::from_secs(10));
        writer.write_all(b"\x03").unwrap();
        writer.flush().unwrap();
        wait_for_screen_marker(
            output_rx,
            output,
            "Ask Lime to do anything",
            Duration::from_secs(10),
        );
    }
    writer
        .write_all(b"\x12\x1b[200~PTY_HISTORY\x1b[201~")
        .unwrap();
    writer.flush().unwrap();
    wait_for_screen_marker(
        output_rx,
        output,
        "› PTY_HISTORY_ALPHA",
        Duration::from_secs(10),
    );
    writer.write_all(b"\x1b[A").unwrap();
    writer.flush().unwrap();
    wait_for_screen_marker(
        output_rx,
        output,
        "› PTY_HISTORY_BETA",
        Duration::from_secs(10),
    );
    writer.write_all(b"\x1b[A").unwrap();
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "local search boundary waits for uncached persistent rows",
        |screen| screen.contains("› PTY_HISTORY_BETA") && screen.contains("searching"),
    );
    wait_for_screen(
        output_rx,
        output,
        "duplicate history boundary keeps the unique preview",
        |screen| {
            screen.contains("› PTY_HISTORY_BETA")
                && !screen.contains("PTY_HISTORY_ALPHA")
                && screen.contains("accept")
                && !screen.contains("searching")
        },
    );
    writer.write_all(b"\x1b[B").unwrap();
    writer.flush().unwrap();
    wait_for_screen_marker(
        output_rx,
        output,
        "› PTY_HISTORY_ALPHA",
        Duration::from_secs(10),
    );
    writer.write_all(b"\r").unwrap();
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "search Enter accepts without submitting",
        |screen| screen.contains("› PTY_HISTORY_ALPHA") && !screen.contains("reverse-i-search:"),
    );
    writer.write_all(b"\x03").unwrap();
    writer.flush().unwrap();
    wait_for_screen_marker(
        output_rx,
        output,
        "Ask Lime to do anything",
        Duration::from_secs(10),
    );
}
