use super::*;

fn image_content() -> Vec<ContentPart> {
    vec![ContentPart::media("sidecar://image-1", "image/png").expect("canonical media")]
}

fn detailed_image_content(detail: ImageDetail) -> Vec<ContentPart> {
    vec![
        ContentPart::media_with_detail("sidecar://image-1", "image/png", Some(detail))
            .expect("canonical media"),
    ]
}

fn media_payloads() -> BTreeMap<String, String> {
    BTreeMap::from([(
        "sidecar://image-1".to_string(),
        "data:image/png;base64,abc".to_string(),
    )])
}

#[test]
fn openai_compatible_image_parts_use_only_native_wire_fields() {
    let content = image_content();
    let payloads = media_payloads();

    let chat = chat_content(&content, &payloads);
    let responses = responses_input_content(&content, &payloads);

    assert_eq!(chat[0]["type"], "image_url");
    assert_eq!(
        chat[0]["image_url"],
        json!({ "url": "data:image/png;base64,abc" })
    );
    assert!(chat[0]["image_url"].get("media_type").is_none());
    assert_eq!(
        responses[0],
        json!({
            "type": "input_image",
            "image_url": "data:image/png;base64,abc"
        })
    );
    assert!(responses[0].get("media_type").is_none());
}

#[test]
fn anthropic_base64_image_keeps_required_media_type() {
    let message = runtime_core::CanonicalMessage {
        id: None,
        role: CanonicalRole::User,
        content: image_content(),
        metadata: Default::default(),
    };

    let lowered = anthropic_message(&message, &media_payloads());

    assert_eq!(
        lowered[0]["content"][0]["source"],
        json!({
            "type": "base64",
            "media_type": "image/png",
            "data": "abc"
        })
    );
}

#[test]
fn image_detail_is_lowered_only_to_supported_openai_fields() {
    let content = detailed_image_content(ImageDetail::Original);
    let payloads = media_payloads();

    let chat = chat_content(&content, &payloads);
    let responses = responses_input_content(&content, &payloads);
    let anthropic = anthropic_message(
        &runtime_core::CanonicalMessage {
            id: None,
            role: CanonicalRole::User,
            content,
            metadata: Default::default(),
        },
        &payloads,
    );

    assert_eq!(chat[0]["image_url"]["detail"], "original");
    assert_eq!(responses[0]["detail"], "original");
    assert!(anthropic[0]["content"][0].get("detail").is_none());
    assert!(anthropic[0]["content"][0]["source"].get("detail").is_none());
}

fn config(reasoning_effort: Option<&str>) -> RuntimeProviderConfig {
    RuntimeProviderConfig {
        provider_name: "openai".to_string(),
        provider_selector: Some("openai".to_string()),
        model_name: "gpt-5-codex".to_string(),
        api_key: Some("test".to_string()),
        auth: crate::runtime_provider::RuntimeProviderAuth::ApiKey,
        base_url: Some("https://gateway.example.com/v1".to_string()),
        api_version: None,
        credential_uuid: "credential-1".to_string(),
        reasoning_effort: reasoning_effort.map(str::to_string),
        service_tier: None,
        protocol: Some(crate::runtime_provider::RuntimeProviderProtocol::ChatCompletions),
        supports_websockets: false,
        toolshim: false,
        toolshim_model: None,
    }
}

#[test]
fn openai_reasoning_controls_follow_native_wire_shapes() {
    let request = CanonicalRequest::text("gpt-5-codex", "hello");

    let chat = chat_completions_request(
        &config(Some("high")),
        &request,
        &RuntimeReplyProviderRequestWireShape::default(),
        &BTreeMap::new(),
    )
    .expect("Chat Completions lowering");
    assert_eq!(chat["reasoning_effort"], "high");

    let responses = responses_request(
        &config(Some("high")),
        &request,
        &RuntimeReplyProviderRequestWireShape::default(),
        &BTreeMap::new(),
    )
    .expect("Responses lowering");
    assert_eq!(responses["reasoning"], json!({ "effort": "high" }));
}

