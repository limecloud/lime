use super::*;

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
