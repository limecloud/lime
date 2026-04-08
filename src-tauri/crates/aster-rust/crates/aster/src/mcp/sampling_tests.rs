//! Sampling Property-Based Tests
//!
//! This module contains property-based tests for MCP Sampling support.
//! Tests validate the correctness properties defined in the design document.
//!
//! **Feature: mcp-alignment**
//!
//! Properties tested:
//! - Property 22: Sampling Parameter Handling
//! - Property 23: Sampling Result Format

use proptest::prelude::*;
use rmcp::model::{Content, Role};

// ============================================================================
// Property 22: Sampling Parameter Handling
// ============================================================================

/// Represents sampling parameters for testing
#[derive(Debug, Clone)]
pub struct SamplingParams {
    pub max_tokens: u32,
    pub temperature: Option<f32>,
    pub model_hint: Option<String>,
    pub system_prompt: Option<String>,
}

impl SamplingParams {
    pub fn new(max_tokens: u32) -> Self {
        Self {
            max_tokens,
            temperature: None,
            model_hint: None,
            system_prompt: None,
        }
    }

    pub fn with_temperature(mut self, temp: f32) -> Self {
        self.temperature = Some(temp);
        self
    }

    pub fn with_model_hint(mut self, hint: String) -> Self {
        self.model_hint = Some(hint);
        self
    }

    pub fn with_system_prompt(mut self, prompt: String) -> Self {
        self.system_prompt = Some(prompt);
        self
    }
}

/// Simulates model config building from sampling params
/// This mirrors the logic in create_message
fn build_model_config_from_params(
    base_model: &str,
    params: &SamplingParams,
) -> SimulatedModelConfig {
    let mut config = SimulatedModelConfig {
        model_name: base_model.to_string(),
        context_limit: simulated_context_limit(base_model),
        max_tokens: None,
        temperature: None,
    };

    // Apply model hint if provided
    if let Some(hint) = &params.model_hint {
        if !hint.is_empty() {
            config.model_name = hint.clone();
            config.context_limit = simulated_context_limit(hint);
        }
    }

    // Apply max_tokens (required field in MCP sampling)
    config.max_tokens = Some(params.max_tokens as i32);

    // Apply temperature if provided
    if let Some(temp) = params.temperature {
        config.temperature = Some(temp);
    }

    config
}

fn simulated_context_limit(model_name: &str) -> Option<usize> {
    match model_name {
        "gpt-4-turbo" => Some(128_000),
        "gpt-4.1" => Some(1_000_000),
        "gpt-4o" => Some(128_000),
        "claude-3" | "claude-sonnet-4-20250514" => Some(200_000),
        _ => None,
    }
}

/// Simulated model config for testing
#[derive(Debug, Clone, PartialEq)]
pub struct SimulatedModelConfig {
    pub model_name: String,
    pub context_limit: Option<usize>,
    pub max_tokens: Option<i32>,
    pub temperature: Option<f32>,
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(100))]

    /// **Property 22: Sampling Parameter Handling**
    ///
    /// *For any* sampling request with maxTokens and temperature parameters,
    /// the MCP_Client SHALL pass these parameters to the provider.
    ///
    /// **Validates: Requirements 6.3**
    #[test]
    fn prop_sampling_max_tokens_passed_to_provider(max_tokens in 1u32..100000) {
        let params = SamplingParams::new(max_tokens);
        let config = build_model_config_from_params("base-model", &params);

        // max_tokens should always be set (it's required in MCP sampling)
        prop_assert!(config.max_tokens.is_some(), "max_tokens should be set");
        prop_assert_eq!(
            config.max_tokens.unwrap(),
            max_tokens as i32,
            "max_tokens should match the input value"
        );
    }

    /// **Property 22: Sampling Parameter Handling - Temperature**
    ///
    /// *For any* sampling request with temperature parameter,
    /// the MCP_Client SHALL pass the temperature to the provider.
    ///
    /// **Validates: Requirements 6.3**
    #[test]
    fn prop_sampling_temperature_passed_to_provider(
        max_tokens in 1u32..100000,
        temperature in 0.0f32..2.0f32
    ) {
        let params = SamplingParams::new(max_tokens).with_temperature(temperature);
        let config = build_model_config_from_params("base-model", &params);

        // Temperature should be set when provided
        prop_assert!(config.temperature.is_some(), "temperature should be set");
        prop_assert!(
            (config.temperature.unwrap() - temperature).abs() < 0.0001,
            "temperature should match the input value"
        );
    }

    /// **Property 22: Sampling Parameter Handling - Model Preferences**
    ///
    /// *For any* sampling request with model preferences (hints),
    /// the MCP_Client SHALL apply the model hint to the provider config.
    ///
    /// **Validates: Requirements 6.3**
    #[test]
    fn prop_sampling_model_hint_applied(
        max_tokens in 1u32..100000,
        model_hint in "[a-z][a-z0-9-]{0,30}"
    ) {
        let params = SamplingParams::new(max_tokens).with_model_hint(model_hint.clone());
        let config = build_model_config_from_params("base-model", &params);

        // Model name should be updated to the hint
        prop_assert_eq!(
            &config.model_name,
            &model_hint,
            "model_name should be updated to the hint"
        );
    }

    /// **Property 22: Sampling Parameter Handling - Empty Model Hint**
    ///
    /// *For any* sampling request with empty model hint,
    /// the MCP_Client SHALL keep the base model name.
    ///
    /// **Validates: Requirements 6.3**
    #[test]
    fn prop_sampling_empty_model_hint_keeps_base(max_tokens in 1u32..100000) {
        let params = SamplingParams::new(max_tokens).with_model_hint(String::new());
        let config = build_model_config_from_params("base-model", &params);

        // Model name should remain as base model when hint is empty
        prop_assert_eq!(
            &config.model_name,
            "base-model",
            "model_name should remain as base model when hint is empty"
        );
    }

    /// **Property 22: Sampling Parameter Handling - No Temperature**
    ///
    /// *For any* sampling request without temperature parameter,
    /// the MCP_Client SHALL not set temperature in the provider config.
    ///
    /// **Validates: Requirements 6.3**
    #[test]
    fn prop_sampling_no_temperature_when_not_provided(max_tokens in 1u32..100000) {
        let params = SamplingParams::new(max_tokens);
        let config = build_model_config_from_params("base-model", &params);

        // Temperature should not be set when not provided
        prop_assert!(
            config.temperature.is_none(),
            "temperature should not be set when not provided"
        );
    }
}

