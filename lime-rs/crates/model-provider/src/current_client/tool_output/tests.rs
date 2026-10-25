use super::*;
use crate::current_client::{
    CurrentProviderContent, CurrentProviderMessage, CurrentProviderRequest,
};
use agent_protocol::ImageDetail;

const IMAGE: &str = "data:image/png;base64,aGVsbG8=";

fn result() -> CurrentProviderToolResult {
    CurrentProviderToolResult {
        content_items: vec![
            FunctionCallOutputContentItem::InputText {
                text: "partial observation".into(),
            },
            FunctionCallOutputContentItem::InputImage {
                image_url: IMAGE.into(),
                detail: Some(ImageDetail::High),
            },
        ],
        history_token_limit: Some(20),
        call_id: "call_image".into(),
        name: "computer_use".into(),
        success: false,
        output: "partial observation".into(),
        error: Some("window disappeared".into()),
    }
}

#[test]
fn durable_typed_output_restores_canonical_media_without_inline_bytes() {
    for custom in [false, true] {
        let part = if custom {
            CurrentProviderContent::CustomToolResult(result())
        } else {
            CurrentProviderContent::ToolResult(result())
        };
        let serialized = serde_json::to_vec(&part).unwrap();
        let restored = serde_json::from_slice(&serialized).unwrap();
        assert_eq!(part, restored);
        let request =
            CurrentProviderRequest::new(vec![CurrentProviderMessage::tool(vec![restored])]);
        let canonical = request.into_canonical("fixture").unwrap();
        let (id, value) = match &canonical.messages[0].content[0] {
            ContentPart::ToolResult { id, result, .. }
            | ContentPart::CustomToolResult { id, result, .. } => (id, result),
            _ => panic!("typed result"),
        };
        assert_eq!(id, "call_image");
        let ToolResultValue::Content { value } = value else {
            panic!("typed content")
        };
        assert!(
            matches!(&value[0], ContentPart::Text { text, .. } if text == "partial observation")
        );
        let ContentPart::Media { uri, detail, .. } = &value[1] else {
            panic!("image")
        };
        assert!(uri.starts_with("opaque://tool-output/"));
        assert_eq!(*detail, Some(ImageDetail::High));
        assert_eq!(request.media_payloads().unwrap()[uri], IMAGE);
        assert!(!serde_json::to_string(&canonical)
            .unwrap()
            .contains("base64"));
    }
}

#[test]
fn invalid_typed_media_is_rejected_without_rendering_payload_as_text() {
    let mut output = result();
    output.content_items[1] = FunctionCallOutputContentItem::InputImage {
        image_url: "data:text/plain;base64,c2VjcmV0".into(),
        detail: None,
    };
    let error = canonical_result(&output).unwrap_err().to_string();
    assert!(!error.contains("c2VjcmV0"));
    assert!(collect_media_payloads(&output, &mut BTreeMap::new()).is_err());
}

#[test]
fn plain_results_keep_their_existing_wire_shape() {
    let mut output = result();
    output.content_items.clear();
    assert!(matches!(
        canonical_result(&output).unwrap(),
        ToolResultValue::Error { .. }
    ));
    output.success = true;
    assert_eq!(
        canonical_result(&output).unwrap(),
        ToolResultValue::text("partial observation")
    );
}
