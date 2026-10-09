//! Real keyboard completion is observed through PTY screen state, not injected popup models.

use super::*;

pub(super) fn exercise_suggestion_menus(
    writer: &mut impl Write,
    output_rx: &mpsc::Receiver<Vec<u8>>,
    output: &mut String,
    ledger_path: &Path,
) {
    exercise_empty_prompt_navigation(writer, output_rx, output);
    exercise_empty_completion(writer, output_rx, output);
    exercise_slash_completion(writer, output_rx, output);
    exercise_modified_enter(writer, output_rx, output);
    exercise_editor_shortcuts(writer, output_rx, output);
    write_typed_text(writer, b"/");
    wait_for_screen_marker(output_rx, output, "› /model", Duration::from_secs(10));
    writer.write_all(b"\x1b[1;1:2B").unwrap();
    writer.flush().unwrap();
    wait_for_screen_marker(output_rx, output, "› /plan", Duration::from_secs(10));
    #[cfg(not(windows))]
    writer.write_all(b"\x1b[112;7u").unwrap();
    writer.write_all(b"\x1b[1;1:3B\x1b[1;1:2A").unwrap();
    writer.flush().unwrap();
    wait_for_screen_marker(output_rx, output, "› /model", Duration::from_secs(10));
    writer
        .write_all(b"\x1b[1;1:2A")
        .expect("repeat wraps slash selection to last command");
    writer.flush().unwrap();
    wait_for_screen_marker(output_rx, output, "› /vim", Duration::from_secs(10));
    writer
        .write_all(b"\x1b")
        .expect("cancel slash suggestions without submitting draft");
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "slash popup closed with draft intact",
        |screen| !screen.contains("/model") && screen.lines().any(|line| line.trim() == "› /"),
    );
    clear_draft(writer, output_rx, output);

    write_typed_text(writer, b"@parser");
    let files = wait_for_screen(
        output_rx,
        output,
        "distinct filenames in search results",
        |screen| {
            screen.contains("› @parser")
                && screen.contains("parser_alpha.rs")
                && screen.contains("parser_beta.rs")
                && selected_filename(screen).is_some()
        },
    );
    let selected_before = selected_filename(&files)
        .unwrap_or_else(|| panic!("selected search row missing; screen: {files}"));
    writer
        .write_all(b"\x1b[1;1:2B")
        .expect("repeat navigates real file search results");
    writer.flush().unwrap();
    let files = wait_for_screen(output_rx, output, "file selection moved", |screen| {
        selected_filename(screen).is_some_and(|name| name != selected_before)
    });
    let selected = selected_filename(&files).unwrap();
    #[cfg(not(windows))]
    writer.write_all(b"\x1b[112;7u").unwrap();
    writer
        .write_all(b"\x1b[1;1:3B\x1b[9;1:2u")
        .expect("release keeps selection and repeat Tab inserts the canonical file path");
    writer.flush().unwrap();
    let full_path = format!(
        "{}/{selected}",
        "long_directory_for_filename_identity_".repeat(3)
    );
    let inserted = wait_for_screen(
        output_rx,
        output,
        "original untruncated file path inserted",
        |screen| {
            screen
                .chars()
                .filter(|ch| !ch.is_whitespace())
                .collect::<String>()
                .contains(&full_path)
        },
    );
    assert!(
        !inserted.contains(if selected == "parser_alpha.rs" {
            "parser_beta.rs"
        } else {
            "parser_alpha.rs"
        }),
        "file popup stayed visible after insertion: {inserted}"
    );
    clear_draft(writer, output_rx, output);

    write_typed_text(writer, b"$gate-skill-");
    wait_for_screen_marker(output_rx, output, "› $gate-skill-", Duration::from_secs(10));
    wait_for_screen_marker(
        output_rx,
        output,
        "› gate-skill-00",
        Duration::from_secs(10),
    );
    wait_for_screen_marker(output_rx, output, "[Skill]", Duration::from_secs(10));
    wait_for_screen_marker(
        output_rx,
        output,
        "enter insert · esc close",
        Duration::from_secs(10),
    );
    writer
        .write_all(b"\x1b[1;1:2A")
        .expect("repeat scrolls skill suggestions to last catalog entry");
    writer.flush().unwrap();
    wait_for_screen_marker(
        output_rx,
        output,
        "› gate-skill-09",
        Duration::from_secs(10),
    );
    #[cfg(not(windows))]
    writer.write_all(b"\x1b[110;7u").unwrap();
    writer
        .write_all(b"\x1b[1;1:3B\x1b[9;1:2u")
        .expect("release keeps selection and repeat Tab inserts the selected skill");
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "canonical skill token inserted and popup closed",
        |screen| screen.contains("$gate-skill-09") && !screen.contains("[Skill]"),
    );
    clear_draft(writer, output_rx, output);

    let ledger = std::fs::read_to_string(ledger_path).unwrap_or_default();
    assert!(
        !ledger
            .lines()
            .filter_map(|line| serde_json::from_str::<serde_json::Value>(line).ok())
            .any(|entry| entry["scenario"] == "complete" && entry["kind"] == "turnStart"),
        "suggestion navigation/completion must not start a canonical turn"
    );
    eprintln!("TUI_POPUP_ENTER_OK slash=ok file=ok skill=ok shift-alt=newline turns=none");
    eprintln!("TUI_SLASH_COMPLETION_OK tab=ok slash=ok enter=ok args=preserved turns=none");
    eprintln!(
        "TUI_EMPTY_COMPLETION_OK file-tab=closed skill-tab-enter=closed draft=preserved turns=none"
    );
    eprintln!("TUI_POPUP_KEYBOARD_OK repeat=navigation-completion release=ignored modifiers=exact-control ctrl-j=newline ctrl-k=editor turns=none");
}

