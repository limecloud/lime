use super::*;

const TRANSLATION_SKILL_LAUNCH_PROMPT_MARKER: &str = "<<LIME_TRANSLATION_SKILL_LAUNCH_HINT>>";

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

fn ensure_harness_workbench_chat_mode(value: &mut serde_json::Value, launch_keys: &[&str]) {
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

    let has_launch = launch_keys.iter().any(|key| {
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

pub(crate) fn prepare_translation_skill_launch_request_metadata(
    request_metadata: Option<&serde_json::Value>,
) -> Option<serde_json::Value> {
    let mut metadata = request_metadata.cloned()?;
    ensure_harness_workbench_chat_mode(
        &mut metadata,
        &["translation_skill_launch", "translationSkillLaunch"],
    );

    Some(metadata)
}

pub(crate) fn merge_system_prompt_with_translation_skill_launch(
    base_prompt: Option<String>,
    request_metadata: Option<&serde_json::Value>,
) -> Option<String> {
    let Some(launch_prompt) = build_translation_skill_launch_system_prompt(request_metadata) else {
        return base_prompt;
    };

    match base_prompt {
        Some(base) => {
            if base.contains(TRANSLATION_SKILL_LAUNCH_PROMPT_MARKER) {
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

fn build_translation_skill_launch_system_prompt(
    request_metadata: Option<&serde_json::Value>,
) -> Option<String> {
    let launch = extract_harness_nested_object(
        request_metadata,
        &["translation_skill_launch", "translationSkillLaunch"],
    )?;
    let kind = extract_object_string(launch, &["kind"])
        .unwrap_or_else(|| "translation_request".to_string());
    if kind != "translation_request" {
        return None;
    }

    let skill_name = extract_object_string(launch, &["skill_name", "skillName"])
        .unwrap_or_else(|| "translation".to_string());
    let translation_request = launch
        .get("translation_request")
        .and_then(serde_json::Value::as_object)?;
    let raw_text = extract_object_string(translation_request, &["raw_text", "rawText"]);
    let prompt = extract_object_string(translation_request, &["prompt"])
        .unwrap_or_else(|| "请翻译当前对话中最相关的内容".to_string());
    let content = extract_object_string(translation_request, &["content"]);
    let source_language =
        extract_object_string(translation_request, &["source_language", "sourceLanguage"]);
    let target_language =
        extract_object_string(translation_request, &["target_language", "targetLanguage"]);
    let style = extract_object_string(translation_request, &["style"]);
    let output_format =
        extract_object_string(translation_request, &["output_format", "outputFormat"]);
    let project_id = extract_object_string(translation_request, &["project_id", "projectId"]);
    let content_id = extract_object_string(translation_request, &["content_id", "contentId"]);
    let entry_source = extract_object_string(translation_request, &["entry_source", "entrySource"])
        .unwrap_or_else(|| "at_translation_command".to_string());
    let args_payload = serde_json::json!({
        "user_input": raw_text.clone().unwrap_or_else(|| prompt.clone()),
        "translation_request": serde_json::Value::Object(translation_request.clone()),
    });
    let args_json = truncate_prompt_text(
        serde_json::to_string(&args_payload).unwrap_or_else(|_| "{}".to_string()),
        4_000,
    );
    let request_json = truncate_prompt_text(
        serde_json::to_string(translation_request).unwrap_or_else(|_| "{}".to_string()),
        4_000,
    );
    let has_explicit_content = content
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .is_some();

    let mut lines = vec![
        TRANSLATION_SKILL_LAUNCH_PROMPT_MARKER.to_string(),
        "- 当前回合来自翻译技能启动，不要把它当成普通聊天回答。".to_string(),
        "- 先快速判断要翻译什么、要翻译成什么语言，再立刻把任务交给 Skill 工具；不要直接跳过 Skill 在聊天区作答。"
            .to_string(),
        format!("- 第一优先工具调用必须是 Skill，且 skill=\"{skill_name}\"。"),
        "- 调用 Skill 时，args 必须是一个严格 JSON 字符串，不要漏引号、不要写注释、不要只传半截字段。".to_string(),
        format!("- 推荐传给 Skill.args 的 JSON：{args_json}"),
        "- 这条命令属于 prompt skill 主链，不要创建 task file，也不要回退成普通聊天翻译。".to_string(),
        "- 若用户明确给了正文、文件路径或范围，优先翻译这些材料；若未明确给材料，则翻译当前对话中与请求最相关的内容。".to_string(),
        "- 译文必须忠于原文，不要补写原文没有的新事实；遇到术语或语义歧义时，要单独标注待确认项。".to_string(),
        format!("- 当前翻译请求上下文(JSON)：{request_json}"),
        format!("- 当前入口来源：{entry_source}。"),
        format!("- 当前翻译目标：{prompt}"),
    ];

    if let Some(value) = content.as_deref() {
        lines.push(format!("- 当前显式正文：{value}。"));
    }
    if let Some(value) = source_language.as_deref() {
        lines.push(format!("- 当前原语言偏好：{value}。"));
    }
    if let Some(value) = target_language.as_deref() {
        lines.push(format!("- 当前目标语言偏好：{value}。"));
    }
    if let Some(value) = style.as_deref() {
        lines.push(format!("- 当前风格偏好：{value}。"));
    }
    if let Some(value) = output_format.as_deref() {
        lines.push(format!("- 当前输出格式偏好：{value}。"));
    }
    if let Some(value) = project_id.as_deref() {
        lines.push(format!("- 当前 project_id：{value}。"));
    }
    if let Some(value) = content_id.as_deref() {
        lines.push(format!("- 当前 content_id：{value}。"));
    }

    if has_explicit_content {
        lines
            .push("- 当前任务已经显式进入翻译技能主链，不要再追问用户“是否开始翻译”。".to_string());
    } else {
        lines.push(
            "- 当前没有显式正文时，优先尝试翻译当前对话上下文；只有在上下文也不足以完成时，才最多追问 1 个关键问题。"
                .to_string(),
        );
    }

    Some(lines.join("\n"))
}
