use crate::file_read_execution::file_read_canonical_tool_name;
use crate::file_search_execution::file_search_canonical_tool_name;
use crate::native_dispatch::runtime_native_dispatch;
use crate::tool_definition::RuntimeToolDefinition;
use jsonschema::ValidationError;
use jsonschema::error::ValidationErrorKind;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::BTreeSet;

const MAX_SCHEMA_ERRORS: usize = 4;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ToolCallRepairFailureKind {
    MissingName,
    UnknownTool,
    MalformedArguments,
    ArgumentsNotObject,
    InvalidSchema,
    SchemaMismatch,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ToolArgumentChange {
    pub key: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub before: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub after: Option<Value>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ToolCallRepair {
    pub requested_name: String,
    pub resolved_name: String,
    pub original_arguments: Map<String, Value>,
    pub arguments: Map<String, Value>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub argument_changes: Vec<ToolArgumentChange>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ToolCallRepairFailure {
    pub requested_name: String,
    pub raw_arguments: String,
    pub kind: ToolCallRepairFailureKind,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub schema_errors: Vec<String>,
}

impl ToolCallRepairFailure {
    pub fn message(&self) -> String {
        match self.kind {
            ToolCallRepairFailureKind::MissingName => {
                "Provider tool call omitted tool name".to_string()
            }
            ToolCallRepairFailureKind::UnknownTool => format!(
                "tool '{}' was not advertised for this sampling step",
                self.requested_name
            ),
            ToolCallRepairFailureKind::MalformedArguments => format!(
                "tool '{}' received malformed JSON arguments",
                self.requested_name
            ),
            ToolCallRepairFailureKind::ArgumentsNotObject => format!(
                "tool '{}' arguments must be a JSON object",
                self.requested_name
            ),
            ToolCallRepairFailureKind::InvalidSchema => format!(
                "tool '{}' advertised an invalid input schema",
                self.requested_name
            ),
            ToolCallRepairFailureKind::SchemaMismatch => {
                let message = format!(
                    "tool '{}' arguments did not match the advertised input schema",
                    self.requested_name
                );
                if self.schema_errors.is_empty() {
                    message
                } else {
                    format!("{message}: {}", self.schema_errors.join("; "))
                }
            }
        }
    }

    pub fn model_arguments(&self) -> Map<String, Value> {
        Map::from_iter([
            (
                "tool".to_string(),
                Value::String(self.requested_name.clone()),
            ),
            ("error".to_string(), Value::String(self.message())),
        ])
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum ToolCallRepairOutcome {
    Ready(ToolCallRepair),
    Invalid(ToolCallRepairFailure),
}

pub fn repair_tool_call(
    available_tools: &[RuntimeToolDefinition],
    requested_name: &str,
    raw_arguments: &str,
    canonical_name: &dyn Fn(&str) -> Option<String>,
) -> ToolCallRepairOutcome {
    let requested_name = requested_name.trim();
    if requested_name.is_empty() {
        return invalid_tool_call_repair(
            requested_name,
            raw_arguments,
            ToolCallRepairFailureKind::MissingName,
        );
    }
    let available_tool_names = available_tools
        .iter()
        .map(|definition| definition.name.as_str())
        .collect::<Vec<_>>();
    let Some(resolved_name) =
        runtime_tool_call_surface_name(&available_tool_names, requested_name, canonical_name)
    else {
        return invalid_tool_call_repair(
            requested_name,
            raw_arguments,
            ToolCallRepairFailureKind::UnknownTool,
        );
    };
    let parsed_arguments = match serde_json::from_str::<Value>(raw_arguments) {
        Ok(value) => value,
        Err(_) => {
            return invalid_tool_call_repair(
                requested_name,
                raw_arguments,
                ToolCallRepairFailureKind::MalformedArguments,
            );
        }
    };
    let Value::Object(original_arguments) = parsed_arguments else {
        return invalid_tool_call_repair(
            requested_name,
            raw_arguments,
            ToolCallRepairFailureKind::ArgumentsNotObject,
        );
    };
    let definition = available_tools
        .iter()
        .find(|definition| definition.name == resolved_name)
        .expect("resolved tool name must come from the frozen definitions");
    let mut arguments = original_arguments.clone();
    runtime_tool_call_normalize_arguments(&resolved_name, &mut arguments);
    let mut argument_value = Value::Object(arguments);
    coerce_numeric_strings(&mut argument_value, &definition.input_schema);
    let Value::Object(arguments) = argument_value else {
        unreachable!("tool arguments remain an object after schema coercion");
    };
    let validator = match jsonschema::validator_for(&definition.input_schema) {
        Ok(validator) => validator,
        Err(_) => {
            return invalid_tool_call_schema_repair(
                requested_name,
                raw_arguments,
                ToolCallRepairFailureKind::InvalidSchema,
                Vec::new(),
            );
        }
    };
    let schema_errors = validator
        .iter_errors(&Value::Object(arguments.clone()))
        .take(MAX_SCHEMA_ERRORS)
        .map(safe_schema_validation_error)
        .collect::<Vec<_>>();
    if !schema_errors.is_empty() {
        return invalid_tool_call_schema_repair(
            requested_name,
            raw_arguments,
            ToolCallRepairFailureKind::SchemaMismatch,
            schema_errors,
        );
    }
    let keys = original_arguments
        .keys()
        .chain(arguments.keys())
        .collect::<BTreeSet<_>>();
    let argument_changes = keys
        .into_iter()
        .filter_map(|key| {
            let before = original_arguments.get(key);
            let after = arguments.get(key);
            (before != after).then(|| ToolArgumentChange {
                key: key.clone(),
                before: before.cloned(),
                after: after.cloned(),
            })
        })
        .collect::<Vec<_>>();

    ToolCallRepairOutcome::Ready(ToolCallRepair {
        requested_name: requested_name.to_string(),
        resolved_name,
        original_arguments,
        arguments,
        argument_changes,
    })
}

fn invalid_tool_call_repair(
    requested_name: &str,
    raw_arguments: &str,
    kind: ToolCallRepairFailureKind,
) -> ToolCallRepairOutcome {
    invalid_tool_call_schema_repair(requested_name, raw_arguments, kind, Vec::new())
}

fn invalid_tool_call_schema_repair(
    requested_name: &str,
    raw_arguments: &str,
    kind: ToolCallRepairFailureKind,
    schema_errors: Vec<String>,
) -> ToolCallRepairOutcome {
    ToolCallRepairOutcome::Invalid(ToolCallRepairFailure {
        requested_name: requested_name.to_string(),
        raw_arguments: raw_arguments.to_string(),
        kind,
        schema_errors,
    })
}

fn coerce_numeric_strings(value: &mut Value, schema: &Value) {
    let Some(schema) = schema.as_object() else {
        return;
    };
    match schema.get("type").and_then(Value::as_str) {
        Some("integer" | "number") => {
            let Value::String(text) = value else {
                return;
            };
            let Ok(Value::Number(number)) = serde_json::from_str::<Value>(text.trim()) else {
                return;
            };
            *value = Value::Number(number);
        }
        Some("object") => {
            let (Value::Object(arguments), Some(properties)) =
                (value, schema.get("properties").and_then(Value::as_object))
            else {
                return;
            };
            for (key, property_schema) in properties {
                if let Some(argument) = arguments.get_mut(key) {
                    coerce_numeric_strings(argument, property_schema);
                }
            }
        }
        Some("array") => {
            let (Value::Array(items), Some(item_schema)) = (value, schema.get("items")) else {
                return;
            };
            for item in items {
                coerce_numeric_strings(item, item_schema);
            }
        }
        _ => {}
    }
}

fn safe_schema_validation_error(error: ValidationError<'_>) -> String {
    let detail = match &error.kind {
        ValidationErrorKind::AdditionalProperties { .. } => {
            "additional properties are not allowed".to_string()
        }
        ValidationErrorKind::UnevaluatedProperties { .. } => {
            "unevaluated properties are not allowed".to_string()
        }
        ValidationErrorKind::PropertyNames { .. } => {
            "a property name did not match the schema".to_string()
        }
        _ => error.masked().to_string(),
    };
    let schema_path = error.schema_path.to_string();
    if schema_path.is_empty() {
        detail
    } else {
        format!("schema {schema_path}: {detail}")
    }
}

pub fn runtime_tool_call_surface_name<T: AsRef<str>>(
    available_tool_names: &[T],
    requested_name: &str,
    canonical_name: &dyn Fn(&str) -> Option<String>,
) -> Option<String> {
    let requested_name = requested_name.trim();
    if requested_name.is_empty() {
        return None;
    }

    if let Some(surface_name) = current_surface_tool_name(available_tool_names, requested_name) {
        return Some(surface_name);
    }

    let canonical_name = canonical_name(requested_name)?;
    current_surface_tool_name(available_tool_names, &canonical_name)
}

pub fn runtime_tool_call_canonical_name(requested_name: &str) -> Option<String> {
    runtime_native_dispatch()
        .canonical_name(requested_name)
        .map(ToString::to_string)
        .or_else(|| file_read_canonical_tool_name(requested_name).map(ToString::to_string))
        .or_else(|| file_search_canonical_tool_name(requested_name).map(ToString::to_string))
}

pub fn runtime_tool_call_normalize_arguments(
    tool_name: &str,
    arguments: &mut serde_json::Map<String, Value>,
) {
    match tool_name {
        "Read" => {
            move_argument_if_missing(arguments, "file_path", "path");
            move_argument_if_missing(arguments, "filePath", "path");
            move_argument_if_missing(arguments, "startLine", "start_line");
            move_argument_if_missing(arguments, "endLine", "end_line");
            if !arguments.contains_key("end_line") {
                if let Some(head) = positive_integer_argument(arguments, "head") {
                    arguments.insert("end_line".to_string(), Value::Number(head.into()));
                    arguments
                        .entry("start_line".to_string())
                        .or_insert_with(|| Value::Number(1.into()));
                }
            }
            if arguments.contains_key("end_line") {
                arguments.remove("head");
            }
        }
        "Glob" | "Grep" => {
            move_argument_if_missing(arguments, "query", "pattern");
        }
        _ => {}
    }
}

fn current_surface_tool_name<T: AsRef<str>>(
    available_tool_names: &[T],
    name: &str,
) -> Option<String> {
    available_tool_names
        .iter()
        .find(|tool_name| tool_name.as_ref() == name)
        .or_else(|| {
            available_tool_names
                .iter()
                .find(|tool_name| tool_name.as_ref().eq_ignore_ascii_case(name))
        })
        .map(|tool_name| tool_name.as_ref().to_string())
}

fn positive_integer_argument(arguments: &serde_json::Map<String, Value>, key: &str) -> Option<i64> {
    arguments
        .get(key)
        .and_then(|value| match value {
            Value::Number(number) => number.as_i64(),
            Value::String(text) => text.trim().parse::<i64>().ok(),
            _ => None,
        })
        .filter(|value| *value > 0)
}

fn move_argument_if_missing(arguments: &mut serde_json::Map<String, Value>, from: &str, to: &str) {
    let Some(value) = arguments.remove(from) else {
        return;
    };
    arguments
        .entry(to.to_string())
        .or_insert_with(|| match value {
            Value::String(text) => Value::String(text.trim().to_string()),
            value => value,
        });
}

#[cfg(test)]
mod tests;
