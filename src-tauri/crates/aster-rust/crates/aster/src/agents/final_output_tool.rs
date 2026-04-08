use crate::agents::tool_execution::ToolCallResult;
use indoc::formatdoc;
use rmcp::model::{CallToolRequestParam, Content, ErrorCode, ErrorData, Tool, ToolAnnotations};
use serde_json::Value;
use std::borrow::Cow;

pub const FINAL_OUTPUT_TOOL_NAME: &str = "StructuredOutput";
pub const FINAL_OUTPUT_CONTINUATION_MESSAGE: &str =
    "You MUST call the `StructuredOutput` tool NOW with the structured final output for the user.";

#[derive(Debug)]
pub struct FinalOutputTool {
    output_schema: Value,
    /// The final output collected for the user. It will be a single line string for easy script extraction from output.
    pub final_output: Option<String>,
}

impl FinalOutputTool {
    pub fn validate_output_schema(output_schema: &Value) -> Result<(), String> {
        let Some(schema_object) = output_schema.as_object() else {
            return Err(
                "Cannot create FinalOutputTool: output_schema must be a JSON object".to_string(),
            );
        };

        if schema_object.is_empty() {
            return Err(
                "Cannot create FinalOutputTool: empty output_schema is not allowed".to_string(),
            );
        }

        if let Some(schema_type) = schema_object.get("type") {
            if schema_type != "object" {
                return Err(
                    "Cannot create FinalOutputTool: top-level output_schema type must be object"
                        .to_string(),
                );
            }
        }

        jsonschema::meta::validate(output_schema)
            .map_err(|error| format!("Cannot create FinalOutputTool: invalid schema: {error}"))
    }

    pub fn new(output_schema: Value) -> Result<Self, String> {
        Self::validate_output_schema(&output_schema)?;
        Ok(Self {
            output_schema,
            final_output: None,
        })
    }

