use crate::AppDataSource;
use crate::RuntimeCoreError;
use lime_agent::AgentRuntimeState;
use std::sync::{Arc, RwLock};
use std::time::Duration;
use tokio::time::timeout;

const MCP_RUNTIME_CONFIGURATION_TIMEOUT: Duration = Duration::from_secs(2);

pub(super) async fn ensure_thread_mcp_runtime_if_available(
    agent_state: &AgentRuntimeState,
    app_data_source: &RwLock<Option<Arc<dyn AppDataSource>>>,
    session_id: &str,
    thread_id: &str,
) -> Result<(), RuntimeCoreError> {
    if !agent_state.is_initialized().await {
        return Ok(());
    }
    let app_data_source = app_data_source
        .read()
        .map_err(|_| {
            RuntimeCoreError::Backend("MCP bridge app data source lock poisoned".to_string())
        })?
        .clone();
    let Some(app_data_source) = app_data_source else {
        return Ok(());
    };
    let server_specs = match timeout(
        MCP_RUNTIME_CONFIGURATION_TIMEOUT,
        app_data_source.list_mcp_runtime_server_specs(),
    )
    .await
    {
        Ok(Ok(snapshots)) => snapshots,
        Ok(Err(error)) => {
            tracing::warn!(
                error = %error,
                "[RuntimeBackend] MCP runtime 配置读取失败，继续执行主模型回合"
            );
            return Ok(());
        }
        Err(_) => {
            tracing::warn!(
                timeout_secs = MCP_RUNTIME_CONFIGURATION_TIMEOUT.as_secs(),
                "[RuntimeBackend] MCP runtime 配置读取超时，继续执行主模型回合"
            );
            return Ok(());
        }
    };
    agent_state
        .ensure_mcp_runtime(
            app_data_source.mcp_oauth_store_root(),
            session_id.to_string(),
            thread_id.to_string(),
            app_data_source.mcp_elicitation_router(),
            server_specs,
        )
        .await
        .map_err(|error| RuntimeCoreError::Backend(error.to_string()))
}
