use super::*;

const COVER_SKILL_LAUNCH_PROMPT_MARKER: &str = "<<LIME_COVER_SKILL_LAUNCH_HINT>>";

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

fn truncate_prompt_text(value: String, max_chars: usize) -> String {
    let total_chars = value.chars().count();
    if total_chars <= max_chars {
        return value;
    }

    let truncated = value.chars().take(max_chars).collect::<String>();
    format!("{truncated}...(已截断，原始长度 {total_chars} 字)")
}

pub(crate) fn merge_system_prompt_with_cover_skill_launch(
    base_prompt: Option<String>,
    request_metadata: Option<&serde_json::Value>,
) -> Option<String> {
    let Some(launch_prompt) = build_cover_skill_launch_system_prompt(request_metadata) else {
        return base_prompt;
    };

    match base_prompt {
        Some(base) => {
            if base.contains(COVER_SKILL_LAUNCH_PROMPT_MARKER) {
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

fn build_cover_skill_launch_system_prompt(
    request_metadata: Option<&serde_json::Value>,
) -> Option<String> {
    let launch = extract_harness_nested_object(
        request_metadata,
        &["cover_skill_launch", "coverSkillLaunch"],
    )?;
    let kind = extract_object_string(launch, &["kind"]).unwrap_or_else(|| "cover_task".to_string());
    if kind != "cover_task" {
        return None;
    }

    let skill_name = extract_object_string(launch, &["skill_name", "skillName"])
        .unwrap_or_else(|| "cover_generate".to_string());
    let cover_task = launch
        .get("cover_task")
        .and_then(serde_json::Value::as_object)?;
    let raw_text = extract_object_string(cover_task, &["raw_text", "rawText"]);
    let prompt = extract_object_string(cover_task, &["prompt"]);
    let title = extract_object_string(cover_task, &["title"]);
    let platform = extract_object_string(cover_task, &["platform"]);
    let size = extract_object_string(cover_task, &["size"]);
    let style = extract_object_string(cover_task, &["style"]);
    let session_id = extract_object_string(cover_task, &["session_id", "sessionId"]);
    let project_id = extract_object_string(cover_task, &["project_id", "projectId"]);
    let content_id = extract_object_string(cover_task, &["content_id", "contentId"]);
    let entry_source = extract_object_string(cover_task, &["entry_source", "entrySource"])
        .unwrap_or_else(|| "at_cover_command".to_string());
    let args_payload = serde_json::json!({
        "user_input": raw_text
            .clone()
            .or(prompt.clone())
            .or(title.clone())
            .unwrap_or_else(|| "请根据当前要求执行封面任务".to_string()),
        "cover_task": serde_json::Value::Object(cover_task.clone()),
    });
    let args_json = truncate_prompt_text(
        serde_json::to_string(&args_payload).unwrap_or_else(|_| "{}".to_string()),
        4_000,
    );
    let cover_task_json = truncate_prompt_text(
        serde_json::to_string(cover_task).unwrap_or_else(|_| "{}".to_string()),
        4_000,
    );

    let mut lines = vec![
        COVER_SKILL_LAUNCH_PROMPT_MARKER.to_string(),
        "- 当前回合来自封面技能启动，不要把它当成普通聊天回答。".to_string(),
        "- 先快速归纳用户目标，然后立刻把任务交给 Skill 工具；不要停留在泛泛解释。".to_string(),
        format!("- 第一优先工具调用必须是 Skill，且 skill=\"{skill_name}\"。"),
        "- 调用 Skill 时，args 必须是一个严格 JSON 字符串，不要漏引号、不要写注释、不要只传半截字段。".to_string(),
        format!("- 推荐传给 Skill.args 的 JSON：{args_json}"),
        "- Skill 执行后，优先沿 cover_generate skill 的 social_generate_cover_image + Bash / task file 主链提交异步任务；只有 Skill 明确不可用时，才允许直接回退到 lime_create_cover_generation_task。".to_string(),
        "- 不要把封面任务退化成普通配图，也不要伪造“封面已生成完成”；在 task file 真正返回结果前，只能汇报任务已提交、排队或执行中。".to_string(),
        format!("- 当前封面任务上下文(JSON)：{cover_task_json}"),
        format!("- 当前入口来源：{entry_source}。"),
    ];

    if let Some(value) = prompt.as_deref() {
        lines.push(format!("- 当前封面目标：{value}"));
    }
    if let Some(value) = title.as_deref() {
        lines.push(format!("- 当前封面标题：{value}。"));
    }
    if let Some(value) = platform.as_deref() {
        lines.push(format!("- 当前目标平台：{value}。"));
    }
    if let Some(value) = size.as_deref() {
        lines.push(format!("- 当前尺寸要求：{value}。"));
    }
    if let Some(value) = style.as_deref() {
        lines.push(format!("- 当前视觉风格：{value}。"));
    }
    if let Some(value) = session_id.as_deref() {
        lines.push(format!("- 当前 session_id：{value}。"));
    }
    if let Some(value) = project_id.as_deref() {
        lines.push(format!("- 当前 project_id：{value}。"));
    }
    if let Some(value) = content_id.as_deref() {
        lines.push(format!("- 当前 content_id：{value}。"));
    }

    lines.push(
        "- 当前任务已经显式进入封面技能主链，不要再要求用户额外确认“是否开始生成封面”。"
            .to_string(),
    );

    Some(lines.join("\n"))
}
