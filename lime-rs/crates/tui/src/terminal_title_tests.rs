use super::*;

#[test]
fn osc_payload_is_bounded_visible_unicode_and_cannot_escape_its_framing() {
    let mut output = Vec::new();
    assert_eq!(
        set_terminal_title(
            &mut output,
            " \t界\u{202e}\u{2066}\u{200b}\u{feff}\u{e0100}\x1b\x07\u{009d}\u{009c}\n 名  "
        )
        .unwrap(),
        SetTerminalTitleResult::Applied
    );
    assert_eq!(output, "\x1b]0;界 名\x07".as_bytes());
    let long = format!("{} 界", "名".repeat(MAX_TERMINAL_TITLE_CHARS - 1));
    let sanitized = sanitize_terminal_title(&long);
    assert_eq!(sanitized.chars().count(), MAX_TERMINAL_TITLE_CHARS);
    assert!(
        sanitized.ends_with('界'),
        "visible content has priority over pending whitespace"
    );
    output.clear();
    assert_eq!(
        set_terminal_title(&mut output, " \x07\u{202e}\u{feff}\u{200b}").unwrap(),
        SetTerminalTitleResult::NoVisibleContent
    );
    assert!(
        output.is_empty(),
        "invisible text must not clear someone else's title"
    );
}

#[test]
fn title_writes_are_deduplicated_and_only_managed_titles_are_cleared() {
    let mut title = ManagedTerminalTitle::default();
    let mut output = Vec::new();
    title.refresh(&mut output, None).unwrap();
    title.refresh(&mut output, Some("\u{200b}\x07")).unwrap();
    assert!(output.is_empty());
    title.refresh(&mut output, Some("界\t project")).unwrap();
    assert!(title.is_managed());
    title
        .refresh(&mut output, Some("界   project\u{202e}"))
        .unwrap();
    assert_eq!(output, "\x1b]0;界 project\x07".as_bytes());
    title.refresh(&mut output, Some("\u{200b}")).unwrap();
    assert!(!title.is_managed());
    title.refresh(&mut output, None).unwrap();
    assert_eq!(output, "\x1b]0;界 project\x07\x1b]0;\x07".as_bytes());
    title.refresh(&mut output, Some("界 project")).unwrap();
    assert!(
        title.is_managed(),
        "a successful handoff clear must allow the same title to be reapplied"
    );
}

struct FailedOutput;
impl Write for FailedOutput {
    fn write(&mut self, _: &[u8]) -> io::Result<usize> {
        Err(io::Error::other("terminal unavailable"))
    }
    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

#[test]
fn failed_set_and_clear_preserve_the_last_acknowledged_title_for_retry() {
    let mut title = ManagedTerminalTitle::default();
    assert!(title.refresh(&mut FailedOutput, Some("project")).is_err());
    assert!(!title.is_managed());
    let mut output = Vec::new();
    title.refresh(&mut output, Some("project")).unwrap();
    assert!(title.refresh(&mut FailedOutput, None).is_err());
    assert!(title.is_managed());
    title.refresh(&mut output, None).unwrap();
    assert!(!title.is_managed());
    assert_eq!(output, b"\x1b]0;project\x07\x1b]0;\x07");
}
