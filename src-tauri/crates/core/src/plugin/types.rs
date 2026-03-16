//! 插件系统类型定义
//!
//! 定义 Plugin trait、PluginContext、PluginManifest 等核心类型

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fmt;
use std::path::PathBuf;
use std::sync::Arc;
use thiserror::Error;

use crate::ProviderType;

/// 插件错误类型
#[derive(Error, Debug)]
pub enum PluginError {
    #[error("插件加载失败: {0}")]
    LoadError(String),

    #[error("插件初始化失败: {0}")]
    InitError(String),

    #[error("插件执行超时: {plugin_name} 超过 {timeout_ms}ms")]
    Timeout {
        plugin_name: String,
        timeout_ms: u64,
    },

    #[error("插件执行失败: {plugin_name} - {message}")]
    ExecutionError {
        plugin_name: String,
        message: String,
    },

    #[error("插件配置错误: {0}")]
    ConfigError(String),

    #[error("插件不存在: {0}")]
    NotFound(String),

    #[error("插件已禁用: {0}")]
    Disabled(String),

    #[error("清单文件无效: {0}")]
    InvalidManifest(String),

    #[error("IO 错误: {0}")]
    IoError(#[from] std::io::Error),

    #[error("JSON 解析错误: {0}")]
    JsonError(#[from] serde_json::Error),
}

/// 插件状态
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum PluginStatus {
    /// 已加载但未启用
    #[default]
    Loaded,
    /// 已启用
    Enabled,
    /// 已禁用
    Disabled,
    /// 错误状态
    Error,
}

impl fmt::Display for PluginStatus {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            PluginStatus::Loaded => write!(f, "loaded"),
            PluginStatus::Enabled => write!(f, "enabled"),
            PluginStatus::Disabled => write!(f, "disabled"),
            PluginStatus::Error => write!(f, "error"),
        }
    }
}

/// 插件清单 (manifest.json / plugin.json)
///
/// 描述插件的元数据、依赖和入口点
/// _需求: 5.1, 5.2, 5.3_
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PluginManifest {
    /// 插件名称
    pub name: String,
    /// 插件版本
    pub version: String,
    /// 插件描述
    #[serde(default)]
    pub description: String,
    /// 作者
    #[serde(default)]
    pub author: Option<String>,
    /// 主页/仓库地址
    #[serde(default)]
    pub homepage: Option<String>,
    /// 许可证
    #[serde(default)]
    pub license: Option<String>,
    /// 入口文件 (相对于插件目录)
    #[serde(default = "default_entry")]
    pub entry: String,
    /// 插件类型
    #[serde(default)]
    pub plugin_type: PluginType,
    /// 配置 schema (JSON Schema)
    #[serde(default)]
    pub config_schema: Option<serde_json::Value>,
    /// 支持的钩子
    #[serde(default)]
    pub hooks: Vec<String>,
    /// 最低 ProxyCast 版本要求
    #[serde(default)]
    pub min_proxycast_version: Option<String>,
    /// Binary 类型插件的扩展配置
    /// _需求: 5.2_
    #[serde(default)]
    pub binary: Option<BinaryManifest>,
    /// UI 配置
    /// _需求: 5.3_
    #[serde(default)]
    pub ui: Option<UiManifest>,
}

fn default_entry() -> String {
    "config.json".to_string()
}

impl PluginManifest {
    /// 验证清单有效性
    pub fn validate(&self) -> Result<(), PluginError> {
        if self.name.is_empty() {
            return Err(PluginError::InvalidManifest("插件名称不能为空".to_string()));
        }
        if self.version.is_empty() {
            return Err(PluginError::InvalidManifest("插件版本不能为空".to_string()));
        }
        Ok(())
    }
}

/// 插件类型
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum PluginType {
    /// 脚本插件 (JSON 配置驱动)
    #[default]
    #[serde(alias = "lua")]
    Script,
    /// 原生 Rust 插件 (预留)
    Native,
    /// 二进制可执行文件
    Binary,
}

/// 平台二进制文件名映射
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PlatformBinaries {
    /// macOS ARM64 (Apple Silicon)
    #[serde(rename = "macos-arm64")]
    pub macos_arm64: String,
    /// macOS x64 (Intel)
    #[serde(rename = "macos-x64")]
    pub macos_x64: String,
    /// Linux x64
    #[serde(rename = "linux-x64")]
    pub linux_x64: String,
    /// Linux ARM64
    #[serde(rename = "linux-arm64")]
    pub linux_arm64: String,
    /// Windows x64
    #[serde(rename = "windows-x64")]
    pub windows_x64: String,
}

