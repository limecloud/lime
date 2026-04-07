use super::*;

const PRESENTATION_SKILL_LAUNCH_PROMPT_MARKER: &str = "<<LIME_PRESENTATION_SKILL_LAUNCH_HINT>>";
const PRESENTATION_SKILL_LAUNCH_DETOUR_DENY_PATTERNS: &[&str] = &[
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

fn extract_object_u64(
    object: &serde_json::Map<String, serde_json::Value>,
    keys: &[&str],
) -> Option<u64> {
    keys.iter()
        .filter_map(|key| object.get(*key))
        .find_map(|value| {
            value
                .as_u64()
                .or_else(|| value.as_i64().map(|raw| raw.max(0) as u64))
        })
        .filter(|value| *value > 0)
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

pub(crate) fn prepare_presentation_skill_launch_request_metadata(
    request_metadata: Option<&serde_json::Value>,
) -> Option<serde_json::Value> {
    let mut metadata = request_metadata.cloned()?;
    ensure_harness_workbench_chat_mode(
        &mut metadata,
        &["presentation_skill_launch", "presentationSkillLaunch"],
    );

    Some(metadata)
}

pub(crate) fn merge_system_prompt_with_presentation_skill_launch(
    base_prompt: Option<String>,
    request_metadata: Option<&serde_json::Value>,
) -> Option<String> {
    let Some(launch_prompt) = build_presentation_skill_launch_system_prompt(request_metadata)
    else {
        return base_prompt;
    };

    match base_prompt {
        Some(base) => {
            if base.contains(PRESENTATION_SKILL_LAUNCH_PROMPT_MARKER) {
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

pub(crate) fn should_lock_presentation_skill_launch_to_presentation_generate(
    request_metadata: Option<&serde_json::Value>,
) -> bool {
    let Some(launch) = extract_harness_nested_object(
        request_metadata,
        &["presentation_skill_launch", "presentationSkillLaunch"],
    ) else {
        return false;
    };

    extract_object_string(launch, &["kind"]).unwrap_or_else(|| "presentation_request".to_string())
        == "presentation_request"
}

pub(crate) fn append_presentation_skill_launch_session_permissions(
    permissions: &mut Vec<ToolPermission>,
    session_id: &str,
    request_metadata: Option<&serde_json::Value>,
) {
    if !should_lock_presentation_skill_launch_to_presentation_generate(request_metadata) {
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
            description: Some("仅对当前演示稿生成技能启动回合生效".to_string()),
        }]
    };

    for pattern in PRESENTATION_SKILL_LAUNCH_DETOUR_DENY_PATTERNS {
        permissions.push(ToolPermission {
            tool: (*pattern).to_string(),
            allowed: false,
            priority: 1224,
            conditions: conditions.clone(),
            parameter_restrictions: Vec::new(),
            scope: PermissionScope::Session,
            reason: Some(
                "演示稿生成技能启动回合已锁定为 Skill(presentation_generate) 主链，禁止先走通用工具搜索/读文件链路偏航"
                    .to_string(),
            ),
            expires_at: None,
            metadata: HashMap::new(),
        });
    }
}

pub(crate) fn prune_presentation_skill_launch_detour_tools_from_registry(
    registry: &mut aster::tools::ToolRegistry,
    request_metadata: Option<&serde_json::Value>,
) {
    if !should_lock_presentation_skill_launch_to_presentation_generate(request_metadata) {
        return;
    }

    for tool_name in PRESENTATION_SKILL_LAUNCH_DETOUR_DENY_PATTERNS {
        registry.unregister(tool_name);
    }
}

fn build_presentation_skill_launch_system_prompt(
    request_metadata: Option<&serde_json::Value>,
) -> Option<String> {
    let launch = extract_harness_nested_object(
        request_metadata,
        &["presentation_skill_launch", "presentationSkillLaunch"],
    )?;
    let kind = extract_object_string(launch, &["kind"])
        .unwrap_or_else(|| "presentation_request".to_string());
    if kind != "presentation_request" {
        return None;
    }

    let skill_name = extract_object_string(launch, &["skill_name", "skillName"])
        .unwrap_or_else(|| "presentation_generate".to_string());
    let presentation_request = launch
        .get("presentation_request")
        .and_then(serde_json::Value::as_object)?;
    let raw_text = extract_object_string(presentation_request, &["raw_text", "rawText"]);
    let prompt = extract_object_string(presentation_request, &["prompt"])
        .unwrap_or_else(|| "请生成一份可直接讲述的演示文稿草稿".to_string());
    let content = extract_object_string(presentation_request, &["content"]);
    let deck_type = extract_object_string(presentation_request, &["deck_type", "deckType"]);
    let style = extract_object_string(presentation_request, &["style"]);
    let audience = extract_object_string(presentation_request, &["audience"]);
    let slide_count = extract_object_u64(presentation_request, &["slide_count", "slideCount"]);
    let project_id = extract_object_string(presentation_request, &["project_id", "projectId"]);
    let content_id = extract_object_string(presentation_request, &["content_id", "contentId"]);
    let entry_source =
        extract_object_string(presentation_request, &["entry_source", "entrySource"])
            .unwrap_or_else(|| "at_presentation_command".to_string());
    let args_payload = serde_json::json!({
        "user_input": raw_text.clone().unwrap_or_else(|| prompt.clone()),
        "presentation_request": serde_json::Value::Object(presentation_request.clone()),
    });
    let args_json = truncate_prompt_text(
        serde_json::to_string(&args_payload).unwrap_or_else(|_| "{}".to_string()),
        4_000,
    );
    let request_json = truncate_prompt_text(
        serde_json::to_string(presentation_request).unwrap_or_else(|_| "{}".to_string()),
        4_000,
    );

    let mut lines = vec![
        PRESENTATION_SKILL_LAUNCH_PROMPT_MARKER.to_string(),
        "- 当前回合来自演示稿生成技能启动，不要把它当成普通聊天回答。".to_string(),
        "- 先快速归纳用户的演示目标，然后立刻把任务交给 Skill 工具；不要停留在泛泛解释。".to_string(),
        format!("- 第一优先工具调用必须是 Skill，且 skill=\"{skill_name}\"。"),
        "- 调用 Skill 时，args 必须是一个严格 JSON 字符串，不要漏引号、不要写注释、不要只传半截字段。".to_string(),
        format!("- 推荐传给 Skill.args 的 JSON：{args_json}"),
        format!(
            "- 第一工具调用示例(Skill 参数 JSON)：{{\"skill\":\"{skill_name}\",\"args\":{}}}",
            serde_json::to_string(&args_json).unwrap_or_else(|_| "\"{}\"".to_string())
        ),
        "- 当前回合已经显式知道要走演示稿生成技能主链，不要为了确认技能名、工具名或命令名再去调用 ToolSearch。".to_string(),
        "- 在 Skill(presentation_generate) 真正执行前，不要先走 ToolSearch / WebSearch / Read / Glob / Grep 等通用工具发现、检索或读文件链路。".to_string(),
        "- 当前命令的目标是产出真实演示稿 artifact，不要先退回空泛大纲，也不要只给口头建议。".to_string(),
        "- 如果某个通用搜索/读文件工具因为 session policy 被拒绝，不要重复同类调用；应立即改为直调 Skill(presentation_generate)。".to_string(),
        "- Skill 执行时必须产出一个可预览、可继续导出的单文件演示稿，并通过 <write_file> 落到工作区。".to_string(),
        "- 不要伪造“演示稿已生成”但没有实际文件；如果信息不足，最多追问 1 个关键问题。".to_string(),
        format!("- 当前演示请求上下文(JSON)：{request_json}"),
        format!("- 当前入口来源：{entry_source}。"),
    ];

    lines.push(format!("- 当前演示目标：{prompt}"));
    if let Some(value) = content.as_deref() {
        lines.push(format!(
            "- 当前原始命令摘要：{}",
            truncate_prompt_text(value.to_string(), 400)
        ));
    }
    if let Some(value) = deck_type.as_deref() {
        lines.push(format!("- 当前演示类型：{value}。"));
    }
    if let Some(value) = style.as_deref() {
        lines.push(format!("- 当前风格要求：{value}。"));
    }
    if let Some(value) = audience.as_deref() {
        lines.push(format!("- 当前受众：{value}。"));
    }
    if let Some(value) = slide_count {
        lines.push(format!("- 当前目标页数：{value} 页。"));
    }
    if let Some(value) = project_id.as_deref() {
        lines.push(format!("- 当前 project_id：{value}。"));
    }
    if let Some(value) = content_id.as_deref() {
        lines.push(format!("- 当前 content_id：{value}。"));
    }
    lines.push("- 当前任务已经显式进入演示稿生成技能主链。".to_string());

    Some(lines.join("\n"))
}