#[test]
fn structured_output_schema_is_lowered_for_each_current_protocol() {
    let mut request = CanonicalRequest::text("memory-model", "extract");
    request.output_schema = Some(json!({
        "type": "object",
        "properties": {
            "rollout_summary": { "type": "string" },
            "rollout_slug": { "type": "string" }
        },
        "required": ["rollout_summary", "rollout_slug"],
        "additionalProperties": false
    }));
    request.output_schema_strict = true;

    let shape = RuntimeReplyProviderRequestWireShape::default();
    let chat = chat_completions_request(&config(None), &request, &shape, &BTreeMap::new())
        .expect("Chat Completions structured output");
    assert_eq!(chat["response_format"]["type"], "json_schema");
    assert_eq!(chat["response_format"]["json_schema"]["strict"], true);

    let mut responses_config = config(None);
    responses_config.protocol = Some(crate::runtime_provider::RuntimeProviderProtocol::Responses);
    let responses = responses_request(&responses_config, &request, &shape, &BTreeMap::new())
        .expect("Responses structured output");
    assert_eq!(responses["text"]["format"]["type"], "json_schema");
    assert_eq!(responses["text"]["format"]["strict"], true);

    let mut anthropic_config = config(None);
    anthropic_config.protocol =
        Some(crate::runtime_provider::RuntimeProviderProtocol::AnthropicMessages);
    let anthropic = anthropic_request(&anthropic_config, &request, &BTreeMap::new())
        .expect("Anthropic structured output");
    assert_eq!(anthropic["output_config"]["format"]["type"], "json_schema");

    let gemini = super::super::gemini::request(&request, &BTreeMap::new())
        .expect("Gemini structured output");
    assert_eq!(
        gemini["generationConfig"]["responseMimeType"],
        "application/json"
    );
    assert_eq!(
        gemini["generationConfig"]["responseSchema"]["type"],
        "object"
    );
}

#[test]
fn responses_lowering_emits_session_scoped_prompt_cache_key() {
    let mut request = CanonicalRequest::text("gpt-5-codex", "hello");
    request.metadata.insert(
        SESSION_ID_METADATA_KEY.to_string(),
        Value::String("session-1".to_string()),
    );
    let mut provider_config = config(Some("high"));
    provider_config.protocol = Some(crate::runtime_provider::RuntimeProviderProtocol::Responses);

    let responses = responses_request(
        &provider_config,
        &request,
        &RuntimeReplyProviderRequestWireShape::default(),
        &BTreeMap::new(),
    )
    .expect("Responses lowering");

    assert_eq!(responses["prompt_cache_key"], "session-1");
}

fn request_with_tool() -> CanonicalRequest {
    let mut request = CanonicalRequest::text("gpt-5-codex", "hello");
    request.tools = vec![runtime_core::CanonicalToolDefinition::function(
        "read_file",
        "Read a file",
        json!({
            "type": "object",
            "properties": { "path": { "type": "string" } },
            "required": ["path"]
        }),
    )];
    request
}

#[test]
fn parallel_tool_calls_preserves_true_false_and_unknown_wire_states() {
    let request = request_with_tool();

    for (parallel_tool_calls, expected) in [
        (Some(true), Some(true)),
        (Some(false), Some(false)),
        (None, None),
    ] {
        let wire_shape = RuntimeReplyProviderRequestWireShape {
            parallel_tool_calls,
            ..Default::default()
        };
        let responses = responses_request(&config(None), &request, &wire_shape, &BTreeMap::new())
            .expect("Responses lowering");
        assert_eq!(
            responses
                .get("parallel_tool_calls")
                .and_then(Value::as_bool),
            expected,
            "parallel_tool_calls={parallel_tool_calls:?}"
        );
    }
}

