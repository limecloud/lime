//! 配置管理器
//!
//! 增强版配置管理器，支持多源配置合并、来源追踪、热重载等功能

use notify::{Event, RecommendedWatcher, RecursiveMode, Watcher};
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::SystemTime;

/// 配置重载回调函数类型
pub(crate) type ConfigReloadCallback = Box<dyn Fn(&HashMap<String, Value>) + Send + Sync>;

/// 配置重载回调列表类型
pub(crate) type ConfigReloadCallbackList = Arc<RwLock<Vec<ConfigReloadCallback>>>;

/// 配置来源
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ConfigSource {
    /// 内置默认值
    Default,
    /// 用户全局配置 (~/.aster/settings.yaml)
    UserSettings,
    /// 项目配置 (.aster/settings.yaml)
    ProjectSettings,
    /// 本地配置 (.aster/settings.local.yaml) - 应添加到 .gitignore
    LocalSettings,
    /// 环境变量
    EnvSettings,
    /// 命令行标志
    FlagSettings,
    /// 企业策略配置 (~/.aster/managed_settings.yaml)
    PolicySettings,
}

impl ConfigSource {
    /// 获取配置源优先级（数字越大优先级越高）
    pub fn priority(&self) -> u8 {
        match self {
            ConfigSource::Default => 0,
            ConfigSource::UserSettings => 1,
            ConfigSource::ProjectSettings => 2,
            ConfigSource::LocalSettings => 3,
            ConfigSource::EnvSettings => 4,
            ConfigSource::FlagSettings => 5,
            ConfigSource::PolicySettings => 6,
        }
    }
}

/// 配置源信息
#[derive(Debug, Clone)]
pub struct ConfigSourceInfo {
    /// 配置源类型
    pub source: ConfigSource,
    /// 配置文件路径（如果有）
    pub path: Option<PathBuf>,
    /// 优先级
    pub priority: u8,
    /// 是否存在
    pub exists: bool,
    /// 加载时间
    pub loaded_at: Option<SystemTime>,
}

/// 配置项来源详情
#[derive(Debug, Clone)]
pub struct ConfigKeySource {
    /// 配置键
    pub key: String,
    /// 配置值
    pub value: Value,
    /// 来源
    pub source: ConfigSource,
    /// 来源路径
    pub source_path: Option<PathBuf>,
    /// 被哪些来源覆盖
    pub overridden_by: Vec<ConfigSource>,
}

/// 企业策略配置
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct EnterprisePolicyConfig {
    /// 强制设置（不可被用户覆盖）
    #[serde(default)]
    pub enforced: HashMap<String, Value>,
    /// 默认设置（可被用户覆盖）
    #[serde(default)]
    pub defaults: HashMap<String, Value>,
    /// 禁用的功能
    #[serde(default)]
    pub disabled_features: Vec<String>,
    /// 允许的工具白名单
    #[serde(default)]
    pub allowed_tools: Vec<String>,
    /// 禁止的工具黑名单
    #[serde(default)]
    pub denied_tools: Vec<String>,
    /// 策略元数据
    #[serde(default)]
    pub metadata: PolicyMetadata,
}

/// 策略元数据
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct PolicyMetadata {
    pub version: Option<String>,
    pub last_updated: Option<String>,
    pub organization_id: Option<String>,
    pub policy_name: Option<String>,
}

/// 配置管理器选项
#[derive(Debug, Clone, Default)]
pub struct ConfigManagerOptions {
    /// 标志配置文件路径
    pub flag_settings_path: Option<PathBuf>,
    /// 工作目录
    pub working_directory: Option<PathBuf>,
    /// 调试模式
    pub debug_mode: bool,
    /// CLI 标志
    pub cli_flags: HashMap<String, Value>,
}

/// 配置管理器
pub struct ConfigManager {
    /// 全局配置目录
    global_config_dir: PathBuf,
    /// 用户配置文件
    user_config_file: PathBuf,
    /// 项目配置文件
    project_config_file: PathBuf,
    /// 本地配置文件
    local_config_file: PathBuf,
    /// 企业策略配置文件
    policy_config_file: PathBuf,
    /// 标志配置文件
    flag_config_file: Option<PathBuf>,

