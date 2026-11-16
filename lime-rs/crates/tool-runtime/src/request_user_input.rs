use crate::tool_definition::RuntimeToolDefinition;
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};
use std::fmt;

#[path = "request_user_input/execution.rs"]
mod execution;
#[path = "request_user_input/response.rs"]
mod response;

pub use execution::{RequestUserInputCallback, execute_request_user_input};
pub use response::{
    build_elicitation_message, build_elicitation_schema, extract_response,
    normalize_request_user_input_result,
};

pub const DEFAULT_REQUEST_USER_INPUT_TIMEOUT_SECS: u64 = 300;
pub const REQUEST_USER_INPUT_TOOL_NAME: &str = "request_user_input";
pub const REQUEST_USER_INPUT_HEADER_WIDTH: usize = 12;
pub const REQUEST_USER_INPUT_QUESTIONS_SCHEMA_KEY: &str = "x-lime-ask-user-questions";
const REQUEST_USER_INPUT_TOOL_DESCRIPTION: &str = "Request user input for one to three short questions and wait for the response. \
Set autoResolutionMs, from 60000 to 240000 milliseconds, only when the question is useful \
but non-blocking and continuing with best judgment is acceptable if the user does not answer; \
omit it when explicit user input is required.";

fn is_false(value: &bool) -> bool {
    !*value
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RequestUserInputSurfaceErrorKind {
    InvalidParams,
    ExecutionFailed,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RequestUserInputSurfaceError {
    kind: RequestUserInputSurfaceErrorKind,
    message: String,
}

impl RequestUserInputSurfaceError {
    pub fn invalid_params(message: impl Into<String>) -> Self {
        Self {
            kind: RequestUserInputSurfaceErrorKind::InvalidParams,
            message: message.into(),
        }
    }

    pub fn execution_failed(message: impl Into<String>) -> Self {
        Self {
            kind: RequestUserInputSurfaceErrorKind::ExecutionFailed,
            message: message.into(),
        }
    }

    pub fn kind(&self) -> RequestUserInputSurfaceErrorKind {
        self.kind
    }

    pub fn message(&self) -> &str {
        &self.message
    }
}

impl fmt::Display for RequestUserInputSurfaceError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{}", self.message)
    }
}

impl std::error::Error for RequestUserInputSurfaceError {}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RequestUserInputQuestion {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    pub question: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub header: Option<String>,
    #[serde(default, skip_serializing_if = "is_false")]
    pub is_other: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    pub is_secret: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub options: Vec<RequestUserInputOption>,
    #[serde(default, alias = "multi_select")]
    pub multi_select: bool,
}

impl RequestUserInputQuestion {
    pub fn new(question: impl Into<String>) -> Self {
        Self {
            id: None,
            question: question.into(),
            header: None,
            is_other: false,
            is_secret: false,
            options: Vec::new(),
            multi_select: false,
        }
    }

    pub fn with_options(question: impl Into<String>, options: Vec<RequestUserInputOption>) -> Self {
        Self {
            id: None,
            question: question.into(),
            header: None,
            is_other: false,
            is_secret: false,
            options,
            multi_select: false,
        }
    }

    fn validate(&self) -> Result<(), RequestUserInputSurfaceError> {
        if self.question.trim().is_empty() {
            return Err(RequestUserInputSurfaceError::invalid_params(
                "Question text cannot be empty",
            ));
        }

        for option in &self.options {
            option.validate()?;
        }

        Ok(())
    }

    fn validate_current_surface(&self) -> Result<(), RequestUserInputSurfaceError> {
        let id = self
            .id
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| {
                RequestUserInputSurfaceError::invalid_params(
                    "request_user_input.questions[].id is required",
                )
            })?;

        if !id.chars().all(|character| {
            character.is_ascii_lowercase() || character == '_' || character.is_ascii_digit()
        }) {
            return Err(RequestUserInputSurfaceError::invalid_params(
                "request_user_input.questions[].id must be snake_case",
            ));
        }

        let header = self
            .header
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| {
                RequestUserInputSurfaceError::invalid_params(
                    "Question header is required for request_user_input",
                )
            })?;

        if header.chars().count() > REQUEST_USER_INPUT_HEADER_WIDTH {
            return Err(RequestUserInputSurfaceError::invalid_params(format!(
                "Question header cannot exceed {REQUEST_USER_INPUT_HEADER_WIDTH} characters"
            )));
        }

        let mut labels = BTreeSet::new();
        for option in &self.options {
            let label = option.display().trim();
            if !labels.insert(label.to_string()) {
                return Err(RequestUserInputSurfaceError::invalid_params(
                    "Option labels must be unique within each question",
                ));
            }
        }

        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RequestUserInputRequest {
    pub questions: Vec<RequestUserInputQuestion>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auto_resolution_ms: Option<u64>,
}

