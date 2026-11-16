use state::SqliteConfig;
use std::path::Path;
use std::path::PathBuf;
use std::sync::Arc;

pub trait RolloutConfigView {
    fn lime_home(&self) -> &Path;
    fn sqlite_config(&self) -> &SqliteConfig;
    fn cwd(&self) -> &Path;
    fn model_provider_id(&self) -> &str;
    fn generate_memories(&self) -> bool;
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RolloutConfig {
    pub lime_home: PathBuf,
    pub sqlite: SqliteConfig,
    pub cwd: PathBuf,
    pub model_provider_id: String,
    pub generate_memories: bool,
}

pub type Config = RolloutConfig;

impl RolloutConfig {
    pub fn from_view(view: &impl RolloutConfigView) -> Self {
        Self {
            lime_home: view.lime_home().to_path_buf(),
            sqlite: view.sqlite_config().clone(),
            cwd: view.cwd().to_path_buf(),
            model_provider_id: view.model_provider_id().to_string(),
            generate_memories: view.generate_memories(),
        }
    }
}

impl RolloutConfigView for RolloutConfig {
    fn lime_home(&self) -> &Path {
        self.lime_home.as_path()
    }

    fn sqlite_config(&self) -> &SqliteConfig {
        &self.sqlite
    }

    fn cwd(&self) -> &Path {
        self.cwd.as_path()
    }

    fn model_provider_id(&self) -> &str {
        self.model_provider_id.as_str()
    }

    fn generate_memories(&self) -> bool {
        self.generate_memories
    }
}

impl<T: RolloutConfigView + ?Sized> RolloutConfigView for &T {
    fn lime_home(&self) -> &Path {
        (*self).lime_home()
    }

    fn sqlite_config(&self) -> &SqliteConfig {
        (*self).sqlite_config()
    }

    fn cwd(&self) -> &Path {
        (*self).cwd()
    }

    fn model_provider_id(&self) -> &str {
        (*self).model_provider_id()
    }

    fn generate_memories(&self) -> bool {
        (*self).generate_memories()
    }
}

impl<T: RolloutConfigView + ?Sized> RolloutConfigView for Arc<T> {
    fn lime_home(&self) -> &Path {
        self.as_ref().lime_home()
    }

    fn sqlite_config(&self) -> &SqliteConfig {
        self.as_ref().sqlite_config()
    }

    fn cwd(&self) -> &Path {
        self.as_ref().cwd()
    }

    fn model_provider_id(&self) -> &str {
        self.as_ref().model_provider_id()
    }

    fn generate_memories(&self) -> bool {
        self.as_ref().generate_memories()
    }
}
