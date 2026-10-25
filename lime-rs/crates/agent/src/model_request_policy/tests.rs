use super::*;
use model_provider::provider_stream::RuntimeReplyProviderRequestWireShape;
use serde_json::json;
use std::collections::HashMap;

#[test]
fn truncation_only_policy_reaches_runtime_without_responses_settings() {
    for (mode, limit, expected) in [
        ("tokens", 32, TruncationPolicy::Tokens(32)),
        ("bytes", 128, TruncationPolicy::Bytes(128)),
        ("tokens", 0, TruncationPolicy::Tokens(0)),
    ] {
        let metadata = json!({"harness":{"model_request_policy":{
            "truncation_policy":{"mode":mode,"limit":limit}
        }}});
        let policy = runtime_reply_model_request_policy_from_metadata(&metadata).unwrap();
        assert_eq!(policy.truncation, Some(expected));
        assert_eq!(policy.parallel_tool_calls(), None);
        assert!(!policy.use_responses_lite());
    }
}

#[test]
fn model_request_policy_from_metadata_reads_snake_case_harness_policy() {
    let metadata = json!({
        "harness": {
            "model_request_policy": {
                "source": "model_registry",
                "provider_id": "openai",
                "model_id": "fixture-model",
                "responses_policy": {
                    "use_responses_lite": true
                },
                "tool_call_policy": {
                    "supports_parallel_tool_calls": true
                },
                "input_modality_policy": {
                    "input_modalities": ["text", "image"],
                    "send_gate_modalities": ["text", "image"],
                    "supports_text_input": true,
                    "supports_media_input": true,
                    "supports_image_input": true,
                    "source": "lime_default"
                },
                "context_policy": {
                    "context_window": 273000,
                    "max_context_window": 400000,
                    "auto_compact_token_limit": 260000,
                    "effective_context_window_percent": 90
                },
                "reasoning_output_policy": {
                    "default_reasoning_summary": "detailed",
                    "support_verbosity": true,
                    "default_verbosity": "low"
                },
                "truncation_policy": {
                    "truncation_policy": {
                        "mode": "tokens",
                        "limit": 4096
                    }
                },
                "native_tool_policy": {
                    "shell_type": "unified-exec",
                    "apply_patch_tool_type": "freeform",
                    "experimental_supported_tools": ["Beta", "beta", "alpha"]
                }
            }
        }
    });

    let policy = model_request_policy_from_metadata(&metadata).expect("policy");

    assert_eq!(policy.source.as_deref(), Some("model_registry"));
    assert_eq!(policy.provider_id.as_deref(), Some("openai"));
    assert_eq!(policy.model_id.as_deref(), Some("fixture-model"));
    assert_eq!(
        policy.responses_policy,
        Some(ModelResponsesPolicySnapshot {
            use_responses_lite: true,
            request_mode: "responses_lite".into(),
            instructions_location: "input_prefix".into(),
            tools_location: "input_prefix".into(),
            reasoning_context: "all_turns".into(),
            parallel_tool_calls_allowed: false,
            requires_responses_lite_header: true,
        })
    );
    assert_eq!(
        policy.tool_call_policy,
        Some(ModelToolCallPolicySnapshot {
            supports_parallel_tool_calls: true,
            parallel_tool_calls: true,
        })
    );
    assert_eq!(
        policy.input_modality_policy,
        Some(ModelInputModalityPolicySnapshot {
            input_modalities: vec!["text".into(), "image".into()],
            send_gate_modalities: vec!["text".into(), "image".into()],
            unknown_input_modalities: Vec::new(),
            supports_text_input: true,
            supports_media_input: true,
            supports_image_input: true,
            source: "lime_default".into(),
        })
    );
    assert_eq!(
        policy.context_policy,
        Some(ModelContextPolicySnapshot {
            context_window: Some(273_000),
            max_context_window: Some(400_000),
            resolved_context_window: Some(273_000),
            effective_context_window_percent: 90,
            model_context_window: Some(245_700),
            auto_compact_token_limit: Some(245_700),
        })
    );
    assert_eq!(
        policy.reasoning_output_policy,
        Some(ModelReasoningOutputPolicySnapshot {
            default_reasoning_summary: "detailed".into(),
            support_verbosity: true,
            default_verbosity: Some("low".into()),
            can_set_verbosity: true,
        })
    );
    assert_eq!(
        policy.truncation_policy, None,
        "catalog hints are not overrides"
    );
    assert_eq!(
        policy.native_tool_policy,
        Some(ModelNativeToolPolicySnapshot {
            shell_type: Some("unified_exec".into()),
            shell_tool_enabled: true,
            preferred_shell_surface: Some("unified_exec".into()),
            apply_patch_tool_type: Some("freeform".into()),
            apply_patch_tool_enabled: true,
            experimental_supported_tools: vec!["alpha".into(), "beta".into()],
        })
    );
}

