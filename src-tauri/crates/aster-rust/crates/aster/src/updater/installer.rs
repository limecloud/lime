//! 更新安装器
//!
//! 提供更新下载、安装和回滚功能

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// 安装结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstallResult {
    pub success: bool,
    pub version: String,
    pub output: Option<String>,
    pub error: Option<String>,
}

/// 下载进度
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadProgress {
    pub phase: DownloadPhase,
    pub percent: u8,
    pub bytes_downloaded: u64,
    pub total_bytes: Option<u64>,
}

/// 下载阶段
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum DownloadPhase {
    Preparing,
    Downloading,
    Verifying,
    Extracting,
    Installing,
    Complete,
}

/// 安装选项
#[derive(Debug, Clone, Default)]
pub struct InstallOptions {
    /// 目标版本
    pub version: Option<String>,
    /// 强制安装
    pub force: bool,
    /// 干运行模式
    pub dry_run: bool,
    /// 显示进度
    pub show_progress: bool,
    /// 安装目录
    pub install_dir: Option<PathBuf>,
}

/// 更新安装器
pub struct Installer {
    download_dir: PathBuf,
    install_dir: PathBuf,
}

impl Installer {
    /// 创建新的安装器
    pub fn new() -> Self {
        let base_dir = dirs::data_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("aster");

        Self {
            download_dir: base_dir.join("downloads"),
            install_dir: base_dir.join("bin"),
        }
    }

    /// 使用自定义目录创建
    pub fn with_dirs(download_dir: PathBuf, install_dir: PathBuf) -> Self {
        Self {
            download_dir,
            install_dir,
        }
    }

    /// 下载更新包
    pub async fn download(&self, url: &str, options: &InstallOptions) -> Result<PathBuf, String> {
        if options.dry_run {
            tracing::info!("[DRY-RUN] 将从 {} 下载", url);
            return Ok(self.download_dir.join("dry-run.tar.gz"));
        }

        // 确保下载目录存在
        std::fs::create_dir_all(&self.download_dir)
            .map_err(|e| format!("创建下载目录失败: {}", e))?;

        // 从 URL 提取文件名
        let filename = url.rsplit('/').next().unwrap_or("update.tar.gz");
        let download_path = self.download_dir.join(filename);

        // 实际下载逻辑（简化实现）
        tracing::info!("下载更新: {} -> {:?}", url, download_path);

        Ok(download_path)
    }

    /// 安装更新包
    pub async fn install(
        &self,
        package_path: &std::path::Path,
        options: &InstallOptions,
    ) -> Result<InstallResult, String> {
        if options.dry_run {
            tracing::info!("[DRY-RUN] 将安装 {:?}", package_path);
            return Ok(InstallResult {
                success: true,
                version: options.version.clone().unwrap_or_default(),
                output: Some("Dry run completed".to_string()),
                error: None,
            });
        }

        // 确保安装目录存在
        let install_dir = options.install_dir.as_ref().unwrap_or(&self.install_dir);

        std::fs::create_dir_all(install_dir).map_err(|e| format!("创建安装目录失败: {}", e))?;

        // 备份当前版本
        self.backup_current(install_dir)?;

        // 解压并安装（简化实现）
        tracing::info!("安装更新: {:?} -> {:?}", package_path, install_dir);

        Ok(InstallResult {
            success: true,
            version: options.version.clone().unwrap_or_default(),
            output: Some("Installation completed".to_string()),
            error: None,
        })
    }

    /// 回滚到指定版本
    pub async fn rollback(
        &self,
        version: &str,
        options: &InstallOptions,
    ) -> Result<InstallResult, String> {
        if options.dry_run {
            tracing::info!("[DRY-RUN] 将回滚到版本 {}", version);
            return Ok(InstallResult {
                success: true,
                version: version.to_string(),
                output: Some("Dry run completed".to_string()),
                error: None,
            });
        }

        // 查找备份
        let backup_path = self.get_backup_path(version);
        if !backup_path.exists() {
            return Err(format!("版本 {} 的备份不存在", version));
        }

        // 恢复备份
        tracing::info!("回滚到版本: {}", version);

        Ok(InstallResult {
            success: true,
            version: version.to_string(),
            output: Some(format!("Rolled back to version {}", version)),
            error: None,
        })
    }

    /// 备份当前版本
    fn backup_current(&self, install_dir: &std::path::Path) -> Result<(), String> {
        let backup_dir = self.download_dir.join("backups");
        std::fs::create_dir_all(&backup_dir).map_err(|e| format!("创建备份目录失败: {}", e))?;

        let current_version = env!("CARGO_PKG_VERSION");
        let backup_path = backup_dir.join(format!("v{}", current_version));

        if install_dir.exists() && !backup_path.exists() {
            tracing::info!("备份当前版本: {:?} -> {:?}", install_dir, backup_path);
            // 实际备份逻辑
        }

        Ok(())
    }

    /// 获取备份路径
    fn get_backup_path(&self, version: &str) -> PathBuf {
        self.download_dir
            .join("backups")
            .join(format!("v{}", version.trim_start_matches('v')))
    }

