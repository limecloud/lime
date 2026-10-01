use super::*;
fn lower_turn_start_params(
    params: &TurnStartParams,
    session_id: String,
) -> Result<crate::runtime::TurnStartRequest, JsonRpcError> {
    lower_turn_start_params_with_policy(params, session_id, None)
}

fn lower_runtime_options(params: &TurnStartParams) -> Result<Option<RuntimeOptions>, JsonRpcError> {
    lower_runtime_options_with_policy(params, None)
}
use agent_protocol::{CollaborationMode, CollaborationModeSettings, ImageDetail, ModeKind};
use serde_json::json;

#[test]
fn lowers_v2_text_and_image_input_without_losing_ordered_text() {
    let input = lower_user_input(vec![
        UserInput::Text {
            text: "first".to_string(),
            text_elements: Vec::new(),
        },
        UserInput::Text {
            text: "second".to_string(),
            text_elements: Vec::new(),
        },
        UserInput::LocalImage {
            detail: Some(ImageDetail::High),
            path: "/tmp/image.png".to_string(),
        },
    ])
    .expect("lower input");

    assert_eq!(
        input,
        vec![
            AgentInput::text("first"),
            AgentInput::text("second"),
            AgentInput::LocalImage {
                path: "/tmp/image.png".to_string(),
                detail: Some(ImageDetail::High),
            },
        ]
    );
}

#[test]
fn preserves_structured_v2_input_without_turning_it_into_text() {
    let input = lower_user_input(vec![UserInput::Skill {
        name: "review".to_string(),
        path: "/skills/review/SKILL.md".to_string(),
    }])
    .expect("skill input");

    assert_eq!(
        input,
        vec![AgentInput::Skill {
            name: "review".to_string(),
            path: "/skills/review/SKILL.md".to_string(),
        }]
    );
}

#[test]
fn lowers_client_message_identity_into_runtime_metadata() {
    let params = TurnStartParams {
        thread_id: "thread-1".to_string(),
        client_user_message_id: Some(" client-1 ".to_string()),
        input: vec![UserInput::Text {
            text: "hello".to_string(),
            text_elements: Vec::new(),
        }],
        ..TurnStartParams::default()
    };

    let lowered =
        lower_turn_start_params(&params, "session-1".to_string()).expect("lower turn start");
    assert_eq!(
        lowered
            .runtime_options
            .as_ref()
            .and_then(RuntimeOptions::runtime_metadata)
            .and_then(|metadata| metadata.get("clientUserMessageId")),
        Some(&json!("client-1"))
    );
}

#[test]
fn collaboration_mode_settings_override_plain_turn_fields() {
    let params = TurnStartParams {
        thread_id: "thread-1".to_string(),
        input: vec![UserInput::Text {
            text: "hello".to_string(),
            text_elements: Vec::new(),
        }],
        model: Some("stale-model".to_string()),
        effort: Some("low".to_string()),
        collaboration_mode: Some(CollaborationMode {
            mode: ModeKind::Plan,
            settings: CollaborationModeSettings {
                model: "gpt-5.4".to_string(),
                reasoning_effort: Some("high".to_string()),
                developer_instructions: Some("Plan before editing.".to_string()),
            },
        }),
        ..TurnStartParams::default()
    };

    let options = lower_runtime_options(&params)
        .expect("typed collaboration mode")
        .expect("runtime options");
    let request = options.runtime_request.expect("runtime request");

    assert_eq!(request.model_preference.as_deref(), Some("gpt-5.4"));
    assert_eq!(request.reasoning_effort.as_deref(), Some("high"));
    assert_eq!(
        request.system_prompt.as_deref(),
        Some("Plan before editing.")
    );
    assert_eq!(request.collaboration_mode, params.collaboration_mode);
}

#[test]
fn collaboration_mode_rejects_an_empty_settings_model() {
    let params = TurnStartParams {
        thread_id: "thread-1".to_string(),
        input: vec![UserInput::Text {
            text: "hello".to_string(),
            text_elements: Vec::new(),
        }],
        collaboration_mode: Some(CollaborationMode {
            mode: ModeKind::Plan,
            settings: CollaborationModeSettings {
                model: "   ".to_string(),
                reasoning_effort: None,
                developer_instructions: None,
            },
        }),
        ..TurnStartParams::default()
    };

    let error = lower_runtime_options(&params).expect_err("empty model must fail closed");
    assert_eq!(error.code, error_codes::INVALID_PARAMS);
    assert!(error.message.contains("settings.model must not be empty"));
}

