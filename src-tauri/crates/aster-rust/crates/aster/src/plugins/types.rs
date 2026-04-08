//! 插件类型定义
//!
//! 定义插件相关的数据结构

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;

/// 插件元数据
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginMetadata {
    /// 插件名称
    pub name: String,
    /// 版本
    pub version: String,
    /// 描述
    pub description: Option<String>,
    /// 作者
    pub author: Option<String>,
    /// 主页
    pub homepage: Option<String>,
    /// 许可证
    pub license: Option<String>,
    /// 主入口文件
    pub main: Option<String>,
    /// 引擎要求
    pub engines: Option<EngineRequirements>,
    /// 依赖
    pub dependencies: Option<HashMap<String, String>>,
}

/// 引擎要求
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct EngineRequirements {
    /// Rust 版本
    pub rust: Option<String>,
    /// Aster 版本
    pub aster: Option<String>,
}

/// 插件状态
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginState {
    /// 元数据
    pub metadata: PluginMetadata,
    /// 路径
    pub path: PathBuf,
    /// 是否启用
    pub enabled: bool,
    /// 是否已加载
    pub loaded: bool,
    /// 是否已初始化
    pub initialized: bool,
    /// 是否已激活
    pub activated: bool,
    /// 错误信息
    pub error: Option<String>,
    /// 加载时间
    pub load_time: Option<u64>,
    /// 依赖列表
    pub dependencies: Vec<String>,
    /// 被依赖列表
    pub dependents: Vec<String>,
}

/// 插件配置
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct PluginConfig {
    /// 是否启用
    pub enabled: bool,
    /// 是否自动加载
    pub auto_load: bool,
    /// 配置数据
    pub config: HashMap<String, serde_json::Value>,
}

/// 命令定义
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommandDefinition {
    /// 命令名称
    pub name: String,
    /// 描述
    pub description: String,
    /// 用法
    pub usage: Option<String>,
    /// 示例
    pub examples: Vec<String>,
}

/// 技能定义
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillDefinition {
    /// 技能名称
    pub name: String,
    /// 描述
    pub description: String,
    /// 提示词
    pub prompt: String,
    /// 分类
    pub category: Option<String>,
    /// 示例
    pub examples: Vec<String>,
    /// 参数
    pub parameters: Vec<SkillParameter>,
}

/// 技能参数
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillParameter {
    /// 参数名
    pub name: String,
    /// 描述
    pub description: String,
    /// 是否必需
    pub required: bool,
    /// 类型
    pub param_type: Option<String>,
}

/// 插件钩子类型
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PluginHookType {
    BeforeMessage,
    AfterMessage,
    BeforeToolCall,
    AfterToolCall,
    OnError,
    OnSessionStart,
    OnSessionEnd,
    OnPluginLoad,
    OnPluginUnload,
}

/// 钩子定义
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HookDefinition {
    /// 钩子类型
    pub hook_type: PluginHookType,
    /// 优先级
    pub priority: i32,
}

/// 插件 trait
pub trait Plugin: Send + Sync {
    /// 获取元数据
    fn metadata(&self) -> &PluginMetadata;
    /// 初始化
    fn init(&mut self) -> anyhow::Result<()> {
        Ok(())
    }
    /// 激活
    fn activate(&mut self) -> anyhow::Result<()> {
        Ok(())
    }
    /// 停用
    fn deactivate(&mut self) -> anyhow::Result<()> {
        Ok(())
    }
    /// 获取命令
    fn commands(&self) -> Vec<CommandDefinition> {
        Vec::new()
    }
    /// 获取技能
    fn skills(&self) -> Vec<SkillDefinition> {
        Vec::new()
    }
    /// 获取钩子
    fn hooks(&self) -> Vec<HookDefinition> {
        Vec::new()
    }
}