fn exercise_empty_prompt_navigation(
    writer: &mut impl Write,
    output_rx: &mpsc::Receiver<Vec<u8>>,
    output: &mut String,
) {
    for sequence in [b"\x1b[1;1:2D".as_slice(), b"\x1b[1;1:3D"] {
        writer.write_all(sequence).unwrap();
        writer
            .write_all(b"\x1b[200~PTY_LEFT_EVENT_BARRIER\x1b[201~")
            .expect("observe repeat/release Left before the next composer input");
        writer.flush().unwrap();
        wait_for_screen(
            output_rx,
            output,
            "repeat and release Left leave empty input in the composer",
            |screen| {
                screen.contains("› PTY_LEFT_EVENT_BARRIER")
                    && !screen.contains("Agent command center")
            },
        );
        clear_draft(writer, output_rx, output);
    }
    writer
        .write_all(b"\x1b[D")
        .expect("press Left opens the empty-prompt Agents Overview");
    writer.flush().unwrap();
    wait_for_screen_marker(
        output_rx,
        output,
        "Agent command center",
        Duration::from_secs(10),
    );
    writer.write_all(b"\x18q").unwrap();
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "cancel overview restores the empty composer",
        |screen| {
            screen.contains("Ask Lime to do anything") && !screen.contains("Agent command center")
        },
    );
    writer
        .write_all(b"\x1b[200~ab\x1b[201~\x05\x1b[1;1:2D\x1b[200~X\x1b[201~")
        .expect("repeat Left still moves the editor cursor in a draft");
    writer.flush().unwrap();
    wait_for_screen_marker(output_rx, output, "› aXb", Duration::from_secs(10));
    clear_draft(writer, output_rx, output);
    eprintln!("TUI_EMPTY_NAVIGATION_OK left=press-only repeat=editor release=ignored overview=cancelled turns=none");
}

