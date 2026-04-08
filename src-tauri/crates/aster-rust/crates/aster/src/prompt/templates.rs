//! 系统提示词模板
//!
//! 模块化的提示词组件

use super::types::{DiagnosticInfo, GitStatusInfo, IdeType, TodoItem};

/// 核心身份描述
pub const CORE_IDENTITY: &str = r#"You are an interactive CLI tool that helps users according to your "Output Style" below, which describes how you should respond to user queries. Use the instructions below and the tools available to you to assist the user.

IMPORTANT: Assist with authorized security testing, defensive security, CTF challenges, and educational contexts. Refuse requests for destructive techniques, DoS attacks, mass targeting, supply chain compromise, or detection evasion for malicious purposes.
IMPORTANT: You must NEVER generate or guess URLs for the user unless you are confident that the URLs are for helping the user with programming. You may use URLs provided by the user in their messages or local files."#;

/// 工具使用指南
pub const TOOL_GUIDELINES: &str = r#"# Tool usage policy
- When doing file search or codebase exploration, prefer Glob, Grep, and Read before falling back to bash.
- Use specialized tools instead of bash commands when possible, as this provides a better user experience.
- NEVER use bash echo or other command-line tools to communicate thoughts, explanations, or instructions to the user.
- Use TaskCreate, TaskList, TaskGet, and TaskUpdate to track progress on multi-step work.
- Use ToolSearch to discover deferred extension tools, and use `select:<tool_name>` when you need to load a specific deferred tool into the active tool surface.
- Use Config when the user asks to inspect or update supported runtime settings such as model selection or permission mode.
- Use Sleep instead of `Bash(sleep ...)` when you intentionally need to wait.
- Only use host-injected delegation tools when the tool schema explicitly exposes them."#;

/// 权限模式说明
pub mod permission_modes {
    pub const DEFAULT: &str = r#"# Permission Mode: Default
You are running in default mode. You must ask for user approval before:
- Writing or editing files
- Running bash commands
- Making network requests"#;

    pub const ACCEPT_EDITS: &str = r#"# Permission Mode: Accept Edits
You are running in accept-edits mode. File edits are automatically approved.
You still need to ask for approval for:
- Running bash commands that could be dangerous
- Making network requests to external services"#;

    pub const BYPASS: &str = r#"# Permission Mode: Bypass
You are running in bypass mode. All tool calls are automatically approved.
Use this mode responsibly and only when explicitly requested."#;

    pub const PLAN: &str = r#"# Permission Mode: Plan
You are running in plan mode. You should:
1. Thoroughly explore the codebase using Glob, Grep, and Read tools
2. Understand existing patterns and architecture
3. Design an implementation approach
4. Present your plan to the user for approval
5. Exit plan mode with ExitPlanMode when ready to implement"#;

    pub const DELEGATE: &str = r#"# Permission Mode: Delegate
You are running as a delegated subagent. Permission decisions are delegated to the parent agent.
Complete your task autonomously without asking for user input."#;

    pub const DONT_ASK: &str = r#"# Permission Mode: Don't Ask
You are running in don't-ask mode. Permissions are determined by configured rules.
Follow the rules defined in the configuration without prompting the user."#;
}

/// 输出风格指令
pub const OUTPUT_STYLE: &str = r#"# Tone and style
- Only use emojis if the user explicitly requests it.
- Your output will be displayed on a command line interface. Your responses should be short and concise.
- Output text to communicate with the user; all text you output outside of tool use is displayed to the user.
- NEVER create files unless they're absolutely necessary for achieving your goal.

# Professional objectivity
Prioritize technical accuracy and truthfulness over validating the user's beliefs. Focus on facts and problem-solving."#;

/// Git 操作指南
pub const GIT_GUIDELINES: &str = r#"# Git Operations
- NEVER update the git config
- NEVER run destructive/irreversible git commands (like push --force, hard reset) unless explicitly requested
- NEVER skip hooks (--no-verify, --no-gpg-sign) unless explicitly requested
- NEVER force push to main/master
- Avoid git commit --amend unless explicitly requested
- NEVER commit changes unless the user explicitly asks"#;

/// 任务管理指南
pub const TASK_MANAGEMENT: &str = r#"# Task Management
You have access to TaskCreate, TaskList, TaskGet, and TaskUpdate to manage the current structured task board.
Use these tools proactively for multi-step work so progress stays explicit and visible to the user."#;

/// 代码编写指南
pub const CODING_GUIDELINES: &str = r#"# Doing tasks
- NEVER propose changes to code you haven't read. If a user asks about or wants you to modify a file, read it first.
- Use the Task* tools to plan and update the task board when the work is non-trivial
- Be careful not to introduce security vulnerabilities such as command injection, XSS, SQL injection.
- Avoid over-engineering. Only make changes that are directly requested or clearly necessary."#;

