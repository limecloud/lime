//! 插件上下文
//!
//! 提供给插件的 API 和资源

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, RwLock};

/// 插件配置 API
pub trait PluginConfigAPI: Send + Sync {
    /// 获取配置值
    fn get(&self, key: &str) -> Option<serde_json::Value>;
    /// 设置配置值
    fn set(&self, key: &str, value: serde_json::Value);
    /// 获取所有配置
    fn get_all(&self) -> HashMap<String, serde_json::Value>;
    /// 检查是否存在
    fn has(&self, key: &str) -> bool;
    /// 删除配置
    fn delete(&self, key: &str);
}

/// 插件日志
pub trait PluginLogger: Send + Sync {
    fn debug(&self, message: &str);
    fn info(&self, message: &str);
    fn warn(&self, message: &str);
    fn error(&self, message: &str);
}

/// 默认配置 API 实现
pub struct DefaultConfigAPI {
    config: Arc<RwLock<HashMap<String, serde_json::Value>>>,
}

impl DefaultConfigAPI {
    pub fn new() -> Self {
        Self {
            config: Arc::new(RwLock::new(HashMap::new())),
        }
    }
}

impl Default for DefaultConfigAPI {
    fn default() -> Self {
        Self::new()
    }
}

impl PluginConfigAPI for DefaultConfigAPI {
    fn get(&self, key: &str) -> Option<serde_json::Value> {
        self.config.read().ok()?.get(key).cloned()
    }

    fn set(&self, key: &str, value: serde_json::Value) {
        if let Ok(mut config) = self.config.write() {
            config.insert(key.to_string(), value);
        }
    }

    fn get_all(&self) -> HashMap<String, serde_json::Value> {
        self.config.read().map(|c| c.clone()).unwrap_or_default()
    }

    fn has(&self, key: &str) -> bool {
        self.config
            .read()
            .map(|c| c.contains_key(key))
            .unwrap_or(false)
    }

    fn delete(&self, key: &str) {
        if let Ok(mut config) = self.config.write() {
            config.remove(key);
        }
    }
}

/// 默认日志实现
pub struct DefaultLogger {
    plugin_name: String,
}

impl DefaultLogger {
    pub fn new(plugin_name: &str) -> Self {
        Self {
            plugin_name: plugin_name.to_string(),
        }
    }
}

impl PluginLogger for DefaultLogger {
    fn debug(&self, message: &str) {
        tracing::debug!("[Plugin:{}] {}", self.plugin_name, message);
    }

    fn info(&self, message: &str) {
        tracing::info!("[Plugin:{}] {}", self.plugin_name, message);
    }

    fn warn(&self, message: &str) {
        tracing::warn!("[Plugin:{}] {}", self.plugin_name, message);
    }

    fn error(&self, message: &str) {
        tracing::error!("[Plugin:{}] {}", self.plugin_name, message);
    }
}

/// 插件上下文
pub struct PluginContext {
    /// 插件名称
    pub plugin_name: String,
    /// 插件路径
    pub plugin_path: PathBuf,
    /// 配置 API
    pub config: Box<dyn PluginConfigAPI>,
    /// 日志
    pub logger: Box<dyn PluginLogger>,
}

impl PluginContext {
    /// 创建新的插件上下文
    pub fn new(plugin_name: &str, plugin_path: PathBuf) -> Self {
        Self {
            plugin_name: plugin_name.to_string(),
            plugin_path,
            config: Box::new(DefaultConfigAPI::new()),
            logger: Box::new(DefaultLogger::new(plugin_name)),
        }
    }
}