#[test]
fn responses_reasoning_summary_context_and_verbosity_share_native_objects() {
    let request = CanonicalRequest::text("gpt-5-codex", "hello");
    let wire_shape = RuntimeReplyProviderRequestWireShape {
        reasoning_context: Some("all_turns".to_string()),
        reasoning_summary: Some("detailed".to_string()),
        text_verbosity: Some("low".to_string()),
        ..Default::default()
    };

    let responses = responses_request(
        &config(Some("high")),
        &request,
        &wire_shape,
        &BTreeMap::new(),
    )
    .expect("Responses lowering");

    assert_eq!(
        responses["reasoning"],
        json!({
            "effort": "high",
            "summary": "detailed",
            "context": "all_turns"
        })
    );
    assert_eq!(responses["text"], json!({ "verbosity": "low" }));
}

#[test]
fn responses_lite_uses_input_prefix_and_strips_image_detail() {
    let mut request = request_with_tool();
    request.system = vec![ContentPart::text("Follow repository rules")];
    request.messages[0].content = detailed_image_content(ImageDetail::Original);
    let wire_shape = RuntimeReplyProviderRequestWireShape {
        use_responses_lite: true,
        instructions_location: Some("input_prefix".to_string()),
        tools_location: Some("input_prefix".to_string()),
        reasoning_context: Some("all_turns".to_string()),
        parallel_tool_calls: Some(false),
        ..Default::default()
    };

    let responses = responses_request(&config(None), &request, &wire_shape, &media_payloads())
        .expect("Responses lowering");

    assert_eq!(
        responses,
        json!({
            "model": "gpt-5-codex",
            "include": ["reasoning.encrypted_content"],
            "input": [
                {
                    "type": "additional_tools",
                    "role": "developer",
                    "tools": [{
                        "type": "function",
                        "name": "read_file",
                        "description": "Read a file",
                        "parameters": {
                            "type": "object",
                            "properties": { "path": { "type": "string" } },
                            "required": ["path"]
                        },
                        "strict": false
                    }]
                },
                {
                    "type": "message",
                    "role": "developer",
                    "content": [{
                        "type": "input_text",
                        "text": "Follow repository rules"
                    }]
                },
                {
                    "type": "message",
                    "role": "user",
                    "content": [{
                        "type": "input_image",
                        "image_url": "data:image/png;base64,abc"
                    }]
                }
            ],
            "stream": true,
            "store": false,
            "parallel_tool_calls": false,
            "reasoning": { "context": "all_turns" }
        })
    );
}

#[test]
fn custom_responses_tools_preserve_freeform_history_and_fail_closed_elsewhere() {
    let mut request = CanonicalRequest::text("gpt-5-codex", "inspect the workspace");
    request.tools = vec![CanonicalToolDefinition::custom(
        "run_code",
        "Run a bounded CodeMode program",
        runtime_core::FreeformToolFormat {
            r#type: "grammar".to_string(),
            syntax: "lark".to_string(),
            definition: "program := statement*".to_string(),
        },
    )];
    request.messages.extend([
        runtime_core::CanonicalMessage {
            id: None,
            role: CanonicalRole::Assistant,
            content: vec![ContentPart::CustomToolCall {
                id: "custom-call-1".to_string(),
                name: "run_code".to_string(),
                input: "return 42;".to_string(),
                namespace: Some("codemode".to_string()),
                metadata: BTreeMap::new(),
            }],
            metadata: BTreeMap::new(),
        },
        runtime_core::CanonicalMessage {
            id: None,
            role: CanonicalRole::Tool,
            content: vec![ContentPart::CustomToolResult {
                id: "custom-call-1".to_string(),
                name: "run_code".to_string(),
                result: ToolResultValue::text("42"),
                error: None,
                metadata: BTreeMap::new(),
            }],
            metadata: BTreeMap::new(),
        },
    ]);

    let mut official = config(None);
    official.provider_name = "openai".to_string();
    official.provider_selector = Some("openai".to_string());
    official.base_url = Some("https://api.openai.com/v1".to_string());
    official.protocol = Some(crate::runtime_provider::RuntimeProviderProtocol::Responses);
    let responses = responses_request(
        &official,
        &request,
        &RuntimeReplyProviderRequestWireShape::default(),
        &BTreeMap::new(),
    )
    .expect("official Responses custom lowering");

    assert_eq!(responses["tools"][0]["type"], "custom");
    assert_eq!(responses["tools"][0]["format"]["syntax"], "lark");
    assert_eq!(responses["input"][1]["type"], "custom_tool_call");
    assert_eq!(responses["input"][1]["namespace"], "codemode");
    assert_eq!(responses["input"][2]["type"], "custom_tool_call_output");

    let mut gateway = official.clone();
    gateway.base_url = Some("https://gateway.example.com/v1".to_string());
    let gateway_responses = responses_request(
        &gateway,
        &request,
        &RuntimeReplyProviderRequestWireShape::default(),
        &BTreeMap::new(),
    )
    .expect("client-side custom tools support third-party Responses endpoints");
    assert_eq!(gateway_responses, responses);
    let error = chat_completions_request(
        &gateway,
        &request,
        &RuntimeReplyProviderRequestWireShape::default(),
        &BTreeMap::new(),
    )
    .expect_err("Chat Completions custom tools must fail closed");
    assert!(error.message.contains("custom tool"));
    let error = anthropic_request(&gateway, &request, &BTreeMap::new())
        .expect_err("Anthropic custom tools must fail closed");
    assert!(error.message.contains("custom tool"));
}

