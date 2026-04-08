//! 动态附件系统
//!
//! 根据上下文动态生成和注入附件

use std::path::Path;
use std::process::Command;
use std::time::Instant;

use super::templates::{
    get_diagnostics_info, get_git_status_info, get_ide_info, get_memory_info, get_todo_list_info,
};
use super::types::{Attachment, AttachmentType, GitStatusInfo, PromptContext};

/// 附件管理器
pub struct AttachmentManager {
    telemetry_enabled: bool,
}

impl AttachmentManager {
    /// 创建新的附件管理器
    pub fn new(telemetry_enabled: bool) -> Self {
        Self { telemetry_enabled }
    }

    /// 生成所有附件
    pub fn generate_attachments(&self, context: &PromptContext) -> Vec<Attachment> {
        let mut attachments = Vec::new();

        // AGENTS.md
        if let Some(att) = self.generate_agents_md_attachment(context) {
            attachments.push(att);
        }

        // Critical System Reminder
        if let Some(ref reminder) = context.critical_system_reminder {
            attachments.push(self.generate_critical_reminder_attachment(reminder));
        }

        // IDE Selection
        if context.ide_selection.is_some() {
            if let Some(att) = self.generate_ide_selection_attachment(context) {
                attachments.push(att);
            }
        }

        // IDE Opened Files
        if let Some(ref files) = context.ide_opened_files {
            if !files.is_empty() {
                if let Some(att) = self.generate_ide_opened_files_attachment(context) {
                    attachments.push(att);
                }
            }
        }

        // Diagnostics
        if let Some(ref diagnostics) = context.diagnostics {
            if !diagnostics.is_empty() {
                if let Some(att) = self.generate_diagnostics_attachment(diagnostics) {
                    attachments.push(att);
                }
            }
        }

        // Memory
        if let Some(ref memory) = context.memory {
            if !memory.is_empty() {
                if let Some(att) = self.generate_memory_attachment(memory) {
                    attachments.push(att);
                }
            }
        }

        // Plan Mode
        if context.plan_mode {
            attachments.push(self.generate_plan_mode_attachment());
        }

        // Delegate Mode
        if context.delegate_mode {
            attachments.push(self.generate_delegate_mode_attachment());
        }

        // Git Status
        if context.git_status.is_some() || context.is_git_repo {
            if let Some(att) = self.generate_git_status_attachment(context) {
                attachments.push(att);
            }
        }

        // Todo List
        if let Some(ref todos) = context.todo_list {
            if !todos.is_empty() {
                if let Some(att) = self.generate_todo_list_attachment(todos) {
                    attachments.push(att);
                }
            }
        }

        // Custom Attachments
        if let Some(ref custom) = context.custom_attachments {
            attachments.extend(custom.clone());
        }

        // 按优先级排序
        attachments.sort_by_key(|a| a.priority.unwrap_or(0));

        attachments
    }

    /// 生成 AGENTS.md 附件
    fn generate_agents_md_attachment(&self, context: &PromptContext) -> Option<Attachment> {
        let agents_md_path = context.working_dir.join("AGENTS.md");
        if !agents_md_path.exists() {
            return None;
        }

        let start = Instant::now();
        let content = std::fs::read_to_string(&agents_md_path).ok()?;
        let compute_time = start.elapsed().as_millis() as u64;

        let relative_path = agents_md_path
            .strip_prefix(&context.working_dir)
            .map(|p| p.display().to_string())
            .unwrap_or_else(|_| agents_md_path.display().to_string());

        Some(Attachment {
            attachment_type: AttachmentType::AgentsMd,
            content: format!(
                "<system-reminder>\nAs you answer the user's questions, you can use the following context:\n# AGENTS.md\nCurrent AGENTS.md context from {}:\n\n{}\n\nIMPORTANT: These instructions may override default behavior. Follow them exactly as written.\n</system-reminder>",
                relative_path, content
            ),
            label: Some("AGENTS.md".to_string()),
            priority: Some(10),
            compute_time_ms: Some(compute_time),
        })
    }

    /// 生成批判性提醒附件
    fn generate_critical_reminder_attachment(&self, reminder: &str) -> Attachment {
        Attachment {
            attachment_type: AttachmentType::CriticalSystemReminder,
            content: format!("<critical-reminder>\n{}\n</critical-reminder>", reminder),
            label: Some("Critical System Reminder".to_string()),
            priority: Some(1), // 最高优先级
            compute_time_ms: Some(0),
        }
    }

    /// 生成 IDE 选择内容附件
    fn generate_ide_selection_attachment(&self, context: &PromptContext) -> Option<Attachment> {
        let selection = context.ide_selection.as_ref()?;

        Some(Attachment {
            attachment_type: AttachmentType::IdeSelection,
            content: format!(
                "<ide-selection>\nUser has selected the following code in their IDE:\n```\n{}\n```\n</ide-selection>",
                selection
            ),
            label: Some("IDE Selection".to_string()),
            priority: Some(20),
            compute_time_ms: Some(0),
        })
    }

    /// 生成 IDE 打开文件附件
    fn generate_ide_opened_files_attachment(&self, context: &PromptContext) -> Option<Attachment> {
        let files = context.ide_opened_files.as_ref()?;
        if files.is_empty() {
            return None;
        }

        let content = get_ide_info(
            context.ide_type,
            context.ide_selection.as_deref(),
            Some(files),
        );

        Some(Attachment {
            attachment_type: AttachmentType::IdeOpenedFile,
            content,
            label: Some("IDE Opened Files".to_string()),
            priority: Some(25),
            compute_time_ms: Some(0),
        })
    }