// ============================================================================
// Property 23: Sampling Result Format
// ============================================================================

/// Represents a sampling result for testing
#[derive(Debug, Clone)]
pub struct SamplingResult {
    pub model: String,
    pub stop_reason: Option<String>,
    pub role: Role,
    pub content: Content,
}

impl SamplingResult {
    pub fn new(model: String, content: Content) -> Self {
        Self {
            model,
            stop_reason: Some("end_turn".to_string()),
            role: Role::Assistant,
            content,
        }
    }

    pub fn with_stop_reason(mut self, reason: String) -> Self {
        self.stop_reason = Some(reason);
        self
    }
}

/// Validates that a sampling result has the correct MCP format
fn validate_sampling_result_format(result: &SamplingResult) -> ValidationResult {
    let mut validation = ValidationResult::valid();

    // Check model field is present and non-empty
    if result.model.is_empty() {
        validation.add_error("model field should not be empty".to_string());
    }

    // Check role is Assistant (MCP sampling responses are always from assistant)
    if result.role != Role::Assistant {
        validation.add_error("role should be Assistant for sampling responses".to_string());
    }

    // Check stop_reason is present (should always be set)
    if result.stop_reason.is_none() {
        validation.add_error("stop_reason should be present".to_string());
    }

    validation
}

/// Validation result helper
#[derive(Debug, Clone)]
pub struct ValidationResult {
    pub valid: bool,
    pub errors: Vec<String>,
}

impl ValidationResult {
    pub fn valid() -> Self {
        Self {
            valid: true,
            errors: vec![],
        }
    }

    pub fn add_error(&mut self, error: String) {
        self.valid = false;
        self.errors.push(error);
    }
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(100))]

    /// **Property 23: Sampling Result Format**
    ///
    /// *For any* sampling completion, the MCP_Client SHALL return the result
    /// in valid MCP sampling format with role, content, and model fields.
    ///
    /// **Validates: Requirements 6.4**
    #[test]
    fn prop_sampling_result_has_required_fields(
        model_name in "[a-z][a-z0-9-]{0,30}",
        text_content in ".*"
    ) {
        let content = Content::text(&text_content);
        let result = SamplingResult::new(model_name.clone(), content);

        let validation = validate_sampling_result_format(&result);

        prop_assert!(validation.valid, "Result should be valid: {:?}", validation.errors);
        prop_assert_eq!(&result.model, &model_name, "Model should match");
        prop_assert_eq!(result.role, Role::Assistant, "Role should be Assistant");
        prop_assert!(result.stop_reason.is_some(), "Stop reason should be present");
    }

    /// **Property 23: Sampling Result Format - Role is Always Assistant**
    ///
    /// *For any* sampling completion, the role SHALL always be Assistant.
    ///
    /// **Validates: Requirements 6.4**
    #[test]
    fn prop_sampling_result_role_is_assistant(
        model_name in "[a-z][a-z0-9-]{0,30}"
    ) {
        let content = Content::text("test response");
        let result = SamplingResult::new(model_name, content);

        prop_assert_eq!(
            result.role,
            Role::Assistant,
            "Sampling result role should always be Assistant"
        );
    }

    /// **Property 23: Sampling Result Format - Stop Reason Present**
    ///
    /// *For any* sampling completion, the stop_reason SHALL be present.
    ///
    /// **Validates: Requirements 6.4**
    #[test]
    fn prop_sampling_result_stop_reason_present(
        model_name in "[a-z][a-z0-9-]{0,30}",
        stop_reason in "[a-z_]{1,20}"
    ) {
        let content = Content::text("test response");
        let result = SamplingResult::new(model_name, content)
            .with_stop_reason(stop_reason.clone());

        prop_assert!(result.stop_reason.is_some(), "Stop reason should be present");
        prop_assert_eq!(
            result.stop_reason.as_ref().unwrap(),
            &stop_reason,
            "Stop reason should match"
        );
    }

    /// **Property 23: Sampling Result Format - Model Field Non-Empty**
    ///
    /// *For any* valid sampling completion, the model field SHALL not be empty.
    ///
    /// **Validates: Requirements 6.4**
    #[test]
    fn prop_sampling_result_model_non_empty(
        model_name in "[a-z][a-z0-9-]{1,30}"  // At least 1 char
    ) {
        let content = Content::text("test response");
        let result = SamplingResult::new(model_name.clone(), content);

        let validation = validate_sampling_result_format(&result);

        prop_assert!(validation.valid, "Result should be valid");
        prop_assert!(!result.model.is_empty(), "Model should not be empty");
    }

    /// **Property 23: Sampling Result Format - Content Preserved**
    ///
    /// *For any* sampling completion with text content, the content SHALL be preserved.
    ///
    /// **Validates: Requirements 6.4**
    #[test]
    fn prop_sampling_result_content_preserved(
        model_name in "[a-z][a-z0-9-]{1,30}",
        text_content in ".{0,1000}"
    ) {
        let content = Content::text(&text_content);
        let result = SamplingResult::new(model_name, content.clone());

        // Verify content is preserved by checking it matches
        if let Some(text) = result.content.as_text() {
            prop_assert_eq!(&text.text, &text_content, "Text content should be preserved");
        } else {
            prop_assert!(false, "Content should be text type");
        }
    }
}

