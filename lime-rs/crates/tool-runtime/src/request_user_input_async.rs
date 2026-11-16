//! Non-blocking questions published as canonical AgentMessage items.

use crate::tool_definition::RuntimeToolDefinition;
use agent_protocol::AsyncUserInputQuestion;
use serde::Deserialize;
use serde_json::{Value, json};

pub const REQUEST_USER_INPUT_ASYNC_TOOL_NAME: &str = "request_user_input_async";
pub const REQUEST_USER_INPUT_ASYNC_ACCEPTED: &str = r#"{"accepted":true}"#;

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RequestUserInputAsyncArgs {
    pub questions: Vec<AsyncUserInputQuestion>,
}

pub fn parse_request_user_input_async_args(
    arguments: &Value,
) -> Result<RequestUserInputAsyncArgs, String> {
    let args: RequestUserInputAsyncArgs = serde_json::from_value(arguments.clone())
        .map_err(|error| format!("invalid request_user_input_async arguments: {error}"))?;
    if args.questions.is_empty() {
        return Err("questions must not be empty".to_string());
    }
    for question in &args.questions {
        if question.title.trim().is_empty() {
            return Err("question titles must not be empty".to_string());
        }
        if question.options.as_ref().is_some_and(|options| {
            options.is_empty() || options.iter().any(|option| option.trim().is_empty())
        }) {
            return Err("options must contain at least one non-empty answer".to_string());
        }
    }
    Ok(args)
}

pub fn question_text(questions: &[AsyncUserInputQuestion]) -> String {
    questions
        .iter()
        .map(|question| {
            let mut lines = vec![question.title.clone()];
            if let Some(options) = &question.options {
                lines.extend(options.iter().map(|option| format!("- {option}")));
            }
            lines.join("\n")
        })
        .collect::<Vec<_>>()
        .join("\n\n")
}

pub fn request_user_input_async_tool_definition() -> RuntimeToolDefinition {
    RuntimeToolDefinition::new(
        REQUEST_USER_INPUT_ASYNC_TOOL_NAME,
        "Present one or more questions to the user without waiting for the response. \
The questions are shown while you continue working. Ask only non-blocking questions; \
continue with best judgment if the user has not answered. Recommended answers go first. \
The UI provides free-text input automatically. A preselected option is not a submitted answer.",
        json!({
            "type": "object",
            "properties": {
                "questions": {
                    "type": "array",
                    "minItems": 1,
                    "description": "One or more self-contained questions to present together, in display order.",
                    "items": {
                        "type": "object",
                        "properties": {
                            "title": {"type": "string", "description": "The complete question shown to the user, including any context needed to answer it."},
                            "options": {
                                "type": "array",
                                "items": {"type": "string"},
                                "minItems": 1,
                                "description": "Suggested answers, in display order. Put the recommended answer first; the first option is preselected by default. The user can select one option or enter a free-text answer. Do not include an Other option or a free-text placeholder; the UI provides free-text input automatically. Omit options for a free-text-only question."
                            }
                        },
                        "required": ["title"],
                        "additionalProperties": false
                    }
                }
            },
            "required": ["questions"],
            "additionalProperties": false
        }),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_all_questions_before_producing_text() {
        for invalid in [
            json!({"questions": []}),
            json!({"questions": [{"title": "ok"}, {"title": " "}]}),
            json!({"questions": [{"title": "ok", "options": []}]}),
            json!({"questions": [{"title": "ok", "options": [" "]}]}),
            json!({"questions": [{"title": "ok", "requestId": "invented"}]}),
            json!({"questions": [{"title": "ok"}], "isBlocking": true}),
        ] {
            assert!(
                parse_request_user_input_async_args(&invalid).is_err(),
                "{invalid}"
            );
        }
        let args = parse_request_user_input_async_args(&json!({"questions": [
            {"title": "Choose", "options": ["First", "Second"]},
            {"title": "Anything else?"}
        ]}))
        .unwrap();
        assert_eq!(
            question_text(&args.questions),
            "Choose\n- First\n- Second\n\nAnything else?"
        );
        assert!(args.questions[1].options.is_none());
    }
}
