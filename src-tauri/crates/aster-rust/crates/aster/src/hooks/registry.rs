//! Hook 注册表
//!
//! 管理已注册的 hooks

use super::types::{HookConfig, HookEvent, LegacyHookConfig};
use parking_lot::RwLock;
use regex::Regex;
use std::collections::HashMap;
use std::sync::Arc;

/// 已注册的 Hooks 存储
pub type RegisteredHooks = HashMap<HookEvent, Vec<HookConfig>>;

/// Hook 注册表
#[derive(Debug, Default)]
pub struct HookRegistry {
    hooks: RwLock<RegisteredHooks>,
}

impl HookRegistry {
    /// 创建新的注册表
    pub fn new() -> Self {
        Self {
            hooks: RwLock::new(HashMap::new()),
        }
    }

    /// 注册 hook
    pub fn register(&self, event: HookEvent, config: HookConfig) {
        let mut hooks = self.hooks.write();
        hooks.entry(event).or_default().push(config);
    }

    /// 注册旧版 hook（兼容性）
    pub fn register_legacy(&self, config: LegacyHookConfig) {
        let (event, hook_config) = config.into();
        self.register(event, hook_config);
    }

    /// 获取匹配的 hooks
    pub fn get_matching(&self, event: HookEvent, tool_name: Option<&str>) -> Vec<HookConfig> {
        let hooks = self.hooks.read();
        let event_hooks = match hooks.get(&event) {
            Some(h) => h,
            None => return vec![],
        };

        event_hooks
            .iter()
            .filter(|hook| {
                if let Some(matcher) = hook.matcher() {
                    if let Some(name) = tool_name {
                        // 支持正则匹配
                        if matcher.starts_with('/') && matcher.ends_with('/') {
                            let pattern = matcher
                                .get(1..matcher.len().saturating_sub(1))
                                .unwrap_or("");
                            if let Ok(regex) = Regex::new(pattern) {
                                return regex.is_match(name);
                            }
                        }
                        // 精确匹配
                        return matcher == name;
                    }
                    return false;
                }
                true
            })
            .cloned()
            .collect()
    }

    /// 获取指定事件的 hooks
    pub fn get_for_event(&self, event: HookEvent) -> Vec<HookConfig> {
        let hooks = self.hooks.read();
        hooks.get(&event).cloned().unwrap_or_default()
    }

    /// 获取所有已注册的 hooks
    pub fn get_all(&self) -> RegisteredHooks {
        self.hooks.read().clone()
    }

    /// 获取所有已注册的 hooks（扁平数组）
    pub fn get_all_flat(&self) -> Vec<(HookEvent, HookConfig)> {
        let hooks = self.hooks.read();
        let mut result = Vec::new();
        for (event, configs) in hooks.iter() {
            for config in configs {
                result.push((*event, config.clone()));
            }
        }
        result
    }

    /// 获取 hook 总数
    pub fn count(&self) -> usize {
        let hooks = self.hooks.read();
        hooks.values().map(|v| v.len()).sum()
    }

    /// 获取指定事件的 hook 数量
    pub fn count_for_event(&self, event: HookEvent) -> usize {
        let hooks = self.hooks.read();
        hooks.get(&event).map(|v| v.len()).unwrap_or(0)
    }

    /// 取消注册 hook
    pub fn unregister(&self, event: HookEvent, config: &HookConfig) -> bool {
        let mut hooks = self.hooks.write();
        if let Some(event_hooks) = hooks.get_mut(&event) {
            let initial_len = event_hooks.len();
            event_hooks.retain(|h| !Self::configs_match(h, config));
            let removed = event_hooks.len() < initial_len;
            if event_hooks.is_empty() {
                hooks.remove(&event);
            }
            return removed;
        }
        false
    }

    /// 清除指定事件的所有 hooks
    pub fn clear_event(&self, event: HookEvent) {
        let mut hooks = self.hooks.write();
        hooks.remove(&event);
    }

    /// 清除所有 hooks
    pub fn clear(&self) {
        let mut hooks = self.hooks.write();
        hooks.clear();
    }

    /// 比较两个配置是否匹配
    fn configs_match(a: &HookConfig, b: &HookConfig) -> bool {
        match (a, b) {
            (HookConfig::Command(a), HookConfig::Command(b)) => a.command == b.command,
            (HookConfig::Url(a), HookConfig::Url(b)) => a.url == b.url,
            (HookConfig::Mcp(a), HookConfig::Mcp(b)) => a.server == b.server && a.tool == b.tool,
            (HookConfig::Prompt(a), HookConfig::Prompt(b)) => a.prompt == b.prompt,
            (HookConfig::Agent(a), HookConfig::Agent(b)) => a.agent_type == b.agent_type,
            _ => false,
        }
    }
}

/// 共享的 Hook 注册表
pub type SharedHookRegistry = Arc<HookRegistry>;

/// 全局注册表
static GLOBAL_REGISTRY: once_cell::sync::Lazy<SharedHookRegistry> =
    once_cell::sync::Lazy::new(|| Arc::new(HookRegistry::new()));

/// 获取全局注册表
pub fn global_registry() -> SharedHookRegistry {
    GLOBAL_REGISTRY.clone()
}

/// 注册 hook 到全局注册表
pub fn register_hook(event: HookEvent, config: HookConfig) {
    global_registry().register(event, config);
}

/// 注册旧版 hook 到全局注册表
pub fn register_legacy_hook(config: LegacyHookConfig) {
    global_registry().register_legacy(config);
}

/// 清除全局注册表
pub fn clear_hooks() {
    global_registry().clear();
}

/// 获取 hook 总数
pub fn get_hook_count() -> usize {
    global_registry().count()
}

/// 获取指定事件的 hook 数量
pub fn get_event_hook_count(event: HookEvent) -> usize {
    global_registry().count_for_event(event)
}
