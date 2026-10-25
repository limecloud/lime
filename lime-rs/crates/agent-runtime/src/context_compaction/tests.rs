use super::*;
use futures::{future::BoxFuture, stream};
use model_provider::current_client::{
    CurrentProviderContent, CurrentProviderMessage, CurrentProviderStream, CurrentProviderTool,
    CurrentProviderToolCall, CurrentProviderToolResult,
};
use std::sync::Mutex;

struct Provider {
    events: Vec<CanonicalLlmEvent>,
    requests: Mutex<Vec<CurrentProviderRequest>>,
    pending: bool,
}

impl CurrentProvider for Provider {
    fn stream<'a>(
        &'a self,
        request: CurrentProviderRequest,
    ) -> BoxFuture<'a, Result<CurrentProviderStream, CurrentProviderError>> {
        self.requests.lock().unwrap().push(request);
        Box::pin(async move {
            if self.pending {
                return Ok(Box::pin(stream::pending()) as CurrentProviderStream);
            }
            Ok(
                Box::pin(stream::iter(self.events.clone().into_iter().map(Ok)))
                    as CurrentProviderStream,
            )
        })
    }
}

fn provider(events: Vec<CanonicalLlmEvent>) -> Provider {
    Provider {
        events,
        requests: Mutex::new(Vec::new()),
        pending: false,
    }
}

fn request() -> CurrentProviderRequest {
    CurrentProviderRequest::new(vec![
        CurrentProviderMessage::user(vec![CurrentProviderContent::Text(
            "Previous window summary: keep the user constraint and pending work".to_string(),
        )]),
        CurrentProviderMessage::assistant(vec![CurrentProviderContent::ToolCall(
            CurrentProviderToolCall::new(
                "read-1",
                "read_file",
                serde_json::json!({"path":"state.md"}),
            ),
        )]),
        CurrentProviderMessage::tool(vec![CurrentProviderContent::ToolResult(
            CurrentProviderToolResult {
                content_items: Vec::new(),
                history_token_limit: None,
                call_id: "read-1".to_string(),
                name: "read_file".to_string(),
                success: true,
                output: format!("{} critical-tool-result-at-the-end", "x".repeat(2_000)),
                error: None,
            },
        )]),
    ])
    .with_tools(vec![CurrentProviderTool::function(
        "read_file",
        "must not run during compaction",
        serde_json::json!({"type":"object"}),
    )])
}

fn text(value: &str) -> CanonicalLlmEvent {
    CanonicalLlmEvent::TextDelta {
        id: "summary".to_string(),
        text: value.to_string(),
    }
}

fn finish(reason: FinishReason) -> CanonicalLlmEvent {
    CanonicalLlmEvent::Finish {
        reason,
        needs_follow_up: false,
        usage: None,
        response_id: None,
    }
}

#[tokio::test]
async fn summary_applies_each_selected_model_budget_without_mutating_history() {
    use agent_protocol::truncation::TruncationPolicy;
    use model_provider::provider_stream::RuntimeReplyModelRequestPolicy;
    let provider = provider(vec![text("summary"), finish(FinishReason::Stop)]);
    let original = request();
    for policy in [TruncationPolicy::Bytes(100), TruncationPolicy::Tokens(100)] {
        let configured =
            original
                .clone()
                .with_model_request_policy(RuntimeReplyModelRequestPolicy::new(
                    None,
                    None,
                    None,
                    Some(policy),
                ));
        summarize_context(&provider, configured, CancellationToken::new())
            .await
            .unwrap();
    }
    let requests = provider.requests.lock().unwrap();
    let result = |request: &CurrentProviderRequest| {
        request
            .messages
            .iter()
            .flat_map(|message| &message.content)
            .find_map(|part| match part {
                CurrentProviderContent::ToolResult(result) => Some(result.output.clone()),
                _ => None,
            })
            .unwrap()
    };
    assert_eq!(
        result(&requests[0]),
        tool_runtime::tool_io::truncate_tool_output(
            &result(&original),
            TruncationPolicy::Bytes(120)
        )
    );
    assert_eq!(
        result(&requests[1]),
        tool_runtime::tool_io::truncate_tool_output(
            &result(&original),
            TruncationPolicy::Tokens(120)
        )
    );
    assert_ne!(result(&requests[0]), result(&requests[1]));
    assert_eq!(original.messages, request().messages);
}

