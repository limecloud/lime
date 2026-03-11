//! Skill 执行 Tauri 命令模块
//!
//! 本模块提供 Skill 执行相关的 Tauri 命令，包括：
//! - `execute_skill`: 执行指定的 Skill
//! - `list_executable_skills`: 列出所有可执行的 Skills
//! - `get_skill_detail`: 获取 Skill 详情
//!
//! ## 依赖
//! - `AsterAgentState`: Aster Agent 状态管理，提供完整的工具集支持
//! - `TauriExecutionCallback`: 执行进度回调
//! - `ProviderPoolService`: 凭证池服务
//!
//! ## Requirements
//! - 3.1: execute_skill 命令接受 skill_name 和 user_input 参数
//! - 4.1: list_executable_skills 返回所有可执行的 skills
//! - 5.1: get_skill_detail 接受 skill_name 参数

use futures::StreamExt;
use serde::{Deserialize, Serialize};
use tauri::{Emitter, State};
use uuid::Uuid;

use aster::conversation::message::Message;
use chrono::Utc;

use crate::agent::aster_state::SessionConfigBuilder;
use crate::agent::{AsterAgentState, TauriAgentEvent};
use crate::commands::api_key_provider_cmd::ApiKeyProviderServiceState;
use crate::commands::aster_agent_cmd::{
    ensure_browser_mcp_tools_registered, ensure_creation_task_tools_registered,
    ensure_social_image_tool_registered,
};
use crate::commands::skill_error::{
    format_skill_error, map_find_skill_error, SKILL_ERR_CATALOG_UNAVAILABLE,
    SKILL_ERR_EXECUTE_FAILED, SKILL_ERR_PROVIDER_UNAVAILABLE, SKILL_ERR_SESSION_INIT_FAILED,
    SKILL_ERR_STREAM_FAILED,
};
use crate::config::GlobalConfigManagerState;
use crate::database::DbConnection;
use crate::services::execution_tracker_service::{ExecutionTracker, RunFinishDecision, RunSource};
use crate::services::memory_profile_prompt_service::build_memory_profile_prompt;
use crate::skills::TauriExecutionCallback;
use proxycast_agent::event_converter::{convert_agent_event, TauriToolResult};
use proxycast_skills::{
    find_skill_by_name, get_proxycast_skills_dir, load_skills_from_directory, ExecutionCallback,
};
#[cfg(test)]
use proxycast_skills::{
    load_skill_from_file, parse_allowed_tools, parse_boolean, parse_skill_frontmatter,
};

// ============================================================================
// 公开类型定义
// ============================================================================

/// 可执行 Skill 信息
///
/// 用于 list_executable_skills 命令的返回类型
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecutableSkillInfo {
    /// Skill 名称（唯一标识）
    pub name: String,
    /// 显示名称
    pub display_name: String,
    /// Skill 描述
    pub description: String,
    /// 执行模式：prompt, workflow, agent
    pub execution_mode: String,
    /// 是否有 workflow 定义
    pub has_workflow: bool,
    /// 指定的 Provider（可选）
    pub provider: Option<String>,
    /// 指定的 Model（可选）
    pub model: Option<String>,
    /// 参数提示（可选）
    pub argument_hint: Option<String>,
}

/// Workflow 步骤信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowStepInfo {
    /// 步骤 ID
    pub id: String,
    /// 步骤名称
    pub name: String,
    /// 依赖的步骤 ID 列表
    pub dependencies: Vec<String>,
}

/// Skill 详情信息
///
/// 用于 get_skill_detail 命令的返回类型
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillDetailInfo {
    /// 基本信息
    #[serde(flatten)]
    pub basic: ExecutableSkillInfo,
    /// Markdown 内容
    pub markdown_content: String,
    /// Workflow 步骤（如果有）
    pub workflow_steps: Option<Vec<WorkflowStepInfo>>,
    /// 允许的工具列表（可选）
    pub allowed_tools: Option<Vec<String>>,
    /// 使用场景说明（可选）
    pub when_to_use: Option<String>,
}

/// 步骤执行结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StepResult {
    /// 步骤 ID
    pub step_id: String,
    /// 步骤名称
    pub step_name: String,
    /// 是否成功
    pub success: bool,
    /// 输出内容
    pub output: Option<String>,
    /// 错误信息
    pub error: Option<String>,
}

/// Skill 执行结果
///
/// 用于 execute_skill 命令的返回类型
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillExecutionResult {
    /// 是否成功
    pub success: bool,
    /// 最终输出
    pub output: Option<String>,
    /// 错误信息
    pub error: Option<String>,
    /// 已完成的步骤结果
    pub steps_completed: Vec<StepResult>,
}

const SOCIAL_POST_WITH_COVER_SKILL_NAME: &str = "social_post_with_cover";
const SOCIAL_POST_OUTPUT_DIR: &str = "social-posts";
const SOCIAL_POST_WRITE_TOOL_NAME: &str = "write_file";
const SOCIAL_POST_EMPTY_FALLBACK_CONTENT: &str = "# 社媒文案\n\n（生成结果为空，请重试。）";
const SOCIAL_POST_FALLBACK_COVER_URL: &str = "cover-generation-failed";
const SOCIAL_POST_FALLBACK_COVER_NOTE: &str = "封面图生成失败，可稍后仅重试配图。";
const SOCIAL_POST_DEFAULT_IMAGE_SIZE: &str = "1024x1024";

#[derive(Debug, Clone)]
struct SocialSkillOutputEnvelope {
    final_output: String,
    file_path: String,
    file_content: String,
}

fn infer_theme_workbench_gate_key(skill_name: &str, user_input: &str) -> &'static str {
    let probe = format!("{} {}", skill_name, user_input).to_lowercase();
    if probe.contains("publish")
        || probe.contains("adapt")
        || probe.contains("distribution")
        || probe.contains("release")
        || probe.contains("发布")
        || probe.contains("分发")
        || probe.contains("平台适配")
    {
        return "publish_confirm";
    }
    if probe.contains("topic")
        || probe.contains("research")
        || probe.contains("trend")
        || probe.contains("idea")
        || probe.contains("选题")
        || probe.contains("方向")
        || probe.contains("调研")
        || probe.contains("洞察")
    {
        return "topic_select";
    }
    "write_mode"
}

