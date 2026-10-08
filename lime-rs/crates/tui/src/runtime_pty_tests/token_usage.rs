//! Canonical provider usage crosses the real stdio bridge before appearing on each TUI surface.

use super::*;
use lime_core::config::ConfigManager;

pub(super) fn exercise_shared_usage(
    writer: &mut Box<dyn Write + Send>,
    output_rx: &mpsc::Receiver<Vec<u8>>,
    output: &mut String,
    ledger_path: &Path,
    config_path: &Path,
) {
    eprintln!("TUI_USAGE phase=status-pager");
    let ledger_before = std::fs::read_to_string(ledger_path).unwrap();
    let saved = ConfigManager::load(config_path)
        .unwrap()
        .config()
        .tui
        .clone();
    let saved_title = terminal_title::latest_title(output).unwrap().to_string();
    let usage_title = format!("{saved_title} | 31K used | Context 84% left");
    config::open_setup(writer, "status");
    wait_for_screen(
        output_rx,
        output,
        "status pager displays server totals and latest context",
        |screen| {
            screen.contains("31K used")
                && screen.contains("155K in")
                && screen.contains("6K out")
                && screen.contains("128K window")
                && screen.contains("Context 84% left")
                && screen.contains("Context 16% used")
        },
    );
    writer.write_all(b"\x1b").unwrap();
    writer.flush().unwrap();
    wait_for_screen(output_rx, output, "close usage status pager", |screen| {
        !screen.contains("Used tokens:")
    });

    config::open_setup(writer, "statusline");
    eprintln!("TUI_USAGE phase=status-line");
    wait_for_screen(
        output_rx,
        output,
        "open usage status-line setup",
        |screen| screen.contains("Configure status line"),
    );
    for name in ["Context remaining", "Used tokens"] {
        config::toggle_setup_item(writer, name, true);
    }
    wait_for_screen(
        output_rx,
        output,
        "usage setup previews canonical values",
        |screen| screen.contains("31K used") && screen.contains("Context 84% left"),
    );
    writer.write_all(b"\x1b[20~").unwrap();
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "footer displays canonical usage and context",
        |screen| {
            !screen.contains("Configure status line")
                && screen
                    .lines()
                    .last()
                    .unwrap_or_default()
                    .contains("31K used · Context 84% left")
        },
    );

    for save in [false, true] {
        eprintln!("TUI_USAGE phase=title save={save}");
        config::open_setup(writer, "title");
        wait_for_screen(output_rx, output, "open usage title setup", |screen| {
            screen.contains("Configure terminal title")
        });
        for name in ["Used tokens", "Context remaining"] {
            config::toggle_setup_item(writer, name, false);
        }
        terminal_title::wait_for_title(
            output_rx,
            output,
            "OSC preview uses the same canonical usage",
            |title| title == usage_title,
        );
        writer
            .write_all(if save { b"\x1b[20~" } else { b"\x18q" })
            .unwrap();
        writer.flush().unwrap();
        wait_for_screen(output_rx, output, "close usage title setup", |screen| {
            !screen.contains("Configure terminal title")
        });
        terminal_title::wait_for_title(
            output_rx,
            output,
            "usage title cancel restores or save acknowledges",
            |title| title == if save { &usage_title } else { &saved_title },
        );
    }
    let selected = ConfigManager::load(config_path)
        .unwrap()
        .config()
        .tui
        .clone();
    assert_eq!(
        &selected.status_line.as_ref().unwrap()[..2],
        &["used-tokens", "context-remaining"]
    );
    assert!(selected
        .terminal_title
        .as_ref()
        .unwrap()
        .ends_with(&["used-tokens".into(), "context-remaining".into()]));
    config::assert_fresh_stdio_settings(&selected);
    eprintln!("TUI_USAGE phase=restore");
    for command in ["title", "statusline"] {
        config::open_setup(writer, command);
        let title = if command == "title" {
            "Configure terminal title"
        } else {
            "Configure status line"
        };
        wait_for_screen(
            output_rx,
            output,
            "remove usage selection through current setup",
            |screen| screen.contains(title),
        );
        for name in ["Used tokens", "Context remaining"] {
            config::toggle_setup_item(writer, name, false);
        }
        writer.write_all(b"\x1b[20~").unwrap();
        writer.flush().unwrap();
        wait_for_screen(output_rx, output, "usage selection restored", |screen| {
            !screen.contains(title)
        });
    }
    terminal_title::wait_for_title(
        output_rx,
        output,
        "usage removal restores saved OSC",
        |title| title == saved_title,
    );
    assert_eq!(
        ConfigManager::load(config_path).unwrap().config().tui,
        saved
    );
    assert_eq!(
        std::fs::read_to_string(ledger_path).unwrap(),
        ledger_before,
        "usage configuration must not create a canonical turn"
    );
}