impl RequestUserInputRequest {
    pub fn from_legacy(question: impl Into<String>, options: Vec<RequestUserInputOption>) -> Self {
        Self {
            questions: vec![RequestUserInputQuestion::with_options(question, options)],
            auto_resolution_ms: None,
        }
    }

    fn validate(&self) -> Result<(), RequestUserInputSurfaceError> {
        if self.questions.is_empty() {
            return Err(RequestUserInputSurfaceError::invalid_params(
                "At least one question is required",
            ));
        }

        if self.questions.len() > 3 {
            return Err(RequestUserInputSurfaceError::invalid_params(
                "request_user_input questions cannot exceed 3 entries",
            ));
        }

        for question in &self.questions {
            question.validate()?;
        }

        Ok(())
    }

    fn validate_current_surface(&self) -> Result<(), RequestUserInputSurfaceError> {
        self.validate()?;

        let mut question_texts = BTreeSet::new();
        let mut headers = BTreeSet::new();
        for question in &self.questions {
            if !question_texts.insert(question.question.trim().to_string()) {
                return Err(RequestUserInputSurfaceError::invalid_params(
                    "Question texts must be unique",
                ));
            }
            question.validate_current_surface()?;
            if let Some(header) = question.header.as_deref().map(str::trim) {
                if !headers.insert(header.to_string()) {
                    return Err(RequestUserInputSurfaceError::invalid_params(
                        "Question headers must be unique",
                    ));
                }
            }
        }

        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RequestUserInputOption {
    pub value: String,
    pub label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preview: Option<String>,
}

impl RequestUserInputOption {
    pub fn new(value: impl Into<String>) -> Self {
        Self {
            value: value.into(),
            label: None,
            description: None,
            preview: None,
        }
    }

    pub fn with_label(value: impl Into<String>, label: impl Into<String>) -> Self {
        Self {
            value: value.into(),
            label: Some(label.into()),
            description: None,
            preview: None,
        }
    }

    pub fn display(&self) -> &str {
        self.label.as_deref().unwrap_or(&self.value)
    }

    fn validate(&self) -> Result<(), RequestUserInputSurfaceError> {
        if self.value.trim().is_empty() && self.display().trim().is_empty() {
            return Err(RequestUserInputSurfaceError::invalid_params(
                "Option value/label cannot both be empty",
            ));
        }

        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct RequestUserInputAnnotation {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preview: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestUserInputResult {
    pub response: Value,
    pub answers: BTreeMap<String, String>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub annotations: BTreeMap<String, RequestUserInputAnnotation>,
    pub from_option: bool,
    pub option_index: Option<usize>,
}

impl RequestUserInputResult {
    fn new(
        response: Value,
        answers: BTreeMap<String, String>,
        annotations: BTreeMap<String, RequestUserInputAnnotation>,
        from_option: bool,
        option_index: Option<usize>,
    ) -> Self {
        Self {
            response,
            answers,
            annotations,
            from_option,
            option_index,
        }
    }

    pub fn primary_response(&self) -> Option<&str> {
        self.answers.values().next().map(String::as_str)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct RequestUserInputProjection {
    pub output: String,
    pub metadata: BTreeMap<String, Value>,
}

pub fn project_request_user_input_result(
    request: &RequestUserInputRequest,
    result: &RequestUserInputResult,
) -> RequestUserInputProjection {
    let answers_text = result
        .answers
        .iter()
        .map(|(question, answer)| {
            let mut parts = vec![format!("\"{question}\"=\"{answer}\"")];
            if let Some(annotation) = result.annotations.get(question) {
                if let Some(preview) = annotation.preview.as_deref() {
                    parts.push(format!("selected preview:\n{preview}"));
                }
                if let Some(notes) = annotation.notes.as_deref() {
                    parts.push(format!("user notes: {notes}"));
                }
            }
            parts.join(" ")
        })
        .collect::<Vec<_>>()
        .join(", ");
    let output = format!(
        "User has answered your questions: {answers_text}. You can now continue with the user's answers in mind."
    );

    let mut metadata = BTreeMap::new();
    metadata.insert("questions".to_string(), json!(request.questions));
    metadata.insert("answers".to_string(), json!(result.answers));
    metadata.insert("raw_response".to_string(), result.response.clone());
    if !result.annotations.is_empty() {
        metadata.insert("annotations".to_string(), json!(result.annotations));
    }

    RequestUserInputProjection { output, metadata }
}

pub fn request_user_input_tool_definition() -> RuntimeToolDefinition {
    RuntimeToolDefinition::new(
        REQUEST_USER_INPUT_TOOL_NAME,
        REQUEST_USER_INPUT_TOOL_DESCRIPTION,
        request_user_input_tool_input_schema(),
    )
}

pub fn request_user_input_canonical_tool_name(name: &str) -> Option<&'static str> {
    name.eq_ignore_ascii_case(REQUEST_USER_INPUT_TOOL_NAME)
        .then_some(REQUEST_USER_INPUT_TOOL_NAME)
}

#[derive(Debug, Clone)]
enum RequestUserInputOptionInput {
    String(String),
    Object(RequestUserInputOptionObject),
}

impl<'de> Deserialize<'de> for RequestUserInputOptionInput {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = Value::deserialize(deserializer)?;
        match value {
            Value::String(value) => Ok(Self::String(value)),
            Value::Object(_) => serde_json::from_value::<RequestUserInputOptionObject>(value)
                .map(Self::Object)
                .map_err(serde::de::Error::custom),
            _ => Err(serde::de::Error::custom(
                "request_user_input option must be a string or object",
            )),
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct RequestUserInputOptionObject {
    value: Option<String>,
    label: Option<String>,
    description: Option<String>,
    preview: Option<String>,
}

impl TryFrom<RequestUserInputOptionInput> for RequestUserInputOption {
    type Error = RequestUserInputSurfaceError;

    fn try_from(value: RequestUserInputOptionInput) -> Result<Self, Self::Error> {
        match value {
            RequestUserInputOptionInput::String(value) => {
                let option = RequestUserInputOption::new(value);
                option.validate()?;
                Ok(option)
            }
            RequestUserInputOptionInput::Object(object) => {
                let value = object
                    .value
                    .or_else(|| object.label.clone())
                    .unwrap_or_default();
                let option = RequestUserInputOption {
                    value,
                    label: object.label,
                    description: object.description,
                    preview: object.preview,
                };
                option.validate()?;
                Ok(option)
            }
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct RequestUserInputQuestionInput {
    id: Option<String>,
    question: String,
    header: Option<String>,
    #[serde(default, rename = "isOther")]
    is_other: bool,
    #[serde(default, rename = "isSecret")]
    is_secret: bool,
    options: Option<Vec<RequestUserInputOptionInput>>,
    #[serde(default, alias = "multi_select")]
    multi_select: bool,
}

impl TryFrom<RequestUserInputQuestionInput> for RequestUserInputQuestion {
    type Error = RequestUserInputSurfaceError;

    fn try_from(value: RequestUserInputQuestionInput) -> Result<Self, Self::Error> {
        let options = value
            .options
            .unwrap_or_default()
            .into_iter()
            .map(RequestUserInputOption::try_from)
            .collect::<Result<Vec<_>, _>>()?;

        let question = RequestUserInputQuestion {
            id: value.id,
            question: value.question,
            header: value.header,
            is_other: value.is_other,
            is_secret: value.is_secret,
            options,
            multi_select: value.multi_select,
        };
        question.validate()?;
        Ok(question)
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct RequestUserInputParams {
    questions: Option<Vec<RequestUserInputQuestionInput>>,
    #[serde(default, alias = "auto_resolution_ms")]
    auto_resolution_ms: Option<u64>,
}

pub fn parse_request_user_input_tool_input(
    params: Value,
) -> Result<RequestUserInputRequest, RequestUserInputSurfaceError> {
    let input: RequestUserInputParams = serde_json::from_value(params).map_err(|error| {
        RequestUserInputSurfaceError::invalid_params(format!(
            "Failed to parse request_user_input input: {error}"
        ))
    })?;

    let questions = input.questions.ok_or_else(|| {
        RequestUserInputSurfaceError::invalid_params("Missing required parameter: questions")
    })?;
    let request = RequestUserInputRequest {
        questions: questions
            .into_iter()
            .map(RequestUserInputQuestion::try_from)
            .collect::<Result<Vec<_>, _>>()?,
        auto_resolution_ms: input.auto_resolution_ms,
    };

    request.validate_current_surface()?;
    Ok(request)
}

pub fn request_user_input_tool_input_schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "properties": {
            "questions": {
                "type": "array",
                "description": "Questions to show the user. Prefer 1 and do not exceed 3",
                "minItems": 1,
                "maxItems": 3,
                "items": {
                    "type": "object",
                    "additionalProperties": false,
                    "properties": {
                        "id": {
                            "type": "string",
                            "description": "Stable identifier for mapping answers (snake_case)."
                        },
                        "header": {
                            "type": "string",
                            "description": "Short header label shown in the UI (12 or fewer chars)."
                        },
                        "question": {
                            "type": "string",
                            "description": "Single-sentence prompt shown to the user."
                        },
                        "isOther": {
                            "type": "boolean",
                            "default": false
                        },
                        "isSecret": {
                            "type": "boolean",
                            "default": false
                        },
                        "options": {
                            "type": "array",
                            "description": "Optional selectable choices. Omit this field for a free-form answer.",
                            "items": {
                                "type": "object",
                                "additionalProperties": false,
                                "properties": {
                                    "label": {
                                        "type": "string",
                                        "description": "User-facing label (1-5 words)."
                                    },
                                    "description": {
                                        "type": "string",
                                        "description": "One short sentence explaining impact/tradeoff if selected."
                                    }
                                },
                                "required": ["label", "description"]
                            }
                        }
                    },
                    "required": ["id", "header", "question"]
                }
            },
            "autoResolutionMs": {
                "type": "number",
                "minimum": 60000,
                "maximum": 240000,
                "description": "Optional auto-resolution window in milliseconds, from 60000 to 240000. Include this only when the question is useful but non-blocking and continuing with best judgment is acceptable if the user does not answer; omit it when explicit user input is required before continuing."
            }
        },
        "required": ["questions"]
    })
}

pub fn resolve_request_prompt(request: &RequestUserInputRequest) -> String {
    request
        .questions
        .first()
        .map(|question| question.question.trim().to_string())
        .filter(|question| !question.is_empty())
        .unwrap_or_else(|| "请提供继续执行所需信息".to_string())
}

pub(super) fn requested_schema_field_key(
    question: &RequestUserInputQuestion,
    index: usize,
    total: usize,
) -> String {
    if total == 1 {
        return "answer".to_string();
    }

    if let Some(header) = question.header.as_deref() {
        let normalized = header
            .trim()
            .to_lowercase()
            .chars()
            .map(|ch| {
                if ch.is_ascii_alphanumeric() || ch == '_' || ch == '-' {
                    ch
                } else {
                    '_'
                }
            })
            .collect::<String>()
            .trim_matches('_')
            .to_string();

        if !normalized.is_empty() {
            return normalized;
        }
    }

    format!("question_{}", index + 1)
}

fn build_question_schema(
    question: &RequestUserInputQuestion,
    index: usize,
    total: usize,
) -> (String, Value) {
    let field_key = requested_schema_field_key(question, index, total);
    let option_labels = question
        .options
        .iter()
        .map(|option| option.display().to_string())
        .collect::<Vec<_>>();

    let mut property = json!({
        "title": question.header.clone().unwrap_or_else(|| question.question.clone()),
        "description": question.question,
    });

    if let Some(object) = property.as_object_mut() {
        if question.multi_select {
            object.insert("type".to_string(), json!("array"));
            object.insert(
                "items".to_string(),
                json!({
                    "type": "string",
                    "enum": option_labels,
                }),
            );
        } else {
            object.insert("type".to_string(), json!("string"));
            if !option_labels.is_empty() {
                object.insert("enum".to_string(), json!(option_labels));
            }
        }
    }

    (field_key, property)
}

pub fn build_requested_schema(request: &RequestUserInputRequest) -> Value {
    let total = request.questions.len();
    let mut properties = serde_json::Map::new();
    let mut required = Vec::new();

    for (index, question) in request.questions.iter().enumerate() {
        let (field_key, property) = build_question_schema(question, index, total);
        properties.insert(field_key.clone(), property);
        required.push(field_key);
    }

    json!({
        "type": "object",
        "properties": properties,
        "required": required,
        REQUEST_USER_INPUT_QUESTIONS_SCHEMA_KEY: request.questions,
    })
}

#[cfg(test)]
mod tests;
