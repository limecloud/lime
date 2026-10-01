//! MCP form and approval schema validation; no input or rendering state.

use super::*;

pub(super) fn parse_fields(schema: &Value) -> Option<Vec<McpField>> {
    let schema = schema.as_object()?;
    if schema.get("type").and_then(Value::as_str) != Some("object") {
        return None;
    }
    let properties = schema.get("properties")?.as_object()?;
    let required = parse_required(schema.get("required"), properties)?;
    properties
        .iter()
        .map(|(id, property)| parse_field(id, property, required.contains(id)))
        .collect()
}

pub(super) fn is_empty_object_schema(schema: &Value) -> bool {
    schema
        .as_object()
        .and_then(|schema| {
            schema
                .get("type")
                .and_then(Value::as_str)
                .map(|type_name| (schema, type_name))
        })
        .is_some_and(|(schema, type_name)| {
            type_name == "object"
                && schema
                    .get("properties")
                    .and_then(Value::as_object)
                    .is_some_and(Map::is_empty)
        })
}

pub(super) fn is_tool_suggestion(meta: Option<&Value>) -> bool {
    meta.and_then(Value::as_object)
        .and_then(|meta| meta.get(APPROVAL_META_KIND_KEY))
        .and_then(Value::as_str)
        == Some(APPROVAL_META_KIND_TOOL_SUGGESTION)
}

pub(super) fn is_tool_call_approval(meta: Option<&Value>) -> bool {
    meta.and_then(Value::as_object)
        .and_then(|meta| meta.get(APPROVAL_META_KIND_KEY))
        .and_then(Value::as_str)
        == Some(APPROVAL_META_KIND_MCP_TOOL_CALL)
}

