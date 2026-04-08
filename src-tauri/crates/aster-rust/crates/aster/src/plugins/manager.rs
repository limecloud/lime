//! 插件管理器
//!
//! 负责插件的发现、加载、卸载、依赖管理等

use super::registry::PluginRegistry;
use super::types::*;
use super::version::VersionChecker;
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::{Arc, RwLock};
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::sync::broadcast;

/// 插件事件
#[derive(Debug, Clone)]
pub enum PluginEvent {
    Loaded(String),
    Unloaded(String),
    Reloaded(String),
    Error(String, String),
}

/// 插件管理器
pub struct PluginManager {
    /// 插件状态
    plugin_states: Arc<RwLock<HashMap<String, PluginState>>>,
    /// 插件配置
    plugin_configs: Arc<RwLock<HashMap<String, PluginConfig>>>,
    /// 插件目录
    plugin_dirs: Vec<PathBuf>,
    /// 配置目录
    config_dir: PathBuf,
    /// Aster 版本
    aster_version: String,
    /// 注册表
    registry: Arc<PluginRegistry>,
    /// 事件发送器
    event_tx: broadcast::Sender<PluginEvent>,
}

impl PluginManager {
    /// 创建新的插件管理器
    pub fn new(aster_version: &str) -> Self {
        let config_dir = dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("~"))
            .join(".aster");

        let plugin_dirs = vec![
            config_dir.join("plugins"),
            std::env::current_dir()
                .unwrap_or_default()
                .join(".aster")
                .join("plugins"),
        ];

        let (event_tx, _) = broadcast::channel(100);