fn normalize_social_post_output(
    skill_name: &str,
    user_input: &str,
    execution_id: &str,
    raw_output: &str,
) -> Option<SocialSkillOutputEnvelope> {
    if skill_name != SOCIAL_POST_WITH_COVER_SKILL_NAME {
        return None;
    }

    let generated_path = build_social_post_file_path(user_input, execution_id);
    if let Some((range, existing_path, content)) = extract_first_write_file_block(raw_output) {
        let normalized_content = normalize_social_markdown_contract(&content);
        let has_existing_path = existing_path.is_some();
        let path = existing_path.unwrap_or_else(|| generated_path.clone());

        if has_existing_path {
            if normalized_content != content {
                let normalized_block = build_write_file_block(&path, &normalized_content);
                let mut rebuilt = String::new();
                rebuilt.push_str(&raw_output[..range.start]);
                rebuilt.push_str(&normalized_block);
                rebuilt.push_str(&raw_output[range.end..]);
                return Some(SocialSkillOutputEnvelope {
                    final_output: rebuilt,
                    file_path: path,
                    file_content: normalized_content,
                });
            }
            return Some(SocialSkillOutputEnvelope {
                final_output: raw_output.to_string(),
                file_path: path,
                file_content: normalized_content,
            });
        }

        let normalized_block = build_write_file_block(&path, &normalized_content);
        let mut rebuilt = String::new();
        rebuilt.push_str(&raw_output[..range.start]);
        rebuilt.push_str(&normalized_block);
        rebuilt.push_str(&raw_output[range.end..]);

        return Some(SocialSkillOutputEnvelope {
            final_output: rebuilt,
            file_path: path,
            file_content: normalized_content,
        });
    }

    let normalized_content = normalize_social_markdown_contract(raw_output);
    Some(SocialSkillOutputEnvelope {
        final_output: build_write_file_block(&generated_path, &normalized_content),
        file_path: generated_path,
        file_content: normalized_content,
    })
}

fn extract_first_write_file_block(
    raw_output: &str,
) -> Option<(std::ops::Range<usize>, Option<String>, String)> {
    let open_start = raw_output.find("<write_file")?;
    let open_end_offset = raw_output[open_start..].find('>')?;
    let open_end = open_start + open_end_offset;
    let open_tag = &raw_output[open_start..=open_end];

    let content_start = open_end + 1;
    let close_tag = "</write_file>";
    let close_offset = raw_output[content_start..].find(close_tag)?;
    let close_start = content_start + close_offset;
    let block_end = close_start + close_tag.len();

    let content = raw_output[content_start..close_start].trim().to_string();
    let path = extract_write_file_path(open_tag);
    Some((open_start..block_end, path, content))
}

fn extract_write_file_path(open_tag: &str) -> Option<String> {
    let path_idx = open_tag.find("path")?;
    let after_path = &open_tag[path_idx + "path".len()..];
    let equal_idx = after_path.find('=')?;
    let value = after_path[equal_idx + 1..].trim_start();
    let quote = value.chars().next()?;
    if quote != '"' && quote != '\'' {
        return None;
    }

    let rest = &value[quote.len_utf8()..];
    let end_idx = rest.find(quote)?;
    let path = rest[..end_idx].trim();
    if path.is_empty() {
        None
    } else {
        Some(path.to_string())
    }
}

fn normalize_social_output_content(content: &str) -> String {
    let trimmed = content.trim();
    if trimmed.is_empty() {
        SOCIAL_POST_EMPTY_FALLBACK_CONTENT.to_string()
    } else {
        trimmed.to_string()
    }
}

fn normalize_social_markdown_contract(content: &str) -> String {
    let mut normalized = normalize_social_output_content(content);
    if !normalized.contains("![封面图](") {
        normalized = format!("{normalized}\n\n![封面图]({SOCIAL_POST_FALLBACK_COVER_URL})");
    }
    normalized
}

fn extract_cover_url_from_markdown(content: &str) -> Option<String> {
    for line in content.lines() {
        let trimmed = line.trim();
        if !trimmed.starts_with("![") {
            continue;
        }
        let open = trimmed.find("](")?;
        let close = trimmed.rfind(')')?;
        if close <= open + 2 {
            continue;
        }
        let url = trimmed[(open + 2)..close].trim();
        if !url.is_empty() {
            return Some(url.to_string());
        }
    }
    None
}

fn extract_detail_value(content: &str, label: &str) -> Option<String> {
    let probe = format!("- {label}：");
    for line in content.lines() {
        let trimmed = line.trim();
        if let Some(value) = trimmed.strip_prefix(&probe) {
            let value = value.trim();
            if !value.is_empty() {
                return Some(value.to_string());
            }
        }
    }
    None
}

fn derive_social_auxiliary_paths(article_path: &str) -> (String, String) {
    let base = article_path.strip_suffix(".md").unwrap_or(article_path);
    (
        format!("{base}.cover.json"),
        format!("{base}.publish-pack.json"),
    )
}

fn collect_social_artifact_paths_from_output(output: Option<&str>) -> Vec<String> {
    let Some(raw_output) = output else {
        return Vec::new();
    };
    let Some((_, maybe_path, _)) = extract_first_write_file_block(raw_output) else {
        return Vec::new();
    };
    let Some(article_path) = maybe_path else {
        return Vec::new();
    };
    let (cover_meta_path, publish_pack_path) = derive_social_auxiliary_paths(&article_path);
    vec![article_path, cover_meta_path, publish_pack_path]
}

fn summarize_social_content(content: &str) -> String {
    let compact = content
        .lines()
        .filter(|line| !line.trim().starts_with('#'))
        .collect::<Vec<_>>()
        .join(" ");
    let compact = compact.split_whitespace().collect::<Vec<_>>().join(" ");
    compact.chars().take(180).collect()
}

fn build_social_auxiliary_file_payloads(
    execution_id: &str,
    user_input: &str,
    article_path: &str,
    article_content: &str,
) -> Vec<(String, String)> {
    let (cover_meta_path, publish_pack_path) = derive_social_auxiliary_paths(article_path);
    let cover_url = extract_cover_url_from_markdown(article_content)
        .unwrap_or_else(|| SOCIAL_POST_FALLBACK_COVER_URL.to_string());
    let cover_prompt =
        extract_detail_value(article_content, "提示词").unwrap_or_else(|| "未提供".to_string());
    let cover_size = extract_detail_value(article_content, "尺寸")
        .unwrap_or_else(|| SOCIAL_POST_DEFAULT_IMAGE_SIZE.to_string());
    let cover_status = extract_detail_value(article_content, "状态").unwrap_or_else(|| {
        if cover_url == SOCIAL_POST_FALLBACK_COVER_URL {
            "失败".to_string()
        } else {
            "成功".to_string()
        }
    });
    let cover_remark = extract_detail_value(article_content, "备注").unwrap_or_else(|| {
        if cover_status == "失败" {
            SOCIAL_POST_FALLBACK_COVER_NOTE.to_string()
        } else {
            "".to_string()
        }
    });

    let cover_meta = serde_json::json!({
        "execution_id": execution_id,
        "article_path": article_path,
        "cover_url": cover_url,
        "prompt": cover_prompt,
        "size": cover_size,
        "status": cover_status,
        "remark": cover_remark,
        "generated_at": Utc::now().to_rfc3339(),
    });

    let publish_pack = serde_json::json!({
        "execution_id": execution_id,
        "pipeline": ["topic_select", "write_mode", "publish_confirm"],
        "article_path": article_path,
        "cover_meta_path": cover_meta_path,
        "source_input": user_input,
        "recommended_channels": ["xiaohongshu", "wechat"],
        "summary": summarize_social_content(article_content),
        "generated_at": Utc::now().to_rfc3339(),
    });

    vec![
        (
            cover_meta_path,
            serde_json::to_string_pretty(&cover_meta).unwrap_or_else(|_| cover_meta.to_string()),
        ),
        (
            publish_pack_path,
            serde_json::to_string_pretty(&publish_pack)
                .unwrap_or_else(|_| publish_pack.to_string()),
        ),
    ]
}

