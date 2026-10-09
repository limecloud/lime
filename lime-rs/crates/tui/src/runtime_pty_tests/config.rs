use super::*;

pub(super) fn open_setup(writer: &mut Box<dyn Write + Send>, command: &str) {
    writer
        .write_all(format!("\x1b[200~/{command}\x1b[201~\r").as_bytes())
        .unwrap();
    writer.flush().unwrap();
}

pub(super) fn toggle_setup_item(
    writer: &mut Box<dyn Write + Send>,
    output_rx: &mpsc::Receiver<Vec<u8>>,
    output: &mut String,
    name: &str,
    move_first: bool,
) {
    let unchecked = format!("› [ ] {name}");
    let checked = format!("› [x] {name}");
    writer
        .write_all(format!("\x1b[200~{name}\x1b[201~").as_bytes())
        .unwrap();
    writer.flush().unwrap();
    let screen = wait_for_screen(
        output_rx,
        output,
        &format!("filter setup item {name}"),
        |screen| {
            screen.lines().any(|line| line.trim() == name)
                && screen
                    .lines()
                    .any(|line| line.starts_with(&unchecked) || line.starts_with(&checked))
        },
    );
    let toggled = if screen.lines().any(|line| line.starts_with(&checked)) {
        &unchecked
    } else {
        &checked
    };
    writer.write_all(b" ").unwrap();
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        &format!("toggle setup item {name}"),
        |screen| screen.lines().any(|line| line.starts_with(toggled)),
    );
    for remaining in (0..name.chars().count()).rev() {
        writer.write_all(b"\x7f").unwrap();
        writer.flush().unwrap();
        if remaining > 0 {
            let filter = name.chars().take(remaining).collect::<String>();
            wait_for_screen(
                output_rx,
                output,
                &format!("delete setup filter character {name}"),
                |screen| screen.lines().any(|line| line.trim() == filter.trim()),
            );
        }
    }
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        &format!("clear setup filter {name}"),
        |screen| {
            screen.contains("←/→ reorder") && screen.lines().any(|line| line.starts_with(toggled))
        },
    );
    if move_first {
        let item_count = crate::bottom_pane::status_line_setup::StatusLineItem::ALL
            .len()
            .max(crate::bottom_pane::title_setup::TerminalTitleItem::ALL.len());
        for _ in 0..item_count {
            writer.write_all(b"\x1b[D").unwrap();
        }
        writer.flush().unwrap();
        wait_for_screen(
            output_rx,
            output,
            &format!("move setup item {name} first"),
            |screen| {
                screen
                    .lines()
                    .find(|line| line.contains("[x] ") || line.contains("[ ] "))
                    .is_some_and(|line| line.starts_with(toggled))
            },
        );
    }
}

pub(super) fn assert_fresh_stdio_settings(expected: &lime_core::config::TuiConfig) {
    use crate::app_server_session::AppServerSession;
    use crate::local_settings::LocalSettings;
    use app_server_client::StdioTransportConfig;
    let isolated = tempfile::tempdir().unwrap();
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap()
        .block_on(async {
            let mut session = AppServerSession::connect(StdioTransportConfig {
                app_server_bin: required_test_path("LIME_TEST_APP_SERVER_BIN"),
                args: vec![
                    "--stdio".into(),
                    "--backend".into(),
                    "unavailable".into(),
                    "--data-dir".into(),
                    isolated.path().join("data").into_os_string(),
                    "--app-data-dir".into(),
                    isolated.path().join("app-data").into_os_string(),
                ],
            })
            .await
            .expect("fresh real App Server initializes for config reload");
            let settings = LocalSettings::read(&session)
                .await
                .expect("fresh config/read snapshot");
            assert_eq!(
                &settings.tui, expected,
                "fresh App Server and LocalSettings must retain the saved selection and colors"
            );
            assert!(settings.config_version.is_some());
            let mut app = crate::app::App::default();
            app.chat_widget.tui_config = settings.tui.clone();

            let (mcp_login_tx, _rx) = tokio::sync::mpsc::unbounded_channel();
            for action in [
                crate::app::AppAction::StatusLineSetup {
                    items: vec![],
                    use_colors: true,
                },
                crate::app::AppAction::TerminalTitleSetup { items: vec![] },
            ] {
                app.chat_widget.config_version = Some("stale-version".into());
                app.handle_event(
                    action,
                    crate::app::event_dispatch::EventContext {
                        session: &mut session,
                        mcp_login_tx: &mcp_login_tx,
                    },
                )
                .await
                .unwrap();
                assert!(app.projection.status().contains("modified since last read"));
                assert_eq!(
                    &app.chat_widget.tui_config, expected,
                    "conflicting TUI write must preserve the shared preferences"
                );
                assert_eq!(
                    app.chat_widget.config_version, settings.config_version,
                    "conflict must recover the latest shared version for an explicit retry"
                );
                assert_eq!(
                    &LocalSettings::read(&session).await.unwrap().tui,
                    expected,
                    "conflict must not partially persist colors or selection"
                );
            }
            session.shutdown().await.unwrap();
        });
}
