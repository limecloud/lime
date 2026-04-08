//! LSP 服务器配置
//!
//! 定义 LSP 服务器配置结构和默认配置

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;

/// LSP 服务器配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LSPServerConfig {
    /// 服务器名称
    pub name: String,
    /// 可执行文件路径或命令
    pub command: String,
    /// 命令行参数
    #[serde(default)]
    pub args: Vec<String>,
    /// 支持的文件扩展名
    pub file_extensions: Vec<String>,

    /// 文件扩展名到语言ID的映射
    #[serde(default)]
    pub extension_to_language: HashMap<String, String>,
    /// 初始化选项
    #[serde(default)]
    pub initialization_options: Option<serde_json::Value>,
    /// 服务器设置
    #[serde(default)]
    pub settings: Option<serde_json::Value>,
    /// 环境变量
    #[serde(default)]
    pub env: HashMap<String, String>,
    /// 工作区文件夹路径
    pub workspace_folder: Option<String>,
    /// 启动超时时间 (毫秒)
    #[serde(default = "default_startup_timeout")]
    pub startup_timeout: u64,
    /// 崩溃后是否自动重启
    #[serde(default = "default_restart_on_crash")]
    pub restart_on_crash: bool,
    /// 最大重启次数
    #[serde(default = "default_max_restarts")]
    pub max_restarts: u32,
    /// 配置来源
    pub source: Option<String>,
}

fn default_startup_timeout() -> u64 {
    30000
}
fn default_restart_on_crash() -> bool {
    true
}
fn default_max_restarts() -> u32 {
    3
}

impl Default for LSPServerConfig {
    fn default() -> Self {
        Self {
            name: String::new(),
            command: String::new(),
            args: Vec::new(),
            file_extensions: Vec::new(),
            extension_to_language: HashMap::new(),
            initialization_options: None,
            settings: None,
            env: HashMap::new(),
            workspace_folder: None,
            startup_timeout: default_startup_timeout(),
            restart_on_crash: default_restart_on_crash(),
            max_restarts: default_max_restarts(),
            source: None,
        }
    }
}

/// .lsp.json 配置文件格式
pub type LSPConfigFile = HashMap<String, LSPServerConfig>;

/// 加载 .lsp.json 配置文件
pub fn load_lsp_config_file(workspace_root: &Path) -> Vec<LSPServerConfig> {
    let search_paths = [
        workspace_root.join(".lsp.json"),
        workspace_root.join(".claude/lsp.json"),
        dirs::home_dir()
            .map(|h| h.join(".claude/lsp.json"))
            .unwrap_or_default(),
    ];

    let mut configs = Vec::new();

    for config_path in &search_paths {
        if !config_path.exists() {
            continue;
        }

        match std::fs::read_to_string(config_path) {
            Ok(content) => match serde_json::from_str::<LSPConfigFile>(&content) {
                Ok(config_file) => {
                    for (name, mut config) in config_file {
                        config.name = name;
                        config.source = Some(config_path.display().to_string());
                        configs.push(config);
                    }
                }
                Err(e) => {
                    tracing::warn!("解析 LSP 配置文件失败 {}: {}", config_path.display(), e);
                }
            },
            Err(e) => {
                tracing::warn!("读取 LSP 配置文件失败 {}: {}", config_path.display(), e);
            }
        }
    }

    configs
}

/// 默认 LSP 服务器配置
pub fn default_lsp_configs() -> Vec<LSPServerConfig> {
    vec![
        LSPServerConfig {
            name: "typescript-language-server".to_string(),
            command: "typescript-language-server".to_string(),
            args: vec!["--stdio".to_string()],
            file_extensions: vec![
                ".ts".to_string(),
                ".tsx".to_string(),
                ".js".to_string(),
                ".jsx".to_string(),
            ],
            extension_to_language: [
                (".ts".to_string(), "typescript".to_string()),
                (".tsx".to_string(), "typescriptreact".to_string()),
                (".js".to_string(), "javascript".to_string()),
                (".jsx".to_string(), "javascriptreact".to_string()),
            ]
            .into_iter()
            .collect(),
            restart_on_crash: true,
            max_restarts: 3,
            ..Default::default()
        },
        LSPServerConfig {
            name: "pyright".to_string(),
            command: "pyright-langserver".to_string(),
            args: vec!["--stdio".to_string()],
            file_extensions: vec![".py".to_string()],
            extension_to_language: [(".py".to_string(), "python".to_string())]
                .into_iter()
                .collect(),
            restart_on_crash: true,
            max_restarts: 3,
            ..Default::default()
        },
        LSPServerConfig {
            name: "rust-analyzer".to_string(),
            command: "rust-analyzer".to_string(),
            args: vec![],
            file_extensions: vec![".rs".to_string()],
            extension_to_language: [(".rs".to_string(), "rust".to_string())]
                .into_iter()
                .collect(),
            restart_on_crash: true,
            max_restarts: 3,
            ..Default::default()
        },
    ]
}