/// 子代理系统说明
pub const SUBAGENT_SYSTEM: &str = r#"# Subagent System
Only use delegation or subagent flows when the currently available tool schemas explicitly expose them.
Do not assume background execution or task-board tools support specialized agent routing unless that field is present in the tool schema."#;

/// 获取权限模式描述
pub fn get_permission_mode_description(mode: &str) -> &'static str {
    match mode {
        "default" => permission_modes::DEFAULT,
        "accept_edits" | "acceptEdits" => permission_modes::ACCEPT_EDITS,
        "bypass" | "bypassPermissions" => permission_modes::BYPASS,
        "plan" => permission_modes::PLAN,
        "delegate" => permission_modes::DELEGATE,
        "dont_ask" | "dontAsk" => permission_modes::DONT_ASK,
        _ => permission_modes::DEFAULT,
    }
}

/// 环境信息
pub struct EnvironmentInfo<'a> {
    pub working_dir: &'a str,
    pub is_git_repo: bool,
    pub platform: &'a str,
    pub today_date: &'a str,
    pub model: Option<&'a str>,
}

/// 获取环境信息文本
pub fn get_environment_info(info: &EnvironmentInfo) -> String {
    let mut lines = vec![
        "<environment>".to_string(),
        format!("Working directory: {}", info.working_dir),
        format!("Is git repo: {}", info.is_git_repo),
        format!("Platform: {}", info.platform),
        format!("Today: {}", info.today_date),
    ];

    if let Some(model) = info.model {
        lines.push(format!("Model: {}", model));
    }

    lines.push("</environment>".to_string());
    lines.join("\n")
}

/// 获取 IDE 信息文本
pub fn get_ide_info(
    ide_type: Option<IdeType>,
    ide_selection: Option<&str>,
    ide_opened_files: Option<&[String]>,
) -> String {
    let mut lines = vec!["<ide-info>".to_string()];

    if let Some(ide) = ide_type {
        lines.push(format!("IDE: {:?}", ide));
    }

    if let Some(selection) = ide_selection {
        lines.push(format!("Selected code:\n```\n{}\n```", selection));
    }

    if let Some(files) = ide_opened_files {
        if !files.is_empty() {
            lines.push("Opened files:".to_string());
            for file in files {
                lines.push(format!("  - {}", file));
            }
        }
    }

    lines.push("</ide-info>".to_string());
    lines.join("\n")
}

/// 获取诊断信息文本
pub fn get_diagnostics_info(diagnostics: &[DiagnosticInfo]) -> Option<String> {
    if diagnostics.is_empty() {
        return None;
    }

    let mut lines = vec!["<diagnostics>".to_string()];

    for diag in diagnostics {
        let severity = format!("{:?}", diag.severity).to_uppercase();
        lines.push(format!(
            "[{}] {}:{}:{} - {}",
            severity, diag.file, diag.line, diag.column, diag.message
        ));
    }

    lines.push("</diagnostics>".to_string());
    Some(lines.join("\n"))
}

/// 获取 Git 状态信息文本
pub fn get_git_status_info(status: &GitStatusInfo) -> String {
    let mut lines = vec![
        "<git-status>".to_string(),
        format!("Branch: {}", status.branch),
        format!("Clean: {}", status.is_clean),
    ];

    if status.ahead > 0 || status.behind > 0 {
        lines.push(format!(
            "Ahead: {}, Behind: {}",
            status.ahead, status.behind
        ));
    }

    if !status.staged.is_empty() {
        lines.push(format!("Staged: {}", status.staged.join(", ")));
    }

    if !status.unstaged.is_empty() {
        lines.push(format!("Unstaged: {}", status.unstaged.join(", ")));
    }

    if !status.untracked.is_empty() {
        lines.push(format!("Untracked: {}", status.untracked.join(", ")));
    }

    lines.push("</git-status>".to_string());
    lines.join("\n")
}

/// 获取记忆信息文本
pub fn get_memory_info(memory: &std::collections::HashMap<String, String>) -> Option<String> {
    if memory.is_empty() {
        return None;
    }

    let mut lines = vec!["<memory>".to_string()];

    for (key, value) in memory {
        lines.push(format!("## {}\n{}", key, value));
    }

    lines.push("</memory>".to_string());
    Some(lines.join("\n"))
}

/// 获取任务列表信息文本
pub fn get_todo_list_info(todos: &[TodoItem]) -> Option<String> {
    if todos.is_empty() {
        return None;
    }

    let mut lines = vec!["# Current Tasks".to_string()];

    for todo in todos {
        let status_icon = match todo.status {
            super::types::TodoStatus::Pending => "[ ]",
            super::types::TodoStatus::InProgress => "[~]",
            super::types::TodoStatus::Completed => "[x]",
        };
        lines.push(format!("{} {}", status_icon, todo.content));
    }

    Some(lines.join("\n"))
}