fn build_write_file_block(file_path: &str, file_content: &str) -> String {
    format!("<write_file path=\"{file_path}\">\n{file_content}\n</write_file>")
}

fn build_social_post_file_path(user_input: &str, execution_id: &str) -> String {
    let timestamp = Utc::now().format("%Y%m%d-%H%M%S");
    let slug = build_social_post_slug(user_input);
    let suffix = build_execution_suffix(execution_id);
    format!("{SOCIAL_POST_OUTPUT_DIR}/{timestamp}-{slug}-{suffix}.md")
}

fn build_social_post_slug(user_input: &str) -> String {
    let mut normalized = String::new();
    let mut last_was_dash = false;

    for ch in user_input.chars() {
        if ch.is_ascii_alphanumeric() {
            normalized.push(ch.to_ascii_lowercase());
            last_was_dash = false;
            continue;
        }

        if !last_was_dash {
            normalized.push('-');
            last_was_dash = true;
        }
    }

    let trimmed = normalized.trim_matches('-');
    let truncated: String = trimmed.chars().take(24).collect();
    if truncated.is_empty() {
        "post".to_string()
    } else {
        truncated
    }
}

fn build_execution_suffix(execution_id: &str) -> String {
    let normalized: String = execution_id
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric())
        .take(6)
        .collect();
    if normalized.is_empty() {
        "run".to_string()
    } else {
        normalized.to_ascii_lowercase()
    }
}

fn build_social_tool_event_id(execution_id: &str, file_path: &str) -> String {
    let mut hash: u32 = 0x811c9dc5;
    for byte in file_path.as_bytes() {
        hash ^= u32::from(*byte);
        hash = hash.wrapping_mul(0x01000193);
    }
    format!("social-write-{execution_id}-{hash:08x}")
}

fn emit_social_write_file_events(
    app_handle: &tauri::AppHandle,
    execution_id: &str,
    file_path: &str,
    file_content: &str,
) {
    let event_name = format!("skill-exec-{execution_id}");
    let tool_id = build_social_tool_event_id(execution_id, file_path);
    let arguments = serde_json::json!({
        "path": file_path,
        "content": file_content,
    })
    .to_string();

    let tool_start = TauriAgentEvent::ToolStart {
        tool_name: SOCIAL_POST_WRITE_TOOL_NAME.to_string(),
        tool_id: tool_id.clone(),
        arguments: Some(arguments),
    };
    if let Err(err) = app_handle.emit(&event_name, &tool_start) {
        tracing::warn!("[execute_skill] 发送社媒写入工具开始事件失败: {}", err);
    }

    let tool_end = TauriAgentEvent::ToolEnd {
        tool_id,
        result: TauriToolResult {
            success: true,
            output: format!("写入社媒文稿: {file_path}"),
            error: None,
            images: None,
            metadata: None,
        },
    };
    if let Err(err) = app_handle.emit(&event_name, &tool_end) {
        tracing::warn!("[execute_skill] 发送社媒写入工具完成事件失败: {}", err);
    }
}

