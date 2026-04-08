//! LSP Server Manager
//!
//! 管理 LSP 服务器的安装、启动和生命周期

use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Command;
use std::sync::Arc;
use tokio::sync::{broadcast, RwLock};

use super::lsp_client::{LspClient, LspClientConfig, LspServerState};

/// LSP 服务器信息
#[derive(Debug, Clone)]
pub struct LspServerInfo {
    /// 语言
    pub language: String,
    /// 服务器名称
    pub name: String,
    /// 命令
    pub command: String,
    /// 参数
    pub args: Vec<String>,
    /// 安装命令
    pub install_command: String,
    /// 检查命令
    pub check_command: String,
    /// 文件扩展名
    pub extensions: Vec<String>,
    /// 语言 ID
    pub language_id: String,
}

/// LSP 服务器配置表
pub static LSP_SERVERS: once_cell::sync::Lazy<HashMap<&'static str, LspServerInfo>> =
    once_cell::sync::Lazy::new(|| {
        let mut m = HashMap::new();

        m.insert(
            "typescript",
            LspServerInfo {
                language: "typescript".to_string(),
                name: "TypeScript Language Server".to_string(),
                command: "typescript-language-server".to_string(),
                args: vec!["--stdio".to_string()],
                install_command: "npm install -g typescript-language-server typescript".to_string(),
                check_command: "typescript-language-server --version".to_string(),
                extensions: vec![".ts".to_string(), ".tsx".to_string()],
                language_id: "typescript".to_string(),
            },
        );

        m.insert(
            "javascript",
            LspServerInfo {
                language: "javascript".to_string(),
                name: "TypeScript Language Server (JavaScript)".to_string(),
                command: "typescript-language-server".to_string(),
                args: vec!["--stdio".to_string()],
                install_command: "npm install -g typescript-language-server typescript".to_string(),
                check_command: "typescript-language-server --version".to_string(),
                extensions: vec![".js".to_string(), ".jsx".to_string()],
                language_id: "javascript".to_string(),
            },
        );

        m.insert(
            "python",
            LspServerInfo {
                language: "python".to_string(),
                name: "Pyright".to_string(),
                command: "pyright-langserver".to_string(),
                args: vec!["--stdio".to_string()],
                install_command: "npm install -g pyright".to_string(),
                check_command: "pyright-langserver --version".to_string(),
                extensions: vec![".py".to_string(), ".pyi".to_string()],
                language_id: "python".to_string(),
            },
        );

        m.insert(
            "rust",
            LspServerInfo {
                language: "rust".to_string(),
                name: "rust-analyzer".to_string(),
                command: "rust-analyzer".to_string(),
                args: vec![],
                install_command: "rustup component add rust-analyzer".to_string(),
                check_command: "rust-analyzer --version".to_string(),
                extensions: vec![".rs".to_string()],
                language_id: "rust".to_string(),
            },
        );

        m.insert(
            "go",
            LspServerInfo {
                language: "go".to_string(),
                name: "gopls".to_string(),
                command: "gopls".to_string(),
                args: vec!["serve".to_string()],
                install_command: "go install golang.org/x/tools/gopls@latest".to_string(),
                check_command: "gopls version".to_string(),
                extensions: vec![".go".to_string()],
                language_id: "go".to_string(),
            },
        );

        m
    });

/// 安装状态
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InstallStatus {
    Checking,
    Installing,
    Installed,
    Failed,
    Skipped,
}

/// 进度事件
#[derive(Debug, Clone)]
pub struct ProgressEvent {
    pub language: String,
    pub status: InstallStatus,
    pub message: String,
    pub progress: Option<u8>,
}

/// LSP 管理器事件
#[derive(Debug, Clone)]
pub enum LspManagerEvent {
    Progress(ProgressEvent),
    ClientStateChange {
        language: String,
        state: LspServerState,
    },
    ClientError {
        language: String,
        error: String,
    },
}

/// LSP 服务器管理器
pub struct LspManager {
    clients: Arc<RwLock<HashMap<String, Arc<LspClient>>>>,
    installed_servers: Arc<RwLock<std::collections::HashSet<String>>>,
    workspace_root: PathBuf,
    event_sender: broadcast::Sender<LspManagerEvent>,
}

impl LspManager {
    /// 创建新的 LSP 管理器
    pub fn new(workspace_root: Option<PathBuf>) -> Self {
        let (event_sender, _) = broadcast::channel(64);
        Self {
            clients: Arc::new(RwLock::new(HashMap::new())),
            installed_servers: Arc::new(RwLock::new(std::collections::HashSet::new())),
            workspace_root: workspace_root
                .unwrap_or_else(|| std::env::current_dir().unwrap_or_default()),
            event_sender,
        }
    }

    /// 订阅事件
    pub fn subscribe(&self) -> broadcast::Receiver<LspManagerEvent> {
        self.event_sender.subscribe()
    }

