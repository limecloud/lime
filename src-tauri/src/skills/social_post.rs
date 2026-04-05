use crate::agent::AgentEvent as RuntimeAgentEvent;
use chrono::Utc;
use lime_agent::{build_write_tool_artifact_events, AgentToolResult};
use tauri::{AppHandle, Emitter};

pub(crate) const CONTENT_POST_WITH_COVER_SKILL_NAME: &str = "content_post_with_cover";
pub(crate) const CONTENT_POST_OUTPUT_DIR: &str = "content-posts";
const SOCIAL_POST_WRITE_TOOL_NAME: &str = "write_file";
const SOCIAL_POST_EMPTY_FALLBACK_CONTENT: &str = "# 内容主稿\n\n（生成结果为空，请重试。）";
const SOCIAL_POST_FALLBACK_COVER_URL: &str = "cover-generation-failed";
const SOCIAL_POST_FALLBACK_COVER_NOTE: &str = "封面图生成失败，可稍后仅重试配图。";
const SOCIAL_POST_DEFAULT_IMAGE_SIZE: &str = "1024x1024";

pub(crate) fn is_content_post_skill_name(skill_name: &str) -> bool {
    skill_name == CONTENT_POST_WITH_COVER_SKILL_NAME
}

#[derive(Debug, Clone)]
pub struct FinalizedSkillOutput {
    pub final_output: String,
    pub artifact_paths: Vec<String>,
}

#[derive(Debug, Clone)]
struct SocialSkillOutputEnvelope {
    final_output: String,
    file_path: String,
    file_content: String,
}

pub fn infer_theme_workbench_gate_key(skill_name: &str, user_input: &str) -> &'static str {
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

pub fn finalize_skill_output(
    app_handle: &AppHandle,
    skill_name: &str,
    user_input: &str,
    execution_id: &str,
    raw_output: &str,
) -> FinalizedSkillOutput {
    let Some(social_output) =
        normalize_social_post_output(skill_name, user_input, execution_id, raw_output)
    else {
        return FinalizedSkillOutput {
            final_output: raw_output.to_string(),
            artifact_paths: Vec::new(),
        };
    };

    let artifact_paths = build_social_artifact_paths(&social_output.file_path);
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
        emit_social_write_file_events(app_handle, execution_id, &artifact_path, &artifact_content);
    }

    FinalizedSkillOutput {
        final_output: social_output.final_output,
        artifact_paths,
    }
}