/// 执行 Skill
///
/// 加载并执行指定的 Skill，使用 Aster Agent 系统提供完整的工具集支持。
///
/// # Arguments
/// * `app_handle` - Tauri AppHandle，用于发送事件
/// * `db` - 数据库连接
/// * `aster_state` - Aster Agent 状态
/// * `skill_name` - Skill 名称
/// * `user_input` - 用户输入
/// * `provider_override` - 可选的 Provider 覆盖
/// * `session_id` - 可选的会话 ID（用于复用当前聊天上下文）
///
/// # Returns
/// * `Ok(SkillExecutionResult)` - 执行结果
/// * `Err(String)` - 错误信息
///
/// # Requirements
/// - 3.1: 接受 skill_name 和 user_input 参数
/// - 3.2: 从 registry 加载 skill
/// - 3.3: 使用 Aster Agent 执行（支持工具调用）
/// - 3.5: 返回 SkillExecutionResult
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn execute_skill(
    app_handle: tauri::AppHandle,
    db: State<'_, DbConnection>,
    api_key_provider_service: State<'_, ApiKeyProviderServiceState>,
    config_manager: State<'_, GlobalConfigManagerState>,
    aster_state: State<'_, AsterAgentState>,
    skill_name: String,
    user_input: String,
    provider_override: Option<String>,
    model_override: Option<String>,
    execution_id: Option<String>,
    session_id: Option<String>,
) -> Result<SkillExecutionResult, String> {
    // 生成执行 ID，并优先复用前端会话 ID（提升 /skill 与主会话上下文一致性）
    let execution_id = execution_id.unwrap_or_else(|| Uuid::new_v4().to_string());
    let session_id = session_id.unwrap_or_else(|| format!("skill-exec-{}", Uuid::new_v4()));
    let inferred_gate_key =
        infer_theme_workbench_gate_key(skill_name.as_str(), user_input.as_str());
    let memory_profile_prompt = build_memory_profile_prompt(&config_manager.config());
    let tracker = ExecutionTracker::new(db.inner().clone());

    tracker
        .with_run_custom(
            RunSource::Skill,
            Some(skill_name.clone()),
            Some(session_id.clone()),
            Some(serde_json::json!({
                "execution_id": execution_id.clone(),
                "skill_name": skill_name.clone(),
                "gate_key": inferred_gate_key,
                "provider_override": provider_override.clone(),
                "model_override": model_override.clone(),
            })),
            async {
        tracing::info!(
            "[execute_skill] 开始执行 Skill: name={}, execution_id={}, session_id={}, provider_override={:?}, model_override={:?}",
            skill_name,
            execution_id,
            session_id,
            provider_override,
            model_override
        );

        // 1. 从 registry 加载 skill（Requirements 3.2）
        let skill = find_skill_by_name(&skill_name).map_err(map_find_skill_error)?;

        // 检查是否禁用了模型调用
        if skill.disable_model_invocation {
            return Err(format_skill_error(
                SKILL_ERR_EXECUTE_FAILED,
                format!("Skill '{skill_name}' 已禁用模型调用，无法执行"),
            ));
        }

        // 2. 创建 TauriExecutionCallback
        let callback = TauriExecutionCallback::new(app_handle.clone(), execution_id.clone());

        // 3. 初始化 Agent（如果未初始化）
        if !aster_state.is_initialized().await {
            tracing::info!("[execute_skill] Agent 未初始化，开始初始化...");
            aster_state.init_agent_with_db(&db).await.map_err(|e| {
                format_skill_error(
                    SKILL_ERR_SESSION_INIT_FAILED,
                    format!("初始化 Agent 失败: {e}"),
                )
            })?;
            tracing::info!("[execute_skill] Agent 初始化完成");
        }
        ensure_browser_mcp_tools_registered(aster_state.inner())
            .await
            .map_err(|e| {
                format_skill_error(
                    SKILL_ERR_SESSION_INIT_FAILED,
                    format!("注册浏览器工具失败: {e}"),
                )
            })?;
        ensure_social_image_tool_registered(aster_state.inner(), config_manager.inner())
            .await
            .map_err(|e| {
                format_skill_error(
                    SKILL_ERR_SESSION_INIT_FAILED,
                    format!("注册社媒生图工具失败: {e}"),
                )
            })?;
        ensure_creation_task_tools_registered(
            aster_state.inner(),
            db.inner(),
            api_key_provider_service.inner(),
            &app_handle,
        )
        .await
        .map_err(|e| {
            format_skill_error(
                SKILL_ERR_SESSION_INIT_FAILED,
                format!("注册创作任务工具失败: {e}"),
            )
        })?;

        // 4. 配置 Provider（从凭证池选择，支持 fallback）
        let preferred_provider = provider_override
            .clone()
            .or_else(|| skill.provider.clone())
            .unwrap_or_else(|| "anthropic".to_string());

        let preferred_model = model_override
            .clone()
            .or_else(|| skill.model.clone())
            .unwrap_or_else(|| "claude-sonnet-4-20250514".to_string());

        // 支持工具调用的 Provider fallback 列表
        // 注意：provider 名称需要与 ProviderType::FromStr 匹配
        let fallback_providers: Vec<(&str, &str)> = vec![
            ("anthropic", "claude-sonnet-4-20250514"),
            ("openai", "gpt-4o"),
            ("gemini", "gemini-2.0-flash"),
        ];

        let mut configure_result = aster_state
            .configure_provider_from_pool(&db, &preferred_provider, &preferred_model, &session_id)
            .await;

        if configure_result.is_err() {
            tracing::warn!(
                "[execute_skill] 首选 Provider {} 配置失败: {:?}，尝试 fallback",
                preferred_provider,
                configure_result.as_ref().err()
            );

            for (fb_provider, fb_model) in &fallback_providers {
                if *fb_provider == preferred_provider {
                    continue;
                }
                match aster_state
                    .configure_provider_from_pool(&db, fb_provider, fb_model, &session_id)
                    .await
                {
                    Ok(config) => {
                        tracing::info!(
                            "[execute_skill] Fallback 到 {} / {} 成功",
                            fb_provider,
                            fb_model
                        );
                        configure_result = Ok(config);
                        break;
                    }
                    Err(e) => {
                        tracing::warn!("[execute_skill] Fallback {} 也失败: {}", fb_provider, e);
                    }
                }
            }
        }

        let configured_provider = configure_result.map_err(|e| {
            format_skill_error(
                SKILL_ERR_PROVIDER_UNAVAILABLE,
                format!(
                    "无法配置任何可用的 Provider（需要支持工具调用的 Provider，如 Anthropic、OpenAI 或 Google）: {e}"
                ),
            )
        })?;

        let resolved_provider = configured_provider.provider_name.clone();
        let resolved_model = configured_provider.model_name.clone();

        tracing::info!(
            "[execute_skill] Provider 配置成功: requested={} / {}, resolved={} / {}",
            preferred_provider,
            preferred_model,
            resolved_provider,
            resolved_model
        );

        // 5. 根据 execution_mode 分支执行
        if skill.execution_mode == "workflow" && !skill.workflow_steps.is_empty() {
            // ========== Workflow 模式：按步骤顺序执行 ==========
            execute_skill_workflow(
                &app_handle,
                &aster_state,
                &skill,
                &user_input,
                &execution_id,
                &session_id,
                &callback,
                memory_profile_prompt.as_deref(),
            )
            .await
        } else {
            // ========== Prompt 模式：单次执行 ==========
            execute_skill_prompt(
                &app_handle,
                &aster_state,
                &skill,
                &user_input,
                &execution_id,
                &session_id,
                &callback,
                memory_profile_prompt.as_deref(),
            )
            .await
        }
            },
            |result| match result {
                Ok(exec_result) if exec_result.success => {
                    let artifact_paths = if skill_name == SOCIAL_POST_WITH_COVER_SKILL_NAME {
                        collect_social_artifact_paths_from_output(exec_result.output.as_deref())
                    } else {
                        Vec::new()
                    };
                    let metadata = if skill_name == SOCIAL_POST_WITH_COVER_SKILL_NAME {
                        serde_json::json!({
                            "skill_name": skill_name,
                            "execution_id": execution_id,
                            "workflow": "social_content_pipeline_v1",
                            "version_id": execution_id,
                            "stages": ["topic_select", "write_mode", "publish_confirm"],
                            "artifact_paths": artifact_paths,
                            "provider_override": provider_override,
                            "model_override": model_override,
                            "requested_provider": provider_override,
                            "requested_model": model_override,
                        })
                    } else {
                        serde_json::json!({
                            "skill_name": skill_name,
                            "execution_id": execution_id,
                            "provider_override": provider_override,
                            "model_override": model_override,
                            "requested_provider": provider_override,
                            "requested_model": model_override,
                        })
                    };
                    RunFinishDecision {
                        status: crate::database::dao::agent_run::AgentRunStatus::Success,
                        error_code: None,
                        error_message: None,
                        metadata: Some(metadata),
                    }
                }
                Ok(exec_result) => RunFinishDecision {
                    status: crate::database::dao::agent_run::AgentRunStatus::Error,
                    error_code: Some("skill_execute_failed".to_string()),
                    error_message: exec_result.error.clone(),
                    metadata: Some(serde_json::json!({
                        "skill_name": skill_name,
                        "execution_id": execution_id,
                        "success": false,
                        "provider_override": provider_override,
                        "model_override": model_override,
                        "requested_provider": provider_override,
                        "requested_model": model_override,
                    })),
                },
                Err(err) => RunFinishDecision {
                    status: crate::database::dao::agent_run::AgentRunStatus::Error,
                    error_code: Some("skill_execute_failed".to_string()),
                    error_message: Some(err.clone()),
                    metadata: Some(serde_json::json!({
                        "skill_name": skill_name,
                        "execution_id": execution_id,
                        "provider_override": provider_override,
                        "model_override": model_override,
                        "requested_provider": provider_override,
                        "requested_model": model_override,
                    })),
                },
            },
        )
        .await
}