#[test]
fn model_request_policy_from_metadata_accepts_camel_case_aliases() {
    let metadata = json!({
        "harness": {
            "modelRequestPolicy": {
                "providerId": "provider",
                "modelId": "model",
                "responsesPolicy": {
                    "useResponsesLite": false,
                    "parallelToolCallsAllowed": true
                },
                "toolCallPolicy": {
                    "supportsParallelToolCalls": true,
                    "parallelToolCalls": false
                },
                "inputModalityPolicy": {
                    "inputModalities": ["text"],
                    "sendGateModalities": ["text"],
                    "unknownInputModalities": ["diagram"],
                    "supportsImageInput": false
                },
                "contextPolicy": {
                    "maxContextWindow": 400000,
                    "autoCompactTokenLimit": 100000,
                    "effectiveContextWindowPercent": 50
                },
                "reasoningOutputPolicy": {
                    "defaultReasoningSummary": "none",
                    "supportVerbosity": false,
                    "defaultVerbosity": "high"
                },
                "truncationPolicy": {
                    "mode": "bytes",
                    "limit": 1234
                },
                "nativeToolPolicy": {
                    "shellType": "shell-command",
                    "applyPatchToolEnabled": false
                }
            }
        }
    });

    let policy = model_request_policy_from_metadata(&metadata).expect("policy");

    assert_eq!(policy.provider_id.as_deref(), Some("provider"));
    assert_eq!(policy.model_id.as_deref(), Some("model"));
    assert_eq!(
        policy.tool_call_policy,
        Some(ModelToolCallPolicySnapshot {
            supports_parallel_tool_calls: true,
            parallel_tool_calls: false,
        })
    );
    assert_eq!(
        policy
            .input_modality_policy
            .as_ref()
            .map(|policy| policy.supports_image_input),
        Some(false)
    );
    assert_eq!(
        policy
            .input_modality_policy
            .as_ref()
            .map(|policy| policy.unknown_input_modalities.clone()),
        Some(vec!["diagram".to_string()])
    );
    assert_eq!(
        policy.context_policy,
        Some(ModelContextPolicySnapshot {
            context_window: None,
            max_context_window: Some(400_000),
            resolved_context_window: Some(400_000),
            effective_context_window_percent: 50,
            model_context_window: Some(200_000),
            auto_compact_token_limit: Some(100_000),
        })
    );
    assert_eq!(
        policy.reasoning_output_policy,
        Some(ModelReasoningOutputPolicySnapshot {
            default_reasoning_summary: "none".into(),
            support_verbosity: false,
            default_verbosity: None,
            can_set_verbosity: false,
        })
    );
    assert_eq!(
        policy.truncation_policy,
        Some(ModelTruncationPolicySnapshot {
            mode: "bytes".into(),
            limit: 1234,
        })
    );
    assert_eq!(
        policy
            .native_tool_policy
            .as_ref()
            .and_then(|policy| policy.preferred_shell_surface.as_deref()),
        Some("unified_exec")
    );
    assert_eq!(
        policy
            .native_tool_policy
            .as_ref()
            .map(|policy| policy.apply_patch_tool_enabled),
        Some(false)
    );
}

#[test]
fn input_modality_policy_allows_images_only_when_selected_model_supports_image() {
    let text_only_metadata = json!({
        "model_request_policy": {
            "input_modality_policy": {
                "input_modalities": ["text"],
                "supports_image_input": false
            }
        }
    });
    let text_only_policy = model_request_policy_from_metadata(&text_only_metadata).expect("policy");

    assert!(!input_modality_policy_allows_image_input(
        text_only_policy.input_modality_policy.as_ref()
    ));
    assert!(input_modality_policy_allows_image_input(None));

    let inferred_image_metadata = json!({
        "model_request_policy": {
            "input_modality_policy": {
                "input_modalities": ["text", "image"]
            }
        }
    });
    let inferred_image_policy =
        model_request_policy_from_metadata(&inferred_image_metadata).expect("policy");

    assert!(input_modality_policy_allows_image_input(
        inferred_image_policy.input_modality_policy.as_ref()
    ));
}

