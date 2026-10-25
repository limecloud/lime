use serde_json::Value as JsonValue;
use tool_runtime::tool_result_projection::{
    runtime_tool_result_to_call_tool_result, NormalizedToolOutput, RuntimeToolResultParts,
};

pub(super) fn code_mode_result(output: NormalizedToolOutput) -> JsonValue {
    let mut mcp = runtime_tool_result_to_call_tool_result(RuntimeToolResultParts {
        success: output.success,
        output: Some(output.text.clone()),
        error: output.error,
        metadata: output.metadata,
    });
    if !mcp
        .content
        .iter()
        .any(|content| content.as_image().is_some())
    {
        return output
            .structured_content
            .unwrap_or(JsonValue::String(output.text));
    }
    mcp.structured_content = output.structured_content;
    // Adapted from tools/src/tool_output.rs::CallToolResult::code_mode_result.
    let mut result = serde_json::to_value(mcp)
        .unwrap_or_else(|err| JsonValue::String(format!("failed to serialize mcp result: {err}")));
    // MCP result metadata is private to clients and must not reach Code Mode.
    if let JsonValue::Object(fields) = &mut result {
        fields.remove("_meta");
    }
    result
}

#[cfg(test)]
mod tests;
