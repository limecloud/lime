use super::*;

const TYPESETTING_SKILL_LAUNCH_PROMPT_MARKER: &str = "<<LIME_TYPESETTING_SKILL_LAUNCH_HINT>>";
const TYPESETTING_SKILL_LAUNCH_DETOUR_DENY_PATTERNS: &[&str] = &[
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

pub(crate) fn prepare_typesetting_skill_launch_request_metadata(
    request_metadata: Option<&serde_json::Value>,
) -> Option<serde_json::Value> {
    let mut metadata = request_metadata.cloned()?;
    ensure_harness_workbench_chat_mode(
        &mut metadata,
        &["typesetting_skill_launch", "typesettingSkillLaunch"],
    );

    Some(metadata)
}

pub(crate) fn merge_system_prompt_with_typesetting_skill_launch(
    base_prompt: Option<String>,
    request_metadata: Option<&serde_json::Value>,
) -> Option<String> {
    let Some(launch_prompt) = build_typesetting_skill_launch_system_prompt(request_metadata) else {
        return base_prompt;
    };

    match base_prompt {
        Some(base) => {
            if base.contains(TYPESETTING_SKILL_LAUNCH_PROMPT_MARKER) {
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

pub(crate) fn should_lock_typesetting_skill_launch_to_typesetting(
    request_metadata: Option<&serde_json::Value>,
) -> bool {
    let Some(launch) = extract_harness_nested_object(
        request_metadata,
        &["typesetting_skill_launch", "typesettingSkillLaunch"],
    ) else {
        return false;
    };

    extract_object_string(launch, &["kind"]).unwrap_or_else(|| "typesetting_task".to_string())
        == "typesetting_task"
}

pub(crate) fn append_typesetting_skill_launch_session_permissions(
    permissions: &mut Vec<ToolPermission>,
    session_id: &str,
    request_metadata: Option<&serde_json::Value>,
) {
    if !should_lock_typesetting_skill_launch_to_typesetting(request_metadata) {
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
            description: Some("仅对当前排版技能启动回合生效".to_string()),
        }]
    };

    for pattern in TYPESETTING_SKILL_LAUNCH_DETOUR_DENY_PATTERNS {
        permissions.push(ToolPermission {
            tool: (*pattern).to_string(),
            allowed: false,
            priority: 1224,
            conditions: conditions.clone(),
            parameter_restrictions: Vec::new(),
            scope: PermissionScope::Session,
            reason: Some(
                "排版技能启动回合已锁定为 Skill(typesetting) 主链，禁止先走通用工具搜索/读文件链路偏航"
                    .to_string(),
            ),
            expires_at: None,
            metadata: HashMap::new(),
        });
    }
}

pub(crate) fn prune_typesetting_skill_launch_detour_tools_from_registry(
    registry: &mut aster::tools::ToolRegistry,
    request_metadata: Option<&serde_json::Value>,
) {
    if !should_lock_typesetting_skill_launch_to_typesetting(request_metadata) {
        return;
    }

    for tool_name in TYPESETTING_SKILL_LAUNCH_DETOUR_DENY_PATTERNS {
        registry.unregister(tool_name);
    }
}

fn build_typesetting_skill_launch_system_prompt(
    request_metadata: Option<&serde_json::Value>,
) -> Option<String> {
    let launch = extract_harness_nested_object(
        request_metadata,
        &["typesetting_skill_launch", "typesettingSkillLaunch"],
    )?;
    let kind =
        extract_object_string(launch, &["kind"]).unwrap_or_else(|| "typesetting_task".to_string());
    if kind != "typesetting_task" {
        return None;
    }

    let skill_name = extract_object_string(launch, &["skill_name", "skillName"])
        .unwrap_or_else(|| "typesetting".to_string());
    let typesetting_task = launch
        .get("typesetting_task")
        .and_then(serde_json::Value::as_object)?;
    let raw_text = extract_object_string(typesetting_task, &["raw_text", "rawText"]);
    let prompt = extract_object_string(typesetting_task, &["prompt"]);
    let content = extract_object_string(typesetting_task, &["content"]);
    let target_platform =
        extract_object_string(typesetting_task, &["target_platform", "targetPlatform"]);
    let session_id = extract_object_string(typesetting_task, &["session_id", "sessionId"]);
    let project_id = extract_object_string(typesetting_task, &["project_id", "projectId"]);
    let content_id = extract_object_string(typesetting_task, &["content_id", "contentId"]);
    let entry_source = extract_object_string(typesetting_task, &["entry_source", "entrySource"])
        .unwrap_or_else(|| "at_typesetting_command".to_string());
    let rules = typesetting_task
        .get("rules")
        .and_then(serde_json::Value::as_object)
        .cloned();
    let args_payload = serde_json::json!({
        "user_input": raw_text
            .clone()
            .or(prompt.clone())
            .or(content.clone())
            .unwrap_or_else(|| "请根据当前要求执行排版优化任务".to_string()),
        "typesetting_task": serde_json::Value::Object(typesetting_task.clone()),
    });
    let args_json = truncate_prompt_text(
        serde_json::to_string(&args_payload).unwrap_or_else(|_| "{}".to_string()),
        4_000,
    );
    let task_json = truncate_prompt_text(
        serde_json::to_string(typesetting_task).unwrap_or_else(|_| "{}".to_string()),
        4_000,
    );
    let content_present = content
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .is_some();

    let mut lines = vec![
        TYPESETTING_SKILL_LAUNCH_PROMPT_MARKER.to_string(),
        "- 当前回合来自排版技能启动，不要把它当成普通聊天回答。".to_string(),
        "- 先快速归纳用户目标，然后立刻把任务交给 Skill 工具；不要停留在泛泛解释。".to_string(),
        format!("- 第一优先工具调用必须是 Skill，且 skill=\"{skill_name}\"。"),
        "- 调用 Skill 时，args 必须是一个严格 JSON 字符串，不要漏引号、不要写注释、不要只传半截字段。".to_string(),
        format!("- 推荐传给 Skill.args 的 JSON：{args_json}"),
        format!(
            "- 第一工具调用示例(Skill 参数 JSON)：{{\"skill\":\"{skill_name}\",\"args\":{}}}",
            serde_json::to_string(&args_json).unwrap_or_else(|_| "\"{}\"".to_string())
        ),
        "- 当前回合已经显式知道要走排版技能主链，不要为了确认技能名、工具名或命令名再去调用 ToolSearch。".to_string(),
        "- 在 Skill(typesetting) 真正执行前，不要先走 ToolSearch / WebSearch / Read / Glob / Grep 等通用工具发现、检索或读文件链路。".to_string(),
        "- 不要搜索 “typesetting”、“lime task create typesetting --json” 或 “lime_create_typesetting_task” 之类目录信息；当前 typesetting_task 已经提供了足够上下文。".to_string(),
        "- 如果某个通用搜索/读文件工具因为 session policy 被拒绝，不要重复同类调用；应立即改为直调 Skill(typesetting)。".to_string(),
        "- Skill 执行后，优先沿 typesetting skill 的 Bash / task file 主链提交异步任务；只有 Skill 明确不可用时，才允许直接回退到 lime_create_typesetting_task。".to_string(),
        "- 不要伪造“排版已完成”；在 task file 真正返回结果前，只能汇报任务已提交、排队或执行中。".to_string(),
        format!("- 当前排版任务上下文(JSON)：{task_json}"),
        format!("- 当前入口来源：{entry_source}。"),
    ];

    if let Some(value) = prompt.as_deref() {
        lines.push(format!("- 当前排版目标：{value}"));
    }
    if let Some(value) = content.as_deref() {
        lines.push(format!(
            "- 当前待排版内容摘要：{}",
            truncate_prompt_text(value.to_string(), 400)
        ));
    }
    if let Some(value) = target_platform.as_deref() {
        lines.push(format!("- 当前目标平台：{value}。"));
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
    if let Some(value) = rules.as_ref() {
        lines.push(format!(
            "- 当前结构化规则(JSON)：{}",
            truncate_prompt_text(
                serde_json::to_string(value).unwrap_or_else(|_| "{}".to_string()),
                1_000,
            )
        ));
    }

    if content_present {
        lines.push(
            "- 当前任务已经显式进入排版技能主链，不要再要求用户额外确认“是否开始排版”。"
                .to_string(),
        );
    } else {
        lines.push(
            "- 当前还缺少明确待排版内容。你最多只能追问 1 个关键问题，请用户补充正文；在正文补齐前不要创建任务，也不要伪造结果。"
                .to_string(),
        );
    }

    Some(lines.join("\n"))
}
