//! LSP 服务器管理器
//!
//! 管理多个语言服务器实例

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::RwLock;

use super::config::{default_lsp_configs, load_lsp_config_file, LSPServerConfig};
use super::server::{LSPDiagnostic, LSPServer, LSPServerState};

/// 初始化选项
#[derive(Debug, Clone, Default)]
pub struct InitializeLSPOptions {
    /// 是否加载 .lsp.json 配置文件
    pub load_config_file: bool,
    /// 是否注册默认服务器
    pub use_defaults: bool,
    /// 自定义服务器配置
    pub custom_configs: Vec<LSPServerConfig>,
}

/// LSP 服务器管理器
pub struct LSPServerManager {
    servers: Arc<RwLock<HashMap<String, LSPServer>>>,
    server_configs: Arc<RwLock<Vec<LSPServerConfig>>>,
    workspace_root: PathBuf,
    extension_to_server: Arc<RwLock<HashMap<String, Vec<String>>>>,
    diagnostics_cache: Arc<RwLock<HashMap<String, Vec<LSPDiagnostic>>>>,
}

impl LSPServerManager {
    /// 创建新的管理器
    pub fn new(workspace_root: impl AsRef<Path>) -> Self {
        Self {
            servers: Arc::new(RwLock::new(HashMap::new())),
            server_configs: Arc::new(RwLock::new(Vec::new())),
            workspace_root: workspace_root.as_ref().to_path_buf(),
            extension_to_server: Arc::new(RwLock::new(HashMap::new())),
            diagnostics_cache: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// 注册 LSP 服务器配置
    pub async fn register_server(&self, config: LSPServerConfig) {
        // 建立扩展名索引
        let mut ext_map = self.extension_to_server.write().await;
        for ext in &config.file_extensions {
            let normalized = if ext.starts_with('.') {
                ext.to_lowercase()
            } else {
                format!(".{}", ext.to_lowercase())
            };
            ext_map
                .entry(normalized)
                .or_default()
                .push(config.name.clone());
        }

        self.server_configs.write().await.push(config);
    }

    /// 从 .lsp.json 加载配置
    pub async fn load_config_from_file(&self) -> Vec<LSPServerConfig> {
        let configs = load_lsp_config_file(&self.workspace_root);
        for config in &configs {
            self.register_server(config.clone()).await;
        }
        configs
    }

    /// 初始化所有服务器
    pub async fn initialize(&self, options: InitializeLSPOptions) -> Result<(), String> {
        // 1. 加载配置文件
        if options.load_config_file {
            let file_configs = self.load_config_from_file().await;
            if !file_configs.is_empty() {
                tracing::info!("[LSP] 从配置文件加载了 {} 个服务器", file_configs.len());
            }
        }

        // 2. 注册自定义配置
        for config in options.custom_configs {
            self.register_server(config).await;
        }

        // 3. 注册默认服务器
        if options.use_defaults {
            let existing: std::collections::HashSet<_> = self
                .server_configs
                .read()
                .await
                .iter()
                .map(|c| c.name.clone())
                .collect();
            for config in default_lsp_configs() {
                if !existing.contains(&config.name) {
                    self.register_server(config).await;
                }
            }
        }

        // 4. 启动所有服务器
        let configs = self.server_configs.read().await.clone();
        for config in configs {
            let mut server = LSPServer::new(config.clone());
            if let Err(e) = server.start(&self.workspace_root).await {
                tracing::warn!("[LSP] 启动 {} 失败: {}", config.name, e);
                continue;
            }
            self.servers
                .write()
                .await
                .insert(config.name.clone(), server);
        }

        let count = self.servers.read().await.len();
        tracing::info!("[LSP] 初始化完成: {} 个服务器启动成功", count);
        Ok(())
    }

    /// 关闭所有服务器
    pub async fn shutdown(&self) {
        let mut servers = self.servers.write().await;
        for (name, server) in servers.iter_mut() {
            if let Err(e) = server.stop().await {
                tracing::warn!("[LSP] 停止 {} 失败: {}", name, e);
            }
        }
        servers.clear();
    }

    /// 根据文件类型获取服务器
    pub async fn get_server_for_file(&self, file_path: &Path) -> Option<String> {
        let ext = file_path.extension()?.to_str()?;
        let normalized = format!(".{}", ext.to_lowercase());

        let ext_map = self.extension_to_server.read().await;
        let server_names = ext_map.get(&normalized)?;

        let servers = self.servers.read().await;
        for name in server_names {
            if let Some(server) = servers.get(name) {
                if server.is_healthy().await {
                    return Some(name.clone());
                }
            }
        }
        None
    }

    /// 获取所有服务器状态
    pub async fn get_all_server_status(&self) -> HashMap<String, LSPServerState> {
        let servers = self.servers.read().await;
        let mut status = HashMap::new();
        for (name, server) in servers.iter() {
            status.insert(name.clone(), server.get_state().await);
        }
        status
    }

    /// 获取文件的诊断信息
    pub async fn get_file_diagnostics(&self, file_path: &Path) -> Vec<LSPDiagnostic> {
        let uri = format!("file://{}", file_path.display());
        self.diagnostics_cache
            .read()
            .await
            .get(&uri)
            .cloned()
            .unwrap_or_default()
    }

    /// 清除诊断缓存
    pub async fn clear_diagnostics(&self, file_path: Option<&Path>) {
        if let Some(path) = file_path {
            let uri = format!("file://{}", path.display());
            self.diagnostics_cache.write().await.remove(&uri);
        } else {
            self.diagnostics_cache.write().await.clear();
        }
    }
}