fn normalize_social_post_output(
    skill_name: &str,
    user_input: &str,
    execution_id: &str,
    raw_output: &str,
) -> Option<SocialSkillOutputEnvelope> {
    if !is_content_post_skill_name(skill_name) {
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

fn build_social_artifact_paths(article_path: &str) -> Vec<String> {
    let (cover_meta_path, publish_pack_path) = derive_social_auxiliary_paths(article_path);
    vec![article_path.to_string(), cover_meta_path, publish_pack_path]
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
    format!("{CONTENT_POST_OUTPUT_DIR}/{timestamp}-{slug}-{suffix}.md")
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

fn build_social_write_tool_events(
    execution_id: &str,
    file_path: &str,
    file_content: &str,
) -> Vec<RuntimeAgentEvent> {
    let tool_id = build_social_tool_event_id(execution_id, file_path);
    build_write_tool_artifact_events(
        &format!("skill-exec-{execution_id}"),
        SOCIAL_POST_WRITE_TOOL_NAME,
        &tool_id,
        file_path,
        file_content,
        AgentToolResult {
            success: true,
            output: format!("写入内容主稿: {file_path}"),
            error: None,
            images: None,
            metadata: None,
        },
    )
}

fn emit_social_write_file_events(
    app_handle: &AppHandle,
    execution_id: &str,
    file_path: &str,
    file_content: &str,
) {
    let event_name = format!("skill-exec-{execution_id}");
    for event in build_social_write_tool_events(execution_id, file_path, file_content) {
        if let Err(err) = app_handle.emit(&event_name, &event) {
            tracing::warn!("[execute_skill] 发送内容主稿写入事件失败: {}", err);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_content_post_skill_name_only_accepts_current_name() {
        assert!(is_content_post_skill_name(
            CONTENT_POST_WITH_COVER_SKILL_NAME
        ));
        assert!(!is_content_post_skill_name("legacy_content_post"));
    }

    #[test]
    fn test_normalize_social_post_output_wraps_plain_markdown() {
        let normalized = normalize_social_post_output(
            CONTENT_POST_WITH_COVER_SKILL_NAME,
            "春季上新",
            "exec123456",
            "# 标题\n\n正文内容",
        )
        .expect("should normalize");

        assert!(normalized
            .final_output
            .contains("<write_file path=\"content-posts/"));
        assert!(normalized.final_output.contains("# 标题"));
        assert!(normalized.file_content.contains("# 标题"));
        assert!(normalized.file_content.contains("![封面图]("));
        assert!(normalized.file_path.starts_with("content-posts/"));
        assert!(normalized.file_path.ends_with(".md"));
    }

    #[test]
    fn test_normalize_social_post_output_keeps_existing_write_file_block() {
        let raw_output =
            "<write_file path=\"content-posts/custom-post.md\">\n# 标题\n\n正文\n</write_file>";
        let normalized = normalize_social_post_output(
            CONTENT_POST_WITH_COVER_SKILL_NAME,
            "春季上新",
            "exec123456",
            raw_output,
        )
        .expect("should normalize");

        assert_eq!(normalized.file_path, "content-posts/custom-post.md");
        assert!(normalized
            .final_output
            .contains("content-posts/custom-post.md"));
        assert!(normalized.file_content.contains("# 标题"));
        assert!(normalized.file_content.contains("![封面图]("));
    }

    #[test]
    fn test_normalize_social_post_output_injects_missing_path() {
        let raw_output = "前置说明\n<write_file>\n# 标题\n\n正文\n</write_file>\n后置说明";
        let normalized = normalize_social_post_output(
            CONTENT_POST_WITH_COVER_SKILL_NAME,
            "spring launch",
            "exec123456",
            raw_output,
        )
        .expect("should normalize");

        assert!(normalized.final_output.contains("前置说明"));
        assert!(normalized.final_output.contains("后置说明"));
        assert!(normalized
            .final_output
            .contains("<write_file path=\"content-posts/"));
        assert!(normalized.file_content.contains("# 标题"));
        assert!(normalized.file_content.contains("![封面图]("));
    }

    #[test]
    fn test_build_social_auxiliary_file_payloads_should_include_cover_and_publish_pack() {
        let payloads = build_social_auxiliary_file_payloads(
            "exec123",
            "新品发布",
            "content-posts/demo.md",
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
    fn test_build_social_artifact_paths_should_expand_auxiliary_files() {
        let paths = build_social_artifact_paths("content-posts/demo.md");
        assert_eq!(paths.len(), 3);
        assert_eq!(paths[0], "content-posts/demo.md");
        assert!(paths[1].ends_with(".cover.json"));
        assert!(paths[2].ends_with(".publish-pack.json"));
    }

    #[test]
    fn test_build_social_write_tool_events_reuses_unified_artifact_emitter() {
        let events =
            build_social_write_tool_events("exec123", "content-posts/demo.md", "# 标题\n\n正文");

        assert_eq!(events.len(), 4);

        match &events[0] {
            RuntimeAgentEvent::ArtifactSnapshot { artifact } => {
                assert_eq!(artifact.file_path, "content-posts/demo.md");
                assert_eq!(
                    artifact
                        .metadata
                        .as_ref()
                        .and_then(|metadata| metadata.get("writePhase"))
                        .and_then(serde_json::Value::as_str),
                    Some("streaming")
                );
            }
            other => panic!("expected ArtifactSnapshot, got {other:?}"),
        }

        match &events[1] {
            RuntimeAgentEvent::ToolStart { tool_name, .. } => {
                assert_eq!(tool_name, SOCIAL_POST_WRITE_TOOL_NAME);
            }
            other => panic!("expected ToolStart, got {other:?}"),
        }

        match &events[2] {
            RuntimeAgentEvent::ArtifactSnapshot { artifact } => {
                assert_eq!(artifact.file_path, "content-posts/demo.md");
                assert_eq!(
                    artifact
                        .metadata
                        .as_ref()
                        .and_then(|metadata| metadata.get("writePhase"))
                        .and_then(serde_json::Value::as_str),
                    Some("completed")
                );
            }
            other => panic!("expected ArtifactSnapshot, got {other:?}"),
        }

        match &events[3] {
            RuntimeAgentEvent::ToolEnd { result, .. } => {
                assert_eq!(
                    result
                        .metadata
                        .as_ref()
                        .and_then(|metadata| metadata.get("artifact_streamed"))
                        .and_then(serde_json::Value::as_bool),
                    Some(true)
                );
                assert_eq!(
                    result
                        .metadata
                        .as_ref()
                        .and_then(|metadata| metadata.get("file_path"))
                        .and_then(serde_json::Value::as_str),
                    Some("content-posts/demo.md")
                );
            }
            other => panic!("expected ToolEnd, got {other:?}"),
        }
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
}
