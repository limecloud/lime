//! Git 工具模块
//!
//! 提供 Git 状态检测、分支信息、安全检查等功能

mod core;
mod safety;

pub use core::{
    get_current_branch, get_default_branch, get_git_info, get_git_status, is_git_repository,
    GitInfo, GitStatus, GitUtils, PushStatus,
};
pub use safety::{is_dangerous_command, GitSafety, SafetyCheckResult, SensitiveFilesCheck};
