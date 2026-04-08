//! 系统提示词构建器
//!
//! 组装完整的模块化系统提示词

use std::time::Instant;

use super::attachments::AttachmentManager;
use super::cache::{estimate_tokens, generate_cache_key, PromptCache};
use super::templates::{
    get_environment_info, get_permission_mode_description, EnvironmentInfo, CODING_GUIDELINES,
    CORE_IDENTITY, GIT_GUIDELINES, OUTPUT_STYLE, SUBAGENT_SYSTEM, TASK_MANAGEMENT, TOOL_GUIDELINES,
};
use super::types::{
    Attachment, BuildResult, PermissionMode, PromptContext, PromptTooLongError, SystemPromptOptions,
};

/// 系统提示词构建器
pub struct SystemPromptBuilder {
    attachment_manager: AttachmentManager,
    cache: PromptCache,
    debug: bool,
}

impl SystemPromptBuilder {
    /// 创建新的构建器
    pub fn new(debug: bool) -> Self {
        Self {
            attachment_manager: AttachmentManager::default(),
            cache: PromptCache::default(),
            debug,
        }
    }

    /// 使用自定义组件创建构建器
    pub fn with_components(
        attachment_manager: AttachmentManager,
        cache: PromptCache,
        debug: bool,
    ) -> Self {
        Self {
            attachment_manager,
            cache,
            debug,
        }
    }

    /// 构建完整的系统提示词
    pub fn build(
        &mut self,
        context: &PromptContext,
        options: Option<SystemPromptOptions>,
    ) -> Result<BuildResult, PromptTooLongError> {
        let start_time = Instant::now();
        let opts = options.unwrap_or_default();

        // 检查缓存
        if opts.enable_cache {
            let cache_key = generate_cache_key(
                &context.working_dir.display().to_string(),
                context.model.as_deref(),
                context
                    .permission_mode
                    .map(|m| format!("{:?}", m))
                    .as_deref(),
                context.plan_mode,
            );

            if let Some((content, hash_info)) = self.cache.get(&cache_key) {
                if self.debug {
                    eprintln!("[SystemPromptBuilder] Cache hit");
                }
                return Ok(BuildResult {
                    content,
                    hash_info,
                    attachments: vec![],
                    truncated: false,
                    build_time_ms: start_time.elapsed().as_millis() as u64,
                });
            }
        }

        // 生成附件
        let attachments = self.attachment_manager.generate_attachments(context);

        // 构建各个部分
        let mut parts: Vec<String> = Vec::new();

        // 1. 核心身份
        if opts.include_identity {
            parts.push(CORE_IDENTITY.to_string());
        }

        // 2. 帮助信息
        parts.push(
            "If the user asks for help or wants to give feedback inform them of the following:\n\
             - /help: Get help with using the agent\n\
             - To give feedback, users should report the issue at the project repository"
                .to_string(),
        );

        // 3. 输出风格
        parts.push(OUTPUT_STYLE.to_string());

        // 4. 任务管理
        parts.push(TASK_MANAGEMENT.to_string());

        // 5. 代码编写指南
        parts.push(CODING_GUIDELINES.to_string());

        // 6. 工具使用指南
        if opts.include_tool_guidelines {
            parts.push(TOOL_GUIDELINES.to_string());
        }

        // 7. Git 操作指南
        parts.push(GIT_GUIDELINES.to_string());

        // 8. 子代理系统
        parts.push(SUBAGENT_SYSTEM.to_string());

        // 9. 权限模式
        if opts.include_permission_mode {
            if let Some(mode) = context.permission_mode {
                let mode_str = match mode {
                    PermissionMode::Default => "default",
                    PermissionMode::AcceptEdits => "accept_edits",
                    PermissionMode::BypassPermissions => "bypass",
                    PermissionMode::Plan => "plan",
                    PermissionMode::Delegate => "delegate",
                    PermissionMode::DontAsk => "dont_ask",
                };
                parts.push(get_permission_mode_description(mode_str).to_string());
            }
        }

        // 10. 环境信息
        let env_info = EnvironmentInfo {
            working_dir: &context.working_dir.display().to_string(),
            is_git_repo: context.is_git_repo,
            platform: context.platform.as_deref().unwrap_or("unknown"),
            today_date: context.today_date.as_deref().unwrap_or("unknown"),
            model: context.model.as_deref(),
        };
        parts.push(get_environment_info(&env_info));

        // 11. 附件内容
        for attachment in &attachments {
            if !attachment.content.is_empty() {
                parts.push(attachment.content.clone());
            }
        }

        // 组装完整提示词
        let mut content = parts.join("\n\n");

        // 检查长度限制
        let mut truncated = false;
        let estimated_tokens = estimate_tokens(&content);

        if estimated_tokens > opts.max_tokens {
            // 尝试截断附件
            content = self.truncate_to_limit(&parts, &attachments, opts.max_tokens);
            truncated = true;

            // 再次检查
            let final_tokens = estimate_tokens(&content);
            if final_tokens > opts.max_tokens {
                return Err(PromptTooLongError::new(final_tokens, opts.max_tokens));
            }
        }

        // 计算哈希
        let hash_info = self.cache.compute_hash(&content);

        // 缓存结果
        if opts.enable_cache {
            let cache_key = generate_cache_key(
                &context.working_dir.display().to_string(),
                context.model.as_deref(),
                context
                    .permission_mode
                    .map(|m| format!("{:?}", m))
                    .as_deref(),
                context.plan_mode,
            );
            self.cache
                .set(cache_key, content.clone(), Some(hash_info.clone()));
        }

        let build_time_ms = start_time.elapsed().as_millis() as u64;

        if self.debug {
            eprintln!(
                "[SystemPromptBuilder] Built in {}ms, {} tokens",
                build_time_ms, hash_info.estimated_tokens
            );
        }

        Ok(BuildResult {
            content,
            hash_info,
            attachments,
            truncated,
            build_time_ms,
        })
    }