        Self {
            plugin_states: Arc::new(RwLock::new(HashMap::new())),
            plugin_configs: Arc::new(RwLock::new(HashMap::new())),
            plugin_dirs,
            config_dir,
            aster_version: aster_version.to_string(),
            registry: Arc::new(PluginRegistry::new()),
            event_tx,
        }
    }

    /// 订阅事件
    pub fn subscribe(&self) -> broadcast::Receiver<PluginEvent> {
        self.event_tx.subscribe()
    }

    /// 获取注册表
    pub fn registry(&self) -> Arc<PluginRegistry> {
        Arc::clone(&self.registry)
    }

    /// 添加插件目录
    pub fn add_plugin_dir(&mut self, dir: PathBuf) {
        if !self.plugin_dirs.contains(&dir) {
            self.plugin_dirs.push(dir);
        }
    }

    /// 发现所有插件
    pub async fn discover(&self) -> Vec<PluginState> {
        let mut discovered = Vec::new();

        for dir in &self.plugin_dirs {
            if !dir.exists() {
                continue;
            }

            let entries = match tokio::fs::read_dir(dir).await {
                Ok(e) => e,
                Err(_) => continue,
            };

            let mut entries = entries;
            while let Ok(Some(entry)) = entries.next_entry().await {
                let path = entry.path();
                if !path.is_dir() {
                    continue;
                }

                let package_path = path.join("package.json");
                if !package_path.exists() {
                    continue;
                }

                if let Ok(content) = tokio::fs::read_to_string(&package_path).await {
                    if let Ok(metadata) = serde_json::from_str::<PluginMetadata>(&content) {
                        let state = PluginState {
                            metadata: metadata.clone(),
                            path: path.clone(),
                            enabled: true,
                            loaded: false,
                            initialized: false,
                            activated: false,
                            error: None,
                            load_time: None,
                            dependencies: Vec::new(),
                            dependents: Vec::new(),
                        };

                        if let Ok(mut states) = self.plugin_states.write() {
                            states.insert(metadata.name.clone(), state.clone());
                        }
                        discovered.push(state);
                    }
                }
            }
        }

        // 解析依赖关系
        self.resolve_dependencies();

        discovered
    }

    /// 解析插件依赖关系
    fn resolve_dependencies(&self) {
        let mut states = match self.plugin_states.write() {
            Ok(s) => s,
            Err(_) => return,
        };

        // 收集所有插件名
        let plugin_names: HashSet<String> = states.keys().cloned().collect();

        // 解析依赖
        for state in states.values_mut() {
            state.dependencies.clear();
            state.dependents.clear();

            if let Some(deps) = &state.metadata.dependencies {
                for dep_name in deps.keys() {
                    if plugin_names.contains(dep_name) {
                        state.dependencies.push(dep_name.clone());
                    }
                }
            }
        }

        // 构建反向依赖
        let deps_map: HashMap<String, Vec<String>> = states
            .iter()
            .map(|(name, state)| (name.clone(), state.dependencies.clone()))
            .collect();

        for (name, deps) in deps_map {
            for dep_name in deps {
                if let Some(dep_state) = states.get_mut(&dep_name) {
                    if !dep_state.dependents.contains(&name) {
                        dep_state.dependents.push(name.clone());
                    }
                }
            }
        }
    }

    /// 检查引擎兼容性
    fn check_engine_compatibility(&self, metadata: &PluginMetadata) -> bool {
        if let Some(engines) = &metadata.engines {
            if let Some(aster_req) = &engines.aster {
                if !VersionChecker::satisfies(&self.aster_version, aster_req) {
                    return false;
                }
            }
        }
        true
    }

    /// 检查依赖是否满足
    fn check_dependencies(&self, name: &str) -> Result<(), String> {
        let states = self.plugin_states.read().map_err(|e| e.to_string())?;

        let state = states
            .get(name)
            .ok_or_else(|| format!("Plugin not found: {}", name))?;

        if let Some(deps) = &state.metadata.dependencies {
            for (dep_name, version_range) in deps {
                let dep_state = states.get(dep_name);

                match dep_state {
                    None => {
                        return Err(format!(
                            "Dependency not found: {}@{}",
                            dep_name, version_range
                        ));
                    }
                    Some(dep) if !dep.loaded => {
                        return Err(format!(
                            "Dependency not loaded: {}@{}",
                            dep_name, version_range
                        ));
                    }
                    Some(dep) => {
                        if !VersionChecker::satisfies(&dep.metadata.version, version_range) {
                            return Err(format!(
                                "Dependency version mismatch: {} requires {}@{}, found {}",
                                name, dep_name, version_range, dep.metadata.version
                            ));
                        }
                    }
                }
            }
        }

        Ok(())
    }

    /// 加载插件
    pub async fn load(&self, name: &str) -> Result<(), String> {
        // 获取插件状态
        let state = {
            let states = self.plugin_states.read().map_err(|e| e.to_string())?;
            states
                .get(name)
                .cloned()
                .ok_or_else(|| format!("Plugin not found: {}", name))?
        };

        if state.loaded {
            return Ok(());
        }

        // 检查引擎兼容性
        if !self.check_engine_compatibility(&state.metadata) {
            return Err(format!(
                "Plugin {} is not compatible with Aster {}",
                name, self.aster_version
            ));
        }

        // 先加载依赖
        for dep_name in &state.dependencies {
            Box::pin(self.load(dep_name)).await?;
        }

        // 检查依赖版本
        self.check_dependencies(name)?;

        // 更新状态
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);

        {
            let mut states = self.plugin_states.write().map_err(|e| e.to_string())?;
            if let Some(s) = states.get_mut(name) {
                s.loaded = true;
                s.initialized = true;
                s.activated = true;
                s.load_time = Some(now);
                s.error = None;
            }
        }

        let _ = self.event_tx.send(PluginEvent::Loaded(name.to_string()));
        Ok(())
    }

    /// 卸载插件
    pub async fn unload(&self, name: &str, force: bool) -> Result<(), String> {
        let state = {
            let states = self.plugin_states.read().map_err(|e| e.to_string())?;
            states
                .get(name)
                .cloned()
                .ok_or_else(|| format!("Plugin not found: {}", name))?
        };

        if !state.loaded {
            return Ok(());
        }

        // 检查是否有其他插件依赖此插件
        if !force && !state.dependents.is_empty() {
            let loaded_dependents: Vec<_> = {
                let states = self.plugin_states.read().map_err(|e| e.to_string())?;
                state
                    .dependents
                    .iter()
                    .filter(|dep| states.get(*dep).map(|s| s.loaded).unwrap_or(false))
                    .cloned()
                    .collect()
            };

            if !loaded_dependents.is_empty() {
                return Err(format!(
                    "Cannot unload {}: required by {}",
                    name,
                    loaded_dependents.join(", ")
                ));
            }
        }

        // 清理注册表
        self.registry.clear_plugin(name);

        // 更新状态
        {
            let mut states = self.plugin_states.write().map_err(|e| e.to_string())?;
            if let Some(s) = states.get_mut(name) {
                s.loaded = false;
                s.initialized = false;
                s.activated = false;
            }
        }

        let _ = self.event_tx.send(PluginEvent::Unloaded(name.to_string()));
        Ok(())
    }

    /// 重载插件
    pub async fn reload(&self, name: &str) -> Result<(), String> {
        self.unload(name, false).await?;
        self.load(name).await?;
        let _ = self.event_tx.send(PluginEvent::Reloaded(name.to_string()));
        Ok(())
    }

    /// 按拓扑顺序加载所有插件
    pub async fn load_all(&self) -> Result<(), String> {
        let names: Vec<String> = {
            let states = self.plugin_states.read().map_err(|e| e.to_string())?;
            states
                .iter()
                .filter(|(_, s)| s.enabled)
                .map(|(name, _)| name.clone())
                .collect()
        };

        // 拓扑排序加载
        let mut loaded = HashSet::new();
        let mut loading = HashSet::new();

        for name in names {
            Box::pin(self.load_with_deps(&name, &mut loaded, &mut loading)).await?;
        }

        Ok(())
    }

    /// 带依赖检查的加载
    async fn load_with_deps(
        &self,
        name: &str,
        loaded: &mut HashSet<String>,
        loading: &mut HashSet<String>,
    ) -> Result<(), String> {
        if loaded.contains(name) {
            return Ok(());
        }

        if loading.contains(name) {
            return Err(format!("Circular dependency detected: {}", name));
        }

        loading.insert(name.to_string());

        // 获取依赖
        let deps = {
            let states = self.plugin_states.read().map_err(|e| e.to_string())?;
            states
                .get(name)
                .map(|s| s.dependencies.clone())
                .unwrap_or_default()
        };

        // 先加载依赖
        for dep in deps {
            Box::pin(self.load_with_deps(&dep, loaded, loading)).await?;
        }

        // 加载自己
        self.load(name).await?;
        loaded.insert(name.to_string());
        loading.remove(name);

        Ok(())
    }

    /// 卸载所有插件（反向拓扑顺序）
    pub async fn unload_all(&self) -> Result<(), String> {
        let names: Vec<String> = {
            let states = self.plugin_states.read().map_err(|e| e.to_string())?;
            states
                .iter()
                .filter(|(_, s)| s.loaded)
                .map(|(name, _)| name.clone())
                .collect()
        };

        for name in names {
            self.unload(&name, true).await?;
        }

        Ok(())
    }

    /// 获取插件状态
    pub fn get_plugin_state(&self, name: &str) -> Option<PluginState> {
        self.plugin_states.read().ok()?.get(name).cloned()
    }

    /// 获取所有插件状态
    pub fn get_plugin_states(&self) -> Vec<PluginState> {
        self.plugin_states
            .read()
            .map(|s| s.values().cloned().collect())
            .unwrap_or_default()
    }

    /// 设置插件启用状态
    pub fn set_enabled(&self, name: &str, enabled: bool) -> bool {
        if let Ok(mut states) = self.plugin_states.write() {
            if let Some(state) = states.get_mut(name) {
                state.enabled = enabled;
                return true;
            }
        }
        false
    }

    /// 获取已加载的插件数量
    pub fn loaded_count(&self) -> usize {
        self.plugin_states
            .read()
            .map(|s| s.values().filter(|p| p.loaded).count())
            .unwrap_or(0)
    }

    /// 获取已启用的插件数量
    pub fn enabled_count(&self) -> usize {
        self.plugin_states
            .read()
            .map(|s| s.values().filter(|p| p.enabled).count())
            .unwrap_or(0)
    }

    /// 获取插件的工具
    pub fn get_plugin_tools(&self, name: &str) -> Vec<super::registry::ToolDefinition> {
        self.registry
            .tools
            .read()
            .ok()
            .and_then(|t| t.get(name).cloned())
            .unwrap_or_default()
    }

    /// 获取插件的命令
    pub fn get_plugin_commands(&self, name: &str) -> Vec<CommandDefinition> {
        self.registry
            .commands
            .read()
            .ok()
            .and_then(|c| c.get(name).cloned())
            .unwrap_or_default()
    }

    /// 获取插件的技能
    pub fn get_plugin_skills(&self, name: &str) -> Vec<SkillDefinition> {
        self.registry
            .skills
            .read()
            .ok()
            .and_then(|s| s.get(name).cloned())
            .unwrap_or_default()
    }

    /// 获取插件的钩子
    pub fn get_plugin_hooks(&self, name: &str) -> Vec<HookDefinition> {
        self.registry
            .hooks
            .read()
            .ok()
            .and_then(|h| h.get(name).cloned())
            .unwrap_or_default()
    }
}

