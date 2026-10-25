use super::*;
use rmcp::model::Content;

#[test]
fn gateway_screenshot_survives_the_agent_tool_projection() {
    let result = CallToolResult::success(vec![
        Content::text("Screenshot of the approved window"),
        Content::image("iVBORw0KGgo=", "image/png"),
    ]);
    let projected = project_call_result(Ok(result)).unwrap();
    assert_eq!(projected.output, "Screenshot of the approved window");
    assert_eq!(
        projected.metadata.get("model_visible_image"),
        Some(&json!(true))
    );
    assert_eq!(
        projected.metadata.get("image_url"),
        Some(&json!("data:image/png;base64,iVBORw0KGgo="))
    );
    let canonical = tool_runtime::tool_result_projection::runtime_tool_result_to_call_tool_result(
        tool_runtime::tool_result_projection::RuntimeToolResultParts {
            success: projected.success,
            output: Some(projected.output),
            error: projected.error,
            metadata: projected.metadata,
        },
    );
    assert!(canonical
        .content
        .iter()
        .any(|content| content.as_image().is_some()));
}