/// Prompt 模式执行（单步）
async fn execute_skill_prompt(
    app_handle: &tauri::AppHandle,
    aster_state: &AsterAgentState,
    skill: &proxycast_skills::LoadedSkillDefinition,
    user_input: &str,
    execution_id: &str,
    session_id: &str,
    callback: &TauriExecutionCallback,
    memory_profile_prompt: Option<&str>,
) -> Result<SkillExecutionResult, String> {
    // 发送步骤开始事件
    callback.on_step_start("main", &skill.display_name, 1, 1);

    // 构建 SessionConfig
    let mut combined_prompt = skill.markdown_content.clone();
    if let Some(memory_prompt) = memory_profile_prompt {
        combined_prompt = format!("{combined_prompt}\n\n{memory_prompt}");
    }

    let session_config = SessionConfigBuilder::new(session_id)
        .system_prompt(combined_prompt)
        .include_context_trace(true)
        .build();

    let user_message = Message::user().with_text(user_input);

    // 获取 Agent 并执行
    let agent_arc = aster_state.get_agent_arc();
    let guard = agent_arc.read().await;
    let agent = guard.as_ref().ok_or_else(|| {
        format_skill_error(SKILL_ERR_SESSION_INIT_FAILED, "Agent not initialized")
    })?;

    let cancel_token = aster_state.create_cancel_token(session_id).await;
    let stream_result = agent
        .reply(user_message, session_config, Some(cancel_token.clone()))
        .await;

    let mut final_output = String::new();
    let mut has_error = false;
    let mut error_message: Option<String> = None;
    let event_name = format!("skill-exec-{execution_id}");

    match stream_result {
        Ok(mut stream) => {
            while let Some(event_result) = stream.next().await {
                match event_result {
                    Ok(agent_event) => {
                        let tauri_events = convert_agent_event(agent_event);
                        for tauri_event in tauri_events {
                            if let TauriAgentEvent::TextDelta { ref text } = tauri_event {
                                final_output.push_str(text);
                            }
                            if let Err(e) = app_handle.emit(&event_name, &tauri_event) {
                                tracing::error!("[execute_skill] 发送事件失败: {}", e);
                            }
                        }
                    }
                    Err(e) => {
                        has_error = true;
                        error_message = Some(format_skill_error(
                            SKILL_ERR_STREAM_FAILED,
                            format!("Stream error: {e}"),
                        ));
                        tracing::error!("[execute_skill] 流处理错误: {}", e);
                    }
                }
            }

            let done_event = TauriAgentEvent::FinalDone { usage: None };
            if let Err(e) = app_handle.emit(&event_name, &done_event) {
                tracing::error!("[execute_skill] 发送完成事件失败: {}", e);
            }
        }
        Err(e) => {
            has_error = true;
            error_message = Some(format_skill_error(
                SKILL_ERR_STREAM_FAILED,
                format!("Agent error: {e}"),
            ));
            tracing::error!("[execute_skill] Agent 错误: {}", e);
        }
    }

    aster_state.remove_cancel_token(session_id).await;

    if has_error {
        let err_msg = error_message
            .unwrap_or_else(|| format_skill_error(SKILL_ERR_EXECUTE_FAILED, "Unknown error"));
        callback.on_step_error("main", &err_msg, false);
        callback.on_complete(false, None, Some(&err_msg));

        Ok(SkillExecutionResult {
            success: false,
            output: None,
            error: Some(err_msg.clone()),
            steps_completed: vec![StepResult {
                step_id: "main".to_string(),
                step_name: skill.display_name.clone(),
                success: false,
                output: None,
                error: Some(err_msg),
            }],
        })
    } else {
        let normalized_output = normalize_social_post_output(
            &skill.skill_name,
            user_input,
            execution_id,
            &final_output,
        );
        let output_for_return = if let Some(ref social_output) = normalized_output {
            emit_social_write_file_events(
                app_handle,
                execution_id,
                &social_output.file_path,
                &social_output.file_content,
            );
            for (artifact_path, artifact_content) in build_social_auxiliary_file_payloads(
                execution_id,
                user_input,
                &social_output.file_path,
                &social_output.file_content,
            ) {
                emit_social_write_file_events(
                    app_handle,
                    execution_id,
                    &artifact_path,
                    &artifact_content,
                );
            }
            social_output.final_output.clone()
        } else {
            final_output.clone()
        };

        callback.on_step_complete("main", &output_for_return);
        callback.on_complete(true, Some(&output_for_return), None);

        Ok(SkillExecutionResult {
            success: true,
            output: Some(output_for_return.clone()),
            error: None,
            steps_completed: vec![StepResult {
                step_id: "main".to_string(),
                step_name: skill.display_name.clone(),
                success: true,
                output: Some(output_for_return),
                error: None,
            }],
        })
    }
}

