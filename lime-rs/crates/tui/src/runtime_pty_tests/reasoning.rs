use super::*;

pub(super) fn assert_summary_body(
    output_rx: &mpsc::Receiver<Vec<u8>>,
    output: &mut String,
    reasoning_text: &str,
) {
    wait_for_screen_marker(
        output_rx,
        output,
        "PTY_SECOND_PARAGRAPH",
        Duration::from_secs(10),
    );
    let screen = terminal_screen_text(output);
    for header in [
        "PTY_EMPTY_STATUS",
        "PTY_BODY_HEADER",
        "PTY_EMPTY_TAIL",
        "PTY_RAW_REASONING_MUST_STAY_HIDDEN",
    ] {
        assert!(
            !screen.contains(header),
            "summary heading leaked into detailed body: {screen}"
        );
    }
    assert!(
        screen.contains("use <!-- -->."),
        "literal comment content disappeared: {screen}"
    );
    let rows = screen.lines().collect::<Vec<_>>();
    assert_eq!(
        screen.matches(reasoning_text).count(),
        1,
        "summary body duplicated: {screen}"
    );
    assert_eq!(
        screen.matches("PTY_SECOND_PARAGRAPH").count(),
        1,
        "summary paragraph duplicated: {screen}"
    );
    let first = rows
        .iter()
        .position(|row| row.contains(reasoning_text))
        .expect("summary body row");
    let second = rows
        .iter()
        .position(|row| row.contains("PTY_SECOND_PARAGRAPH"))
        .expect("second summary part row");
    assert!(
        second > first + 1,
        "summary part boundary lost its blank paragraph: {screen}"
    );
    assert!(
        rows[first + 1..second]
            .iter()
            .any(|row| row.trim().is_empty()),
        "summary parts have no blank row: {screen}"
    );
    eprintln!("TUI_REASONING_PARTS_OK body=ok paragraphs=ok placeholders=hidden literal-comment=preserved");
}