impl PlatformBinaries {
    /// 获取当前平台的二进制文件名
    pub fn get_current_platform(&self) -> Option<&str> {
        match (std::env::consts::ARCH, std::env::consts::OS) {
            ("aarch64", "macos") => Some(&self.macos_arm64),
            ("x86_64", "macos") => Some(&self.macos_x64),
            ("x86_64", "linux") => Some(&self.linux_x64),
            ("aarch64", "linux") => Some(&self.linux_arm64),
            ("x86_64", "windows") => Some(&self.windows_x64),
            _ => None,
        }
    }
}

/// Binary 类型的 manifest 扩展字段
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct BinaryManifest {
    /// 二进制文件名（不含平台后缀）
    pub binary_name: String,
    /// GitHub 仓库 owner
    pub github_owner: String,
    /// GitHub 仓库名
    pub github_repo: String,
    /// 平台文件名映射
    pub platform_binaries: PlatformBinaries,
    /// 校验文件名（可选）
    #[serde(default)]
    pub checksum_file: Option<String>,
}

/// UI 配置扩展字段
///
/// 定义插件的 UI 展示配置
/// _需求: 5.2, 5.3_
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct UiManifest {
    /// UI 展示位置 (如 "main", "settings", "sidebar", "tools")
    #[serde(default)]
    pub surfaces: Vec<String>,
    /// 图标名称 (使用 Lucide 图标名)
    #[serde(default)]
    pub icon: Option<String>,
    /// 窗口标题
    #[serde(default)]
    pub title: Option<String>,
    /// 嵌入式 UI 入口文件路径 (相对于插件目录，如 "dist/index.js")
    #[serde(default)]
    pub entry: Option<String>,
    /// UI 描述
    #[serde(default)]
    pub description: Option<String>,
    /// 窗口默认宽度
    #[serde(default)]
    pub default_width: Option<u32>,
    /// 窗口默认高度
    #[serde(default)]
    pub default_height: Option<u32>,
}

/// 二进制组件状态
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BinaryComponentStatus {
    /// 组件名称
    pub name: String,
    /// 是否已安装
    pub installed: bool,
    /// 已安装版本
    pub installed_version: Option<String>,
    /// 最新可用版本
    pub latest_version: Option<String>,
    /// 是否有更新
    pub has_update: bool,
    /// 二进制文件路径
    pub binary_path: Option<String>,
    /// 安装时间
    pub installed_at: Option<String>,
    /// 描述
    pub description: Option<String>,
}

/// 插件上下文 - 传递给钩子函数的上下文信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginContext {
    /// 请求 ID
    pub request_id: String,
    /// Provider 类型
    pub provider: ProviderType,
    /// 模型名称
    pub model: String,
    /// 元数据
    #[serde(default)]
    pub metadata: HashMap<String, serde_json::Value>,
    /// 时间戳
    pub timestamp: DateTime<Utc>,
}

impl PluginContext {
    /// 创建新的插件上下文
    pub fn new(request_id: String, provider: ProviderType, model: String) -> Self {
        Self {
            request_id,
            provider,
            model,
            metadata: HashMap::new(),
            timestamp: Utc::now(),
        }
    }

    /// 添加元数据
    pub fn with_metadata(mut self, key: &str, value: serde_json::Value) -> Self {
        self.metadata.insert(key.to_string(), value);
        self
    }

    /// 获取元数据
    pub fn get_metadata(&self, key: &str) -> Option<&serde_json::Value> {
        self.metadata.get(key)
    }

    /// 设置元数据
    pub fn set_metadata(&mut self, key: &str, value: serde_json::Value) {
        self.metadata.insert(key.to_string(), value);
    }
}

/// 钩子执行结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HookResult {
    /// 是否成功
    pub success: bool,
    /// 是否修改了数据
    pub modified: bool,
    /// 错误信息 (如果失败)
    pub error: Option<String>,
    /// 执行时间 (毫秒)
    pub duration_ms: u64,
}

impl HookResult {
    /// 创建成功结果
    pub fn success(modified: bool, duration_ms: u64) -> Self {
        Self {
            success: true,
            modified,
            error: None,
            duration_ms,
        }
    }