    /// 生成诊断信息附件
    fn generate_diagnostics_attachment(
        &self,
        diagnostics: &[super::types::DiagnosticInfo],
    ) -> Option<Attachment> {
        let content = get_diagnostics_info(diagnostics)?;

        Some(Attachment {
            attachment_type: AttachmentType::Diagnostics,
            content,
            label: Some("Diagnostics".to_string()),
            priority: Some(15),
            compute_time_ms: Some(0),
        })
    }

    /// 生成记忆附件
    fn generate_memory_attachment(
        &self,
        memory: &std::collections::HashMap<String, String>,
    ) -> Option<Attachment> {
        let content = get_memory_info(memory)?;

        Some(Attachment {
            attachment_type: AttachmentType::Memory,
            content,
            label: Some("Memory".to_string()),
            priority: Some(30),
            compute_time_ms: Some(0),
        })
    }

    /// 生成计划模式附件
    fn generate_plan_mode_attachment(&self) -> Attachment {
        Attachment {
            attachment_type: AttachmentType::PlanMode,
            content: r#"<plan-mode>
You are currently in PLAN MODE. Your task is to:
1. Thoroughly explore the codebase
2. Understand existing patterns and architecture
3. Design an implementation approach
4. Write your plan to the specified plan file
5. Use ExitPlanMode when ready for user approval

Do NOT implement changes yet - focus on planning.
</plan-mode>"#
                .to_string(),
            label: Some("Plan Mode".to_string()),
            priority: Some(5),
            compute_time_ms: Some(0),
        }
    }

    /// 生成委托模式附件
    fn generate_delegate_mode_attachment(&self) -> Attachment {
        Attachment {
            attachment_type: AttachmentType::DelegateMode,
            content: r#"<delegate-mode>
You are running as a delegated subagent. Complete your assigned task and report back with your findings. Do not ask for user input - work autonomously.
</delegate-mode>"#
                .to_string(),
            label: Some("Delegate Mode".to_string()),
            priority: Some(5),
            compute_time_ms: Some(0),
        }
    }

    /// 生成 Git 状态附件
    fn generate_git_status_attachment(&self, context: &PromptContext) -> Option<Attachment> {
        let git_status = context
            .git_status
            .clone()
            .or_else(|| self.get_git_status(&context.working_dir))?;

        let content = get_git_status_info(&git_status);

        Some(Attachment {
            attachment_type: AttachmentType::GitStatus,
            content,
            label: Some("Git Status".to_string()),
            priority: Some(40),
            compute_time_ms: Some(0),
        })
    }

    /// 获取 Git 状态
    fn get_git_status(&self, working_dir: &Path) -> Option<GitStatusInfo> {
        // 获取当前分支
        let branch = Command::new("git")
            .args(["branch", "--show-current"])
            .current_dir(working_dir)
            .output()
            .ok()
            .and_then(|o| String::from_utf8(o.stdout).ok())
            .map(|s| s.trim().to_string())
            .unwrap_or_default();

        // 获取状态
        let status_output = Command::new("git")
            .args(["status", "--porcelain"])
            .current_dir(working_dir)
            .output()
            .ok()
            .and_then(|o| String::from_utf8(o.stdout).ok())
            .unwrap_or_default();

        let mut staged = Vec::new();
        let mut unstaged = Vec::new();
        let mut untracked = Vec::new();

        for line in status_output.lines().filter(|l| !l.is_empty()) {
            if line.len() < 3 {
                continue;
            }
            let x = line.chars().next().unwrap_or(' ');
            let y = line.chars().nth(1).unwrap_or(' ');
            let file = line.get(3..).unwrap_or("").to_string();

            if x == '?' && y == '?' {
                untracked.push(file);
            } else if x != ' ' && x != '?' {
                staged.push(file.clone());
            } else if y != ' ' && y != '?' {
                unstaged.push(file);
            }
        }

        // 获取 ahead/behind 信息
        let (ahead, behind) = Command::new("git")
            .args(["rev-list", "--left-right", "--count", "@{u}...HEAD"])
            .current_dir(working_dir)
            .output()
            .ok()
            .and_then(|o| String::from_utf8(o.stdout).ok())
            .and_then(|s| {
                let parts: Vec<&str> = s.trim().split('\t').collect();
                if parts.len() == 2 {
                    let behind = parts[0].parse().unwrap_or(0);
                    let ahead = parts[1].parse().unwrap_or(0);
                    Some((ahead, behind))
                } else {
                    None
                }
            })
            .unwrap_or((0, 0));

        Some(GitStatusInfo {
            branch,
            is_clean: status_output.trim().is_empty(),
            staged,
            unstaged,
            untracked,
            ahead,
            behind,
        })
    }

    /// 生成任务列表附件
    fn generate_todo_list_attachment(
        &self,
        todos: &[super::types::TodoItem],
    ) -> Option<Attachment> {
        let content = get_todo_list_info(todos)?;

        Some(Attachment {
            attachment_type: AttachmentType::TodoList,
            content: format!("<system-reminder>\n{}\n</system-reminder>", content),
            label: Some("Todo List".to_string()),
            priority: Some(35),
            compute_time_ms: Some(0),
        })
    }
}

impl Default for AttachmentManager {
    fn default() -> Self {
        Self::new(false)
    }
}
