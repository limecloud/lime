use super::tool_process_kind_metadata::classify_tool_process_kind;
use super::tool_process_risk_metadata::{classify_tool_process_risk, ToolProcessRiskMetadata};
use lime_agent::AgentToolResult;
use serde_json::{json, Map, Value};

pub(crate) fn promote_mcp_route_metadata(payload_object: &mut Map<String, Value>) {
    let Some(metadata) = payload_object
        .get("progress")
        .and_then(Value::as_object)
        .and_then(|progress| progress.get("metadata"))
        .and_then(Value::as_object)
    else {
        return;
    };
    let Some(_notification_kind) = metadata
        .get("notification_kind")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|kind| {
            matches!(
                *kind,
                "mcp_progress"
                    | "mcp_resources_changed"
                    | "mcp_tools_changed"
                    | "mcp_prompts_changed"
            )
        })
    else {
        return;
    };
    let promoted = [
        ("server_name", "serverName"),
        ("tool_name", "toolName"),
        ("runtime_tool_name", "runtimeToolName"),
    ]
    .into_iter()
    .filter_map(|(source, target)| {
        metadata
            .get(source)
            .cloned()
            .map(|value| (target.to_string(), value))
    })
    .collect::<Vec<_>>();
    for (target, value) in promoted {
        payload_object.insert(target, value);
    }
}

#[derive(Clone, Copy)]
pub(crate) enum ToolProcessStatus {
    Started,
    InputDelta,
    Progress,
    OutputDelta,
    Completed,
    Failed,
}

pub(crate) struct ToolProcessMetadataInput<'a> {
    pub(crate) tool_id: &'a str,
    pub(crate) tool_name: Option<&'a str>,
    pub(crate) status: ToolProcessStatus,
    pub(crate) arguments: Option<&'a Value>,
    pub(crate) result: Option<&'a AgentToolResult>,
}

pub(crate) fn build_tool_process_metadata(
    input: ToolProcessMetadataInput<'_>,
) -> Map<String, Value> {
    let mut lifecycle = tool_lifecycle_descriptor(input.status);
    let risk = classify_tool_process_risk(&input);
    risk.apply_to_lifecycle(&mut lifecycle);
    let mut metadata = Map::new();
    metadata.insert(
        "tool_process_facts".to_string(),
        tool_process_facts_with_risk(&input, &lifecycle, &risk),
    );
    if let Some(summary) = tool_process_summary_descriptor(&input) {
        metadata.insert("tool_process_summary".to_string(), summary);
    }
    if let Some(risk_level) = lifecycle.get("riskLevel").and_then(Value::as_str) {
        metadata.insert(
            "risk_level".to_string(),
            Value::String(risk_level.to_string()),
        );
    }
    risk.insert_metadata_fields(&mut metadata);
    metadata
}

fn tool_lifecycle_descriptor(status: ToolProcessStatus) -> Map<String, Value> {
    let (phase, status_name) = match status {
        ToolProcessStatus::Started => ("before_tool", "started"),
        ToolProcessStatus::InputDelta => ("before_tool", "input_delta"),
        ToolProcessStatus::Progress => ("tool_progress", "progress"),
        ToolProcessStatus::OutputDelta => ("tool_progress", "output_delta"),
        ToolProcessStatus::Completed => ("after_tool_success", "completed"),
        ToolProcessStatus::Failed => ("after_tool_failure", "failed"),
    };
    Map::from_iter([
        (
            "surface".to_string(),
            Value::String("tool_lifecycle".to_string()),
        ),
        ("phase".to_string(), Value::String(phase.to_string())),
        ("status".to_string(), Value::String(status_name.to_string())),
        ("riskLevel".to_string(), Value::String("normal".to_string())),
    ])
}