/// Workflow 模式执行（多步骤顺序执行）
async fn execute_skill_workflow(
    app_handle: &tauri::AppHandle,
    aster_state: &AsterAgentState,
    skill: &proxycast_skills::LoadedSkillDefinition,
    user_input: &str,
    execution_id: &str,
    session_id: &str,
    callback: &TauriExecutionCallback,
    memory_profile_prompt: Option<&str>,
) -> Result<SkillExecutionResult, String> {
    let steps = &skill.workflow_steps;
    let total_steps = steps.len();
    let event_name = format!("skill-exec-{execution_id}");
    let mut steps_completed = Vec::new();
    let mut accumulated_context = user_input.to_string();
    let mut final_output = String::new();

    tracing::info!(
        "[execute_skill_workflow] 开始 workflow 执行: steps={}, skill={}",
        total_steps,
        skill.skill_name
    );

    for (idx, step) in steps.iter().enumerate() {
        let step_num = idx + 1;

        // 发送步骤开始事件
        callback.on_step_start(&step.id, &step.name, step_num, total_steps);

        tracing::info!(
            "[execute_skill_workflow] 执行步骤 {}/{}: id={}, name={}",
            step_num,
            total_steps,
            step.id,
            step.name
        );

        // 构建该步骤的 system_prompt：基础 skill prompt + 步骤 prompt
        let step_system_prompt = format!(
            "{}\n\n---\n\n## 当前步骤: {} ({}/{})\n\n{}",
            skill.markdown_content, step.name, step_num, total_steps, step.prompt
        );

        let step_prompt_with_memory = if let Some(memory_prompt) = memory_profile_prompt {
            format!("{step_system_prompt}\n\n{memory_prompt}")
        } else {
            step_system_prompt
        };

        let step_session_id = format!("{}-step-{}", session_id, step.id);
        let session_config = SessionConfigBuilder::new(&step_session_id)
            .system_prompt(step_prompt_with_memory)
            .include_context_trace(true)
            .build();

        // 用户消息 = 原始输入 + 前序步骤的累积上下文
        let step_input = if idx == 0 {
            accumulated_context.clone()
        } else {
            format!("原始需求：{user_input}\n\n前序步骤输出：\n{accumulated_context}")
        };

        let user_message = Message::user().with_text(&step_input);

        // 获取 Agent 并执行
        let agent_arc = aster_state.get_agent_arc();
        let guard = agent_arc.read().await;
        let agent = guard.as_ref().ok_or_else(|| {
            format_skill_error(SKILL_ERR_SESSION_INIT_FAILED, "Agent not initialized")
        })?;

        let cancel_token = aster_state.create_cancel_token(&step_session_id).await;
        let stream_result = agent
            .reply(user_message, session_config, Some(cancel_token.clone()))
            .await;

        let mut step_output = String::new();
        let mut step_error: Option<String> = None;

        match stream_result {
            Ok(mut stream) => {
                while let Some(event_result) = stream.next().await {
                    match event_result {
                        Ok(agent_event) => {
                            let tauri_events = convert_agent_event(agent_event);
                            for tauri_event in tauri_events {
                                if let TauriAgentEvent::TextDelta { ref text } = tauri_event {
                                    step_output.push_str(text);
                                }
                                if let Err(e) = app_handle.emit(&event_name, &tauri_event) {
                                    tracing::error!("[execute_skill_workflow] 发送事件失败: {}", e);
                                }
                            }
                        }
                        Err(e) => {
                            step_error = Some(format!("Stream error: {e}"));
                            tracing::error!(
                                "[execute_skill_workflow] 步骤 {} 流处理错误: {}",
                                step.id,
                                e
                            );
                            break;
                        }
                    }
                }
            }
            Err(e) => {
                step_error = Some(format!("Agent error: {e}"));
                tracing::error!(
                    "[execute_skill_workflow] 步骤 {} Agent 错误: {}",
                    step.id,
                    e
                );
            }
        }

        aster_state.remove_cancel_token(&step_session_id).await;

        if let Some(err) = &step_error {
            callback.on_step_error(&step.id, err, false);
            steps_completed.push(StepResult {
                step_id: step.id.clone(),
                step_name: step.name.clone(),
                success: false,
                output: None,
                error: Some(err.clone()),
            });

            // 步骤失败，终止 workflow
            let err_msg = format_skill_error(
                SKILL_ERR_EXECUTE_FAILED,
                format!("步骤 '{}' 执行失败: {}", step.name, err),
            );
            callback.on_complete(false, None, Some(&err_msg));

            let done_event = TauriAgentEvent::FinalDone { usage: None };
            let _ = app_handle.emit(&event_name, &done_event);

            return Ok(SkillExecutionResult {
                success: false,
                output: None,
                error: Some(err_msg),
                steps_completed,
            });
        }

        // 步骤成功
        callback.on_step_complete(&step.id, &step_output);
        steps_completed.push(StepResult {
            step_id: step.id.clone(),
            step_name: step.name.clone(),
            success: true,
            output: Some(step_output.clone()),
            error: None,
        });

        // 累积上下文供下一步使用
        accumulated_context = step_output.clone();
        final_output = step_output;
    }

    // 所有步骤完成
    callback.on_complete(true, Some(&final_output), None);

    let done_event = TauriAgentEvent::FinalDone { usage: None };
    let _ = app_handle.emit(&event_name, &done_event);

    tracing::info!(
        "[execute_skill_workflow] Workflow 执行完成: skill={}, steps_completed={}",
        skill.skill_name,
        steps_completed.len()
    );

    Ok(SkillExecutionResult {
        success: true,
        output: Some(final_output),
        error: None,
        steps_completed,
    })
}

/// 列出可执行的 Skills
///
/// 返回所有可以执行的 Skills 列表，过滤掉 disable_model_invocation=true 的 Skills。
///
/// # Returns
/// * `Ok(Vec<ExecutableSkillInfo>)` - 可执行的 Skills 列表
/// * `Err(String)` - 错误信息
///
/// # Requirements
/// - 4.1: 返回所有可执行的 skills
/// - 4.2: 包含 name, description, execution_mode
/// - 4.3: 指示是否有 workflow 定义
/// - 4.4: 过滤 disable_model_invocation=true 的 skills
#[tauri::command]
pub async fn list_executable_skills() -> Result<Vec<ExecutableSkillInfo>, String> {
    let skills_dir = get_proxycast_skills_dir()
        .ok_or_else(|| format_skill_error(SKILL_ERR_CATALOG_UNAVAILABLE, "无法获取 Skills 目录"))?;

    // 加载所有 skills
    let all_skills = load_skills_from_directory(&skills_dir);

    // 过滤掉 disable_model_invocation=true 的 skills（Requirements 4.4）
    let executable_skills: Vec<ExecutableSkillInfo> = all_skills
        .into_iter()
        .filter(|s| !s.disable_model_invocation)
        .map(|s| ExecutableSkillInfo {
            name: s.skill_name,
            display_name: s.display_name,
            description: s.description,
            execution_mode: s.execution_mode.clone(),
            has_workflow: s.execution_mode == "workflow",
            provider: s.provider,
            model: s.model,
            argument_hint: s.argument_hint,
        })
        .collect();

    tracing::info!(
        "[list_executable_skills] 返回 {} 个可执行 Skills",
        executable_skills.len()
    );

    Ok(executable_skills)
}

