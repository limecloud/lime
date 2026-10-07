//! Shared user-config transport; the terminal never reads or writes config files itself.

use super::AppServerSession;
use anyhow::{Context, Result};
use app_server_protocol::protocol::v2::{
    ConfigBatchWriteParams, ConfigReadParams, ConfigReadResponse, ConfigWriteResponse,
    METHOD_CONFIG_BATCH_WRITE, METHOD_CONFIG_READ,
};

impl AppServerSession {
    pub(crate) async fn read_config(&self) -> Result<ConfigReadResponse> {
        self.request_handle
            .request(
                METHOD_CONFIG_READ,
                ConfigReadParams {
                    include_layers: true,
                    ..Default::default()
                },
            )
            .await
            .context("failed to read TUI settings through App Server config/read")
    }

    pub(crate) async fn write_config_batch(
        &self,
        params: ConfigBatchWriteParams,
    ) -> Result<ConfigWriteResponse> {
        self.request_handle
            .request(METHOD_CONFIG_BATCH_WRITE, params)
            .await
            .context("App Server config/batchWrite failed")
    }
}
