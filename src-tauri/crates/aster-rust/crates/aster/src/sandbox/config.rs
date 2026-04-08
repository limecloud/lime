//! 沙箱配置
//!
//! 提供沙箱配置管理、预设、验证功能

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, RwLock};

/// 资源限制
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ResourceLimits {
    /// 最大内存（字节）
    pub max_memory: Option<u64>,
    /// 最大 CPU 使用率 (0-100)
    pub max_cpu: Option<u32>,
    /// 最大进程数
    pub max_processes: Option<u32>,
    /// 最大文件大小（字节）
    pub max_file_size: Option<u64>,
    /// 最大执行时间（毫秒）
    pub max_execution_time: Option<u64>,
    /// 最大文件描述符数
    pub max_file_descriptors: Option<u32>,
}

/// 沙箱类型
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SandboxType {
    /// Bubblewrap (Linux)
    Bubblewrap,
    /// Docker 容器
    Docker,
    /// Firejail (Linux)
    Firejail,
    /// Seatbelt (macOS)
    Seatbelt,
    /// 无沙箱
    #[default]
    None,
}

/// 审计日志配置
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AuditLogging {
    /// 是否启用
    pub enabled: bool,
    /// 日志文件路径
    pub log_file: Option<PathBuf>,
    /// 日志级别
    pub log_level: LogLevel,
}

/// 日志级别
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LogLevel {
    Debug,
    #[default]
    Info,
    Warn,
    Error,
}

/// Docker 配置
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct DockerConfig {
    /// 镜像名称
    pub image: Option<String>,
    /// 容器名称
    pub container_name: Option<String>,
    /// 卷挂载
    pub volumes: Vec<String>,
    /// 端口映射
    pub ports: Vec<String>,
    /// 网络模式
    pub network: Option<String>,
    /// 用户
    pub user: Option<String>,
    /// 工作目录
    pub workdir: Option<String>,
}

/// 沙箱配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SandboxConfig {
    /// 是否启用沙箱
    pub enabled: bool,
    /// 沙箱类型
    pub sandbox_type: SandboxType,
    /// 允许访问的路径
    pub allowed_paths: Vec<PathBuf>,
    /// 禁止访问的路径（优先级更高）
    pub denied_paths: Vec<PathBuf>,
    /// 是否允许网络访问
    pub network_access: bool,
    /// 环境变量
    pub environment_variables: HashMap<String, String>,
    /// 只读路径
    pub read_only_paths: Vec<PathBuf>,
    /// 可写路径
    pub writable_paths: Vec<PathBuf>,
    /// 是否允许 /dev 访问
    pub allow_dev_access: bool,
    /// 是否允许 /proc 访问
    pub allow_proc_access: bool,
    /// 是否允许 /sys 访问
    pub allow_sys_access: bool,
    /// 环境变量白名单
    pub env_whitelist: Vec<String>,
    /// tmpfs 大小
    pub tmpfs_size: String,
    /// 是否隔离所有命名空间
    pub unshare_all: bool,
    /// 是否随父进程退出
    pub die_with_parent: bool,
    /// 是否创建新会话
    pub new_session: bool,
    /// Docker 配置
    pub docker: Option<DockerConfig>,
    /// 自定义参数
    pub custom_args: Vec<String>,
    /// 审计日志
    pub audit_logging: Option<AuditLogging>,
    /// 资源限制
    pub resource_limits: Option<ResourceLimits>,
}

impl Default for SandboxConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            sandbox_type: SandboxType::None,
            allowed_paths: Vec::new(),
            denied_paths: Vec::new(),
            network_access: false,
            environment_variables: HashMap::new(),
            read_only_paths: vec![
                PathBuf::from("/usr"),
                PathBuf::from("/lib"),
                PathBuf::from("/lib64"),
                PathBuf::from("/bin"),
                PathBuf::from("/sbin"),
                PathBuf::from("/etc"),
            ],
            writable_paths: vec![PathBuf::from("/tmp")],
            allow_dev_access: true,
            allow_proc_access: true,
            allow_sys_access: false,
            env_whitelist: Vec::new(),
            tmpfs_size: "100M".to_string(),
            unshare_all: true,
            die_with_parent: true,
            new_session: true,
            docker: None,
            custom_args: Vec::new(),
            audit_logging: None,
            resource_limits: None,
        }
    }
}

/// 沙箱预设类型
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SandboxPreset {
    /// 严格隔离
    Strict,
    /// 开发环境
    Development,
    /// 测试环境
    Testing,
    /// 生产环境
    Production,
    /// Docker 模式
    Docker,
    /// 无限制
    Unrestricted,
    /// Web 爬虫
    WebScraping,
    /// AI 代码执行
    AiCode,
}