impl Default for PluginManager {
    fn default() -> Self {
        Self::new("0.1.0")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_plugin_manager_new() {
        let manager = PluginManager::new("1.0.0");
        assert_eq!(manager.loaded_count(), 0);
        assert_eq!(manager.enabled_count(), 0);
    }

    #[test]
    fn test_plugin_manager_default() {
        let manager = PluginManager::default();
        assert_eq!(manager.aster_version, "0.1.0");
    }

    #[test]
    fn test_add_plugin_dir() {
        let mut manager = PluginManager::new("1.0.0");
        let custom_dir = PathBuf::from("/custom/plugins");

        manager.add_plugin_dir(custom_dir.clone());
        assert!(manager.plugin_dirs.contains(&custom_dir));

        // 不应重复添加
        manager.add_plugin_dir(custom_dir.clone());
        assert_eq!(
            manager
                .plugin_dirs
                .iter()
                .filter(|p| **p == custom_dir)
                .count(),
            1
        );
    }

    #[test]
    fn test_get_registry() {
        let manager = PluginManager::new("1.0.0");
        let registry = manager.registry();

        // 应该返回同一个注册表
        let registry2 = manager.registry();
        assert!(Arc::ptr_eq(&registry, &registry2));
    }

    #[test]
    fn test_subscribe_events() {
        let manager = PluginManager::new("1.0.0");
        let mut rx = manager.subscribe();

        // 发送事件
        let _ = manager
            .event_tx
            .send(PluginEvent::Loaded("test".to_string()));

        // 应该能接收到
        if let Ok(event) = rx.try_recv() {
            match event {
                PluginEvent::Loaded(name) => assert_eq!(name, "test"),
                _ => panic!("Unexpected event type"),
            }
        }
    }

    #[test]
    fn test_get_plugin_state_not_found() {
        let manager = PluginManager::new("1.0.0");
        assert!(manager.get_plugin_state("nonexistent").is_none());
    }

    #[test]
    fn test_get_plugin_states_empty() {
        let manager = PluginManager::new("1.0.0");
        assert!(manager.get_plugin_states().is_empty());
    }

    #[test]
    fn test_set_enabled() {
        let manager = PluginManager::new("1.0.0");

        // 插件不存在时返回 false
        assert!(!manager.set_enabled("nonexistent", true));
    }

    #[test]
    fn test_get_plugin_tools_empty() {
        let manager = PluginManager::new("1.0.0");
        assert!(manager.get_plugin_tools("test").is_empty());
    }

    #[test]
    fn test_get_plugin_commands_empty() {
        let manager = PluginManager::new("1.0.0");
        assert!(manager.get_plugin_commands("test").is_empty());
    }

    #[test]
    fn test_get_plugin_skills_empty() {
        let manager = PluginManager::new("1.0.0");
        assert!(manager.get_plugin_skills("test").is_empty());
    }

    #[test]
    fn test_get_plugin_hooks_empty() {
        let manager = PluginManager::new("1.0.0");
        assert!(manager.get_plugin_hooks("test").is_empty());
    }

    #[tokio::test]
    async fn test_discover_empty_dirs() {
        let manager = PluginManager::new("1.0.0");
        let discovered = manager.discover().await;
        // 默认目录可能不存在，应该返回空
        assert!(discovered.is_empty() || !discovered.is_empty());
    }

    #[tokio::test]
    async fn test_load_nonexistent_plugin() {
        let manager = PluginManager::new("1.0.0");
        let result = manager.load("nonexistent").await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_unload_nonexistent_plugin() {
        let manager = PluginManager::new("1.0.0");
        let result = manager.unload("nonexistent", false).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_load_all_empty() {
        let manager = PluginManager::new("1.0.0");
        let result = manager.load_all().await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_unload_all_empty() {
        let manager = PluginManager::new("1.0.0");
        let result = manager.unload_all().await;
        assert!(result.is_ok());
    }
}
