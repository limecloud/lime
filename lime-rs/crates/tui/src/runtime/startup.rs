//! Initialize the terminal Host projection through the shared App Server session.

use super::connection::{connect_session, TuiOptions};
use crate::app::startup::StartupSessionState;
use crate::app::App;
use crate::app_event_sender::AppEventSender;
use crate::app_server_session::AppServerSession;
use crate::locale::Locale;
use anyhow::Result;

pub(super) struct InitializedApp {
    pub(super) app: App,
    pub(super) session: AppServerSession,
    pub(super) settings: StartupSessionState,
}

pub(super) async fn initialize_app(
    options: &TuiOptions,
    events: &AppEventSender,
) -> Result<InitializedApp> {
    let mut session = connect_session(options).await?;
    let result = async {
        let local_settings = crate::local_settings::LocalSettings::read(&session).await?;
        let mut app = App::default();
        app.chat_widget.bottom_pane.set_app_event_tx(events.clone());
        app.set_right_click_paste(local_settings.tui.right_click_paste);
        app.projection
            .set_show_raw_agent_reasoning(local_settings.show_raw_agent_reasoning);
        app.chat_widget.tui_config = local_settings.tui;
        app.chat_widget.config_version = local_settings.config_version;
        app.set_runtime_keymap(local_settings.keymap);
        if let Some(cwd) = options.cwd.as_ref() {
            app.set_cwd(cwd.clone());
        }
        app.set_locale(Locale::resolve(options.locale.as_deref()));
        app.chat_widget
            .bottom_pane
            .set_agents_navigation_enabled(options.remote.is_none());
        app.begin_startup_input_boundary();
        let settings =
            crate::app::startup::initialize_session(options, &mut session, &mut app).await?;
        if options.open_agents_overview {
            app.open_agents_overview();
            if let Err(error) = app.refresh_agents_overview_threads(&session).await {
                app.projection.set_status(error.to_string());
            }
        }
        Ok::<_, anyhow::Error>((app, settings))
    }
    .await;
    match result {
        Ok((app, settings)) => Ok(InitializedApp {
            app,
            session,
            settings,
        }),
        Err(error) => {
            let _ = session.shutdown().await;
            Err(error)
        }
    }
}
