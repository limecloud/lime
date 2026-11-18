use super::CurrentProviderError;
use model_routing_core::{CanonicalRequest, ContentPart};
use serde_json::Value;

pub(super) fn ensure_structured_history(
    request: &CanonicalRequest,
    protocol: &str,
) -> Result<(), CurrentProviderError> {
    for part in request.messages.iter().flat_map(|message| &message.content) {
        let ContentPart::ToolCall {
            input,
            raw_arguments,
            ..
        } = part
        else {
            continue;
        };
        let matches_original = raw_arguments.as_deref().is_none_or(|raw| {
            serde_json::from_str::<Value>(raw).is_ok_and(|original| original == *input)
        });
        if !input.is_object() || !matches_original {
            return Err(CurrentProviderError::invalid_request(format!(
                "{protocol} cannot lower original tool arguments as a matching JSON object"
            )));
        }
    }
    Ok(())
}