    /// 合并后的配置
    merged_config: RwLock<HashMap<String, Value>>,
    /// 配置来源映射
    config_sources: RwLock<HashMap<String, ConfigSource>>,
    /// 配置来源路径映射
    config_source_paths: RwLock<HashMap<String, PathBuf>>,
    /// 配置覆盖历史
    config_history: RwLock<HashMap<String, Vec<ConfigKeySource>>>,
    /// 已加载的配置源
    loaded_sources: RwLock<Vec<ConfigSourceInfo>>,
    /// 企业策略
    enterprise_policy: RwLock<Option<EnterprisePolicyConfig>>,
    /// 文件监听器
    watcher: RwLock<Option<RecommendedWatcher>>,
    /// 重载回调
    reload_callbacks: ConfigReloadCallbackList,
    /// CLI 标志
    cli_flags: HashMap<String, Value>,
    /// 调试模式
    debug_mode: bool,
}

impl ConfigManager {
    /// 创建新的配置管理器
    pub fn new(options: ConfigManagerOptions) -> Self {
        let working_dir = options
            .working_directory
            .unwrap_or_else(|| std::env::current_dir().unwrap_or_default());

        // 全局配置目录
        let global_config_dir = std::env::var("ASTER_CONFIG_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|_| dirs::home_dir().unwrap_or_default().join(".aster"));

        // 用户配置文件
        let user_config_file = global_config_dir.join("settings.yaml");

        // 企业策略配置文件
        let managed_settings = global_config_dir.join("managed_settings.yaml");
        let policy_json = global_config_dir.join("policy.yaml");
        let policy_config_file = if managed_settings.exists() {
            managed_settings
        } else {
            policy_json
        };

        // 项目配置文件
        let project_config_file = working_dir.join(".aster").join("settings.yaml");

        // 本地配置文件
        let local_config_file = working_dir.join(".aster").join("settings.local.yaml");

        let debug_mode = options.debug_mode
            || std::env::var("ASTER_DEBUG")
                .map(|v| v == "true")
                .unwrap_or(false);

        let mut manager = Self {
            global_config_dir,
            user_config_file,
            project_config_file,
            local_config_file,
            policy_config_file,
            flag_config_file: options.flag_settings_path,
            merged_config: RwLock::new(HashMap::new()),
            config_sources: RwLock::new(HashMap::new()),
            config_source_paths: RwLock::new(HashMap::new()),
            config_history: RwLock::new(HashMap::new()),
            loaded_sources: RwLock::new(Vec::new()),
            enterprise_policy: RwLock::new(None),
            watcher: RwLock::new(None),
            reload_callbacks: Arc::new(RwLock::new(Vec::new())),
            cli_flags: options.cli_flags,
            debug_mode,
        };

        manager.load_and_merge_config();
        manager
    }

    /// 加载并合并所有配置源
    ///
    /// 优先级链（从低到高）:
    /// 1. default - 内置默认值
    /// 2. userSettings - 用户全局配置
    /// 3. projectSettings - 项目配置
    /// 4. localSettings - 本地配置
    /// 5. envSettings - 环境变量
    /// 6. flagSettings - 命令行标志
    /// 7. policySettings - 企业策略（最高优先级）
    fn load_and_merge_config(&mut self) {
        self.config_sources.write().clear();
        self.config_source_paths.write().clear();
        self.config_history.write().clear();
        self.loaded_sources.write().clear();

        let load_time = SystemTime::now();
        let mut config: HashMap<String, Value> = HashMap::new();

        // 1. 默认配置
        let defaults = self.get_default_config();
        self.track_config_source(&defaults, ConfigSource::Default, None);
        config.extend(defaults);
        self.loaded_sources.write().push(ConfigSourceInfo {
            source: ConfigSource::Default,
            path: None,
            priority: ConfigSource::Default.priority(),
            exists: true,
            loaded_at: Some(load_time),
        });

        // 2. 加载企业策略默认值
        if let Some(policy) = self.load_enterprise_policy() {
            if !policy.defaults.is_empty() {
                self.merge_config(
                    &mut config,
                    &policy.defaults,
                    ConfigSource::PolicySettings,
                    Some(&self.policy_config_file.clone()),
                );
                self.debug_log("加载企业策略默认值");
            }
            *self.enterprise_policy.write() = Some(policy);
        }

        // 3. 用户配置
        let user_exists = self.user_config_file.exists();
        self.loaded_sources.write().push(ConfigSourceInfo {
            source: ConfigSource::UserSettings,
            path: Some(self.user_config_file.clone()),
            priority: ConfigSource::UserSettings.priority(),
            exists: user_exists,
            loaded_at: Some(load_time),
        });
        if user_exists {
            if let Some(user_config) = self.load_config_file(&self.user_config_file) {
                self.merge_config(
                    &mut config,
                    &user_config,
                    ConfigSource::UserSettings,
                    Some(&self.user_config_file.clone()),
                );
                self.debug_log(&format!("加载用户配置: {:?}", self.user_config_file));
            }
        }

        // 4. 项目配置
        let project_exists = self.project_config_file.exists();
        self.loaded_sources.write().push(ConfigSourceInfo {
            source: ConfigSource::ProjectSettings,
            path: Some(self.project_config_file.clone()),
            priority: ConfigSource::ProjectSettings.priority(),
            exists: project_exists,
            loaded_at: Some(load_time),
        });
        if project_exists {
            if let Some(project_config) = self.load_config_file(&self.project_config_file) {
                self.merge_config(
                    &mut config,
                    &project_config,
                    ConfigSource::ProjectSettings,
                    Some(&self.project_config_file.clone()),
                );
                self.debug_log(&format!("加载项目配置: {:?}", self.project_config_file));
            }
        }

        // 5. 本地配置
        let local_exists = self.local_config_file.exists();
        self.loaded_sources.write().push(ConfigSourceInfo {
            source: ConfigSource::LocalSettings,
            path: Some(self.local_config_file.clone()),
            priority: ConfigSource::LocalSettings.priority(),
            exists: local_exists,
            loaded_at: Some(load_time),
        });
        if local_exists {
            if let Some(local_config) = self.load_config_file(&self.local_config_file) {
                self.merge_config(
                    &mut config,
                    &local_config,
                    ConfigSource::LocalSettings,
                    Some(&self.local_config_file.clone()),
                );
                self.debug_log(&format!("加载本地配置: {:?}", self.local_config_file));
            }
        }

        // 6. 环境变量
        let env_config = self.get_env_config();
        if !env_config.is_empty() {
            self.merge_config(&mut config, &env_config, ConfigSource::EnvSettings, None);
            self.loaded_sources.write().push(ConfigSourceInfo {
                source: ConfigSource::EnvSettings,
                path: None,
                priority: ConfigSource::EnvSettings.priority(),
                exists: true,
                loaded_at: Some(load_time),
            });
            self.debug_log(&format!("加载 {} 个环境变量配置", env_config.len()));
        }

        // 7. 标志配置文件
        if let Some(ref flag_file) = self.flag_config_file {
            let flag_exists = flag_file.exists();
            self.loaded_sources.write().push(ConfigSourceInfo {
                source: ConfigSource::FlagSettings,
                path: Some(flag_file.clone()),
                priority: ConfigSource::FlagSettings.priority(),
                exists: flag_exists,
                loaded_at: Some(load_time),
            });
            if flag_exists {
                if let Some(flag_config) = self.load_config_file(flag_file) {
                    self.merge_config(
                        &mut config,
                        &flag_config,
                        ConfigSource::FlagSettings,
                        Some(flag_file),
                    );
                    self.debug_log(&format!("加载标志配置: {:?}", flag_file));
                }
            }
        }

        // 8. CLI 标志
        if !self.cli_flags.is_empty() {
            self.merge_config(
                &mut config,
                &self.cli_flags,
                ConfigSource::FlagSettings,
                None,
            );
            self.debug_log(&format!("应用 {} 个 CLI 标志", self.cli_flags.len()));
        }

        // 9. 企业策略强制设置（最高优先级）
        if let Some(ref policy) = *self.enterprise_policy.read() {
            if !policy.enforced.is_empty() {
                self.merge_config(
                    &mut config,
                    &policy.enforced,
                    ConfigSource::PolicySettings,
                    Some(&self.policy_config_file.clone()),
                );
                self.loaded_sources.write().push(ConfigSourceInfo {
                    source: ConfigSource::PolicySettings,
                    path: Some(self.policy_config_file.clone()),
                    priority: ConfigSource::PolicySettings.priority(),
                    exists: true,
                    loaded_at: Some(load_time),
                });
                self.debug_log("应用企业策略强制设置");
            }
        }

        *self.merged_config.write() = config;

        if self.debug_mode {
            self.print_debug_info();
        }
    }

    /// 获取默认配置
    fn get_default_config(&self) -> HashMap<String, Value> {
        let mut defaults = HashMap::new();
        defaults.insert(
            "model".to_string(),
            Value::String("claude-3-5-sonnet".to_string()),
        );
        defaults.insert("max_tokens".to_string(), Value::Number(4096.into()));
        defaults.insert(
            "temperature".to_string(),
            Value::Number(serde_json::Number::from_f64(0.7).unwrap()),
        );
        defaults.insert("enable_telemetry".to_string(), Value::Bool(false));
        defaults.insert("theme".to_string(), Value::String("auto".to_string()));
        defaults
    }

    /// 从环境变量获取配置
    fn get_env_config(&self) -> HashMap<String, Value> {
        let mut config = HashMap::new();
        let env_mappings = [
            ("ASTER_API_KEY", "api_key"),
            ("ASTER_MODEL", "model"),
            ("ASTER_MAX_TOKENS", "max_tokens"),
            ("ASTER_PROVIDER", "api_provider"),
            ("ASTER_ENABLE_TELEMETRY", "enable_telemetry"),
        ];

        for (env_key, config_key) in env_mappings {
            if let Ok(val) = std::env::var(env_key) {
                if let Some(parsed) = self.parse_env_value(&val) {
                    config.insert(config_key.to_string(), parsed);
                }
            }
        }
        config
    }

    /// 解析环境变量值
    fn parse_env_value(&self, val: &str) -> Option<Value> {
        // 尝试 JSON 解析
        if let Ok(json_value) = serde_json::from_str(val) {
            return Some(json_value);
        }

        let trimmed = val.trim();

        // 布尔值
        match trimmed.to_lowercase().as_str() {
            "true" => return Some(Value::Bool(true)),
            "false" => return Some(Value::Bool(false)),
            _ => {}
        }

        // 整数
        if let Ok(int_val) = trimmed.parse::<i64>() {
            return Some(Value::Number(int_val.into()));
        }

        // 浮点数
        if let Ok(float_val) = trimmed.parse::<f64>() {
            if let Some(num) = serde_json::Number::from_f64(float_val) {
                return Some(Value::Number(num));
            }
        }

        // 字符串
        Some(Value::String(val.to_string()))
    }

    /// 加载配置文件
    fn load_config_file(&self, path: &Path) -> Option<HashMap<String, Value>> {
        if !path.exists() {
            return None;
        }

        match fs::read_to_string(path) {
            Ok(content) => {
                // 尝试 YAML 解析
                if let Ok(yaml_value) = serde_yaml::from_str::<serde_yaml::Value>(&content) {
                    if let Ok(Value::Object(map)) = serde_json::to_value(yaml_value) {
                        return Some(map.into_iter().collect());
                    }
                }
                // 尝试 JSON 解析
                if let Ok(Value::Object(map)) = serde_json::from_str::<Value>(&content) {
                    return Some(map.into_iter().collect());
                }
                tracing::warn!("无法解析配置文件: {:?}", path);
                None
            }
            Err(e) => {
                tracing::warn!("读取配置文件失败: {:?}, 错误: {}", path, e);
                None
            }
        }
    }

    /// 加载企业策略配置
    fn load_enterprise_policy(&self) -> Option<EnterprisePolicyConfig> {
        if !self.policy_config_file.exists() {
            return None;
        }

        match fs::read_to_string(&self.policy_config_file) {
            Ok(content) => {
                // 尝试 YAML
                if let Ok(policy) = serde_yaml::from_str(&content) {
                    self.debug_log(&format!("加载企业策略: {:?}", self.policy_config_file));
                    return Some(policy);
                }
                // 尝试 JSON
                if let Ok(policy) = serde_json::from_str(&content) {
                    self.debug_log(&format!("加载企业策略: {:?}", self.policy_config_file));
                    return Some(policy);
                }
                tracing::warn!("无法解析企业策略文件");
                None
            }
            Err(e) => {
                tracing::warn!("读取企业策略失败: {}", e);
                None
            }
        }
    }

    /// 合并配置并追踪来源
    fn merge_config(
        &self,
        base: &mut HashMap<String, Value>,
        override_config: &HashMap<String, Value>,
        source: ConfigSource,
        source_path: Option<&PathBuf>,
    ) {
        for (key, value) in override_config {
            // 追踪覆盖历史
            if let Some(prev_source) = self.config_sources.read().get(key) {
                if *prev_source != source {
                    let mut history = self.config_history.write();
                    let entry = history.entry(key.clone()).or_default();
                    entry.push(ConfigKeySource {
                        key: key.clone(),
                        value: value.clone(),
                        source,
                        source_path: source_path.cloned(),
                        overridden_by: vec![*prev_source],
                    });
                }
            }

            // 更新来源
            self.config_sources.write().insert(key.clone(), source);
            if let Some(path) = source_path {
                self.config_source_paths
                    .write()
                    .insert(key.clone(), path.clone());
            }

            // 深度合并
            base.insert(key.clone(), self.deep_merge(base.get(key), value));
        }
    }

    /// 深度合并值
    fn deep_merge(&self, base: Option<&Value>, override_val: &Value) -> Value {
        match (base, override_val) {
            (Some(Value::Object(base_map)), Value::Object(override_map)) => {
                let mut result = base_map.clone();
                for (k, v) in override_map {
                    let merged = self.deep_merge(base_map.get(k), v);
                    result.insert(k.clone(), merged);
                }
                Value::Object(result)
            }
            _ => override_val.clone(),
        }
    }

    /// 追踪配置来源
    fn track_config_source(
        &self,
        config: &HashMap<String, Value>,
        source: ConfigSource,
        source_path: Option<&PathBuf>,
    ) {
        for key in config.keys() {
            self.config_sources.write().insert(key.clone(), source);
            if let Some(path) = source_path {
                self.config_source_paths
                    .write()
                    .insert(key.clone(), path.clone());
            }
        }
    }

    /// 调试日志
    fn debug_log(&self, message: &str) {
        if self.debug_mode {
            tracing::debug!("[Config] {}", message);
        }
    }

    /// 打印调试信息
    fn print_debug_info(&self) {
        tracing::debug!("\n=== 配置调试信息 ===");
        tracing::debug!("已加载的配置源:");
        for source in self.loaded_sources.read().iter() {
            let status = if source.exists { "OK" } else { "未找到" };
            let path_info = source
                .path
                .as_ref()
                .map(|p| format!(" ({:?})", p))
                .unwrap_or_default();
            tracing::debug!(
                "  [{}] {:?}{}: {}",
                source.priority,
                source.source,
                path_info,
                status
            );
        }

        tracing::debug!("\n配置项来源:");
        for (key, source) in self.config_sources.read().iter() {
            let path_info = self
                .config_source_paths
                .read()
                .get(key)
                .map(|p| format!(" ({:?})", p))
                .unwrap_or_default();
            tracing::debug!("  {}: {:?}{}", key, source, path_info);
        }
        tracing::debug!("================================\n");
    }

    // ============ 公共 API ============

    /// 获取配置项
    pub fn get<T: for<'de> Deserialize<'de>>(&self, key: &str) -> Option<T> {
        self.merged_config
            .read()
            .get(key)
            .and_then(|v| serde_json::from_value(v.clone()).ok())
    }

    /// 获取配置项（带默认值）
    pub fn get_or<T: for<'de> Deserialize<'de>>(&self, key: &str, default: T) -> T {
        self.get(key).unwrap_or(default)
    }

    /// 获取原始值
    pub fn get_value(&self, key: &str) -> Option<Value> {
        self.merged_config.read().get(key).cloned()
    }

    /// 设置配置项
    pub fn set<T: Serialize>(&self, key: &str, value: T) {
        if let Ok(json_value) = serde_json::to_value(value) {
            self.merged_config
                .write()
                .insert(key.to_string(), json_value);
        }
    }

    /// 获取所有配置
    pub fn get_all(&self) -> HashMap<String, Value> {
        self.merged_config.read().clone()
    }

    /// 获取配置项及其来源
    pub fn get_with_source<T: for<'de> Deserialize<'de>>(
        &self,
        key: &str,
    ) -> Option<(T, ConfigSource, Option<PathBuf>)> {
        let value = self.get::<T>(key)?;
        let source = self
            .config_sources
            .read()
            .get(key)
            .copied()
            .unwrap_or(ConfigSource::Default);
        let path = self.config_source_paths.read().get(key).cloned();
        Some((value, source, path))
    }

    /// 获取配置项的来源
    pub fn get_config_source(&self, key: &str) -> Option<ConfigSource> {
        self.config_sources.read().get(key).copied()
    }

    /// 获取所有配置来源
    pub fn get_all_config_sources(&self) -> HashMap<String, ConfigSource> {
        self.config_sources.read().clone()
    }

    /// 获取配置源信息
    pub fn get_config_source_info(&self) -> Vec<ConfigSourceInfo> {
        self.loaded_sources.read().clone()
    }

    /// 获取配置项的覆盖历史
    pub fn get_config_history(&self, key: &str) -> Vec<ConfigKeySource> {
        self.config_history
            .read()
            .get(key)
            .cloned()
            .unwrap_or_default()
    }

    /// 检查配置项是否被企业策略强制
    pub fn is_enforced_by_policy(&self, key: &str) -> bool {
        self.enterprise_policy
            .read()
            .as_ref()
            .map(|p| p.enforced.contains_key(key))
            .unwrap_or(false)
    }

    /// 获取企业策略
    pub fn get_enterprise_policy(&self) -> Option<EnterprisePolicyConfig> {
        self.enterprise_policy.read().clone()
    }

    /// 检查功能是否被禁用
    pub fn is_feature_disabled(&self, feature: &str) -> bool {
        self.enterprise_policy
            .read()
            .as_ref()
            .map(|p| p.disabled_features.contains(&feature.to_string()))
            .unwrap_or(false)
    }

    /// 获取配置文件路径
    pub fn get_config_paths(&self) -> HashMap<String, PathBuf> {
        let mut paths = HashMap::new();
        paths.insert("user_settings".to_string(), self.user_config_file.clone());
        paths.insert(
            "project_settings".to_string(),
            self.project_config_file.clone(),
        );
        paths.insert("local_settings".to_string(), self.local_config_file.clone());
        paths.insert(
            "policy_settings".to_string(),
            self.policy_config_file.clone(),
        );
        paths.insert(
            "global_config_dir".to_string(),
            self.global_config_dir.clone(),
        );
        if let Some(ref flag_file) = self.flag_config_file {
            paths.insert("flag_settings".to_string(), flag_file.clone());
        }
        paths
    }

    // ============ 保存和重载 ============

    /// 保存到用户配置文件
    pub fn save(&self, config: Option<&HashMap<String, Value>>) -> Result<(), std::io::Error> {
        if let Some(cfg) = config {
            self.merged_config.write().extend(cfg.clone());
        }

        if let Some(parent) = self.user_config_file.parent() {
            fs::create_dir_all(parent)?;
        }

        // 备份现有配置
        self.backup_config(&self.user_config_file)?;

        let yaml = serde_yaml::to_string(&*self.merged_config.read())
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
        fs::write(&self.user_config_file, yaml)
    }

    /// 保存到本地配置文件
    pub fn save_local(&self, config: &HashMap<String, Value>) -> Result<(), std::io::Error> {
        // 检查企业策略强制项
        let mut filtered_config = config.clone();
        if let Some(ref policy) = *self.enterprise_policy.read() {
            for key in policy.enforced.keys() {
                if filtered_config.contains_key(key) {
                    tracing::warn!("配置项 {} 被企业策略强制，无法本地覆盖", key);
                    filtered_config.remove(key);
                }
            }
        }

        if let Some(parent) = self.local_config_file.parent() {
            fs::create_dir_all(parent)?;
        }

        // 合并现有本地配置
        let mut local_config = self
            .load_config_file(&self.local_config_file)
            .unwrap_or_default();
        local_config.extend(filtered_config);

        self.backup_config(&self.local_config_file)?;

        let yaml = serde_yaml::to_string(&local_config)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
        fs::write(&self.local_config_file, yaml)
    }

    /// 保存到项目配置文件
    pub fn save_project(&self, config: &HashMap<String, Value>) -> Result<(), std::io::Error> {
        if let Some(parent) = self.project_config_file.parent() {
            fs::create_dir_all(parent)?;
        }

        let mut project_config = self
            .load_config_file(&self.project_config_file)
            .unwrap_or_default();
        project_config.extend(config.clone());

        let yaml = serde_yaml::to_string(&project_config)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
        fs::write(&self.project_config_file, yaml)
    }

    /// 重新加载配置
    pub fn reload(&mut self) {
        self.load_and_merge_config();
        let config = self.merged_config.read().clone();
        for callback in self.reload_callbacks.read().iter() {
            callback(&config);
        }
    }

    /// 监听配置变化
    pub fn watch<F>(&self, callback: F) -> Result<(), notify::Error>
    where
        F: Fn(&HashMap<String, Value>) + Send + Sync + 'static,
    {
        self.reload_callbacks.write().push(Box::new(callback));

        let mut watcher_guard = self.watcher.write();
        if watcher_guard.is_some() {
            return Ok(());
        }

        let callbacks = self.reload_callbacks.clone();
        let user_file = self.user_config_file.clone();
        let project_file = self.project_config_file.clone();
        let local_file = self.local_config_file.clone();

        let watcher = notify::recommended_watcher(move |res: Result<Event, _>| {
            if let Ok(event) = res {
                if event.kind.is_modify() {
                    // 简化：触发回调
                    let cbs = callbacks.read();
                    for cb in cbs.iter() {
                        cb(&HashMap::new()); // 实际应重新加载
                    }
                }
            }
        })?;

        // 监听配置文件
        let mut w = watcher;
        if user_file.exists() {
            let _ = w.watch(&user_file, RecursiveMode::NonRecursive);
        }
        if project_file.exists() {
            let _ = w.watch(&project_file, RecursiveMode::NonRecursive);
        }
        if local_file.exists() {
            let _ = w.watch(&local_file, RecursiveMode::NonRecursive);
        }

        *watcher_guard = Some(w);
        Ok(())
    }

    // ============ 备份和恢复 ============

    /// 备份配置文件
    fn backup_config(&self, file_path: &Path) -> Result<(), std::io::Error> {
        if !file_path.exists() {
            return Ok(());
        }

        let backup_dir = file_path
            .parent()
            .map(|p| p.join(".backups"))
            .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "无效路径"))?;

