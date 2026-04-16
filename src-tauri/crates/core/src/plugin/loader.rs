//! 插件加载器

use super::types::{
    HookResult, Plugin, PluginConfig, PluginContext, PluginError, PluginManifest, PluginType,
};
use crate::app_paths;
use async_trait::async_trait;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::fs;

pub struct PluginLoader {
    plugins_dir: PathBuf,
}

impl PluginLoader {
    pub fn new(plugins_dir: PathBuf) -> Self {
        Self { plugins_dir }
    }

    pub fn default_plugins_dir() -> PathBuf {
        app_paths::best_effort_runtime_subdir("plugins")
    }

    pub fn with_defaults() -> Self {
        Self::new(Self::default_plugins_dir())
    }

    pub async fn ensure_plugins_dir(&self) -> Result<(), PluginError> {
        if !self.plugins_dir.exists() {
            fs::create_dir_all(&self.plugins_dir).await?;
        }
        Ok(())
    }

    pub async fn scan(&self) -> Result<Vec<PathBuf>, PluginError> {
        self.ensure_plugins_dir().await?;
        let mut plugins = Vec::new();
        let mut entries = fs::read_dir(&self.plugins_dir).await?;
        while let Some(entry) = entries.next_entry().await? {
            let path = entry.path();
            if path.is_dir() && path.join("manifest.json").exists() {
                plugins.push(path);
            }
        }
        Ok(plugins)
    }

    pub async fn load_manifest(&self, plugin_dir: &Path) -> Result<PluginManifest, PluginError> {
        let manifest_path = plugin_dir.join("manifest.json");
        let content = fs::read_to_string(&manifest_path)
            .await
            .map_err(|e| PluginError::LoadError(format!("无法读取清单文件: {e}")))?;
        let manifest: PluginManifest = serde_json::from_str(&content)
            .map_err(|e| PluginError::InvalidManifest(format!("解析失败: {e}")))?;
        manifest.validate()?;
        Ok(manifest)
    }

    pub async fn load(
        &self,
        plugin_dir: &Path,
        config: &PluginConfig,
    ) -> Result<Arc<dyn Plugin>, PluginError> {
        let manifest = self.load_manifest(plugin_dir).await?;
        match manifest.plugin_type {
            PluginType::Script => self.load_script_plugin(plugin_dir, manifest, config).await,
            PluginType::Native => Err(PluginError::LoadError("原生插件暂不支持".to_string())),
            PluginType::Binary => Err(PluginError::LoadError(
                "二进制组件不通过插件加载器加载".to_string(),
            )),
        }
    }

    async fn load_script_plugin(
        &self,
        plugin_dir: &Path,
        manifest: PluginManifest,
        _config: &PluginConfig,
    ) -> Result<Arc<dyn Plugin>, PluginError> {
        let config_path = plugin_dir.join("config.json");
        let plugin_settings = if config_path.exists() {
            let content = fs::read_to_string(&config_path)
                .await
                .map_err(|e| PluginError::LoadError(format!("无法读取配置文件: {e}")))?;
            serde_json::from_str(&content).unwrap_or_default()
        } else {
            serde_json::Value::Object(serde_json::Map::new())
        };
        let plugin = ScriptPlugin::new(manifest, plugin_settings);
        Ok(Arc::new(plugin))
    }

    pub async fn load_all(
        &self,
        configs: &HashMap<String, PluginConfig>,
    ) -> Result<Vec<(PathBuf, Arc<dyn Plugin>)>, PluginError> {
        let plugin_dirs = self.scan().await?;
        let mut plugins = Vec::new();
        for dir in plugin_dirs {
            let manifest = match self.load_manifest(&dir).await {
                Ok(m) => m,
                Err(e) => {
                    tracing::warn!("跳过插件 {}: {}", dir.display(), e);
                    continue;
                }
            };
            let config = configs.get(&manifest.name).cloned().unwrap_or_default();
            match self.load(&dir, &config).await {
                Ok(plugin) => plugins.push((dir, plugin)),
                Err(e) => {
                    tracing::warn!("加载插件 {} 失败: {}", manifest.name, e);
                }
            }
        }
        Ok(plugins)
    }

    pub fn plugins_dir(&self) -> &Path {
        &self.plugins_dir
    }
}

pub struct ScriptPlugin {
    manifest: PluginManifest,
    settings: serde_json::Value,
}

impl ScriptPlugin {
    pub fn new(manifest: PluginManifest, settings: serde_json::Value) -> Self {
        Self { manifest, settings }
    }

    fn apply_request_transforms(&self, request: &mut serde_json::Value) -> bool {
        let transforms = match self.settings.get("request_transforms") {
            Some(t) if t.is_array() => t.as_array().unwrap(),
            _ => return false,
        };
        let mut modified = false;
        let obj = match request.as_object_mut() {
            Some(o) => o,
            None => return false,
        };
        for transform in transforms {
            if let Some(inject) = transform.get("inject").and_then(|v| v.as_object()) {
                for (key, value) in inject {
                    if !obj.contains_key(key) {
                        obj.insert(key.clone(), value.clone());
                        modified = true;
                    }
                }
            }
        }
        modified
    }

    fn apply_response_transforms(&self, response: &mut serde_json::Value) -> bool {
        let transforms = match self.settings.get("response_transforms") {
            Some(t) if t.is_array() => t.as_array().unwrap(),
            _ => return false,
        };
        let mut modified = false;
        let obj = match response.as_object_mut() {
            Some(o) => o,
            None => return false,
        };
        for transform in transforms {
            if let Some(inject) = transform.get("inject").and_then(|v| v.as_object()) {
                for (key, value) in inject {
                    obj.insert(key.clone(), value.clone());
                    modified = true;
                }
            }
        }
        modified
    }
}

#[async_trait]
impl Plugin for ScriptPlugin {
    fn name(&self) -> &str {
        &self.manifest.name
    }

    fn version(&self) -> &str {
        &self.manifest.version
    }

    fn manifest(&self) -> &PluginManifest {
        &self.manifest
    }

    async fn init(&mut self, _config: &PluginConfig) -> Result<(), PluginError> {
        Ok(())
    }

    async fn on_request(
        &self,
        _ctx: &mut PluginContext,
        request: &mut serde_json::Value,
    ) -> Result<HookResult, PluginError> {
        let start = std::time::Instant::now();
        let modified = self.apply_request_transforms(request);
        Ok(HookResult::success(
            modified,
            start.elapsed().as_millis() as u64,
        ))
    }

    async fn on_response(
        &self,
        _ctx: &mut PluginContext,
        response: &mut serde_json::Value,
    ) -> Result<HookResult, PluginError> {
        let start = std::time::Instant::now();
        let modified = self.apply_response_transforms(response);
        Ok(HookResult::success(
            modified,
            start.elapsed().as_millis() as u64,
        ))
    }

    async fn on_error(
        &self,
        _ctx: &mut PluginContext,
        _error: &str,
    ) -> Result<HookResult, PluginError> {
        let start = std::time::Instant::now();
        Ok(HookResult::success(
            false,
            start.elapsed().as_millis() as u64,
        ))
    }

    async fn shutdown(&mut self) -> Result<(), PluginError> {
        Ok(())
    }
}