    pub fn tool(&self) -> Tool {
        let instructions = formatdoc! {r#"
            The StructuredOutput tool validates and returns the final structured output for the user against a predefined JSON schema.

            This tool MUST be called exactly once when you are ready to return the final structured result.
            
            Purpose:
            - Return the final response as structured JSON
            - Ensure the final output conforms to the expected JSON structure
            - Provide clear validation feedback when outputs do not match the schema
            
            Usage:
            - Call the `StructuredOutput` tool with the JSON object that should be returned to the caller.
            
            The expected JSON schema format is:

            {}
            
            When validation fails, you'll receive:
            - Specific validation errors
            - The expected format
        "#, serde_json::to_string_pretty(&self.output_schema).unwrap()};

        Tool::new(
            FINAL_OUTPUT_TOOL_NAME.to_string(),
            instructions,
            self.output_schema.as_object().unwrap().clone(),
        )
        .annotate(ToolAnnotations {
            title: Some("Structured Output".to_string()),
            read_only_hint: Some(false),
            destructive_hint: Some(false),
            idempotent_hint: Some(true),
            open_world_hint: Some(false),
        })
    }

    pub fn system_prompt(&self) -> String {
        formatdoc! {r#"
            # Structured Output Instructions

            You MUST use the `StructuredOutput` tool to return the final structured output for the user rather than providing the output directly in your response.
            The final output MUST be a valid JSON object provided to the `StructuredOutput` tool, and it must match the following schema:

            {}

            ----
        "#, serde_json::to_string_pretty(&self.output_schema).unwrap()}
    }

    async fn validate_json_output(&self, output: &Value) -> Result<Value, String> {
        let compiled_schema = match jsonschema::validator_for(&self.output_schema) {
            Ok(schema) => schema,
            Err(e) => {
                return Err(format!("Internal error: Failed to compile schema: {}", e));
            }
        };

        let validation_errors: Vec<String> = compiled_schema
            .iter_errors(output)
            .map(|error| format!("- {}: {}", error.instance_path, error))
            .collect();

        if validation_errors.is_empty() {
            Ok(output.clone())
        } else {
            Err(format!(
                "Validation failed:\n{}\n\nExpected format:\n{}\n\nPlease correct your output to match the expected JSON schema and try again.",
                validation_errors.join("\n"),
                serde_json::to_string_pretty(&self.output_schema).unwrap_or_else(|_| "Invalid schema".to_string())
            ))
        }
    }

    pub async fn execute_tool_call(&mut self, tool_call: CallToolRequestParam) -> ToolCallResult {
        match tool_call.name.to_string().as_str() {
            FINAL_OUTPUT_TOOL_NAME => {
                let result = self.validate_json_output(&tool_call.arguments.into()).await;
                match result {
                    Ok(parsed_value) => {
                        self.final_output = Some(Self::parsed_final_output_string(parsed_value));
                        ToolCallResult::from(Ok(rmcp::model::CallToolResult {
                            content: vec![Content::text(
                                "Structured output captured successfully.".to_string(),
                            )],
                            structured_content: None,
                            is_error: Some(false),
                            meta: None,
                        }))
                    }
                    Err(error) => ToolCallResult::from(Err(ErrorData {
                        code: ErrorCode::INVALID_PARAMS,
                        message: Cow::from(error),
                        data: None,
                    })),
                }
            }
            _ => ToolCallResult::from(Err(ErrorData {
                code: ErrorCode::INVALID_REQUEST,
                message: Cow::from(format!("Unknown tool: {}", tool_call.name)),
                data: None,
            })),
        }
    }

    // Formats the parsed JSON as a single line string so its easy to extract from the output
    fn parsed_final_output_string(parsed_json: Value) -> String {
        serde_json::to_string(&parsed_json).unwrap()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rmcp::model::CallToolRequestParam;
    use rmcp::object;
    use serde_json::json;

    fn create_complex_test_schema() -> Value {
        json!({
            "type": "object",
            "properties": {
                "user": {
                    "type": "object",
                    "properties": {
                        "name": {"type": "string"},
                        "age": {"type": "number"}
                    },
                    "required": ["name", "age"]
                },
                "tags": {
                    "type": "array",
                    "items": {"type": "string"}
                }
            },
            "required": ["user", "tags"]
        })
    }

    #[test]
    fn test_new_with_non_object_schema_returns_error() {
        let error = FinalOutputTool::new(json!("text")).unwrap_err();
        assert!(error.contains("output_schema must be a JSON object"));
    }

    #[test]
    fn test_new_with_empty_schema_returns_error() {
        let error = FinalOutputTool::new(json!({})).unwrap_err();
        assert!(error.contains("empty output_schema is not allowed"));
    }

    #[test]
    fn test_new_with_non_object_root_type_returns_error() {
        let error = FinalOutputTool::new(json!({
            "type": "string"
        }))
        .unwrap_err();
        assert!(error.contains("top-level output_schema type must be object"));
    }

    #[test]
    fn test_new_with_invalid_schema_returns_error() {
        let error = FinalOutputTool::new(json!({
            "type": "object",
            "properties": {
                "message": {
                    "type": "unknown_type"
                }
            }
        }))
        .unwrap_err();
        assert!(error.contains("invalid schema"));
    }

    #[tokio::test]
    async fn test_execute_tool_call_schema_validation_failure() {
        let mut tool = FinalOutputTool::new(json!({
            "type": "object",
            "properties": {
                "message": {
                    "type": "string"
                },
                "count": {
                    "type": "number"
                }
            },
            "required": ["message", "count"]
        }))
        .expect("schema should be valid");
        let tool_call = CallToolRequestParam {
            name: FINAL_OUTPUT_TOOL_NAME.into(),
            arguments: Some(object!({
                "message": "Hello"  // Missing required "count" field
            })),
        };

        let result = tool.execute_tool_call(tool_call).await;
        let tool_result = result.result.await;
        assert!(tool_result.is_err());
        if let Err(error) = tool_result {
            assert!(error.to_string().contains("Validation failed"));
        }
    }

    #[tokio::test]
    async fn test_execute_tool_call_complex_valid_json() {
        let mut tool =
            FinalOutputTool::new(create_complex_test_schema()).expect("schema should be valid");
        let tool_call = CallToolRequestParam {
            name: FINAL_OUTPUT_TOOL_NAME.into(),
            arguments: Some(object!({
                "user": {
                    "name": "John",
                    "age": 30
                },
                "tags": ["developer", "rust"]
            })),
        };

        let result = tool.execute_tool_call(tool_call).await;
        let tool_result = result.result.await;
        assert!(tool_result.is_ok());
        assert!(tool.final_output.is_some());

        let final_output = tool.final_output.unwrap();
        assert!(serde_json::from_str::<Value>(&final_output).is_ok());
        assert!(!final_output.contains('\n'));
    }
}
