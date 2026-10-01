//! One public input-size error contract for turn and durable queue ingress.

use agent_protocol::input::{validate_user_input_text_length, MAX_USER_INPUT_TEXT_CHARS};
use agent_protocol::AgentInputError;
use app_server_protocol::protocol::v2::UserInput;
use app_server_protocol::{error_codes, JsonRpcError};

pub(super) const INPUT_TOO_LARGE_ERROR_CODE: &str = "input_too_large";

pub(in crate::processor) fn validate_v2_input_limit(
    items: &[UserInput],
) -> Result<(), JsonRpcError> {
    let actual_chars = items
        .iter()
        .map(|item| match item {
            UserInput::Text { text, .. } => text.chars().count(),
            _ => 0,
        })
        .sum();
    validate_user_input_text_length(actual_chars).map_err(|_| input_too_large_error(actual_chars))
}

fn input_too_large_error(actual_chars: usize) -> JsonRpcError {
    JsonRpcError {
        code: error_codes::INVALID_PARAMS,
        message: AgentInputError::InputTooLarge { actual_chars }.to_string(),
        data: Some(serde_json::json!({
            "input_error_code": INPUT_TOO_LARGE_ERROR_CODE,
            "max_chars": MAX_USER_INPUT_TEXT_CHARS,
            "actual_chars": actual_chars,
        })),
    }
}
