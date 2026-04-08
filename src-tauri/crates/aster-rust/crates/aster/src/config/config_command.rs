//! 配置命令
//!
//! 提供 /config 命令用于展示和管理配置

use super::agents_md_parser::AgentsMdParser;
use super::config_manager::{ConfigManager, ConfigSource};
use serde_json::Value;
use std::collections::HashMap;

/// 配置展示选项
#[derive(Debug, Clone, Default)]
pub struct ConfigDisplayOptions {
    /// 是否显示敏感信息
    pub show_secrets: bool,
    /// 是否显示来源
    pub show_sources: bool,
    /// 是否显示备份
    pub show_backups: bool,
    /// 输出格式
    pub format: ConfigFormat,
}

/// 输出格式
#[derive(Debug, Clone, Copy, Default)]
pub enum ConfigFormat {
    #[default]
    Json,
    Yaml,
    Table,
}

/// 配置命令处理器
pub struct ConfigCommand<'a> {
    config_manager: &'a ConfigManager,
}

impl<'a> ConfigCommand<'a> {
    /// 创建新的配置命令处理器
    pub fn new(config_manager: &'a ConfigManager) -> Self {
        Self { config_manager }
    }

    /// 展示当前配置
    pub fn display(&self, options: ConfigDisplayOptions) -> String {
        let mut output = String::new();

        // 标题
        output.push_str(&"=".repeat(60));
        output.push_str("\nAster Configuration\n");
        output.push_str(&"=".repeat(60));
        output.push_str("\n\n");

        // 配置内容
        let config = if options.show_secrets {
            serde_json::to_string_pretty(&self.config_manager.get_all()).unwrap_or_default()
        } else {
            self.config_manager.export(true)
        };

        output.push_str("**当前配置:**\n");
        output.push_str("```json\n");
        output.push_str(&config);
        output.push_str("\n```\n\n");

        // 配置来源
        if options.show_sources {
            output.push_str(&self.display_sources());
        }

        // 备份信息
        if options.show_backups {
            output.push_str(&self.display_backups());
        }

        // AGENTS.md 信息
        output.push_str(&self.display_agents_md());

        output.push('\n');
        output.push_str(&"=".repeat(60));
        output.push('\n');

        output
    }

    /// 展示配置来源
    fn display_sources(&self) -> String {
        let mut output = String::from("**配置来源:**\n\n");

        let sources = self.config_manager.get_config_source_info();

        output.push_str("| 优先级 | 来源 | 路径 | 状态 |\n");
        output.push_str("|--------|------|------|------|\n");

        for info in sources {
            let status = if info.exists { "OK" } else { "未找到" };
            let path = info
                .path
                .as_ref()
                .map(|p| p.display().to_string())
                .unwrap_or_else(|| "N/A".to_string());

            output.push_str(&format!(
                "| {} | {:?} | {} | {} |\n",
                info.priority, info.source, path, status
            ));
        }

        output.push_str("\n**配置项来源:**\n\n");
        output.push_str("| 配置键 | 值 | 来源 |\n");
        output.push_str("|--------|-----|------|\n");

        let config = self.config_manager.get_all();
        let sources = self.config_manager.get_all_config_sources();

        let important_keys = [
            "api_key",
            "model",
            "max_tokens",
            "api_provider",
            "theme",
            "enable_telemetry",
        ];

        for key in important_keys {
            if let Some(value) = config.get(key) {
                let formatted_value = self.format_value(value);
                let source = sources.get(key).copied().unwrap_or(ConfigSource::Default);
                output.push_str(&format!(
                    "| {} | {} | {:?} |\n",
                    key, formatted_value, source
                ));
            }
        }

        output.push('\n');
        output
    }

    /// 格式化配置值
    fn format_value(&self, value: &Value) -> String {
        match value {
            Value::Null => "null".to_string(),
            Value::Bool(b) => b.to_string(),
            Value::Number(n) => n.to_string(),
            Value::String(s) => {
                if s.len() > 30 {
                    format!("{}...", s.get(..27).unwrap_or(s))
                } else {
                    s.clone()
                }
            }
            Value::Array(_) | Value::Object(_) => {
                let json = serde_json::to_string(value).unwrap_or_default();
                if json.len() > 30 {
                    format!("{}...", json.get(..27).unwrap_or(&json))
                } else {
                    json
                }
            }
        }
    }

    /// 展示备份信息
    fn display_backups(&self) -> String {
        let mut output = String::from("**可用备份:**\n\n");

        let user_backups = self.config_manager.list_backups("user");
        let project_backups = self.config_manager.list_backups("project");
        let local_backups = self.config_manager.list_backups("local");

        output.push_str(&format!("用户配置备份: {}\n", user_backups.len()));
        if let Some(latest) = user_backups.first() {
            output.push_str(&format!("  最新: {}\n", latest));
        }

        output.push_str(&format!("项目配置备份: {}\n", project_backups.len()));
        if let Some(latest) = project_backups.first() {
            output.push_str(&format!("  最新: {}\n", latest));
        }

        output.push_str(&format!("本地配置备份: {}\n", local_backups.len()));
        if let Some(latest) = local_backups.first() {
            output.push_str(&format!("  最新: {}\n", latest));
        }

        output.push('\n');
        output
    }

