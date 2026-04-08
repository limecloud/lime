//! 系统提示词类型定义
//!

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;

/// 附件类型
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AttachmentType {
    AgentsMd,
    CriticalSystemReminder,
    IdeSelection,
    IdeOpenedFile,
    OutputStyle,
    Diagnostics,
    Memory,
    PlanMode,
    DelegateMode,
    GitStatus,
    TodoList,
    Custom,
}

/// 附件结构
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Attachment {
    pub attachment_type: AttachmentType,
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub priority: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub compute_time_ms: Option<u64>,
}

/// 权限模式
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum PermissionMode {
    #[default]
    Default,
    AcceptEdits,
    BypassPermissions,
    Plan,
    Delegate,
    DontAsk,
}

/// 诊断信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiagnosticInfo {
    pub file: String,
    pub line: u32,
    pub column: u32,
    pub severity: DiagnosticSeverity,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
}

/// 诊断严重程度
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DiagnosticSeverity {
    Error,
    Warning,
    Info,
    Hint,
}

/// 任务项
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TodoItem {
    pub content: String,
    pub status: TodoStatus,
    pub active_form: String,
}

/// 任务状态
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TodoStatus {
    Pending,
    InProgress,
    Completed,
}

/// Git 状态信息
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct GitStatusInfo {
    pub branch: String,
    pub is_clean: bool,
    pub staged: Vec<String>,
    pub unstaged: Vec<String>,
    pub untracked: Vec<String>,
    pub ahead: u32,
    pub behind: u32,
}

/// IDE 类型
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum IdeType {
    Vscode,
    Cursor,
    Windsurf,
    Zed,
    Terminal,
}

/// 提示词上下文
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct PromptContext {
    /// 工作目录
    pub working_dir: PathBuf,
    /// 当前模型
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    /// 权限模式
    #[serde(skip_serializing_if = "Option::is_none")]
    pub permission_mode: Option<PermissionMode>,
    /// 是否为调试模式
    #[serde(default)]
    pub debug: bool,
    /// 是否为 plan 模式
    #[serde(default)]
    pub plan_mode: bool,
    /// 是否为 delegate 模式
    #[serde(default)]
    pub delegate_mode: bool,
    /// IDE 类型
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ide_type: Option<IdeType>,
    /// IDE 选择内容
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ide_selection: Option<String>,
    /// IDE 打开的文件
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ide_opened_files: Option<Vec<String>>,
    /// 诊断信息
    #[serde(skip_serializing_if = "Option::is_none")]
    pub diagnostics: Option<Vec<DiagnosticInfo>>,
    /// 记忆系统内容
    #[serde(skip_serializing_if = "Option::is_none")]
    pub memory: Option<HashMap<String, String>>,
    /// 任务列表
    #[serde(skip_serializing_if = "Option::is_none")]
    pub todo_list: Option<Vec<TodoItem>>,
    /// Git 状态
    #[serde(skip_serializing_if = "Option::is_none")]
    pub git_status: Option<GitStatusInfo>,
    /// 自定义附件
    #[serde(skip_serializing_if = "Option::is_none")]
    pub custom_attachments: Option<Vec<Attachment>>,
    /// critical_system_reminder
    #[serde(skip_serializing_if = "Option::is_none")]
    pub critical_system_reminder: Option<String>,
    /// 今天日期
    #[serde(skip_serializing_if = "Option::is_none")]
    pub today_date: Option<String>,
    /// 平台
    #[serde(skip_serializing_if = "Option::is_none")]
    pub platform: Option<String>,
    /// 是否为 git 仓库
    #[serde(default)]
    pub is_git_repo: bool,
}

/// 系统提示词构建选项
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemPromptOptions {
    /// 包含核心身份描述
    #[serde(default = "default_true")]
    pub include_identity: bool,
    /// 包含工具使用指南
    #[serde(default = "default_true")]
    pub include_tool_guidelines: bool,
    /// 包含权限模式说明
    #[serde(default = "default_true")]
    pub include_permission_mode: bool,
    /// 包含 AGENTS.md 内容
    #[serde(default = "default_true")]
    pub include_agents_md: bool,
    /// 包含 IDE 集成信息
    #[serde(default = "default_true")]
    pub include_ide_info: bool,
    /// 包含诊断信息
    #[serde(default = "default_true")]
    pub include_diagnostics: bool,
    /// 最大长度限制 (tokens)
    #[serde(default = "default_max_tokens")]
    pub max_tokens: usize,
    /// 是否启用缓存
    #[serde(default = "default_true")]
    pub enable_cache: bool,
}

fn default_true() -> bool {
    true
}

fn default_max_tokens() -> usize {
    180000
}

impl Default for SystemPromptOptions {
    fn default() -> Self {
        Self {
            include_identity: true,
            include_tool_guidelines: true,
            include_permission_mode: true,
            include_agents_md: true,
            include_ide_info: true,
            include_diagnostics: true,
            max_tokens: 180000,
            enable_cache: true,
        }
    }
}

/// 提示词哈希信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PromptHashInfo {
    /// 哈希值
    pub hash: String,
    /// 计算时间
    pub computed_at: u64,
    /// 原始长度
    pub length: usize,
    /// 估算 tokens
    pub estimated_tokens: usize,
}

/// 提示词构建结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BuildResult {
    /// 完整的系统提示词
    pub content: String,
    /// 哈希信息
    pub hash_info: PromptHashInfo,
    /// 附件列表
    pub attachments: Vec<Attachment>,
    /// 是否被截断
    pub truncated: bool,
    /// 构建耗时 (ms)
    pub build_time_ms: u64,
}

/// 长度限制错误
#[derive(Debug, Clone)]
pub struct PromptTooLongError {
    pub estimated_tokens: usize,
    pub max_tokens: usize,
    pub message: String,
}

impl PromptTooLongError {
    pub fn new(estimated_tokens: usize, max_tokens: usize) -> Self {
        let message = format!(
            "Prompt is too long. Estimated {} tokens, max {}. \
             Press esc twice to go up a few messages and try again, or use /compact to reduce context.",
            estimated_tokens, max_tokens
        );
        Self {
            estimated_tokens,
            max_tokens,
            message,
        }
    }
}

impl std::fmt::Display for PromptTooLongError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.message)
    }
}

impl std::error::Error for PromptTooLongError {}
