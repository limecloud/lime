//! Preserve the shared protocol's typed output in durable model history.

use agent_protocol::response_item::FunctionCallOutputContentItem;
use agent_protocol::ImageDetail;
use tool_runtime::tool_result_projection::{
    runtime_tool_result_to_call_tool_result, NormalizedToolOutput, RuntimeToolResultParts,
};

pub(super) fn normalized_content_items(
    output: &NormalizedToolOutput,
) -> Vec<FunctionCallOutputContentItem> {
    let result = runtime_tool_result_to_call_tool_result(RuntimeToolResultParts {
        success: output.success,
        output: Some(output.text.clone()),
        error: output.error.clone(),
        metadata: output.metadata.clone(),
    });
    if !result
        .content
        .iter()
        .any(|content| content.as_image().is_some())
    {
        return Vec::new();
    }
    result
        .content
        .iter()
        .filter_map(|content| {
            if let Some(text) = content.as_text() {
                return Some(FunctionCallOutputContentItem::InputText {
                    text: text.text.clone(),
                });
            }
            content
                .as_image()
                .map(|image| FunctionCallOutputContentItem::InputImage {
                    image_url: format!("data:{};base64,{}", image.mime_type, image.data),
                    detail: Some(ImageDetail::High),
                })
        })
        .collect()
}

pub(super) fn code_mode_content_items(
    items: Vec<code_mode_protocol::FunctionCallOutputContentItem>,
) -> Vec<FunctionCallOutputContentItem> {
    items
        .into_iter()
        .map(|item| match item {
            code_mode_protocol::FunctionCallOutputContentItem::InputText { text } => {
                FunctionCallOutputContentItem::InputText { text }
            }
            code_mode_protocol::FunctionCallOutputContentItem::InputImage { image_url, detail } => {
                FunctionCallOutputContentItem::InputImage {
                    image_url,
                    detail: detail.map(|detail| match detail {
                        code_mode_protocol::ImageDetail::Auto => ImageDetail::Auto,
                        code_mode_protocol::ImageDetail::Low => ImageDetail::Low,
                        code_mode_protocol::ImageDetail::High => ImageDetail::High,
                        code_mode_protocol::ImageDetail::Original => ImageDetail::Original,
                    }),
                }
            }
            code_mode_protocol::FunctionCallOutputContentItem::InputAudio { audio_url } => {
                FunctionCallOutputContentItem::InputAudio { audio_url }
            }
        })
        .collect()
}