fn exercise_empty_completion(
    writer: &mut impl Write,
    output_rx: &mpsc::Receiver<Vec<u8>>,
    output: &mut String,
) {
    for (token, empty_hint, completion_key) in [
        ("@zzzz-unmatched", "no matches", b"\t"),
        ("$zzzz-unmatched", "no matching skills", b"\t"),
        ("$zzzz-unmatched", "no matching skills", b"\r"),
    ] {
        write_typed_text(writer, token.as_bytes());
        wait_for_screen(output_rx, output, "empty completion list", |screen| {
            screen.contains(&format!("› {token}")) && screen.contains(empty_hint)
        });
        writer
            .write_all(completion_key)
            .expect("close empty completion without submitting");
        writer.flush().unwrap();
        wait_for_screen(
            output_rx,
            output,
            "empty list closed with partial draft preserved",
            |screen| {
                screen
                    .lines()
                    .any(|line| line.trim() == format!("› {token}"))
                    && !screen.contains(empty_hint)
            },
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
}

fn exercise_slash_completion(
    writer: &mut impl Write,
    output_rx: &mpsc::Receiver<Vec<u8>>,
    output: &mut String,
) {
    for completion_key in [b"\t".as_slice(), b"/", b"\r"] {
        writer
            .write_all(b"\x1b[200~/effo high\x1b[201~\x01\x1b[C\x1b[C\x1b[C\x1b[C\x1b[C")
            .expect("edit the command prefix while retaining its argument");
        writer.flush().unwrap();
        wait_for_screen(
            output_rx,
            output,
            "slash popup with existing inline argument",
            |screen| screen.contains("› /effo high") && screen.contains("› /effort"),
        );
        writer
            .write_all(completion_key)
            .expect("accept command completion as text");
        writer.flush().unwrap();
        wait_for_screen(
            output_rx,
            output,
            "completed command retained its argument without dispatch",
            |screen| {
                screen.lines().any(|line| line.trim() == "› /effort high")
                    && !screen.lines().any(|line| {
                        line.trim_start().starts_with("› /effort")
                            && line.trim() != "› /effort high"
                    })
            },
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
}

fn exercise_modified_enter(
    writer: &mut impl Write,
    output_rx: &mpsc::Receiver<Vec<u8>>,
    output: &mut String,
) {
    for token in ["/sta", "@parser", "$gate-skill-"] {
        for modified_enter in [b"\x1b[13;2u".as_slice(), b"\x1b[13;3u", b"\n"] {
            write_typed_text(writer, token.as_bytes());
            wait_for_screen(
                output_rx,
                output,
                "completion before modified Enter",
                |screen| {
                    screen.contains(&format!("› {token}"))
                        && match token {
                            "/sta" => screen.contains("› /status"),
                            "@parser" => selected_filename(screen).is_some(),
                            _ => screen.contains("[Skill]"),
                        }
                },
            );
            writer
                .write_all(modified_enter)
                .expect("send real Shift/Alt+Enter or Ctrl-J");
            writer
                .write_all(b"\x1b[200~PTY_POPUP_NEWLINE\x1b[201~")
                .expect("type on the new line without accepting a completion");
            writer.flush().unwrap();
            wait_for_screen(
                output_rx,
                output,
                "modified Enter preserved the partial token and added a line",
                |screen| {
                    let lines = screen.lines().collect::<Vec<_>>();
                    lines
                        .iter()
                        .position(|line| line.trim() == format!("› {token}"))
                        .is_some_and(|index| {
                            lines
                                .get(index + 1)
                                .is_some_and(|line| line.trim() == "PTY_POPUP_NEWLINE")
                        })
                        && !screen.contains("[Skill]")
                        && !screen.contains("› /status")
                        && selected_filename(screen).is_none()
                },
            );
            writer
                .write_all(b"\x03")
                .expect("clear the complete multiline draft");
            writer.flush().unwrap();
            wait_for_screen(
                output_rx,
                output,
                "multiline completion draft cleared",
                |screen| {
                    screen.contains("Ask Lime to do anything")
                        && !screen.contains("PTY_POPUP_NEWLINE")
                },
            );
        }
    }
}

fn exercise_editor_shortcuts(
    writer: &mut impl Write,
    output_rx: &mpsc::Receiver<Vec<u8>>,
    output: &mut String,
) {
    write_typed_text(writer, b"/");
    wait_for_screen_marker(output_rx, output, "› /model", Duration::from_secs(10));
    writer.write_all(b"\x0b\x1b[9;1:2u").unwrap();
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "Ctrl-K reaches the editor without moving the popup",
        |screen| screen.lines().any(|line| line.trim() == "› /model") && !screen.contains("/plan"),
    );
    clear_draft(writer, output_rx, output);
}

fn selected_filename(screen: &str) -> Option<&'static str> {
    screen
        .lines()
        .filter(|line| line.trim_start().starts_with('›'))
        .find_map(|line| {
            ["parser_alpha.rs", "parser_beta.rs"]
                .into_iter()
                .find(|name| line.contains(name))
        })
}

fn clear_draft(writer: &mut impl Write, output_rx: &mpsc::Receiver<Vec<u8>>, output: &mut String) {
    writer
        .write_all(b"\x05\x15")
        .expect("move to the end before Ctrl-U clears the completion line");
    writer.flush().unwrap();
    wait_for_screen_marker(
        output_rx,
        output,
        "Ask Lime to do anything",
        Duration::from_secs(10),
    );
}
