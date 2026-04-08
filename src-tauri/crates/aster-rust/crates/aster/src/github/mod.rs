//! GitHub 集成模块
//!
//! 提供 GitHub Actions 工作流设置、PR 管理等功能

mod pr;
mod workflow;

pub use pr::{
    add_pr_comment, create_pr, get_pr_comments, get_pr_info, CreatePROptions, PRComment, PRInfo,
};
pub use workflow::{
    check_github_cli, setup_github_workflow, GitHubCLIStatus, CLAUDE_CODE_WORKFLOW,
};
