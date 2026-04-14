//! Ask Tool Implementation
//!
//! Provides user interaction capabilities for the agent to ask questions
//! and receive responses from the user.
//!
//! Requirements: 6.1, 6.2, 6.3, 6.4, 6.5

use async_trait::async_trait;
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::{Map, Value};
use std::collections::{BTreeMap, BTreeSet};
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use std::time::Duration;

use crate::tools::base::{PermissionCheckResult, Tool};
use crate::tools::context::{ToolContext, ToolResult};
use crate::tools::error::ToolError;

/// Default timeout for user response (5 minutes)
pub const DEFAULT_ASK_TIMEOUT_SECS: u64 = 300;
pub const ASK_USER_QUESTION_TOOL_NAME: &str = "AskUserQuestion";
pub const ASK_USER_QUESTION_TOOL_CHIP_WIDTH: usize = 12;

/// A structured question payload aligned with modern ask_user style prompts.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AskQuestion {
    /// The complete question text shown to the user
    pub question: String,
    /// Optional short chip/header label
    #[serde(skip_serializing_if = "Option::is_none")]
    pub header: Option<String>,
    /// Optional predefined choices
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub options: Vec<AskOption>,
    /// Whether multiple options can be selected
    #[serde(default, alias = "multi_select")]
    pub multi_select: bool,
}

impl AskQuestion {
    /// Create a new free-form question
    pub fn new(question: impl Into<String>) -> Self {
        Self {
            question: question.into(),
            header: None,
            options: Vec::new(),
            multi_select: false,
        }
    }

    /// Create a question with predefined choices
    pub fn with_options(question: impl Into<String>, options: Vec<AskOption>) -> Self {
        Self {
            question: question.into(),
            header: None,
            options,
            multi_select: false,
        }
    }

    fn validate(&self) -> Result<(), ToolError> {
        if self.question.trim().is_empty() {
            return Err(ToolError::invalid_params(
                "Question text cannot be empty".to_string(),
            ));
        }

        if self.options.len() > 4 {
            return Err(ToolError::invalid_params(
                "Question options cannot exceed 4 choices".to_string(),
            ));
        }

        for option in &self.options {
            option.validate()?;
        }

        Ok(())
    }

    fn validate_current_surface(&self) -> Result<(), ToolError> {
        let header = self
            .header
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| {
                ToolError::invalid_params(
                    "Question header is required for AskUserQuestion".to_string(),
                )
            })?;

        if header.chars().count() > ASK_USER_QUESTION_TOOL_CHIP_WIDTH {
            return Err(ToolError::invalid_params(format!(
                "Question header cannot exceed {} characters",
                ASK_USER_QUESTION_TOOL_CHIP_WIDTH
            )));
        }

        if self.options.len() < 2 || self.options.len() > 4 {
            return Err(ToolError::invalid_params(
                "Each question must provide 2-4 options".to_string(),
            ));
        }

        let mut labels = BTreeSet::new();
        for option in &self.options {
            let label = option.display().trim();
            if !labels.insert(label.to_string()) {
                return Err(ToolError::invalid_params(
                    "Option labels must be unique within each question".to_string(),
                ));
            }
        }

        Ok(())
    }
}

/// A modern ask request that may contain one or more related questions.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AskRequest {
    pub questions: Vec<AskQuestion>,
}

impl AskRequest {
    /// Build a legacy single-question request.
    pub fn from_legacy(question: impl Into<String>, options: Vec<AskOption>) -> Self {
        Self {
            questions: vec![AskQuestion::with_options(question, options)],
        }
    }

    fn validate(&self) -> Result<(), ToolError> {
        if self.questions.is_empty() {
            return Err(ToolError::invalid_params(
                "At least one question is required".to_string(),
            ));
        }

        if self.questions.len() > 4 {
            return Err(ToolError::invalid_params(
                "Questions cannot exceed 4 entries".to_string(),
            ));
        }

        for question in &self.questions {
            question.validate()?;
        }

        Ok(())
    }

    fn validate_current_surface(&self) -> Result<(), ToolError> {
        self.validate()?;

        let mut question_texts = BTreeSet::new();
        let mut headers = BTreeSet::new();
        for question in &self.questions {
            if !question_texts.insert(question.question.trim().to_string()) {
                return Err(ToolError::invalid_params(
                    "Question texts must be unique".to_string(),
                ));
            }
            question.validate_current_surface()?;
            if let Some(header) = question.header.as_deref().map(str::trim) {
                if !headers.insert(header.to_string()) {
                    return Err(ToolError::invalid_params(
                        "Question headers must be unique".to_string(),
                    ));
                }
            }
        }

        Ok(())
    }
}

/// Callback type for handling user questions
///
/// The callback receives the normalized ask request and returns the user's
/// structured response as JSON.
pub type AskCallback =
    Arc<dyn Fn(AskRequest) -> Pin<Box<dyn Future<Output = Option<Value>> + Send>> + Send + Sync>;