#[test]
fn context_policy_applies_context_window_and_auto_compact_limits() {
    let metadata = json!({
        "model_request_policy": {
            "context_policy": {
                "context_window": 100000,
                "max_context_window": 400000,
                "auto_compact_token_limit": 95000,
                "effective_context_window_percent": 50
            }
        }
    });

    let policy = model_request_policy_from_metadata(&metadata).expect("policy");

    assert_eq!(
        policy.context_policy,
        Some(ModelContextPolicySnapshot {
            context_window: Some(100_000),
            max_context_window: Some(400_000),
            resolved_context_window: Some(100_000),
            effective_context_window_percent: 50,
            model_context_window: Some(50_000),
            auto_compact_token_limit: Some(90_000),
        })
    );
}

#[test]
fn context_policy_preserves_explicit_auto_compact_without_context_window() {
    let metadata = json!({
        "model_request_policy": {
            "context_policy": {
                "auto_compact_token_limit": 64000,
                "effective_context_window_percent": 125
            }
        }
    });

    let policy = model_request_policy_from_metadata(&metadata).expect("policy");

    assert_eq!(
        policy.context_policy,
        Some(ModelContextPolicySnapshot {
            context_window: None,
            max_context_window: None,
            resolved_context_window: None,
            effective_context_window_percent: DEFAULT_EFFECTIVE_CONTEXT_WINDOW_PERCENT,
            model_context_window: None,
            auto_compact_token_limit: Some(64_000),
        })
    );
}

#[test]
fn context_policy_from_turn_context_reads_selected_model_policy() {
    let context = AgentTurnContext {
        metadata: HashMap::from([(
            "runtime_options".to_string(),
            json!({
                "harness": {
                    "model_request_policy": {
                        "context_policy": {
                            "max_context_window": 200000,
                            "effective_context_window_percent": 25
                        }
                    }
                }
            }),
        )]),
        ..AgentTurnContext::default()
    };

    let policy = model_request_policy_from_turn_context(Some(&context)).expect("policy");
    let context_policy = policy.context_policy.expect("context policy");

    assert_eq!(context_policy.model_context_window, Some(50_000));
    assert_eq!(context_policy.auto_compact_token_limit, Some(180_000));
}

#[test]
fn reasoning_output_policy_defaults_summary_and_gates_verbosity() {
    let metadata = json!({
        "model_request_policy": {
            "reasoning_output_policy": {
                "default_reasoning_summary": "unknown",
                "support_verbosity": false,
                "default_verbosity": "high"
            }
        }
    });

    let policy = model_request_policy_from_metadata(&metadata).expect("policy");

    assert_eq!(
        policy.reasoning_output_policy,
        Some(ModelReasoningOutputPolicySnapshot {
            default_reasoning_summary: "auto".into(),
            support_verbosity: false,
            default_verbosity: None,
            can_set_verbosity: false,
        })
    );
}

#[test]
fn reasoning_output_policy_keeps_supported_default_verbosity() {
    let metadata = json!({
        "model_request_policy": {
            "reasoning_output_policy": {
                "default_reasoning_summary": "concise",
                "support_verbosity": true,
                "default_verbosity": "medium"
            }
        }
    });

    let policy = model_request_policy_from_metadata(&metadata).expect("policy");

    assert_eq!(
        policy.reasoning_output_policy,
        Some(ModelReasoningOutputPolicySnapshot {
            default_reasoning_summary: "concise".into(),
            support_verbosity: true,
            default_verbosity: Some("medium".into()),
            can_set_verbosity: true,
        })
    );
}

#[test]
fn runtime_reply_policy_projects_reasoning_output_for_provider_wire_shape() {
    let metadata = json!({
        "model_request_policy": {
            "reasoning_output_policy": {
                "default_reasoning_summary": "detailed",
                "support_verbosity": true,
                "default_verbosity": "low"
            }
        }
    });

    let policy = runtime_reply_model_request_policy_from_metadata(&metadata).expect("policy");
    let wire_shape = RuntimeReplyProviderRequestWireShape::from_model_request_policy(Some(&policy));

    assert_eq!(policy.reasoning_summary(), Some("detailed"));
    assert_eq!(policy.text_verbosity(), Some("low"));
    assert_eq!(wire_shape.reasoning_summary.as_deref(), Some("detailed"));
    assert_eq!(wire_shape.text_verbosity.as_deref(), Some("low"));
}

