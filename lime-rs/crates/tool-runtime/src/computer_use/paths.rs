use std::path::PathBuf;

/// Trusted host paths. The root is stable per user, independent of a workspace,
/// config override or AgentRuntimeRoot, so all hosts share one desktop lock.
#[derive(Clone, Debug)]
pub struct ComputerUsePaths {
    pub root: PathBuf,
    pub chrome_manifest: PathBuf,
    pub excel_sideload: Option<PathBuf>,
}

impl ComputerUsePaths {
    pub(super) fn sessions(&self) -> PathBuf {
        self.root.join("sessions")
    }
}
