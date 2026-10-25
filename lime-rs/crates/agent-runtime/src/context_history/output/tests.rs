use super::*;

#[test]
fn typed_tool_images_survive_zero_text_budget_without_mutating_durable_history() {
    use agent_protocol::response_item::FunctionCallOutputContentItem;
    use model_provider::current_client::CurrentProviderToolResult;
    let image = FunctionCallOutputContentItem::InputImage {
        image_url: "data:image/png;base64,AA==".into(),
        detail: None,
    };
    let original = CurrentProviderContent::ToolResult(CurrentProviderToolResult {
        content_items: vec![
            FunctionCallOutputContentItem::InputText {
                text: "original observation".into(),
            },
            image.clone(),
        ],
        history_token_limit: Some(0),
        call_id: "image".into(),
        name: "computer_use".into(),
        success: false,
        output: "original observation".into(),
        error: Some("window disappeared".into()),
    });
    let snapshot = original.clone();
    let CurrentProviderContent::ToolResult(result) =
        for_prompt(&original, TruncationPolicy::Tokens(10))
    else {
        panic!("result")
    };
    assert_eq!(result.content_items, vec![image]);
    assert_eq!(result.error.as_deref(), Some("window disappeared"));
    assert!(!result.output.contains("base64"));
    assert_eq!(original, snapshot);
}

#[test]
fn structured_outputs_share_text_budget_and_keep_media_order_and_opaque_fields() {
    let original = CurrentProviderContent::RawResponseItem(json!({
        "type":"function_call_output","name":"external_event","success":false,
        "opaque":{"keep":true},"output":[
            {"type":"input_text","text":"abcdef","annotation":"keep"},
            {"type":"input_image","image_url":"data:image/png;base64,AA=="},
            {"type":"input_text","text":"ghijklmnopqrstuvwxyz"},
            {"type":"encrypted_content","encrypted_content":"private-state"},
            {"type":"input_audio","audio_url":"data:audio/wav;base64,AA=="},
            {"type":"input_text","text":"omitted"}
        ]
    }));
    let snapshot = original.clone();
    let CurrentProviderContent::RawResponseItem(actual) =
        for_prompt(&original, TruncationPolicy::Bytes(10))
    else {
        unreachable!()
    };
    assert_eq!(
        actual,
        json!({
            "type":"function_call_output","name":"external_event","success":false,
            "opaque":{"keep":true},"output":[
                {"type":"input_text","text":"abcdef","annotation":"keep"},
                {"type":"input_image","image_url":"data:image/png;base64,AA=="},
                {"type":"input_text","text":"gh…16 chars truncated…yz"},
                {"type":"encrypted_content","encrypted_content":"private-state"},
                {"type":"input_audio","audio_url":"data:audio/wav;base64,AA=="},
                {"type":"input_text","text":"[omitted 1 text items ...]"}
            ]
        })
    );
    assert_eq!(original, snapshot, "durable original must not be mutated");
}

#[test]
fn raw_custom_output_uses_the_same_utf8_token_budget_without_touching_identity() {
    let original = CurrentProviderContent::RawResponseItem(json!({
        "type":"custom_tool_call_output","id":"output-id","call_id":"custom",
        "output":"你好世界-abcdef-再见世界","success":false,"extension":{"keep":true}
    }));
    let CurrentProviderContent::RawResponseItem(actual) =
        for_prompt(&original, TruncationPolicy::Tokens(2))
    else {
        unreachable!()
    };
    let mut expected = match original {
        CurrentProviderContent::RawResponseItem(item) => item,
        _ => unreachable!(),
    };
    expected["output"] = json!("你…6 tokens truncated…界");
    assert_eq!(actual, expected);
}
