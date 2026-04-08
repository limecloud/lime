pub mod anthropic;
#[cfg(feature = "provider-aws")]
pub mod bedrock;
pub mod databricks;
pub mod gcpvertexai;
pub mod google;
pub mod openai;
pub mod openai_responses;
pub mod snowflake;

use rmcp::model::Tool;
use serde_json::Value;

pub(crate) fn tool_input_examples(tool: &Tool) -> Option<&Value> {
    tool.meta
        .as_ref()
        .and_then(|meta| meta.get("input_examples"))
}

pub(crate) fn tool_description_with_examples(tool: &Tool) -> String {
    let mut description = tool.description.as_deref().unwrap_or("").to_string();
    let Some(examples) = tool_input_examples(tool) else {
        return description;
    };

    let rendered = render_input_examples_for_description(examples);
    if rendered.is_empty() {
        return description;
    }

    if !description.is_empty() {
        description.push_str("\n\n");
    }
    description.push_str("Input examples:\n");
    description.push_str(&rendered);
    description
}

fn render_input_examples_for_description(examples: &Value) -> String {
    fn truncate_for_prompt(input: &str, max_chars: usize) -> String {
        if input.chars().count() <= max_chars {
            return input.to_string();
        }
        let mut truncated = input.chars().take(max_chars).collect::<String>();
        truncated.push_str("...");
        truncated
    }

    let Some(arr) = examples.as_array() else {
        return truncate_for_prompt(&examples.to_string(), 240);
    };

    if arr.is_empty() {
        return String::new();
    }

    let mut lines = Vec::new();
    for (idx, example) in arr.iter().take(3).enumerate() {
        let label = example
            .get("description")
            .and_then(|v| v.as_str())
            .map(ToString::to_string)
            .unwrap_or_else(|| format!("Example {}", idx + 1));
        let input = example.get("input").unwrap_or(example);
        let serialized = truncate_for_prompt(&input.to_string(), 180);
        lines.push(format!("- {}: {}", label, serialized));
    }

    if arr.len() > 3 {
        lines.push(format!("- ... and {} more", arr.len() - 3));
    }

    lines.join("\n")
}
