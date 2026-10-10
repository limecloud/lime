//! Real PTY selection drives managed OSC; shared config reloads through fresh stdio.

use super::*;
use lime_core::config::ConfigManager;

pub(super) fn exercise_preview_save_and_cancel(
    master: &dyn portable_pty::MasterPty,
    writer: &mut Box<dyn Write + Send>,
    output_rx: &mpsc::Receiver<Vec<u8>>,
    output: &mut String,
    ledger_path: &Path,
    completed_text: &str,
    config_path: &Path,
) {
    let ledger_before = std::fs::read_to_string(ledger_path).unwrap();
    let initial = ConfigManager::load(config_path)
        .unwrap()
        .config()
        .tui
        .clone();
    let initial_title = terminal_title::latest_title(output).unwrap().to_string();
    let preview_title = format!("lime | {initial_title}");
    let open = |writer: &mut Box<dyn Write + Send>| {
        writer.write_all(b"\x1b[200~/title\x1b[201~\r").unwrap();
        writer.flush().unwrap();
    };
    let ordered_preview = |writer: &mut Box<dyn Write + Send>| {
        // Enable App name, then move it before activity/thread-name/project-name.
        writer
            .write_all(b"\x1b[B\x1b[B\x1b[B \x1b[D\x1b[D\x1b[D")
            .unwrap();
        writer.flush().unwrap();
    };
    open(writer);
    wait_for_screen(
        output_rx,
        output,
        "title setup shows configured controls and real preview",
        |screen| {
            screen.contains("Configure terminal title")
                && screen.contains("f9 save")
                && screen.contains("ctrl+x q back")
                && screen.contains(completed_text)
        },
    );
    ordered_preview(writer);
    terminal_title::wait_for_title(
        output_rx,
        output,
        "ordered title selection previews real OSC before saving",
        |title| title == preview_title,
    );
    assert_eq!(
        ConfigManager::load(config_path).unwrap().config().tui,
        initial,
        "preview must never persist preferences"
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
        "narrow title setup keeps the full cancel chord",
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
        "title setup reflows after resize",
        |screen| screen.contains("f9 save · ctrl+x q back"),
    );
    // Enter is unbound; the full cancel chord must still restore the saved title.
    writer.write_all(b"\r\x18q").unwrap();
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "cancel restores saved title selection without writing",
        |screen| !screen.contains("Configure terminal title") && screen.contains(completed_text),
    );
    terminal_title::wait_for_title(
        output_rx,
        output,
        "cancel restores actual managed OSC",
        |title| title == initial_title,
    );
    assert_eq!(
        ConfigManager::load(config_path).unwrap().config().tui,
        initial
    );

    open(writer);
    wait_for_screen(
        output_rx,
        output,
        "title setup reopens after cancel",
        |screen| screen.contains("Configure terminal title"),
    );
    ordered_preview(writer);
    writer.write_all(b"\x1b[20~").unwrap();
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "F9 saves ordered terminal title",
        |screen| {
            !screen.contains("Configure terminal title") && screen.contains("Terminal title saved")
        },
    );
    terminal_title::wait_for_title(
        output_rx,
        output,
        "saved ordered title stays applied",
        |title| title == preview_title,
    );
    let saved = ConfigManager::load(config_path)
        .unwrap()
        .config()
        .tui
        .clone();
    assert_eq!(
        saved.terminal_title,
        Some(vec![
            "app-name".into(),
            "activity".into(),
            "thread-name".into(),
            "project-name".into()
        ])
    );
    assert_eq!(
        saved.status_line, initial.status_line,
        "title writes preserve status-line settings"
    );
    config::assert_fresh_stdio_settings(&saved);

    open(writer);
    wait_for_screen(
        output_rx,
        output,
        "saved title ordering and checkboxes reopen",
        |screen| screen.contains("Configure terminal title") && screen.contains("[x] App name"),
    );
    writer.write_all(b" \x1b[B \x1b[B \x1b[B \x1b[20~").unwrap();
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "explicit empty title is saved",
        |screen| {
            !screen.contains("Configure terminal title") && screen.contains("Terminal title saved")
        },
    );
    terminal_title::wait_for_title(
        output_rx,
        output,
        "explicit empty selection clears managed OSC",
        |title| title.is_empty(),
    );
    let empty = ConfigManager::load(config_path)
        .unwrap()
        .config()
        .tui
        .clone();
    assert_eq!(empty.terminal_title, Some(vec![]));
    config::assert_fresh_stdio_settings(&empty);
    open(writer);
    wait_for_screen(
        output_rx,
        output,
        "empty title survives reopening",
        |screen| screen.contains("Configure terminal title") && screen.contains("[ ] App name"),
    );
    writer.write_all(b" \x03").unwrap();
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "Ctrl-C closes title setup without exiting",
        |screen| !screen.contains("Configure terminal title") && screen.contains(completed_text),
    );
    terminal_title::wait_for_title(
        output_rx,
        output,
        "Ctrl-C restores the saved disabled title",
        |title| title.is_empty(),
    );
    assert_eq!(
        ConfigManager::load(config_path).unwrap().config().tui,
        empty
    );

    // Restore default items/order through the same product picker for later fixture scenarios.
    open(writer);
    wait_for_screen(
        output_rx,
        output,
        "restore default title selection",
        |screen| screen.contains("Configure terminal title"),
    );
    writer.write_all(b"\x1b[B\x1b[B\x1b[B \x1b[D\x1b[D\x1b[D\x1b[B\x1b[B\x1b[B\x1b[B\x1b[B \x1b[D\x1b[D\x1b[D\x1b[D\x1b[B\x1b[B \x1b[D\x1b[20~").unwrap();
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "default title selection restored",
        |screen| {
            !screen.contains("Configure terminal title") && screen.contains("Terminal title saved")
        },
    );
    terminal_title::wait_for_title(output_rx, output, "default title OSC restored", |title| {
        title == initial_title
    });
    assert_eq!(
        ConfigManager::load(config_path)
            .unwrap()
            .config()
            .tui
            .terminal_title,
        Some(vec![
            "activity".into(),
            "thread-name".into(),
            "project-name".into()
        ])
    );
    assert_eq!(
        std::fs::read_to_string(ledger_path).unwrap(),
        ledger_before,
        "title interaction must not create a canonical turn"
    );
}
