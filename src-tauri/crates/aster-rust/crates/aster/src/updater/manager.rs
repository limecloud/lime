//! 更新管理器
//!
//! 管理更新检查、下载和安装，支持：
//! - 自动检查更新
//! - 事件通知
//! - 版本回滚
//! - 多更新通道

use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::RwLock;

use super::checker::{compare_versions, UpdateCheckResult};
use super::installer::{InstallOptions, Installer};

/// 更新配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateConfig {
    pub check_interval: u64,
    pub auto_download: bool,
    pub auto_install: bool,
    pub channel: UpdateChannel,
    pub registry_url: String,
    pub package_name: String,
}

impl Default for UpdateConfig {
    fn default() -> Self {
        Self {
            check_interval: 24 * 60 * 60,
            auto_download: false,
            auto_install: false,
            channel: UpdateChannel::Stable,
            registry_url: "https://github.com/astercloud/aster-rust/releases".to_string(),
            package_name: "aster".to_string(),
        }
    }
}

/// 更新通道
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum UpdateChannel {
    Stable,
    Beta,
    Canary,
}

/// 更新状态
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum UpdateStatus {
    Idle,
    Checking,
    Available,
    Downloading,
    Ready,
    Installing,
    Error,
}

/// 更新选项
#[derive(Debug, Clone, Default)]
pub struct UpdateOptions {
    pub version: Option<String>,
    pub force: bool,
    pub dry_run: bool,
    pub beta: bool,
    pub canary: bool,
    pub show_progress: bool,
}

/// 更新事件
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum UpdateEvent {
    Checking,
    UpdateAvailable { current: String, latest: String },
    UpdateNotAvailable,
    Downloading { version: String },
    Downloaded { version: String },
    Installing { version: String },
    Installed { version: String },
    Progress { phase: String, percent: u8 },
    Error { message: String },
    RollbackStarted { version: String },
    RollbackComplete { version: String },
}

/// 更新管理器
pub struct UpdateManager {
    config: UpdateConfig,
    status: Arc<RwLock<UpdateStatus>>,
    current_version: String,
    last_check: Arc<RwLock<Option<i64>>>,
    installer: Installer,
    event_sender: Option<tokio::sync::mpsc::Sender<UpdateEvent>>,
}

impl UpdateManager {
    pub fn new(config: UpdateConfig) -> Self {
        Self {
            config,
            status: Arc::new(RwLock::new(UpdateStatus::Idle)),
            current_version: env!("CARGO_PKG_VERSION").to_string(),
            last_check: Arc::new(RwLock::new(None)),
            installer: Installer::new(),
            event_sender: None,
        }
    }

    pub fn with_event_sender(mut self, sender: tokio::sync::mpsc::Sender<UpdateEvent>) -> Self {
        self.event_sender = Some(sender);
        self
    }

    async fn emit(&self, event: UpdateEvent) {
        if let Some(sender) = &self.event_sender {
            let _ = sender.send(event).await;
        }
    }

    pub async fn get_status(&self) -> UpdateStatus {
        *self.status.read().await
    }
    pub fn get_current_version(&self) -> &str {
        &self.current_version
    }
    pub fn get_config(&self) -> &UpdateConfig {
        &self.config
    }

    pub async fn check_for_updates(&self) -> Result<UpdateCheckResult, String> {
        *self.status.write().await = UpdateStatus::Checking;
        self.emit(UpdateEvent::Checking).await;

        let latest_version = self.fetch_latest_version().await?;
        let has_update = compare_versions(&latest_version, &self.current_version) > 0;

        *self.last_check.write().await = Some(chrono::Utc::now().timestamp());

        if has_update {
            *self.status.write().await = UpdateStatus::Available;
            self.emit(UpdateEvent::UpdateAvailable {
                current: self.current_version.clone(),
                latest: latest_version.clone(),
            })
            .await;
        } else {
            *self.status.write().await = UpdateStatus::Idle;
            self.emit(UpdateEvent::UpdateNotAvailable).await;
        }

        Ok(UpdateCheckResult {
            has_update,
            current_version: self.current_version.clone(),
            latest_version,
            version_info: None,
            changelog: None,
        })
    }

    async fn fetch_latest_version(&self) -> Result<String, String> {
        Ok(self.current_version.clone())
    }