    /// 截断到限制
    fn truncate_to_limit(
        &self,
        parts: &[String],
        _attachments: &[Attachment],
        max_tokens: usize,
    ) -> String {
        // 优先保留核心部分
        let core_parts: Vec<&String> = parts.iter().take(7).collect();
        let remaining_parts: Vec<&String> = parts.iter().skip(7).collect();

        // 计算核心部分的 tokens
        let mut content = core_parts
            .iter()
            .map(|s| s.as_str())
            .collect::<Vec<_>>()
            .join("\n\n");
        let mut current_tokens = estimate_tokens(&content);

        // 添加剩余部分直到接近限制
        let reserve_tokens = max_tokens / 10; // 保留 10% 空间
        let target_tokens = max_tokens - reserve_tokens;

        for part in remaining_parts {
            let part_tokens = estimate_tokens(part);
            if current_tokens + part_tokens < target_tokens {
                content.push_str("\n\n");
                content.push_str(part);
                current_tokens += part_tokens;
            }
        }

        // 添加截断提示
        content.push_str("\n\n<system-reminder>\nSome context was truncated due to length limits. Use tools to gather additional information as needed.\n</system-reminder>");

        content
    }

    /// 获取提示词预览
    pub fn preview(&self, content: &str, max_length: usize) -> String {
        if content.len() <= max_length {
            return content.to_string();
        }
        format!(
            "{}\n... [truncated, total {} chars]",
            content.get(..max_length).unwrap_or(content),
            content.len()
        )
    }

    /// 获取调试信息
    pub fn get_debug_info(&self, result: &BuildResult) -> String {
        let mut lines = vec![
            "=== System Prompt Debug Info ===".to_string(),
            format!("Hash: {}", result.hash_info.hash),
            format!("Length: {} chars", result.hash_info.length),
            format!("Estimated Tokens: {}", result.hash_info.estimated_tokens),
            format!("Build Time: {}ms", result.build_time_ms),
            format!("Truncated: {}", result.truncated),
            format!("Attachments: {}", result.attachments.len()),
        ];

        if !result.attachments.is_empty() {
            lines.push("Attachment Details:".to_string());
            for att in &result.attachments {
                lines.push(format!(
                    "  - {:?}: {} ({} chars)",
                    att.attachment_type,
                    att.label.as_deref().unwrap_or("no label"),
                    att.content.len()
                ));
            }
        }

        lines.push("=================================".to_string());
        lines.join("\n")
    }

    /// 清除缓存
    pub fn clear_cache(&mut self) {
        self.cache.clear();
    }
}

impl Default for SystemPromptBuilder {
    fn default() -> Self {
        Self::new(false)
    }
}
