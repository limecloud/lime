//! Preserve typed media while applying the script's text-output budget.

use crate::{
    FunctionCallOutputContentItem, RuntimeCodeModeResponse as RuntimeResponse,
    RuntimeCodeModeToolResult,
};

// Copied from upstream core/src/tools/code_mode/mod.rs, frozen revision in the copy ledger.
fn format_script_status(response: &RuntimeResponse) -> String {
    match response {
        RuntimeResponse::Yielded { cell_id, .. } => {
            format!("Script running with cell ID {cell_id}")
        }
        RuntimeResponse::Terminated { .. } => "Script terminated".to_string(),
        RuntimeResponse::Result { error_text, .. } => {
            if error_text.is_none() {
                "Script completed".to_string()
            } else {
                "Script failed".to_string()
            }
        }
    }
}

pub(super) fn tool_result(
    response: RuntimeResponse,
    max_tokens: usize,
) -> RuntimeCodeModeToolResult {
    let status = format_script_status(&response);
    let (cell_id, mut content_items, error) = match response {
        RuntimeResponse::Yielded {
            cell_id,
            content_items,
            ..
        }
        | RuntimeResponse::Terminated {
            cell_id,
            content_items,
            ..
        } => (cell_id, content_items, None),
        RuntimeResponse::Result {
            cell_id,
            content_items,
            error_text,
            ..
        } => (cell_id, content_items, error_text),
    };
    content_items.insert(
        0,
        FunctionCallOutputContentItem::InputText {
            text: format!("{status}\nOutput:\n"),
        },
    );
    if let Some(error) = error.as_ref() {
        content_items.push(FunctionCallOutputContentItem::InputText {
            text: format!("\nScript error:\n{error}"),
        });
    }
    // Keep media out of text serialization and preserve its position in the typed body.
    let mut remaining = max_tokens.max(1).saturating_mul(4);
    let mut truncated = false;
    for item in &mut content_items {
        if let FunctionCallOutputContentItem::InputText { text } = item {
            let count = text.chars().count();
            if count > remaining {
                *text = text.chars().take(remaining).collect();
                truncated = true;
            }
            remaining = remaining.saturating_sub(count);
        }
    }
    if truncated {
        content_items.push(FunctionCallOutputContentItem::InputText {
            text: "\n[output truncated]".to_string(),
        });
    }
    let output = content_items
        .iter()
        .filter_map(|item| match item {
            FunctionCallOutputContentItem::InputText { text } => Some(text.as_str()),
            _ => None,
        })
        .collect::<String>();
    RuntimeCodeModeToolResult {
        cell_id,
        success: error.is_none(),
        output,
        content_items,
        error,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{ImageDetail, RuntimeCodeModeCellId};

    fn image() -> FunctionCallOutputContentItem {
        FunctionCallOutputContentItem::InputImage {
            image_url: "data:image/png;base64,aGVsbG8=".to_string(),
            detail: Some(ImageDetail::High),
        }
    }

    #[test]
    fn media_survives_text_budget_without_base64_in_text() {
        let result = RuntimeResponse::Yielded {
            cell_id: RuntimeCodeModeCellId::new("image-cell"),
            content_items: vec![
                image(),
                FunctionCallOutputContentItem::InputText {
                    text: "中文".repeat(20),
                },
            ],
            code_mode_host_duration: None,
        }
        .into_tool_result_with_max_tokens(2);
        assert!(result.output.contains("output truncated"));
        assert!(!result.output.contains("base64"));
        assert!(result.content_items.contains(&image()));
        assert_eq!(result.cell_id.as_str(), "image-cell");
    }

    #[test]
    fn failed_script_keeps_partial_media_and_error() {
        let result = RuntimeResponse::Result {
            cell_id: RuntimeCodeModeCellId::new("failed-cell"),
            content_items: vec![
                FunctionCallOutputContentItem::InputText {
                    text: "partial observation".to_string(),
                },
                image(),
            ],
            error_text: Some("window disappeared".to_string()),
            code_mode_host_duration: None,
        }
        .into_tool_result();
        assert!(!result.success);
        assert_eq!(result.error.as_deref(), Some("window disappeared"));
        assert!(result.output.contains("partial observation"));
        assert!(result.output.contains("Script error:\nwindow disappeared"));
        assert!(result.content_items.contains(&image()));
        assert!(!result.output.contains("base64"));
    }
}
