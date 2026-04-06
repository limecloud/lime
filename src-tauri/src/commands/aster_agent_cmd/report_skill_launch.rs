use super::*;

const REPORT_SKILL_LAUNCH_PROMPT_MARKER: &str = "<<LIME_REPORT_SKILL_LAUNCH_HINT>>";

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

pub(crate) fn prepare_report_skill_launch_request_metadata(
    request_metadata: Option<&serde_json::Value>,
) -> Option<serde_json::Value> {
    let mut metadata = request_metadata.cloned()?;
    ensure_harness_workbench_chat_mode(
        &mut metadata,
        &["report_skill_launch", "reportSkillLaunch"],
    );

    Some(metadata)
}

pub(crate) fn merge_system_prompt_with_report_skill_launch(
    base_prompt: Option<String>,
    request_metadata: Option<&serde_json::Value>,
) -> Option<String> {
    let Some(launch_prompt) = build_report_skill_launch_system_prompt(request_metadata) else {
        return base_prompt;
    };

    match base_prompt {
        Some(base) => {
            if base.contains(REPORT_SKILL_LAUNCH_PROMPT_MARKER) {
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

fn build_report_skill_launch_system_prompt(
    request_metadata: Option<&serde_json::Value>,
) -> Option<String> {
    let launch = extract_harness_nested_object(
        request_metadata,
        &["report_skill_launch", "reportSkillLaunch"],
    )?;
    let kind =
        extract_object_string(launch, &["kind"]).unwrap_or_else(|| "report_request".to_string());
    if kind != "report_request" {
        return None;
    }

    let skill_name = extract_object_string(launch, &["skill_name", "skillName"])
        .unwrap_or_else(|| "report_generate".to_string());
    let report_request = launch
        .get("report_request")
        .and_then(serde_json::Value::as_object)?;
    let raw_text = extract_object_string(report_request, &["raw_text", "rawText"]);
    let prompt = extract_object_string(report_request, &["prompt"]);
    let query = extract_object_string(report_request, &["query"]);
    let site = extract_object_string(report_request, &["site"]);
    let time_range = extract_object_string(report_request, &["time_range", "timeRange"]);
    let depth = extract_object_string(report_request, &["depth"]);
    let focus = extract_object_string(report_request, &["focus"]);
    let output_format = extract_object_string(report_request, &["output_format", "outputFormat"]);
    let project_id = extract_object_string(report_request, &["project_id", "projectId"]);
    let content_id = extract_object_string(report_request, &["content_id", "contentId"]);
    let entry_source = extract_object_string(report_request, &["entry_source", "entrySource"])
        .unwrap_or_else(|| "at_report_command".to_string());
    let args_payload = serde_json::json!({
        "user_input": raw_text
            .clone()
            .or(prompt.clone())
            .or(query.clone())
            .unwrap_or_else(|| "请根据当前要求执行研报任务".to_string()),
        "report_request": serde_json::Value::Object(report_request.clone()),
    });
    let args_json = truncate_prompt_text(
        serde_json::to_string(&args_payload).unwrap_or_else(|_| "{}".to_string()),
        4_000,
    );
    let request_json = truncate_prompt_text(
        serde_json::to_string(report_request).unwrap_or_else(|_| "{}".to_string()),
        4_000,
    );
    let has_query = query
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .is_some();

    let mut lines = vec![
        REPORT_SKILL_LAUNCH_PROMPT_MARKER.to_string(),
        "- 当前回合来自研报技能启动，不要把它当成普通聊天回答。".to_string(),
        "- 先快速归纳用户的研报目标，然后立刻把任务交给 Skill 工具；不要先写空泛长文。"
            .to_string(),
        format!("- 第一优先工具调用必须是 Skill，且 skill=\"{skill_name}\"。"),
        "- 调用 Skill 时，args 必须是一个严格 JSON 字符串，不要漏引号、不要写注释、不要只传半截字段。".to_string(),
        format!("- 推荐传给 Skill.args 的 JSON：{args_json}"),
        "- 这条命令属于 prompt skill 主链，不要创建媒体 task file，也不要退回普通聊天写长文。".to_string(),
        "- report_generate skill 内部必须先执行真实联网检索，再产出研究报告。".to_string(),
        "- 如果用户要求最新、近期、今天或时间敏感信息，检索词里必须补年份或时间范围，并在结果中标注时间口径。".to_string(),
        "- 最终输出必须清楚区分核心结论、关键证据、风险/待确认项与建议动作，不要把推断写成已确认事实。".to_string(),
        format!("- 当前研报请求上下文(JSON)：{request_json}"),
        format!("- 当前入口来源：{entry_source}。"),
    ];

    if let Some(value) = prompt.as_deref() {
        lines.push(format!("- 当前研报目标：{value}"));
    }
    if let Some(value) = query.as_deref() {
        lines.push(format!("- 当前核心主题：{value}。"));
    }
    if let Some(value) = site.as_deref() {
        lines.push(format!("- 当前目标站点/来源：{value}。"));
    }
    if let Some(value) = time_range.as_deref() {
        lines.push(format!("- 当前时间范围：{value}。"));
    }
    if let Some(value) = depth.as_deref() {
        lines.push(format!("- 当前调研深度：{value}。"));
    }
    if let Some(value) = focus.as_deref() {
        lines.push(format!("- 当前关注重点：{value}。"));
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

    if has_query {
        lines.push(
            "- 当前任务已经显式进入研报技能主链，不要再追问用户“是否开始做研报”。".to_string(),
        );
    } else {
        lines.push(
            "- 当前还缺少明确研报主题。你最多只能追问 1 个关键问题，请用户补充最关键的研究对象；在主题补齐前不要伪造检索或研报结果。"
                .to_string(),
        );
    }

    Some(lines.join("\n"))
}
