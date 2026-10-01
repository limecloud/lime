//! Real canonical file item -> diff renderer -> PTY colors, including continuation padding.

use super::*;

pub(super) fn assert_painted_patch(output_rx: &mpsc::Receiver<Vec<u8>>, output: &mut String) {
    wait_for_screen(
        output_rx,
        output,
        "canonical patch and both wrapped tails are visible",
        |screen| screen.contains("PTY_DIFF_OLD_TAIL") && screen.contains("PTY_DIFF_NEW_TAIL"),
    );
    let mut parser = vt100::Parser::new(24, 100, 0);
    parser.process(output.as_bytes());
    for (marker, fill, foreground) in [
        (
            "PTY_DIFF_OLD",
            vt100::Color::Rgb(74, 34, 29),
            vt100::Color::Idx(1),
        ),
        (
            "PTY_DIFF_NEW",
            vt100::Color::Rgb(33, 58, 43),
            vt100::Color::Idx(2),
        ),
    ] {
        let (row, column) =
            terminal_marker_position(output, marker).expect("canonical patch text position");
        let sign = parser.screen().cell(row, column - 1).unwrap();
        assert_eq!(
            sign.fgcolor(),
            foreground,
            "{marker} sign color at ({column},{row}); screen={}",
            parser.screen().contents()
        );
        for y in [row, row + 1] {
            for x in [column, 99] {
                let cell = parser.screen().cell(y, x).unwrap();
                assert_eq!(
                    cell.bgcolor(),
                    fill,
                    "{marker} body/continuation padding ({x},{y})"
                );
                assert!(!cell.dim(), "{marker} content must not inherit delete dim");
            }
        }
    }
}