        fs::create_dir_all(&backup_dir)?;

        let timestamp = chrono::Utc::now().format("%Y-%m-%dT%H-%M-%S");
        let filename = file_path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("config");
        let backup_path = backup_dir.join(format!("{}.{}.yaml", filename, timestamp));

        fs::copy(file_path, &backup_path)?;
        self.clean_old_backups(&backup_dir, filename)?;
        Ok(())
    }

    /// 清理旧备份（保留最近10个）
    fn clean_old_backups(&self, backup_dir: &Path, filename: &str) -> Result<(), std::io::Error> {
        let mut backups: Vec<_> = fs::read_dir(backup_dir)?
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().starts_with(filename))
            .collect();

        backups.sort_by_key(|e| std::cmp::Reverse(e.metadata().and_then(|m| m.modified()).ok()));

        for backup in backups.into_iter().skip(10) {
            let _ = fs::remove_file(backup.path());
        }
        Ok(())
    }

    /// 列出可用备份
    pub fn list_backups(&self, config_type: &str) -> Vec<String> {
        let config_file = match config_type {
            "user" => &self.user_config_file,
            "project" => &self.project_config_file,
            "local" => &self.local_config_file,
            _ => return Vec::new(),
        };

        let backup_dir = match config_file.parent() {
            Some(p) => p.join(".backups"),
            None => return Vec::new(),
        };

        if !backup_dir.exists() {
            return Vec::new();
        }

        let filename = config_file
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("settings");

        fs::read_dir(&backup_dir)
            .ok()
            .map(|entries| {
                let mut backups: Vec<_> = entries
                    .filter_map(|e| e.ok())
                    .filter(|e| e.file_name().to_string_lossy().starts_with(filename))
                    .map(|e| e.file_name().to_string_lossy().to_string())
                    .collect();
                backups.sort();
                backups.reverse();
                backups
            })
            .unwrap_or_default()
    }

    /// 从备份恢复
    pub fn restore_from_backup(
        &mut self,
        backup_filename: &str,
        config_type: &str,
    ) -> Result<(), std::io::Error> {
        let config_file = match config_type {
            "user" => &self.user_config_file,
            "project" => &self.project_config_file,
            "local" => &self.local_config_file,
            _ => {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::InvalidInput,
                    "无效的配置类型",
                ))
            }
        };

        let backup_dir = config_file
            .parent()
            .map(|p| p.join(".backups"))
            .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "无效路径"))?;

        let backup_path = backup_dir.join(backup_filename);
        if !backup_path.exists() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::NotFound,
                "备份文件不存在",
            ));
        }

        // 备份当前配置
        self.backup_config(config_file)?;

        // 恢复备份
        fs::copy(&backup_path, config_file)?;

        // 重新加载
        self.reload();
        Ok(())
    }

    /// 重置为默认配置
    pub fn reset(&mut self) {
        *self.merged_config.write() = self.get_default_config();
        let _ = self.save(None);
    }

    // ============ 导出和导入 ============

    /// 导出配置（可选掩码敏感信息）
    pub fn export(&self, mask_secrets: bool) -> String {
        let config = self.merged_config.read().clone();

        if mask_secrets {
            let masked = self.mask_sensitive_fields(&config);
            serde_json::to_string_pretty(&masked).unwrap_or_default()
        } else {
            serde_json::to_string_pretty(&config).unwrap_or_default()
        }
    }

    /// 掩码敏感字段
    fn mask_sensitive_fields(&self, config: &HashMap<String, Value>) -> HashMap<String, Value> {
        let sensitive_keys = ["api_key", "secret", "password", "token", "credential"];
        let mut masked = config.clone();

        for (key, value) in masked.iter_mut() {
            let key_lower = key.to_lowercase();
            if sensitive_keys.iter().any(|s| key_lower.contains(s)) {
                if let Value::String(s) = value {
                    if s.len() > 8 {
                        *value = Value::String(format!(
                            "{}...{}",
                            s.get(..4).unwrap_or(""),
                            s.get(s.len().saturating_sub(4)..).unwrap_or("")
                        ));
                    } else {
                        *value = Value::String("****".to_string());
                    }
                }
            }
        }
        masked
    }

    /// 导入配置
    pub fn import(&mut self, config_json: &str) -> Result<(), String> {
        let config: HashMap<String, Value> =
            serde_json::from_str(config_json).map_err(|e| format!("JSON 解析失败: {}", e))?;

        *self.merged_config.write() = config;
        self.save(None).map_err(|e| format!("保存失败: {}", e))?;
        Ok(())
    }
}