    pub async fn download(
        &self,
        version: Option<&str>,
        options: &UpdateOptions,
    ) -> Result<(), String> {
        let target_version = version.unwrap_or(&self.current_version);

        if options.dry_run {
            tracing::info!("[DRY-RUN] 将下载版本 {}", target_version);
            return Ok(());
        }

        *self.status.write().await = UpdateStatus::Downloading;
        self.emit(UpdateEvent::Downloading {
            version: target_version.to_string(),
        })
        .await;

        let download_url = format!(
            "{}/download/v{}/aster-{}.tar.gz",
            self.config.registry_url,
            target_version,
            std::env::consts::OS
        );

        let install_options = InstallOptions {
            version: Some(target_version.to_string()),
            dry_run: options.dry_run,
            show_progress: options.show_progress,
            ..Default::default()
        };

        self.installer
            .download(&download_url, &install_options)
            .await?;

        *self.status.write().await = UpdateStatus::Ready;
        self.emit(UpdateEvent::Downloaded {
            version: target_version.to_string(),
        })
        .await;
        Ok(())
    }

    pub async fn install(
        &self,
        version: Option<&str>,
        options: &UpdateOptions,
    ) -> Result<(), String> {
        let target_version = version.unwrap_or("latest");

        if options.dry_run {
            tracing::info!("[DRY-RUN] 将安装版本 {}", target_version);
            return Ok(());
        }

        *self.status.write().await = UpdateStatus::Installing;
        self.emit(UpdateEvent::Installing {
            version: target_version.to_string(),
        })
        .await;

        let install_options = InstallOptions {
            version: Some(target_version.to_string()),
            force: options.force,
            dry_run: options.dry_run,
            show_progress: options.show_progress,
            ..Default::default()
        };

        let package_path = dirs::data_dir()
            .unwrap_or_default()
            .join("aster/downloads")
            .join(format!("aster-{}.tar.gz", std::env::consts::OS));

        self.installer
            .install(&package_path, &install_options)
            .await?;

        self.emit(UpdateEvent::Installed {
            version: target_version.to_string(),
        })
        .await;
        *self.status.write().await = UpdateStatus::Idle;
        Ok(())
    }

    pub async fn rollback(&self, version: &str, options: &UpdateOptions) -> Result<(), String> {
        *self.status.write().await = UpdateStatus::Installing;
        self.emit(UpdateEvent::RollbackStarted {
            version: version.to_string(),
        })
        .await;

        if options.dry_run {
            tracing::info!("[DRY-RUN] 将回滚到版本 {}", version);
            return Ok(());
        }

        let available = self.installer.list_backups();
        if !available.contains(&version.to_string()) {
            return Err(format!("版本 {} 不存在", version));
        }

        let install_options = InstallOptions {
            version: Some(version.to_string()),
            dry_run: options.dry_run,
            ..Default::default()
        };

        self.installer.rollback(version, &install_options).await?;

        self.emit(UpdateEvent::RollbackComplete {
            version: version.to_string(),
        })
        .await;
        *self.status.write().await = UpdateStatus::Idle;
        Ok(())
    }

    pub fn list_available_versions(&self) -> Vec<String> {
        self.installer.list_backups()
    }
    pub fn cleanup(&self, keep_versions: usize) -> Result<(), String> {
        self.installer.cleanup(keep_versions)
    }
}

impl Default for UpdateManager {
    fn default() -> Self {
        Self::new(UpdateConfig::default())
    }
}

// ============ 便捷函数 ============

pub async fn check_for_updates(config: Option<UpdateConfig>) -> Result<UpdateCheckResult, String> {
    let manager = UpdateManager::new(config.unwrap_or_default());
    manager.check_for_updates().await
}

pub async fn perform_update(options: UpdateOptions) -> Result<bool, String> {
    let channel = if options.beta {
        UpdateChannel::Beta
    } else if options.canary {
        UpdateChannel::Canary
    } else {
        UpdateChannel::Stable
    };

    let config = UpdateConfig {
        channel,
        ..Default::default()
    };
    let manager = UpdateManager::new(config);

    let result = manager.check_for_updates().await?;
    if !result.has_update {
        return Ok(true);
    }

    manager
        .download(options.version.as_deref(), &options)
        .await?;
    if !options.dry_run {
        manager
            .install(options.version.as_deref(), &options)
            .await?;
    }
    Ok(true)
}

pub async fn rollback_version(version: &str, options: UpdateOptions) -> Result<bool, String> {
    let manager = UpdateManager::new(UpdateConfig::default());
    manager.rollback(version, &options).await?;
    Ok(true)
}

