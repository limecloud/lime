//! Drives Codex-shaped resize/reflow scenarios through Lime's real PTY host.
//!
//! Codex uses tmux and a locally built binary for these cases. Lime has no tmux
//! dependency in its current product path, so the equivalent evidence uses the
//! portable-pty master to deliver real window-size changes to the same TUI
//! process and checks the VT100 projection after each resize.

use std::path::PathBuf;
use std::time::Duration;

use super::focus_palette::PtyLime;
use anyhow::{ensure, Result};

const RESIZE_TIMEOUT: Duration = Duration::from_secs(5);
const DRAFT: &str = "resize reflow draft sentinel";
const DRAFT_INPUT_TAIL: &str = "resize input tail 7391";

#[test]
fn tmux_split_preserves_fresh_session_composer_row_after_resize_reflow() -> Result<()> {
    if !gate_enabled() {
        return Ok(());
    }
    run_resize_case(|terminal| {
        terminal.resize(14, 60)?;
        terminal.wait_for_screen_compact_contains(DRAFT, RESIZE_TIMEOUT)?;
        ensure!(
            terminal.screen_size() == (14, 60),
            "VT100 screen did not adopt resized dimensions: {:?}\nscreen:\n{}",
            terminal.screen_size(),
            terminal.screen_contents()
        );
        Ok(())
    })
}

#[test]
fn tmux_repeated_resizes_do_not_push_composer_down() -> Result<()> {
    if !gate_enabled() {
        return Ok(());
    }
    let mut terminal = start_terminal()?;
    terminal.write_input(DRAFT.as_bytes())?;

    for (rows, cols) in [(14, 60), (20, 90), (10, 44), (32, 120), (18, 72)] {
        terminal.resize(rows, cols)?;
        terminal.wait_for_screen_compact_contains(DRAFT, RESIZE_TIMEOUT)?;
        ensure!(
            terminal.screen_size() == (rows, cols),
            "VT100 screen did not adopt resize {rows}x{cols}: {:?}\nscreen:\n{}",
            terminal.screen_size(),
            terminal.screen_contents()
        );
    }
    quit_terminal(&mut terminal)
}

#[test]
fn tmux_width_resize_restore_keeps_visible_content_anchored() -> Result<()> {
    if !gate_enabled() {
        return Ok(());
    }
    let mut terminal = start_terminal()?;
    terminal.write_input(DRAFT.as_bytes())?;
    terminal.wait_for_screen_compact_contains(DRAFT, RESIZE_TIMEOUT)?;
    let baseline_size = terminal.screen_size();

    terminal.resize(32, 60)?;
    terminal.wait_for_screen_compact_contains(DRAFT, RESIZE_TIMEOUT)?;
    terminal.resize(32, 120)?;
    terminal.wait_for_screen_compact_contains(DRAFT, RESIZE_TIMEOUT)?;
    ensure!(
        terminal.screen_size() == baseline_size,
        "terminal size did not restore after width resize: baseline={baseline_size:?}, restored={:?}\n{}",
        terminal.screen_size(),
        terminal.screen_contents()
    );
    quit_terminal(&mut terminal)
}

#[test]
fn tmux_scrolled_composer_resize_preserves_visible_draft_text() -> Result<()> {
    if !gate_enabled() {
        return Ok(());
    }
    let mut terminal = start_terminal()?;
    let long_draft = format!("{DRAFT} {DRAFT} {DRAFT} {DRAFT_INPUT_TAIL}");
    terminal.write_input(long_draft.as_bytes())?;
    terminal.wait_for_screen_compact_contains(DRAFT_INPUT_TAIL, RESIZE_TIMEOUT)?;

    terminal.resize(12, 44)?;
    terminal.wait_for_screen_compact_contains(DRAFT, RESIZE_TIMEOUT)?;
    terminal.resize(32, 120)?;
    terminal.wait_for_screen_compact_contains(DRAFT, RESIZE_TIMEOUT)?;
    ensure!(
        compact_text(&terminal.screen_contents()).contains(&compact_text(DRAFT)),
        "visible draft text was lost after narrow composer resize:\n{}",
        terminal.screen_contents()
    );
    quit_terminal(&mut terminal)
}

fn run_resize_case(mut resize: impl FnMut(&mut PtyLime) -> Result<()>) -> Result<()> {
    let mut terminal = start_terminal()?;
    terminal.write_input(DRAFT.as_bytes())?;
    terminal.wait_for_screen_compact_contains(DRAFT, RESIZE_TIMEOUT)?;
    resize(&mut terminal)?;
    quit_terminal(&mut terminal)
}

fn start_terminal() -> Result<PtyLime> {
    let cli_bin = required_test_path("LIME_TEST_CLI_BIN");
    let app_server_bin = required_test_path("LIME_TEST_APP_SERVER_BIN");
    let backend_path = required_test_path("LIME_TEST_TERMINAL_BACKEND");
    let ledger_path = required_test_path("LIME_TEST_TERMINAL_LEDGER");
    let cwd = required_test_path("LIME_TEST_TERMINAL_CWD");
    let node_bin = required_test_path("LIME_TEST_NODE_BIN");
    let mut terminal = PtyLime::start(
        &cli_bin,
        &app_server_bin,
        &backend_path,
        &ledger_path,
        &cwd,
        &node_bin,
    )?;
    terminal.wait_for_startup()?;
    Ok(terminal)
}

fn quit_terminal(terminal: &mut PtyLime) -> Result<()> {
    // The first Ctrl-C cancels the draft; observe that edit before asking the idle host to quit.
    terminal.write_input(&[3])?;
    terminal.wait_for_screen_without(DRAFT, RESIZE_TIMEOUT)?;
    terminal.wait_for_screen_compact_contains("Ask Lime to do anything", RESIZE_TIMEOUT)?;
    terminal.write_input(&[3])?;
    terminal.wait_for_exit()?;
    ensure!(
        terminal.output_contains(b"\x1b[?1049l"),
        "alternate screen was not restored after resize/reflow test"
    );
    Ok(())
}

fn gate_enabled() -> bool {
    std::env::var_os("LIME_TEST_TUI_GATE_B").is_some()
}

fn required_test_path(name: &str) -> PathBuf {
    std::env::var_os(name)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| panic!("missing {name}"))
}

fn compact_text(text: &str) -> String {
    text.chars()
        .filter(|character| !character.is_whitespace())
        .collect()
}