    /// 展示 AGENTS.md 信息
    fn display_agents_md(&self) -> String {
        let parser = AgentsMdParser::default();
        let info = parser.parse();

        let mut output = String::from("**AGENTS.md 状态:**\n\n");

        if info.exists {
            let stats = parser.get_stats();
            let validation = parser.validate();

            output.push_str(&format!("路径: {}\n", info.path.display()));
            output.push_str("状态: 已找到 ✓\n");

            if let Some(modified) = info.last_modified {
                if let Ok(duration) = modified.elapsed() {
                    output.push_str(&format!("最后修改: {}秒前\n", duration.as_secs()));
                }
            }

            if let Some(stats) = stats {
                output.push_str(&format!(
                    "大小: {} 字节 ({} 行, {} 字符)\n",
                    stats.size, stats.lines, stats.chars
                ));
            }

            if !validation.warnings.is_empty() {
                output.push_str("\n警告:\n");
                for warning in validation.warnings {
                    output.push_str(&format!("  - {}\n", warning));
                }
            }
        } else {
            output.push_str(&format!("路径: {}\n", info.path.display()));
            output.push_str("状态: 未找到 ✗\n");
            output.push_str("\n提示: 创建 AGENTS.md 文件为 AI Agent 提供项目指导。\n");
        }

        output.push('\n');
        output
    }

    /// 获取特定配置项
    pub fn get(&self, key: &str) -> String {
        match self.config_manager.get_with_source::<Value>(key) {
            Some((value, source, path)) => {
                let path_info = path.map(|p| format!(" ({:?})", p)).unwrap_or_default();
                format!(
                    "{} = {} (来源: {:?}{})",
                    key,
                    serde_json::to_string_pretty(&value).unwrap_or_default(),
                    source,
                    path_info
                )
            }
            None => format!("{} = 未设置", key),
        }
    }

    /// 设置配置项
    pub fn set(&self, key: &str, value: Value, target: &str) -> String {
        let mut config = HashMap::new();
        config.insert(key.to_string(), value.clone());

        let result = match target {
            "local" => self.config_manager.save_local(&config),
            "project" => self.config_manager.save_project(&config),
            _ => self.config_manager.save(Some(&config)),
        };

        match result {
            Ok(_) => format!("已设置 {} = {:?} 到 {} 配置", key, value, target),
            Err(e) => format!("设置失败: {}", e),
        }
    }

    /// 列出备份
    pub fn list_backups(&self, config_type: &str) -> String {
        let backups = self.config_manager.list_backups(config_type);

        if backups.is_empty() {
            return format!("未找到 {} 配置的备份", config_type);
        }

        let mut output = format!("{} 配置的备份:\n\n", config_type);
        for (index, backup) in backups.iter().enumerate() {
            output.push_str(&format!("{}. {}\n", index + 1, backup));
        }
        output
    }

    /// 恢复备份
    pub fn restore(
        &self,
        backup_filename: &str,
        config_type: &str,
        manager: &mut ConfigManager,
    ) -> String {
        match manager.restore_from_backup(backup_filename, config_type) {
            Ok(_) => format!("已从 {} 恢复 {} 配置", backup_filename, config_type),
            Err(e) => format!("恢复失败: {}", e),
        }
    }

    /// 重置配置
    pub fn reset(&self, manager: &mut ConfigManager) -> String {
        manager.reset();
        "配置已重置为默认值".to_string()
    }

    /// 导出配置
    pub fn export_config(&self, mask_secrets: bool) -> String {
        self.config_manager.export(mask_secrets)
    }

    /// 导入配置
    pub fn import_config(&self, config_json: &str, manager: &mut ConfigManager) -> String {
        match manager.import(config_json) {
            Ok(_) => "配置导入成功".to_string(),
            Err(e) => format!("导入失败: {}", e),
        }
    }

    /// 获取帮助信息
    pub fn help(&self) -> String {
        r#"
Aster 配置命令

用法:
  /config                   - 显示当前配置
  /config get <key>         - 获取特定配置值
  /config set <key> <value> - 设置配置值
  /config backups [type]    - 列出可用备份 (user/project/local)
  /config restore <file>    - 从备份恢复配置
  /config reset             - 重置为默认配置
  /config export            - 导出配置（敏感信息已掩码）
  /config import <json>     - 从 JSON 导入配置
  /config help              - 显示此帮助信息

示例:
  /config get model
  /config set theme dark
  /config backups user
  /config restore settings.2024-01-01T12-00-00.yaml

配置来源（优先级从低到高）:
  0. default              - 内置默认值
  1. userSettings         - 用户全局配置 (~/.aster/settings.yaml)
  2. projectSettings      - 项目配置 (./.aster/settings.yaml)
  3. localSettings        - 本地配置 (./.aster/settings.local.yaml)
  4. envSettings          - 环境变量 (ASTER_*)
  5. flagSettings         - 命令行标志 (--settings)
  6. policySettings       - 企业策略 (~/.aster/managed_settings.yaml)
"#
        .to_string()
    }
}

/// 创建配置命令实例
pub fn create_config_command(config_manager: &ConfigManager) -> ConfigCommand<'_> {
    ConfigCommand::new(config_manager)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_config_command_help() {
        let manager = ConfigManager::default();
        let cmd = ConfigCommand::new(&manager);
        let help = cmd.help();
        assert!(help.contains("/config"));
        assert!(help.contains("配置来源"));
    }

    #[test]
    fn test_config_command_get() {
        let manager = ConfigManager::default();
        let cmd = ConfigCommand::new(&manager);
        let result = cmd.get("model");
        assert!(result.contains("model"));
    }

    #[test]
    fn test_config_command_display() {
        let manager = ConfigManager::default();
        let cmd = ConfigCommand::new(&manager);
        let output = cmd.display(ConfigDisplayOptions::default());
        assert!(output.contains("Aster Configuration"));
    }

    #[test]
    fn test_format_value() {
        let manager = ConfigManager::default();
        let cmd = ConfigCommand::new(&manager);

        assert_eq!(cmd.format_value(&Value::Bool(true)), "true");
        assert_eq!(cmd.format_value(&Value::Number(42.into())), "42");
        assert_eq!(cmd.format_value(&Value::String("test".to_string())), "test");
    }
}
