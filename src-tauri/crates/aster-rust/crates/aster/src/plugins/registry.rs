//! 插件注册表
//!
//! 管理插件注册的工具、命令、技能和钩子

use super::types::*;
use std::collections::HashMap;
use std::sync::{Arc, RwLock};

/// 工具定义（简化版）
#[derive(Debug, Clone)]
pub struct ToolDefinition {
    pub name: String,
    pub description: String,
    pub parameters: serde_json::Value,
}

/// 插件工具 API
pub struct PluginToolAPI {
    plugin_name: String,
    tools: Arc<RwLock<HashMap<String, Vec<ToolDefinition>>>>,
}

impl PluginToolAPI {
    pub fn new(
        plugin_name: &str,
        tools: Arc<RwLock<HashMap<String, Vec<ToolDefinition>>>>,
    ) -> Self {
        Self {
            plugin_name: plugin_name.to_string(),
            tools,
        }
    }

    /// 注册工具
    pub fn register(&self, tool: ToolDefinition) {
        if let Ok(mut tools) = self.tools.write() {
            tools
                .entry(self.plugin_name.clone())
                .or_default()
                .push(tool);
        }
    }

    /// 注销工具
    pub fn unregister(&self, tool_name: &str) {
        if let Ok(mut tools) = self.tools.write() {
            if let Some(list) = tools.get_mut(&self.plugin_name) {
                list.retain(|t| t.name != tool_name);
            }
        }
    }

    /// 获取已注册的工具
    pub fn get_registered(&self) -> Vec<ToolDefinition> {
        self.tools
            .read()
            .ok()
            .and_then(|t| t.get(&self.plugin_name).cloned())
            .unwrap_or_default()
    }
}

/// 插件命令 API
pub struct PluginCommandAPI {
    plugin_name: String,
    commands: Arc<RwLock<HashMap<String, Vec<CommandDefinition>>>>,
}

impl PluginCommandAPI {
    pub fn new(
        plugin_name: &str,
        commands: Arc<RwLock<HashMap<String, Vec<CommandDefinition>>>>,
    ) -> Self {
        Self {
            plugin_name: plugin_name.to_string(),
            commands,
        }
    }

    /// 注册命令
    pub fn register(&self, command: CommandDefinition) {
        if let Ok(mut commands) = self.commands.write() {
            commands
                .entry(self.plugin_name.clone())
                .or_default()
                .push(command);
        }
    }

    /// 注销命令
    pub fn unregister(&self, command_name: &str) {
        if let Ok(mut commands) = self.commands.write() {
            if let Some(list) = commands.get_mut(&self.plugin_name) {
                list.retain(|c| c.name != command_name);
            }
        }
    }

    /// 获取已注册的命令
    pub fn get_registered(&self) -> Vec<CommandDefinition> {
        self.commands
            .read()
            .ok()
            .and_then(|c| c.get(&self.plugin_name).cloned())
            .unwrap_or_default()
    }
}

/// 插件技能 API
pub struct PluginSkillAPI {
    plugin_name: String,
    skills: Arc<RwLock<HashMap<String, Vec<SkillDefinition>>>>,
}

impl PluginSkillAPI {
    pub fn new(
        plugin_name: &str,
        skills: Arc<RwLock<HashMap<String, Vec<SkillDefinition>>>>,
    ) -> Self {
        Self {
            plugin_name: plugin_name.to_string(),
            skills,
        }
    }

    /// 注册技能
    pub fn register(&self, skill: SkillDefinition) {
        if let Ok(mut skills) = self.skills.write() {
            skills
                .entry(self.plugin_name.clone())
                .or_default()
                .push(skill);
        }
    }

    /// 注销技能
    pub fn unregister(&self, skill_name: &str) {
        if let Ok(mut skills) = self.skills.write() {
            if let Some(list) = skills.get_mut(&self.plugin_name) {
                list.retain(|s| s.name != skill_name);
            }
        }
    }

    /// 获取已注册的技能
    pub fn get_registered(&self) -> Vec<SkillDefinition> {
        self.skills
            .read()
            .ok()
            .and_then(|s| s.get(&self.plugin_name).cloned())
            .unwrap_or_default()
    }
}

/// 插件钩子 API
pub struct PluginHookAPI {
    plugin_name: String,
    hooks: Arc<RwLock<HashMap<String, Vec<HookDefinition>>>>,
}

impl PluginHookAPI {
    pub fn new(
        plugin_name: &str,
        hooks: Arc<RwLock<HashMap<String, Vec<HookDefinition>>>>,
    ) -> Self {
        Self {
            plugin_name: plugin_name.to_string(),
            hooks,
        }
    }

