//! Four configured Vim contexts are exercised through the real PTY and composer.

use super::*;

pub(super) fn exercise_modal_keymap(
    writer: &mut impl Write,
    output_rx: &mpsc::Receiver<Vec<u8>>,
    output: &mut String,
) {
    writer.write_all(b"\x1b[200~/vim\x1b[201~\r").unwrap();
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "configured Vim owner starts in Normal",
        |screen| screen.contains("Vim: Normal") && screen.contains("Ask Lime to do anything"),
    );
    cursor_style::wait_for_style(
        output_rx,
        output,
        0,
        "main Vim Normal uses the user's default cursor",
    );
    writer.write_all(b"i").unwrap();
    writer.flush().unwrap();
    cursor_style::wait_for_style(
        output_rx,
        output,
        6,
        "main Vim Insert emits a steady bar cursor",
    );
    writer
        .write_all(b"\x1b[200~one two tail\x1b[201~\x1b")
        .unwrap();
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "standalone Escape returns configured draft to Normal before printable commands",
        |screen| {
            screen.lines().any(|line| line.trim() == "› one two tail")
                && screen.contains("Vim: Normal")
        },
    );
    cursor_style::wait_for_style(
        output_rx,
        output,
        0,
        "main Vim Escape restores the default cursor",
    );
    writer.write_all(b"0x").unwrap();
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "old x is explicitly unbound in Normal",
        |screen| {
            screen.lines().any(|line| line.trim() == "› one two tail")
                && screen.contains("Vim: Normal")
        },
    );
    writer.write_all(b"\x1b[24~").unwrap();
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "rebound F12 deletes but old x is explicitly unbound",
        |screen| {
            screen.lines().any(|line| line.trim() == "› ne two tail")
                && screen.contains("Vim: Normal")
        },
    );
    writer.write_all(b"zuzdzw").unwrap();
    writer.flush().unwrap();
    wait_for_screen_marker(output_rx, output, "› two tail", Duration::from_secs(10));
    writer.write_all(b"zdi\x1b[24~").unwrap();
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "rebound text object uses operator context not Normal F12",
        |screen| {
            screen.contains("›  tail")
                && !screen.contains("two tail")
                && screen.contains("Vim: Normal")
        },
    );
    writer
        .write_all(b"zuzu0z/\x1b[200~tail\x1b[201~\r")
        .unwrap();
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "configured search chord accepts the literal query",
        |screen| {
            screen.contains("› one two tail")
                && screen.contains("Vim: Normal")
                && !screen.contains("Vim /: tail")
        },
    );
    writer.write_all(b"zdi\x1b[24~").unwrap();
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "configured search moved to the real word before deletion",
        |screen| {
            screen.contains("› one two")
                && !screen.contains("one two tail")
                && screen.contains("Vim: Normal")
        },
    );
    writer
        .write_all(b"zu\x03i\x1b[200~PTY_VIM_LINE_A\nPTY_VIM_LINE_B\x1b[201~\x1b")
        .unwrap();
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "linewise draft enters Normal before the gg chord",
        |screen| {
            screen.contains("PTY_VIM_LINE_A")
                && screen.contains("PTY_VIM_LINE_B")
                && screen.contains("Vim: Normal")
        },
    );
    writer.write_all(b"ggYp").unwrap();
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "linewise register pastes below the current logical line",
        |screen| {
            let lines = screen.lines().collect::<Vec<_>>();
            lines
                .iter()
                .position(|line| line.contains("› PTY_VIM_LINE_A"))
                .is_some_and(|index| {
                    index + 2 < lines.len()
                        && lines[index + 1].trim() == "PTY_VIM_LINE_A"
                        && lines[index + 2].trim() == "PTY_VIM_LINE_B"
                })
        },
    );
    writer
        .write_all(b"zu\x03i\x1b[200~PTY_VIM_CANCEL\x1b[201~\x1b")
        .unwrap();
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "cancel draft enters Normal before the modal prefix",
        |screen| screen.contains("PTY_VIM_CANCEL") && screen.contains("Vim: Normal"),
    );
    writer.write_all(b"z\rzu").unwrap();
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "modal chord cancellation does not submit and rebound undo remains one edit",
        |screen| {
            screen.contains("Ask Lime to do anything")
                && screen.contains("Vim: Normal")
                && !screen.contains("PTY_VIM_CANCEL")
        },
    );
    writer.write_all(b"\x1b[200~/vim\x1b[201~\r").unwrap();
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "configured Vim flow leaves no canonical turn or residual draft",
        |screen| screen.contains("Ask Lime to do anything") && !screen.contains("Vim:"),
    );
}