#[test]
fn responses_only_emits_codex_turn_identity_and_protects_reserved_metadata() {
    let metadata = super::super::CurrentProviderRequestMetadata::new(
        "session-1",
        "thread-1",
        "turn-1",
        Some("thread-source".to_string()),
    )
    .with_history_ingest_requested(true)
    .with_extra(runtime_core::ProviderMetadata::from([
        ("session_id".to_string(), json!("overridden-session")),
        (
            "forked_from_thread_id".to_string(),
            json!("overridden-source"),
        ),
        ("request_kind".to_string(), json!("overridden-kind")),
        ("history_ingest_requested".to_string(), json!(false)),
        ("workspace_kind".to_string(), json!("local")),
        ("ignored_object".to_string(), json!({"value": true})),
    ]));
    let provider_request = super::super::CurrentProviderRequest::new(vec![
        super::super::CurrentProviderMessage::user(vec![
            super::super::CurrentProviderContent::Text("hello".to_string()),
        ]),
    ])
    .with_metadata(metadata);
    let canonical = provider_request
        .into_canonical("gpt-5-codex")
        .expect("canonical request");

    let responses = responses_request(
        &config(Some("high")),
        &canonical,
        &RuntimeReplyProviderRequestWireShape::default(),
        &BTreeMap::new(),
    )
    .expect("Responses lowering");
    let client_metadata = responses["client_metadata"]
        .as_object()
        .expect("Responses client_metadata");
    assert_eq!(client_metadata["session_id"], "session-1");
    assert_eq!(client_metadata["thread_id"], "thread-1");
    assert_eq!(client_metadata["turn_id"], "turn-1");
    assert!(!client_metadata.contains_key("forked_from_thread_id"));
    let turn_metadata: Value = serde_json::from_str(
        client_metadata["x-codex-turn-metadata"]
            .as_str()
            .expect("serialized turn metadata"),
    )
    .expect("valid turn metadata JSON");
    assert_eq!(turn_metadata["session_id"], "session-1");
    assert_eq!(turn_metadata["thread_id"], "thread-1");
    assert_eq!(turn_metadata["turn_id"], "turn-1");
    assert_eq!(turn_metadata["forked_from_thread_id"], "thread-source");
    assert_eq!(turn_metadata["request_kind"], "turn");
    assert_eq!(turn_metadata["history_ingest_requested"], true);
    assert_eq!(turn_metadata["workspace_kind"], "local");
    assert!(turn_metadata.get("ignored_object").is_none());

    let chat = chat_completions_request(
        &config(Some("high")),
        &canonical,
        &RuntimeReplyProviderRequestWireShape::default(),
        &BTreeMap::new(),
    )
    .expect("Chat Completions lowering");
    let anthropic =
        anthropic_request(&config(None), &canonical, &BTreeMap::new()).expect("Anthropic lowering");
    assert!(chat.get("client_metadata").is_none());
    assert!(anthropic.get("client_metadata").is_none());
}