/// 预设配置集合
pub static SANDBOX_PRESETS: once_cell::sync::Lazy<HashMap<SandboxPreset, SandboxConfig>> =
    once_cell::sync::Lazy::new(|| {
        let mut presets = HashMap::new();

        // 严格隔离预设
        presets.insert(
            SandboxPreset::Strict,
            SandboxConfig {
                enabled: true,
                sandbox_type: SandboxType::Bubblewrap,
                allowed_paths: Vec::new(),
                denied_paths: vec![PathBuf::from("/home"), PathBuf::from("/root")],
                network_access: false,
                read_only_paths: vec![
                    PathBuf::from("/usr"),
                    PathBuf::from("/lib"),
                    PathBuf::from("/lib64"),
                    PathBuf::from("/bin"),
                    PathBuf::from("/sbin"),
                    PathBuf::from("/etc"),
                ],
                writable_paths: vec![PathBuf::from("/tmp")],
                allow_dev_access: false,
                allow_proc_access: false,
                allow_sys_access: false,
                tmpfs_size: "50M".to_string(),
                resource_limits: Some(ResourceLimits {
                    max_memory: Some(512 * 1024 * 1024),
                    max_cpu: Some(50),
                    max_processes: Some(10),
                    max_file_size: Some(10 * 1024 * 1024),
                    max_execution_time: Some(60000),
                    max_file_descriptors: Some(100),
                }),
                ..Default::default()
            },
        );

        // 开发环境预设
        presets.insert(
            SandboxPreset::Development,
            SandboxConfig {
                enabled: true,
                sandbox_type: SandboxType::Bubblewrap,
                network_access: true,
                allow_dev_access: true,
                allow_proc_access: true,
                tmpfs_size: "200M".to_string(),
                resource_limits: Some(ResourceLimits {
                    max_memory: Some(2 * 1024 * 1024 * 1024),
                    max_cpu: Some(80),
                    max_processes: Some(50),
                    max_execution_time: Some(300000),
                    ..Default::default()
                }),
                ..Default::default()
            },
        );

        // 测试环境预设
        presets.insert(
            SandboxPreset::Testing,
            SandboxConfig {
                enabled: true,
                sandbox_type: SandboxType::Bubblewrap,
                network_access: true,
                allow_dev_access: true,
                allow_proc_access: true,
                tmpfs_size: "200M".to_string(),
                resource_limits: Some(ResourceLimits {
                    max_memory: Some(1024 * 1024 * 1024),
                    max_cpu: Some(75),
                    max_processes: Some(30),
                    max_execution_time: Some(120000),
                    ..Default::default()
                }),
                ..Default::default()
            },
        );

        presets
    });

/// 验证结果
#[derive(Debug, Clone)]
pub struct ValidationResult {
    /// 是否有效
    pub valid: bool,
    /// 错误信息
    pub errors: Vec<String>,
    /// 警告信息
    pub warnings: Vec<String>,
}

/// 沙箱配置管理器
pub struct SandboxConfigManager {
    /// 配置目录
    config_dir: PathBuf,
    /// 配置文件路径
    config_file: PathBuf,
    /// 当前配置
    current_config: Arc<RwLock<SandboxConfig>>,
}

impl SandboxConfigManager {
    /// 创建新的配置管理器
    pub fn new(config_dir: Option<PathBuf>) -> Self {
        let config_dir = config_dir.unwrap_or_else(|| {
            dirs::home_dir()
                .unwrap_or_else(|| PathBuf::from("~"))
                .join(".aster")
                .join("sandbox")
        });
        let config_file = config_dir.join("config.json");
        let current_config = Arc::new(RwLock::new(SandboxConfig::default()));

        let mut manager = Self {
            config_dir,
            config_file,
            current_config,
        };
        manager.load_config_sync();
        manager
    }

    /// 同步加载配置
    fn load_config_sync(&mut self) {
        if let Ok(content) = std::fs::read_to_string(&self.config_file) {
            if let Ok(config) = serde_json::from_str::<SandboxConfig>(&content) {
                if let Ok(mut current) = self.current_config.write() {
                    *current = config;
                }
            }
        }
    }

    /// 异步加载配置
    pub async fn load_config(&self) -> anyhow::Result<SandboxConfig> {
        let content = tokio::fs::read_to_string(&self.config_file).await?;
        let config: SandboxConfig = serde_json::from_str(&content)?;
        if let Ok(mut current) = self.current_config.write() {
            *current = config.clone();
        }
        Ok(config)
    }

