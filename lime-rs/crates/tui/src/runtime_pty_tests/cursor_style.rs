//! Observe the latest real DECSCUSR command; screen text cannot prove a terminal cursor shape.

use super::*;

fn latest_style(output: &str) -> Option<u8> {
    output.rmatch_indices("\x1b[").find_map(|(index, _)| {
        let (style, _) = output[index + 2..].split_once(" q")?;
        style.parse().ok()
    })
}

pub(super) fn wait_for_style(
    output_rx: &mpsc::Receiver<Vec<u8>>,
    output: &mut String,
    expected: u8,
    scenario: &str,
) {
    let deadline = Instant::now() + Duration::from_secs(10);
    while latest_style(output) != Some(expected) {
        let remaining = deadline.saturating_duration_since(Instant::now());
        assert!(
            !remaining.is_zero(),
            "timed out: {scenario}; expected cursor style {expected}, actual {:?}",
            latest_style(output)
        );
        let chunk = output_rx.recv_timeout(remaining).unwrap_or_else(|error| {
            panic!("PTY unavailable: {scenario}; {error}; expected cursor style {expected}, actual {:?}", latest_style(output))
        });
        output.push_str(&String::from_utf8_lossy(&chunk));
    }
}

pub(super) fn assert_default_restored(output: &str) {
    assert_eq!(
        latest_style(output),
        Some(0),
        "terminal exit must restore the user's default cursor shape"
    );
}

pub(super) fn assert_default_before_editor(output: &str) {
    let marker = output
        .find("EDITOR_JOB_CONTROL_OK")
        .expect("external editor marker");
    assert_eq!(
        latest_style(&output[..marker]),
        Some(0),
        "external editor must inherit the user's default cursor shape"
    );
}