#[test]
fn permission_profile_resolves_to_runtime_policy_and_provenance() {
    let params = TurnStartParams {
        thread_id: "thread-1".to_string(),
        input: vec![UserInput::Text {
            text: "hello".to_string(),
            text_elements: Vec::new(),
        }],
        approval_policy: Some(json!("on-request")),
        permissions: Some(":workspace".to_string()),
        ..TurnStartParams::default()
    };

    let options = lower_runtime_options(&params)
        .expect("known permission profile")
        .expect("runtime options");
    let request = options.runtime_request.expect("runtime request");
    assert_eq!(request.approval_policy.as_deref(), Some("on-request"));
    assert_eq!(request.sandbox_policy.as_deref(), Some("workspace-write"));
    assert_eq!(
        request
            .metadata
            .as_ref()
            .and_then(Value::as_object)
            .and_then(|metadata| metadata.get("activePermissionProfile")),
        Some(&json!({"id": ":workspace"}))
    );
}

#[test]
fn permission_profile_rejects_unknown_and_sandbox_combination() {
    let mut params = TurnStartParams {
        thread_id: "thread-1".to_string(),
        input: vec![UserInput::Text {
            text: "hello".to_string(),
            text_elements: Vec::new(),
        }],
        permissions: Some("custom".to_string()),
        ..TurnStartParams::default()
    };
    let error = lower_runtime_options(&params).expect_err("unknown profile must fail closed");
    assert_eq!(error.code, error_codes::INVALID_PARAMS);
    assert!(error.message.contains("unknown permission profile"));

    params.permissions = Some(":read-only".to_string());
    params.sandbox_policy = Some(json!("read-only"));
    let error = lower_runtime_options(&params).expect_err("mixed policy must fail closed");
    assert_eq!(error.code, error_codes::INVALID_PARAMS);
    assert!(error.message.contains("cannot be combined"));
}

#[test]
fn deprecated_multi_agent_mode_does_not_enter_runtime_metadata() {
    let params = TurnStartParams {
        thread_id: "thread-1".to_string(),
        input: vec![UserInput::Text {
            text: "hello".to_string(),
            text_elements: Vec::new(),
        }],
        multi_agent_mode: Some(agent_protocol::MultiAgentMode::Proactive),
        ..TurnStartParams::default()
    };

    assert!(lower_runtime_options(&params)
        .expect("deprecated field is accepted")
        .is_none());
}

#[test]
fn lowers_v2_application_metadata_into_runtime_options() {
    let trace = json!({
        "traceId": "trace-v2",
        "requestId": "request-v2",
        "submittedAt": 1_784_447_000_000_i64,
    });
    let harness = json!({
        "image_command_intent": {
            "kind": "image_task",
            "image_task": {
                "prompt": "draw a lime"
            }
        }
    });
    let params = TurnStartParams {
        thread_id: "thread-1".to_string(),
        input: vec![UserInput::Text {
            text: "hello".to_string(),
            text_elements: Vec::new(),
        }],
        additional_context: Some(
            [(
                "metadata".to_string(),
                app_server_protocol::protocol::v2::AdditionalContextEntry {
                    kind: AdditionalContextKind::Application,
                    value: json!({
                        "agentUiPerformanceTrace": trace,
                        "harness": harness,
                    })
                    .to_string(),
                },
            )]
            .into(),
        ),
        ..TurnStartParams::default()
    };

    let lowered = lower_runtime_options(&params)
        .expect("lower runtime options")
        .expect("runtime options");
    let metadata = lowered.runtime_metadata().expect("runtime metadata");
    assert_eq!(metadata.get("agentUiPerformanceTrace"), Some(&trace));
    assert_eq!(metadata.get("harness"), Some(&harness));
    assert!(metadata.get("additionalContext").is_some());
}

#[test]
fn does_not_lower_untrusted_v2_trace_metadata() {
    let params = TurnStartParams {
        thread_id: "thread-1".to_string(),
        input: vec![UserInput::Text {
            text: "hello".to_string(),
            text_elements: Vec::new(),
        }],
        additional_context: Some(
            [(
                "metadata".to_string(),
                app_server_protocol::protocol::v2::AdditionalContextEntry {
                    kind: AdditionalContextKind::Untrusted,
                    value: json!({
                        "agentUiPerformanceTrace": { "traceId": "must-not-lower" }
                    })
                    .to_string(),
                },
            )]
            .into(),
        ),
        ..TurnStartParams::default()
    };

    let lowered = lower_runtime_options(&params)
        .expect("lower runtime options")
        .expect("runtime options");
    let metadata = lowered.runtime_metadata().expect("runtime metadata");
    assert!(metadata.get("agentUiPerformanceTrace").is_none());
}