#[tokio::test]
async fn summary_is_committed_only_after_a_complete_nonempty_response() {
    let provider = provider(vec![
        text("constraint; "),
        text("pending tool result"),
        finish(FinishReason::Stop),
    ]);
    let summary = summarize_context(&provider, request(), CancellationToken::new())
        .await
        .unwrap();
    assert_eq!(summary, "constraint; pending tool result");
    let requests = provider.requests.lock().unwrap();
    assert_eq!(requests[0].messages, request().messages);
    assert!(requests[0].tools.is_empty());
}

#[tokio::test]
async fn summary_request_repairs_incomplete_history_without_modifying_the_source() {
    let provider = provider(vec![
        text("recovered pending work"),
        finish(FinishReason::Stop),
    ]);
    let mut request = request();
    request
        .messages
        .push(CurrentProviderMessage::assistant(vec![
            CurrentProviderContent::ToolCall(CurrentProviderToolCall::new(
                "unfinished",
                "exec_command",
                serde_json::json!({"cmd":"never execute"}),
            )),
        ]));
    request.messages.push(CurrentProviderMessage::tool(vec![
        CurrentProviderContent::ToolResult(CurrentProviderToolResult {
            content_items: Vec::new(),
            history_token_limit: None,
            call_id: "orphan".to_string(),
            name: "read_file".to_string(),
            success: true,
            output: "remove orphan".to_string(),
            error: None,
        }),
    ]));
    let source = request.messages.clone();
    summarize_context(&provider, request, CancellationToken::new())
        .await
        .unwrap();
    let requests = provider.requests.lock().unwrap();
    let parts = requests[0]
        .messages
        .iter()
        .flat_map(|message| &message.content)
        .collect::<Vec<_>>();
    assert!(parts.iter().any(|part| matches!(part,
        CurrentProviderContent::ToolResult(result)
            if result.call_id == "unfinished" && !result.success && result.output == "aborted")));
    assert!(!parts.iter().any(|part| matches!(part,
        CurrentProviderContent::ToolResult(result) if result.call_id == "orphan")));
    assert_eq!(
        &requests[0].messages[..3],
        &source[..3],
        "existing pair and full result must survive"
    );
    assert!(requests[0].tools.is_empty());
    assert!(matches!(&source.last().unwrap().content[0],
        CurrentProviderContent::ToolResult(result) if result.call_id == "orphan"));
}

#[tokio::test]
async fn empty_incomplete_and_tool_responses_cannot_become_a_context_window() {
    for events in [
        vec![finish(FinishReason::Stop)],
        vec![text("  "), finish(FinishReason::Stop)],
        vec![text("partial")],
        vec![text("partial"), finish(FinishReason::Length)],
        vec![text("partial"), finish(FinishReason::ContentFilter)],
        vec![CanonicalLlmEvent::CustomToolCall {
            id: "unexpected-tool".to_string(),
            name: "exec_command".to_string(),
            input: "touch forbidden".to_string(),
            namespace: None,
            provider_metadata: Default::default(),
        }],
        vec![
            text("partial"),
            CanonicalLlmEvent::ProviderError {
                message: "upstream failed".to_string(),
                classification: None,
                retryable: Some(false),
            },
        ],
    ] {
        let provider = provider(events);
        assert!(
            summarize_context(&provider, request(), CancellationToken::new())
                .await
                .is_err()
        );
    }
}

#[tokio::test]
async fn cancellation_drops_a_pending_stream_and_prevents_a_new_request() {
    let mut provider = provider(Vec::new());
    provider.pending = true;
    let token = CancellationToken::new();
    let summary = summarize_context(&provider, request(), token.clone());
    let cancel = async {
        tokio::task::yield_now().await;
        token.cancel();
    };
    let (result, ()) = tokio::join!(summary, cancel);
    assert!(result.unwrap_err().to_string().contains("cancelled"));
    assert_eq!(provider.requests.lock().unwrap().len(), 1);
    assert!(summarize_context(&provider, request(), token)
        .await
        .is_err());
    assert_eq!(provider.requests.lock().unwrap().len(), 1);
}
