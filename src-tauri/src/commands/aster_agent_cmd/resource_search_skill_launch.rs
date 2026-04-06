use super::*;

const RESOURCE_SEARCH_SKILL_LAUNCH_PROMPT_MARKER: &str =
    "<<LIME_RESOURCE_SEARCH_SKILL_LAUNCH_HINT>>";

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

pub(crate) fn prepare_resource_search_skill_launch_request_metadata(
    request_metadata: Option<&serde_json::Value>,
) -> Option<serde_json::Value> {
    let mut metadata = request_metadata.cloned()?;
    ensure_harness_workbench_chat_mode(
        &mut metadata,
        &["resource_search_skill_launch", "resourceSearchSkillLaunch"],
    );

    Some(metadata)
}

pub(crate) fn merge_system_prompt_with_resource_search_skill_launch(
    base_prompt: Option<String>,
    request_metadata: Option<&serde_json::Value>,
) -> Option<String> {
    let Some(launch_prompt) = build_resource_search_skill_launch_system_prompt(request_metadata)
    else {
        return base_prompt;
    };

    match base_prompt {
        Some(base) => {
            if base.contains(RESOURCE_SEARCH_SKILL_LAUNCH_PROMPT_MARKER) {
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

fn build_resource_search_skill_launch_system_prompt(
    request_metadata: Option<&serde_json::Value>,
) -> Option<String> {
    let launch = extract_harness_nested_object(
        request_metadata,
        &["resource_search_skill_launch", "resourceSearchSkillLaunch"],
    )?;
    let kind = extract_object_string(launch, &["kind"])
        .unwrap_or_else(|| "resource_search_task".to_string());
    if kind != "resource_search_task" {
        return None;
    }

    let skill_name = extract_object_string(launch, &["skill_name", "skillName"])
        .unwrap_or_else(|| "modal_resource_search".to_string());
    let resource_search_task = launch
        .get("resource_search_task")
        .and_then(serde_json::Value::as_object)?;
    let raw_text = extract_object_string(resource_search_task, &["raw_text", "rawText"]);
    let prompt = extract_object_string(resource_search_task, &["prompt"]);
    let title = extract_object_string(resource_search_task, &["title"]);
    let resource_type =
        extract_object_string(resource_search_task, &["resource_type", "resourceType"]);
    let query = extract_object_string(resource_search_task, &["query"]);
    let usage = extract_object_string(resource_search_task, &["usage"]);
    let session_id = extract_object_string(resource_search_task, &["session_id", "sessionId"]);
    let project_id = extract_object_string(resource_search_task, &["project_id", "projectId"]);
    let content_id = extract_object_string(resource_search_task, &["content_id", "contentId"]);
    let count = resource_search_task
        .get("count")
        .and_then(serde_json::Value::as_u64);
    let filters = resource_search_task
        .get("filters")
        .and_then(serde_json::Value::as_object)
        .cloned();
    let entry_source =
        extract_object_string(resource_search_task, &["entry_source", "entrySource"])
            .unwrap_or_else(|| "at_resource_search_command".to_string());
    let args_payload = serde_json::json!({
        "user_input": raw_text
            .clone()
            .or(prompt.clone())
            .or(query.clone())
            .unwrap_or_else(|| "请根据当前要求执行素材检索任务".to_string()),
        "resource_search_task": serde_json::Value::Object(resource_search_task.clone()),
    });
    let args_json = truncate_prompt_text(
        serde_json::to_string(&args_payload).unwrap_or_else(|_| "{}".to_string()),
        4_000,
    );
    let task_json = truncate_prompt_text(
        serde_json::to_string(resource_search_task).unwrap_or_else(|_| "{}".to_string()),
        4_000,
    );
    let has_resource_type = resource_type
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .is_some();
    let has_query = query
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .is_some();

    let mut lines = vec![
        RESOURCE_SEARCH_SKILL_LAUNCH_PROMPT_MARKER.to_string(),
        "- 当前回合来自素材检索技能启动，不要把它当成普通聊天回答。".to_string(),
        "- 先快速归纳用户的素材目标，然后立刻把任务交给 Skill 工具；不要停留在泛泛解释。".to_string(),
        format!("- 第一优先工具调用必须是 Skill，且 skill=\"{skill_name}\"。"),
        "- 调用 Skill 时，args 必须是一个严格 JSON 字符串，不要漏引号、不要写注释、不要只传半截字段。".to_string(),
        format!("- 推荐传给 Skill.args 的 JSON：{args_json}"),
        format!("- 当前素材检索任务上下文(JSON)：{task_json}"),
        format!("- 当前入口来源：{entry_source}。"),
    ];

    if let Some(value) = prompt.as_deref() {
        lines.push(format!("- 当前检索目标：{value}"));
    }
    if let Some(value) = title.as_deref() {
        lines.push(format!("- 当前任务标题：{value}。"));
    }
    if let Some(value) = resource_type.as_deref() {
        lines.push(format!("- 当前资源类型：{value}。"));
    }
    if let Some(value) = query.as_deref() {
        lines.push(format!("- 当前检索关键词：{value}。"));
    }
    if let Some(value) = usage.as_deref() {
        lines.push(format!("- 当前使用场景：{value}。"));
    }
    if let Some(value) = count {
        lines.push(format!("- 当前候选数量：{value}。"));
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
    if let Some(value) = filters.as_ref() {
        lines.push(format!(
            "- 当前过滤条件(JSON)：{}",
            truncate_prompt_text(
                serde_json::to_string(value).unwrap_or_else(|_| "{}".to_string()),
                1_000,
            )
        ));
    }

    if matches!(resource_type.as_deref(), Some("image")) && has_query {
        lines.push(
            "- 当前是图片素材检索。Skill 内必须优先调用 lime_search_web_images 直接搜图，不要先走 ToolSearch / WebSearch / Grep 等长链工具搜索。"
                .to_string(),
        );
        lines.push(
            "- 若 lime_search_web_images 返回候选，直接汇总候选摘要与来源，不要伪造“任务已创建”。只有 Pexels API Key 未配置、无结果，或用户明确要求异步追踪时，才回退 Bash / lime_create_modal_resource_search_task。"
                .to_string(),
        );
    } else {
        lines.push(
            "- Skill 执行后，优先沿 modal_resource_search skill 的 Bash / task file 主链提交异步任务；只有 Skill 明确不可用时，才允许直接回退到 lime_create_modal_resource_search_task。"
                .to_string(),
        );
        lines.push(
            "- 不要伪造“素材已检索完成”；在 task file 真正返回候选前，只能汇报任务已提交、排队或执行中。"
                .to_string(),
        );
    }

    if has_resource_type && has_query {
        lines.push(
            "- 当前任务已经显式进入素材检索技能主链，不要再要求用户额外确认“是否开始检索素材”。"
                .to_string(),
        );
    } else {
        lines.push(
            "- 当前还缺少明确资源类型或检索关键词。你最多只能追问 1 个关键问题，请用户补充最关键缺口；在信息补齐前不要创建任务，也不要伪造结果。"
                .to_string(),
        );
    }

    Some(lines.join("\n"))
}