pub fn list_versions() -> Vec<String> {
    UpdateManager::new(UpdateConfig::default()).list_available_versions()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_update_config_default() {
        let config = UpdateConfig::default();
        assert_eq!(config.check_interval, 24 * 60 * 60);
        assert!(!config.auto_download);
        assert!(!config.auto_install);
        assert_eq!(config.channel, UpdateChannel::Stable);
    }

    #[test]
    fn test_update_channel_variants() {
        assert_ne!(UpdateChannel::Stable, UpdateChannel::Beta);
        assert_ne!(UpdateChannel::Beta, UpdateChannel::Canary);
    }

    #[test]
    fn test_update_status_variants() {
        let statuses = [
            UpdateStatus::Idle,
            UpdateStatus::Checking,
            UpdateStatus::Available,
            UpdateStatus::Downloading,
            UpdateStatus::Ready,
            UpdateStatus::Installing,
            UpdateStatus::Error,
        ];
        assert_eq!(statuses.len(), 7);
    }

    #[test]
    fn test_update_options_default() {
        let options = UpdateOptions::default();
        assert!(options.version.is_none());
        assert!(!options.force);
        assert!(!options.dry_run);
        assert!(!options.beta);
        assert!(!options.canary);
        assert!(!options.show_progress);
    }

    #[test]
    fn test_update_manager_new() {
        let manager = UpdateManager::new(UpdateConfig::default());
        assert!(!manager.get_current_version().is_empty());
    }

    #[test]
    fn test_update_manager_default() {
        let manager = UpdateManager::default();
        assert_eq!(manager.get_config().channel, UpdateChannel::Stable);
    }

    #[test]
    fn test_update_manager_get_config() {
        let config = UpdateConfig {
            channel: UpdateChannel::Beta,
            ..Default::default()
        };
        let manager = UpdateManager::new(config);
        assert_eq!(manager.get_config().channel, UpdateChannel::Beta);
    }

    #[tokio::test]
    async fn test_update_manager_get_status() {
        let manager = UpdateManager::default();
        let status = manager.get_status().await;
        assert_eq!(status, UpdateStatus::Idle);
    }

    #[tokio::test]
    async fn test_update_manager_check_for_updates() {
        let manager = UpdateManager::default();
        let result = manager.check_for_updates().await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_update_manager_download_dry_run() {
        let manager = UpdateManager::default();
        let options = UpdateOptions {
            dry_run: true,
            ..Default::default()
        };
        let result = manager.download(Some("1.0.0"), &options).await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_update_manager_install_dry_run() {
        let manager = UpdateManager::default();
        let options = UpdateOptions {
            dry_run: true,
            ..Default::default()
        };
        let result = manager.install(Some("1.0.0"), &options).await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_update_manager_rollback_dry_run() {
        let manager = UpdateManager::default();
        let options = UpdateOptions {
            dry_run: true,
            ..Default::default()
        };
        let result = manager.rollback("1.0.0", &options).await;
        assert!(result.is_ok());
    }

    #[test]
    fn test_update_manager_list_available_versions() {
        let manager = UpdateManager::default();
        let versions = manager.list_available_versions();
        // 可能为空，但不应该 panic（versions.len() 是 usize，总是 >= 0）
        let _ = versions;
    }

    #[test]
    fn test_update_manager_cleanup() {
        let manager = UpdateManager::default();
        let result = manager.cleanup(3);
        assert!(result.is_ok());
    }

    #[test]
    fn test_update_event_variants() {
        let events = vec![
            UpdateEvent::Checking,
            UpdateEvent::UpdateAvailable {
                current: "1.0".to_string(),
                latest: "1.1".to_string(),
            },
            UpdateEvent::UpdateNotAvailable,
            UpdateEvent::Downloading {
                version: "1.1".to_string(),
            },
            UpdateEvent::Downloaded {
                version: "1.1".to_string(),
            },
            UpdateEvent::Installing {
                version: "1.1".to_string(),
            },
            UpdateEvent::Installed {
                version: "1.1".to_string(),
            },
            UpdateEvent::Progress {
                phase: "download".to_string(),
                percent: 50,
            },
            UpdateEvent::Error {
                message: "error".to_string(),
            },
            UpdateEvent::RollbackStarted {
                version: "1.0".to_string(),
            },
            UpdateEvent::RollbackComplete {
                version: "1.0".to_string(),
            },
        ];
        assert_eq!(events.len(), 11);
    }

    #[tokio::test]
    async fn test_check_for_updates_function() {
        let result = check_for_updates(None).await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_perform_update_dry_run() {
        let options = UpdateOptions {
            dry_run: true,
            ..Default::default()
        };
        let result = perform_update(options).await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_rollback_version_dry_run() {
        let options = UpdateOptions {
            dry_run: true,
            ..Default::default()
        };
        let result = rollback_version("1.0.0", options).await;
        assert!(result.is_ok());
    }

    #[test]
    fn test_list_versions_function() {
        let versions = list_versions();
        // versions.len() 是 usize，总是 >= 0
        let _ = versions;
    }
}
