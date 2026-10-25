use super::*;
use model_provider::current_client::{CurrentProviderToolCall, CurrentProviderToolResult};

#[test]
fn identified_user_input_round_trips_without_provider_envelopes() {
    let message = CurrentProviderMessage::user(vec![CurrentProviderContent::Text(
        "<hook_prompt hook_run_id=\"stop:1\">verify &amp; retry</hook_prompt>".into(),
    )]);
    let record = ModelHistoryRecord::input(message.clone(), "hook-item".into()).unwrap();
    let restored: ModelHistoryRecord =
        serde_json::from_value(serde_json::to_value(record).unwrap()).unwrap();
    assert_eq!(
        restored.metadata.source_item_id.as_deref(),
        Some("hook-item")
    );
    assert_eq!(restored.into_message().unwrap(), message);
    assert!(ModelHistoryRecord::completed(message, "hook-item".into()).is_err());
}

#[test]
fn identified_input_rejects_missing_identity_native_payloads_roles_and_budgets() {
    let valid = ModelHistoryRecord::input(
        CurrentProviderMessage::user(vec![CurrentProviderContent::Text("retry".into())]),
        "hook-item".into(),
    )
    .unwrap();
    for change in 0..7 {
        let mut invalid = valid.clone();
        match change {
            0 => invalid.metadata.source_item_id = Some("  ".into()),
            1 => invalid.message.producer = Some("provider".into()),
            2 => invalid
                .message
                .content
                .push(CurrentProviderContent::RawResponseItem(
                    serde_json::json!({"type":"message","role":"user"}),
                )),
            3 => invalid.message.role = CurrentProviderRole::Assistant,
            4 => {
                invalid
                    .metadata
                    .output_token_limits
                    .insert("other".into(), 1);
            }
            5 => invalid.message.content.clear(),
            6 => invalid.message.content = vec![CurrentProviderContent::Text("  ".into())],
            _ => unreachable!(),
        }
        assert!(
            invalid.into_message().is_err(),
            "invalid input case {change}"
        );
    }
    assert!(ModelHistoryRecord::input(
        CurrentProviderMessage::assistant(vec![CurrentProviderContent::Text("retry".into())]),
        "hook-item".into(),
    )
    .is_err());
}

#[test]
fn history_receipt_requires_a_real_record_identity_and_sequence() {
    for (event_id, sequence) in [("", 1), ("  ", 1), ("event", 0)] {
        assert!(HistoryReceipt::new(event_id, sequence).is_err());
    }
}

#[test]
fn raw_arguments_and_zero_budget_survive_persistence_without_wire_metadata() {
    let call = CurrentProviderContent::ToolCall(CurrentProviderToolCall::from_raw(
        "call-1".to_string(),
        "exec_command".to_string(),
        "{ \"cmd\": \"pwd\" }".to_string(),
    ));
    let record = ModelHistoryRecord::calls(&[call.clone()]).unwrap();
    let encoded = serde_json::to_value(record).unwrap();
    let decoded: ModelHistoryRecord = serde_json::from_value(encoded).unwrap();
    assert_eq!(decoded.into_message().unwrap().content, vec![call]);
    let output = CurrentProviderContent::ToolResult(CurrentProviderToolResult {
        content_items: Vec::new(),
        history_token_limit: Some(0),
        call_id: "call-1".to_string(),
        name: "exec_command".to_string(),
        success: true,
        output: "original durable output".to_string(),
        error: None,
    });
    let record = ModelHistoryRecord::outputs(&[output.clone()]);
    assert_eq!(record.metadata.output_token_limits["call-1"], 0);
    assert!(
        matches!(&record.message.content[0], CurrentProviderContent::ToolResult(result) if result.history_token_limit.is_none())
    );
    let decoded: ModelHistoryRecord =
        serde_json::from_value(serde_json::to_value(record).unwrap()).unwrap();
    assert_eq!(decoded.into_message().unwrap().content, vec![output]);
}

#[test]
fn history_record_rejects_non_tool_content_and_unmatched_budgets() {
    let record = ModelHistoryRecord {
        message: CurrentProviderMessage::user(vec![CurrentProviderContent::Text(
            "not a tool".to_string(),
        )]),
        metadata: ModelHistoryMetadata::default(),
    };
    assert!(record.into_message().is_err());
    let mut record = ModelHistoryRecord::calls(&[CurrentProviderContent::ToolCall(
        CurrentProviderToolCall::new("call-1", "Read", serde_json::json!({})),
    )])
    .unwrap();
    record
        .metadata
        .output_token_limits
        .insert("other-call".to_string(), 0);
    assert!(record.into_message().is_err());
}

#[test]
fn invalid_model_names_are_preserved_but_missing_call_ids_are_rejected() {
    let call = CurrentProviderContent::ToolCall(CurrentProviderToolCall::from_raw(
        "invalid-name-call".to_string(),
        String::new(),
        "{not-json".to_string(),
    ));
    let record = ModelHistoryRecord::calls(&[call.clone()]).unwrap();
    assert_eq!(record.into_message().unwrap().content, vec![call]);
    let output = CurrentProviderContent::ToolResult(CurrentProviderToolResult {
        content_items: Vec::new(),
        history_token_limit: Some(0),
        call_id: "invalid-name-call".to_string(),
        name: String::new(),
        success: false,
        output: "unknown tool".to_string(),
        error: Some("unknown tool".to_string()),
    });
    assert_eq!(
        ModelHistoryRecord::outputs(&[output.clone()])
            .into_message()
            .unwrap()
            .content,
        vec![output],
    );
    let unidentified = CurrentProviderContent::ToolCall(CurrentProviderToolCall::new(
        "",
        "Read",
        serde_json::json!({}),
    ));
    assert!(ModelHistoryRecord::calls(&[unidentified])
        .unwrap()
        .into_message()
        .is_err());
}
