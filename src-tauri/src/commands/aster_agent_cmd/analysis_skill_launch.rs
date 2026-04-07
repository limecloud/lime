use super::*;

const ANALYSIS_SKILL_LAUNCH_PROMPT_MARKER: &str = "<<LIME_ANALYSIS_SKILL_LAUNCH_HINT>>";
const ANALYSIS_SKILL_LAUNCH_DETOUR_DENY_PATTERNS: &[&str] = &[
    TOOL_SEARCH_TOOL_NAME,
    "WebSearch",
    "web_search",
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

pub(crate) fn prepare_analysis_skill_launch_request_metadata(
    request_metadata: Option<&serde_json::Value>,
) -> Option<serde_json::Value> {
    let mut metadata = request_metadata.cloned()?;
    ensure_harness_workbench_chat_mode(
        &mut metadata,
        &["analysis_skill_launch", "analysisSkillLaunch"],
    );

    Some(metadata)
}

pub(crate) fn merge_system_prompt_with_analysis_skill_launch(
    base_prompt: Option<String>,
    request_metadata: Option<&serde_json::Value>,
) -> Option<String> {
    let Some(launch_prompt) = build_analysis_skill_launch_system_prompt(request_metadata) else {
        return base_prompt;
    };

    match base_prompt {
        Some(base) => {
            if base.contains(ANALYSIS_SKILL_LAUNCH_PROMPT_MARKER) {
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

pub(crate) fn should_lock_analysis_skill_launch_to_analysis(
    request_metadata: Option<&serde_json::Value>,
) -> bool {
    let Some(launch) = extract_harness_nested_object(
        request_metadata,
        &["analysis_skill_launch", "analysisSkillLaunch"],
    ) else {
        return false;
    };

    extract_object_string(launch, &["kind"]).unwrap_or_else(|| "analysis_request".to_string())
        == "analysis_request"
}

pub(crate) fn append_analysis_skill_launch_session_permissions(
    permissions: &mut Vec<ToolPermission>,
    session_id: &str,
    request_metadata: Option<&serde_json::Value>,
) {
    if !should_lock_analysis_skill_launch_to_analysis(request_metadata) {
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
            description: Some("仅对当前分析技能启动回合生效".to_string()),
        }]
    };

    for pattern in ANALYSIS_SKILL_LAUNCH_DETOUR_DENY_PATTERNS {
        permissions.push(ToolPermission {
            tool: (*pattern).to_string(),
            allowed: false,
            priority: 1227,
            conditions: conditions.clone(),
            parameter_restrictions: Vec::new(),
            scope: PermissionScope::Session,
            reason: Some(
                "分析技能启动回合已锁定为 Skill(analysis) 主链，禁止先走工具目录/联网检索偏航"
                    .to_string(),
            ),
            expires_at: None,
            metadata: HashMap::new(),
        });
    }
}

pub(crate) fn prune_analysis_skill_launch_detour_tools_from_registry(
    registry: &mut aster::tools::ToolRegistry,
    request_metadata: Option<&serde_json::Value>,
) {
    if !should_lock_analysis_skill_launch_to_analysis(request_metadata) {
        return;
    }

    for tool_name in ANALYSIS_SKILL_LAUNCH_DETOUR_DENY_PATTERNS {
        registry.unregister(tool_name);
    }
}

fn build_analysis_skill_launch_system_prompt(
    request_metadata: Option<&serde_json::Value>,
) -> Option<String> {
    let launch = extract_harness_nested_object(
        request_metadata,
        &["analysis_skill_launch", "analysisSkillLaunch"],
    )?;
    let kind =
        extract_object_string(launch, &["kind"]).unwrap_or_else(|| "analysis_request".to_string());
    if kind != "analysis_request" {
        return None;
    }

    let skill_name = extract_object_string(launch, &["skill_name", "skillName"])
        .unwrap_or_else(|| "analysis".to_string());
    let analysis_request = launch
        .get("analysis_request")
        .and_then(serde_json::Value::as_object)?;
    let raw_text = extract_object_string(analysis_request, &["raw_text", "rawText"]);
    let prompt = extract_object_string(analysis_request, &["prompt"])
        .unwrap_or_else(|| "请分析当前对话中最相关的内容".to_string());
    let content = extract_object_string(analysis_request, &["content"]);
    let focus = extract_object_string(analysis_request, &["focus"]);
    let style = extract_object_string(analysis_request, &["style"]);
    let output_format = extract_object_string(analysis_request, &["output_format", "outputFormat"]);
    let project_id = extract_object_string(analysis_request, &["project_id", "projectId"]);
    let content_id = extract_object_string(analysis_request, &["content_id", "contentId"]);
    let entry_source = extract_object_string(analysis_request, &["entry_source", "entrySource"])
        .unwrap_or_else(|| "at_analysis_command".to_string());
    let args_payload = serde_json::json!({
        "user_input": raw_text.clone().unwrap_or_else(|| prompt.clone()),
        "analysis_request": serde_json::Value::Object(analysis_request.clone()),
    });
    let args_json = truncate_prompt_text(
        serde_json::to_string(&args_payload).unwrap_or_else(|_| "{}".to_string()),
        4_000,
    );
    let request_json = truncate_prompt_text(
        serde_json::to_string(analysis_request).unwrap_or_else(|_| "{}".to_string()),
        4_000,
    );
    let has_explicit_content = content
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .is_some();

    let mut lines = vec![
        ANALYSIS_SKILL_LAUNCH_PROMPT_MARKER.to_string(),
        "- 当前回合来自分析技能启动，不要把它当成普通聊天回答。".to_string(),
        "- 先快速判断要分析什么，再立刻把任务交给 Skill 工具；不要直接跳过 Skill 在聊天区作答。"
            .to_string(),
        format!("- 第一优先工具调用必须是 Skill，且 skill=\"{skill_name}\"。"),
        "- 调用 Skill 时，args 必须是一个严格 JSON 字符串，不要漏引号、不要写注释、不要只传半截字段。".to_string(),
        format!("- 推荐传给 Skill.args 的 JSON：{args_json}"),
        format!(
            "- 第一工具调用示例(Skill 参数 JSON)：{{\"skill\":\"{skill_name}\",\"args\":{}}}",
            serde_json::to_string(&args_json).unwrap_or_else(|_| "\"{}\"".to_string())
        ),
        "- 当前回合已经显式知道要走分析技能主链，不要为了确认技能名、工具名或命令名再去调用 ToolSearch。".to_string(),
        "- 在 Skill(analysis) 真正执行前，不要先走 ToolSearch / WebSearch / Grep 等工具目录发现、联网检索或内容检索偏航。".to_string(),
        "- 不要先搜索 “analysis”、“read_file” 或 “list_directory” 的目录信息；当前 analysis_request 已经提供了足够上下文。".to_string(),
        "- 如果某个通用搜索工具因为 session policy 被拒绝，不要重复同类调用；应立即改为直调 Skill(analysis)。".to_string(),
        "- 这条命令属于 prompt skill 主链，不要创建 task file，也不要回退成普通聊天分析。".to_string(),
        "- 若用户明确给了正文、文件路径或范围，优先分析这些材料；若未明确给材料，则分析当前对话中与请求最相关的内容。".to_string(),
        "- 如需处理本地路径或目录，只允许在 Skill(analysis) 内最小化使用 Read / Glob 确认必要内容；不要在进入 Skill 前先探测大量文件。".to_string(),
        "- 分析结果必须区分原文事实、你的判断与待确认项，不要把推断写成已确认事实。".to_string(),
        format!("- 当前分析请求上下文(JSON)：{request_json}"),
        format!("- 当前入口来源：{entry_source}。"),
        format!("- 当前分析目标：{prompt}"),
    ];

    if let Some(value) = content.as_deref() {
        lines.push(format!("- 当前显式正文：{value}。"));
    }
    if let Some(value) = focus.as_deref() {
        lines.push(format!("- 当前分析重点：{value}。"));
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
            .push("- 当前任务已经显式进入分析技能主链，不要再追问用户“是否开始分析”。".to_string());
    } else {
        lines.push(
            "- 当前没有显式正文时，优先尝试分析当前对话上下文；只有在上下文也不足以完成时，才最多追问 1 个关键问题。"
                .to_string(),
        );
    }

    Some(lines.join("\n"))
}