pub(super) fn parse_tool_approval_display_params(
    meta: Option<&Value>,
) -> Vec<McpToolApprovalDisplayParam> {
    let Some(meta) = meta.and_then(Value::as_object) else {
        return Vec::new();
    };

    let display_params = meta
        .get(APPROVAL_TOOL_PARAMS_DISPLAY_KEY)
        .and_then(Value::as_array)
        .map(|params| {
            params
                .iter()
                .filter_map(parse_tool_approval_display_param)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    if !display_params.is_empty() {
        return display_params;
    }

    let mut fallback = meta
        .get(APPROVAL_TOOL_PARAMS_KEY)
        .and_then(Value::as_object)
        .map(|params| {
            params
                .iter()
                .map(|(name, value)| McpToolApprovalDisplayParam {
                    name: name.clone(),
                    value: value.clone(),
                    display_name: name.clone(),
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    fallback.sort_by(|left, right| left.name.cmp(&right.name));
    fallback
}

pub(super) fn parse_tool_approval_display_param(
    value: &Value,
) -> Option<McpToolApprovalDisplayParam> {
    let value = value.as_object()?;
    let name = value.get("name")?.as_str()?.trim();
    if name.is_empty() {
        return None;
    }
    let display_name = value
        .get("display_name")
        .and_then(Value::as_str)
        .unwrap_or(name)
        .trim();
    if display_name.is_empty() {
        return None;
    }
    Some(McpToolApprovalDisplayParam {
        name: name.to_string(),
        value: value.get("value")?.clone(),
        display_name: display_name.to_string(),
    })
}

pub(super) fn format_tool_approval_display_message(
    message: &str,
    display_params: &[McpToolApprovalDisplayParam],
) -> String {
    let message = message.trim();
    if display_params.is_empty() {
        return message.to_string();
    }

    let mut sections = Vec::new();
    if !message.is_empty() {
        sections.push(message.to_string());
    }
    let params = display_params
        .iter()
        .take(APPROVAL_TOOL_PARAM_DISPLAY_LIMIT)
        .map(format_tool_approval_display_param_line)
        .collect::<Vec<_>>();
    if !params.is_empty() {
        sections.push(params.join("\n"));
    }
    sections.join("\n\n")
}

pub(super) fn format_tool_approval_display_param_line(
    param: &McpToolApprovalDisplayParam,
) -> String {
    format!(
        "{}: {}",
        param.display_name,
        format_tool_approval_display_param_value(&param.value)
    )
}

pub(super) fn format_tool_approval_display_param_value(value: &Value) -> String {
    let formatted = match value {
        Value::String(text) => text.split_whitespace().collect::<Vec<_>>().join(" "),
        _ => {
            let compact_json = value.to_string();
            format_json_compact(&compact_json).unwrap_or(compact_json)
        }
    };
    truncate_text(&formatted, APPROVAL_TOOL_PARAM_VALUE_TRUNCATE_GRAPHEMES)
}

pub(super) fn approval_fields(meta: Option<&Value>) -> Option<Vec<McpField>> {
    let is_tool_call = is_tool_call_approval(meta);
    let mut options = vec![McpOption {
        label: APPROVAL_ACCEPT_ONCE_VALUE.to_string(),
        description: None,
        value: Value::String(APPROVAL_ACCEPT_ONCE_VALUE.to_string()),
    }];
    if approval_supports_persist_mode(meta, APPROVAL_PERSIST_SESSION_VALUE) {
        options.push(McpOption {
            label: APPROVAL_ACCEPT_SESSION_VALUE.to_string(),
            description: None,
            value: Value::String(APPROVAL_ACCEPT_SESSION_VALUE.to_string()),
        });
    }
    if approval_supports_persist_mode(meta, APPROVAL_PERSIST_ALWAYS_VALUE) {
        options.push(McpOption {
            label: APPROVAL_ACCEPT_ALWAYS_VALUE.to_string(),
            description: None,
            value: Value::String(APPROVAL_ACCEPT_ALWAYS_VALUE.to_string()),
        });
    }
    if !is_tool_call {
        options.push(McpOption {
            label: APPROVAL_DECLINE_VALUE.to_string(),
            description: None,
            value: Value::String(APPROVAL_DECLINE_VALUE.to_string()),
        });
    }
    options.push(McpOption {
        label: APPROVAL_CANCEL_VALUE.to_string(),
        description: None,
        value: Value::String(APPROVAL_CANCEL_VALUE.to_string()),
    });
    Some(vec![McpField {
        id: "__approval".to_string(),
        label: String::new(),
        description: None,
        required: true,
        input: McpFieldInput::Select {
            options,
            default_index: None,
        },
    }])
}

pub(super) fn approval_supports_persist_mode(meta: Option<&Value>, expected_mode: &str) -> bool {
    let Some(persist) = meta
        .and_then(Value::as_object)
        .and_then(|meta| meta.get(APPROVAL_PERSIST_KEY))
    else {
        return false;
    };
    match persist {
        Value::String(value) => value == expected_mode,
        Value::Array(values) => values
            .iter()
            .filter_map(Value::as_str)
            .any(|value| value == expected_mode),
        _ => false,
    }
}

pub(super) fn parse_required(
    value: Option<&Value>,
    properties: &Map<String, Value>,
) -> Option<HashSet<String>> {
    let Some(value) = value else {
        return Some(HashSet::new());
    };
    if value.is_null() {
        return Some(HashSet::new());
    }
    let required = value.as_array()?;
    let mut names = HashSet::new();
    for value in required {
        let name = value.as_str()?.to_string();
        if !properties.contains_key(&name) {
            return None;
        }
        names.insert(name);
    }
    Some(names)
}

pub(super) fn parse_field(id: &str, property: &Value, required: bool) -> Option<McpField> {
    let property = property.as_object()?;
    let type_name = property.get("type")?.as_str()?;
    let label = string_property(property, "title")?.unwrap_or_else(|| id.to_string());
    let description = string_property(property, "description")?;
    let input = match type_name {
        "string" if property.contains_key("enum") || property.contains_key("oneOf") => {
            McpFieldInput::Select {
                options: parse_options(property)?,
                default_index: parse_default_index(property)?,
            }
        }
        "string" => McpFieldInput::Text {
            default: optional_string_property(property, "default")?,
        },
        "boolean" => McpFieldInput::Select {
            options: vec![
                McpOption {
                    label: "true".to_string(),
                    description: None,
                    value: Value::Bool(true),
                },
                McpOption {
                    label: "false".to_string(),
                    description: None,
                    value: Value::Bool(false),
                },
            ],
            default_index: match property.get("default") {
                None | Some(Value::Null) => None,
                Some(value) => Some(usize::from(!value.as_bool()?)),
            },
        },
        _ => return None,
    };
    Some(McpField {
        id: id.to_string(),
        label,
        description,
        required,
        input,
    })
}

pub(super) fn parse_options(property: &Map<String, Value>) -> Option<Vec<McpOption>> {
    if property.contains_key("enum") && property.contains_key("oneOf") {
        return None;
    }
    if let Some(values) = property.get("enum") {
        let values = values.as_array()?;
        if values.is_empty() {
            return None;
        }
        let labels = match property.get("enumNames") {
            None | Some(Value::Null) => None,
            Some(Value::Array(labels)) => Some(
                labels
                    .iter()
                    .map(Value::as_str)
                    .collect::<Option<Vec<_>>>()?,
            ),
            Some(_) => return None,
        };
        if labels
            .as_ref()
            .is_some_and(|labels| labels.len() != values.len())
        {
            return None;
        }
        return values
            .iter()
            .enumerate()
            .map(|(index, value)| {
                let value = value.as_str()?.to_string();
                Some(McpOption {
                    label: labels
                        .as_ref()
                        .and_then(|labels| labels.get(index).copied())
                        .unwrap_or(value.as_str())
                        .to_string(),
                    description: None,
                    value: Value::String(value),
                })
            })
            .collect();
    }

    let values = property.get("oneOf")?.as_array()?;
    if values.is_empty() {
        return None;
    }
    values
        .iter()
        .map(|value| {
            let option = value.as_object()?;
            Some(McpOption {
                label: option.get("title")?.as_str()?.to_string(),
                description: string_property(option, "description")?,
                value: Value::String(option.get("const")?.as_str()?.to_string()),
            })
        })
        .collect()
}

pub(super) fn parse_default_index(property: &Map<String, Value>) -> Option<Option<usize>> {
    let Some(default) = property.get("default") else {
        return Some(None);
    };
    let default = default.as_str()?;
    let options = parse_options(property)?;
    Some(
        options
            .iter()
            .position(|option| option.value.as_str() == Some(default)),
    )
}

pub(super) fn string_property(property: &Map<String, Value>, name: &str) -> Option<Option<String>> {
    match property.get(name) {
        None | Some(Value::Null) => Some(None),
        Some(Value::String(value)) => Some(Some(value.clone())),
        Some(_) => None,
    }
}

pub(super) fn optional_string_property(
    property: &Map<String, Value>,
    name: &str,
) -> Option<Option<String>> {
    string_property(property, name)
}
