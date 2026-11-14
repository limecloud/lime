use super::RuntimeBackend;
use crate::runtime::PluginTurnSnapshot;
use crate::{AppDataSource, RuntimeCoreError};
use std::sync::Arc;
use tool_runtime::hook_source::{
    PluginHookLoadFuture, PluginHookSourceProvider, PluginHookSourceProviderHandle,
};

impl RuntimeBackend {
    pub(super) async fn current_plugin_turn_snapshots(
        &self,
    ) -> Result<Vec<PluginTurnSnapshot>, RuntimeCoreError> {
        let Some(app_data_source) = self.current_app_data_source()? else {
            return Ok(Vec::new());
        };
        app_data_source.list_enabled_plugin_turn_snapshots().await
    }
}

pub(super) fn source(
    data: Option<Arc<dyn AppDataSource>>,
) -> Option<PluginHookSourceProviderHandle> {
    data.map(|data| PluginHookSourceProviderHandle::new(Arc::new(CurrentPluginHookSource { data })))
}

struct CurrentPluginHookSource {
    data: Arc<dyn AppDataSource>,
}

impl PluginHookSourceProvider for CurrentPluginHookSource {
    fn load(&self) -> PluginHookLoadFuture<'_> {
        Box::pin(async move {
            self.data
                .load_plugin_hooks()
                .await
                .map_err(|error| error.to_string())
        })
    }
}