    /// 注册钩子
    pub fn register(&self, hook: HookDefinition) {
        if let Ok(mut hooks) = self.hooks.write() {
            hooks
                .entry(self.plugin_name.clone())
                .or_default()
                .push(hook);
        }
    }

    /// 注销钩子
    pub fn unregister(&self, hook_type: PluginHookType) {
        if let Ok(mut hooks) = self.hooks.write() {
            if let Some(list) = hooks.get_mut(&self.plugin_name) {
                list.retain(|h| h.hook_type != hook_type);
            }
        }
    }

    /// 获取已注册的钩子
    pub fn get_registered(&self) -> Vec<HookDefinition> {
        self.hooks
            .read()
            .ok()
            .and_then(|h| h.get(&self.plugin_name).cloned())
            .unwrap_or_default()
    }
}

/// 全局注册表
pub struct PluginRegistry {
    pub tools: Arc<RwLock<HashMap<String, Vec<ToolDefinition>>>>,
    pub commands: Arc<RwLock<HashMap<String, Vec<CommandDefinition>>>>,
    pub skills: Arc<RwLock<HashMap<String, Vec<SkillDefinition>>>>,
    pub hooks: Arc<RwLock<HashMap<String, Vec<HookDefinition>>>>,
}

impl PluginRegistry {
    pub fn new() -> Self {
        Self {
            tools: Arc::new(RwLock::new(HashMap::new())),
            commands: Arc::new(RwLock::new(HashMap::new())),
            skills: Arc::new(RwLock::new(HashMap::new())),
            hooks: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// 获取所有工具
    pub fn get_all_tools(&self) -> Vec<ToolDefinition> {
        self.tools
            .read()
            .map(|t| t.values().flatten().cloned().collect())
            .unwrap_or_default()
    }

    /// 获取所有命令
    pub fn get_all_commands(&self) -> Vec<CommandDefinition> {
        self.commands
            .read()
            .map(|c| c.values().flatten().cloned().collect())
            .unwrap_or_default()
    }

    /// 获取所有技能
    pub fn get_all_skills(&self) -> Vec<SkillDefinition> {
        self.skills
            .read()
            .map(|s| s.values().flatten().cloned().collect())
            .unwrap_or_default()
    }

    /// 获取指定类型的所有钩子
    pub fn get_hooks_by_type(&self, hook_type: PluginHookType) -> Vec<HookDefinition> {
        self.hooks
            .read()
            .map(|h| {
                h.values()
                    .flatten()
                    .filter(|hook| hook.hook_type == hook_type)
                    .cloned()
                    .collect()
            })
            .unwrap_or_default()
    }

    /// 清理插件的所有注册
    pub fn clear_plugin(&self, plugin_name: &str) {
        if let Ok(mut tools) = self.tools.write() {
            tools.remove(plugin_name);
        }
        if let Ok(mut commands) = self.commands.write() {
            commands.remove(plugin_name);
        }
        if let Ok(mut skills) = self.skills.write() {
            skills.remove(plugin_name);
        }
        if let Ok(mut hooks) = self.hooks.write() {
            hooks.remove(plugin_name);
        }
    }
}

impl Default for PluginRegistry {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_plugin_registry_new() {
        let registry = PluginRegistry::new();
        assert!(registry.get_all_tools().is_empty());
        assert!(registry.get_all_commands().is_empty());
        assert!(registry.get_all_skills().is_empty());
    }

    #[test]
    fn test_tool_api_register() {
        let registry = PluginRegistry::new();
        let tool_api = PluginToolAPI::new("test-plugin", Arc::clone(&registry.tools));

        let tool = ToolDefinition {
            name: "test-tool".to_string(),
            description: "A test tool".to_string(),
            parameters: serde_json::json!({}),
        };

        tool_api.register(tool);

        let tools = tool_api.get_registered();
        assert_eq!(tools.len(), 1);
        assert_eq!(tools[0].name, "test-tool");
    }

    #[test]
    fn test_tool_api_unregister() {
        let registry = PluginRegistry::new();
        let tool_api = PluginToolAPI::new("test-plugin", Arc::clone(&registry.tools));

        tool_api.register(ToolDefinition {
            name: "tool1".to_string(),
            description: "Tool 1".to_string(),
            parameters: serde_json::json!({}),
        });
        tool_api.register(ToolDefinition {
            name: "tool2".to_string(),
            description: "Tool 2".to_string(),
            parameters: serde_json::json!({}),
        });

        assert_eq!(tool_api.get_registered().len(), 2);

        tool_api.unregister("tool1");

        let tools = tool_api.get_registered();
        assert_eq!(tools.len(), 1);
        assert_eq!(tools[0].name, "tool2");
    }

    #[test]
    fn test_command_api_register() {
        let registry = PluginRegistry::new();
        let cmd_api = PluginCommandAPI::new("test-plugin", Arc::clone(&registry.commands));

        let cmd = CommandDefinition {
            name: "test-cmd".to_string(),
            description: "A test command".to_string(),
            usage: Some("/test-cmd".to_string()),
            examples: vec!["example1".to_string()],
        };

        cmd_api.register(cmd);

        let cmds = cmd_api.get_registered();
        assert_eq!(cmds.len(), 1);
        assert_eq!(cmds[0].name, "test-cmd");
    }

    #[test]
    fn test_skill_api_register() {
        let registry = PluginRegistry::new();
        let skill_api = PluginSkillAPI::new("test-plugin", Arc::clone(&registry.skills));

        let skill = SkillDefinition {
            name: "test-skill".to_string(),
            description: "A test skill".to_string(),
            prompt: "Test prompt".to_string(),
            category: Some("test".to_string()),
            examples: vec!["example1".to_string()],
            parameters: vec![],
        };

        skill_api.register(skill);

        let skills = skill_api.get_registered();
        assert_eq!(skills.len(), 1);
        assert_eq!(skills[0].name, "test-skill");
    }

    #[test]
    fn test_hook_api_register() {
        let registry = PluginRegistry::new();
        let hook_api = PluginHookAPI::new("test-plugin", Arc::clone(&registry.hooks));

        let hook = HookDefinition {
            hook_type: PluginHookType::BeforeToolCall,
            priority: 10,
        };

        hook_api.register(hook);

        let hooks = hook_api.get_registered();
        assert_eq!(hooks.len(), 1);
        assert_eq!(hooks[0].hook_type, PluginHookType::BeforeToolCall);
    }

    #[test]
    fn test_registry_get_all() {
        let registry = PluginRegistry::new();

        // 注册多个插件的工具
        let tool_api1 = PluginToolAPI::new("plugin1", Arc::clone(&registry.tools));
        let tool_api2 = PluginToolAPI::new("plugin2", Arc::clone(&registry.tools));

        tool_api1.register(ToolDefinition {
            name: "tool1".to_string(),
            description: "Tool 1".to_string(),
            parameters: serde_json::json!({}),
        });
        tool_api2.register(ToolDefinition {
            name: "tool2".to_string(),
            description: "Tool 2".to_string(),
            parameters: serde_json::json!({}),
        });

        let all_tools = registry.get_all_tools();
        assert_eq!(all_tools.len(), 2);
    }

    #[test]
    fn test_registry_get_hooks_by_type() {
        let registry = PluginRegistry::new();
        let hook_api = PluginHookAPI::new("test-plugin", Arc::clone(&registry.hooks));

        hook_api.register(HookDefinition {
            hook_type: PluginHookType::BeforeToolCall,
            priority: 10,
        });
        hook_api.register(HookDefinition {
            hook_type: PluginHookType::AfterToolCall,
            priority: 20,
        });
        hook_api.register(HookDefinition {
            hook_type: PluginHookType::BeforeToolCall,
            priority: 5,
        });

        let before_hooks = registry.get_hooks_by_type(PluginHookType::BeforeToolCall);
        assert_eq!(before_hooks.len(), 2);

        let after_hooks = registry.get_hooks_by_type(PluginHookType::AfterToolCall);
        assert_eq!(after_hooks.len(), 1);
    }

    #[test]
    fn test_registry_clear_plugin() {
        let registry = PluginRegistry::new();

        let tool_api = PluginToolAPI::new("test-plugin", Arc::clone(&registry.tools));
        let cmd_api = PluginCommandAPI::new("test-plugin", Arc::clone(&registry.commands));

        tool_api.register(ToolDefinition {
            name: "tool1".to_string(),
            description: "Tool 1".to_string(),
            parameters: serde_json::json!({}),
        });
        cmd_api.register(CommandDefinition {
            name: "cmd1".to_string(),
            description: "Command 1".to_string(),
            usage: None,
            examples: vec![],
        });

        assert_eq!(registry.get_all_tools().len(), 1);
        assert_eq!(registry.get_all_commands().len(), 1);

        registry.clear_plugin("test-plugin");

        assert!(registry.get_all_tools().is_empty());
        assert!(registry.get_all_commands().is_empty());
    }
}