#[test]
fn runtime_reply_policy_omits_none_summary_and_unsupported_verbosity() {
    let metadata = json!({
        "model_request_policy": {
            "reasoning_output_policy": {
                "default_reasoning_summary": "none",
                "support_verbosity": false,
                "default_verbosity": "high"
            }
        }
    });

    let policy = runtime_reply_model_request_policy_from_metadata(&metadata).expect("policy");
    let wire_shape = RuntimeReplyProviderRequestWireShape::from_model_request_policy(Some(&policy));

    assert_eq!(policy.reasoning_summary(), None);
    assert_eq!(policy.text_verbosity(), None);
    assert_eq!(wire_shape.reasoning_summary, None);
    assert_eq!(wire_shape.text_verbosity, None);
}

#[test]
fn native_shell_aliases_normalize_to_the_shared_unified_exec_surface() {
    for shell_type in ["default", "local", "shell_command", "unified_exec"] {
        let metadata = json!({
            "model_request_policy": {
                "native_tool_policy": {
                    "shell_type": shell_type,
                    "preferred_shell_surface": "shell_command",
                    "apply_patch_tool_type": "freeform"
                }
            }
        });
        let policy = native_tool_policy_from_metadata(&metadata).expect("native policy");
        assert_eq!(policy.shell_type.as_deref(), Some("unified_exec"));
        assert_eq!(
            policy.preferred_shell_surface.as_deref(),
            Some("unified_exec")
        );
        assert!(policy.shell_tool_enabled);
        assert!(native_tool_policy_disallowed_tool_names(Some(&policy)).is_empty());
    }
}

#[test]
fn stale_shell_metadata_cannot_enable_disabled_or_unknown_shell_types() {
    for shell_type in ["disabled", "remote_shell"] {
        let metadata = json!({
            "model_request_policy": {
                "native_tool_policy": {
                    "shell_type": shell_type,
                    "shell_tool_enabled": true,
                    "preferred_shell_surface": "unified_exec",
                    "apply_patch_tool_type": "freeform"
                }
            }
        });
        let policy = native_tool_policy_from_metadata(&metadata).expect("native policy");
        assert_eq!(policy.preferred_shell_surface, None);
        assert!(!policy.shell_tool_enabled);
        assert_eq!(
            native_tool_policy_disallowed_tool_names(Some(&policy)),
            vec![MODEL_NATIVE_SHELL_TOOL_NAME, MODEL_NATIVE_STDIN_TOOL_NAME]
        );
    }
}

#[test]
fn canonical_shell_policy_preserves_explicit_tool_opt_out() {
    let metadata = json!({
        "model_request_policy": {
            "native_tool_policy": {
                "shell_type": "unified_exec",
                "shell_tool_enabled": false,
                "apply_patch_tool_type": "freeform"
            }
        }
    });
    let policy = native_tool_policy_from_metadata(&metadata).expect("native policy");
    assert!(!policy.shell_tool_enabled);
    assert_eq!(
        native_tool_policy_disallowed_tool_names(Some(&policy)),
        vec![MODEL_NATIVE_SHELL_TOOL_NAME, MODEL_NATIVE_STDIN_TOOL_NAME]
    );
}

#[test]
fn native_tool_policy_disallowed_tools_follow_model_capabilities() {
    let unified_exec_metadata = json!({
        "model_request_policy": {
            "native_tool_policy": {
                "shell_type": "unified_exec",
                "apply_patch_tool_type": "freeform"
            }
        }
    });
    let unified_exec_policy =
        native_tool_policy_from_metadata(&unified_exec_metadata).expect("native policy");

    assert_eq!(
        native_tool_policy_disallowed_tool_names(Some(&unified_exec_policy)),
        Vec::<&'static str>::new()
    );

    let disabled_patch_metadata = json!({
        "model_request_policy": {
            "native_tool_policy": {
                "shell_type": "shell_command",
                "apply_patch_tool_enabled": true
            }
        }
    });
    let disabled_patch_policy =
        native_tool_policy_from_metadata(&disabled_patch_metadata).expect("native policy");

    assert_eq!(
        native_tool_policy_disallowed_tool_names(Some(&disabled_patch_policy)),
        vec![MODEL_NATIVE_APPLY_PATCH_TOOL_NAME]
    );
}