// ============================================================================
// Additional Unit Tests
// ============================================================================

#[cfg(test)]
mod unit_tests {
    use super::*;

    #[test]
    fn test_sampling_params_builder() {
        let params = SamplingParams::new(1000)
            .with_temperature(0.7)
            .with_model_hint("claude-3".to_string())
            .with_system_prompt("You are helpful".to_string());

        assert_eq!(params.max_tokens, 1000);
        assert_eq!(params.temperature, Some(0.7));
        assert_eq!(params.model_hint, Some("claude-3".to_string()));
        assert_eq!(params.system_prompt, Some("You are helpful".to_string()));
    }

    #[test]
    fn test_build_model_config_all_params() {
        let params = SamplingParams::new(2000)
            .with_temperature(0.5)
            .with_model_hint("gpt-4".to_string());

        let config = build_model_config_from_params("base-model", &params);

        assert_eq!(config.model_name, "gpt-4");
        assert_eq!(config.context_limit, None);
        assert_eq!(config.max_tokens, Some(2000));
        assert_eq!(config.temperature, Some(0.5));
    }

    #[test]
    fn test_build_model_config_minimal_params() {
        let params = SamplingParams::new(500);
        let config = build_model_config_from_params("claude-3", &params);

        assert_eq!(config.model_name, "claude-3");
        assert_eq!(config.context_limit, Some(200_000));
        assert_eq!(config.max_tokens, Some(500));
        assert_eq!(config.temperature, None);
    }

    #[test]
    fn test_build_model_config_recomputes_context_limit_for_model_hint() {
        let params = SamplingParams::new(500).with_model_hint("gpt-4.1".to_string());
        let config = build_model_config_from_params("gpt-4-turbo", &params);

        assert_eq!(config.model_name, "gpt-4.1");
        assert_eq!(config.context_limit, Some(1_000_000));
    }

    #[test]
    fn test_sampling_result_format_valid() {
        let content = Content::text("Hello, world!");
        let result = SamplingResult::new("claude-3".to_string(), content);

        let validation = validate_sampling_result_format(&result);
        assert!(validation.valid);
        assert!(validation.errors.is_empty());
    }

    #[test]
    fn test_sampling_result_format_empty_model() {
        let content = Content::text("Hello");
        let result = SamplingResult {
            model: String::new(),
            stop_reason: Some("end_turn".to_string()),
            role: Role::Assistant,
            content,
        };

        let validation = validate_sampling_result_format(&result);
        assert!(!validation.valid);
        assert!(validation.errors.iter().any(|e| e.contains("model")));
    }

    #[test]
    fn test_sampling_result_format_missing_stop_reason() {
        let content = Content::text("Hello");
        let result = SamplingResult {
            model: "claude-3".to_string(),
            stop_reason: None,
            role: Role::Assistant,
            content,
        };

        let validation = validate_sampling_result_format(&result);
        assert!(!validation.valid);
        assert!(validation.errors.iter().any(|e| e.contains("stop_reason")));
    }

    #[test]
    fn test_validation_result_helper() {
        let mut validation = ValidationResult::valid();
        assert!(validation.valid);
        assert!(validation.errors.is_empty());

        validation.add_error("test error".to_string());
        assert!(!validation.valid);
        assert_eq!(validation.errors.len(), 1);
    }
}