fn tool_process_facts_with_risk(
    input: &ToolProcessMetadataInput<'_>,
    lifecycle: &Map<String, Value>,
    risk: &ToolProcessRiskMetadata,
) -> Value {
    let mut facts = Map::from_iter([
        (
            "source".to_string(),
            Value::String("runtime_facts".to_string()),
        ),
        (
            "toolCallId".to_string(),
            Value::String(input.tool_id.to_string()),
        ),
        (
            "status".to_string(),
            Value::String(tool_process_status_name(input.status).to_string()),
        ),
    ]);
    if let Some(tool_name) = input.tool_name.and_then(non_empty_str) {
        facts.insert("toolName".to_string(), Value::String(tool_name.to_string()));
    }
    classify_tool_process_kind(input).insert_fact_fields(&mut facts);
    if let Some(phase) = lifecycle.get("phase").and_then(Value::as_str) {
        facts.insert("phase".to_string(), Value::String(phase.to_string()));
    }
    if let Some(risk_level) = lifecycle.get("riskLevel").and_then(Value::as_str) {
        facts.insert(
            "riskLevel".to_string(),
            Value::String(risk_level.to_string()),
        );
    }
    risk.insert_fact_fields(&mut facts);
    if let Some(subject) = tool_process_subject(input.arguments, input.tool_name) {
        facts.insert("subject".to_string(), Value::String(subject));
    }
    if let Some(result) = input.result {
        if let Some(error) = result.error.as_deref().and_then(non_empty_str) {
            facts.insert(
                "error".to_string(),
                Value::String(shorten_value(error, 160)),
            );
        }
        if !result.output.trim().is_empty() {
            facts.insert("hasOutput".to_string(), Value::Bool(true));
        }
    }
    Value::Object(facts)
}

fn tool_process_summary_descriptor(input: &ToolProcessMetadataInput<'_>) -> Option<Value> {
    let mut summary = Map::from_iter([
        (
            "source".to_string(),
            Value::String("runtime_facts".to_string()),
        ),
        (
            "schema".to_string(),
            Value::String("tool_process_summary.v1".to_string()),
        ),
    ]);
    match input.status {
        ToolProcessStatus::Started => {
            summary.insert(
                "pre".to_string(),
                descriptor_for_tool_phase(
                    input.tool_name,
                    input.arguments,
                    ToolProcessStatus::Started,
                ),
            );
        }
        ToolProcessStatus::InputDelta
        | ToolProcessStatus::Progress
        | ToolProcessStatus::OutputDelta => {
            return None;
        }
        ToolProcessStatus::Completed => {
            if input.tool_name.is_some() {
                summary.insert(
                    "pre".to_string(),
                    descriptor_for_tool_phase(
                        input.tool_name,
                        input.arguments,
                        ToolProcessStatus::Started,
                    ),
                );
            }
            summary.insert(
                "completed".to_string(),
                descriptor_for_tool_phase(
                    input.tool_name,
                    input.arguments,
                    ToolProcessStatus::Completed,
                ),
            );
        }
        ToolProcessStatus::Failed => {
            summary.insert(
                "failed".to_string(),
                descriptor_with_values(
                    "toolCall.processSummary.error.failed",
                    Map::from_iter([(
                        "message".to_string(),
                        Value::String(tool_failure_message(input.result)),
                    )]),
                ),
            );
        }
    }
    Some(Value::Object(summary))
}

fn descriptor_for_tool_phase(
    tool_name: Option<&str>,
    arguments: Option<&Value>,
    status: ToolProcessStatus,
) -> Value {
    let normalized = tool_name
        .map(normalize_tool_name)
        .unwrap_or_else(|| "".to_string());
    let subject = tool_process_subject(arguments, tool_name);
    match status {
        ToolProcessStatus::Started => {
            if normalized.contains("websearch") || normalized.contains("searchquery") {
                return match subject {
                    Some(query) => descriptor_with_values(
                        "toolCall.processSummary.webSearch.searchFirstWithQuery",
                        Map::from_iter([("query".to_string(), Value::String(query))]),
                    ),
                    None => {
                        descriptor_without_values("toolCall.processSummary.webSearch.searchFirst")
                    }
                };
            }
            if normalized == "updateplan" {
                return descriptor_without_values("toolCall.processSummary.plan.updateFirst");
            }
            descriptor_for_generic_tool(&normalized, subject, true)
        }
        ToolProcessStatus::InputDelta
        | ToolProcessStatus::Progress
        | ToolProcessStatus::OutputDelta => {
            descriptor_without_values("toolCall.processSummary.generic.stepStartFirst")
        }
        ToolProcessStatus::Completed => {
            if normalized == "updateplan" {
                return descriptor_without_values("toolCall.processSummary.plan.updated");
            }
            descriptor_for_generic_tool(&normalized, subject, false)
        }
        ToolProcessStatus::Failed => descriptor_with_values(
            "toolCall.processSummary.error.failed",
            Map::from_iter([(
                "message".to_string(),
                Value::String("tool_failed".to_string()),
            )]),
        ),
    }
}