    /// 创建失败结果
    pub fn failure(error: String, duration_ms: u64) -> Self {
        Self {
            success: false,
            modified: false,
            error: Some(error),
            duration_ms,
        }
    }
}

/// 插件配置
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PluginConfig {
    /// 插件特定配置
    #[serde(default)]
    pub settings: serde_json::Value,
    /// 是否启用
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    /// 执行超时 (毫秒)
    #[serde(default = "default_timeout")]
    pub timeout_ms: u64,
}

fn default_enabled() -> bool {
    true
}

fn default_timeout() -> u64 {
    5000 // 5 秒
}

impl PluginConfig {
    /// 创建默认配置
    pub fn new() -> Self {
        Self::default()
    }

    /// 设置配置值
    pub fn with_settings(mut self, settings: serde_json::Value) -> Self {
        self.settings = settings;
        self
    }

    /// 设置启用状态
    pub fn with_enabled(mut self, enabled: bool) -> Self {
        self.enabled = enabled;
        self
    }

    /// 设置超时
    pub fn with_timeout(mut self, timeout_ms: u64) -> Self {
        self.timeout_ms = timeout_ms;
        self
    }
}

/// 插件状态信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginState {
    /// 插件名称
    pub name: String,
    /// 插件状态
    pub status: PluginStatus,
    /// 加载时间
    pub loaded_at: DateTime<Utc>,
    /// 最后执行时间
    pub last_executed: Option<DateTime<Utc>>,
    /// 执行次数
    pub execution_count: u64,
    /// 错误次数
    pub error_count: u64,
    /// 最后错误信息
    pub last_error: Option<String>,
}

impl PluginState {
    /// 创建新的插件状态
    pub fn new(name: String) -> Self {
        Self {
            name,
            status: PluginStatus::Loaded,
            loaded_at: Utc::now(),
            last_executed: None,
            execution_count: 0,
            error_count: 0,
            last_error: None,
        }
    }

    /// 记录执行
    pub fn record_execution(&mut self, success: bool, error: Option<String>) {
        self.last_executed = Some(Utc::now());
        self.execution_count += 1;
        if !success {
            self.error_count += 1;
            self.last_error = error;
        }
    }
}

/// 插件信息 (用于 UI 显示)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginInfo {
    /// 插件名称
    pub name: String,
    /// 插件版本
    pub version: String,
    /// 插件描述
    pub description: String,
    /// 作者
    pub author: Option<String>,
    /// 插件状态
    pub status: PluginStatus,
    /// 插件路径
    pub path: PathBuf,
    /// 支持的钩子
    pub hooks: Vec<String>,
    /// 最低 ProxyCast 版本要求
    pub min_proxycast_version: Option<String>,
    /// 配置 schema
    pub config_schema: Option<serde_json::Value>,
    /// 当前配置
    pub config: PluginConfig,
    /// 运行时状态
    pub state: PluginState,
}

/// 插件 trait - 定义插件必须实现的接口
#[async_trait]
pub trait Plugin: Send + Sync {
    /// 获取插件名称
    fn name(&self) -> &str;

    /// 获取插件版本
    fn version(&self) -> &str;

    /// 获取插件清单
    fn manifest(&self) -> &PluginManifest;

    /// 初始化插件
    async fn init(&mut self, config: &PluginConfig) -> Result<(), PluginError>;

    /// 请求前钩子
    async fn on_request(
        &self,
        ctx: &mut PluginContext,
        request: &mut serde_json::Value,
    ) -> Result<HookResult, PluginError>;

    /// 响应后钩子
    async fn on_response(
        &self,
        ctx: &mut PluginContext,
        response: &mut serde_json::Value,
    ) -> Result<HookResult, PluginError>;

    /// 错误钩子
    async fn on_error(
        &self,
        ctx: &mut PluginContext,
        error: &str,
    ) -> Result<HookResult, PluginError>;

    /// 关闭插件
    async fn shutdown(&mut self) -> Result<(), PluginError>;
}

/// 插件实例包装器 - 用于管理插件生命周期
pub struct PluginInstance {
    /// 插件实现
    pub plugin: Arc<dyn Plugin>,
    /// 插件路径
    pub path: PathBuf,
    /// 插件配置
    pub config: PluginConfig,
    /// 插件状态
    pub state: PluginState,
}

