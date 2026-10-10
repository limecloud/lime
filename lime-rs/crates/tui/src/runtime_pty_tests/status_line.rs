use super::*;
use lime_core::config::ConfigManager;

pub(super) fn exercise_selection_save_and_cancel(
    master: &dyn portable_pty::MasterPty,
    writer: &mut Box<dyn Write + Send>,
    output_rx: &mpsc::Receiver<Vec<u8>>,
    output: &mut String,
    ledger_path: &Path,
    completed_text: &str,
    config_path: &Path,
) {
    let starts_before = std::fs::read_to_string(ledger_path).unwrap();
    let open = |writer: &mut Box<dyn Write + Send>| {
        writer
            .write_all(b"\x1b[200~/statusline\x1b[201~\r")
            .unwrap();
        writer.flush().unwrap();
    };
    open(writer);
    wait_for_screen(
        output_rx,
        output,
        "status-line setup shows real preview and configured controls",
        |screen| {
            screen.contains("Configure status line")
                && screen.contains("Preview:")
                && screen.contains("f9 save")
                && screen.contains("ctrl+x q back")
                && screen.contains(completed_text)
        },
    );
    // Explicitly clear the three default items, then disable theme colors.
    writer.write_all(b" \x1b[B \x1b[B \x1b[F ").unwrap();
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "empty selection previews no invented status facts",
        |screen| {
            screen.contains("[ ] Use theme colors")
                && screen
                    .lines()
                    .last()
                    .is_some_and(|line| line.trim() == "Preview:")
        },
    );
    writer.write_all(b"\x1b[20~").unwrap();
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "saved empty status line restores ordinary shortcuts",
        |screen| {
            !screen.contains("Configure status line")
                && screen.contains("Status line saved")
                && screen.contains("? for shortcuts")
        },
    );
    let config = ConfigManager::load(config_path).unwrap();
    assert_eq!(config.config().tui.status_line, Some(vec![]));
    assert!(!config.config().tui.status_line_use_colors);

    open(writer);
    wait_for_screen(
        output_rx,
        output,
        "reopened setup keeps explicit empty selection",
        |screen| screen.contains("Configure status line") && screen.contains("[ ] model"),
    );
    terminal_observer::resize(output, 24, 12);
    master
        .resize(PtySize {
            rows: 24,
            cols: 12,
            pixel_width: 0,
            pixel_height: 0,
        })
        .unwrap();
    wait_for_screen(
        output_rx,
        output,
        "narrow setup keeps the complete configured cancel chord",
        |screen| screen.lines().any(|line| line.trim() == "ctrl+x q"),
    );
    terminal_observer::resize(output, 24, 100);
    master
        .resize(PtySize {
            rows: 24,
            cols: 100,
            pixel_width: 0,
            pixel_height: 0,
        })
        .unwrap();
    wait_for_screen(
        output_rx,
        output,
        "status-line setup reflows after resize",
        |screen| screen.contains("f9 save · ctrl+x q back"),
    );
    // Unbound Enter must leave the setup open; Space enables the actual current model.
    writer.write_all(b"\r \x1b[20~").unwrap();
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "configured F9 saves the selected item",
        |screen| {
            !screen.contains("Configure status line")
                && screen.contains("Status line saved")
                && !screen
                    .lines()
                    .last()
                    .unwrap_or_default()
                    .contains("? for shortcuts")
        },
    );
    let saved = ConfigManager::load(config_path)
        .unwrap()
        .config()
        .tui
        .clone();
    assert_eq!(saved.status_line, Some(vec!["model".into()]));
    assert!(!saved.status_line_use_colors);
    config::assert_fresh_stdio_settings(&saved);
    open(writer);
    wait_for_screen(
        output_rx,
        output,
        "saved selection is checked when reopening",
        |screen| screen.contains("[x] model"),
    );
    writer.write_all(b" \x18q").unwrap();
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "configured cancel restores the saved status line without writing",
        |screen| !screen.contains("Configure status line") && screen.contains(completed_text),
    );
    assert_eq!(
        ConfigManager::load(config_path).unwrap().config().tui,
        saved
    );
    // Restore the default ordered selection through the same product UI for later scenarios.
    open(writer);
    wait_for_screen(
        output_rx,
        output,
        "restore default status-line selection",
        |screen| screen.contains("Configure status line"),
    );
    writer.write_all(b" ").unwrap();
    for name in ["Thread name", "working directory", "Model with reasoning"] {
        config::toggle_setup_item(writer, output_rx, output, name, true);
    }
    writer.write_all(b"\x1b[F \x1b[20~").unwrap();
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "restored status-line configuration saved",
        |screen| !screen.contains("Configure status line") && screen.contains("Status line saved"),
    );
    let restored = ConfigManager::load(config_path)
        .unwrap()
        .config()
        .tui
        .clone();
    assert_eq!(
        restored.status_line,
        Some(vec![
            "model-with-reasoning".into(),
            "current-dir".into(),
            "thread-name".into()
        ])
    );
    assert!(restored.status_line_use_colors);
    assert_eq!(
        std::fs::read_to_string(ledger_path).unwrap(),
        starts_before,
        "status-line interaction must not start another canonical turn"
    );
}
