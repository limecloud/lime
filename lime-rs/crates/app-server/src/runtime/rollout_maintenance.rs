use super::canonical_rollout::RolloutCompressionTrigger;
use super::{RuntimeCore, RuntimeCoreError};

impl RuntimeCore {
    pub(crate) fn compress_rollouts(&self) -> Result<(), RuntimeCoreError> {
        self.spawn_rollout_compression_worker(RolloutCompressionTrigger::Rpc)
    }

    fn spawn_rollout_compression_worker(
        &self,
        trigger: RolloutCompressionTrigger,
    ) -> Result<(), RuntimeCoreError> {
        let store = self
            .projection_store
            .as_deref()
            .and_then(|projection| projection.rollout_store())
            .ok_or_else(|| {
                RuntimeCoreError::MethodNotFound(
                    "rollout/compress is not supported yet".to_string(),
                )
            })?;
        store.spawn_rollout_compression_worker(trigger);
        Ok(())
    }

    pub(super) fn start_rollout_maintenance(&self) {
        let enabled = lime_core::config::ConfigManager::load(&self.app_config_path)
            .map(|manager| manager.config().experimental.local_thread_store_compression)
            .unwrap_or(false);
        if enabled && tokio::runtime::Handle::try_current().is_ok() {
            if let Err(error) =
                self.spawn_rollout_compression_worker(RolloutCompressionTrigger::Startup)
            {
                tracing::warn!(%error, "rollout startup compression could not start");
            }
        }
    }
}
