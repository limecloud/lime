//! 自动更新系统
//!
//! 提供版本检查、下载、安装和回滚功能

mod checker;
mod installer;
mod manager;

pub use checker::{
    check_for_updates as check_version, compare_versions, UpdateCheckResult, VersionInfo,
};
pub use installer::{DownloadPhase, DownloadProgress, InstallOptions, InstallResult, Installer};
pub use manager::{
    check_for_updates, list_versions, perform_update, rollback_version, UpdateChannel,
    UpdateConfig, UpdateEvent, UpdateManager, UpdateOptions, UpdateStatus,
};
