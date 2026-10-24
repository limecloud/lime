use super::{ExecutionProcessError, ExecutionProcessServer};
use lime_core::config::layers::ConfigLayers;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tool_runtime::primary_runtime::PrimaryRuntimeService;

impl ExecutionProcessServer {
    pub(crate) fn attach_primary_runtime(
        &self,
        service: Arc<PrimaryRuntimeService>,
        config: PathBuf,
    ) {
        *self.primary_runtime.write().expect("primary runtime lock") = Some((service, config));
    }

    pub(crate) fn expose_primary_runtime(
        &self,
        environment: &mut HashMap<String, String>,
    ) -> Result<(), ExecutionProcessError> {
        let source = self
            .primary_runtime
            .read()
            .expect("primary runtime lock")
            .clone();
        let Some((service, path)) = source else {
            return Ok(());
        };
        let config = ConfigLayers::load(&path, None)
            .map_err(|error| ExecutionProcessError::Start(error.to_string()))?;
        if config.effective.features.workspace_dependencies_enabled() {
            service
                .expose(environment)
                .map_err(|error| ExecutionProcessError::Start(error.to_string()))?;
        }
        Ok(())
    }
}
