use super::*;

const FORM_SKILL_LAUNCH_PROMPT_MARKER: &str = "<<LIME_FORM_SKILL_LAUNCH_HINT>>";
const FORM_SKILL_LAUNCH_DETOUR_DENY_PATTERNS: &[&str] = &[
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

pub(crate) fn prepare_form_skill_launch_request_metadata(
    request_metadata: Option<&serde_json::Value>,
) -> Option<serde_json::Value> {
    let mut metadata = request_metadata.cloned()?;
    ensure_harness_workbench_chat_mode(&mut metadata, &["form_skill_launch", "formSkillLaunch"]);

    Some(metadata)
}

pub(crate) fn merge_system_prompt_with_form_skill_launch(
    base_prompt: Option<String>,
    request_metadata: Option<&serde_json::Value>,
) -> Option<String> {
    let Some(launch_prompt) = build_form_skill_launch_system_prompt(request_metadata) else {
        return base_prompt;
    };

    match base_prompt {
        Some(base) => {
            if base.contains(FORM_SKILL_LAUNCH_PROMPT_MARKER) {
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

pub(crate) fn should_lock_form_skill_launch_to_form_generate(
    request_metadata: Option<&serde_json::Value>,
) -> bool {
    let Some(launch) =
        extract_harness_nested_object(request_metadata, &["form_skill_launch", "formSkillLaunch"])
    else {
        return false;
    };

    extract_object_string(launch, &["kind"]).unwrap_or_else(|| "form_request".to_string())
        == "form_request"
}

pub(crate) fn append_form_skill_launch_session_permissions(
    permissions: &mut Vec<ToolPermission>,
    session_id: &str,
    request_metadata: Option<&serde_json::Value>,
) {
    if !should_lock_form_skill_launch_to_form_generate(request_metadata) {
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
            description: Some("仅对当前表单生成技能启动回合生效".to_string()),
        }]
    };

    for pattern in FORM_SKILL_LAUNCH_DETOUR_DENY_PATTERNS {
        permissions.push(ToolPermission {
            tool: (*pattern).to_string(),
            allowed: false,
            priority: 1225,
            conditions: conditions.clone(),
            parameter_restrictions: Vec::new(),
            scope: PermissionScope::Session,
            reason: Some(
                "表单生成技能启动回合已锁定为 Skill(form_generate) 主链，禁止先走通用工具搜索/读文件链路偏航"
                    .to_string(),
            ),
            expires_at: None,
            metadata: HashMap::new(),
        });
    }
}

pub(crate) fn prune_form_skill_launch_detour_tools_from_registry(
    registry: &mut aster::tools::ToolRegistry,
    request_metadata: Option<&serde_json::Value>,
) {
    if !should_lock_form_skill_launch_to_form_generate(request_metadata) {
        return;
    }

    for tool_name in FORM_SKILL_LAUNCH_DETOUR_DENY_PATTERNS {
        registry.unregister(tool_name);
    }
}

fn build_form_skill_launch_system_prompt(
    request_metadata: Option<&serde_json::Value>,
) -> Option<String> {
    let launch =
        extract_harness_nested_object(request_metadata, &["form_skill_launch", "formSkillLaunch"])?;
    let kind =
        extract_object_string(launch, &["kind"]).unwrap_or_else(|| "form_request".to_string());
    if kind != "form_request" {
        return None;
    }

    let skill_name = extract_object_string(launch, &["skill_name", "skillName"])
        .unwrap_or_else(|| "form_generate".to_string());
    let form_request = launch
        .get("form_request")
        .and_then(serde_json::Value::as_object)?;
    let raw_text = extract_object_string(form_request, &["raw_text", "rawText"]);
    let prompt = extract_object_string(form_request, &["prompt"])
        .unwrap_or_else(|| "请生成一个可直接使用的 A2UI 表单".to_string());
    let content = extract_object_string(form_request, &["content"]);
    let form_type = extract_object_string(form_request, &["form_type", "formType"]);
    let style = extract_object_string(form_request, &["style"]);
    let audience = extract_object_string(form_request, &["audience"]);
    let field_count = extract_object_u64(form_request, &["field_count", "fieldCount"]);
    let project_id = extract_object_string(form_request, &["project_id", "projectId"]);
    let content_id = extract_object_string(form_request, &["content_id", "contentId"]);
    let entry_source = extract_object_string(form_request, &["entry_source", "entrySource"])
        .unwrap_or_else(|| "at_form_command".to_string());
    let args_payload = serde_json::json!({
        "user_input": raw_text.clone().unwrap_or_else(|| prompt.clone()),
        "form_request": serde_json::Value::Object(form_request.clone()),
    });
    let args_json = truncate_prompt_text(
        serde_json::to_string(&args_payload).unwrap_or_else(|_| "{}".to_string()),
        4_000,
    );
    let request_json = truncate_prompt_text(
        serde_json::to_string(form_request).unwrap_or_else(|_| "{}".to_string()),
        4_000,
    );

    let mut lines = vec![
        FORM_SKILL_LAUNCH_PROMPT_MARKER.to_string(),
        "- 当前回合来自表单生成技能启动，不要把它当成普通聊天回答。".to_string(),
        "- 先快速归纳用户的表单目标，然后立刻把任务交给 Skill 工具；不要停留在泛泛解释。".to_string(),
        format!("- 第一优先工具调用必须是 Skill，且 skill=\"{skill_name}\"。"),
        "- 调用 Skill 时，args 必须是一个严格 JSON 字符串，不要漏引号、不要写注释、不要只传半截字段。".to_string(),
        format!("- 推荐传给 Skill.args 的 JSON：{args_json}"),
        format!(
            "- 第一工具调用示例(Skill 参数 JSON)：{{\"skill\":\"{skill_name}\",\"args\":{}}}",
            serde_json::to_string(&args_json).unwrap_or_else(|_| "\"{}\"".to_string())
        ),
        "- 当前回合已经显式知道要走表单生成技能主链，不要为了确认技能名、工具名或命令名再去调用 ToolSearch。".to_string(),
        "- 在 Skill(form_generate) 真正执行前，不要先走 ToolSearch / WebSearch / Read / Glob / Grep 等通用工具发现、检索或读文件链路。".to_string(),
        "- 目标是复用 Lime 现有 A2UI 协议输出一份真实可渲染的表单，不要退回纯文本问题列表，也不要输出另一套自定义表单 DSL。".to_string(),
        "- 最终结果必须输出一个 ```a2ui 代码块，并在代码块内放一份可被现有 A2UI parser 识别的 JSON。".to_string(),
        "- 优先输出简化表单格式：{ \"type\": \"form\", \"title\": \"...\", \"description\": \"...\", \"fields\": [...], \"submitLabel\": \"提交\" }。".to_string(),
        "- 字段类型只允许使用 simple form 已支持的 choice / text / slider / checkbox；不要发明 DatePicker、FileUpload 等当前 simple form 还未支持的字段。".to_string(),
        "- 若用户要求报名/线索表单，应至少包含联系人字段与隐私同意 checkbox；若是问卷/反馈表单，应优先使用 choice、slider 和 text 组合。".to_string(),
        "- 如信息不足，最多追问 1 个关键问题；除非真的缺失目标，否则不要停在追问。".to_string(),
        format!("- 当前表单请求上下文(JSON)：{request_json}"),
        format!("- 当前入口来源：{entry_source}。"),
    ];

    lines.push(format!("- 当前表单目标：{prompt}"));
    if let Some(value) = content.as_deref() {
        lines.push(format!(
            "- 当前原始命令摘要：{}",
            truncate_prompt_text(value.to_string(), 400)
        ));
    }
    if let Some(value) = form_type.as_deref() {
        lines.push(format!("- 当前表单类型：{value}。"));
    }
    if let Some(value) = style.as_deref() {
        lines.push(format!("- 当前风格要求：{value}。"));
    }
    if let Some(value) = audience.as_deref() {
        lines.push(format!("- 当前目标受众：{value}。"));
    }
    if let Some(value) = field_count {
        lines.push(format!("- 目标字段数：{value}。"));
    }
    if let Some(value) = project_id.as_deref() {
        lines.push(format!("- 当前项目 ID：{value}。"));
    }
    if let Some(value) = content_id.as_deref() {
        lines.push(format!("- 当前内容 ID：{value}。"));
    }
    lines.push("- 不要输出 `<write_file>`、HTML、Markdown 表格或伪代码来替代 A2UI；这次需要直接复用现有 A2UI 渲染链。".to_string());

    Some(lines.join("\n"))
}
