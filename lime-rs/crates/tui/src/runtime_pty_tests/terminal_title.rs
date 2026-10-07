//! Observe actual OSC 0 payloads; a visible footer cannot prove a terminal tab title.

use super::*;

fn titles(output: &str) -> impl Iterator<Item = &str> {
    output.match_indices("\x1b]0;").filter_map(|(index, _)| {
        output[index + 4..]
            .split_once('\x07')
            .map(|(title, _)| title)
    })
}

pub(super) fn latest_title(output: &str) -> Option<&str> {
    titles(output).last()
}

pub(super) fn wait_for_title(
    output_rx: &mpsc::Receiver<Vec<u8>>,
    output: &mut String,
    scenario: &str,
    matches: impl Fn(&str) -> bool,
) {
    let deadline = Instant::now() + Duration::from_secs(10);
    while !latest_title(output).is_some_and(&matches) {
        let remaining = deadline.saturating_duration_since(Instant::now());
        assert!(
            !remaining.is_zero(),
            "timed out: {scenario}; actual title {:?}",
            latest_title(output)
        );
        let chunk = output_rx.recv_timeout(remaining).unwrap_or_else(|error| {
            panic!(
                "PTY unavailable: {scenario}; {error}; actual title {:?}",
                latest_title(output)
            )
        });
        output.push_str(&String::from_utf8_lossy(&chunk));
    }
}

pub(super) fn wait_for_idle(output_rx: &mpsc::Receiver<Vec<u8>>, output: &mut String, cwd: &Path) {
    let project = cwd.file_name().unwrap().to_string_lossy();
    wait_for_title(
        output_rx,
        output,
        "idle terminal title uses the real cwd without activity",
        |title| title == project,
    );
}

pub(super) fn wait_for_running(output_rx: &mpsc::Receiver<Vec<u8>>, output: &mut String) {
    wait_for_title(
        output_rx,
        output,
        "canonical active turn emits a terminal-title spinner",
        |title| {
            title
                .chars()
                .next()
                .is_some_and(|ch| "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏".contains(ch))
        },
    );
}

pub(super) fn wait_for_action_required(output_rx: &mpsc::Receiver<Vec<u8>>, output: &mut String) {
    wait_for_title(
        output_rx,
        output,
        "pending canonical request replaces activity with Action required",
        |title| {
            title.starts_with("[ ! ] Action required") || title.starts_with("[ . ] Action required")
        },
    );
}

pub(super) fn wait_for_named_thread(
    output_rx: &mpsc::Receiver<Vec<u8>>,
    output: &mut String,
    name: &str,
) {
    wait_for_title(
        output_rx,
        output,
        "terminal title follows the current canonical thread name",
        |title| title.contains(name),
    );
}

pub(super) fn assert_cleared_on_exit(output: &str) {
    assert_eq!(
        latest_title(output),
        Some(""),
        "terminal exit must clear the title managed by this process"
    );
}

pub(super) fn assert_external_editor_handoff(output: &str) {
    let marker = output
        .find("EDITOR_JOB_CONTROL_OK")
        .expect("external editor marker");
    assert_eq!(
        latest_title(&output[..marker]),
        Some(""),
        "external editor must not inherit our managed title"
    );
    assert!(titles(&output[marker..]).any(|title| !title.is_empty()), "returning from the external editor must reapply the title even when context did not change");
}
