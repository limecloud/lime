//! Hook 注册表
//!
//! 管理已注册的 hooks

use super::types::{FrontmatterHooks, HookConfig, HookEvent, LegacyHookConfig};
use parking_lot::RwLock;
use regex::Regex;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
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
            .filter(|hook| matcher_matches(hook.matcher(), tool_name))
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
            (HookConfig::Agent(a), HookConfig::Agent(b)) => {
                a.agent_type == b.agent_type
                    && a.prompt == b.prompt
                    && a.model == b.model
                    && a.agent_config == b.agent_config
            }
            _ => false,
        }
    }
}

fn matcher_matches(matcher: Option<&str>, tool_name: Option<&str>) -> bool {
    let Some(matcher) = matcher else {
        return true;
    };

    let Some(name) = tool_name else {
        return false;
    };

    if matcher.starts_with('/') && matcher.ends_with('/') {
        let pattern = matcher
            .get(1..matcher.len().saturating_sub(1))
            .unwrap_or("");
        if let Ok(regex) = Regex::new(pattern) {
            return regex.is_match(name);
        }
    }

    matcher == name
}

#[derive(Debug, Clone)]
pub struct SessionHookEntry {
    pub id: u64,
    pub config: HookConfig,
    pub once: bool,
}

#[derive(Debug, Default, Clone)]
pub struct SessionHookRegistrationReport {
    pub registered: usize,
    pub skipped: Vec<String>,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
struct FrontmatterHookRegistrationOptions {
    rewrite_stop_to_subagent_stop: bool,
}

type RegisteredSessionHooks = HashMap<String, HashMap<HookEvent, Vec<SessionHookEntry>>>;

#[derive(Debug, Default)]
pub struct SessionHookStore {
    hooks: RwLock<RegisteredSessionHooks>,
    next_id: AtomicU64,
}

impl SessionHookStore {
    pub fn new() -> Self {
        Self {
            hooks: RwLock::new(HashMap::new()),
            next_id: AtomicU64::new(1),
        }
    }

    pub fn register(
        &self,
        session_id: &str,
        event: HookEvent,
        config: HookConfig,
        once: bool,
    ) -> u64 {
        let entry_id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let mut hooks = self.hooks.write();
        hooks
            .entry(session_id.to_string())
            .or_default()
            .entry(event)
            .or_default()
            .push(SessionHookEntry {
                id: entry_id,
                config,
                once,
            });
        entry_id
    }

    pub fn register_frontmatter_hooks(
        &self,
        session_id: &str,
        hooks: &FrontmatterHooks,
    ) -> SessionHookRegistrationReport {
        self.register_frontmatter_hooks_with_options(
            session_id,
            hooks,
            FrontmatterHookRegistrationOptions::default(),
        )
    }

    pub fn register_agent_frontmatter_hooks(
        &self,
        session_id: &str,
        hooks: &FrontmatterHooks,
    ) -> SessionHookRegistrationReport {
        self.register_frontmatter_hooks_with_options(
            session_id,
            hooks,
            FrontmatterHookRegistrationOptions {
                rewrite_stop_to_subagent_stop: true,
            },
        )
    }

    fn register_frontmatter_hooks_with_options(
        &self,
        session_id: &str,
        hooks: &FrontmatterHooks,
        options: FrontmatterHookRegistrationOptions,
    ) -> SessionHookRegistrationReport {
        let mut report = SessionHookRegistrationReport::default();

        for (event, matchers) in hooks {
            let target_event = rewrite_frontmatter_event_for_registration(*event, options);
            for matcher in matchers {
                for hook in &matcher.hooks {
                    match hook.to_registration(matcher.matcher.as_deref()) {
                        Ok(registration) => {
                            self.register(
                                session_id,
                                target_event,
                                registration.config,
                                registration.once,
                            );
                            report.registered += 1;
                        }
                        Err(error) => {
                            report.skipped.push(format!("{target_event}: {error}"));
                        }
                    }
                }
            }
        }

        report
    }

