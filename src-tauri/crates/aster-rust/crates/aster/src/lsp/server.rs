//! LSP 服务器实例
//!
//! 管理单个语言服务器的生命周期和通信

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tokio::process::{Child, Command};
use tokio::sync::{mpsc, RwLock};

use super::config::LSPServerConfig;

/// LSP 服务器状态
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum LSPServerState {
    Initializing,
    Ready,
    Error,
    Stopped,
}

/// LSP 诊断信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LSPDiagnostic {
    pub range: LSPRange,
    pub severity: Option<u32>,
    pub message: String,
    pub source: Option<String>,
    pub code: Option<String>,
}

/// LSP 范围
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LSPRange {
    pub start: LSPPosition,
    pub end: LSPPosition,
}

/// LSP 位置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LSPPosition {
    pub line: u32,
    pub character: u32,
}

/// 打开的文档
#[derive(Debug, Clone)]
struct OpenDocument {
    uri: String,
    language_id: String,
    version: u32,
    content: String,
}

/// LSP 服务器实例
pub struct LSPServer {
    config: LSPServerConfig,
    state: Arc<RwLock<LSPServerState>>,
    process: Arc<RwLock<Option<Child>>>,
    next_request_id: AtomicU64,
    open_documents: Arc<RwLock<HashMap<String, OpenDocument>>>,
    workspace_root: Arc<RwLock<String>>,
    restart_count: Arc<RwLock<u32>>,
    request_tx: Option<mpsc::Sender<String>>,
}

impl LSPServer {
    /// 创建新的 LSP 服务器实例
    pub fn new(config: LSPServerConfig) -> Self {
        Self {
            config,
            state: Arc::new(RwLock::new(LSPServerState::Stopped)),
            process: Arc::new(RwLock::new(None)),
            next_request_id: AtomicU64::new(1),
            open_documents: Arc::new(RwLock::new(HashMap::new())),
            workspace_root: Arc::new(RwLock::new(String::new())),
            restart_count: Arc::new(RwLock::new(0)),
            request_tx: None,
        }
    }

    /// 启动 LSP 服务器
    pub async fn start(&mut self, workspace_root: &Path) -> Result<(), String> {
        let mut state = self.state.write().await;
        if *state != LSPServerState::Stopped {
            return Err(format!("服务器已启动 (状态: {:?})", *state));
        }

        *state = LSPServerState::Initializing;
        *self.workspace_root.write().await = workspace_root.display().to_string();

        // 启动进程
        let mut cmd = Command::new(&self.config.command);
        cmd.args(&self.config.args)
            .current_dir(workspace_root)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        // 设置环境变量
        for (key, value) in &self.config.env {
            cmd.env(key, value);
        }

        match cmd.spawn() {
            Ok(child) => {
                *self.process.write().await = Some(child);
                *state = LSPServerState::Ready;
                tracing::info!("[LSP] {} 启动成功", self.config.name);
                Ok(())
            }
            Err(e) => {
                *state = LSPServerState::Error;
                Err(format!("启动 {} 失败: {}", self.config.name, e))
            }
        }
    }

    /// 停止 LSP 服务器
    pub async fn stop(&mut self) -> Result<(), String> {
        let mut state = self.state.write().await;
        if *state == LSPServerState::Stopped {
            return Ok(());
        }

        // 杀死进程
        if let Some(mut child) = self.process.write().await.take() {
            let _ = child.kill().await;
        }

        *state = LSPServerState::Stopped;
        tracing::info!("[LSP] {} 已停止", self.config.name);
        Ok(())
    }

    /// 获取状态
    pub async fn get_state(&self) -> LSPServerState {
        *self.state.read().await
    }

    /// 获取配置
    pub fn get_config(&self) -> &LSPServerConfig {
        &self.config
    }

    /// 检查服务器是否健康
    pub async fn is_healthy(&self) -> bool {
        *self.state.read().await == LSPServerState::Ready
    }

    /// 获取重启次数
    pub async fn get_restart_count(&self) -> u32 {
        *self.restart_count.read().await
    }

    /// 打开文档
    pub async fn open_document(&self, file_path: &Path, content: &str, language_id: &str) {
        let uri = format!("file://{}", file_path.display());
        let doc = OpenDocument {
            uri: uri.clone(),
            language_id: language_id.to_string(),
            version: 1,
            content: content.to_string(),
        };
        self.open_documents
            .write()
            .await
            .insert(file_path.display().to_string(), doc);
    }

    /// 关闭文档
    pub async fn close_document(&self, file_path: &Path) {
        self.open_documents
            .write()
            .await
            .remove(&file_path.display().to_string());
    }

    /// 检查文档是否打开
    pub async fn is_document_open(&self, file_path: &Path) -> bool {
        self.open_documents
            .read()
            .await
            .contains_key(&file_path.display().to_string())
    }

    /// 获取下一个请求 ID
    fn next_id(&self) -> u64 {
        self.next_request_id.fetch_add(1, Ordering::SeqCst)
    }
}
