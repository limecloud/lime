use super::*;
use base64::{engine::general_purpose::STANDARD, Engine as _};
use std::fs;
use std::path::{Path, PathBuf};

const IMAGE_SKILL_INPUT_REF_PREFIX: &str = "skill-input-image://";
pub(super) const IMAGE_SKILL_LAUNCH_PROMPT_MARKER: &str = "<<LIME_IMAGE_SKILL_LAUNCH_HINT>>";
const IMAGE_SKILL_LAUNCH_DETOUR_DENY_PATTERNS: &[&str] = &[
    TOOL_SEARCH_TOOL_NAME,
    "WebSearch",
    "web_search",
    "Read",
    "read",
    "Glob",
    "glob",
    "Grep",
    "grep",
];

fn extract_object_string(
    object: &serde_json::Map<String, serde_json::Value>,
    keys: &[&str],
) -> Option<String> {
    keys.iter()
        .filter_map(|key| object.get(*key))
        .find_map(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn build_image_skill_input_ref(index: usize) -> String {
    format!("{IMAGE_SKILL_INPUT_REF_PREFIX}{}", index + 1)
}

fn extension_for_media_type(media_type: &str) -> &'static str {
    match media_type.trim().to_ascii_lowercase().as_str() {
        "image/jpeg" | "image/jpg" => "jpg",
        "image/webp" => "webp",
        "image/gif" => "gif",
        "image/bmp" => "bmp",
        "image/tiff" => "tiff",
        "image/svg+xml" => "svg",
        _ => "png",
    }
}

fn resolve_image_skill_input_root(
    workspace_root: &Path,
    session_id: &str,
    turn_id: &str,
) -> PathBuf {
    workspace_root
        .join(".lime")
        .join("turn-inputs")
        .join(session_id)
        .join(turn_id)
}

fn persist_image_skill_input_images(root: &Path, images: &[ImageInput]) -> Vec<Option<String>> {
    if images.is_empty() {
        return Vec::new();
    }

    if let Err(error) = fs::create_dir_all(root) {
        tracing::warn!(
            "[AsterAgent] 创建图片技能输入目录失败 path={}: {}",
            root.display(),
            error
        );
        return vec![None; images.len()];
    }

    images
        .iter()
        .enumerate()
        .map(|(index, image)| {
            let file_name = format!(
                "input-{}.{}",
                index + 1,
                extension_for_media_type(&image.media_type)
            );
            let file_path = root.join(file_name);
            let bytes = match STANDARD.decode(&image.data) {
                Ok(bytes) => bytes,
                Err(error) => {
                    tracing::warn!(
                        "[AsterAgent] 解码图片技能输入失败 ref={} media_type={}: {}",
                        build_image_skill_input_ref(index),
                        image.media_type,
                        error
                    );
                    return None;
                }
            };
            match fs::write(&file_path, bytes) {
                Ok(_) => Some(file_path.to_string_lossy().to_string()),
                Err(error) => {
                    tracing::warn!(
                        "[AsterAgent] 写入图片技能输入失败 path={}: {}",
                        file_path.display(),
                        error
                    );
                    None
                }
            }
        })
        .collect()
}

fn replace_image_skill_input_refs(
    value: &mut serde_json::Value,
    materialized_paths: &[Option<String>],
) {
    match value {
        serde_json::Value::Array(items) => {
            for item in items {
                replace_image_skill_input_refs(item, materialized_paths);
            }
        }
        serde_json::Value::Object(record) => {
            for item in record.values_mut() {
                replace_image_skill_input_refs(item, materialized_paths);
            }
        }
        serde_json::Value::String(text) => {
            let normalized = text.trim();
            if let Some(index_text) = normalized.strip_prefix(IMAGE_SKILL_INPUT_REF_PREFIX) {
                if let Ok(index) = index_text.parse::<usize>() {
                    if let Some(Some(path)) = materialized_paths.get(index.saturating_sub(1)) {
                        *value = serde_json::Value::String(path.clone());
                    }
                }
            }
        }
        _ => {}
    }
}

fn extract_harness_nested_object_mut<'a>(
    value: &'a mut serde_json::Value,
    keys: &[&str],
) -> Option<&'a mut serde_json::Map<String, serde_json::Value>> {
    let root = value.as_object_mut()?;
    let harness = if root.contains_key("harness") {
        root.get_mut("harness")
            .and_then(serde_json::Value::as_object_mut)?
    } else {
        root
    };

    for key in keys.iter().copied() {
        let exists = harness
            .get(key)
            .and_then(serde_json::Value::as_object)
            .is_some();
        if exists {
            return harness
                .get_mut(key)
                .and_then(serde_json::Value::as_object_mut);
        }
    }

    None
}

fn ensure_image_skill_launch_workbench_chat_mode(value: &mut serde_json::Value) {
    let Some(root) = value.as_object_mut() else {
        return;
    };
    let harness = if root.contains_key("harness") {
        match root
            .get_mut("harness")
            .and_then(serde_json::Value::as_object_mut)
        {
            Some(harness) => harness,
            None => return,
        }
    } else {
        root
    };

    let has_launch = ["image_skill_launch", "imageSkillLaunch"]
        .iter()
        .any(|key| {
            harness
                .get(*key)
                .and_then(serde_json::Value::as_object)
                .is_some()
        });
    if !has_launch {
        return;
    }

    harness.insert(
        "chat_mode".to_string(),
        serde_json::Value::String("workbench".to_string()),
    );
}

