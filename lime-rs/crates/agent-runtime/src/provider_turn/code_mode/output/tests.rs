use super::*;
use code_mode::{
    CodeModeToolKind, FunctionCallOutputContentItem, ProcessCodeModeSessionProvider,
    RuntimeCodeModeCellId, RuntimeCodeModeExecuteRequest, RuntimeCodeModeFuture,
    RuntimeCodeModeNestedToolCall, RuntimeCodeModeSessionDelegate, RuntimeCodeModeSessionProvider,
    RuntimeCodeModeTool, RuntimeToolDefinition, RuntimeToolIdentity,
};
use serde_json::json;
use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use tokio::time::{timeout, Duration};
use tokio_util::sync::CancellationToken;

const PNG: &str =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aFe0AAAAASUVORK5CYII=";

fn output(image_visible: bool) -> NormalizedToolOutput {
    NormalizedToolOutput {
        history_token_limit: None,
        success: true,
        text: "approved window screenshot".to_string(),
        structured_content: Some(json!({"width":1,"height":1})),
        error: None,
        duration_ms: 1,
        truncation: None,
        sidecar_reference: None,
        metadata: HashMap::from([
            ("model_visible_image".to_string(), json!(image_visible)),
            (
                "image_url".to_string(),
                json!(format!("data:image/png;base64,{PNG}")),
            ),
            ("host_private".to_string(), json!("must not reach JS")),
        ]),
        agent_control_projection_facts: Vec::new(),
        agent_control_state_facts: Vec::new(),
    }
}

#[test]
fn nested_image_uses_mcp_content_and_preserves_business_result() {
    let value = code_mode_result(output(true));
    assert_eq!(value["content"][0]["text"], "approved window screenshot");
    assert_eq!(
        value["content"][1],
        json!({"type":"image","data":PNG,"mimeType":"image/png"})
    );
    assert_eq!(value["structuredContent"], json!({"width":1,"height":1}));
    assert!(value.get("_meta").is_none());
    assert!(!value.to_string().contains("host_private"));
}

#[test]
fn metadata_without_model_image_authority_does_not_expose_image() {
    let value = code_mode_result(output(false));
    assert_eq!(value, json!({"width":1,"height":1}));
    let mut text = output(false);
    text.structured_content = None;
    assert_eq!(code_mode_result(text), "approved window screenshot");
}

#[derive(Default)]
struct ImageDelegate {
    calls: AtomicUsize,
}

impl RuntimeCodeModeSessionDelegate for ImageDelegate {
    fn invoke_tool<'a>(
        &'a self,
        invocation: RuntimeCodeModeNestedToolCall,
        cancellation: CancellationToken,
    ) -> RuntimeCodeModeFuture<'a, JsonValue> {
        Box::pin(async move {
            assert_eq!(invocation.tool_name, "computer_use");
            assert!(!cancellation.is_cancelled());
            self.calls.fetch_add(1, Ordering::Relaxed);
            Ok(code_mode_result(output(true)))
        })
    }

    fn notify<'a>(
        &'a self,
        _tool_call_id: String,
        _cell_id: RuntimeCodeModeCellId,
        _text: String,
        _cancellation: CancellationToken,
    ) -> RuntimeCodeModeFuture<'a, ()> {
        Box::pin(async { Ok(()) })
    }

    fn cell_closed(&self, _cell_id: &RuntimeCodeModeCellId) {}
}

#[tokio::test]
async fn real_code_mode_host_preserves_nested_image_before_script_failure() {
    // This delegate supplies an explicit fixture image; it does not operate the OS.
    let provider = ProcessCodeModeSessionProvider::default();
    provider
        .availability()
        .expect("build code-mode-host before this test");
    let delegate = Arc::new(ImageDelegate::default());
    let session = timeout(
        Duration::from_secs(15),
        provider.create_session(delegate.clone()),
    )
    .await
    .unwrap()
    .unwrap();
    let response = timeout(Duration::from_secs(15), async {
        session.execute(RuntimeCodeModeExecuteRequest {
            tool_call_id: "call_nested_image".to_string(),
            source: "const result = await tools.computer_use({});\ntext(result.structuredContent);\nimage(result.content.find(item => item.type === 'image'));\nthrow new Error('fixture failure after image');".to_string(),
            enabled_tools: vec![RuntimeCodeModeTool {
                identity: RuntimeToolIdentity::plain("computer_use"),
                definition: RuntimeToolDefinition::new("computer_use", "fixture image", json!({})),
                kind: CodeModeToolKind::Function,
                code_name: "computer_use".to_string(),
                global_name: "computer_use".to_string(),
            }],
            yield_time_ms: Some(5_000),
            max_output_tokens: Some(256),
            cancellation_token: None,
        }).await?.initial_response().await
    }).await;
    timeout(Duration::from_secs(15), session.shutdown())
        .await
        .unwrap()
        .unwrap();
    let result = response.unwrap().unwrap().into_tool_result();
    assert_eq!(delegate.calls.load(Ordering::Relaxed), 1);
    assert!(!result.success);
    assert!(result
        .error
        .as_ref()
        .unwrap()
        .contains("fixture failure after image"));
    assert!(result.output.contains("\"width\":1"));
    assert!(!result.output.contains(PNG));
    assert!(!result.output.contains("host_private"));
    assert!(result.content_items.iter().any(|item| matches!(
        item, FunctionCallOutputContentItem::InputImage { image_url, .. }
        if image_url == &format!("data:image/png;base64,{PNG}")
    )));
}
