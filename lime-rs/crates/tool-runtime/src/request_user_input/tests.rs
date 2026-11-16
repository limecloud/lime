use super::{
    REQUEST_USER_INPUT_QUESTIONS_SCHEMA_KEY, REQUEST_USER_INPUT_TOOL_NAME,
    RequestUserInputCallback, RequestUserInputOption, RequestUserInputQuestion,
    RequestUserInputRequest, build_requested_schema, execute_request_user_input, extract_response,
    normalize_request_user_input_result, parse_request_user_input_tool_input,
    project_request_user_input_result, request_user_input_canonical_tool_name,
    request_user_input_tool_definition,
};
use std::sync::Arc;
use std::time::Duration;

#[test]
fn parse_request_user_input_tool_input_validates_current_surface() {
    let request = parse_request_user_input_tool_input(serde_json::json!({
        "questions": [{
            "id": "mode",
            "header": "模式",
            "question": "请选择执行模式",
            "options": [
                {"label": "自动", "description": "继续执行"},
                {"label": "确认", "description": "等待确认"}
            ]
        }],
        "autoResolutionMs": 60000
    }))
    .expect("request should parse");

    assert_eq!(request.questions.len(), 1);
    assert_eq!(request.questions[0].id.as_deref(), Some("mode"));
    assert_eq!(request.questions[0].options[0].value, "自动");
    assert_eq!(request.auto_resolution_ms, Some(60000));
}

#[test]
fn parse_request_user_input_accepts_codex_freeform_questions() {
    let request = parse_request_user_input_tool_input(serde_json::json!({
        "questions": [{
            "id": "details",
            "header": "说明",
            "question": "填写具体说明？",
            "isOther": true,
            "isSecret": false
        }]
    }))
    .expect("Codex freeform question should parse");

    assert_eq!(request.questions[0].id.as_deref(), Some("details"));
    assert!(request.questions[0].options.is_empty());
    assert!(request.questions[0].is_other);
    assert!(!request.questions[0].is_secret);
}

#[test]
fn request_user_input_tool_definition_uses_current_name_and_schema() {
    let definition = request_user_input_tool_definition();

    assert_eq!(definition.name, REQUEST_USER_INPUT_TOOL_NAME);
    assert_eq!(
        request_user_input_canonical_tool_name(REQUEST_USER_INPUT_TOOL_NAME),
        Some(REQUEST_USER_INPUT_TOOL_NAME)
    );
    assert_eq!(request_user_input_canonical_tool_name("Ask"), None);
    assert!(definition.description.contains("Request user input"));
    assert_eq!(
        definition.input_schema["required"],
        serde_json::json!(["questions"])
    );
}

#[tokio::test]
async fn execute_request_user_input_uses_callback_and_projects_result() {
    let callback: RequestUserInputCallback = Arc::new(|_request| {
        Box::pin(async move {
            Some(serde_json::json!({
                "模式": "确认后执行"
            }))
        })
    });

    let projection = execute_request_user_input(
        serde_json::json!({
            "questions": [{
                "id": "mode",
                "header": "模式",
                "question": "请选择执行模式",
                "options": [
                    {"label": "自动执行", "description": "继续执行"},
                    {"label": "确认后执行", "description": "等待用户确认"}
                ]
            }]
        }),
        Some(&callback),
        Duration::from_secs(5),
    )
    .await
    .expect("request_user_input should execute");

    assert!(
        projection
            .output
            .contains("\"请选择执行模式\"=\"确认后执行\"")
    );
    assert_eq!(
        projection.metadata.get("answers"),
        Some(&serde_json::json!({
            "请选择执行模式": "确认后执行"
        }))
    );
}

#[test]
fn build_requested_schema_embeds_questions_extension() {
    let request = RequestUserInputRequest {
        questions: vec![RequestUserInputQuestion {
            id: Some("primary_color".to_string()),
            question: "你希望主色调是什么？".to_string(),
            header: Some("主色调".to_string()),
            is_other: false,
            is_secret: false,
            options: vec![
                RequestUserInputOption {
                    value: "blue-purple".to_string(),
                    label: Some("蓝紫".to_string()),
                    description: Some("冷色科技感".to_string()),
                    preview: None,
                },
                RequestUserInputOption {
                    value: "cyber-green".to_string(),
                    label: Some("赛博绿".to_string()),
                    description: Some("高亮未来感".to_string()),
                    preview: None,
                },
            ],
            multi_select: false,
        }],
        auto_resolution_ms: None,
    };

    let schema = build_requested_schema(&request);
    assert_eq!(
        schema
            .get(REQUEST_USER_INPUT_QUESTIONS_SCHEMA_KEY)
            .and_then(|value| value.as_array())
            .map(|value| value.len()),
        Some(1)
    );
    assert_eq!(
        schema["properties"]["answer"]["enum"],
        serde_json::json!(["蓝紫", "赛博绿"])
    );
}