#[test]
fn responses_omits_history_ingest_metadata_for_normal_turns() {
    let metadata =
        super::super::CurrentProviderRequestMetadata::new("session-1", "thread-1", "turn-1", None);
    let provider_request = super::super::CurrentProviderRequest::new(vec![
        super::super::CurrentProviderMessage::user(vec![
            super::super::CurrentProviderContent::Text("hello".to_string()),
        ]),
    ])
    .with_metadata(metadata);
    let canonical = provider_request
        .into_canonical("gpt-5-codex")
        .expect("canonical request");

    let responses = responses_request(
        &config(Some("high")),
        &canonical,
        &RuntimeReplyProviderRequestWireShape::default(),
        &BTreeMap::new(),
    )
    .expect("Responses lowering");
    let turn_metadata: Value = serde_json::from_str(
        responses["client_metadata"]["x-codex-turn-metadata"]
            .as_str()
            .expect("serialized turn metadata"),
    )
    .expect("valid turn metadata JSON");
    assert!(turn_metadata.get("history_ingest_requested").is_none());
}

#[test]
fn blank_reasoning_effort_is_omitted() {
    let request = CanonicalRequest::text("gpt-5-codex", "hello");
    let value = chat_completions_request(
        &config(Some("  ")),
        &request,
        &RuntimeReplyProviderRequestWireShape::default(),
        &BTreeMap::new(),
    )
    .expect("Chat Completions lowering");

    assert!(value.get("reasoning_effort").is_none());
}

#[test]
fn openai_service_tier_uses_native_wire_field() {
    let request = CanonicalRequest::text("gpt-5-codex", "hello");
    let mut config = config(None);
    config.service_tier = Some("priority".to_string());

    let chat = chat_completions_request(
        &config,
        &request,
        &RuntimeReplyProviderRequestWireShape::default(),
        &BTreeMap::new(),
    )
    .expect("Chat Completions lowering");
    let responses = responses_request(
        &config,
        &request,
        &RuntimeReplyProviderRequestWireShape::default(),
        &BTreeMap::new(),
    )
    .expect("Responses lowering");

    assert_eq!(chat["service_tier"], "priority");
    assert_eq!(responses["service_tier"], "priority");
}

#[test]
fn chat_assistant_history_preserves_reasoning_content() {
    let message = runtime_core::CanonicalMessage {
        id: None,
        role: CanonicalRole::Assistant,
        content: vec![
            ContentPart::Reasoning {
                text: "先检查输入。".to_string(),
                encrypted: Some("opaque-reasoning".to_string()),
                metadata: Default::default(),
            },
            ContentPart::text("结果"),
        ],
        metadata: Default::default(),
    };

    let lowered = chat_message(&message, &BTreeMap::new());

    assert_eq!(lowered[0]["reasoning_content"], "先检查输入。");
    assert_eq!(lowered[0]["content"], "结果");
}

#[test]
fn responses_history_preserves_completed_reasoning_without_synthesizing_deltas() {
    let raw = json!({
        "id": "rs_completed_reasoning", "type": "reasoning",
        "summary": [{"type": "summary_text", "text": "summary"}],
        "encrypted_content": "opaque-reasoning"
    });
    for completed in [false, true] {
        let mut content = vec![ContentPart::Reasoning {
            text: "display-only delta".to_string(),
            encrypted: None,
            metadata: Default::default(),
        }];
        if completed {
            content.push(ContentPart::RawResponseItem { item: raw.clone() });
        }
        let message = runtime_core::CanonicalMessage {
            id: None,
            role: CanonicalRole::Assistant,
            content,
            metadata: Default::default(),
        };
        let expected = if completed { vec![raw.clone()] } else { vec![] };
        assert_eq!(responses_message(&message, &BTreeMap::new()), expected);
    }
}
