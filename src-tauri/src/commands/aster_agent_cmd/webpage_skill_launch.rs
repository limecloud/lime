use super::*;

const WEBPAGE_SKILL_LAUNCH_PROMPT_MARKER: &str = "<<LIME_WEBPAGE_SKILL_LAUNCH_HINT>>";
const WEBPAGE_SKILL_LAUNCH_DETOUR_DENY_PATTERNS: &[&str] = &[
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

pub(crate) fn prepare_webpage_skill_launch_request_metadata(
    request_metadata: Option<&serde_json::Value>,
) -> Option<serde_json::Value> {
    let mut metadata = request_metadata.cloned()?;
    ensure_harness_workbench_chat_mode(
        &mut metadata,
        &["webpage_skill_launch", "webpageSkillLaunch"],
    );

    Some(metadata)
}

pub(crate) fn merge_system_prompt_with_webpage_skill_launch(
    base_prompt: Option<String>,
    request_metadata: Option<&serde_json::Value>,
) -> Option<String> {
    let Some(launch_prompt) = build_webpage_skill_launch_system_prompt(request_metadata) else {
        return base_prompt;
    };

    match base_prompt {
        Some(base) => {
            if base.contains(WEBPAGE_SKILL_LAUNCH_PROMPT_MARKER) {
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

pub(crate) fn should_lock_webpage_skill_launch_to_webpage_generate(
    request_metadata: Option<&serde_json::Value>,
) -> bool {
    let Some(launch) = extract_harness_nested_object(
        request_metadata,
        &["webpage_skill_launch", "webpageSkillLaunch"],
    ) else {
        return false;
    };

    extract_object_string(launch, &["kind"]).unwrap_or_else(|| "webpage_request".to_string())
        == "webpage_request"
}

pub(crate) fn append_webpage_skill_launch_session_permissions(
    permissions: &mut Vec<ToolPermission>,
    session_id: &str,
    request_metadata: Option<&serde_json::Value>,
) {
    if !should_lock_webpage_skill_launch_to_webpage_generate(request_metadata) {
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
            description: Some("仅对当前网页生成技能启动回合生效".to_string()),
        }]
    };

    for pattern in WEBPAGE_SKILL_LAUNCH_DETOUR_DENY_PATTERNS {
        permissions.push(ToolPermission {
            tool: (*pattern).to_string(),
            allowed: false,
            priority: 1223,
            conditions: conditions.clone(),
            parameter_restrictions: Vec::new(),
            scope: PermissionScope::Session,
            reason: Some(
                "网页生成技能启动回合已锁定为 Skill(webpage_generate) 主链，禁止先走通用工具搜索/读文件链路偏航"
                    .to_string(),
            ),
            expires_at: None,
            metadata: HashMap::new(),
        });
    }
}

pub(crate) fn prune_webpage_skill_launch_detour_tools_from_registry(
    registry: &mut aster::tools::ToolRegistry,
    request_metadata: Option<&serde_json::Value>,
) {
    if !should_lock_webpage_skill_launch_to_webpage_generate(request_metadata) {
        return;
    }

    for tool_name in WEBPAGE_SKILL_LAUNCH_DETOUR_DENY_PATTERNS {
        registry.unregister(tool_name);
    }
}

fn build_webpage_skill_launch_system_prompt(
    request_metadata: Option<&serde_json::Value>,
) -> Option<String> {
    let launch = extract_harness_nested_object(
        request_metadata,
        &["webpage_skill_launch", "webpageSkillLaunch"],
    )?;
    let kind =
        extract_object_string(launch, &["kind"]).unwrap_or_else(|| "webpage_request".to_string());
    if kind != "webpage_request" {
        return None;
    }

    let skill_name = extract_object_string(launch, &["skill_name", "skillName"])
        .unwrap_or_else(|| "webpage_generate".to_string());
    let webpage_request = launch
        .get("webpage_request")
        .and_then(serde_json::Value::as_object)?;
    let raw_text = extract_object_string(webpage_request, &["raw_text", "rawText"]);
    let prompt = extract_object_string(webpage_request, &["prompt"])
        .unwrap_or_else(|| "请生成一个可直接预览的网页".to_string());
    let content = extract_object_string(webpage_request, &["content"]);
    let page_type = extract_object_string(webpage_request, &["page_type", "pageType"]);
    let style = extract_object_string(webpage_request, &["style"]);
    let tech_stack = extract_object_string(webpage_request, &["tech_stack", "techStack"]);
    let project_id = extract_object_string(webpage_request, &["project_id", "projectId"]);
    let content_id = extract_object_string(webpage_request, &["content_id", "contentId"]);
    let entry_source = extract_object_string(webpage_request, &["entry_source", "entrySource"])
        .unwrap_or_else(|| "at_webpage_command".to_string());
    let args_payload = serde_json::json!({
        "user_input": raw_text.clone().unwrap_or_else(|| prompt.clone()),
        "webpage_request": serde_json::Value::Object(webpage_request.clone()),
    });
    let args_json = truncate_prompt_text(
        serde_json::to_string(&args_payload).unwrap_or_else(|_| "{}".to_string()),
        4_000,
    );
    let request_json = truncate_prompt_text(
        serde_json::to_string(webpage_request).unwrap_or_else(|_| "{}".to_string()),
        4_000,
    );

    let mut lines = vec![
        WEBPAGE_SKILL_LAUNCH_PROMPT_MARKER.to_string(),
        "- 当前回合来自网页生成技能启动，不要把它当成普通聊天回答。".to_string(),
        "- 先快速归纳用户网页目标，然后立刻把任务交给 Skill 工具；不要停留在泛泛解释。".to_string(),
        format!("- 第一优先工具调用必须是 Skill，且 skill=\"{skill_name}\"。"),
        "- 调用 Skill 时，args 必须是一个严格 JSON 字符串，不要漏引号、不要写注释、不要只传半截字段。".to_string(),
        format!("- 推荐传给 Skill.args 的 JSON：{args_json}"),
        format!(
            "- 第一工具调用示例(Skill 参数 JSON)：{{\"skill\":\"{skill_name}\",\"args\":{}}}",
            serde_json::to_string(&args_json).unwrap_or_else(|_| "\"{}\"".to_string())
        ),
        "- 当前回合已经显式知道要走网页生成技能主链，不要为了确认技能名、工具名或命令名再去调用 ToolSearch。".to_string(),
        "- 在 Skill(webpage_generate) 真正执行前，不要先走 ToolSearch / WebSearch / Read / Glob / Grep 等通用工具发现、检索或读文件链路。".to_string(),
        "- 当前网页命令的目标是产出真实 HTML artifact，不要先退回空泛文案，也不要只给伪代码或结构说明。".to_string(),
        "- 如果某个通用搜索/读文件工具因为 session policy 被拒绝，不要重复同类调用；应立即改为直调 Skill(webpage_generate)。".to_string(),
        "- Skill 执行时必须产出一个可预览的单文件 HTML，并通过 <write_file> 落到工作区。".to_string(),
        "- 不要伪造“网页已生成”但没有实际文件；如果信息不足，最多追问 1 个关键问题。".to_string(),
        format!("- 当前网页请求上下文(JSON)：{request_json}"),
        format!("- 当前入口来源：{entry_source}。"),
    ];

    lines.push(format!("- 当前网页目标：{prompt}"));
    if let Some(value) = content.as_deref() {
        lines.push(format!(
            "- 当前原始命令摘要：{}",
            truncate_prompt_text(value.to_string(), 400)
        ));
    }
    if let Some(value) = page_type.as_deref() {
        lines.push(format!("- 当前页面类型：{value}。"));
    }
    if let Some(value) = style.as_deref() {
        lines.push(format!("- 当前风格要求：{value}。"));
    }
    if let Some(value) = tech_stack.as_deref() {
        lines.push(format!("- 当前技术偏好：{value}。"));
    }
    if let Some(value) = project_id.as_deref() {
        lines.push(format!("- 当前 project_id：{value}。"));
    }
    if let Some(value) = content_id.as_deref() {
        lines.push(format!("- 当前 content_id：{value}。"));
    }
    lines.push("- 当前任务已经显式进入网页生成技能主链。".to_string());

    Some(lines.join("\n"))
}