#[test]
fn model_request_policy_from_turn_context_reads_runtime_options_first() {
    let context = AgentTurnContext {
        metadata: HashMap::from([(
            "runtime_options".to_string(),
            json!({
                "harness": {
                    "model_request_policy": {
                        "provider_id": "newer",
                        "tool_call_policy": { "supports_parallel_tool_calls": true }
                    }
                }
            }),
        )]),
        ..AgentTurnContext::default()
    };

    let policy = model_request_policy_from_turn_context(Some(&context)).expect("policy");

    assert_eq!(policy.provider_id.as_deref(), Some("newer"));
    assert_eq!(
        policy
            .tool_call_policy
            .as_ref()
            .map(|policy| policy.parallel_tool_calls),
        Some(true)
    );
}

#[test]
fn invalid_truncation_policy_falls_back_to_default_bytes() {
    let metadata = json!({
        "model_request_policy": {
            "truncation_policy": {
                "truncation_policy": {
                    "mode": "words",
                    "limit": 0
                }
            }
        }
    });

    let policy = model_request_policy_from_metadata(&metadata).expect("policy");

    assert_eq!(
        policy.truncation_policy,
        Some(ModelTruncationPolicySnapshot {
            mode: "bytes".into(),
            limit: TruncationPolicy::default().byte_budget() as u64,
        })
    );
}

#[test]
fn runtime_reply_policy_disables_parallel_tool_calls_for_responses_lite() {
    let metadata = json!({
        "model_request_policy": {
            "responses_policy": {
                "use_responses_lite": true
            },
            "tool_call_policy": {
                "supports_parallel_tool_calls": true,
                "parallel_tool_calls": true
            }
        }
    });

    let policy = runtime_reply_model_request_policy_from_metadata(&metadata).expect("policy");

    let responses = policy.responses.as_ref().expect("responses policy");
    assert!(responses.use_responses_lite);
    assert_eq!(responses.request_mode, "responses_lite");
    assert_eq!(responses.instructions_location, "input_prefix");
    assert_eq!(responses.tools_location, "input_prefix");
    assert_eq!(responses.reasoning_context, "all_turns");
    assert!(!responses.parallel_tool_calls_allowed);
    assert!(responses.requires_responses_lite_header);
    assert_eq!(policy.parallel_tool_calls(), Some(false));
}

#[test]
fn runtime_reply_policy_keeps_parallel_tool_calls_when_responses_allows_it() {
    let metadata = json!({
        "model_request_policy": {
            "responses_policy": {
                "use_responses_lite": false,
                "parallel_tool_calls_allowed": true
            },
            "tool_call_policy": {
                "supports_parallel_tool_calls": true,
                "parallel_tool_calls": true
            }
        }
    });

    let policy = runtime_reply_model_request_policy_from_metadata(&metadata).expect("policy");

    let responses = policy.responses.as_ref().expect("responses policy");
    assert!(!responses.use_responses_lite);
    assert_eq!(responses.request_mode, "responses");
    assert_eq!(responses.reasoning_context, "default");
    assert_eq!(policy.parallel_tool_calls(), Some(true));
}

#[test]
fn runtime_reply_policy_carries_reasoning_output_controls() {
    let metadata = json!({
        "model_request_policy": {
            "reasoning_output_policy": {
                "default_reasoning_summary": "detailed",
                "support_verbosity": true,
                "default_verbosity": "medium"
            }
        }
    });

    let policy = runtime_reply_model_request_policy_from_metadata(&metadata).expect("policy");

    let reasoning_output = policy
        .reasoning_output
        .as_ref()
        .expect("reasoning output policy");
    assert_eq!(reasoning_output.default_reasoning_summary, "detailed");
    assert!(reasoning_output.support_verbosity);
    assert_eq!(
        reasoning_output.default_verbosity.as_deref(),
        Some("medium")
    );
    assert!(reasoning_output.can_set_verbosity);
    assert_eq!(policy.reasoning_summary(), Some("detailed"));
    assert_eq!(policy.text_verbosity(), Some("medium"));
}

#[test]
fn missing_policy_returns_none() {
    let context = AgentTurnContext {
        metadata: HashMap::from([(
            "runtime_options".to_string(),
            json!({ "harness": { "theme": "draft" } }),
        )]),
        ..AgentTurnContext::default()
    };

    assert!(model_request_policy_from_turn_context(Some(&context)).is_none());
    assert!(model_request_policy_from_metadata(&json!({ "harness": {} })).is_none());
}