fn truncate_prompt_text(value: String, max_chars: usize) -> String {
    let total_chars = value.chars().count();
    if total_chars <= max_chars {
        return value;
    }

    let truncated = value.chars().take(max_chars).collect::<String>();
    format!("{truncated}...(已截断，原始长度 {total_chars} 字)")
}

pub(crate) fn prepare_image_skill_launch_request_metadata(
    workspace_root: &Path,
    session_id: &str,
    turn_id: &str,
    request_metadata: Option<&serde_json::Value>,
    images: Option<&[ImageInput]>,
) -> Option<serde_json::Value> {
    let mut metadata = request_metadata.cloned()?;
    ensure_image_skill_launch_workbench_chat_mode(&mut metadata);

    let Some(launch) = extract_harness_nested_object_mut(
        &mut metadata,
        &["image_skill_launch", "imageSkillLaunch"],
    ) else {
        return Some(metadata);
    };

    let Some(images) = images.filter(|items| !items.is_empty()) else {
        return Some(metadata);
    };

    let image_root = resolve_image_skill_input_root(workspace_root, session_id, turn_id);
    let materialized_paths = persist_image_skill_input_images(&image_root, images);
    if materialized_paths.is_empty() {
        return Some(metadata);
    }

    let mut launch_value = serde_json::Value::Object(launch.clone());
    replace_image_skill_input_refs(&mut launch_value, &materialized_paths);
    if let Some(updated_launch) = launch_value.as_object() {
        *launch = updated_launch.clone();
    }

    Some(metadata)
}

pub(crate) fn merge_system_prompt_with_image_skill_launch(
    base_prompt: Option<String>,
    request_metadata: Option<&serde_json::Value>,
) -> Option<String> {
    let Some(launch_prompt) = build_image_skill_launch_system_prompt(request_metadata) else {
        return base_prompt;
    };

    match base_prompt {
        Some(base) => {
            if base.contains(IMAGE_SKILL_LAUNCH_PROMPT_MARKER) {
                Some(base)
            } else if base.trim().is_empty() {
                Some(launch_prompt)
            } else {
                Some(format!("{base}\n\n{launch_prompt}"))
            }
        }
        None => Some(launch_prompt),
    }
}

pub(crate) fn should_lock_image_skill_launch_to_image_generation(
    request_metadata: Option<&serde_json::Value>,
) -> bool {
    let Some(launch) = extract_harness_nested_object(
        request_metadata,
        &["image_skill_launch", "imageSkillLaunch"],
    ) else {
        return false;
    };

    extract_object_string(launch, &["kind"]).unwrap_or_else(|| "image_task".to_string())
        == "image_task"
}

pub(crate) fn append_image_skill_launch_session_permissions(
    permissions: &mut Vec<ToolPermission>,
    session_id: &str,
    request_metadata: Option<&serde_json::Value>,
) {
    if !should_lock_image_skill_launch_to_image_generation(request_metadata) {
        return;
    }

    let session_id = session_id.trim();
    let conditions = if session_id.is_empty() {
        Vec::new()
    } else {
        vec![PermissionCondition {
            condition_type: ConditionType::Session,
            field: Some("session_id".to_string()),
            operator: ConditionOperator::Equals,
            value: serde_json::json!(session_id),
            validator: None,
            description: Some("仅对当前图片技能启动回合生效".to_string()),
        }]
    };

    for pattern in IMAGE_SKILL_LAUNCH_DETOUR_DENY_PATTERNS {
        permissions.push(ToolPermission {
            tool: (*pattern).to_string(),
            allowed: false,
            priority: 1240,
            conditions: conditions.clone(),
            parameter_restrictions: Vec::new(),
            scope: PermissionScope::Session,
            reason: Some(
                "图片技能启动回合已锁定为 Skill(image_generate) 主链，禁止先走通用工具搜索/读文件链路偏航"
                    .to_string(),
            ),
            expires_at: None,
            metadata: HashMap::new(),
        });
    }
}

pub(crate) fn prune_image_skill_launch_detour_tools_from_registry(
    registry: &mut aster::tools::ToolRegistry,
    request_metadata: Option<&serde_json::Value>,
) {
    if !should_lock_image_skill_launch_to_image_generation(request_metadata) {
        return;
    }

    for tool_name in IMAGE_SKILL_LAUNCH_DETOUR_DENY_PATTERNS {
        registry.unregister(tool_name);
    }
}

