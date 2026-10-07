//! Resume chrome consumes the canonical thread list, not a terminal-local store.

use super::*;

pub(super) fn exercise_open_and_cancel(
    writer: &mut impl Write,
    output_rx: &mpsc::Receiver<Vec<u8>>,
    output: &mut String,
    ledger_path: &Path,
    completed_text: &str,
    master: &dyn portable_pty::MasterPty,
) {
    writer
        .write_all(b"\x1b[200~/resume\x1b[201~\x05\r")
        .expect("open resume picker");
    writer.flush().unwrap();
    wait_for_screen_marker(
        output_rx,
        output,
        "Resume a previous session",
        Duration::from_secs(10),
    );
    wait_for_screen(
        output_rx,
        output,
        "canonical session row and primary controls visible",
        |screen| {
            screen.contains("› ")
                && screen.contains("f9 resume")
                && screen.contains("ctrl+x q close")
        },
    );
    for (keys, marker) in [
        (b"\x1b[C".as_slice(), "Filter: All directories"),
        (b"\x1b[D".as_slice(), "Filter: Current cwd"),
        (b"\t\x1b[C".as_slice(), "Status: Archived"),
        (b"\x1b[D".as_slice(), "Status: Active"),
        (b"\t\x1b[C".as_slice(), "Sort: Created"),
        (b"\x1b[D".as_slice(), "Sort: Updated"),
    ] {
        writer
            .write_all(keys)
            .expect("change focused resume toolbar control");
        writer.flush().unwrap();
        wait_for_screen_marker(output_rx, output, marker, Duration::from_secs(10));
    }
    wait_for_screen(
        output_rx,
        output,
        "canonical row reloaded after toolbar round trip",
        |screen| screen.contains("› ") && screen.contains("f9 resume"),
    );
    master
        .resize(PtySize {
            rows: 8,
            cols: 100,
            pixel_width: 0,
            pixel_height: 0,
        })
        .expect("shrink resume viewport");
    wait_for_screen(
        output_rx,
        output,
        "short resume viewport retains its selected row and controls",
        |screen| {
            let visible = screen.lines().take(8).collect::<Vec<_>>().join("\n");
            visible.contains("› ")
                && visible.contains("f9 resume")
                && visible.contains("ctrl+x q close")
        },
    );
    master
        .resize(PtySize {
            rows: 8,
            cols: 10,
            pixel_width: 0,
            pixel_height: 0,
        })
        .expect("shrink resume footer to its exact chord width");
    wait_for_screen(
        output_rx,
        output,
        "ten-column resume footer retains the whole cancel chord with its inset",
        |screen| {
            screen
                .lines()
                .nth(7)
                .is_some_and(|line| line.trim_end() == " ctrl+x q")
        },
    );
    master
        .resize(PtySize {
            rows: 8,
            cols: 100,
            pixel_width: 0,
            pixel_height: 0,
        })
        .expect("restore short resume footer width");
    wait_for_screen(
        output_rx,
        output,
        "resume primary hints expand after narrow resize on the same canonical row",
        |screen| {
            let visible = screen.lines().take(8).collect::<Vec<_>>().join("\n");
            visible.contains("› ") && visible.contains("f9 resume · ctrl+x q close")
        },
    );
    writer
        .write_all(b"\x04\x15")
        .expect("page in the actual resume viewport");
    writer.flush().unwrap();
    master
        .resize(PtySize {
            rows: 24,
            cols: 100,
            pixel_width: 0,
            pixel_height: 0,
        })
        .expect("restore resume viewport");
    writer
        .write_all(b"\x18q")
        .expect("cancel resume picker with configured chord");
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "canonical completed transcript restored after resume cancel",
        |screen| !screen.contains("Resume a previous session") && screen.contains(completed_text),
    );
    writer
        .write_all(b"\x1b[200~/resume\x1b[201~\x05\r")
        .expect("reopen canonical list for configured accept");
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "configured accept hint and canonical row loaded",
        |screen| {
            screen.contains("Resume a previous session")
                && screen.contains("› ")
                && screen.contains("f9 resume")
        },
    );
    writer
        .write_all(b"\x1b[20~")
        .expect("resume the canonical row with configured F9");
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "configured accept resumed the same completed canonical transcript",
        |screen| !screen.contains("Resume a previous session") && screen.contains(completed_text),
    );
    let ledger = std::fs::read_to_string(ledger_path).expect("completed turn ledger");
    let starts = ledger
        .lines()
        .filter_map(|line| serde_json::from_str::<serde_json::Value>(line).ok())
        .filter(|entry| entry["scenario"] == "complete" && entry["kind"] == "turnStart")
        .count();
    assert_eq!(
        starts, 1,
        "resume open/cancel must not submit a new canonical turn"
    );
}
