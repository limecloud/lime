pub mod agents_md_parser;
pub mod aster_mode;
pub mod base;
pub mod config_command;
pub mod config_manager;
pub mod declarative_providers;
mod experiments;
pub mod extensions;
pub mod paths;
pub mod permission;
pub mod search_path;
pub mod signup_openrouter;
pub mod signup_tetrate;
pub mod watcher;

pub use crate::agents::ExtensionConfig;
pub use aster_mode::AsterMode;
pub use base::{Config, ConfigError};
pub use declarative_providers::DeclarativeProviderConfig;
pub use experiments::ExperimentManager;
pub use extensions::{
    get_all_extension_names, get_all_extensions, get_enabled_extensions, get_extension_by_name,
    get_warnings, is_extension_enabled, remove_extension, set_extension, set_extension_enabled,
    ExtensionEntry,
};
pub use permission::PermissionManager;
pub use signup_openrouter::configure_openrouter;
pub use signup_tetrate::configure_tetrate;
pub use watcher::{
    AtomicConfigUpdate, CompositeValidator, ConfigValidator, DebouncedNotifier, NoopValidator,
    RequiredFieldsValidator, UpdateResult,
};

pub use agents_md_parser::{AgentsMdInfo, AgentsMdParser, AgentsMdStats, ValidationResult};
pub use config_command::{
    create_config_command, ConfigCommand, ConfigDisplayOptions, ConfigFormat,
};
pub use config_manager::{
    ConfigKeySource, ConfigManager, ConfigManagerOptions, ConfigSource, ConfigSourceInfo,
    EnterprisePolicyConfig, PolicyMetadata,
};
pub use extensions::DEFAULT_DISPLAY_NAME;
pub use extensions::DEFAULT_EXTENSION;
pub use extensions::DEFAULT_EXTENSION_DESCRIPTION;
pub use extensions::DEFAULT_EXTENSION_TIMEOUT;
