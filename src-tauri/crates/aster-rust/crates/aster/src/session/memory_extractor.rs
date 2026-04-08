use crate::conversation::message::MessageContent;
use anyhow::Result;

pub(crate) fn extract_text_for_memory(content_json: &str) -> Result<String> {
    let contents: Vec<MessageContent> = serde_json::from_str(content_json)?;
    let mut fragments = Vec::new();

    for content in contents {
        match content {
            MessageContent::Text(text) => {
                let trimmed = text.text.trim();
                if !trimmed.is_empty() {
                    fragments.push(trimmed.to_string());
                }
            }
            MessageContent::ToolResponse(tool_response) => {
                if let Ok(result) = tool_response.tool_result {
                    let response_text = result
                        .content
                        .into_iter()
                        .filter_map(|item| item.raw.as_text().map(|t| t.text.to_string()))
                        .collect::<Vec<_>>()
                        .join("\n");
                    if !response_text.trim().is_empty() {
                        fragments.push(response_text);
                    }
                }
            }
            _ => {}
        }
    }

    Ok(fragments.join("\n").trim().to_string())
}
