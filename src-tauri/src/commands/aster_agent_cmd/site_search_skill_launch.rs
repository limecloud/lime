use super::*;
use crate::commands::modality_runtime_contracts::{
    hydrate_limecore_policy_hits_from_request_metadata, insert_web_research_contract_fields,
    runtime_contract_with_policy_hits_from_request_metadata, web_research_required_capabilities,
    web_research_runtime_contract, WEB_RESEARCH_CONTRACT_KEY, WEB_RESEARCH_MODALITY,
    WEB_RESEARCH_ROUTING_SLOT,
};

const SITE_SEARCH_SKILL_LAUNCH_PROMPT_MARKER: &str = "<<LIME_SITE_SEARCH_SKILL_LAUNCH_HINT>>";
const SITE_SEARCH_SKILL_LAUNCH_DETOUR_DENY_PATTERNS: &[&str] = &[
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
    if let Some(site_search_request) = launch
        .get_mut("site_search_request")
        .and_then(serde_json::Value::as_object_mut)
    {
        insert_web_research_contract_fields(site_search_request);
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

pub(crate) fn prepare_site_search_skill_launch_request_metadata(
    request_metadata: Option<&serde_json::Value>,
) -> Option<serde_json::Value> {
    let mut metadata = request_metadata.cloned()?;
    ensure_harness_workbench_chat_mode(
        &mut metadata,
        &["site_search_skill_launch", "siteSearchSkillLaunch"],
    );
    if let Some(launch) = extract_harness_nested_object_mut(
        &mut metadata,
        &["site_search_skill_launch", "siteSearchSkillLaunch"],
    ) {
        ensure_web_research_contract_metadata(launch);
    }
    hydrate_limecore_policy_hits_from_request_metadata(&mut metadata);

    Some(metadata)
}

pub(crate) fn apply_site_search_skill_launch_to_request_tool_policy(
    request_metadata: Option<&serde_json::Value>,
    request_web_search: Option<bool>,
    request_search_mode: Option<RequestToolPolicyMode>,
) -> (Option<bool>, Option<RequestToolPolicyMode>) {
    if should_lock_site_search_skill_launch_to_site_tools(request_metadata) {
        return (Some(false), Some(RequestToolPolicyMode::Disabled));
    }

    (request_web_search, request_search_mode)
}

pub(crate) fn merge_system_prompt_with_site_search_skill_launch(
    base_prompt: Option<String>,
    request_metadata: Option<&serde_json::Value>,
) -> Option<String> {
    let Some(launch_prompt) = build_site_search_skill_launch_system_prompt(request_metadata) else {
        return base_prompt;
    };

    match base_prompt {
        Some(base) => {
            if base.contains(SITE_SEARCH_SKILL_LAUNCH_PROMPT_MARKER) {
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

pub(crate) fn should_lock_site_search_skill_launch_to_site_tools(
    request_metadata: Option<&serde_json::Value>,
) -> bool {
    let Some(launch) = extract_harness_nested_object(
        request_metadata,
        &["site_search_skill_launch", "siteSearchSkillLaunch"],
    ) else {
        return false;
    };

    extract_object_string(launch, &["kind"]).unwrap_or_else(|| "site_search_request".to_string())
        == "site_search_request"
}

pub(crate) fn append_site_search_skill_launch_session_permissions(
    permissions: &mut Vec<ToolPermission>,
    session_id: &str,
    request_metadata: Option<&serde_json::Value>,
) {
    if !should_lock_site_search_skill_launch_to_site_tools(request_metadata) {
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
            description: Some("仅对当前站点搜索技能启动回合生效".to_string()),
        }]
    };

    for pattern in SITE_SEARCH_SKILL_LAUNCH_DETOUR_DENY_PATTERNS {
        permissions.push(ToolPermission {
            tool: (*pattern).to_string(),
            allowed: false,
            priority: 1231,
            conditions: conditions.clone(),
            parameter_restrictions: Vec::new(),
            scope: PermissionScope::Session,
            reason: Some(
                "站点搜索技能启动回合已锁定为 Skill(site_search) 主链，禁止先走通用搜索/本地文件链路偏航"
                    .to_string(),
            ),
            expires_at: None,
            metadata: HashMap::new(),
        });
    }

    for pattern in super::service_skill_launch::service_skill_launch_browser_deny_patterns() {
        permissions.push(ToolPermission {
            tool: (*pattern).to_string(),
            allowed: false,
            priority: 1231,
            conditions: conditions.clone(),
            parameter_restrictions: Vec::new(),
            scope: PermissionScope::Session,
            reason: Some(
                "站点搜索技能启动回合应优先沿 lime_site_* 主链执行，禁止直接回退到底层浏览器兼容工具"
                    .to_string(),
            ),
            expires_at: None,
            metadata: HashMap::new(),
        });
    }
}

pub(crate) fn prune_site_search_skill_launch_detour_tools_from_registry(
    registry: &mut aster::tools::ToolRegistry,
    request_metadata: Option<&serde_json::Value>,
) {
    if !should_lock_site_search_skill_launch_to_site_tools(request_metadata) {
        return;
    }

    for tool_name in SITE_SEARCH_SKILL_LAUNCH_DETOUR_DENY_PATTERNS {
        registry.unregister(tool_name);
    }
}

fn build_site_search_skill_launch_system_prompt(
    request_metadata: Option<&serde_json::Value>,
) -> Option<String> {
    let launch = extract_harness_nested_object(
        request_metadata,
        &["site_search_skill_launch", "siteSearchSkillLaunch"],
    )?;
    let kind = extract_object_string(launch, &["kind"])
        .unwrap_or_else(|| "site_search_request".to_string());
    if kind != "site_search_request" {
        return None;
    }

    let skill_name = extract_object_string(launch, &["skill_name", "skillName"])
        .unwrap_or_else(|| "site_search".to_string());
    let site_search_request = launch
        .get("site_search_request")
        .and_then(serde_json::Value::as_object)?;
    let raw_text = extract_object_string(site_search_request, &["raw_text", "rawText"]);
    let prompt = extract_object_string(site_search_request, &["prompt"]);
    let site = extract_object_string(site_search_request, &["site"]);
    let query = extract_object_string(site_search_request, &["query"]);
    let project_id = extract_object_string(site_search_request, &["project_id", "projectId"]);
    let content_id = extract_object_string(site_search_request, &["content_id", "contentId"]);
    let limit = site_search_request
        .get("limit")
        .and_then(serde_json::Value::as_u64);
    let entry_source = extract_object_string(site_search_request, &["entry_source", "entrySource"])
        .unwrap_or_else(|| "at_site_search_command".to_string());
    let modality_contract_key = extract_object_string(
        site_search_request,
        &["modality_contract_key", "modalityContractKey"],
    )
    .unwrap_or_else(|| WEB_RESEARCH_CONTRACT_KEY.to_string());
    let modality = extract_object_string(site_search_request, &["modality"])
        .unwrap_or_else(|| WEB_RESEARCH_MODALITY.to_string());
    let routing_slot = extract_object_string(site_search_request, &["routing_slot", "routingSlot"])
        .unwrap_or_else(|| WEB_RESEARCH_ROUTING_SLOT.to_string());
    let required_capabilities = {
        let values = extract_object_string_array(
            site_search_request,
            &["required_capabilities", "requiredCapabilities"],
        );
        if values.is_empty() {
            web_research_required_capabilities()
        } else {
            values
        }
    };
    let runtime_contract = extract_object_value(
        site_search_request,
        &["runtime_contract", "runtimeContract"],
    )
    .unwrap_or_else(web_research_runtime_contract);
    let runtime_contract =
        runtime_contract_with_policy_hits_from_request_metadata(runtime_contract, request_metadata);
    let mut site_search_request_payload = site_search_request.clone();
    site_search_request_payload.insert("runtime_contract".to_string(), runtime_contract.clone());
    let args_payload = serde_json::json!({
        "user_input": raw_text
            .clone()
            .or(prompt.clone())
            .or(query.clone())
            .unwrap_or_else(|| "请根据当前要求执行站点检索任务".to_string()),
        "site_search_request": serde_json::Value::Object(site_search_request_payload.clone()),
    });
    let args_json = truncate_prompt_text(
        serde_json::to_string(&args_payload).unwrap_or_else(|_| "{}".to_string()),
        4_000,
    );
    let request_json = truncate_prompt_text(
        serde_json::to_string(&site_search_request_payload).unwrap_or_else(|_| "{}".to_string()),
        4_000,
    );
    let has_site = site
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
        SITE_SEARCH_SKILL_LAUNCH_PROMPT_MARKER.to_string(),
        "- 当前回合来自站点搜索技能启动，不要把它当成普通聊天回答。".to_string(),
        format!(
            "- 当前底层运行合同：modality_contract_key={modality_contract_key}, modality={modality}, routing_slot={routing_slot}；站点搜索是 web_research 合同下的子入口，后续站点结果与产物必须原样保留 contract 字段。"
        ),
        format!(
            "- 当前合同所需能力：{}；不得退回 model_memory_only_answer、通用 WebSearch 或 local_file_search_before_research_skill。",
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
        "- 先快速归纳用户要查哪个站点、查什么，然后立刻把任务交给 Skill 工具。".to_string(),
        format!("- 第一优先工具调用必须是 Skill，且 skill=\"{skill_name}\"。"),
        "- 调用 Skill 时，args 必须是一个严格 JSON 字符串，不要漏引号、不要写注释、不要只传半截字段。".to_string(),
        format!("- 推荐传给 Skill.args 的 JSON：{args_json}"),
        format!(
            "- 第一工具调用示例(Skill 参数 JSON)：{{\"skill\":\"{skill_name}\",\"args\":{}}}",
            serde_json::to_string(&args_json).unwrap_or_else(|_| "\"{}\"".to_string())
        ),
        "- 当前回合已经显式知道要走站点搜索技能主链，不要为了确认技能名、工具名或命令名再去调用 ToolSearch。".to_string(),
        "- 在 Skill(site_search) 真正执行前，不要先走 ToolSearch / WebSearch / Read / Glob / Grep 等通用搜索、工具目录发现或本地文件链路。".to_string(),
        "- 不要先搜索 “site_search”、“lime_site_run” 或 “lime_site_search” 的目录信息；当前 site_search_request 已经提供了足够上下文。".to_string(),
        "- 如果某个通用搜索/读文件工具因为 session policy 被拒绝，不要重复同类调用；应立即改为直调 Skill(site_search)。".to_string(),
        "- 这条命令属于 prompt skill 主链，不要创建 task file，也不要退回普通 research / WebSearch。".to_string(),
        "- site_search skill 内部应优先沿 lime_site_info / lime_site_run / lime_site_search 主链执行，不要先改用 WebSearch、research、webReader 或底层浏览器工具替代。".to_string(),
        "- 若用户已明确指定站点，应优先在该站点的 adapter 范围内求解；只有 adapter 名不明确时，才允许先用 lime_site_search 缩小范围。".to_string(),
        "- Skill 执行后，再基于真实站点结果整理摘要；在真实检索完成前，不要伪造“已完成站点搜索”的结果。".to_string(),
        format!("- 当前站点搜索请求上下文(JSON)：{request_json}"),
        format!("- 当前入口来源：{entry_source}。"),
    ];

    if let Some(value) = prompt.as_deref() {
        lines.push(format!("- 当前站点搜索目标：{value}"));
    }
    if let Some(value) = site.as_deref() {
        lines.push(format!("- 当前目标站点：{value}。"));
    }
    if let Some(value) = query.as_deref() {
        lines.push(format!("- 当前检索关键词：{value}。"));
    }
    if let Some(value) = limit {
        lines.push(format!("- 当前结果数量上限：{value}。"));
    }
    if let Some(value) = project_id.as_deref() {
        lines.push(format!("- 当前 project_id：{value}。"));
    }
    if let Some(value) = content_id.as_deref() {
        lines.push(format!("- 当前 content_id：{value}。"));
    }

    if has_site && has_query {
        lines.push(
            "- 当前任务已经显式进入站点搜索技能主链，不要再追问用户“是否开始站点搜索”。"
                .to_string(),
        );
    } else {
        lines.push(
            "- 当前还缺少明确站点或检索关键词。你最多只能追问 1 个关键问题，请用户补最关键的缺口；在信息补齐前不要伪造结果。"
                .to_string(),
        );
    }

    Some(lines.join("\n"))
}