impl PluginInstance {
    /// 创建新的插件实例
    pub fn new(plugin: Arc<dyn Plugin>, path: PathBuf, config: PluginConfig) -> Self {
        let state = PluginState::new(plugin.name().to_string());
        Self {
            plugin,
            path,
            config,
            state,
        }
    }

    /// 获取插件信息
    pub fn info(&self) -> PluginInfo {
        let manifest = self.plugin.manifest();
        PluginInfo {
            name: manifest.name.clone(),
            version: manifest.version.clone(),
            description: manifest.description.clone(),
            author: manifest.author.clone(),
            status: self.state.status,
            path: self.path.clone(),
            hooks: manifest.hooks.clone(),
            min_proxycast_version: manifest.min_proxycast_version.clone(),
            config_schema: manifest.config_schema.clone(),
            config: self.config.clone(),
            state: self.state.clone(),
        }
    }

    /// 是否启用
    pub fn is_enabled(&self) -> bool {
        self.config.enabled && self.state.status == PluginStatus::Enabled
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    /// 生成随机的 PlatformBinaries
    fn arb_platform_binaries() -> impl Strategy<Value = PlatformBinaries> {
        (
            "[a-z0-9_-]{1,30}",
            "[a-z0-9_-]{1,30}",
            "[a-z0-9_-]{1,30}",
            "[a-z0-9_-]{1,30}",
            "[a-z0-9_-]{1,30}",
        )
            .prop_map(
                |(macos_arm64, macos_x64, linux_x64, linux_arm64, windows_x64)| PlatformBinaries {
                    macos_arm64,
                    macos_x64,
                    linux_x64,
                    linux_arm64,
                    windows_x64,
                },
            )
    }

    /// 生成随机的 BinaryManifest
    fn arb_binary_manifest() -> impl Strategy<Value = BinaryManifest> {
        (
            "[a-z0-9_-]{1,20}",
            "[a-z0-9_-]{1,20}",
            "[a-z0-9_-]{1,20}",
            arb_platform_binaries(),
            proptest::option::of("[a-z0-9_-]{1,20}"),
        )
            .prop_map(
                |(binary_name, github_owner, github_repo, platform_binaries, checksum_file)| {
                    BinaryManifest {
                        binary_name,
                        github_owner,
                        github_repo,
                        platform_binaries,
                        checksum_file,
                    }
                },
            )
    }

    /// 生成随机的 UiManifest
    fn arb_ui_manifest() -> impl Strategy<Value = UiManifest> {
        (
            prop::collection::vec("[a-z]{1,10}", 0..3),
            proptest::option::of("[a-z-]{1,20}"),
            proptest::option::of("[a-zA-Z0-9 ]{1,30}"),
            proptest::option::of("[a-z/]{1,30}"),
            proptest::option::of("[a-zA-Z0-9 ]{1,50}"),
            proptest::option::of(100u32..2000u32),
            proptest::option::of(100u32..2000u32),
        )
            .prop_map(
                |(surfaces, icon, title, entry, description, default_width, default_height)| {
                    UiManifest {
                        surfaces,
                        icon,
                        title,
                        entry,
                        description,
                        default_width,
                        default_height,
                    }
                },
            )
    }

    /// 生成随机的 PluginType
    fn arb_plugin_type() -> impl Strategy<Value = PluginType> {
        prop_oneof![
            Just(PluginType::Script),
            Just(PluginType::Native),
            Just(PluginType::Binary),
        ]
    }

    /// 生成随机的 PluginManifest
    ///
    /// 用于属性测试，生成包含所有字段的完整清单
    fn arb_plugin_manifest() -> impl Strategy<Value = PluginManifest> {
        (
            "[a-z0-9_-]{1,20}",                                           // name
            "[0-9]{1,2}\\.[0-9]{1,2}\\.[0-9]{1,2}",                       // version
            "[a-zA-Z0-9 ]{0,50}",                                         // description
            proptest::option::of("[a-zA-Z ]{1,30}"),                      // author
            proptest::option::of("https://[a-z]{1,20}\\.com"),            // homepage
            proptest::option::of("[A-Z]{2,5}"),                           // license
            "[a-z0-9_-]{1,20}",                                           // entry
            arb_plugin_type(),                                            // plugin_type
            prop::collection::vec("[a-z_]{1,15}", 0..5),                  // hooks
            proptest::option::of("[0-9]{1,2}\\.[0-9]{1,2}\\.[0-9]{1,2}"), // min_proxycast_version
            proptest::option::of(arb_binary_manifest()),                  // binary
            proptest::option::of(arb_ui_manifest()),                      // ui
        )
            .prop_map(
                |(
                    name,
                    version,
                    description,
                    author,
                    homepage,
                    license,
                    entry,
                    plugin_type,
                    hooks,
                    min_proxycast_version,
                    binary,
                    ui,
                )| {
                    PluginManifest {
                        name,
                        version,
                        description,
                        author,
                        homepage,
                        license,
                        entry,
                        plugin_type,
                        config_schema: None, // JSON Schema 太复杂，跳过
                        hooks,
                        min_proxycast_version,
                        binary,
                        ui,
                    }
                },
            )
    }

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(20))]

        /// **Feature: plugin-installation, 属性 5: 清单 Round-Trip**
        /// **验证需求: 5.1, 5.2, 5.3**
        ///
        /// *对于任意*有效的 PluginManifest 对象，序列化为 JSON 然后反序列化必须产生等价的对象。
        #[test]
        fn manifest_roundtrip(manifest in arb_plugin_manifest()) {
            // 序列化为 JSON
            let json = serde_json::to_string(&manifest).expect("序列化应该成功");

            // 反序列化回 PluginManifest
            let parsed: PluginManifest = serde_json::from_str(&json).expect("反序列化应该成功");

            // 验证整体相等
            prop_assert_eq!(manifest, parsed, "整个 PluginManifest 应该相等");
        }
    }

    #[test]
    fn test_ui_manifest_serialization() {
        let ui = UiManifest {
            surfaces: vec!["main".to_string(), "settings".to_string()],
            icon: Some("puzzle".to_string()),
            title: Some("Test Plugin".to_string()),
            entry: None,
            description: None,
            default_width: Some(800),
            default_height: Some(600),
        };

        let json = serde_json::to_string(&ui).unwrap();
        assert!(json.contains("main"));
        assert!(json.contains("puzzle"));

        let parsed: UiManifest = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.surfaces, ui.surfaces);
        assert_eq!(parsed.icon, ui.icon);
    }

    #[test]
    fn test_plugin_manifest_with_binary_and_ui() {
        let manifest = PluginManifest {
            name: "machine-id-tool".to_string(),
            version: "0.1.0".to_string(),
            description: "Machine ID 管理工具".to_string(),
            author: Some("ProxyCast Team".to_string()),
            homepage: Some("https://github.com/user/machine-id-tool".to_string()),
            license: Some("MIT".to_string()),
            entry: "machine-id-tool".to_string(),
            plugin_type: PluginType::Binary,
            config_schema: None,
            hooks: vec![],
            min_proxycast_version: Some("1.0.0".to_string()),
            binary: Some(BinaryManifest {
                binary_name: "machine-id-tool".to_string(),
                github_owner: "user".to_string(),
                github_repo: "machine-id-tool".to_string(),
                platform_binaries: PlatformBinaries {
                    macos_arm64: "machine-id-tool-aarch64-apple-darwin".to_string(),
                    macos_x64: "machine-id-tool-x86_64-apple-darwin".to_string(),
                    linux_x64: "machine-id-tool-x86_64-unknown-linux-gnu".to_string(),
                    linux_arm64: "machine-id-tool-aarch64-unknown-linux-gnu".to_string(),
                    windows_x64: "machine-id-tool-x86_64-pc-windows-msvc.exe".to_string(),
                },
                checksum_file: None,
            }),
            ui: Some(UiManifest {
                surfaces: vec!["main".to_string()],
                icon: Some("puzzle".to_string()),
                title: None,
                entry: None,
                description: None,
                default_width: None,
                default_height: None,
            }),
        };

        // 序列化
        let json = serde_json::to_string_pretty(&manifest).unwrap();
        assert!(json.contains("machine-id-tool"));
        assert!(json.contains("binary"));
        assert!(json.contains("platform_binaries"));
        assert!(json.contains("macos-arm64"));

        // 反序列化
        let parsed: PluginManifest = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.name, manifest.name);
        assert!(parsed.binary.is_some());
        assert!(parsed.ui.is_some());

        let binary = parsed.binary.unwrap();
        assert_eq!(binary.binary_name, "machine-id-tool");
        assert_eq!(binary.github_owner, "user");
    }
}