impl Default for ConfigManager {
    fn default() -> Self {
        Self::new(ConfigManagerOptions::default())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[allow(unused_imports)]
    use tempfile::TempDir;

    #[test]
    fn test_config_manager_default() {
        let manager = ConfigManager::default();
        assert!(manager.get::<String>("model").is_some());
    }

    #[test]
    fn test_get_default_config() {
        let manager = ConfigManager::default();
        let model: String = manager.get_or("model", "default".to_string());
        assert_eq!(model, "claude-3-5-sonnet");
    }

    #[test]
    fn test_set_and_get() {
        let manager = ConfigManager::default();
        manager.set("test_key", "test_value");
        let value: Option<String> = manager.get("test_key");
        assert_eq!(value, Some("test_value".to_string()));
    }

    #[test]
    fn test_config_source_priority() {
        assert!(ConfigSource::PolicySettings.priority() > ConfigSource::FlagSettings.priority());
        assert!(ConfigSource::FlagSettings.priority() > ConfigSource::EnvSettings.priority());
        assert!(ConfigSource::EnvSettings.priority() > ConfigSource::LocalSettings.priority());
    }

    #[test]
    fn test_parse_env_value() {
        let manager = ConfigManager::default();

        assert_eq!(manager.parse_env_value("true"), Some(Value::Bool(true)));
        assert_eq!(manager.parse_env_value("false"), Some(Value::Bool(false)));
        assert_eq!(
            manager.parse_env_value("42"),
            Some(Value::Number(42.into()))
        );
        assert_eq!(
            manager.parse_env_value("hello"),
            Some(Value::String("hello".to_string()))
        );
    }

    #[test]
    fn test_mask_sensitive_fields() {
        let manager = ConfigManager::default();
        let mut config = HashMap::new();
        config.insert(
            "api_key".to_string(),
            Value::String("sk-1234567890abcdef".to_string()),
        );
        config.insert("model".to_string(), Value::String("claude-3".to_string()));

        let masked = manager.mask_sensitive_fields(&config);
        assert!(masked
            .get("api_key")
            .unwrap()
            .as_str()
            .unwrap()
            .contains("..."));
        assert_eq!(masked.get("model").unwrap().as_str().unwrap(), "claude-3");
    }
}
