//! Shared optimistic config writes for client status surfaces; no private preference store.

use super::App;
use crate::app_server_session::AppServerSession;
use app_server_protocol::protocol::v2::{ConfigBatchWriteParams, ConfigEdit};

impl App {
    pub(super) async fn write_tui_preferences(
        &mut self,
        session: &AppServerSession,
        edits: Vec<ConfigEdit>,
    ) -> anyhow::Result<String> {
        let Some(version) = self.chat_widget.config_version.clone() else {
            anyhow::bail!("App Server user config version unavailable");
        };
        match session
            .write_config_batch(ConfigBatchWriteParams {
                edits,
                file_path: None,
                expected_version: Some(version),
                reload_user_config: true,
            })
            .await
        {
            Ok(response) => Ok(response.version),
            Err(error) => {
                // Recover the shared version for another explicit attempt; never auto-retry a conflicting write.
                if let Ok(settings) = crate::local_settings::LocalSettings::read(session).await {
                    self.chat_widget.tui_config = settings.tui;
                    self.chat_widget.config_version = settings.config_version;
                }
                Err(error)
            }
        }
    }
}
