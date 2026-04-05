use super::*;

const TRANSCRIPTION_SKILL_LAUNCH_PROMPT_MARKER: &str = "<<LIME_TRANSCRIPTION_SKILL_LAUNCH_HINT>>";

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

pub(crate) fn merge_system_prompt_with_transcription_skill_launch(
    base_prompt: Option<String>,
    request_metadata: Option<&serde_json::Value>,
) -> Option<String> {
    let Some(launch_prompt) = build_transcription_skill_launch_system_prompt(request_metadata)
    else {
        return base_prompt;
    };

    match base_prompt {
        Some(base) => {
            if base.contains(TRANSCRIPTION_SKILL_LAUNCH_PROMPT_MARKER) {
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

fn build_transcription_skill_launch_system_prompt(
    request_metadata: Option<&serde_json::Value>,
) -> Option<String> {
    let launch = extract_harness_nested_object(
        request_metadata,
        &["transcription_skill_launch", "transcriptionSkillLaunch"],
    )?;
    let kind = extract_object_string(launch, &["kind"])
        .unwrap_or_else(|| "transcription_task".to_string());
    if kind != "transcription_task" {
        return None;
    }

    let skill_name = extract_object_string(launch, &["skill_name", "skillName"])
        .unwrap_or_else(|| "transcription_generate".to_string());
    let transcription_task = launch
        .get("transcription_task")
        .and_then(serde_json::Value::as_object)?;
    let raw_text = extract_object_string(transcription_task, &["raw_text", "rawText"]);
    let prompt = extract_object_string(transcription_task, &["prompt"]);
    let source_url = extract_object_string(transcription_task, &["source_url", "sourceUrl"]);
    let source_path = extract_object_string(transcription_task, &["source_path", "sourcePath"]);
    let language = extract_object_string(transcription_task, &["language"]);
    let output_format =
        extract_object_string(transcription_task, &["output_format", "outputFormat"]);
    let speaker_labels = transcription_task
        .get("speaker_labels")
        .or_else(|| transcription_task.get("speakerLabels"))
        .and_then(serde_json::Value::as_bool);
    let timestamps = transcription_task
        .get("timestamps")
        .and_then(serde_json::Value::as_bool);
    let provider_id = extract_object_string(transcription_task, &["provider_id", "providerId"]);
    let model = extract_object_string(transcription_task, &["model"]);
    let entry_source = extract_object_string(transcription_task, &["entry_source", "entrySource"])
        .unwrap_or_else(|| "at_transcription_command".to_string());
    let args_payload = serde_json::json!({
        "user_input": raw_text
            .clone()
            .or(prompt.clone())
            .unwrap_or_else(|| "请根据当前要求执行转写任务".to_string()),
        "transcription_task": serde_json::Value::Object(transcription_task.clone()),
    });
    let args_json = truncate_prompt_text(
        serde_json::to_string(&args_payload).unwrap_or_else(|_| "{}".to_string()),
        4_000,
    );
    let transcription_task_json = truncate_prompt_text(
        serde_json::to_string(transcription_task).unwrap_or_else(|_| "{}".to_string()),
        4_000,
    );
    let source_present = source_url.is_some() || source_path.is_some();

    let mut lines = vec![
        TRANSCRIPTION_SKILL_LAUNCH_PROMPT_MARKER.to_string(),
        "- 当前回合来自转写技能启动，不要把它当成普通聊天回答。".to_string(),
        "- 先快速归纳用户目标，然后立刻把任务交给 Skill 工具；不要停留在泛泛解释。".to_string(),
        format!("- 第一优先工具调用必须是 Skill，且 skill=\"{skill_name}\"。"),
        "- 调用 Skill 时，args 必须是一个严格 JSON 字符串，不要漏引号、不要写注释、不要只传半截字段。".to_string(),
        format!("- 推荐传给 Skill.args 的 JSON：{args_json}"),
        "- Skill 执行后，优先沿 transcription_generate skill 的 Bash / task file 主链提交异步任务；只有 Skill 明确不可用时，才允许直接回退到 lime_create_transcription_task。".to_string(),
        "- 不要伪造“转写已完成”；在 task file 真正返回结果前，只能汇报任务已提交、排队或执行中。".to_string(),
        format!("- 当前转写任务上下文(JSON)：{transcription_task_json}"),
        format!("- 当前入口来源：{entry_source}。"),
    ];

    if let Some(value) = prompt.as_deref() {
        lines.push(format!("- 当前用户目标：{value}"));
    }
    if let Some(value) = source_url.as_deref() {
        lines.push(format!("- 当前来源 URL：{value}。"));
    }
    if let Some(value) = source_path.as_deref() {
        lines.push(format!("- 当前来源路径：{value}。"));
    }
    if let Some(value) = language.as_deref() {
        lines.push(format!("- 当前目标语言：{value}。"));
    }
    if let Some(value) = output_format.as_deref() {
        lines.push(format!("- 当前输出格式：{value}。"));
    }
    if let Some(value) = speaker_labels {
        lines.push(format!(
            "- 当前是否区分说话人：{}。",
            if value { "是" } else { "否" }
        ));
    }
    if let Some(value) = timestamps {
        lines.push(format!(
            "- 当前是否带时间戳：{}。",
            if value { "是" } else { "否" }
        ));
    }
    if let Some(value) = provider_id.as_deref() {
        lines.push(format!("- 当前首选 provider_id：{value}。"));
    }
    if let Some(value) = model.as_deref() {
        lines.push(format!("- 当前首选模型：{value}。"));
    }

    if source_present {
        lines.push(
            "- 当前任务已经显式进入转写技能主链，不要再要求用户额外确认“是否开始转写”。"
                .to_string(),
        );
    } else {
        lines.push(
            "- 当前还缺少明确的音频/视频来源。你最多只能追问 1 个关键问题，请用户补充 source_url 或 source_path；在来源补齐前不要创建任务，也不要伪造结果。"
                .to_string(),
        );
    }

    Some(lines.join("\n"))
}
