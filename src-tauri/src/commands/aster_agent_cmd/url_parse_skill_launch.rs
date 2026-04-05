use super::*;

const URL_PARSE_SKILL_LAUNCH_PROMPT_MARKER: &str = "<<LIME_URL_PARSE_SKILL_LAUNCH_HINT>>";

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

pub(crate) fn merge_system_prompt_with_url_parse_skill_launch(
    base_prompt: Option<String>,
    request_metadata: Option<&serde_json::Value>,
) -> Option<String> {
    let Some(launch_prompt) = build_url_parse_skill_launch_system_prompt(request_metadata) else {
        return base_prompt;
    };

    match base_prompt {
        Some(base) => {
            if base.contains(URL_PARSE_SKILL_LAUNCH_PROMPT_MARKER) {
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

fn build_url_parse_skill_launch_system_prompt(
    request_metadata: Option<&serde_json::Value>,
) -> Option<String> {
    let launch = extract_harness_nested_object(
        request_metadata,
        &["url_parse_skill_launch", "urlParseSkillLaunch"],
    )?;
    let kind =
        extract_object_string(launch, &["kind"]).unwrap_or_else(|| "url_parse_task".to_string());
    if kind != "url_parse_task" {
        return None;
    }

    let skill_name = extract_object_string(launch, &["skill_name", "skillName"])
        .unwrap_or_else(|| "url_parse".to_string());
    let url_parse_task = launch
        .get("url_parse_task")
        .and_then(serde_json::Value::as_object)?;
    let raw_text = extract_object_string(url_parse_task, &["raw_text", "rawText"]);
    let prompt = extract_object_string(url_parse_task, &["prompt"]);
    let url = extract_object_string(url_parse_task, &["url"]);
    let extract_goal = extract_object_string(url_parse_task, &["extract_goal", "extractGoal"]);
    let session_id = extract_object_string(url_parse_task, &["session_id", "sessionId"]);
    let project_id = extract_object_string(url_parse_task, &["project_id", "projectId"]);
    let content_id = extract_object_string(url_parse_task, &["content_id", "contentId"]);
    let entry_source = extract_object_string(url_parse_task, &["entry_source", "entrySource"])
        .unwrap_or_else(|| "at_url_parse_command".to_string());
    let args_payload = serde_json::json!({
        "user_input": raw_text
            .clone()
            .or(prompt.clone())
            .unwrap_or_else(|| "请根据当前要求执行链接解析任务".to_string()),
        "url_parse_task": serde_json::Value::Object(url_parse_task.clone()),
    });
    let args_json = truncate_prompt_text(
        serde_json::to_string(&args_payload).unwrap_or_else(|_| "{}".to_string()),
        4_000,
    );
    let task_json = truncate_prompt_text(
        serde_json::to_string(url_parse_task).unwrap_or_else(|_| "{}".to_string()),
        4_000,
    );
    let has_url = url.is_some();

    let mut lines = vec![
        URL_PARSE_SKILL_LAUNCH_PROMPT_MARKER.to_string(),
        "- 当前回合来自链接解析技能启动，不要把它当成普通聊天回答。".to_string(),
        "- 先快速归纳用户目标，然后立刻把任务交给 Skill 工具；不要停留在泛泛解释。".to_string(),
        format!("- 第一优先工具调用必须是 Skill，且 skill=\"{skill_name}\"。"),
        "- 调用 Skill 时，args 必须是一个严格 JSON 字符串，不要漏引号、不要写注释、不要只传半截字段。".to_string(),
        format!("- 推荐传给 Skill.args 的 JSON：{args_json}"),
        "- Skill 执行后，优先沿 url_parse skill 的 Bash / task file 主链提交异步任务；只有 Skill 明确不可用时，才允许直接回退到 lime_create_url_parse_task。".to_string(),
        "- 如果当前回合无法在预算内抓取并整理网页正文，也必须创建真实 url_parse task，并把 extractStatus 设为 pending_extract，而不是停留在空泛解释。".to_string(),
        "- 不要伪造“链接已解析完成”；只有 task payload 已经写入 summary / keyPoints 且 extractStatus=ready 时，才能声称已得到解析结果。".to_string(),
        format!("- 当前链接解析任务上下文(JSON)：{task_json}"),
        format!("- 当前入口来源：{entry_source}。"),
    ];

    if let Some(value) = prompt.as_deref() {
        lines.push(format!("- 当前解析目标：{value}"));
    }
    if let Some(value) = url.as_deref() {
        lines.push(format!("- 当前目标 URL：{value}。"));
    }
    if let Some(value) = extract_goal.as_deref() {
        lines.push(format!("- 当前抽取目标：{value}。"));
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

    if has_url {
        lines.push(
            "- 当前任务已经显式进入链接解析技能主链，不要再要求用户额外确认“是否开始解析链接”。"
                .to_string(),
        );
    } else {
        lines.push(
            "- 当前还缺少明确 URL。你最多只能追问 1 个关键问题，请用户补充完整链接；在 URL 补齐前不要创建任务，也不要伪造结果。"
                .to_string(),
        );
    }

    Some(lines.join("\n"))
}