/// 获取 Skill 详情
///
/// 根据 skill_name 返回完整的 Skill 详情信息。
///
/// # Arguments
/// * `skill_name` - Skill 名称
///
/// # Returns
/// * `Ok(SkillDetailInfo)` - Skill 详情
/// * `Err(String)` - 错误信息（如 skill 不存在）
///
/// # Requirements
/// - 5.1: 接受 skill_name 参数
/// - 5.2: 返回完整的 SkillDefinition
/// - 5.3: 包含 workflow steps 信息（如果有）
/// - 5.4: skill 不存在时返回错误
#[tauri::command]
pub async fn get_skill_detail(skill_name: String) -> Result<SkillDetailInfo, String> {
    // 查找 skill（Requirements 5.1, 5.4）
    let skill = find_skill_by_name(&skill_name).map_err(map_find_skill_error)?;

    // 转换为 SkillDetailInfo（Requirements 5.2, 5.3）
    let detail = SkillDetailInfo {
        basic: ExecutableSkillInfo {
            name: skill.skill_name,
            display_name: skill.display_name,
            description: skill.description,
            execution_mode: skill.execution_mode.clone(),
            has_workflow: skill.execution_mode == "workflow",
            provider: skill.provider,
            model: skill.model,
            argument_hint: skill.argument_hint,
        },
        markdown_content: skill.markdown_content,
        workflow_steps: if skill.workflow_steps.is_empty() {
            None
        } else {
            Some(
                skill
                    .workflow_steps
                    .iter()
                    .map(|s| WorkflowStepInfo {
                        id: s.id.clone(),
                        name: s.name.clone(),
                        dependencies: Vec::new(),
                    })
                    .collect(),
            )
        },
        allowed_tools: skill.allowed_tools,
        when_to_use: skill.when_to_use,
    };

    tracing::info!("[get_skill_detail] 返回 Skill 详情: name={}", skill_name);

    Ok(detail)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_executable_skill_info_serialization() {
        let info = ExecutableSkillInfo {
            name: "test-skill".to_string(),
            display_name: "Test Skill".to_string(),
            description: "A test skill".to_string(),
            execution_mode: "prompt".to_string(),
            has_workflow: false,
            provider: None,
            model: None,
            argument_hint: Some("Enter your query".to_string()),
        };

        let json = serde_json::to_string(&info).unwrap();
        assert!(json.contains("test-skill"));
        assert!(json.contains("Test Skill"));
    }

    #[test]
    fn test_skill_execution_result_serialization() {
        let result = SkillExecutionResult {
            success: true,
            output: Some("Hello, world!".to_string()),
            error: None,
            steps_completed: vec![StepResult {
                step_id: "step-1".to_string(),
                step_name: "Process".to_string(),
                success: true,
                output: Some("Done".to_string()),
                error: None,
            }],
        };

        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("\"success\":true"));
        assert!(json.contains("Hello, world!"));
        assert!(json.contains("step-1"));
    }

    #[test]
    fn test_skill_detail_info_serialization() {
        let detail = SkillDetailInfo {
            basic: ExecutableSkillInfo {
                name: "workflow-skill".to_string(),
                display_name: "Workflow Skill".to_string(),
                description: "A workflow skill".to_string(),
                execution_mode: "workflow".to_string(),
                has_workflow: true,
                provider: Some("claude".to_string()),
                model: Some("claude-sonnet-4-5-20250514".to_string()),
                argument_hint: None,
            },
            markdown_content: "# Workflow Skill\n\nThis is a workflow skill.".to_string(),
            workflow_steps: Some(vec![
                WorkflowStepInfo {
                    id: "step-1".to_string(),
                    name: "Initialize".to_string(),
                    dependencies: vec![],
                },
                WorkflowStepInfo {
                    id: "step-2".to_string(),
                    name: "Process".to_string(),
                    dependencies: vec!["step-1".to_string()],
                },
            ]),
            allowed_tools: Some(vec!["read_file".to_string(), "write_file".to_string()]),
            when_to_use: Some("Use this skill for complex workflows".to_string()),
        };

        let json = serde_json::to_string(&detail).unwrap();
        assert!(json.contains("workflow-skill"));
        assert!(json.contains("workflow_steps"));
        assert!(json.contains("step-1"));
        assert!(json.contains("step-2"));
    }

    #[test]
    fn test_parse_skill_frontmatter_basic() {
        let content = r#"---
name: test-skill
description: A test skill
model: claude-sonnet-4-5-20250514
provider: claude
---

# Test Skill

This is the body content.
"#;
        let (fm, body) = parse_skill_frontmatter(content);
        assert_eq!(fm.name, Some("test-skill".to_string()));
        assert_eq!(fm.description, Some("A test skill".to_string()));
        assert_eq!(fm.model, Some("claude-sonnet-4-5-20250514".to_string()));
        assert_eq!(fm.provider, Some("claude".to_string()));
        assert!(body.contains("# Test Skill"));
        assert!(body.contains("This is the body content."));
    }

    #[test]
    fn test_parse_skill_frontmatter_no_frontmatter() {
        let content = "# Just content\nNo frontmatter here.";
        let (fm, body) = parse_skill_frontmatter(content);
        assert!(fm.name.is_none());
        assert_eq!(body, content);
    }

    #[test]
    fn test_parse_skill_frontmatter_with_quotes() {
        let content = r#"---
name: "quoted-name"
description: 'single quoted'
---
Body
"#;
        let (fm, _) = parse_skill_frontmatter(content);
        assert_eq!(fm.name, Some("quoted-name".to_string()));
        assert_eq!(fm.description, Some("single quoted".to_string()));
    }

    #[test]
    fn test_normalize_social_post_output_wraps_plain_markdown() {
        let normalized = normalize_social_post_output(
            SOCIAL_POST_WITH_COVER_SKILL_NAME,
            "春季上新",
            "exec123456",
            "# 标题\n\n正文内容",
        )
        .expect("should normalize");

        assert!(normalized
            .final_output
            .contains("<write_file path=\"social-posts/"));
        assert!(normalized.final_output.contains("# 标题"));
        assert!(normalized.file_content.contains("# 标题"));
        assert!(normalized.file_content.contains("![封面图]("));
        assert!(normalized.file_path.starts_with("social-posts/"));
        assert!(normalized.file_path.ends_with(".md"));
    }

    #[test]
    fn test_normalize_social_post_output_keeps_existing_write_file_block() {
        let raw_output =
            "<write_file path=\"social-posts/custom-post.md\">\n# 标题\n\n正文\n</write_file>";
        let normalized = normalize_social_post_output(
            SOCIAL_POST_WITH_COVER_SKILL_NAME,
            "春季上新",
            "exec123456",
            raw_output,
        )
        .expect("should normalize");

        assert_eq!(normalized.file_path, "social-posts/custom-post.md");
        assert!(normalized
            .final_output
            .contains("social-posts/custom-post.md"));
        assert!(normalized.file_content.contains("# 标题"));
        assert!(normalized.file_content.contains("![封面图]("));
    }

    #[test]
    fn test_normalize_social_post_output_injects_missing_path() {
        let raw_output = "前置说明\n<write_file>\n# 标题\n\n正文\n</write_file>\n后置说明";
        let normalized = normalize_social_post_output(
            SOCIAL_POST_WITH_COVER_SKILL_NAME,
            "spring launch",
            "exec123456",
            raw_output,
        )
        .expect("should normalize");

        assert!(normalized.final_output.contains("前置说明"));
        assert!(normalized.final_output.contains("后置说明"));
        assert!(normalized
            .final_output
            .contains("<write_file path=\"social-posts/"));
        assert!(normalized.file_content.contains("# 标题"));
        assert!(normalized.file_content.contains("![封面图]("));
    }

    #[test]
    fn test_build_social_auxiliary_file_payloads_should_include_cover_and_publish_pack() {
        let payloads = build_social_auxiliary_file_payloads(
            "exec123",
            "新品发布",
            "social-posts/demo.md",
            "# 标题\n\n![封面图](https://img.example/cover.png)\n\n## 配图说明\n- 提示词：简洁科技风\n- 尺寸：1024x1024\n- 状态：成功\n- 备注：\n",
        );

        assert_eq!(payloads.len(), 2);
        assert!(payloads
            .iter()
            .any(|(path, _)| path.ends_with(".cover.json")));
        assert!(payloads
            .iter()
            .any(|(path, _)| path.ends_with(".publish-pack.json")));
    }

    #[test]
    fn test_collect_social_artifact_paths_from_output_should_expand_auxiliary_files() {
        let output = "<write_file path=\"social-posts/demo.md\">\n# 标题\n\n正文\n</write_file>";
        let paths = collect_social_artifact_paths_from_output(Some(output));
        assert_eq!(paths.len(), 3);
        assert_eq!(paths[0], "social-posts/demo.md");
        assert!(paths[1].ends_with(".cover.json"));
        assert!(paths[2].ends_with(".publish-pack.json"));
    }

    #[test]
    fn test_build_social_post_slug_fallback_to_post() {
        assert_eq!(build_social_post_slug(""), "post");
        assert_eq!(build_social_post_slug("！！！"), "post");
        assert_eq!(
            build_social_post_slug("Spring Launch 2026"),
            "spring-launch-2026"
        );
    }

    #[test]
    fn test_parse_allowed_tools() {
        assert_eq!(parse_allowed_tools(None), None);
        assert_eq!(parse_allowed_tools(Some("")), None);
        assert_eq!(
            parse_allowed_tools(Some("tool1")),
            Some(vec!["tool1".to_string()])
        );
        assert_eq!(
            parse_allowed_tools(Some("tool1, tool2, tool3")),
            Some(vec![
                "tool1".to_string(),
                "tool2".to_string(),
                "tool3".to_string()
            ])
        );
    }

    #[test]
    fn test_parse_boolean() {
        assert!(!parse_boolean(None, false));
        assert!(parse_boolean(None, true));
        assert!(parse_boolean(Some("true"), false));
        assert!(parse_boolean(Some("TRUE"), false));
        assert!(parse_boolean(Some("1"), false));
        assert!(parse_boolean(Some("yes"), false));
        assert!(!parse_boolean(Some("false"), true));
        assert!(!parse_boolean(Some("no"), true));
    }

    #[test]
    fn test_load_skill_from_file() {
        use tempfile::TempDir;

        let temp_dir = TempDir::new().unwrap();
        let skill_dir = temp_dir.path().join("my-skill");
        std::fs::create_dir(&skill_dir).unwrap();

        let skill_file = skill_dir.join("SKILL.md");
        std::fs::write(
            &skill_file,
            r#"---
name: my-skill
description: Test skill description
allowed-tools: tool1, tool2
model: gpt-4
provider: openai
---

# My Skill

Instructions here.
"#,
        )
        .unwrap();

        let skill = load_skill_from_file("my-skill", &skill_file).unwrap();

        assert_eq!(skill.skill_name, "my-skill");
        assert_eq!(skill.display_name, "my-skill");
        assert_eq!(skill.description, "Test skill description");
        assert_eq!(
            skill.allowed_tools,
            Some(vec!["tool1".to_string(), "tool2".to_string()])
        );
        assert_eq!(skill.model, Some("gpt-4".to_string()));
        assert_eq!(skill.provider, Some("openai".to_string()));
        assert!(!skill.disable_model_invocation);
        assert_eq!(skill.execution_mode, "prompt");
    }

    #[test]
    fn test_load_skills_from_directory() {
        use tempfile::TempDir;

        let temp_dir = TempDir::new().unwrap();
        let skills_dir = temp_dir.path();

        // 创建 skill 1
        let skill1_dir = skills_dir.join("skill-one");
        std::fs::create_dir(&skill1_dir).unwrap();
        std::fs::write(
            skill1_dir.join("SKILL.md"),
            r#"---
name: skill-one
description: First skill
---
Content 1
"#,
        )
        .unwrap();

        // 创建 skill 2
        let skill2_dir = skills_dir.join("skill-two");
        std::fs::create_dir(&skill2_dir).unwrap();
        std::fs::write(
            skill2_dir.join("SKILL.md"),
            r#"---
name: skill-two
description: Second skill
disable-model-invocation: true
---
Content 2
"#,
        )
        .unwrap();

        let skills = load_skills_from_directory(skills_dir);

        assert_eq!(skills.len(), 2);
        let names: Vec<_> = skills.iter().map(|s| s.skill_name.as_str()).collect();
        assert!(names.contains(&"skill-one"));
        assert!(names.contains(&"skill-two"));

        // 验证 disable_model_invocation 被正确解析
        let skill_two = skills.iter().find(|s| s.skill_name == "skill-two").unwrap();
        assert!(skill_two.disable_model_invocation);
    }

    #[test]
    fn test_load_skills_from_nonexistent_directory() {
        let skills = load_skills_from_directory(std::path::Path::new("/nonexistent/path"));
        assert!(skills.is_empty());
    }

    #[test]
    fn test_bundled_social_post_with_cover_skill_contract() {
        let skill_file = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources/default-skills/social_post_with_cover/SKILL.md");

        assert!(skill_file.exists());
        let content = std::fs::read_to_string(&skill_file).unwrap();
        let skill = load_skill_from_file("social_post_with_cover", &skill_file).unwrap();

        assert_eq!(skill.skill_name, "social_post_with_cover");
        assert_eq!(skill.execution_mode, "workflow");
        assert_eq!(
            skill.allowed_tools,
            Some(vec![
                "social_generate_cover_image".to_string(),
                "search_query".to_string(),
            ])
        );
        assert!(content.contains("<write_file") && content.contains("social-posts/"));
        assert!(!skill.disable_model_invocation);
    }
}
