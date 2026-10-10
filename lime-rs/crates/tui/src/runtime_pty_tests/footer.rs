//! Ordinary footer context is observed after typed usage crosses the real stdio boundary.

use super::*;
use crate::bottom_pane::status_line_setup::StatusLineItem;
use crate::locale::Locale;
use lime_core::config::ConfigManager;

pub(super) fn exercise_context_and_canonical_config(
    master: &dyn portable_pty::MasterPty,
    writer: &mut Box<dyn Write + Send>,
    output_rx: &mpsc::Receiver<Vec<u8>>,
    output: &mut String,
    ledger_path: &Path,
    config_path: &Path,
) {
    eprintln!("TUI_FOOTER phase=ordinary-context");
    let ledger = std::fs::read_to_string(ledger_path).unwrap();
    let first_turn: serde_json::Value =
        serde_json::from_str(ledger.lines().next().unwrap()).unwrap();
    let thread_id = first_turn["threadId"].as_str().unwrap();
    let saved = ConfigManager::load(config_path)
        .unwrap()
        .config()
        .tui
        .clone();
    config::open_setup(writer, "statusline");
    wait_for_screen(
        output_rx,
        output,
        "disable passive status through current UI",
        |screen| screen.contains("Configure status line"),
    );
    for name in ["Model with reasoning", "working directory", "Thread name"] {
        config::toggle_setup_item(writer, output_rx, output, name, false);
    }
    writer.write_all(b"\x1b[20~").unwrap();
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "ordinary footer displays true remaining context",
        |screen| {
            let footer = screen.lines().last().unwrap_or_default();
            !screen.contains("Configure status line")
                && footer.contains("? for shortcuts")
                && footer.trim_end().ends_with("84% context left")
        },
    );
    assert_eq!(
        ConfigManager::load(config_path)
            .unwrap()
            .config()
            .tui
            .status_line,
        Some(vec![])
    );

    terminal_observer::resize(output, 24, 16);
    master
        .resize(PtySize {
            rows: 24,
            cols: 16,
            pixel_width: 0,
            pixel_height: 0,
        })
        .unwrap();
    wait_for_screen(
        output_rx,
        output,
        "narrow footer omits context instead of clipping it",
        |screen| {
            screen.lines().any(|line| line.trim() == "› Ask Lime to d")
                && !screen.contains("84% context left")
        },
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
        "context reappears after terminal resize",
        |screen| {
            screen
                .lines()
                .last()
                .unwrap_or_default()
                .trim_end()
                .ends_with("84% context left")
        },
    );

    writer.write_all(b"?").unwrap();
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "shortcut overlay owns footer without context leakage",
        |screen| {
            screen.contains("Keyboard shortcuts")
                && !screen
                    .lines()
                    .last()
                    .unwrap_or_default()
                    .contains("context")
        },
    );
    writer.write_all(b"\x1b").unwrap();
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "closing shortcuts restores ordinary context",
        |screen| {
            !screen.contains("Keyboard shortcuts")
                && screen
                    .lines()
                    .last()
                    .unwrap_or_default()
                    .trim_end()
                    .ends_with("84% context left")
        },
    );
    config::open_setup(writer, "vim");
    wait_for_screen(
        output_rx,
        output,
        "context and Vim are one right-aligned group",
        |screen| {
            screen
                .lines()
                .last()
                .unwrap_or_default()
                .trim_end()
                .ends_with("84% context left | Vim: Normal")
        },
    );
    writer.write_all(b"i\x1b[200~usage\x1b[201~\x1b").unwrap();
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "nonempty Vim draft is ready for footer search",
        |screen| {
            screen.lines().any(|line| line.trim() == "› usage") && screen.contains("Vim: Normal")
        },
    );
    writer.write_all(b"/usage").unwrap();
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "Vim query owns the footer instead of token context",
        |screen| {
            let footer = screen.lines().last().unwrap_or_default();
            footer.contains("/usage") && !footer.contains("context")
        },
    );
    writer.write_all(b"\x1b").unwrap();
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "cancelling Vim query restores context",
        |screen| {
            screen
                .lines()
                .last()
                .unwrap_or_default()
                .trim_end()
                .ends_with("84% context left | Vim: Normal")
        },
    );
    writer.write_all(b"i\x05\x15\x1b").unwrap();
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "footer search draft is cleared without submission",
        |screen| screen.contains("Ask Lime to do anything") && screen.contains("Vim: Normal"),
    );
    config::open_setup(writer, "vim");
    wait_for_screen(
        output_rx,
        output,
        "disable Vim without creating a turn",
        |screen| {
            let footer = screen.lines().last().unwrap_or_default();
            !footer.contains("Vim:") && footer.trim_end().ends_with("84% context left")
        },
    );

    eprintln!("TUI_FOOTER phase=canonical-config");
    config::open_setup(writer, "statusline");
    wait_for_screen(
        output_rx,
        output,
        "select canonical state and thread fields",
        |screen| screen.contains("Configure status line"),
    );
    for item in [StatusLineItem::Status, StatusLineItem::SessionId] {
        config::toggle_setup_item(
            writer,
            output_rx,
            output,
            Locale::EnUs.status_line_item_name(item),
            false,
        );
    }
    writer.write_all(b"\x1b[20~").unwrap();
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "passive state and thread display suppress duplicate context",
        |screen| {
            let footer = screen.lines().last().unwrap_or_default();
            !screen.contains("Configure status line")
                && footer.contains(&Locale::EnUs.status("ready"))
                && footer.contains(thread_id)
                && footer.contains(" · ")
                && !footer.contains("context")
        },
    );
    let selected = ConfigManager::load(config_path)
        .unwrap()
        .config()
        .tui
        .clone();
    assert_eq!(
        selected.status_line,
        Some(vec!["run-state".into(), "thread-id".into()])
    );
    config::assert_fresh_stdio_settings(&selected);
    config::open_setup(writer, "statusline");
    wait_for_screen(
        output_rx,
        output,
        "restore original status facts through current UI",
        |screen| screen.contains("Configure status line"),
    );
    for item in [StatusLineItem::Status, StatusLineItem::SessionId] {
        config::toggle_setup_item(
            writer,
            output_rx,
            output,
            Locale::EnUs.status_line_item_name(item),
            false,
        );
        let checkbox = format!("[ ] {}", Locale::EnUs.status_line_item_name(item));
        wait_for_screen(
            output_rx,
            output,
            "canonical item disabled before restoring defaults",
            |screen| screen.contains(&checkbox),
        );
    }
    for name in ["Thread name", "working directory", "Model with reasoning"] {
        config::toggle_setup_item(writer, output_rx, output, name, true);
        let checkbox = format!("[x] {name}");
        wait_for_screen(
            output_rx,
            output,
            "default item visibly restored before saving",
            |screen| screen.contains(&checkbox),
        );
    }
    writer.write_all(b"\x1b[20~").unwrap();
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "original passive footer restored",
        |screen| {
            let footer = screen.lines().last().unwrap_or_default();
            !screen.contains("Configure status line")
                && !footer.contains("context")
                && footer.contains(" · ")
        },
    );
    assert_eq!(
        ConfigManager::load(config_path).unwrap().config().tui,
        saved
    );
    assert_eq!(
        std::fs::read_to_string(ledger_path).unwrap(),
        ledger,
        "footer/config interaction must not create a canonical turn"
    );
}