fn descriptor_for_generic_tool(normalized_name: &str, subject: Option<String>, pre: bool) -> Value {
    let key = if normalized_name.contains("search")
        || normalized_name.contains("grep")
        || normalized_name.contains("find")
    {
        if pre {
            "toolCall.processSummary.generic.searchFirst"
        } else {
            "toolCall.processSummary.generic.searched"
        }
    } else if normalized_name.contains("fetch")
        || normalized_name.contains("http")
        || normalized_name.contains("url")
        || normalized_name.contains("web")
    {
        if pre {
            "toolCall.processSummary.generic.fetchFirst"
        } else {
            "toolCall.processSummary.generic.fetched"
        }
    } else if normalized_name.contains("read")
        || normalized_name.contains("get")
        || normalized_name.contains("cat")
    {
        if pre {
            "toolCall.processSummary.generic.readFirst"
        } else {
            "toolCall.processSummary.generic.read"
        }
    } else if normalized_name.contains("list") || normalized_name.contains("dir") {
        if pre {
            "toolCall.processSummary.generic.listFirst"
        } else {
            "toolCall.processSummary.generic.located"
        }
    } else if normalized_name.contains("write")
        || normalized_name.contains("create")
        || normalized_name.contains("save")
    {
        if pre {
            "toolCall.processSummary.generic.writeFirst"
        } else {
            "toolCall.processSummary.generic.written"
        }
    } else if normalized_name.contains("edit")
        || normalized_name.contains("patch")
        || normalized_name.contains("update")
    {
        if pre {
            "toolCall.processSummary.generic.editFirst"
        } else {
            "toolCall.processSummary.generic.edited"
        }
    } else if pre {
        "toolCall.processSummary.generic.stepStartFirst"
    } else {
        "toolCall.processSummary.generic.completed"
    };

    match subject {
        Some(subject) => {
            let subject_key = match key {
                "toolCall.processSummary.generic.searchFirst" => {
                    Some("toolCall.processSummary.generic.searchFirstWithSubject")
                }
                "toolCall.processSummary.generic.searched" => {
                    Some("toolCall.processSummary.generic.searchedWithSubject")
                }
                "toolCall.processSummary.generic.fetchFirst" => {
                    Some("toolCall.processSummary.generic.fetchFirstWithSubject")
                }
                "toolCall.processSummary.generic.fetched" => {
                    Some("toolCall.processSummary.generic.fetchedWithSubject")
                }
                "toolCall.processSummary.generic.readFirst" => {
                    Some("toolCall.processSummary.generic.readFirstWithSubject")
                }
                "toolCall.processSummary.generic.read" => {
                    Some("toolCall.processSummary.generic.readWithSubject")
                }
                "toolCall.processSummary.generic.listFirst" => {
                    Some("toolCall.processSummary.generic.listFirstWithSubject")
                }
                "toolCall.processSummary.generic.located" => {
                    Some("toolCall.processSummary.generic.locatedWithSubject")
                }
                "toolCall.processSummary.generic.writeFirst" => {
                    Some("toolCall.processSummary.generic.writeFirstWithSubject")
                }
                "toolCall.processSummary.generic.written" => {
                    Some("toolCall.processSummary.generic.writtenWithSubject")
                }
                "toolCall.processSummary.generic.editFirst" => {
                    Some("toolCall.processSummary.generic.editFirstWithSubject")
                }
                "toolCall.processSummary.generic.edited" => {
                    Some("toolCall.processSummary.generic.editedWithSubject")
                }
                _ => None,
            };
            match subject_key {
                Some(subject_key) => descriptor_with_values(
                    subject_key,
                    Map::from_iter([("subject".to_string(), Value::String(subject))]),
                ),
                None => descriptor_without_values(key),
            }
        }
        None => descriptor_without_values(key),
    }
}

fn descriptor_without_values(key: &str) -> Value {
    json!({ "key": key })
}

fn descriptor_with_values(key: &str, values: Map<String, Value>) -> Value {
    json!({
        "key": key,
        "values": Value::Object(values),
    })
}

fn tool_process_status_name(status: ToolProcessStatus) -> &'static str {
    match status {
        ToolProcessStatus::Started => "started",
        ToolProcessStatus::InputDelta => "input_delta",
        ToolProcessStatus::Progress => "progress",
        ToolProcessStatus::OutputDelta => "output_delta",
        ToolProcessStatus::Completed => "completed",
        ToolProcessStatus::Failed => "failed",
    }
}

fn tool_failure_message(result: Option<&AgentToolResult>) -> String {
    let Some(result) = result else {
        return "tool_failed".to_string();
    };
    if let Some(error) = result.error.as_deref().and_then(non_empty_str) {
        return shorten_value(error, 120);
    }
    if let Some(message) = non_empty_str(&result.output) {
        return shorten_value(message, 120);
    }
    tool_failure_category(result)
}

