use super::*;

const PDF_READ_SKILL_LAUNCH_PROMPT_MARKER: &str = "<<LIME_PDF_READ_SKILL_LAUNCH_HINT>>";
const PDF_READ_SKILL_LAUNCH_DETOUR_DENY_PATTERNS: &[&str] = &[
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

pub(crate) fn prepare_pdf_read_skill_launch_request_metadata(
    request_metadata: Option<&serde_json::Value>,
) -> Option<serde_json::Value> {
    let mut metadata = request_metadata.cloned()?;
    ensure_harness_workbench_chat_mode(
        &mut metadata,
        &["pdf_read_skill_launch", "pdfReadSkillLaunch"],
    );

    Some(metadata)
}

pub(crate) fn merge_system_prompt_with_pdf_read_skill_launch(
    base_prompt: Option<String>,
    request_metadata: Option<&serde_json::Value>,
) -> Option<String> {
    let Some(launch_prompt) = build_pdf_read_skill_launch_system_prompt(request_metadata) else {
        return base_prompt;
    };

    match base_prompt {
        Some(base) => {
            if base.contains(PDF_READ_SKILL_LAUNCH_PROMPT_MARKER) {
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

pub(crate) fn should_lock_pdf_read_skill_launch_to_pdf_read(
    request_metadata: Option<&serde_json::Value>,
) -> bool {
    let Some(launch) = extract_harness_nested_object(
        request_metadata,
        &["pdf_read_skill_launch", "pdfReadSkillLaunch"],
    ) else {
        return false;
    };

    extract_object_string(launch, &["kind"]).unwrap_or_else(|| "pdf_read_request".to_string())
        == "pdf_read_request"
}

pub(crate) fn append_pdf_read_skill_launch_session_permissions(
    permissions: &mut Vec<ToolPermission>,
    session_id: &str,
    request_metadata: Option<&serde_json::Value>,
) {
    if !should_lock_pdf_read_skill_launch_to_pdf_read(request_metadata) {
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
            description: Some("仅对当前读PDF技能启动回合生效".to_string()),
        }]
    };

    for pattern in PDF_READ_SKILL_LAUNCH_DETOUR_DENY_PATTERNS {
        permissions.push(ToolPermission {
            tool: (*pattern).to_string(),
            allowed: false,
            priority: 1230,
            conditions: conditions.clone(),
            parameter_restrictions: Vec::new(),
            scope: PermissionScope::Session,
            reason: Some(
                "读PDF技能启动回合已锁定为 Skill(pdf_read) 主链，禁止先走工具目录/联网搜索偏航"
                    .to_string(),
            ),
            expires_at: None,
            metadata: HashMap::new(),
        });
    }
}

pub(crate) fn prune_pdf_read_skill_launch_detour_tools_from_registry(
    registry: &mut aster::tools::ToolRegistry,
    request_metadata: Option<&serde_json::Value>,
) {
    if !should_lock_pdf_read_skill_launch_to_pdf_read(request_metadata) {
        return;
    }

    for tool_name in PDF_READ_SKILL_LAUNCH_DETOUR_DENY_PATTERNS {
        registry.unregister(tool_name);
    }
}

fn build_pdf_read_skill_launch_system_prompt(
    request_metadata: Option<&serde_json::Value>,
) -> Option<String> {
    let launch = extract_harness_nested_object(
        request_metadata,
        &["pdf_read_skill_launch", "pdfReadSkillLaunch"],
    )?;
    let kind =
        extract_object_string(launch, &["kind"]).unwrap_or_else(|| "pdf_read_request".to_string());
    if kind != "pdf_read_request" {
        return None;
    }

    let skill_name = extract_object_string(launch, &["skill_name", "skillName"])
        .unwrap_or_else(|| "pdf_read".to_string());
    let pdf_read_request = launch
        .get("pdf_read_request")
        .and_then(serde_json::Value::as_object)?;
    let raw_text = extract_object_string(pdf_read_request, &["raw_text", "rawText"]);
    let prompt = extract_object_string(pdf_read_request, &["prompt"])
        .unwrap_or_else(|| "请阅读这份 PDF 并提炼关键信息".to_string());
    let source_path = extract_object_string(pdf_read_request, &["source_path", "sourcePath"]);
    let source_url = extract_object_string(pdf_read_request, &["source_url", "sourceUrl"]);
    let focus = extract_object_string(pdf_read_request, &["focus"]);
    let output_format = extract_object_string(pdf_read_request, &["output_format", "outputFormat"]);
    let project_id = extract_object_string(pdf_read_request, &["project_id", "projectId"]);
    let content_id = extract_object_string(pdf_read_request, &["content_id", "contentId"]);
    let entry_source = extract_object_string(pdf_read_request, &["entry_source", "entrySource"])
        .unwrap_or_else(|| "at_pdf_read_command".to_string());
    let args_payload = serde_json::json!({
        "user_input": raw_text.clone().unwrap_or_else(|| prompt.clone()),
        "pdf_read_request": serde_json::Value::Object(pdf_read_request.clone()),
    });
    let args_json = truncate_prompt_text(
        serde_json::to_string(&args_payload).unwrap_or_else(|_| "{}".to_string()),
        4_000,
    );
    let request_json = truncate_prompt_text(
        serde_json::to_string(pdf_read_request).unwrap_or_else(|_| "{}".to_string()),
        4_000,
    );
    let has_source_path = source_path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .is_some();
    let has_source_url = source_url
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .is_some();

    let mut lines = vec![
        PDF_READ_SKILL_LAUNCH_PROMPT_MARKER.to_string(),
        "- 当前回合来自读 PDF 技能启动，不要把它当成普通聊天回答。".to_string(),
        "- 先确认 PDF 来源，再立刻把任务交给 Skill 工具；不要在未实际读取文件前直接总结 PDF 内容。"
            .to_string(),
        format!("- 第一优先工具调用必须是 Skill，且 skill=\"{skill_name}\"。"),
        "- 调用 Skill 时，args 必须是一个严格 JSON 字符串，不要漏引号、不要写注释、不要只传半截字段。".to_string(),
        format!("- 推荐传给 Skill.args 的 JSON：{args_json}"),
        format!(
            "- 第一工具调用示例(Skill 参数 JSON)：{{\"skill\":\"{skill_name}\",\"args\":{}}}",
            serde_json::to_string(&args_json).unwrap_or_else(|_| "\"{}\"".to_string())
        ),
        "- 当前回合已经显式知道要走读PDF技能主链，不要为了确认技能名、工具名或命令名再去调用 ToolSearch。".to_string(),
        "- 在 Skill(pdf_read) 真正执行前，不要先走 ToolSearch / WebSearch / Grep 等工具目录发现、联网搜索或内容检索偏航。".to_string(),
        "- 不要先搜索 “pdf_read”、“read_file” 或 “list_directory” 的目录信息；当前 pdf_read_request 已经提供了足够上下文。".to_string(),
        "- 如果某个通用搜索工具因为 session policy 被拒绝，不要重复同类调用；应立即改为直调 Skill(pdf_read)。".to_string(),
        "- 这条命令属于 prompt skill 主链，不要创建 task file，也不要退回普通聊天凭空回答。".to_string(),
        "- 若拿到本地或工作区 PDF 路径，优先最小化使用 `list_directory / read_file` 读取目标 PDF，并保留真实 tool timeline。".to_string(),
        "- 若路径是相对路径，可先用 `list_directory` 确认位置，再调用 `read_file`；不要假装文件已经读取成功。".to_string(),
        "- 结果必须按“文档信息 / 核心要点 / 关键证据 / 待确认项”组织，且所有结论都要能回溯到实际读到的 PDF 内容。".to_string(),
        format!("- 当前读 PDF 请求上下文(JSON)：{request_json}"),
        format!("- 当前入口来源：{entry_source}。"),
        format!("- 当前解读目标：{prompt}"),
    ];

    if let Some(value) = source_path.as_deref() {
        lines.push(format!("- 当前 PDF 本地路径：{value}。"));
    }
    if let Some(value) = source_url.as_deref() {
        lines.push(format!("- 当前 PDF 链接：{value}。"));
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

    if has_source_path {
        lines.push(
            "- 当前任务已经显式提供 PDF 路径，不要再追问用户“是否开始读取 PDF”。".to_string(),
        );
    } else if has_source_url {
        lines.push(
            "- 当前只有 PDF URL。现有链路不保证能稳定直接读取远程 PDF；你最多只能追问 1 个关键问题，请用户提供本地路径或先把 PDF 导入工作区。".to_string(),
        );
    } else {
        lines.push(
            "- 当前缺少明确 PDF 来源。你最多只能追问 1 个关键问题，请用户补充本地路径或工作区内 PDF 文件位置；在来源补齐前不要伪造已读结果。".to_string(),
        );
    }

    Some(lines.join("\n"))
}