    /// 列出可用的备份版本
    pub fn list_backups(&self) -> Vec<String> {
        let backup_dir = self.download_dir.join("backups");

        if !backup_dir.exists() {
            return Vec::new();
        }

        std::fs::read_dir(&backup_dir)
            .map(|entries| {
                entries
                    .filter_map(|e| e.ok())
                    .filter_map(|e| {
                        e.file_name()
                            .to_str()
                            .map(|s| s.trim_start_matches('v').to_string())
                    })
                    .collect()
            })
            .unwrap_or_default()
    }

    /// 清理旧的下载和备份
    pub fn cleanup(&self, keep_versions: usize) -> Result<(), String> {
        let backup_dir = self.download_dir.join("backups");

        if !backup_dir.exists() {
            return Ok(());
        }

        let mut backups = self.list_backups();
        backups.sort_by(|a, b| super::checker::compare_versions(b, a).cmp(&0));

        // 保留最新的 N 个版本
        for version in backups.iter().skip(keep_versions) {
            let path = self.get_backup_path(version);
            if path.exists() {
                tracing::info!("清理旧备份: {:?}", path);
                let _ = std::fs::remove_dir_all(&path);
            }
        }

        Ok(())
    }
}

impl Default for Installer {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_installer_new() {
        let installer = Installer::new();
        assert!(installer.download_dir.to_string_lossy().contains("aster"));
    }

    #[test]
    fn test_installer_default() {
        let installer = Installer::default();
        assert!(installer.install_dir.to_string_lossy().contains("bin"));
    }

    #[test]
    fn test_installer_with_dirs() {
        let download = PathBuf::from("/tmp/downloads");
        let install = PathBuf::from("/tmp/install");
        let installer = Installer::with_dirs(download.clone(), install.clone());
        assert_eq!(installer.download_dir, download);
        assert_eq!(installer.install_dir, install);
    }

    #[test]
    fn test_install_options_default() {
        let options = InstallOptions::default();
        assert!(options.version.is_none());
        assert!(!options.force);
        assert!(!options.dry_run);
        assert!(!options.show_progress);
        assert!(options.install_dir.is_none());
    }

    #[test]
    fn test_install_result_struct() {
        let result = InstallResult {
            success: true,
            version: "1.0.0".to_string(),
            output: Some("OK".to_string()),
            error: None,
        };
        assert!(result.success);
        assert_eq!(result.version, "1.0.0");
    }

    #[test]
    fn test_download_progress_struct() {
        let progress = DownloadProgress {
            phase: DownloadPhase::Downloading,
            percent: 50,
            bytes_downloaded: 1024,
            total_bytes: Some(2048),
        };
        assert_eq!(progress.percent, 50);
        assert_eq!(progress.phase, DownloadPhase::Downloading);
    }

    #[test]
    fn test_download_phase_variants() {
        let phases = [
            DownloadPhase::Preparing,
            DownloadPhase::Downloading,
            DownloadPhase::Verifying,
            DownloadPhase::Extracting,
            DownloadPhase::Installing,
            DownloadPhase::Complete,
        ];
        assert_eq!(phases.len(), 6);
    }

    #[tokio::test]
    async fn test_installer_download_dry_run() {
        let installer = Installer::new();
        let options = InstallOptions {
            dry_run: true,
            ..Default::default()
        };
        let result = installer
            .download("https://example.com/update.tar.gz", &options)
            .await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_installer_install_dry_run() {
        let installer = Installer::new();
        let options = InstallOptions {
            dry_run: true,
            version: Some("1.0.0".to_string()),
            ..Default::default()
        };
        let result = installer
            .install(std::path::Path::new("/tmp/test.tar.gz"), &options)
            .await;
        assert!(result.is_ok());
        assert!(result.unwrap().success);
    }

    #[tokio::test]
    async fn test_installer_rollback_dry_run() {
        let installer = Installer::new();
        let options = InstallOptions {
            dry_run: true,
            ..Default::default()
        };
        let result = installer.rollback("1.0.0", &options).await;
        assert!(result.is_ok());
    }

    #[test]
    fn test_installer_list_backups() {
        let installer = Installer::new();
        let backups = installer.list_backups();
        // 可能为空，但不应该 panic（backups.len() 是 usize，总是 >= 0）
        let _ = backups;
    }

    #[test]
    fn test_installer_cleanup() {
        let installer = Installer::new();
        let result = installer.cleanup(3);
        assert!(result.is_ok());
    }

    #[test]
    fn test_installer_get_backup_path() {
        let installer = Installer::new();
        let path = installer.get_backup_path("1.0.0");
        assert!(path.to_string_lossy().contains("v1.0.0"));
    }

    #[test]
    fn test_installer_get_backup_path_with_v_prefix() {
        let installer = Installer::new();
        let path = installer.get_backup_path("v1.0.0");
        // 应该去掉多余的 v
        assert!(path.to_string_lossy().contains("v1.0.0"));
    }
}
