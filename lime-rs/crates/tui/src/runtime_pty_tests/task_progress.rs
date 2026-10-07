//! Both status surfaces consume the canonical checklist emitted by the real App Server.

use super::*;
use lime_core::config::ConfigManager;

pub(super) fn exercise_shared_progress(
    writer: &mut Box<dyn Write + Send>,
    output_rx: &mpsc::Receiver<Vec<u8>>,
    output: &mut String,
    ledger_path: &Path,
    config_path: &Path,
) {
    let ledger_before = std::fs::read_to_string(ledger_path).unwrap();
    let saved = ConfigManager::load(config_path)
        .unwrap()
        .config()
        .tui
        .clone();
    let saved_title = terminal_title::latest_title(output).unwrap().to_string();
    let progress_title = format!("{saved_title} | Tasks 1/3");
    let open = |writer: &mut Box<dyn Write + Send>, command: &str| {
        writer
            .write_all(format!("\x1b[200~/{command}\x1b[201~\r").as_bytes())
            .unwrap();
        writer.flush().unwrap();
    };
    let toggle = |writer: &mut Box<dyn Write + Send>| {
        writer
            .write_all(b"\x1b[200~Task progress\x1b[201~ ")
            .unwrap();
        writer.flush().unwrap();
    };
    open(writer, "statusline");
    wait_for_screen(
        output_rx,
        output,
        "canonical checklist is selectable in the status-line setup",
        |screen| screen.contains("Configure status line"),
    );
    toggle(writer);
    // Move progress first through the product ordering keys so a long real cwd cannot hide it.
    for _ in 0.."Task progress".len() {
        writer.write_all(b"\x7f").unwrap();
    }
    for _ in 0..12 {
        writer.write_all(b"\x1b[D").unwrap();
    }
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "status-line preview shows typed task progress",
        |screen| screen.contains("[x] Task progress") && screen.contains("Tasks 1/3"),
    );
    writer.write_all(b"\x1b[20~").unwrap();
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "saved footer shows canonical task progress",
        |screen| {
            !screen.contains("Configure status line")
                && screen
                    .lines()
                    .last()
                    .unwrap_or_default()
                    .contains("Tasks 1/3")
        },
    );

    open(writer, "title");
    wait_for_screen(
        output_rx,
        output,
        "canonical checklist is selectable in the title setup",
        |screen| screen.contains("Configure terminal title"),
    );
    toggle(writer);
    terminal_title::wait_for_title(
        output_rx,
        output,
        "title preview uses the same typed task progress",
        |title| title == progress_title,
    );
    writer.write_all(b"\x18q").unwrap();
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "cancel task-progress title preview",
        |screen| !screen.contains("Configure terminal title"),
    );
    terminal_title::wait_for_title(
        output_rx,
        output,
        "cancel task-progress restores saved OSC",
        |title| title == saved_title,
    );

    open(writer, "title");
    wait_for_screen(
        output_rx,
        output,
        "reopen task-progress title setup",
        |screen| screen.contains("Configure terminal title"),
    );
    toggle(writer);
    writer.write_all(b"\x1b[20~").unwrap();
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "save task-progress title selection",
        |screen| {
            !screen.contains("Configure terminal title") && screen.contains("Terminal title saved")
        },
    );
    terminal_title::wait_for_title(
        output_rx,
        output,
        "saved title and footer share canonical progress",
        |title| title == progress_title,
    );
    let progress = ConfigManager::load(config_path)
        .unwrap()
        .config()
        .tui
        .clone();
    assert!(progress
        .status_line
        .as_ref()
        .unwrap()
        .iter()
        .any(|id| id == "task-progress"));
    assert_eq!(
        progress
            .status_line
            .as_ref()
            .unwrap()
            .first()
            .map(String::as_str),
        Some("task-progress")
    );
    assert!(progress
        .terminal_title
        .as_ref()
        .unwrap()
        .iter()
        .any(|id| id == "task-progress"));
    config::assert_fresh_stdio_settings(&progress);

    for command in ["title", "statusline"] {
        open(writer, command);
        let title = if command == "title" {
            "Configure terminal title"
        } else {
            "Configure status line"
        };
        wait_for_screen(
            output_rx,
            output,
            "remove task-progress selection through current setup",
            |screen| screen.contains(title),
        );
        toggle(writer);
        writer.write_all(b"\x1b[20~").unwrap();
        writer.flush().unwrap();
        wait_for_screen(
            output_rx,
            output,
            "task-progress selection restored",
            |screen| !screen.contains(title),
        );
    }
    terminal_title::wait_for_title(
        output_rx,
        output,
        "task-progress removal restores default title",
        |title| title == saved_title,
    );
    assert_eq!(
        ConfigManager::load(config_path).unwrap().config().tui,
        saved
    );
    assert_eq!(
        std::fs::read_to_string(ledger_path).unwrap(),
        ledger_before,
        "task-progress configuration must not create a canonical turn"
    );
}