#[test]
fn extract_response_normalizes_question_answers() {
    let request = RequestUserInputRequest {
        questions: vec![
            RequestUserInputQuestion::new("第一问"),
            RequestUserInputQuestion {
                id: Some("mode".to_string()),
                question: "第二问".to_string(),
                header: Some("mode".to_string()),
                is_other: false,
                is_secret: false,
                options: vec![
                    RequestUserInputOption::with_label("auto", "自动执行"),
                    RequestUserInputOption::with_label("confirm", "确认后执行"),
                ],
                multi_select: false,
            },
        ],
        auto_resolution_ms: None,
    };

    let response = extract_response(
        &request,
        &serde_json::json!({
            "question_1": "先看结构",
            "mode": "确认后执行"
        }),
    )
    .expect("expected normalized response");

    assert_eq!(
        response,
        serde_json::json!({
            "answers": {
                "第一问": "先看结构",
                "第二问": "confirm"
            }
        })
    );
}

#[test]
fn extract_response_uses_question_text_as_single_answer_key() {
    let request = RequestUserInputRequest {
        questions: vec![RequestUserInputQuestion {
            id: Some("mode".to_string()),
            question: "请选择执行模式".to_string(),
            header: Some("mode".to_string()),
            is_other: false,
            is_secret: false,
            options: vec![
                RequestUserInputOption::with_label("auto", "自动执行"),
                RequestUserInputOption::with_label("confirm", "确认后执行"),
            ],
            multi_select: false,
        }],
        auto_resolution_ms: None,
    };

    let response = extract_response(
        &request,
        &serde_json::json!({
            "answer": "确认后执行"
        }),
    )
    .expect("expected normalized response");

    assert_eq!(
        response,
        serde_json::json!({
            "answer": "confirm",
            "answers": {
                "请选择执行模式": "confirm"
            }
        })
    );
    assert!(response["answers"].get("question_text").is_none());
}

#[test]
fn extract_response_accepts_codex_question_id_keys() {
    let request = RequestUserInputRequest {
        questions: vec![RequestUserInputQuestion {
            id: Some("freeform_id".to_string()),
            question: "填写具体说明？".to_string(),
            header: Some("说明".to_string()),
            is_other: true,
            is_secret: false,
            options: Vec::new(),
            multi_select: false,
        }],
        auto_resolution_ms: None,
    };

    assert_eq!(
        extract_response(
            &request,
            &serde_json::json!({
                "freeform_id": "自由答案"
            }),
        ),
        Some(serde_json::json!({
            "answer": "自由答案",
            "answers": {
                "填写具体说明？": "自由答案"
            }
        }))
    );
}

#[test]
fn normalize_result_preserves_annotations_and_option_identity() {
    let request = RequestUserInputRequest {
        questions: vec![RequestUserInputQuestion {
            id: Some("mode".to_string()),
            question: "请选择执行模式".to_string(),
            header: Some("mode".to_string()),
            is_other: false,
            is_secret: false,
            options: vec![
                RequestUserInputOption::with_label("auto", "自动执行"),
                RequestUserInputOption::with_label("confirm", "确认后执行"),
            ],
            multi_select: false,
        }],
        auto_resolution_ms: None,
    };

    let result = normalize_request_user_input_result(
        &request,
        serde_json::json!({
            "mode": "确认后执行",
            "annotations": {
                "mode": {
                    "preview": "diff preview",
                    "notes": "先看计划"
                }
            }
        }),
    )
    .expect("result should normalize");

    assert_eq!(result.primary_response(), Some("confirm"));
    assert!(result.from_option);
    assert_eq!(result.option_index, Some(1));
    assert_eq!(
        result
            .annotations
            .get("请选择执行模式")
            .and_then(|annotation| annotation.preview.as_deref()),
        Some("diff preview")
    );
}

#[test]
fn project_request_user_input_result_builds_output_and_metadata() {
    let request = RequestUserInputRequest {
        questions: vec![RequestUserInputQuestion {
            id: Some("mode".to_string()),
            question: "请选择执行模式".to_string(),
            header: Some("mode".to_string()),
            is_other: false,
            is_secret: false,
            options: vec![
                RequestUserInputOption::with_label("auto", "自动执行"),
                RequestUserInputOption::with_label("confirm", "确认后执行"),
            ],
            multi_select: false,
        }],
        auto_resolution_ms: None,
    };
    let result = normalize_request_user_input_result(
        &request,
        serde_json::json!({
            "mode": "确认后执行",
            "annotations": {
                "mode": {
                    "preview": "diff preview",
                    "notes": "先看计划"
                }
            }
        }),
    )
    .expect("result should normalize");

    let projection = project_request_user_input_result(&request, &result);

    assert!(projection.output.contains("\"请选择执行模式\"=\"confirm\""));
    assert!(
        projection
            .output
            .contains("selected preview:\ndiff preview")
    );
    assert_eq!(
        projection.metadata.get("answers"),
        Some(&serde_json::json!({
            "请选择执行模式": "confirm"
        }))
    );
    assert!(projection.metadata.contains_key("annotations"));
}
