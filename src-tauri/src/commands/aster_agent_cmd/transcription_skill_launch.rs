use super::*;
use crate::commands::modality_runtime_contracts::{
    audio_transcription_required_capabilities, audio_transcription_runtime_contract,
    insert_audio_transcription_contract_fields, AUDIO_TRANSCRIPTION_CONTRACT_KEY,
    AUDIO_TRANSCRIPTION_MODALITY, AUDIO_TRANSCRIPTION_ROUTING_SLOT,
};

const TRANSCRIPTION_SKILL_LAUNCH_PROMPT_MARKER: &str = "<<LIME_TRANSCRIPTION_SKILL_LAUNCH_HINT>>";
const TRANSCRIPTION_SKILL_LAUNCH_DETOUR_DENY_PATTERNS: &[&str] = &[
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

fn truncate_prompt_text(value: String, max_chars: usize) -> String {
    let total_chars = value.chars().count();
    if total_chars <= max_chars {
        return value;
    }

    let truncated = value.chars().take(max_chars).collect::<String>();
    format!("{truncated}...(已截断，原始长度 {total_chars} 字)")
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
        .find(|value| !value.is_null())
        .cloned()
}

fn ensure_audio_transcription_contract_metadata(
    launch: &mut serde_json::Map<String, serde_json::Value>,
) {
    insert_audio_transcription_contract_fields(launch);
    let transcription_task = if launch.contains_key("transcription_task") {
        launch.get_mut("transcription_task")
    } else {
        launch.get_mut("transcriptionTask")
    };
    if let Some(transcription_task) = transcription_task.and_then(serde_json::Value::as_object_mut)
    {
        insert_audio_transcription_contract_fields(transcription_task);
    }
}

pub(crate) fn prepare_transcription_skill_launch_request_metadata(
    request_metadata: Option<&serde_json::Value>,
) -> Option<serde_json::Value> {
    let mut metadata = request_metadata.cloned()?;
    ensure_harness_workbench_chat_mode(
        &mut metadata,
        &["transcription_skill_launch", "transcriptionSkillLaunch"],
    );
    if let Some(launch) = extract_harness_nested_object_mut(
        &mut metadata,
        &["transcription_skill_launch", "transcriptionSkillLaunch"],
    ) {
        ensure_audio_transcription_contract_metadata(launch);
    }

    Some(metadata)
}

pub(crate) fn merge_system_prompt_with_transcription_skill_launch(
    base_prompt: Option<String>,
    request_metadata: Option<&serde_json::Value>,
) -> Option<String> {
    let Some(launch_prompt) = build_transcription_skill_launch_system_prompt(request_metadata)
    else {
        return base_prompt;
    };

    match base_prompt {
        Some(base) => {
            if base.contains(TRANSCRIPTION_SKILL_LAUNCH_PROMPT_MARKER) {
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

pub(crate) fn should_lock_transcription_skill_launch_to_transcription_generation(
    request_metadata: Option<&serde_json::Value>,
) -> bool {
    let Some(launch) = extract_harness_nested_object(
        request_metadata,
        &["transcription_skill_launch", "transcriptionSkillLaunch"],
    ) else {
        return false;
    };

    extract_object_string(launch, &["kind"]).unwrap_or_else(|| "transcription_task".to_string())
        == "transcription_task"
}

pub(crate) fn append_transcription_skill_launch_session_permissions(
    permissions: &mut Vec<ToolPermission>,
    session_id: &str,
    request_metadata: Option<&serde_json::Value>,
) {
    if !should_lock_transcription_skill_launch_to_transcription_generation(request_metadata) {
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
            description: Some("仅对当前转写技能启动回合生效".to_string()),
        }]
    };

    for pattern in TRANSCRIPTION_SKILL_LAUNCH_DETOUR_DENY_PATTERNS {
        permissions.push(ToolPermission {
            tool: (*pattern).to_string(),
            allowed: false,
            priority: 1226,
            conditions: conditions.clone(),
            parameter_restrictions: Vec::new(),
            scope: PermissionScope::Session,
            reason: Some(
                "转写技能启动回合已锁定为 Skill(transcription_generate) 主链，禁止先走通用工具搜索/读文件链路偏航"
                    .to_string(),
            ),
            expires_at: None,
            metadata: HashMap::new(),
        });
    }
}

pub(crate) fn prune_transcription_skill_launch_detour_tools_from_registry(
    registry: &mut aster::tools::ToolRegistry,
    request_metadata: Option<&serde_json::Value>,
) {
    if !should_lock_transcription_skill_launch_to_transcription_generation(request_metadata) {
        return;
    }

    for tool_name in TRANSCRIPTION_SKILL_LAUNCH_DETOUR_DENY_PATTERNS {
        registry.unregister(tool_name);
    }
}

fn build_transcription_skill_launch_system_prompt(
    request_metadata: Option<&serde_json::Value>,
) -> Option<String> {
    let launch = extract_harness_nested_object(
        request_metadata,
        &["transcription_skill_launch", "transcriptionSkillLaunch"],
    )?;
    let kind = extract_object_string(launch, &["kind"])
        .unwrap_or_else(|| "transcription_task".to_string());
    if kind != "transcription_task" {
        return None;
    }

    let skill_name = extract_object_string(launch, &["skill_name", "skillName"])
        .unwrap_or_else(|| "transcription_generate".to_string());
    let transcription_task = launch
        .get("transcription_task")
        .and_then(serde_json::Value::as_object)?;
    let raw_text = extract_object_string(transcription_task, &["raw_text", "rawText"]);
    let prompt = extract_object_string(transcription_task, &["prompt"]);
    let source_url = extract_object_string(transcription_task, &["source_url", "sourceUrl"]);
    let source_path = extract_object_string(transcription_task, &["source_path", "sourcePath"]);
    let language = extract_object_string(transcription_task, &["language"]);
    let output_format =
        extract_object_string(transcription_task, &["output_format", "outputFormat"]);
    let speaker_labels = transcription_task
        .get("speaker_labels")
        .or_else(|| transcription_task.get("speakerLabels"))
        .and_then(serde_json::Value::as_bool);
    let timestamps = transcription_task
        .get("timestamps")
        .and_then(serde_json::Value::as_bool);
    let provider_id = extract_object_string(transcription_task, &["provider_id", "providerId"]);
    let model = extract_object_string(transcription_task, &["model"]);
    let entry_source = extract_object_string(transcription_task, &["entry_source", "entrySource"])
        .unwrap_or_else(|| "at_transcription_command".to_string());
    let modality_contract_key = extract_object_string(
        transcription_task,
        &["modality_contract_key", "modalityContractKey"],
    )
    .unwrap_or_else(|| AUDIO_TRANSCRIPTION_CONTRACT_KEY.to_string());
    let modality = extract_object_string(transcription_task, &["modality"])
        .unwrap_or_else(|| AUDIO_TRANSCRIPTION_MODALITY.to_string());
    let routing_slot = extract_object_string(transcription_task, &["routing_slot", "routingSlot"])
        .unwrap_or_else(|| AUDIO_TRANSCRIPTION_ROUTING_SLOT.to_string());
    let required_capabilities = {
        let values = extract_object_string_array(
            transcription_task,
            &["required_capabilities", "requiredCapabilities"],
        );
        if values.is_empty() {
            audio_transcription_required_capabilities()
        } else {
            values
        }
    };
    let runtime_contract =
        extract_object_value(transcription_task, &["runtime_contract", "runtimeContract"])
            .unwrap_or_else(audio_transcription_runtime_contract);
    let args_payload = serde_json::json!({
        "user_input": raw_text
            .clone()
            .or(prompt.clone())
            .unwrap_or_else(|| "请根据当前要求执行转写任务".to_string()),
        "transcription_task": serde_json::Value::Object(transcription_task.clone()),
    });
    let args_json = truncate_prompt_text(
        serde_json::to_string(&args_payload).unwrap_or_else(|_| "{}".to_string()),
        4_000,
    );
    let transcription_task_json = truncate_prompt_text(
        serde_json::to_string(transcription_task).unwrap_or_else(|_| "{}".to_string()),
        4_000,
    );
    let source_present = source_url.is_some() || source_path.is_some();

    let mut lines = vec![
        TRANSCRIPTION_SKILL_LAUNCH_PROMPT_MARKER.to_string(),
        "- 当前回合来自转写技能启动，不要把它当成普通聊天回答。".to_string(),
        "- 先快速归纳用户目标，然后立刻把任务交给 Skill 工具；不要停留在泛泛解释。".to_string(),
        format!("- 第一优先工具调用必须是 Skill，且 skill=\"{skill_name}\"。"),
        "- 调用 Skill 时，args 必须是一个严格 JSON 字符串，不要漏引号、不要写注释、不要只传半截字段。".to_string(),
        format!("- 推荐传给 Skill.args 的 JSON：{args_json}"),
        format!(
            "- 第一工具调用示例(Skill 参数 JSON)：{{\"skill\":\"{skill_name}\",\"args\":{}}}",
            serde_json::to_string(&args_json).unwrap_or_else(|_| "\"{}\"".to_string())
        ),
        "- 当前回合已经显式知道要走转写技能主链，不要为了确认技能名、工具名或命令名再去调用 ToolSearch。".to_string(),
        "- 在 Skill(transcription_generate) 真正执行前，不要先走 ToolSearch / WebSearch / Read / Glob / Grep 等通用工具发现、检索或读文件链路。".to_string(),
        "- 不要搜索 “transcription_generate”、“lime task create transcription --json” 或 “lime_create_transcription_task” 之类目录信息；当前 transcription_task 已经提供了足够上下文。".to_string(),
        "- 如果某个通用搜索/读文件工具因为 session policy 被拒绝，不要重复同类调用；应立即改为直调 Skill(transcription_generate)。".to_string(),
        "- Skill 执行后，优先沿 transcription_generate skill 的 Bash / task file 主链提交异步任务；只有 Skill 明确不可用时，才允许直接回退到 lime_create_transcription_task。".to_string(),
        "- 不要伪造“转写已完成”；在 task file 真正返回结果前，只能汇报任务已提交、排队或执行中。".to_string(),
        format!(
            "- 当前底层运行合同：modality_contract_key={modality_contract_key}, modality={modality}, routing_slot={routing_slot}；`@转写` 只是 audio_transcription 的上层入口，首刀仍走 Skill(transcription_generate)。"
        ),
        format!(
            "- 当前合同所需能力：{}；不得退回 frontend_direct_asr、generic_file_transcript、tool_search_before_transcription_skill 或 web_search_before_transcription_skill。",
            required_capabilities.join(", ")
        ),
        format!(
            "- 当前 runtime_contract(JSON)：{}",
            truncate_prompt_text(
                serde_json::to_string(&runtime_contract)
                    .unwrap_or_else(|_| "{}".to_string()),
                4_000,
            )
        ),
        format!("- 当前转写任务上下文(JSON)：{transcription_task_json}"),
        format!("- 当前入口来源：{entry_source}。"),
    ];

    if let Some(value) = prompt.as_deref() {
        lines.push(format!("- 当前用户目标：{value}"));
    }
    if let Some(value) = source_url.as_deref() {
        lines.push(format!("- 当前来源 URL：{value}。"));
    }
    if let Some(value) = source_path.as_deref() {
        lines.push(format!("- 当前来源路径：{value}。"));
    }
    if let Some(value) = language.as_deref() {
        lines.push(format!("- 当前目标语言：{value}。"));
    }
    if let Some(value) = output_format.as_deref() {
        lines.push(format!("- 当前输出格式：{value}。"));
    }
    if let Some(value) = speaker_labels {
        lines.push(format!(
            "- 当前是否区分说话人：{}。",
            if value { "是" } else { "否" }
        ));
    }
    if let Some(value) = timestamps {
        lines.push(format!(
            "- 当前是否带时间戳：{}。",
            if value { "是" } else { "否" }
        ));
    }
    if let Some(value) = provider_id.as_deref() {
        lines.push(format!("- 当前首选 provider_id：{value}。"));
    }
    if let Some(value) = model.as_deref() {
        lines.push(format!("- 当前首选模型：{value}。"));
    }

    if source_present {
        lines.push(
            "- 当前任务已经显式进入转写技能主链，不要再要求用户额外确认“是否开始转写”。"
                .to_string(),
        );
    } else {
        lines.push(
            "- 当前还缺少明确的音频/视频来源。你最多只能追问 1 个关键问题，请用户补充 source_url 或 source_path；在来源补齐前不要创建任务，也不要伪造结果。"
                .to_string(),
        );
    }

    Some(lines.join("\n"))
}