/// A predefined option for the user to select
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AskOption {
    /// The value to return if this option is selected
    pub value: String,
    /// Optional display label (defaults to value if not provided)
    pub label: Option<String>,
    /// Optional explanation for the option
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// Optional preview payload for richer UIs
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preview: Option<String>,
}

impl AskOption {
    /// Create a new option with just a value
    pub fn new(value: impl Into<String>) -> Self {
        Self {
            value: value.into(),
            label: None,
            description: None,
            preview: None,
        }
    }

    /// Create a new option with a value and label
    pub fn with_label(value: impl Into<String>, label: impl Into<String>) -> Self {
        Self {
            value: value.into(),
            label: Some(label.into()),
            description: None,
            preview: None,
        }
    }

    /// Get the display text for this option
    pub fn display(&self) -> &str {
        self.label.as_deref().unwrap_or(&self.value)
    }

    fn validate(&self) -> Result<(), ToolError> {
        if self.value.trim().is_empty() && self.display().trim().is_empty() {
            return Err(ToolError::invalid_params(
                "Option value/label cannot both be empty".to_string(),
            ));
        }

        Ok(())
    }
}

/// Result of an ask operation
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct AskAnnotation {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preview: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
}

/// Result of an ask operation
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AskResult {
    /// Raw user data returned from the ask bridge
    pub response: Value,
    /// Normalized answers keyed by question text
    pub answers: BTreeMap<String, String>,
    /// Optional per-question annotations returned from richer clients
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub annotations: BTreeMap<String, AskAnnotation>,
    /// Whether the response was from a predefined option
    pub from_option: bool,
    /// The index of the selected option (if applicable)
    pub option_index: Option<usize>,
}