    /// 验证配置
    pub fn validate_config(&self, config: &SandboxConfig) -> ValidationResult {
        let errors = Vec::new();
        let mut warnings = Vec::new();

        // 检查平台兼容性
        if config.enabled && config.sandbox_type == SandboxType::Bubblewrap {
            #[cfg(not(target_os = "linux"))]
            warnings.push("Bubblewrap 仅在 Linux 上可用，沙箱将被禁用".to_string());
        }

        if config.enabled && config.sandbox_type == SandboxType::Seatbelt {
            #[cfg(not(target_os = "macos"))]
            warnings.push("Seatbelt 仅在 macOS 上可用，沙箱将被禁用".to_string());
        }

        // 检查路径冲突
        for allowed in &config.allowed_paths {
            for denied in &config.denied_paths {
                if allowed.starts_with(denied) || denied.starts_with(allowed) {
                    warnings.push(format!(
                        "路径冲突: {} vs {}",
                        allowed.display(),
                        denied.display()
                    ));
                }
            }
        }

        // 检查资源限制
        if let Some(ref limits) = config.resource_limits {
            if let Some(max_memory) = limits.max_memory {
                if max_memory > 4 * 1024 * 1024 * 1024 {
                    warnings.push("max_memory > 4GB 可能在某些系统上导致问题".to_string());
                }
            }
        }

        ValidationResult {
            valid: errors.is_empty(),
            errors,
            warnings,
        }
    }

    /// 合并配置
    pub fn merge_configs(
        &self,
        base: &SandboxConfig,
        override_config: &SandboxConfig,
    ) -> SandboxConfig {
        SandboxConfig {
            enabled: override_config.enabled,
            sandbox_type: override_config.sandbox_type,
            allowed_paths: if override_config.allowed_paths.is_empty() {
                base.allowed_paths.clone()
            } else {
                override_config.allowed_paths.clone()
            },
            denied_paths: if override_config.denied_paths.is_empty() {
                base.denied_paths.clone()
            } else {
                override_config.denied_paths.clone()
            },
            network_access: override_config.network_access,
            environment_variables: {
                let mut env = base.environment_variables.clone();
                env.extend(override_config.environment_variables.clone());
                env
            },
            read_only_paths: if override_config.read_only_paths.is_empty() {
                base.read_only_paths.clone()
            } else {
                override_config.read_only_paths.clone()
            },
            writable_paths: if override_config.writable_paths.is_empty() {
                base.writable_paths.clone()
            } else {
                override_config.writable_paths.clone()
            },
            allow_dev_access: override_config.allow_dev_access,
            allow_proc_access: override_config.allow_proc_access,
            allow_sys_access: override_config.allow_sys_access,
            env_whitelist: if override_config.env_whitelist.is_empty() {
                base.env_whitelist.clone()
            } else {
                override_config.env_whitelist.clone()
            },
            tmpfs_size: override_config.tmpfs_size.clone(),
            unshare_all: override_config.unshare_all,
            die_with_parent: override_config.die_with_parent,
            new_session: override_config.new_session,
            docker: override_config
                .docker
                .clone()
                .or_else(|| base.docker.clone()),
            custom_args: if override_config.custom_args.is_empty() {
                base.custom_args.clone()
            } else {
                override_config.custom_args.clone()
            },
            audit_logging: override_config
                .audit_logging
                .clone()
                .or_else(|| base.audit_logging.clone()),
            resource_limits: override_config
                .resource_limits
                .clone()
                .or_else(|| base.resource_limits.clone()),
        }
    }

    /// 获取预设配置
    pub fn get_preset(&self, preset: SandboxPreset) -> Option<SandboxConfig> {
        SANDBOX_PRESETS.get(&preset).cloned()
    }

    /// 获取当前配置
    pub fn get_config(&self) -> SandboxConfig {
        self.current_config
            .read()
            .map(|c| c.clone())
            .unwrap_or_default()
    }

    /// 更新配置
    pub async fn update_config(&self, config: SandboxConfig) -> anyhow::Result<()> {
        if let Ok(mut current) = self.current_config.write() {
            *current = config;
        }
        self.save_config().await
    }

    /// 保存配置到文件
    pub async fn save_config(&self) -> anyhow::Result<()> {
        tokio::fs::create_dir_all(&self.config_dir).await?;
        let config = self.get_config();
        let content = serde_json::to_string_pretty(&config)?;
        tokio::fs::write(&self.config_file, content).await?;
        Ok(())
    }

    /// 重置为默认配置
    pub async fn reset(&self) -> anyhow::Result<()> {
        self.update_config(SandboxConfig::default()).await
    }

    /// 检查路径是否允许访问
    pub fn is_path_allowed(&self, target_path: &std::path::Path) -> bool {
        let config = self.get_config();

        // 禁止路径优先
        for denied in &config.denied_paths {
            if target_path.starts_with(denied) {
                return false;
            }
        }

        // 检查允许路径
        if config.allowed_paths.is_empty() {
            return true;
        }

        for allowed in &config.allowed_paths {
            if target_path.starts_with(allowed) {
                return true;
            }
        }

        false
    }

    /// 检查路径是否可写
    pub fn is_path_writable(&self, target_path: &std::path::Path) -> bool {
        if !self.is_path_allowed(target_path) {
            return false;
        }

        let config = self.get_config();
        for writable in &config.writable_paths {
            if target_path.starts_with(writable) {
                return true;
            }
        }

        false
    }
}