    /// 检查 LSP 服务器是否已安装
    pub fn is_server_installed(&self, language: &str) -> bool {
        let server = match LSP_SERVERS.get(language) {
            Some(s) => s,
            None => return false,
        };

        let output = Command::new("sh")
            .arg("-c")
            .arg(&server.check_command)
            .output();

        matches!(output, Ok(o) if o.status.success())
    }

    /// 确保 LSP 服务器已安装
    pub async fn ensure_server(&self, language: &str) -> Result<(), String> {
        let server = LSP_SERVERS
            .get(language)
            .ok_or_else(|| format!("Unsupported language: {}", language))?;

        if self.installed_servers.read().await.contains(language) {
            return Ok(());
        }

        let _ = self
            .event_sender
            .send(LspManagerEvent::Progress(ProgressEvent {
                language: language.to_string(),
                status: InstallStatus::Checking,
                message: format!("Checking {}...", server.name),
                progress: None,
            }));

        if self.is_server_installed(language) {
            self.installed_servers
                .write()
                .await
                .insert(language.to_string());
            let _ = self
                .event_sender
                .send(LspManagerEvent::Progress(ProgressEvent {
                    language: language.to_string(),
                    status: InstallStatus::Installed,
                    message: format!("{} is ready", server.name),
                    progress: Some(100),
                }));
            return Ok(());
        }

        Err(format!(
            "{} is not installed. Install with: {}",
            server.name, server.install_command
        ))
    }

    /// 获取或创建 LSP 客户端
    pub async fn get_client(&self, language: &str) -> Result<Arc<LspClient>, String> {
        // 检查是否已有客户端
        if let Some(client) = self.clients.read().await.get(language) {
            if client.get_state().await == LspServerState::Running {
                return Ok(client.clone());
            }
        }

        // 确保服务器已安装
        self.ensure_server(language).await?;

        let server = LSP_SERVERS
            .get(language)
            .ok_or_else(|| format!("Unsupported language: {}", language))?;

        // 构建 root URI
        let root_uri = format!("file://{}", self.workspace_root.display());

        let config = LspClientConfig {
            command: server.command.clone(),
            args: server.args.clone(),
            root_uri: Some(root_uri),
            initialization_options: None,
        };

        let client = Arc::new(LspClient::new(language, config));

        // 启动客户端
        client.start().await?;

        self.clients
            .write()
            .await
            .insert(language.to_string(), client.clone());

        Ok(client)
    }

    /// 根据文件扩展名获取语言
    pub fn get_language_by_extension(&self, ext: &str) -> Option<String> {
        for (lang, server) in LSP_SERVERS.iter() {
            if server.extensions.contains(&ext.to_string()) {
                return Some(lang.to_string());
            }
        }
        None
    }

    /// 获取语言 ID
    pub fn get_language_id(&self, language: &str) -> String {
        LSP_SERVERS
            .get(language)
            .map(|s| s.language_id.clone())
            .unwrap_or_else(|| language.to_string())
    }

    /// 停止所有客户端
    pub async fn stop_all(&self) {
        let clients = self.clients.read().await;
        for client in clients.values() {
            client.stop().await;
        }
    }

    /// 获取所有支持的语言
    pub fn get_supported_languages(&self) -> Vec<String> {
        LSP_SERVERS.keys().map(|s| s.to_string()).collect()
    }

    /// 获取服务器信息
    pub fn get_server_info(&self, language: &str) -> Option<&LspServerInfo> {
        LSP_SERVERS.get(language)
    }
}

impl Default for LspManager {
    fn default() -> Self {
        Self::new(None)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_lsp_servers_config() {
        assert!(LSP_SERVERS.contains_key("typescript"));
        assert!(LSP_SERVERS.contains_key("rust"));
        assert!(LSP_SERVERS.contains_key("python"));
    }

    #[test]
    fn test_get_language_by_extension() {
        let manager = LspManager::default();
        assert_eq!(
            manager.get_language_by_extension(".ts"),
            Some("typescript".to_string())
        );
        assert_eq!(
            manager.get_language_by_extension(".rs"),
            Some("rust".to_string())
        );
        assert_eq!(
            manager.get_language_by_extension(".py"),
            Some("python".to_string())
        );
        assert_eq!(manager.get_language_by_extension(".unknown"), None);
    }

    #[test]
    fn test_get_language_id() {
        let manager = LspManager::default();
        assert_eq!(manager.get_language_id("typescript"), "typescript");
        assert_eq!(manager.get_language_id("rust"), "rust");
    }

    #[test]
    fn test_get_supported_languages() {
        let manager = LspManager::default();
        let languages = manager.get_supported_languages();
        assert!(languages.contains(&"typescript".to_string()));
        assert!(languages.contains(&"rust".to_string()));
    }

    #[test]
    fn test_get_server_info() {
        let manager = LspManager::default();
        let info = manager.get_server_info("rust").unwrap();
        assert_eq!(info.command, "rust-analyzer");
    }
}