impl AskResult {
    fn new(
        response: Value,
        answers: BTreeMap<String, String>,
        annotations: BTreeMap<String, AskAnnotation>,
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

/// Ask tool for user interaction
///
/// Allows the agent to ask questions to the user and receive responses.
/// Supports:
/// - Free-form text questions
/// - Predefined options for selection
/// - Configurable timeout
///
/// Requirements: 6.1, 6.2, 6.3, 6.4, 6.5
pub struct AskTool {
    /// Callback for handling user questions
    callback: Option<AskCallback>,
    /// Default timeout for user response
    timeout: Duration,
}

impl Default for AskTool {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug, Clone)]
enum AskOptionInput {
    String(String),
    Object(AskOptionObject),
}

impl<'de> Deserialize<'de> for AskOptionInput {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = Value::deserialize(deserializer)?;
        match value {
            Value::String(value) => Ok(Self::String(value)),
            Value::Object(_) => serde_json::from_value::<AskOptionObject>(value)
                .map(Self::Object)
                .map_err(serde::de::Error::custom),
            _ => Err(serde::de::Error::custom(
                "ask option must be a string or object",
            )),
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct AskOptionObject {
    value: Option<String>,
    label: Option<String>,
    description: Option<String>,
    preview: Option<String>,
}

impl TryFrom<AskOptionInput> for AskOption {
    type Error = ToolError;

    fn try_from(value: AskOptionInput) -> Result<Self, Self::Error> {
        match value {
            AskOptionInput::String(value) => {
                let option = AskOption::new(value);
                option.validate()?;
                Ok(option)
            }
            AskOptionInput::Object(object) => {
                let value = object
                    .value
                    .or_else(|| object.label.clone())
                    .unwrap_or_default();
                let option = AskOption {
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
struct AskQuestionInput {
    question: String,
    header: Option<String>,
    options: Option<Vec<AskOptionInput>>,
    #[serde(default, alias = "multi_select")]
    multi_select: bool,
}

impl TryFrom<AskQuestionInput> for AskQuestion {
    type Error = ToolError;

    fn try_from(value: AskQuestionInput) -> Result<Self, Self::Error> {
        let options = value
            .options
            .unwrap_or_default()
            .into_iter()
            .map(AskOption::try_from)
            .collect::<Result<Vec<_>, _>>()?;

        let question = AskQuestion {
            question: value.question,
            header: value.header,
            options,
            multi_select: value.multi_select,
        };
        question.validate()?;
        Ok(question)
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct AskToolInput {
    questions: Option<Vec<AskQuestionInput>>,
}

impl AskTool {
    /// Create a new AskTool without a callback
    ///
    /// Note: Without a callback, the tool will return an error when executed.
    /// Use `with_callback` to set up the user interaction handler.
    pub fn new() -> Self {
        Self {
            callback: None,
            timeout: Duration::from_secs(DEFAULT_ASK_TIMEOUT_SECS),
        }
    }

    /// Set the callback for handling user questions
    pub fn with_callback(mut self, callback: AskCallback) -> Self {
        self.callback = Some(callback);
        self
    }

    /// Set the default timeout for user responses
    pub fn with_timeout(mut self, timeout: Duration) -> Self {
        self.timeout = timeout;
        self
    }

    /// Check if a callback is configured
    pub fn has_callback(&self) -> bool {
        self.callback.is_some()
    }

    /// Get the configured timeout
    pub fn timeout(&self) -> Duration {
        self.timeout
    }

    fn parse_request(&self, params: Value) -> Result<AskRequest, ToolError> {
        let input: AskToolInput = serde_json::from_value(params).map_err(|e| {
            ToolError::invalid_params(format!("Failed to parse AskUserQuestion input: {e}"))
        })?;

        let questions = input.questions.ok_or_else(|| {
            ToolError::invalid_params("Missing required parameter: questions".to_string())
        })?;
        let request = AskRequest {
            questions: questions
                .into_iter()
                .map(AskQuestion::try_from)
                .collect::<Result<Vec<_>, _>>()?,
        };

        request.validate_current_surface()?;
        Ok(request)
    }

    fn normalize_answer_value(value: &Value) -> Option<String> {
        match value {
            Value::String(text) => {
                let trimmed = text.trim();
                if trimmed.is_empty() {
                    None
                } else {
                    Some(trimmed.to_string())
                }
            }
            Value::Array(items) => {
                let parts = items
                    .iter()
                    .filter_map(Self::normalize_answer_value)
                    .collect::<Vec<_>>();
                if parts.is_empty() {
                    None
                } else {
                    Some(parts.join(", "))
                }
            }
            Value::Number(number) => Some(number.to_string()),
            Value::Bool(value) => Some(value.to_string()),
            _ => None,
        }
    }

    fn question_field_key(question: &AskQuestion, index: usize, total: usize) -> String {
        if total == 1 {
            if let Some(header) = question.header.as_deref() {
                let trimmed = header.trim();
                if !trimmed.is_empty() {
                    return trimmed.to_string();
                }
            }
            return "answer".to_string();
        }

        if let Some(header) = question.header.as_deref() {
            let normalized = header.trim().to_string();

            if !normalized.is_empty() {
                return normalized;
            }
        }

        format!("question_{}", index + 1)
    }

    fn resolve_answers(&self, request: &AskRequest, response: &Value) -> BTreeMap<String, String> {
        let mut answers = BTreeMap::new();
        let total = request.questions.len();

        match response {
            Value::String(_) | Value::Array(_) | Value::Number(_) | Value::Bool(_) => {
                if let Some(first_question) = request.questions.first() {
                    if let Some(answer) = Self::normalize_answer_value(response) {
                        answers.insert(first_question.question.clone(), answer);
                    }
                }
                return answers;
            }
            Value::Object(map) => {
                if let Some(Value::Object(answer_map)) = map.get("answers") {
                    for question in &request.questions {
                        if let Some(value) = answer_map.get(&question.question) {
                            if let Some(answer) = Self::normalize_answer_value(value) {
                                answers.insert(question.question.clone(), answer);
                            }
                        }
                    }
                }

                for (index, question) in request.questions.iter().enumerate() {
                    if answers.contains_key(&question.question) {
                        continue;
                    }

                    for key in [
                        question.question.clone(),
                        question.header.clone().unwrap_or_default(),
                        Self::question_field_key(question, index, total),
                    ] {
                        if key.is_empty() {
                            continue;
                        }

                        if let Some(value) = map.get(&key) {
                            if let Some(answer) = Self::normalize_answer_value(value) {
                                answers.insert(question.question.clone(), answer);
                                break;
                            }
                        }
                    }
                }

                if answers.is_empty() && total == 1 {
                    let candidate = map
                        .get("other")
                        .or_else(|| map.get("answer"))
                        .and_then(Self::normalize_answer_value);
                    if let (Some(question), Some(answer)) = (request.questions.first(), candidate) {
                        answers.insert(question.question.clone(), answer);
                    }
                }

                return answers;
            }
            _ => {}
        }

        answers
    }

    fn resolve_annotations(
        &self,
        request: &AskRequest,
        response: &Value,
    ) -> BTreeMap<String, AskAnnotation> {
        let Some(map) = response.as_object() else {
            return BTreeMap::new();
        };
        let Some(Value::Object(annotation_map)) = map.get("annotations") else {
            return BTreeMap::new();
        };

        let total = request.questions.len();
        let mut annotations = BTreeMap::new();
        for (index, question) in request.questions.iter().enumerate() {
            for key in [
                question.question.clone(),
                question.header.clone().unwrap_or_default(),
                Self::question_field_key(question, index, total),
            ] {
                if key.is_empty() {
                    continue;
                }
                let Some(Value::Object(entry)) = annotation_map.get(&key) else {
                    continue;
                };
                let preview = entry
                    .get("preview")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(str::to_string);
                let notes = entry
                    .get("notes")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(str::to_string);
                if preview.is_some() || notes.is_some() {
                    annotations.insert(question.question.clone(), AskAnnotation { preview, notes });
                    break;
                }
            }
        }

        annotations
    }

    fn resolve_option_match(question: &AskQuestion, answer: Option<&str>) -> (bool, Option<usize>) {
        let Some(answer) = answer.map(str::trim).filter(|value| !value.is_empty()) else {
            return (false, None);
        };

        for (index, option) in question.options.iter().enumerate() {
            if answer == option.value || answer == option.display() {
                return (true, Some(index));
            }
        }

        (false, None)
    }

    fn normalize_result(
        &self,
        request: &AskRequest,
        response: Value,
    ) -> Result<AskResult, ToolError> {
        let mut answers = self.resolve_answers(request, &response);
        let annotations = self.resolve_annotations(request, &response);
        if answers.is_empty() {
            return Err(ToolError::execution_failed(
                "User response was empty or could not be normalized",
            ));
        }

        let (from_option, option_index) = if request.questions.len() == 1 {
            let question = &request.questions[0];
            let answer = answers.get(&question.question).map(String::as_str);
            let (from_option, option_index) = Self::resolve_option_match(question, answer);
            if let Some(index) = option_index {
                if let Some(option) = question.options.get(index) {
                    answers.insert(question.question.clone(), option.value.clone());
                }
            }
            (from_option, option_index)
        } else {
            (false, None)
        };

        Ok(AskResult::new(
            response,
            answers,
            annotations,
            from_option,
            option_index,
        ))
    }

    pub fn build_elicitation_message(request: &AskRequest) -> String {
        if request.questions.len() == 1 {
            return request.questions[0].question.trim().to_string();
        }

        let question_list = request
            .questions
            .iter()
            .enumerate()
            .map(|(index, question)| format!("{}. {}", index + 1, question.question.trim()))
            .collect::<Vec<_>>()
            .join("\n");
        format!("Please answer the following questions:\n{question_list}")
    }

    pub fn build_elicitation_schema(request: &AskRequest) -> Value {
        let total = request.questions.len();
        let mut properties = Map::new();
        let mut required = Vec::with_capacity(total);

        for (index, question) in request.questions.iter().enumerate() {
            let field_key = Self::question_field_key(question, index, total);
            required.push(field_key.clone());

            let description = if question.multi_select {
                let choices = question
                    .options
                    .iter()
                    .map(|option| option.display().to_string())
                    .collect::<Vec<_>>()
                    .join(", ");
                if choices.is_empty() {
                    format!(
                        "{} Separate multiple selections with commas.",
                        question.question
                    )
                } else {
                    format!(
                        "{} Separate multiple selections with commas. Available choices: {}.",
                        question.question, choices
                    )
                }
            } else {
                question.question.clone()
            };

            let mut property = serde_json::json!({
                "type": "string",
                "description": description,
                "minLength": 1
            });

            if !question.multi_select {
                let labels = question
                    .options
                    .iter()
                    .map(|option| option.display().to_string())
                    .collect::<Vec<_>>();
                if !labels.is_empty() {
                    property["enum"] = serde_json::json!(labels);
                }
            }

            properties.insert(field_key, property);
        }

        Value::Object(
            [
                ("type".to_string(), Value::String("object".to_string())),
                (
                    "title".to_string(),
                    Value::String("User input required".to_string()),
                ),
                (
                    "description".to_string(),
                    Value::String(
                        "Provide the requested answers so the agent can continue.".to_string(),
                    ),
                ),
                ("properties".to_string(), Value::Object(properties)),
                ("required".to_string(), serde_json::json!(required)),
            ]
            .into_iter()
            .collect(),
        )
    }

    /// Ask one or more questions to the user and wait for their response.
    pub async fn ask(&self, request: &AskRequest) -> Result<AskResult, ToolError> {
        let callback = self.callback.as_ref().ok_or_else(|| {
            ToolError::execution_failed("No callback configured for user interaction")
        })?;

        // Call the callback with timeout
        let response = tokio::time::timeout(self.timeout, callback(request.clone()))
            .await
            .map_err(|_| ToolError::timeout(self.timeout))?;

        // Handle the response
        match response {
            Some(response_data) => self.normalize_result(request, response_data),
            None => Err(ToolError::execution_failed(
                "User cancelled the interaction",
            )),
        }
    }
}

#[async_trait]
impl Tool for AskTool {
    fn name(&self) -> &str {
        ASK_USER_QUESTION_TOOL_NAME
    }

    fn description(&self) -> &str {
        "Ask the user multiple-choice questions to gather information, clarify ambiguity, \
         understand preferences, and make decisions before continuing execution. \
         Use the modern `questions` array with short headers, 2-4 options, and optional \
         multi-select choices."
    }

    fn input_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "additionalProperties": false,
            "properties": {
                "questions": {
                    "type": "array",
                    "description": "Questions to ask the user (1-4 questions).",
                    "minItems": 1,
                    "maxItems": 4,
                    "items": {
                        "type": "object",
                        "additionalProperties": false,
                        "properties": {
                            "question": {
                                "type": "string",
                                "description": "The complete question to ask the user."
                            },
                            "header": {
                                "type": "string",
                                "description": "Very short label displayed as a chip/tag (max 12 chars)."
                            },
                            "options": {
                                "type": "array",
                                "description": "The available choices for this question. Provide 2-4 options.",
                                "minItems": 2,
                                "maxItems": 4,
                                "items": {
                                    "type": "object",
                                    "additionalProperties": false,
                                    "properties": {
                                        "label": {
                                            "type": "string",
                                            "description": "The display text for this option that the user will see and select."
                                        },
                                        "description": {
                                            "type": "string",
                                            "description": "Explanation of what this option means or what will happen if chosen."
                                        },
                                        "preview": {
                                            "type": "string",
                                            "description": "Optional preview content for richer UIs."
                                        }
                                    },
                                    "required": ["label", "description"]
                                }
                            },
                            "multiSelect": {
                                "type": "boolean",
                                "description": "Set to true to allow the user to select multiple options."
                            }
                        },
                        "required": ["question", "header", "options"]
                    }
                }
            },
            "required": ["questions"]
        })
    }

    async fn execute(
        &self,
        params: serde_json::Value,
        _context: &ToolContext,
    ) -> Result<ToolResult, ToolError> {
        let request = self.parse_request(params)?;
        let result = self.ask(&request).await?;
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

        let mut tool_result = ToolResult::success(output)
            .with_metadata("questions", serde_json::json!(request.questions))
            .with_metadata("answers", serde_json::json!(result.answers))
            .with_metadata("raw_response", result.response.clone());
        if !result.annotations.is_empty() {
            tool_result =
                tool_result.with_metadata("annotations", serde_json::json!(result.annotations));
        }

        Ok(tool_result)
    }

    async fn check_permissions(
        &self,
        _params: &serde_json::Value,
        _context: &ToolContext,
    ) -> PermissionCheckResult {
        // This tool always requires user interaction, so execution itself is allowed.
        // The actual permission is implicit in the user's response
        PermissionCheckResult::allow()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    /// Create a mock callback that returns a fixed response
    fn mock_callback(response: Option<Value>) -> AskCallback {
        Arc::new(move |_request| {
            let resp = response.clone();
            Box::pin(async move { resp })
        })
    }

    /// Create a mock callback that delays before responding
    fn mock_callback_delayed(response: Option<Value>, delay_ms: u64) -> AskCallback {
        Arc::new(move |_request| {
            let resp = response.clone();
            Box::pin(async move {
                tokio::time::sleep(Duration::from_millis(delay_ms)).await;
                resp
            })
        })
    }

    #[test]
    fn test_ask_option_new() {
        let opt = AskOption::new("yes");
        assert_eq!(opt.value, "yes");
        assert!(opt.label.is_none());
        assert_eq!(opt.display(), "yes");
    }

    #[test]
    fn test_ask_option_with_label() {
        let opt = AskOption::with_label("y", "Yes, proceed");
        assert_eq!(opt.value, "y");
        assert_eq!(opt.label, Some("Yes, proceed".to_string()));
        assert_eq!(opt.display(), "Yes, proceed");
    }

    #[test]
    fn test_ask_request_from_legacy() {
        let request = AskRequest::from_legacy("Continue?", vec![AskOption::new("yes")]);
        assert_eq!(request.questions.len(), 1);
        assert_eq!(request.questions[0].question, "Continue?");
        assert_eq!(request.questions[0].options[0].value, "yes");
    }

    #[test]
    fn test_ask_result_primary_response() {
        let mut answers = BTreeMap::new();
        answers.insert("Question".to_string(), "hello".to_string());
        let result = AskResult::new(
            serde_json::json!("hello"),
            answers,
            BTreeMap::new(),
            false,
            None,
        );
        assert_eq!(result.primary_response(), Some("hello"));
        assert!(!result.from_option);
        assert!(result.option_index.is_none());
    }

    #[test]
    fn test_ask_result_option_metadata() {
        let mut answers = BTreeMap::new();
        answers.insert("Continue?".to_string(), "yes".to_string());
        let result = AskResult::new(
            serde_json::json!("yes"),
            answers,
            BTreeMap::new(),
            true,
            Some(0),
        );
        assert_eq!(result.primary_response(), Some("yes"));
        assert!(result.from_option);
        assert_eq!(result.option_index, Some(0));
    }

    #[test]
    fn test_ask_tool_new() {
        let tool = AskTool::new();
        assert!(!tool.has_callback());
        assert_eq!(
            tool.timeout(),
            Duration::from_secs(DEFAULT_ASK_TIMEOUT_SECS)
        );
    }

    #[test]
    fn test_ask_tool_with_callback() {
        let callback = mock_callback(Some(serde_json::json!("test")));
        let tool = AskTool::new().with_callback(callback);
        assert!(tool.has_callback());
    }

    #[test]
    fn test_ask_tool_with_timeout() {
        let tool = AskTool::new().with_timeout(Duration::from_secs(60));
        assert_eq!(tool.timeout(), Duration::from_secs(60));
    }

    #[test]
    fn test_ask_tool_default() {
        let tool = AskTool::default();
        assert!(!tool.has_callback());
        assert_eq!(
            tool.timeout(),
            Duration::from_secs(DEFAULT_ASK_TIMEOUT_SECS)
        );
    }

    #[tokio::test]
    async fn test_ask_without_callback() {
        let tool = AskTool::new();
        let result = tool
            .ask(&AskRequest::from_legacy("What is your name?", vec![]))
            .await;
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), ToolError::ExecutionFailed(_)));
    }

    #[tokio::test]
    async fn test_ask_free_form_response() {
        let callback = mock_callback(Some(serde_json::json!("John")));
        let tool = AskTool::new().with_callback(callback);

        let result = tool
            .ask(&AskRequest::from_legacy("What is your name?", vec![]))
            .await
            .unwrap();
        assert_eq!(result.primary_response(), Some("John"));
        assert_eq!(
            result.answers.get("What is your name?").map(String::as_str),
            Some("John")
        );
        assert!(!result.from_option);
        assert!(result.option_index.is_none());
    }

    #[tokio::test]
    async fn test_ask_with_options_select_by_value() {
        let callback = mock_callback(Some(serde_json::json!("yes")));
        let tool = AskTool::new().with_callback(callback);

        let options = vec![AskOption::new("yes"), AskOption::new("no")];

        let result = tool
            .ask(&AskRequest::from_legacy("Continue?", options))
            .await
            .unwrap();
        assert_eq!(result.primary_response(), Some("yes"));
        assert!(result.from_option);
        assert_eq!(result.option_index, Some(0));
    }

    #[tokio::test]
    async fn test_ask_with_options_select_by_label() {
        let callback = mock_callback(Some(serde_json::json!("Yes, proceed")));
        let tool = AskTool::new().with_callback(callback);

        let options = vec![
            AskOption::with_label("y", "Yes, proceed"),
            AskOption::with_label("n", "No, cancel"),
        ];

        let result = tool
            .ask(&AskRequest::from_legacy("Continue?", options))
            .await
            .unwrap();
        assert_eq!(result.primary_response(), Some("y"));
        assert!(result.from_option);
        assert_eq!(result.option_index, Some(0));
    }

    #[tokio::test]
    async fn test_ask_with_options_free_form() {
        let callback = mock_callback(Some(serde_json::json!("maybe")));
        let tool = AskTool::new().with_callback(callback);

        let options = vec![AskOption::new("yes"), AskOption::new("no")];

        let result = tool
            .ask(&AskRequest::from_legacy("Continue?", options))
            .await
            .unwrap();
        assert_eq!(result.primary_response(), Some("maybe"));
        assert!(!result.from_option);
        assert!(result.option_index.is_none());
    }

    #[tokio::test]
    async fn test_ask_with_modern_questions_payload() {
        let callback = mock_callback(Some(serde_json::json!({
            "answers": {
                "Choose a theme": "Cyber green"
            }
        })));
        let tool = AskTool::new().with_callback(callback);

        let request = AskRequest {
            questions: vec![AskQuestion {
                question: "Choose a theme".to_string(),
                header: Some("Theme".to_string()),
                options: vec![
                    AskOption {
                        value: "Network matrix".to_string(),
                        label: Some("Network matrix".to_string()),
                        description: Some("Dense and technical".to_string()),
                        preview: None,
                    },
                    AskOption {
                        value: "Cyber green".to_string(),
                        label: Some("Cyber green".to_string()),
                        description: Some("Bright and futuristic".to_string()),
                        preview: None,
                    },
                ],
                multi_select: false,
            }],
        };

        let result = tool.ask(&request).await.unwrap();
        assert_eq!(result.primary_response(), Some("Cyber green"));
        assert_eq!(
            result.answers.get("Choose a theme").map(String::as_str),
            Some("Cyber green")
        );
    }

    #[tokio::test]
    async fn test_ask_with_multiple_questions_payload() {
        let callback = mock_callback(Some(serde_json::json!({
            "answers": {
                "Primary goal?": "Ship quickly",
                "Need tests?": "Yes"
            }
        })));
        let tool = AskTool::new().with_callback(callback);

        let request = AskRequest {
            questions: vec![
                AskQuestion {
                    question: "Primary goal?".to_string(),
                    header: Some("Goal".to_string()),
                    options: vec![
                        AskOption::with_label("Ship quickly", "Ship quickly"),
                        AskOption::with_label("Refactor first", "Refactor first"),
                    ],
                    multi_select: false,
                },
                AskQuestion {
                    question: "Need tests?".to_string(),
                    header: Some("Tests".to_string()),
                    options: vec![
                        AskOption::with_label("Yes", "Yes"),
                        AskOption::with_label("No", "No"),
                    ],
                    multi_select: false,
                },
            ],
        };

        let result = tool.ask(&request).await.unwrap();
        assert_eq!(result.answers.len(), 2);
        assert_eq!(
            result.answers.get("Primary goal?").map(String::as_str),
            Some("Ship quickly")
        );
        assert_eq!(
            result.answers.get("Need tests?").map(String::as_str),
            Some("Yes")
        );
    }

    #[tokio::test]
    async fn test_ask_user_cancels() {
        let callback = mock_callback(None);
        let tool = AskTool::new().with_callback(callback);

        let result = tool
            .ask(&AskRequest::from_legacy("What is your name?", vec![]))
            .await;
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), ToolError::ExecutionFailed(_)));
    }

    #[tokio::test]
    async fn test_ask_timeout() {
        let callback = mock_callback_delayed(Some(serde_json::json!("response")), 200);
        let tool = AskTool::new()
            .with_callback(callback)
            .with_timeout(Duration::from_millis(50));

        let result = tool
            .ask(&AskRequest::from_legacy("What is your name?", vec![]))
            .await;
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), ToolError::Timeout(_)));
    }

    #[tokio::test]
    async fn test_ask_tool_trait_name() {
        let tool = AskTool::new();
        assert_eq!(tool.name(), ASK_USER_QUESTION_TOOL_NAME);
    }

    #[tokio::test]
    async fn test_ask_tool_trait_description() {
        let tool = AskTool::new();
        assert!(tool.description().contains("multiple-choice questions"));
    }

    #[tokio::test]
    async fn test_ask_tool_trait_input_schema() {
        let tool = AskTool::new();
        let schema = tool.input_schema();

        assert_eq!(schema["type"], "object");
        assert_eq!(schema["additionalProperties"], serde_json::json!(false));
        assert!(schema["properties"]["questions"].is_object());
        assert_eq!(schema["required"], serde_json::json!(["questions"]));
        assert_eq!(
            schema["properties"]["questions"]["items"]["additionalProperties"],
            serde_json::json!(false)
        );
        assert_eq!(
            schema["properties"]["questions"]["items"]["properties"]["options"]["items"]
                ["additionalProperties"],
            serde_json::json!(false)
        );
        assert!(!schema["properties"]
            .as_object()
            .unwrap()
            .contains_key("question"));
    }

    #[tokio::test]
    async fn test_ask_tool_execute_success() {
        let callback = mock_callback(Some(serde_json::json!({
            "Profile": "John"
        })));
        let tool = AskTool::new().with_callback(callback);
        let context = ToolContext::new(PathBuf::from("/tmp"));

        let params = serde_json::json!({
            "questions": [
                {
                    "question": "What is your name?",
                    "header": "Profile",
                    "options": [
                        { "label": "John", "description": "Use the current name" },
                        { "label": "Jane", "description": "Switch to Jane" }
                    ]
                }
            ]
        });

        let result = tool.execute(params, &context).await.unwrap();
        assert!(result.is_success());
        assert!(result
            .output
            .unwrap()
            .contains("\"What is your name?\"=\"John\""));
        assert_eq!(
            result.metadata.get("answers"),
            Some(&serde_json::json!({
                "What is your name?": "John"
            }))
        );
    }

    #[tokio::test]
    async fn test_ask_tool_execute_with_options() {
        let callback = mock_callback(Some(serde_json::json!({
            "Approval": "Yes"
        })));
        let tool = AskTool::new().with_callback(callback);
        let context = ToolContext::new(PathBuf::from("/tmp"));

        let params = serde_json::json!({
            "questions": [
                {
                    "question": "Continue?",
                    "header": "Approval",
                    "options": [
                        { "label": "Yes", "description": "Proceed with the change" },
                        { "label": "No", "description": "Stop here" }
                    ]
                }
            ]
        });

        let result = tool.execute(params, &context).await.unwrap();
        assert!(result.is_success());
        assert!(result.output.unwrap().contains("\"Continue?\"=\"Yes\""));
        assert_eq!(
            result.metadata.get("questions"),
            Some(&serde_json::json!([
                {
                    "question": "Continue?",
                    "header": "Approval",
                    "options": [
                        {
                            "value": "Yes",
                            "label": "Yes",
                            "description": "Proceed with the change"
                        },
                        {
                            "value": "No",
                            "label": "No",
                            "description": "Stop here"
                        }
                    ],
                    "multiSelect": false
                }
            ]))
        );
    }

    #[tokio::test]
    async fn test_ask_tool_execute_with_modern_questions() {
        let callback = mock_callback(Some(serde_json::json!({
            "answers": {
                "Which mode?": "Fast"
            }
        })));
        let tool = AskTool::new().with_callback(callback);
        let context = ToolContext::new(PathBuf::from("/tmp"));

        let params = serde_json::json!({
            "questions": [
                {
                    "question": "Which mode?",
                    "header": "Mode",
                    "options": [
                        { "label": "Fast", "description": "Optimized for speed" },
                        { "label": "Thorough", "description": "Optimized for depth" }
                    ]
                }
            ]
        });

        let result = tool.execute(params, &context).await.unwrap();
        assert!(result.is_success());
        assert_eq!(
            result.metadata.get("answers"),
            Some(&serde_json::json!({
                "Which mode?": "Fast"
            }))
        );
    }

    #[tokio::test]
    async fn test_ask_tool_execute_missing_question() {
        let callback = mock_callback(Some(serde_json::json!("test")));
        let tool = AskTool::new().with_callback(callback);
        let context = ToolContext::new(PathBuf::from("/tmp"));

        let params = serde_json::json!({});

        let result = tool.execute(params, &context).await;
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), ToolError::InvalidParams(_)));
    }

    #[tokio::test]
    async fn test_ask_tool_rejects_unknown_top_level_field() {
        let callback = mock_callback(Some(serde_json::json!("test")));
        let tool = AskTool::new().with_callback(callback);
        let context = ToolContext::new(PathBuf::from("/tmp"));

        let params = serde_json::json!({
            "questions": [
                {
                    "question": "Continue?",
                    "header": "Approval",
                    "options": [
                        { "label": "Yes", "description": "Proceed" },
                        { "label": "No", "description": "Stop" }
                    ]
                }
            ],
            "extra": true
        });

        let result = tool.execute(params, &context).await;
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("unknown field `extra`"));
    }

    #[tokio::test]
    async fn test_ask_tool_rejects_unknown_question_field() {
        let callback = mock_callback(Some(serde_json::json!("test")));
        let tool = AskTool::new().with_callback(callback);
        let context = ToolContext::new(PathBuf::from("/tmp"));

        let params = serde_json::json!({
            "questions": [
                {
                    "question": "Continue?",
                    "header": "Approval",
                    "options": [
                        { "label": "Yes", "description": "Proceed" },
                        { "label": "No", "description": "Stop" }
                    ],
                    "extra": "field"
                }
            ]
        });

        let result = tool.execute(params, &context).await;
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("unknown field `extra`"));
    }

    #[tokio::test]
    async fn test_ask_tool_rejects_unknown_option_field() {
        let callback = mock_callback(Some(serde_json::json!("test")));
        let tool = AskTool::new().with_callback(callback);
        let context = ToolContext::new(PathBuf::from("/tmp"));

        let params = serde_json::json!({
            "questions": [
                {
                    "question": "Continue?",
                    "header": "Approval",
                    "options": [
                        { "label": "Yes", "description": "Proceed", "extra": 1 },
                        { "label": "No", "description": "Stop" }
                    ]
                }
            ]
        });

        let result = tool.execute(params, &context).await;
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("unknown field `extra`"));
    }

    #[tokio::test]
    async fn test_ask_tool_check_permissions() {
        let tool = AskTool::new();
        let context = ToolContext::new(PathBuf::from("/tmp"));
        let params = serde_json::json!({"questions": []});

        let result = tool.check_permissions(&params, &context).await;
        assert!(result.is_allowed());
    }

    #[test]
    fn test_ask_option_serialization() {
        let opt = AskOption::with_label("y", "Yes");
        let json = serde_json::to_string(&opt).unwrap();
        let deserialized: AskOption = serde_json::from_str(&json).unwrap();

        assert_eq!(opt.value, deserialized.value);
        assert_eq!(opt.label, deserialized.label);
    }

    #[test]
    fn test_ask_result_serialization() {
        let mut answers = BTreeMap::new();
        answers.insert("Continue?".to_string(), "yes".to_string());
        let mut annotations = BTreeMap::new();
        annotations.insert(
            "Continue?".to_string(),
            AskAnnotation {
                preview: Some("preview".to_string()),
                notes: Some("notes".to_string()),
            },
        );
        let result = AskResult::new(
            serde_json::json!("yes"),
            answers,
            annotations,
            true,
            Some(0),
        );
        let json = serde_json::to_string(&result).unwrap();
        let deserialized: AskResult = serde_json::from_str(&json).unwrap();

        assert_eq!(result.response, deserialized.response);
        assert_eq!(result.answers, deserialized.answers);
        assert_eq!(result.annotations, deserialized.annotations);
        assert_eq!(result.from_option, deserialized.from_option);
        assert_eq!(result.option_index, deserialized.option_index);
    }
}