fn build_image_skill_launch_system_prompt(
    request_metadata: Option<&serde_json::Value>,
) -> Option<String> {
    let launch = extract_harness_nested_object(
        request_metadata,
        &["image_skill_launch", "imageSkillLaunch"],
    )?;
    let kind = extract_object_string(launch, &["kind"]).unwrap_or_else(|| "image_task".to_string());
    if kind != "image_task" {
        return None;
    }

    let skill_name = extract_object_string(launch, &["skill_name", "skillName"])
        .unwrap_or_else(|| "image_generate".to_string());
    let image_task = launch
        .get("image_task")
        .and_then(serde_json::Value::as_object)?;
    let raw_text = extract_object_string(image_task, &["raw_text", "rawText"]);
    let prompt = extract_object_string(image_task, &["prompt"]);
    let mode =
        extract_object_string(image_task, &["mode"]).unwrap_or_else(|| "generate".to_string());
    let size = extract_object_string(image_task, &["size"]);
    let aspect_ratio = extract_object_string(image_task, &["aspect_ratio", "aspectRatio"]);
    let provider_id = extract_object_string(image_task, &["provider_id", "providerId"]);
    let model = extract_object_string(image_task, &["model"]);
    let entry_source = extract_object_string(image_task, &["entry_source", "entrySource"])
        .unwrap_or_else(|| "at_image_command".to_string());
    let reference_images = image_task
        .get("reference_images")
        .and_then(serde_json::Value::as_array)
        .cloned()
        .unwrap_or_default();
    let args_payload = serde_json::json!({
        "user_input": raw_text
            .clone()
            .or(prompt.clone())
            .unwrap_or_else(|| "请根据当前要求执行图片任务".to_string()),
        "image_task": serde_json::Value::Object(image_task.clone()),
    });
    let args_json = truncate_prompt_text(
        serde_json::to_string(&args_payload).unwrap_or_else(|_| "{}".to_string()),
        4_000,
    );
    let image_task_json = truncate_prompt_text(
        serde_json::to_string(image_task).unwrap_or_else(|_| "{}".to_string()),
        4_000,
    );

    let mut lines = vec![
        IMAGE_SKILL_LAUNCH_PROMPT_MARKER.to_string(),
        "- 当前回合来自图片技能启动，不要把它当成普通聊天回答。".to_string(),
        "- 先快速归纳用户目标，然后立刻把任务交给 Skill 工具；不要停留在泛泛解释。".to_string(),
        format!("- 第一优先工具调用必须是 Skill，且 skill=\"{skill_name}\"。"),
        "- 调用 Skill 时，args 必须是一个严格 JSON 字符串，不要漏引号、不要写注释、不要只传半截字段。".to_string(),
        format!("- 推荐传给 Skill.args 的 JSON：{args_json}"),
        format!(
            "- 第一工具调用示例(Skill 参数 JSON)：{{\"skill\":\"{skill_name}\",\"args\":{}}}",
            serde_json::to_string(&args_json).unwrap_or_else(|_| "\"{}\"".to_string())
        ),
        "- 当前回合已经显式知道要走图片技能主链，不要为了确认技能名、工具名或命令名再去调用 ToolSearch。".to_string(),
        "- 在 Skill(image_generate) 真正执行前，不要先走 ToolSearch / WebSearch / Read / Glob / Grep 等通用工具发现、检索或读文件链路。".to_string(),
        "- 不要搜索 “Skill image_generate”、“lime media image generate --json”、“lime_create_image_generation_task” 之类目录信息；当前 image_task 已经提供了足够上下文。".to_string(),
        "- 如果某个通用搜索/读文件工具因为 session policy 被拒绝，不要重复同类调用；应立即改为直调 Skill(image_generate)。".to_string(),
        "- Skill 执行后，优先沿 image_generate skill 的 Bash / task file 主链提交异步任务；只有 Skill 明确不可用时，才允许直接回退到 lime_create_image_generation_task。".to_string(),
        "- 如果回退到 lime_create_image_generation_task，也必须只提交标准 image task 参数；不要传 outputPath，不要把任务写成 markdown 文稿。".to_string(),
        "- 不要伪造“图片已生成完成”；在 task file 真正返回结果前，只能汇报任务已提交、排队或执行中。".to_string(),
        format!("- 当前图片任务上下文(JSON)：{image_task_json}"),
        format!("- 当前模式：{mode}。"),
        format!("- 当前入口来源：{entry_source}。"),
        format!(
            "- 当前参考图数量：{}。若上下文里已经是本地文件路径、URL 或已物化输入图路径，提交任务时必须原样透传。",
            reference_images.len()
        ),
    ];

    if let Some(value) = prompt.as_deref() {
        lines.push(format!("- 当前用户目标：{value}"));
    }
    if let Some(value) = size.as_deref() {
        lines.push(format!("- 当前目标尺寸：{value}。"));
    }
    if let Some(value) = aspect_ratio.as_deref() {
        lines.push(format!("- 当前宽高比：{value}。"));
    }
    if let Some(value) = provider_id.as_deref() {
        lines.push(format!("- 当前首选 provider_id：{value}。"));
    }
    if let Some(value) = model.as_deref() {
        lines.push(format!("- 当前首选模型：{value}。"));
    }

    lines.push(
        "- 当前任务已经显式进入图片技能主链，不要再要求用户额外确认“是否开始生成/修图”。"
            .to_string(),
    );

    Some(lines.join("\n"))
}
