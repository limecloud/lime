use super::RuntimeCore;
use std::path::PathBuf;
use std::sync::Arc;
use tool_runtime::primary_runtime::PrimaryRuntimeService;

impl RuntimeCore {
    pub fn with_primary_runtime_root(mut self, root: PathBuf) -> std::io::Result<Self> {
        self.primary_runtime_service = Some(Arc::new(PrimaryRuntimeService::new(root)?));
        Ok(self)
    }

    pub(crate) fn primary_runtime_service(&self) -> Option<Arc<PrimaryRuntimeService>> {
        self.primary_runtime_service.clone()
    }
}
