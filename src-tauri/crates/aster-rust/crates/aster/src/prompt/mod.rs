//! 系统提示词模块
//!
//! - 类型定义 (types)
//! - 缓存系统 (cache)
//! - 模板常量 (templates)
//! - 附件管理 (attachments)
//! - 提示词构建器 (builder)

pub mod attachments;
pub mod builder;
pub mod cache;
pub mod templates;
pub mod types;

#[cfg(test)]
mod tests;

// Re-exports
pub use attachments::AttachmentManager;
pub use builder::SystemPromptBuilder;
pub use cache::{estimate_tokens, generate_cache_key, CacheStats, PromptCache};
pub use templates::{
    get_diagnostics_info, get_environment_info, get_git_status_info, get_ide_info, get_memory_info,
    get_permission_mode_description, get_todo_list_info, EnvironmentInfo, CODING_GUIDELINES,
    CORE_IDENTITY, GIT_GUIDELINES, OUTPUT_STYLE, SUBAGENT_SYSTEM, TASK_MANAGEMENT, TOOL_GUIDELINES,
};
pub use types::{
    Attachment, AttachmentType, BuildResult, DiagnosticInfo, DiagnosticSeverity, GitStatusInfo,
    IdeType, PermissionMode, PromptContext, PromptHashInfo, PromptTooLongError,
    SystemPromptOptions, TodoItem, TodoStatus,
};