pub(crate) fn merge_tool_process_metadata(
    target: &mut Map<String, Value>,
    metadata: &Map<String, Value>,
) {
    merge_tool_process_metadata_into(target, metadata);
    let metadata_value = target
        .entry("metadata".to_string())
        .or_insert_with(|| Value::Object(Map::new()));
    if !metadata_value.is_object() {
        *metadata_value = Value::Object(Map::new());
    }
    if let Some(metadata_object) = metadata_value.as_object_mut() {
        merge_tool_process_metadata_into(metadata_object, metadata);
    }
}

pub(crate) fn merge_result_tool_process_metadata(
    payload_object: &mut Map<String, Value>,
    metadata: &Map<String, Value>,
) {
    let Some(result) = payload_object.get_mut("result") else {
        return;
    };
    if !result.is_object() {
        return;
    }
    let result = result.as_object_mut().expect("checked result object");
    let metadata_value = result
        .entry("metadata".to_string())
        .or_insert_with(|| Value::Object(Map::new()));
    if !metadata_value.is_object() {
        *metadata_value = Value::Object(Map::new());
    }
    if let Some(metadata_object) = metadata_value.as_object_mut() {
        merge_tool_process_metadata_into(metadata_object, metadata);
    }
}

fn merge_tool_process_metadata_into(
    target: &mut Map<String, Value>,
    metadata: &Map<String, Value>,
) {
    for (key, value) in metadata {
        if key == "tool_process_summary" && has_tool_process_summary(target) {
            continue;
        }
        if matches!(key.as_str(), "tool_process_facts") {
            merge_object_field_into(target, key, value);
            continue;
        }
        target.entry(key.clone()).or_insert_with(|| value.clone());
    }
}

fn merge_object_field_into(target: &mut Map<String, Value>, key: &str, value: &Value) {
    let Some(source_object) = value.as_object() else {
        target
            .entry(key.to_string())
            .or_insert_with(|| value.clone());
        return;
    };
    match target.get_mut(key).and_then(Value::as_object_mut) {
        Some(target_object) => {
            for (field, field_value) in source_object {
                target_object
                    .entry(field.clone())
                    .or_insert_with(|| field_value.clone());
            }
        }
        None => {
            target
                .entry(key.to_string())
                .or_insert_with(|| value.clone());
        }
    }
}

fn has_tool_process_summary(target: &Map<String, Value>) -> bool {
    [
        "tool_process_summary",
        "toolProcessSummary",
        "process_summary",
        "processSummary",
    ]
    .iter()
    .any(|key| target.get(*key).and_then(Value::as_object).is_some())
}

fn tool_process_subject(arguments: Option<&Value>, tool_name: Option<&str>) -> Option<String> {
    let subject = arguments.and_then(|arguments| {
        let object = arguments.as_object()?;
        [
            "query",
            "q",
            "searchQuery",
            "url",
            "href",
            "path",
            "file_path",
            "filePath",
            "title",
            "name",
            "command",
            "cmd",
            "prompt",
            "id",
            "task_id",
            "taskId",
            "libraryName",
            "location",
            "ticker",
        ]
        .iter()
        .find_map(|key| object.get(*key).and_then(value_to_short_string))
    });
    subject.or_else(|| {
        tool_name
            .and_then(non_empty_str)
            .map(|value| shorten_value(value, 72))
    })
}

fn value_to_short_string(value: &Value) -> Option<String> {
    match value {
        Value::String(value) => non_empty_str(value).map(|value| shorten_value(value, 72)),
        Value::Number(value) => Some(value.to_string()),
        Value::Bool(value) => Some(value.to_string()),
        _ => None,
    }
}

fn normalize_tool_name(tool_name: &str) -> String {
    tool_name
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect()
}

fn shorten_value(value: &str, max_chars: usize) -> String {
    let value = value.trim();
    if value.chars().count() <= max_chars {
        return value.to_string();
    }
    let mut shortened = value
        .chars()
        .take(max_chars.saturating_sub(3))
        .collect::<String>();
    shortened.push_str("...");
    shortened
}

pub(crate) fn tool_failure_category(result: &AgentToolResult) -> String {
    result
        .metadata
        .as_ref()
        .and_then(|metadata| {
            [
                "failureCategory",
                "failure_category",
                "reasonCode",
                "reason_code",
            ]
            .iter()
            .find_map(|key| metadata.get(*key)?.as_str().and_then(non_empty_str))
        })
        .unwrap_or("tool_failed")
        .to_string()
}

fn non_empty_str(value: &str) -> Option<&str> {
    let value = value.trim();
    (!value.is_empty()).then_some(value)
}
