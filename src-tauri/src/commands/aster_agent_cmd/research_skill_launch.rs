use super::*;
use crate::commands::modality_runtime_contracts::{
    insert_web_research_contract_fields, web_research_required_capabilities,
    web_research_runtime_contract, WEB_RESEARCH_CONTRACT_KEY, WEB_RESEARCH_MODALITY,
    WEB_RESEARCH_ROUTING_SLOT,
};

const RESEARCH_SKILL_LAUNCH_PROMPT_MARKER: &str = "<<LIME_RESEARCH_SKILL_LAUNCH_HINT>>";
const RESEARCH_SKILL_LAUNCH_DETOUR_DENY_PATTERNS: &[&str] = &[
    TOOL_SEARCH_TOOL_NAME,
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

fn extract_object_string_array(
    object: &serde_json::Map<String, serde_json::Value>,
    keys: &[&str],
) -> Vec<String> {
    keys.iter()
        .filter_map(|key| object.get(*key))
        .find_map(serde_json::Value::as_array)
        .map(|values| {
            values
                .iter()
                .filter_map(serde_json::Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default()
}

fn extract_object_value(
    object: &serde_json::Map<String, serde_json::Value>,
    keys: &[&str],
) -> Option<serde_json::Value> {
    keys.iter()
        .filter_map(|key| object.get(*key))
        .find(|value| value.is_object())
        .cloned()
}

fn extract_harness_nested_object_mut<'a>(
    value: &'a mut serde_json::Value,
    keys: &[&str],
) -> Option<&'a mut serde_json::Map<String, serde_json::Value>> {
    let root = value.as_object_mut()?;
    let harness = if root.contains_key("harness") {
        root.get_mut("harness")
            .and_then(serde_json::Value::as_object_mut)?
    } else {
        root
    };

    for key in keys.iter().copied() {
        let exists = harness
            .get(key)
            .and_then(serde_json::Value::as_object)
            .is_some();
        if exists {
            return harness
                .get_mut(key)
                .and_then(serde_json::Value::as_object_mut);
        }
    }

    None
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

fn ensure_web_research_contract_metadata(launch: &mut serde_json::Map<String, serde_json::Value>) {
    insert_web_research_contract_fields(launch);
    if let Some(research_request) = launch
        .get_mut("research_request")
        .and_then(serde_json::Value::as_object_mut)
    {
        insert_web_research_contract_fields(research_request);
    }
}

fn truncate_prompt_text(value: String, max_chars: usize) -> String {
    let total_chars = value.chars().count();
    if total_chars <= max_chars {
        return value;
    }

    let truncated = value.chars().take(max_chars).collect::<String>();
    format!("{truncated}...(已截断，原始长度 {total_chars} 字)")
}

pub(crate) fn prepare_research_skill_launch_request_metadata(
    request_metadata: Option<&serde_json::Value>,
) -> Option<serde_json::Value> {
    let mut metadata = request_metadata.cloned()?;
    ensure_harness_workbench_chat_mode(
        &mut metadata,
        &["research_skill_launch", "researchSkillLaunch"],
    );
    if let Some(launch) = extract_harness_nested_object_mut(
        &mut metadata,
        &["research_skill_launch", "researchSkillLaunch"],
    ) {
        ensure_web_research_contract_metadata(launch);
    }

    Some(metadata)
}

pub(crate) fn merge_system_prompt_with_research_skill_launch(
    base_prompt: Option<String>,
    request_metadata: Option<&serde_json::Value>,
) -> Option<String> {
    let Some(launch_prompt) = build_research_skill_launch_system_prompt(request_metadata) else {
        return base_prompt;
    };

    match base_prompt {
        Some(base) => {
            if base.contains(RESEARCH_SKILL_LAUNCH_PROMPT_MARKER) {
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

pub(crate) fn should_lock_research_skill_launch_to_prompt_search(
    request_metadata: Option<&serde_json::Value>,
) -> bool {
    let Some(launch) = extract_harness_nested_object(
        request_metadata,
        &["research_skill_launch", "researchSkillLaunch"],
    ) else {
        return false;
    };

    extract_object_string(launch, &["kind"]).unwrap_or_else(|| "research_request".to_string())
        == "research_request"
}

pub(crate) fn append_research_skill_launch_session_permissions(
    permissions: &mut Vec<ToolPermission>,
    session_id: &str,
    request_metadata: Option<&serde_json::Value>,
) {
    if !should_lock_research_skill_launch_to_prompt_search(request_metadata) {
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
            description: Some("仅对当前搜索技能启动回合生效".to_string()),
        }]
    };

    for pattern in RESEARCH_SKILL_LAUNCH_DETOUR_DENY_PATTERNS {
        permissions.push(ToolPermission {
            tool: (*pattern).to_string(),
            allowed: false,
            priority: 1234,
            conditions: conditions.clone(),
            parameter_restrictions: Vec::new(),
            scope: PermissionScope::Session,
            reason: Some(
                "搜索技能启动回合已锁定为 Skill(research) 主链，禁止先走工具目录/本地文件链路偏航"
                    .to_string(),
            ),
            expires_at: None,
            metadata: HashMap::new(),
        });
    }
}

pub(crate) fn prune_research_skill_launch_detour_tools_from_registry(
    registry: &mut aster::tools::ToolRegistry,
    request_metadata: Option<&serde_json::Value>,
) {
    if !should_lock_research_skill_launch_to_prompt_search(request_metadata) {
        return;
    }

    for tool_name in RESEARCH_SKILL_LAUNCH_DETOUR_DENY_PATTERNS {
        registry.unregister(tool_name);
    }
}

fn build_research_skill_launch_system_prompt(
    request_metadata: Option<&serde_json::Value>,
) -> Option<String> {
    let launch = extract_harness_nested_object(
        request_metadata,
        &["research_skill_launch", "researchSkillLaunch"],
    )?;
    let kind =
        extract_object_string(launch, &["kind"]).unwrap_or_else(|| "research_request".to_string());
    if kind != "research_request" {
        return None;
    }

    let skill_name = extract_object_string(launch, &["skill_name", "skillName"])
        .unwrap_or_else(|| "research".to_string());
    let research_request = launch
        .get("research_request")
        .and_then(serde_json::Value::as_object)?;
    let raw_text = extract_object_string(research_request, &["raw_text", "rawText"]);
    let prompt = extract_object_string(research_request, &["prompt"]);
    let query = extract_object_string(research_request, &["query"]);
    let site = extract_object_string(research_request, &["site"]);
    let time_range = extract_object_string(research_request, &["time_range", "timeRange"]);
    let depth = extract_object_string(research_request, &["depth"]);
    let focus = extract_object_string(research_request, &["focus"]);
    let output_format = extract_object_string(research_request, &["output_format", "outputFormat"]);
    let project_id = extract_object_string(research_request, &["project_id", "projectId"]);
    let content_id = extract_object_string(research_request, &["content_id", "contentId"]);
    let entry_source = extract_object_string(research_request, &["entry_source", "entrySource"])
        .unwrap_or_else(|| "at_search_command".to_string());
    let modality_contract_key = extract_object_string(
        research_request,
        &["modality_contract_key", "modalityContractKey"],
    )
    .unwrap_or_else(|| WEB_RESEARCH_CONTRACT_KEY.to_string());
    let modality = extract_object_string(research_request, &["modality"])
        .unwrap_or_else(|| WEB_RESEARCH_MODALITY.to_string());
    let routing_slot = extract_object_string(research_request, &["routing_slot", "routingSlot"])
        .unwrap_or_else(|| WEB_RESEARCH_ROUTING_SLOT.to_string());
    let required_capabilities = {
        let values = extract_object_string_array(
            research_request,
            &["required_capabilities", "requiredCapabilities"],
        );
        if values.is_empty() {
            web_research_required_capabilities()
        } else {
            values
        }
    };
    let runtime_contract =
        extract_object_value(research_request, &["runtime_contract", "runtimeContract"])
            .unwrap_or_else(web_research_runtime_contract);
    let args_payload = serde_json::json!({
        "user_input": raw_text
            .clone()
            .or(prompt.clone())
            .or(query.clone())
            .unwrap_or_else(|| "请根据当前要求执行联网搜索任务".to_string()),
        "research_request": serde_json::Value::Object(research_request.clone()),
    });
    let args_json = truncate_prompt_text(
        serde_json::to_string(&args_payload).unwrap_or_else(|_| "{}".to_string()),
        4_000,
    );
    let request_json = truncate_prompt_text(
        serde_json::to_string(research_request).unwrap_or_else(|_| "{}".to_string()),
        4_000,
    );
    let has_query = query
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .is_some();

    let mut lines = vec![
        RESEARCH_SKILL_LAUNCH_PROMPT_MARKER.to_string(),
        "- 当前回合来自搜索技能启动，不要把它当成普通聊天回答。".to_string(),
        format!(
            "- 当前底层运行合同：modality_contract_key={modality_contract_key}, modality={modality}, routing_slot={routing_slot}；后续检索、引用与产物必须原样保留 contract 字段。"
        ),
        format!(
            "- 当前合同所需能力：{}；不得退回 model_memory_only_answer 或 local_file_search_before_research_skill。",
            required_capabilities.join(", ")
        ),
        format!(
            "- 当前 runtime_contract(JSON)：{}",
            truncate_prompt_text(
                serde_json::to_string(&runtime_contract)
                    .unwrap_or_else(|_| "{}".to_string()),
                1_200,
            )
        ),
        "- 先快速归纳用户的搜索目标，然后立刻把任务交给 Skill 工具；不要先直接给出记忆性结论。"
            .to_string(),
        format!("- 第一优先工具调用必须是 Skill，且 skill=\"{skill_name}\"。"),
        "- 调用 Skill 时，args 必须是一个严格 JSON 字符串，不要漏引号、不要写注释、不要只传半截字段。".to_string(),
        format!("- 推荐传给 Skill.args 的 JSON：{args_json}"),
        format!(
            "- 第一工具调用示例(Skill 参数 JSON)：{{\"skill\":\"{skill_name}\",\"args\":{}}}",
            serde_json::to_string(&args_json).unwrap_or_else(|_| "\"{}\"".to_string())
        ),
        "- 当前回合已经显式知道要走搜索技能主链，不要为了确认技能名、工具名或命令名再去调用 ToolSearch。".to_string(),
        "- 在 Skill(research) 真正执行前，不要先走 ToolSearch / Read / Glob / Grep 等工具目录发现或本地文件链路。".to_string(),
        "- 不要先搜索 “research”、“search_query” 或 “WebSearch” 的目录信息；当前 research_request 已经提供了足够上下文。".to_string(),
        "- 如果某个工具目录/读文件工具因为 session policy 被拒绝，不要重复同类调用；应立即改为直调 Skill(research)。".to_string(),
        "- 这条命令属于 prompt skill 主链，不要创建媒体 task file，也不要回退成普通聊天搜索。".to_string(),
        "- research skill 内部必须真正执行联网检索，不要只凭已有记忆直接回答。".to_string(),
        "- 如果用户要求最新、近期、今天或时间敏感信息，检索词里必须补年份或时间范围，并在最终回答中标注时间口径。".to_string(),
        "- Skill 执行后，再基于检索结果整理结论、来源与建议；在真实检索完成前，不要伪造“已经搜索完毕”的细节。".to_string(),
        format!("- 当前搜索请求上下文(JSON)：{request_json}"),
        format!("- 当前入口来源：{entry_source}。"),
    ];

    if let Some(value) = prompt.as_deref() {
        lines.push(format!("- 当前搜索目标：{value}"));
    }
    if let Some(value) = query.as_deref() {
        lines.push(format!("- 当前核心查询：{value}。"));
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
        lines
            .push("- 当前任务已经显式进入搜索技能主链，不要再追问用户“是否开始搜索”。".to_string());
    } else {
        lines.push(
            "- 当前还缺少明确搜索主题。你最多只能追问 1 个关键问题，请用户补充最关键的检索对象；在主题补齐前不要伪造检索结果。"
                .to_string(),
        );
    }

    Some(lines.join("\n"))
}