    pub fn get_matching(
        &self,
        session_id: &str,
        event: HookEvent,
        tool_name: Option<&str>,
    ) -> Vec<SessionHookEntry> {
        let hooks = self.hooks.read();
        let session_hooks = match hooks.get(session_id) {
            Some(items) => items,
            None => return vec![],
        };
        let event_hooks = match session_hooks.get(&event) {
            Some(items) => items,
            None => return vec![],
        };

        event_hooks
            .iter()
            .filter(|entry| matcher_matches(entry.config.matcher(), tool_name))
            .cloned()
            .collect()
    }

    pub fn unregister_entry(&self, session_id: &str, event: HookEvent, entry_id: u64) -> bool {
        let mut hooks = self.hooks.write();
        let Some(session_hooks) = hooks.get_mut(session_id) else {
            return false;
        };
        let Some(event_hooks) = session_hooks.get_mut(&event) else {
            return false;
        };

        let initial_len = event_hooks.len();
        event_hooks.retain(|entry| entry.id != entry_id);
        let removed = event_hooks.len() < initial_len;

        if event_hooks.is_empty() {
            session_hooks.remove(&event);
        }
        if session_hooks.is_empty() {
            hooks.remove(session_id);
        }

        removed
    }

    pub fn clear_session(&self, session_id: &str) {
        self.hooks.write().remove(session_id);
    }

    pub fn clear_all(&self) {
        self.hooks.write().clear();
    }

    pub fn count_for_session(&self, session_id: &str) -> usize {
        let hooks = self.hooks.read();
        hooks
            .get(session_id)
            .map(|events| events.values().map(|items| items.len()).sum())
            .unwrap_or(0)
    }
}

fn rewrite_frontmatter_event_for_registration(
    event: HookEvent,
    options: FrontmatterHookRegistrationOptions,
) -> HookEvent {
    if options.rewrite_stop_to_subagent_stop && matches!(event, HookEvent::Stop) {
        HookEvent::SubagentStop
    } else {
        event
    }
}

/// 共享的 Hook 注册表
pub type SharedHookRegistry = Arc<HookRegistry>;
pub type SharedSessionHookStore = Arc<SessionHookStore>;

/// 全局注册表
static GLOBAL_REGISTRY: once_cell::sync::Lazy<SharedHookRegistry> =
    once_cell::sync::Lazy::new(|| Arc::new(HookRegistry::new()));
static SESSION_HOOK_STORE: once_cell::sync::Lazy<SharedSessionHookStore> =
    once_cell::sync::Lazy::new(|| Arc::new(SessionHookStore::new()));

/// 获取全局注册表
pub fn global_registry() -> SharedHookRegistry {
    GLOBAL_REGISTRY.clone()
}

pub fn global_session_hook_store() -> SharedSessionHookStore {
    SESSION_HOOK_STORE.clone()
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
    global_session_hook_store().clear_all();
}

pub fn register_session_frontmatter_hooks(
    session_id: &str,
    hooks: &FrontmatterHooks,
) -> SessionHookRegistrationReport {
    global_session_hook_store().register_frontmatter_hooks(session_id, hooks)
}

pub fn register_agent_session_frontmatter_hooks(
    session_id: &str,
    hooks: &FrontmatterHooks,
) -> SessionHookRegistrationReport {
    global_session_hook_store().register_agent_frontmatter_hooks(session_id, hooks)
}

pub fn get_matching_session_hooks(
    session_id: &str,
    event: HookEvent,
    tool_name: Option<&str>,
) -> Vec<SessionHookEntry> {
    global_session_hook_store().get_matching(session_id, event, tool_name)
}

pub fn clear_session_hooks(session_id: &str) {
    global_session_hook_store().clear_session(session_id);
}

pub fn unregister_session_hook_entry(session_id: &str, event: HookEvent, entry_id: u64) -> bool {
    global_session_hook_store().unregister_entry(session_id, event, entry_id)
}

pub fn get_session_hook_count(session_id: &str) -> usize {
    global_session_hook_store().count_for_session(session_id)
}

/// 获取 hook 总数
pub fn get_hook_count() -> usize {
    global_registry().count()
}

/// 获取指定事件的 hook 数量
pub fn get_event_hook_count(event: HookEvent) -> usize {
    global_registry().count_for_event(event)
}
